import { ColdStorage } from '../models/coldStorage.model.js';
import { User } from '../models/user.model.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { uploadMultipleImages } from '../utils/uploadToCloudinary.js';

// Maximum cold storages allowed per owner
const MAX_COLD_STORAGES_PER_OWNER = 1;

// Create Cold Storage
const createColdStorage = asyncHandler(async (req, res) => {
  const { name, address, city, village, state, pincode, phone, email, capacity, pricePerTon, captureLocation, images } =
    req.body;

  // Validation - email is optional
  if (!name || !address || !city || !state || !pincode || !phone || !capacity || !pricePerTon) {
    throw new ApiError(400, 'All required fields must be filled');
  }

  // Check if owner has reached the limit
  const existingCount = await ColdStorage.countDocuments({ owner: req.user._id });
  if (existingCount >= MAX_COLD_STORAGES_PER_OWNER) {
    throw new ApiError(
      400,
      `You can only add up to ${MAX_COLD_STORAGES_PER_OWNER} cold storage. Please delete an existing one to add a new storage.`
    );
  }

  // Upload base64 images to Cloudinary
  let imageUrls = [];
  if (images && images.length > 0) {
    try {
      imageUrls = await uploadMultipleImages(images, 'cold_storages');
    } catch (uploadErr) {
      console.error('Cold storage image upload failed:', uploadErr.message);
      // Continue without images if upload fails
    }
  }

  // Create cold storage
  const coldStorage = await ColdStorage.create({
    owner: req.user._id, // From auth middleware
    name,
    address,
    city,
    village: village || null,
    state,
    pincode,
    phone,
    email: email || null,
    capacity,
    availableCapacity: capacity, // Initially same as capacity
    pricePerTon,
    captureLocation: captureLocation || null,
    images: imageUrls,
  });

  return res.status(201).json(new ApiResponse(201, { coldStorage }, 'Cold storage created successfully'));
});

// Get All Cold Storages (with filters)
const getAllColdStorages = asyncHandler(async (req, res) => {
  const { city, village, district, state, isAvailable, minCapacity, nearbySearch } = req.query;

  // Build filter
  const filter = {};

  // If nearbySearch is provided, do a flexible search in city/village fields
  if (nearbySearch) {
    // Search in city, village, or address fields using case-insensitive regex
    filter.$or = [
      { city: { $regex: nearbySearch, $options: 'i' } },
      { village: { $regex: nearbySearch, $options: 'i' } },
      { address: { $regex: nearbySearch, $options: 'i' } },
    ];
  } else {
    // Exact filters
    if (city) filter.city = { $regex: city, $options: 'i' };
    if (village) filter.village = { $regex: village, $options: 'i' };
    if (district) {
      // District search in city field (as city often represents district)
      filter.city = { $regex: district, $options: 'i' };
    }
  }

  if (state) filter.state = { $regex: state, $options: 'i' };
  if (isAvailable) filter.isAvailable = isAvailable === 'true';
  if (minCapacity) filter.availableCapacity = { $gte: Number(minCapacity) };

  const coldStorages = await ColdStorage.find(filter)
    .populate('owner', 'firstName lastName email phone')
    .sort({ createdAt: -1 });

  return res.json(
    new ApiResponse(
      200,
      { coldStorages, count: coldStorages.length },
      'Cold storages fetched successfully'
    )
  );
});

// Get Cold Storage by ID
const getColdStorageById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const coldStorage = await ColdStorage.findById(id).populate(
    'owner',
    'firstName lastName email phone'
  );

  if (!coldStorage) {
    throw new ApiError(404, 'Cold storage not found');
  }

  return res.json(new ApiResponse(200, { coldStorage }, 'Cold storage fetched successfully'));
});

// Get My Cold Storages (Owner)
const getMyColdStorages = asyncHandler(async (req, res) => {
  const coldStorages = await ColdStorage.find({ owner: req.user._id })
    .populate('manager', 'firstName lastName phone')
    .sort({ createdAt: -1 });

  return res.json(
    new ApiResponse(
      200,
      { coldStorages, count: coldStorages.length },
      'Your cold storages fetched successfully'
    )
  );
});

