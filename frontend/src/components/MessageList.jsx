import { useEffect, useRef } from "react";

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

export default function MessageList({ messages, isSending }) {
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

  return (
    <div className="messages-panel">
      {messages.length ? (
        messages.map((message) => (
          <article
            key={message.id}
            className={`message-bubble ${message.role === "assistant" ? "assistant" : "user"}`}
          >
            <span className="message-role">
              {message.role === "assistant" ? "Blue" : "Tu"}
            </span>
            <p>{renderMessageContent(message.content)}</p>
          </article>
        ))
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
