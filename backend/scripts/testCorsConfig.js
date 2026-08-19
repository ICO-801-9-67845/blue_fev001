import assert from "node:assert/strict";
process.env.DATABASE_URL ||= "mysql://test:test@127.0.0.1:3306/blue_fev_cors_test";
process.env.JWT_SECRET ||= "cors-test-only-secret";
process.env.AI_PROVIDER = "ollama";
process.env.AI_FALLBACK_PROVIDER = "none";
process.env.OLLAMA_BASE_URL ||= "https://ollama.example.test";
process.env.OLLAMA_HOST_HEADER ||= "localhost:11434";
process.env.FRONTEND_URL = "https://blue.example.test";
process.env.FRONTEND_ADDITIONAL_ORIGINS = "http://127.0.0.1:5173";
const { default: app } = await import("../src/app.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const baseUrl = "http://127.0.0.1:" + server.address().port;
const results = [];
async function test(name, callback) {
  try { await callback(); results.push({ name, status: "PASS" }); console.log("PASS " + name); }
  catch (error) { results.push({ name, status: "FAIL", error: error.message }); console.error("FAIL " + name + ": " + error.message); }
}
function request(origin, method = "GET") {
  return fetch(baseUrl + "/api/health", { method, headers: { Origin: origin,
    ...(method === "OPTIONS" ? { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization" } : {}) } });
}
try {
  await test("01 local explicit origin is authorized", async () => {
    const r = await request("http://127.0.0.1:5173"); assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
  });
  await test("02 production explicit origin remains authorized", async () => {
    const r = await request("https://blue.example.test"); assert.equal(r.headers.get("access-control-allow-origin"), "https://blue.example.test");
  });
  await test("03 unknown origin is rejected by CORS", async () => {
    const r = await request("https://unknown.example.test"); assert.equal(r.headers.has("access-control-allow-origin"), false);
  });
  await test("04 authorized preflight is correct", async () => {
    const r = await request("http://127.0.0.1:5173", "OPTIONS"); assert.equal(r.status, 204);
    assert.equal(r.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
    assert.match(r.headers.get("access-control-allow-methods") || "", /POST/);
  });
  await test("05 credentials are explicit", async () => {
    const r = await request("http://127.0.0.1:5173"); assert.equal(r.headers.get("access-control-allow-credentials"), "true");
  });
  await test("06 wildcard is absent", async () => {
    const r = await request("http://127.0.0.1:5173"); assert.notEqual(r.headers.get("access-control-allow-origin"), "*");
  });
  await test("07 backend exposes no Ollama route", async () => {
    const r = await fetch(baseUrl + "/api/ollama", { headers: { Origin: "http://127.0.0.1:5173" } }); assert.equal(r.status, 404);
  });
} finally { await new Promise((resolve) => server.close(resolve)); }
const passed = results.filter((item) => item.status === "PASS").length;
const failed = results.length - passed;
console.log("TOTAL: " + results.length + " | PASS: " + passed + " | FAIL: " + failed);
if (failed) process.exitCode = 1;
