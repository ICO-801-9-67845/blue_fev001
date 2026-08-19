import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../src/config/prisma.js";
import { searchEducativeOffers } from "../src/services/educativeSearchService.js";
import {
  getEducativeProgramRelations,
  normalizeProgramText,
} from "../src/services/educativeProgramRelationsService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportDir = resolve(__dirname, "../../tmp/educative-program-relations");
const config = getEducativeProgramRelations();

function expectedOfferLevel(level) {
  return ["bachillerato", "tecnico_bachillerato"].includes(level) ? "1" : "2";
}

function eligibleRow(row, level) {
  return Number(row.career_active) === 1 &&
    Number(row.offer_active) === 1 &&
    String(row.offer_level) === expectedOfferLevel(level) &&
    String(row.redirect_url || "").trim();
}

const rows = await prisma.$queryRawUnsafe(`
  SELECT c.name AS program_name, c.active AS career_active,
    o.id AS offer_id, o.active AS offer_active, o.level AS offer_level,
    o.redirect_url AS redirect_url
  FROM tbl_educative_offer_campus_careers c
  JOIN tbl_educative_offer_campuses campus
    ON campus.id = c.ev_educative_offer_campus_id
  JOIN tbl_educative_offer o ON o.id = campus.ev_educative_offer_id
  WHERE c.name IS NOT NULL AND TRIM(c.name) <> ''
`);

const rowsByName = new Map();
for (const row of rows) {
  const key = normalizeProgramText(row.program_name);
  rowsByName.set(key, [...(rowsByName.get(key) || []), row]);
}

const aliasOwners = new Map();
for (const [id, program] of Object.entries(config.programs)) {
  for (const alias of program.exactAliases) {
    const key = normalizeProgramText(alias);
    aliasOwners.set(key, [...new Set([...(aliasOwners.get(key) || []), id])]);
  }
}

