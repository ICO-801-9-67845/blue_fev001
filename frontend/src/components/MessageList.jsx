import { useEffect, useRef } from "react";
import EducativeActionMenu from "./EducativeActionMenu";

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
const URL_TEST_PATTERN = /^https?:\/\/[^\s]+$/;

function renderMessageContent(content) {
  return `${content || ""}`.split(URL_PATTERN).map((part, index) => {
    if (!URL_TEST_PATTERN.test(part)) {
      return part;
    }

    return (
      <a key={`${part}-${index}`} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    );
  });
}

export default function MessageList({
  messages,
  isSending,
  activeActionId,
  onEducativeAction,
}) {
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

  return (
    <div className="messages-panel">
      {messages.length ? (
        messages.map((message) => {
          const isAssistant = message.role === "assistant";

          return (
            <div
              key={message.id}
              className={`message-row ${isAssistant ? "assistant" : "user"}`}
            >
              {isAssistant ? (
                <img
                  className="message-avatar"
                  src="/character.png"
                  alt=""
                  aria-hidden="true"
                />
              ) : null}

              <article className={`message-bubble ${isAssistant ? "assistant" : "user"}`}>
                <span className="message-role visually-hidden">
                  {isAssistant ? "Blue" : "Tu"}
                </span>
                <p>{renderMessageContent(message.content)}</p>
                {isAssistant && message.uiAction ? (
                  <EducativeActionMenu
                    messageId={message.id}
                    uiAction={message.uiAction}
                    activeActionId={activeActionId}
                    disabled={isSending}
                    onAction={onEducativeAction}
                  />
                ) : null}
              </article>

              {!isAssistant ? (
                <span className="message-avatar user-avatar" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    focusable="false"
                  >
                    <path
                      d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M4.75 20c.85-3.08 3.48-5 7.25-5s6.4 1.92 7.25 5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              ) : null}
            </div>
          );
        })
      ) : (
        <div className="messages-empty">
          <h3>Una charla que empieza suave</h3>
          <p>
            Puedes hablar de tu dia, una duda, algo que te emociona o algo que te tiene
            confundido. El asistente va conociendote primero antes de orientar tu camino.
          </p>
        </div>
      )}

      {isSending ? (
        <div className="typing-indicator">
          <span />
          <span />
          <span />
        </div>
      ) : null}

      <div ref={messagesEndRef} />
    </div>
  );
}
