import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ||= "mysql://test:test@127.0.0.1:3306/test";
process.env.JWT_SECRET ||= "memory-throttling-test";
process.env.GEMINI_API_KEYS ||= "not-a-real-key";

const {
  MEMORY_REFRESH_FLOWS,
  createMemoryRefreshService,
  isEligibleMemoryRefreshFlow,
} = await import("../src/services/memoryRefreshService.js");
const { positiveInteger } = await import("../src/config/env.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportPath = resolve(
  __dirname,
  "../../tmp/ai-memory-throttling/test-results.json",
);
const results = [];
const simulation = {
  conversationCalls: 0,
  memoryCalls: 0,
  memoryCallsAvoided: 0,
  memoryRequestReductionPercent: 0,
};

function createBarrier(parties) {
  let arrived = 0;
  let release;
  const ready = new Promise((resolveReady) => {
    release = resolveReady;
  });

  return async () => {
    arrived += 1;
    if (arrived === parties) {
      release();
    }
    await ready;
  };
}

function summarySuccess(chatSummary, userMemorySummary) {
  return {
    ok: true,
    summaries: { chatSummary, userMemorySummary },
    reason: "valid_summary",
    metadata: { finishReason: "STOP", responseCharacterCount: 10 },
  };
}

function createHarness({
  cadence = 4,
  eligible = 0,
  summarized = 0,
  waitAfterIncrement = async () => {},
  generate = async () =>
    summarySuccess("Resumen del chat", "Memoria del usuario"),
  saveChat = async () => {},
  saveUserMemory = async () => {},
} = {}) {
  const state = { eligible, summarized };
  const calls = {
    increments: 0,
    claims: 0,
    rollbacks: 0,
    memory: 0,
    chatSaves: 0,
    userMemorySaves: 0,
  };
  const logs = [];
  let generateImplementation = generate;

  const service = createMemoryRefreshService({
    cadence,
    async incrementEligibleTurn() {
      calls.increments += 1;
      state.eligible += 1;
      const snapshot = {
        memoryEligibleTurnCount: state.eligible,
        memorySummarizedTurnCount: state.summarized,
      };
      await waitAfterIncrement();
      return snapshot;
    },
    async claimRefresh(_chatId, previousCount, claimedCount) {
      calls.claims += 1;
      if (state.summarized !== previousCount) {
        return false;
      }
      state.summarized = claimedCount;
      return true;
    },
    async rollbackRefresh(_chatId, claimedCount, previousCount) {
      calls.rollbacks += 1;
      if (state.summarized !== claimedCount) {
        return false;
      }
      state.summarized = previousCount;
      return true;
    },
    async generateSummaries(params) {
      calls.memory += 1;
      return generateImplementation(params);
    },
    async saveChatSummary(...args) {
      calls.chatSaves += 1;
      return saveChat(...args);
    },
    async saveUserMemorySummary(...args) {
      calls.userMemorySaves += 1;
      return saveUserMemory(...args);
    },
    writeLog(entry) {
      logs.push(entry);
    },
  });

  return {
    state,
    calls,
    logs,
    setGenerate(nextGenerate) {
      generateImplementation = nextGenerate;
    },
    run(flow = MEMORY_REFRESH_FLOWS.CONVERSATION) {
      return service({
        flow,
        chatId: "chat-secret",
        userId: "user-secret",
        messages: [{ role: "user", content: "private-message" }],
        currentChatSummary: "private-chat-summary",
        userMemorySummary: "private-user-summary",
      });
    },
  };
}

async function test(name, run) {
  try {
    await run();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({ name, status: "FAIL", error: error.message });
  }
}

await test("Validacion de cadencia: fallback y enteros positivos", () => {
  const key = "MEMORY_THROTTLING_TEST_VALUE";
  const cases = [
    [undefined, 4],
    ["1", 1],
    ["2", 2],
    ["7", 7],
    ["0", 4],
    ["-1", 4],
    ["1.5", 4],
    ["NaN", 4],
    ["Infinity", 4],
  ];

  for (const [value, expected] of cases) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
    assert.equal(positiveInteger(key, 4), expected, String(value));
  }
  delete process.env[key];
});

