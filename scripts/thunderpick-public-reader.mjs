import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const READER='https://r.jina.ai/';
const NFL_PAGE='https://thunderpick.io/sports/american-football/us/nfl/389';
const SPORT='american-football';
const GAME_ID=18;
const NFL_COMPETITION_ID=389;
const nowIso=()=>new Date().toISOString();
const sha=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const readJson=async(p,fallback={})=>{try{return JSON.parse(await fs.readFile(p,'utf8'));}catch{return fallback;}};
const isNflEvent=e=>{
  const compId=Number(e?.competition?.id);
  const comp=String(e?.competition?.name||e?.competition?.shortName||'');
  return compId===NFL_COMPETITION_ID||/\bnfl\b/i.test(comp);
};
const propLike=name=>/\bplayer\b|passing|rushing|receiving|receptions?|touchdowns?|attempts?|completions?|interceptions?/i.test(String(name||''));

async function fetchText(url){
  const r=await fetch(READER+url,{headers:{accept:'text/plain','user-agent':'Mozilla/5.0 ThunderpickCloudCollector/1.0'}});
  const text=await r.text();
  if(!r.ok) throw new Error(`reader HTTP ${r.status} for ${url}`);
  return text;
}
function parseReaderJson(text,url){
  const marker='Markdown Content:';
  const i=text.indexOf(marker);
  if(i<0) throw new Error(`reader JSON marker missing for ${url}`);
  let raw=text.slice(i+marker.length).trim();
  const first=raw.indexOf('{');
  if(first<0) throw new Error(`reader JSON body missing for ${url}`);
  raw=raw.slice(first);
  try{return JSON.parse(raw);}catch(e){throw new Error(`reader JSON parse failed for ${url}: ${e.message}`);}
}
function extractNflMatchUrls(markdown){
  const re=/https:\/\/thunderpick\.io\/sports\/american-football\/(?:us\/)?nfl\/389\/[a-z0-9-]+\/(\d+)/gi;
  const seen=new Map(); let m;
  while((m=re.exec(markdown))){seen.set(String(m[1]),m[0]);}
  return [...seen.entries()].map(([id,url])=>({id,url,via:'nfl-page'}));
}
function knownNflIds(snapshot){
  const rows=snapshot?.sports?.[SPORT]?.data?.data;
  if(!Array.isArray(rows)) return [];
  const now=Date.now()-5*60e3;
  const out=[];
  for(const e of rows){
    const id=e?.id;
    const start=Date.parse(e?.startTime||'');
    if(!id || e?.isLive===true || (Number.isFinite(start)&&start<=now)) continue;
    if(isNflEvent(e)) out.push({id:String(id),url:null,via:'existing-snapshot'});
  }
  return out;
}
async function fetchMatch(id){
  const metaUrl=`https://thunderpick.io/api/matches?matchesIds=${encodeURIComponent(id)}`;
  const marketsUrl=`https://thunderpick.io/api/markets/${encodeURIComponent(id)}`;
  const [metaText,marketText]=await Promise.all([fetchText(metaUrl),fetchText(marketsUrl)]);
  const metaBody=parseReaderJson(metaText,metaUrl);
  const marketBody=parseReaderJson(marketText,marketsUrl);
  if(metaBody?.statusCode!==200||metaBody?.ok!==true) throw new Error(`metadata not OK for ${id}`);
  if(marketBody?.statusCode!==200||marketBody?.ok!==true) throw new Error(`markets not OK for ${id}`);
  const event=metaBody?.data?.matches?.[0] ?? (metaBody?.data?.id?metaBody.data:null);
  const markets=marketBody?.data;
  if(!event||String(event.id)!==String(id)||!Array.isArray(markets)||!markets.length) throw new Error(`incomplete first-party payload for ${id}`);
  const fetchedAt=nowIso();
  return {...event,preferredMarkets:markets,deepMarketsFetchedAt:fetchedAt,deepMarketsFresh:true};
}

await fs.mkdir('data',{recursive:true});
const snapshot=await readJson('data/owls-latest.json',{generatedAt:null,source:null,format:null,sports:{}});
const meta=await readJson('data/owls-meta.json',{generatedAt:null,source:null,format:null,sports:{}});
const fetchedAt=nowIso();
const priorSport=snapshot?.sports?.[SPORT]||{};
const priorRows=Array.isArray(priorSport?.data?.data)?priorSport.data.data:[];
const nonNflRows=priorRows.filter(e=>!isNflEvent(e));

let pageText='';
try{pageText=await fetchText(NFL_PAGE);}catch(e){console.error('THUNDERPICK_PUBLIC_READER_DISCOVERY_FAILED',e.message);}
const pageDiscovered=pageText?extractNflMatchUrls(pageText):[];
const existing=knownNflIds(snapshot);
const union=new Map();
for(const x of [...existing,...pageDiscovered]) union.set(String(x.id),union.has(String(x.id))?{...union.get(String(x.id)),...x}:x);
const discovered=[...union.values()];
if(!discovered.length){console.error('THUNDERPICK_PUBLIC_READER_NO_NFL_MATCHES');process.exit(2);}

