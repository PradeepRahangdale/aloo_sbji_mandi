import jwt from 'jsonwebtoken';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Master phone number - cannot be deleted or changed
const MASTER_PHONE = '8112363785';

const authMiddleware = asyncHandler(async (req, res, next) => {
  try {
    const incomingToken = req.headers.authorization?.split(' ')[1];

    if (!incomingToken || incomingToken == 'undefined')
      throw new ApiError(401, 'Unauthrized: token not provide');

    const decode = await jwt.verify(incomingToken, process.env.ACCESS_TOKEN_SECRET);

    const user = await User.findById({ _id: decode._id });

    if (!user) throw new ApiError(404, 'Unauthrized: User not Found ');

    req.user = user;

    next();
  } catch (error) {
    console.log(error?.message || 'Something went wrong while creating Token');
    next(error);
  }
});

// Optional auth - doesn't require token but attaches user if present
const optionalAuth = asyncHandler(async (req, res, next) => {
  try {
    const incomingToken = req.headers.authorization?.split(' ')[1];

    if (incomingToken && incomingToken !== 'undefined') {
      const decode = await jwt.verify(incomingToken, process.env.ACCESS_TOKEN_SECRET);
      const user = await User.findById({ _id: decode._id });
      if (user) {
        req.user = user;
      }
    }
    next();
  } catch (error) {
    // Token invalid but we continue without user
    next();
  }
});

// Middleware: Only master can access
const masterOnly = asyncHandler(async (req, res, next) => {
  if (!req.user) throw new ApiError(401, 'Unauthorized: Please login first');
  if (req.user.role !== 'master' && req.user.phone !== MASTER_PHONE) {
    throw new ApiError(403, 'Access denied: Only master can perform this action');
  }
  next();
});

// Middleware: Master or Admin can access
const adminOrMaster = asyncHandler(async (req, res, next) => {
  if (!req.user) throw new ApiError(401, 'Unauthorized: Please login first');
  if (req.user.role !== 'master' && req.user.role !== 'admin' && req.user.phone !== MASTER_PHONE) {
    throw new ApiError(403, 'Access denied: Only admin or master can perform this action');
  }
  next();
});

// Helper: Check if user is master
const isMaster = (user) => {
  return user && (user.role === 'master' || user.phone === MASTER_PHONE);
};

export {
  adminOrMaster,
  authMiddleware,
  isMaster,
  MASTER_PHONE,
  masterOnly,
  optionalAuth,
  authMiddleware as verifyJWT,
};
