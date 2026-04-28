import {
  createChat as createChatRecord,
  deleteChat as deleteChatRecord,
  findChatById,
  listChatsByUserId,
  updateChat,
} from "../repositories/chatRepository.js";
import {
  countMessagesByChatId,
  createMessage,
  listMessagesByChatId,
} from "../repositories/messageRepository.js";
import { ApiError } from "../utils/ApiError.js";
import { generateAssistantReply } from "./aiService.js";

function ensureContent(content) {
  if (!content || !content.trim()) {
    throw new ApiError(400, "El mensaje no puede estar vacio");
  }
}

function deriveChatTitle(content) {
  const normalized = content.trim().replace(/\s+/g, " ");
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
}

async function getOwnedChat(chatId, userId) {
  const chat = await findChatById(chatId);

  if (!chat || chat.userId !== userId) {
    throw new ApiError(404, "Conversacion no encontrada");
  }

  return chat;
}

export async function listChats(userId) {
  const chats = await listChatsByUserId(userId);
  return chats.map((chat) => ({
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat._count.messages,
  }));
}

export async function createChat(userId, title = "Nueva conversacion") {
  return createChatRecord({
    userId,
    title: title.trim() || "Nueva conversacion",
  });
}

export async function getChatMessages(chatId, userId) {
  await getOwnedChat(chatId, userId);
  return listMessagesByChatId(chatId);
}

export async function sendMessage(chatId, userId, content) {
  ensureContent(content);
  const chat = await getOwnedChat(chatId, userId);

  const userMessage = await createMessage({
    chatId,
    role: "user",
    content: content.trim(),
  });

  const history = await listMessagesByChatId(chatId);
  const assistantReply = await generateAssistantReply(history);

  const assistantMessage = await createMessage({
    chatId,
    role: "assistant",
    content: assistantReply,
  });

  await updateChat(chatId, {});

  const totalMessages = await countMessagesByChatId(chatId);

  if (chat.title === "Nueva conversacion" && totalMessages <= 2) {
    await updateChat(chatId, { title: deriveChatTitle(content) });
  }

  return {
    userMessage,
    assistantMessage,
  };
}

export async function removeChat(chatId, userId) {
  await getOwnedChat(chatId, userId);
  await deleteChatRecord(chatId);
}
