import fs from 'node:fs/promises';
import {canonicalBookmakerFamily,NEW_BOOKMAKER_FAMILIES,ODDS_PAPI_ESPORT_SPORTS,readOddsPapiEntitlement} from './third-source-eligibility.mjs';
import {normalizeOddsPapiEvent} from './oddspapi-exact-normalizer.mjs';
import {eligibleEsportsMatches} from './oddspapi-refresh-policy.mjs';

const PREFERRED=['bet365','betano','roobet','1xbet','unibet-kambi'];
const VALID_SPORTS=new Set(Object.keys(ODDS_PAPI_ESPORT_SPORTS));
const cacheAgeMs=14*86400000;
const validDate=v=>Number.isFinite(Date.parse(v||''));
const str=v=>String(v??'').trim();
export const targetPair=v=>str(v).split(/\s+(?:vs\.?|v\.)\s+/i)
 .map(x=>x.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\b(team|esports|gaming|club)\b/g,'').replace(/[^a-z0-9]/g,''))
 .filter(Boolean).sort().join('|');
function catalogEntries(all=[]){
 return all.filter(m=>VALID_SPORTS.has(Object.keys(ODDS_PAPI_ESPORT_SPORTS).find(s=>ODDS_PAPI_ESPORT_SPORTS[s]===Number(m.sportId))) &&
  (m.marketName==='Winner'||m.marketName==='Total Maps Over Under'||/^(?:First|Second|Third|Fourth|Fifth) Map Winner \(incl\. overtime\)$/i.test(str(m.marketName))) &&
  Array.isArray(m.outcomes)&&m.outcomes.length===2).slice(0,300);
}
function extractFixtureRows(v){return Array.isArray(v)?v:Array.isArray(v?.data)?v.data:Array.isArray(v?.fixtures)?v.fixtures:v?.fixtureId?[v]:[];}
export function batchBookmakers(bookmakers={},maxGroups=2){
 const entries=Object.keys(bookmakers||{}).map(slug=>({slug,family:canonicalBookmakerFamily(slug)}))
  .filter(x=>NEW_BOOKMAKER_FAMILIES.includes(x.family));
 const chosen=new Map();
 for(const family of PREFERRED){
  const match=entries.find(x=>x.family===family);
  if(match)chosen.set(family,match.slug);
 }
 const slugs=[...chosen.values()];
 const groups=[];for(let i=0;i<slugs.length&&groups.length<maxGroups;i+=3)groups.push(slugs.slice(i,i+3));
 return groups;
}
export function chooseTournament(fixtures=[],{sport,targets=[],nowMs=Date.now()}={}){
 const expected=new Set(targets.map(targetPair).filter(x=>x.includes('|')));
 const candidates=fixtures.filter(f=>Number(f?.sportId)===ODDS_PAPI_ESPORT_SPORTS[sport]&&
  Number(f?.statusId)===0&&f?.hasOdds===true&&str(f?.fixtureId)&&
  Number.isInteger(Number(f?.tournamentId))&&Number(f?.tournamentId)>0&&
  validDate(f?.startTime)&&Date.parse(f.startTime)>nowMs+5*60000&&
  Date.parse(f.startTime)<=nowMs+24*3600000&&
  expected.has(targetPair(str(f.participant1Name)+' vs '+str(f.participant2Name))));
 const groups=new Map();
 for(const row of candidates){
  const t=String(row.tournamentId);
  if(!groups.has(t))groups.set(t,[]);
  groups.get(t).push(row);
 }
 const ranked=[...groups.entries()].sort((a,b)=>b[1].length-a[1].length||
  Math.min(...a[1].map(x=>Date.parse(x.startTime)))-Math.min(...b[1].map(x=>Date.parse(x.startTime))));
 const [id,rows]=ranked[0]||[];
 return id?{tournamentId:Number(id),fixtures:rows.slice(0,12),matchCount:rows.length}:null;
}
export function fuseTournamentQuote(raw={},identity={}){
 if(str(raw.fixtureId)!==str(identity.fixtureId)||Number(raw.tournamentId)!==Number(identity.tournamentId)||
    Number(raw.sportId)!==Number(identity.sportId)||Number(raw.statusId)!==0||
    (validDate(raw.startTime)&&Math.abs(Date.parse(raw.startTime)-Date.parse(identity.startTime))>5*60000))return null;
 return {...identity,bookmakerOdds:raw.bookmakerOdds||{}};
}
export async function collectOddsPapiTournamentShadow({get,inventory={},previous={},nowIso=new Date().toISOString(),maxBillableCalls=5,strategy='tournament'}={}){
 const nowMs=Date.parse(nowIso);
 const result={generatedAt:nowIso,mode:'TOURNAMENT_SHADOW_ONLY',productionEligible:false,
  state:'INITIAL',counts:{requests:0,events:0,markets:0,books:0,fixturesExamined:0,batchedEvents:0,quoteAgeRejected:0},
  bookmakerFamilies:[],bookmakerSlugsObserved:[],errors:[],sports:{},cacheUsed:false,batchUnsupported:false,fallbackUsed:false,
  marketCatalog:null,source:strategy==='fixture'?'OddsPapi /v4/odds (verified exact fixture)':'OddsPapi /v4/odds-by-tournaments'};
 if(typeof get!=='function'||!Number.isFinite(nowMs)){result.state='INVALID_INPUT';return result;}
 let billable=0;
 const limit=Math.max(0,Math.min(5,Number(maxBillableCalls)||0));
 const call=async(path,params={})=>{
  if(path!=='/account'){if(billable>=limit)throw Error('REQUEST_BUDGET_EXHAUSTED');billable++;}
  return get(path,params);
 };
 try{
  const account=await call('/account');
  const access=readOddsPapiEntitlement(account);
  result.entitlement={state:access.state,remaining:access.remaining,sports:access.sports,candidateFamilies:access.candidateFamilies};
  if(access.state!=='ESPORTS_ELIGIBLE'){result.state=access.state;return result;}
  const remaining=access.remaining-25;
  if(remaining<3){result.state='MONTHLY_QUOTA_RESERVED';return result;}
  const allowed=Math.min(limit,remaining);
  const current=account.subscriptions?.find(s=>s?.subscription_id===account.current_subscription_id&&s.is_active)
   ||account.subscriptions?.find(s=>s?.is_active);
  const groups=batchBookmakers(current?.bookmakers||{});
  if(!groups.length){result.state='NO_VERIFIED_BOOKMAKER_FAMILIES';return result;}
  const previousCatalog=previous.marketCatalog;
  let catalog=[];
  if(previousCatalog&&validDate(previousCatalog.fetchedAt)&&nowMs-Date.parse(previousCatalog.fetchedAt)<cacheAgeMs&&
    nowMs>=Date.parse(previousCatalog.fetchedAt)&&Array.isArray(previousCatalog.entries)&&previousCatalog.entries.length){
    catalog=previousCatalog.entries;result.cacheUsed=true;
  }else{
    if(billable>=allowed){result.state='QUOTA_RESERVED';return result;}
    const marketResponse=await call('/markets',{language:'en'});
    catalog=catalogEntries(extractFixtureRows(marketResponse));
    if(!catalog.length){result.state='MARKET_CATALOG_MISSING';return result;}
  }
  result.marketCatalog={fetchedAt:result.cacheUsed?previousCatalog.fetchedAt:nowIso,entries:catalog};
  const events=eligibleEsportsMatches(inventory,nowMs,24);
  const sports=[...new Set(events.map(e=>e.sport))].filter(s=>access.sports.includes(s));
  if(!sports.length){result.state='NO_UPCOMING_MATCHES';return result;}
  const totals=new Map(),slugs=new Set(),families=new Set();
  for(const sport of sports){
    if(billable+2>allowed)break; // one fixtures discovery and >=one bookmaker batch
    let fixtureList=[];
    try{
      const response=await call('/fixtures',{sportId:ODDS_PAPI_ESPORT_SPORTS[sport],from:nowIso,
       to:new Date(nowMs+24*3600000).toISOString(),statusId:0,hasOdds:true,language:'en'});
      fixtureList=extractFixtureRows(response);
    }catch(e){result.errors.push(sport+':'+str(e?.name||e?.message).slice(0,50));continue;}
    result.counts.fixturesExamined+=fixtureList.length;
    const selection=chooseTournament(fixtureList,{sport,targets:events.filter(e=>e.sport===sport).map(e=>e.name),nowMs});
    result.sports[sport]={tournamentId:selection?.tournamentId||null,targetedFixtures:selection?.matchCount||0,exactV2:[]};
    if(!selection)continue;
    const known=new Map(selection.fixtures.map(f=>[str(f.fixtureId),f]));
    if(strategy==='fixture'){
      // Production mode: the tournament API returned HTTP 400 on this account.
      // Use the confirmed authorized fixture endpoint only. One precise target
      // per authorized run, without a deliberate failing/paid batch request.
      const fixture=selection.fixtures[0];
      if(billable<allowed){
        try{
          const raw=await call('/odds',{fixtureId:str(fixture.fixtureId),oddsFormat:'decimal',language:'en',verbosity:3});
          if(str(raw?.fixtureId)!==str(fixture.fixtureId)||Number(raw?.sportId)!==Number(fixture.sportId)||
             Number(raw?.statusId)!==0||
             (validDate(raw?.startTime)&&Math.abs(Date.parse(raw.startTime)-Date.parse(fixture.startTime))>5*60000)){
            result.errors.push('fixture:IDENTITY_MISMATCH');
          }else{
            const bookmakerOdds={};
            for(const [slug,book] of Object.entries(raw?.bookmakerOdds||{})){
              if(!NEW_BOOKMAKER_FAMILIES.includes(canonicalBookmakerFamily(slug)))continue;
              slugs.add(slug);bookmakerOdds[slug]=book;
            }
            if(Object.keys(bookmakerOdds).length)totals.set(str(fixture.fixtureId),{fixture,bookmakerOdds,sport});
            result.fallbackUsed=true;
          }
        }catch(e){result.errors.push('fixture:'+str(e?.name||e?.message).slice(0,45));}
      }
      break;
    }
    const selectedFamilyBatches=groups.slice(0,Math.max(0,allowed-billable));
    for(const batch of selectedFamilyBatches){
      try{
        const response=await call('/odds-by-tournaments',{tournamentIds:String(selection.tournamentId),
         bookmakers:batch.join(','),language:'en',verbosity:3});
        const rawRows=extractFixtureRows(response);
        result.counts.batchedEvents+=rawRows.length;
        for(const raw of rawRows){
          const fixture=known.get(str(raw?.fixtureId));
          if(!fixture)continue;
          const fixed=fuseTournamentQuote(raw,fixture);
          if(!fixed)continue;
          const id=str(fixed.fixtureId);
          const current=totals.get(id)||{fixture,bookmakerOdds:{},sport};
          for(const [slug,book] of Object.entries(raw.bookmakerOdds||{})){
            if(!batch.includes(slug))continue;
            slugs.add(slug);
            current.bookmakerOdds[slug]=book;
          }
          totals.set(id,current);
        }
      }catch(e){
        const label=str(e?.name||'REQUEST_FAILED').slice(0,28);
        const detail=str(e?.detail||'').slice(0,120);
        result.errors.push('batch:'+label+(detail?':'+detail:''));
        // Two 400s on the same tournament add cost but no information.
        if(label==='HTTP_400'){result.batchUnsupported=true;break;}
      }
    }
    if(result.batchUnsupported&&billable<allowed&&selection.fixtures.length){
      // Authorized single-fixture endpoint was previously verified to return
      // bookmaker-attributed data; fallback consumes at most ONE extra call.
      const fixture=selection.fixtures[0];
      try{
        const raw=await call('/odds',{fixtureId:str(fixture.fixtureId),oddsFormat:'decimal',language:'en',verbosity:3});
        const fixed=fuseTournamentQuote({...fixture,...raw},fixture);
        if(fixed){
          const odds={};
          for(const [slug,book] of Object.entries(fixed.bookmakerOdds||{})){
            if(!batchBookmakers({[slug]:{}}).length)continue;
            slugs.add(slug);odds[slug]=book;
          }
          if(Object.keys(odds).length){
            totals.set(str(fixture.fixtureId),{fixture,bookmakerOdds:odds,sport});
            result.fallbackUsed=true;
          }
        }
      }catch(e){result.errors.push('fallback:'+str(e?.name||e?.message).slice(0,45));}
    }
    break; // only one targeted tournament per run; never consume quota scanning everywhere
  }
  for(const [id,entry] of totals){
    const {fixture,bookmakerOdds,sport}=entry;
    const merged={...fixture,fixtureId:id,bookmakerOdds};
    const unfiltered=normalizeOddsPapiEvent(merged,catalog,{fetchedAt:nowIso});
    const valid=normalizeOddsPapiEvent(merged,catalog,{fetchedAt:nowIso,requireQuoteTimestamps:true});
    const allCount=unfiltered?.bookmakers?.reduce((sum,b)=>sum+b.markets.length,0)||0;
    const validCount=valid?.bookmakers?.reduce((sum,b)=>sum+b.markets.length,0)||0;
    result.counts.quoteAgeRejected+=Math.max(0,allCount-validCount);
    if(!valid?.bookmakers?.length)continue;
    result.sports[sport].exactV2.push(valid);
    result.counts.events++;
    for(const b of valid.bookmakers){
      families.add(b.sourceFamily);
      result.counts.markets+=b.markets.length;
    }
  }
  result.bookmakerSlugsObserved=[...slugs].sort();
  result.bookmakerFamilies=[...families].sort();
  result.counts.books=families.size;
  result.state=result.counts.events?'COLLECTED':'NO_FRESH_EXACT_QUOTE_TIMESTAMPS';
 }catch(e){result.state='COLLECTOR_ERROR';result.errors.push(str(e?.name||e?.message).slice(0,60));}
 finally{result.counts.requests=billable;}
 return result;
}
async function run(){
 const key=str(process.env.ODDSPAPI_API_KEY);
 if(!key){console.log('ODDSPAPI_TOURNAMENT_SHADOW',JSON.stringify({state:'NO_KEY_CONFIGURED'}));return;}
 let inventory={},previous={};
 try{inventory=JSON.parse(await fs.readFile(process.env.ODDSPAPI_INVENTORY_FILE||'data/owls-latest.json','utf8'));}catch{}
 try{previous=JSON.parse(await fs.readFile(process.env.ODDSPAPI_PREVIOUS_FILE||'/tmp/oddspapi-tournament-previous.json','utf8'));}catch{}
 let last=0;
 const get=async(path,params={})=>{
  if(last){const pause=2200-(Date.now()-last);if(pause>0)await new Promise(ok=>setTimeout(ok,pause));}
  const url=new URL('https://api.oddspapi.io/v4'+path);
  url.searchParams.set('apiKey',key);
  for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
  last=Date.now();
  const res=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000)});
  if(!res.ok){
    let payload={};try{payload=await res.json();}catch{}
    const safe=x=>str(x).replace(/pk_[A-Za-z0-9_-]+/g,'[redacted]').replace(/apiKey[^\\s,]*/ig,'[redacted]').slice(0,90);
    // Return public API error code/message only, never URL or credentials.
    const detail=[safe(payload.code||payload.errorCode),safe(payload.message||payload.error)]
     .filter(Boolean).join(':');
    throw Object.assign(Error('upstream status'),{name:'HTTP_'+res.status,detail});
  }
  return res.json();
 };
 const result=await collectOddsPapiTournamentShadow({get,inventory,previous,
  maxBillableCalls:Number(process.env.ODDSPAPI_MAX_BILLABLE_REQUESTS||5),strategy:process.env.ODDSPAPI_COLLECTION_MODE||'tournament'});
 await fs.mkdir('data',{recursive:true});
 await fs.writeFile('data/oddspapi-tournament-shadow-latest.json',JSON.stringify(result));
 console.log('ODDSPAPI_TOURNAMENT_SHADOW',JSON.stringify({
  state:result.state,generatedAt:result.generatedAt,counts:result.counts,
  bookmakerFamilies:result.bookmakerFamilies,bookmakerSlugsObserved:result.bookmakerSlugsObserved,
  cacheUsed:result.cacheUsed,batchUnsupported:result.batchUnsupported,fallbackUsed:result.fallbackUsed,entitlement:result.entitlement,
  sports:Object.fromEntries(Object.entries(result.sports).map(([s,v])=>[s,{tournamentId:v.tournamentId,targetedFixtures:v.targetedFixtures,accepted:v.exactV2?.length||0}])),
  errors:result.errors,productionEligible:false
 }));
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)await run();