const results = [];
const originalLog = console.log;
try {
  console.log = () => {};
  for (const [canonicalProgramId, program] of Object.entries(config.programs)) {
    const normalizedAliases = program.exactAliases.map(normalizeProgramText);
    const invalidAlias = !normalizedAliases.length || normalizedAliases.some((alias) => !alias);
    const matchingRows = [...new Set(normalizedAliases)]
      .flatMap((alias) => rowsByName.get(alias) || []);
    const eligibleRows = matchingRows.filter((row) => eligibleRow(row, program.level));
    const eligibleIds = [...new Set(eligibleRows.map((row) => String(row.offer_id)))];
    const ambiguousAliases = [...new Set(normalizedAliases)]
      .filter((alias) => (aliasOwners.get(alias) || []).length > 1);

    const searchArgs = {
      prisma,
      message: program.canonicalName,
      canonicalProgramId,
      exactAliases: program.exactAliases,
      academicLevel: program.level,
      limit: 3,
    };
    let first = null;
    let repeat = null;
    let serviceError = null;
    const offers = [];
    try {
      first = await searchEducativeOffers({ ...searchArgs, excludeShownIds: [] });
      repeat = await searchEducativeOffers({ ...searchArgs, excludeShownIds: [] });
      offers.push(...first.offerContext);
      const shownIds = first.offerContext.map((offer) => String(offer.id));
      let remaining = first.remainingCount;
      let rounds = 0;
      while (remaining > 0 && rounds < 100) {
        const page = await searchEducativeOffers({ ...searchArgs, excludeShownIds: shownIds });
        const newOffers = page.offerContext.filter((offer) => !shownIds.includes(String(offer.id)));
        offers.push(...newOffers);
        shownIds.push(...newOffers.map((offer) => String(offer.id)));
        remaining = page.remainingCount;
        rounds += 1;
        if (!newOffers.length && remaining > 0) {
          serviceError = "PAGINATION_STALLED";
          break;
        }
      }
    } catch (error) {
      serviceError = error.message;
    }
    const resultIds = offers.map((offer) => String(offer.id));
    const firstIds = (first?.offerContext || []).map((offer) => String(offer.id));
    const allowed = new Set(normalizedAliases);
    const wrongPrograms = offers.flatMap((offer) => offer.careers || [])
      .filter((career) => !allowed.has(normalizeProgramText(career)));
    const duplicateOfferIds = resultIds.filter((id, index) => resultIds.indexOf(id) !== index);
    const invalidRedirectIds = offers
      .filter((offer) => !String(offer.redirect_url || "").trim())
      .map((offer) => String(offer.id));
    const levelMismatchIds = offers
      .filter((offer) => String(offer.level) !== expectedOfferLevel(program.level))
      .map((offer) => String(offer.id));
    const repeatIds = (repeat?.offerContext || []).map((offer) => String(offer.id));
    const stableRanking = !serviceError && JSON.stringify(firstIds) === JSON.stringify(repeatIds);
    const missingEligibleIds = eligibleIds.filter((id) => !resultIds.includes(id));

    let status = "PASS";
    if (invalidAlias) status = "INVALID_ALIAS";
    else if (levelMismatchIds.length) status = "LEVEL_MISMATCH";
    else if (serviceError || wrongPrograms.length || duplicateOfferIds.length ||
      invalidRedirectIds.length || !stableRanking || missingEligibleIds.length) status = "FAIL";
    else if (ambiguousAliases.length) status = "AMBIGUOUS_MAPPING";
    else if (!eligibleIds.length) status = matchingRows.length ? "NO_ELIGIBLE_OFFER" : "WORD_ONLY";

    results.push({
      canonicalProgramId,
      canonicalName: program.canonicalName,
      displayName: program.displayName,
      level: program.level,
      exactAliases: program.exactAliases,
      familyId: program.familyId || null,
      eligibleOfferIds: eligibleIds,
      resultOfferIds: resultIds,
      resultCount: resultIds.length,
      status,
      checks: {
        onlyExactAliases: wrongPrograms.length === 0,
        noDuplicateSchools: duplicateOfferIds.length === 0,
        validRedirectUrls: invalidRedirectIds.length === 0,
        levelMatches: levelMismatchIds.length === 0,
        stableRanking,
        allEligibleOffersReturned: missingEligibleIds.length === 0,
      },
      ambiguousAliases,
      wrongPrograms,
      duplicateOfferIds,
      invalidRedirectIds,
      levelMismatchIds,
      missingEligibleIds,
      serviceError,
    });
  }
} finally {
  console.log = originalLog;
  await prisma.$disconnect();
}

const statusCounts = results.reduce((counts, result) => {
  counts[result.status] = (counts[result.status] || 0) + 1;
  return counts;
}, {});
const report = {
  generatedAt: new Date().toISOString(),
  summary: { total: results.length, ...statusCounts },
  results,
};
mkdirSync(reportDir, { recursive: true });
writeFileSync(resolve(reportDir, "canonical-full-sweep.json"), JSON.stringify(report, null, 2) + "\n");
const markdown = [
  "# Barrido completo de programas canonicos",
  "",
  "## Resumen",
  "",
  ...Object.entries(report.summary).map(([key, value]) => `- ${key}: ${value}`),
  "",
  "## Resultados",
  "",
  "| Estado | Nivel | canonicalProgramId | Programa | IDs elegibles | IDs devueltos |",
  "|---|---|---|---|---|---|",
  ...results.map((item) => `| ${item.status} | ${item.level} | ${item.canonicalProgramId} | ${item.canonicalName.replace(/\|/g, "/")} | ${item.eligibleOfferIds.join(", ") || "-"} | ${item.resultOfferIds.join(", ") || "-"} |`),
];
writeFileSync(resolve(reportDir, "canonical-full-sweep.md"), markdown.join("\n") + "\n");
console.log(JSON.stringify(report.summary, null, 2));
if (results.length !== 462 || statusCounts.FAIL || statusCounts.INVALID_ALIAS || statusCounts.LEVEL_MISMATCH) {
  process.exitCode = 1;
}
