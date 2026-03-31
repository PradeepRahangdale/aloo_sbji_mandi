import express from 'express';
import {
  isMaster,
  MASTER_PHONE,
  masterOnly,
  authMiddleware as verify,
} from '../middleware/auth.middleware.js';
import { isAdmin } from '../middleware/admin.middleware.js';
import { User } from '../models/user.model.js';
import { Notification } from '../models/notification.model.js';
import { sendPushNotification } from '../services/fcm.service.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();

// ============================================
// CHECK ROLE - Returns whether user is master/admin
// ============================================
router.get(
  '/check-role',
  verify,
  asyncHandler(async (req, res) => {
    const user = req.user;
    const userIsMaster = isMaster(user);

    return res.json(
      new ApiResponse(
        200,
        {
          role: user.role,
          isMaster: userIsMaster,
          isAdmin: user.role === 'admin' || userIsMaster,
          phone: user.phone,
        },
        'Role check successful'
      )
    );
  })
);

// ============================================
// GET ALL ADMINS - Master only
// ============================================
router.get(
  '/admins',
  verify,
  masterOnly,
  asyncHandler(async (req, res) => {
    const admins = await User.find({
      role: { $in: ['admin', 'master'] },
    })
      .select('firstName lastName phone email role isMaster createdAt address')
      .sort({ createdAt: -1 });

    // Mark master in response
    const adminsWithMasterFlag = admins.map((admin) => {
      const adminObj = admin.toObject();
      adminObj.isMaster = admin.phone === MASTER_PHONE || admin.role === 'master';
      return adminObj;
    });

    return res.json(new ApiResponse(200, adminsWithMasterFlag, 'Admins fetched successfully'));
  })
);

// ============================================
// CREATE ADMIN - Master only
// ============================================
router.post(
  '/create-admin',
  verify,
  masterOnly,
  asyncHandler(async (req, res) => {
    const { firstName, lastName, phone, password, email } = req.body;

    // Validation
    if (!firstName || !lastName) {
      throw new ApiError(400, 'First name and last name are required');
    }
    if (!phone) {
      throw new ApiError(400, 'Phone number is required');
    }
    if (!password || password.length < 6) {
      throw new ApiError(400, 'Password must be at least 6 characters long');
    }

    // Cannot create another master
    if (phone === MASTER_PHONE) {
      throw new ApiError(400, 'This phone number is reserved for the master account');
    }

    // Check if user already exists with this phone
    const existingUser = await User.findOne({ phone: phone.trim() });

    if (existingUser) {
      // If user exists but is not admin, upgrade them to admin
      if (existingUser.role !== 'admin' && existingUser.role !== 'master') {
        existingUser.role = 'admin';
        await existingUser.save({ validateBeforeSave: false });

        const updatedUser = await User.findById(existingUser._id).select('-refreshToken -password');
        return res
          .status(200)
          .json(new ApiResponse(200, updatedUser, 'Existing user promoted to admin'));
      }
      throw new ApiError(400, 'User with this phone number is already an admin');
    }

    // Create new admin user
    const adminData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      password,
      role: 'admin',
      isPhoneVerified: true,
    };

    if (email) {
      adminData.email = email.trim();
      adminData.isEmailVerified = true;
    }

    const newAdmin = await User.create(adminData);
    const adminResponse = await User.findById(newAdmin._id).select('-refreshToken -password');

    return res.status(201).json(new ApiResponse(201, adminResponse, 'Admin created successfully'));
  })
);

