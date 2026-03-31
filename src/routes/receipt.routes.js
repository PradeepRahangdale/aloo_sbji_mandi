import { Router } from "express";
import { Receipt } from "../models/receipt.model.js";
import { Deal } from "../models/deal.model.js";
import { authMiddleware } from "../middleware/auth.middleware.js";

const router = Router();

// Generate receipt after successful payment
router.post("/generate", authMiddleware, async (req, res) => {
  try {
    const { dealId } = req.body;

    if (!dealId) {
      return res.status(400).json({
        success: false,
        message: "Deal ID is required",
      });
    }

    // Check if receipt already exists for this deal
    const existingReceipt = await Receipt.findOne({ dealId });
    if (existingReceipt) {
      return res.status(200).json({
        success: true,
        message: "Receipt already exists",
        receipt: existingReceipt,
      });
    }

    // Get deal details with populated fields
    const deal = await Deal.findById(dealId)
      .populate("farmer", "firstName lastName phone")
      .populate("coldStorageOwner", "firstName lastName phone")
      .populate("vendor", "firstName lastName phone")
      .populate("listingId", "title vegetable");

    if (!deal) {
      return res.status(404).json({
        success: false,
        message: "Deal not found",
      });
    }

    if (deal.status !== "closed" || deal.paymentStatus !== "paid") {
      return res.status(400).json({
        success: false,
        message: "Receipt can only be generated for paid and closed deals",
      });
    }

    // Generate receipt number
    const receiptNumber = await Receipt.generateReceiptNumber();

    // Determine payer based on deal type
    const isListingDeal = deal.dealType === "listing";
    const payer = isListingDeal ? deal.vendor : deal.coldStorageOwner;
    const payerRole = isListingDeal ? "vendor" : "cold-storage-owner";

    // Create receipt
    const receipt = await Receipt.create({
      receiptNumber,
      dealId: deal._id,
      dealType: deal.dealType,
      farmer: {
        userId: deal.farmer._id,
        name: `${deal.farmer.firstName} ${deal.farmer.lastName}`,
        phone: deal.farmer.phone,
      },
      payer: {
        userId: payer._id,
        name: `${payer.firstName} ${payer.lastName}`,
        phone: payer.phone,
        role: payerRole,
      },
      dealDetails: {
        quantity: deal.quantity,
        unit: isListingDeal ? "packets" : "tons",
        pricePerUnit: deal.pricePerTon,
        duration: deal.duration,
        listingTitle: deal.listingId?.title || deal.listingId?.vegetable,
      },
      paymentDetails: {
        subtotal: deal.totalAmount,
        taxes: 0,
        totalAmount: deal.totalAmount,
        paymentMethod: deal.paymentMethod || "razorpay",
        paymentId: deal.paymentId,
        paymentOrderId: deal.paymentOrderId,
        paidAt: deal.paidAt,
      },
      status: "generated",
    });

    res.status(201).json({
      success: true,
      message: "Receipt generated successfully",
      receipt,
    });
  } catch (error) {
    console.error("Generate receipt error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate receipt",
      error: error.message,
    });
  }
});

// Get receipt by deal ID
router.get("/deal/:dealId", authMiddleware, async (req, res) => {
  try {
    const { dealId } = req.params;
    const userId = req.user._id;

    const receipt = await Receipt.findOne({ dealId });

    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: "Receipt not found",
      });
    }

    // Check if user is part of the deal
    const isFarmer = receipt.farmer.userId.toString() === userId.toString();
    const isPayer = receipt.payer.userId.toString() === userId.toString();

    if (!isFarmer && !isPayer) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view this receipt",
      });
    }

    // Update viewed status
    if (isFarmer && !receipt.viewedByFarmer) {
      receipt.viewedByFarmer = true;
      receipt.viewedAt.farmer = new Date();
      await receipt.save();
    } else if (isPayer && !receipt.viewedByPayer) {
      receipt.viewedByPayer = true;
      receipt.viewedAt.payer = new Date();
      await receipt.save();
    }

    res.json({
      success: true,
      receipt,
      userRole: isFarmer ? "farmer" : "payer",
    });
  } catch (error) {
    console.error("Get receipt error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get receipt",
      error: error.message,
    });
  }
});

// Get receipt by receipt number
router.get("/number/:receiptNumber", authMiddleware, async (req, res) => {
  try {
    const { receiptNumber } = req.params;
    const userId = req.user._id;

    const receipt = await Receipt.findOne({ receiptNumber });

    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: "Receipt not found",
      });
    }

    // Check if user is part of the deal
    const isFarmer = receipt.farmer.userId.toString() === userId.toString();
    const isPayer = receipt.payer.userId.toString() === userId.toString();

    if (!isFarmer && !isPayer) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to view this receipt",
      });
    }

    res.json({
      success: true,
      receipt,
      userRole: isFarmer ? "farmer" : "payer",
    });
  } catch (error) {
    console.error("Get receipt by number error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get receipt",
      error: error.message,
    });
  }
});

// Get all receipts for current user
router.get("/my-receipts", authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20 } = req.query;

    const receipts = await Receipt.find({
      $or: [{ "farmer.userId": userId }, { "payer.userId": userId }],
    })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Receipt.countDocuments({
      $or: [{ "farmer.userId": userId }, { "payer.userId": userId }],
    });

    res.json({
      success: true,
      receipts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get my receipts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get receipts",
      error: error.message,
    });
  }
});

// Mark receipt as downloaded
router.patch("/downloaded/:receiptId", authMiddleware, async (req, res) => {
  try {
    const { receiptId } = req.params;

    const receipt = await Receipt.findByIdAndUpdate(
      receiptId,
      { status: "downloaded" },
      { new: true }
    );

    if (!receipt) {
      return res.status(404).json({
        success: false,
        message: "Receipt not found",
      });
    }

    res.json({
      success: true,
      message: "Receipt marked as downloaded",
      receipt,
    });
  } catch (error) {
    console.error("Mark downloaded error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update receipt",
      error: error.message,
    });
  }
});

export { router };
