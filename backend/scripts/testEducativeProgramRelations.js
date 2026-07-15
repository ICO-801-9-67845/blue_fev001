import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  getEducativeProgramRelations,
  normalizeProgramText,
} from "../src/services/educativeProgramRelationsService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, "..");
const reportDir = resolve(backendRoot, "../tmp/educative-program-relations");
const prisma = new PrismaClient();
const config = getEducativeProgramRelations();

function expectedOfferLevel(academicLevel) {
  return ["bachillerato", "tecnico_bachillerato"].includes(academicLevel) ? "1" : "2";
}

function csvSafe(value) {
  return String(value ?? "").replace(/\|/g, "/");
}

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      c.name AS program_name,
      c.active AS career_active,
      o.id AS offer_id,
      o.name AS offer_name,
      o.active AS offer_active,
      o.level AS offer_level,
      o.redirect_url AS redirect_url
    FROM tbl_educative_offer_campus_careers c
    JOIN tbl_educative_offer_campuses campus
      ON campus.id = c.ev_educative_offer_campus_id
    JOIN tbl_educative_offer o
      ON o.id = campus.ev_educative_offer_id
    WHERE c.name IS NOT NULL
      AND TRIM(c.name) <> ''
  `);

  const rowsByName = new Map();
  for (const row of rows) {
    const key = normalizeProgramText(row.program_name);
    const entries = rowsByName.get(key) || [];
    entries.push({
      programName: row.program_name,
      careerActive: Number(row.career_active),
      offerId: String(row.offer_id),
      offerName: row.offer_name,
      offerActive: Number(row.offer_active),
      offerLevel: String(row.offer_level),
      redirectUrl: String(row.redirect_url || ""),
    });
    rowsByName.set(key, entries);
  }

  const aliasOwners = new Map();
  for (const [programId, program] of Object.entries(config.programs)) {
    for (const alias of program.exactAliases) {
      const key = normalizeProgramText(alias);
      const owners = aliasOwners.get(key) || [];
      owners.push(programId);
      aliasOwners.set(key, [...new Set(owners)]);
    }
  }

  const programs = [];
  for (const [programId, program] of Object.entries(config.programs)) {
    const names = new Set(program.exactAliases.map(normalizeProgramText));
    const matchingRows = [...names].flatMap((name) => rowsByName.get(name) || []);
    const expectedLevel = expectedOfferLevel(program.level);
    const eligible = matchingRows.filter((row) =>
      row.careerActive === 1 &&
      row.offerActive === 1 &&
      row.offerLevel === expectedLevel &&
      row.redirectUrl.trim(),
    );
    const eligibleOfferIds = [...new Set(eligible.map((row) => row.offerId))];
    const ambiguousAliases = [...names].filter((name) => (aliasOwners.get(name) || []).length > 1);
    const status = ambiguousAliases.length
      ? "AMBIGUOUS_MAPPING"
      : eligibleOfferIds.length
        ? "PASS"
        : matchingRows.length
          ? "NO_ELIGIBLE_OFFER"
          : "WORD_ONLY";

    programs.push({
      canonicalProgramId: programId,
      canonicalName: program.canonicalName,
      displayName: program.displayName,
      level: program.level,
      exactAliases: program.exactAliases,
      eligibleOfferIds,
      eligibleOfferCount: eligibleOfferIds.length,
      matchingDatabaseNames: [...new Set(matchingRows.map((row) => row.programName))],
      status,
    });
  }

  const databaseOnly = [];
  for (const [normalizedName, databaseRows] of rowsByName) {
    if (aliasOwners.has(normalizedName)) continue;
    const eligibleRows = databaseRows.filter((row) =>
      row.careerActive === 1 &&
      row.offerActive === 1 &&
      row.redirectUrl.trim(),
    );
    if (!eligibleRows.length) continue;
    databaseOnly.push({
      canonicalProgramId: null,
      databaseName: databaseRows[0].programName,
      level: [...new Set(eligibleRows.map((row) => row.offerLevel))],
      eligibleOfferIds: [...new Set(eligibleRows.map((row) => row.offerId))],
      status: "DATABASE_ONLY",
    });
  }

  const counts = programs.reduce((result, program) => {
    result[program.status] = (result[program.status] || 0) + 1;
    return result;
  }, { DATABASE_ONLY: databaseOnly.length });
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      canonicalPrograms: programs.length,
      databaseProgramNames: rowsByName.size,
      ...counts,
    },
    programs,
    databaseOnly,
  };

  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    resolve(reportDir, "database-coverage.json"),
    JSON.stringify(report, null, 2) + "\n",
    "utf8",
  );

  const markdown = [
    "# Cobertura de programas contra la base",
    "",
    "## Resumen",
    "",
    ...Object.entries(report.summary).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Gaps del Word",
    "",
    ...programs
      .filter((program) => program.status !== "PASS")
      .map((program) =>
        `- ${program.status} | ${program.canonicalProgramId} | ${program.canonicalName} | nivel ${program.level} | IDs ${program.eligibleOfferIds.join(", ") || "ninguno"}`,
      ),
    "",
    "## Programas solo en base",
    "",
    ...databaseOnly.map((program) =>
      `- DATABASE_ONLY | ${csvSafe(program.databaseName)} | nivel DB ${program.level.join(",")} | IDs ${program.eligibleOfferIds.join(",")}`,
    ),
  ];
  writeFileSync(resolve(reportDir, "database-coverage.md"), markdown.join("\n") + "\n", "utf8");
  console.log(JSON.stringify(report.summary, null, 2));

}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
