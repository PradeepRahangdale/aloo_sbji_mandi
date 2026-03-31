import mongoose from "mongoose";

const receiptSchema = new mongoose.Schema(
  {
    receiptNumber: {
      type: String,
      required: true,
      unique: true,
    },
    dealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Deal",
      required: true,
    },
    dealType: {
      type: String,
      enum: ["cold-storage", "listing"],
      required: true,
    },
    // Parties involved
    farmer: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      name: String,
      phone: String,
    },
    payer: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      name: String,
      phone: String,
      role: {
        type: String,
        enum: ["cold-storage-owner", "vendor"],
      },
    },
    // Deal details
    dealDetails: {
      quantity: Number,
      unit: {
        type: String,
        default: "tons",
      },
      pricePerUnit: Number,
      duration: Number, // for cold storage deals
      listingTitle: String, // for vendor deals
    },
    // Payment details
    paymentDetails: {
      subtotal: Number,
      taxes: {
        type: Number,
        default: 0,
      },
      totalAmount: {
        type: Number,
        required: true,
      },
      paymentMethod: {
        type: String,
        enum: ["razorpay", "stripe", "upi", "cash", "bank_transfer"],
        default: "razorpay",
      },
      paymentId: String,
      paymentOrderId: String,
      paidAt: Date,
    },
    // Status
    status: {
      type: String,
      enum: ["generated", "sent", "viewed", "downloaded"],
      default: "generated",
    },
    // Viewed by
    viewedByFarmer: {
      type: Boolean,
      default: false,
    },
    viewedByPayer: {
      type: Boolean,
      default: false,
    },
    viewedAt: {
      farmer: Date,
      payer: Date,
    },
    // Additional info
    notes: String,
    termsAndConditions: {
      type: String,
      default: "This is a computer-generated receipt and does not require a signature. Payment has been verified and confirmed.",
    },
  },
  {
    timestamps: true,
  }
);

// Generate unique receipt number
receiptSchema.statics.generateReceiptNumber = async function () {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  
  // Get count of receipts today
  const startOfDay = new Date(date.setHours(0, 0, 0, 0));
  const endOfDay = new Date(date.setHours(23, 59, 59, 999));
  
  const count = await this.countDocuments({
    createdAt: { $gte: startOfDay, $lte: endOfDay },
  });
  
  const sequence = (count + 1).toString().padStart(4, "0");
  return `RCP${year}${month}${day}${sequence}`;
};

// Index for quick lookups
receiptSchema.index({ dealId: 1 });
receiptSchema.index({ "farmer.userId": 1 });
receiptSchema.index({ "payer.userId": 1 });
receiptSchema.index({ createdAt: -1 });

export const Receipt = mongoose.model("Receipt", receiptSchema);
