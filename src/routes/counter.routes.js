import { Router } from 'express';
import { Counter } from '../models/counter.model.js';
import { ColdStorage } from '../models/coldStorage.model.js';
import { Token } from '../models/token.model.js';
import { verifyJWT } from '../middleware/auth.middleware.js';

const router = Router();

// Helper to check ownership
const checkOwnership = async (coldStorageId, userId) => {
  const cs = await ColdStorage.findById(coldStorageId);
  if (!cs) return { error: 'Cold storage not found', status: 404 };
  const isOwner = cs.owner.toString() === userId.toString();
  const isManager = cs.manager && cs.manager.toString() === userId.toString();
  if (!isOwner && !isManager) return { error: 'Not authorized', status: 403 };
  return { coldStorage: cs };
};

// GET /api/v1/counters/:coldStorageId — Get all counters for a cold storage
router.get('/:coldStorageId', verifyJWT, async (req, res) => {
  try {
    const { coldStorageId } = req.params;
    const ownership = await checkOwnership(coldStorageId, req.user._id);
    if (ownership.error) {
      return res.status(ownership.status).json({ message: ownership.error });
    }

    const counters = await Counter.find({ coldStorage: coldStorageId })
      .sort({ number: 1 })
      .populate('activeTokenId', 'tokenNumber farmerName status');

    // Auto-rename counters with numeric-only names to letter names (A, B, C...)
    const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    for (const counter of counters) {
      const shouldRename =
        /^\d+$/.test(counter.name) ||
        /^Counter \d+$/.test(counter.name);
      if (shouldRename && counter.number <= LETTERS.length) {
        counter.name = `Counter ${LETTERS[counter.number - 1]}`;
        await counter.save();
      }
    }

    // Recalculate queue lengths for accuracy
    for (const counter of counters) {
      await Counter.recalculateQueueLength(counter._id);
    }

    // Re-fetch after recalculation
    const freshCounters = await Counter.find({ coldStorage: coldStorageId })
      .sort({ number: 1 })
      .populate('activeTokenId', 'tokenNumber farmerName status');

    res.json({
      data: { counters: freshCounters },
    });
  } catch (error) {
    console.error('Error fetching counters:', error);
    res.status(500).json({ message: 'Failed to fetch counters', error: error.message });
  }
});

// POST /api/v1/counters/:coldStorageId — Create a new counter
router.post('/:coldStorageId', verifyJWT, async (req, res) => {
  try {
    const { coldStorageId } = req.params;
    const { name, averageServiceTime } = req.body;

    const ownership = await checkOwnership(coldStorageId, req.user._id);
    if (ownership.error) {
      return res.status(ownership.status).json({ message: ownership.error });
    }

    // Get next counter number
    const COUNTER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const lastCounter = await Counter.findOne({ coldStorage: coldStorageId })
      .sort({ number: -1 });
    const nextNumber = lastCounter ? lastCounter.number + 1 : 1;
    const defaultName = nextNumber <= COUNTER_LETTERS.length
      ? `Counter ${COUNTER_LETTERS[nextNumber - 1]}`
      : `Counter ${nextNumber}`;

    const counter = await Counter.create({
      coldStorage: coldStorageId,
      number: nextNumber,
      name: name || defaultName,
      averageServiceTime: averageServiceTime || 10,
      isActive: true,
    });

    res.status(201).json({
      message: 'Counter created successfully',
      data: { counter },
    });
  } catch (error) {
    console.error('Error creating counter:', error);
    res.status(500).json({ message: 'Failed to create counter', error: error.message });
  }
});

// PUT /api/v1/counters/update/:counterId — Update a counter
router.put('/update/:counterId', verifyJWT, async (req, res) => {
  try {
    const { counterId } = req.params;
    const { name, averageServiceTime, isActive } = req.body;

    const counter = await Counter.findById(counterId);
    if (!counter) {
      return res.status(404).json({ message: 'Counter not found' });
    }

    const ownership = await checkOwnership(counter.coldStorage, req.user._id);
    if (ownership.error) {
      return res.status(ownership.status).json({ message: ownership.error });
    }

    if (name !== undefined) counter.name = name;
    if (averageServiceTime !== undefined) counter.averageServiceTime = averageServiceTime;
    if (isActive !== undefined) counter.isActive = isActive;
    await counter.save();

    res.json({
      message: 'Counter updated successfully',
      data: { counter },
    });
  } catch (error) {
    console.error('Error updating counter:', error);
    res.status(500).json({ message: 'Failed to update counter', error: error.message });
  }
});

// DELETE /api/v1/counters/delete/:counterId — Delete a counter
router.delete('/delete/:counterId', verifyJWT, async (req, res) => {
  try {
    const { counterId } = req.params;

    const counter = await Counter.findById(counterId);
    if (!counter) {
      return res.status(404).json({ message: 'Counter not found' });
    }

    const ownership = await checkOwnership(counter.coldStorage, req.user._id);
    if (ownership.error) {
      return res.status(ownership.status).json({ message: ownership.error });
    }

    // Check if there are active tokens at this counter
    const today = new Date();
    const tokenDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const activeTokens = await Token.countDocuments({
      counter: counterId,
      tokenDate,
      status: { $in: ['waiting', 'called', 'in-service'] },
    });

    if (activeTokens > 0) {
      return res.status(400).json({
        message: `Cannot delete counter with ${activeTokens} active token(s). Transfer or complete them first.`,
      });
    }

    await Counter.findByIdAndDelete(counterId);

    res.json({ message: 'Counter deleted successfully' });
  } catch (error) {
    console.error('Error deleting counter:', error);
    res.status(500).json({ message: 'Failed to delete counter', error: error.message });
  }
});

// POST /api/v1/counters/:coldStorageId/setup-default — Ensure default counters exist
router.post('/:coldStorageId/setup-default', verifyJWT, async (req, res) => {
  try {
    const { coldStorageId } = req.params;
    const { count = 3 } = req.body; // Default 3 counters

    const ownership = await checkOwnership(coldStorageId, req.user._id);
    if (ownership.error) {
      return res.status(ownership.status).json({ message: ownership.error });
    }

    const existing = await Counter.find({ coldStorage: coldStorageId });
    if (existing.length > 0) {
      return res.json({
        message: 'Counters already exist',
        data: { counters: existing },
      });
    }

    const COUNTER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const counters = [];
    for (let i = 1; i <= Math.min(count, 10); i++) {
      const letterName = i <= COUNTER_LETTERS.length
        ? `Counter ${COUNTER_LETTERS[i - 1]}`
        : `Counter ${i}`;
      const counter = await Counter.create({
        coldStorage: coldStorageId,
        number: i,
        name: letterName,
        averageServiceTime: 10,
        isActive: true,
      });
      counters.push(counter);
    }

    res.status(201).json({
      message: `${counters.length} counters created successfully`,
      data: { counters },
    });
  } catch (error) {
    console.error('Error setting up counters:', error);
    res.status(500).json({ message: 'Failed to setup counters', error: error.message });
  }
});

export default router;
