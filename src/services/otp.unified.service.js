import crypto from 'crypto';
import { sendOTPEmail } from './email.service.js';
import { sendOTPSMS, isTwilioConfigured } from './sms.service.js';

// ============================================
// Unified OTP Service with Security Features
// ============================================

// In-memory stores (use Redis in production for scalability)
const otpStore = new Map();
const rateLimitStore = new Map();
const attemptStore = new Map();

// Configuration
const config = {
    OTP_LENGTH: 4,
    OTP_EXPIRY_MS: 5 * 60 * 1000,        // 5 minutes
    MAX_OTP_REQUESTS: 5,                   // Max 5 OTP requests per period
    RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,  // 15 minutes window
    MAX_VERIFY_ATTEMPTS: 5,                // Max 5 wrong attempts
    VERIFY_LOCKOUT_MS: 30 * 60 * 1000,     // 30 minutes lockout after max attempts
};

// Secure OTP generation using crypto
const generateSecureOTP = (length = config.OTP_LENGTH) => {
    const digits = '0123456789';
    let otp = '';
    const randomBytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
        otp += digits[randomBytes[i] % 10];
    }
    return otp;
};

// Hash OTP for secure storage
const hashOTP = (otp) => {
    return crypto.createHash('sha256').update(otp).digest('hex');
};

// Clean up expired entries periodically
setInterval(() => {
    const now = Date.now();

    for (const [key, data] of otpStore.entries()) {
        if (data.expiresAt < now) {
            otpStore.delete(key);
        }
    }

    for (const [key, data] of rateLimitStore.entries()) {
        if (data.windowExpiresAt < now) {
            rateLimitStore.delete(key);
        }
    }

    for (const [key, data] of attemptStore.entries()) {
        if (data.lockoutUntil && data.lockoutUntil < now) {
            attemptStore.delete(key);
        }
    }
}, 60000);

// ============================================
// Rate Limiting
// ============================================

export const checkRateLimit = (identifier, type = 'phone') => {
    const key = `ratelimit:${type}:${identifier}`;
    const now = Date.now();
    const stored = rateLimitStore.get(key);

    // Check if window expired
    if (!stored || stored.windowExpiresAt < now) {
        rateLimitStore.set(key, {
            attempts: 1,
            windowExpiresAt: now + config.RATE_LIMIT_WINDOW_MS
        });
        return { allowed: true, remaining: config.MAX_OTP_REQUESTS - 1 };
    }

    // Check if max attempts reached
    if (stored.attempts >= config.MAX_OTP_REQUESTS) {
        const remainingTime = Math.ceil((stored.windowExpiresAt - now) / 1000);
        const minutes = Math.floor(remainingTime / 60);
        const seconds = remainingTime % 60;
        return {
            allowed: false,
            message: `Too many OTP requests. Please try again in ${minutes}m ${seconds}s.`,
            retryAfter: remainingTime
        };
    }

    // Increment attempts
    stored.attempts += 1;
    rateLimitStore.set(key, stored);
    return { allowed: true, remaining: config.MAX_OTP_REQUESTS - stored.attempts };
};

// ============================================
// Brute Force Protection
// ============================================

const checkVerifyAttempts = (identifier, type = 'phone') => {
    const key = `attempts:${type}:${identifier}`;
    const now = Date.now();
    const stored = attemptStore.get(key);

    // Check if locked out
    if (stored && stored.lockoutUntil && stored.lockoutUntil > now) {
        const remainingTime = Math.ceil((stored.lockoutUntil - now) / 1000);
        const minutes = Math.floor(remainingTime / 60);
        return {
            allowed: false,
            message: `Account temporarily locked. Try again in ${minutes} minutes.`,
            locked: true
        };
    }

    return { allowed: true };
};

const recordFailedAttempt = (identifier, type = 'phone') => {
    const key = `attempts:${type}:${identifier}`;
    const now = Date.now();
    const stored = attemptStore.get(key) || { count: 0 };

    stored.count += 1;
    stored.lastAttempt = now;

    // Lock out after max attempts
    if (stored.count >= config.MAX_VERIFY_ATTEMPTS) {
        stored.lockoutUntil = now + config.VERIFY_LOCKOUT_MS;
    }

    attemptStore.set(key, stored);

    return {
        attemptsRemaining: Math.max(0, config.MAX_VERIFY_ATTEMPTS - stored.count),
        locked: stored.count >= config.MAX_VERIFY_ATTEMPTS
    };
};

const clearFailedAttempts = (identifier, type = 'phone') => {
    const key = `attempts:${type}:${identifier}`;
    attemptStore.delete(key);
};

// ============================================
// OTP Storage
// ============================================

export const storeOTP = (identifier, otp, type = 'phone') => {
    const key = `otp:${type}:${identifier}`;
    const hashedOTP = hashOTP(otp);

    otpStore.set(key, {
        hash: hashedOTP,
        createdAt: Date.now(),
        expiresAt: Date.now() + config.OTP_EXPIRY_MS,
        used: false
    });

    console.log(`📱 OTP stored for ${type}:${identifier}`);
    return true;
};

// ============================================
// OTP Verification
// ============================================

