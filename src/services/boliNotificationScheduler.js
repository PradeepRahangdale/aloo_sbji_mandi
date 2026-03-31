/**
 * Boli Alert Notification Scheduler
 * 
 * Sends push-style notifications to farmers and vyaparis
 * 3 days, 2 days, and 1 day before each upcoming boli (auction).
 * 
 * Runs a cron job every day at 8:00 AM IST to check for upcoming boli alerts.
 */

import cron from 'node-cron';
import { BoliAlert } from '../models/boliAlert.model.js';
import { Notification } from '../models/notification.model.js';
import { User } from '../models/user.model.js';
import { Booking } from '../models/booking.model.js';
import { emitToUser } from '../config/socket.js';

// Hindi day names for notification messages
const getDayNameHindi = (dayNum) => {
    const days = ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];
    return days[dayNum];
};

/**
 * Get the target recipients for a boli alert (farmers + vyaparis)
 */
const getTargetRecipients = async (boliAlert) => {
    try {
        let recipients = [];

        if (boliAlert.targetAudience === 'customers') {
            // Get farmers with active bookings at this cold storage
            const bookings = await Booking.find({
                coldStorage: boliAlert.coldStorage._id || boliAlert.coldStorage,
                status: { $in: ['confirmed', 'active', 'pending'] },
            }).distinct('farmer');

            if (bookings.length > 0) {
                recipients = await User.find({
                    _id: { $in: bookings },
                }).select('_id role').limit(500);
            }
        } else {
            // Send to all farmers AND vyaparis in same city/district/state
            const locationQuery = {
                $or: [
                    { 'address.city': new RegExp(boliAlert.location?.city || '', 'i') },
                    { 'address.district': new RegExp(boliAlert.location?.city || '', 'i') },
                    { 'address.state': new RegExp(boliAlert.location?.state || '', 'i') },
                ],
            };

            // Get farmers
            const farmers = await User.find({
                role: 'farmer',
                ...locationQuery,
            }).select('_id role').limit(300);

            // Get vyaparis (traders)
            const vyaparis = await User.find({
                role: 'vyapari',
                ...locationQuery,
            }).select('_id role').limit(300);

            recipients = [...farmers, ...vyaparis];
        }

        return recipients;
    } catch (error) {
        console.error('Error getting target recipients:', error);
        return [];
    }
};

/**
 * Create and send notifications for a boli alert at a specific days-before interval
 */
const sendBoliReminder = async (boliAlert, daysBeforeLabel, daysBeforeHindi) => {
    try {
        const coldStorageName = boliAlert.coldStorage?.name || 'Cold Storage';
        const city = boliAlert.location?.city || '';
        const dayName = getDayNameHindi(boliAlert.dayOfWeek);
        const boliTime = boliAlert.boliTime || '10:00 AM';

        const recipients = await getTargetRecipients(boliAlert);

        if (recipients.length === 0) {
            console.log(`No recipients found for boli alert ${boliAlert._id}`);
            return 0;
        }

        // Build notification title and message
        const title = `🔔 बोली अलर्ट - ${daysBeforeHindi} / Boli Alert - ${daysBeforeLabel}`;
        const message = `${coldStorageName} में ${dayName} (${daysBeforeHindi}) को बोली होगी! समय: ${boliTime}, स्थान: ${city}। तैयारी करें!\n\nAuction at ${coldStorageName} in ${daysBeforeLabel}! Time: ${boliTime}, Location: ${city}. Get ready!`;

        // Check for duplicate notifications (avoid re-sending same reminder)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const existingNotif = await Notification.findOne({
            type: 'boli_alert',
            referenceId: boliAlert._id,
            title: { $regex: daysBeforeLabel, $options: 'i' },
            createdAt: { $gte: today, $lt: tomorrow },
        });

        if (existingNotif) {
            console.log(`Boli reminder "${daysBeforeLabel}" already sent today for alert ${boliAlert._id}`);
            return 0;
        }

        // Create notifications for all recipients
        const notifications = recipients.map((user) => ({
            recipient: user._id,
            sender: boliAlert.createdBy,
            title: title,
            message: message,
            type: 'boli_alert',
            referenceId: boliAlert._id,
            referenceType: 'deal',
            data: {
                boliAlertId: boliAlert._id.toString(),
                coldStorageName: coldStorageName,
                boliTime: boliTime,
                dayOfWeek: boliAlert.dayOfWeek,
                nextBoliDate: boliAlert.nextBoliDate,
                daysBeforeLabel: daysBeforeLabel,
                city: city,
            },
        }));

        if (notifications.length > 0) {
            await Notification.insertMany(notifications);

            // Emit real-time socket events to online users
            for (const user of recipients) {
                emitToUser(user._id.toString(), 'boli_alert_reminder', {
                    title: title,
                    message: message,
                    boliAlertId: boliAlert._id.toString(),
                    coldStorageName: coldStorageName,
                    boliTime: boliTime,
                    nextBoliDate: boliAlert.nextBoliDate,
                    daysBeforeLabel: daysBeforeLabel,
                    city: city,
                });
            }

            console.log(`✅ Sent "${daysBeforeLabel}" boli reminder to ${notifications.length} users for ${coldStorageName}`);
        }

        return notifications.length;
    } catch (error) {
        console.error(`Error sending boli reminder (${daysBeforeLabel}):`, error);
        return 0;
    }
};

