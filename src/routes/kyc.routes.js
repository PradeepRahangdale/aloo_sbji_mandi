import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import {
    sendAadhaarOtp,
    verifyAadhaarOtp,
    getKycStatus,
    uploadAadhaarPhoto,
    resendAadhaarOtp,
} from "../controller/kyc.controller.js";

const router = express.Router();

// All KYC routes require authentication
router.use(authMiddleware);

// Get KYC status
router.get("/status", getKycStatus);

// Send OTP to Aadhaar-linked mobile
router.post("/send-otp", sendAadhaarOtp);

// Verify OTP
router.post("/verify-otp", verifyAadhaarOtp);

// Resend OTP
router.post("/resend-otp", resendAadhaarOtp);

// Upload Aadhaar photo (optional document)
router.post("/upload-photo", uploadAadhaarPhoto);

export default router;
