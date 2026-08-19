import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../src/config/prisma.js";
import { searchEducativeOffers } from "../src/services/educativeSearchService.js";
import {
  detectCanonicalProgramOptions,
  normalizeProgramText,
} from "../src/services/educativeProgramRelationsService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportDir = resolve(__dirname, "../../tmp/educative-program-relations");
const evidenceDir = resolve(reportDir, "evidence/exact-search");
const cases = [
  "Psicología",
  "Psicología Clínica",
  "Psicología Organizacional",
  "Psicología Educativa",
  "Psicología Social",
  "Contaduría",
  "Contaduría Pública",
  "Contador Público",
  "Ingeniería en Computación",
  "Ingeniería en Sistemas Computacionales",
  "Tecnologías de la Información",
  "Ingeniería en Mecatrónica",
  "TSU en Mecatrónica área Automatización",
  "Arquitectura",
  "Ingeniero Arquitecto",
  "Pedagogía",
  "Ciencias de la Educación",
  "Derecho",
  "Criminología",
  "Criminología y Criminalística",
  "Administración",
  "Administración Agropecuaria",
  "Agronegocios",
  "Nutrición",
  "Enfermería",
  "Fisioterapia",
  "Diseño Gráfico",
  "Diseño Gráfico Digital",
  "Bachillerato General",
  "Contabilidad de bachillerato",
  "Programación de bachillerato",
  "Especialidad en Diseño Digital",
  "Maestría en Administración",
  "Doctorado en Psicología",
];

function expectedOfferLevel(level) {
  return ["bachillerato", "tecnico_bachillerato"].includes(level) ? "1" : "2";
}

async function exactSearch(candidate, excluded = []) {
  return searchEducativeOffers({
    prisma,
    message: candidate.searchQuery,
    canonicalProgramId: candidate.canonicalProgramId,
    exactAliases: candidate.exactAliases,
    academicLevel: candidate.academicLevel,
    excludeShownIds: excluded,
    limit: 3,
  });
}

mkdirSync(evidenceDir, { recursive: true });
const results = [];
const serviceLog = console.log;
try {
  console.log = () => {};
  for (const query of cases) {
    const candidate = detectCanonicalProgramOptions(query, { limit: 1 })[0] || null;
    if (!candidate) {
      results.push({ query, status: "FAIL", reason: "NO_CANONICAL_MATCH" });
      continue;
    }

    const first = await exactSearch(candidate);
    const firstIds = first.offerContext.map((offer) => String(offer.id));
    const second = first.remainingCount > 0 ? await exactSearch(candidate, firstIds) : null;
    const secondIds = second?.offerContext.map((offer) => String(offer.id)) || [];
    const allowed = new Set(candidate.exactAliases.map(normalizeProgramText));
    const returnedCareers = [
      ...first.offerContext.flatMap((offer) => offer.careers || []),
      ...(second?.offerContext || []).flatMap((offer) => offer.careers || []),
    ];
    const wrongPrograms = returnedCareers.filter((career) => !allowed.has(normalizeProgramText(career)));
    const duplicateIds = firstIds.filter((id) => secondIds.includes(id));
    const invalidOffers = [...first.offerContext, ...(second?.offerContext || [])].filter((offer) =>
      !offer.redirect_url ||
      String(offer.level) !== expectedOfferLevel(candidate.academicLevel)
    );
    const repeat = await exactSearch(candidate);
    const stableRanking = JSON.stringify(firstIds) ===
      JSON.stringify(repeat.offerContext.map((offer) => String(offer.id)));
    const status = !firstIds.length
      ? "EXPECTED_DATA_GAP"
      : wrongPrograms.length || duplicateIds.length || invalidOffers.length || !stableRanking
        ? "FAIL"
        : "PASS";
    const item = {
      query,
      status,
      canonicalProgramId: candidate.canonicalProgramId,
      academicLevel: candidate.academicLevel,
      exactAliases: candidate.exactAliases,
      firstOfferIds: firstIds,
      secondOfferIds: secondIds,
      remainingAfterFirst: first.remainingCount,
      wrongPrograms,
      duplicateIds,
      invalidOfferIds: invalidOffers.map((offer) => String(offer.id)),
      stableRanking,
      firstSearchSignature: first.searchSignature,
      secondSearchSignature: second?.searchSignature || null,
    };
    results.push(item);
    writeFileSync(
      resolve(evidenceDir, candidate.canonicalProgramId + ".json"),
      JSON.stringify({ candidate, first, second }, null, 2) + "\n",
    );
  }
} finally {
  console.log = serviceLog;
  await prisma.$disconnect();
}

const summary = {
  total: results.length,
  PASS: results.filter((item) => item.status === "PASS").length,
  FAIL: results.filter((item) => item.status === "FAIL").length,
  EXPECTED_DATA_GAP: results.filter((item) => item.status === "EXPECTED_DATA_GAP").length,
};
mkdirSync(evidenceDir, { recursive: true });
const report = { generatedAt: new Date().toISOString(), summary, results };
writeFileSync(resolve(reportDir, "exact-search-results.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
if (summary.FAIL) process.exitCode = 1;
