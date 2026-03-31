import { Advertisement } from '../models/advertisement.model.js';
import {
  AppSettings,
  DEFAULT_DURATION_OPTIONS,
  DEFAULT_SLIDE_PRICING,
} from '../models/appSettings.model.js';
import { User } from '../models/user.model.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';

// Lazy Razorpay instance (reuses env keys)
let razorpayInstance = null;
const getRazorpay = () => {
  if (!razorpayInstance) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error('Razorpay keys not configured');
    }
    razorpayInstance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayInstance;
};

// Create advertisement request (for cold storage owners, traders, etc.)
const createAdvertisementRequest = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const {
    title,
    description,
    imageUrl,
    images,
    redirectUrl,
    redirectUrls,
    advertiserType,
    coldStorageId,
    durationDays,
    contactPhone,
    contactEmail,
  } = req.body;

  // Accept either images array or legacy imageUrl
  const slideImages = images && images.length > 0 ? images : imageUrl ? [imageUrl] : [];

  if (!title || slideImages.length === 0) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, 'Title and at least one image are required'));
  }

  if (slideImages.length > 5) {
    return res.status(400).json(new ApiResponse(400, null, 'Maximum 5 slide images allowed'));
  }

  // Calculate price based on duration (example: ₹100 per day)
  const pricePerDay = 100;
  const price = (durationDays || 30) * pricePerDay;

  const advertisement = await Advertisement.create({
    advertiser: userId,
    title,
    description,
    imageUrl: slideImages[0] || '',
    images: slideImages,
    redirectUrl,
    redirectUrls: redirectUrls || [],
    advertiserType: advertiserType || 'cold-storage',
    coldStorage: coldStorageId || null,
    durationDays: durationDays || 30,
    price,
    contactPhone,
    contactEmail,
    status: 'pending',
    paymentStatus: 'unpaid',
  });

  return res
    .status(201)
    .json(new ApiResponse(201, { advertisement }, 'Advertisement request submitted successfully'));
});

// Get my advertisement requests
const getMyAdvertisements = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const advertisements = await Advertisement.find({ advertiser: userId })
    .populate('coldStorage', 'name address city')
    .sort({ createdAt: -1 });

  return res
    .status(200)
    .json(new ApiResponse(200, { advertisements }, 'Advertisements fetched successfully'));
});

// Get active advertisements for slider (public)
const getActiveAdvertisements = asyncHandler(async (req, res) => {
  const now = new Date();

  const advertisements = await Advertisement.find({
    status: 'active',
    startDate: { $lte: now },
    endDate: { $gte: now },
  })
    .populate('advertiser', 'firstName lastName')
    .populate('coldStorage', 'name address city')
    .select('-paymentId -adminNotes')
    .sort({ createdAt: -1 });

  return res
    .status(200)
    .json(new ApiResponse(200, { advertisements }, 'Active advertisements fetched'));
});

// Track ad view
const trackAdView = asyncHandler(async (req, res) => {
  const { id } = req.params;

  await Advertisement.findByIdAndUpdate(id, { $inc: { viewCount: 1 } });

  return res.status(200).json(new ApiResponse(200, null, 'View tracked'));
});

// Track ad click
const trackAdClick = asyncHandler(async (req, res) => {
  const { id } = req.params;

  await Advertisement.findByIdAndUpdate(id, { $inc: { clickCount: 1 } });

  return res.status(200).json(new ApiResponse(200, null, 'Click tracked'));
});

// ============ ADMIN FUNCTIONS ============

// Get all advertisement requests (Admin only)
const getAllAdvertisements = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (status) filter.status = status;

  const advertisements = await Advertisement.find(filter)
    .populate('advertiser', 'firstName lastName phone email role')
    .populate('coldStorage', 'name address city')
    .populate('approvedBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Advertisement.countDocuments(filter);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        advertisements,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / limit),
        },
      },
      'Advertisements fetched successfully'
    )
  );
});

