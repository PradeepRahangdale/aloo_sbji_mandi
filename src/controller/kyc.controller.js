import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import crypto from "crypto";

// ──────────────────────────────────────────────
// CONFIGURATION
// In production, replace with real KYC provider (Digio, Signzy, Karza)
// Set these in .env:
//   KYC_PROVIDER_API_KEY=your_api_key
//   KYC_PROVIDER_BASE_URL=https://api.provider.com
//   KYC_ENCRYPTION_KEY=32-char-hex-key
// ──────────────────────────────────────────────

const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 3;
const OTP_COOLDOWN_SECONDS = 60;

// Simple encryption for Aadhaar at rest (use env key in production)
const ENCRYPTION_KEY = process.env.KYC_ENCRYPTION_KEY || "aloo_mandi_kyc_default_key_32ch";
const IV_LENGTH = 16;

function encryptAadhaar(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decryptAadhaar(text) {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function maskAadhaar(number) {
    if (!number || number.length !== 12) return 'XXXX XXXX XXXX';
    return `XXXX XXXX ${number.substring(8)}`;
}

// ──────────────────────────────────────────────
// 1. SEND OTP
// POST /api/v1/kyc/send-otp
// Body: { aadhaarNumber: "123456789012" }
// ──────────────────────────────────────────────
const sendAadhaarOtp = asyncHandler(async (req, res) => {
    const aadhaarNumber = (req.body.aadhaarNumber || '').toString().trim().replace(/[\s-]/g, '');
    const userId = req.user._id;

    // Validate Aadhaar format
    if (!aadhaarNumber || aadhaarNumber.length !== 12 || !/^\d{12}$/.test(aadhaarNumber)) {
        throw new ApiError(400, "Invalid Aadhaar number. Must be exactly 12 digits.");
    }

    if (aadhaarNumber.startsWith('0') || aadhaarNumber.startsWith('1')) {
        throw new ApiError(400, "Invalid Aadhaar number. Cannot start with 0 or 1.");
    }

    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, "User not found");

    // Check if already verified
    if (user.kyc?.status === 'verified') {
        throw new ApiError(400, "Aadhaar is already verified.");
    }

    // Check cooldown (prevent OTP spam)
    if (user.kyc?.otpExpiresAt) {
        const timeSinceLastOtp = Date.now() - (new Date(user.kyc.otpExpiresAt).getTime() - OTP_EXPIRY_MINUTES * 60 * 1000);
        if (timeSinceLastOtp < OTP_COOLDOWN_SECONDS * 1000) {
            const waitSeconds = Math.ceil((OTP_COOLDOWN_SECONDS * 1000 - timeSinceLastOtp) / 1000);
            throw new ApiError(429, `Please wait ${waitSeconds} seconds before requesting another OTP.`);
        }
    }

    // ──────────────────────────────────────────────
    // PRODUCTION: Call real KYC provider here
    // Example with Signzy/Digio:
    //
    // const response = await fetch(`${KYC_PROVIDER_URL}/aadhaar/otp`, {
    //     method: 'POST',
    //     headers: { 'Authorization': `Bearer ${KYC_API_KEY}`, 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ aadhaar_number: aadhaarNumber })
    // });
    // const data = await response.json();
    // const transactionId = data.transaction_id;
    //
    // For now, we simulate the OTP flow:
    // ──────────────────────────────────────────────

    const transactionId = `TXN_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    // In simulation mode, generate a 6-digit OTP for testing
    // In production, the OTP is sent by UIDAI to user's linked mobile - you never see it
    const simulatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store encrypted Aadhaar and transaction info
    user.kyc = {
        ...user.kyc?.toObject?.() || {},
        aadhaarNumber: encryptAadhaar(aadhaarNumber),
        aadhaarLast4: aadhaarNumber.substring(8),
        status: 'otp_sent',
        otpTransactionId: transactionId,
        otpExpiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
        otpAttempts: 0,
        // SIMULATION ONLY: store OTP hash for verification (remove in production)
        _simulatedOtpHash: crypto.createHash('sha256').update(simulatedOtp).digest('hex'),
    };
    await user.save();

    // Log masked Aadhaar only (NEVER log full number)
    console.log(`[KYC] OTP sent for user ${userId}, Aadhaar: ${maskAadhaar(aadhaarNumber)}, txn: ${transactionId}`);

    res.status(200).json(new ApiResponse(200, {
        transactionId,
        maskedAadhaar: maskAadhaar(aadhaarNumber),
        expiresInMinutes: OTP_EXPIRY_MINUTES,
        message: "OTP sent to Aadhaar-linked mobile number",
        // SIMULATION ONLY: remove this in production!
        _simulatedOtp: process.env.NODE_ENV !== 'production' ? simulatedOtp : undefined,
    }, "OTP sent successfully"));
});

// ──────────────────────────────────────────────
// 2. VERIFY OTP
// POST /api/v1/kyc/verify-otp
// Body: { otp: "123456", transactionId: "TXN_..." }
// ──────────────────────────────────────────────
const verifyAadhaarOtp = asyncHandler(async (req, res) => {
    const { otp, transactionId } = req.body;
    const userId = req.user._id;

    if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
        throw new ApiError(400, "Invalid OTP. Must be 6 digits.");
    }

    if (!transactionId) {
        throw new ApiError(400, "Transaction ID is required.");
    }

    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, "User not found");

    // Check KYC state
    if (user.kyc?.status === 'verified') {
        throw new ApiError(400, "Aadhaar is already verified.");
    }

    if (user.kyc?.status !== 'otp_sent') {
        throw new ApiError(400, "No OTP request found. Please request OTP first.");
    }

    // Check transaction ID matches
    if (user.kyc.otpTransactionId !== transactionId) {
        throw new ApiError(400, "Invalid transaction. Please request a new OTP.");
    }

    // Check expiry
    if (new Date() > new Date(user.kyc.otpExpiresAt)) {
        user.kyc.status = 'not_started';
        user.kyc.otpTransactionId = '';
        await user.save();
        throw new ApiError(410, "OTP has expired. Please request a new one.");
    }

    // Check attempts
    if (user.kyc.otpAttempts >= MAX_OTP_ATTEMPTS) {
        user.kyc.status = 'not_started';
        user.kyc.otpTransactionId = '';
        await user.save();
        throw new ApiError(429, "Too many failed attempts. Please request a new OTP.");
    }

    // ──────────────────────────────────────────────
    // PRODUCTION: Call real KYC provider to verify
    //
    // const response = await fetch(`${KYC_PROVIDER_URL}/aadhaar/verify`, {
    //     method: 'POST',
    //     headers: { 'Authorization': `Bearer ${KYC_API_KEY}` },
    //     body: JSON.stringify({ otp, transaction_id: transactionId })
    // });
    // const data = await response.json();
    // const isValid = data.verified === true;
    //
    // SIMULATION: verify against stored hash
    // ──────────────────────────────────────────────

    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const isValid = otpHash === user.kyc._simulatedOtpHash;

    if (!isValid) {
        console.log(`[KYC] Invalid OTP attempt for user ${userId}, attempt #${(user.kyc.otpAttempts || 0) + 1}`);
        user.kyc.otpAttempts = (user.kyc.otpAttempts || 0) + 1;
        const remaining = MAX_OTP_ATTEMPTS - user.kyc.otpAttempts;
        await user.save();
        throw new ApiError(401, `Invalid OTP. ${remaining} attempt(s) remaining.`);
    }

    // SUCCESS - mark as verified
    user.kyc.status = 'verified';
    user.kyc.verifiedAt = new Date();
    user.kyc.otpTransactionId = '';
    user.kyc.otpExpiresAt = null;
    user.kyc.otpAttempts = 0;
    user.kyc._simulatedOtpHash = undefined;
    user.kyc.providerRefId = transactionId; // store for audit trail
    await user.save();

    console.log(`[KYC] Aadhaar verified for user ${userId}, Aadhaar: XXXX XXXX ${user.kyc.aadhaarLast4}`);

    res.status(200).json(new ApiResponse(200, {
        status: 'verified',
        maskedAadhaar: `XXXX XXXX ${user.kyc.aadhaarLast4}`,
        verifiedAt: user.kyc.verifiedAt,
    }, "Aadhaar verified successfully! 🎉"));
});

