import { User } from "../models/user.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

// Get Aloo Mitra Profile
export const getAlooMitraProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);
    
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const profileData = {
        serviceType: user.alooMitraProfile?.serviceType || null,
        businessName: user.alooMitraProfile?.businessName || "",
        pricing: user.alooMitraProfile?.pricing || "",
        description: user.alooMitraProfile?.description || "",
        isVerified: user.alooMitraProfile?.isVerified || false,
        rating: user.alooMitraProfile?.rating || 0,
        state: user.address?.state || "",
        district: user.address?.district || "",
        city: user.address?.village || "",
        // Majdoor-specific fields
        majdoorMobile: user.alooMitraProfile?.majdoorMobile || "",
        kaamType: user.alooMitraProfile?.kaamType || null,
        kaamJagah: user.alooMitraProfile?.kaamJagah || null,
        availability: user.alooMitraProfile?.availability || null,
        aadhaarImageUrl: user.alooMitraProfile?.aadhaarImageUrl || "",
        // Business photos
        businessPhotos: user.alooMitraProfile?.businessPhotos || [],
    };

    return res.status(200).json(
        new ApiResponse(200, profileData, "Profile fetched successfully")
    );
});

// Update Aloo Mitra Profile
export const updateAlooMitraProfile = asyncHandler(async (req, res) => {
    const { 
        serviceType, 
        businessName, 
        businessAddress, 
        businessLocation, 
        pincode, 
        state, 
        district, 
        city, 
        pricing, 
        description,
        // Majdoor-specific fields
        majdoorMobile,
        kaamType,
        kaamJagah,
        availability,
        // Gunny Bag-specific fields
        gunnyBagBusinessName,
        gunnyBagOwnerName,
        // Machinery-specific fields
        machineryBusinessName,
        machineType,
        machineryServiceType,
        rentType,
        salePriceMin,
        salePriceMax,
        rentPriceMin,
        rentPriceMax,
        // Business photos
        businessPhotos
    } = req.body;

    const user = await User.findById(req.user._id);
    
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // Get existing profile as plain object to avoid Mongoose subdocument spread issues
    const existingProfile = user.alooMitraProfile ? user.alooMitraProfile.toObject() : {};

    // Update aloo mitra profile
    user.alooMitraProfile = {
        ...existingProfile,
        serviceType: serviceType || existingProfile.serviceType,
        businessName: businessName || existingProfile.businessName,
        businessAddress: businessAddress || existingProfile.businessAddress,
        businessLocation: businessLocation || existingProfile.businessLocation,
        businessPincode: pincode || existingProfile.businessPincode,
        pricing: pricing || existingProfile.pricing,
        description: description || existingProfile.description,
        // Majdoor-specific fields
        majdoorMobile: majdoorMobile || existingProfile.majdoorMobile,
        kaamType: kaamType || existingProfile.kaamType,
        kaamJagah: kaamJagah || existingProfile.kaamJagah,
        availability: availability || existingProfile.availability,
        // Gunny Bag-specific fields
        gunnyBagBusinessName: gunnyBagBusinessName || existingProfile.gunnyBagBusinessName,
        gunnyBagOwnerName: gunnyBagOwnerName || existingProfile.gunnyBagOwnerName,
        // Machinery-specific fields
        machineryBusinessName: machineryBusinessName || existingProfile.machineryBusinessName,
        machineType: machineType || existingProfile.machineType,
        machineryServiceType: machineryServiceType || existingProfile.machineryServiceType,
        rentType: rentType || existingProfile.rentType,
        salePriceMin: salePriceMin ?? existingProfile.salePriceMin,
        salePriceMax: salePriceMax ?? existingProfile.salePriceMax,
        rentPriceMin: rentPriceMin ?? existingProfile.rentPriceMin,
        rentPriceMax: rentPriceMax ?? existingProfile.rentPriceMax,
        // Business photos (array of base64 strings)
        businessPhotos: businessPhotos || existingProfile.businessPhotos || [],
    };

    // Update address
    user.address = {
        ...user.address,
        state: state || user.address?.state,
        district: district || user.address?.district,
        village: city || user.address?.village,
    };

    // Mark nested fields as modified so Mongoose detects changes
    user.markModified('alooMitraProfile');
    user.markModified('address');

    await user.save();

    return res.status(200).json(
        new ApiResponse(200, { user }, "Profile updated successfully")
    );
});

// Get Aloo Mitra Statistics
export const getAlooMitraStats = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);
    
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // For now, return default stats. These can be calculated from actual data later
    const stats = {
        totalEnquiries: 0,
        activeListings: 1,
        completedDeals: 0,
        rating: user.alooMitraProfile?.rating || 0,
    };

    return res.status(200).json(
        new ApiResponse(200, stats, "Stats fetched successfully")
    );
});

// Get List of Service Providers
export const getServiceProviders = asyncHandler(async (req, res) => {
    const { serviceType, state, district, page = 1, limit = 20 } = req.query;
    
    const query = { role: "aloo-mitra" };
    
    if (serviceType) {
        query["alooMitraProfile.serviceType"] = serviceType;
    }
    if (state) {
        query["address.state"] = state;
    }
    if (district) {
        query["address.district"] = district;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const providers = await User.find(query)
        .select("firstName lastName phone alooMitraProfile address")
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

    const total = await User.countDocuments(query);

    const formattedProviders = providers.map(p => ({
        _id: p._id,
        name: `${p.firstName} ${p.lastName}`,
        phone: p.phone,
        serviceType: p.alooMitraProfile?.serviceType,
        businessName: p.alooMitraProfile?.businessName,
        pricing: p.alooMitraProfile?.pricing,
        rating: p.alooMitraProfile?.rating || 0,
        location: {
            state: p.address?.state,
            district: p.address?.district,
            city: p.address?.village,
        },
        isVerified: p.alooMitraProfile?.isVerified || false,
    }));

    return res.status(200).json(
        new ApiResponse(200, {
            providers: formattedProviders,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            }
        }, "Providers fetched successfully")
    );
});

// Send Enquiry to Service Provider
export const sendEnquiry = asyncHandler(async (req, res) => {
    const { providerId, message, quantity } = req.body;

    if (!providerId || !message) {
        throw new ApiError(400, "Provider ID and message are required");
    }

    const provider = await User.findById(providerId);
    if (!provider || provider.role !== "aloo-mitra") {
        throw new ApiError(404, "Service provider not found");
    }

    // For now, just acknowledge the enquiry
    // In the future, you can save this to an Enquiry model
    const enquiryData = {
        from: req.user._id,
        to: providerId,
        message,
        quantity,
        createdAt: new Date(),
    };

    return res.status(201).json(
        new ApiResponse(201, enquiryData, "Enquiry sent successfully")
    );
});

// Get Received Enquiries (for service providers)
export const getReceivedEnquiries = asyncHandler(async (req, res) => {
    // Placeholder - return empty array for now
    // In the future, fetch from Enquiry model
    
    return res.status(200).json(
        new ApiResponse(200, { enquiries: [], total: 0 }, "Enquiries fetched successfully")
    );
});
