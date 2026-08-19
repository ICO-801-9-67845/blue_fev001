import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../src/config/prisma.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportDir = resolve(__dirname, "../../tmp/educative-program-relations");
const API = process.env.BLUE_TEST_API_URL || "http://localhost:4000/api";
const suffix = Date.now();
const createdChatIds = [];
const createdUserIds = [];
const results = [];
const observedStatuses = [];
const observedResponses = [];

function record(name, expected, actual, details = {}) {
  const passed = typeof expected === "function" ? expected(actual) : actual === expected;
  results.push({ name, status: passed ? "PASS" : "FAIL", expected: typeof expected === "function" ? "predicate" : expected, actual, details });
  return passed;
}

async function request(path, options = {}, token = "") {
  const response = await fetch(API + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  let body = null;
  try { body = await response.json(); } catch {}
  observedStatuses.push(response.status);
  observedResponses.push({ path, method: options.method || "GET", status: response.status, body });
  return { status: response.status, body };
}

async function register(label) {
  const result = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: label, email: `${label}-${suffix}@bluefev.test`, password: "Test12345" }),
  });
  if (result.status !== 201) throw new Error(`No se pudo registrar ${label}: ${JSON.stringify(result.body)}`);
  createdUserIds.push(result.body.data.user.id);
  return { token: result.body.data.token, userId: result.body.data.user.id };
}

async function createChat(token, title) {
  const result = await request("/chats", { method: "POST", body: JSON.stringify({ title }) }, token);
  if (result.status !== 201) throw new Error(`No se pudo crear chat: ${JSON.stringify(result.body)}`);
  createdChatIds.push(result.body.data.id);
  return result.body.data.id;
}