// Update Cold Storage
const updateColdStorage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = { ...req.body };

  // Find cold storage
  const coldStorage = await ColdStorage.findById(id);

  if (!coldStorage) {
    throw new ApiError(404, 'Cold storage not found');
  }

  // Check ownership
  if (coldStorage.owner.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'You are not authorized to update this cold storage');
  }

  // Upload base64 images to Cloudinary if provided
  if (updates.images && Array.isArray(updates.images) && updates.images.length > 0) {
    try {
      // Filter only new base64 images (existing URLs start with https://)
      const newBase64Images = updates.images.filter(img => !img.startsWith('http'));
      const existingUrls = updates.images.filter(img => img.startsWith('http'));

      let newUrls = [];
      if (newBase64Images.length > 0) {
        newUrls = await uploadMultipleImages(newBase64Images, 'cold_storages');
      }
      updates.images = [...existingUrls, ...newUrls];
    } catch (uploadErr) {
      console.error('Cold storage image upload failed:', uploadErr.message);
      delete updates.images; // Don't update images if upload fails
    }
  }

  // Update
  const updatedColdStorage = await ColdStorage.findByIdAndUpdate(
    id,
    { $set: updates },
    { new: true, runValidators: true }
  );

  return res.json(
    new ApiResponse(200, { coldStorage: updatedColdStorage }, 'Cold storage updated successfully')
  );
});

// Delete Cold Storage
const deleteColdStorage = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Find cold storage
  const coldStorage = await ColdStorage.findById(id);

  if (!coldStorage) {
    throw new ApiError(404, 'Cold storage not found');
  }

  // Check ownership
  if (coldStorage.owner.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'You are not authorized to delete this cold storage');
  }

  await ColdStorage.findByIdAndDelete(id);

  return res.json(new ApiResponse(200, {}, 'Cold storage deleted successfully'));
});

// Toggle Availability
const toggleAvailability = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const coldStorage = await ColdStorage.findById(id);

  if (!coldStorage) {
    throw new ApiError(404, 'Cold storage not found');
  }

  // Check ownership
  if (coldStorage.owner.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'You are not authorized to update this cold storage');
  }

  coldStorage.isAvailable = !coldStorage.isAvailable;
  await coldStorage.save();

  return res.json(
    new ApiResponse(
      200,
      { coldStorage },
      `Cold storage ${coldStorage.isAvailable ? 'activated' : 'deactivated'} successfully`
    )
  );
});

// Add Rating to Cold Storage
const addRating = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rating, review } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    throw new ApiError(400, 'Rating must be between 1 and 5');
  }

  const coldStorage = await ColdStorage.findById(id);

  if (!coldStorage) {
    throw new ApiError(404, 'Cold storage not found');
  }

  // Check if user has already rated
  const existingRating = coldStorage.ratings.find(
    (r) => r.user.toString() === req.user._id.toString()
  );

  if (existingRating) {
    // Update existing rating
    existingRating.rating = rating;
    existingRating.review = review || existingRating.review;
  } else {
    // Add new rating
    coldStorage.ratings.push({
      user: req.user._id,
      rating,
      review,
    });
  }

  // Calculate average rating
  coldStorage.calculateAverageRating();
  await coldStorage.save();

  return res.json(
    new ApiResponse(
      200,
      {
        coldStorage,
        averageRating: coldStorage.averageRating,
        totalRatings: coldStorage.totalRatings,
      },
      existingRating ? 'Rating updated successfully' : 'Rating added successfully'
    )
  );
});

// Get Ratings for Cold Storage
const getRatings = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const coldStorage = await ColdStorage.findById(id).populate('ratings.user', 'firstName lastName');

  if (!coldStorage) {
    throw new ApiError(404, 'Cold storage not found');
  }

  return res.json(
    new ApiResponse(
      200,
      {
        ratings: coldStorage.ratings,
        averageRating: coldStorage.averageRating,
        totalRatings: coldStorage.totalRatings,
      },
      'Ratings fetched successfully'
    )
  );
});

