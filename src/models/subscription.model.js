import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    
    planId: {
        type: String,
        enum: ['free', 'seasonal', 'yearly'],
        required: true
    },
    
    planName: {
        type: String,
        required: true
    },
    
    price: {
        type: Number,
        required: true
    },
    
    currency: {
        type: String,
        default: 'INR'
    },
    
    duration: {
        type: Number,  // Duration in days
        required: true
    },
    
    startDate: {
        type: Date,
        default: Date.now
    },
    
    endDate: {
        type: Date,
        required: true
    },
    
    status: {
        type: String,
        enum: ['active', 'expired', 'cancelled', 'pending'],
        default: 'pending'
    },
    
    // Razorpay payment details
    payment: {
        orderId: String,
        paymentId: String,
        signature: String,
        method: String,
        status: {
            type: String,
            enum: ['pending', 'completed', 'failed', 'refunded'],
            default: 'pending'
        },
        paidAt: Date
    },
    
    // Auto-renewal
    autoRenew: {
        type: Boolean,
        default: false
    },
    
    // Features unlocked by this plan
    features: {
        unlimitedListings: { type: Boolean, default: false },
        prioritySearch: { type: Boolean, default: false },
        verifiedBadge: { type: Boolean, default: false },
        featuredListings: { type: Boolean, default: false },
        directCalls: { type: Boolean, default: false },
        noAds: { type: Boolean, default: false },
        dedicatedManager: { type: Boolean, default: false },
        apiAccess: { type: Boolean, default: false },
        premiumBadge: { type: Boolean, default: false }
    },
    
    // Limits
    limits: {
        listingsPerMonth: { type: Number, default: 5 },
        boliAlertsPerMonth: { type: Number, default: 2 }
    }
    
}, { timestamps: true });

// Static method to get plan details
subscriptionSchema.statics.getPlanDetails = function(planId) {
    const plans = {
        'free': {
            name: 'Free',
            price: 0,
            duration: 36500, // ~100 years (forever)
            features: {
                unlimitedListings: false,
                prioritySearch: false,
                verifiedBadge: false,
                featuredListings: false,
                directCalls: false,
                noAds: false,
                dedicatedManager: false,
                apiAccess: false,
                premiumBadge: false
            },
            limits: {
                listingsPerMonth: 5,
                boliAlertsPerMonth: 2
            }
        },
        'seasonal': {
            name: 'Seasonal Pass',
            price: 699,
            duration: 120, // 4 months
            features: {
                unlimitedListings: true,
                prioritySearch: true,
                verifiedBadge: true,
                featuredListings: true,
                directCalls: true,
                noAds: false,
                dedicatedManager: false,
                apiAccess: false,
                premiumBadge: false
            },
            limits: {
                listingsPerMonth: -1, // Unlimited
                boliAlertsPerMonth: -1 // Unlimited
            }
        },
        'yearly': {
            name: 'Yearly Pass',
            price: 1499,
            duration: 365, // 1 year
            features: {
                unlimitedListings: true,
                prioritySearch: true,
                verifiedBadge: true,
                featuredListings: true,
                directCalls: true,
                noAds: true,
                dedicatedManager: true,
                apiAccess: true,
                premiumBadge: true
            },
            limits: {
                listingsPerMonth: -1,
                boliAlertsPerMonth: -1
            }
        }
    };
    
    return plans[planId] || plans['free'];
};

// Method to check if subscription is active
subscriptionSchema.methods.isActive = function() {
    return this.status === 'active' && new Date() < new Date(this.endDate);
};

// Method to get remaining days
subscriptionSchema.methods.getRemainingDays = function() {
    if (!this.isActive()) return 0;
    const now = new Date();
    const end = new Date(this.endDate);
    const diffTime = end - now;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Index for faster queries
subscriptionSchema.index({ user: 1, status: 1 });
subscriptionSchema.index({ endDate: 1 });
subscriptionSchema.index({ 'payment.orderId': 1 }, { sparse: true, unique: true });
subscriptionSchema.index({ 'payment.paymentId': 1 }, { sparse: true });

export const Subscription = mongoose.model("Subscription", subscriptionSchema);
