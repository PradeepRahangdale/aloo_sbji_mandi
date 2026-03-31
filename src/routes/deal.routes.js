import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { Deal } from "../models/deal.model.js";
import { Booking } from "../models/booking.model.js";
import { Message } from "../models/message.model.js";
import { Conversation } from "../models/conversation.model.js";
import { Notification } from "../models/notification.model.js";
import { emitToUser } from "../config/socket.js";

const router = express.Router();

// Create a deal proposal
router.post("/propose", authMiddleware, async (req, res) => {
    try {
        const { 
            conversationId, 
            bookingId,
            quantity, 
            pricePerTon, 
            duration,
            notes 
        } = req.body;
        
        const userId = req.user._id;

        // Validate required fields
        if (!conversationId || !quantity || !pricePerTon) {
            return res.status(400).json({
                success: false,
                message: "Conversation ID, quantity, and price per ton are required"
            });
        }

        // Get conversation to find participants
        const conversation = await Conversation.findById(conversationId)
            .populate('participants', 'firstName lastName role');

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: "Conversation not found"
            });
        }

        // Check if user is part of conversation
        const isParticipant = conversation.participants.some(
            p => p._id.toString() === userId.toString()
        );
        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: "Not authorized"
            });
        }

        // Find participants - support deals between ANY two users
        const farmer = conversation.participants.find(p => p.role === 'farmer');
        const coldStorageOwner = conversation.participants.find(p => p.role === 'cold-storage');
        const vendor = conversation.participants.find(p => p.role === 'vendor');
        const trader = conversation.participants.find(p => p.role === 'trader');

        // Current user and other party
        const currentUser = conversation.participants.find(p => p._id.toString() === userId.toString());
        const otherParticipant = conversation.participants.find(p => p._id.toString() !== userId.toString());

        if (!currentUser || !otherParticipant) {
            return res.status(400).json({
                success: false,
                message: "Invalid conversation participants"
            });
        }

        // Determine deal type and parties
        // For deals, we need a "farmer/seller" side and a "buyer" side
        let dealType = 'listing';  // Default to listing for general deals
        let farmerParty = null;
        let buyerParty = null;

        // If farmer-cold storage deal
        if (farmer && coldStorageOwner) {
            dealType = 'cold-storage';
            farmerParty = farmer;
            buyerParty = coldStorageOwner;
        } 
        // If farmer-vendor deal
        else if (farmer && vendor) {
            dealType = 'listing';
            farmerParty = farmer;
            buyerParty = vendor;
        }
        // If farmer-trader deal
        else if (farmer && trader) {
            dealType = 'listing';
            farmerParty = farmer;
            buyerParty = trader;
        }
        // For any other combination, use current user as one party and other as the other
        else {
            // If one is a farmer, they are the seller
            if (currentUser.role === 'farmer') {
                farmerParty = currentUser;
                buyerParty = otherParticipant;
            } else if (otherParticipant.role === 'farmer') {
                farmerParty = otherParticipant;
                buyerParty = currentUser;
            } else {
                // Neither is a farmer - proposer is seller, other is buyer
                farmerParty = currentUser;
                buyerParty = otherParticipant;
            }
            dealType = 'listing';
        }

        // Safety check - ensure both parties are assigned
        if (!farmerParty || !buyerParty) {
            return res.status(400).json({
                success: false,
                message: "Could not determine deal parties"
            });
        }

        // Check if there's already an active deal for this conversation
        const existingActiveDeal = await Deal.findOne({
            conversationId,
            status: { $in: ['proposed', 'farmer_confirmed', 'owner_confirmed'] }
        });
        if (existingActiveDeal) {
            return res.status(400).json({
                success: false,
                message: "There is already an active deal in this conversation. Please cancel or complete it first."
            });
        }

        // Calculate total amount
        const totalAmount = quantity * pricePerTon;

        // Create the deal
        const deal = await Deal.create({
            conversationId,
            bookingId: bookingId || null,
            dealType,
            farmer: farmerParty._id,
            coldStorageOwner: buyerParty._id,  // This can be cold storage owner, vendor, or trader
            coldStorage: dealType === 'cold-storage' ? (conversation.contextId || null) : null,
            listingId: dealType === 'listing' ? (conversation.contextId || null) : null,
            quantity,
            pricePerTon,
            totalAmount,
            duration: duration || 1,
            proposedBy: userId,
            notes: notes || "",
            // Auto-confirm for the proposer
            farmerConfirmed: userId.toString() === farmerParty._id.toString(),
            ownerConfirmed: userId.toString() === buyerParty._id.toString(),
            status: "proposed",
            paymentStatus: "pending"
        });

        // Create a deal proposal message (use otherParticipant from earlier)
        const message = await Message.create({
            conversationId,
            sender: userId,
            receiver: otherParticipant._id,
            content: `💼 Deal Proposal: ${quantity} packets at ₹${pricePerTon}/packet. Total: ₹${totalAmount}`,
            messageType: "deal_proposal",
            dealDetails: {
                quantity,
                pricePerKg: pricePerTon / 1000,
                totalAmount,
                storageMonths: duration || 1
            }
        });

        // Update deal with message ID
        deal.dealMessageId = message._id;
        await deal.save();

        // Update conversation
        conversation.lastMessage = message._id;
        conversation.lastMessageText = message.content;
        conversation.lastMessageAt = new Date();
        const currentUnread = conversation.unreadCount.get(otherParticipant._id.toString()) || 0;
        conversation.unreadCount.set(otherParticipant._id.toString(), currentUnread + 1);
        await conversation.save();

        // Notify the other party
        await Notification.create({
            recipient: otherParticipant._id,
            sender: userId,
            type: "deal_proposal",
            title: "New Deal Proposal",
            message: `You have received a deal proposal for ${quantity} packets at ₹${pricePerTon}/packet`,
            referenceId: deal._id,
            referenceType: "deal"
        });

        // Emit socket event
        emitToUser(otherParticipant._id.toString(), "newDealProposal", {
            deal: deal,
            message: message,
            conversationId
        });

        await deal.populate([
            { path: 'farmer', select: 'firstName lastName' },
            { path: 'coldStorageOwner', select: 'firstName lastName' }
        ]);

        res.status(201).json({
            success: true,
            message: "Deal proposal sent successfully",
            data: { deal, message }
        });

    } catch (error) {
        console.error("Create deal error:", error);
        console.error("Error stack:", error.stack);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to create deal proposal",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Confirm a deal
router.patch("/:dealId/confirm", authMiddleware, async (req, res) => {
    try {
        const { dealId } = req.params;
        const userId = req.user._id;

        const deal = await Deal.findById(dealId)
            .populate('farmer', 'firstName lastName')
            .populate('coldStorageOwner', 'firstName lastName');

        if (!deal) {
            return res.status(404).json({
                success: false,
                message: "Deal not found"
            });
        }

        // Check if user is part of this deal
        const isFarmer = deal.farmer._id.toString() === userId.toString();
        const isOwner = deal.coldStorageOwner._id.toString() === userId.toString();

        if (!isFarmer && !isOwner) {
            return res.status(403).json({
                success: false,
                message: "Not authorized to confirm this deal"
            });
        }

        // Check if already confirmed by this user
        if ((isFarmer && deal.farmerConfirmed) || (isOwner && deal.ownerConfirmed)) {
            return res.status(400).json({
                success: false,
                message: "You have already confirmed this deal"
            });
        }

        // Check if deal is still in proposed state
        if (deal.status === "closed" || deal.status === "cancelled") {
            return res.status(400).json({
                success: false,
                message: "This deal is no longer active"
            });
        }

        // Update confirmation
        if (isFarmer) {
            deal.farmerConfirmed = true;
            deal.farmerConfirmedAt = new Date();
            deal.status = deal.ownerConfirmed ? "closed" : "farmer_confirmed";
        } else {
            deal.ownerConfirmed = true;
            deal.ownerConfirmedAt = new Date();
            deal.status = deal.farmerConfirmed ? "closed" : "owner_confirmed";
        }

        await deal.save();

        // Find the other party
        const otherPartyId = isFarmer ? deal.coldStorageOwner._id : deal.farmer._id;

        // Create confirmation message in chat
        const conversation = await Conversation.findById(deal.conversationId);
        
        let messageContent;
        let messageType;
        
        if (deal.status === "closed") {
            // Deal Closed - both confirmed, but payment pending
            messageContent = `✅ Deal Closed! Both parties have confirmed.\n\n📦 ${deal.quantity} packets\n💰 ₹${deal.pricePerTon}/packet\n💵 Total: ₹${deal.totalAmount}\n\n💳 Proceed to payment to complete the deal.`;
            messageType = "deal_accepted";
        } else {
            const confirmerName = isFarmer ? deal.farmer.firstName : deal.coldStorageOwner.firstName;
            messageContent = `✔️ ${confirmerName} has confirmed the deal. Waiting for other party's confirmation.`;
            messageType = "text";
        }

        const message = await Message.create({
            conversationId: deal.conversationId,
            sender: userId,
            receiver: otherPartyId,
            content: messageContent,
            messageType: messageType,
            dealDetails: deal.status === "closed" ? {
                quantity: deal.quantity,
                pricePerKg: deal.pricePerTon / 1000,
                totalAmount: deal.totalAmount,
                storageMonths: deal.duration
            } : undefined
        });

        // Update conversation
        conversation.lastMessage = message._id;
        conversation.lastMessageText = messageContent;
        conversation.lastMessageAt = new Date();
        await conversation.save();

        // Notify other party
        const notificationType = deal.status === "closed" ? "deal_closed" : "deal_confirmed";
        const notificationTitle = deal.status === "closed" ? "Deal Closed! 🎉" : "Deal Confirmed";
        const notificationMessage = deal.status === "closed" 
            ? `Your deal for ${deal.quantity} tons has been finalized!`
            : `The other party has confirmed the deal. Please confirm to close the deal.`;

        await Notification.create({
            recipient: otherPartyId,
            sender: userId,
            type: notificationType,
            title: notificationTitle,
            message: notificationMessage,
            referenceId: deal._id,
            referenceType: "deal"
        });

        // Emit socket events
        emitToUser(otherPartyId.toString(), "dealConfirmed", {
            deal: deal,
            message: message,
            isClosed: deal.status === "closed"
        });

        res.json({
            success: true,
            message: deal.status === "closed" ? "Deal closed successfully!" : "Deal confirmed. Waiting for other party.",
            data: { deal, message }
        });

    } catch (error) {
        console.error("Confirm deal error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to confirm deal",
            error: error.message
        });
    }
});

