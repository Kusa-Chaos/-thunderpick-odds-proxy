import fs from 'node:fs/promises';
import {normalizeKambiObjectiveOffer} from './kambi-objective-normalizer.mjs';

const FILE='data/direct-sources-latest.json';
const ROOT='https://eu-offering-api.kambicdn.com/offering/v2018/ub';
const UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const NOW=Date.now(),MAX=NOW+30*24*3600e3;
const SPORT_MAP={DOTA:'dota2',LEAGUE_OF_LEGENDS:'lol'};
const PREFIX='unibet-kambi-objective:';

function isoOk(v){const t=Date.parse(v||'');return Number.isFinite(t)&&t>=NOW-5*60e3&&t<=MAX;}
function synthetic(e){return /esports battle|cyber live|efootball|e-basketball|ebasketball|virtual|simulat/i.test(`${e?.name||''} ${e?.group||''}`);}
async function getJson(url){const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':UA},redirect:'follow',signal:AbortSignal.timeout(30000)});const text=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status} ${text.slice(0,140)}`);return JSON.parse(text);}
async function mapLimit(items,limit,fn){const res=[];let i=0;async function w(){while(true){const n=i++;if(n>=items.length)return;try{res[n]=await fn(items[n])}catch(e){res[n]={__error:String(e?.message||e)}}}}await Promise.all(Array.from({length:Math.min(limit,items.length||1)},w));return res;}

const out=JSON.parse(await fs.readFile(FILE,'utf8'));
for(const sport of ['lol','dota2']){
  const bucket=out?.sports?.[sport];
  if(bucket?.exactV2)bucket.exactV2=bucket.exactV2.filter(e=>!String(e?.id||'').startsWith(PREFIX));
}
const health={ok:false,status:null,rawEvents:0,eligibleEvents:0,deepEventRequests:0,acceptedEvents:0,marketCount:0,bySport:{lol:{events:0,markets:0},dota2:{events:0,markets:0}},byFamilyHint:{},errors:[],fetchedAt:new Date().toISOString()};
try{
  const board=await getJson(`${ROOT}/listView.json?lang=en_GB&market=GB`),events=board?.events||[];
  health.rawEvents=events.length;
  const eligible=[];
  for(const row of events){
    const e=row?.event||{},sport=SPORT_MAP[e.sport];
    if(!sport||!out?.sports?.[sport]||!isoOk(e.start)||e.state==='FINISHED'||synthetic(e))continue;
    if(!e.homeName||!e.awayName)continue;
    eligible.push({e,sport});
  }
  health.eligibleEvents=eligible.length;
  const deep=await mapLimit(eligible,8,async x=>{
    health.deepEventRequests++;
    const body=await getJson(`${ROOT}/betoffer/event/${x.e.id}.json?lang=en_GB&market=GB&includeParticipants=true`);
    return {...x,offers:body?.betOffers||[]};
  });
  for(const x of deep){
    if(x?.__error){health.errors.push(x.__error);continue;}
    const {e,sport,offers}=x,markets=[];
    for(const offer of offers){
      const m=normalizeKambiObjectiveOffer(offer,e); if(!m)continue;
      markets.push(m); health.marketCount++; health.bySport[sport].markets++;
      const name=m.name||'';
      for(const hint of ['Total Towers','Total Roshans','Total Barons','Total Dragons','Total Kills']){
        if(name.includes(hint)){health.byFamilyHint[hint]=(health.byFamilyHint[hint]||0)+1;break;}
      }
    }
    if(!markets.length)continue;
    out.sports[sport].exactV2.push({id:`${PREFIX}${e.id}`,home_team:String(e.homeName),away_team:String(e.awayName),commence_time:e.start,live:false,bookmakers:[{key:'unibet-kambi-objective',title:'Unibet/Kambi Direct',markets}]});
    health.acceptedEvents++;health.bySport[sport].events++;
  }
  health.ok=true;health.status=200;
}catch(e){health.status=500;health.errors.push(String(e?.message||e));}
health.errors=[...new Set(health.errors)].slice(0,20);health.fetchedAt=new Date().toISOString();
out.providerHealth||={};out.providerHealth.kambiObjective=health;out.generatedAt=new Date().toISOString();
for(const s of Object.keys(out.sports||{}))out.sports[s].exactV2EventCount=(out.sports[s].exactV2||[]).length;
await fs.writeFile(FILE,JSON.stringify(out,null,2));
console.log('KAMBI_OBJECTIVE_HEALTH',JSON.stringify(health));
