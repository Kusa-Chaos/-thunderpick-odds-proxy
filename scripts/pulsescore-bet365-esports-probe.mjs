import fs from 'node:fs/promises';

const KEY=(process.env.PULSESCORE_API_KEY||'').trim();
const OUT='data/pulsescore-bet365-esports-latest.json';
const BASE='https://api.pulsescore.net/api/v3/bet365';

const result={
  generatedAt:new Date().toISOString(),
  mode:'pulsescore-bet365-esports-shadow-v1',
  configured:Boolean(KEY),
  endpointUsed:null,
  status:null,
  ok:false,
  eventCount:0,
  leagueCount:0,
  marketCount:0,
  objectiveMarketCount:0,
  families:{},
  samples:[],
  errors:[]
};

if(!KEY){
  await fs.mkdir('data',{recursive:true});
  await fs.writeFile(OUT,JSON.stringify(result,null,2));
  console.log('PULSESCORE_BET365_ESPORTS',JSON.stringify(result));
  process.exit(0);
}

async function get(path){
  const r=await fetch(BASE+path,{
    headers:{'X-Secret':KEY,'Accept':'application/json','Accept-Encoding':'gzip'},
    signal:AbortSignal.timeout(30000)
  });
  const text=await r.text();
  let body;
  try{body=JSON.parse(text)}catch{body={raw:text.slice(0,1200)}}
  return {status:r.status,ok:r.ok,body};
}

function eventArray(body){
  if(Array.isArray(body)) return body;
  if(Array.isArray(body?.events)) return body.events;
  if(Array.isArray(body?.data)) return body.data;
  if(Array.isArray(body?.items)) return body.items;
  return [];
}
function marketArray(ev){
  if(Array.isArray(ev?.markets)) return ev.markets;
  if(Array.isArray(ev?.mg)) return ev.mg;
  if(Array.isArray(ev?.marketGroups)) return ev.marketGroups.flatMap(x=>x?.markets||[]);
  return [];
}
function marketName(m){
  return String(m?.rawName??m?.canonicalMarket??m?.name??m?.type??'').trim();
}
function classify(name){
  const s=name.toLowerCase();
  if(/first blood/.test(s)) return 'first_blood';
  if(/first (?:to|team to)\s*(?:reach\s*)?\d+.*kill|race to\s*\d+.*kill/.test(s)) return 'race_to_kills';
  if(/first tower|first turret/.test(s)) return 'first_tower';
  if(/tower|turret/.test(s)) return /team/.test(s)?'team_towers':'total_towers';
  if(/baron/.test(s)) return 'baron';
  if(/dragon/.test(s)) return 'dragon';
  if(/roshan/.test(s)) return 'roshan';
  if(/barracks/.test(s)) return 'barracks';
  if(/team.*total.*kill|total.*team.*kill/.test(s)) return 'team_total_kills';
  if(/total.*kill|kills.*total/.test(s)) return 'total_kills';
  if(/map.*winner|winner.*map/.test(s)) return 'map_winner';
  if(/map.*handicap|handicap.*map/.test(s)) return 'map_handicap';
  if(/round.*handicap|handicap.*round/.test(s)) return 'round_handicap';
  if(/round.*total|total.*round/.test(s)) return 'round_total';
  if(/player|kills by|deaths by|assists by/.test(s)) return 'player_prop';
  return 'other';
}
function selections(m){
  if(Array.isArray(m?.selections)) return m.selections;
  if(Array.isArray(m?.ma)) return m.ma.flatMap(x=>Array.isArray(x?.pa)?x.pa.map(p=>({name:x.name??p.name,decimal:p.decimal??p.odds??p.price,line:p.handicap??p.line})):[]);
  if(Array.isArray(m?.outcomes)) return m.outcomes;
  return [];
}

const paths=['/e-sports/events?page=1&limit=30','/esports/events?page=1&limit=30'];
let chosen=null;
for(const p of paths){
  try{
    const r=await get(p);
    if(r.ok){
      chosen={path:p,...r};
      break;
    }
    result.errors.push({path:p,status:r.status,body:r.body});
  }catch(e){
    result.errors.push({path:p,error:String(e?.message||e)});
  }
}
if(!chosen){
  result.status=result.errors.at(-1)?.status??null;
  await fs.mkdir('data',{recursive:true});
  await fs.writeFile(OUT,JSON.stringify(result,null,2));
  console.log('PULSESCORE_BET365_ESPORTS',JSON.stringify(result));
  process.exit(0);
}

result.endpointUsed=chosen.path;
result.status=chosen.status;
result.ok=true;
const events=eventArray(chosen.body);
result.eventCount=events.length;
const leagues=new Set();
const familyCounts={};
let markets=0;
const samples=[];

for(const ev of events){
  if(ev?.league) leagues.add(String(ev.league));
  const ms=marketArray(ev);
  markets+=ms.length;
  for(const m of ms){
    const name=marketName(m);
    const family=classify(name);
    familyCounts[family]=(familyCounts[family]||0)+1;
    if(family!=='other' && samples.length<100){
      const sels=selections(m).slice(0,8).map(s=>({
        name:s?.name??s?.rawName??s?.selectionName??null,
        decimal:Number(s?.decimal??s?.odds??s?.price) || null,
        line:s?.line??s?.handicap??null
      }));
      samples.push({
        eventId:ev?.eventId??ev?.fi??ev?.id??null,
        esport:ev?.moreInfo?.esport??ev?.esport??ev?.game??null,
        league:ev?.league??null,
        home:ev?.home??ev?.participant1??null,
        away:ev?.away??ev?.participant2??null,
        startTime:ev?.startTime??ev?.date??null,
        live:Boolean(ev?.live),
        market:name,
        canonicalMarket:m?.canonicalMarket??null,
        period:m?.period??null,
        family,
        selections:sels
      });
    }
  }
}

result.leagueCount=leagues.size;
result.marketCount=markets;
result.families=familyCounts;
result.objectiveMarketCount=Object.entries(familyCounts).filter(([k])=>['first_blood','race_to_kills','first_tower','total_towers','team_towers','baron','dragon','roshan','barracks','total_kills','team_total_kills'].includes(k)).reduce((a,[,v])=>a+v,0);
result.samples=samples;
result.generatedAt=new Date().toISOString();

await fs.mkdir('data',{recursive:true});
await fs.writeFile(OUT,JSON.stringify(result,null,2));
console.log('PULSESCORE_BET365_ESPORTS',JSON.stringify({
  configured:result.configured,
  endpointUsed:result.endpointUsed,
  status:result.status,
  ok:result.ok,
  eventCount:result.eventCount,
  leagueCount:result.leagueCount,
  marketCount:result.marketCount,
  objectiveMarketCount:result.objectiveMarketCount,
  families:result.families,
  sampleCount:result.samples.length,
  errors:result.errors
}));
