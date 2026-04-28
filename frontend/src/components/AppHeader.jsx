export default function AppHeader({ user, onLogout }) {
  return (
    <header className="chat-header">
      <div>
        <p className="eyebrow">Espacio personal</p>
        <h2>Conversa a tu ritmo</h2>
      </div>

      <div className="header-actions">
        <div className="user-chip">
          <span>{user?.name?.split(" ")[0]}</span>
          <small>{user?.email}</small>
        </div>
        <button className="ghost-button" onClick={onLogout}>
          Salir
        </button>
      </div>
    </header>
  );
}
