import { Subscription } from "../models/subscription.model.js";
import { User } from "../models/user.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import Razorpay from "razorpay";
import crypto from "crypto";

// Lazy-initialize Razorpay (initialized on first use)
let razorpay = null;

const getRazorpayInstance = () => {
    if (!razorpay) {
        if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            throw new Error("Razorpay keys not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env");
        }
        razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
    }
    return razorpay;
};

// ──────────────────────────────────────────────────────────
// GET /plans — Return all available plans
// ──────────────────────────────────────────────────────────
export const getPlans = asyncHandler(async (req, res) => {
    const plans = [
        {
            id: 'free',
            name: 'Free',
            price: 0,
            duration: 'Forever',
            durationDays: 36500,
            features: [
                'Basic Listings (5/month)',
                'Standard Search',
                'Basic Support'
            ],
            popular: false
        },
        {
            id: 'seasonal',
            name: 'Seasonal Pass',
            price: 699,
            duration: '4 Months',
            durationDays: 120,
            features: [
                'Unlimited Listings',
                'Priority Search',
                'Featured Listings',
                'Direct Calls',
                'Verified Badge',
                'Advanced Analytics'
            ],
            popular: true
        },
        {
            id: 'yearly',
            name: 'Yearly Pass',
            price: 1499,
            duration: '1 Year',
            durationDays: 365,
            features: [
                'Everything in Seasonal Pass',
                'Dedicated Manager',
                'Market Insights',
                'Premium Badge',
                '24/7 Support',
                'No Ads'
            ],
            popular: false
        }
    ];
    
    return res.status(200).json(
        new ApiResponse(200, plans, "Plans fetched successfully")
    );
});

// ──────────────────────────────────────────────────────────
// GET /current — Get current user's active subscription
// ──────────────────────────────────────────────────────────
export const getCurrentSubscription = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    
    // Find active subscription
    const subscription = await Subscription.findOne({
        user: userId,
        status: 'active',
        endDate: { $gt: new Date() }
    }).sort({ createdAt: -1 });
    
    if (!subscription) {
        const freePlan = Subscription.getPlanDetails('free');
        return res.status(200).json(
            new ApiResponse(200, {
                planId: 'free',
                planName: 'Free',
                price: 0,
                status: 'active',
                features: freePlan.features,
                limits: freePlan.limits,
                isFreePlan: true
            }, "No active subscription, using free plan")
        );
    }
    
    return res.status(200).json(
        new ApiResponse(200, {
            ...subscription.toObject(),
            remainingDays: subscription.getRemainingDays(),
            isActive: subscription.isActive()
        }, "Subscription fetched successfully")
    );
});

// ──────────────────────────────────────────────────────────
// POST /create-order — Create Razorpay order for a plan
// Security: Prevents duplicate pending orders, validates plan,
//           checks for already-active subscription
// ──────────────────────────────────────────────────────────
export const createSubscriptionOrder = asyncHandler(async (req, res) => {
    const { planId } = req.body;
    const userId = req.user._id;
    
    if (!planId) {
        throw new ApiError(400, "Plan ID is required");
    }
    
    // Validate plan exists
    const planDetails = Subscription.getPlanDetails(planId);
    if (!planDetails || planDetails.price === undefined) {
        throw new ApiError(400, "Invalid plan ID");
    }
    
    // Prevent duplicate: check if user already has active subscription for same plan
    const existingActive = await Subscription.findOne({
        user: userId,
        planId: planId,
        status: 'active',
        endDate: { $gt: new Date() }
    });
    if (existingActive) {
        throw new ApiError(400, "You already have an active subscription for this plan");
    }
    
    // Free plan — activate directly without payment
    if (planId === 'free') {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + planDetails.duration);
        
        const subscription = await Subscription.create({
            user: userId,
            planId: 'free',
            planName: planDetails.name,
            price: 0,
            duration: planDetails.duration,
            endDate,
            status: 'active',
            features: planDetails.features,
            limits: planDetails.limits,
            payment: { status: 'completed', paidAt: new Date() }
        });
        
        return res.status(200).json(
            new ApiResponse(200, { subscription, isFree: true }, "Free subscription activated")
        );
    }
    
    // Cancel any stale pending subscriptions for this user (cleanup)
    await Subscription.updateMany(
        { user: userId, status: 'pending' },
        { $set: { status: 'cancelled', 'payment.status': 'failed' } }
    );
    
    // Create Razorpay order for paid plans
    const amount = planDetails.price * 100; // Convert to paise
    // Receipt: max 40 chars — use short format
    const receiptId = `s${userId.toString().slice(-6)}_${Date.now().toString(36)}`;
    
    const options = {
        amount,
        currency: "INR",
        receipt: receiptId,
        notes: {
            userId: userId.toString(),
            planId,
            planName: planDetails.name,
            duration: String(planDetails.duration)
        }
    };
    
    try {
        const razorpayInstance = getRazorpayInstance();
        const order = await razorpayInstance.orders.create(options);
        
        // Create pending subscription tied to this order
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + planDetails.duration);
        
        const subscription = await Subscription.create({
            user: userId,
            planId,
            planName: planDetails.name,
            price: planDetails.price,
            duration: planDetails.duration,
            endDate,
            status: 'pending',
            features: planDetails.features,
            limits: planDetails.limits,
            payment: {
                orderId: order.id,
                status: 'pending'
            }
        });
        
        console.log(`[Razorpay] Order ${order.id} created for user ${userId} plan ${planId}`);
        
        return res.status(200).json(
            new ApiResponse(200, {
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
                subscriptionId: subscription._id,
                keyId: process.env.RAZORPAY_KEY_ID,
                planName: planDetails.name,
                planId
            }, "Order created successfully")
        );
    } catch (error) {
        console.error("[Razorpay] Order creation error:", error?.message || error);
        razorpay = null; // Reset so next attempt re-initializes
        const errorMsg = error?.error?.description || error?.message || "Failed to create payment order";
        throw new ApiError(500, `Payment order failed: ${errorMsg}`);
    }
});

