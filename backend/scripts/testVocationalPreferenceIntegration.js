import assert from "node:assert/strict";
import { register } from "node:module";
import {
  getDefaultVocationalProfile,
  profilesEqual,
} from "../src/services/vocationalPreferenceService.js";
import {
  getDefaultEducativeState,
} from "../src/services/educativeConfirmationService.js";

const NOW = "2026-07-19T00:00:00.000Z";
const chatServiceUrl = new URL("../src/services/chatService.js", import.meta.url).href;
const confirmationUrl = new URL("../src/services/educativeConfirmationService.js", import.meta.url).href;
const vocationalUrl = new URL("../src/services/vocationalPreferenceService.js", import.meta.url).href;

const stubSources = {
  chatRepository: `
    const h = () => globalThis.__vocationalIntegrationHarness;
    export const findChatById = async (id) => h().chat.id === id ? h().chat : null;
    export const listRecentChatSummariesByUserId = async () => [];
    export const listChatsByUserId = async () => [];
    export const createChat = async (data) => ({ id: "new-chat", ...data });
    export const deleteChat = async () => null;
    export const updateChat = async (id, data) => { Object.assign(h().chat, data); return h().chat; };
  `,
  messageRepository: `
    const h = () => globalThis.__vocationalIntegrationHarness;
    export const createMessage = async (data) => h().createMessage(data);
    export const listMessagesByChatId = async (chatId) => h().messages.filter((item) => item.chatId === chatId);
    export const countMessagesByChatId = async (chatId) => h().messages.filter((item) => item.chatId === chatId).length;
  `,
  userMemoryRepository: `
    export const findUserMemoryByUserId = async () => null;
  `,
  prisma: `
    export default new Proxy({}, { get(_target, key) { return globalThis.__vocationalIntegrationHarness.prisma[key]; } });
  `,
  aiService: `
    export async function generateAssistantReply() {
      const h = globalThis.__vocationalIntegrationHarness;
      h.calls.gemini += 1;
      h.calls.providerAttempts += h.providerAttemptsPerCall;
      if (h.geminiError) throw h.geminiError;
      return h.assistantReply;
    }
  `,
  aiContextService: `
    export const shouldIncludePreviousChatSummaries = () => false;
    export const buildEducativeContinuitySummary = () => "";
  `,
  memoryRefreshService: `
    export const MEMORY_REFRESH_FLOWS = Object.freeze({ CONVERSATION: "conversation", CONTINUE_AFTER_ACTION: "continue_after_action" });
    export async function refreshMemoryAfterEligibleTurn() {
      globalThis.__vocationalIntegrationHarness.calls.memory += 1;
    }
  `,
  educativeSearchService: `
    export const buildEducativeSearchReply = () => "Resultados educativos stubbed";
    export async function searchEducativeOffers() {
      const h = globalThis.__vocationalIntegrationHarness;
      h.calls.search += 1;
      return h.searchResult;
    }
  `,
  educativeConfirmationService: `
    export * from ${JSON.stringify(confirmationUrl)};
    import * as actual from ${JSON.stringify(confirmationUrl)};
    export function detectCareerOptions(text, options) {
      const h = globalThis.__vocationalIntegrationHarness;
      h.detectorInputs.push(text);
      return actual.detectCareerOptions(text, options);
    }
  `,
  vocationalPreferenceService: `
    export * from ${JSON.stringify(vocationalUrl)};
    import * as actual from ${JSON.stringify(vocationalUrl)};
    export function extractExplicitVocationalUpdates(input) {
      globalThis.__vocationalIntegrationHarness.calls.extractor += 1;
      return actual.extractExplicitVocationalUpdates(input);
    }
  `,
};

