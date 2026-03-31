import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import {
    getPlans,
    getCurrentSubscription,
    createSubscriptionOrder,
    verifySubscriptionPayment,
    handleWebhook,
    getSubscriptionHistory,
    cancelSubscription,
    checkRazorpayConfig
} from "../controller/subscription.controller.js";

const router = express.Router();

// Public routes
router.get("/plans", getPlans);
router.get("/check-config", checkRazorpayConfig);

// Webhook route (no auth - called by Razorpay)
// Note: The webhook receives JSON but we parse it as text for signature verification
router.post("/webhook", express.json(), handleWebhook);

// Protected routes
router.use(verifyJWT);

router.get("/current", getCurrentSubscription);
router.post("/create-order", createSubscriptionOrder);
router.post("/verify", verifySubscriptionPayment);
router.get("/history", getSubscriptionHistory);
router.post("/cancel/:subscriptionId", cancelSubscription);

export default router;
