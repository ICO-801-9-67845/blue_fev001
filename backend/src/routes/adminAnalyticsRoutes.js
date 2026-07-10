import { Router } from "express";
import {
  activeUsers,
  recentSessions,
  summary,
  trends,
} from "../controllers/adminAnalyticsController.js";
import { requireAdmin } from "../middlewares/adminMiddleware.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();
router.use(requireAuth, requireAdmin);
router.get("/summary", summary);
router.get("/active-users", activeUsers);
router.get("/recent-sessions", recentSessions);
router.get("/trends", trends);

export default router;
