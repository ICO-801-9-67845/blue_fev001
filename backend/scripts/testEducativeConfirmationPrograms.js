import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const API_URL = process.env.BLUE_TEST_API_URL || "http://localhost:4000/api";
const searchMap = JSON.parse(
  readFileSync(new URL("../src/config/educativeSearchMap.json", import.meta.url), "utf8")
    .replace(/^\uFEFF/, ""),
);
const prisma = new PrismaClient();
const email = "educative-programs-" + Date.now() + "@bluefev.test";
const password = "Test12345";
const results = [];
let token = "";
let userId = "";

async function request(path, options = {}) {
  const response = await fetch(API_URL + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(options.headers || {}),
    },
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

function expectedLevel(bucket, program) {
  if (bucket === "bachillerato") {
    return "prepa";
  }
  if (bucket === "tsu") {
    return "tsu";
  }
  if (bucket === "posgrados") {
    return "posgrado";
  }
  return "undergraduate";
}

function buildProgramQuery(item) {
  const levelPrefix = {
    prepa: "Quiero estudiar bachillerato en ",
    tsu: "Quiero estudiar TSU en ",
    posgrado: "Quiero estudiar posgrado en ",
    undergraduate: "Quiero estudiar ",
  };
  return levelPrefix[item.expectedLevel] + item.program;
}
function getUrls(text) {
  return String(text || "").match(/https?:\/\/[^\s]+/g) || [];
}

function getOfferIds(text) {
  return [...String(text || "").matchAll(/oferta-educativa\/detalle\/(\d+)/g)]
    .map((match) => match[1]);
}

const programs = [];
const seen = new Set();
for (const [categoryKey, category] of Object.entries(searchMap)) {
  for (const [bucket, entries] of Object.entries(category.programs || {})) {
    for (const program of entries || []) {
      const key = bucket + ":" + program;
      if (!seen.has(key)) {
        seen.add(key);
        programs.push({
          categoryKey,
          bucket,
          program,
          expectedLevel: expectedLevel(bucket, program),
        });
      }
    }
  }
}

try {
  const registration = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Educative Programs E2E",
      email,
      password,
    }),
  });
  if (!registration.response.ok) {
    throw new Error("No se pudo registrar usuario: " + JSON.stringify(registration.body));
  }
  token = registration.body.data.token;
  userId = registration.body.data.user.id;

  let index = 0;
  for (const item of programs) {
    index += 1;
    const chat = await request("/chats", {
      method: "POST",
      body: JSON.stringify({ title: "Programa " + index }),
    });
    const chatId = chat.body?.data?.id;
    const confirmation = await request("/chats/" + chatId + "/messages", {
      method: "POST",
      body: JSON.stringify({ content: buildProgramQuery(item) }),
    });
    const confirmationMessage = confirmation.body?.data?.assistantMessage;
    const uiAction = confirmationMessage?.uiAction;
    const career = uiAction?.careers?.[0];
    const confirmationValid =
      confirmation.response.status === 201 &&
      uiAction?.type === "career_confirmation" &&
      uiAction.careers.length <= 3 &&
      getUrls(confirmationMessage?.content).length === 0;
    let confirmed = null;
    if (confirmationValid && career) {
      confirmed = await request("/chats/" + chatId + "/messages", {
        method: "POST",
        body: JSON.stringify({
          content: "Mostrar opciones de " + career.name,
          action: {
            type: "confirm_educative_search",
            actionId: uiAction.id,
            career: career.normalizedName,
            level: career.level,
          },
        }),
      });
    }

    const confirmedMessage = confirmed?.body?.data?.assistantMessage;
    const offerIds = getOfferIds(confirmedMessage?.content);
    const urls = getUrls(confirmedMessage?.content);
    const resultValid =
      confirmed?.response?.status === 201 &&
      ["search_followup", "search_exhausted"].includes(
        confirmedMessage?.uiAction?.type,
      ) &&
      offerIds.length <= 3 &&
      new Set(offerIds).size === offerIds.length &&
      urls.every((url) =>
        url.includes("leonforumvocacional.com.mx/oferta-educativa/detalle/"),
      );
    const levelValid = career?.level === item.expectedLevel;
    const status =
      confirmationValid && resultValid && levelValid
        ? offerIds.length
          ? "PASS"
          : "EXPECTED_DATA_GAP"
        : "FAIL";

    results.push({
      index,
      ...item,
      detectedCareer: career || null,
      confirmationValid,
      resultValid,
      levelValid,
      offerIds,
      resultActionType: confirmedMessage?.uiAction?.type || null,
      status,
      error:
        confirmation.body?.message ||
        confirmed?.body?.message ||
        null,
    });

    await request("/chats/" + chatId, { method: "DELETE" });

    if (index % 50 === 0 || index === programs.length) {
      console.error("Processed " + index + "/" + programs.length);
    }
  }
} finally {
  if (userId) {
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  await prisma.$disconnect();
}

const summary = {
  generatedAt: new Date().toISOString(),
  total: results.length,
  pass: results.filter((result) => result.status === "PASS").length,
  expectedDataGap: results.filter(
    (result) => result.status === "EXPECTED_DATA_GAP",
  ).length,
  fail: results.filter((result) => result.status === "FAIL").length,
  results,
};

console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.fail === 0 ? 0 : 1;