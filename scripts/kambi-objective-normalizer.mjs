function dec(v){const n=Number(v);return Number.isFinite(n)&&n>1000?n/1000:null;}
function point(v){const n=Number(v);return Number.isFinite(n)?n/1000:null;}
function latestDate(xs=[]){return xs.map(x=>x?.changedDate).filter(Boolean).sort().at(-1)||null;}
function eventTeams(e={}){return e.homeName&&e.awayName?[String(e.homeName),String(e.awayName)]:[];}
function canon(v=''){return String(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'').trim();}
function overUnder(offer={}){
  const active=(offer.outcomes||[]).filter(x=>!x.status||String(x.status).toUpperCase()==='OPEN');
  const ov=active.find(x=>/^over$/i.test(String(x.label||''))),un=active.find(x=>/^under$/i.test(String(x.label||'')));
  if(!ov||!un)return null;
  const lp=point(ov.line),up=point(un.line),op=dec(ov.odds),unp=dec(un.odds);
  if(lp==null||up==null||Math.abs(lp-up)>1e-9||!(op>1&&unp>1))return null;
  return {line:lp,outcomes:[{name:'Over',type:'over',price:op,point:lp},{name:'Under',type:'under',price:unp,point:lp}]};
}
export function normalizeKambiObjectiveOffer(offer={},event={}){
  const label=String(offer?.criterion?.englishLabel||offer?.criterion?.label||'').trim();
  const mm=label.match(/^Map\s*(\d+)\s*-\s*(.+)$/i); if(!mm)return null;
  const map=Number(mm[1]),body=mm[2].trim();
  if(/odd\s*\/\s*even|handicap|by the player/i.test(body))return null;
  const teams=eventTeams(event); let name=null;
  if(/^Total (?:Towers Destroyed|Turrets destroyed)$/i.test(body)) name=`Map ${map} - Total Towers Destroyed`;
  else if(/^Total Roshans Killed$/i.test(body)) name=`Map ${map} - Total Roshans Killed`;
  else if(/^Total Barons Slain$/i.test(body)) name=`Map ${map} - Total Barons`;
  else if(/^Total Dragons Slain$/i.test(body)) name=`Map ${map} - Total Dragons`;
  else if(/^Total Kills$/i.test(body)) name=`Map ${map} - Total Kills`;
  else {
    const tm=body.match(/^Total Kills by (.+)$/i);
    if(tm){const target=teams.find(t=>canon(t)===canon(tm[1])); if(target)name=`Map ${map} - ${target} Total Kills`;}
  }
  if(!name)return null;
  const q=overUnder(offer);if(!q)return null;
  return {key:'kambi-objective',name,title:label,scope:{map,round:null},line:q.line,last_update:latestDate(offer.outcomes||[]),settlementScope:'standard',outcomes:q.outcomes};
}
