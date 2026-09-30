import fs from 'node:fs/promises';
import {orientNamedTwoWayPrices,safeQuoteTimestamp} from './source-quality.mjs';

const FILE='data/direct-sources-latest.json';
const out=JSON.parse(await fs.readFile(FILE,'utf8'));
const NOW=Date.now(), MAX_FUTURE=NOW+30*24*3600e3;
const UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function current(v){const t=Date.parse(v||'');return Number.isFinite(t)&&t>=NOW-2*3600e3&&t<=MAX_FUTURE;}
function norm(v=''){return String(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function esportOf(text=''){const s=norm(text);if(/counter strike|cs2|cs go|csgo/.test(s))return'cs2';if(/dota 2|\bdota\b/.test(s))return'dota2';if(/league of legends|\blol\b|\blck\b|\blpl\b|\blec\b|\blcs\b/.test(s))return'lol';if(/valorant/.test(s))return'valorant';return null;}
function sportFromName(name=''){const s=norm(name);if(/e sports|esports/.test(s))return'esports';if(/american football|football/.test(s)&&!/soccer/.test(s))return'american-football';if(/baseball/.test(s))return'baseball';if(/basketball/.test(s))return'basketball';if(/soccer/.test(s))return'soccer';if(/tennis/.test(s))return'tennis';return null;}
function decimal(v){const n=Number(v);if(!Number.isFinite(n))return null;if(n>1&&n<100)return n;if(n>=100)return 1+n/100;if(n<=-100)return 1+100/Math.abs(n);return null;}
function participantPair(m={}){const ps=(m.participants||[]).filter(Boolean);if(ps.length<2)return null;const home=ps.find(p=>/home/i.test(String(p.alignment||p.designation||'')))||ps[0];const away=ps.find(p=>/away/i.test(String(p.alignment||p.designation||'')))||ps.find(p=>p!==home)||ps[1];if(!home?.name||!away?.name)return null;return {home,away};}
function pricesOf(m={}){const a=[];for(const k of ['prices','outcomes','selections'])if(Array.isArray(m[k]))a.push(...m[k]);return a;}
function marketKind(m={}){const t=norm([m.type,m.marketType,m.betType,m.name,m.description,m.designation].filter(Boolean).join(' '));if(/player/.test(t)&&/(kill|kills|headshot|assist|ace|point|rebounds|yards)/.test(t))return'player_prop';if(/map/.test(t)&&/(moneyline|winner)/.test(t))return'map_winner';if(/moneyline|match winner|winner/.test(t)&&!/map|period|set|half|round/.test(t))return'h2h';if(/spread|handicap/.test(t))return'spreads';if(/total/.test(t))return'totals';return null;}
function orientPrices(m,matchup,pair){const ps=pricesOf(m).map(p=>({...p,price:decimal(p.price??p.odds??p.decimalOdds),point:Number.isFinite(Number(p.points??p.handicap??p.total))?Number(p.points??p.handicap??p.total):undefined})).filter(p=>p&&p.price>1);if(ps.length!==2)return null;return orientNamedTwoWayPrices(ps,matchup.participants||[],pair);}
async function getJson(url,headers={}){const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':UA,Origin:'https://www.pinnacle.com',Referer:'https://www.pinnacle.com/',...headers},redirect:'follow',signal:AbortSignal.timeout(30000)});const text=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status} ${text.slice(0,120)}`);return JSON.parse(text);}
async function mapLimit(items,limit,fn){const out=[];let i=0;async function worker(){while(true){const n=i++;if(n>=items.length)return;try{out[n]=await fn(items[n])}catch(e){out[n]={__error:String(e?.message||e)}}}}await Promise.all(Array.from({length:Math.min(limit,items.length||1)},worker));return out;}

let health={ok:false,status:null,sports:0,leagues:0,matchups:0,marketRequests:0,acceptedEvents:0,acceptedMarkets:0,playerPropMarkets:0,mapWinnerMarkets:0,rejectedUnorientableMarkets:0,errors:[],fetchedAt:new Date().toISOString()};
try{
  const cfg=await getJson('https://www.pinnacle.com/config/app.json');
  const hay=cfg?.api?.haywire;if(!hay?.apiKey)throw new Error('Pinnacle public client key missing from app config');
  const route=hay?.routes?.curacao||Object.values(hay?.routes||{})[0];const root=route?.guestRoot;if(!root)throw new Error('Pinnacle guest root missing');
  const ver=hay.apiVersion||'0.1', headers={'X-API-Key':hay.apiKey};
  const sports=await getJson(`${root}/${ver}/sports`,headers);health.sports=Array.isArray(sports)?sports.length:0;
  const wanted=(sports||[]).map(s=>({row:s,kind:sportFromName(s.name)})).filter(x=>x.kind);
  const leagueGroups=await mapLimit(wanted,3,async x=>({kind:x.kind,sport:x.row,leagues:await getJson(`${root}/${ver}/sports/${x.row.id}/leagues?all=false`,headers)}));
  const leagueItems=[];for(const g of leagueGroups){if(g?.__error){health.errors.push(g.__error);continue}for(const l of g.leagues||[]){if(Number(l.matchupCount||0)<=0)continue;leagueItems.push({kind:g.kind,league:l});}}
  health.leagues=leagueItems.length;
  const matchupGroups=await mapLimit(leagueItems.slice(0,220),6,async x=>({kind:x.kind,league:x.league,matchups:await getJson(`${root}/${ver}/leagues/${x.league.id}/matchups`,headers)}));
  const matches=[];for(const g of matchupGroups){if(g?.__error){health.errors.push(g.__error);continue}for(const m of g.matchups||[]){if(!m?.hasMarkets||m?.isLive||!current(m.startTime))continue;const pair=participantPair(m);if(!pair)continue;let sport=g.kind==='esports'?esportOf(`${g.league?.name||''} ${m?.league?.name||''}`):g.kind;if(!sport||!out?.sports?.[sport])continue;matches.push({sport,league:g.league,m,pair});}}
  health.matchups=matches.length;
  const sampled=matches.slice(0,180);
  const marketGroups=await mapLimit(sampled,8,async q=>{let last='';for(const path of [`${root}/${ver}/matchups/${q.m.id}/markets/straight`,`${root}/${ver}/matchups/${q.m.id}/markets/related/straight`]){health.marketRequests++;try{return{...q,markets:await getJson(path,headers)}}catch(e){last=String(e?.message||e)}}return{...q,__error:last};});
  for(const g of marketGroups){if(g?.__error){health.errors.push(g.__error);continue}const markets=Array.isArray(g.markets)?g.markets:(g.markets?.markets||g.markets?.data||[]);const normalized=[];for(const m of markets){const kind=marketKind(m);if(!kind)continue;const outcomes=orientPrices(m,g.m,g.pair);if(!outcomes){health.rejectedUnorientableMarkets++;continue;}if(kind==='player_prop')health.playerPropMarkets++;if(kind==='map_winner')health.mapWinnerMarkets++;let scope={map:null,round:null};const txt=String([m.name,m.description,m.period?.description,m.period].filter(Boolean).join(' '));const mm=txt.match(/\bmap\s*(\d+)\b/i);if(mm)scope.map=Number(mm[1]);const quoteTs=safeQuoteTimestamp({updatedAt:m.updatedAt,lastUpdate:m.lastUpdate,last_update:m.last_update});normalized.push({key:kind,name:m.name||m.description||kind,title:m.name||m.description||kind,scope,line:null,last_update:quoteTs?new Date(quoteTs).toISOString():null,outcomes});}
    if(!normalized.length)continue;out.sports[g.sport].exactV2.push({id:`pinnacle-direct:${g.m.id}`,home_team:g.pair.home.name,away_team:g.pair.away.name,commence_time:g.m.startTime,live:false,bookmakers:[{key:'pinnacle-direct',title:'Pinnacle Direct',markets:normalized}]});health.acceptedEvents++;health.acceptedMarkets+=normalized.length;}
  health.ok=true;health.status=200;
}catch(e){health.errors.push(String(e?.message||e));health.status=health.status||500;}
for(const s of Object.keys(out.sports||{}))out.sports[s].exactV2EventCount=(out.sports[s].exactV2||[]).length;
health.errors=[...new Set(health.errors)].slice(0,20);health.fetchedAt=new Date().toISOString();out.providerHealth ||= {};out.providerHealth.pinnacle=health;out.generatedAt=new Date().toISOString();await fs.writeFile(FILE,JSON.stringify(out,null,2));
console.log('PINNACLE_DIRECT_HEALTH',JSON.stringify(health));
console.log('PINNACLE_DIRECT_COUNTS',JSON.stringify(Object.fromEntries(Object.entries(out.sports).map(([s,v])=>[s,(v.exactV2||[]).filter(e=>String(e.id).startsWith('pinnacle-direct:')).length]))));
