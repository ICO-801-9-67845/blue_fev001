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
  buildEducativeContinuitySummary,
  shouldIncludePreviousChatSummaries,
} from "./aiContextService.js";
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
import {
  applyVocationalUpdates,
  extractExplicitVocationalUpdates,
  normalizeVocationalProfile,
} from "./vocationalPreferenceService.js";
import { rankVocationalFlowCandidates } from "./vocationalRankingIntegrationService.js";
import {
  closeVocationalCareerPaginationState,
  createVocationalCareerPaginationState,
  getCurrentVocationalCareerPage,
  getNextVocationalCareerPage,
} from "./vocationalCareerPaginationService.js";

const MEMORY_SUMMARY_MESSAGE_LIMIT = 12;
const VOCATIONAL_CANDIDATE_LIMIT = 128;
const SAFE_VOCATIONAL_FALLBACK =
  "Necesito un poco mas de informacion sobre tus intereses antes de sugerir una carrera. Podemos seguir conversando.";
const EXPLICIT_CAREER_REQUEST_PATTERN =
  /\b(?:quiero|quisiera|deseo|busco|necesito|planeo)\s+(?:estudiar|cursar|explorar|conocer)\b|\b(?:donde|como)\s+(?:puedo\s+)?(?:estudiar|cursar)\b|\b(?:cuentame|dime|informame)\s+(?:algo\s+)?(?:sobre|de)\b|\b(?:quiero\s+ver|muestrame|dame|busco)\s+(?:escuelas|universidades|instituciones|opciones)\b|\bque\s+opciones\b/;
const NEGATED_CAREER_REQUEST_PATTERN =
  /\b(?:no|nunca|jamas)\s+(?:quiero|quisiera|deseo|busco|necesito|planeo)\s+(?:estudiar|cursar|explorar|conocer)\b/;

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

