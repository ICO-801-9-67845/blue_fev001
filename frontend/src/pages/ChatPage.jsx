import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createChatRequest,
  deleteChatRequest,
  getChatsRequest,
  getMessagesRequest,
  sendMessageRequest,
} from "../api/chatApi";
import AppHeader from "../components/AppHeader";
import CharacterPanel from "../components/CharacterPanel";
import ChatSidebar from "../components/ChatSidebar";
import MessageComposer from "../components/MessageComposer";
import MessageList from "../components/MessageList";
import { useAuth } from "../hooks/useAuth";

export default function ChatPage() {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState("");
  const [messages, setMessages] = useState([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    loadChats();
  }, []);

  async function refreshChats() {
    const nextChats = await getChatsRequest();
    setChats(nextChats);
    return nextChats;
  }

  async function loadMessages(chatId) {
    setLoadingMessages(true);

    try {
      const nextMessages = await getMessagesRequest(chatId);
      setMessages(nextMessages);
      setActiveChatId(chatId);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "No fue posible cargar los mensajes");
    } finally {
      setLoadingMessages(false);
    }
  }

  async function loadChats(preferredChatId = "") {
    setLoadingChats(true);
    setError("");

    try {
      const nextChats = await refreshChats();
      const chatToOpen = preferredChatId || nextChats[0]?.id || "";
      setActiveChatId(chatToOpen);

      if (chatToOpen) {
        await loadMessages(chatToOpen);
      } else {
        setMessages([]);
      }
    } catch (requestError) {
      if (requestError.response?.status === 401) {
        logout();
        navigate("/login");
        return;
      }

      setError(requestError.response?.data?.message || "No fue posible cargar tus chats");
    } finally {
      setLoadingChats(false);
    }
  }

  async function handleCreateChat() {
    try {
      const chat = await createChatRequest();
      await loadChats(chat.id);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "No fue posible crear la conversacion");
    }
  }

  async function handleDeleteChat(chatId) {
    try {
      await deleteChatRequest(chatId);
      const nextChatId = activeChatId === chatId ? "" : activeChatId;
      await loadChats(nextChatId);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "No fue posible eliminar el chat");
    }
  }

  async function handleSendMessage(content) {
    let currentChatId = activeChatId;

    if (!currentChatId) {
      const newChat = await createChatRequest();
      currentChatId = newChat.id;
      setActiveChatId(currentChatId);
      setChats((current) => [newChat, ...current]);
    }

    const optimisticUserMessage = {
      id: `temp-user-${Date.now()}`,
      role: "user",
      content,
    };

    setMessages((current) => [...current, optimisticUserMessage]);
    setSending(true);
    setError("");

    try {
      const result = await sendMessageRequest(currentChatId, content);
      setMessages((current) => [
        ...current.filter((message) => message.id !== optimisticUserMessage.id),
        result.userMessage,
        result.assistantMessage,
      ]);
      const nextChats = await refreshChats();
      setChats(nextChats);
    } catch (requestError) {
      setMessages((current) =>
        current.filter((message) => message.id !== optimisticUserMessage.id),
      );
      setError(requestError.response?.data?.message || "No fue posible enviar el mensaje");
    } finally {
      setSending(false);
    }
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <main className="chat-page">
      <ChatSidebar
        chats={chats}
        activeChatId={activeChatId}
        onCreateChat={handleCreateChat}
        onSelectChat={loadMessages}
        onDeleteChat={handleDeleteChat}
      />

      <section className="chat-main">
        <AppHeader user={user} onLogout={handleLogout} />

        <div className="chat-content">
          <div className="conversation-card">
            {error ? <div className="banner-error">{error}</div> : null}
            {loadingChats || loadingMessages ? (
              <div className="app-shell-centered">Cargando conversacion...</div>
            ) : (
              <>
                <MessageList messages={messages} isSending={sending} />
                <MessageComposer disabled={sending} onSend={handleSendMessage} />
              </>
            )}
          </div>

          <CharacterPanel />
        </div>
      </section>
    </main>
  );
}
