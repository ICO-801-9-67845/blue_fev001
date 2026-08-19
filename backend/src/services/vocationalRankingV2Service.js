import { readFileSync } from "node:fs";

const profiles = JSON.parse(readFileSync(new URL("../config/vocationalProgramProfiles.json", import.meta.url), "utf8")).programs;
const relations = JSON.parse(readFileSync(new URL("../config/educativeProgramRelations.json", import.meta.url), "utf8")).programs;
const lexicon = JSON.parse(readFileSync(new URL("../config/vocationalConceptLexiconV2.json", import.meta.url), "utf8"));
const concepts = new Map(lexicon.concepts.map((c) => [c.id, c]));
const norm = (s) => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
const contains = (text, alias) => new RegExp(`(?:^|\\s)${norm(alias).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?:$|\\s)`).test(text);
const clamp = (n) => Math.max(-100,Math.min(100,Math.round(n*100)/100));
const recency = (distance) => distance<=8?1:distance<=20?.85:distance<=40?.7:.5;
const LEVELS = { secundaria:["bachillerato","tecnico_bachillerato"], preparatoria:["tsu","licenciatura","ingenieria"], tsu:["licenciatura","ingenieria"], licenciatura:["especialidad","maestria"], maestria:["doctorado"] };
const WEIGHTS = Object.freeze({ interestPositive:14, interestNegative:-22, abilityPositive:7, abilityNegative:-5, preferencePositive:10, preferenceNegative:-14, restrictionNegative:-28, riasec:18, stageImmediate:8, stagePathway:-4, explicitRequest:38, explicitSelection:44 });

export function migrateVocationalProfileV2(value) {
  const source = value && typeof value === "object" ? value : {};
  return { version:2, revision:Number.isInteger(source.revision)?source.revision:0, currentAcademicStage:source.currentAcademicStage||null, completedAcademicStage:source.completedAcademicStage||null, priorFields:Array.isArray(source.priorFields)?[...new Set(source.priorFields)]:[], signals:Array.isArray(source.signals)?source.signals.map(x=>({...x})):[], exclusions:Array.isArray(source.exclusions)?source.exclusions.map(x=>({...x})):[] };
}

export function extractAcademicStageV2(text) {
  const value=norm(text),completed=/\b(?:ya termine|termine|conclui|complete|egrese)\b/.test(value);
  const stage=/\b(?:secundaria|tercero de secundaria)\b/.test(value)?"secundaria":/\b(?:prepa|preparatoria|bachillerato)\b/.test(value)?"preparatoria":/\b(?:tsu|tecnico superior universitario)\b/.test(value)?"tsu":/\b(?:licenciatura|universidad)\b/.test(value)?"licenciatura":/\bmaestria\b/.test(value)?"maestria":/\bdoctorado\b/.test(value)?"doctorado":null;
  return stage ? (completed?{completedAcademicStage:stage}:{currentAcademicStage:stage}) : {};
}

export function extractVocationalEvidenceV2(text, { revision=1, observedAt=new Date().toISOString() }={}) {
  const clauses=norm(text).split(/\b(?:pero|aunque|mientras que|en cambio)\b|[.!?;]+/).map(x=>x.trim()).filter(Boolean),signals=[];let previousMatches=[];
  for(const clause of clauses){let matches=[];for(const concept of concepts.values())for(const alias of concept.aliases)if(contains(clause,alias)){matches.push({concept,alias});break;}if(!matches.length&&/se me dificulta|me cuesta|no soy buen|se me facilita|ya no/.test(clause))matches=previousMatches;
  for(const {concept,alias} of matches) {
    const position=Math.max(0,clause.indexOf(norm(alias))),local=clause.slice(Math.max(0,position-55),Math.min(clause.length,position+norm(alias).length+35));
    const correction=/antes me gust|ya no|no dije/.test(local),difficulty=/se me dificulta|me cuesta|no soy buen/.test(local),strength=/soy buen|se me facilita/.test(local),restriction=/no quiero trabajar|prefiero no trabajar|evitar.*(?:sangre|hospital|clinica)/.test(local),negative=/\bno (?:me gusta|me interesa|quiero)\b|ya no/.test(local),positive=!negative&&/me gusta|me encanta|disfruto|me interesa|quiero|atrae/.test(local);
    const base={conceptKind:concept.kind,conceptId:concept.id,intensity:/encanta|mucho/.test(local)?5:4,source:correction?"explicit_correction":"explicit_statement",updatedRevision:revision,updatedAt:observedAt};
    if(difficulty)signals.push({...base,dimension:"ability",polarity:"negative",intensity:3});else if(strength)signals.push({...base,dimension:"ability",polarity:"positive"});
    if(restriction)signals.push({...base,dimension:"restriction",polarity:"negative",intensity:5});else if(negative||positive)signals.push({...base,dimension:"interest",polarity:negative?"negative":"positive"});
  }if(matches.length)previousMatches=matches;}
  return [...new Map(signals.map(s=>[`${s.conceptId}|${s.dimension}`,s])).values()];
}

