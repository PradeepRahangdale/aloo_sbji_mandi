import mongoose from 'mongoose';

const advertisement_schema = new mongoose.Schema(
  {
    // Who is advertising
    advertiser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Advertisement details
    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
    },

    // Image URL for the slider (legacy single image)
    imageUrl: {
      type: String,
      default: '',
    },

    // Multiple slide images (up to 5) - base64 or URLs
    images: {
      type: [String],
      default: [],
      validate: {
        validator: function (v) {
          return v.length <= 5;
        },
        message: 'Maximum 5 slide images allowed',
      },
    },

    // Link to redirect when ad is clicked (legacy single URL)
    redirectUrl: {
      type: String,
      trim: true,
    },

    // Per-slide redirect URLs (parallel to images array)
    redirectUrls: {
      type: [String],
      default: [],
    },

    // Type of advertiser
    advertiserType: {
      type: String,
      enum: ['cold-storage', 'trader', 'farmer', 'aloo-mitra', 'external'],
      default: 'cold-storage',
    },

    // Cold storage reference if advertiser is cold storage owner
    coldStorage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ColdStorage',
    },

    // Advertisement duration in days
    durationDays: {
      type: Number,
      required: true,
      default: 30,
    },

    // Pricing
    price: {
      type: Number,
      required: true,
    },

    // Status workflow: pending -> approved/rejected -> paid -> active -> expired
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'paid', 'active', 'expired', 'cancelled'],
      default: 'pending',
    },

    // Payment details
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'pending', 'completed', 'failed', 'refunded'],
      default: 'unpaid',
    },

    paymentId: {
      type: String,
    },

    paymentOrderId: {
      type: String,
    },

    paymentMethod: {
      type: String,
    },

    // Active period
    startDate: {
      type: Date,
    },

    endDate: {
      type: Date,
    },

    // Admin notes
    adminNotes: {
      type: String,
    },

    // Rejection reason
    rejectionReason: {
      type: String,
    },

    // Approved by admin
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    approvedAt: {
      type: Date,
    },

    // View count for analytics
    viewCount: {
      type: Number,
      default: 0,
    },

    clickCount: {
      type: Number,
      default: 0,
    },

    // Contact details
    contactPhone: {
      type: String,
    },

    contactEmail: {
      type: String,
    },
  },
  { timestamps: true }
);

// Index for querying active ads
advertisement_schema.index({ status: 1, startDate: 1, endDate: 1 });
advertisement_schema.index({ advertiser: 1 });

export const Advertisement = mongoose.model('Advertisement', advertisement_schema);