export const verifyOTP = (identifier, providedOTP, type = 'phone') => {
    const key = `otp:${type}:${identifier}`;
    const now = Date.now();

    // Check brute force protection
    const attemptCheck = checkVerifyAttempts(identifier, type);
    if (!attemptCheck.allowed) {
        return { success: false, message: attemptCheck.message, locked: true };
    }

    const stored = otpStore.get(key);

    // Check if OTP exists
    if (!stored) {
        const failResult = recordFailedAttempt(identifier, type);
        return {
            success: false,
            message: 'OTP expired or not found. Please request a new one.',
            attemptsRemaining: failResult.attemptsRemaining
        };
    }

    // Check if already used (single-use)
    if (stored.used) {
        otpStore.delete(key);
        return {
            success: false,
            message: 'OTP has already been used. Please request a new one.'
        };
    }

    // Check if expired
    if (stored.expiresAt < now) {
        otpStore.delete(key);
        const failResult = recordFailedAttempt(identifier, type);
        return {
            success: false,
            message: 'OTP has expired. Please request a new one.',
            attemptsRemaining: failResult.attemptsRemaining
        };
    }

    // Verify OTP hash
    const providedHash = hashOTP(String(providedOTP).trim());
    if (stored.hash !== providedHash) {
        const failResult = recordFailedAttempt(identifier, type);

        if (failResult.locked) {
            return {
                success: false,
                message: 'Too many incorrect attempts. Please try again after 30 minutes.',
                locked: true
            };
        }

        return {
            success: false,
            message: `Invalid OTP. ${failResult.attemptsRemaining} attempts remaining.`,
            attemptsRemaining: failResult.attemptsRemaining
        };
    }

    // Success - mark as used and delete
    otpStore.delete(key);
    clearFailedAttempts(identifier, type);

    console.log(`✅ OTP verified for ${type}:${identifier}`);
    return { success: true, message: 'OTP verified successfully' };
};

// ============================================
// Send OTP Functions
// ============================================

export const sendPhoneOTP = async (phone, purpose = 'verification') => {
    // Check rate limit
    const rateCheck = checkRateLimit(phone, 'phone');
    if (!rateCheck.allowed) {
        return {
            success: false,
            message: rateCheck.message,
            retryAfter: rateCheck.retryAfter
        };
    }

    // Generate OTP
    const otp = generateSecureOTP();

    // Store OTP
    storeOTP(phone, otp, 'phone');

    // In development mode, just log the OTP
    if (process.env.DEV_MODE === 'true') {
        console.log('═══════════════════════════════════════════════════════');
        console.log(`📱 DEV MODE - OTP for ${phone}: ${otp}`);
        console.log('═══════════════════════════════════════════════════════');
        return {
            success: true,
            message: 'OTP sent successfully (dev mode)',
            otp: otp,  // Only in dev mode!
            devMode: true
        };
    }

    // Try to send via SMS
    if (isTwilioConfigured()) {
        const smsResult = await sendOTPSMS(phone, otp, purpose);
        if (smsResult.success) {
            return { success: true, message: 'OTP sent to your phone' };
        }
        // Log error but don't expose to user
        console.error('SMS failed, OTP:', otp);
    }

    // Fallback: Log to console (production without SMS configured)
    console.log('════════════════════════════════════════════════════════');
    console.log(`📱 SMS not configured - OTP for ${phone}: ${otp}`);
    console.log('════════════════════════════════════════════════════════');

    return {
        success: true,
        message: 'OTP sent successfully',
        otp: process.env.DEV_MODE === 'true' ? otp : undefined
    };
};

export const sendEmailOTP = async (email, purpose = 'verification') => {
    // Check rate limit
    const rateCheck = checkRateLimit(email, 'email');
    if (!rateCheck.allowed) {
        return {
            success: false,
            message: rateCheck.message,
            retryAfter: rateCheck.retryAfter
        };
    }

    // Generate OTP
    const otp = generateSecureOTP();

    // Store OTP
    storeOTP(email, otp, 'email');

    // In development mode, just log the OTP
    if (process.env.DEV_MODE === 'true') {
        console.log('═══════════════════════════════════════════════════════');
        console.log(`📧 DEV MODE - OTP for ${email}: ${otp}`);
        console.log('═══════════════════════════════════════════════════════');
        return {
            success: true,
            message: 'OTP sent successfully (dev mode)',
            otp: otp,  // Only in dev mode!
            devMode: true
        };
    }

    // Try to send via Email
    const emailResult = await sendOTPEmail(email, otp, purpose);
    if (emailResult.success) {
        return { success: true, message: 'OTP sent to your email' };
    }

    // Fallback: Log to console
    console.log('════════════════════════════════════════════════════════');
    console.log(`📧 Email not configured - OTP for ${email}: ${otp}`);
    console.log('════════════════════════════════════════════════════════');

    return {
        success: true,
        message: 'OTP sent successfully',
        otp: process.env.DEV_MODE === 'true' ? otp : undefined
    };
};

// For testing/debugging only
export const getStoredOTPDebug = (identifier, type = 'phone') => {
    if (process.env.DEV_MODE !== 'true') {
        return null; // Never expose in production
    }
    const key = `otp:${type}:${identifier}`;
    const stored = otpStore.get(key);
    return stored ? { exists: true, expiresIn: Math.ceil((stored.expiresAt - Date.now()) / 1000) } : null;
};
