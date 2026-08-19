const MEMORY_ROLES = new Set(["user", "assistant"]);

const DETERMINISTIC_MARKERS = Object.freeze({
  career_confirmation: "[Solicito confirmacion de una carrera]",
  search_followup:
    "[Mostro opciones educativas verificadas y ofrecio mostrar mas]",
  search_exhausted:
    "[Mostro las opciones educativas disponibles y ofrecio continuar la conversacion]",
});

function toText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  try {
    return String(value);
  } catch {
    return "";
  }
}

export function countUnicodeCharacters(value) {
  return Array.from(toText(value)).length;
}

export function truncateMemoryText(value, maxCharacters) {
  const text = toText(value).trim();
  if (!text || maxCharacters <= 0) {
    return "";
  }

  return Array.from(text).slice(0, maxCharacters).join("");
}

function getOwnDataProperty(object, property) {
  if (!object || typeof object !== "object") {
    return undefined;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, property);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function getMessageIdentity(message, role) {
  const id = getOwnDataProperty(message, "id");
  if (typeof id === "string" || typeof id === "number" || typeof id === "bigint") {
    const normalized = String(id).trim();
    return normalized ? `${role}:${normalized}` : "";
  }
  return "";
}

function getDeterministicActionType(message) {
  const uiAction = getOwnDataProperty(message, "uiAction");
  const type = getOwnDataProperty(uiAction, "type");
  return typeof type === "string" ? type : "";
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  const seenIds = new Set();
  const seenObjects = new WeakSet();
  const normalizedReverse = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const source = messages[index];
    const role = getOwnDataProperty(source, "role");
    if (!MEMORY_ROLES.has(role)) {
      continue;
    }

    const identity = getMessageIdentity(source, role);
    if (identity && seenIds.has(identity)) {
      continue;
    }
    if (source && typeof source === "object") {
      if (seenObjects.has(source)) {
        continue;
      }
      seenObjects.add(source);
    }
    if (identity) {
      seenIds.add(identity);
    }

    const originalContent = toText(
      getOwnDataProperty(source, "content"),
    ).trim();
    const deterministicMarker =
      role === "assistant"
        ? DETERMINISTIC_MARKERS[getDeterministicActionType(source)] || ""
        : "";
    const content = deterministicMarker || originalContent;
    if (!content) {
      continue;
    }

    normalizedReverse.push({
      role,
      content,
      sourceIndex: index,
      originalContentLength: countUnicodeCharacters(originalContent),
      compacted: Boolean(deterministicMarker),
    });
  }

  return normalizedReverse.reverse();
}

function getTranscriptOverhead(selectedCount) {
  return selectedCount === 0 ? 3 : 4;
}

function addCandidate(state, candidate, perMessageLimit) {
  if (!candidate || state.selected.length >= state.messageLimit) {
    return false;
  }

  const overhead = getTranscriptOverhead(state.selected.length);
  const remaining = state.characterBudget - state.transcriptCharacters - overhead;
  if (remaining <= 0) {
    return false;
  }

  const originalLength = countUnicodeCharacters(candidate.content);
  const allowedLength = Math.min(perMessageLimit, remaining);
  const content = truncateMemoryText(candidate.content, allowedLength);
  if (!content) {
    return false;
  }

  const contentLength = countUnicodeCharacters(content);
  state.selected.push({
    ...candidate,
    content,
    truncated: contentLength < originalLength,
  });
  state.transcriptCharacters += overhead + contentLength;
  return true;
}