// Get pending advertisement requests (Admin only)
const getPendingAdvertisements = asyncHandler(async (req, res) => {
  const advertisements = await Advertisement.find({ status: 'pending' })
    .populate('advertiser', 'firstName lastName phone email role')
    .populate('coldStorage', 'name address city')
    .sort({ createdAt: -1 });

  return res
    .status(200)
    .json(new ApiResponse(200, { advertisements }, 'Pending advertisements fetched'));
});

// Approve advertisement (Admin only)
const approveAdvertisement = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user._id;
  const { adminNotes, price } = req.body;

  const advertisement = await Advertisement.findById(id);
  if (!advertisement) {
    return res.status(404).json(new ApiResponse(404, null, 'Advertisement not found'));
  }

  if (advertisement.status !== 'pending') {
    return res
      .status(400)
      .json(new ApiResponse(400, null, 'Only pending advertisements can be approved'));
  }

  advertisement.status = 'approved';
  advertisement.approvedBy = adminId;
  advertisement.approvedAt = new Date();
  if (adminNotes) advertisement.adminNotes = adminNotes;
  if (price) advertisement.price = price;

  await advertisement.save();

  // TODO: Send notification to advertiser about approval

  return res
    .status(200)
    .json(new ApiResponse(200, { advertisement }, 'Advertisement approved successfully'));
});

// Reject advertisement (Admin only)
const rejectAdvertisement = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rejectionReason, adminNotes } = req.body;

  const advertisement = await Advertisement.findById(id);
  if (!advertisement) {
    return res.status(404).json(new ApiResponse(404, null, 'Advertisement not found'));
  }

  if (advertisement.status !== 'pending') {
    return res
      .status(400)
      .json(new ApiResponse(400, null, 'Only pending advertisements can be rejected'));
  }

  advertisement.status = 'rejected';
  advertisement.rejectionReason = rejectionReason || 'Request rejected by admin';
  if (adminNotes) advertisement.adminNotes = adminNotes;

  await advertisement.save();

  // TODO: Send notification to advertiser about rejection

  return res.status(200).json(new ApiResponse(200, { advertisement }, 'Advertisement rejected'));
});

// Mark payment as completed and activate ad (Admin only)
const confirmPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { paymentId, paymentMethod } = req.body;

  const advertisement = await Advertisement.findById(id);
  if (!advertisement) {
    return res.status(404).json(new ApiResponse(404, null, 'Advertisement not found'));
  }

  if (advertisement.status !== 'approved' && advertisement.status !== 'paid') {
    return res
      .status(400)
      .json(new ApiResponse(400, null, 'Advertisement must be approved before payment'));
  }

  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + advertisement.durationDays);

  advertisement.status = 'active';
  advertisement.paymentStatus = 'completed';
  advertisement.paymentId = paymentId || `PAY_${Date.now()}`;
  advertisement.paymentMethod = paymentMethod || 'manual';
  advertisement.startDate = startDate;
  advertisement.endDate = endDate;

  await advertisement.save();

  return res
    .status(200)
    .json(new ApiResponse(200, { advertisement }, 'Payment confirmed and advertisement activated'));
});

// Get advertisement stats (Admin only)
const getAdvertisementStats = asyncHandler(async (req, res) => {
  const stats = await Advertisement.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalRevenue: {
          $sum: {
            $cond: [{ $eq: ['$paymentStatus', 'completed'] }, '$price', 0],
          },
        },
      },
    },
  ]);

  const totalViews = await Advertisement.aggregate([
    { $group: { _id: null, views: { $sum: '$viewCount' }, clicks: { $sum: '$clickCount' } } },
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        statusStats: stats,
        engagement: totalViews[0] || { views: 0, clicks: 0 },
      },
      'Stats fetched'
    )
  );
});

// Get all users (Admin only)
const getAllUsers = asyncHandler(async (req, res) => {
  const { role, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (role) filter.role = role;

  const users = await User.find(filter)
    .select('-password -refreshToken')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await User.countDocuments(filter);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        users,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / limit),
        },
      },
      'Users fetched successfully'
    )
  );
});

