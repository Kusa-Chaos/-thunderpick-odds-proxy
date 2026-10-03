function clone(v){return JSON.parse(JSON.stringify(v??{}));}

export function mergeGgBetObjectiveArtifact(baseInput,artifactInput,{nowMs=Date.now(),maxAgeMs=10*60*1000}={}){
  const base=clone(baseInput);
  const artifact=artifactInput||{};
  base.providerHealth ||= {};
  base.sports ||= {};
  const generatedMs=Date.parse(artifact.generatedAt||'');
  const ageMs=Number.isFinite(generatedMs)?Math.max(0,nowMs-generatedMs):Infinity;
  const sourceEvents=['lol','dota2'].reduce((n,s)=>n+((artifact?.sports?.[s]?.exactV2||[]).length),0);
  const fresh=Number.isFinite(generatedMs)&&ageMs<=maxAgeMs;
  const healthy=artifact.connected===true&&artifact.usable===true&&fresh&&Array.isArray(artifact.errors)&&(artifact.errors.length===0)&&sourceEvents>0;
  let state=artifact.state||'UNAVAILABLE';
  if(!fresh) state='STALE';
  else if(!healthy&&sourceEvents===0&&artifact.connected===true) state=artifact.state||'CONNECTED_NO_OBJECTIVE_MARKETS';
  base.providerHealth.ggbetObjective={
    connected:artifact.connected===true,
    usable:healthy,
    state,
    events:healthy?sourceEvents:0,
    errors:Array.isArray(artifact.errors)?artifact.errors:[],
    generatedAt:artifact.generatedAt||null,
    ageMs:Number.isFinite(ageMs)?ageMs:null
  };
  if(!healthy) return base;
  for(const sport of ['lol','dota2']){
    base.sports[sport] ||= {exactV2:[]};
    base.sports[sport].exactV2 ||= [];
    const incoming=artifact?.sports?.[sport]?.exactV2||[];
    base.sports[sport].exactV2.push(...clone(incoming));
  }
  return base;
}
