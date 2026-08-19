import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../src/config/", import.meta.url);
const relations = JSON.parse(readFileSync(new URL("educativeProgramRelations.json", root), "utf8"));
const lexicon = JSON.parse(readFileSync(new URL("vocationalConceptLexiconV2.json", root), "utf8"));

const FAMILIES = [
  { id: "computing", cmpe: "06", isced: "06", words: /comput|software|informatic|datos|sistemas|digital|ciber|redes/, traits: ["computing","programming","data","technology","mathematics"], riasec: [0.35,0.9,0.2,0.2,0.25,0.65] },
  { id: "engineering", cmpe: "07", isced: "07", words: /ingenier|mecatron|electron|mecanic|manufactur|industrial|automotriz|mantenimiento|robot|energia/, traits: ["mathematics","physics","electronics","mechanics","manufacturing","technology"], riasec: [0.8,0.8,0.2,0.15,0.35,0.45] },
  { id: "construction_design", cmpe: "07", isced: "07", words: /arquitect|constru|obra|urban|diseno.*espacio|civil/, traits: ["construction","architecture","design","drawing","creativity","precision"], riasec: [0.65,0.55,0.75,0.2,0.35,0.35] },
  { id: "health", cmpe: "09", isced: "09", words: /medicin|enfermer|salud|odont|nutric|fisioter|terapia|farmac|optometr|biomed/, traits: ["biology","chemistry","health","care","helping","hospital_clinic"], riasec: [0.25,0.8,0.15,0.8,0.2,0.45], contexts:["blood_environment"] },
  { id: "life_agriculture", cmpe: "05", isced: "05", words: /biolog|veterin|agron|agric|ambient|ecolog|animal|forest|alimentos|biotecn/, traits: ["biology","chemistry","animals","agriculture","environment","field_outdoors","research"], riasec: [0.7,0.85,0.15,0.35,0.2,0.3] },
  { id: "business", cmpe: "04", isced: "04", words: /administra|negocio|mercad|contab|finanz|comerc|ventas|capital humano|gestion|econom|emprend/, traits: ["business","administration","accounting","finance","sales","negotiation","leadership","organization"], riasec: [0.15,0.35,0.15,0.45,0.9,0.75] },
  { id: "social_education", cmpe: "01", isced: "01", words: /educa|pedagog|docen|ensen|psicolog|trabajo social|sociolog|orientacion/, traits: ["teaching","psychology","human_behavior","listening","helping","people_work","communication"], riasec: [0.1,0.55,0.35,0.95,0.35,0.3] },
  { id: "law_politics", cmpe: "03", isced: "03", words: /derecho|jurid|politic|gobierno|crimin|seguridad|relaciones internacionales/, traits: ["law","politics","communication","negotiation","public_speaking","research"], riasec: [0.15,0.55,0.25,0.55,0.8,0.5] },
  { id: "arts_humanities", cmpe: "02", isced: "02", words: /arte|musica|diseno|comunicacion|idioma|lengua|liter|historia|filosof|animacion|cine|moda/, traits: ["art","music","design","drawing","writing","languages","communication","creativity"], riasec: [0.15,0.35,0.95,0.45,0.35,0.2] },
  { id: "science_math", cmpe: "05", isced: "05", words: /matematic|estadistic|fisic|quimic|ciencia|investig/, traits: ["mathematics","statistics","physics","chemistry","research","experimentation","data"], riasec: [0.2,0.98,0.25,0.2,0.15,0.55] },
  { id: "services", cmpe: "10", isced: "10", words: /turis|gastronom|hotel|deporte|logistic|transporte|proteccion|seguridad/, traits: ["tourism","gastronomy","logistics","transport","people_work","organization"], riasec: [0.55,0.25,0.35,0.7,0.65,0.5] },
];
const DEFAULT = { id:"general", cmpe:"00", isced:"00", traits:["communication","organization","learning_variety"], riasec:[0.35,0.45,0.35,0.45,0.4,0.45] };
const conceptIds = new Set(lexicon.concepts.map((c) => c.id));
const normalize = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const profiles = {};
for (const id of Object.keys(relations.programs).sort()) {
  const program = relations.programs[id];
  const text = normalize(`${program.canonicalName} ${id}`);
  const family = FAMILIES.find((item) => item.words.test(text)) || DEFAULT;
  const traitWeights = Object.fromEntries(family.traits.filter((x) => conceptIds.has(x)).map((x, i) => [x, i < 3 ? 1 : 0.65]));
  profiles[id] = {
    canonicalProgramId:id, academicLevel:program.level,
    classification:{ cmpe2016:{ fieldCode:family.cmpe, mappingLevel:"broad_field" }, iscedF2013:{ fieldCode:family.isced, mappingLevel:"broad_field" } },
    riasec:Object.fromEntries(["R","I","A","S","E","C"].map((key,i)=>[key,family.riasec[i]])),
    traitWeights:{ subjects:traitWeights, activities:traitWeights, abilities:traitWeights, workStyles:traitWeights, contexts:Object.fromEntries((family.contexts||[]).map(x=>[x,1])) },
    occupationalMappings:[],
    provenance:{ source:"Blue field/family mapping using canonical program identity", sourceVersion:"CMPE 2016; ISCED-F 2013; O*NET 30.3 Content Model", derivationMethod:`deterministic_${family.id}_field_fallback`, confidenceBand:family===DEFAULT?"low":"medium", reviewStatus:"generated_requires_program_review" }
  };
}
const output = { schemaVersion:2, sourceCatalogVersion:relations.version, sourceVersions:{ cmpe:"2016", iscedF:"2013", onet:"30.3" }, programs:profiles };
writeFileSync(new URL("vocationalProgramProfiles.json", root), `${JSON.stringify(output,null,2)}\n`, "utf8");
console.log(`Generated ${Object.keys(profiles).length} deterministic profiles.`);
