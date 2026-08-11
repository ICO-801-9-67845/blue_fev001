import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:4017/api";
const nonce = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const email = `ollama-e2e-${nonce}@bluefev.test`;
const password = `E2e-${randomBytes(12).toString("base64url")}!`;

const created = {
  userId: null,
  chatIds: [],
  messageIds: [],
  memoryIds: [],
  analyticsSessionIds: [],
};
const results = [];
let token = "";
let cleanupFailure = null;
let residualCounts = null;

function record(name, passed, details = {}) {
  results.push({ name, passed, details });
  if (!passed) throw new Error(`E2E assertion failed: ${name}`);
}

async function request(path, { method = "GET", body, auth = token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const responseBody = await response.json().catch(() => null);
  return { status: response.status, body: responseBody };
}

function addExactIds(target, values) {
  for (const value of values) {
    if (typeof value === "string" && value && !target.includes(value)) target.push(value);
  }
}

async function recoverExactIds() {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (user) created.userId = user.id;
  if (!created.userId) return;

  const chats = await prisma.chat.findMany({
    where: { userId: created.userId },
    select: { id: true },
  });
  addExactIds(created.chatIds, chats.map(({ id }) => id));

  if (created.chatIds.length) {
    const messages = await prisma.message.findMany({
      where: { chatId: { in: created.chatIds } },
      select: { id: true },
    });
    addExactIds(created.messageIds, messages.map(({ id }) => id));
  }

  const memory = await prisma.userMemory.findUnique({
    where: { userId: created.userId },
    select: { id: true },
  });
  addExactIds(created.memoryIds, memory ? [memory.id] : []);

  const sessions = await prisma.analyticsSession.findMany({
    where: { userId: created.userId },
    select: { id: true },
  });
  addExactIds(created.analyticsSessionIds, sessions.map(({ id }) => id));
}

async function exactCleanup() {
  await recoverExactIds();

  if (created.messageIds.length) {
    await prisma.message.deleteMany({ where: { id: { in: created.messageIds } } });
  }
  for (const memoryId of created.memoryIds) {
    await prisma.userMemory.delete({ where: { id: memoryId } });
  }
  if (created.analyticsSessionIds.length) {
    await prisma.analyticsSession.deleteMany({
      where: { id: { in: created.analyticsSessionIds } },
    });
  }
  if (created.chatIds.length) {
    await prisma.chat.deleteMany({ where: { id: { in: created.chatIds } } });
  }
  if (created.userId) {
    await prisma.user.deleteMany({
      where: { id: created.userId, email },
    });
  }
}

async function countResiduals() {
  const userFilters = [
    { email },
    ...(created.userId ? [{ id: created.userId }] : []),
  ];
  return {
    users: await prisma.user.count({ where: { OR: userFilters } }),
    chats: created.chatIds.length
      ? await prisma.chat.count({ where: { id: { in: created.chatIds } } })
      : 0,
    messages: created.messageIds.length
      ? await prisma.message.count({ where: { id: { in: created.messageIds } } })
      : 0,
    memories: created.memoryIds.length
      ? await prisma.userMemory.count({ where: { id: { in: created.memoryIds } } })
      : 0,
    analyticsSessions: created.analyticsSessionIds.length
      ? await prisma.analyticsSession.count({
          where: { id: { in: created.analyticsSessionIds } },
        })
      : 0,
  };
}

try {
  record("environment is test", process.env.NODE_ENV === "test");
  record("provider is Ollama without fallback", (
    process.env.AI_PROVIDER === "ollama" &&
    process.env.AI_FALLBACK_PROVIDER === "none"
  ));

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  record("unique email does not exist", existing === null);

  const health = await request("/health", { auth: "" });
  record("health check HTTP", health.status === 200 && health.body?.success === true, {
    status: health.status,
  });

  const registration = await request("/auth/register", {
    method: "POST",
    auth: "",
    body: { name: "Ollama E2E", email, password },
  });
  created.userId = registration.body?.data?.user?.id || null;
  token = registration.body?.data?.token || "";
  record("temporary registration", (
    registration.status === 201 && Boolean(created.userId) && Boolean(token)
  ), { status: registration.status });

  const login = await request("/auth/login", {
    method: "POST",
    auth: "",
    body: { email, password },
  });
  token = login.body?.data?.token || token;
  record("login", login.status === 200 && Boolean(login.body?.data?.token), {
    status: login.status,
  });

  const me = await request("/auth/me");
  record("authenticated identity", (
    me.status === 200 && me.body?.data?.id === created.userId
  ), { status: me.status });

  const chat = await request("/chats", {
    method: "POST",
    body: { title: "Ollama HTTP E2E" },
  });
  const chatId = chat.body?.data?.id;
  addExactIds(created.chatIds, [chatId]);
  record("chat creation", chat.status === 201 && Boolean(chatId), {
    status: chat.status,
  });

  const normalMessage = await request(`/chats/${chatId}/messages`, {
    method: "POST",
    body: { content: "Me gusta resolver problemas de lógica. Hazme una pregunta breve." },
  });
  const userMessage = normalMessage.body?.data?.userMessage;
  const assistantMessage = normalMessage.body?.data?.assistantMessage;
  addExactIds(created.messageIds, [userMessage?.id, assistantMessage?.id]);
  record("normal message and real assistant response", (
    normalMessage.status === 201 &&
    userMessage?.role === "user" &&
    assistantMessage?.role === "assistant" &&
    typeof assistantMessage?.content === "string" &&
    assistantMessage.content.trim().length > 0 &&
    !assistantMessage.content.includes("<think>")
  ), { status: normalMessage.status });

  record("frontend response contract", (
    normalMessage.body?.success === true &&
    typeof userMessage?.content === "string" &&
    typeof assistantMessage?.content === "string" &&
    Object.hasOwn(assistantMessage, "uiAction")
  ));

  const history = await request(`/chats/${chatId}/messages`);
  const historyIds = Array.isArray(history.body?.data)
    ? history.body.data.map(({ id }) => id)
    : [];
  addExactIds(created.messageIds, historyIds);
  record("history", (
    history.status === 200 &&
    created.messageIds.every((id) => historyIds.includes(id))
  ), { status: history.status });

  const memory = await prisma.userMemory.findUnique({
    where: { userId: created.userId },
    select: { id: true, summary: true },
  });
  addExactIds(created.memoryIds, memory ? [memory.id] : []);
  record("memory generated", Boolean(memory?.summary?.trim()));

  const controlledError = await request("/route-that-does-not-exist", { auth: "" });
  record("controlled HTTP error", (
    controlledError.status === 404 && controlledError.body?.success === false
  ), { status: controlledError.status });
} catch (error) {
  results.push({ name: "suite execution", passed: false, details: { message: error.message } });
} finally {
  try {
    await exactCleanup();
  } catch (error) {
    cleanupFailure = error;
  }

  try {
    residualCounts = await countResiduals();
  } catch (error) {
    cleanupFailure ||= error;
  }

  await prisma.$disconnect();
}

const passed = results.filter(({ passed }) => passed).length;
const failed = results.filter(({ passed }) => !passed).length;
const zeroResiduals = residualCounts && Object.values(residualCounts).every((count) => count === 0);

console.log(`E2E_TEMPORARY_EMAIL=${email}`);
console.log(`E2E_USERS_CREATED=${created.userId ? 1 : 0}`);
console.log(`E2E_CHATS_CREATED=${created.chatIds.length}`);
console.log(`E2E_MESSAGES_CREATED=${created.messageIds.length}`);
console.log(`E2E_TESTS_PASSED=${passed}`);
console.log(`E2E_TESTS_FAILED=${failed}`);
console.log(`E2E_CLEANUP=${!cleanupFailure && zeroResiduals ? "complete" : "failed"}`);
console.log(`E2E_RESIDUAL_USERS=${residualCounts?.users ?? "unknown"}`);
console.log(`E2E_RESIDUAL_CHATS=${residualCounts?.chats ?? "unknown"}`);
console.log(`E2E_RESIDUAL_MESSAGES=${residualCounts?.messages ?? "unknown"}`);
console.log(`E2E_RESIDUAL_MEMORIES=${residualCounts?.memories ?? "unknown"}`);
console.log(`E2E_RESIDUAL_ANALYTICS=${residualCounts?.analyticsSessions ?? "unknown"}`);

if (cleanupFailure || !zeroResiduals) {
  console.error("E2E_CLEANUP_FAILED");
  console.error(`PENDING_USER_ID=${residualCounts?.users ? created.userId : "none"}`);
  console.error(`PENDING_CHAT_IDS=${residualCounts?.chats ? created.chatIds.join(",") : "none"}`);
  console.error(`PENDING_MESSAGE_IDS=${residualCounts?.messages ? created.messageIds.join(",") : "none"}`);
  process.exitCode = 2;
} else if (failed) {
  process.exitCode = 1;
}
