import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const API_KEY=(process.env.OWLS_API_KEY||'').replace(/\s+/g,'');
if(!API_KEY){console.error('OWLS_API_KEY is not configured.');process.exit(2);}
// NFL first so tomorrow's board gets first claim on any available rate-limit budget.
const SPORTS=['american-football','cs2','dota2','lol','valorant','baseball','basketball','soccer','tennis'];
const BASE='https://api.owlsinsight.com/api/v2/thunderpick';
const outDir=path.join(process.cwd(),'data'),outPath=path.join(outDir,'owls-latest.json'),metaPath=path.join(outDir,'owls-meta.json');
const TARGET_MARKET=/(winner|moneyline|handicap|spread|total|map|round|correct score|pistol|kills?|game)/i;
const MAX_MARKETS_PER_EVENT=160;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function readPreviousMeta(){try{return JSON.parse(await fs.readFile(metaPath,'utf8'));}catch{return null;}}
async function readPreviousSnapshot(){try{return JSON.parse(await fs.readFile(outPath,'utf8'));}catch{return null;}}
const stableHash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function toEvents(p){if(Array.isArray(p))return p;if(Array.isArray(p?.data))return p.data;if(Array.isArray(p?.events))return p.events;if(p?.data&&typeof p.data==='object')return Object.values(p.data);return [];}
const scalar=v=>['string','number','boolean'].includes(typeof v)?v:null;
function compactSelection(s={}){return{id:scalar(s.id),name:s.name??null,type:s.type??null,odds:s.odds??null,point:s.point??s.points??null,handicap:s.handicap??null,total:s.total??null,line:s.line??null,map:s.map??null,round:s.round??null,status:s.status??null,specifiers:scalar(s.specifiers)};}
function compactMarketSide(s={}){return{name:s.name??null,odds:s.odds??null};}
function compactMarket(m={}){return{id:scalar(m.id),name:m.name??null,nickName:m.nickName??null,type:m.type??null,category:m.category??null,subCategory:m.subCategory??null,baseLine:m.baseLine??null,isMainLine:m.isMainLine??null,isFeatured:m.isFeatured??null,specifiers:scalar(m.specifiers),selections:Array.isArray(m.selections)?m.selections.map(compactSelection):[]};}
function keepMarket(m={}){const text=`${m?.nickName||''} ${m?.name||''}`;const ss=Array.isArray(m?.selections)?m.selections:[];return TARGET_MARKET.test(text)&&ss.filter(s=>Number(s?.odds)>1).length>=2;}
function dedupeMarkets(ms){const seen=new Set(),out=[];for(const m of ms){const k=`${m.id??''}|${m.name??''}|${m.nickName??''}|${m.baseLine??''}|${m.specifiers??''}|${(m.selections||[]).map(s=>`${s.id??''}:${s.odds??''}:${s.handicap??''}:${s.total??''}`).join(',')}`;if(seen.has(k))continue;seen.add(k);out.push(m);if(out.length>=MAX_MARKETS_PER_EVENT)break;}return out;}
function compactEvent(e={}){const preferred=Array.isArray(e.preferredMarkets)?e.preferredMarkets.filter(keepMarket).map(compactMarket):[];const deep=Array.isArray(e.markets)?e.markets.filter(keepMarket).map(compactMarket):[];const allMarkets=dedupeMarkets([...preferred,...deep]);const market=e?.market?{home:compactMarketSide(e.market.home),away:compactMarketSide(e.market.away)}:null;return{id:e.id??null,name:e.name??null,startTime:e.startTime??null,isLive:Boolean(e.isLive),status:e.status??null,lastUpdateMs:e.lastUpdateMs??null,league:e?.league?{id:e.league.id??null,name:e.league.name??null}:null,competition:e?.competition?{id:e.competition.id??null,name:e.competition.name??null}:null,tournament:e?.tournament?{id:e.tournament.id??null,name:e.tournament.name??null}:null,teams:{home:{name:e?.teams?.home?.name??market?.home?.name??null},away:{name:e?.teams?.away?.name??market?.away?.name??null}},market,preferredMarkets:allMarkets};}
function rateInfo(response,body={}){return{remainingMinute:response.headers.get('x-ratelimit-remaining-minute'),remainingMonth:response.headers.get('x-ratelimit-remaining-month'),resetMinute:response.headers.get('x-ratelimit-reset-minute'),resetMonth:response.headers.get('x-ratelimit-reset-month'),retryAfter:response.headers.get('retry-after')??body?.retryAfter??null,limit:body?.limit??null,code:body?.code??null,message:body?.message??body?.error??null};}
function conditionalEtag(old){if(old?.etag)return old.etag;if(old?.hash)return `"${old.hash}"`;return null;}

