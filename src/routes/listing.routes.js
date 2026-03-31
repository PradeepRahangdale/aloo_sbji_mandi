import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { Listing } from '../models/listing.model.js';
import { deleteCloudinaryImage, uploadMultipleImages } from '../utils/uploadToCloudinary.js';

const router = express.Router();

// ── Backfill helper: assign ALM-XXXXX to listings that don't have one ──
async function backfillReferenceIds(listings) {
  const needBackfill = listings.filter((l) => !l.referenceId);
  if (needBackfill.length === 0) return listings;

  for (const listing of needBackfill) {
    try {
      const doc = await Listing.findById(listing._id);
      if (doc && !doc.referenceId) {
        await doc.save(); // pre-save hook generates referenceId
        listing.referenceId = doc.referenceId;
      }
    } catch (e) {
      console.error(`Backfill referenceId failed for ${listing._id}:`, e.message);
    }
  }
  return listings;
}

// Get all listings with filters
router.get('/', async (req, res) => {
  try {
    const {
      type,
      variety,
      state,
      district,
      minPrice,
      maxPrice,
      qualityGrade,
      limit = 20,
      page = 1,
    } = req.query;

    // Only show active listings that haven't expired
    const query = {
      isActive: true,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } },
      ],
    };

    if (type) query.type = type;
    if (variety) query.potatoVariety = { $regex: variety, $options: 'i' };
    if (state) query['location.state'] = state;
    if (district) query['location.district'] = district;
    if (qualityGrade) query.qualityGrade = qualityGrade;
    if (minPrice) query.pricePerQuintal = { $gte: parseInt(minPrice) };
    if (maxPrice) query.pricePerQuintal = { ...query.pricePerQuintal, $lte: parseInt(maxPrice) };

    const listings = await Listing.find(query)
      .populate('seller', 'firstName lastName phone role address rating totalRatings')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    await backfillReferenceIds(listings);

    const total = await Listing.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        listings,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get sell listings only
