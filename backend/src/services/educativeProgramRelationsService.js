import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const relations = JSON.parse(
  readFileSync(join(__dirname, "../config/educativeProgramRelations.json"), "utf8")
    .replace(/^\uFEFF/, ""),
);

const programs = relations.programs || {};
const aliasIndex = new Map();
const DISCOVERY_STOP_WORDS = new Set([
  "QUIERO","QUISIERA","BUSCO","DAME","MUESTRAME","MOSTRAR","VER","ESTUDIAR","CURSAR","CONOCER",
  "CARRERA","CARRERAS","OPCION","OPCIONES","ALGO","RELACIONADO","RELACIONADOS","UNA","UN","DE","DEL","EN","CON",
  "LICENCIATURA","LICENCIATURAS","INGENIERIA","INGENIERIAS","MAESTRIA","MAESTRIAS","MASTER",
  "DOCTORADO","DOCTORADOS","ESPECIALIDAD","ESPECIALIDADES","TSU","BACHILLERATO","BACHILLERATOS","PREPA","PREPARATORIA"
]);
const AMBIGUOUS_DISCOVERY_TERMS = new Set(["ADMINISTRACION"]);

export function normalizeProgramText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getStateLevelForAcademicLevel(level) {
  if (["bachillerato", "tecnico_bachillerato"].includes(level)) return "prepa";
  if (level === "tsu") return "tsu";
  if (["licenciatura", "ingenieria"].includes(level)) return "undergraduate";
  return "posgrado";
}

export function getStudyTypeForAcademicLevel(level) {
  if (["bachillerato", "tecnico_bachillerato"].includes(level)) return "prepa";
  if (level === "tsu") return "tsu";
  if (["licenciatura", "ingenieria"].includes(level)) return "undergraduate";
  if (level === "especialidad") return "especialidad";
  if (level === "maestria") return "maestria";
  if (level === "doctorado") return "doctorado";
  return null;
}

for (const [programId, program] of Object.entries(programs)) {
  const aliases = [
    ...(program.exactAliases || []).map((alias) => ({ alias, inputOnly: false })),
    ...(program.inputAliases || []).map((alias) => ({ alias, inputOnly: true })),
  ];
  for (const { alias, inputOnly } of aliases) {
    const normalized = normalizeProgramText(alias);
    const entries = aliasIndex.get(normalized) || [];
    if (!entries.some((entry) => entry.programId === programId)) {
      entries.push({ programId, program, alias, normalized, inputOnly });
      aliasIndex.set(normalized, entries);
    }
  }
}

export function requestedAcademicLevelForText(text) {
  const normalized = normalizeProgramText(text);
  if (/\b(BACHILLERATO|PREPA|PREPARATORIA|MEDIA SUPERIOR)\b/.test(normalized)) {
    return "bachillerato";
  }
  if (/\b(TSU|T S U|TECNICO SUPERIOR UNIVERSITARIO)\b/.test(normalized)) return "tsu";
  if (/\bESPECIALIDAD(?:ES)?\b/.test(normalized)) return "especialidad";
  if (/\b(MAESTRIA(?:S)?|MASTER)\b/.test(normalized)) return "maestria";
  if (/\bDOCTORADO(?:S)?\b/.test(normalized)) return "doctorado";
  if (/\bINGENIERIA(?:S)?\b/.test(normalized)) return "ingenieria";
  if (/\bLICENCIATURA(?:S)?\b/.test(normalized)) return "licenciatura";
  return null;
}

function academicLevelsForText(text) {
  const requested = requestedAcademicLevelForText(text);
  if (requested === "bachillerato") return new Set(["bachillerato", "tecnico_bachillerato"]);
  if (requested) return new Set([requested]);
  return new Set(["licenciatura", "ingenieria"]);
}

