// In-memory OTP store for development (when Redis is not available)
const otpStore = new Map();
const rateLimitStore = new Map();

// OTP Configuration
const OTP_EXPIRY = 120000; // 2 minutes in milliseconds
const OTP_LENGTH = 6;

// Generate random OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Clean expired OTPs periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of otpStore.entries()) {
        if (data.expiresAt < now) {
            otpStore.delete(key);
        }
    }
    for (const [key, data] of rateLimitStore.entries()) {
        if (data.expiresAt < now) {
            rateLimitStore.delete(key);
        }
    }
}, 60000); // Clean every minute

// Store OTP in memory
export const storeOTP = async (identifier, otp, type = 'phone') => {
    try {
        const key = `otp:${type}:${identifier}`;
        otpStore.set(key, {
            otp: otp,
            expiresAt: Date.now() + OTP_EXPIRY
        });
        console.log(`📱 OTP stored for ${identifier}: ${otp}`);
        return true;
    } catch (error) {
        console.error('Error storing OTP:', error);
        throw error;
    }
};

// Verify OTP
export const verifyOTP = async (identifier, otp, type = 'phone') => {
    try {
        const key = `otp:${type}:${identifier}`;
        const stored = otpStore.get(key);

        console.log('🔍 OTP Verification Debug:');
        console.log('  Key:', key);
        console.log('  Stored:', stored);
        console.log('  Provided OTP:', otp);

        if (!stored) {
            return { success: false, message: 'OTP expired or not found' };
        }

        if (stored.expiresAt < Date.now()) {
            otpStore.delete(key);
            return { success: false, message: 'OTP expired' };
        }

        const storedOTPStr = String(stored.otp).trim();
        const providedOTPStr = String(otp).trim();

        if (storedOTPStr !== providedOTPStr) {
            return { success: false, message: 'Invalid OTP' };
        }

        // Delete OTP after successful verification
        otpStore.delete(key);
        console.log('✅ OTP verified successfully');
        return { success: true, message: 'OTP verified successfully' };
    } catch (error) {
        console.error('Error verifying OTP:', error);
        throw error;
    }
};

// Send OTP via SMS (Development mode - just logs OTP)
export const sendPhoneOTP = async (phone) => {
    try {
        const otp = generateOTP();

        // Store OTP
        await storeOTP(phone, otp, 'phone');

        // In development mode, just log the OTP
        if (process.env.DEV_MODE === 'true') {
            console.log('═══════════════════════════════════════════');
            console.log(`📱 OTP for ${phone}: ${otp}`);
            console.log('═══════════════════════════════════════════');
            return { success: true, message: 'OTP sent successfully', otp: otp }; // Return OTP in dev mode
        }

        // In production, use Twilio
        try {
            const twilio = await import('twilio');
            const client = twilio.default(
                process.env.TWILIO_ACCOUNT_SID,
                process.env.TWILIO_AUTH_TOKEN
            );

            await client.messages.create({
                body: `Your Aloo Mandi OTP is: ${otp}. Valid for 2 minutes.`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: `+91${phone}`
            });
        } catch (twilioError) {
            console.log('Twilio not configured, OTP logged to console:', otp);
        }

        return { success: true, message: 'OTP sent successfully' };
    } catch (error) {
        console.error('Error sending OTP:', error);
        throw error;
    }
};

// Send OTP via Email (Development mode - just logs OTP)
export const sendEmailOTP = async (email) => {
    try {
        const otp = generateOTP();

        // Store OTP
        await storeOTP(email, otp, 'email');

        // In development mode, just log the OTP
        if (process.env.DEV_MODE === 'true') {
            console.log('═══════════════════════════════════════════');
            console.log(`📧 OTP for ${email}: ${otp}`);
            console.log('═══════════════════════════════════════════');
            return { success: true, message: 'OTP sent successfully', otp: otp };
        }

        // In production, use nodemailer
        try {
            const nodemailer = await import('nodemailer');
            const transporter = nodemailer.createTransport({
                service: process.env.EMAIL_SERVICE || 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASSWORD
                }
            });

            await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'Aloo Mandi - OTP Verification',
                html: `<h2>Your OTP is: <strong>${otp}</strong></h2><p>Valid for 2 minutes.</p>`
            });
        } catch (emailError) {
            console.log('Email not configured, OTP logged to console:', otp);
        }

        return { success: true, message: 'OTP sent successfully' };
    } catch (error) {
        console.error('Error sending email OTP:', error);
        throw error;
    }
};

// Rate limiting for OTP requests
export const checkOTPRateLimit = async (identifier, type = 'phone') => {
    try {
        const key = `ratelimit:${type}:${identifier}`;
        const stored = rateLimitStore.get(key);

        if (stored && stored.expiresAt > Date.now() && stored.attempts >= 5) {
            const remainingTime = Math.ceil((stored.expiresAt - Date.now()) / 1000);
            return {
                allowed: false,
                message: `Too many OTP requests. Please try again after ${remainingTime} seconds.`
            };
        }

        // Update attempts
        if (stored && stored.expiresAt > Date.now()) {
            stored.attempts += 1;
            rateLimitStore.set(key, stored);
        } else {
            rateLimitStore.set(key, {
                attempts: 1,
                expiresAt: Date.now() + OTP_EXPIRY
            });
        }

        return { allowed: true };
    } catch (error) {
        console.error('Error checking rate limit:', error);
        return { allowed: true }; // Allow on error
    }
};

// Get stored OTP (for testing/debugging only)
export const getStoredOTP = (identifier, type = 'phone') => {
    const key = `otp:${type}:${identifier}`;
    const stored = otpStore.get(key);
    return stored ? stored.otp : null;
};