const nflEvents=[];const errors=[];
for(const item of discovered){
  try{
    const e=await fetchMatch(item.id);
    const start=Date.parse(e.startTime||'');
    if(e.gameId===GAME_ID && isNflEvent(e) && e.isLive!==true && (!Number.isFinite(start)||start>Date.now()-5*60e3)) nflEvents.push(e);
  }catch(err){errors.push({id:item.id,via:item.via,error:String(err?.message||err)});}
}
if(!nflEvents.length){console.error('THUNDERPICK_PUBLIC_READER_ZERO_VALID_EVENTS',JSON.stringify({discovered:discovered.length,errors}));process.exit(2);}

const mergedById=new Map();
for(const e of nonNflRows) if(e?.id!=null) mergedById.set(String(e.id),e);
for(const e of nflEvents) if(e?.id!=null) mergedById.set(String(e.id),e);
const events=[...mergedById.values()].sort((a,b)=>Date.parse(a?.startTime||0)-Date.parse(b?.startTime||0));
const retainedMarketCount=events.reduce((n,e)=>n+(Array.isArray(e.preferredMarkets)?e.preferredMarkets.length:0)+(e.market?1:0),0);
const playerPropLikeMarkets=events.reduce((n,e)=>n+(e.preferredMarkets||[]).filter(m=>propLike(m?.name)).length,0);
const deepMarkets=events.reduce((n,e)=>n+(e?.deepMarketsFresh===true&&Array.isArray(e?.preferredMarkets)?e.preferredMarkets.length:0),0);
const baseMeta=meta?.sports?.[SPORT]||{};
const sportRecord={
  ok:true,httpOk:true,status:200,fetchedAt,gameId:GAME_ID,eventCount:events.length,retainedMarketCount,
  deepEligibleEvents:baseMeta.deepEligibleEvents??null,
  deepSelectedEvents:baseMeta.deepSelectedEvents??null,
  deepSkippedByCap:baseMeta.deepSkippedByCap??null,
  deepMarketRequests:(baseMeta.deepMarketRequests||0)+discovered.length,
  deepMarketSuccess:(baseMeta.deepMarketSuccess||0)+nflEvents.length,
  deepMarketFailures:(baseMeta.deepMarketFailures||0)+errors.length,
  deep429s:baseMeta.deep429s||0,
  deepMarkets,playerPropLikeMarkets,
  hash:sha(events),changedSincePrevious:null,coverageStatus:'fresh-first-party-plus-public-reader',usedFallback:false,error:null,
  source:'Thunderpick first-party browser plus NFL metadata/markets via free public reader',data:{data:events}
};
snapshot.generatedAt=fetchedAt;
snapshot.source='Thunderpick first-party API with free public reader NFL refresh';
snapshot.format='first-party-browser-v3-plus-public-reader-nfl-merge';
snapshot.sports={...(snapshot.sports||{}),[SPORT]:sportRecord};
meta.generatedAt=fetchedAt;
meta.source='Thunderpick first-party API with free public reader NFL refresh';
meta.format='first-party-browser-v3-plus-public-reader-nfl-merge';
meta.quotaExhausted=false;
meta.quotaResetMonth=null;
meta.sports={...(meta.sports||{}),[SPORT]:{...sportRecord,data:undefined}};
meta.successfulSports=[...new Set([...(meta.successfulSports||[]).filter(x=>x!==SPORT),SPORT])];
meta.failedSports=(meta.failedSports||[]).filter(x=>x!==SPORT);
meta.coverageAnomalies=(meta.coverageAnomalies||[]).filter(x=>x?.sport!==SPORT);
meta.totalEvents=Object.values(snapshot.sports||{}).reduce((n,s)=>n+(s?.eventCount||0),0);
meta.totalRetainedMarkets=Object.values(snapshot.sports||{}).reduce((n,s)=>n+(s?.retainedMarketCount||0),0);
meta.totalDeepMarkets=Object.values(meta.sports||{}).reduce((n,s)=>n+(s?.deepMarkets||0),0);
meta.totalPlayerPropLikeMarkets=Object.values(meta.sports||{}).reduce((n,s)=>n+(s?.playerPropLikeMarkets||0),0);
meta.publicReader={ok:true,fetchedAt,competition:NFL_PAGE,pageDiscovered:pageDiscovered.length,existingKnown:existing.length,unionCandidates:discovered.length,acceptedNflEvents:nflEvents.length,preservedNonNflEvents:nonNflRows.length,mergedAmericanFootballEvents:events.length,failedEvents:errors.length,errors:errors.slice(0,20)};
await fs.writeFile('data/owls-latest.json',JSON.stringify(snapshot,null,2));
await fs.writeFile('data/owls-meta.json',JSON.stringify(meta,null,2));
console.log('THUNDERPICK_PUBLIC_READER',JSON.stringify({pageDiscovered:pageDiscovered.length,existingKnown:existing.length,unionCandidates:discovered.length,nflEvents:nflEvents.length,preservedNonNflEvents:nonNflRows.length,mergedAmericanFootballEvents:events.length,errors:errors.length,markets:retainedMarketCount,playerPropLikeMarkets,examples:nflEvents.slice(0,3).map(e=>({id:e.id,name:e.name,startTime:e.startTime,markets:e.preferredMarkets?.length||0}))}));