// ============================================
// UPDATE ADMIN - Master only
// ============================================
router.put(
  '/update-admin/:adminId',
  verify,
  masterOnly,
  asyncHandler(async (req, res) => {
    const { adminId } = req.params;
    const { firstName, lastName, phone, email, password } = req.body;

    const admin = await User.findById(adminId);
    if (!admin) {
      throw new ApiError(404, 'Admin not found');
    }

    // Cannot modify master account
    if (admin.phone === MASTER_PHONE || admin.role === 'master') {
      throw new ApiError(403, 'Master account cannot be modified');
    }

    // Only allow updating admins
    if (admin.role !== 'admin') {
      throw new ApiError(400, 'This user is not an admin');
    }

    const updateData = {};
    if (firstName) updateData.firstName = firstName.trim();
    if (lastName) updateData.lastName = lastName.trim();
    if (email) updateData.email = email.trim();
    if (phone) {
      if (phone === MASTER_PHONE) {
        throw new ApiError(400, 'Cannot use master phone number');
      }
      updateData.phone = phone.trim();
    }

    // If password update, hash it through the model
    if (password) {
      if (password.length < 6) {
        throw new ApiError(400, 'Password must be at least 6 characters long');
      }
      admin.password = password;
      await admin.save(); // This triggers the pre-save hook for password hashing
    }

    const updatedAdmin = await User.findByIdAndUpdate(
      adminId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-refreshToken -password');

    return res.json(new ApiResponse(200, updatedAdmin, 'Admin updated successfully'));
  })
);

// ============================================
// DELETE ADMIN - Master only
// ============================================
router.delete(
  '/delete-admin/:adminId',
  verify,
  masterOnly,
  asyncHandler(async (req, res) => {
    const { adminId } = req.params;

    const admin = await User.findById(adminId);
    if (!admin) {
      throw new ApiError(404, 'Admin not found');
    }

    // Cannot delete master
    if (admin.phone === MASTER_PHONE || admin.role === 'master') {
      throw new ApiError(403, 'Master account cannot be deleted');
    }

    // Only delete admins
    if (admin.role !== 'admin') {
      throw new ApiError(
        400,
        'This user is not an admin. Use user management to handle other roles.'
      );
    }

    await User.findByIdAndDelete(adminId);

    return res.json(new ApiResponse(200, { deletedId: adminId }, 'Admin deleted successfully'));
  })
);

// ============================================
// DEMOTE ADMIN TO USER - Master only
// ============================================
router.put(
  '/demote-admin/:adminId',
  verify,
  masterOnly,
  asyncHandler(async (req, res) => {
    const { adminId } = req.params;
    const { newRole } = req.body;

    const admin = await User.findById(adminId);
    if (!admin) {
      throw new ApiError(404, 'Admin not found');
    }

    // Cannot demote master
    if (admin.phone === MASTER_PHONE || admin.role === 'master') {
      throw new ApiError(403, 'Master account cannot be demoted');
    }

    if (admin.role !== 'admin') {
      throw new ApiError(400, 'This user is not an admin');
    }

    const validRoles = ['farmer', 'trader', 'cold-storage', 'aloo-mitra'];
    const targetRole = newRole && validRoles.includes(newRole) ? newRole : 'farmer';

    admin.role = targetRole;
    await admin.save({ validateBeforeSave: false });

    const updatedUser = await User.findById(adminId).select('-refreshToken -password');

    return res.json(
      new ApiResponse(200, updatedUser, `Admin demoted to ${targetRole} successfully`)
    );
  })
);

// ============================================
// BROADCAST NOTIFICATION - Admin only
// Send notification to all users
// ============================================
router.post(
  '/broadcast-notification',
  verify,
  isAdmin,
  asyncHandler(async (req, res) => {
    const { title, message, imageUrl } = req.body;

    // Validation
    if (!title || !message) {
      throw new ApiError(400, 'Title and message are required');
    }

    if (title.length > 200) {
      throw new ApiError(400, 'Title must be less than 200 characters');
    }

    if (message.length > 1000) {
      throw new ApiError(400, 'Message must be less than 1000 characters');
    }

    // Get all active users (exclude deleted/banned users if such flags exist)
    const users = await User.find({
      role: { $in: ['farmer', 'trader', 'cold-storage', 'aloo-mitra'] }
    }).select('_id firstName fcmToken');

    if (users.length === 0) {
      throw new ApiError(404, 'No users found to send notification');
    }

    // Prepare notification data
    const notificationData = {
      imageUrl: imageUrl || null,
      sender: req.user._id,
      senderName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
    };

    // Create notifications for all users in batches
    const batchSize = 100;
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      
      try {
        // Create in-app notifications
        const notifications = batch.map(user => ({
          recipient: user._id,
          sender: req.user._id,
          type: 'admin_broadcast',
          title,
          message,
          data: notificationData,
          isRead: false,
          isSeen: false,
        }));

        await Notification.insertMany(notifications);

        // Send FCM push notifications to offline users
        const pushPromises = batch.map(user =>
          sendPushNotification(
            user._id.toString(),
            title,
            message,
            {
              type: 'admin_broadcast',
              imageUrl: imageUrl || '',
              senderId: req.user._id.toString(),
            }
          )
        );

        await Promise.allSettled(pushPromises);
        
        successCount += batch.length;
      } catch (error) {
        console.error(`Batch notification error:`, error);
        failureCount += batch.length;
      }
    }

    return res.json(
      new ApiResponse(
        200,
        {
          totalUsers: users.length,
          successCount,
          failureCount,
        },
        `Notification sent to ${successCount} users successfully`
      )
    );
  })
);

export default router;
