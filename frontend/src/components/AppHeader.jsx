export default function AppHeader({ user, onLogout, isSidebarOpen, onToggleSidebar }) {
  return (
    <header className="chat-header">
      <div className="chat-header-title">
        <button
          className="sidebar-toggle"
          type="button"
          onClick={onToggleSidebar}
          aria-label={isSidebarOpen ? "Cerrar historial" : "Abrir historial"}
        >
          {isSidebarOpen ? "×" : "☰"}
        </button>
        <div>
          <p className="eyebrow">Espacio personal</p>
          <h2>Conversa a tu ritmo</h2>
        </div>
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
