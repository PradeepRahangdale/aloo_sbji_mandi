import express from 'express';
import {
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
} from '../controller/coldStorage.controller.js';
import { authMiddleware as verify } from '../middleware/auth.middleware.js';

const router = express.Router();

// Public routes
router.route('/').get(getAllColdStorages); // Get all with filters

// Protected routes - MUST come before /:id routes
router.route('/create').post(verify, createColdStorage); // Create
router.route('/my').get(verify, getMyColdStorages); // Get my cold storages
router.route('/manager/my-storage').get(verify, getManagerColdStorage); // Get manager's assigned cold storage

// Dynamic ID routes - MUST come after specific routes
router.route('/:id').get(getColdStorageById); // Get by ID
router.route('/:id').put(verify, updateColdStorage); // Update
router.route('/:id').delete(verify, deleteColdStorage); // Delete
router.route('/:id/toggle').patch(verify, toggleAvailability); // Toggle availability
router.route('/:id/rating').post(verify, addRating); // Add rating
router.route('/:id/ratings').get(getRatings); // Get all ratings
router.route('/:id/assign-manager').post(verify, assignManager); // Assign manager
router.route('/:id/remove-manager').delete(verify, removeManager); // Remove manager

export { router };
