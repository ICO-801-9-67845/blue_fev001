import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { extractVocationalEvidenceV2, rankFullVocationalCatalog, diversifyVocationalPresentation, nextBestVocationalQuestion, migrateVocationalProfileV2 } from "../src/services/vocationalRankingV2Service.js";
const relations=JSON.parse(readFileSync(new URL("../src/config/educativeProgramRelations.json",import.meta.url),"utf8"));
const at="2026-08-18T12:00:00.000Z",profile=(text,stage=null)=>({version:2,revision:1,currentAcademicStage:stage,signals:extractVocationalEvidenceV2(text,{revision:1,observedAt:at}),exclusions:[]}),names=(r,n=20)=>r.ordered.slice(0,n).map(x=>x.canonicalProgramId).join(" ");
let r=rankFullVocationalCatalog({vocationalProfile:profile("Me gustan mucho las matemáticas y programar.")});assert.equal(r.catalogProgramCount,462);assert.match(names(r),/matematic|software|comput|sistemas|ingenier/);
r=rankFullVocationalCatalog({vocationalProfile:profile("Me gusta la biología, los animales y trabajar en el campo.")});assert.match(names(r),/veterin|agron|biolog/);
r=rankFullVocationalCatalog({vocationalProfile:profile("Me gusta escuchar a la gente y ayudar, pero no quiero trabajar con sangre.")});assert.match(names(r),/psicolog|educa|social/);assert.ok(r.rejected.some(x=>x.score===-100));
r=rankFullVocationalCatalog({vocationalProfile:profile("Me encanta dibujar, diseñar y también construir cosas.")});assert.match(names(r),/arquitect|diseno|constru/);
r=rankFullVocationalCatalog({vocationalProfile:profile("Me gusta negociar, vender, organizar y dirigir equipos.")});assert.match(names(r),/administra|negocio|mercad/);
const mixed=profile("Me gustan las matemáticas pero se me dificultan.");assert.ok(mixed.signals.some(x=>x.conceptId==="mathematics"&&x.dimension==="interest"&&x.polarity==="positive"));assert.ok(mixed.signals.some(x=>x.conceptId==="mathematics"&&x.dimension==="ability"&&x.polarity==="negative"));
const correction=extractVocationalEvidenceV2("Antes me gustaba programar pero ya no.",{revision:2,observedAt:at});assert.ok(correction.some(x=>x.conceptId==="programming"&&x.polarity==="negative"&&x.source==="explicit_correction"));
const medicine="licenciatura_medico_cirujano";r=rankFullVocationalCatalog({vocationalProfile:profile(""),candidateSource:"explicit_user_request",explicitProgramId:medicine});assert.equal(r.ordered.find(x=>x.canonicalProgramId===medicine).classification,"accepted");
const rejected=profile("");rejected.exclusions=[{targetKind:"program",targetId:medicine,mode:"exact",source:"explicit_statement",updatedRevision:1,updatedAt:at}];r=rankFullVocationalCatalog({vocationalProfile:rejected});assert.equal(r.ordered.find(x=>x.canonicalProgramId===medicine).score,-100);
assert.equal(migrateVocationalProfileV2({version:1,revision:4,signals:[],exclusions:[]}).version,2);
for(const stage of ["secundaria","preparatoria","licenciatura","maestria"]){r=rankFullVocationalCatalog({vocationalProfile:profile("Me gusta aprender cosas nuevas",stage)});assert.equal(r.catalogProgramCount,462);}
r=rankFullVocationalCatalog({vocationalProfile:profile("Me gusta diseñar y construir")});assert.ok(diversifyVocationalPresentation(r.ordered).length<=5);nextBestVocationalQuestion(r.ordered,profile("Me gusta diseñar"));
const times=[];for(let i=0;i<100;i++){const start=performance.now();rankFullVocationalCatalog({vocationalProfile:profile("Me gustan matemáticas y programar")});times.push(performance.now()-start);}times.sort((a,b)=>a-b);console.log(JSON.stringify({tests:"PASS",iterations:100,p50Ms:+times[49].toFixed(3),p95Ms:+times[94].toFixed(3)}));