// ──────────────────────────────────────────────────────────
// POST /verify — Verify Razorpay payment & activate subscription
// Security: HMAC-SHA256 signature verification, amount cross-check,
//           user ownership check, idempotency for duplicate calls,
//           payment status validation from Razorpay API
// ──────────────────────────────────────────────────────────
export const verifySubscriptionPayment = asyncHandler(async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, subscriptionId } = req.body;
    const userId = req.user._id;
    
    // Validate required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        throw new ApiError(400, "Payment verification requires order_id, payment_id, and signature");
    }
    
    // ── Step 1: HMAC-SHA256 Signature Verification ──
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(body)
        .digest("hex");
    
    if (expectedSignature !== razorpay_signature) {
        console.error(`[Payment] INVALID signature for order ${razorpay_order_id} — possible tampering`);
        if (subscriptionId) {
            await Subscription.findByIdAndUpdate(subscriptionId, {
                status: 'cancelled',
                'payment.status': 'failed'
            });
        }
        throw new ApiError(400, "Payment verification failed — invalid signature");
    }
    
    // ── Step 2: Find subscription by orderId ──
    const subscription = await Subscription.findOne({
        'payment.orderId': razorpay_order_id
    });
    
    if (!subscription) {
        throw new ApiError(404, "No subscription found for this order");
    }
    
    // ── Step 3: Idempotency — already activated? Return success ──
    if (subscription.status === 'active' && subscription.payment.status === 'completed') {
        return res.status(200).json(
            new ApiResponse(200, {
                subscription,
                message: "Subscription is already active.",
                alreadyActive: true
            }, "Payment already verified")
        );
    }
    
    // ── Step 4: User ownership check ──
    if (subscription.user.toString() !== userId.toString()) {
        throw new ApiError(403, "This subscription does not belong to you");
    }
    
    // ── Step 5: Fetch payment from Razorpay & cross-verify ──
    let paymentDetails;
    try {
        paymentDetails = await getRazorpayInstance().payments.fetch(razorpay_payment_id);
    } catch (error) {
        console.error("[Payment] Error fetching from Razorpay:", error?.message);
    }
    
    if (paymentDetails) {
        // Verify amount matches
        const expectedAmount = subscription.price * 100;
        if (paymentDetails.amount !== expectedAmount) {
            console.error(`[Payment] Amount mismatch! Expected ${expectedAmount} paise, got ${paymentDetails.amount}`);
            throw new ApiError(400, "Payment amount mismatch — contact support");
        }
        // Verify payment is actually captured/authorized
        if (paymentDetails.status !== 'captured' && paymentDetails.status !== 'authorized') {
            console.error(`[Payment] Status '${paymentDetails.status}' is not captured/authorized`);
            throw new ApiError(400, `Payment not completed. Status: ${paymentDetails.status}`);
        }
    }
    
    // ── Step 6: Activate subscription ──
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + subscription.duration);
    
    subscription.status = 'active';
    subscription.startDate = now;
    subscription.endDate = endDate;
    subscription.payment.paymentId = razorpay_payment_id;
    subscription.payment.signature = razorpay_signature;
    subscription.payment.status = 'completed';
    subscription.payment.paidAt = now;
    subscription.payment.method = paymentDetails?.method || 'unknown';
    
    await subscription.save();
    
    // ── Step 7: Update user's plan ──
    await User.findByIdAndUpdate(subscription.user, {
        currentPlan: subscription.planId,
        subscriptionEndDate: subscription.endDate
    });
    
    console.log(`[Payment] Activated: sub=${subscription._id} plan=${subscription.planId} user=${userId}`);
    
    return res.status(200).json(
        new ApiResponse(200, {
            subscription,
            message: "Payment successful! Your subscription is now active."
        }, "Payment verified successfully")
    );
});