// Cancel a deal
router.patch("/:dealId/cancel", authMiddleware, async (req, res) => {
    try {
        const { dealId } = req.params;
        const { reason } = req.body;
        const userId = req.user._id;

        const deal = await Deal.findById(dealId)
            .populate('farmer', 'firstName lastName')
            .populate('coldStorageOwner', 'firstName lastName');

        if (!deal) {
            return res.status(404).json({
                success: false,
                message: "Deal not found"
            });
        }

        // Check if user is part of this deal
        const isFarmer = deal.farmer._id.toString() === userId.toString();
        const isOwner = deal.coldStorageOwner._id.toString() === userId.toString();

        if (!isFarmer && !isOwner) {
            return res.status(403).json({
                success: false,
                message: "Not authorized to cancel this deal"
            });
        }

        // Can't cancel closed deals
        if (deal.status === "closed") {
            return res.status(400).json({
                success: false,
                message: "Cannot cancel a closed deal"
            });
        }

        deal.status = "cancelled";
        await deal.save();

        // Find other party
        const otherPartyId = isFarmer ? deal.coldStorageOwner._id : deal.farmer._id;
        const cancellerName = isFarmer ? deal.farmer.firstName : deal.coldStorageOwner.firstName;

        // Create cancellation message
        const message = await Message.create({
            conversationId: deal.conversationId,
            sender: userId,
            receiver: otherPartyId,
            content: `❌ Deal cancelled by ${cancellerName}${reason ? `: ${reason}` : ''}`,
            messageType: "deal_rejected"
        });

        // Update conversation
        const conversation = await Conversation.findById(deal.conversationId);
        conversation.lastMessage = message._id;
        conversation.lastMessageText = message.content;
        conversation.lastMessageAt = new Date();
        await conversation.save();

        // Notify other party
        await Notification.create({
            recipient: otherPartyId,
            sender: userId,
            type: "deal_cancelled",
            title: "Deal Cancelled",
            message: `The deal for ${deal.quantity} tons has been cancelled`,
            referenceId: deal._id,
            referenceType: "deal"
        });

        emitToUser(otherPartyId.toString(), "dealCancelled", {
            deal: deal,
            message: message
        });

        res.json({
            success: true,
            message: "Deal cancelled",
            data: { deal }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to cancel deal",
            error: error.message
        });
    }
});

