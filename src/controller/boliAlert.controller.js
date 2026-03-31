import { BoliAlert } from '../models/boliAlert.model.js';
import { ColdStorage } from '../models/coldStorage.model.js';
import { Booking } from '../models/booking.model.js';
import { User } from '../models/user.model.js';
import { Notification } from '../models/notification.model.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Helper to get day name
const getDayName = (dayNum) => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayNum];
};

const getDayNameHindi = (dayNum) => {
  const days = ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];
  return days[dayNum];
};

// Helper to calculate next boli date based on day of week
const calculateNextBoliDate = (dayOfWeek, boliTime = '10:00') => {
  const now = new Date();
  const currentDay = now.getDay();

  // Calculate days until next occurrence
  let daysUntilNext = dayOfWeek - currentDay;
  if (daysUntilNext <= 0) {
    daysUntilNext += 7; // Next week
  }

  const nextDate = new Date(now);
  nextDate.setDate(now.getDate() + daysUntilNext);

  // Set the time
  const timeParts = boliTime.replace(/[APMapm\s]/g, '').split(':');
  let hours = parseInt(timeParts[0]) || 10;
  const minutes = parseInt(timeParts[1]) || 0;

  // Handle PM
  if (boliTime.toLowerCase().includes('pm') && hours < 12) {
    hours += 12;
  } else if (boliTime.toLowerCase().includes('am') && hours === 12) {
    hours = 0;
  }

  nextDate.setHours(hours, minutes, 0, 0);

  return nextDate;
};

