import fs from 'node:fs/promises';

const SPORTS=['american-football','baseball','basketball','soccer','tennis','cs2','dota2','lol','valorant'];
const PREFIX='pinnwire-direct:';
const MAX_AGE_MS=40*60*1000;
const copy=x=>JSON.parse(JSON.stringify(x??{}));
const validTime=x=>Number.isFinite(Date.parse(x||''))?Date.parse(x):null;
const fresh=(iso,now,maxAgeMs)=>{const t=validTime(iso);return t!==null&&t<=now+30000&&t>=now-maxAgeMs;};

export function publishPinnwireSnapshot(direct={}, {now=Date.now()}={}){
  const sports={};
  for(const sport of SPORTS){
    const events=(direct?.sports?.[sport]?.exactV2||[]).filter(e=>String(e?.id||'').startsWith(PREFIX));
    sports[sport]={exactV2:copy(events)};
  }
  return {
    generatedAt:new Date(now).toISOString(),
    source:'pinnwire-github-readonly-snapshot',
    providerHealth:{pinnwire:copy(direct?.providerHealth?.pinnwire||{})},
    sports
  };
}

function qualify(event,observedAt,now){
  if(!String(event?.id||'').startsWith(PREFIX))return null;
  const teams=[String(event.home_team||'').trim(),String(event.away_team||'').trim()];
  if(!teams[0]||!teams[1]||teams[0].toLowerCase()===teams[1].toLowerCase())return null;
  const start=validTime(event.commence_time);
  if(start===null||start<now-5*60*1000||start>now+30*86400000||event.live===true)return null;
  const books=[];
  for(const b of event.bookmakers||[]){
    if(!String(b.key||'').includes('pinnacle'))continue;
    const markets=[];
    for(const m of b.markets||[]){
      if(!['h2h','spreads','totals','team_totals'].includes(m.key))continue;
      // Never pretend an unspecified PinnWire period represents a specific esports map.
      if(m.scope?.period==null||Number(m.scope.period)!==0)continue;
      if(m.key!=='h2h' && (!Number.isFinite(Number(m.line))||m.line==null))continue;
      if(!Array.isArray(m.outcomes)||m.outcomes.length!==2||!m.outcomes.every(o=>o.name&&Number.isFinite(Number(o.price))&&Number(o.price)>1))continue;
      markets.push({...copy(m),observedAt,last_update:observedAt});
    }
    if(markets.length)books.push({...copy(b),key:'pinnacle-direct',sourceFamily:'pinnacle',markets});
  }
  return books.length?{...copy(event),bookmakers:books}:null;
}

export function mergePinnwireSnapshot(direct={},snapshot={}, {now=Date.now(),maxAgeMs=MAX_AGE_MS}={}){
  const base=copy(direct);base.sports ||= {};base.providerHealth ||= {};
  for(const sport of SPORTS){
    base.sports[sport] ||= {exactV2:[]};
    base.sports[sport].exactV2=(base.sports[sport].exactV2||[]).filter(e=>!String(e?.id||'').startsWith(PREFIX));
  }
  const health=snapshot?.providerHealth?.pinnwire||{};
  const ageOk=fresh(snapshot?.generatedAt,now,maxAgeMs)&&fresh(health.fetchedAt,now,maxAgeMs);
  let state='UNAVAILABLE';
  if(snapshot?.generatedAt&&!ageOk)state='STALE';
  else if(snapshot?.generatedAt && !(health.ok===true&&health.status===200))state='SOURCE_FAILED';
  else if(snapshot?.generatedAt)state='NO_QUALIFYING_QUOTES';
  let eventCount=0,marketCount=0;
  if(ageOk&&health.ok===true&&health.status===200){
    for(const sport of SPORTS){
      const seen=new Set();
      for(const e of snapshot?.sports?.[sport]?.exactV2||[]){
        const row=qualify(e,health.fetchedAt,now);
        if(!row||seen.has(row.id))continue;
        seen.add(row.id);base.sports[sport].exactV2.push(row);eventCount++;
        marketCount+=row.bookmakers.reduce((n,b)=>n+(b.markets?.length||0),0);
      }
    }
    if(eventCount>0&&marketCount>0)state='CONNECTED_USABLE';
  }
  base.providerHealth.pinnwire={
    ok:state==='CONNECTED_USABLE',usable:state==='CONNECTED_USABLE',status:health.status??null,state,
    events:eventCount,markets:marketCount,sourceFamily:'pinnacle',
    fetchedAt:health.fetchedAt??null,generatedAt:snapshot?.generatedAt??null,
    errors:Array.isArray(health.errors)?health.errors.slice(0,3):[]
  };
  base.generatedAt=new Date(now).toISOString();
  return base;
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  const mode=process.argv[2];
  const input='data/direct-sources-latest.json';
  const artifact='data/pinnwire-source-latest.json';
  const read=async(p,fallback={})=>{try{return JSON.parse(await fs.readFile(p,'utf8'))}catch{return fallback}};
  if(mode==='publish'){
    const d=await read(input,{});const out=publishPinnwireSnapshot(d);
    await fs.writeFile(artifact,JSON.stringify(out,null,2));
    const n=Object.values(out.sports).reduce((sum,s)=>sum+s.exactV2.length,0);
    console.log('PINNWIRE_SOURCE_PUBLISHED',JSON.stringify({generatedAt:out.generatedAt,status:out.providerHealth.pinnwire.status??null,events:n,ok:out.providerHealth.pinnwire.ok===true}));
  }else if(mode==='import'){
    const d=await read(input,{}),art=await read(artifact,{});
    const out=mergePinnwireSnapshot(d,art);
    await fs.writeFile(input,JSON.stringify(out,null,2));
    console.log('PINNWIRE_SOURCE_IMPORTED',JSON.stringify(out.providerHealth.pinnwire));
  }else throw new Error('Usage: node scripts/pinnwire-bridge.mjs publish|import');
}