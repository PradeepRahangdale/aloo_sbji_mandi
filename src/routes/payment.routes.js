import express from "express";
import Razorpay from "razorpay";
import crypto from "crypto";
import { Deal } from "../models/deal.model.js";
import { Receipt } from "../models/receipt.model.js";
import { Message } from "../models/message.model.js";
import { Conversation } from "../models/conversation.model.js";
import { Notification } from "../models/notification.model.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { emitToUser } from "../config/socket.js";

const router = express.Router();

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_demo',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'demo_secret'
});

// Create payment order (farmer requests payment from vendor)
router.post("/create-order", authMiddleware, async (req, res) => {
    try {
        const { dealId } = req.body;

        const deal = await Deal.findById(dealId)
            .populate("farmer", "firstName lastName phone")
            .populate("coldStorageOwner", "firstName lastName phone");

        if (!deal) {
            return res.status(404).json({ success: false, message: "Deal not found" });
        }

        // Only farmer can request payment
        if (deal.farmer._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: "Only farmer can request payment" });
        }

        // Deal must be closed before payment
        if (deal.status !== 'closed') {
            return res.status(400).json({ success: false, message: "Deal must be closed before requesting payment" });
        }

        // Create Razorpay order
        const options = {
            amount: Math.round(deal.totalAmount * 100), // Razorpay expects amount in paise
            currency: "INR",
            receipt: `deal_${deal._id}`,
            notes: {
                dealId: deal._id.toString(),
                farmerId: deal.farmer._id.toString(),
                vendorId: deal.coldStorageOwner._id.toString()
            }
        };

        const order = await razorpay.orders.create(options);

        // Update deal with payment info
        deal.paymentStatus = 'requested';
        deal.paymentRequestedAt = new Date();
        deal.paymentRequestedBy = req.user._id;
        deal.paymentOrderId = order.id;
        await deal.save();

        // Notify vendor about payment request
        emitToUser(deal.coldStorageOwner._id.toString(), 'payment_requested', {
            dealId: deal._id,
            amount: deal.totalAmount,
            orderId: order.id,
            farmerName: `${deal.farmer.firstName} ${deal.farmer.lastName}`
        });

        res.status(200).json({
            success: true,
            message: "Payment order created",
            data: {
                orderId: order.id,
                amount: deal.totalAmount,
                currency: "INR",
                dealId: deal._id,
                key: process.env.RAZORPAY_KEY_ID
            }
        });
    } catch (error) {
        console.error("Create order error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Verify payment (after vendor pays)
router.post("/verify", authMiddleware, async (req, res) => {
    try {
        const { 
            razorpay_order_id, 
            razorpay_payment_id, 
            razorpay_signature,
            dealId 
        } = req.body;

        // Verify signature
        const sign = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSign = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || 'demo_secret')
            .update(sign.toString())
            .digest("hex");

        if (razorpay_signature !== expectedSign) {
            return res.status(400).json({ success: false, message: "Invalid payment signature" });
        }

        // Update deal
        const deal = await Deal.findById(dealId)
            .populate("farmer", "firstName lastName phone")
            .populate("coldStorageOwner", "firstName lastName phone");

        if (!deal) {
            return res.status(404).json({ success: false, message: "Deal not found" });
        }

        deal.paymentStatus = 'paid';
        deal.paymentId = razorpay_payment_id;
        deal.paidAt = new Date();
        deal.paymentMethod = 'razorpay';
        await deal.save();

        // Generate receipt automatically
        let receipt = null;
        try {
            const existingReceipt = await Receipt.findOne({ dealId: deal._id });
            if (!existingReceipt) {
                const receiptNumber = await Receipt.generateReceiptNumber();
                const isListingDeal = deal.dealType === "listing";
                const payer = deal.coldStorageOwner;
                const payerRole = isListingDeal ? "vendor" : "cold-storage-owner";

                receipt = await Receipt.create({
                    receiptNumber,
                    dealId: deal._id,
                    dealType: deal.dealType || "cold-storage",
                    farmer: {
                        userId: deal.farmer._id,
                        name: `${deal.farmer.firstName} ${deal.farmer.lastName}`,
                        phone: deal.farmer.phone,
                    },
                    payer: {
                        userId: payer._id,
                        name: `${payer.firstName} ${payer.lastName}`,
                        phone: payer.phone,
                        role: payerRole,
                    },
                    dealDetails: {
                        quantity: deal.quantity,
                        unit: isListingDeal ? "packets" : "tons",
                        pricePerUnit: deal.pricePerTon,
                        duration: deal.duration,
                    },
                    paymentDetails: {
                        subtotal: deal.totalAmount,
                        taxes: 0,
                        totalAmount: deal.totalAmount,
                        paymentMethod: "razorpay",
                        paymentId: razorpay_payment_id,
                        paymentOrderId: razorpay_order_id,
                        paidAt: new Date(),
                    },
                    status: "generated",
                });
            } else {
                receipt = existingReceipt;
            }
        } catch (receiptError) {
            console.error("Receipt generation error:", receiptError);
        }

        // Notify farmer about successful payment
        emitToUser(deal.farmer._id.toString(), 'payment_success', {
            dealId: deal._id,
            amount: deal.totalAmount,
            paymentId: razorpay_payment_id,
            vendorName: `${deal.coldStorageOwner.firstName} ${deal.coldStorageOwner.lastName}`,
            receiptNumber: receipt?.receiptNumber
        });

        // Notify payer (vendor/cold storage owner) about receipt
        emitToUser(deal.coldStorageOwner._id.toString(), 'receipt_generated', {
            dealId: deal._id,
            receiptNumber: receipt?.receiptNumber,
            amount: deal.totalAmount
        });

        // Create "Deal Done!" message in chat
        try {
            const conversation = await Conversation.findById(deal.conversationId);
            if (conversation) {
                const messageContent = `🎉 Deal Done! Payment of ₹${deal.totalAmount} completed successfully!\n\n📦 ${deal.quantity} packets\n💰 ₹${deal.pricePerTon}/packet\n✅ Payment ID: ${razorpay_payment_id.slice(-8)}`;

                const message = await Message.create({
                    conversationId: deal.conversationId,
                    sender: req.user._id,
                    receiver: deal.farmer._id,
                    content: messageContent,
                    messageType: "deal_completed",
                    dealDetails: {
                        quantity: deal.quantity,
                        pricePerKg: deal.pricePerTon / 1000,
                        totalAmount: deal.totalAmount,
                        storageMonths: deal.duration,
                        paymentId: razorpay_payment_id
                    }
                });

                // Update conversation
                conversation.lastMessage = message._id;
                conversation.lastMessageText = messageContent;
                conversation.lastMessageAt = new Date();
                await conversation.save();

                // Create notification for farmer
                await Notification.create({
                    recipient: deal.farmer._id,
                    sender: req.user._id,
                    type: "deal_completed",
                    title: "🎉 Deal Done! Payment Received",
                    message: `Payment of ₹${deal.totalAmount} received for ${deal.quantity} packets deal!`,
                    referenceId: deal._id,
                    referenceType: "deal"
                });
            }
        } catch (msgError) {
            console.error("Error creating deal done message:", msgError);
        }

        res.status(200).json({
            success: true,
            message: "Payment verified successfully",
            data: { deal, receipt }
        });
    } catch (error) {
        console.error("Verify payment error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get payment status for a deal
router.get("/status/:dealId", authMiddleware, async (req, res) => {
    try {
        const deal = await Deal.findById(req.params.dealId);

        if (!deal) {
            return res.status(404).json({ success: false, message: "Deal not found" });
        }

        // Check if user is part of this deal
        if (deal.farmer.toString() !== req.user._id.toString() && 
            deal.coldStorageOwner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: "Not authorized" });
        }

        res.status(200).json({
            success: true,
            data: {
                paymentStatus: deal.paymentStatus,
                paymentId: deal.paymentId,
                paidAt: deal.paidAt,
                totalAmount: deal.totalAmount
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get Razorpay key (for frontend)
router.get("/key", authMiddleware, async (req, res) => {
    res.status(200).json({
        success: true,
        data: { key: process.env.RAZORPAY_KEY_ID || 'rzp_test_demo' }
    });
});

export { router };
