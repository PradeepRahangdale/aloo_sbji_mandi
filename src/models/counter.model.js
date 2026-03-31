import mongoose, { Schema } from 'mongoose';

const counterSchema = new Schema(
  {
    // Which cold storage this counter belongs to
    coldStorage: {
      type: Schema.Types.ObjectId,
      ref: 'ColdStorage',
      required: true,
    },
    // Counter number (1, 2, 3...)
    number: {
      type: Number,
      required: true,
    },
    // Display name (e.g. "Counter 1", "Window A")
    name: {
      type: String,
      required: true,
    },
    // Average service time per farmer in minutes
    averageServiceTime: {
      type: Number,
      default: 10,
      min: 1,
    },
    // Whether this counter is currently active/open
    isActive: {
      type: Boolean,
      default: true,
    },
    // Current queue length (denormalized for fast reads)
    currentQueueLength: {
      type: Number,
      default: 0,
    },
    // Currently active token at this counter
    activeTokenId: {
      type: Schema.Types.ObjectId,
      ref: 'Token',
      default: null,
    },
  },
  { timestamps: true }
);

// Compound index: one counter number per cold storage
counterSchema.index({ coldStorage: 1, number: 1 }, { unique: true });
counterSchema.index({ coldStorage: 1, isActive: 1 });

// Static: find counter with lowest estimated wait for smart assignment
counterSchema.statics.getBestCounter = async function (coldStorageId) {
  const activeCounters = await this.find({
    coldStorage: coldStorageId,
    isActive: true,
  }).sort({ currentQueueLength: 1, number: 1 });

  if (activeCounters.length === 0) return null;

  // Return the counter with the lowest queue length
  // If tied, the one with lower number (sorted above)
  return activeCounters[0];
};

// Static: recalculate queue length for a counter from actual token data
counterSchema.statics.recalculateQueueLength = async function (counterId) {
  const Token = mongoose.model('Token');
  const today = new Date();
  const tokenDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const count = await Token.countDocuments({
    counter: counterId,
    tokenDate: tokenDate,
    status: { $in: ['waiting', 'called'] },
  });

  await this.findByIdAndUpdate(counterId, { currentQueueLength: count });
  return count;
};

// Static: ensure default counter exists for a cold storage
counterSchema.statics.ensureDefaultCounter = async function (coldStorageId) {
  const existing = await this.findOne({ coldStorage: coldStorageId });
  if (!existing) {
    return await this.create({
      coldStorage: coldStorageId,
      number: 1,
      name: 'Counter A',
      averageServiceTime: 10,
      isActive: true,
    });
  }
  return existing;
};

export const Counter = mongoose.model('Counter', counterSchema);
