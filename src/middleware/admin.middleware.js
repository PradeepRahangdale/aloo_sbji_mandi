import { User } from "../models/user.model.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Middleware to check if user is admin
const isAdmin = asyncHandler(async (req, res, next) => {
    const userId = req.user?._id;

    if (!userId) {
        return res.status(401).json(
            new ApiResponse(401, null, "Authentication required")
        );
    }

    const user = await User.findById(userId);

    if (!user) {
        return res.status(401).json(
            new ApiResponse(401, null, "User not found")
        );
    }

    // Allow both 'admin' and 'master' roles
    if (user.role !== "admin" && user.role !== "master") {
        return res.status(403).json(
            new ApiResponse(403, null, "Admin access required")
        );
    }

    next();
});

export { isAdmin };
