import { buildActions } from "./educativeActions";

export default function EducativeActionMenu({
  messageId,
  uiAction,
  activeActionId,
  disabled,
  onAction,
}) {
  const actions = buildActions(uiAction);
  const isPending = uiAction.status === "pending";
  const isLoading = activeActionId === uiAction.id;

  if (!actions.length) {
    return null;
  }

  return (
    <div
      className="educative-action-menu"
      aria-label="Opciones de búsqueda educativa"
      aria-busy={isLoading}
    >
      {actions.map((item) => (
        <button
          key={item.key}
          className={item.secondary ? "educative-action secondary" : "educative-action"}
          type="button"
          disabled={disabled || !isPending || isLoading}
          onClick={() => onAction(messageId, item.content, item.action)}
        >
          {isLoading ? "Procesando..." : item.label}
        </button>
      ))}
      {!isPending && !isLoading ? (
        <span className="educative-action-status">
          {uiAction.status === "dismissed"
            ? "Opción pospuesta"
            : uiAction.status === "expired"
              ? "Acción reemplazada"
              : "Acción completada"}
        </span>
      ) : null}
    </div>
  );
}
