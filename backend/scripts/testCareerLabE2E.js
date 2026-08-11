import assert from "node:assert/strict";
import prisma from "../src/config/prisma.js";
import * as lab from "../src/services/careerLabService.js";

const userA = await prisma.user.create({ data: { name: "Career Lab A", email: `career-a-${Date.now()}@example.test`, passwordHash: "test-only" } });
const userB = await prisma.user.create({ data: { name: "Career Lab B", email: `career-b-${Date.now()}@example.test`, passwordHash: "test-only" } });
let checks = 0;
try {
  assert.equal(lab.listLabs().length, 6); checks++;
  await assert.rejects(() => lab.startAttempt(userA.id, { labKey: "missing" }), /Lab no encontrado/); checks++;
  for (const definition of lab.listLabs()) {
    let attempt = await lab.startAttempt(userA.id, { labKey: definition.key }); assert.equal(attempt.status, "active"); checks++;
    await assert.rejects(() => lab.act(userA.id, attempt.id, { attemptId: attempt.id, stepId: "fake", optionId: "fake", revision: attempt.revision }), /Paso invalido/); checks++;
    await assert.rejects(() => lab.act(userA.id, attempt.id, { attemptId: attempt.id, stepId: attempt.currentStep.id, optionId: "fake", revision: attempt.revision }), /Opcion invalida/); checks++;
    await assert.rejects(() => lab.act(userA.id, attempt.id, { attemptId: attempt.id, stepId: attempt.currentStep.id, optionId: attempt.currentStep.options[0].id, revision: attempt.revision, score: 100 }), /Accion no permitida/); checks++;
    while (attempt.status === "active") attempt = await lab.act(userA.id, attempt.id, { attemptId: attempt.id, stepId: attempt.currentStep.id, optionId: attempt.currentStep.options[0].id, revision: attempt.revision });
    assert.ok(Object.values(attempt.skillScores).every((score) => score >= 0 && score <= 100)); checks++;
    await assert.rejects(() => lab.getAttempt(userB.id, attempt.id), /Intento no encontrado/); checks++;
    await assert.rejects(() => lab.act(userA.id, attempt.id, { attemptId: attempt.id, stepId: "x", optionId: "x", revision: attempt.revision }), /ya termino/); checks++;
    const before = JSON.stringify(attempt.skillScores); attempt = await lab.reflect(userA.id, attempt.id, { attemptId: attempt.id, reflection: "LIKED", revision: attempt.revision }); assert.equal(JSON.stringify(attempt.skillScores), before); checks++;
    await assert.rejects(() => lab.reflect(userA.id, attempt.id, { attemptId: attempt.id, reflection: "LIKED", revision: attempt.revision }), /ya fue guardada/); checks++;
  }
  const concurrent = await lab.startAttempt(userA.id, { labKey: "technology_debugging" }); const payload = { attemptId: concurrent.id, stepId: concurrent.currentStep.id, optionId: concurrent.currentStep.options[0].id, revision: concurrent.revision }; const settled = await Promise.allSettled([lab.act(userA.id, concurrent.id, payload), lab.act(userA.id, concurrent.id, payload)]); assert.equal(settled.filter((x) => x.status === "fulfilled").length, 1); assert.equal(settled.filter((x) => x.status === "rejected" && x.reason.statusCode === 409).length, 1); checks += 2;
  const profile = await lab.profile(userA.id); assert.equal(profile.completedLabs, 6); assert.equal(profile.areasExplored.length, 6); checks += 2;
  const completed = (await lab.listAttempts(userA.id)).find((item) => item.lab.key === "technology_debugging" && item.status === "completed"); const careers = await lab.relatedCareers(userA.id, completed.id); assert.ok(careers.length > 0); assert.ok(careers.every((item) => item.careerId && item.offerId && item.campusId)); checks += 2;
  console.log(`career lab E2E: ${checks} passed; completed labs: ${profile.completedLabs}; related real careers: ${careers.length}`);
} finally { await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } }); await prisma.$disconnect(); }