function userRiasec(signals) { const v={R:0,I:0,A:0,S:0,E:0,C:0}; for(const s of signals){if(!["interest","preference"].includes(s.dimension))continue;const sign=(s.polarity==="positive"?1:-1)*(s.dimension==="preference"?.7:1),c=s.conceptId;if(/mechan|construction|animal|agric|manual|repair|transport/.test(c))v.R+=sign;if(/math|stat|physics|chem|biology|research|data|comput|program/.test(c))v.I+=sign;if(/art|music|design|drawing|writing|creativ/.test(c))v.A+=sign;if(/teach|psych|listen|help|care|people|empathy/.test(c))v.S+=sign;if(/business|sales|negoti|leader|polit|public/.test(c))v.E+=sign;if(/account|finance|organization|office|precision|data/.test(c))v.C+=sign;}return v;}
function cosine(a,b){const keys=["R","I","A","S","E","C"], dot=keys.reduce((n,k)=>n+a[k]*b[k],0), x=Math.sqrt(keys.reduce((n,k)=>n+a[k]**2,0)), y=Math.sqrt(keys.reduce((n,k)=>n+b[k]**2,0)); return x&&y?dot/(x*y):0;}

export function rankFullVocationalCatalog({ vocationalProfile, currentRevision, candidateSource="profile_inference", explicitProgramId=null }={}) {
  const p=migrateVocationalProfileV2(vocationalProfile), revision=currentRevision??p.revision, u=userRiasec(p.signals), immediate=new Set(LEVELS[p.currentAcademicStage]||[]);
  const ordered=Object.keys(profiles).map(id=>{const profile=profiles[id], breakdown=[]; let score=0,pos=0,neg=0,blocked=false;
    if(explicitProgramId===id){const n=candidateSource==="explicit_user_selection"?WEIGHTS.explicitSelection:WEIGHTS.explicitRequest;score+=n;breakdown.push({code:candidateSource,value:n});}
    for(const e of p.exclusions) if(e.targetKind==="program"&&e.targetId===id&&e.mode==="exact") blocked=true;
    const weights={...profile.traitWeights.subjects,...profile.traitWeights.activities,...profile.traitWeights.abilities,...profile.traitWeights.workStyles,...profile.traitWeights.contexts};
    for(const s of p.signals){const affinity=weights[s.conceptId]||0;if(!affinity)continue;const key=`${s.dimension}${s.polarity[0].toUpperCase()+s.polarity.slice(1)}`;const base=WEIGHTS[key]||0,value=base*(s.intensity/3)*recency(revision-s.updatedRevision)*affinity;score+=value;(value>=0?pos++:neg++);breakdown.push({code:key,conceptId:s.conceptId,value:Math.round(value*100)/100});if(s.dimension==="restriction"&&s.polarity==="negative"&&affinity>=1)blocked=true;}
    const fit=Math.max(0,cosine(u,profile.riasec))*WEIGHTS.riasec; if(fit){score+=fit;breakdown.push({code:"riasec_fit",value:Math.round(fit*100)/100});}
    const stage=immediate.has(profile.academicLevel)?WEIGHTS.stageImmediate:(p.currentAcademicStage?WEIGHTS.stagePathway:0);score+=stage;if(stage)breakdown.push({code:stage>0?"academic_stage_match":"pathway_option",value:stage});
    score=blocked?-100:clamp(score);const explicit=explicitProgramId===id;return {canonicalProgramId:id,academicLevel:profile.academicLevel,classification:blocked?"rejected":explicit?"accepted":pos>=2&&score>=20?"accepted":pos>=1&&score>=8?"confirmation_required":"rejected",score,positiveEvidenceCount:pos,negativeEvidenceCount:neg,reasonCodes:[...new Set(breakdown.map(x=>x.code))],scoreBreakdown:breakdown,confidenceBand:profile.provenance.confidenceBand,family:profile.provenance.derivationMethod};
  }).sort((a,b)=>b.score-a.score||b.positiveEvidenceCount-a.positiveEvidenceCount||a.canonicalProgramId.localeCompare(b.canonicalProgramId));
  return {catalogProgramCount:ordered.length,accepted:ordered.filter(x=>x.classification==="accepted"),confirmationRequired:ordered.filter(x=>x.classification==="confirmation_required"),rejected:ordered.filter(x=>x.classification==="rejected"),ordered};
}

export function diversifyVocationalPresentation(ordered,{limit=5,maxScoreGap=12}={}){const eligible=ordered.filter(x=>x.classification!=="rejected"),out=[],families=new Set();for(const row of eligible){const family=row.family;if(out.length===0||(row.score>=out[0].score-maxScoreGap&&!families.has(family))||out.length>=Math.ceil(limit/2)){out.push(row);families.add(family);}if(out.length===limit)break;}return out;}
export function nextBestVocationalQuestion(ordered,profile){const top=ordered.filter(x=>x.classification!=="rejected").slice(0,5),known=new Set(migrateVocationalProfileV2(profile).signals.map(x=>x.conceptId));if(top.length<2||top[0].score-top[1].score>10)return null;const candidates=new Map();for(const row of top)for(const [id,w] of Object.entries({...profiles[row.canonicalProgramId].traitWeights.subjects,...profiles[row.canonicalProgramId].traitWeights.activities}))if(!known.has(id)){const a=candidates.get(id)||[];a.push(w);candidates.set(id,a);}const best=[...candidates].sort((a,b)=>(Math.max(...b[1])-Math.min(...b[1]))-(Math.max(...a[1])-Math.min(...a[1]))||a[0].localeCompare(b[0]))[0]?.[0];return best?`¿Qué tanto te interesa ${concepts.get(best)?.aliases[0]||best}?`:null;}
export function toCanonicalCareerV2(row){const p=relations[row.canonicalProgramId];return {canonicalProgramId:row.canonicalProgramId,name:p.displayName,normalizedName:p.canonicalName,level:p.level,academicLevel:p.level,searchQuery:p.displayName,familyId:p.familyId,exactAliases:[...p.exactAliases],vocationalBucket:row.classification,score:row.score};}
export { WEIGHTS as VOCATIONAL_V2_WEIGHTS };
