function num(v){
  if(v===null||v===undefined||v==='') return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}

function norm(v=''){
  return String(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'').trim();
}

function teamNames(event={}){
  const home=event.home??event.home_team??event?.teams?.home?.name??event?.market?.home?.name??null;
  const away=event.away??event.away_team??event?.teams?.away?.name??event?.market?.away?.name??null;
  return [home,away].filter(Boolean).map(String);
}

function mapNumber(market={}){
  for(const v of [market?.scope?.map,market?.map,market?.mapNumber,market?.map_number]){
    const n=num(v); if(n!==null)return n;
  }
  if(String(market?.period?.type||'').toLowerCase()==='map'){
    const n=num(market?.period?.number); if(n!==null)return n;
  }
  const text=[market.name,market.title,market.description,market.period_name,market.periodName].filter(Boolean).join(' ');
  const m=text.match(/\bmap\s*(?:=|:|#|-)?\s*(\d+)\b/i);
  return m?Number(m[1]):null;
}

function marketLine(market={}){
  for(const v of [market.baseLine,market.line,market.point,market.total]){
    const n=num(v); if(n!==null)return n;
  }
  const candidate=[];
  for(const o of [...(market.outcomes||[]),...(market.selections||[])]){
    for(const v of [o.point,o.total,o.line,o.handicap]){const n=num(v);if(n!==null)candidate.push(n);}
    const mm=String(o.name||'').match(/\b(?:over|under)\s*([+-]?\d+(?:\.\d+)?)/i);
    if(mm)candidate.push(Number(mm[1]));
  }
  if(candidate.length){
    const first=candidate[0];
    if(candidate.every(x=>Math.abs(x-first)<1e-9))return first;
  }
  const text=String(market.name||'');
  const m=text.match(/(?:first to(?: reach)?|race to|total(?:\s+\w+){0,3})\s*([+-]?\d+(?:\.\d+)?)/i);
  return m?Number(m[1]):null;
}

function targetTeam(name,event={}){
  const n=norm(name);
  const teams=teamNames(event);
  for(const t of teams){if(n.includes(norm(t)))return t;}
  if(/\bhome\b/i.test(name)&&teams[0])return teams[0];
  if(/\baway\b/i.test(name)&&teams[1])return teams[1];
  return null;
}

export function normalizeObjectiveMarket({sport='',source='',event={},market={}}={}){
  const name=String(market.name||market.title||market.marketName||market.market_name||'').trim();
  if(!name)return null;
  const lower=name.toLowerCase();
  const map=mapNumber(market);
  const line=marketLine(market);
  const target=targetTeam(name,event);
  let family=null;

  if(/first to reach kills|race to\s*\d*\s*kills?|first to\s*\d+\s*kills?/i.test(name)) family='race_to_kills';
  else if(/first blood/i.test(name)) family='first_blood';
  else if(/(?:first|1st).*tower|tower.*(?:first|1st)/i.test(name)) family='first_tower';
  else if(/(?:first|1st).*baron|baron.*(?:first|1st)/i.test(name)) family='first_baron';
  else if(/(?:first|1st).*dragon|dragon.*(?:first|1st)/i.test(name)) family='first_dragon';
  else if(/(?:first|1st).*roshan|roshan.*(?:first|1st)/i.test(name)) family='first_roshan';
  else if(/(?:first|1st).*inhibitor|inhibitor.*(?:first|1st)/i.test(name)) family='first_inhibitor';
  else if(/(?:first|1st).*barracks|barracks.*(?:first|1st)/i.test(name)) family='first_barracks';
  else if(/total.*barons?|barons?.*over\/under/i.test(name)) family='total_barons';
  else if(/total.*(?:elemental\s+)?dragons?|dragons?.*over\/under/i.test(name)) family='total_dragons';
  else if(/total.*roshans?|roshans?.*over\/under/i.test(name)) family='total_roshans';
  else if(/total.*barracks|barracks.*over\/under/i.test(name)) family='total_barracks';
  else if(/total towers? destroyed|total turrets?|towers?.*over\/under|turrets?.*over\/under/i.test(name)) family=target?'team_towers':'total_towers';
  else if(/total kills/i.test(name)){
    if(/^player\b/i.test(name)||(/map\s*\d+\s*-\s*[^-]+\s+total kills/i.test(name)&&!target&&!/\b(?:home|away)\s+total kills/i.test(name))) return null;
    family=target?'team_kills':'total_kills';
  }

  if(!family)return null;
  if(family==='race_to_kills'&&line===null)return null;
  const lineFamilies=new Set(['race_to_kills','total_towers','team_towers','total_barons','total_dragons','total_roshans','total_barracks','total_kills','team_kills']);
  return {family,map,line:lineFamilies.has(family)?line:null,target:target||null,sport:String(sport),source:String(source),label:name};
}

export function objectiveContractKey({sport='',event='',family='',target='',map=null,line=null,side='',state='prematch',settlement='standard'}={}){
  const mapPart=map===null||map===undefined?'':Number(map);
  const linePart=line===null||line===undefined?'':Number(line);
  return [
    norm(sport),norm(event),String(family).toLowerCase(),
    'target='+norm(target),'map='+mapPart,'line='+linePart,
    'side='+norm(side),'state='+String(state).toLowerCase(),'settlement='+String(settlement).toLowerCase()
  ].join('|');
}