// Get deals for a conversation
router.get("/conversation/:conversationId", authMiddleware, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user._id;

        // Verify user is part of conversation
        const conversation = await Conversation.findById(conversationId);
        if (!conversation || !conversation.participants.some(p => p.toString() === userId.toString())) {
            return res.status(403).json({
                success: false,
                message: "Not authorized"
            });
        }

        const deals = await Deal.find({ conversationId })
            .populate('farmer', 'firstName lastName')
            .populate('coldStorageOwner', 'firstName lastName')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: { deals }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch deals",
            error: error.message
        });
    }
});

// Get my deals (all deals for current user)
router.get("/my-deals", authMiddleware, async (req, res) => {
    try {
        const userId = req.user._id;
        const { status } = req.query;

        const query = {
            $or: [
                { farmer: userId },
                { coldStorageOwner: userId }
            ]
        };

        if (status) query.status = status;

        const deals = await Deal.find(query)
            .populate('farmer', 'firstName lastName')
            .populate('coldStorageOwner', 'firstName lastName')
            .populate('coldStorage', 'name address city')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: { deals }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch deals",
            error: error.message
        });
    }
});

// Get single deal
router.get("/:dealId", authMiddleware, async (req, res) => {
    try {
        const { dealId } = req.params;
        const userId = req.user._id;

        const deal = await Deal.findById(dealId)
            .populate('farmer', 'firstName lastName phone')
            .populate('coldStorageOwner', 'firstName lastName phone')
            .populate('coldStorage', 'name address city state')
            .populate('bookingId');

        if (!deal) {
            return res.status(404).json({
                success: false,
                message: "Deal not found"
            });
        }

        // Check authorization
        if (deal.farmer._id.toString() !== userId.toString() && 
            deal.coldStorageOwner._id.toString() !== userId.toString()) {
            return res.status(403).json({
                success: false,
                message: "Not authorized"
            });
        }

        res.json({
            success: true,
            data: { deal }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch deal",
            error: error.message
        });
    }
});

