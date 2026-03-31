/**
 * Firebase Cloud Messaging (FCM) Push Notification Service
 *
 * Sends push notifications to user devices when they are offline
 * (no active WebSocket connection). Works as a fallback to Socket.IO.
 *
 * SETUP REQUIRED:
 * 1. Create a Firebase project at https://console.firebase.google.com
 * 2. Go to Project Settings → Service Accounts → Generate New Private Key
 * 3. Save the JSON file as `firebase-service-account.json` in the project root
 *    OR set the env var FIREBASE_SERVICE_ACCOUNT_JSON with the JSON string
 * 4. npm install firebase-admin
 */

import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { User } from '../models/user.model.js';
import { checkUserOnline } from '../config/socket.js';

let firebaseInitialized = false;

/**
 * Initialize Firebase Admin SDK
 */
export function initializeFirebase() {
  if (firebaseInitialized) return;

  try {
    const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (serviceAccountEnv) {
      // From environment variable (production / Render)
      const serviceAccount = JSON.parse(serviceAccountEnv);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      firebaseInitialized = true;
      console.log('✅ Firebase Admin initialized (from env)');
    } else {
      // Try loading from file
      try {
        const filePath = path.resolve('firebase-service-account.json');
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf8');
          const serviceAccount = JSON.parse(raw);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
          firebaseInitialized = true;
          console.log('✅ Firebase Admin initialized (from file)');
        } else {
          console.warn('⚠️  Firebase service account not found. Push notifications disabled.');
          console.warn('   Set FIREBASE_SERVICE_ACCOUNT_JSON env var or place firebase-service-account.json in project root.');
        }
      } catch (fileErr) {
        console.warn('⚠️  Firebase init from file failed:', fileErr.message);
      }
    }
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed:', error.message);
  }
}

/**
 * Send push notification to a specific user via FCM
 * Only sends if the user is OFFLINE (no active socket connection)
 *
 * @param {string} userId - MongoDB user ID
 * @param {string} title - Notification title
 * @param {string} body - Notification body text
 * @param {object} data - Additional data payload (all values must be strings)
 * @returns {Promise<boolean>} - true if sent successfully
 */
export async function sendPushNotification(userId, title, body, data = {}) {
  if (!firebaseInitialized) {
    return false;
  }

  // Only send push if user is offline (socket not connected)
  if (checkUserOnline(userId)) {
    return false; // User is online, socket event will handle it
  }

  try {
    const user = await User.findById(userId).select('fcmToken firstName');
    if (!user || !user.fcmToken) {
      return false;
    }

    // FCM data payload values must all be strings
    const stringData = {};
    for (const [key, val] of Object.entries(data)) {
      stringData[key] = val != null ? String(val) : '';
    }

    const message = {
      token: user.fcmToken,
      notification: {
        title,
        body,
      },
      data: stringData,
      android: {
        priority: 'high',
        notification: {
          channelId: 'token_queue_channel',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
          icon: '@mipmap/ic_launcher',
          color: '#1B5E20',
        },
      },
      apns: {
        payload: {
          aps: {
            alert: { title, body },
            sound: 'default',
            badge: 1,
            'content-available': 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log(`📱 FCM push sent to ${user.firstName || userId}: ${title}`);
    return true;
  } catch (error) {
    console.error(`FCM push failed for ${userId}:`, error.message);

    // If token is invalid/expired, remove it from user
    if (
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/registration-token-not-registered'
    ) {
      await User.findByIdAndUpdate(userId, { fcmToken: null });
      console.log(`Removed invalid FCM token for user ${userId}`);
    }

    return false;
  }
}

/**
 * Send push notification for token queue events
 * Convenience wrapper with event-specific formatting
 *
 * @param {string} userId - Farmer's user ID
 * @param {string} event - Event type (token_called, token_nearby, etc.)
 * @param {object} eventData - Event-specific data
 */
export async function sendTokenPushNotification(userId, event, eventData = {}) {
  const { tokenNumber, counterName, coldStorageName, position, reason, message: eventMessage } = eventData;

  let title, body;

  switch (event) {
    case 'token_issued':
      title = `🎫 Token Approved — ${tokenNumber}`;
      body = eventMessage || `Your token ${tokenNumber} has been issued at ${coldStorageName}. Counter: ${counterName || 'TBD'}, Position: ${position || '—'}`;
      break;

    case 'token_called':
      title = `📢 Your Turn Now! Token ${tokenNumber}`;
      body = eventMessage || `Proceed to ${counterName || 'the counter'} at ${coldStorageName}`;
      break;

    case 'token_nearby':
      title = `⏰ Your Turn is Coming!`;
      body = eventMessage || `${position} people ahead of you at ${coldStorageName}. Get ready!`;
      break;

    case 'token_in_service':
      title = `✅ Service Started — Token ${tokenNumber}`;
      body = eventMessage || `Your service has started at ${counterName || 'the counter'}`;
      break;

    case 'token_completed':
      title = `🎉 Token Completed — ${tokenNumber}`;
      body = eventMessage || `Your service for token ${tokenNumber} is complete!`;
      break;

    case 'token_skipped':
      title = `⚠️ Token ${tokenNumber} Skipped`;
      body = eventMessage || `Your token was skipped. Reason: ${reason || 'Not present'}`;
      break;

    case 'token_transferred':
      title = `🔄 Counter Changed — Token ${tokenNumber}`;
      body = eventMessage || `Your token moved to ${counterName}. New position: ${position || '—'}`;
      break;

    case 'token_rejected':
      title = `❌ Token Request Rejected`;
      body = eventMessage || `Your token request at ${coldStorageName} was rejected. Reason: ${reason || '—'}`;
      break;

    case 'token_queue_update':
      title = `📊 Queue Update — Token ${tokenNumber}`;
      body = eventMessage || `Your position is now ${position} at ${coldStorageName}`;
      break;

    default:
      title = `🥔 Aloo Market — Token Update`;
      body = eventMessage || `There's an update for your token ${tokenNumber || ''}`;
  }

  return sendPushNotification(userId, title, body, {
    type: 'token_event',
    event,
    tokenId: eventData.tokenId || '',
    tokenNumber: tokenNumber || '',
    coldStorageName: coldStorageName || '',
    counterName: counterName || '',
    position: position || '',
  });
}
