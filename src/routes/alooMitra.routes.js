import { Router } from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import {
    getAlooMitraProfile,
    updateAlooMitraProfile,
    getAlooMitraStats,
    getServiceProviders,
    sendEnquiry,
    getReceivedEnquiries,
} from "../controller/alooMitra.controller.js";

const router = Router();

// Protected routes (require authentication)
router.use(verifyJWT);

// Profile routes
router.get("/profile", getAlooMitraProfile);
router.put("/profile", updateAlooMitraProfile);

// Stats
router.get("/stats", getAlooMitraStats);

// Service Providers listing (for farmers/traders to browse)
router.get("/providers", getServiceProviders);

// Enquiry routes
router.post("/enquiry", sendEnquiry);
router.get("/enquiries", getReceivedEnquiries);

export default router;
