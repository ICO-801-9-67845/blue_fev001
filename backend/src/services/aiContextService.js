const DETERMINISTIC_ACTION_TYPES = new Set([
  "career_confirmation",
  "search_followup",
  "search_exhausted",
]);

const PREVIOUS_CHAT_RECALL_PATTERNS = [
  /^(?:oye\s+|blue\s+|por favor\s+)?recuerda(?:s)?\b/,
  /\bcomo te (?:dije|conte)\b/,
  /\bte habia (?:dicho|contado)\b/,
  /\bya te habia (?:dicho|contado)\b/,
  /\bhablamos antes\b/,
  /\ben otro chat\b/,
  /\blo que te dije antes\b/,
  /\blo que hablamos\b/,
  /\b(?:te dije|te conte|te mencione) anteriormente\b/,
  /^anteriormente$/,
];

const PREVIOUS_MESSAGE_MAX_CHARS = 1200;
const EDUCATIVE_CONTINUITY_MAX_CHARS = 220;

function toText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function normalizeRecallText(value) {
  return toText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAtWord(value, maxChars) {
  const text = toText(value);

  if (text.length <= maxChars) {
    return text;
  }

  if (maxChars <= 1) {
    return maxChars === 1 ? "…" : "";
  }

  const candidate = text.slice(0, maxChars - 1);
  const lastWhitespace = candidate.search(/\s+\S*$/);
  const boundary =
    lastWhitespace >= Math.floor((maxChars - 1) * 0.6)
      ? lastWhitespace
      : candidate.length;
  return candidate.slice(0, boundary).trimEnd() + "…";
}

function getSafeCareerName(uiAction) {
  const candidate =
    typeof uiAction?.career === "string"
      ? uiAction.career
      : Array.isArray(uiAction?.careers)
        ? uiAction.careers.find((career) => toText(career?.name).trim())?.name
        : "";
  const normalized = toText(candidate).replace(/\s+/g, " ").trim();

  if (
    !normalized ||
    /https?:\/\/|www\.|\/oferta-educativa\/|@|\b(?:action|canonical|family)?id\b|\b(?:cursor|redirect_url|telefono|phone)\b|\+?\d[\d\s().-]{7,}\d/i.test(normalized)
  ) {
    return "";
  }

  return truncateAtWord(normalized, 120);
}

function buildDeterministicMessageText(type, careerName) {
  if (type === "career_confirmation") {
    return careerName
      ? `Blue mostró opciones educativas validadas por el backend para ${careerName}.`
      : "Blue mostró opciones educativas validadas por el backend.";
  }

  if (type === "search_followup") {
    return careerName
      ? `Blue mostró resultados educativos validados para ${careerName} y existen más opciones.`
      : "Blue mostró resultados educativos validados por el backend y existen más opciones.";
  }

  if (type === "search_exhausted") {
    return careerName
      ? `Blue mostró los resultados educativos disponibles para ${careerName} y la búsqueda quedó agotada.`
      : "Blue mostró los resultados educativos disponibles y la búsqueda quedó agotada.";
  }

  return "";
}

export function shouldIncludePreviousChatSummaries({
  history = [],
  currentMessage = "",
} = {}) {
  const userMessageCount = (Array.isArray(history) ? history : []).filter(
    (message) => message?.role === "user" && toText(message?.content).trim(),
  ).length;

  if (userMessageCount <= 2) {
    return true;
  }

  const normalizedCurrentMessage = normalizeRecallText(currentMessage);
  return PREVIOUS_CHAT_RECALL_PATTERNS.some((pattern) =>
    pattern.test(normalizedCurrentMessage),
  );
}

export function compactDeterministicAssistantMessage(message = {}) {
  const copy = { ...message };
  const type = message?.uiAction?.type;

  if (
    message?.role !== "assistant" ||
    !DETERMINISTIC_ACTION_TYPES.has(type)
  ) {
    return { message: copy, compacted: false };
  }

  return {
    message: {
      role: "assistant",
      content: buildDeterministicMessageText(
        type,
        getSafeCareerName(message.uiAction),
      ),
    },
    compacted: true,
  };
}

export function selectConversationHistory(
  history,
  {
    hasCurrentChatSummary = false,
    limitWithSummary = 6,
    limitWithoutSummary = 8,
    maxCharsWithSummary = 3200,
    maxCharsWithoutSummary = 4800,
  } = {},
) {
  const source = (Array.isArray(history) ? history : []).map((message, index) => ({
    ...message,
    content: toText(message?.content),
    sourceIndex: index,
  }));
  const historyMessageLimit = hasCurrentChatSummary
    ? limitWithSummary
    : limitWithoutSummary;
  const historyCharacterBudget = hasCurrentChatSummary
    ? maxCharsWithSummary
    : maxCharsWithoutSummary;
  const originalHistoryCharacterCount = source.reduce(
    (total, message) => total + message.content.length,
    0,
  );
  let currentMessageIndex = -1;

  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (
      source[index].role === "user" &&
      source[index].content.trim()
    ) {
      currentMessageIndex = index;
      break;
    }
  }

  if (currentMessageIndex === -1) {
    return {
      messages: [],
      metrics: {
        originalHistoryMessageCount: source.length,
        selectedHistoryMessageCount: 0,
        originalHistoryCharacterCount,
        selectedHistoryCharacterCount: 0,
        droppedHistoryMessageCount: source.length,
        truncatedHistoryMessageCount: 0,
        compactedDeterministicMessageCount: 0,
        historyMessageLimit,
        historyCharacterBudget,
        currentMessagePreserved: false,
        currentMessageExceededBudget: false,
      },
    };
  }

  const currentMessage = {
    ...source[currentMessageIndex],
    compacted: false,
    truncated: false,
  };
  const selectedReverse = [currentMessage];
  let selectedCharacterCount = currentMessage.content.length;

  for (
    let index = currentMessageIndex - 1;
    index >= 0 && selectedReverse.length < historyMessageLimit;
    index -= 1
  ) {
    if (!source[index].content.trim()) {
      continue;
    }

    const compacted = compactDeterministicAssistantMessage(source[index]);
    let content = toText(compacted.message.content);
    let truncated = false;

    if (content.length > PREVIOUS_MESSAGE_MAX_CHARS) {
      content = truncateAtWord(content, PREVIOUS_MESSAGE_MAX_CHARS);
      truncated = true;
    }

    const remainingBudget = historyCharacterBudget - selectedCharacterCount;

    if (remainingBudget <= 0) {
      continue;
    }

    if (content.length > remainingBudget) {
      content = truncateAtWord(content, remainingBudget);
      truncated = true;
    }

    if (!content.trim()) {
      continue;
    }

    selectedReverse.push({
      ...compacted.message,
      content,
      sourceIndex: index,
      compacted: compacted.compacted,
      truncated,
    });
    selectedCharacterCount += content.length;
  }

  const selected = selectedReverse.reverse();

  while (selected[0]?.role === "assistant") {
    selected.shift();
  }

  const messages = selected.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const selectedHistoryCharacterCount = messages.reduce(
    (total, message) => total + toText(message.content).length,
    0,
  );

  return {
    messages,
    metrics: {
      originalHistoryMessageCount: source.length,
      selectedHistoryMessageCount: messages.length,
      originalHistoryCharacterCount,
      selectedHistoryCharacterCount,
      droppedHistoryMessageCount: source.length - messages.length,
      truncatedHistoryMessageCount: selected.filter((message) => message.truncated).length,
      compactedDeterministicMessageCount: selected.filter((message) => message.compacted).length,
      historyMessageLimit,
      historyCharacterBudget,
      currentMessagePreserved: selected.some(
        (message) => message.sourceIndex === currentMessageIndex,
      ),
      currentMessageExceededBudget:
        currentMessage.content.length > historyCharacterBudget,
    },
  };
}

