import { readFileSync } from "node:fs";
import { buildActions } from "../../frontend/src/components/educativeActions.js";
import {
  buildEducativeSearchReply,
  findEligibleEducativePrograms,
  searchEducativeOffers,
} from "../src/services/educativeSearchService.js";
import { toCanonicalCareerCandidate } from "../src/services/educativeProgramRelationsService.js";

const files = {
  page: readFileSync(new URL("../../frontend/src/pages/ChatPage.jsx", import.meta.url), "utf8"),
  list: readFileSync(new URL("../../frontend/src/components/MessageList.jsx", import.meta.url), "utf8"),
  menu: readFileSync(new URL("../../frontend/src/components/EducativeActionMenu.jsx", import.meta.url), "utf8"),
  composer: readFileSync(new URL("../../frontend/src/components/MessageComposer.jsx", import.meta.url), "utf8"),
  api: readFileSync(new URL("../../frontend/src/api/chatApi.js", import.meta.url), "utf8"),
  css: readFileSync(new URL("../../frontend/src/styles/global.css", import.meta.url), "utf8"),
  actions: readFileSync(new URL("../../frontend/src/components/educativeActions.js", import.meta.url), "utf8"),
  search: readFileSync(new URL("../src/services/educativeSearchService.js", import.meta.url), "utf8"),
};

const careers = Array.from({ length: 5 }, (_, index) => ({
  name: `Carrera ${index + 1}`,
  normalizedName: `CARRERA ${index + 1}`,
}));
const careerActions = buildActions({
  id: "action-1", type: "career_confirmation", careers, hasMoreCareers: true,
});
const finalCareerActions = buildActions({
  id: "action-2", type: "career_confirmation", careers, hasMoreCareers: false,
});

const exhaustedWithoutRelations = buildActions({
  id: "action-3",
  type: "search_exhausted",
  hasEligibleRelatedPrograms: false,
});
const exhaustedWithRelations = buildActions({
  id: "action-4",
  type: "search_exhausted",
  hasEligibleRelatedPrograms: true,
});

const exactCareer = toCanonicalCareerCandidate("licenciatura_psicologia");
const fixtureRows = [
  {
    id: 1, name: "Institucion Alfa", short_name: "IA", level: 2,
    municipality: "León", redirect_url: "https://fixture.invalid/oferta/1",
    website: "https://website.invalid/1",
    careers: "LICENCIATURA EN PSICOLOGÍA", matchScore: 1,
  },
  {
    id: 2, name: "Institucion Beta", short_name: "IB", level: 2,
    municipality: "Guanajuato", redirect_url: "https://fixture.invalid/oferta/2",
    careers: "LICENCIATURA EN PSICOLOGÍA", matchScore: 1,
  },
  {
    id: 3, name: "Institucion Gamma", short_name: "IG", level: 2,
    municipality: "Silao", redirect_url: "https://fixture.invalid/oferta/3",
    careers: "LICENCIATURA EN PSICOLOGÍA", matchScore: 1,
  },
  {
    id: 4, name: "Institucion Delta", short_name: "ID", level: 2,
    municipality: "León", redirect_url: "https://fixture.invalid/oferta/4",
    careers: "LICENCIATURA EN PSICOLOGÍA", matchScore: 1,
  },
  {
    id: 5, name: "Institucion Empate", short_name: "IE1", level: 2,
    municipality: "Celaya", redirect_url: "https://fixture.invalid/oferta/5",
    careers: "LICENCIATURA EN PSICOLOGÍA", matchScore: 1,
  },
  {
    id: 6, name: "Institucion Empate", short_name: "IE2", level: 2,
    municipality: "Irapuato", redirect_url: "https://fixture.invalid/oferta/6",
    careers: "LICENCIATURA EN PSICOLOGÍA", matchScore: 1,
  },
  {
    id: 1, name: "Institucion Alfa", short_name: "IA", level: 2,
    municipality: "León", redirect_url: "https://fixture.invalid/oferta/1",
    careers: "LICENCIATURA EN PSICOLOGÍA", matchScore: 1,
  },
  {
    id: 9, name: "Institucion Alfa", short_name: "IA2", level: 2,
    municipality: "León", redirect_url: "https://fixture.invalid/oferta/9",
    careers: "LICENCIATURA EN PSICOLOGÍA", matchScore: 1,
  },
  {
    id: 7, name: "Institucion Sin Enlace", short_name: "ISE", level: 2,
    municipality: "León", redirect_url: "   ",
    careers: "LICENCIATURA EN PSICOLOGÍA", matchScore: 1,
  },
  {
    id: 8, name: "Institucion Inactiva", short_name: "II", level: 2,
    municipality: "León", redirect_url: "https://fixture.invalid/oferta/8",
    careers: "LICENCIATURA EN PSICOLOGÍA", matchScore: 1,
    offer_active: 0, campus_active: 1, career_active: 1,
  },
  {
    id: 10, name: "Campus Inactivo", short_name: "CI", level: 2,
    municipality: "León", redirect_url: "https://fixture.invalid/oferta/10",
    careers: "LICENCIATURA EN PSICOLOGÍA", matchScore: 1, campus_active: 0,
  },
  {
    id: 11, name: "Programa Inactivo", short_name: "PI", level: 2,
    municipality: "León", redirect_url: "https://fixture.invalid/oferta/11",
    careers: "LICENCIATURA EN PSICOLOGÍA", matchScore: 1, career_active: 0,
  },
  {
    id: 12, name: "Redirect Null", short_name: "RN", level: 2,
    municipality: "León", redirect_url: null,
    website: "https://website.invalid/12",
    careers: "LICENCIATURA EN PSICOLOGÍA", matchScore: 1,
  },
  {
    id: 13, name: "Redirect Vacio", short_name: "RV", level: 2,
    municipality: "León", redirect_url: "",
    careers: "LICENCIATURA EN PSICOLOGÍA", matchScore: 1,
  },
  {
    id: 14, name: "Nivel Diferente", short_name: "ND", level: 1,
    municipality: "León", redirect_url: "https://fixture.invalid/oferta/14",
    careers: "LICENCIATURA EN PSICOLOGÍA", matchScore: 1,
  },
  {
    id: 15, name: "Programa Diferente", short_name: "PD", level: 2,
    municipality: "León", redirect_url: "https://fixture.invalid/oferta/15",
    careers: "LICENCIATURA EN DERECHO", matchScore: 1, program_matches: false,
  },
];

