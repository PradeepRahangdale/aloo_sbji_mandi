import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
    // The conversation this message belongs to
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Conversation",
        required: true
    },

    // Sender of the message
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    // Receiver of the message
    receiver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    // Message content
    content: {
        type: String,
        required: true,
        trim: true
    },

    // Message type
    messageType: {
        type: String,
        enum: ["text", "image", "deal_proposal", "deal_accepted", "deal_rejected", "deal_completed", "payment_request", "closing_call", "closing_call_accepted", "deal_closed", "payment_shared", "payment_sent"],
        default: "text"
    },

    // For deal-related messages
    dealDetails: {
        quantity: Number,        // in kg
        pricePerKg: Number,      // in rupees
        totalAmount: Number,
        storageMonths: Number,   // for cold storage deals
        paymentId: String,       // for payment completion
        paymentMethod: String,   // cash, upi, razorpay, bank_transfer
        sellerName: String,      // seller name for closing call
        buyerName: String,       // buyer name for closing call
        coldStorageId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ColdStorage"
        }
    },

    // Read status
    isRead: {
        type: Boolean,
        default: false
    },

    // Read timestamp
    readAt: {
        type: Date
    },

    // Delivery status
    status: {
        type: String,
        enum: ["sent", "delivered", "read"],
        default: "sent"
    }

}, { timestamps: true });

// Indexes for fast queries
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ receiver: 1 });

export const Message = mongoose.model("Message", messageSchema);
