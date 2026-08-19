import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createChatRequest,
  deleteChatRequest,
  getChatsRequest,
  getMessagesRequest,
  sendMessageRequest,
} from "../api/chatApi";
import AppHeader from "../components/AppHeader";
import ChatSidebar from "../components/ChatSidebar";
import MessageComposer from "../components/MessageComposer";
import MessageList from "../components/MessageList";
import { useAuth } from "../hooks/useAuth";
import { useAnalyticsSession } from "../hooks/useAnalyticsSession";

export default function ChatPage() {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState("");
  const [messages, setMessages] = useState([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [activeActionId, setActiveActionId] = useState("");
  const sendingGuardRef = useRef(false);
  const [error, setError] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    () => typeof window !== "undefined" && window.innerWidth > 860,
  );
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  useAnalyticsSession(user);

  useEffect(() => {
    loadChats();
  }, []);

  useEffect(() => {
    function handleResize() {
      setIsSidebarOpen(window.innerWidth > 860);
    }

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  function closeSidebarOnCompactScreens() {
    if (typeof window !== "undefined" && window.innerWidth <= 860) {
      setIsSidebarOpen(false);
    }
  }

  function toggleSidebar() {
    setIsSidebarOpen((current) => !current);
  }

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
      closeSidebarOnCompactScreens();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "No fue posible crear la conversacion");
    }
  }

  async function handleSelectChat(chatId) {
    await loadMessages(chatId);
    closeSidebarOnCompactScreens();
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

  async function handleSendMessage(
    content,
    action = null,
    sourceActionMessageId = "",
  ) {
    if (sending || sendingGuardRef.current) {
      return;
    }

    sendingGuardRef.current = true;
    let currentChatId = activeChatId;

    if (!currentChatId) {
      try {
        const newChat = await createChatRequest();
        currentChatId = newChat.id;
        setActiveChatId(currentChatId);
        setChats((current) => [newChat, ...current]);
      } catch (requestError) {
        sendingGuardRef.current = false;
        setError(requestError.response?.data?.message || "No fue posible crear la conversacion");
        return;
      }
    }

    const optimisticUserMessage = {
      id: `temp-user-${Date.now()}`,
      role: "user",
      content,
    };

    setMessages((current) => [
      ...current.map((message) =>
        message.id === sourceActionMessageId
          ? {
              ...message,
              uiAction: {
                ...message.uiAction,
                status: "processing",
              },
            }
          : message,
      ),
      optimisticUserMessage,
    ]);
    setActiveActionId(action?.actionId || "");
    setSending(true);
    setError("");

    try {
      const result = await sendMessageRequest(currentChatId, content, action);
      try {
        const nextMessages = await getMessagesRequest(currentChatId);
        setMessages(nextMessages);
      } catch {
        setMessages((current) => [
          ...current.filter((message) => message.id !== optimisticUserMessage.id),
          result.userMessage,
          result.assistantMessage,
        ]);
      }
      const nextChats = await refreshChats();
      setChats(nextChats);
    } catch (requestError) {
      setMessages((current) =>
        current
          .filter((message) => message.id !== optimisticUserMessage.id)
          .map((message) =>
            message.id === sourceActionMessageId
              ? {
                  ...message,
                  uiAction: {
                    ...message.uiAction,
                    status: "pending",
                  },
                }
              : message,
          ),
      );
      setError(requestError.response?.data?.message || "No fue posible enviar el mensaje");
    } finally {
      sendingGuardRef.current = false;
      setActiveActionId("");
      setSending(false);
    }
  }

  async function handleEducativeAction(messageId, content, action) {
    await handleSendMessage(content, action, messageId);
  }
  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <main className={`chat-page ${isSidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
      <button
        className="sidebar-overlay"
        type="button"
        aria-label="Cerrar historial"
        onClick={() => setIsSidebarOpen(false)}
      />

      <ChatSidebar
        chats={chats}
        activeChatId={activeChatId}
        onCreateChat={handleCreateChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
      />

      <section className="chat-main">
        <AppHeader
          user={user}
          onLogout={handleLogout}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={toggleSidebar}
        />

        <div className="chat-content">
          <div className="conversation-card">
            {error ? <div className="banner-error">{error}</div> : null}
            {loadingChats || loadingMessages ? (
              <div className="app-shell-centered">Cargando conversacion...</div>
            ) : (
              <>
                <MessageList
                  messages={messages}
                  isSending={sending}
                  activeActionId={activeActionId}
                  onEducativeAction={handleEducativeAction}
                />
                <MessageComposer disabled={sending} onSend={handleSendMessage} />
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
