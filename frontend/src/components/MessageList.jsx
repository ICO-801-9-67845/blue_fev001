import { useEffect, useRef } from "react";

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
            <p>{message.content}</p>
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
