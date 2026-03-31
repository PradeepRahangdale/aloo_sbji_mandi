import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema({
    // The farmer who made the booking
    farmer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    // The cold storage being booked
    coldStorage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ColdStorage",
        required: true
    },

    // The cold storage owner
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    // Booking details
    quantity: {
        type: Number,
        required: true,
        min: 1
    },

    // Duration in months
    duration: {
        type: Number,
        required: true,
        default: 1,
        min: 1
    },

    // Price per ton at time of booking
    pricePerTon: {
        type: Number,
        required: true
    },

    // Total calculated price
    totalPrice: {
        type: Number,
        required: true
    },

    // Booking status
    status: {
        type: String,
        enum: ["pending", "accepted", "rejected", "cancelled", "completed"],
        default: "pending"
    },

    // Farmer's message/note with the booking
    farmerNote: {
        type: String,
        default: ""
    },

    // Owner's response message
    ownerResponse: {
        type: String,
        default: ""
    },

    // Start date (when storage begins)
    startDate: {
        type: Date
    },

    // End date (when storage ends)
    endDate: {
        type: Date
    },

    // When the booking was accepted/rejected
    respondedAt: {
        type: Date
    },

    // Related conversation for this booking
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Conversation"
    }

}, { timestamps: true });

// Index for faster queries
bookingSchema.index({ farmer: 1, status: 1 });
bookingSchema.index({ owner: 1, status: 1 });
bookingSchema.index({ coldStorage: 1, status: 1 });

export const Booking = mongoose.model("Booking", bookingSchema);