await test("Cadencia 1 ejecuta memoria en cada turno elegible", async () => {
  const harness = createHarness({ cadence: 1 });
  for (let turn = 1; turn <= 3; turn += 1) {
    await harness.run();
  }
  assert.equal(harness.calls.memory, 3);
  assert.equal(harness.state.summarized, 3);
});

await test("Cadencia 2 y personalizada respetan su intervalo", async () => {
  const cadenceTwo = createHarness({ cadence: 2 });
  for (let turn = 1; turn <= 5; turn += 1) {
    await cadenceTwo.run();
  }
  assert.equal(cadenceTwo.calls.memory, 2);
  assert.equal(cadenceTwo.state.summarized, 4);

  const customCadence = createHarness({ cadence: 3 });
  for (let turn = 1; turn <= 7; turn += 1) {
    await customCadence.run();
  }
  assert.equal(customCadence.calls.memory, 2);
  assert.equal(customCadence.state.summarized, 6);
});

await test("Simulacion de 12 respuestas con cadencia 4", async () => {
  const harness = createHarness();
  const runTurns = [];
  const skippedTurns = [];

  for (let turn = 1; turn <= 12; turn += 1) {
    const result = await harness.run();
    (result.action === "run" ? runTurns : skippedTurns).push(turn);
    assert.ok(harness.state.summarized <= harness.state.eligible);
  }

  assert.deepEqual(runTurns, [4, 8, 12]);
  assert.deepEqual(skippedTurns, [1, 2, 3, 5, 6, 7, 9, 10, 11]);
  assert.equal(harness.calls.memory, 3);
  simulation.conversationCalls = 12;
  simulation.memoryCalls = harness.calls.memory;
  simulation.memoryCallsAvoided = 12 - harness.calls.memory;
  simulation.memoryRequestReductionPercent =
    (simulation.memoryCallsAvoided / 12) * 100;
});

await test("Concurrencia de 20 solicitudes concede una sola reclamacion", async () => {
  const requestCount = 20;
  const barrier = createBarrier(requestCount);
  const harness = createHarness({
    eligible: 3,
    summarized: 0,
    waitAfterIncrement: barrier,
  });

  const outcomes = await Promise.all(
    Array.from({ length: requestCount }, () => harness.run()),
  );
  assert.equal(harness.calls.increments, requestCount);
  assert.equal(harness.state.eligible, 23);
  assert.equal(harness.calls.memory, 1);
  assert.equal(outcomes.filter((item) => item.action === "run").length, 1);
  assert.equal(
    outcomes.filter((item) => item.action === "lost_claim").length,
    requestCount - 1,
  );
  assert.equal(
    harness.logs.filter((entry) => entry.action === "lost_claim").length,
    requestCount - 1,
  );
  assert.equal(harness.state.summarized, 4);
  assert.ok(harness.state.eligible >= 0);
  assert.ok(harness.state.summarized >= 0);
  assert.ok(harness.state.summarized <= harness.state.eligible);

  const nextOutcome = await harness.run();
  assert.equal(nextOutcome.action, "run");
  assert.equal(harness.calls.memory, 2);
  assert.equal(harness.state.eligible, 24);
  assert.equal(harness.state.summarized, 24);
});

await test("Null consume el intervalo y reintenta en la siguiente cadencia", async () => {
  let attempt = 0;
  const harness = createHarness({
    eligible: 3,
    generate: async () => {
      attempt += 1;
      return attempt === 1
        ? null
        : summarySuccess("Resumen recuperado", "Memoria recuperada");
    },
  });

  const failedAttempt = await harness.run();
  assert.equal(failedAttempt.action, "defer");
  assert.equal(failedAttempt.reason, "invalid_schema");
  assert.equal(harness.state.eligible, 4);
  assert.equal(harness.state.summarized, 4);
  assert.equal(harness.calls.rollbacks, 0);

  assert.equal((await harness.run()).action, "skip");
  assert.equal((await harness.run()).action, "skip");
  assert.equal((await harness.run()).action, "skip");
  const successfulAttempt = await harness.run();
  assert.equal(successfulAttempt.action, "run");
  assert.equal(harness.calls.memory, 2);
  assert.equal(harness.calls.chatSaves, 1);
  assert.equal(harness.calls.userMemorySaves, 1);
  assert.equal(harness.state.eligible, 8);
  assert.equal(harness.state.summarized, 8);
});