function sanitizeContinuityValue(value, maxChars) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
    return "";
  }

  const withoutUrls = toText(value)
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/\b(?:action|canonical|family)?id\s*[:#=-]?\s*[a-z0-9-]+\b/gi, "")
    .replace(/\b(?:cursor|redirect_url)\s*[:#=-]?\s*\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return truncateAtWord(withoutUrls, maxChars);
}

export function buildEducativeContinuitySummary(state = {}) {
  const career = sanitizeContinuityValue(
    state?.activeConfirmedCareer?.name,
    120,
  );
  const level = sanitizeContinuityValue(
    state?.currentLevel || state?.activeConfirmedLevel,
    60,
  );
  const status = sanitizeContinuityValue(state?.status, 40);
  const hasRelevantStatus = status && status !== "idle";

  if (!career && !level && !hasRelevantStatus) {
    return "";
  }

  const details = [
    career ? `el usuario exploró ${career}` : "existe una exploración educativa activa",
    level ? `nivel ${level}` : "",
    hasRelevantStatus ? `estado ${status}` : "",
  ].filter(Boolean);

  return truncateAtWord(
    `Contexto educativo actual: ${details.join(", ")}.`,
    EDUCATIVE_CONTINUITY_MAX_CHARS,
  );
}

function buildContents(messages, contextualText) {
  const contents = messages
    .filter((message) => toText(message?.content).trim())
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: toText(message.content) }],
    }));

  if (!contextualText) {
    return contents;
  }

  let lastUserIndex = -1;

  for (let index = contents.length - 1; index >= 0; index -= 1) {
    if (contents[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }

  if (lastUserIndex === -1) {
    return [
      {
        role: "user",
        parts: [{ text: contextualText }],
      },
      ...contents,
    ];
  }

  const originalUserText = contents[lastUserIndex].parts
    .map((part) => part.text)
    .join("\n");

  contents[lastUserIndex] = {
    role: "user",
    parts: [
      {
        text: `${contextualText}

Mensaje actual del usuario:
${originalUserText}`,
      },
    ],
  };

  return contents;
}

export function buildAssistantRequestContext({
  history = [],
  offerContext = [],
  memoryContext = {},
  memoryContextText = "",
  offerContextText = "",
  baseSystemInstruction = "",
  educativeOfferRules = "",
  model = "",
  limits = {},
} = {}) {
  const hasOffers = Array.isArray(offerContext) && offerContext.length > 0;
  const selection = selectConversationHistory(history, {
    hasCurrentChatSummary: Boolean(
      toText(memoryContext?.currentChatSummary).trim(),
    ),
    ...limits,
  });
  const contextualText = [memoryContextText, offerContextText]
    .map((value) => toText(value).trim())
    .filter(Boolean)
    .join("\n\n");
  const previousChatSummaries = Array.isArray(
    memoryContext?.previousChatSummaries,
  )
    ? memoryContext.previousChatSummaries.filter((chat) =>
        toText(chat?.summary).trim(),
      )
    : [];

  return {
    systemInstruction: hasOffers
      ? `${baseSystemInstruction}

${educativeOfferRules}`
      : baseSystemInstruction,
    contents: buildContents(selection.messages, contextualText),
    metrics: {
      event: "gemini_context_usage",
      requestType: "conversation",
      model,
      systemPromptMode: hasOffers ? "educative" : "base",
      ...selection.metrics,
      includedUserMemory: Boolean(
        toText(memoryContext?.userMemorySummary).trim(),
      ),
      includedCurrentChatSummary: Boolean(
        toText(memoryContext?.currentChatSummary).trim(),
      ),
      includedPreviousChatSummaries: previousChatSummaries.length > 0,
      previousChatSummaryCount: previousChatSummaries.length,
      includedEducativeContinuitySummary: Boolean(
        toText(memoryContext?.educativeContinuitySummary).trim(),
      ),
      includedOfferContext: hasOffers && Boolean(toText(offerContextText).trim()),
      offerCount: hasOffers ? offerContext.length : 0,
      includedEducativeRules: hasOffers,
    },
  };
}

export function countHistoryCharacters(history = []) {
  return (Array.isArray(history) ? history : []).reduce(
    (total, message) => total + toText(message?.content).length,
    0,
  );
}
