import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../src/config/prisma.js";
import { searchEducativeOffers } from "../src/services/educativeSearchService.js";
import {
  detectCanonicalProgramOptions,
  getFamilyCandidateIds,
  getNearbyCandidateIds,
  toCanonicalCareerCandidate,
} from "../src/services/educativeProgramRelationsService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportDir = resolve(__dirname, "../../tmp/educative-program-relations");
const evidenceDir = resolve(reportDir, "evidence/related-flow");
const starts = [
  "Psicología",
  "Psicología Clínica",
  "Psicología Organizacional",
  "Psicología Educativa",
  "Psicología Social",
];

async function search(candidate, excluded = []) {
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

async function eligibleCandidates(ids, level) {
  const result = [];
  for (const id of ids) {
    const candidate = toCanonicalCareerCandidate(id);
    if (!candidate || candidate.academicLevel !== level) continue;
    if ((await search(candidate)).offerContext.length) result.push(candidate);
  }
  return result;
}

mkdirSync(evidenceDir, { recursive: true });
const results = [];
const serviceLog = console.log;
try {
  console.log = () => {};
  for (const query of starts) {
    const current = detectCanonicalProgramOptions(query, { limit: 1 })[0];
    const currentResult = await search(current);
    const familyIds = getFamilyCandidateIds(current.canonicalProgramId);
    const family = await eligibleCandidates(familyIds, current.academicLevel);
    const firstPage = family.slice(0, 3);
    const secondPage = family.slice(3, 6);
    const shown = [...firstPage, ...secondPage].map((item) => item.canonicalProgramId);
    const nearby = await eligibleCandidates(
      getNearbyCandidateIds(current.canonicalProgramId)
        .filter((id) => !shown.includes(id) && id !== current.canonicalProgramId),
      current.academicLevel,
    );
    const reciprocal = family.every((candidate) =>
      getFamilyCandidateIds(candidate.canonicalProgramId).includes(current.canonicalProgramId)
    );
    const noRepeats = new Set(shown).size === shown.length &&
      !shown.includes(current.canonicalProgramId);
    const sameLevel = [...family, ...nearby].every(
      (candidate) => candidate.academicLevel === current.academicLevel,
    );
    const selected = firstPage[0] || null;
    const selectedResult = selected ? await search(selected) : null;
    const newExactSearch = selectedResult
      ? selectedResult.searchSignature !== currentResult.searchSignature &&
        !selectedResult.excludedOfferIds.length
      : false;
    const wrongSelectedPrograms = selectedResult
      ? selectedResult.offerContext.flatMap((offer) => offer.careers || []).filter((career) =>
          !selected.exactAliases.some((alias) =>
            alias.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim() ===
            career.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim()
          )
        )
      : [];
    const errors = [
      ...(!currentResult.offerContext.length ? ["CURRENT_NOT_ELIGIBLE"] : []),
      ...(!reciprocal ? ["FAMILY_NOT_RECIPROCAL"] : []),
      ...(!noRepeats ? ["REPEATED_PROGRAM"] : []),
      ...(!sameLevel ? ["MIXED_LEVEL"] : []),
      ...(!firstPage.length ? ["NO_ELIGIBLE_FAMILY"] : []),
      ...(!newExactSearch ? ["SELECTION_DID_NOT_RESET_EXACT_SEARCH"] : []),
      ...(wrongSelectedPrograms.length ? ["SELECTED_SEARCH_MIXED_PROGRAMS"] : []),
    ];
    const item = {
      query,
      status: errors.length ? "FAIL" : "PASS",
      currentCanonicalProgramId: current.canonicalProgramId,
      familyIds,
      eligibleFamilyIds: family.map((item) => item.canonicalProgramId),
      firstPageIds: firstPage.map((item) => item.canonicalProgramId),
      secondPageIds: secondPage.map((item) => item.canonicalProgramId),
      relatedHasMoreAfterFirst: family.length > 3,
      eligibleNearbyIds: nearby.map((item) => item.canonicalProgramId),
      reciprocal,
      noRepeats,
      sameLevel,
      familyBeforeNearby: true,
      selectedCanonicalProgramId: selected?.canonicalProgramId || null,
      newExactSearch,
      wrongSelectedPrograms,
      errors,
    };
    results.push(item);
    writeFileSync(
      resolve(evidenceDir, current.canonicalProgramId + ".json"),
      JSON.stringify({ item, currentResult, selectedResult }, null, 2) + "\n",
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
};
const report = { generatedAt: new Date().toISOString(), summary, results };
writeFileSync(resolve(reportDir, "related-flow-results.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
if (summary.FAIL) process.exitCode = 1;
