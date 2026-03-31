import express from "express";
import { 
    userRegister, 
    verifyOTPAndRegister, 
    userLogin, 
    logout, 
    devRegister,
    devFindManager,
    getUserProfile, 
    getAllUsers,
    resendOTP,
    sendLoginOTP,
    verifyLoginOTP,
    updateUserProfile,
    getAlooMitras
} from "../controller/user.controller.js";
import { authMiddleware as verify } from "../middleware/auth.middleware.js";

const router = express.Router();

// ============================================
// REGISTRATION ROUTES (with OTP)
// ============================================

// Step 1: Register & Send OTP
router.route("/register").post(userRegister);

// Step 2: Verify OTP & Create Account
router.route("/verify-otp").post(verifyOTPAndRegister);

// Resend OTP
router.route("/resend-otp").post(resendOTP);

// ============================================
// LOGIN ROUTES
// ============================================

// Password-based login
router.route("/login").post(userLogin);

// OTP-based login - Step 1: Send OTP
router.route("/login/send-otp").post(sendLoginOTP);

// OTP-based login - Step 2: Verify OTP
router.route("/login/verify-otp").post(verifyLoginOTP);

// ============================================
// DEV ROUTES (for testing)
// ============================================

// Dev Registration (No OTP - for testing only)
router.route("/dev-register").post(devRegister);

// Dev: Find existing assigned manager (for dev quick login)
router.route("/dev-find-manager").get(devFindManager);

// ============================================
// PROTECTED ROUTES
// ============================================

// Get current user
router.route("/me").get(verify, (req, res) => res.json({ user: req.user }));

// Logout
router.route("/logout").post(verify, logout);

// Get user profile by ID
router.route("/profile/:userId").get(verify, getUserProfile);

// Update user profile
router.route("/profile/update").put(verify, updateUserProfile);

// Get all users (for directory/contacts)
router.route("/all").get(verify, getAllUsers);

// Get Aloo Mitras (public endpoint)
router.route("/aloo-mitras").get(getAlooMitras);

// Save/Update FCM token for push notifications
router.route("/fcm-token").post(verify, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ message: 'FCM token is required' });
    }
    const { default: User } = await import('../models/user.model.js');
    await User.findByIdAndUpdate(req.user._id, { fcmToken });
    res.json({ message: 'FCM token saved successfully' });
  } catch (error) {
    console.error('Error saving FCM token:', error);
    res.status(500).json({ message: 'Failed to save FCM token' });
  }
});

export { router }