function discoveryCore(value) {
  return normalizeProgramText(value).split(" ").filter((token) => token.length > 1 && !DISCOVERY_STOP_WORDS.has(token)).join(" ");
}
function bigrams(value) {
  const compact=value.replace(/\s+/g," "),out=[];
  for(let index=0;index<compact.length-1;index+=1)out.push(compact.slice(index,index+2));
  return out;
}
function dice(left,right) {
  const a=bigrams(left),b=bigrams(right);if(!a.length||!b.length)return left===right?1:0;
  const counts=new Map();for(const item of a)counts.set(item,(counts.get(item)||0)+1);let overlap=0;
  for(const item of b){const count=counts.get(item)||0;if(count){overlap+=1;counts.set(item,count-1);}}
  return 2*overlap/(a.length+b.length);
}
function tokenCoverage(query,candidate){const queryTokens=[...new Set(query.split(" ").filter(Boolean))],candidateTokens=new Set(candidate.split(" ").filter(Boolean));return queryTokens.length?queryTokens.filter(token=>candidateTokens.has(token)).length/queryTokens.length:0;}

export function resolveFlexibleCanonicalPrograms(text,{academicLevel=null,limit=5}={}){
  const query=discoveryCore(text);if(query.length<4)return {status:"low_confidence",query,candidates:[]};
  const allowed=academicLevel?new Set([academicLevel]):academicLevelsForText(text),byProgram=new Map();
  for(const [normalizedAlias,entries] of aliasIndex){const candidateCore=discoveryCore(normalizedAlias);if(candidateCore.length<3)continue;const coverage=tokenCoverage(query,candidateCore),similarity=dice(query,candidateCore),score=Math.round(Math.max(coverage*.55+similarity*.45,similarity*.85)*10000)/10000;for(const entry of entries){if(!allowed.has(entry.program.level))continue;const current=byProgram.get(entry.programId);if(!current||score>current.score)byProgram.set(entry.programId,{entry,score,coverage,similarity});}}
  const ranked=[...byProgram.values()].filter(item=>item.score>=.52).sort((a,b)=>b.score-a.score||b.coverage-a.coverage||a.entry.programId.localeCompare(b.entry.programId));
  if(!ranked.length)return {status:"low_confidence",query,candidates:[]};const margin=ranked[1]?ranked[0].score-ranked[1].score:1;
  const status=ranked[0].score>=.65&&margin>=.08&&!AMBIGUOUS_DISCOVERY_TERMS.has(query)?"high_confidence":"ambiguous";
  const selected=status==="high_confidence"?ranked.slice(0,1):ranked.filter(item=>item.score>=ranked[0].score-.12).slice(0,limit);
  return {status,query,topScore:ranked[0].score,margin:Math.round(margin*10000)/10000,algorithm:"token_coverage_0.55_plus_dice_bigrams_0.45",candidates:selected.map(item=>({...toCareerCandidate(item.entry.programId,item.entry.program,item.entry.alias),discoveryScore:item.score}))};
}

function containsAt(normalizedText, normalizedAlias, start) {
  const before = start === 0 ? " " : normalizedText[start - 1];
  const end = start + normalizedAlias.length;
  const after = end >= normalizedText.length ? " " : normalizedText[end];
  return before === " " && after === " ";
}

function toCareerCandidate(programId, program, matchedAlias) {
  return {
    name: program.displayName,
    normalizedName: normalizeProgramText(program.displayName),
    level: getStateLevelForAcademicLevel(program.level),
    academicLevel: program.level,
    searchQuery: program.canonicalName,
    canonicalProgramId: programId,
    familyId: program.familyId || null,
    exactAliases: [...program.exactAliases],
    matchedAlias,
  };
}

export function getEducativeProgramRelations() {
  return relations;
}

export function getCanonicalProgram(programId) {
  const program = programs[programId];
  return program ? { id: programId, ...program } : null;
}

export function getProgramFamily(familyId) {
  const family = relations.families?.[familyId];
  return family ? { id: familyId, ...family } : null;
}

