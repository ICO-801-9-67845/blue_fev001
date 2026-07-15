import {
  createChat,
  getChatMessages,
  listChats,
  removeChat,
  sendMessage,
} from "../services/chatService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const getChats = asyncHandler(async (request, response) => {
  const chats = await listChats(request.user.sub);
  response.json({
    success: true,
    data: chats,
  });
});

export const postChat = asyncHandler(async (request, response) => {
  const chat = await createChat(request.user.sub, request.body?.title);
  response.status(201).json({
    success: true,
    data: chat,
  });
});

export const getMessages = asyncHandler(async (request, response) => {
  const messages = await getChatMessages(request.params.chatId, request.user.sub);
  response.json({
    success: true,
    data: messages,
  });
});

export const postMessage = asyncHandler(async (request, response) => {
  const result = await sendMessage(
    request.params.chatId,
    request.user.sub,
    request.body?.content,
    request.body?.action,
  );
  response.status(201).json({
    success: true,
    data: result,
  });
});

export const destroyChat = asyncHandler(async (request, response) => {
  await removeChat(request.params.chatId, request.user.sub);
  response.json({
    success: true,
    message: "Conversacion eliminada",
  });
});
