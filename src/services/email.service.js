import nodemailer from 'nodemailer';

// ============================================
// SMTP Email Service for OTP Delivery
// ============================================

// Create reusable transporter
let transporter = null;

const getTransporter = () => {
    if (transporter) return transporter;

    // Gmail SMTP configuration
    transporter = nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD, // Use App Password for Gmail
        },
    });

    return transporter;
};

// Professional OTP Email Template
const getOTPEmailTemplate = (otp, purpose = 'verification') => {
    const purposeText = purpose === 'login' ? 'Login' : 'Account Verification';
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OTP Verification - Aloo Mandi</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <tr>
            <td style="background: linear-gradient(135deg, #2E7D32 0%, #4CAF50 100%); border-radius: 16px 16px 0 0; padding: 30px; text-align: center;">
                <h1 style="color: #fff; margin: 0; font-size: 28px;">🥔 Aloo Mandi</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">Fresh from Farm to Market</p>
            </td>
        </tr>
        <tr>
            <td style="background-color: #fff; padding: 40px 30px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                <h2 style="color: #333; margin: 0 0 20px 0; font-size: 22px;">${purposeText} OTP</h2>
                <p style="color: #666; line-height: 1.6; margin: 0 0 25px 0;">
                    Please use the following One-Time Password (OTP) to complete your ${purpose === 'login' ? 'login' : 'registration'}:
                </p>
                
                <div style="background: linear-gradient(135deg, #E8F5E9 0%, #C8E6C9 100%); border: 2px dashed #4CAF50; border-radius: 12px; padding: 25px; text-align: center; margin: 0 0 25px 0;">
                    <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #2E7D32; font-family: 'Courier New', monospace;">${otp}</span>
                </div>
                
                <div style="background-color: #FFF3E0; border-left: 4px solid #FF9800; padding: 15px; border-radius: 0 8px 8px 0; margin: 0 0 25px 0;">
                    <p style="color: #E65100; margin: 0; font-size: 14px;">
                        ⏱️ <strong>This OTP expires in 5 minutes.</strong><br>
                        🔒 Never share this OTP with anyone.
                    </p>
                </div>
                
                <p style="color: #999; font-size: 13px; line-height: 1.5; margin: 0;">
                    If you didn't request this OTP, please ignore this email or contact our support team.
                </p>
            </td>
        </tr>
        <tr>
            <td style="padding: 20px; text-align: center;">
                <p style="color: #999; font-size: 12px; margin: 0;">
                    © ${new Date().getFullYear()} Aloo Mandi. All rights reserved.<br>
                    This is an automated message, please do not reply.
                </p>
            </td>
        </tr>
    </table>
</body>
</html>
    `;
};

// Plain text version for email clients that don't support HTML
const getOTPPlainText = (otp, purpose = 'verification') => {
    return `
Aloo Mandi - OTP Verification

Your One-Time Password (OTP) for ${purpose === 'login' ? 'login' : 'account verification'} is:

${otp}

This OTP expires in 5 minutes.
Never share this OTP with anyone.

If you didn't request this OTP, please ignore this email.

© ${new Date().getFullYear()} Aloo Mandi
    `.trim();
};

// Send OTP via Email
export const sendOTPEmail = async (email, otp, purpose = 'verification') => {
    try {
        // Validate email configuration
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
            console.log('⚠️ Email not configured. OTP:', otp);
            return { 
                success: false, 
                message: 'Email service not configured',
                fallback: true 
            };
        }

        const transport = getTransporter();

        const mailOptions = {
            from: {
                name: 'Aloo Mandi',
                address: process.env.EMAIL_USER
            },
            to: email,
            subject: `🔐 Your Aloo Mandi OTP: ${otp}`,
            text: getOTPPlainText(otp, purpose),
            html: getOTPEmailTemplate(otp, purpose),
        };

        const info = await transport.sendMail(mailOptions);
        
        console.log('✅ Email sent successfully:', info.messageId);
        return { 
            success: true, 
            message: 'OTP sent to email',
            messageId: info.messageId 
        };

    } catch (error) {
        console.error('❌ Email sending failed:', error.message);
        return { 
            success: false, 
            message: `Failed to send email: ${error.message}`,
            error: error.message 
        };
    }
};

// Verify SMTP connection
export const verifyEmailConnection = async () => {
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
            return { connected: false, message: 'Email credentials not configured' };
        }

        const transport = getTransporter();
        await transport.verify();
        
        console.log('✅ SMTP connection verified');
        return { connected: true, message: 'SMTP connection successful' };
    } catch (error) {
        console.error('❌ SMTP connection failed:', error.message);
        return { connected: false, message: error.message };
    }
};
