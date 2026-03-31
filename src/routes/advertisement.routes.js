import { Router } from 'express';
import {
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
} from '../controller/advertisement.controller.js';
import { isAdmin } from '../middleware/admin.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// ============ PUBLIC ROUTES ============
// Get ad slide pricing (public - anyone can see prices)
router.get('/pricing', getAdPricing);

// Get active ads for slider (no auth required)
router.get('/active', getActiveAdvertisements);

// Track ad engagement (no auth required)
router.post('/:id/view', trackAdView);
router.post('/:id/click', trackAdClick);

// ============ AUTHENTICATED USER ROUTES ============
// Create advertisement request
router.post('/request', authMiddleware, createAdvertisementRequest);

// Get my advertisements
router.get('/my', authMiddleware, getMyAdvertisements);

// ============ USER PAYMENT ROUTES ============
// Create Razorpay order for approved advertisement
router.post('/pay/create-order', authMiddleware, createAdPaymentOrder);

// Verify Razorpay payment and activate advertisement
router.post('/pay/verify', authMiddleware, verifyAdPayment);

// ============ ADMIN ROUTES ============
// Admin: Create and activate banner directly
router.post('/admin/create', authMiddleware, isAdmin, adminCreateBanner);

// Admin: Update slide pricing
router.put('/admin/pricing', authMiddleware, isAdmin, updateAdPricing);

// Get all advertisements
router.get('/admin/all', authMiddleware, isAdmin, getAllAdvertisements);

// Get pending advertisements
router.get('/admin/pending', authMiddleware, isAdmin, getPendingAdvertisements);

// Approve advertisement
router.patch('/admin/:id/approve', authMiddleware, isAdmin, approveAdvertisement);

// Reject advertisement
router.patch('/admin/:id/reject', authMiddleware, isAdmin, rejectAdvertisement);

// Confirm payment
router.patch('/admin/:id/confirm-payment', authMiddleware, isAdmin, confirmPayment);

// Admin: Edit advertisement
router.put('/admin/:id/edit', authMiddleware, isAdmin, adminEditAdvertisement);

// Admin: Delete advertisement
router.delete('/admin/:id', authMiddleware, isAdmin, adminDeleteAdvertisement);

// Get advertisement stats
router.get('/admin/stats', authMiddleware, isAdmin, getAdvertisementStats);

// Get all users (Admin)
router.get('/admin/users', authMiddleware, isAdmin, getAllUsers);

// Get dashboard stats (Admin)
router.get('/admin/dashboard', authMiddleware, isAdmin, getDashboardStats);

export default router;
