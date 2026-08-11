import { Router } from "express";
import { create, decision, get, institutions, list, programs } from "../controllers/futureSimulatorController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();
router.use(requireAuth);
router.get("/programs", programs);
router.get("/programs/:programId/institutions", institutions);
router.post("/simulations", create);
router.get("/simulations", list);
router.get("/simulations/:simulationId", get);
router.post("/simulations/:simulationId/decisions", decision);
export default router;
