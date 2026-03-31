import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    transactionId: {
        type: String,
        required: true,
        unique: true
    },
    type: {
        type: String,
        enum: ['payment', 'refund', 'withdrawal', 'deposit', 'subscription', 'purchase'],
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'INR'
    },
    status: {
        type: String,
        enum: ['pending', 'success', 'failed', 'cancelled', 'refunded'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        enum: ['card', 'upi', 'netbanking', 'wallet', 'cod', 'razorpay'],
        required: true
    },
    description: {
        type: String
    },
    metadata: {
        // For storing related IDs like listingId, bookingId, etc.
        relatedId: {
            type: mongoose.Schema.Types.ObjectId
        },
        relatedType: {
            type: String,
            enum: ['listing', 'booking', 'subscription', 'advertisement', 'token']
        },
        razorpayOrderId: String,
        razorpayPaymentId: String,
        razorpaySignature: String,
        bankRefNumber: String,
        upiId: String,
        cardLast4: String
    },
    failureReason: {
        type: String
    }
}, {
    timestamps: true
});

// Indexes for faster queries
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ status: 1 });

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;
