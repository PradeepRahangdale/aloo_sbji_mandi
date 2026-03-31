import { emitToUser } from '../config/socket.js';
import { Counter } from '../models/counter.model.js';
import { ColdStorage } from '../models/coldStorage.model.js';
import { Notification } from '../models/notification.model.js';
import { Token } from '../models/token.model.js';
import { sendSMS } from '../services/sms.service.js';
import { sendTokenPushNotification } from '../services/fcm.service.js';

// Helper to get today's date (start of day)
const getTodayDate = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

// Default average service time (fallback if counter has no config)
const DEFAULT_AVG_SERVICE_TIME = 10;

// Auto-expire stale pending/waiting tokens from previous days
const autoExpireStaleTokens = async () => {
  const today = getTodayDate();
  const result = await Token.updateMany(
    {
      tokenDate: { $lt: today },
      status: { $in: ['pending', 'waiting', 'called'] },
    },
    { $set: { status: 'cancelled', cancelReason: 'auto-expired (previous day)' } }
  );
  if (result.modifiedCount > 0) {
    console.log(`Auto-expired ${result.modifiedCount} stale tokens from previous days`);
  }
};

// ==================== SMART COUNTER ASSIGNMENT ====================

/**
 * Odd/Even counter assignment rule:
 *   - Odd  sequence numbers → Counters A (1), C (3), E (5)  — round-robin
 *   - Even sequence numbers → Counters B (2), D (4)          — round-robin
 *
 * Counter number mapping:  A=1, B=2, C=3, D=4, E=5
 */
const ODD_COUNTER_NUMBERS  = [1, 3, 5]; // A, C, E
const EVEN_COUNTER_NUMBERS = [2, 4];     // B, D

const assignByOddEvenRule = async (coldStorageId, sequenceNumber) => {
  // Fetch all active counters sorted by number
  let counters = await Counter.find({
    coldStorage: coldStorageId,
    isActive: true,
  }).sort({ number: 1 });

  if (counters.length === 0) {
    const defaultCounter = await Counter.ensureDefaultCounter(coldStorageId);
    counters = [defaultCounter];
  }

  const isOdd = sequenceNumber % 2 !== 0;
  const targetNumbers = isOdd ? ODD_COUNTER_NUMBERS : EVEN_COUNTER_NUMBERS;

  // Find matching counters for this parity
  const matchingCounters = counters.filter(c => targetNumbers.includes(c.number));

  if (matchingCounters.length === 0) {
    // Fallback: no matching counters, use any active counter with lowest queue
    return assignToBestCounter(coldStorageId, getTodayDate());
  }

  // Round-robin within the matching group based on sequence number
  // For odd tokens (seq 1,3,5,7,...) → pick among A,C,E
  // For even tokens (seq 2,4,6,8,...) → pick among B,D
  const groupIndex = isOdd
    ? Math.floor((sequenceNumber - 1) / 2) % matchingCounters.length
    : Math.floor((sequenceNumber - 2) / 2) % matchingCounters.length;

  return matchingCounters[groupIndex];
};

/**
 * Auto-assign a token to the best counter (lowest estimated wait).
 * Creates a default counter if none exist.
 */
const assignToBestCounter = async (coldStorageId, tokenDate) => {
  let counters = await Counter.find({
    coldStorage: coldStorageId,
    isActive: true,
  }).sort({ number: 1 });

  if (counters.length === 0) {
    const defaultCounter = await Counter.ensureDefaultCounter(coldStorageId);
    counters = [defaultCounter];
  }

  let bestCounter = counters[0];
  let lowestWait = Infinity;

  for (const counter of counters) {
    const waitingCount = await Token.countDocuments({
      counter: counter._id,
      tokenDate,
      status: { $in: ['waiting', 'called'] },
    });
    const estimatedWait = waitingCount * counter.averageServiceTime;

    if (estimatedWait < lowestWait) {
      lowestWait = estimatedWait;
      bestCounter = counter;
    }
  }

  return bestCounter;
};

/**
 * Update counter queue lengths (denormalized field) for a cold storage.
 */
const updateCounterQueueLengths = async (coldStorageId) => {
  const counters = await Counter.find({ coldStorage: coldStorageId });
  const today = getTodayDate();

  for (const counter of counters) {
    const count = await Token.countDocuments({
      counter: counter._id,
      tokenDate: today,
      status: { $in: ['waiting', 'called'] },
    });

    const activeToken = await Token.findOne({
      counter: counter._id,
      tokenDate: today,
      status: { $in: ['called', 'in-service'] },
    }).sort({ sequenceNumber: 1 });

    counter.currentQueueLength = count;
    counter.activeTokenId = activeToken ? activeToken._id : null;
    await counter.save();
  }
};

// ==================== FOR COLD STORAGE OWNERS ====================

