import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sourceDirectory = resolve(process.argv[2] || "tmp/onet-30.3-source/csv");
const target = new URL("../src/config/onetVocationalSnapshot.json", import.meta.url);
const OCCUPATIONS = [
  "11-1021.00","11-2021.00","11-3031.00","11-3071.00","11-9013.00",
  "13-1081.00","13-2011.00","15-1252.00","17-1011.00","17-2021.00",
  "17-2031.00","17-2051.00","19-3011.00","19-3033.00","19-4012.00",
  "23-1011.00","27-3023.00","29-1031.00","29-1131.00","35-1011.00",
  "41-3041.00"
];
const FILES = {
  interests:"career_interest_types.csv", knowledge:"knowledge.csv", abilities:"abilities.csv",
  skills:"essential_skills.csv", workStyles:"work_styles.csv", activities:"work_activities.csv",
  contexts:"work_context.csv", occupations:"occupation_data.csv",
};
function parseCsv(raw){const rows=[];let row=[],field="",quoted=false;for(let i=0;i<raw.length;i++){const c=raw[i];if(c==='"'){if(quoted&&raw[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field="";}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&raw[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field="";}else field+=c;}if(field||row.length){row.push(field);rows.push(row);}const [head,...data]=rows;return data.map(values=>Object.fromEntries(head.map((key,index)=>[key,values[index]||""])));}
const bytes={},tables={};for(const [key,file] of Object.entries(FILES)){const raw=readFileSync(resolve(sourceDirectory,file));bytes[file]=createHash("sha256").update(raw).digest("hex");tables[key]=parseCsv(raw.toString("utf8").replace(/^\uFEFF/,""));}
const wanted=new Set(OCCUPATIONS),titles=new Map(tables.occupations.filter(x=>wanted.has(x["O*NET-SOC Code"])).map(x=>[x["O*NET-SOC Code"],x.Title]));
const dimensions={interests:"OI",knowledge:"IM",abilities:"IM",skills:"IM",workStyles:"WI",activities:"IM",contexts:"CX"};
const profiles={};for(const code of OCCUPATIONS){const profile={onetSocCode:code,title:titles.get(code),riasec:{},knowledge:[],abilities:[],skills:[],activities:[],contexts:[],workStyles:[]};for(const [dimension,scale] of Object.entries(dimensions)){const rows=tables[dimension].filter(x=>x["O*NET-SOC Code"]===code&&x["Scale ID"]===scale).map(x=>({elementId:x["Element ID"],name:x["Element Name"],value:Number(x["Data Value"]),date:x.Date,domainSource:x["Domain Source"]})).filter(x=>Number.isFinite(x.value)).sort((a,b)=>b.value-a.value||a.elementId.localeCompare(b.elementId));if(dimension==="interests")for(const row of rows)profile.riasec[row.name[0]]=Math.round((row.value/7)*10000)/10000;else profile[dimension]=rows.slice(0,8);}profiles[code]=profile;}
const output={version:1,source:{name:"O*NET Database",version:"30.3",license:"CC BY 4.0",downloadUrl:"https://www.onetcenter.org/database.html",zipSha256:"78703906d5eb92faaa3d912164bbee7706658d85630143d9716df040f9a9f6aa",fileSha256:bytes},occupations:profiles};
writeFileSync(target,`${JSON.stringify(output,null,2)}\n`,`utf8`);console.log(`Built compact O*NET snapshot for ${OCCUPATIONS.length} occupations.`);