const replacements = {
  "../repositories/chatRepository.js": "chatRepository",
  "../repositories/messageRepository.js": "messageRepository",
  "../config/prisma.js": "prisma",
  "../repositories/userMemoryRepository.js": "userMemoryRepository",
  "./aiService.js": "aiService",
  "./aiContextService.js": "aiContextService",
  "./memoryRefreshService.js": "memoryRefreshService",
  "./educativeSearchService.js": "educativeSearchService",
  "./educativeConfirmationService.js": "educativeConfirmationService",
  "./vocationalPreferenceService.js": "vocationalPreferenceService",
};
const hookSource = `
  const parent = ${JSON.stringify(chatServiceUrl)};
  const replacements = ${JSON.stringify(replacements)};
  const sources = ${JSON.stringify(stubSources)};
  export async function resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(parent) && replacements[specifier]) {
      return { url: "vocational-stub:" + replacements[specifier], shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
  export async function load(url, context, nextLoad) {
    if (url.startsWith("vocational-stub:")) {
      return { format: "module", source: sources[url.slice("vocational-stub:".length)], shortCircuit: true };
    }
    return nextLoad(url, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(hookSource)}`, import.meta.url);
const { sendMessage } = await import(`${chatServiceUrl}?real-vocational-integration`);

function clone(value) {
  return structuredClone(value);
}

function createHarness(profile = getDefaultVocationalProfile()) {
  const harness = {
    chat: {
      id: "chat-1", userId: "user-1", title: "Nueva conversacion", summary: null,
      educativeStateVersion: 0,
      educativeState: { ...getDefaultEducativeState(), vocationalProfile: profile },
    },
    messages: [],
    nextMessageId: 1,
    calls: { extractor: 0, gemini: 0, providerAttempts: 0, memory: 0, search: 0,
      transactions: 0, stateUpdates: 0 },
    detectorInputs: [],
    events: [],
    forceConflict: false,
    geminiError: null,
    assistantReply: "Respuesta conversacional stubbed",
    providerAttemptsPerCall: 1,
    searchResult: { offerContext: [], remainingCount: 0, searchSignature: "stub-signature" },
  };

  harness.createMessage = (data) => {
    const message = {
      id: `message-${harness.nextMessageId++}`,
      createdAt: new Date(Date.parse(NOW) + harness.nextMessageId),
      uiAction: null,
      ...clone(data),
    };
    harness.messages.push(message);
    harness.events.push(`message:${message.role}`);
    return message;
  };
  harness.updateMany = async ({ where, data }) => {
    if (harness.forceConflict) {
      harness.forceConflict = false;
      return { count: 0 };
    }
    if (where.id !== harness.chat.id || where.userId !== harness.chat.userId ||
        where.educativeStateVersion !== harness.chat.educativeStateVersion) return { count: 0 };
    harness.chat.educativeState = clone(data.educativeState);
    if (data.educativeStateVersion?.increment) harness.chat.educativeStateVersion += data.educativeStateVersion.increment;
    harness.calls.stateUpdates += 1;
    harness.events.push("chat:update");
    return { count: 1 };
  };
  const messageApi = {
    create: async ({ data }) => harness.createMessage(data),
    findFirst: async ({ where }) => harness.messages.find((message) =>
      (!where.id || message.id === where.id) && (!where.chatId || message.chatId === where.chatId) &&
      (!where.role || message.role === where.role)) || null,
    update: async ({ where, data }) => {
      const message = harness.messages.find((item) => item.id === where.id);
      if (!message) throw new Error("Stub message not found");
      Object.assign(message, clone(data));
      return message;
    },
  };
  const transaction = { message: messageApi, chat: { updateMany: harness.updateMany } };
  harness.prisma = {
    message: messageApi,
    chat: { updateMany: harness.updateMany },
    $transaction: async (callback) => {
      harness.calls.transactions += 1;
      const snapshot = { chat: clone(harness.chat), messages: clone(harness.messages),
        nextMessageId: harness.nextMessageId, events: [...harness.events] };
      harness.events.push("tx:start");
      try {
        const result = await callback(transaction);
        harness.events.push("tx:commit");
        return result;
      } catch (error) {
        Object.keys(harness.chat).forEach((key) => delete harness.chat[key]);
        Object.assign(harness.chat, snapshot.chat);
        harness.messages.splice(0, harness.messages.length, ...snapshot.messages);
        harness.nextMessageId = snapshot.nextMessageId;
        harness.events.splice(0, harness.events.length, ...snapshot.events, "tx:rollback");
        throw error;
      }
    },
  };
  globalThis.__vocationalIntegrationHarness = harness;
  return harness;
}