function normalizeFixtureText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function fixtureSearch(rows, requestedMunicipality = null) {
  const calls = [];
  const prisma = {
    $queryRawUnsafe: async (sql, ...params) => {
      calls.push({ sql, params });
      let selectedRows = rows;
      if (sql.includes("o.active = 1")) {
        selectedRows = selectedRows.filter((row) => row.offer_active !== 0);
      }
      if (sql.includes("campus.active = 1")) {
        selectedRows = selectedRows.filter((row) => row.campus_active !== 0);
      }
      if (sql.includes("c.active = 1")) {
        selectedRows = selectedRows.filter((row) => row.career_active !== 0);
      }
      if (sql.includes("o.level = ?")) {
        selectedRows = selectedRows.filter((row) => String(row.level) === "2");
      }
      if (sql.includes("REGEXP_REPLACE")) {
        selectedRows = selectedRows.filter((row) => row.program_matches !== false);
      }
      return requestedMunicipality
        ? selectedRows.filter((row) =>
            normalizeFixtureText(row.municipality) === normalizeFixtureText(requestedMunicipality)
          )
        : selectedRows;
    },
  };
  const result = await searchEducativeOffers({
    prisma,
    message: exactCareer.searchQuery,
    canonicalProgramId: exactCareer.canonicalProgramId,
    exactAliases: exactCareer.exactAliases,
    academicLevel: exactCareer.academicLevel,
    requestedMunicipality,
    limit: null,
  });
  return { result, call: calls[0] };
}

const originalLog = console.log;
let allFixture;
let reverseFixture;
let leonFixture;
try {
  console.log = () => {};
  allFixture = await fixtureSearch(fixtureRows);
  reverseFixture = await fixtureSearch([...fixtureRows].reverse());
  leonFixture = await fixtureSearch(fixtureRows, "León");
} finally {
  console.log = originalLog;
}
let eligibleRelations;
let emptyRelations;
try {
  console.log = () => {};
  eligibleRelations = await findEligibleEducativePrograms({
    prisma: { $queryRawUnsafe: async () => fixtureRows.slice(0, 1) },
    candidates: [exactCareer],
  });
  emptyRelations = await findEligibleEducativePrograms({
    prisma: { $queryRawUnsafe: async () => [] },
    candidates: [exactCareer],
  });
} finally {
  console.log = originalLog;
}
function validFixtureRows(count) {
  const municipalities = ["León", "Guanajuato", "Silao", "Irapuato", "Celaya"];
  return Array.from({ length: count }, (_, index) => ({
    id: 1000 + index,
    name: `Institucion Controlada ${String(index + 1).padStart(3, "0")}`,
    short_name: `IC${index + 1}`,
    level: 2,
    municipality: municipalities[index % municipalities.length],
    redirect_url: `https://fixture.invalid/controlada/${index + 1}`,
    careers: "LICENCIATURA EN PSICOLOGÍA",
    matchScore: 1,
  }));
}

