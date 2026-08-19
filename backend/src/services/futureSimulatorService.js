import prisma from "../config/prisma.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiError } from "../utils/ApiError.js";
import { getCanonicalProgram, normalizeProgramText, resolveCanonicalProgram } from "./educativeProgramRelationsService.js";
import { SCENARIO_VERSION, METRIC_KEYS, getEvent, getTrackEventId } from "../config/futureSimulatorScenarios.js";

const PAGE_SIZE_MAX = 50;
const allowedLevels = Object.freeze({ secundaria: new Set(["bachillerato", "tecnico_bachillerato"]), preparatoria: new Set(["tsu", "licenciatura", "ingenieria"]) });
const categoryTracks = Object.freeze({ computacion_sistemas_ti: "technology", administracion_negocios_mercadotecnia: "business_finance", contabilidad_finanzas_economia: "business_finance", derecho_politica_gobierno: "social_humanities", salud_medicina_enfermeria_nutricion: "health_science", psicologia: "social_humanities", educacion_pedagogia_docencia: "education", ingenieria_industrial_mecatronica_mecanica: "engineering_industry", arquitectura_construccion_civil: "engineering_industry", diseno_artes_moda: "design_creative", comunicacion_lenguas_humanidades: "social_humanities", criminologia_seguridad: "social_humanities", quimica_biologia_biotecnologia_ambiental: "agriculture_environment", agronomia_veterinaria_alimentos: "agriculture_environment", logistica_comercio_internacional_transporte: "business_finance", gastronomia_turismo_hospitalidad: "tourism_gastronomy_service", fisico_matematicas_ciencias_exactas: "engineering_industry" });
const configDirectory = dirname(fileURLToPath(import.meta.url));
const educativeSearchMap = JSON.parse(readFileSync(join(configDirectory, "../config/educativeSearchMap.json"), "utf8").replace(/^\uFEFF/, ""));
const explicitTrackIndex = new Map();
for (const [category, definition] of Object.entries(educativeSearchMap)) for (const values of Object.values(definition.programs || {})) for (const name of values || []) {
  const normalized = normalizeProgramText(name); const track = categoryTracks[category];
  if (normalized && track && !explicitTrackIndex.has(normalized)) explicitTrackIndex.set(normalized, track);
}

