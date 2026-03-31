import mongoose from 'mongoose';

const ratingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    review: {
      type: String,
    },
  },
  { timestamps: true }
);

const coldStorageSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    name: {
      type: String,
      required: true,
    },

    address: {
      type: String,
      required: true,
    },

    city: {
      type: String,
      required: true,
    },

    village: {
      type: String,
      default: null, // Optional: village/town within the district
    },

    state: {
      type: String,
      required: true,
    },

    pincode: {
      type: String,
      required: true,
    },

    phone: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: false,
      default: null,
    },

    capacity: {
      type: Number,
      required: true,
    },

    availableCapacity: {
      type: Number,
      required: true,
    },

    pricePerTon: {
      type: Number,
      required: true,
    },

    isAvailable: {
      type: Boolean,
      default: true,
    },

    // Manager assigned to this cold storage
    manager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    managerPhone: {
      type: String,
      default: null,
    },

    // GPS location captured when owner takes a photo
    captureLocation: {
      address: { type: String, default: null },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },

    images: [
      {
        type: String,
      },
    ],

    ratings: [ratingSchema],

    averageRating: {
      type: Number,
      default: 0,
    },

    totalRatings: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Method to calculate average rating
coldStorageSchema.methods.calculateAverageRating = function () {
  if (this.ratings.length === 0) {
    this.averageRating = 0;
    this.totalRatings = 0;
  } else {
    const sum = this.ratings.reduce((acc, r) => acc + r.rating, 0);
    this.averageRating = Math.round((sum / this.ratings.length) * 10) / 10;
    this.totalRatings = this.ratings.length;
  }
  return this.averageRating;
};

export const ColdStorage = new mongoose.model('ColdStorage', coldStorageSchema);
