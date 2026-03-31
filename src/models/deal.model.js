import mongoose from "mongoose";

const dealSchema = new mongoose.Schema({
    // The conversation this deal belongs to
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Conversation",
        required: true
    },

    // The booking this deal is related to (for cold storage deals)
    bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Booking"
    },

    // Deal type: 'cold-storage' or 'listing' (farmer-vendor)
    dealType: {
        type: String,
        enum: ["cold-storage", "listing"],
        default: "cold-storage"
    },

    // Farmer who is making the deal
    farmer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    // Cold storage owner OR Vendor (buyer)
    coldStorageOwner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    // Cold storage (only for cold-storage deals)
    coldStorage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ColdStorage"
    },

    // Listing reference (for farmer-vendor deals)
    listingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Listing"
    },

    // Deal details
    quantity: {
        type: Number,
        required: true  // in tons or packets
    },

    pricePerTon: {
        type: Number,
        required: true
    },

    totalAmount: {
        type: Number,
        required: true
    },

    duration: {
        type: Number,
        default: 1  // in months
    },

    // Who proposed the deal
    proposedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    // Deal status
    status: {
        type: String,
        enum: ["proposed", "farmer_confirmed", "owner_confirmed", "closed", "cancelled"],
        default: "proposed"
    },

    // Confirmations
    farmerConfirmed: {
        type: Boolean,
        default: false
    },

    ownerConfirmed: {
        type: Boolean,
        default: false
    },

    // Timestamps for confirmations
    farmerConfirmedAt: {
        type: Date
    },

    ownerConfirmedAt: {
        type: Date
    },

    // Notes
    notes: {
        type: String
    },

    // Message ID that contains this deal proposal
    dealMessageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message"
    },

    // Payment fields
    paymentStatus: {
        type: String,
        enum: ["pending", "requested", "paid", "failed", "refunded"],
        default: "pending"
    },

    paymentRequestedAt: {
        type: Date
    },

    paymentRequestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },

    paymentId: {
        type: String  // Razorpay/Stripe payment ID
    },

    paymentOrderId: {
        type: String  // Razorpay order ID
    },

    paidAt: {
        type: Date
    },

    paymentMethod: {
        type: String,
        enum: ["razorpay", "stripe", "upi", "cash", "bank_transfer"]
    },

    // Payment confirmation flags (both must confirm for deal to complete)
    payerConfirmed: {
        type: Boolean,
        default: false
    },

    receiverConfirmed: {
        type: Boolean,
        default: false
    },

    payerConfirmedAt: {
        type: Date
    },

    receiverConfirmedAt: {
        type: Date
    }

}, { timestamps: true });

// Indexes
dealSchema.index({ conversationId: 1 });
dealSchema.index({ bookingId: 1 });
dealSchema.index({ farmer: 1, status: 1 });
dealSchema.index({ coldStorageOwner: 1, status: 1 });

export const Deal = mongoose.model("Deal", dealSchema);