// Confirm payment sent (by payer - usually coldStorageOwner/buyer)
router.patch("/:dealId/confirm-payment-sent", authMiddleware, async (req, res) => {
    try {
        const { dealId } = req.params;
        const userId = req.user._id;
        
        console.log(`[Payment Confirm] User ${userId} confirming payment sent for deal ${dealId}`);

        const deal = await Deal.findById(dealId)
            .populate('farmer', 'firstName lastName')
            .populate('coldStorageOwner', 'firstName lastName');
        
        console.log(`[Payment Confirm] Deal found:`, deal ? `status=${deal.status}, farmer=${deal.farmer?._id}, owner=${deal.coldStorageOwner?._id}` : 'null');

        if (!deal) {
            return res.status(404).json({
                success: false,
                message: "Deal not found"
            });
        }

        // Check if user is part of this deal
        const isFarmer = deal.farmer._id.toString() === userId.toString();
        const isOwner = deal.coldStorageOwner._id.toString() === userId.toString();

        if (!isFarmer && !isOwner) {
            return res.status(403).json({
                success: false,
                message: "Not authorized"
            });
        }

        // Only closed deals can have payment confirmation
        if (deal.status !== "closed") {
            return res.status(400).json({
                success: false,
                message: "Deal must be closed before confirming payment"
            });
        }

        // Mark as payer confirmed
        deal.payerConfirmed = true;
        deal.payerConfirmedAt = new Date();
        deal.paymentMethod = "upi";

        // If both confirmed, mark as paid
        if (deal.payerConfirmed && deal.receiverConfirmed) {
            deal.paymentStatus = "paid";
            deal.paidAt = new Date();
        }

        await deal.save();

        // Notify other party
        const otherPartyId = isFarmer ? deal.coldStorageOwner._id : deal.farmer._id;
        const senderName = isFarmer ? deal.farmer.firstName : deal.coldStorageOwner.firstName;

        // Create message
        const message = await Message.create({
            conversationId: deal.conversationId,
            sender: userId,
            receiver: otherPartyId,
            content: `💰 ${senderName} ने भुगतान भेजने की पुष्टि की / ${senderName} confirmed payment sent`,
            messageType: "text"
        });

        // Update conversation
        const conversation = await Conversation.findById(deal.conversationId);
        if (conversation) {
            conversation.lastMessage = message._id;
            conversation.lastMessageText = message.content;
            conversation.lastMessageAt = new Date();
            await conversation.save();
        }

        // Notify
        await Notification.create({
            recipient: otherPartyId,
            sender: userId,
            type: "payment_sent",
            title: "Payment Sent",
            message: `${senderName} has confirmed sending payment of ₹${deal.totalAmount}`,
            referenceId: deal._id,
            referenceType: "deal"
        });

        emitToUser(otherPartyId.toString(), "paymentConfirmed", { deal, type: "sent" });

        res.json({
            success: true,
            message: "Payment sent confirmation recorded",
            data: { deal }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to confirm payment",
            error: error.message
        });
    }
});