// ──────────────────────────────────────────────
// 3. GET KYC STATUS
// GET /api/v1/kyc/status
// ──────────────────────────────────────────────
const getKycStatus = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, "User not found");

    const kyc = user.kyc || {};

    res.status(200).json(new ApiResponse(200, {
        status: kyc.status || 'not_started',
        maskedAadhaar: kyc.aadhaarLast4 ? `XXXX XXXX ${kyc.aadhaarLast4}` : null,
        verifiedAt: kyc.verifiedAt || null,
        hasPhoto: !!kyc.aadhaarPhotoUrl,
    }, "KYC status fetched"));
});

// ──────────────────────────────────────────────
// 4. UPLOAD AADHAAR PHOTO (optional supporting doc)
// POST /api/v1/kyc/upload-photo
// Body: { photo: "data:image/jpeg;base64,..." }
// ──────────────────────────────────────────────
const uploadAadhaarPhoto = asyncHandler(async (req, res) => {
    const { photo } = req.body;
    const userId = req.user._id;

    if (!photo) {
        throw new ApiError(400, "Photo is required.");
    }

    // Limit photo size to ~5MB base64 (~6.6MB encoded)
    if (typeof photo !== 'string' || photo.length > 7 * 1024 * 1024) {
        throw new ApiError(400, "Photo is too large. Maximum 5MB allowed.");
    }

    // Validate it's actually a base64 image
    if (!photo.startsWith('data:image/')) {
        throw new ApiError(400, "Invalid photo format. Must be a base64-encoded image.");
    }

    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, "User not found");

    if (!user.kyc) user.kyc = {};
    user.kyc.aadhaarPhotoUrl = photo;
    await user.save();

    res.status(200).json(new ApiResponse(200, {
        hasPhoto: true,
    }, "Aadhaar photo uploaded successfully"));
});