await test("Error de memoria difiere sin fallar la respuesta principal", async () => {
  const harness = createHarness({
    eligible: 3,
    generate: async () => {
      throw new Error("simulated");
    },
  });
  const outcome = await harness.run();
  assert.equal(outcome.action, "defer");
  assert.equal(outcome.reason, "generation_error");
  assert.equal(harness.state.summarized, 4);
  assert.equal((await harness.run()).action, "skip");
  assert.equal(harness.calls.memory, 1);
});

await test("Fallo clasificado no sobrescribe una reclamacion mas nueva", async () => {
  const harness = createHarness({ eligible: 3 });
  harness.setGenerate(async () => {
    harness.state.eligible = 8;
    harness.state.summarized = 8;
    throw new Error("simulated");
  });
  await harness.run();
  assert.equal(harness.state.summarized, 8);
  assert.equal(harness.calls.rollbacks, 0);
});

await test("Persistencia completa, parcial y vacia conserva watermark", async () => {
  const both = createHarness({ eligible: 3 });
  assert.equal((await both.run()).action, "run");
  assert.equal(both.calls.chatSaves, 1);
  assert.equal(both.calls.userMemorySaves, 1);
  assert.equal(both.state.summarized, 4);

  const chatOnly = createHarness({
    eligible: 3,
    generate: async () => summarySuccess("Solo chat", "   "),
  });
  assert.equal((await chatOnly.run()).action, "run");
  assert.equal(chatOnly.calls.chatSaves, 1);
  assert.equal(chatOnly.calls.userMemorySaves, 0);

  const userOnly = createHarness({
    eligible: 3,
    generate: async () => summarySuccess("", "Solo usuario"),
  });
  assert.equal((await userOnly.run()).action, "run");
  assert.equal(userOnly.calls.chatSaves, 0);
  assert.equal(userOnly.calls.userMemorySaves, 1);

  const empty = createHarness({
    eligible: 3,
    generate: async () => summarySuccess(" ", ""),
  });
  assert.equal((await empty.run()).action, "defer");
  assert.equal(empty.calls.chatSaves, 0);
  assert.equal(empty.calls.userMemorySaves, 0);
  assert.equal(empty.state.summarized, 4);

  const chatFailure = createHarness({
    eligible: 3,
    saveChat: async () => {
      throw new Error("simulated chat persistence failure");
    },
  });
  const persistenceFailure = await chatFailure.run();
  assert.equal(persistenceFailure.action, "defer");
  assert.equal(persistenceFailure.reason, "persistence_failed");
  assert.equal(chatFailure.calls.chatSaves, 1);
  assert.equal(chatFailure.calls.userMemorySaves, 0);
  assert.equal(chatFailure.state.summarized, 4);
  assert.equal((await chatFailure.run()).action, "skip");
  assert.equal(chatFailure.calls.memory, 1);
});

await test("Solo los dos flujos conversacionales son elegibles", async () => {
  assert.equal(
    isEligibleMemoryRefreshFlow(MEMORY_REFRESH_FLOWS.CONVERSATION),
    true,
  );
  assert.equal(
    isEligibleMemoryRefreshFlow(MEMORY_REFRESH_FLOWS.CONTINUE_AFTER_ACTION),
    true,
  );

  for (const flow of Object.values(MEMORY_REFRESH_FLOWS)) {
    const harness = createHarness({ eligible: 3 });
    const outcome = await harness.run(flow);
    assert.equal(outcome.action, "run");
    assert.equal(harness.calls.increments, 1);
    assert.equal(harness.calls.memory, 1);
  }

  const ineligibleFlows = [
    "deterministic_confirmation",
    "exact_search",
    "more_results",
    "related_family",
    "related_nearby",
    "history_read",
  ];

  for (const flow of ineligibleFlows) {
    const harness = createHarness();
    const outcome = await harness.run(flow);
    assert.equal(outcome.reason, "ineligible_flow");
    assert.equal(harness.calls.increments, 0);
    assert.equal(harness.calls.memory, 0);
  }
});

