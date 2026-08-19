import { Link, Outlet } from "react-router-dom";
import ToolsNavigation from "./ToolsNavigation";
import "../styles/tools.css";

export default function ToolsLayout() {
  return (
    <main className="tools-page">
      <div className="tools-shell">
        <header className="tools-header">
          <div className="tools-brand">
            <p className="eyebrow">Espacio personal</p>
            <Link to="/tools/schedule">Herramientas Blue</Link>
          </div>

          <ToolsNavigation />
        </header>

        <div className="tools-content">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