async function buildMemoryContext(
  userId,
  chat,
  history,
  currentMessage,
  educativeState,
) {
  const includePreviousChatSummaries = shouldIncludePreviousChatSummaries({
    history,
    currentMessage,
  });
  const [userMemory, previousChatSummaries] = await Promise.all([
    findUserMemoryByUserId(userId),
    includePreviousChatSummaries
      ? listRecentChatSummariesByUserId(userId, chat.id, 2)
      : Promise.resolve([]),
  ]);

  return {
    userMemorySummary: userMemory?.summary || "",
    currentChatSummary: chat.summary || "",
    previousChatSummaries,
    educativeContinuitySummary: buildEducativeContinuitySummary(educativeState),
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
    "more_vocational_careers",
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

function isExplicitCareerRequest(content, career) {
  const normalizedContent = normalizeEducativeText(content);
  const aliases = [career?.matchedAlias, career?.name, career?.normalizedName]
    .map(normalizeEducativeText)
    .filter(Boolean);
  if (aliases.some((alias) => normalizedContent === alias)) return true;
  const requestText = normalizedContent.replace(NEGATED_CAREER_REQUEST_PATTERN, "");
  return aliases.some((alias) => {
    const aliasIndex = requestText.indexOf(alias);
    if (aliasIndex < 0) return false;
    const prefix = requestText.slice(0, aliasIndex);
    const clauseStart = Math.max(
      prefix.lastIndexOf(","),
      prefix.lastIndexOf(";"),
      prefix.lastIndexOf("."),
      prefix.lastIndexOf(" pero "),
      prefix.lastIndexOf(" aunque "),
    );
    return EXPLICIT_CAREER_REQUEST_PATTERN.test(prefix.slice(clauseStart + 1));
  });
}

function isExplicitCareerRejection(content) {
  return NEGATED_CAREER_REQUEST_PATTERN.test(normalizeEducativeText(content));
}

function evaluateCareerCandidates(state, careers, source) {
  if (!careers?.length) return null;
  const result = rankVocationalFlowCandidates({
    vocationalProfile: state.vocationalProfile,
    currentRevision: state.vocationalProfile.revision,
    candidates: careers.map((career) => ({
      career,
      source: typeof source === "function" ? source(career) : source,
    })),
  });
  if (result.status === "ranking_error") {
    console.warn({
      event: "vocational_ranking_failure",
      code: result.code,
      candidateCount: result.candidateCount,
    });
  }
  return result;
}

function getAllowedRankedCareers(result) {
  if (!result || result.status !== "ok") return [];
  return result.ordered
    .filter((item) => item.decision.classification !== "rejected")
    .map((item) => ({
      ...item.career,
      vocationalBucket: item.decision.classification,
    }));
}

function rankingRejectedAll(result) {
  return result?.status === "ok" && result.candidateCount > 0 &&
    result.rejected.length === result.ordered.length;
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

function hasVocationalOperations(extraction) {
  return [
    extraction.updates,
    extraction.exclusionsToAdd,
    extraction.exclusionsToLift,
    extraction.removeSignals,
  ].some((items) => Array.isArray(items) && items.length > 0);
}

async function createUserMessageWithVocationalProfile(
  chat,
  content,
  currentState,
  detectedCareerMentions,
) {
  const extraction = extractExplicitVocationalUpdates({
    text: content,
    currentProfile: normalizeVocationalProfile(currentState.vocationalProfile),
    canonicalMentions: detectedCareerMentions,
  });
  if (!hasVocationalOperations(extraction)) {
    const userMessage = await createMessage({
      chatId: chat.id,
      role: "user",
      content: content.trim(),
    });
    return { userMessage, state: currentState, profilePersisted: false };
  }

  const expectedVersion = Number(chat.educativeStateVersion) || 0;
  const result = await prisma.$transaction(async (transaction) => {
    const userMessage = await transaction.message.create({
      data: { chatId: chat.id, role: "user", content: content.trim() },
    });
    const applied = applyVocationalUpdates(currentState.vocationalProfile, extraction, {
      nextRevision: currentState.vocationalProfile.revision + 1,
      observedAt: userMessage.createdAt.toISOString(),
    });
    if (!applied.changed) return { userMessage, state: currentState, profilePersisted: false };

    const nextState = { ...currentState, vocationalProfile: applied.profile };
    const updated = await transaction.chat.updateMany({
      where: { id: chat.id, userId: chat.userId, educativeStateVersion: expectedVersion },
      data: { educativeState: nextState, educativeStateVersion: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new ApiError(409, "La conversacion cambio mientras procesabamos la accion");
    }
    return { userMessage, state: nextState, profilePersisted: true };
  });

  if (result.profilePersisted) {
    chat.educativeState = result.state;
    chat.educativeStateVersion = expectedVersion + 1;
  }
  return result;
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
  paginationOverride = null,
) {
  await expirePendingAction(chat, state);
  const paginationState = relatedContext
    ? null
    : paginationOverride || createVocationalCareerPaginationState(careers.map((career) => ({
        canonicalProgramId: career.canonicalProgramId,
        bucket: career.vocationalBucket || career.bucket || "confirmation_required",
        name: career.name,
        normalizedName: career.normalizedName,
        level: career.level,
        academicLevel: career.academicLevel,
        searchQuery: career.searchQuery,
        familyId: career.familyId || null,
        exactAliases: career.exactAliases || [],
        ...(career.matchedAlias ? { matchedAlias: career.matchedAlias } : {}),
        ...(career.fromRelated ? { fromRelated: true } : {}),
        ...(career.relationType ? { relationType: career.relationType } : {}),
        ...(career.searchContinuation ? { searchContinuation: true } : {}),
      })), {
        stateVersion: (Number(chat.educativeStateVersion) || 0) + 1,
      });
  const visibleCareers = paginationState
    ? getCurrentVocationalCareerPage(paginationState).careers
    : careers;
  const uiAction = createUiAction("career_confirmation", {
    careers: visibleCareers.map(({
      name,
      normalizedName,
      level,
      academicLevel,
    }) => ({
      name,
      normalizedName,
      level,
      academicLevel,
    })),
    hasMoreCareers: Boolean(paginationState?.hasMore),
    relatedHasMore: Boolean(relatedContext?.hasMore),
    relatedStage: relatedContext?.stage || null,
    canonicalProgramId: relatedContext?.canonicalProgramId || null,
    familyId: relatedContext?.familyId || null,
    academicLevel: relatedContext?.academicLevel || null,
  });
  const nextState = {
    ...state,
    status: "awaiting_confirmation",
    pendingCareers: visibleCareers,
    pendingLevel: visibleCareers.length === 1 ? visibleCareers[0].level : null,
    searchConfirmed: false,
    deferredSearch: false,
    messagesSinceDeferral: 0,
    lastPromptedCareers: visibleCareers,
    lastPromptedAt: new Date().toISOString(),
    hasMoreResults: false,
    relatedHasMore: Boolean(relatedContext?.hasMore),
    relatedStage: relatedContext?.stage || state.relatedStage,
    vocationalCareerPagination: paginationState,
  };
  const reply = content || buildConfirmationReply(visibleCareers, directRequest);
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
    vocationalCareerPagination: null,
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
  const careers = [...(state.pendingCareers || [])];
  const uiAction = createUiAction("career_confirmation", {
    careers: careers.map(({
      name,
      normalizedName,
      level,
      academicLevel,
    }) => ({
      name,
      normalizedName,
      level,
      academicLevel,
    })),
    hasMoreCareers: Boolean(state.vocationalCareerPagination?.hasMore),
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

async function filterRankedCareersForPrompt(result) {
  if (!result || result.status !== "ok") return [];
  return getAllowedRankedCareers(result);
}

async function getRelatedPage(state) {
  const currentId = state.currentCanonicalProgramId;
  const excluded = new Set([
    currentId,
    ...(state.exploredProgramIds || []),
    ...(state.shownFamilyProgramIds || []),
    ...(state.shownNearbyProgramIds || []),
  ].filter(Boolean));

  const collectCanonical = (ids, relationType) => {
    return ids
      .filter((id) => !excluded.has(id))
      .map(toCanonicalCareerCandidate)
      .filter((candidate) => candidate && candidate.academicLevel === state.currentLevel)
      .map((candidate) => ({ ...candidate, fromRelated: true, relationType }));
  };

  const includeFamily = state.relatedStage !== "nearby" && state.relatedStage !== "exhausted";
  const familyCandidates = includeFamily
    ? collectCanonical(getFamilyCandidateIds(currentId), "family")
    : [];
  const nearbyCandidates = collectCanonical(getNearbyCandidateIds(currentId), "nearby");
  const candidates = [...familyCandidates, ...nearbyCandidates];
  const ranking = evaluateCareerCandidates(
    state,
    candidates,
    (career) => career.relationType === "family" ? "same_family" : "documented_nearby",
  );
  if (ranking?.status === "ranking_error") {
    return { careers: [], hasMore: false, stage: state.relatedStage, rankingError: true };
  }

  const eligible = await filterRankedCareersForPrompt(ranking, Number.POSITIVE_INFINITY);
  const family = eligible.filter((career) => career.relationType === "family");
  const nearby = eligible.filter((career) => career.relationType === "nearby");
  if (family.length) {
    return {
      careers: family.slice(0, 3),
      hasMore: family.length > 3 || nearby.length > 0,
      stage: "family",
    };
  }
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
  if (page.rankingError) {
    const assistantMessage = await createMessage({
      chatId: chat.id,
      role: "assistant",
      content: SAFE_VOCATIONAL_FALLBACK,
    });
    return { userMessage: consumed.userMessage, assistantMessage };
  }
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
      pendingCareers: [],
      pendingLevel: null,
      vocationalCareerPagination: null,
    },
  );
  const history = await listMessagesByChatId(chat.id);
  const memoryHistory = history.slice(-MEMORY_SUMMARY_MESSAGE_LIMIT);
  const memoryContext = await buildMemoryContext(
    userId,
    chat,
    history,
    content,
    consumedState,
  );
  const assistantReply = await generateAssistantReply(
    history,
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
    messages: [...memoryHistory, assistantMessage],
    currentChatSummary: memoryContext.currentChatSummary,
    userMemorySummary: memoryContext.userMemorySummary,
    userId,
  });

  return { userMessage, assistantMessage, state: consumedState };
}
async function advanceVocationalCareerPage(chat, state, clientAction, content) {
  const actionMessage = await validatePendingAction(chat, state, clientAction);
  const expectedVersion = Number(chat.educativeStateVersion) || 0;
  if (state.vocationalCareerPagination?.stateVersion !== expectedVersion) {
    throw new ApiError(409, "La pagina de carreras quedo obsoleta");
  }

  let pagination;
  try {
    pagination = getNextVocationalCareerPage(state.vocationalCareerPagination);
  } catch {
    throw new ApiError(409, "La pagina de carreras ya no esta disponible");
  }
  const page = getCurrentVocationalCareerPage(pagination);
  const uiAction = createUiAction("career_confirmation", {
    careers: page.careers.map(({ name, normalizedName, level, academicLevel }) => ({
      name,
      normalizedName,
      level,
      academicLevel,
    })),
    hasMoreCareers: page.hasMore,
    relatedHasMore: false,
    relatedStage: null,
    canonicalProgramId: null,
    familyId: null,
    academicLevel: null,
  });
  const nextState = {
    ...state,
    status: "awaiting_confirmation",
    pendingCareers: page.careers,
    pendingLevel: page.careers.length === 1 ? page.careers[0].level : null,
    pendingConfirmationActionId: uiAction.id,
    pendingActionMessageId: uiAction.id,
    searchConfirmed: false,
    deferredSearch: false,
    messagesSinceDeferral: 0,
    lastPromptedCareers: page.careers,
    lastPromptedAt: new Date().toISOString(),
    hasMoreResults: false,
    relatedHasMore: false,
    vocationalCareerPagination: pagination,
  };
  const result = await prisma.$transaction(async (transaction) => {
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
      data: { uiAction: { ...actionMessage.uiAction, status: "completed" } },
    });
    const userMessage = await transaction.message.create({
      data: { chatId: chat.id, role: "user", content: content.trim() },
    });
    const assistantMessage = await transaction.message.create({
      data: {
        id: uiAction.id,
        chatId: chat.id,
        role: "assistant",
        content: buildConfirmationReply(page.careers, false),
        uiAction,
      },
    });
    return { userMessage, assistantMessage };
  });
  chat.educativeState = nextState;
  chat.educativeStateVersion = expectedVersion + 1;
  return result;
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
  if (clientAction.type === "more_vocational_careers") {
    return advanceVocationalCareerPage(chat, currentState, clientAction, content);
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
    const ranking = evaluateCareerCandidates(
      currentState,
      [career],
      "explicit_user_selection",
    );
    if (ranking?.status === "ranking_error" || rankingRejectedAll(ranking)) {
      const consumed = await consumePendingAction(
        chat,
        currentState,
        clientAction,
        content,
        {
          status: "idle",
          pendingCareers: [],
          pendingLevel: null,
          searchConfirmed: false,
          hasMoreResults: false,
          vocationalCareerPagination: currentState.vocationalCareerPagination
            ? closeVocationalCareerPaginationState(currentState.vocationalCareerPagination)
            : null,
        },
      );
      const assistantMessage = await createMessage({
        chatId: chat.id,
        role: "assistant",
        content: SAFE_VOCATIONAL_FALLBACK,
      });
      return { userMessage: consumed.userMessage, assistantMessage };
    }
    const continuingSearch = Boolean(career.searchContinuation);
    const { userMessage, state } = await consumePendingAction(
      chat,
      currentState,
      clientAction,
      content,
      {
        status: "processing",
        searchConfirmed: true,
        deferredSearch: false,
        excludedOfferIds: continuingSearch
          ? currentState.excludedOfferIds
          : [],
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
        vocationalCareerPagination: currentState.vocationalCareerPagination
          ? closeVocationalCareerPaginationState(currentState.vocationalCareerPagination)
          : null,
      },
    );
    const result = await runConfirmedEducativeSearch(chat, state, career, continuingSearch);
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
    const continuationCareer = { ...activeCareer, searchContinuation: true };
    const { userMessage, state } = await consumePendingAction(
      chat,
      currentState,
      clientAction,
      content,
      { status: "processing" },
    );
    const continuationRanking = evaluateCareerCandidates(
      state,
      [continuationCareer],
      "search_continuation",
    );
    if (continuationRanking?.status === "ranking_error" ||
        rankingRejectedAll(continuationRanking)) {
      const assistantMessage = await createMessage({
        chatId: chat.id,
        role: "assistant",
        content: SAFE_VOCATIONAL_FALLBACK,
      });
      return { userMessage, assistantMessage };
    }
    if (continuationRanking.confirmation.length > 0) {
      const confirmation = await createCareerConfirmation(
        chat,
        "",
        [continuationCareer],
        false,
        state,
      );
      return { userMessage, assistantMessage: confirmation.assistantMessage };
    }
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
  let currentState = getChatEducativeState(chat);
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

  if (currentState.vocationalCareerPagination) {
    await expirePendingAction(chat, currentState);
    currentState = await updateEducativeState(chat, {
      ...currentState,
      status: "idle",
      pendingCareers: [],
      pendingLevel: null,
      pendingConfirmationActionId: null,
      pendingActionMessageId: null,
      vocationalCareerPagination: null,
      searchConfirmed: false,
      hasMoreResults: false,
    });
  }
  const detectedCareerMentions = detectCareerOptions(
    content,
    { limit: VOCATIONAL_CANDIDATE_LIMIT },
  );
  const vocationalResult = await createUserMessageWithVocationalProfile(
    chat,
    content,
    currentState,
    detectedCareerMentions,
  );
  const userMessage = vocationalResult.userMessage;
  currentState = vocationalResult.state;
  const history = await listMessagesByChatId(chatId);
  const memoryHistory = history.slice(-MEMORY_SUMMARY_MESSAGE_LIMIT);
  const directRequest = detectedCareerMentions.some(
    (career) => isExplicitCareerRequest(content, career),
  );
  const directRanking = evaluateCareerCandidates(
    currentState,
    detectedCareerMentions,
    (career) => isExplicitCareerRequest(content, career)
      ? "explicit_user_request"
      : "direct_canonical_mention",
  );
  if (directRanking?.status === "ranking_error" ||
      (
        (directRequest || isExplicitCareerRejection(content)) &&
        rankingRejectedAll(directRanking)
      )) {
    const assistantMessage = await createMessage({
      chatId,
      role: "assistant",
      content: SAFE_VOCATIONAL_FALLBACK,
    });
    await updateTitleAfterMessage(chat, content);
    return { userMessage, assistantMessage };
  }
  const directCareers = await filterRankedCareersForPrompt(directRanking);
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
    canPromptAfterDeferral;

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

  const memoryContext = await buildMemoryContext(
    userId,
    chat,
    history,
    content,
    workingState,
  );
  const assistantReply = await generateAssistantReply(
    history,
    [],
    memoryContext,
    { isEducativeRequest: false },
  );
  const geminiCandidates = detectCareerOptions(
    assistantReply,
    { limit: VOCATIONAL_CANDIDATE_LIMIT },
  );
  const geminiRanking = evaluateCareerCandidates(
    workingState,
    geminiCandidates,
    "gemini_response",
  );
  const inferredCareers = await filterRankedCareersForPrompt(geminiRanking);
  const inferredHasNewCareer = hasDifferentCareer(
    inferredCareers,
    currentState.lastPromptedCareers,
  );
  let careersToPrompt = inferredCareers;
  let fallbackRanking = null;
  if (!careersToPrompt.length && !geminiCandidates.length &&
      currentState.deferredSearch && messagesSinceDeferral >= 3) {
    fallbackRanking = evaluateCareerCandidates(
      workingState,
      currentState.lastPromptedCareers,
      "search_continuation",
    );
    careersToPrompt = getAllowedRankedCareers(fallbackRanking);
  }
  const rankingFailed = geminiRanking?.status === "ranking_error" ||
    fallbackRanking?.status === "ranking_error";
  const hasRejectedGeminiCandidates = (geminiRanking?.rejected.length || 0) > 0;
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
    const safeReply = hasRejectedGeminiCandidates || rankingFailed ? "" : assistantReply;
    const result = await createCareerConfirmation(
      chat,
      safeReply,
      careersToPrompt,
      false,
      workingState,
    );
    assistantMessage = result.assistantMessage;
  } else {
    assistantMessage = await createMessage({
      chatId,
      role: "assistant",
      content: hasRejectedGeminiCandidates || rankingFailed
        ? SAFE_VOCATIONAL_FALLBACK
        : assistantReply,
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
    messages: [...memoryHistory, assistantMessage],
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
