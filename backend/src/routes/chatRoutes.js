import { Router } from "express";
import {
  destroyChat,
  getChats,
  getMessages,
  postChat,
  postMessage,
} from "../controllers/chatController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = Router();

router.use(requireAuth);
router.get("/", getChats);
router.post("/", postChat);
router.get("/:chatId/messages", getMessages);
router.post("/:chatId/messages", postMessage);
router.delete("/:chatId", destroyChat);

export default router;