// ──────────────────────────────────────────────────────────
// POST /webhook — Razorpay webhook (no auth, called by Razorpay)
// Safety net: activates subscription even if client verify fails
// ──────────────────────────────────────────────────────────
export const handleWebhook = asyncHandler(async (req, res) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    
    if (webhookSecret) {
        const signature = req.headers['x-razorpay-signature'];
        const body = JSON.stringify(req.body);
        
        const expectedSignature = crypto
            .createHmac("sha256", webhookSecret)
            .update(body)
            .digest("hex");
        
        if (signature !== expectedSignature) {
            console.error("[Webhook] Signature verification failed");
            return res.status(400).json({ error: "Invalid webhook signature" });
        }
    }
    
    const event = req.body.event;
    const payload = req.body.payload;
    console.log("[Webhook] Event:", event);
    
    switch (event) {
        case 'payment.captured':
            await handlePaymentCaptured(payload.payment.entity);
            break;
        case 'payment.failed':
            await handlePaymentFailed(payload.payment.entity);
            break;
        case 'order.paid':
            await handleOrderPaid(payload.order.entity, payload.payment.entity);
            break;
        case 'refund.created':
            await handleRefundCreated(payload.refund.entity);
            break;
        default:
            console.log("[Webhook] Unhandled:", event);
    }
    
    return res.status(200).json({ status: "ok" });
});

// ─── Webhook helpers ─────────────────────────────────────

async function activateSubscription(subscription, paymentId, method) {
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + subscription.duration);
    
    subscription.status = 'active';
    subscription.startDate = now;
    subscription.endDate = endDate;
    subscription.payment.paymentId = paymentId;
    subscription.payment.status = 'completed';
    subscription.payment.paidAt = now;
    if (method) subscription.payment.method = method;
    await subscription.save();
    
    await User.findByIdAndUpdate(subscription.user, {
        currentPlan: subscription.planId,
        subscriptionEndDate: subscription.endDate
    });
    
    console.log(`[Webhook] Activated sub=${subscription._id} plan=${subscription.planId}`);
}

async function handlePaymentCaptured(payment) {
    const subscription = await Subscription.findOne({ 'payment.orderId': payment.order_id });
    if (subscription && subscription.status === 'pending') {
        await activateSubscription(subscription, payment.id, payment.method);
    }
}

async function handlePaymentFailed(payment) {
    const subscription = await Subscription.findOne({ 'payment.orderId': payment.order_id });
    if (subscription && subscription.status === 'pending') {
        subscription.status = 'cancelled';
        subscription.payment.status = 'failed';
        await subscription.save();
        console.log(`[Webhook] Failed sub=${subscription._id}`);
    }
}

async function handleOrderPaid(order, payment) {
    const subscription = await Subscription.findOne({ 'payment.orderId': order.id });
    if (subscription && subscription.status === 'pending') {
        await activateSubscription(subscription, payment.id, null);
    }
}

async function handleRefundCreated(refund) {
    const subscription = await Subscription.findOne({ 'payment.paymentId': refund.payment_id });
    if (subscription) {
        subscription.status = 'cancelled';
        subscription.payment.status = 'refunded';
        await subscription.save();
        
        await User.findByIdAndUpdate(subscription.user, {
            currentPlan: 'free',
            subscriptionEndDate: null
        });
        console.log(`[Webhook] Refunded sub=${subscription._id}`);
    }
}

// ──────────────────────────────────────────────────────────
// GET /check-config — Diagnostic endpoint (public)
// ──────────────────────────────────────────────────────────
export const checkRazorpayConfig = asyncHandler(async (req, res) => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    
    const status = {
        keyIdSet: !!keyId,
        keySecretSet: !!keySecret,
        keyIdPrefix: keyId ? keyId.substring(0, 12) + '...' : 'NOT SET',
        isTestMode: keyId ? keyId.startsWith('rzp_test') : null,
        isLiveMode: keyId ? keyId.startsWith('rzp_live') : null,
    };
    
    try {
        getRazorpayInstance();
        status.instanceCreated = true;
    } catch (error) {
        status.instanceCreated = false;
        status.instanceError = error.message;
    }
    
    return res.status(200).json(
        new ApiResponse(200, status, "Razorpay configuration status")
    );
});

// ──────────────────────────────────────────────────────────
// GET /history — User's subscription history
// ──────────────────────────────────────────────────────────
export const getSubscriptionHistory = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    
    const subscriptions = await Subscription.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(20);
    
    return res.status(200).json(
        new ApiResponse(200, subscriptions, "Subscription history fetched successfully")
    );
});

// ──────────────────────────────────────────────────────────
// POST /cancel/:subscriptionId — Cancel active subscription
// ──────────────────────────────────────────────────────────
export const cancelSubscription = asyncHandler(async (req, res) => {
    const { subscriptionId } = req.params;
    const userId = req.user._id;
    
    const subscription = await Subscription.findOne({
        _id: subscriptionId,
        user: userId,
        status: 'active'
    });
    
    if (!subscription) {
        throw new ApiError(404, "Active subscription not found");
    }
    
    subscription.autoRenew = false;
    subscription.status = 'cancelled';
    await subscription.save();
    
    await User.findByIdAndUpdate(userId, {
        currentPlan: 'free',
        subscriptionEndDate: null
    });
    
    return res.status(200).json(
        new ApiResponse(200, subscription,
            "Subscription cancelled successfully. Access remains until " + subscription.endDate.toLocaleDateString()
        )
    );
});
