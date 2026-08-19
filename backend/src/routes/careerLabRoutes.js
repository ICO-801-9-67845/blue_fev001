import { Router } from "express";
import { requireAuth } from "../middlewares/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as c from "../controllers/careerLabController.js";
const router = Router(); router.use(requireAuth);
router.get("/labs", asyncHandler(c.listLabs)); router.get("/labs/:labKey", asyncHandler(c.getLab));
router.post("/attempts", asyncHandler(c.startAttempt)); router.get("/attempts", asyncHandler(c.listAttempts)); router.get("/attempts/:id", asyncHandler(c.getAttempt));
router.post("/attempts/:id/actions", asyncHandler(c.act)); router.post("/attempts/:id/reflection", asyncHandler(c.reflect)); router.get("/attempts/:id/related-careers", asyncHandler(c.related)); router.get("/profile", asyncHandler(c.profile));
export default router;
