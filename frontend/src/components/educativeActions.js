export function buildActions(uiAction) {
  if (uiAction.type === "career_confirmation") {
    return [
      ...(uiAction.careers || []).map((career) => ({
        key: career.normalizedName,
        label: "Mostrar opciones de " + career.name,
        content: "Mostrar opciones de " + career.name,
        action: {
          type: "confirm_educative_search",
          actionId: uiAction.id,
          career: career.normalizedName,
        },
      })),
      ...(uiAction.hasMoreCareers
        ? [{
            key: "more-careers",
            label: "Mostrar más carreras",
            content: "Mostrar más carreras",
            action: {
              type: "more_vocational_careers",
              actionId: uiAction.id,
            },
          }]
        : []),
      ...(uiAction.relatedHasMore
        ? [{
            key: "more-related",
            label: "Mostrar más carreras relacionadas",
            content: "Mostrar más carreras relacionadas",
            action: {
              type: "more_related_programs",
              actionId: uiAction.id,
              canonicalProgramId: uiAction.canonicalProgramId,
              academicLevel: uiAction.academicLevel,
              familyId: uiAction.familyId,
              relatedStage: uiAction.relatedStage,
            },
          }]
        : []),
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
      ...(uiAction.hasEligibleRelatedPrograms
        ? [{
            key: "related",
            label: "Explorar carreras relacionadas",
            content: "Quiero explorar carreras relacionadas",
            action: {
              type: "explore_related_careers",
              actionId: uiAction.id,
              career: uiAction.career,
              level: uiAction.level,
              canonicalProgramId: uiAction.canonicalProgramId,
              academicLevel: uiAction.academicLevel,
              familyId: uiAction.familyId,
              relatedStage: "family",
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

  return [];
}
