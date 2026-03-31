import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { Booking } from '../models/booking.model.js';
import { ColdStorage } from '../models/coldStorage.model.js';
import { Notification } from '../models/notification.model.js';

const router = express.Router();

// Create a new booking (Farmer only)
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { coldStorageId, quantity, duration, farmerNote } = req.body;
    const farmerId = req.user._id;

    // Validate required fields
    if (!coldStorageId || !quantity) {
      return res.status(400).json({
        success: false,
        message: 'Cold storage ID and quantity are required',
      });
    }

    // Get cold storage details
    const coldStorage = await ColdStorage.findById(coldStorageId).populate('owner');
    if (!coldStorage) {
      return res.status(404).json({
        success: false,
        message: 'Cold storage not found',
      });
    }

    // Check if space is available
    if (quantity > coldStorage.availableCapacity) {
      return res.status(400).json({
        success: false,
        message: `Only ${coldStorage.availableCapacity} Pkt available`,
      });
    }

    // Calculate total price
    const totalPrice = quantity * coldStorage.pricePerTon * (duration || 1);

    // Create booking
    const booking = await Booking.create({
      farmer: farmerId,
      coldStorage: coldStorageId,
      owner: coldStorage.owner._id,
      quantity,
      duration: duration || 1,
      pricePerTon: coldStorage.pricePerTon,
      totalPrice,
      farmerNote: farmerNote || '',
    });

    // Create notification for owner
    const farmerFullName =
      `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'A farmer';
    await Notification.create({
      recipient: coldStorage.owner._id,
      sender: farmerId,
      type: 'booking_request',
      title: `New Booking — ${coldStorage.name}`,
      message: `${farmerFullName} has requested ${quantity} Pkt storage at ${coldStorage.name} for ${duration || 1} month${(duration || 1) > 1 ? 's' : ''}`,
      referenceId: booking._id,
      referenceType: 'booking',
      data: {
        bookingId: booking._id,
        coldStorageId: coldStorageId,
        quantity,
        duration: duration || 1,
        totalPrice,
        farmerName: farmerFullName,
        coldStorageName: coldStorage.name,
      },
    });

    // Populate the booking for response
    await booking.populate([
      { path: 'farmer', select: 'firstName lastName phone' },
      { path: 'coldStorage', select: 'name address city state' },
      { path: 'owner', select: 'firstName lastName phone' },
    ]);

    res.status(201).json({
      success: true,
      message: 'Booking request sent successfully',
      data: { booking },
    });
  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking',
      error: error.message,
    });
  }
});

// Get my bookings (for farmers)
router.get('/my-bookings', authMiddleware, async (req, res) => {
  try {
    const farmerId = req.user._id;
    const { status } = req.query;

    const query = { farmer: farmerId };
    if (status) query.status = status;

    const bookings = await Booking.find(query)
      .populate('coldStorage', 'name address city state pricePerTon')
      .populate('owner', 'firstName lastName phone')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { bookings },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings',
      error: error.message,
    });
  }
});

// Get booking requests (for cold storage owners AND managers)
router.get('/requests', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    const { status } = req.query;

    let query;

    if (req.user.role === 'cold-storage-manager') {
      // Manager: find the cold storage they manage
      const managedStorage = await ColdStorage.findOne({ manager: userId });
      if (!managedStorage) {
        return res.json({ success: true, data: { bookings: [] } });
      }
      query = { coldStorage: managedStorage._id };
    } else {
      // Owner: show their own bookings
      query = { owner: userId };
    }

    if (status) query.status = status;

    const bookings = await Booking.find(query)
      .populate('farmer', 'firstName lastName phone address')
      .populate('coldStorage', 'name address city state')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { bookings },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking requests',
      error: error.message,
    });
  }
});

// Get single booking
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('farmer', 'firstName lastName phone address')
      .populate('coldStorage', 'name address city state pricePerTon capacity availableCapacity')
      .populate('owner', 'firstName lastName phone');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    // Check if user is authorized to view this booking (farmer, owner, or manager)
    const csForAuth = await ColdStorage.findById(booking.coldStorage._id || booking.coldStorage);
    const isBookingOwner = booking.owner._id.toString() === req.user._id.toString();
    const isBookingFarmer = booking.farmer._id.toString() === req.user._id.toString();
    const isBookingManager =
      csForAuth && csForAuth.manager && csForAuth.manager.toString() === req.user._id.toString();
    if (!isBookingFarmer && !isBookingOwner && !isBookingManager) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this booking',
      });
    }

    res.json({
      success: true,
      data: { booking },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking',
      error: error.message,
    });
  }
});

// Update booking (farmer can update pending bookings)
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const { quantity, duration, farmerNote } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    // Only farmer can update their own booking
    if (booking.farmer.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this booking',
      });
    }

    // Can only update pending bookings
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Can only update pending bookings',
      });
    }

    // Get cold storage for validation
    const coldStorage = await ColdStorage.findById(booking.coldStorage);

    // Validate new quantity if provided
    if (quantity && quantity > coldStorage.availableCapacity) {
      return res.status(400).json({
        success: false,
        message: `Only ${coldStorage.availableCapacity} Pkt available`,
      });
    }

    // Update fields
    if (quantity) booking.quantity = quantity;
    if (duration) booking.duration = duration;
    if (farmerNote !== undefined) booking.farmerNote = farmerNote;

    // Recalculate total price
    booking.totalPrice = booking.quantity * booking.pricePerTon * booking.duration;

    await booking.save();

    // Notify owner about update
    await Notification.create({
      recipient: booking.owner,
      sender: req.user._id,
      type: 'booking_updated',
      title: 'Booking Updated',
      message: `Booking request has been updated to ${booking.quantity} Pkt`,
      referenceId: booking._id,
      referenceType: 'booking',
    });

    await booking.populate([
      { path: 'coldStorage', select: 'name address city state' },
      { path: 'owner', select: 'firstName lastName phone' },
    ]);

    res.json({
      success: true,
      message: 'Booking updated successfully',
      data: { booking },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update booking',
      error: error.message,
    });
  }
});

// Accept/Reject booking (owner only)
router.patch('/:id/respond', authMiddleware, async (req, res) => {
  try {
    const { action, ownerResponse, startDate } = req.body;

    // First get the raw booking to preserve coldStorage ObjectId
    const rawBooking = await Booking.findById(req.params.id);

    if (!rawBooking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    // Store the coldStorage ID before populate (in case CS was deleted)
    const coldStorageId = rawBooking.coldStorage;

    // Now populate for display data
    const booking = await Booking.findById(req.params.id).populate(
      'coldStorage',
      'name address city state'
    );

    // Owner or manager can respond
    const coldStorageDoc = await ColdStorage.findById(coldStorageId);
    const isOwner = booking.owner.toString() === req.user._id.toString();
    const isManager =
      coldStorageDoc &&
      coldStorageDoc.manager &&
      coldStorageDoc.manager.toString() === req.user._id.toString();
    if (!isOwner && !isManager) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to respond to this booking',
      });
    }

    // Can only respond to pending bookings
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Booking already processed',
      });
    }

    const csName = booking.coldStorage?.name || coldStorageDoc?.name || 'Cold Storage';

    if (action === 'accept') {
      // Update cold storage available capacity
      if (!coldStorageDoc) {
        return res.status(400).json({
          success: false,
          message: 'Cold storage not found. Cannot accept booking.',
        });
      }

      if (booking.quantity > coldStorageDoc.availableCapacity) {
        return res.status(400).json({
          success: false,
          message: 'Not enough space available',
        });
      }

      coldStorageDoc.availableCapacity -= booking.quantity;
      if (coldStorageDoc.availableCapacity === 0) {
        coldStorageDoc.isAvailable = false;
      }
      await coldStorageDoc.save();

      booking.status = 'accepted';
      booking.startDate = startDate || new Date();

      // Calculate end date based on duration
      const endDate = new Date(booking.startDate);
      endDate.setMonth(endDate.getMonth() + booking.duration);
      booking.endDate = endDate;

      // Create notification for farmer
      await Notification.create({
        recipient: booking.farmer,
        sender: req.user._id,
        type: 'booking_accepted',
        title: `Booking Accepted at ${csName}!`,
        message: `Your booking for ${booking.quantity} Pkt at ${csName} for ${booking.duration} month${booking.duration > 1 ? 's' : ''} has been accepted`,
        referenceId: booking._id,
        referenceType: 'booking',
        data: {
          bookingId: booking._id,
          coldStorageId: coldStorageId,
          quantity: booking.quantity,
          duration: booking.duration,
          totalPrice: booking.totalPrice,
          coldStorageName: csName,
        },
      });
    } else if (action === 'reject') {
      booking.status = 'rejected';

      await Notification.create({
        recipient: booking.farmer,
        sender: req.user._id,
        type: 'booking_rejected',
        title: `Booking Rejected - ${csName}`,
        message: `Your booking request for ${booking.quantity} Pkt at ${csName} has been declined${ownerResponse ? ': ' + ownerResponse : ''}`,
        referenceId: booking._id,
        referenceType: 'booking',
        data: {
          bookingId: booking._id,
          coldStorageId: coldStorageId,
          coldStorageName: csName,
        },
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Use 'accept' or 'reject'",
      });
    }

    booking.ownerResponse = ownerResponse || '';
    booking.respondedAt = new Date();
    await booking.save();

    await booking.populate([{ path: 'farmer', select: 'firstName lastName phone' }]);
    // coldStorage is already populated above

    res.json({
      success: true,
      message: `Booking ${action}ed successfully`,
      data: { booking },
    });
  } catch (error) {
    console.error('Booking respond error:', error.message, error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to process booking',
      error: error.message,
    });
  }
});

// Cancel booking (farmer only, for pending bookings)
router.patch('/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const rawBooking = await Booking.findById(req.params.id);

    if (!rawBooking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    const coldStorageId = rawBooking.coldStorage;
    const booking = await Booking.findById(req.params.id).populate('coldStorage', 'name');

    // Only farmer can cancel
    if (booking.farmer.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this booking',
      });
    }

    // Can only cancel pending or accepted bookings
    if (!['pending', 'accepted'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel this booking',
      });
    }

    // If accepted, return capacity to cold storage
    if (booking.status === 'accepted') {
      const coldStorage = await ColdStorage.findById(coldStorageId);
      if (coldStorage) {
        coldStorage.availableCapacity += booking.quantity;
        coldStorage.isAvailable = true;
        await coldStorage.save();
      }
    }

    booking.status = 'cancelled';
    await booking.save();

    // Notify owner
    const cancelCsName = booking.coldStorage?.name || 'Cold Storage';
    const cancelFarmerName =
      `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Farmer';
    await Notification.create({
      recipient: booking.owner,
      sender: req.user._id,
      type: 'booking_cancelled',
      title: `Booking Cancelled - ${cancelCsName}`,
      message: `${cancelFarmerName} has cancelled the booking for ${booking.quantity} Pkt at ${cancelCsName}`,
      referenceId: booking._id,
      referenceType: 'booking',
    });

    res.json({
      success: true,
      message: 'Booking cancelled successfully',
      data: { booking },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking',
      error: error.message,
    });
  }
});

// Delete a booking (Owner only)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found',
      });
    }

    // Only owner can delete
    if (booking.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this booking',
      });
    }

    // If accepted, return capacity to cold storage
    if (booking.status === 'accepted') {
      const coldStorage = await ColdStorage.findById(booking.coldStorage);
      if (coldStorage) {
        coldStorage.availableCapacity += booking.quantity;
        coldStorage.isAvailable = true;
        await coldStorage.save();
      }
    }

    await Booking.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Booking deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete booking',
      error: error.message,
    });
  }
});

export { router };
