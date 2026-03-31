import Transaction from "../models/transaction.model.js";

// Create a new transaction
export const createTransaction = async (req, res) => {
    try {
        const userId = req.user._id;
        const {
            transactionId,
            type,
            amount,
            currency,
            status,
            paymentMethod,
            description,
            metadata
        } = req.body;

        const transaction = new Transaction({
            userId,
            transactionId: transactionId || `TXN${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
            type,
            amount,
            currency: currency || 'INR',
            status: status || 'pending',
            paymentMethod,
            description,
            metadata
        });

        await transaction.save();

        res.status(201).json({
            success: true,
            message: 'Transaction created successfully',
            data: transaction
        });
    } catch (error) {
        console.error('Create transaction error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create transaction',
            error: error.message
        });
    }
};

// Get user's transaction history
export const getTransactionHistory = async (req, res) => {
    try {
        const userId = req.user._id;
        const { page = 1, limit = 20, status, type, startDate, endDate } = req.query;

        const query = { userId };

        // Apply filters
        if (status) {
            query.status = status;
        }
        if (type) {
            query.type = type;
        }
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) {
                query.createdAt.$gte = new Date(startDate);
            }
            if (endDate) {
                query.createdAt.$lte = new Date(endDate);
            }
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const transactions = await Transaction.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Transaction.countDocuments(query);

        // Calculate summary
        const successfulTransactions = await Transaction.aggregate([
            { $match: { userId, status: 'success' } },
            { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);

        const summary = {
            totalAmount: successfulTransactions[0]?.total || 0,
            totalCount: successfulTransactions[0]?.count || 0
        };

        res.status(200).json({
            success: true,
            data: {
                transactions,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / parseInt(limit)),
                    totalItems: total,
                    itemsPerPage: parseInt(limit)
                },
                summary
            }
        });
    } catch (error) {
        console.error('Get transaction history error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transaction history',
            error: error.message
        });
    }
};

// Get single transaction details
export const getTransactionById = async (req, res) => {
    try {
        const userId = req.user._id;
        const { transactionId } = req.params;

        const transaction = await Transaction.findOne({
            $or: [
                { _id: transactionId, userId },
                { transactionId: transactionId, userId }
            ]
        });

        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }

        res.status(200).json({
            success: true,
            data: transaction
        });
    } catch (error) {
        console.error('Get transaction error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transaction',
            error: error.message
        });
    }
};

// Update transaction status
export const updateTransactionStatus = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const { status, failureReason, metadata } = req.body;

        const transaction = await Transaction.findOneAndUpdate(
            { transactionId },
            {
                status,
                failureReason,
                ...(metadata && { $set: { metadata } })
            },
            { new: true }
        );

        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Transaction updated successfully',
            data: transaction
        });
    } catch (error) {
        console.error('Update transaction error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update transaction',
            error: error.message
        });
    }
};

// Get transaction summary/stats
export const getTransactionStats = async (req, res) => {
    try {
        const userId = req.user._id;

        const stats = await Transaction.aggregate([
            { $match: { userId } },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' }
                }
            }
        ]);

        const byType = await Transaction.aggregate([
            { $match: { userId, status: 'success' } },
            {
                $group: {
                    _id: '$type',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' }
                }
            }
        ]);

        const recentTransactions = await Transaction.find({ userId })
            .sort({ createdAt: -1 })
            .limit(5);

        res.status(200).json({
            success: true,
            data: {
                byStatus: stats,
                byType,
                recentTransactions
            }
        });
    } catch (error) {
        console.error('Get transaction stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transaction stats',
            error: error.message
        });
    }
};
