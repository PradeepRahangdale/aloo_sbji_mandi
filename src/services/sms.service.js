import twilio from 'twilio';

// ============================================
// SMS Service for OTP Delivery (Twilio)
// ============================================

let twilioClient = null;

const getTwilioClient = () => {
  if (twilioClient) return twilioClient;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return null;
  }

  twilioClient = twilio(accountSid, authToken);
  return twilioClient;
};

// SMS OTP Message Template
const getOTPMessage = (otp, purpose = 'verification') => {
  const purposeText = purpose === 'login' ? 'login' : 'registration';
  return `🥔 Aloo Mandi: Your OTP for ${purposeText} is ${otp}. Valid for 5 minutes. Do not share this code with anyone.`;
};

// Format phone number for Twilio (add country code if missing)
const formatPhoneNumber = (phone) => {
  // Remove any non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // If it doesn't start with +, add Indian country code
  if (!cleaned.startsWith('+')) {
    // Remove leading 0 if present
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    cleaned = '+91' + cleaned;
  }

  return cleaned;
};

// Send OTP via SMS (Twilio)
export const sendOTPSMS = async (phone, otp, purpose = 'verification') => {
  try {
    const client = getTwilioClient();

    if (!client) {
      console.log('⚠️ Twilio not configured. OTP for', phone, ':', otp);
      return {
        success: false,
        message: 'SMS service not configured',
        fallback: true,
      };
    }

    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
    if (!twilioPhone) {
      console.log('⚠️ Twilio phone number not configured');
      return {
        success: false,
        message: 'Twilio phone number not configured',
        fallback: true,
      };
    }

    const formattedPhone = formatPhoneNumber(phone);
    const message = getOTPMessage(otp, purpose);

    const result = await client.messages.create({
      body: message,
      from: twilioPhone,
      to: formattedPhone,
    });

    console.log('✅ SMS sent successfully:', result.sid);
    return {
      success: true,
      message: 'OTP sent via SMS',
      messageSid: result.sid,
    };
  } catch (error) {
    console.error('❌ SMS sending failed:', error.message);

    // Check for common Twilio errors
    if (error.code === 21211) {
      return {
        success: false,
        message: 'Invalid phone number format',
        error: error.message,
      };
    }
    if (error.code === 21608) {
      return {
        success: false,
        message: 'Phone number not verified for trial account',
        error: error.message,
      };
    }

    return {
      success: false,
      message: `Failed to send SMS: ${error.message}`,
      error: error.message,
    };
  }
};

// Check if Twilio is configured
export const isTwilioConfigured = () => {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
};

// Send a generic SMS message (used for token alerts etc.)
export const sendSMS = async (phone, messageText) => {
  try {
    const client = getTwilioClient();

    if (!client) {
      console.log('⚠️ Twilio not configured. SMS for', phone, ':', messageText);
      return { success: false, message: 'SMS service not configured', fallback: true };
    }

    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
    if (!twilioPhone) {
      return { success: false, message: 'Twilio phone number not configured', fallback: true };
    }

    const formattedPhone = formatPhoneNumber(phone);

    const result = await client.messages.create({
      body: messageText,
      from: twilioPhone,
      to: formattedPhone,
    });

    console.log('✅ SMS sent:', result.sid);
    return { success: true, messageSid: result.sid };
  } catch (error) {
    console.error('❌ SMS failed:', error.message);
    return { success: false, message: error.message };
  }
};

// Verify Twilio configuration
export const verifyTwilioConnection = async () => {
  try {
    const client = getTwilioClient();
    if (!client) {
      return { connected: false, message: 'Twilio credentials not configured' };
    }

    // Try to fetch account info to verify connection
    await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();

    console.log('✅ Twilio connection verified');
    return { connected: true, message: 'Twilio connection successful' };
  } catch (error) {
    console.error('❌ Twilio connection failed:', error.message);
    return { connected: false, message: error.message };
  }
};
