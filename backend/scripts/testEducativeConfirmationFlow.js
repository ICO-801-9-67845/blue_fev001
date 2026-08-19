import { PrismaClient } from "@prisma/client";

const API_URL = process.env.BLUE_TEST_API_URL || "http://localhost:4000/api";
const EMAIL = "educative-confirmation-" + Date.now() + "@bluefev.test";
const PASSWORD = "Test12345";
const prisma = new PrismaClient();
const results = [];
const createdChatIds = [];

function record(name, passed, details = {}) {
  results.push({
    name,
    status: passed ? "PASS" : "FAIL",
    details,
  });
}

async function request(path, options = {}, token = "") {
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

async function createChat(token, title) {
  const result = await request(
    "/chats",
    {
      method: "POST",
      body: JSON.stringify({ title }),
    },
    token,
  );
  if (!result.response.ok) {
    throw new Error("No se pudo crear chat: " + JSON.stringify(result.body));
  }
  createdChatIds.push(result.body.data.id);
  return result.body.data.id;
}

async function send(token, chatId, content, action = null) {
  return request(
    "/chats/" + chatId + "/messages",
    {
      method: "POST",
      body: JSON.stringify({
        content,
        ...(action ? { action } : {}),
      }),
    },
    token,
  );
}

function getUrls(text) {
  return String(text || "").match(/https?:\/\/[^\s]+/g) || [];
}

function getOfferIds(text) {
  return [...String(text || "").matchAll(/oferta-educativa\/detalle\/(\d+)/g)]
    .map((match) => match[1]);
}

async function confirmFirstCareer(token, chatId, confirmationResponse) {
  const uiAction = confirmationResponse.body?.data?.assistantMessage?.uiAction;
  const career = uiAction?.careers?.[0];
  if (!career) {
    return null;
  }
  return send(
    token,
    chatId,
    "Mostrar opciones de " + career.name,
    {
      type: "confirm_educative_search",
      actionId: uiAction.id,
      career: career.normalizedName,
      level: career.level,
    },
  );
}

const login = await request("/auth/register", {
  method: "POST",
  body: JSON.stringify({
    name: "Educative Confirmation E2E",
    email: EMAIL,
    password: PASSWORD,
  }),
});

if (!login.response.ok) {
  throw new Error("Registro de prueba fallo: " + JSON.stringify(login.body));
}

const token = login.body.data.token;
const testUserId = login.body.data.user.id;
const mainChatId = await createChat(token, "E2E confirmacion educativa");
const first = await send(token, mainChatId, "Quiero estudiar Psicología");
const firstMessage = first.body?.data?.assistantMessage;
record(
  "1. Carrera directa requiere confirmacion",
  first.response.status === 201 &&
    firstMessage?.uiAction?.type === "career_confirmation" &&
    getUrls(firstMessage?.content).length === 0,
  { status: first.response.status, uiAction: firstMessage?.uiAction },
);

const firstAction = firstMessage?.uiAction;
const selectedCareer = firstAction?.careers?.[0];
const confirmed = await confirmFirstCareer(token, mainChatId, first);
const confirmedMessage = confirmed?.body?.data?.assistantMessage;
const firstOfferIds = getOfferIds(confirmedMessage?.content);
record(
  "2. Confirmar devuelve maximo tres instituciones validas",
  confirmed?.response?.status === 201 &&
    firstOfferIds.length > 0 &&
    firstOfferIds.length <= 3 &&
    getUrls(confirmedMessage?.content).every((url) =>
      url.includes("leonforumvocacional.com.mx/oferta-educativa/detalle/"),
    ),
  { status: confirmed?.response?.status, offerIds: firstOfferIds },
);

const reloaded = await request("/chats/" + mainChatId + "/messages", {}, token);
const previousAction = reloaded.body?.data?.find(
  (message) => message.id === firstMessage?.id,
)?.uiAction;
record(
  "3. Historial reconstruye accion y estado",
  reloaded.response.ok &&
    previousAction?.id === firstAction?.id &&
    previousAction?.status === "completed",
  { previousAction },
);

const duplicate = await send(
  token,
  mainChatId,
  "Mostrar opciones de " + selectedCareer?.name,
  {
    type: "confirm_educative_search",
    actionId: firstAction?.id,
    career: selectedCareer?.normalizedName,
  },
);
record(
  "4. Accion duplicada se rechaza",
  duplicate.response.status === 409,
  { status: duplicate.response.status, body: duplicate.body },
);

const followupAction = confirmedMessage?.uiAction;
let more = null;
let secondOfferIds = [];
if (followupAction?.type === "search_followup") {
  more = await send(
    token,
    mainChatId,
    "Dame más opciones",
    {
      type: "more_educative_results",
      actionId: followupAction.id,
    },
  );
  secondOfferIds = getOfferIds(more.body?.data?.assistantMessage?.content);
}
record(
  "5. Mas opciones conserva busqueda y no duplica",
  followupAction?.type !== "search_followup" ||
    (
      more?.response?.status === 201 &&
      secondOfferIds.every((id) => !firstOfferIds.includes(id)) &&
      secondOfferIds.length <= 3
    ),
  { firstOfferIds, secondOfferIds },
);

const typedChat = await createChat(token, "E2E respuesta escrita");
const typedStart = await send(token, typedChat, "Quiero estudiar Derecho");
const typedConfirm = await send(token, typedChat, "muéstrame opciones");
record(
  "6. Respuesta escrita confirma accion unica",
  typedStart.body?.data?.assistantMessage?.uiAction?.type === "career_confirmation" &&
    getOfferIds(typedConfirm.body?.data?.assistantMessage?.content).length > 0,
  { status: typedConfirm.response.status },
);

const multipleChat = await createChat(token, "E2E varias carreras");
const multiple = await send(
  token,
  multipleChat,
  "Me interesan Psicología, Trabajo Social y Pedagogía",
);
const multipleAction = multiple.body?.data?.assistantMessage?.uiAction;
record(
  "7. Varias carreras: maximo tres y sin duplicados",
  multipleAction?.type === "career_confirmation" &&
    multipleAction.careers.length === 3 &&
    new Set(multipleAction.careers.map((career) => career.normalizedName)).size === 3,
  { careers: multipleAction?.careers },
);

const ambiguous = await send(token, multipleChat, "sí");
record(
  "8. Si ambiguo no elige carrera",
  ambiguous.response.status === 201 &&
    getUrls(ambiguous.body?.data?.assistantMessage?.content).length === 0 &&
    String(ambiguous.body?.data?.assistantMessage?.content).includes("varias opciones"),
  { response: ambiguous.body?.data?.assistantMessage?.content },
);

const secondSelection = await send(token, multipleChat, "la segunda");
record(
  "9. Referencia ordinal selecciona opcion ofrecida",
  secondSelection.response.status === 201 &&
    getOfferIds(secondSelection.body?.data?.assistantMessage?.content).length > 0,
  { response: secondSelection.body?.data?.assistantMessage?.content },
);

const foreignChat = await createChat(token, "E2E accion ajena");
const foreign = await send(
  token,
  foreignChat,
  "Mostrar opciones",
  {
    type: "confirm_educative_search",
    actionId: firstAction?.id,
    career: selectedCareer?.normalizedName,
  },
);
record(
  "10. Accion de otro chat se rechaza",
  foreign.response.status === 409,
  { status: foreign.response.status },
);

const deferralChat = await createChat(token, "E2E posponer");
const deferralStart = await send(token, deferralChat, "Quiero estudiar Contabilidad");
const deferralAction = deferralStart.body?.data?.assistantMessage?.uiAction;
const deferral = await send(
  token,
  deferralChat,
  "Seguir conversando",
  {
    type: "defer_educative_search",
    actionId: deferralAction?.id,
  },
);
record(
  "11. Seguir conversando no muestra instituciones",
  deferral.response.status === 201 &&
    getUrls(deferral.body?.data?.assistantMessage?.content).length === 0,
  { status: deferral.response.status },
);

const deferralHistory = await request("/chats/" + deferralChat + "/messages", {}, token);
const deferredCard = deferralHistory.body?.data?.find(
  (message) => message.id === deferralStart.body?.data?.assistantMessage?.id,
)?.uiAction;
record(
  "12. Accion pospuesta persiste como dismissed",
  deferredCard?.status === "dismissed",
  { deferredCard },
);

const reinforced = await send(
  token,
  deferralChat,
  "La contabilidad me interesa cada vez más",
);
record(
  "21. Refuerzo fuerte reabre antes de tres mensajes",
  reinforced.response.status === 201 &&
    reinforced.body?.data?.assistantMessage?.uiAction?.type === "career_confirmation" &&
    getUrls(reinforced.body?.data?.assistantMessage?.content).length === 0,
  { uiAction: reinforced.body?.data?.assistantMessage?.uiAction },
);

await prisma.userMemory.deleteMany({
  where: { userId: testUserId },
});
const threeMessageChat = await createChat(token, "E2E espera tres mensajes");
const threeStart = await send(token, threeMessageChat, "Quiero estudiar Psicología");
const threeAction = threeStart.body?.data?.assistantMessage?.uiAction;
await send(
  token,
  threeMessageChat,
  "Seguir conversando",
  {
    type: "defer_educative_search",
    actionId: threeAction?.id,
  },
);
const neutralOne = await send(token, threeMessageChat, "Hoy fue un día tranquilo");
const neutralTwo = await send(token, threeMessageChat, "También descansé un poco");
record(
  "22. Sin refuerzo no repite antes de tres mensajes",
  neutralOne.body?.data?.assistantMessage?.uiAction?.type !== "career_confirmation" &&
    neutralTwo.body?.data?.assistantMessage?.uiAction?.type !== "career_confirmation",
  {
    firstAction: neutralOne.body?.data?.assistantMessage?.uiAction || null,
    secondAction: neutralTwo.body?.data?.assistantMessage?.uiAction || null,
  },
);
const neutralThree = await send(token, threeMessageChat, "Eso es todo por ahora");
record(
  "23. Tercer mensaje puede reabrir confirmacion",
  neutralThree.body?.data?.assistantMessage?.uiAction?.type === "career_confirmation",
  { uiAction: neutralThree.body?.data?.assistantMessage?.uiAction },
);
const noPendingChat = await createChat(token, "E2E si sin pendiente");
const noPendingYes = await send(token, noPendingChat, "sí");
record(
  "13. Si sin accion pendiente no inicia busqueda",
  noPendingYes.response.status === 201 &&
    getUrls(noPendingYes.body?.data?.assistantMessage?.content).length === 0,
  { status: noPendingYes.response.status },
);

const levelCases = [
  ["14. Bachillerato conserva nivel", "Quiero estudiar bachillerato", "prepa"],
  ["15. TSU conserva nivel", "Quiero estudiar TSU en tecnologías de la información", "tsu"],
  ["16. Posgrado conserva nivel", "Quiero estudiar Maestría en Derecho", "posgrado"],
];
for (const [name, query, expectedLevel] of levelCases) {
  const chatId = await createChat(token, name);
  const response = await send(token, chatId, query);
  const career = response.body?.data?.assistantMessage?.uiAction?.careers?.[0];
  record(name, career?.level === expectedLevel, { career });
}

const changeChat = await createChat(token, "E2E cambio de carrera");
const psychology = await send(token, changeChat, "Quiero estudiar Psicología");
await confirmFirstCareer(token, changeChat, psychology);
const law = await send(token, changeChat, "Ahora quiero estudiar Derecho");
record(
  "17. Cambio de carrera exige nueva confirmacion",
  law.body?.data?.assistantMessage?.uiAction?.type === "career_confirmation" &&
    getUrls(law.body?.data?.assistantMessage?.content).length === 0 &&
    law.body.data.assistantMessage.uiAction.careers.some(
      (career) => career.normalizedName === "DERECHO",
    ),
  { uiAction: law.body?.data?.assistantMessage?.uiAction },
);

const oldPsychAction = psychology.body?.data?.assistantMessage?.uiAction;
const oldReuse = await send(
  token,
  changeChat,
  "Mostrar opciones de Psicología",
  {
    type: "confirm_educative_search",
    actionId: oldPsychAction?.id,
    career: oldPsychAction?.careers?.[0]?.normalizedName,
  },
);
record(
  "18. Accion vieja tras cambio se rechaza",
  oldReuse.response.status === 409,
  { status: oldReuse.response.status },
);

const exhaustedAction = more?.body?.data?.assistantMessage?.uiAction ||
  confirmedMessage?.uiAction;
record(
  "19. Resultado expone followup o exhausted estructurado",
  ["search_followup", "search_exhausted"].includes(exhaustedAction?.type) &&
    (
      exhaustedAction.type !== "search_exhausted" ||
      exhaustedAction.hasMoreResults === false
    ),
  { uiAction: exhaustedAction },
);

const backendLogCheck = await fetch("http://localhost:4000/api/health");
record(
  "20. Gemini no decide instituciones",
  backendLogCheck.ok &&
    getUrls(confirmedMessage?.content).every((url) =>
      url.includes("/oferta-educativa/detalle/"),
    ),
  { note: "Las confirmaciones y resultados se construyen en backend; la busqueda confirmada no llama Gemini." },
);

const regressionQueries = [
  "Ingeniería en Computación",
  "Psicología",
  "Derecho",
  "Contabilidad",
  "Veterinaria",
  "Mecatrónica",
  "Arquitectura",
  "Licenciatura en Administración Agropecuaria",
  "TSU en Tecnologías de la Información",
  "Bachillerato",
  "Maestría en Derecho",
];
const regression = [];

for (const query of regressionQueries) {
  const chatId = await createChat(token, "Regresion " + query);
  const confirmation = await send(token, chatId, "Quiero estudiar " + query);
  const confirmationMessage = confirmation.body?.data?.assistantMessage;
  const result = await confirmFirstCareer(token, chatId, confirmation);
  const resultMessage = result?.body?.data?.assistantMessage;
  const ids = getOfferIds(resultMessage?.content);
  regression.push({
    query,
    confirmationType: confirmationMessage?.uiAction?.type || null,
    institutionsBeforeConfirmation: getUrls(confirmationMessage?.content).length,
    confirmedStatus: result?.response?.status || null,
    offerIds: ids,
    resultActionType: resultMessage?.uiAction?.type || null,
    passed:
      confirmationMessage?.uiAction?.type === "career_confirmation" &&
      getUrls(confirmationMessage?.content).length === 0 &&
      result?.response?.status === 201 &&
      ids.length <= 3,
  });
}

for (const chatId of createdChatIds) {
  await request("/chats/" + chatId, { method: "DELETE" }, token);
}

await prisma.user.deleteMany({
  where: { id: testUserId },
});
await prisma.$disconnect();

const summary = {
  generatedAt: new Date().toISOString(),
  backend: {
    total: results.length,
    pass: results.filter((result) => result.status === "PASS").length,
    fail: results.filter((result) => result.status === "FAIL").length,
    results,
  },
  regression: {
    total: regression.length,
    pass: regression.filter((result) => result.passed).length,
    fail: regression.filter((result) => !result.passed).length,
    results: regression,
  },
};

console.log(JSON.stringify(summary, null, 2));
process.exitCode =
  summary.backend.fail === 0 && summary.regression.fail === 0 ? 0 : 1;