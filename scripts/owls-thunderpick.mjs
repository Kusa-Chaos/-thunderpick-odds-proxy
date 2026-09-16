import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const API_KEY = (process.env.OWLS_API_KEY || '').replace(/\s+/g, '');
if (!API_KEY) {
  console.error('OWLS_API_KEY is not configured.');
  process.exit(2);
}

const SPORTS = ['american-football','baseball','basketball','cs2','dota2','lol','soccer','tennis','valorant'];
const BASE = 'https://api.owlsinsight.com/api/v2/thunderpick';
const outDir = path.join(process.cwd(), 'data');
const outPath = path.join(outDir, 'owls-latest.json');
const metaPath = path.join(outDir, 'owls-meta.json');
const TARGET_MARKET = /(winner|moneyline|handicap|spread|total|map|round|correct score|pistol|kills?|game)/i;
const MAX_MARKETS_PER_EVENT = 160;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function readPreviousMeta(){try{return JSON.parse(await fs.readFile(metaPath,'utf8'));}catch{return null;}}
function stableHash(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function toEvents(payload){if(Array.isArray(payload))return payload;if(Array.isArray(payload?.data))return payload.data;if(Array.isArray(payload?.events))return payload.events;if(payload?.data&&typeof payload.data==='object')return Object.values(payload.data);return [];}
function scalar(v){return ['string','number','boolean'].includes(typeof v)?v:null;}
function compactSelection(s={}){
 return {id:scalar(s.id),name:s.name??null,type:s.type??null,odds:s.odds??null,point:s.point??s.points??null,handicap:s.handicap??null,total:s.total??null,line:s.line??null,map:s.map??null,round:s.round??null,status:s.status??null,specifiers:scalar(s.specifiers)};
}
function compactMarketSide(side={}){return{name:side.name??null,odds:side.odds??null};}
function compactMarket(m={}){
 return {id:scalar(m.id),name:m.name??null,nickName:m.nickName??null,type:m.type??null,category:m.category??null,subCategory:m.subCategory??null,baseLine:m.baseLine??null,isMainLine:m.isMainLine??null,isFeatured:m.isFeatured??null,specifiers:scalar(m.specifiers),selections:Array.isArray(m.selections)?m.selections.map(compactSelection):[]};
}
function keepMarket(m={}){
 const text=`${m?.nickName||''} ${m?.name||''}`;
 const selections=Array.isArray(m?.selections)?m.selections:[];
 return TARGET_MARKET.test(text)&&selections.filter(s=>Number(s?.odds)>1).length>=2;
}
function dedupeMarkets(markets){
 const seen=new Set();const out=[];
 for(const m of markets){
  const k=`${m.id??''}|${m.name??''}|${m.nickName??''}|${m.baseLine??''}|${m.specifiers??''}|${(m.selections||[]).map(s=>`${s.id??''}:${s.odds??''}:${s.handicap??''}:${s.total??''}`).join(',')}`;
  if(seen.has(k))continue;seen.add(k);out.push(m);if(out.length>=MAX_MARKETS_PER_EVENT)break;
 }
 return out;
}
function compactEvent(event={}){
 const preferred=Array.isArray(event.preferredMarkets)?event.preferredMarkets.filter(keepMarket).map(compactMarket):[];
 const deep=Array.isArray(event.markets)?event.markets.filter(keepMarket).map(compactMarket):[];
 const allMarkets=dedupeMarkets([...preferred,...deep]);
 const market=event?.market?{home:compactMarketSide(event.market.home),away:compactMarketSide(event.market.away)}:null;
 return {id:event.id??null,name:event.name??null,startTime:event.startTime??null,isLive:Boolean(event.isLive),status:event.status??null,lastUpdateMs:event.lastUpdateMs??null,league:event?.league?{id:event.league.id??null,name:event.league.name??null}:null,competition:event?.competition?{id:event.competition.id??null,name:event.competition.name??null}:null,tournament:event?.tournament?{id:event.tournament.id??null,name:event.tournament.name??null}:null,teams:{home:{name:event?.teams?.home?.name??market?.home?.name??null},away:{name:event?.teams?.away?.name??market?.away?.name??null}},market,preferredMarkets:allMarkets};
}

const previousMeta=await readPreviousMeta();const snapshots={};const metaSports={};const failures=[];
for(const sport of SPORTS){
 const url=`${BASE}/${encodeURIComponent(sport)}`;console.log(`Fetching Thunderpick ${sport}...`);
 try{
  const response=await fetch(url,{headers:{Authorization:`Bearer ${API_KEY}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
  const raw=await response.text();let body;try{body=JSON.parse(raw);}catch{body={raw};}
  const hash=stableHash(body),old=previousMeta?.sports?.[sport],fetchedAt=new Date().toISOString(),compactEvents=toEvents(body).map(compactEvent);
  const marketCount=compactEvents.reduce((sum,e)=>sum+(e.preferredMarkets?.length||0)+(e.market?1:0),0);
  const summary={ok:response.ok,status:response.status,fetchedAt,etag:response.headers.get('etag'),eventCount:compactEvents.length,retainedMarketCount:marketCount,hash,changedSincePrevious:old?old.hash!==hash:true};
  snapshots[sport]={...summary,data:{data:compactEvents}};metaSports[sport]=summary;if(!response.ok)failures.push({sport,status:response.status});
 }catch(error){const record={ok:false,status:null,fetchedAt:new Date().toISOString(),error:String(error?.message||error),eventCount:0,retainedMarketCount:0,hash:null,changedSincePrevious:false};snapshots[sport]={...record,data:{data:[]}};metaSports[sport]=record;failures.push({sport,error:record.error});}
 await sleep(3500);
}
const changedSports=SPORTS.filter(s=>snapshots[s]?.changedSincePrevious),generatedAt=new Date().toISOString();
const output={generatedAt,source:'Owls Insight Thunderpick Source API v2',format:'compact-v3-full-market-depth',requestCountThisRun:SPORTS.length,requestedSports:SPORTS,successfulSports:SPORTS.filter(s=>snapshots[s]?.ok),failedSports:failures,changedSports,sports:snapshots};
await fs.mkdir(outDir,{recursive:true});const serialized=JSON.stringify(output);await fs.writeFile(outPath,serialized);
const meta={generatedAt,source:output.source,format:output.format,snapshotBytes:Buffer.byteLength(serialized),requestCountThisRun:SPORTS.length,requestedSports:SPORTS,successfulSports:output.successfulSports,failedSports:failures,changedSports,totalEvents:SPORTS.reduce((sum,s)=>sum+(metaSports[s]?.eventCount||0),0),totalRetainedMarkets:SPORTS.reduce((sum,s)=>sum+(metaSports[s]?.retainedMarketCount||0),0),sports:metaSports};
await fs.writeFile(metaPath,JSON.stringify(meta,null,2));
console.log(`Saved ${SPORTS.length} full-depth compact Thunderpick sport snapshots.`);console.log(`Snapshot bytes: ${meta.snapshotBytes}`);console.log(`Retained markets: ${meta.totalRetainedMarkets}`);console.log(`Changed sports: ${changedSports.join(', ')||'none'}`);if(failures.length){console.error(`Failures: ${JSON.stringify(failures)}`);process.exitCode=1;}
