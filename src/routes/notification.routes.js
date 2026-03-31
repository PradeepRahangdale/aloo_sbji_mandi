import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { Notification } from "../models/notification.model.js";

const router = express.Router();

// Get all notifications for logged-in user
router.get("/", authMiddleware, async (req, res) => {
    try {
        const userId = req.user._id;
        const { limit = 50, skip = 0, unreadOnly, types } = req.query;

        const query = { recipient: userId };
        if (unreadOnly === 'true') query.isRead = false;
        if (types) {
            const typeList = types.split(',').map(t => t.trim()).filter(Boolean);
            if (typeList.length > 0) query.type = { $in: typeList };
        }

        const notifications = await Notification.find(query)
            .populate('sender', 'firstName lastName')
            .sort({ createdAt: -1 })
            .skip(parseInt(skip))
            .limit(parseInt(limit));

        const unreadCount = await Notification.countDocuments({ 
            recipient: userId, 
            isRead: false 
        });

        res.json({
            success: true,
            data: { 
                notifications,
                unreadCount
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to fetch notifications",
            error: error.message
        });
    }
});

// Get unread count
router.get("/unread-count", authMiddleware, async (req, res) => {
    try {
        const { types } = req.query;
        const query = { 
            recipient: req.user._id, 
            isRead: false 
        };
        if (types) {
            const typeList = types.split(',').map(t => t.trim()).filter(Boolean);
            if (typeList.length > 0) query.type = { $in: typeList };
        }

        const count = await Notification.countDocuments(query);

        res.json({
            success: true,
            data: { unreadCount: count }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to get unread count",
            error: error.message
        });
    }
});

// Mark notification as read
router.patch("/:id/read", authMiddleware, async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, recipient: req.user._id },
            { isRead: true, isSeen: true },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: "Notification not found"
            });
        }

        res.json({
            success: true,
            data: { notification }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to mark as read",
            error: error.message
        });
    }
});

// Mark all notifications as read
router.patch("/read-all", authMiddleware, async (req, res) => {
    try {
        const { types } = req.body;
        const query = { recipient: req.user._id, isRead: false };
        if (types && Array.isArray(types) && types.length > 0) {
            query.type = { $in: types };
        }

        await Notification.updateMany(query, { isRead: true, isSeen: true });

        res.json({
            success: true,
            message: "All notifications marked as read"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to mark all as read",
            error: error.message
        });
    }
});

// Mark all as seen (for badge dismissal)
router.patch("/seen-all", authMiddleware, async (req, res) => {
    try {
        const { types } = req.body;
        const query = { recipient: req.user._id, isSeen: false };
        if (types && Array.isArray(types) && types.length > 0) {
            query.type = { $in: types };
        }

        await Notification.updateMany(query, { isSeen: true });

        res.json({
            success: true,
            message: "All notifications marked as seen"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to mark as seen",
            error: error.message
        });
    }
});

// Delete a notification
router.delete("/:id", authMiddleware, async (req, res) => {
    try {
        const notification = await Notification.findOneAndDelete({
            _id: req.params.id,
            recipient: req.user._id
        });

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: "Notification not found"
            });
        }

        res.json({
            success: true,
            message: "Notification deleted"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to delete notification",
            error: error.message
        });
    }
});

// Clear all notifications
router.delete("/", authMiddleware, async (req, res) => {
    try {
        await Notification.deleteMany({ recipient: req.user._id });

        res.json({
            success: true,
            message: "All notifications cleared"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Failed to clear notifications",
            error: error.message
        });
    }
});

export { router };
