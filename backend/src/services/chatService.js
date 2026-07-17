import {
  createChat as createChatRecord,
  deleteChat as deleteChatRecord,
  findChatById,
  listRecentChatSummariesByUserId,
  listChatsByUserId,
  updateChat,
} from "../repositories/chatRepository.js";
import {
  countMessagesByChatId,
  createMessage,
  listMessagesByChatId,
} from "../repositories/messageRepository.js";
import prisma from "../config/prisma.js";
import {
  findUserMemoryByUserId,
} from "../repositories/userMemoryRepository.js";
import { ApiError } from "../utils/ApiError.js";
import { generateAssistantReply } from "./aiService.js";
import {
  MEMORY_REFRESH_FLOWS,
  refreshMemoryAfterEligibleTurn,
} from "./memoryRefreshService.js";
import { buildEducativeSearchReply, searchEducativeOffers } from "./educativeSearchService.js";
import {
  buildConfirmationReply,
  classifyTypedAction,
  createUiAction,
  detectCareerOptions,
  isDirectEducativeRequest,
  isDirectInstitutionRequest,
  isStrongCareerReinforcement,
  normalizeEducativeState,
  normalizeEducativeText,
} from "./educativeConfirmationService.js";
import {
  getFamilyCandidateIds,
  getNearbyCandidateIds,
  toCanonicalCareerCandidate,
} from "./educativeProgramRelationsService.js";

const MEMORY_MESSAGE_LIMIT = 12;

const EDUCATIVE_INTENT_PATTERN =
  /\b(escuela|escuelas|universidad|universidades|prepa|prepas|preparatoria|preparatorias|bachillerato|carrera|carreras|licenciatura|licenciaturas|ingenieria|ingenierias|opcion|opciones|estudiar|donde estudiar)\b/i;

const EDUCATIVE_FOLLOW_UP_PATTERN =
  /\b(dame\s+mas\s+opciones|mas\s+opciones|otras\s+opciones|dame\s+otras|hay\s+mas|quiero\s+mas)\b/i;

const EDUCATIVE_OFFER_DETAIL_ID_PATTERN = /oferta-educativa\/detalle\/(\d+)/gi;

const MUNICIPALITY_ALIASES = [
  ["leon", "León"],
  ["silao", "Silao"],
  ["irapuato", "Irapuato"],
  ["celaya", "Celaya"],
  ["guanajuato", "Guanajuato"],
  ["salamanca", "Salamanca"],
  ["san miguel de allende", "San Miguel de Allende"],
  ["dolores hidalgo", "Dolores Hidalgo"],
  ["san francisco del rincon", "San Francisco del Rincón"],
  ["purisima del rincon", "Purísima del Rincón"],
];

const CAREER_STOP_WORDS = new Set([
  "escuela",
  "escuelas",
  "universidad",
  "universidades",
  "prepa",
  "prepas",
  "preparatoria",
  "preparatorias",
  "bachillerato",
  "carrera",
  "carreras",
  "licenciatura",
  "licenciaturas",
  "ingenieria",
  "ingenierias",
  "opcion",
  "opciones",
  "estudiar",
  "donde",
  "para",
  "sobre",
  "quiero",
  "busco",
  "recomienda",
  "recomiendas",
  "recomendar",
  "puedes",
  "dar",
  "dame",
  "dime",
  "tengo",
  "tienes",
  "tienen",
  "mas",
  "otras",
  "otros",
  "hay",
  "en",
  "de",
  "del",
  "la",
  "las",
  "los",
  "el",
  "un",
  "una",
  "gto",
  "guanajuato",
]);

function ensureContent(content) {
  if (!content || !content.trim()) {
    throw new ApiError(400, "El mensaje no puede estar vacio");
  }
}

function deriveChatTitle(content) {
  const normalized = content.trim().replace(/\s+/g, " ");
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
}

