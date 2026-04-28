export default function ChatSidebar({
  chats,
  activeChatId,
  onCreateChat,
  onSelectChat,
  onDeleteChat,
}) {
  return (
    <aside className="chat-sidebar">
      <div className="sidebar-top">
        <div>
          <p className="eyebrow">Historial</p>
          <h3>Tus conversaciones</h3>
        </div>
        <button className="primary-button sidebar-button" onClick={onCreateChat}>
          Nueva charla
        </button>
      </div>

      <div className="chat-list">
        {chats.length ? (
          chats.map((chat) => (
            <article
              key={chat.id}
              className={`chat-list-item ${activeChatId === chat.id ? "active" : ""}`}
            >
              <button className="chat-open-button" onClick={() => onSelectChat(chat.id)}>
                <div>
                  <strong>{chat.title}</strong>
                  <span>{new Date(chat.updatedAt).toLocaleString()}</span>
                </div>
                <small>{chat.messageCount} msgs</small>
              </button>
              <button
                className="chat-delete"
                type="button"
                onClick={() => onDeleteChat(chat.id)}
              >
                Eliminar
              </button>
            </article>
          ))
        ) : (
          <div className="sidebar-empty">
            <p>Aun no hay conversaciones. Empieza una y el historial se guardara aqui.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
