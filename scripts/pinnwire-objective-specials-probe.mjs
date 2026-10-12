// Price-qualified PinnWire objective probe. ONE authorized REST request,
// no write to production, no promotions, and no fabricated map identity.
import fs from 'node:fs/promises';
const objective=/\b(?:first\s*blood|first\s*(?:baron|dragon|tower|turret|inhibitor|roshan|barracks)|total\s*(?:kills|dragons|barons|towers|roshans)|race\s*to\s*\d+\s*kills)\b/i;
const clean=s=>String(s??'').replace(/[\x00-\x1f]/g,' ').slice(0,130);
const valid=v=>typeof v==='number'&&Number.isFinite(v)&&v>1&&v<100;
function specialRows(obj={}){
 const sub=obj?.special_markets||{};
 const out=[];
 for(const [group,items] of Object.entries(sub)){
  for(const m of Array.isArray(items)?items:[]){
   const label=clean(m.name||m.description||m.type||obj.special||obj.special_category||group);
   const parts=(m.prices||[]).filter(q=>q&&valid(Number(q.price))&&clean(q.name));
   out.push({group,label,priceCount:parts.length,
    validTwoSided:parts.length===2&&parts.every(q=>valid(Number(q.price)))&&
     new Set(parts.map(q=>String(q.name).toLowerCase())).size===2,
    point:typeof m.points==='number'?m.points:null,
    period:m.period??null,map:m.map??null,marketId:m.id??null,
    outcomes:parts.slice(0,2).map(q=>({name:clean(q.name),price:Number(q.price),point:q.points??null}))});
  }
 }
 return out;
}
export function summarizePinnwireSpecials(body={}){
 const events=Array.isArray(body.events)?body.events:[];
 const summary={totalEvents:events.length,eventsWithSpecials:0,specialGroups:0,
  rawSpecialMarkets:0,namedObjectiveMarkets:0,validTwoSidedObjectiveMarkets:0,
  sampleObjectiveRows:[],sampleSpecialShapes:[],sampleEvents:[],sportCounts:{lol:0,dota2:0,cs2:0,other:0}};
 for(const e of events){
  const labels=String([e.league_name,e.home,e.away].join(' ')).toLowerCase();
  const sport=/league of legends|\blol\b|\blck\b|\blpl\b|\blec\b|\blcs\b/.test(labels)?'lol':
   /dota/.test(labels)?'dota2':/counter.?strike|\bcs2\b|csgo/.test(labels)?'cs2':'other';
  summary.sportCounts[sport]++;
  if(!['lol','dota2'].includes(sport))continue;
  if(summary.sampleEvents.length<10)summary.sampleEvents.push({
   sport,event_id:e.event_id,home:clean(e.home),away:clean(e.away),
   nestedSpecials:Array.isArray(e.specials)?e.specials.length:0,
   directSpecialMarketKeys:Object.keys(e.special_markets||{}).slice(0,8)
  });
  const all=Array.isArray(e.specials)?e.specials:[];
  if(all.length)summary.eventsWithSpecials++;
  for(const special of all){
   summary.specialGroups++;
   const rows=specialRows(special);
   summary.rawSpecialMarkets+=rows.length;
   if(summary.sampleSpecialShapes.length<8)summary.sampleSpecialShapes.push({
    name:clean(special.special||special.special_category||''),
    objectKeys:Object.keys(special||{}).slice(0,10),
    marketGroups:Object.keys(special.special_markets||{}).slice(0,8),
    sampleMarketLabel:rows[0]?.label||null
   });
   for(const row of rows){
    const actualName=[special.special,special.special_category,row.group,row.label].filter(Boolean).join(' ');
    if(!objective.test(actualName))continue;
    summary.namedObjectiveMarkets++;
    if(row.validTwoSided)summary.validTwoSidedObjectiveMarkets++;
    if(summary.sampleObjectiveRows.length<24)summary.sampleObjectiveRows.push({
     sport,home:clean(e.home),away:clean(e.away),
     special:clean(special.special||special.special_category||row.group),
     label:row.label,period:row.period,map:row.map,point:row.point,
     twoSided:row.validTwoSided,outcomes:row.outcomes
    });
   }
  }
 }
 return summary;
}
async function main(){
 const key=String(process.env.PINNWIRE_API_KEY||'').trim();
 if(!key){console.log('PINNWIRE_OBJECTIVE_PROBE',JSON.stringify({state:'KEY_MISSING',productionEligible:false}));process.exitCode=2;return;}
 const result={generatedAt:new Date().toISOString(),mode:'PINNWIRE_OBJECTIVE_SHADOW_ONLY',
  productionEligible:false,requests:0,upstreamStatus:null,state:'INITIAL',summary:null};
 try{
  const url='https://pinnwire.com/kit/v1/prematch/fixtures?sport_id=11&include_specials=nested';
  result.requests++;
  const res=await fetch(url,{headers:{Accept:'application/json','x-api-key':key},
   signal:AbortSignal.timeout(30000)});
  result.upstreamStatus=res.status;
  if(!res.ok)throw Object.assign(Error('UPSTREAM'),{name:'HTTP_'+res.status});
  const json=await res.json();
  result.summary=summarizePinnwireSpecials(json);
  result.state=result.summary.validTwoSidedObjectiveMarkets>0?'OBJECTIVE_TWO_SIDED_PRICES_FOUND':
   result.summary.namedObjectiveMarkets>0?'OBJECTIVE_NAMES_UNPRICED':'NO_OBJECTIVE_SPECIALS_VERIFIED';
 }catch(e){result.state='PROBE_UNAVAILABLE';result.error=clean(e?.name||e?.message);}
 await fs.mkdir('data',{recursive:true});
 await fs.writeFile('data/pinnwire-objective-specials-shadow-latest.json',JSON.stringify(result,null,2));
 console.log('PINNWIRE_OBJECTIVE_SPECIALS_PROBE',JSON.stringify(result));
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)await main();