await test("Los logs estructurados no contienen contenido sensible", async () => {
  const harness = createHarness({ eligible: 3 });
  await harness.run();
  const serialized = JSON.stringify(harness.logs);
  const forbidden = [
    "chat-secret",
    "user-secret",
    "private-message",
    "private-chat-summary",
    "private-user-summary",
  ];
  for (const value of forbidden) {
    assert.equal(serialized.includes(value), false);
  }
  for (const entry of harness.logs) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      [
        "action",
        "cadence",
        "eligibleTurnCount",
        "event",
        "reason",
        "summarizedTurnCount",
      ].sort(),
    );
  }
});

await test("chatService integra exactamente dos puntos despues del guardado", () => {
  const source = readFileSync(
    resolve(__dirname, "../src/services/chatService.js"),
    "utf8",
  );
  assert.equal(
    (source.match(/await refreshMemoryAfterEligibleTurn\(/g) || []).length,
    2,
  );
  assert.equal(source.includes("generateMemorySummaries"), false);

  const continueBlock = source.slice(
    source.indexOf("async function continueConversationAfterAction"),
    source.indexOf("async function handleEducativeAction"),
  );
  assert.ok(
    continueBlock.indexOf("await generateAssistantReply") <
      continueBlock.indexOf("const assistantMessage = await createMessage"),
  );
  assert.ok(
    continueBlock.indexOf("const assistantMessage = await createMessage") <
      continueBlock.indexOf("await refreshMemoryAfterEligibleTurn"),
  );

  const normalBlock = source.slice(source.indexOf("export async function sendMessage"));
  assert.ok(
    normalBlock.indexOf("await generateAssistantReply") <
      normalBlock.indexOf("await refreshMemoryAfterEligibleTurn"),
  );
  assert.ok(
    normalBlock.lastIndexOf("assistantMessage =") <
      normalBlock.indexOf("await refreshMemoryAfterEligibleTurn"),
  );
});

await test("Errores previos al guardado no alcanzan el refresco", async () => {
  async function orchestrate(generateReply, saveAssistant, refresh) {
    const reply = await generateReply();
    await saveAssistant(reply);
    await refresh();
  }

  let refreshCalls = 0;
  await assert.rejects(
    orchestrate(
      async () => {
        const error = new Error("Gemini unavailable");
        error.statusCode = 502;
        throw error;
      },
      async () => {},
      async () => {
        refreshCalls += 1;
      },
    ),
  );
  assert.equal(refreshCalls, 0);

  await assert.rejects(
    orchestrate(
      async () => "reply",
      async () => {
        throw new Error("save failed");
      },
      async () => {
        refreshCalls += 1;
      },
    ),
  );
  assert.equal(refreshCalls, 0);
});

await test("Cuando no corresponde hay cero llamadas de memoria", async () => {
  const harness = createHarness();
  for (let turn = 1; turn <= 3; turn += 1) {
    await harness.run();
  }
  assert.equal(harness.calls.memory, 0);
});

await test("Cuando corresponde hay exactamente una llamada de memoria", async () => {
  const harness = createHarness({ eligible: 3 });
  await harness.run();
  assert.equal(harness.calls.memory, 1);
  assert.equal(harness.calls.chatSaves, 1);
  assert.equal(harness.calls.userMemorySaves, 1);
});

const failed = results.filter((result) => result.status === "FAIL");
const output = {
  generatedAt: new Date().toISOString(),
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  simulation,
  realGeminiCalls: 0,
  productionDatabaseWrites: 0,
  results,
};

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output, null, 2));

if (failed.length) {
  process.exitCode = 1;
}