const previousMeta=await readPreviousMeta(),previousSnapshot=await readPreviousSnapshot(),snapshots={},metaSports={},failures=[],coverageAnomalies=[];
let actualRequests=0,quotaExhausted=false,quotaResetMonth=null;
for(const sport of SPORTS){
 const old=previousMeta?.sports?.[sport],priorEvents=previousSnapshot?.sports?.[sport]?.data?.data,priorKnown=Array.isArray(priorEvents)&&Boolean(old);
 if(quotaExhausted){
   const marketCount=priorKnown?priorEvents.reduce((sum,e)=>sum+(e.preferredMarkets?.length||0)+(e.market?1:0),0):0;
   const record={ok:Boolean(priorKnown),httpOk:false,status:429,fetchedAt:new Date().toISOString(),etag:old?.etag??null,eventCount:priorKnown?priorEvents.length:0,retainedMarketCount:marketCount,hash:old?.hash??null,changedSincePrevious:false,coverageStatus:'stale-fallback',usedFallback:Boolean(priorKnown),rateLimit:{remainingMonth:'0',resetMonth:quotaResetMonth,limit:'month',message:'Monthly Owls quota exhausted earlier in this run'}};
   snapshots[sport]={...record,data:{data:priorKnown?priorEvents:[]}};metaSports[sport]=record;
   if(priorKnown)coverageAnomalies.push({sport,status:429,reason:'Owls monthly quota exhausted; reused previous snapshot'});else failures.push({sport,status:429,reason:'Owls monthly quota exhausted and no prior snapshot'});
   continue;
 }
 const url=`${BASE}/${encodeURIComponent(sport)}`;console.log(`Fetching Thunderpick ${sport}...`);
 try{
   let response,raw='',body={},info={},notModified=false;
   const etag=conditionalEtag(old);
   for(let attempt=1;attempt<=3;attempt++){
     const headers={Authorization:`Bearer ${API_KEY}`,Accept:'application/json'};if(etag)headers['If-None-Match']=etag;
     actualRequests++;
     response=await fetch(url,{headers,signal:AbortSignal.timeout(45000)});
     if(response.status===304){notModified=true;info=rateInfo(response,{});break;}
     raw=await response.text();try{body=JSON.parse(raw);}catch{body={raw};}
     info=rateInfo(response,body);
     if(response.status!==429)break;
     console.warn('OWLS_429',JSON.stringify({sport,attempt,remainingMinute:info.remainingMinute,remainingMonth:info.remainingMonth,resetMinute:info.resetMinute,resetMonth:info.resetMonth,retryAfter:info.retryAfter,limit:info.limit,code:info.code,message:info.message}));
     const monthZero=String(info.remainingMonth??'')==='0'||String(info.limit??'').toLowerCase()==='month';
     if(monthZero){quotaExhausted=true;quotaResetMonth=info.resetMonth??null;break;}
     if(attempt<3){const sec=Math.max(1,Math.min(65,Number(info.retryAfter)||5));await sleep(sec*1000);}
   }
   const fetchedAt=new Date().toISOString();
   if(notModified&&priorKnown){
     const marketCount=priorEvents.reduce((sum,e)=>sum+(e.preferredMarkets?.length||0)+(e.market?1:0),0);
     const summary={ok:true,httpOk:true,status:304,fetchedAt,etag:response.headers.get('etag')||etag,eventCount:priorEvents.length,retainedMarketCount:marketCount,hash:old?.hash??null,changedSincePrevious:false,coverageStatus:'fresh-unchanged-304',usedFallback:false,freshVia304:true,rateLimit:info};
     snapshots[sport]={...summary,data:{data:priorEvents}};metaSports[sport]=summary;console.log(`Thunderpick ${sport}: HTTP 304; current board unchanged (${priorEvents.length} events)`);await sleep(3500);continue;
   }
   const hash=stableHash(body),compactEvents=toEvents(body).map(compactEvent);let events=compactEvents,usedFallback=false;
   if((!response?.ok||events.length===0)&&priorKnown){events=priorEvents;usedFallback=true;console.warn(`Thunderpick ${sport}: HTTP ${response?.status}; using previous snapshot (${events.length} events)`);}
   const marketCount=events.reduce((sum,e)=>sum+(e.preferredMarkets?.length||0)+(e.market?1:0),0),suspiciousEmpty=!usedFallback&&response?.ok&&events.length===0;
   const summary={ok:(Boolean(response?.ok)&&!suspiciousEmpty)||usedFallback,httpOk:Boolean(response?.ok),status:response?.status??null,fetchedAt,etag:response?.headers?.get('etag')||old?.etag||null,eventCount:events.length,retainedMarketCount:marketCount,hash:usedFallback?(old?.hash||hash):hash,changedSincePrevious:usedFallback?false:(old?old.hash!==hash:true),coverageStatus:usedFallback?'stale-fallback':(suspiciousEmpty?'anomaly':'ok'),usedFallback,rateLimit:info};
   snapshots[sport]={...summary,data:{data:events}};metaSports[sport]=summary;
   if(!response?.ok&&!usedFallback)failures.push({sport,status:response?.status??null});
   if(usedFallback)coverageAnomalies.push({sport,status:response?.status??null,reason:quotaExhausted?'Owls monthly quota exhausted; reused previous healthy snapshot':'Owls refresh unavailable after rate-limit retry; reused previous healthy snapshot'});
   if(suspiciousEmpty)coverageAnomalies.push({sport,status:response.status,reason:'HTTP success but zero events; coverage cannot be considered complete'});
 }catch(error){
   if(priorKnown){const marketCount=priorEvents.reduce((sum,e)=>sum+(e.preferredMarkets?.length||0)+(e.market?1:0),0),record={ok:true,httpOk:false,status:null,fetchedAt:new Date().toISOString(),etag:old?.etag??null,error:String(error?.message||error),eventCount:priorEvents.length,retainedMarketCount:marketCount,hash:old?.hash||null,changedSincePrevious:false,coverageStatus:'stale-fallback',usedFallback:true};snapshots[sport]={...record,data:{data:priorEvents}};metaSports[sport]=record;coverageAnomalies.push({sport,status:null,reason:'Owls request timed out/failed; reused previous healthy snapshot'});console.warn(`Thunderpick ${sport}: request failed; using previous healthy snapshot (${priorEvents.length} events)`);}else{const record={ok:false,httpOk:false,status:null,fetchedAt:new Date().toISOString(),etag:null,error:String(error?.message||error),eventCount:0,retainedMarketCount:0,hash:null,changedSincePrevious:false,coverageStatus:'error',usedFallback:false};snapshots[sport]={...record,data:{data:[]}};metaSports[sport]=record;failures.push({sport,error:record.error});}
 }
 await sleep(3500);
}
const changedSports=SPORTS.filter(s=>snapshots[s]?.changedSincePrevious),generatedAt=new Date().toISOString();
const output={generatedAt,source:'Owls Insight Thunderpick Source API v2',format:'compact-v5-etag-rate-aware',requestCountThisRun:actualRequests,requestedSports:SPORTS,successfulSports:SPORTS.filter(s=>snapshots[s]?.ok),failedSports:failures,coverageAnomalies,changedSports,quotaExhausted,quotaResetMonth,sports:snapshots};
await fs.mkdir(outDir,{recursive:true});const serialized=JSON.stringify(output);await fs.writeFile(outPath,serialized);
const meta={generatedAt,source:output.source,format:output.format,snapshotBytes:Buffer.byteLength(serialized),requestCountThisRun:actualRequests,requestedSports:SPORTS,successfulSports:output.successfulSports,failedSports:failures,coverageAnomalies,coverageComplete:failures.length===0&&coverageAnomalies.length===0,changedSports,quotaExhausted,quotaResetMonth,totalEvents:SPORTS.reduce((sum,s)=>sum+(metaSports[s]?.eventCount||0),0),totalRetainedMarkets:SPORTS.reduce((sum,s)=>sum+(metaSports[s]?.retainedMarketCount||0),0),sports:metaSports};
await fs.writeFile(metaPath,JSON.stringify(meta,null,2));
console.log(`Saved ${SPORTS.length} compact Thunderpick sport snapshots.`);console.log(`Owls HTTP requests this run: ${actualRequests}`);console.log(`Retained markets: ${meta.totalRetainedMarkets}`);console.log(`Coverage anomalies: ${coverageAnomalies.map(x=>x.sport).join(', ')||'none'}`);if(quotaExhausted)console.warn('OWLS_MONTHLY_QUOTA_EXHAUSTED',quotaResetMonth||'reset time not supplied');
const hardFailures=failures.filter(f=>!snapshots[f.sport]?.usedFallback);
if(hardFailures.length){console.error('HARD_REFRESH_FAILURES',JSON.stringify(hardFailures));process.exitCode=1;}else if(coverageAnomalies.length){console.warn('DEGRADED_REFRESH_CONTINUE',coverageAnomalies.length,'fallback/anomaly sport(s); comparison may continue but freshness policy must gate ACTION');}