// Create/Issue a token to a farmer
export const issueToken = async (req, res) => {
  try {
    const { coldStorageId } = req.params;
    const {
      farmerId,
      farmerName,
      farmerPhone,
      purpose = 'storage',
      expectedQuantity,
      potatoVariety,
      notes,
      counterId, // Optional: owner can specify a counter
    } = req.body;

    // Verify cold storage exists and user owns it
    const coldStorage = await ColdStorage.findById(coldStorageId);
    if (!coldStorage) {
      return res.status(404).json({ message: 'Cold storage not found' });
    }

    if (
      coldStorage.owner.toString() !== req.user._id.toString() &&
      (!coldStorage.manager || coldStorage.manager.toString() !== req.user._id.toString())
    ) {
      return res.status(403).json({ message: 'Not authorized to manage this cold storage' });
    }

    const today = getTodayDate();

    const actualFarmerId = farmerId || null;
    if (!actualFarmerId) {
      return res
        .status(400)
        .json({ message: 'Farmer ID is required. Use the farmer search to select a farmer.' });
    }

    // Smart counter assignment
    let assignedCounter;
    if (counterId) {
      assignedCounter = await Counter.findById(counterId);
      if (!assignedCounter || assignedCounter.coldStorage.toString() !== coldStorageId) {
        return res.status(400).json({ message: 'Invalid counter' });
      }
    } else {
      assignedCounter = await assignToBestCounter(coldStorageId, today);
    }

    // Generate token number
    const { tokenNumber, sequenceNumber } = await Token.generateTokenNumber(coldStorageId, today);

    // Calculate per-counter wait time
    const waitingAtCounter = await Token.countDocuments({
      counter: assignedCounter._id,
      tokenDate: today,
      status: { $in: ['waiting', 'called'] },
    });
    const estimatedWaitMinutes = waitingAtCounter * assignedCounter.averageServiceTime;
    const estimatedStartTime = new Date(Date.now() + estimatedWaitMinutes * 60 * 1000);

    // Create token
    const token = await Token.create({
      tokenNumber,
      sequenceNumber,
      coldStorage: coldStorageId,
      farmer: actualFarmerId,
      farmerName: farmerName || `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
      farmerPhone: farmerPhone || req.user.phone,
      expectedQuantity,
      potatoVariety,
      tokenDate: today,
      estimatedWaitMinutes,
      estimatedStartTime,
      counter: assignedCounter._id,
      counterNumber: assignedCounter.number,
      positionInQueue: waitingAtCounter + 1,
      notes,
    });

    await token.populate('coldStorage', 'name address');

    // Update counter queue length
    await updateCounterQueueLengths(coldStorageId);

    // Real-time: notify the farmer their token is issued
    const farmerUserId = actualFarmerId.toString();
    const issuedData = {
      tokenId: token._id,
      tokenNumber: token.tokenNumber,
      position: waitingAtCounter + 1,
      estimatedWaitMinutes,
      counterNumber: assignedCounter.number,
      counterName: assignedCounter.name,
      coldStorageName: coldStorage.name,
    };
    emitToUser(farmerUserId, 'token_issued', issuedData);
    sendTokenPushNotification(farmerUserId, 'token_issued', issuedData);

    await broadcastQueueUpdate(coldStorageId, today);

    res.status(201).json({
      message: 'Token issued successfully',
      data: {
        token,
        position: waitingAtCounter + 1,
        estimatedWaitMinutes,
        counterNumber: assignedCounter.number,
        counterName: assignedCounter.name,
      },
    });
  } catch (error) {
    console.error('Error issuing token:', error);
    res.status(500).json({ message: 'Failed to issue token', error: error.message });
  }
};

// Get today's token queue for a cold storage (with per-counter breakdown)
export const getTokenQueue = async (req, res) => {
  try {
    const { coldStorageId } = req.params;
    const { status, date } = req.query;

    await autoExpireStaleTokens();

    const tokenDate = date ? new Date(date) : getTodayDate();

    const query = {
      coldStorage: coldStorageId,
      tokenDate: tokenDate,
    };

    if (status) {
      query.status = status;
    }

    const tokens = await Token.find(query)
      .sort({ sequenceNumber: 1 })
      .populate('farmer', 'firstName lastName phone')
      .populate('counter', 'number name averageServiceTime isActive');

    // Get statistics
    const stats = {
      total: tokens.length,
      pending: tokens.filter((t) => t.status === 'pending').length,
      waiting: tokens.filter((t) => t.status === 'waiting').length,
      called: tokens.filter((t) => t.status === 'called').length,
      inService: tokens.filter((t) => t.status === 'in-service').length,
      completed: tokens.filter((t) => t.status === 'completed').length,
      skipped: tokens.filter((t) => t.status === 'skipped').length,
      cancelled: tokens.filter((t) => t.status === 'cancelled').length,
      rejected: tokens.filter((t) => t.status === 'rejected').length,
    };

    // Current serving tokens (one per counter)
    const currentServing = tokens.filter(
      (t) => t.status === 'in-service' || t.status === 'called'
    );

    // Get counters with their queues
    const counters = await Counter.find({ coldStorage: coldStorageId }).sort({ number: 1 });

    // Build per-counter breakdown
    const counterQueues = counters.map((counter) => {
      const counterTokens = tokens.filter(
        (t) => t.counter && t.counter._id.toString() === counter._id.toString()
      );
      const waiting = counterTokens.filter((t) => t.status === 'waiting');
      const active = counterTokens.find(
        (t) => t.status === 'called' || t.status === 'in-service'
      );

      return {
        counter: {
          _id: counter._id,
          number: counter.number,
          name: counter.name,
          averageServiceTime: counter.averageServiceTime,
          isActive: counter.isActive,
          currentQueueLength: waiting.length,
        },
        activeToken: active
          ? {
              _id: active._id,
              tokenNumber: active.tokenNumber,
              farmerName: active.farmerName,
              status: active.status,
            }
          : null,
        waitingTokens: waiting.map((t, idx) => ({
          _id: t._id,
          tokenNumber: t.tokenNumber,
          farmerName: t.farmerName,
          farmerPhone: t.farmerPhone,
          purpose: t.purpose,
          expectedQuantity: t.expectedQuantity,
          unit: t.unit,
          position: idx + 1,
          estimatedWaitMinutes: idx * counter.averageServiceTime,
        })),
        waitingCount: waiting.length,
        estimatedTotalWait: waiting.length * counter.averageServiceTime,
      };
    });

    // Tokens without a counter (legacy or unassigned)
    const unassignedTokens = tokens.filter((t) => !t.counter);

    res.json({
      data: {
        tokens,
        stats,
        currentServing: currentServing.length > 0 ? currentServing[0] : null,
        allServing: currentServing,
        counterQueues,
        unassignedTokens,
        date: tokenDate,
      },
    });
  } catch (error) {
    console.error('Error fetching token queue:', error);
    res.status(500).json({ message: 'Failed to fetch token queue', error: error.message });
  }
};

// Call next token (per-counter)
export const callNextToken = async (req, res) => {
  try {
    const { coldStorageId } = req.params;
    const { counterId, counterNumber = 1 } = req.body;

    const coldStorage = await ColdStorage.findById(coldStorageId);
    if (
      !coldStorage ||
      (coldStorage.owner.toString() !== req.user._id.toString() &&
        (!coldStorage.manager || coldStorage.manager.toString() !== req.user._id.toString()))
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const today = getTodayDate();

    // Build query — prefer counterId, fall back to counterNumber
    const callQuery = {
      coldStorage: coldStorageId,
      tokenDate: today,
      status: 'waiting',
    };

    let targetCounter;
    if (counterId) {
      targetCounter = await Counter.findById(counterId);
      if (!targetCounter) {
        return res.status(404).json({ message: 'Counter not found' });
      }
      callQuery.counter = counterId;
    } else {
      targetCounter = await Counter.findOne({
        coldStorage: coldStorageId,
        number: counterNumber,
      });
      if (targetCounter) {
        callQuery.counter = targetCounter._id;
      }
    }

    const actualCounterNumber = targetCounter ? targetCounter.number : counterNumber;
    const actualCounterName = targetCounter ? targetCounter.name : `Counter ${counterNumber}`;

    // Atomically find and update the next waiting token
    const nextToken = await Token.findOneAndUpdate(
      callQuery,
      {
        $set: {
          status: 'called',
          calledAt: new Date(),
          counterNumber: actualCounterNumber,
          counter: targetCounter ? targetCounter._id : undefined,
        },
      },
      { sort: { sequenceNumber: 1 }, new: true }
    );

    if (!nextToken) {
      return res.status(404).json({ message: 'No waiting tokens in queue for this counter' });
    }

    // Notification to farmer
    await Notification.create({
      recipient: nextToken.farmer,
      title: `🎫 Your Turn Now! Token ${nextToken.tokenNumber}`,
      message: `Token ${nextToken.tokenNumber} - Please proceed to ${actualCounterName} at ${coldStorage.name}`,
      type: 'token_called',
      referenceId: nextToken._id,
      referenceType: 'token',
      data: {
        tokenId: nextToken._id,
        coldStorageId,
        counterNumber: actualCounterNumber,
        counterName: actualCounterName,
        tokenNumber: nextToken.tokenNumber,
      },
    });

    nextToken.calledNotificationSent = true;
    await nextToken.save();

    // Real-time socket event to farmer + FCM push fallback
    const calledData = {
      tokenId: nextToken._id,
      tokenNumber: nextToken.tokenNumber,
      counterNumber: actualCounterNumber,
      counterName: actualCounterName,
      coldStorageName: coldStorage.name,
      message: `आपकी बारी आ गई! टोकन ${nextToken.tokenNumber} - ${actualCounterName} पर जाएं`,
    };
    emitToUser(nextToken.farmer.toString(), 'token_called', calledData);
    sendTokenPushNotification(nextToken.farmer.toString(), 'token_called', calledData);

    // SMS to farmer
    try {
      await sendSMS(
        nextToken.farmerPhone,
        `🥔 Aloo Mandi: आपकी बारी आ गई! टोकन ${nextToken.tokenNumber} - ${coldStorage.name} पर ${actualCounterName} पर जाएं। Your turn now!`
      );
    } catch (smsErr) {
      console.log('SMS send failed (non-critical):', smsErr.message);
    }

    // Emit queue update to cold storage owner
    emitToUser(coldStorage.owner.toString(), 'token_queue_updated', {
      coldStorageId,
      action: 'called',
      tokenNumber: nextToken.tokenNumber,
      counterNumber: actualCounterNumber,
    });

    // Update counter queue lengths
    await updateCounterQueueLengths(coldStorageId);

    // Notify nearby farmers at this counter
    await notifyNearbyFarmers(coldStorageId, today, coldStorage.name, targetCounter?._id);

    res.json({
      message: 'Token called successfully',
      data: nextToken,
    });
  } catch (error) {
    console.error('Error calling next token:', error);
    res.status(500).json({ message: 'Failed to call next token', error: error.message });
  }
};

// ==================== TRANSFER TOKEN BETWEEN COUNTERS ====================

export const transferToken = async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { targetCounterId } = req.body;

    if (!targetCounterId) {
      return res.status(400).json({ message: 'Target counter ID is required' });
    }

    const token = await Token.findById(tokenId).populate('coldStorage');
    if (!token) {
      return res.status(404).json({ message: 'Token not found' });
    }

    // Verify ownership
    if (
      token.coldStorage.owner.toString() !== req.user._id.toString() &&
      (!token.coldStorage.manager ||
        token.coldStorage.manager.toString() !== req.user._id.toString())
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Only waiting tokens can be transferred
    if (token.status !== 'waiting') {
      return res.status(400).json({ message: 'Only waiting tokens can be transferred' });
    }

    // Verify target counter exists and belongs to same cold storage
    const targetCounter = await Counter.findById(targetCounterId);
    if (!targetCounter || targetCounter.coldStorage.toString() !== token.coldStorage._id.toString()) {
      return res.status(400).json({ message: 'Invalid target counter' });
    }

    const today = getTodayDate();

    // Assign to new counter
    token.counter = targetCounter._id;
    token.counterNumber = targetCounter.number;

    // Recalculate position at new counter
    const aheadCount = await Token.countDocuments({
      counter: targetCounter._id,
      tokenDate: today,
      status: 'waiting',
      sequenceNumber: { $lt: token.sequenceNumber },
    });
    const position = aheadCount + 1;
    const estimatedWaitMinutes = aheadCount * targetCounter.averageServiceTime;
    const estimatedStartTime = new Date(Date.now() + estimatedWaitMinutes * 60 * 1000);

    token.positionInQueue = position;
    token.estimatedWaitMinutes = estimatedWaitMinutes;
    token.estimatedStartTime = estimatedStartTime;
    await token.save();

    // Update queue lengths for both old and new counters
    await updateCounterQueueLengths(token.coldStorage._id.toString());

    // Notify the farmer about the transfer + FCM push fallback
    const transferData = {
      tokenId: token._id,
      tokenNumber: token.tokenNumber,
      newCounterNumber: targetCounter.number,
      newCounterName: targetCounter.name,
      counterName: targetCounter.name,
      position: token.positionInQueue,
      estimatedWaitMinutes: token.estimatedWaitMinutes,
      coldStorageName: token.coldStorage.name,
      message: `आपका टोकन ${token.tokenNumber} ${targetCounter.name} पर स्थानांतरित किया गया है।`,
    };
    emitToUser(token.farmer.toString(), 'token_transferred', transferData);
    sendTokenPushNotification(token.farmer.toString(), 'token_transferred', transferData);

    // Broadcast queue update for all waiting farmers
    await broadcastQueueUpdate(token.coldStorage._id.toString(), today);

    res.json({
      message: `Token transferred to ${targetCounter.name}`,
      data: {
        token,
        newCounter: targetCounter,
        position: token.positionInQueue,
        estimatedWaitMinutes: token.estimatedWaitMinutes,
      },
    });
  } catch (error) {
    console.error('Error transferring token:', error);
    res.status(500).json({ message: 'Failed to transfer token', error: error.message });
  }
};

// ==================== HELPERS ====================

// Notify farmers whose turn is approaching (per-counter)
const notifyNearbyFarmers = async (coldStorageId, tokenDate, coldStorageName, counterId) => {
  try {
    const query = {
      coldStorage: coldStorageId,
      tokenDate: tokenDate,
      status: 'waiting',
    };
    if (counterId) query.counter = counterId;

    const firstWaiting = await Token.findOne(query).sort({ sequenceNumber: 1 });
    if (!firstWaiting) return;

    const nearbyTokens = await Token.find({
      ...query,
      sequenceNumber: {
        $gt: firstWaiting.sequenceNumber,
        $lte: firstWaiting.sequenceNumber + 5,
      },
      nearbyNotificationSent: false,
    });

    for (const token of nearbyTokens) {
      const position = token.sequenceNumber - firstWaiting.sequenceNumber + 1;

      await Notification.create({
        recipient: token.farmer,
        title: `⏰ आपकी बारी आने वाली है! ${position} लोग आगे`,
        message: `टोकन ${token.tokenNumber} - आपसे ${position} लोग आगे हैं ${coldStorageName} पर। तैयार रहें!`,
        type: 'token_nearby',
        referenceId: token._id,
        referenceType: 'token',
        data: {
          tokenId: token._id,
          coldStorageId,
          position,
        },
      });

      const nearbyData = {
        tokenId: token._id,
        tokenNumber: token.tokenNumber,
        position,
        coldStorageName,
        message: `आपसे ${position} लोग आगे हैं। तैयार रहें!`,
      };
      emitToUser(token.farmer.toString(), 'token_nearby', nearbyData);
      sendTokenPushNotification(token.farmer.toString(), 'token_nearby', nearbyData);

      try {
        await sendSMS(
          token.farmerPhone,
          `🥔 Aloo Mandi: आपकी बारी आने वाली है! टोकन ${token.tokenNumber} - आपसे ${position} लोग आगे हैं। ${coldStorageName} पर तैयार रहें। Your turn is coming!`
        );
      } catch (smsErr) {
        console.log('SMS send failed (non-critical):', smsErr.message);
      }

      token.nearbyNotificationSent = true;
      await token.save();
    }
  } catch (error) {
    console.error('Error notifying nearby farmers:', error);
  }
};

// Broadcast queue updates to all waiting farmers (per-counter positions)
const broadcastQueueUpdate = async (coldStorageId, tokenDate) => {
  try {
    // Get all counters
    const counters = await Counter.find({ coldStorage: coldStorageId });

    for (const counter of counters) {
      const waitingTokens = await Token.find({
        coldStorage: coldStorageId,
        counter: counter._id,
        tokenDate: tokenDate,
        status: 'waiting',
      }).sort({ sequenceNumber: 1 });

      const currentServing = await Token.findOne({
        coldStorage: coldStorageId,
        counter: counter._id,
        tokenDate: tokenDate,
        status: { $in: ['called', 'in-service'] },
      }).sort({ sequenceNumber: 1 });

      for (let i = 0; i < waitingTokens.length; i++) {
        const token = waitingTokens[i];
        const position = i + 1;
        const estimatedWaitMinutes = i * counter.averageServiceTime;

        // Update position in DB
        await Token.findByIdAndUpdate(token._id, {
          positionInQueue: position,
          estimatedWaitMinutes,
          estimatedStartTime: new Date(Date.now() + estimatedWaitMinutes * 60 * 1000),
        });

        emitToUser(token.farmer.toString(), 'token_queue_update', {
          tokenId: token._id,
          tokenNumber: token.tokenNumber,
          coldStorageId: coldStorageId,
          counterNumber: counter.number,
          counterName: counter.name,
          position,
          totalWaiting: waitingTokens.length,
          estimatedWaitMinutes,
          currentlyServing: currentServing?.tokenNumber || null,
        });
      }
    }

    // Handle tokens without a counter (legacy)
    const unassignedWaiting = await Token.find({
      coldStorage: coldStorageId,
      tokenDate: tokenDate,
      status: 'waiting',
      counter: null,
    }).sort({ sequenceNumber: 1 });

    for (let i = 0; i < unassignedWaiting.length; i++) {
      const token = unassignedWaiting[i];
      const position = i + 1;
      const estimatedWaitMinutes = i * DEFAULT_AVG_SERVICE_TIME;

      emitToUser(token.farmer.toString(), 'token_queue_update', {
        tokenId: token._id,
        tokenNumber: token.tokenNumber,
        coldStorageId,
        position,
        totalWaiting: unassignedWaiting.length,
        estimatedWaitMinutes,
        currentlyServing: null,
      });
    }
  } catch (error) {
    console.error('Error broadcasting queue update:', error);
  }
};

// ==================== TOKEN LIFECYCLE ====================

// Start serving a token
export const startServingToken = async (req, res) => {
  try {
    const { tokenId } = req.params;

    const token = await Token.findById(tokenId).populate('coldStorage');
    if (!token) {
      return res.status(404).json({ message: 'Token not found' });
    }

    if (
      token.coldStorage.owner.toString() !== req.user._id.toString() &&
      (!token.coldStorage.manager ||
        token.coldStorage.manager.toString() !== req.user._id.toString())
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (token.status !== 'called') {
      return res.status(400).json({ message: 'Token must be called first' });
    }

    token.status = 'in-service';
    token.serviceStartedAt = new Date();
    await token.save();

    // Update counter's active token
    if (token.counter) {
      await Counter.findByIdAndUpdate(token.counter, {
        activeTokenId: token._id,
      });
    }

    const inServiceData = {
      tokenId: token._id,
      tokenNumber: token.tokenNumber,
      counterNumber: token.counterNumber,
      coldStorageName: token.coldStorage.name,
      message: `आपकी सेवा शुरू हो गई है!`,
    };
    emitToUser(token.farmer.toString(), 'token_in_service', inServiceData);
    sendTokenPushNotification(token.farmer.toString(), 'token_in_service', inServiceData);

    const today = getTodayDate();
    await updateCounterQueueLengths(token.coldStorage._id.toString());
    await broadcastQueueUpdate(token.coldStorage._id.toString(), today);

    res.json({
      message: 'Service started',
      data: token,
    });
  } catch (error) {
    console.error('Error starting service:', error);
    res.status(500).json({ message: 'Failed to start service', error: error.message });
  }
};

// Complete a token
export const completeToken = async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { notes } = req.body;

    const token = await Token.findById(tokenId).populate('coldStorage');
    if (!token) {
      return res.status(404).json({ message: 'Token not found' });
    }

    if (
      token.coldStorage.owner.toString() !== req.user._id.toString() &&
      (!token.coldStorage.manager ||
        token.coldStorage.manager.toString() !== req.user._id.toString())
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    token.status = 'completed';
    token.completedAt = new Date();
    if (notes) token.notes = notes;
    await token.save();

    // Clear counter's active token
    if (token.counter) {
      await Counter.findByIdAndUpdate(token.counter, { activeTokenId: null });
    }

    const completedData = {
      tokenId: token._id,
      tokenNumber: token.tokenNumber,
      coldStorageName: token.coldStorage.name,
      message: `टोकन ${token.tokenNumber} की सेवा पूर्ण हो गई!`,
    };
    emitToUser(token.farmer.toString(), 'token_completed', completedData);
    sendTokenPushNotification(token.farmer.toString(), 'token_completed', completedData);

    const today = getTodayDate();
    await updateCounterQueueLengths(token.coldStorage._id.toString());
    await broadcastQueueUpdate(token.coldStorage._id.toString(), today);

    res.json({
      message: 'Token completed successfully',
      data: token,
    });
  } catch (error) {
    console.error('Error completing token:', error);
    res.status(500).json({ message: 'Failed to complete token', error: error.message });
  }
};

// Skip a token
export const skipToken = async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { reason } = req.body;

    const token = await Token.findById(tokenId).populate('coldStorage');
    if (!token) {
      return res.status(404).json({ message: 'Token not found' });
    }

    if (
      token.coldStorage.owner.toString() !== req.user._id.toString() &&
      (!token.coldStorage.manager ||
        token.coldStorage.manager.toString() !== req.user._id.toString())
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (!['waiting', 'called'].includes(token.status)) {
      return res.status(400).json({ message: 'Only waiting or called tokens can be skipped' });
    }

    token.status = 'skipped';
    token.notes = reason || 'Farmer not present';
    await token.save();

    await Notification.create({
      recipient: token.farmer,
      title: `⚠️ Token ${token.tokenNumber} Skipped`,
      message: `Your token ${token.tokenNumber} was skipped. Reason: ${token.notes}`,
      type: 'token_skipped',
      referenceId: token._id,
      referenceType: 'token',
      data: { tokenId: token._id },
    });

    const skippedData = {
      tokenId: token._id,
      tokenNumber: token.tokenNumber,
      reason: token.notes,
      coldStorageName: token.coldStorage.name,
      message: `आपका टोकन ${token.tokenNumber} छोड़ दिया गया। कारण: ${token.notes}`,
    };
    emitToUser(token.farmer.toString(), 'token_skipped', skippedData);
    sendTokenPushNotification(token.farmer.toString(), 'token_skipped', skippedData);

    emitToUser(token.coldStorage.owner.toString(), 'token_queue_updated', {
      coldStorageId: token.coldStorage._id.toString(),
      action: 'skipped',
      tokenNumber: token.tokenNumber,
    });

    const today = getTodayDate();
    await updateCounterQueueLengths(token.coldStorage._id.toString());
    await broadcastQueueUpdate(token.coldStorage._id.toString(), today);

    res.json({
      message: 'Token skipped',
      data: token,
    });
  } catch (error) {
    console.error('Error skipping token:', error);
    res.status(500).json({ message: 'Failed to skip token', error: error.message });
  }
};

// Re-queue a skipped token (with smart counter re-assignment)
export const requeueToken = async (req, res) => {
  try {
    const { tokenId } = req.params;

    const token = await Token.findById(tokenId).populate('coldStorage');
    if (!token) {
      return res.status(404).json({ message: 'Token not found' });
    }

    if (
      token.coldStorage.owner.toString() !== req.user._id.toString() &&
      (!token.coldStorage.manager ||
        token.coldStorage.manager.toString() !== req.user._id.toString())
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (token.status !== 'skipped') {
      return res.status(400).json({ message: 'Only skipped tokens can be re-queued' });
    }

    const today = getTodayDate();
    const { tokenNumber: newTokenNumber, sequenceNumber } = await Token.generateTokenNumber(
      token.coldStorage._id,
      today
    );

    // Re-assign to best counter
    const bestCounter = await assignToBestCounter(token.coldStorage._id, today);

    token.status = 'waiting';
    token.tokenNumber = newTokenNumber;
    token.sequenceNumber = sequenceNumber;
    token.counter = bestCounter._id;
    token.counterNumber = bestCounter.number;
    token.nearbyNotificationSent = false;
    token.calledNotificationSent = false;
    token.notes = (token.notes || '') + ' | Re-queued';
    await token.save();

    const position = await Token.getQueuePosition(token._id);
    token.positionInQueue = position;
    token.estimatedWaitMinutes = (position - 1) * bestCounter.averageServiceTime;
    token.estimatedStartTime = new Date(Date.now() + token.estimatedWaitMinutes * 60 * 1000);
    await token.save();

    await updateCounterQueueLengths(token.coldStorage._id.toString());

    const requeueData = {
      tokenId: token._id,
      tokenNumber: token.tokenNumber,
      position,
      estimatedWaitMinutes: token.estimatedWaitMinutes,
      counterNumber: bestCounter.number,
      counterName: bestCounter.name,
      coldStorageName: token.coldStorage.name,
      message: `आपका टोकन ${token.tokenNumber} पुनः ${bestCounter.name} पर लाइन में लगा दिया गया है।`,
    };
    emitToUser(token.farmer.toString(), 'token_issued', requeueData);
    sendTokenPushNotification(token.farmer.toString(), 'token_issued', requeueData);

    await broadcastQueueUpdate(token.coldStorage._id.toString(), today);

    res.json({
      message: 'Token re-queued successfully',
      data: { token, position, counterName: bestCounter.name },
    });
  } catch (error) {
    console.error('Error re-queuing token:', error);
    res.status(500).json({ message: 'Failed to re-queue token', error: error.message });
  }
};

// ==================== FOR FARMERS ====================

// Get my tokens (with per-counter position info)
export const getMyTokens = async (req, res) => {
  try {
    await autoExpireStaleTokens();

    const today = getTodayDate();

    const tokens = await Token.find({
      farmer: req.user._id,
      tokenDate: today,
    })
      .populate('coldStorage', 'name address phone')
      .populate('counter', 'number name averageServiceTime')
      .sort({ createdAt: -1 });

    const tokensWithPosition = await Promise.all(
      tokens.map(async (token) => {
        const tokenObj = token.toObject();

        // Add counter info
        if (token.counter) {
          tokenObj.counterName = token.counter.name;
          tokenObj.counterNumber = token.counter.number;
        }

        if (token.status === 'waiting') {
          tokenObj.position = await Token.getQueuePosition(token._id);
          const avgTime = token.counter
            ? token.counter.averageServiceTime
            : DEFAULT_AVG_SERVICE_TIME;
          tokenObj.estimatedWaitMinutes = (tokenObj.position - 1) * avgTime;
          tokenObj.estimatedStartTime = new Date(
            Date.now() + tokenObj.estimatedWaitMinutes * 60 * 1000
          );
        }

        // Get current serving at this counter
        if (token.counter && ['waiting', 'called'].includes(token.status)) {
          const serving = await Token.findOne({
            coldStorage: token.coldStorage._id || token.coldStorage,
            counter: token.counter._id || token.counter,
            tokenDate: today,
            status: { $in: ['called', 'in-service'] },
          }).sort({ sequenceNumber: 1 });

          if (serving) {
            tokenObj.currentlyServing = serving.tokenNumber;
          }
        }

        return tokenObj;
      })
    );

    res.json({
      data: tokensWithPosition,
    });
  } catch (error) {
    console.error('Error fetching my tokens:', error);
    res.status(500).json({ message: 'Failed to fetch tokens', error: error.message });
  }
};

// Get token status with live position
export const getTokenStatus = async (req, res) => {
  try {
    const { tokenId } = req.params;

    const token = await Token.findById(tokenId)
      .populate('coldStorage', 'name address phone')
      .populate('counter', 'number name averageServiceTime');

    if (!token) {
      return res.status(404).json({ message: 'Token not found' });
    }

    const coldStorage = await ColdStorage.findById(token.coldStorage._id);
    const isOwner = token.farmer.toString() === req.user._id.toString();
    const isColdStorageOwner = coldStorage.owner.toString() === req.user._id.toString();
    const isColdStorageManager =
      coldStorage.manager && coldStorage.manager.toString() === req.user._id.toString();

    if (!isOwner && !isColdStorageOwner && !isColdStorageManager) {
      return res.status(403).json({ message: 'Not authorized to view this token' });
    }

    const tokenData = token.toObject();

    if (token.counter) {
      tokenData.counterName = token.counter.name;
    }

    if (token.status === 'waiting') {
      tokenData.position = await Token.getQueuePosition(token._id);
      const avgTime = token.counter
        ? token.counter.averageServiceTime
        : DEFAULT_AVG_SERVICE_TIME;
      tokenData.estimatedWaitMinutes = (tokenData.position - 1) * avgTime;
      tokenData.estimatedStartTime = new Date(
        Date.now() + tokenData.estimatedWaitMinutes * 60 * 1000
      );

      const currentServing = await Token.findOne({
        coldStorage: token.coldStorage._id,
        counter: token.counter?._id,
        tokenDate: token.tokenDate,
        status: { $in: ['called', 'in-service'] },
      }).sort({ sequenceNumber: 1 });

      if (currentServing) {
        tokenData.currentlyServing = currentServing.tokenNumber;
      }
    }

    res.json({
      data: tokenData,
    });
  } catch (error) {
    console.error('Error fetching token status:', error);
    res.status(500).json({ message: 'Failed to fetch token status', error: error.message });
  }
};

// Request token — if counterId is provided, auto-issue directly into queue (waiting)
// Otherwise, create a pending request that needs owner approval
// Update my pending token request (farmer can edit before approval)
export const updateMyToken = async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { purpose, expectedQuantity, unit, remark } = req.body;

    const token = await Token.findById(tokenId);
    if (!token) {
      return res.status(404).json({ message: 'Token not found' });
    }

    if (token.farmer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (token.status !== 'pending') {
      return res.status(400).json({ message: 'Can only edit pending token requests' });
    }

    if (purpose) token.purpose = purpose;
    if (expectedQuantity !== undefined) token.expectedQuantity = expectedQuantity;
    if (unit) token.unit = unit;
    if (remark !== undefined) token.remark = remark;

    await token.save();
    await token.populate('coldStorage', 'name address phone');

    res.json({
      message: 'Token request updated successfully',
      data: token,
    });
  } catch (error) {
    console.error('Error updating token:', error);
    res.status(500).json({ message: 'Failed to update token', error: error.message });
  }
};

// Delete my pending token request (farmer can delete before approval)
export const deleteMyToken = async (req, res) => {
  try {
    const { tokenId } = req.params;

    const token = await Token.findById(tokenId);
    if (!token) {
      return res.status(404).json({ message: 'Token not found' });
    }

    if (token.farmer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (token.status !== 'pending') {
      return res.status(400).json({ message: 'Can only delete pending token requests' });
    }

    await Token.findByIdAndDelete(tokenId);

    const coldStorage = await ColdStorage.findById(token.coldStorage);
    if (coldStorage) {
      emitToUser(coldStorage.owner.toString(), 'token_queue_updated', {
        coldStorageId: token.coldStorage.toString(),
        action: 'deleted',
        tokenNumber: token.tokenNumber,
      });
    }

    res.json({
      message: 'Token request deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting token:', error);
    res.status(500).json({ message: 'Failed to delete token', error: error.message });
  }
};

export const requestToken = async (req, res) => {
  try {
    const { coldStorageId, purpose, expectedQuantity, potatoVariety, unit, counterId } = req.body;

    const coldStorage = await ColdStorage.findById(coldStorageId);
    if (!coldStorage) {
      return res.status(404).json({ message: 'Cold storage not found' });
    }

    const today = getTodayDate();
    const farmerName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
    const farmerPhone = req.user.phone || '';

    // If counterId provided → auto-issue directly into queue (no approval needed)
    if (counterId) {
      const assignedCounter = await Counter.findById(counterId);
      if (!assignedCounter || assignedCounter.coldStorage.toString() !== coldStorageId) {
        return res.status(400).json({ message: 'Invalid counter/lane' });
      }
      if (!assignedCounter.isActive) {
        return res.status(400).json({ message: 'This lane is currently inactive' });
      }

      // Generate token number
      const { tokenNumber, sequenceNumber } = await Token.generateTokenNumber(coldStorageId, today);

      // Calculate wait time at this counter
      const waitingAtCounter = await Token.countDocuments({
        counter: assignedCounter._id,
        tokenDate: today,
        status: { $in: ['waiting', 'called'] },
      });
      const estimatedWaitMinutes = waitingAtCounter * assignedCounter.averageServiceTime;
      const estimatedStartTime = new Date(Date.now() + estimatedWaitMinutes * 60 * 1000);

      const token = await Token.create({
        tokenNumber,
        sequenceNumber,
        coldStorage: coldStorageId,
        farmer: req.user._id,
        farmerName,
        farmerPhone,
        purpose: purpose || 'storage',
        expectedQuantity,
        unit: unit || 'Packet',
        potatoVariety,
        tokenDate: today,
        status: 'waiting',
        issuedAt: new Date(),
        estimatedWaitMinutes,
        estimatedStartTime,
        counter: assignedCounter._id,
        counterNumber: assignedCounter.number,
        positionInQueue: waitingAtCounter + 1,
      });

      await token.populate('coldStorage', 'name address phone');
      await updateCounterQueueLengths(coldStorageId);

      // Notify cold storage owner about auto-issued token
      const issuedData = {
        tokenId: token._id,
        tokenNumber: token.tokenNumber,
        position: waitingAtCounter + 1,
        estimatedWaitMinutes,
        counterNumber: assignedCounter.number,
        counterName: assignedCounter.name,
        coldStorageName: coldStorage.name,
        farmerName,
      };
      emitToUser(coldStorage.owner.toString(), 'token_queue_updated', {
        coldStorageId,
        action: 'auto_issued',
        farmerName,
        tokenNumber: token.tokenNumber,
        counterNumber: assignedCounter.number,
      });

      await broadcastQueueUpdate(coldStorageId, today);

      return res.status(201).json({
        message: 'Token issued successfully!',
        data: {
          token,
          position: waitingAtCounter + 1,
          estimatedWaitMinutes,
          counterNumber: assignedCounter.number,
          counterName: assignedCounter.name,
          autoIssued: true,
        },
      });
    }

    // No counterId → create PENDING token (needs owner approval)
    const { remark } = req.body;
    const token = await Token.create({
      coldStorage: coldStorageId,
      farmer: req.user._id,
      farmerName,
      farmerPhone,
      purpose: purpose || 'storage',
      expectedQuantity,
      unit: unit || 'Packet',
      potatoVariety,
      remark: remark || '',
      tokenDate: today,
      status: 'pending',
      requestedAt: new Date(),
    });

    await token.populate('coldStorage', 'name address phone');

    // Real-time: notify cold storage owner
    emitToUser(coldStorage.owner.toString(), 'token_request_pending', {
      tokenId: token._id,
      farmerId: req.user._id,
      farmerName,
      farmerPhone,
      purpose: purpose || 'storage',
      expectedQuantity,
      coldStorageId,
    });

    emitToUser(coldStorage.owner.toString(), 'token_queue_updated', {
      coldStorageId,
      action: 'new_request',
      farmerName,
    });

    res.status(201).json({
      message: 'Token request sent successfully! The cold storage owner will approve your request.',
      data: {
        token,
        autoIssued: false,
      },
    });
  } catch (error) {
    console.error('Error requesting token:', error);
    res.status(500).json({ message: 'Failed to request token', error: error.message });
  }
};

// Approve a pending token request (with smart counter assignment)
export const approveTokenRequest = async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { counterId } = req.body; // Optional: owner can specify counter

    const token = await Token.findById(tokenId).populate('coldStorage');
    if (!token) {
      return res.status(404).json({ message: 'Token request not found' });
    }

    if (
      token.coldStorage.owner.toString() !== req.user._id.toString() &&
      (!token.coldStorage.manager ||
        token.coldStorage.manager.toString() !== req.user._id.toString())
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (token.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be approved' });
    }

    const today = getTodayDate();

    // Generate token number FIRST (needed for odd/even assignment)
    const { tokenNumber, sequenceNumber } = await Token.generateTokenNumber(
      token.coldStorage._id,
      today
    );

    // Smart counter assignment using odd/even rule:
    //   Odd  sequence → A (1), C (3), E (5)  round-robin
    //   Even sequence → B (2), D (4)          round-robin
    let assignedCounter;
    if (counterId) {
      assignedCounter = await Counter.findById(counterId);
      if (!assignedCounter || assignedCounter.coldStorage.toString() !== token.coldStorage._id.toString()) {
        return res.status(400).json({ message: 'Invalid counter' });
      }
    } else {
      assignedCounter = await assignByOddEvenRule(token.coldStorage._id, sequenceNumber);
    }

    // Count waiting at this counter for position
    const waitingCount = await Token.countDocuments({
      counter: assignedCounter._id,
      tokenDate: today,
      status: { $in: ['waiting', 'called'] },
    });

    const estimatedWaitMinutes = waitingCount * assignedCounter.averageServiceTime;
    const estimatedStartTime = new Date(Date.now() + estimatedWaitMinutes * 60 * 1000);

    // Update token: pending → waiting with counter assignment
    token.tokenNumber = tokenNumber;
    token.sequenceNumber = sequenceNumber;
    token.status = 'waiting';
    token.issuedAt = new Date();
    token.counter = assignedCounter._id;
    token.counterNumber = assignedCounter.number;
    token.positionInQueue = waitingCount + 1;
    token.estimatedWaitMinutes = estimatedWaitMinutes;
    token.estimatedStartTime = estimatedStartTime;
    await token.save();

    // Update counter queue lengths
    await updateCounterQueueLengths(token.coldStorage._id.toString());

    // Notification for farmer
    await Notification.create({
      recipient: token.farmer,
      title: `🎫 Token Approved! ${tokenNumber}`,
      message: `Your token ${tokenNumber} has been approved at ${token.coldStorage.name}. ${assignedCounter.name} — Position: ${waitingCount + 1}`,
      type: 'token_issued',
      referenceId: token._id,
      referenceType: 'token',
      data: {
        tokenId: token._id,
        coldStorageId: token.coldStorage._id,
        tokenNumber,
        position: waitingCount + 1,
        counterNumber: assignedCounter.number,
        counterName: assignedCounter.name,
      },
    });

    const approvedData = {
      tokenId: token._id,
      tokenNumber,
      position: waitingCount + 1,
      estimatedWaitMinutes,
      counterNumber: assignedCounter.number,
      counterName: assignedCounter.name,
      coldStorageName: token.coldStorage.name,
      message: `आपका टोकन स्वीकृत हो गया! टोकन: ${tokenNumber}, ${assignedCounter.name}, स्थिति: ${waitingCount + 1}`,
    };
    emitToUser(token.farmer.toString(), 'token_issued', approvedData);
    sendTokenPushNotification(token.farmer.toString(), 'token_issued', approvedData);

    await broadcastQueueUpdate(token.coldStorage._id.toString(), today);

    res.json({
      message: 'Token approved successfully',
      data: {
        token,
        position: waitingCount + 1,
        estimatedWaitMinutes,
        counterNumber: assignedCounter.number,
        counterName: assignedCounter.name,
      },
    });
  } catch (error) {
    console.error('Error approving token request:', error);
    res.status(500).json({ message: 'Failed to approve token request', error: error.message });
  }
};

// Reject a pending token request
export const rejectTokenRequest = async (req, res) => {
  try {
    const { tokenId } = req.params;
    const { reason } = req.body;

    const token = await Token.findById(tokenId).populate('coldStorage');
    if (!token) {
      return res.status(404).json({ message: 'Token request not found' });
    }

    if (
      token.coldStorage.owner.toString() !== req.user._id.toString() &&
      (!token.coldStorage.manager ||
        token.coldStorage.manager.toString() !== req.user._id.toString())
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (token.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be rejected' });
    }

    token.status = 'rejected';
    token.notes = reason || 'Request rejected by cold storage owner';
    await token.save();

    const rejectedData = {
      tokenId: token._id,
      reason: token.notes,
      coldStorageName: token.coldStorage.name,
      message: `आपका टोकन अनुरोध अस्वीकार कर दिया गया। कारण: ${token.notes}`,
    };
    emitToUser(token.farmer.toString(), 'token_rejected', rejectedData);
    sendTokenPushNotification(token.farmer.toString(), 'token_rejected', rejectedData);

    res.json({
      message: 'Token request rejected',
      data: token,
    });
  } catch (error) {
    console.error('Error rejecting token request:', error);
    res.status(500).json({ message: 'Failed to reject token request', error: error.message });
  }
};

// Cancel my token
export const cancelMyToken = async (req, res) => {
  try {
    const { tokenId } = req.params;

    const token = await Token.findById(tokenId);
    if (!token) {
      return res.status(404).json({ message: 'Token not found' });
    }

    if (token.farmer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (!['pending', 'waiting', 'called'].includes(token.status)) {
      return res.status(400).json({ message: 'Cannot cancel token in current status' });
    }

    token.status = 'cancelled';
    await token.save();

    const coldStorage = await ColdStorage.findById(token.coldStorage);
    if (coldStorage) {
      emitToUser(coldStorage.owner.toString(), 'token_queue_updated', {
        coldStorageId: token.coldStorage.toString(),
        action: 'cancelled',
        tokenNumber: token.tokenNumber,
      });
    }

    const today = getTodayDate();
    await updateCounterQueueLengths(token.coldStorage.toString());
    await broadcastQueueUpdate(token.coldStorage.toString(), today);

    res.json({
      message: 'Token cancelled successfully',
      data: token,
    });
  } catch (error) {
    console.error('Error cancelling token:', error);
    res.status(500).json({ message: 'Failed to cancel token', error: error.message });
  }
};

// Get queue info for a cold storage (public — with per-counter breakdown)
export const getPublicQueueInfo = async (req, res) => {
  try {
    const { coldStorageId } = req.params;
    const today = getTodayDate();

    const waitingCount = await Token.countDocuments({
      coldStorage: coldStorageId,
      tokenDate: today,
      status: 'waiting',
    });

    const currentServing = await Token.findOne({
      coldStorage: coldStorageId,
      tokenDate: today,
      status: { $in: ['called', 'in-service'] },
    }).sort({ sequenceNumber: 1 });

    const queueList = await Token.find({
      coldStorage: coldStorageId,
      tokenDate: today,
      status: 'waiting',
    })
      .sort({ sequenceNumber: 1 })
      .select('tokenNumber sequenceNumber farmerName status farmer counter counterNumber');

    const queueIndex = queueList.map((t, i) => ({
      position: i + 1,
      tokenNumber: t.tokenNumber,
      farmerName: t.farmerName,
      farmerId: t.farmer?.toString() || null,
      counterNumber: t.counterNumber,
    }));

    const completedCount = await Token.countDocuments({
      coldStorage: coldStorageId,
      tokenDate: today,
      status: 'completed',
    });

    // Get counters info
    const counters = await Counter.find({ coldStorage: coldStorageId, isActive: true }).sort({
      number: 1,
    });

    const counterInfo = await Promise.all(
      counters.map(async (counter) => {
        const counterWaiting = await Token.countDocuments({
          counter: counter._id,
          tokenDate: today,
          status: 'waiting',
        });
        const counterServing = await Token.findOne({
          counter: counter._id,
          tokenDate: today,
          status: { $in: ['called', 'in-service'] },
        });
        return {
          _id: counter._id,
          number: counter.number,
          name: counter.name,
          isActive: counter.isActive,
          averageServiceTime: counter.averageServiceTime,
          waitingCount: counterWaiting,
          estimatedWait: counterWaiting * counter.averageServiceTime,
          currentlyServing: counterServing
            ? { tokenNumber: counterServing.tokenNumber, status: counterServing.status }
            : null,
        };
      })
    );

    res.json({
      data: {
        waitingCount,
        completedCount,
        estimatedWaitMinutes: waitingCount * DEFAULT_AVG_SERVICE_TIME,
        currentlyServing: currentServing
          ? {
              tokenNumber: currentServing.tokenNumber,
              farmerName: currentServing.farmerName,
              status: currentServing.status,
              counterNumber: currentServing.counterNumber,
            }
          : null,
        queueIndex,
        counters: counterInfo,
        totalCounters: counters.length,
        isQueueOpen: true,
      },
    });
  } catch (error) {
    console.error('Error fetching queue info:', error);
    res.status(500).json({ message: 'Failed to fetch queue info', error: error.message });
  }
};
