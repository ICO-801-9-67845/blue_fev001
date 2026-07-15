import http from "./http";

export async function getChatsRequest() {
  const response = await http.get("/chats");
  return response.data.data;
}

export async function createChatRequest(payload = {}) {
  const response = await http.post("/chats", payload);
  return response.data.data;
}

export async function getMessagesRequest(chatId) {
  const response = await http.get(`/chats/${chatId}/messages`);
  return response.data.data;
}

export async function sendMessageRequest(chatId, content, action = null) {
  const response = await http.post(`/chats/${chatId}/messages`, {
    content,
    ...(action ? { action } : {}),
  });
  return response.data.data;
}

export async function deleteChatRequest(chatId) {
  const response = await http.delete(`/chats/${chatId}`);
  return response.data;
}
