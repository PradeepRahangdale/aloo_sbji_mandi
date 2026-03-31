import mongoose from 'mongoose';

const listingSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    type: {
      type: String,
      enum: ['sell', 'buy'],
      required: true,
    },

    potatoVariety: {
      type: String,
      required: true,
    },

    quantity: {
      type: Number,
      required: true, // in quintals
    },

    pricePerQuintal: {
      type: Number,
      required: true,
    },

    description: {
      type: String,
    },

    images: [
      {
        type: String,
      },
    ],

    location: {
      village: String,
      district: String,
      state: String,
      pincode: String,
    },

    size: {
      type: String,
      enum: ['Small', 'Medium', 'Large'],
      default: 'Medium',
    },

    quality: {
      type: String,
      enum: ['Low', 'Average', 'Good'],
      default: 'Good',
    },

    packetWeight: {
      type: Number,
      default: null,
    },

    unit: {
      type: String,
      enum: ['Packet', 'Quintal', 'Kg'],
      default: 'Packet',
    },

    sourceType: {
      type: String,
      enum: ['field', 'cold_storage'],
      default: 'cold_storage',
    },

    coldStorage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ColdStorage',
      default: null,
    },

    coldStorageName: {
      type: String,
      default: null,
    },

    captureLocation: {
      address: { type: String, default: null },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },

    listingType: {
      type: String,
      enum: ['seed', 'crop'],
      default: 'crop',
    },

    contactPhone: {
      type: String,
      default: null,
    },

    referenceId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    expiresAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Auto-generate referenceId (ALM-XXXXX) before saving
listingSchema.pre('save', async function () {
  if (this.referenceId) return;

  const lastListing = await mongoose
    .model('Listing')
    .findOne({ referenceId: { $ne: null } })
    .sort({ referenceId: -1 })
    .select('referenceId')
    .lean();

  let nextNum = 1;
  if (lastListing && lastListing.referenceId) {
    const match = lastListing.referenceId.match(/ALM-(\d+)/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }

  this.referenceId = `ALM-${String(nextNum).padStart(5, '0')}`;
});

export const Listing = mongoose.model('Listing', listingSchema);
