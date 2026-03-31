import express from "express";
import { TraderRequest } from "../models/traderRequest.model.js";
import { User } from "../models/user.model.js";
import { Notification } from "../models/notification.model.js";
import { emitToUser } from "../config/socket.js";
import { authMiddleware } from "../middleware/auth.middleware.js";

const router = express.Router();

// Get my requests (for traders) - MUST be before /:id route
router.get("/user/my", authMiddleware, async (req, res) => {
    try {
        const requests = await TraderRequest.find({ 
            trader: req.user._id,
            status: { $ne: "cancelled" }
        })
            .populate("responses.farmer", "firstName lastName phone")
            .sort({ createdAt: -1 });
        
        res.status(200).json({
            success: true,
            data: { requests }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get requests where logged-in farmer has responded (My Offers for farmers)
router.get("/farmer/my-responses", authMiddleware, async (req, res) => {
    try {
        const farmerId = req.user._id;
        
        // Find all requests that have a response from this farmer
        const requests = await TraderRequest.find({
            "responses.farmer": farmerId,
            status: { $ne: "cancelled" }
        })
            .populate("trader", "firstName lastName phone role address")
            .populate("responses.farmer", "firstName lastName phone")
            .sort({ createdAt: -1 });
        
        // For each request, extract only this farmer's response info
        const enrichedRequests = requests.map(req => {
            const reqObj = req.toObject();
            const myResponse = reqObj.responses.find(
                r => r.farmer && r.farmer._id.toString() === farmerId.toString()
            );
            return {
                ...reqObj,
                myResponse: myResponse || null,
            };
        });
        
        res.status(200).json({
            success: true,
            data: { requests: enrichedRequests }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Farmer withdraws/deletes their own response from a request
router.delete("/:id/my-response", authMiddleware, async (req, res) => {
    try {
        const farmerId = req.user._id;
        const request = await TraderRequest.findById(req.params.id);
        
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }
        
        const responseIndex = request.responses.findIndex(
            r => r.farmer.toString() === farmerId.toString()
        );
        
        if (responseIndex === -1) {
            return res.status(404).json({ 
                success: false, 
                message: "You have not responded to this request" 
            });
        }
        
        // Only allow withdrawal if response is still pending
        const response = request.responses[responseIndex];
        if (response.status === "accepted") {
            return res.status(400).json({
                success: false,
                message: "Cannot withdraw an accepted response"
            });
        }
        
        request.responses.splice(responseIndex, 1);
        await request.save();
        
        res.status(200).json({
            success: true,
            message: "Your response has been withdrawn successfully"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get all open requests (for farmers to see)
router.get("/", async (req, res) => {
    try {
        const { limit = 20, page = 1 } = req.query;
        
        const requests = await TraderRequest.find({ 
            status: "open", 
            isActive: true,
            expiresAt: { $gt: new Date() }
        })
            .populate("trader", "firstName lastName phone role address")
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));
        
        const total = await TraderRequest.countDocuments({ 
            status: "open", 
            isActive: true 
        });
        
        res.status(200).json({
            success: true,
            data: { requests, total }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get single request
router.get("/:id", async (req, res) => {
    try {
        const request = await TraderRequest.findById(req.params.id)
            .populate("trader", "firstName lastName phone role address")
            .populate("responses.farmer", "firstName lastName phone");
        
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }
        
        res.status(200).json({ success: true, data: { request } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Create request (traders only)
router.post("/create", authMiddleware, async (req, res) => {
    try {
        // Check if user is a trader
        if (req.user.role !== "trader") {
            return res.status(403).json({ 
                success: false, 
                message: "Only traders can create buy requests" 
            });
        }
        
        const { 
            potatoVariety, 
            potatoType,
            quantity, 
            maxPricePerQuintal, 
            description,
            qualityGrade,
            deliveryLocation,
            requiredByDate,
            targetFarmerId
        } = req.body;
        
        const request = await TraderRequest.create({
            trader: req.user._id,
            targetFarmer: targetFarmerId || null,
            potatoVariety,
            potatoType: potatoType || "Any",
            quantity,
            maxPricePerQuintal,
            description,
            qualityGrade: qualityGrade || "Any",
            deliveryLocation,
            requiredByDate
        });
        
        await request.populate("trader", "firstName lastName phone");
        
        res.status(201).json({
            success: true,
            message: "Buy request created successfully",
            data: { request }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Farmer responds to a request
router.post("/:id/respond", authMiddleware, async (req, res) => {
    try {
        // Check if user is a farmer
        if (req.user.role !== "farmer") {
            return res.status(403).json({ 
                success: false, 
                message: "Only farmers can respond to buy requests" 
            });
        }
        
        const { message, offeredPrice, offeredQuantity } = req.body;
        
        const request = await TraderRequest.findById(req.params.id);
        
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }
        
        if (request.status !== "open") {
            return res.status(400).json({ 
                success: false, 
                message: "This request is no longer open" 
            });
        }
        
        // Check if farmer already responded
        const existingResponse = request.responses.find(
            r => r.farmer.toString() === req.user._id.toString()
        );
        
        if (existingResponse) {
            return res.status(400).json({ 
                success: false, 
                message: "You have already responded to this request" 
            });
        }
        
        request.responses.push({
            farmer: req.user._id,
            message,
            offeredPrice,
            offeredQuantity: offeredQuantity || request.quantity
        });
        
        await request.save();
        await request.populate("responses.farmer", "firstName lastName phone");
        
        // Create notification for the trader
        const farmer = await User.findById(req.user._id).select("firstName lastName");
        const farmerName = farmer ? `${farmer.firstName} ${farmer.lastName}` : "A farmer";
        
        try {
            const notification = await Notification.create({
                recipient: request.trader,
                sender: req.user._id,
                type: 'buy_request_response',
                title: 'New Response to Buy Request',
                message: `${farmerName} has responded to your buy request for ${request.potatoVariety}`,
                referenceId: request._id,
                referenceType: 'traderRequest',
                data: {
                    requestId: request._id,
                    potatoVariety: request.potatoVariety,
                    offeredPrice,
                    offeredQuantity: offeredQuantity || request.quantity,
                    farmerName,
                },
            });
            
            // Emit socket event to trader in real-time
            emitToUser(request.trader.toString(), 'buy_request_response', {
                notification: notification.toObject(),
                requestId: request._id,
                potatoVariety: request.potatoVariety,
                farmerName,
                offeredPrice,
                offeredQuantity: offeredQuantity || request.quantity,
            });
        } catch (notifError) {
            console.error("Failed to create buy request notification:", notifError);
            // Don't fail the response if notification fails
        }
        
        res.status(200).json({
            success: true,
            message: "Response submitted successfully",
            data: { request }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Trader accepts/rejects a farmer's response
router.patch("/:id/response/:responseId", authMiddleware, async (req, res) => {
    try {
        const { status } = req.body; // 'accepted' or 'rejected'
        
        const request = await TraderRequest.findById(req.params.id);
        
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }
        
        if (request.trader.toString() !== req.user._id.toString()) {
            return res.status(403).json({ 
                success: false, 
                message: "Only the request creator can accept/reject responses" 
            });
        }
        
        const response = request.responses.id(req.params.responseId);
        
        if (!response) {
            return res.status(404).json({ success: false, message: "Response not found" });
        }
        
        response.status = status;
        
        // If accepted, mark request as fulfilled
        if (status === "accepted") {
            request.status = "fulfilled";
        }
        
        await request.save();
        await request.populate("responses.farmer", "firstName lastName phone");
        
        res.status(200).json({
            success: true,
            message: `Response ${status} successfully`,
            data: { request }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update request
router.patch("/:id", authMiddleware, async (req, res) => {
    try {
        const request = await TraderRequest.findById(req.params.id);
        
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }
        
        if (request.trader.toString() !== req.user._id.toString()) {
            return res.status(403).json({ 
                success: false, 
                message: "You can only update your own requests" 
            });
        }
        
        // Only allow editing open requests
        if (request.status !== "open") {
            return res.status(400).json({ 
                success: false, 
                message: "Only open requests can be edited" 
            });
        }

        const allowedUpdates = [
            "potatoVariety", "potatoType", "quantity", 
            "maxPricePerQuintal", "description", "qualityGrade",
            "size", "deliveryLocation", "requiredByDate", "status", "isActive"
        ];
        
        Object.keys(req.body).forEach(key => {
            if (allowedUpdates.includes(key)) {
                request[key] = req.body[key];
            }
        });
        
        await request.save();
        
        res.status(200).json({
            success: true,
            message: "Request updated successfully",
            data: { request }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete/Cancel request
router.delete("/:id", authMiddleware, async (req, res) => {
    try {
        const request = await TraderRequest.findById(req.params.id);
        
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }
        
        if (request.trader.toString() !== req.user._id.toString()) {
            return res.status(403).json({ 
                success: false, 
                message: "You can only delete your own requests" 
            });
        }
        
        await TraderRequest.findByIdAndDelete(req.params.id);
        
        res.status(200).json({
            success: true,
            message: "Request deleted successfully"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

export { router };
