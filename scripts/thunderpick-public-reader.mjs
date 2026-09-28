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
const isNflEvent=e=>{const compId=Number(e?.competition?.id);const comp=String(e?.competition?.name||e?.competition?.shortName||'');return compId===NFL_COMPETITION_ID||/\bnfl\b/i.test(comp);};
const propLike=name=>/\bplayer\b|passing|rushing|receiving|receptions?|touchdowns?|attempts?|completions?|interceptions?/i.test(String(name||''));

async function fetchText(url){const r=await fetch(READER+url,{headers:{accept:'text/plain','user-agent':'Mozilla/5.0 ThunderpickCloudCollector/1.0'},signal:AbortSignal.timeout(30000)});const text=await r.text();if(!r.ok)throw new Error(`reader HTTP ${r.status} for ${url}`);return text;}
function parseReaderJson(text,url){const marker='Markdown Content:';const i=text.indexOf(marker);if(i<0)throw new Error(`reader JSON marker missing for ${url}`);let raw=text.slice(i+marker.length).trim();const first=raw.indexOf('{');if(first<0)throw new Error(`reader JSON body missing for ${url}`);raw=raw.slice(first);try{return JSON.parse(raw);}catch(e){throw new Error(`reader JSON parse failed for ${url}: ${e.message}`);}}
function extractNflMatchUrls(markdown){const re=/https:\/\/thunderpick\.io\/sports\/american-football\/(?:us\/)?nfl\/389\/[a-z0-9-]+\/(\d+)/gi;const seen=new Map();let m;while((m=re.exec(markdown)))seen.set(String(m[1]),m[0]);return [...seen.entries()].map(([id,url])=>({id,url,via:'nfl-page'}));}
function knownNflIds(snapshot){const rows=snapshot?.sports?.[SPORT]?.data?.data;if(!Array.isArray(rows))return[];const cutoff=Date.now()-5*60e3;const out=[];for(const e of rows){const id=e?.id,start=Date.parse(e?.startTime||'');if(!id||e?.isLive===true||(Number.isFinite(start)&&start<=cutoff))continue;if(isNflEvent(e))out.push({id:String(id),url:null,via:'existing-snapshot'});}return out;}
async function fetchMatch(id){const metaUrl=`https://thunderpick.io/api/matches?matchesIds=${encodeURIComponent(id)}`,marketsUrl=`https://thunderpick.io/api/markets/${encodeURIComponent(id)}`;const [metaText,marketText]=await Promise.all([fetchText(metaUrl),fetchText(marketsUrl)]);const metaBody=parseReaderJson(metaText,metaUrl),marketBody=parseReaderJson(marketText,marketsUrl);if(metaBody?.statusCode!==200||metaBody?.ok!==true)throw new Error(`metadata not OK for ${id}`);if(marketBody?.statusCode!==200||marketBody?.ok!==true)throw new Error(`markets not OK for ${id}`);const event=metaBody?.data?.matches?.[0]??(metaBody?.data?.id?metaBody.data:null),markets=marketBody?.data;if(!event||String(event.id)!==String(id)||!Array.isArray(markets)||!markets.length)throw new Error(`incomplete first-party payload for ${id}`);const fetchedAt=nowIso();return{...event,preferredMarkets:markets,deepMarketsFetchedAt:fetchedAt,deepMarketsFresh:true};}

await fs.mkdir('data',{recursive:true});
const snapshot=await readJson('data/owls-latest.json',{generatedAt:null,source:null,format:null,sports:{}});
const meta=await readJson('data/owls-meta.json',{generatedAt:null,source:null,format:null,sports:{}});
const fetchedAt=nowIso();
const priorSport=snapshot?.sports?.[SPORT]||{};
const priorRows=Array.isArray(priorSport?.data?.data)?priorSport.data.data:[];
const baseMeta=meta?.sports?.[SPORT]||{};

let pageText='';try{pageText=await fetchText(NFL_PAGE);}catch(e){console.error('THUNDERPICK_PUBLIC_READER_DISCOVERY_FAILED',e.message);}
const pageDiscovered=pageText?extractNflMatchUrls(pageText):[],existing=knownNflIds(snapshot),union=new Map();for(const x of [...existing,...pageDiscovered])union.set(String(x.id),union.has(String(x.id))?{...union.get(String(x.id)),...x}:x);const discovered=[...union.values()];
if(!discovered.length){console.error('THUNDERPICK_PUBLIC_READER_NO_NFL_MATCHES');process.exit(2);}

const refreshed=new Map(),errors=[];
for(const item of discovered){try{const e=await fetchMatch(item.id);const start=Date.parse(e.startTime||'');if(e.gameId===GAME_ID&&isNflEvent(e)&&e.isLive!==true&&(!Number.isFinite(start)||start>Date.now()-5*60e3))refreshed.set(String(e.id),e);}catch(err){errors.push({id:item.id,via:item.via,error:String(err?.message||err)});}}

// Supplemental reader refresh must never delete or downgrade a healthy first-party event.
// Start with every first-party row, then replace only IDs the reader refreshed successfully.
const mergedById=new Map();for(const e of priorRows)if(e?.id!=null)mergedById.set(String(e.id),e);for(const [id,e] of refreshed)mergedById.set(id,e);
const events=[...mergedById.values()].sort((a,b)=>Date.parse(a?.startTime||0)-Date.parse(b?.startTime||0));
const retainedMarketCount=events.reduce((n,e)=>n+(Array.isArray(e.preferredMarkets)?e.preferredMarkets.length:0)+(e.market?1:0),0),playerPropLikeMarkets=events.reduce((n,e)=>n+(e.preferredMarkets||[]).filter(m=>propLike(m?.name)).length,0),deepMarkets=events.reduce((n,e)=>n+(e?.deepMarketsFresh===true&&Array.isArray(e?.preferredMarkets)?e.preferredMarkets.length:0),0);

