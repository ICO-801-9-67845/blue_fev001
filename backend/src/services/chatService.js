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
  upsertUserMemory,
} from "../repositories/userMemoryRepository.js";
import { ApiError } from "../utils/ApiError.js";
import { generateAssistantReply, generateMemorySummaries } from "./aiService.js";

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

async function updateSummariesAfterReply({
  chatId,
  messages,
  currentChatSummary,
  userMemorySummary,
  userId,
}) {
  try {
    const summaries = await generateMemorySummaries({
      messages,
      currentChatSummary,
      userMemorySummary,
    });

    if (!summaries) {
      return;
    }

    if (summaries.chatSummary) {
      await updateChat(chatId, { summary: summaries.chatSummary });
    }

    if (summaries.userMemorySummary) {
      await upsertUserMemory(userId, summaries.userMemorySummary);
    }
  } catch (error) {
    console.error(`No fue posible actualizar memoria resumida: ${error.message}`);
  }
}

async function getOwnedChat(chatId, userId) {
  const chat = await findChatById(chatId);

  if (!chat || chat.userId !== userId) {
    throw new ApiError(404, "Conversacion no encontrada");
  }

  return chat;
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

export async function sendMessage(chatId, userId, content) {
  ensureContent(content);
  const chat = await getOwnedChat(chatId, userId);

  const userMessage = await createMessage({
    chatId,
    role: "user",
    content: content.trim(),
  });

  const history = await listMessagesByChatId(chatId);
  const recentHistory = history.slice(-MEMORY_MESSAGE_LIMIT);
  const previousMessages = history.filter((message) => message.id !== userMessage.id);
  const isFollowUp = isEducativeFollowUp(content);
  const isEducativeRequest = shouldSearchEducativeOffers(content) || isFollowUp;
  const searchContent = isFollowUp ? buildFollowUpSearchContent(history) : content;
  const excludedOfferIds = isFollowUp ? extractShownOfferIds(previousMessages) : [];
  const offerContext = await buildEducativeOfferContext(searchContent, {
    excludeOfferIds: excludedOfferIds,
  });
  const memoryContext = await buildMemoryContext(userId, chat);
  console.log("EDUCATIVE FOLLOW UP:", isFollowUp);
  console.log("FOLLOW UP SEARCH CONTENT:", isFollowUp ? searchContent : "");
  console.log("EXCLUDED OFFER IDS:", excludedOfferIds);
  console.log("OFFER CONTEXT:", offerContext);
  const assistantReply =
    isEducativeRequest && offerContext.length === 0
      ? buildEmptyOfferReply(isFollowUp)
      : await generateAssistantReply(recentHistory, offerContext, memoryContext, {
          isEducativeRequest,
        });

  const assistantMessage = await createMessage({
    chatId,
    role: "assistant",
    content: assistantReply,
  });

  await updateChat(chatId, {});

  const totalMessages = await countMessagesByChatId(chatId);

  if (chat.title === "Nueva conversacion" && totalMessages <= 2) {
    await updateChat(chatId, { title: deriveChatTitle(content) });
  }

  await updateSummariesAfterReply({
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