function fullProfile() {
  return {
    version: 1, revision: 1,
    signals: Array.from({ length: 128 }, (_, index) => ({
      conceptKind: "subject", conceptId: `m${index}`, dimension: "interest",
      polarity: "positive", intensity: 4, source: "explicit_statement",
      updatedRevision: 1, updatedAt: NOW,
    })), exclusions: [],
  };
}

function preparePendingConversation(harness) {
  const action = { id: "action-1", type: "career_confirmation", status: "pending", careers: [] };
  const assistant = harness.createMessage({
    chatId: harness.chat.id, role: "assistant", content: "Elige una opción", uiAction: action,
  });
  harness.chat.educativeState = {
    ...harness.chat.educativeState,
    status: "awaiting_confirmation",
    pendingConfirmationActionId: action.id,
    pendingActionMessageId: assistant.id,
  };
  return action;
}

const results = [];
async function test(name, callback) {
  try {
    await callback();
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
  }
}

await test("01 real open conversation calls Gemini once", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Quiero conversar");
  assert.equal(h.calls.gemini, 1);
});
await test("02 real profile update adds no Gemini call", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Me gustan las matemáticas");
  assert.equal(h.calls.gemini, 1);
  assert.equal(h.chat.educativeState.vocationalProfile.revision, 1);
});
await test("03 real no-signal message keeps one call", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Cuéntame más");
  assert.equal(h.calls.gemini, 1);
});
await test("04 neutral canonical mention confirms without presearch", async () => {
  const h = createHarness();
  const result = await sendMessage(h.chat.id, h.chat.userId, "matemáticas");
  assert.equal(result.assistantMessage.uiAction.type, "career_confirmation");
  assert.equal(h.calls.stateUpdates, 1);
  assert.equal(h.chat.educativeStateVersion, 1);
  assert.equal(h.calls.search, 0);
});
await test("05 message and profile use the same real transaction", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Me gustan las matemáticas");
  assert.deepEqual(h.events.slice(0, 4), ["tx:start", "message:user", "chat:update", "tx:commit"]);
});
await test("06 real version conflict rolls message back", async () => {
  const h = createHarness();
  h.forceConflict = true;
  await assert.rejects(sendMessage(h.chat.id, h.chat.userId, "Me gustan las matemáticas"),
    (error) => error.statusCode === 409 || error.status === 409);
  assert.equal(h.messages.length, 0);
  assert.equal(h.chat.educativeState.vocationalProfile.revision, 0);
});
await test("07 real conflict calls Gemini zero times", async () => {
  const h = createHarness();
  h.forceConflict = true;
  await assert.rejects(sendMessage(h.chat.id, h.chat.userId, "Me gustan las matemáticas"));
  assert.equal(h.calls.gemini, 0);
});
await test("08 real capacity rejection saves user message", async () => {
  const h = createHarness(fullProfile());
  await sendMessage(h.chat.id, h.chat.userId, "Me gusta la salud");
  assert.equal(h.messages.filter((message) => message.role === "user").length, 1);
});
await test("09 real capacity rejection preserves profile", async () => {
  const profile = fullProfile();
  const h = createHarness(profile);
  await sendMessage(h.chat.id, h.chat.userId, "Me gusta la salud");
  assert.ok(profilesEqual(h.chat.educativeState.vocationalProfile, profile));
  assert.equal(h.chat.educativeStateVersion, 0);
});
await test("10 real capacity path calls Gemini once", async () => {
  const h = createHarness(fullProfile());
  await sendMessage(h.chat.id, h.chat.userId, "Me gusta la salud");
  assert.equal(h.calls.gemini, 1);
});
await test("11 Gemini failure preserves committed message profile and version", async () => {
  const h = createHarness();
  h.geminiError = new Error("stubbed Gemini failure");
  await assert.rejects(sendMessage(h.chat.id, h.chat.userId, "Me gustan las matemáticas"));
  assert.equal(h.messages.filter((message) => message.role === "user").length, 1);
  assert.equal(h.chat.educativeState.vocationalProfile.revision, 1);
  assert.equal(h.chat.educativeStateVersion, 1);
});
await test("12 UI action reaches action branch before extractor", async () => {
  const h = createHarness();
  await assert.rejects(sendMessage(h.chat.id, h.chat.userId, "Me gustan las matemáticas", { type: "invalid" }));
  assert.equal(h.calls.extractor, 0);
});
await test("13 typed action reaches action branch before extractor", async () => {
  const h = createHarness();
  preparePendingConversation(h);
  await sendMessage(h.chat.id, h.chat.userId, "seguir conversando");
  assert.equal(h.calls.extractor, 0);
  assert.equal(h.calls.gemini, 1);
});
await test("14 assistant output never reaches extractor", async () => {
  const h = createHarness();
  h.assistantReply = "Me gustan las matemáticas";
  await sendMessage(h.chat.id, h.chat.userId, "Cuéntame algo");
  assert.equal(h.calls.extractor, 1);
  assert.equal(h.chat.educativeState.vocationalProfile.signals.length, 0);
});
await test("15 normal user content is detected exactly once", async () => {
  const h = createHarness();
  const content = "Quiero conversar sobre Psicología";
  await sendMessage(h.chat.id, h.chat.userId, content);
  assert.equal(h.detectorInputs.filter((value) => value === content).length, 1);
});
await test("16 real memory refresh keeps one logical call", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Me gustan las matemáticas");
  assert.equal(h.calls.memory, 1);
});
await test("17 direct educational confirmation remains deterministic", async () => {
  const h = createHarness();
  h.searchResult = { offerContext: [{ id: 1 }], remainingCount: 0, searchSignature: "stub" };
  const result = await sendMessage(h.chat.id, h.chat.userId, "Psicología");
  assert.equal(h.calls.gemini, 0);
  assert.equal(result.assistantMessage.uiAction.type, "career_confirmation");
});
await test("18 real integration never calls fetch", async () => {
  const h = createHarness();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("network forbidden"); };
  try { await sendMessage(h.chat.id, h.chat.userId, "Cuéntame más"); } finally { globalThis.fetch = originalFetch; }
  assert.equal(fetchCalls, 0);
});
await test("19 legacy state works through real chat service", async () => {
  const h = createHarness();
  h.chat.educativeState = { status: "idle" };
  await sendMessage(h.chat.id, h.chat.userId, "Me gustan las matemáticas");
  assert.equal(h.chat.educativeState.vocationalProfile.revision, 1);
});
await test("20 local chat version updates after real persistence", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Me gustan las matemáticas");
  assert.equal(h.chat.educativeStateVersion, 1);
});
await test("21 direct confirmation uses the newly persisted version", async () => {
  const h = createHarness();
  h.searchResult = { offerContext: [{ id: 1 }], remainingCount: 0, searchSignature: "stub" };
  const result = await sendMessage(h.chat.id, h.chat.userId,
    "Me gustan las matemáticas y quiero estudiar Psicología");
  assert.equal(result.assistantMessage.uiAction.type, "career_confirmation");
  assert.equal(h.chat.educativeState.vocationalProfile.revision, 1);
  assert.equal(h.chat.educativeStateVersion, 2);
});
await test("22 real profile path creates one user message", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Me gustan las matemáticas");
  assert.equal(h.messages.filter((message) => message.role === "user").length, 1);
});
await test("23 repeated statement does not persist profile again", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Me gustan las matemáticas");
  const updates = h.calls.stateUpdates;
  await sendMessage(h.chat.id, h.chat.userId, "Me gustan las matemáticas");
  assert.equal(h.calls.stateUpdates, updates);
});
await test("24 repeated statement does not increment version", async () => {
  const h = createHarness();
  await sendMessage(h.chat.id, h.chat.userId, "Me gustan las matemáticas");
  const version = h.chat.educativeStateVersion;
  await sendMessage(h.chat.id, h.chat.userId, "Me gustan las matemáticas");
  assert.equal(h.chat.educativeStateVersion, version);
});
await test("25 stubbed provider failover does not add a logical Gemini call", async () => {
  const h = createHarness();
  h.providerAttemptsPerCall = 2;
  await sendMessage(h.chat.id, h.chat.userId, "Me gustan las matemáticas");
  assert.equal(h.calls.gemini, 1);
  assert.equal(h.calls.providerAttempts, 2);
  assert.equal(h.chat.educativeState.vocationalProfile.revision, 1);
});

const passed = results.filter((item) => item.status === "PASS").length;
const failed = results.length - passed;
console.log(`TOTAL: ${results.length} | PASS: ${passed} | FAIL: ${failed}`);
if (failed) process.exitCode = 1;