// Get dashboard stats (Admin only)
const getDashboardStats = asyncHandler(async (req, res) => {
  const userStats = await User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]);

  const totalUsers = await User.countDocuments();
  const pendingAds = await Advertisement.countDocuments({ status: 'pending' });
  const activeAds = await Advertisement.countDocuments({ status: 'active' });

  const revenueResult = await Advertisement.aggregate([
    { $match: { paymentStatus: 'completed' } },
    { $group: { _id: null, total: { $sum: '$price' } } },
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        totalUsers,
        usersByRole: userStats,
        pendingAds,
        activeAds,
        totalRevenue: revenueResult[0]?.total || 0,
      },
      'Dashboard stats fetched'
    )
  );
});

// Admin: Create and activate banner directly (Admin only)
const adminCreateBanner = asyncHandler(async (req, res) => {
  const { title, imageUrl, images, description, durationDays = 30 } = req.body;
  const adminId = req.user._id;

  const slideImages = images && images.length > 0 ? images : imageUrl ? [imageUrl] : [];

  if (!title || slideImages.length === 0) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, 'Title and at least one image are required'));
  }

  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + durationDays);

  const advertisement = await Advertisement.create({
    advertiser: adminId,
    title,
    description: description || '',
    imageUrl: slideImages[0] || '',
    images: slideImages,
    advertiserType: 'aloo-mitra',
    durationDays,
    price: 0, // Admin banners are free
    status: 'active',
    paymentStatus: 'completed',
    approvedBy: adminId,
    approvedAt: new Date(),
    startDate,
    endDate,
  });

  return res
    .status(201)
    .json(new ApiResponse(201, { advertisement }, 'Banner created and activated successfully'));
});

// ──────────────────────────────────────────────
// GET AD PRICING (Public)
// GET /api/v1/advertisements/pricing
// ──────────────────────────────────────────────
const getAdPricing = asyncHandler(async (req, res) => {
  // Try to fetch from DB, fall back to defaults
  const slidePricingSetting = await AppSettings.findOne({ key: 'ad_slide_pricing' });
  const durationSetting = await AppSettings.findOne({ key: 'ad_duration_options' });

  const slidePricing = slidePricingSetting?.value || DEFAULT_SLIDE_PRICING;
  const durationOptions = durationSetting?.value || DEFAULT_DURATION_OPTIONS;

  return res
    .status(200)
    .json(new ApiResponse(200, { slidePricing, durationOptions }, 'Ad pricing fetched'));
});

// ──────────────────────────────────────────────
// UPDATE AD PRICING (Admin only)
// PUT /api/v1/advertisements/admin/pricing
// Body: { slidePricing: [...], durationOptions: [...] }
// ──────────────────────────────────────────────
const updateAdPricing = asyncHandler(async (req, res) => {
  const { slidePricing, durationOptions } = req.body;
  const adminId = req.user._id;

  if (slidePricing) {
    // Validate slide pricing
    if (!Array.isArray(slidePricing) || slidePricing.length < 1 || slidePricing.length > 5) {
      return res
        .status(400)
        .json(new ApiResponse(400, null, 'slidePricing must be an array of 1-5 items'));
    }
    for (const item of slidePricing) {
      if (typeof item.price !== 'number' || item.price < 0) {
        return res
          .status(400)
          .json(new ApiResponse(400, null, 'Each slide must have a valid price >= 0'));
      }
    }
    await AppSettings.findOneAndUpdate(
      { key: 'ad_slide_pricing' },
      { value: slidePricing, updatedBy: adminId },
      { upsert: true, new: true }
    );
  }

  if (durationOptions) {
    // Validate duration options
    if (!Array.isArray(durationOptions) || durationOptions.length < 1) {
      return res
        .status(400)
        .json(new ApiResponse(400, null, 'durationOptions must be a non-empty array'));
    }
    for (const item of durationOptions) {
      if (
        typeof item.days !== 'number' ||
        item.days < 1 ||
        typeof item.multiplier !== 'number' ||
        item.multiplier < 1
      ) {
        return res
          .status(400)
          .json(
            new ApiResponse(
              400,
              null,
              'Each duration must have valid days >= 1 and multiplier >= 1'
            )
          );
      }
    }
    await AppSettings.findOneAndUpdate(
      { key: 'ad_duration_options' },
      { value: durationOptions, updatedBy: adminId },
      { upsert: true, new: true }
    );
  }

  // Fetch updated values
  const updatedSlide = await AppSettings.findOne({ key: 'ad_slide_pricing' });
  const updatedDuration = await AppSettings.findOne({ key: 'ad_duration_options' });

  console.log(`[AD] Pricing updated by admin ${adminId}`);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        slidePricing: updatedSlide?.value || DEFAULT_SLIDE_PRICING,
        durationOptions: updatedDuration?.value || DEFAULT_DURATION_OPTIONS,
      },
      'Ad pricing updated successfully'
    )
  );
});

