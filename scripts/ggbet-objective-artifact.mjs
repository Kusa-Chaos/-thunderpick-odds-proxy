import fs from 'node:fs/promises';
import path from 'node:path';
import {normalizeGGBetEvent} from './ggbet-objective-normalizer.mjs';

export function buildGgBetObjectiveArtifact(raw={}){
  const errors=Array.isArray(raw.errors)?raw.errors.map(String):[];
  if(raw.errorMessage)errors.push(String(raw.errorMessage));
  const sports={lol:{exactV2:[]},dota2:{exactV2:[]}};
  let markets=0;
  for(const sport of ['lol','dota2']){
    for(const event of raw?.sports?.[sport]?.events||[]){
      const normalized=normalizeGGBetEvent(event,sport);
      const count=normalized?.bookmakers?.[0]?.markets?.length||0;
      if(!count)continue;
      markets+=count;
      sports[sport].exactV2.push(normalized);
    }
  }
  const events=sports.lol.exactV2.length+sports.dota2.exactV2.length;
  const connected=raw.connected===true;
  const usable=connected&&errors.length===0&&events>0&&markets>0;
  const state=usable?'CONNECTED_USABLE':connected?(errors.length?'ERROR':'CONNECTED_NO_OBJECTIVE_MARKETS'):'DISCONNECTED';
  return {
    generatedAt:raw.generatedAt||new Date().toISOString(),
    source:'ggbet-objective',connected,usable,state,events,markets,errors:[...new Set(errors)].slice(0,20),
    discovery:raw.discovery||null,
    fetched:raw.fetched||null,
    sports
  };
}

if(path.basename(process.argv[1]||'')==='ggbet-objective-artifact.mjs'){
  const input=process.env.GGBET_RAW_FILE||'data/ggbet-objective-raw-latest.json';
  const output=process.env.GGBET_ARTIFACT_FILE||'data/ggbet-objective-latest.json';
  let raw={connected:false,errors:['raw artifact unavailable']};
  try{raw=JSON.parse(await fs.readFile(input,'utf8'));}catch(e){raw.errors=[String(e?.message||e)];}
  const out=buildGgBetObjectiveArtifact(raw);
  await fs.writeFile(output,JSON.stringify(out,null,2));
  console.log('GGBET_OBJECTIVE_ARTIFACT',JSON.stringify({generatedAt:out.generatedAt,connected:out.connected,usable:out.usable,state:out.state,events:out.events,markets:out.markets,errors:out.errors,bySport:{lol:out.sports.lol.exactV2.length,dota2:out.sports.dota2.exactV2.length}}));
}
