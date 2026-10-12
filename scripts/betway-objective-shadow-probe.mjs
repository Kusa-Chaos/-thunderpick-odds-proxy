// Independent Betway objective markets: PUBLIC DATA QUALIFICATION ONLY.
// Nothing here publishes actionable odds, authenticates, bypasses a block,
// or changes any existing production betting source.
import fs from 'node:fs/promises';
const UA='Mozilla/5.0 (compatible; SportsMarketQualification/1.0)';
const BASE='https://betway.com';
const allowedPaths=['/g/en/sports/cat/esports'];
const targetLabels=/\b(?:first\s*blood|first\s*(?:dragon|baron|tower|turret|roshan|inhibitor|barracks)|total\s*(?:kills|dragons|barons|towers|roshans)|race\s*to\s*\d+\s*kills|map\s*\d+\s*total\s*kills)\b/i;
const safe=s=>String(s||'').replace(/[\x00-\x1f]/g,' ').slice(0,160);
export function inspectPublicMarkup(raw='',origin='category'){
 const t=String(raw||'').replace(/\\u0026/g,'&').replace(/\\\"/g,'"');
 const events=[];
 // Existing production Betway adapter's observed public page event shape.
 for(const m of t.matchAll(/"(\d+)":\{"id":\1,.*?"started":(true|false),.*?"name":"([^"]+)",.*?"subcategoryName":"([^"]+)",.*?"startsAt":"([^"]+)"/gs)){
  const sub=m[4],name=m[3];
  if(!/league of legends|\blol\b|dota\s*2|\bdota\b/i.test(sub+' '+name))continue;
  if(m[2]==='true'||!Number.isFinite(Date.parse(m[5])))continue;
  if(events.some(x=>x.id===m[1]))continue;
  events.push({id:m[1],name:safe(name),category:safe(sub),start:m[5]});
  if(events.length>=10)break;
 }
 const labels=new Map();
 for(const m of t.matchAll(/"marketCName":"([^"]+)"/g)){
  const label=safe(m[1].replace(/-/g,' '));
  if(!label)continue;
  labels.set(label,(labels.get(label)||0)+1);
 }
 const namedMarketObjects=[];
 for(const m of t.matchAll(/"name":\{"default":"([^"]{1,120})"\},"marketCName":"([^"]{1,120})","eventId":(\d+)/g)){
  const label=safe(m[1]);const cName=safe(m[2]);const id=m[3];
  if(!targetLabels.test(label+' '+cName))continue;
  const key=id+'|'+label+'|'+cName;
  if(namedMarketObjects.some(x=>x.key===key))continue;
  namedMarketObjects.push({key,eventId:id,label,marketCategory:cName});
  if(namedMarketObjects.length>=80)break;
 }
 return {origin,events,marketCategories:[...labels].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count).slice(0,75),
  objectiveMarketObjects:namedMarketObjects.map(({key,...v})=>v),
  objectiveCategoryHits:[...labels].filter(([name])=>targetLabels.test(name)).map(([name,count])=>({name,count})),
  bytes:t.length};
}
async function getPublic(path){
 if(!allowedPaths.includes(path)&&!/^\/g\/en\/sports\/event\/\d+$/.test(path))throw Error('UNAPPROVED_PATH');
 const url=BASE+path;
 const res=await fetch(url,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':UA},redirect:'follow',signal:AbortSignal.timeout(25000)});
 if(!res.ok)throw Object.assign(Error('PUBLIC_PAGE_UNAVAILABLE'),{name:'HTTP_'+res.status});
 if(!new URL(res.url).hostname.endsWith('betway.com'))throw Error('UNEXPECTED_REDIRECT');
 const content=await res.text();
 if(content.length>12000000)throw Error('OVERSIZED_RESPONSE');
 return content;
}
async function main(){
 const result={generatedAt:new Date().toISOString(),source:'betway',mode:'OBJECTIVE_QUALIFICATION_ONLY',
  productionEligible:false,independentBookmakerFamily:'betway',state:'INITIAL',requests:0,pages:{},errors:[],
  verifiedObjectiveQuoteCount:0, note:'Page-level market names alone are NOT valid live sportsbook prices'};
 try{
  const category=await getPublic(allowedPaths[0]);result.requests++;
  result.pages.category=inspectPublicMarkup(category,'category');
  const chosen=result.pages.category.events[0];
  if(chosen){
   try{
    const detail=await getPublic('/g/en/sports/event/'+chosen.id);result.requests++;
    result.pages.event=inspectPublicMarkup(detail,'event');
    result.pages.event.name=chosen.name;
   }catch(e){result.errors.push('event:'+safe(e?.name||e?.message));}
  }
  result.state=Object.values(result.pages).some(p=>p.objectiveMarketObjects?.length||p.objectiveCategoryHits?.length)?
   'OBJECTIVE_NAMES_DETECTED_UNPRICED':'NO_OBJECTIVE_MARKETS_VERIFIED';
 }catch(e){result.state='PUBLIC_PAGE_BLOCKED_OR_UNAVAILABLE';result.errors.push(safe(e?.name||e?.message));}
 await fs.mkdir('data',{recursive:true});
 await fs.writeFile('data/betway-objective-shadow-probe-latest.json',JSON.stringify(result,null,2));
 console.log('BETWAY_OBJECTIVE_QUALIFICATION',JSON.stringify({
  state:result.state,requests:result.requests,events:result.pages.category?.events?.length||0,
  objectiveCategories:result.pages.category?.objectiveCategoryHits||[],
  eventObjectiveCategories:result.pages.event?.objectiveCategoryHits||[],
  objectiveMarketObjectSamples:(result.pages.event?.objectiveMarketObjects||result.pages.category?.objectiveMarketObjects||[]).slice(0,18),
  eventSample:result.pages.event?.name||null,errors:result.errors,
  exactTwoSidedObjectivePrices:result.verifiedObjectiveQuoteCount,
  productionEligible:false
 }));
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)await main();
