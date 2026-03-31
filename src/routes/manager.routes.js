import express from 'express';
import {
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
} from '../controller/manager.controller.js';
import { authMiddleware as verify } from '../middleware/auth.middleware.js';

const router = express.Router();

// All manager routes require authentication
// Manager role is verified inside controllers via managedColdStorage check

// ============================================
// DASHBOARD
// ============================================
router.get('/dashboard', verify, getManagerDashboard);

// ============================================
// COLD STORAGE - View & limited edit
// ============================================
router.get('/my-storage', verify, getMyStorage);
router.put('/my-storage', verify, updateStorageDetails);
router.patch('/my-storage/toggle', verify, toggleStorageAvailability);

// ============================================
// BOOKINGS - Full access (view + accept/reject)
// ============================================
router.get('/bookings', verify, getBookingRequests);
router.get('/bookings/stats', verify, getBookingStats);
router.get('/bookings/:bookingId', verify, getBookingById);
router.patch('/bookings/:bookingId/respond', verify, respondToBooking);

// ============================================
// PROFILE
// ============================================
router.get('/profile', verify, getManagerProfile);
router.put('/profile', verify, updateManagerProfile);

export default router;
