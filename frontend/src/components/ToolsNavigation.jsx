import { NavLink } from "react-router-dom";

const navigationItems = [
  { to: "/chat", label: "Chat" },
  { to: "/tools/schedule", label: "Horario" },
  { to: "/tools/focus", label: "Focus" },
  { to: "/tools/cv", label: "CV" },
];

export default function ToolsNavigation() {
  return (
    <nav className="tools-navigation" aria-label="Navegación de herramientas">
      {navigationItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `tools-navigation-link${isActive ? " active" : ""}`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