export function resolveCanonicalProgram(alias, academicLevel = null) {
  const entries = aliasIndex.get(normalizeProgramText(alias)) || [];
  const filtered = academicLevel
    ? entries.filter((entry) => entry.program.level === academicLevel)
    : entries;
  if (filtered.length !== 1) return null;
  const entry = filtered[0];
  return toCareerCandidate(entry.programId, entry.program, entry.alias);
}

export function detectCanonicalProgramOptions(text, { limit = 3 } = {}) {
  const normalizedText = normalizeProgramText(text);
  if (!normalizedText) return [];

  const allowedLevels = academicLevelsForText(text);
  const queryCore = normalizedText.replace(
    /^(?:QUIERO ESTUDIAR|ME INTERESA ESTUDIAR|BUSCO ESTUDIAR|QUIERO VER OPCIONES DE|OPCIONES DE)\s+/,
    "",
  );
  const allowsPrefixExpansion =
    queryCore.length >= 10 &&
    /\b(BACHILLERATO|PREPA|TSU|TECNICO SUPERIOR UNIVERSITARIO)\b/.test(queryCore);
  const matches = [];
  for (const [normalizedAlias, entries] of aliasIndex) {
    if (normalizedAlias.length < 4) continue;
    if (
      allowsPrefixExpansion &&
      normalizedAlias.startsWith(queryCore + " ")
    ) {
      for (const entry of entries) {
        if (allowedLevels.has(entry.program.level)) {
          matches.push({
            ...entry,
            start: 0,
            end: queryCore.length,
            length: queryCore.length,
            prefixExpanded: true,
          });
        }
      }
    }
    let start = normalizedText.indexOf(normalizedAlias);
    while (start !== -1) {
      if (containsAt(normalizedText, normalizedAlias, start)) {
        for (const entry of entries) {
          if (allowedLevels.has(entry.program.level)) {
            matches.push({
              ...entry,
              start,
              end: start + normalizedAlias.length,
              length: normalizedAlias.length,
            });
          }
        }
      }
      start = normalizedText.indexOf(normalizedAlias, start + 1);
    }
  }
  const directMatches = matches.filter((match) => !match.prefixExpanded);
  if (!directMatches.length && matches.some((match) => match.prefixExpanded)) {
    const byId = new Map();
    for (const match of matches) {
      if (!byId.has(match.programId)) byId.set(match.programId, match);
    }
    return [...byId.values()]
      .sort((left, right) =>
        left.program.canonicalName.localeCompare(right.program.canonicalName, "es")
      )
      .slice(0, limit)
      .map((match) => toCareerCandidate(match.programId, match.program, match.alias));
  }

  matches.sort((left, right) =>
    right.length - left.length ||
    left.start - right.start ||
    left.programId.localeCompare(right.programId),
  );

  const occupied = [];
  const selected = [];
  const selectedIds = new Set();
  for (const match of matches) {
    if (selectedIds.has(match.programId)) continue;
    const overlaps = occupied.some(([start, end]) =>
      match.start < end && match.end > start,
    );
    if (overlaps) continue;
    selected.push(toCareerCandidate(match.programId, match.program, match.alias));
    selectedIds.add(match.programId);
    occupied.push([match.start, match.end]);
    if (selected.length === limit) break;
  }

  return selected;
}

export function getCanonicalProgramsByLevel(level){return Object.entries(programs).filter(([,program])=>program.level===level).sort(([left],[right])=>left.localeCompare(right)).map(([programId,program])=>toCareerCandidate(programId,program,program.canonicalName));}

export function getFamilyCandidateIds(programId) {
  const program = programs[programId];
  if (!program?.familyId) return [];
  return (relations.families?.[program.familyId]?.memberProgramIds || [])
    .filter((memberId) => memberId !== programId);
}

export function getNearbyCandidateIds(programId) {
  return [...(programs[programId]?.nearbyProgramIds || [])];
}

export function toCanonicalCareerCandidate(programId) {
  const program = programs[programId];
  return program ? toCareerCandidate(programId, program, program.canonicalName) : null;
}