// Confirm payment received (by receiver - usually farmer)
router.patch("/:dealId/confirm-payment-received", authMiddleware, async (req, res) => {
    try {
        const { dealId } = req.params;
        const userId = req.user._id;
        
        console.log(`[Payment Received] User ${userId} confirming payment received for deal ${dealId}`);

        const deal = await Deal.findById(dealId)
            .populate('farmer', 'firstName lastName')
            .populate('coldStorageOwner', 'firstName lastName');
        
        console.log(`[Payment Received] Deal found:`, deal ? `status=${deal.status}, dealType=${deal.dealType}` : 'null');

        if (!deal) {
            return res.status(404).json({
                success: false,
                message: "Deal not found"
            });
        }

        // Check if user is part of this deal
        const farmerId = deal.farmer?._id?.toString();
        const ownerId = deal.coldStorageOwner?._id?.toString();
        const userIdStr = userId.toString();
        
        const isFarmer = farmerId === userIdStr;
        const isOwner = ownerId === userIdStr;
        
        console.log(`[Payment Received] isFarmer=${isFarmer}, isOwner=${isOwner}, farmerId=${farmerId}, ownerId=${ownerId}, userId=${userIdStr}`);

        if (!isFarmer && !isOwner) {
            return res.status(403).json({
                success: false,
                message: "Not authorized"
            });
        }

        // Only closed deals can have payment confirmation
        if (deal.status !== "closed") {
            return res.status(400).json({
                success: false,
                message: "Deal must be closed before confirming payment"
            });
        }

        // Mark as receiver confirmed
        deal.receiverConfirmed = true;
        deal.receiverConfirmedAt = new Date();
        deal.paymentMethod = "upi";

        // If both confirmed, mark as paid
        if (deal.payerConfirmed && deal.receiverConfirmed) {
            deal.paymentStatus = "paid";
            deal.paidAt = new Date();
        }

        await deal.save();

        // Notify other party - handle null safely
        const otherPartyId = isFarmer ? deal.coldStorageOwner?._id : deal.farmer?._id;
        const receiverName = isFarmer 
            ? (deal.farmer?.firstName || 'Farmer') 
            : (deal.coldStorageOwner?.firstName || 'Trader');

        // Create message only if we have conversation and other party
        if (deal.conversationId && otherPartyId) {
            const message = await Message.create({
                conversationId: deal.conversationId,
                sender: userId,
                receiver: otherPartyId,
                content: `✅ ${receiverName} ने भुगतान प्राप्त करने की पुष्टि की / ${receiverName} confirmed payment received`,
                messageType: "text"
            });

            // Update conversation
            const conversation = await Conversation.findById(deal.conversationId);
            if (conversation) {
                conversation.lastMessage = message._id;
                conversation.lastMessageText = message.content;
                conversation.lastMessageAt = new Date();
                await conversation.save();
            }
        }

        // If both confirmed, send deal complete notification
        if (deal.paymentStatus === "paid") {
            // Notify both parties - handle null safely
            if (deal.farmer?._id) {
                await Notification.create({
                    recipient: deal.farmer._id,
                    sender: userId,
                    type: "deal_completed",
                    title: "Deal Completed! 🎉",
                    message: `Payment of ₹${deal.totalAmount} confirmed. Deal is complete!`,
                    referenceId: deal._id,
                    referenceType: "deal"
                });
                emitToUser(deal.farmer._id.toString(), "dealCompleted", { deal });
            }

            if (deal.coldStorageOwner?._id) {
                await Notification.create({
                    recipient: deal.coldStorageOwner._id,
                    sender: userId,
                    type: "deal_completed",
                    title: "Deal Completed! 🎉",
                    message: `Payment of ₹${deal.totalAmount} confirmed. Deal is complete!`,
                    referenceId: deal._id,
                    referenceType: "deal"
                });
                emitToUser(deal.coldStorageOwner._id.toString(), "dealCompleted", { deal });
            }
        } else if (otherPartyId) {
            // Just notify about payment received confirmation
            await Notification.create({
                recipient: otherPartyId,
                sender: userId,
                type: "payment_received",
                title: "Payment Received",
                message: `${receiverName} has confirmed receiving payment of ₹${deal.totalAmount}`,
                referenceId: deal._id,
                referenceType: "deal"
            });

            emitToUser(otherPartyId.toString(), "paymentConfirmed", { deal, type: "received" });
        }

        res.json({
            success: true,
            message: deal.paymentStatus === "paid" 
                ? "Payment complete! Deal is done!" 
                : "Payment received confirmation recorded",
            data: { deal }
        });

    } catch (error) {
        console.error('[Payment Received] Error:', error);
        res.status(500).json({
            success: false,
            message: "Failed to confirm payment",
            error: error.message
        });
    }
});

export { router };