router.get('/sell', async (req, res) => {
  try {
    const {
      limit = 20,
      page = 1,
      sellerRole,
      excludeDistrict,
      excludeSeller,
      listingType,
      variety,
      size,
      quality,
      sourceType,
      minPrice,
      maxPrice,
      state,
      district,
      sortBy, // 'price_low', 'price_high', 'newest', 'oldest'
    } = req.query;

    // Only show active listings that haven't expired
    const query = {
      type: 'sell',
      isActive: true,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } },
      ],
    };

    // Filter by listing type (seed or crop)
    if (listingType) {
      query.listingType = listingType;
    }

    // Exclude listings from a specific district (for Vyapari - they shouldn't see listings from their own city)
    if (excludeDistrict) {
      // Case-insensitive district exclusion using regex
      query['location.district'] = {
        $not: { $regex: new RegExp(`^${excludeDistrict.trim()}$`, 'i') },
      };
    }

    // Exclude listings from a specific seller (so users don't see their own listings)
    if (excludeSeller) {
      query.seller = { $ne: excludeSeller };
    }

    // Filter by variety (case-insensitive partial match)
    if (variety) {
      query.potatoVariety = { $regex: variety, $options: 'i' };
    }

    // Filter by size
    if (size) {
      query.size = size;
    }

    // Filter by quality
    if (quality) {
      query.quality = quality;
    }

    // Filter by source type
    if (sourceType) {
      query.sourceType = sourceType;
    }

    // Filter by price range
    if (minPrice || maxPrice) {
      query.pricePerQuintal = {};
      if (minPrice) query.pricePerQuintal.$gte = parseInt(minPrice);
      if (maxPrice) query.pricePerQuintal.$lte = parseInt(maxPrice);
    }

    // Filter by state
    if (state) {
      query['location.state'] = { $regex: state, $options: 'i' };
    }

    // Filter by district
    if (district) {
      // If excludeDistrict is also set, we need to handle both
      if (!excludeDistrict) {
        query['location.district'] = { $regex: district, $options: 'i' };
      }
    }

    // Sort order
    let sortOrder = { createdAt: -1 }; // default: newest first
    if (sortBy === 'price_low') sortOrder = { pricePerQuintal: 1 };
    else if (sortBy === 'price_high') sortOrder = { pricePerQuintal: -1 };
    else if (sortBy === 'oldest') sortOrder = { createdAt: 1 };

    let listings = await Listing.find(query)
      .populate('seller', 'firstName lastName phone role address rating totalRatings')
      .sort(sortOrder)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Filter by seller role if specified
    if (sellerRole) {
      listings = listings.filter((listing) => listing.seller && listing.seller.role === sellerRole);
    }

    await backfillReferenceIds(listings);

    const total = await Listing.countDocuments(query);

    res.status(200).json({
      success: true,
      data: { listings, total },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get buy listings only
router.get('/buy', async (req, res) => {
  try {
    const {
      limit = 20,
      page = 1,
      variety,
      size,
      quality,
      sourceType,
      minPrice,
      maxPrice,
      state,
      district,
      sortBy,
    } = req.query;

    // Only show active listings that haven't expired
    const query = {
      type: 'buy',
      isActive: true,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } },
      ],
    };

    if (variety) query.potatoVariety = { $regex: variety, $options: 'i' };
    if (size) query.size = size;
    if (quality) query.quality = quality;
    if (sourceType) query.sourceType = sourceType;
    if (state) query['location.state'] = { $regex: state, $options: 'i' };
    if (district) query['location.district'] = { $regex: district, $options: 'i' };
    if (minPrice || maxPrice) {
      query.pricePerQuintal = {};
      if (minPrice) query.pricePerQuintal.$gte = parseInt(minPrice);
      if (maxPrice) query.pricePerQuintal.$lte = parseInt(maxPrice);
    }

    let sortOrder = { createdAt: -1 };
    if (sortBy === 'price_low') sortOrder = { pricePerQuintal: 1 };
    else if (sortBy === 'price_high') sortOrder = { pricePerQuintal: -1 };
    else if (sortBy === 'oldest') sortOrder = { createdAt: 1 };

    const listings = await Listing.find(query)
      .populate('seller', 'firstName lastName phone role address rating totalRatings')
      .sort(sortOrder)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    await backfillReferenceIds(listings);

    const total = await Listing.countDocuments(query);

    res.status(200).json({
      success: true,
      data: { listings, total },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get single listing
router.get('/:id', async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id).populate(
      'seller',
      'firstName lastName phone role address rating totalRatings'
    );

    if (!listing) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    // Backfill referenceId if missing
    if (!listing.referenceId) {
      await listing.save();
    }

    res.status(200).json({ success: true, data: { listing } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get my listings (protected) — excludes expired listings and auto-deletes them
router.get('/user/my', authMiddleware, async (req, res) => {
  try {
    // Delete expired listings for this user
    await Listing.deleteMany({
      seller: req.user._id,
      expiresAt: { $exists: true, $ne: null, $lte: new Date() },
    });

    const listings = await Listing.find({ seller: req.user._id }).sort({ createdAt: -1 });

    await backfillReferenceIds(listings);

    res.status(200).json({
      success: true,
      data: { listings },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create listing (protected)
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const {
      type,
      potatoVariety,
      quantity,
      pricePerQuintal,
      description,
      images,
      location,
      qualityGrade,
      sourceType, // 'field' or 'cold_storage'
      listingType, // 'seed' or 'crop'
      packetWeight,
      unit,
      coldStorageId, // ObjectId of selected cold storage
      coldStorageName, // Name of cold storage (or custom name)
      captureLocation, // GPS location from photo capture {address, latitude, longitude}
    } = req.body;

    // Set expiry based on source type: field = 48 hours, cold_storage = 60 days
    const expiryMs =
      sourceType === 'field'
        ? 48 * 60 * 60 * 1000 // 48 hours
        : 60 * 24 * 60 * 60 * 1000; // 60 days
    const expiresAt = new Date(Date.now() + expiryMs);

    // Upload base64 images to Cloudinary
    let imageUrls = [];
    if (images && images.length > 0) {
      try {
        imageUrls = await uploadMultipleImages(images, 'listings');
      } catch (uploadErr) {
        console.error('Image upload failed:', uploadErr.message);
        // Continue without images if upload fails
      }
    }

    const listing = await Listing.create({
      seller: req.user._id,
      type,
      potatoVariety,
      quantity,
      pricePerQuintal,
      description,
      images: imageUrls,
      location: location || req.user.address,
      qualityGrade: qualityGrade || 'A',
      sourceType: sourceType || 'cold_storage',
      listingType: listingType || 'crop',
      packetWeight: unit === 'Packet' ? packetWeight || null : null,
      unit: unit || 'Packet',
      coldStorage: sourceType === 'cold_storage' && coldStorageId ? coldStorageId : null,
      coldStorageName: sourceType === 'cold_storage' && coldStorageName ? coldStorageName : null,
      captureLocation: captureLocation || null,
      expiresAt: expiresAt,
    });

    const populatedListing = await Listing.findById(listing._id).populate(
      'seller',
      'firstName lastName phone'
    );

    res.status(201).json({
      success: true,
      message: 'Listing created successfully',
      data: { listing: populatedListing },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update listing (protected)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const updates = req.body;

    // If images are being updated, upload new ones to Cloudinary
    if (updates.images && updates.images.length > 0) {
      try {
        // Delete old images from Cloudinary
        if (listing.images && listing.images.length > 0) {
          for (const oldUrl of listing.images) {
            if (oldUrl.includes('cloudinary')) {
              await deleteCloudinaryImage(oldUrl);
            }
          }
        }
        // Upload new images
        updates.images = await uploadMultipleImages(updates.images, 'listings');
      } catch (uploadErr) {
        console.error('Image upload failed on update:', uploadErr.message);
        delete updates.images; // Don't update images if upload fails
      }
    }

    Object.keys(updates).forEach((key) => {
      listing[key] = updates[key];
    });

    await listing.save();

    res.status(200).json({
      success: true,
      message: 'Listing updated',
      data: { listing },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Toggle listing active status (protected)
router.patch('/:id/toggle', authMiddleware, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    listing.isActive = !listing.isActive;
    await listing.save();

    res.status(200).json({
      success: true,
      message: `Listing ${listing.isActive ? 'activated' : 'deactivated'}`,
      data: { listing },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete listing (protected)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);

    if (!listing) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }

    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // Delete images from Cloudinary
    if (listing.images && listing.images.length > 0) {
      for (const imgUrl of listing.images) {
        if (imgUrl.includes('cloudinary')) {
          await deleteCloudinaryImage(imgUrl);
        }
      }
    }

    await listing.deleteOne();

    res.status(200).json({ success: true, message: 'Listing deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Cleanup: delete all expired listings globally (can be called by a cron/scheduler)
router.delete('/cleanup/expired', async (req, res) => {
  try {
    const result = await Listing.deleteMany({
      expiresAt: { $exists: true, $ne: null, $lte: new Date() },
    });
    res.status(200).json({
      success: true,
      message: `Deleted ${result.deletedCount} expired listings`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