function normalizeSearchText(value) {
  return `${value || ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function shouldSearchEducativeOffers(content) {
  return EDUCATIVE_INTENT_PATTERN.test(normalizeSearchText(content));
}

function isEducativeFollowUp(content) {
  return EDUCATIVE_FOLLOW_UP_PATTERN.test(normalizeSearchText(content));
}

function buildFollowUpSearchContent(history) {
  const userMessages = history
    .filter((message) => message.role === "user")
    .slice(-4)
    .map((message) => message.content)
    .filter(Boolean);

  return userMessages.join("\n");
}

function extractShownOfferIds(messages) {
  const shownOfferIds = new Set();

  messages.forEach((message) => {
    const text = `${message?.content || ""}`;
    let match = EDUCATIVE_OFFER_DETAIL_ID_PATTERN.exec(text);

    while (match) {
      shownOfferIds.add(match[1]);
      match = EDUCATIVE_OFFER_DETAIL_ID_PATTERN.exec(text);
    }

    EDUCATIVE_OFFER_DETAIL_ID_PATTERN.lastIndex = 0;
  });

  return [...shownOfferIds];
}

function buildEmptyOfferReply(isFollowUp) {
  if (isFollowUp) {
    return "No encontre mas opciones en la base con esos filtros. Quieres que ampliemos a otros municipios o carreras relacionadas?";
  }

  return "No encontre opciones exactas en la base con esos datos. Me dices municipio, nivel o carrera para buscar mejor?";
}

function getRequestedMunicipality(content) {
  const normalizedContent = normalizeSearchText(content);
  const match = MUNICIPALITY_ALIASES.find(([alias]) => normalizedContent.includes(alias));
  return match?.[1] || "";
}

function getRequestedLevel(content) {
  const normalizedContent = normalizeSearchText(content);

  if (
    /\b(prepa|prepas|preparatoria|preparatorias|bachillerato)\b/.test(normalizedContent)
  ) {
    return "BACHILLERATO";
  }

  if (
    /\b(universidad|universidades|licenciatura|licenciaturas|ingenieria|ingenierias)\b/.test(
      normalizedContent,
    )
  ) {
    return "ESCUELA UNIVERSITARIA";
  }

  return "";
}

function getCareerSearchTerms(content) {
  const normalizedContent = normalizeSearchText(content);
  const words = normalizedContent
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !CAREER_STOP_WORDS.has(word));

  return [...new Set(words)].slice(0, 4);
}

async function findCareerMatches(searchTerms) {
  if (!searchTerms.length) {
    return [];
  }

  const careerQueries = searchTerms.map((term) =>
    prisma.tbl_educative_offer_campus_careers.findMany({
      where: {
        active: 1,
        name: {
          contains: term,
        },
      },
      orderBy: {
        name: "asc",
      },
      take: 40,
    }),
  );

  const careerResults = (await Promise.all(careerQueries)).flat();
  const uniqueCareers = new Map();

  careerResults.forEach((career) => {
    uniqueCareers.set(career.id.toString(), career);
  });

  return [...uniqueCareers.values()];
}

async function buildEducativeOfferContext(content, options = {}) {
  if (!shouldSearchEducativeOffers(content)) {
    return [];
  }

  const excludedOfferIds = Array.isArray(options.excludeOfferIds)
    ? options.excludeOfferIds
        .filter((offerId) => /^\d+$/.test(`${offerId}`))
        .map((offerId) => BigInt(offerId))
    : [];
  const municipality = getRequestedMunicipality(content);
  const level = getRequestedLevel(content);
  const careerSearchTerms = getCareerSearchTerms(content);

  if (!municipality && !level && !careerSearchTerms.length) {
    return [];
  }

  const matchedCareers = await findCareerMatches(careerSearchTerms);

  if (careerSearchTerms.length && !matchedCareers.length) {
    return [];
  }

  const matchedCampusIds = [
    ...new Set(
      matchedCareers
        .map((career) => career.ev_educative_offer_campus_id)
        .filter((campusId) => campusId !== null && campusId !== undefined)
        .map((campusId) => campusId.toString()),
    ),
  ];

  if (careerSearchTerms.length && !matchedCampusIds.length) {
    return [];
  }

  const campusWhere = {
    active: 1,
    ...(matchedCampusIds.length
      ? {
          id: {
            in: matchedCampusIds.map((campusId) => BigInt(campusId)),
          },
        }
      : {}),
    ...(municipality
      ? {
          municipality: {
            contains: municipality,
          },
        }
      : {}),
    ...(level ? { level } : {}),
  };

  const campuses = await prisma.tbl_educative_offer_campuses.findMany({
    where: campusWhere,
    take: 25,
  });

  const offerIds = [
    ...new Set(
      campuses
        .map((campus) => campus.ev_educative_offer_id)
        .filter(Boolean)
        .map((offerId) => offerId.toString()),
    ),
  ];

  const offerWhere =
    offerIds.length > 0
      ? {
          id: {
            in: offerIds.map((offerId) => BigInt(offerId)),
            ...(excludedOfferIds.length ? { notIn: excludedOfferIds } : {}),
          },
          active: 1,
        }
      : {
          active: 1,
          ...(excludedOfferIds.length
            ? {
                id: {
                  notIn: excludedOfferIds,
                },
              }
            : {}),
          ...(municipality
            ? {
                municipality: {
                  contains: municipality,
                },
              }
            : {}),
          ...(level ? { level } : {}),
        };

  const offers = await prisma.tbl_educative_offer.findMany({
    where: offerWhere,
    select: {
      id: true,
      name: true,
      short_name: true,
      level: true,
      municipality: true,
      redirect_url: true,
    },
    orderBy: {
      name: "asc",
    },
    take: 5,
  });

  if (!offers.length) {
    return [];
  }

  const offerIdSet = new Set(offers.map((offer) => offer.id.toString()));
  const selectedCampuses = campuses.filter((campus) =>
    offerIdSet.has(campus.ev_educative_offer_id?.toString()),
  );
  const selectedCampusIds = selectedCampuses.map((campus) => campus.id);

  const relevantCareers = selectedCampusIds.length
    ? await prisma.tbl_educative_offer_campus_careers.findMany({
        where: {
          active: 1,
          ev_educative_offer_campus_id: {
            in: selectedCampusIds,
          },
          ...(careerSearchTerms.length
            ? {
                OR: careerSearchTerms.map((term) => ({
                  name: {
                    contains: term,
                  },
                })),
              }
            : {}),
        },
        orderBy: {
          name: "asc",
        },
        take: 80,
      })
    : [];

  const careersByCampusId = relevantCareers.reduce((careersMap, career) => {
    const campusId = career.ev_educative_offer_campus_id?.toString();

    if (!campusId) {
      return careersMap;
    }

    const currentCareers = careersMap.get(campusId) || [];
    currentCareers.push({
      name: career.name,
      modality: career.modality,
      shift: career.shift,
    });
    careersMap.set(campusId, currentCareers);

    return careersMap;
  }, new Map());

  return offers.map((offer) => {
    const offerCampuses = selectedCampuses.filter(
      (campus) => campus.ev_educative_offer_id?.toString() === offer.id.toString(),
    );
    const careers = offerCampuses.flatMap(
      (campus) => careersByCampusId.get(campus.id.toString()) || [],
    );

    return {
      id: offer.id.toString(),
      name: offer.name,
      short_name: offer.short_name,
      level: offer.level,
      municipality: offer.municipality || offerCampuses[0]?.municipality,
      redirect_url: offer.redirect_url,
      careers,
    };
  });
}

async function buildMemoryContext(userId, chat) {
  const [userMemory, previousChatSummaries] = await Promise.all([
    findUserMemoryByUserId(userId),
    listRecentChatSummariesByUserId(userId, chat.id, 2),
  ]);

  return {
    userMemorySummary: userMemory?.summary || "",
    currentChatSummary: chat.summary || "",
    previousChatSummaries,
  };
}


async function getOwnedChat(chatId, userId) {
  const chat = await findChatById(chatId);

  if (!chat || chat.userId !== userId) {
    throw new ApiError(404, "Conversacion no encontrada");
  }

  return chat;
}

const ACTION_REQUESTS_BY_UI_TYPE = {
  career_confirmation: new Set([
    "confirm_educative_search",
    "defer_educative_search",
    "clarify_educative_career",
    "more_related_programs",
  ]),
  search_followup: new Set([
    "more_educative_results",
    "continue_conversation",
  ]),
  search_exhausted: new Set([
    "explore_related_careers",
    "continue_conversation",
  ]),
};

function getChatEducativeState(chat) {
  return normalizeEducativeState(chat?.educativeState);
}

function getVisibleAction(action) {
  if (!action || typeof action !== "object") {
    return null;
  }

  return {
    type: String(action.type || ""),
    actionId: String(action.actionId || ""),
    career: action.career ? String(action.career) : null,
    level: action.level ? String(action.level) : null,
    canonicalProgramId: action.canonicalProgramId ? String(action.canonicalProgramId) : null,
    academicLevel: action.academicLevel ? String(action.academicLevel) : null,
    familyId: action.familyId ? String(action.familyId) : null,
    relatedStage: action.relatedStage ? String(action.relatedStage) : null,
    cursor: action.cursor === undefined || action.cursor === null
      ? null
      : Number(action.cursor),
  };
}

function hasSameCareer(left, right) {
  return normalizeEducativeText(left?.normalizedName || left?.name) ===
    normalizeEducativeText(right?.normalizedName || right?.name);
}

function hasDifferentCareer(careers, previousCareers) {
  return (careers || []).some(
    (career) => !(previousCareers || []).some((previous) => hasSameCareer(career, previous)),
  );
}

async function updateEducativeState(chat, state) {
  const expectedVersion = Number(chat.educativeStateVersion) || 0;
  const result = await prisma.chat.updateMany({
    where: {
      id: chat.id,
      userId: chat.userId,
      educativeStateVersion: expectedVersion,
    },
    data: {
      educativeState: state,
      educativeStateVersion: {
        increment: 1,
      },
    },
  });

  if (result.count !== 1) {
    throw new ApiError(409, "La conversacion cambio mientras procesabamos la accion");
  }

  chat.educativeState = state;
  chat.educativeStateVersion = expectedVersion + 1;
  return state;
}

async function setUiActionStatus(chatId, messageId, status) {
  if (!messageId) {
    return;
  }

  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      chatId,
      role: "assistant",
    },
    select: {
      id: true,
      uiAction: true,
    },
  });

  if (!message?.uiAction || typeof message.uiAction !== "object") {
    return;
  }

  await prisma.message.update({
    where: { id: message.id },
    data: {
      uiAction: {
        ...message.uiAction,
        status,
      },
    },
  });
}

async function expirePendingAction(chat, state) {
  if (state.pendingActionMessageId) {
    await setUiActionStatus(chat.id, state.pendingActionMessageId, "expired");
  }
}

async function createAssistantWithAction(chat, content, uiAction, state) {
  const expectedVersion = Number(chat.educativeStateVersion) || 0;
  const result = await prisma.$transaction(async (transaction) => {
    const assistantMessage = await transaction.message.create({
      data: {
        chatId: chat.id,
        role: "assistant",
        content,
        uiAction,
      },
    });
    const nextState = {
      ...state,
      pendingConfirmationActionId: uiAction.id,
      pendingActionMessageId: assistantMessage.id,
    };
    const updated = await transaction.chat.updateMany({
      where: {
        id: chat.id,
        userId: chat.userId,
        educativeStateVersion: expectedVersion,
      },
      data: {
        educativeState: nextState,
        educativeStateVersion: { increment: 1 },
      },
    });

    if (updated.count !== 1) {
      throw new ApiError(409, "La conversacion cambio mientras procesabamos la accion");
    }

    return { assistantMessage, state: nextState };
  });

  chat.educativeState = result.state;
  chat.educativeStateVersion = expectedVersion + 1;
  return result;
}

async function createCareerConfirmation(
  chat,
  content,
  careers,
  directRequest,
  state,
  relatedContext = null,
) {
  await expirePendingAction(chat, state);
  const uiAction = createUiAction("career_confirmation", {
    careers: careers.map(({
      name,
      normalizedName,
      level,
      academicLevel,
      canonicalProgramId,
      familyId,
    }) => ({
      name,
      normalizedName,
      level,
      academicLevel,
      canonicalProgramId,
      familyId,
    })),
    relatedHasMore: Boolean(relatedContext?.hasMore),
    relatedStage: relatedContext?.stage || null,
    canonicalProgramId: relatedContext?.canonicalProgramId || null,
    familyId: relatedContext?.familyId || null,
    academicLevel: relatedContext?.academicLevel || null,
  });
  const nextState = {
    ...state,
    status: "awaiting_confirmation",
    pendingCareers: careers,
    pendingLevel: careers.length === 1 ? careers[0].level : null,
    searchConfirmed: false,
    deferredSearch: false,
    messagesSinceDeferral: 0,
    lastPromptedCareers: careers,
    lastPromptedAt: new Date().toISOString(),
    hasMoreResults: false,
    relatedHasMore: Boolean(relatedContext?.hasMore),
    relatedStage: relatedContext?.stage || state.relatedStage,
  };
  const reply = content || buildConfirmationReply(careers, directRequest);
  return createAssistantWithAction(chat, reply, uiAction, nextState);
}

async function validatePendingAction(chat, state, clientAction) {
  if (!clientAction?.actionId || clientAction.actionId !== state.pendingConfirmationActionId) {
    throw new ApiError(409, "Esta accion ya no esta disponible");
  }

  const actionMessage = await prisma.message.findFirst({
    where: {
      id: state.pendingActionMessageId || "",
      chatId: chat.id,
      role: "assistant",
    },
    select: {
      id: true,
      uiAction: true,
    },
  });
  const uiAction = actionMessage?.uiAction;

  if (
    !uiAction ||
    uiAction.id !== clientAction.actionId ||
    uiAction.status !== "pending" ||
    !ACTION_REQUESTS_BY_UI_TYPE[uiAction.type]?.has(clientAction.type)
  ) {
    throw new ApiError(409, "Esta accion ya fue utilizada o expiro");
  }

  return actionMessage;
}

async function consumePendingAction(chat, state, clientAction, content, stateChanges = {}) {
  const actionMessage = await validatePendingAction(chat, state, clientAction);
  const nextState = {
    ...state,
    ...stateChanges,
    pendingConfirmationActionId: null,
    pendingActionMessageId: null,
  };
  const expectedVersion = Number(chat.educativeStateVersion) || 0;

  const userMessage = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.chat.updateMany({
      where: {
        id: chat.id,
        userId: chat.userId,
        educativeStateVersion: expectedVersion,
      },
      data: {
        educativeState: nextState,
        educativeStateVersion: { increment: 1 },
      },
    });

    if (updated.count !== 1) {
      throw new ApiError(409, "Esta accion ya fue utilizada");
    }

    await transaction.message.update({
      where: { id: actionMessage.id },
      data: {
        uiAction: {
          ...actionMessage.uiAction,
          status:
            clientAction.type === "defer_educative_search" ||
            clientAction.type === "continue_conversation"
              ? "dismissed"
              : "completed",
        },
      },
    });

    return transaction.message.create({
      data: {
        chatId: chat.id,
        role: "user",
        content: content.trim(),
      },
    });
  });

  chat.educativeState = nextState;
  chat.educativeStateVersion = expectedVersion + 1;
  return { userMessage, state: nextState };
}

function getCareerFromAction(state, clientAction) {
  const requestedCareer = normalizeEducativeText(clientAction.career);
  const careers = state.pendingCareers || [];
  const selected = !requestedCareer && careers.length === 1
    ? careers[0]
    : careers.find((career) =>
        normalizeEducativeText(career.normalizedName) === requestedCareer ||
        normalizeEducativeText(career.name) === requestedCareer
      );

  if (!selected) {
    throw new ApiError(400, "La carrera elegida no forma parte de las opciones ofrecidas");
  }
  if (
    (clientAction.canonicalProgramId &&
      clientAction.canonicalProgramId !== selected.canonicalProgramId) ||
    (clientAction.academicLevel &&
      clientAction.academicLevel !== selected.academicLevel) ||
    (clientAction.familyId !== null &&
      clientAction.familyId !== (selected.familyId || null)) ||
    (clientAction.level !== null && clientAction.level !== selected.level)
  ) {
    throw new ApiError(409, "El programa canonico, familia o nivel de la accion fue manipulado");
  }
  return selected;
}

function buildResultsState(state, career, result, offerIds) {
  const previousProgramId = state.currentCanonicalProgramId;
  const exploredProgramIds = career.fromRelated
    ? [...new Set([
        ...(state.exploredProgramIds || []),
        previousProgramId,
        career.canonicalProgramId,
      ].filter(Boolean))]
    : [career.canonicalProgramId];

  return {
    ...state,
    status: result.remainingCount > 0 ? "showing_results" : "exhausted",
    pendingCareers: [],
    pendingLevel: null,
    searchConfirmed: true,
    deferredSearch: false,
    messagesSinceDeferral: 0,
    confirmedSearchSignature: result.searchSignature,
    excludedOfferIds: [...new Set([...(state.excludedOfferIds || []), ...offerIds])],
    hasMoreResults: result.remainingCount > 0,
    activeConfirmedCareer: career,
    activeConfirmedLevel: career.level,
    activeSearchQuery: career.searchQuery,
    currentCanonicalProgramId: career.canonicalProgramId,
    currentLevel: career.academicLevel,
    currentFamilyId: career.familyId || null,
    exploredProgramIds,
    shownFamilyProgramIds: [],
    shownNearbyProgramIds: [],
    relatedStage: "family",
    relatedHasMore: false,
  };
}

function getConfirmedSearchMessage(career) {
  const levelHints = {
    prepa: "bachillerato",
    tsu: "TSU",
    undergraduate: "universidad",
    posgrado: "posgrado",
  };
  return [career.searchQuery, levelHints[career.level]].filter(Boolean).join(" ");
}
async function runConfirmedEducativeSearch(chat, state, career, isMore = false) {
  const result = await searchEducativeOffers({
    prisma,
    message: getConfirmedSearchMessage(career),
    excludeShownIds: state.excludedOfferIds || [],
    limit: 3,
    canonicalProgramId: career.canonicalProgramId,
    exactAliases: career.exactAliases,
    academicLevel: career.academicLevel,
  });
  const offerIds = (result.offerContext || []).map((offer) => String(offer.id));
  const nextState = buildResultsState(state, career, result, offerIds);
  const hasResults = result.offerContext?.length > 0;
  const hasMoreResults = hasResults && result.remainingCount > 0;
  const reply = hasResults
    ? buildEducativeSearchReply({ ...result, isFollowUp: isMore })
    : "Ya te mostre todas las opciones disponibles para " + career.name + " en la informacion actual.";
  const uiAction = createUiAction(
    hasMoreResults ? "search_followup" : "search_exhausted",
    {
      career: career.normalizedName,
      level: career.level,
      academicLevel: career.academicLevel,
      canonicalProgramId: career.canonicalProgramId,
      familyId: career.familyId || null,
      hasMoreResults,
    },
  );
  return createAssistantWithAction(chat, reply, uiAction, nextState);
}

async function replaceAmbiguousCareerConfirmation(chat, state, clientAction, content) {
  const actionMessage = await validatePendingAction(chat, state, clientAction);
  const careers = (state.pendingCareers || []).slice(0, 3);
  const uiAction = createUiAction("career_confirmation", {
    careers: careers.map(({
      name,
      normalizedName,
      level,
      academicLevel,
      canonicalProgramId,
      familyId,
    }) => ({
      name,
      normalizedName,
      level,
      academicLevel,
      canonicalProgramId,
      familyId,
    })),
  });
  const expectedVersion = Number(chat.educativeStateVersion) || 0;
  const result = await prisma.$transaction(async (transaction) => {
    await transaction.message.update({
      where: { id: actionMessage.id },
      data: {
        uiAction: {
          ...actionMessage.uiAction,
          status: "expired",
        },
      },
    });
    const userMessage = await transaction.message.create({
      data: {
        chatId: chat.id,
        role: "user",
        content: content.trim(),
      },
    });
    const assistantMessage = await transaction.message.create({
      data: {
        chatId: chat.id,
        role: "assistant",
        content: "Tengo varias opciones pendientes. Elige cual quieres consultar.",
        uiAction,
      },
    });
    const nextState = {
      ...state,
      status: "awaiting_confirmation",
      pendingCareers: careers,
      pendingLevel: careers.length === 1 ? careers[0].level : null,
      pendingConfirmationActionId: uiAction.id,
      pendingActionMessageId: assistantMessage.id,
      lastPromptedCareers: careers,
      lastPromptedAt: new Date().toISOString(),
    };
    const updated = await transaction.chat.updateMany({
      where: {
        id: chat.id,
        userId: chat.userId,
        educativeStateVersion: expectedVersion,
      },
      data: {
        educativeState: nextState,
        educativeStateVersion: { increment: 1 },
      },
    });

    if (updated.count !== 1) {
      throw new ApiError(409, "Esta accion ya fue utilizada");
    }

    return { userMessage, assistantMessage, state: nextState };
  });

  chat.educativeState = result.state;
  chat.educativeStateVersion = expectedVersion + 1;
  return result;
}

async function isEligibleCanonicalCareer(candidate) {
  if (!candidate?.canonicalProgramId) return false;
  const result = await searchEducativeOffers({
    prisma,
    message: candidate.searchQuery,
    excludeShownIds: [],
    limit: 1,
    canonicalProgramId: candidate.canonicalProgramId,
    exactAliases: candidate.exactAliases,
    academicLevel: candidate.academicLevel,
  });
  return (result.offerContext || []).length > 0;
}

async function filterEligibleCanonicalCareers(careers) {
  const eligible = [];
  for (const career of careers || []) {
    if (await isEligibleCanonicalCareer(career)) eligible.push(career);
    if (eligible.length === 3) break;
  }
  return eligible;
}

async function getRelatedPage(state) {
  const currentId = state.currentCanonicalProgramId;
  const excluded = new Set([
    currentId,
    ...(state.exploredProgramIds || []),
    ...(state.shownFamilyProgramIds || []),
    ...(state.shownNearbyProgramIds || []),
  ].filter(Boolean));

  const collectEligible = async (ids, relationType) => {
    const candidates = [];
    for (const id of ids) {
      if (excluded.has(id)) continue;
      const candidate = toCanonicalCareerCandidate(id);
      if (
        !candidate ||
        candidate.academicLevel !== state.currentLevel ||
        !(await isEligibleCanonicalCareer(candidate))
      ) continue;
      candidates.push({ ...candidate, fromRelated: true, relationType });
    }
    return candidates;
  };

  if (state.relatedStage !== "nearby" && state.relatedStage !== "exhausted") {
    const family = await collectEligible(getFamilyCandidateIds(currentId), "family");
    if (family.length) {
      const nearbyAfterFamily = await collectEligible(
        getNearbyCandidateIds(currentId),
        "nearby",
      );
      return {
        careers: family.slice(0, 3),
        hasMore: family.length > 3 || nearbyAfterFamily.length > 0,
        stage: "family",
      };
    }
  }

  const nearby = await collectEligible(getNearbyCandidateIds(currentId), "nearby");
  if (nearby.length) {
    return { careers: nearby.slice(0, 3), hasMore: nearby.length > 3, stage: "nearby" };
  }
  return { careers: [], hasMore: false, stage: "exhausted" };
}

async function validateRelatedAction(chat, state, clientAction) {
  const actionMessage = await validatePendingAction(chat, state, clientAction);
  const uiAction = actionMessage.uiAction;
  if (clientAction.cursor !== null) {
    throw new ApiError(409, "El cursor de carreras relacionadas fue manipulado");
  }
  if (
    (clientAction.canonicalProgramId &&
      clientAction.canonicalProgramId !== state.currentCanonicalProgramId) ||
    (clientAction.academicLevel &&
      clientAction.academicLevel !== state.currentLevel) ||
    (clientAction.familyId &&
      clientAction.familyId !== state.currentFamilyId) ||
    (uiAction.canonicalProgramId || null) !== (state.currentCanonicalProgramId || null) ||
    (uiAction.familyId || null) !== (state.currentFamilyId || null) ||
    (uiAction.academicLevel || null) !== (state.currentLevel || null)
  ) {
    throw new ApiError(409, "La accion relacionada no corresponde a la busqueda activa");
  }
  if (
    clientAction.type === "more_related_programs" &&
    (
      !state.relatedHasMore ||
      clientAction.relatedStage !== state.relatedStage ||
      uiAction.relatedStage !== state.relatedStage
    )
  ) {
    throw new ApiError(409, "El cursor de carreras relacionadas fue manipulado");
  }
}

async function showRelatedCareers(chat, content, state, clientAction) {
  await validateRelatedAction(chat, state, clientAction);
  const consumed = await consumePendingAction(
    chat,
    state,
    clientAction,
    content,
    { status: "processing", hasMoreResults: false },
  );
  const page = await getRelatedPage(consumed.state);
  const displayedIds = page.careers.map((career) => career.canonicalProgramId);
  const nextState = {
    ...consumed.state,
    shownFamilyProgramIds: page.stage === "family"
      ? [...new Set([...(consumed.state.shownFamilyProgramIds || []), ...displayedIds])]
      : consumed.state.shownFamilyProgramIds,
    shownNearbyProgramIds: page.stage === "nearby"
      ? [...new Set([...(consumed.state.shownNearbyProgramIds || []), ...displayedIds])]
      : consumed.state.shownNearbyProgramIds,
    relatedStage: page.stage,
    relatedHasMore: page.hasMore,
  };
  const currentName = consumed.state.activeConfirmedCareer?.name || "este programa";
  const reply = page.stage === "family"
    ? "Ya te mostre todas las instituciones disponibles para " + currentName +
      ". Tambien puedes explorar otros programas de la misma familia:"
    : page.stage === "nearby"
      ? "Ya revisamos las variantes disponibles. Tambien puedes explorar estas carreras cercanas:"
      : "No encontre otros programas relacionados con oferta elegible en el mismo nivel. Podemos seguir conversando.";
  const result = await createCareerConfirmation(
    chat,
    reply,
    page.careers,
    false,
    nextState,
    {
      hasMore: page.hasMore,
      stage: page.stage,
      canonicalProgramId: consumed.state.currentCanonicalProgramId,
      familyId: consumed.state.currentFamilyId,
      academicLevel: consumed.state.currentLevel,
    },
  );
  return { userMessage: consumed.userMessage, assistantMessage: result.assistantMessage };
}

async function continueConversationAfterAction(chat, userId, content, state, clientAction) {
  const { userMessage, state: consumedState } = await consumePendingAction(
    chat,
    state,
    clientAction,
    content,
    {
      status: "deferred",
      deferredSearch: true,
      messagesSinceDeferral: 0,
      hasMoreResults: false,
    },
  );
  const history = await listMessagesByChatId(chat.id);
  const recentHistory = history.slice(-MEMORY_MESSAGE_LIMIT);
  const memoryContext = await buildMemoryContext(userId, chat);
  const assistantReply = await generateAssistantReply(
    recentHistory,
    [],
    memoryContext,
    { isEducativeRequest: false },
  );
  const assistantMessage = await createMessage({
    chatId: chat.id,
    role: "assistant",
    content: assistantReply,
  });

  await refreshMemoryAfterEligibleTurn({
    flow: MEMORY_REFRESH_FLOWS.CONTINUE_AFTER_ACTION,
    chatId: chat.id,
    messages: [...recentHistory, assistantMessage],
    currentChatSummary: memoryContext.currentChatSummary,
    userMemorySummary: memoryContext.userMemorySummary,
    userId,
  });

  return { userMessage, assistantMessage, state: consumedState };
}

async function handleEducativeAction(chat, userId, content, rawAction, currentState) {
  const clientAction = getVisibleAction(rawAction);

  if (!clientAction?.type) {
    throw new ApiError(400, "La accion educativa no es valida");
  }

  if (clientAction.type === "clarify_educative_career") {
    return replaceAmbiguousCareerConfirmation(
      chat,
      currentState,
      clientAction,
      content,
    );
  }

  if (
    clientAction.type === "explore_related_careers" ||
    clientAction.type === "more_related_programs"
  ) {
    return showRelatedCareers(chat, content, currentState, clientAction);
  }

  if (
    clientAction.type === "defer_educative_search" ||
    clientAction.type === "continue_conversation"
  ) {
    return continueConversationAfterAction(
      chat,
      userId,
      content,
      currentState,
      clientAction,
    );
  }

  if (clientAction.type === "confirm_educative_search") {
    await validatePendingAction(chat, currentState, clientAction);
    const career = getCareerFromAction(currentState, clientAction);
    const { userMessage, state } = await consumePendingAction(
      chat,
      currentState,
      clientAction,
      content,
      {
        status: "processing",
        searchConfirmed: true,
        deferredSearch: false,
        excludedOfferIds: [],
        activeConfirmedCareer: career,
        activeConfirmedLevel: career.level,
        activeSearchQuery: career.searchQuery,
        currentCanonicalProgramId: career.canonicalProgramId,
        currentLevel: career.academicLevel,
        currentFamilyId: career.familyId || null,
        exploredProgramIds: career.fromRelated
          ? [...new Set([
              ...(currentState.exploredProgramIds || []),
              currentState.currentCanonicalProgramId,
              career.canonicalProgramId,
            ].filter(Boolean))]
          : [career.canonicalProgramId],
        shownFamilyProgramIds: [],
        shownNearbyProgramIds: [],
        relatedStage: "family",
        relatedHasMore: false,
      },
    );
    const result = await runConfirmedEducativeSearch(chat, state, career, false);
    return { userMessage, assistantMessage: result.assistantMessage };
  }

  if (clientAction.type === "more_educative_results") {
    const career = currentState.activeConfirmedCareer;
    if (!career || !currentState.activeSearchQuery) {
      throw new ApiError(409, "No hay una busqueda educativa activa");
    }

    const activeCareer = {
      ...career,
      searchQuery: currentState.activeSearchQuery,
      level: currentState.activeConfirmedLevel || career.level,
    };
    const { userMessage, state } = await consumePendingAction(
      chat,
      currentState,
      clientAction,
      content,
      { status: "processing" },
    );
    const result = await runConfirmedEducativeSearch(chat, state, activeCareer, true);
    return { userMessage, assistantMessage: result.assistantMessage };
  }

  throw new ApiError(400, "La accion educativa no es compatible");
}

async function updateTitleAfterMessage(chat, content) {
  const totalMessages = await countMessagesByChatId(chat.id);
  if (chat.title === "Nueva conversacion" && totalMessages <= 2) {
    await updateChat(chat.id, { title: deriveChatTitle(content) });
  } else {
    await updateChat(chat.id, {});
  }
}

export async function listChats(userId) {
  const chats = await listChatsByUserId(userId);
  return chats.map((chat) => ({
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat._count.messages,
  }));
}

export async function createChat(userId, title = "Nueva conversacion") {
  return createChatRecord({
    userId,
    title: title.trim() || "Nueva conversacion",
  });
}

export async function getChatMessages(chatId, userId) {
  await getOwnedChat(chatId, userId);
  return listMessagesByChatId(chatId);
}

export async function sendMessage(chatId, userId, content, action = null) {
  ensureContent(content);
  const chat = await getOwnedChat(chatId, userId);
  const currentState = getChatEducativeState(chat);
  const typedAction = action ? null : classifyTypedAction(content, currentState);
  const requestedAction = action || (
    typedAction
      ? {
          ...typedAction,
          actionId: currentState.pendingConfirmationActionId,
          ...(
            typedAction.type === "explore_related_careers" ||
            typedAction.type === "more_related_programs"
              ? {
                  career: currentState.activeConfirmedCareer?.normalizedName,
                  level: currentState.activeConfirmedLevel,
                  canonicalProgramId: currentState.currentCanonicalProgramId,
                  academicLevel: currentState.currentLevel,
                  familyId: currentState.currentFamilyId,
                  relatedStage: currentState.relatedStage,
                }
              : {}
          ),
        }
      : null
  );

  if (requestedAction) {
    const result = await handleEducativeAction(
      chat,
      userId,
      content,
      requestedAction,
      currentState,
    );
    await updateTitleAfterMessage(chat, content);
    return {
      userMessage: result.userMessage,
      assistantMessage: result.assistantMessage,
    };
  }

  const userMessage = await createMessage({
    chatId,
    role: "user",
    content: content.trim(),
  });
  const history = await listMessagesByChatId(chatId);
  const recentHistory = history.slice(-MEMORY_MESSAGE_LIMIT);
  const directCareers = await filterEligibleCanonicalCareers(detectCareerOptions(content));
  const normalizedContent = normalizeEducativeText(content);
  const isStandaloneCareer = directCareers.some(
    (career) =>
      normalizedContent === normalizeEducativeText(career.name) ||
      normalizedContent === normalizeEducativeText(career.normalizedName),
  );
  const directRequest = directCareers.length > 0 && (
    isDirectEducativeRequest(content) || isStandaloneCareer
  );
  const messagesSinceDeferral = currentState.deferredSearch
    ? currentState.messagesSinceDeferral + 1
    : currentState.messagesSinceDeferral;
  const workingState = {
    ...currentState,
    messagesSinceDeferral,
  };
  const hasStrongReinforcement = isStrongCareerReinforcement(
    content,
    currentState.lastPromptedCareers,
  );
  const hasNewCareer = hasDifferentCareer(
    directCareers,
    currentState.lastPromptedCareers,
  );
  const canPromptAfterDeferral =
    !currentState.deferredSearch ||
    messagesSinceDeferral >= 3 ||
    hasStrongReinforcement ||
    hasNewCareer ||
    isDirectInstitutionRequest(content);

  const shouldShowDirectConfirmation =
    directCareers.length > 0 &&
    canPromptAfterDeferral &&
    (
      directRequest ||
      (
        currentState.deferredSearch &&
        (hasStrongReinforcement || hasNewCareer)
      )
    );

  if (shouldShowDirectConfirmation) {
    const result = await createCareerConfirmation(
      chat,
      "",
      directCareers,
      true,
      workingState,
    );
    await updateTitleAfterMessage(chat, content);
    return {
      userMessage,
      assistantMessage: result.assistantMessage,
    };
  }

  const memoryContext = await buildMemoryContext(userId, chat);
  const assistantReply = await generateAssistantReply(
    recentHistory,
    [],
    memoryContext,
    { isEducativeRequest: false },
  );
  const inferredCareers = await filterEligibleCanonicalCareers(detectCareerOptions(assistantReply));
  const inferredHasNewCareer = hasDifferentCareer(
    inferredCareers,
    currentState.lastPromptedCareers,
  );
  const careersToPrompt = inferredCareers.length > 0
    ? inferredCareers
    : currentState.deferredSearch && messagesSinceDeferral >= 3
      ? currentState.lastPromptedCareers
      : [];
  const canShowInferredConfirmation =
    careersToPrompt.length > 0 &&
    (
      !currentState.deferredSearch ||
      messagesSinceDeferral >= 3 ||
      inferredHasNewCareer ||
      hasStrongReinforcement
    );

  let assistantMessage;
  if (canShowInferredConfirmation) {
    const result = await createCareerConfirmation(
      chat,
      assistantReply,
      careersToPrompt,
      false,
      workingState,
    );
    assistantMessage = result.assistantMessage;
  } else {
    assistantMessage = await createMessage({
      chatId,
      role: "assistant",
      content: assistantReply,
    });

    if (
      workingState.messagesSinceDeferral !== currentState.messagesSinceDeferral
    ) {
      await updateEducativeState(chat, workingState);
    }
  }

  await updateTitleAfterMessage(chat, content);
  await refreshMemoryAfterEligibleTurn({
    flow: MEMORY_REFRESH_FLOWS.CONVERSATION,
    chatId,
    messages: [...recentHistory, assistantMessage],
    currentChatSummary: memoryContext.currentChatSummary,
    userMemorySummary: memoryContext.userMemorySummary,
    userId,
  });

  return {
    userMessage,
    assistantMessage,
  };
}
export async function removeChat(chatId, userId) {
  await getOwnedChat(chatId, userId);
  await deleteChatRecord(chatId);
}
