import { ColdStorage } from '../models/coldStorage.model.js';
import { Booking } from '../models/booking.model.js';
import { User } from '../models/user.model.js';
import { Notification } from '../models/notification.model.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';

// ============================================
// HELPER: Get manager's assigned cold storage
// ============================================
const getManagerStorage = async (userId) => {
  const coldStorage = await ColdStorage.findOne({ manager: userId });
  if (!coldStorage) {
    throw new ApiError(404, 'No cold storage assigned to you as manager');
  }
  return coldStorage;
};

// ============================================
// DASHBOARD - Manager's overview with stats
// ============================================
const getManagerDashboard = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const coldStorage = await ColdStorage.findOne({ manager: userId }).populate(
    'owner',
    'firstName lastName phone'
  );

  if (!coldStorage) {
    throw new ApiError(404, 'No cold storage assigned to you as manager');
  }

  // Get booking stats
  const [pendingBookings, acceptedBookings, totalBookings] = await Promise.all([
    Booking.countDocuments({ coldStorage: coldStorage._id, status: 'pending' }),
    Booking.countDocuments({ coldStorage: coldStorage._id, status: 'accepted' }),
    Booking.countDocuments({ coldStorage: coldStorage._id }),
  ]);

  // Get today's bookings
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayBookings = await Booking.countDocuments({
    coldStorage: coldStorage._id,
    createdAt: { $gte: today },
  });

  const percentUsed =
    coldStorage.capacity > 0
      ? Math.round(
          ((coldStorage.capacity - coldStorage.availableCapacity) / coldStorage.capacity) * 100
        )
      : 0;

  return res.json(
    new ApiResponse(
      200,
      {
        coldStorage,
        stats: {
          totalBookings,
          pendingBookings,
          acceptedBookings,
          todayBookings,
          totalCapacity: coldStorage.capacity,
          availableCapacity: coldStorage.availableCapacity,
          usedCapacity: coldStorage.capacity - coldStorage.availableCapacity,
          percentUsed,
          isAvailable: coldStorage.isAvailable,
        },
      },
      'Manager dashboard fetched successfully'
    )
  );
});

// ============================================
// COLD STORAGE - Get assigned cold storage
// ============================================
const getMyStorage = asyncHandler(async (req, res) => {
  const userId = req.user._id;

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

// ============================================
// COLD STORAGE - Update storage details (limited fields)
// ============================================
const updateStorageDetails = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { phone, availableCapacity, pricePerTon } = req.body;

  const coldStorage = await getManagerStorage(userId);

  // Manager can only update limited fields
  if (phone) coldStorage.phone = phone;
  if (availableCapacity !== undefined) {
    if (availableCapacity < 0 || availableCapacity > coldStorage.capacity) {
      throw new ApiError(400, 'Available capacity must be between 0 and total capacity');
    }
    coldStorage.availableCapacity = availableCapacity;
  }
  if (pricePerTon !== undefined) {
    if (pricePerTon < 0) {
      throw new ApiError(400, 'Price per ton cannot be negative');
    }
    coldStorage.pricePerTon = pricePerTon;
  }

  await coldStorage.save();

  return res.json(
    new ApiResponse(200, { coldStorage }, 'Cold storage details updated successfully')
  );
});

// ============================================
// COLD STORAGE - Toggle availability
// ============================================
const toggleStorageAvailability = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const coldStorage = await getManagerStorage(userId);
  coldStorage.isAvailable = !coldStorage.isAvailable;
  await coldStorage.save();

  return res.json(
    new ApiResponse(
      200,
      { coldStorage },
      `Storage ${coldStorage.isAvailable ? 'available' : 'unavailable'}`
    )
  );
});

// ============================================
// BOOKINGS - Get all booking requests
// ============================================
const getBookingRequests = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { status } = req.query;

  const coldStorage = await getManagerStorage(userId);

  const query = { coldStorage: coldStorage._id };
  if (status) query.status = status;

  const bookings = await Booking.find(query)
    .populate('farmer', 'firstName lastName phone address')
    .populate('coldStorage', 'name address city state')
    .sort({ createdAt: -1 });

  return res.json(new ApiResponse(200, { bookings }, 'Booking requests fetched successfully'));
});

// ============================================
// BOOKINGS - Get single booking
// ============================================
const getBookingById = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { bookingId } = req.params;

  const coldStorage = await getManagerStorage(userId);

  const booking = await Booking.findById(bookingId)
    .populate('farmer', 'firstName lastName phone address')
    .populate('coldStorage', 'name address city state pricePerTon capacity availableCapacity')
    .populate('owner', 'firstName lastName phone');

  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  // Ensure booking belongs to this manager's cold storage
  if (booking.coldStorage._id.toString() !== coldStorage._id.toString()) {
    throw new ApiError(403, 'Not authorized to view this booking');
  }

  return res.json(new ApiResponse(200, { booking }, 'Booking fetched successfully'));
});

