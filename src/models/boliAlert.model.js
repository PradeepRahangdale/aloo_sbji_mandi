import mongoose from "mongoose";

const boliAlertSchema = new mongoose.Schema({
    // Cold storage reference
    coldStorage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ColdStorage",
        required: true
    },
    
    // Created by (cold storage owner/admin)
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    // Boli details
    title: {
        type: String,
        required: true,
        default: "आलू बोली / Potato Auction"
    },

    description: {
        type: String
    },

    // Schedule - Day of week (0=Sunday, 1=Monday, etc.)
    dayOfWeek: {
        type: Number,
        default: 0, // Sunday
        min: 0,
        max: 6
    },

    // Time of boli
    boliTime: {
        type: String,
        required: true,
        default: "10:00 AM"
    },

    // Date of next boli
    nextBoliDate: {
        type: Date,
        required: true
    },

    // Location details
    location: {
        address: {
            type: String,
            required: true
        },
        city: {
            type: String,
            required: true
        },
        district: {
            type: String
        },
        state: {
            type: String,
            required: true
        },
        landmark: String,
        googleMapsLink: String
    },

    // Contact details
    contactPerson: {
        type: String,
        required: true
    },
    
    contactPhone: {
        type: String,
        required: true
    },

    // Expected quantity in tons
    expectedQuantity: {
        type: Number
    },

    // Expected price range (per quintal)
    expectedPriceMin: {
        type: Number
    },
    
    expectedPriceMax: {
        type: Number
    },

    // Potato varieties available
    potatoVarieties: [{
        type: String
    }],

    // Is this a recurring weekly boli?
    isRecurring: {
        type: Boolean,
        default: true
    },

    // Is active
    isActive: {
        type: Boolean,
        default: true
    },

    // Alert sent timestamps
    alertsSent: [{
        sentAt: Date,
        recipientCount: Number
    }],

    // Additional instructions
    instructions: {
        type: String
    },

    // Target audience for alert notifications
    targetAudience: {
        type: String,
        enum: ["customers", "all"],
        default: "all"
    }

}, { timestamps: true });

// Index for efficient querying
boliAlertSchema.index({ nextBoliDate: 1, isActive: 1 });
boliAlertSchema.index({ coldStorage: 1 });

// Method to calculate next boli date based on day of week
boliAlertSchema.methods.calculateNextBoliDate = function() {
    const today = new Date();
    const currentDay = today.getDay();
    let daysUntilNext = this.dayOfWeek - currentDay;
    
    if (daysUntilNext <= 0) {
        daysUntilNext += 7;
    }
    
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + daysUntilNext);
    nextDate.setHours(0, 0, 0, 0);
    
    return nextDate;
};

// Pre-save hook to set next boli date (Mongoose 9+ removed next() callback)
boliAlertSchema.pre('save', function() {
    if (this.isNew || this.isModified('dayOfWeek')) {
        this.nextBoliDate = this.calculateNextBoliDate();
    }
});

export const BoliAlert = mongoose.model("BoliAlert", boliAlertSchema);
