import assert from "node:assert/strict";

const app = (await import("../src/app.js")).default;
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
const results = [];

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { headers: { "content-type": "application/json", ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) }, method: options.method || "GET", body: options.body ? JSON.stringify(options.body) : undefined });
  const payload = await response.json();
  results.push({ path, status: response.status });
  return { response, payload };
}
async function register(email) { const { response, payload } = await request("/auth/register", { method: "POST", body: { name: "Prueba Modo", email, password: "modo2032-test" } }); assert.equal(response.status, 201); return payload.data.token; }
async function create(token, program, institution) { const { response, payload } = await request("/future-simulator/simulations", { token, method: "POST", body: { startingLevel: "preparatoria", programId: program.programId, offerId: institution.offerId, campusId: institution.campuses[0].campusId, setup: { workMode: "no", livingSituation: "familia", priority: "tiempo" }, metrics: { energy: 100 }, scenarioVersion: 999, track: "manipulated" } }); assert.equal(response.status, 201); assert.equal(payload.data.scenarioVersion, 1); assert.notEqual(payload.data.track, "manipulated"); return payload.data; }
try {
  assert.equal((await request("/health")).response.status, 200);
  const suffix = `${Date.now()}${process.pid}`;
  const tokenA = await register(`modo2032-a-${suffix}@example.test`);
  const tokenB = await register(`modo2032-b-${suffix}@example.test`);
  const catalog = await request("/future-simulator/programs?startingLevel=preparatoria&page=1&pageSize=20", { token: tokenA });
  assert.equal(catalog.response.status, 200, catalog.payload.message); assert.ok(catalog.payload.data.items.length > 0); assert.ok(catalog.payload.data.items.every((item) => item.level === "tsu" || item.level === "licenciatura" || item.level === "ingenieria"));
  const secondary = await request("/future-simulator/programs?startingLevel=secundaria&page=1&pageSize=1", { token: tokenA });
  assert.equal(secondary.response.status, 200); assert.ok(secondary.payload.data.items.length > 0); assert.ok(secondary.payload.data.items.every((item) => item.level === "bachillerato" || item.level === "tecnico_bachillerato")); assert.ok(secondary.payload.data.pagination.totalPages >= 1);
  const program = catalog.payload.data.items[0];
  const search = await request(`/future-simulator/programs?startingLevel=preparatoria&query=${encodeURIComponent(program.canonicalName)}&page=1&pageSize=1`, { token: tokenA }); assert.equal(search.response.status, 200); assert.ok(search.payload.data.items.length > 0);
  const institutionsResponse = await request(`/future-simulator/programs/${encodeURIComponent(program.programId)}/institutions?startingLevel=preparatoria`, { token: tokenA }); assert.equal(institutionsResponse.response.status, 200); assert.ok(institutionsResponse.payload.data.length > 0);
  const municipality = institutionsResponse.payload.data[0].campuses[0].municipality; if (municipality) { const localCatalog = await request(`/future-simulator/programs?startingLevel=preparatoria&municipality=${encodeURIComponent(municipality)}&page=1&pageSize=5`, { token: tokenA }); assert.equal(localCatalog.response.status, 200); assert.ok(localCatalog.payload.data.items.length > 0); }
  const institution = institutionsResponse.payload.data[0];
  const simulation = await create(tokenA, program, institution);
  assert.equal(simulation.programName, program.canonicalName); assert.equal(simulation.institutionName, institution.name); assert.equal(simulation.campusName, institution.campuses[0].name);
  const otherUserGet = await request(`/future-simulator/simulations/${simulation.id}`, { token: tokenB }); assert.equal(otherUserGet.response.status, 404);
  const otherUserDecision = await request(`/future-simulator/simulations/${simulation.id}/decisions`, { token: tokenB, method: "POST", body: { eventId: simulation.currentEvent.id, optionId: simulation.currentEvent.options[0].id } }); assert.equal(otherUserDecision.response.status, 404);
  const invalidEvent = await request(`/future-simulator/simulations/${simulation.id}/decisions`, { token: tokenA, method: "POST", body: { eventId: "invalid", optionId: "invalid" } }); assert.equal(invalidEvent.response.status, 409);
  let state = simulation;
  while (state.status === "active") { const { response, payload } = await request(`/future-simulator/simulations/${state.id}/decisions`, { token: tokenA, method: "POST", body: { eventId: state.currentEvent.id, optionId: state.currentEvent.options[0].id, effects: { stress: -999 } } }); assert.equal(response.status, 200); state = payload.data; }
  assert.equal(state.status, "completed"); assert.ok(Object.values(state.metrics).every((value) => value >= 0 && value <= 100)); assert.ok(state.result?.disclaimer);
  const concurrent = await create(tokenA, program, institutionsResponse.payload.data[0]); const body = { eventId: concurrent.currentEvent.id, optionId: concurrent.currentEvent.options[0].id };
  const pair = await Promise.all([request(`/future-simulator/simulations/${concurrent.id}/decisions`, { token: tokenA, method: "POST", body }), request(`/future-simulator/simulations/${concurrent.id}/decisions`, { token: tokenA, method: "POST", body })]);
  assert.deepEqual(pair.map((item) => item.response.status).sort(), [200, 409]);
  const after = await request(`/future-simulator/simulations/${concurrent.id}`, { token: tokenA }); assert.equal(after.response.status, 200); assert.equal(after.payload.data.choices.length, 1); assert.equal(after.payload.data.revision, 1);
  const listed = await request("/future-simulator/simulations", { token: tokenA }); assert.equal(listed.response.status, 200); assert.ok(listed.payload.data.length >= 2); assert.ok(listed.payload.data.every((item) => item.programName === program.canonicalName && item.institutionName === institution.name && item.campusName === institution.campuses[0].name));
  console.log(JSON.stringify({ status: "passed", requests: results, aiCalls: { gemini: 0, ollama: 0, aiProvider: 0 } }));
} finally { await new Promise((resolve) => server.close(resolve)); }