// ============================================
// MANAGER MANAGEMENT
// ============================================

// Assign Manager to Cold Storage
const assignManager = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { managerPhone } = req.body;

  if (!managerPhone) {
    throw new ApiError(400, 'Manager phone number is required');
  }

  // Find cold storage
  const coldStorage = await ColdStorage.findById(id);
  if (!coldStorage) {
    throw new ApiError(404, 'Cold storage not found');
  }

  // Check ownership - only owner can assign manager
  if (coldStorage.owner.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'Only the owner can assign a manager');
  }

  // Check if this cold storage already has a manager
  if (coldStorage.manager) {
    throw new ApiError(
      400,
      'This cold storage already has a manager. Remove the current manager first.'
    );
  }

  // Find or create user with this phone number
  let manager = await User.findOne({ phone: managerPhone });

  if (!manager) {
    // Auto-create user with manager role
    const bcrypt = await import('bcrypt');
    const hashedPassword = await bcrypt.default.hash('manager123', 8);

    manager = await User.create({
      firstName: 'Manager',
      lastName: coldStorage.name,
      phone: managerPhone,
      password: hashedPassword,
      role: 'cold-storage-manager',
      isPhoneVerified: true,
      managedColdStorage: coldStorage._id,
      managedBy: req.user._id,
    });
  } else {
    // Check if this user is already a manager of another cold storage
    if (manager.role === 'cold-storage-manager' && manager.managedColdStorage) {
      throw new ApiError(
        400,
        'This phone number is already assigned as a manager to another cold storage'
      );
    }

    // Update existing user to manager role
    manager.role = 'cold-storage-manager';
    manager.managedColdStorage = coldStorage._id;
    manager.managedBy = req.user._id;
    await manager.save();
  }

  // Update cold storage with manager info
  coldStorage.manager = manager._id;
  coldStorage.managerPhone = managerPhone;
  await coldStorage.save();

  const populatedStorage = await ColdStorage.findById(id).populate(
    'manager',
    'firstName lastName phone'
  );

  return res.json(
    new ApiResponse(
      200,
      {
        coldStorage: populatedStorage,
        manager: {
          _id: manager._id,
          firstName: manager.firstName,
          lastName: manager.lastName,
          phone: manager.phone,
        },
      },
      'Manager assigned successfully'
    )
  );
});

// Remove Manager from Cold Storage
const removeManager = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Find cold storage
  const coldStorage = await ColdStorage.findById(id);
  if (!coldStorage) {
    throw new ApiError(404, 'Cold storage not found');
  }

  // Check ownership - only owner can remove manager
  if (coldStorage.owner.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'Only the owner can remove a manager');
  }

  if (!coldStorage.manager) {
    throw new ApiError(400, 'No manager assigned to this cold storage');
  }

  // Reset manager's role back to farmer
  const manager = await User.findById(coldStorage.manager);
  if (manager) {
    manager.role = 'farmer';
    manager.managedColdStorage = null;
    manager.managedBy = null;
    await manager.save();
  }

  // Remove manager from cold storage
  coldStorage.manager = null;
  coldStorage.managerPhone = null;
  await coldStorage.save();

  return res.json(new ApiResponse(200, { coldStorage }, 'Manager removed successfully'));
});

// Get Cold Storage for Manager (manager's assigned cold storage)
const getManagerColdStorage = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // Find cold storage where this user is the manager
  const coldStorage = await ColdStorage.findOne({ manager: userId }).populate(
    'owner',
    'firstName lastName phone'
  );

  if (!coldStorage) {
    throw new ApiError(404, 'No cold storage assigned to you as manager');
  }

  return res.json(
    new ApiResponse(200, { coldStorage }, "Manager's cold storage fetched successfully")
  );
});

export {
  createColdStorage,
  getAllColdStorages,
  getColdStorageById,
  getMyColdStorages,
  updateColdStorage,
  deleteColdStorage,
  toggleAvailability,
  addRating,
  getRatings,
  assignManager,
  removeManager,
  getManagerColdStorage,
};
