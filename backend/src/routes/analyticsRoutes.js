import { Router } from "express";
import { endSession, heartbeatSession, startSession } from "../controllers/analyticsController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();
router.use(requireAuth);
router.post("/session/start", startSession);
router.post("/session/heartbeat", heartbeatSession);
router.post("/session/end", endSession);

export default router;