// ──────────────────────────────────────────────
// 5. RESEND OTP
// POST /api/v1/kyc/resend-otp
// ──────────────────────────────────────────────
const resendAadhaarOtp = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, "User not found");

    if (user.kyc?.status === 'verified') {
        throw new ApiError(400, "Aadhaar is already verified.");
    }

    if (!user.kyc?.aadhaarNumber) {
        throw new ApiError(400, "No Aadhaar number found. Please start verification first.");
    }

    // Decrypt stored Aadhaar to resend
    let aadhaarNumber;
    try {
        aadhaarNumber = decryptAadhaar(user.kyc.aadhaarNumber);
    } catch (e) {
        console.error(`[KYC] Failed to decrypt Aadhaar for user ${userId}:`, e.message);
        user.kyc.status = 'not_started';
        user.kyc.aadhaarNumber = '';
        await user.save();
        throw new ApiError(500, "Stored Aadhaar data is corrupted. Please re-enter your Aadhaar number.");
    }

    // Check cooldown
    if (user.kyc?.otpExpiresAt) {
        const timeSinceLastOtp = Date.now() - (new Date(user.kyc.otpExpiresAt).getTime() - OTP_EXPIRY_MINUTES * 60 * 1000);
        if (timeSinceLastOtp < OTP_COOLDOWN_SECONDS * 1000) {
            const waitSeconds = Math.ceil((OTP_COOLDOWN_SECONDS * 1000 - timeSinceLastOtp) / 1000);
            throw new ApiError(429, `Please wait ${waitSeconds} seconds before requesting another OTP.`);
        }
    }

    // Generate new OTP (same simulation logic)
    const transactionId = `TXN_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const simulatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    user.kyc.status = 'otp_sent';
    user.kyc.otpTransactionId = transactionId;
    user.kyc.otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    user.kyc.otpAttempts = 0;
    user.kyc._simulatedOtpHash = crypto.createHash('sha256').update(simulatedOtp).digest('hex');
    await user.save();

    console.log(`[KYC] OTP resent for user ${userId}, Aadhaar: ${maskAadhaar(aadhaarNumber)}`);

    res.status(200).json(new ApiResponse(200, {
        transactionId,
        maskedAadhaar: maskAadhaar(aadhaarNumber),
        expiresInMinutes: OTP_EXPIRY_MINUTES,
        message: "OTP resent to Aadhaar-linked mobile number",
        _simulatedOtp: process.env.NODE_ENV !== 'production' ? simulatedOtp : undefined,
    }, "OTP resent successfully"));
});

export {
    sendAadhaarOtp,
    verifyAadhaarOtp,
    getKycStatus,
    uploadAadhaarPhoto,
    resendAadhaarOtp,
};
