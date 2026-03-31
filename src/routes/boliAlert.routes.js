import { Router } from "express";
import { verifyJWT, optionalAuth } from "../middleware/auth.middleware.js";
import {
    createBoliAlert,
    getAllActiveBoliAlerts,
    getBoliAlertsByColdStorage,
    getMyBoliAlerts,
    updateBoliAlert,
    deleteBoliAlert,
    getUpcomingBoliAlertsForNotification,
    markAlertSent
} from "../controller/boliAlert.controller.js";

const router = Router();

// Public routes (anyone can view boli alerts)
router.get("/", optionalAuth, getAllActiveBoliAlerts);
router.get("/cold-storage/:coldStorageId", getBoliAlertsByColdStorage);
router.get("/upcoming", getUpcomingBoliAlertsForNotification);

// Protected routes (need authentication)
router.use(verifyJWT);

router.post("/create", createBoliAlert);
router.get("/my", getMyBoliAlerts);
router.put("/:alertId", updateBoliAlert);
router.delete("/:alertId", deleteBoliAlert);
router.post("/:alertId/mark-sent", markAlertSent);

export default router;