export function selectMemoryMessages(
  messages,
  {
    messageLimit = 8,
    characterBudget = 3600,
    userMessageMaxChars = 600,
    assistantMessageMaxChars = 350,
  } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  const normalized = normalizeMessages(source);
  const latestUser = normalized.findLast((message) => message.role === "user");
  const latestAssistantAfterUser = latestUser
    ? normalized.findLast(
        (message) =>
          message.role === "assistant" &&
          message.sourceIndex > latestUser.sourceIndex,
      )
    : normalized.findLast((message) => message.role === "assistant");
  const state = {
    selected: [],
    transcriptCharacters: 0,
    messageLimit,
    characterBudget,
  };

  if (latestUser) {
    addCandidate(state, latestUser, userMessageMaxChars);
  }
  if (latestAssistantAfterUser) {
    addCandidate(state, latestAssistantAfterUser, assistantMessageMaxChars);
  }

  const selectedIndexes = new Set(
    state.selected.map((message) => message.sourceIndex),
  );
  const remainingUsers = normalized
    .filter(
      (message) =>
        message.role === "user" && !selectedIndexes.has(message.sourceIndex),
    )
    .reverse();
  const remainingAssistants = normalized
    .filter(
      (message) =>
        message.role === "assistant" &&
        !selectedIndexes.has(message.sourceIndex),
    )
    .reverse();

  for (const candidate of [...remainingUsers, ...remainingAssistants]) {
    const perMessageLimit =
      candidate.role === "user"
        ? userMessageMaxChars
        : assistantMessageMaxChars;
    if (addCandidate(state, candidate, perMessageLimit)) {
      selectedIndexes.add(candidate.sourceIndex);
    }
  }

  const selected = state.selected.sort(
    (left, right) => left.sourceIndex - right.sourceIndex,
  );
  const transcript = selected
    .map((message) => `${message.role === "user" ? "U" : "A"}: ${message.content}`)
    .join("\n");
  const messagesResult = selected.map(({ role, content }) => ({ role, content }));
  const selectedMessageCharacterCount = selected.reduce(
    (total, message) => total + countUnicodeCharacters(message.content),
    0,
  );
  const originalMessageCharacterCount = normalized.reduce(
    (total, message) => total + message.originalContentLength,
    0,
  );

  return {
    messages: messagesResult,
    transcript,
    metrics: {
      originalMessageCount: source.length,
      selectedMessageCount: selected.length,
      originalMessageCharacterCount,
      selectedMessageCharacterCount,
      droppedMessageCount: source.length - selected.length,
      truncatedMessageCount: selected.filter((message) => message.truncated).length,
      compactedDeterministicMessageCount: selected.filter(
        (message) => message.compacted,
      ).length,
      transcriptCharacterBudget: characterBudget,
      transcriptCharacterCount: countUnicodeCharacters(transcript),
      latestUserMessagePreserved: Boolean(
        latestUser &&
          selected.some((message) => message.sourceIndex === latestUser.sourceIndex),
      ),
    },
  };
}

export function buildMemoryPrompt({
  transcript = "",
  currentChatSummary = "",
  userMemorySummary = "",
  currentChatSummaryMaxChars = 500,
  userMemoryMaxChars = 700,
} = {}) {
  const limitedChatSummary = truncateMemoryText(
    currentChatSummary,
    currentChatSummaryMaxChars,
  );
  const limitedUserMemory = truncateMemoryText(
    userMemorySummary,
    userMemoryMaxChars,
  );
  const sections = [
    limitedChatSummary ? `CHAT_PREV:\n${limitedChatSummary}` : "",
    limitedUserMemory ? `USER_PREV:\n${limitedUserMemory}` : "",
    toText(transcript).trim() ? `RECENT:\n${toText(transcript).trim()}` : "",
  ].filter(Boolean);
  const prompt = sections.join("\n\n");

  return {
    prompt,
    currentChatSummary: limitedChatSummary,
    userMemorySummary: limitedUserMemory,
    metrics: {
      currentChatSummaryCharacterCount:
        countUnicodeCharacters(limitedChatSummary),
      userMemoryCharacterCount: countUnicodeCharacters(limitedUserMemory),
      promptCharacterCount: countUnicodeCharacters(prompt),
      includedCurrentChatSummary: Boolean(limitedChatSummary),
      includedUserMemory: Boolean(limitedUserMemory),
    },
  };
}

export function buildMemorySummarySystemInstruction({
  targetChatSummaryChars = 450,
  targetUserMemoryChars = 650,
} = {}) {
  return [
    "Actualiza los resumenes usando solo hechos explicitos.",
    "Conserva informacion previa vigente y reemplaza la contradicha por datos recientes.",
    "No inventes ni infieras datos sensibles.",
    "No guardes listas de escuelas, URLs, IDs, texto trivial ni respuestas completas de Blue.",
    "Evita duplicar informacion entre campos.",
    `chatSummary mantiene la continuidad de este chat (objetivo maximo: ${targetChatSummaryChars} caracteres).`,
    `userMemorySummary contiene preferencias estables reutilizables entre chats (objetivo maximo: ${targetUserMemoryChars} caracteres).`,
    'Responde solo JSON valido con exactamente las claves "chatSummary" y "userMemorySummary".',
  ].join("\n");
}

export function buildMemoryRequestContext({
  messages,
  currentChatSummary = "",
  userMemorySummary = "",
  model,
  limits = {},
} = {}) {
  const selection = selectMemoryMessages(messages, limits);
  const promptResult = buildMemoryPrompt({
    transcript: selection.transcript,
    currentChatSummary,
    userMemorySummary,
    currentChatSummaryMaxChars: limits.currentChatSummaryMaxChars,
    userMemoryMaxChars: limits.userMemoryMaxChars,
  });

  return {
    messages: selection.messages,
    transcript: selection.transcript,
    prompt: promptResult.prompt,
    metrics: {
      event: "gemini_memory_context_usage",
      requestType: "memory",
      model: toText(model),
      ...selection.metrics,
      ...promptResult.metrics,
    },
  };
}