function asText(value) { return String(value || "").trim(); }
function integer(value, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function clampMetric(value) { return Math.max(0, Math.min(100, Math.round(Number(value) || 0))); }
function initialMetrics(setup) {
  const state = { energy: 60, resources: 55, freeTime: 55, workload: 45, stress: 35, experience: 25, professionalNetwork: 20 };
  const effects = { "medio-tiempo": { resources: 12, freeTime: -12, workload: 8, stress: 5 }, "fines-semana": { resources: 8, freeTime: -8, workload: 5 }, compartir: { resources: 4, freeTime: -3, stress: 3 }, independiente: { resources: -6, freeTime: -6, stress: 6 }, tiempo: { freeTime: 5, stress: -2 }, recursos: { resources: 5 }, carga: { workload: -4, stress: -2 }, adaptacion: { energy: 4, stress: -3 }, experiencia: { experience: 5 } };
  for (const key of [setup.workMode, setup.livingSituation, setup.priority]) for (const [metric, delta] of Object.entries(effects[key] || {})) state[metric] = clampMetric(state[metric] + delta);
  return state;
}
function inferLevel(name) {
  const normalized = normalizeProgramText(name);
  if (/\b(BACHILLERATO|PREPA|PREPARATORIA)\b/.test(normalized)) return "bachillerato";
  if (/\b(TSU|TECNICO SUPERIOR UNIVERSITARIO)\b/.test(normalized)) return "tsu";
  if (/\bINGENIERIA\b/.test(normalized)) return "ingenieria";
  if (/\b(ESPECIALIDAD|MAESTRIA|MASTER|DOCTORADO)\b/.test(normalized)) return "posgrado";
  return "licenciatura";
}
function programFromRow(row) {
  const canonical = resolveCanonicalProgram(row.careerName) || null;
  const level = canonical?.academicLevel || inferLevel(row.careerName);
  const canonicalName = canonical?.name || asText(row.careerName);
  return { programId: canonical?.canonicalProgramId || `raw:${encodeURIComponent(normalizeProgramText(canonicalName))}`, canonicalName, level, rawName: asText(row.careerName) };
}
async function offerRows() {
  return prisma.$queryRaw`
    SELECT c.id AS campusId, c.ev_educative_offer_id AS offerId, c.name AS campusName, c.municipality AS campusMunicipality,
      o.name AS institutionName, o.municipality AS institutionMunicipality, o.redirect_url AS redirectUrl,
      cc.id AS careerId, cc.name AS careerName, cc.shift AS shift, cc.modality AS modality
    FROM tbl_educative_offer_campus_careers cc
    INNER JOIN tbl_educative_offer_campuses c ON c.id = cc.ev_educative_offer_campus_id
    INNER JOIN tbl_educative_offer o ON CAST(o.id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_bin = CAST(c.ev_educative_offer_id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_bin
    WHERE COALESCE(cc.active, 0) = 1 AND COALESCE(c.active, 0) = 1 AND COALESCE(o.active, 0) = 1
      AND cc.name IS NOT NULL AND TRIM(cc.name) <> ''`;
}
function allowedStartingLevel(value) { if (!allowedLevels[value]) throw new ApiError(400, "Nivel inicial invalido"); return value; }
function trackForProgram(program) {
  const canonical = getCanonicalProgram(program.programId);
  const normalized = normalizeProgramText(canonical?.canonicalName || program.canonicalName);
  return explicitTrackIndex.get(normalized) || "general_academic";
}
async function catalog(startingLevel, { query = "", municipality = "" } = {}) {
  const rows = await offerRows(); const allowed = allowedLevels[startingLevel]; const normalizedQuery = normalizeProgramText(query); const normalizedMunicipality = normalizeProgramText(municipality); const byProgram = new Map();
  for (const row of rows) {
    const program = programFromRow(row); if (!allowed.has(program.level)) continue;
    if (normalizedQuery && !normalizeProgramText(program.canonicalName).includes(normalizedQuery)) continue;
    if (normalizedMunicipality && !normalizeProgramText(row.campusMunicipality || row.institutionMunicipality).includes(normalizedMunicipality)) continue;
    const item = byProgram.get(program.programId) || { ...program, institutionIds: new Set() }; item.institutionIds.add(String(row.offerId)); byProgram.set(program.programId, item);
  }
  return [...byProgram.values()].map(({ institutionIds, ...item }) => ({ ...item, institutionCount: institutionIds.size })).sort((a, b) => a.canonicalName.localeCompare(b.canonicalName, "es"));
}
export async function listPrograms(params) { const startingLevel = allowedStartingLevel(params.startingLevel); const pageSize = Math.min(PAGE_SIZE_MAX, integer(params.pageSize, 20)); const page = integer(params.page, 1); const all = await catalog(startingLevel, params); return { items: all.slice((page - 1) * pageSize, page * pageSize).map(({ rawName, ...item }) => item), pagination: { page, pageSize, total: all.length, totalPages: Math.max(1, Math.ceil(all.length / pageSize)) } }; }
export async function listInstitutions(startingLevel, programId) { const programs = await catalog(allowedStartingLevel(startingLevel)); const program = programs.find((item) => item.programId === programId); if (!program) throw new ApiError(404, "Programa no encontrado o no permitido"); const rows = await offerRows(); const grouped = new Map(); for (const row of rows) { const candidate = programFromRow(row); if (candidate.programId !== programId) continue; const item = grouped.get(String(row.offerId)) || { offerId: String(row.offerId), name: row.institutionName, redirectUrl: row.redirectUrl || null, campuses: [] }; item.campuses.push({ campusId: String(row.campusId), name: row.campusName, municipality: row.campusMunicipality || row.institutionMunicipality || null, programName: candidate.rawName, shift: row.shift || null, modality: row.modality || null }); grouped.set(item.offerId, item); } return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, "es")); }
function validateSetup(setup = {}) { const allowed = { workMode: ["no", "medio-tiempo", "fines-semana"], livingSituation: ["familia", "compartir", "independiente"], priority: ["tiempo", "recursos", "carga", "adaptacion", "experiencia"] }; const result = {}; for (const [key, values] of Object.entries(allowed)) { if (!values.includes(setup[key])) throw new ApiError(400, "Configuracion de escenario invalida"); result[key] = setup[key]; } return result; }
function simulationPresentation(simulation, rows) {
  const matchingRow = rows.find((row) => String(row.offerId) === simulation.selectedOfferId
    && String(row.campusId) === simulation.selectedCampusId
    && programFromRow(row).programId === simulation.selectedProgramId);
  return matchingRow ? { programName: programFromRow(matchingRow).canonicalName, institutionName: asText(matchingRow.institutionName), campusName: asText(matchingRow.campusName) } : { programName: null, institutionName: null, campusName: null };
}
function publicSimulation(simulation, presentation = {}) { const state = simulation.state || {}; const current = simulation.status === "active" ? getEvent(simulation.scenarioTrack, simulation.currentEventId) : null; return { id: simulation.id, programId: simulation.selectedProgramId, programName: presentation.programName || null, offerId: simulation.selectedOfferId, institutionName: presentation.institutionName || null, campusId: simulation.selectedCampusId, campusName: presentation.campusName || null, startingLevel: simulation.startingLevel, track: simulation.scenarioTrack, scenarioVersion: simulation.scenarioVersion, status: simulation.status, stage: simulation.stage, revision: simulation.revision, metrics: state.metrics, flags: state.flags || {}, choices: simulation.choices || [], currentEvent: current ? { id: current.id, stage: current.stage, title: current.title, description: current.description, options: current.options.map(({ id, label, explanation }) => ({ id, label, explanation })) } : null, result: state.result || null, createdAt: simulation.createdAt, updatedAt: simulation.updatedAt }; }
export async function createSimulation(userId, payload) { const startingLevel = allowedStartingLevel(payload.startingLevel); const institutions = await listInstitutions(startingLevel, payload.programId); const institution = institutions.find((item) => item.offerId === String(payload.offerId)); const campus = institution?.campuses.find((item) => item.campusId === String(payload.campusId)); if (!campus) throw new ApiError(400, "La institucion o campus no ofrece el programa seleccionado"); const programs = await catalog(startingLevel); const program = programs.find((item) => item.programId === payload.programId); const setup = validateSetup(payload.setup); const track = trackForProgram(program); const state = { metrics: initialMetrics(setup), flags: {} }; const simulation = await prisma.futureSimulation.create({ data: { userId, selectedProgramId: program.programId, selectedOfferId: institution.offerId, selectedCampusId: campus.campusId, startingLevel, scenarioTrack: track, scenarioVersion: SCENARIO_VERSION, setup, state, choices: [], currentEventId: "start_organize", stage: "start", status: "active" } }); return publicSimulation(simulation, { programName: program.canonicalName, institutionName: institution.name, campusName: campus.name }); }
export async function getSimulation(userId, id) { const item = await prisma.futureSimulation.findFirst({ where: { id, userId } }); if (!item) throw new ApiError(404, "Simulacion no encontrada"); const rows = await offerRows(); return publicSimulation(item, simulationPresentation(item, rows)); }
export async function listSimulations(userId) { const [items, rows] = await Promise.all([prisma.futureSimulation.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } }), offerRows()]); return items.map((item) => publicSimulation(item, simulationPresentation(item, rows))); }
function resultFor(state, choices) { const priorities = choices.some((choice) => choice.optionId === "accept") ? "Priorizaste la experiencia incluso cuando implicó menos tiempo libre." : "Priorizaste sostener un ritmo que protegiera tu disponibilidad."; return { summary: priorities, disclaimer: "Este resultado refleja únicamente las decisiones tomadas dentro de esta simulación. No predice tu desempeño académico, económico o profesional.", metrics: state.metrics }; }
export async function decide(userId, id, payload) { const current = await prisma.futureSimulation.findFirst({ where: { id, userId } }); if (!current) throw new ApiError(404, "Simulacion no encontrada"); if (current.status !== "active") throw new ApiError(409, "La simulacion ya termino"); if (payload.eventId !== current.currentEventId) throw new ApiError(409, "El evento ya no esta disponible"); const item = getEvent(current.scenarioTrack, current.currentEventId); const selected = item?.options.find((choice) => choice.id === payload.optionId); if (!selected) throw new ApiError(400, "Opcion invalida"); const state = structuredClone(current.state); for (const key of METRIC_KEYS) state.metrics[key] = clampMetric(state.metrics[key] + (selected.effects[key] || 0)); state.flags = { ...(state.flags || {}), ...(selected.flags || {}) }; const choices = [...(current.choices || []), { eventId: item.id, optionId: selected.id }]; const next = selected.nextEventId === "__track__" ? getTrackEventId(current.scenarioTrack) : selected.nextEventId; const done = !next; if (done) state.result = resultFor(state, choices); const update = await prisma.futureSimulation.updateMany({ where: { id, userId, revision: current.revision, currentEventId: current.currentEventId, status: "active" }, data: { state, choices, currentEventId: next, stage: done ? "result" : getEvent(current.scenarioTrack, next)?.stage || "result", status: done ? "completed" : "active", revision: { increment: 1 } } }); if (update.count !== 1) throw new ApiError(409, "La simulacion cambio en otra solicitud"); return getSimulation(userId, id); }
export { clampMetric, initialMetrics };