async function send(token, chatId, content, action = null) {
  return request(`/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, ...(action ? { action } : {}) }),
  }, token);
}

async function pending(token, chatId, program = "Psicología") {
  const response = await send(token, chatId, `Quiero estudiar ${program}`);
  const action = response.body?.data?.assistantMessage?.uiAction;
  if (response.status !== 201 || action?.type !== "career_confirmation") {
    throw new Error(`No se genero confirmacion para ${program}: ${JSON.stringify(response.body)}`);
  }
  return action;
}

function confirmPayload(action, overrides = {}) {
  const career = action.careers[0];
  return {
    type: "confirm_educative_search",
    actionId: action.id,
    career: career.normalizedName,
    canonicalProgramId: career.canonicalProgramId,
    academicLevel: career.academicLevel,
    familyId: career.familyId,
    level: career.level,
    ...overrides,
  };
}

async function freshConfirmation(token, label, program = "Psicología") {
  const chatId = await createChat(token, label);
  const action = await pending(token, chatId, program);
  return { chatId, action };
}

async function freshRelatedAction(token, label) {
  const { chatId, action } = await freshConfirmation(token, label, "Psicología Clínica");
  const exact = await send(token, chatId, "Mostrar opciones", confirmPayload(action));
  const exhausted = exact.body?.data?.assistantMessage?.uiAction;
  const explorePayload = {
    type: "explore_related_careers",
    actionId: exhausted.id,
    canonicalProgramId: exhausted.canonicalProgramId,
    academicLevel: exhausted.academicLevel,
    familyId: exhausted.familyId,
  };
  return { chatId, exhausted, explorePayload };
}

async function freshMoreRelatedAction(token, label) {
  const related = await freshRelatedAction(token, label);
  const familyPage = await send(token, related.chatId, "Explorar", related.explorePayload);
  const action = familyPage.body?.data?.assistantMessage?.uiAction;
  return {
    chatId: related.chatId,
    action,
    payload: {
      type: "more_related_programs",
      actionId: action.id,
      canonicalProgramId: action.canonicalProgramId,
      academicLevel: action.academicLevel,
      familyId: action.familyId,
      relatedStage: action.relatedStage,
    },
  };
}

const first = await register("security-owner");
const second = await register("security-foreign");

try {
  const foreignUserChat = await createChat(first.token, "Otro usuario");
  const foreignUserAction = await pending(first.token, foreignUserChat);
  const foreignUser = await send(second.token, foreignUserChat, "Mostrar opciones", confirmPayload(foreignUserAction));
  record("actionId de otro usuario", 404, foreignUser.status);

  const originChat = await createChat(first.token, "Origen");
  const originAction = await pending(first.token, originChat);
  const otherChat = await createChat(first.token, "Otro chat");
  const crossChat = await send(first.token, otherChat, "Mostrar opciones", confirmPayload(originAction));
  record("actionId de otro chat", 409, crossChat.status);

  const consumedChat = await createChat(first.token, "Consumida");
  const consumedAction = await pending(first.token, consumedChat);
  const consumedPayload = confirmPayload(consumedAction);
  const consumedOnce = await send(first.token, consumedChat, "Mostrar opciones", consumedPayload);
  const consumedTwice = await send(first.token, consumedChat, "Mostrar opciones otra vez", consumedPayload);
  record("actionId ya consumido", 409, consumedTwice.status, { firstStatus: consumedOnce.status });

  const expiredChat = await createChat(first.token, "Expirada");
  const expiredAction = await pending(first.token, expiredChat, "Psicología");
  await pending(first.token, expiredChat, "Derecho");
  const expiredUse = await send(first.token, expiredChat, "Usar anterior", confirmPayload(expiredAction));
  record("actionId expirado por reemplazo", 409, expiredUse.status);
  const expiredHistory = await request(`/chats/${expiredChat}/messages`, {}, first.token);
  const expiredCard = expiredHistory.body?.data?.find((message) => message.uiAction?.id === expiredAction.id)?.uiAction;
  record("historial conserva accion expired", "expired", expiredCard?.status);

  const doubleChat = await createChat(first.token, "Doble clic");
  const doubleAction = await pending(first.token, doubleChat);
  const doublePayload = confirmPayload(doubleAction);
  const doubleResponses = await Promise.all([
    send(first.token, doubleChat, "Mostrar opciones", doublePayload),
    send(first.token, doubleChat, "Mostrar opciones", doublePayload),
  ]);
  const doubleStatuses = doubleResponses.map((response) => response.status).sort();
  record("doble clic: solo una solicitud consume", (value) => value.filter((status) => status === 201).length === 1 && value.filter((status) => status === 409).length === 1, doubleStatuses);

  const concurrentChat = await createChat(first.token, "Solicitudes simultaneas");
  const concurrentAction = await pending(first.token, concurrentChat, "Derecho");
  const concurrentPayload = confirmPayload(concurrentAction);
  const concurrentResponses = await Promise.all([
    send(first.token, concurrentChat, "Primera", concurrentPayload),
    send(first.token, concurrentChat, "Segunda", concurrentPayload),
  ]);
  const concurrentStatuses = concurrentResponses.map((response) => response.status).sort();
  record("dos solicitudes simultaneas", (value) => value.filter((status) => status === 201).length === 1 && value.filter((status) => status === 409).length === 1, concurrentStatuses);

  const canonicalCase = await freshConfirmation(first.token, "Canonical manipulado");
  const canonicalTamper = await send(first.token, canonicalCase.chatId, "Manipulado", confirmPayload(canonicalCase.action, { canonicalProgramId: "licenciatura_derecho" }));
  record("canonicalProgramId manipulado", 409, canonicalTamper.status);
  const familyCase = await freshConfirmation(first.token, "Familia manipulada");
  const familyTamper = await send(first.token, familyCase.chatId, "Manipulado", confirmPayload(familyCase.action, { familyId: "familia_falsa" }));
  record("familyId manipulado", 409, familyTamper.status);
  const levelCase = await freshConfirmation(first.token, "Nivel manipulado");
  const levelTamper = await send(first.token, levelCase.chatId, "Manipulado", confirmPayload(levelCase.action, { level: "posgrado" }));
  record("level manipulado", 409, levelTamper.status);
  const academicCase = await freshConfirmation(first.token, "Nivel academico manipulado");
  const academicTamper = await send(first.token, academicCase.chatId, "Manipulado", confirmPayload(academicCase.action, { academicLevel: "doctorado" }));
  record("academicLevel manipulado", 409, academicTamper.status);
  const missingCase = await freshConfirmation(first.token, "Programa no ofrecido");
  const missingProgram = await send(first.token, missingCase.chatId, "Programa no ofrecido", confirmPayload(missingCase.action, { career: "DERECHO", canonicalProgramId: null, academicLevel: null, familyId: null, level: null }));
  record("programa no incluido en la accion", 400, missingProgram.status);

  const reloadChat = await createChat(first.token, "Recarga pending");
  const reloadAction = await pending(first.token, reloadChat);
  const reloadHistory = await request(`/chats/${reloadChat}/messages`, {}, first.token);
  const reloadCard = reloadHistory.body?.data?.find((message) => message.uiAction?.id === reloadAction.id)?.uiAction;
  record("recarga conserva accion pending", "pending", reloadCard?.status);

  const relatedFamilyCase = await freshRelatedAction(first.token, "Familia relacionada manipulada");
  const relatedFamilyTamper = await send(first.token, relatedFamilyCase.chatId, "Explorar", { ...relatedFamilyCase.explorePayload, familyId: "familia_falsa" });
  record("familyId relacionado manipulado", 409, relatedFamilyTamper.status);
  const stageCase = await freshMoreRelatedAction(first.token, "Etapa manipulada");
  const stageTamper = await send(first.token, stageCase.chatId, "Más", { ...stageCase.payload, relatedStage: "nearby" });
  record("relatedStage manipulado", 409, stageTamper.status);
  for (const [name, cursor] of [["cursor negativo", -1], ["cursor demasiado grande", 999999]]) {
    const cursorCase = await freshMoreRelatedAction(first.token, name);
    const response = await send(first.token, cursorCase.chatId, "Más", { ...cursorCase.payload, cursor });
    record(name, 409, response.status);
  }
  const reuseCase = await freshMoreRelatedAction(first.token, "Cursor reutilizado");
  const validMore = await send(first.token, reuseCase.chatId, "Más", reuseCase.payload);
  const reusedCursor = await send(first.token, reuseCase.chatId, "Más", reuseCase.payload);
  record("cursor/action reutilizado", 409, reusedCursor.status, { firstStatus: validMore.status });
  const pendingRaceChat = await createChat(first.token, "Dos pending");
  const pendingRaceResponses = await Promise.all([
    send(first.token, pendingRaceChat, "Quiero estudiar Psicología"),
    send(first.token, pendingRaceChat, "Quiero estudiar Derecho"),
  ]);
  record("creacion simultanea no produce HTTP 500", true, pendingRaceResponses.every((response) => response.status !== 500), {
    statuses: pendingRaceResponses.map((response) => response.status),
  });
  const pendingRaceHistory = await request(`/chats/${pendingRaceChat}/messages`, {}, first.token);
  const pendingCards = (pendingRaceHistory.body?.data || []).filter((message) => message.uiAction?.status === "pending");
  record("dos acciones pendientes simultaneas dejan solo una", 1, pendingCards.length);

  record("ninguna prueba produjo HTTP 500", true, !observedStatuses.includes(500), { responses: observedResponses.filter((response) => response.status === 500) });
} finally {
  for (const chatId of createdChatIds) {
    await request(`/chats/${chatId}`, { method: "DELETE" }, first.token).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
}

const summary = {
  total: results.length,
  PASS: results.filter((item) => item.status === "PASS").length,
  FAIL: results.filter((item) => item.status === "FAIL").length,
};
const report = { generatedAt: new Date().toISOString(), summary, results };
mkdirSync(reportDir, { recursive: true });
writeFileSync(resolve(reportDir, "security-matrix.json"), JSON.stringify(report, null, 2) + "\n");
const md = [
  "# Matriz de seguridad de acciones educativas",
  "",
  ...Object.entries(summary).map(([key, value]) => `- ${key}: ${value}`),
  "",
  "| Prueba | Estado | Esperado | Obtenido |",
  "|---|---|---|---|",
  ...results.map((item) => `| ${item.name} | ${item.status} | ${item.expected} | ${JSON.stringify(item.actual)} |`),
];
writeFileSync(resolve(reportDir, "security-matrix.md"), md.join("\n") + "\n");
console.log(JSON.stringify(summary, null, 2));
if (summary.FAIL) process.exitCode = 1;