const countFixtures = new Map();
for (const count of [1, 3, 6, 10, 11, 250]) {
  countFixtures.set(count, await fixtureSearch(validFixtureRows(count)));
}
const longFixtureReply = buildEducativeSearchReply(countFixtures.get(250).result);
const longFixtureBytes = Buffer.byteLength(longFixtureReply, "utf8");

const allOffers = allFixture.result.offerContext;
const allReply = buildEducativeSearchReply(allFixture.result);
const allIds = allOffers.map((offer) => String(offer.id));
const reverseIds = reverseFixture.result.offerContext.map((offer) => String(offer.id));

const checks = [
  ["1. Tarjeta de una carrera", careerActions.some((item) => item.action.type === "confirm_educative_search")],
  ["2. Pagina visible de cinco carreras", careerActions.filter((item) => item.action.type === "confirm_educative_search").length === 5],
  ["3. Boton Mostrar opciones envia accion", careerActions.some((item) => item.action.type === "confirm_educative_search")],
  ["4. Boton Seguir conversando", careerActions.some((item) => item.action.type === "defer_educative_search")],
  ["5. Boton Mostrar mas opciones", files.actions.includes("more_educative_results")],
  ["6. Resultados agotados", files.actions.includes("search_exhausted")],
  ["7. Estado loading", files.menu.includes("Procesando...") && files.menu.includes("aria-busy")],
  ["8. Botones deshabilitados", files.menu.includes("disabled={disabled || !isPending || isLoading}")],
  ["9. Bloqueo inmediato de doble clic", files.page.includes("sendingGuardRef.current")],
  ["10. Recuperacion de error de red", files.page.includes('status: "pending"')],
  ["11. Recarga de tarjeta pendiente", files.page.includes("getMessagesRequest(currentChatId)")],
  ["12. Recarga despues de confirmar", files.page.includes("setMessages(nextMessages)")],
  ["13. Reapertura desde historial", files.page.includes("loadMessages(chatId)")],
  ["14. Vista movil apilada", files.css.includes(".educative-action-menu") && files.css.includes("display: grid")],
  ["15. Sin overflow horizontal", files.css.includes("overflow-wrap: anywhere") && files.css.includes("width: min(100%, 420px)")],
  ["16. Navegacion con teclado", files.css.includes(".educative-action:focus-visible")],
  ["17. Enter para enviar", files.composer.includes('event.key !== "Enter"') && files.composer.includes("sendCurrentMessage")],
  ["18. Voz a texto conservada", files.composer.includes("SpeechRecognition") && files.composer.includes('lang = "es-MX"')],
  ["19. Autoscroll conservado", files.list.includes("scrollIntoView")],
  ["20. Cambio de carrera usa accion backend", files.api.includes("...(action ? { action } : {})") && !files.menu.includes("message.includes")],
  ["21. Mostrar mas carreras visible", careerActions.some((item) => item.action.type === "more_vocational_careers")],
  ["22. Mostrar mas carreras oculto al final", !finalCareerActions.some((item) => item.action.type === "more_vocational_careers")],
  ["23. Seleccion no envia IDs internos", !careerActions.filter((item) => item.action.type === "confirm_educative_search").some((item) => "canonicalProgramId" in item.action)],
  ["24. Accion cerrada exacta", careerActions.find((item) => item.action.type === "more_vocational_careers")?.content === "Mostrar más carreras"],
  ["25. Handler real conserva cinco nombres", careerActions.slice(0, 5).map((item) => item.label).join("|") === careers.map((item) => "Mostrar opciones de " + item.name).join("|")],
  ["26. Seis instituciones elegibles se conservan", allOffers.length === 6],
  ["27. Las seis conservan redirect_url", allOffers.every((offer) => offer.redirect_url?.trim())],
  ["28. Institucion sin redirect_url se excluye", !allIds.includes("7")],
  ["29. SQL filtra oferta activa", allFixture.call.sql.includes("o.active = 1")],
  ["30. SQL filtra campus activo", allFixture.call.sql.includes("campus.active = 1")],
  ["31. SQL filtra programa activo", allFixture.call.sql.includes("c.active = 1")],
  ["32. Guanajuato se conserva sin municipio explicito", allOffers.some((offer) => offer.municipality === "Guanajuato")],
  ["33. Sin municipio no se agrega Leon", !allFixture.call.params.some((value) => normalizeFixtureText(value) === "leon")],
  ["34. Municipio explicito se envia a SQL", leonFixture.call.params.some((value) => normalizeFixtureText(value) === "leon")],
  ["35. Municipio explicito excluye otros municipios", leonFixture.result.offerContext.every((offer) => normalizeFixtureText(offer.municipality) === "leon")],
  ["36. Instituciones no se repiten", new Set(allIds).size === allIds.length],
  ["37. redirect_url permanece intacto", allOffers.find((offer) => String(offer.id) === "1")?.redirect_url === "https://fixture.invalid/oferta/1"],
  ["38. website no reemplaza redirect_url", !allReply.includes("website.invalid")],
  ["39. Respuesta muestra las seis instituciones", allOffers.every((offer) => allReply.includes(offer.name))],
  ["40. Respuesta no muestra IDs internos", !/ID interno|\"id\"|Oferta ID/i.test(allReply)],
  ["41. Orden determinista con empates", JSON.stringify(allIds) === JSON.stringify(reverseIds)],
  ["42. Sin relaciones no aparece accion", !exhaustedWithoutRelations.some((item) => item.action.type === "explore_related_careers")],
  ["43. Con relacion elegible aparece accion", exhaustedWithRelations.some((item) => item.action.type === "explore_related_careers")],
  ["44. Agotado no muestra mas escuelas", !exhaustedWithoutRelations.some((item) => item.action.type === "more_educative_results")],
  ["45. No existe limite SQL exacto silencioso", !/\bLIMIT \?\s*$/m.test(allFixture.call.sql.trim())],
  ["46. Relacion con oferta elegible se conserva", eligibleRelations.length === 1],
  ["47. Relacion sin oferta elegible se excluye", emptyRelations.length === 0],
  ["48. Institucion inactiva se excluye", !allIds.includes("8")],
  ["49. Una institucion valida se conserva", countFixtures.get(1).result.offerContext.length === 1],
  ["50. Tres instituciones validas se conservan", countFixtures.get(3).result.offerContext.length === 3],
  ["51. Diez instituciones validas se conservan", countFixtures.get(10).result.offerContext.length === 10],
  ["52. Mas de diez instituciones se conservan", countFixtures.get(11).result.offerContext.length === 11],
  ["53. Fixture maxima de 250 no se trunca", countFixtures.get(250).result.offerContext.length === 250],
  ["54. Respuesta extensa contiene primera y ultima", longFixtureReply.includes("Institucion Controlada 001") && longFixtureReply.includes("Institucion Controlada 250")],
  ["55. Tamano extenso es medible y no vacio", longFixtureBytes > 1000],
  ["56. Oferta repetida de misma institucion se deduplica", !allIds.includes("9")],
  ["57. redirect_url null se excluye", !allIds.includes("12")],
  ["58. redirect_url vacio se excluye", !allIds.includes("13")],
  ["59. redirect_url solo espacios se excluye", !allIds.includes("7")],
  ["60. website no rescata redirect_url ausente", !allReply.includes("website.invalid")],
  ["61. Campus inactivo se excluye", !allIds.includes("10")],
  ["62. Programa inactivo se excluye", !allIds.includes("11")],
  ["63. Nivel diferente se excluye", !allIds.includes("14")],
  ["64. Programa diferente se excluye", !allIds.includes("15")],
  ["65. Municipios mixtos sobreviven sin filtro", ["León", "Guanajuato", "Silao", "Irapuato", "Celaya"].every((municipality) => countFixtures.get(10).result.offerContext.some((offer) => offer.municipality === municipality))],
  ["66. Filtro Guanajuato conserva solo Guanajuato", (await fixtureSearch(validFixtureRows(10), "Guanajuato")).result.offerContext.every((offer) => offer.municipality === "Guanajuato")],
  ["67. Servicio no conserva logs de depuracion", !/console\.log\(/.test(files.search)],
  ["68. Servicio de busqueda usa UTF-8 sin BOM", files.search.charCodeAt(0) !== 0xFEFF],
];

const results = checks.map(([name, passed]) => ({
  name,
  status: passed ? "PASS" : "FAIL",
}));
const summary = {
  generatedAt: new Date().toISOString(),
  type: "frontend_contract",
  browserExecution: "BLOCKED_BY_BROWSER_URL_POLICY",
  total: results.length,
  pass: results.filter((result) => result.status === "PASS").length,
  fail: results.filter((result) => result.status === "FAIL").length,
  results,
};

console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.fail === 0 ? 0 : 1;
