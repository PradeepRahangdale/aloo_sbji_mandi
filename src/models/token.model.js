import mongoose, { Schema } from 'mongoose';

const tokenSchema = new Schema(
  {
    // Token number for display (e.g., T-001) — empty for pending requests
    tokenNumber: {
      type: String,
      default: '',
    },
    // Sequential number for ordering — 0 for pending requests
    sequenceNumber: {
      type: Number,
      default: 0,
    },
    // Which cold storage issued this token
    coldStorage: {
      type: Schema.Types.ObjectId,
      ref: 'ColdStorage',
      required: true,
    },
    // The farmer who received this token
    farmer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Farmer's name (for quick display)
    farmerName: {
      type: String,
      default: '',
    },
    // Farmer's phone
    farmerPhone: {
      type: String,
      default: '',
    },
    // Purpose of visit
    purpose: {
      type: String,
      enum: ['storage', 'withdrawal', 'inspection', 'other'],
      default: 'storage',
    },
    // Expected quantity
    expectedQuantity: {
      type: Number,
      default: 0,
    },
    // Unit of expected quantity
    unit: {
      type: String,
      enum: ['Packet', 'Quintal'],
      default: 'Packet',
    },
    // Potato variety
    potatoVariety: {
      type: String,
    },
    // Token status
    status: {
      type: String,
      enum: [
        'pending',
        'waiting',
        'called',
        'in-service',
        'completed',
        'skipped',
        'cancelled',
        'rejected',
      ],
      default: 'waiting',
    },
    // When was the token requested by farmer
    requestedAt: {
      type: Date,
    },
    // Date for which token is valid (tokens reset daily)
    tokenDate: {
      type: Date,
      required: true,
      default: () => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      },
    },
    // Timestamps for tracking
    issuedAt: {
      type: Date,
      default: Date.now,
    },
    calledAt: {
      type: Date,
    },
    serviceStartedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    // Estimated wait time in minutes (calculated)
    estimatedWaitMinutes: {
      type: Number,
      default: 0,
    },
    // Reference to the Counter document
    counter: {
      type: Schema.Types.ObjectId,
      ref: 'Counter',
      default: null,
    },
    // Counter number for quick display (denormalized from Counter)
    counterNumber: {
      type: Number,
      default: 1,
    },
    // Position in queue at this counter (recalculated on changes)
    positionInQueue: {
      type: Number,
      default: 0,
    },
    // Estimated service start time
    estimatedStartTime: {
      type: Date,
      default: null,
    },
    // Remark from farmer
    remark: {
      type: String,
      default: '',
    },
    // Notes from cold storage
    notes: {
      type: String,
    },
    // Whether notification was sent for "your turn is near"
    nearbyNotificationSent: {
      type: Boolean,
      default: false,
    },
    // Whether notification was sent for "your turn now"
    calledNotificationSent: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Index for efficient queries
tokenSchema.index({ coldStorage: 1, tokenDate: 1, status: 1 });
tokenSchema.index({ farmer: 1, tokenDate: 1 });
tokenSchema.index({ coldStorage: 1, sequenceNumber: 1 });
tokenSchema.index({ counter: 1, tokenDate: 1, status: 1 });

// Static method to generate next token number for a cold storage on a given date
// Only considers active tokens (waiting, called, in-service) — completed/cancelled
// tokens do NOT occupy sequence slots, so numbers are reused without gaps.
tokenSchema.statics.generateTokenNumber = async function (coldStorageId, date) {
  const tokenDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  // Only look at tokens currently in the active queue
  const activeStatuses = ['waiting', 'called', 'in-service'];

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const lastActiveToken = await this.findOne({
      coldStorage: coldStorageId,
      tokenDate: tokenDate,
      status: { $in: activeStatuses },
    }).sort({ sequenceNumber: -1 });

    const nextSequence = lastActiveToken ? lastActiveToken.sequenceNumber + 1 : 1;
    const tokenNumber = `T-${String(nextSequence).padStart(3, '0')}`;

    // Check if this sequence already exists among active tokens (race condition guard)
    const exists = await this.findOne({
      coldStorage: coldStorageId,
      tokenDate: tokenDate,
      sequenceNumber: nextSequence,
      status: { $in: activeStatuses },
    });

    if (!exists) {
      return { tokenNumber, sequenceNumber: nextSequence };
    }
    // If exists, retry with a fresh query
  }

  // Final fallback: count active tokens + 1
  const count = await this.countDocuments({
    coldStorage: coldStorageId,
    tokenDate: tokenDate,
    status: { $in: activeStatuses },
  });
  const nextSequence = count + 1;
  const tokenNumber = `T-${String(nextSequence).padStart(3, '0')}`;
  return { tokenNumber, sequenceNumber: nextSequence };
};

// Static method to get current position in queue (per-counter if counter assigned)
tokenSchema.statics.getQueuePosition = async function (tokenId) {
  const token = await this.findById(tokenId);
  if (!token || token.status !== 'waiting') return null;

  const query = {
    coldStorage: token.coldStorage,
    tokenDate: token.tokenDate,
    status: 'waiting',
    sequenceNumber: { $lt: token.sequenceNumber },
  };

  // If token has a counter, position is per-counter
  if (token.counter) {
    query.counter = token.counter;
  }

  const aheadCount = await this.countDocuments(query);
  return aheadCount + 1; // Position is 1-based
};

// Method to calculate estimated wait time (uses counter's avg service time if available)
tokenSchema.methods.calculateEstimatedWait = async function (avgServiceTimeMinutes = 10) {
  const position = await this.constructor.getQueuePosition(this._id);
  if (!position) return 0;

  // If counter is assigned, use its average service time
  let serviceTime = avgServiceTimeMinutes;
  if (this.counter) {
    const Counter = mongoose.model('Counter');
    const counter = await Counter.findById(this.counter);
    if (counter) serviceTime = counter.averageServiceTime;
  }

  // Count tokens being served at this counter
  const inServiceQuery = {
    coldStorage: this.coldStorage,
    tokenDate: this.tokenDate,
    status: 'in-service',
  };
  if (this.counter) inServiceQuery.counter = this.counter;

  const inServiceCount = await this.constructor.countDocuments(inServiceQuery);

  // Subtract in-service tokens as they're almost done
  const effectivePosition = Math.max(0, position - inServiceCount);
  return effectivePosition * serviceTime;
};

export const Token = mongoose.model('Token', tokenSchema);