// Preserve the first-party deep-coverage counters exactly. Reader attempts are separate diagnostics;
// otherwise reader failures can make a fully successful first-party scan look incomplete.
const firstPartyDeepSelected=Number(baseMeta.deepSelectedEvents||0),firstPartyDeepSuccess=Number(baseMeta.deepMarketSuccess||0),firstPartyDeepFailures=Number(baseMeta.deepMarketFailures||0);
const firstPartyComplete=baseMeta.ok===true&&baseMeta.httpOk===true&&firstPartyDeepFailures===0&&(firstPartyDeepSelected===0||firstPartyDeepSuccess===firstPartyDeepSelected)&&!/partial|error|stale/i.test(String(baseMeta.coverageStatus||''));
const sportRecord={
  ...baseMeta,
  ok:firstPartyComplete,httpOk:firstPartyComplete,status:firstPartyComplete?200:(baseMeta.status??200),fetchedAt,gameId:GAME_ID,eventCount:events.length,retainedMarketCount,
  deepEligibleEvents:baseMeta.deepEligibleEvents??null,deepSelectedEvents:baseMeta.deepSelectedEvents??null,deepSkippedByCap:baseMeta.deepSkippedByCap??0,
  deepMarketRequests:baseMeta.deepMarketRequests||0,deepMarketSuccess:baseMeta.deepMarketSuccess||0,deepMarketFailures:baseMeta.deepMarketFailures||0,deep429s:baseMeta.deep429s||0,
  deepMarkets,playerPropLikeMarkets,hash:sha(events),changedSincePrevious:null,
  coverageStatus:firstPartyComplete?'fresh-first-party-deep-plus-reader':'first-party-deep-incomplete',usedFallback:false,error:firstPartyComplete?null:(baseMeta.error||'first-party deep coverage incomplete'),
  publicReaderRequests:discovered.length,publicReaderSuccess:refreshed.size,publicReaderFailures:errors.length,
  source:'Thunderpick first-party browser with supplemental NFL public-reader refresh',data:{data:events}
};
snapshot.generatedAt=fetchedAt;snapshot.source='Thunderpick first-party API with supplemental free public reader NFL refresh';snapshot.format='first-party-browser-v6-plus-public-reader-nfl-safe-merge';snapshot.sports={...(snapshot.sports||{}),[SPORT]:sportRecord};
meta.generatedAt=fetchedAt;meta.source=snapshot.source;meta.format=snapshot.format;meta.quotaExhausted=false;meta.quotaResetMonth=null;meta.sports={...(meta.sports||{}),[SPORT]:{...sportRecord,data:undefined}};
if(firstPartyComplete){meta.successfulSports=[...new Set([...(meta.successfulSports||[]).filter(x=>x!==SPORT),SPORT])];meta.failedSports=(meta.failedSports||[]).filter(x=>x!==SPORT);meta.coverageAnomalies=(meta.coverageAnomalies||[]).filter(x=>x?.sport!==SPORT);}else{meta.failedSports=[...new Set([...(meta.failedSports||[]),SPORT])];}
meta.coverageComplete=(meta.failedSports||[]).length===0;
meta.totalEvents=Object.values(snapshot.sports||{}).reduce((n,s)=>n+(s?.eventCount||0),0);meta.totalRetainedMarkets=Object.values(snapshot.sports||{}).reduce((n,s)=>n+(s?.retainedMarketCount||0),0);meta.totalDeepMarkets=Object.values(meta.sports||{}).reduce((n,s)=>n+(s?.deepMarkets||0),0);meta.totalPlayerPropLikeMarkets=Object.values(meta.sports||{}).reduce((n,s)=>n+(s?.playerPropLikeMarkets||0),0);
meta.publicReader={ok:refreshed.size>0,fetchedAt,competition:NFL_PAGE,pageDiscovered:pageDiscovered.length,existingKnown:existing.length,unionCandidates:discovered.length,acceptedNflEvents:refreshed.size,preservedPriorEvents:priorRows.length,mergedAmericanFootballEvents:events.length,failedEvents:errors.length,errors:errors.slice(0,20),doesNotAffectFirstPartyFreshness:true};
await fs.writeFile('data/owls-latest.json',JSON.stringify(snapshot,null,2));await fs.writeFile('data/owls-meta.json',JSON.stringify(meta,null,2));
console.log('THUNDERPICK_PUBLIC_READER',JSON.stringify({pageDiscovered:pageDiscovered.length,existingKnown:existing.length,unionCandidates:discovered.length,nflEvents:refreshed.size,preservedPriorEvents:priorRows.length,mergedAmericanFootballEvents:events.length,errors:errors.length,firstPartyDeepSelected,firstPartyDeepSuccess,firstPartyDeepFailures,firstPartyComplete,markets:retainedMarketCount,playerPropLikeMarkets,examples:[...refreshed.values()].slice(0,3).map(e=>({id:e.id,name:e.name,startTime:e.startTime,markets:e.preferredMarkets?.length||0}))}));