// ============================================
// BOOKINGS - Respond to booking (accept/reject)
// ============================================
const respondToBooking = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { bookingId } = req.params;
  const { action, ownerResponse, startDate } = req.body;

  const coldStorage = await getManagerStorage(userId);

  const booking = await Booking.findById(bookingId).populate(
    'coldStorage',
    'name address city state'
  );

  if (!booking) {
    throw new ApiError(404, 'Booking not found');
  }

  // Ensure booking belongs to this manager's cold storage
  if (booking.coldStorage._id.toString() !== coldStorage._id.toString()) {
    throw new ApiError(403, 'Not authorized to respond to this booking');
  }

  if (booking.status !== 'pending') {
    throw new ApiError(400, 'Booking already processed');
  }

  if (action === 'accept') {
    if (booking.quantity > coldStorage.availableCapacity) {
      throw new ApiError(400, `Only ${coldStorage.availableCapacity} Pkt available`);
    }

    coldStorage.availableCapacity -= booking.quantity;
    if (coldStorage.availableCapacity === 0) {
      coldStorage.isAvailable = false;
    }
    await coldStorage.save();

    booking.status = 'accepted';
    booking.startDate = startDate || new Date();

    const endDate = new Date(booking.startDate);
    endDate.setMonth(endDate.getMonth() + booking.duration);
    booking.endDate = endDate;

    // Notify farmer
    const csName = booking.coldStorage?.name || 'Cold Storage';
    const managerName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
    await Notification.create({
      recipient: booking.farmer,
      sender: userId,
      type: 'booking_accepted',
      title: `Booking Accepted at ${csName}! 🎉`,
      message: `Manager ${managerName} has accepted your booking for ${booking.quantity} Pkt at ${csName}`,
      referenceId: booking._id,
      referenceType: 'booking',
      data: {
        bookingId: booking._id,
        coldStorageId: coldStorage._id,
        quantity: booking.quantity,
        duration: booking.duration,
        totalPrice: booking.totalPrice,
        coldStorageName: csName,
      },
    });

    // Notify owner too
    await Notification.create({
      recipient: coldStorage.owner,
      sender: userId,
      type: 'booking_accepted',
      title: `Booking Accepted by Manager — ${csName}`,
      message: `Manager ${managerName} accepted booking for ${booking.quantity} Pkt from farmer`,
      referenceId: booking._id,
      referenceType: 'booking',
    });
  } else if (action === 'reject') {
    booking.status = 'rejected';

    const rejCsName = booking.coldStorage?.name || 'Cold Storage';
    await Notification.create({
      recipient: booking.farmer,
      sender: userId,
      type: 'booking_rejected',
      title: `Booking Rejected — ${rejCsName}`,
      message: `Your booking request for ${booking.quantity} Pkt at ${rejCsName} has been declined${ownerResponse ? ': ' + ownerResponse : ''}`,
      referenceId: booking._id,
      referenceType: 'booking',
      data: {
        bookingId: booking._id,
        coldStorageId: coldStorage._id,
        coldStorageName: rejCsName,
      },
    });
  } else {
    throw new ApiError(400, "Invalid action. Use 'accept' or 'reject'");
  }

  booking.ownerResponse = ownerResponse || '';
  booking.respondedAt = new Date();
  await booking.save();

  await booking.populate([{ path: 'farmer', select: 'firstName lastName phone' }]);

  return res.json(new ApiResponse(200, { booking }, `Booking ${action}ed successfully`));
});

// ============================================
// BOOKINGS - Get booking stats
// ============================================
const getBookingStats = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const coldStorage = await getManagerStorage(userId);

  const [pending, accepted, rejected, cancelled, completed] = await Promise.all([
    Booking.countDocuments({ coldStorage: coldStorage._id, status: 'pending' }),
    Booking.countDocuments({ coldStorage: coldStorage._id, status: 'accepted' }),
    Booking.countDocuments({ coldStorage: coldStorage._id, status: 'rejected' }),
    Booking.countDocuments({ coldStorage: coldStorage._id, status: 'cancelled' }),
    Booking.countDocuments({ coldStorage: coldStorage._id, status: 'completed' }),
  ]);

  return res.json(
    new ApiResponse(
      200,
      {
        stats: {
          pending,
          accepted,
          rejected,
          cancelled,
          completed,
          total: pending + accepted + rejected + cancelled + completed,
        },
      },
      'Booking stats fetched successfully'
    )
  );
});

// ============================================
// MANAGER PROFILE - Get own profile info
// ============================================
const getManagerProfile = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const user = await User.findById(userId)
    .select('-password -refreshToken')
    .populate('managedColdStorage', 'name city state phone')
    .populate('managedBy', 'firstName lastName phone');

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  return res.json(new ApiResponse(200, { manager: user }, 'Manager profile fetched'));
});

// ============================================
// MANAGER PROFILE - Update own profile
// ============================================
const updateManagerProfile = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { firstName, lastName } = req.body;

  const updateData = {};
  if (firstName) updateData.firstName = firstName.trim();
  if (lastName) updateData.lastName = lastName.trim();

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set: updateData },
    { new: true, runValidators: true }
  ).select('-password -refreshToken');

  if (!updatedUser) {
    throw new ApiError(404, 'User not found');
  }

  return res.json(new ApiResponse(200, { manager: updatedUser }, 'Profile updated successfully'));
});

export {
  getManagerDashboard,
  getMyStorage,
  updateStorageDetails,
  toggleStorageAvailability,
  getBookingRequests,
  getBookingById,
  respondToBooking,
  getBookingStats,
  getManagerProfile,
  updateManagerProfile,
};