// ──────────────────────────────────────────────
// ADMIN: Edit advertisement
// PUT /api/v1/advertisements/admin/:id/edit
// ──────────────────────────────────────────────
const adminEditAdvertisement = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, description, images, imageUrl, durationDays, price, status, redirectUrl } =
    req.body;

  const advertisement = await Advertisement.findById(id);
  if (!advertisement) {
    return res.status(404).json(new ApiResponse(404, null, 'Advertisement not found'));
  }

  // Update fields if provided
  if (title !== undefined) advertisement.title = title;
  if (description !== undefined) advertisement.description = description;
  if (redirectUrl !== undefined) advertisement.redirectUrl = redirectUrl;
  if (durationDays !== undefined) advertisement.durationDays = durationDays;
  if (price !== undefined) advertisement.price = price;

  // Update images
  if (images && images.length > 0) {
    if (images.length > 5) {
      return res.status(400).json(new ApiResponse(400, null, 'Maximum 5 slide images allowed'));
    }
    advertisement.images = images;
    advertisement.imageUrl = images[0] || '';
  } else if (imageUrl !== undefined) {
    advertisement.imageUrl = imageUrl;
  }

  // Update status if provided (admin can change status)
  if (status !== undefined) {
    advertisement.status = status;
    // If activating, set start/end dates
    if (status === 'active' && !advertisement.startDate) {
      advertisement.startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + (advertisement.durationDays || 30));
      advertisement.endDate = endDate;
    }
  }

  // Recalculate endDate if duration changed on active ad
  if (durationDays !== undefined && advertisement.status === 'active' && advertisement.startDate) {
    const endDate = new Date(advertisement.startDate);
    endDate.setDate(endDate.getDate() + durationDays);
    advertisement.endDate = endDate;
  }

  await advertisement.save();

  const updated = await Advertisement.findById(id)
    .populate('advertiser', 'firstName lastName phone email role')
    .populate('coldStorage', 'name address city');

  console.log(`[AD] Advertisement ${id} edited by admin ${req.user._id}`);

  return res
    .status(200)
    .json(new ApiResponse(200, { advertisement: updated }, 'Advertisement updated successfully'));
});

// ──────────────────────────────────────────────
// ADMIN: Delete advertisement
// DELETE /api/v1/advertisements/admin/:id
// ──────────────────────────────────────────────
const adminDeleteAdvertisement = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const advertisement = await Advertisement.findById(id);
  if (!advertisement) {
    return res.status(404).json(new ApiResponse(404, null, 'Advertisement not found'));
  }

  await Advertisement.findByIdAndDelete(id);

  console.log(
    `[AD] Advertisement ${id} ("${advertisement.title}") deleted by admin ${req.user._id}`
  );

  return res.status(200).json(new ApiResponse(200, null, 'Advertisement deleted successfully'));
});

