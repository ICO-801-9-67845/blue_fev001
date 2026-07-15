function buildActions(uiAction) {
  if (uiAction.type === "career_confirmation") {
    return [
      ...(uiAction.careers || []).slice(0, 3).map((career) => ({
        key: career.normalizedName,
        label: "Mostrar opciones de " + career.name,
        content: "Mostrar opciones de " + career.name,
        action: {
          type: "confirm_educative_search",
          actionId: uiAction.id,
          career: career.normalizedName,
          level: career.level,
        },
      })),
      {
        key: "continue",
        label: "Seguir conversando",
        content: "Seguir conversando",
        action: {
          type: "defer_educative_search",
          actionId: uiAction.id,
        },
        secondary: true,
      },
    ];
  }

  if (uiAction.type === "search_followup") {
    return [
      ...(uiAction.hasMoreResults
        ? [{
            key: "more",
            label: "Mostrar más opciones",
            content: "Dame más opciones",
            action: {
              type: "more_educative_results",
              actionId: uiAction.id,
            },
          }]
        : []),
      {
        key: "continue",
        label: "Seguir conversando",
        content: "Seguir conversando",
        action: {
          type: "continue_conversation",
          actionId: uiAction.id,
        },
        secondary: true,
      },
    ];
  }

  if (uiAction.type === "search_exhausted") {
    return [
      {
        key: "related",
        label: "Explorar carreras relacionadas",
        content: "Quiero explorar carreras relacionadas",
        action: {
          type: "explore_related_careers",
          actionId: uiAction.id,
          career: uiAction.career,
          level: uiAction.level,
        },
      },
      {
        key: "continue",
        label: "Seguir conversando",
        content: "Seguir conversando",
        action: {
          type: "continue_conversation",
          actionId: uiAction.id,
        },
        secondary: true,
      },
    ];
  }

  return [];
}

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