// Helper to notify farmers about new boli alert
const notifyFarmers = async (boliAlert, coldStorage) => {
  try {
    let farmers = [];

    if (boliAlert.targetAudience === 'customers') {
      // Get only farmers who have active bookings at this cold storage
      const bookings = await Booking.find({
        coldStorage: coldStorage._id,
        status: { $in: ['confirmed', 'active', 'pending'] },
      }).distinct('farmer');

      if (bookings.length > 0) {
        farmers = await User.find({
          _id: { $in: bookings },
          role: 'farmer',
        }).limit(500);
      }
    } else {
      // Send to all farmers in same city/district/state
      farmers = await User.find({
        role: 'farmer',
        $or: [
          { 'address.district': new RegExp(boliAlert.location.city, 'i') },
          { 'address.state': new RegExp(boliAlert.location.state, 'i') },
        ],
      }).limit(200);
    }

    // Create notifications for each farmer
    const notifications = farmers.map((farmer) => ({
      recipient: farmer._id,
      sender: boliAlert.createdBy,
      title: '🔔 नई बोली अलर्ट / New Boli Alert',
      message: `${coldStorage.name} में ${getDayNameHindi(boliAlert.dayOfWeek)} को बोली! ${boliAlert.location.city} में आलू की बोली।`,
      type: 'boli_alert',
      referenceId: boliAlert._id,
      referenceType: 'deal',
    }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
      console.log(`Notified ${notifications.length} farmers about new boli alert`);
    }
  } catch (error) {
    console.error('Error notifying farmers:', error);
  }
};

// Create a new boli alert
const createBoliAlert = asyncHandler(async (req, res) => {
  const {
    coldStorageId,
    title,
    description,
    dayOfWeek,
    boliTime,
    location,
    contactPerson,
    contactPhone,
    expectedQuantity,
    expectedPriceMin,
    expectedPriceMax,
    potatoVarieties,
    isRecurring,
    instructions,
    targetAudience,
  } = req.body;

  // Verify cold storage exists and user is owner
  const coldStorage = await ColdStorage.findById(coldStorageId);
  if (!coldStorage) {
    throw new ApiError(404, 'Cold storage not found');
  }

  // Check if user is owner, manager, or admin
  const isOwner = coldStorage.owner.toString() === req.user._id.toString();
  const isManager =
    coldStorage.manager && coldStorage.manager.toString() === req.user._id.toString();
  if (!isOwner && !isManager && req.user.role !== 'admin') {
    throw new ApiError(403, 'You are not authorized to create boli alert for this cold storage');
  }

  // Calculate next boli date based on day of week
  const nextBoliDate = calculateNextBoliDate(dayOfWeek ?? 0, boliTime || '10:00 AM');

  // Create boli alert
  const boliAlert = await BoliAlert.create({
    coldStorage: coldStorageId,
    createdBy: req.user._id,
    title: title || 'आलू बोली / Potato Auction',
    description,
    dayOfWeek: dayOfWeek ?? 0,
    boliTime: boliTime || '10:00 AM',
    nextBoliDate: nextBoliDate,
    location: location || {
      address: coldStorage.address,
      city: coldStorage.city,
      state: coldStorage.state,
    },
    contactPerson: contactPerson || req.user.name,
    contactPhone: contactPhone || coldStorage.phone,
    expectedQuantity,
    expectedPriceMin,
    expectedPriceMax,
    potatoVarieties,
    isRecurring: isRecurring ?? true,
    instructions,
    targetAudience: targetAudience || 'all',
  });

  // Notify farmers about the new boli alert
  await notifyFarmers(boliAlert, coldStorage);

  const populatedAlert = await BoliAlert.findById(boliAlert._id)
    .populate('coldStorage', 'name address city state phone')
    .populate('createdBy', 'name phone');

  return res
    .status(201)
    .json(new ApiResponse(201, populatedAlert, 'Boli alert created successfully'));
});

// Get all active boli alerts (for all users)
const getAllActiveBoliAlerts = asyncHandler(async (req, res) => {
  const { city, state, upcoming } = req.query;

  const query = { isActive: true };

  // Filter by location
  if (city) query['location.city'] = new RegExp(city, 'i');
  if (state) query['location.state'] = new RegExp(state, 'i');

  // Get only upcoming bolis (next 7 days)
  if (upcoming === 'true') {
    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    query.nextBoliDate = { $gte: today, $lte: nextWeek };
  }

  const boliAlerts = await BoliAlert.find(query)
    .populate('coldStorage', 'name address city state phone email')
    .populate('createdBy', 'name')
    .sort({ nextBoliDate: 1 });

  // Add formatted day names
  const alertsWithDayNames = boliAlerts.map((alert) => {
    const alertObj = alert.toObject();
    alertObj.dayName = getDayName(alert.dayOfWeek);
    alertObj.dayNameHindi = getDayNameHindi(alert.dayOfWeek);
    return alertObj;
  });

  return res
    .status(200)
    .json(new ApiResponse(200, alertsWithDayNames, 'Boli alerts fetched successfully'));
});

// Get boli alerts for a specific cold storage
const getBoliAlertsByColdStorage = asyncHandler(async (req, res) => {
  const { coldStorageId } = req.params;

  const boliAlerts = await BoliAlert.find({
    coldStorage: coldStorageId,
    isActive: true,
  })
    .populate('coldStorage', 'name address city state')
    .sort({ nextBoliDate: 1 });

  return res.status(200).json(new ApiResponse(200, boliAlerts, 'Boli alerts fetched successfully'));
});

// Get my boli alerts (for cold storage owner or manager)
const getMyBoliAlerts = asyncHandler(async (req, res) => {
  let query = { createdBy: req.user._id, isActive: true };

  // If manager, also show alerts created by the owner for the managed cold storage
  if (req.user.role === 'cold-storage-manager' && req.user.managedColdStorage) {
    query = {
      coldStorage: req.user.managedColdStorage,
      isActive: true,
    };
  }

  const boliAlerts = await BoliAlert.find(query)
    .populate('coldStorage', 'name address city state')
    .sort({ nextBoliDate: 1 });

  return res
    .status(200)
    .json(new ApiResponse(200, boliAlerts, 'Your boli alerts fetched successfully'));
});

// Update boli alert
const updateBoliAlert = asyncHandler(async (req, res) => {
  const { alertId } = req.params;
  const updateData = req.body;

  const boliAlert = await BoliAlert.findById(alertId);
  if (!boliAlert) {
    throw new ApiError(404, 'Boli alert not found');
  }

  // Check authorization - owner, manager, or admin
  const alertColdStorage = await ColdStorage.findById(boliAlert.coldStorage);
  const isAlertOwner = boliAlert.createdBy.toString() === req.user._id.toString();
  const isAlertManager =
    alertColdStorage &&
    alertColdStorage.manager &&
    alertColdStorage.manager.toString() === req.user._id.toString();
  if (!isAlertOwner && !isAlertManager && req.user.role !== 'admin') {
    throw new ApiError(403, 'You are not authorized to update this boli alert');
  }

  // Update fields - handle nested location object properly
  Object.keys(updateData).forEach((key) => {
    if (updateData[key] !== undefined) {
      if (key === 'location' && typeof updateData[key] === 'object') {
        // Merge location fields instead of replacing
        Object.keys(updateData[key]).forEach((locKey) => {
          boliAlert.location[locKey] = updateData[key][locKey];
        });
        boliAlert.markModified('location');
      } else {
        boliAlert[key] = updateData[key];
      }
    }
  });

  // Recalculate next boli date if day changed
  if (updateData.dayOfWeek !== undefined) {
    boliAlert.nextBoliDate = boliAlert.calculateNextBoliDate();
  }

  await boliAlert.save();

  const updatedAlert = await BoliAlert.findById(alertId)
    .populate('coldStorage', 'name address city state')
    .populate('createdBy', 'name');

  return res
    .status(200)
    .json(new ApiResponse(200, updatedAlert, 'Boli alert updated successfully'));
});

// Delete boli alert
const deleteBoliAlert = asyncHandler(async (req, res) => {
  const { alertId } = req.params;

  const boliAlert = await BoliAlert.findById(alertId);
  if (!boliAlert) {
    throw new ApiError(404, 'Boli alert not found');
  }

  // Check authorization - owner, manager, or admin
  const delColdStorage = await ColdStorage.findById(boliAlert.coldStorage);
  const isDelOwner = boliAlert.createdBy.toString() === req.user._id.toString();
  const isDelManager =
    delColdStorage &&
    delColdStorage.manager &&
    delColdStorage.manager.toString() === req.user._id.toString();
  if (!isDelOwner && !isDelManager && req.user.role !== 'admin') {
    throw new ApiError(403, 'You are not authorized to delete this boli alert');
  }

  // Hard delete - remove from database
  await BoliAlert.findByIdAndDelete(alertId);

  return res.status(200).json(new ApiResponse(200, null, 'Boli alert deleted successfully'));
});

// Get upcoming boli alerts for notification (called by scheduler)
const getUpcomingBoliAlertsForNotification = asyncHandler(async (req, res) => {
  const today = new Date();
  const dayOfWeek = today.getDay();

  // Get alerts scheduled for today or tomorrow
  const alerts = await BoliAlert.find({
    isActive: true,
    dayOfWeek: { $in: [dayOfWeek, (dayOfWeek + 1) % 7] },
  })
    .populate('coldStorage', 'name address city state phone email')
    .populate('createdBy', 'name phone');

  return res.status(200).json(new ApiResponse(200, alerts, 'Upcoming boli alerts fetched'));
});

// Mark alert as sent (for tracking)
const markAlertSent = asyncHandler(async (req, res) => {
  const { alertId } = req.params;
  const { recipientCount } = req.body;

  const boliAlert = await BoliAlert.findById(alertId);
  if (!boliAlert) {
    throw new ApiError(404, 'Boli alert not found');
  }

  boliAlert.alertsSent.push({
    sentAt: new Date(),
    recipientCount: recipientCount || 0,
  });

  // Update next boli date for recurring alerts
  if (boliAlert.isRecurring) {
    boliAlert.nextBoliDate = boliAlert.calculateNextBoliDate();
  }

  await boliAlert.save();

  return res.status(200).json(new ApiResponse(200, boliAlert, 'Alert marked as sent'));
});

export {
  createBoliAlert,
  getAllActiveBoliAlerts,
  getBoliAlertsByColdStorage,
  getMyBoliAlerts,
  updateBoliAlert,
  deleteBoliAlert,
  getUpcomingBoliAlertsForNotification,
  markAlertSent,
};