// ──────────────────────────────────────────────
// POST /pay/create-order  (Authenticated user)
// Creates a Razorpay order for an approved ad
// ──────────────────────────────────────────────
const createAdPaymentOrder = asyncHandler(async (req, res) => {
  const { advertisementId } = req.body;
  const userId = req.user._id;

  if (!advertisementId) {
    return res.status(400).json(new ApiResponse(400, null, 'advertisementId is required'));
  }

  const ad = await Advertisement.findById(advertisementId);
  if (!ad) {
    return res.status(404).json(new ApiResponse(404, null, 'Advertisement not found'));
  }

  // Only the owner can pay
  if (ad.advertiser.toString() !== userId.toString()) {
    return res.status(403).json(new ApiResponse(403, null, 'You can only pay for your own advertisements'));
  }

  // Must be approved
  if (ad.status !== 'approved') {
    return res.status(400).json(new ApiResponse(400, null, 'Advertisement must be approved before payment'));
  }

  const amount = Math.round(ad.price * 100); // paise
  const receiptId = `ad_${userId.toString().slice(-6)}_${Date.now().toString(36)}`;

  const options = {
    amount,
    currency: 'INR',
    receipt: receiptId,
    notes: {
      advertisementId: ad._id.toString(),
      userId: userId.toString(),
      title: ad.title,
    },
  };

  try {
    const rp = getRazorpay();
    const order = await rp.orders.create(options);

    // Mark payment as pending
    ad.paymentStatus = 'pending';
    ad.paymentOrderId = order.id;
    await ad.save();

    console.log(`[AD-PAY] Order ${order.id} created for ad ${ad._id} by user ${userId}`);

    return res.status(200).json(
      new ApiResponse(200, {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        advertisementId: ad._id,
        keyId: process.env.RAZORPAY_KEY_ID,
        title: ad.title,
        price: ad.price,
      }, 'Payment order created')
    );
  } catch (error) {
    console.error('[AD-PAY] Order creation error:', error?.message || error);
    razorpayInstance = null;
    return res.status(500).json(new ApiResponse(500, null, 'Failed to create payment order'));
  }
});

// ──────────────────────────────────────────────
// POST /pay/verify  (Authenticated user)
// Verifies Razorpay signature and activates the ad
// ──────────────────────────────────────────────
const verifyAdPayment = asyncHandler(async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    advertisementId,
  } = req.body;
  const userId = req.user._id;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json(new ApiResponse(400, null, 'Missing payment verification fields'));
  }

  // HMAC-SHA256 signature check
  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSig = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  if (razorpay_signature !== expectedSig) {
    return res.status(400).json(new ApiResponse(400, null, 'Invalid payment signature'));
  }

  const ad = await Advertisement.findById(advertisementId);
  if (!ad) {
    return res.status(404).json(new ApiResponse(404, null, 'Advertisement not found'));
  }

  if (ad.advertiser.toString() !== userId.toString()) {
    return res.status(403).json(new ApiResponse(403, null, 'Unauthorized'));
  }

  // Activate the ad
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + (ad.durationDays || 30));

  ad.status = 'active';
  ad.paymentStatus = 'completed';
  ad.paymentId = razorpay_payment_id;
  ad.paymentMethod = 'razorpay';
  ad.startDate = startDate;
  ad.endDate = endDate;
  await ad.save();

  console.log(`[AD-PAY] Payment verified for ad ${ad._id}. Active until ${endDate.toISOString()}`);

  return res.status(200).json(
    new ApiResponse(200, { advertisement: ad }, 'Payment verified. Advertisement is now active!')
  );
});

export {
  adminCreateBanner,
  adminDeleteAdvertisement,
  adminEditAdvertisement,
  approveAdvertisement,
  confirmPayment,
  createAdPaymentOrder,
  createAdvertisementRequest,
  getActiveAdvertisements,
  getAdPricing,
  getAdvertisementStats,
  getAllAdvertisements,
  getAllUsers,
  getDashboardStats,
  getMyAdvertisements,
  getPendingAdvertisements,
  rejectAdvertisement,
  trackAdClick,
  trackAdView,
  updateAdPricing,
  verifyAdPayment,
};
