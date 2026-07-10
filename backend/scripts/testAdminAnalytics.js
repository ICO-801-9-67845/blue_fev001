import assert from "node:assert/strict";

const nonce = Date.now();
const adminEmail = `analytics-admin-${nonce}@bluefev.test`;
const normalEmail = `analytics-user-${nonce}@bluefev.test`;
const registeredEmail = `analytics-register-${nonce}@bluefev.test`;
process.env.ADMIN_EMAILS = adminEmail;

const [{ default: prisma }, { default: app }, { signAccessToken }, analyticsService] = await Promise.all([
  import("../src/config/prisma.js"),
  import("../src/app.js"),
  import("../src/services/tokenService.js"),
  import("../src/services/analyticsService.js"),
]);

const results = [];
let server;
let admin;
let normal;
let registeredUserId;

function record(name, passed, detail = "") {
  results.push({ name, passed, detail });
  if (!passed) throw new Error(`${name}: ${detail}`);
}

async function request(baseUrl, path, token, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json();
  return { response, body };
}

try {
  [admin, normal] = await Promise.all([
    prisma.user.create({ data: { name: "Analytics Admin Test", email: adminEmail, passwordHash: "test-only" } }),
    prisma.user.create({ data: { name: "Analytics User Test", email: normalEmail, passwordHash: "test-only" } }),
  ]);

  const adminToken = signAccessToken(admin);
  const normalToken = signAccessToken(normal);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  const registration = await request(baseUrl, "/auth/register", "", {
    method: "POST",
    body: JSON.stringify({ name: "Analytics Register Test", email: registeredEmail, password: "Test12345" }),
  });
  registeredUserId = registration.body.data?.user?.id;
  record("Registro de usuario continua funcionando", registration.response.status === 201 && Boolean(registeredUserId));

  const login = await request(baseUrl, "/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ email: registeredEmail, password: "Test12345" }),
  });
  record("Inicio de sesion continua funcionando", login.response.status === 200 && Boolean(login.body.data?.token));

  const forbidden = await request(baseUrl, "/admin/analytics/summary", normalToken);
  record("Usuario normal recibe 403", forbidden.response.status === 403, JSON.stringify(forbidden.body));

  const allowed = await request(baseUrl, "/admin/analytics/summary", adminToken);
  record("Administrador accede al resumen", allowed.response.status === 200, JSON.stringify(allowed.body));
  record("Resumen no expone datos sensibles", !JSON.stringify(allowed.body).match(/passwordHash|token|content/i));

  const started = await request(baseUrl, "/analytics/session/start", adminToken, {
    method: "POST",
    body: JSON.stringify({}),
  });
  record("Crear sesion devuelve sessionId", started.response.status === 201 && Boolean(started.body.data?.sessionId));
  const sessionId = started.body.data.sessionId;
  const beforeHeartbeat = new Date(started.body.data.lastSeenAt);

  const foreignHeartbeat = await request(baseUrl, "/analytics/session/heartbeat", normalToken, {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
  record("Usuario no actualiza sesion ajena", foreignHeartbeat.response.status === 404);

  await new Promise((resolve) => setTimeout(resolve, 25));
  const heartbeat = await request(baseUrl, "/analytics/session/heartbeat", adminToken, {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
  record("Heartbeat actualiza lastSeenAt", heartbeat.response.status === 200 && new Date(heartbeat.body.data.lastSeenAt) > beforeHeartbeat);

  await prisma.analyticsSession.createMany({
    data: [
      { userId: admin.id, startedAt: new Date(Date.now() - 30_000), lastSeenAt: new Date(), durationSeconds: 30 },
      { userId: admin.id, startedAt: new Date(Date.now() - 20_000), lastSeenAt: new Date(), durationSeconds: 20 },
      { userId: normal.id, startedAt: new Date(Date.now() - 180_000), lastSeenAt: new Date(Date.now() - 91_000), durationSeconds: 89 },
    ],
  });

  const active = await request(baseUrl, "/admin/analytics/active-users", adminToken);
  const matchingAdminRows = active.body.data.filter((item) => item.userId === admin.id);
  record("Usuarios activos se deduplican", matchingAdminRows.length === 1, `rows=${matchingAdminRows.length}`);
  record("Sesion sin heartbeat por 90 segundos no aparece", !active.body.data.some((item) => item.userId === normal.id));

  const ended = await request(baseUrl, "/analytics/session/end", adminToken, {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
  record("Cerrar sesion registra endedAt", ended.response.status === 200 && Boolean(ended.body.data.endedAt));

  const stats = analyticsService.calculateDurationStats([
    { startedAt: new Date(0), lastSeenAt: new Date(10_000) },
    { startedAt: new Date(0), lastSeenAt: new Date(20_000) },
    { startedAt: new Date(0), lastSeenAt: new Date(30_000) },
    { startedAt: new Date(0), lastSeenAt: new Date(100_000) },
    { startedAt: new Date(10_000), lastSeenAt: new Date(0) },
  ]);
  record("Promedio ignora duraciones negativas", stats.average === 40, JSON.stringify(stats));
  record("Mediana se calcula correctamente", stats.median === 25, JSON.stringify(stats));

  const today = new Date().toISOString().slice(0, 10);
  const filtered = await request(baseUrl, `/admin/analytics/recent-sessions?userId=${admin.id}&dateFrom=${today}&dateTo=${today}`, adminToken);
  record("Filtros por usuario y fecha funcionan", filtered.response.status === 200 && filtered.body.data.data.every((item) => item.userId === admin.id));

  const invalidRange = await request(baseUrl, "/admin/analytics/trends?range=2d", adminToken);
  record("Rango de tendencias invalido recibe 400", invalidRange.response.status === 400);

  console.log(JSON.stringify({ success: true, passed: results.length, failed: 0, results }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ success: false, passed: results.filter((item) => item.passed).length, failed: 1, results, error: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  const ids = [admin?.id, normal?.id, registeredUserId].filter(Boolean);
  if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}