/**
 * Main function: Check all active boli alerts and send reminders 
 * for those happening in 3, 2, or 1 day(s)
 */
const checkAndSendBoliReminders = async () => {
    try {
        console.log('\n📢 [Boli Scheduler] Checking for upcoming boli alerts...');

        const now = new Date();
        
        // Calculate dates for 1, 2, 3 days from now (start of day)
        const targets = [
            { days: 1, label: 'Tomorrow', hindi: 'कल' },
            { days: 2, label: 'In 2 Days', hindi: '2 दिन बाद' },
            { days: 3, label: 'In 3 Days', hindi: '3 दिन बाद' },
        ];

        // Get all active boli alerts
        const activeAlerts = await BoliAlert.find({ isActive: true })
            .populate('coldStorage', 'name address city state phone')
            .populate('createdBy', 'name phone');

        if (activeAlerts.length === 0) {
            console.log('[Boli Scheduler] No active boli alerts found.');
            return;
        }

        let totalSent = 0;

        for (const alert of activeAlerts) {
            // Calculate the next boli date's day
            const nextBoliDate = new Date(alert.nextBoliDate);
            nextBoliDate.setHours(0, 0, 0, 0);

            for (const target of targets) {
                // Calculate the target date (X days from today)
                const targetDate = new Date(now);
                targetDate.setDate(targetDate.getDate() + target.days);
                targetDate.setHours(0, 0, 0, 0);

                // Check if the boli falls on the target date
                if (nextBoliDate.getTime() === targetDate.getTime()) {
                    console.log(`[Boli Scheduler] Found boli at "${alert.coldStorage?.name}" in ${target.label}`);
                    const count = await sendBoliReminder(alert, target.label, target.hindi);
                    totalSent += count;
                }
            }
        }

        console.log(`📢 [Boli Scheduler] Done. Total notifications sent: ${totalSent}\n`);
    } catch (error) {
        console.error('[Boli Scheduler] Error:', error);
    }
};

/**
 * Start the boli notification scheduler
 * Runs every day at 8:00 AM IST (2:30 AM UTC)
 */
export const startBoliNotificationScheduler = () => {
    // Run at 8:00 AM IST every day (IST = UTC + 5:30, so 8:00 AM IST = 2:30 AM UTC)
    cron.schedule('30 2 * * *', () => {
        console.log('\n⏰ [Boli Scheduler] Running daily boli reminder check at 8:00 AM IST...');
        checkAndSendBoliReminders();
    }, {
        timezone: 'Asia/Kolkata'
    });

    console.log('✅ Boli Notification Scheduler started - runs daily at 8:00 AM IST');

    // Also run once on server startup (after a 10-second delay to let DB connect)
    setTimeout(() => {
        console.log('🚀 [Boli Scheduler] Running initial check on server startup...');
        checkAndSendBoliReminders();
    }, 10000);
};

export { checkAndSendBoliReminders };
