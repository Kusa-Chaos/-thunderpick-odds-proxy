function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function specs(m={}){return Object.fromEntries((m.specifiers||[]).map(x=>[String(x.name||'').toLowerCase(),x.value]));}
function objectiveName(name=''){
  const s=String(name).toLowerCase();
  if(/win map.*total kills|total kills odd\/even|kills handicap|kill maker|ultra kill|first dragon type|baron type|both teams/.test(s))return false;
  return /race to kills|first blood|destroy first tower|first tower|first baron|kill first roshan|first roshan|first barrack|first barracks|total kills|total towers|total barons|total dragons|total roshans|total barracks/.test(s);
}
function marketLine(m={}){const s=specs(m);for(const k of ['xth','total']){const x=n(s[k]);if(x!==null)return x;}return null;}
function mapNumber(m={}){const x=n(specs(m).mapnr);return x;}
function outcomes(m={}){
  return (m.odds||[]).filter(o=>String(o.status||'').toUpperCase()!=='CANCELLED').map(o=>({name:String(o.name||'').trim(),price:n(o.value),odds:n(o.value),type:/^over\b/i.test(o.name||'')?'over':/^under\b/i.test(o.name||'')?'under':null,competitorIds:o.competitorIds||[]})).filter(o=>o.price>1);
}
export function normalizeGGBetEvent(event={},sport=''){
  const f=event.fixture||{};
  const teams=(f.competitors||[]).map(x=>x?.name).filter(Boolean);
  const markets=(event.markets||[]).filter(m=>String(m.status||'').toUpperCase()==='ACTIVE'&&objectiveName(m.name)).map(m=>({
    key:`ggbet:${m.id}`,
    name:m.name,
    title:m.name,
    marketId:m.id,
    typeId:m.typeId??null,
    mapNumber:mapNumber(m),
    baseLine:marketLine(m),
    line:marketLine(m),
    outcomes:outcomes(m),
    settlementScope:'standard'
  })).filter(m=>m.outcomes.length>=2);
  return {
    id:event.id||event.slug||f.title||null,
    name:f.title||teams.join(' vs ')||event.slug||'unknown',
    home_team:teams[0]||null,
    away_team:teams[1]||null,
    startTime:f.startTime||null,
    state:String(f.status||'').toUpperCase()==='LIVE'?'live':'prematch',
    isLive:String(f.status||'').toUpperCase()==='LIVE',
    sport,
    bookmakers:[{key:'ggbet',title:'GG.BET',lastUpdate:new Date().toISOString(),markets}]
  };
}
