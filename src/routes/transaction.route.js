import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import {
    createTransaction,
    getTransactionHistory,
    getTransactionById,
    updateTransactionStatus,
    getTransactionStats
} from "../controller/transaction.controller.js";

const router = express.Router();

// All routes require authentication
router.use(verifyJWT);

// Create a new transaction
router.post("/", createTransaction);

// Get user's transaction history
router.get("/", getTransactionHistory);

// Get transaction stats/summary
router.get("/stats", getTransactionStats);

// Get single transaction by ID
router.get("/:transactionId", getTransactionById);

// Update transaction status (for webhook callbacks)
router.patch("/:transactionId/status", updateTransactionStatus);

export default router;
