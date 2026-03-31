import { Router } from 'express';
import {
  approveTokenRequest,
  callNextToken,
  cancelMyToken,
  completeToken,
  deleteMyToken,
  getMyTokens,
  getPublicQueueInfo,
  getTokenQueue,
  getTokenStatus,
  issueToken,
  rejectTokenRequest,
  requestToken,
  requeueToken,
  skipToken,
  startServingToken,
  transferToken,
  updateMyToken,
} from '../controller/token.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';

const router = Router();

// ==================== PUBLIC ROUTES ====================
// Get queue info for a cold storage (no auth needed)
router.get('/queue-info/:coldStorageId', getPublicQueueInfo);

// ==================== FARMER ROUTES ====================
// Request a token (sends pending request to cold storage owner)
router.post('/request', verifyJWT, requestToken);

// Get my tokens for today
router.get('/my-tokens', verifyJWT, getMyTokens);

// Get specific token status
router.get('/status/:tokenId', verifyJWT, getTokenStatus);

// Cancel my token
router.patch('/cancel/:tokenId', verifyJWT, cancelMyToken);

// Update my pending token request
router.patch('/update/:tokenId', verifyJWT, updateMyToken);

// Delete my pending token request (PATCH used because some reverse proxies block DELETE)
router.patch('/delete/:tokenId', verifyJWT, deleteMyToken);

// ==================== COLD STORAGE OWNER ROUTES ====================
// Issue token to a farmer
router.post('/issue/:coldStorageId', verifyJWT, issueToken);

// Get today's queue for a cold storage
router.get('/queue/:coldStorageId', verifyJWT, getTokenQueue);

// Call next token
router.post('/call-next/:coldStorageId', verifyJWT, callNextToken);

// Start serving a token
router.patch('/start-service/:tokenId', verifyJWT, startServingToken);

// Complete a token
router.patch('/complete/:tokenId', verifyJWT, completeToken);

// Skip a token
router.patch('/skip/:tokenId', verifyJWT, skipToken);

// Re-queue a skipped token
router.patch('/requeue/:tokenId', verifyJWT, requeueToken);

// Approve a pending token request
router.patch('/approve/:tokenId', verifyJWT, approveTokenRequest);

// Reject a pending token request
router.patch('/reject/:tokenId', verifyJWT, rejectTokenRequest);

// Transfer a token to a different counter
router.patch('/transfer/:tokenId', verifyJWT, transferToken);

export default router;
