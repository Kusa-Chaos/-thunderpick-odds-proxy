// Never treat a generic "totals" market key as proof of identical esports
// settlement. An event can simultaneously offer Total Maps, Total Kills,
// Dragons, Towers, Barons and Rounds at the same numeric line.
export const ESPORTS_WITH_SCOPED_TOTALS=new Set(['cs2','dota2','lol','valorant']);
function numeric(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
export function esportsTotalFamily(label=''){
 const s=String(label).toLowerCase().replace(/[_-]/g,' ').replace(/\s+/g,' ').trim();
 if(/\b(?:elemental\s+dragons?|dragons?\s+elemental)\b/.test(s))return 'elemental_dragons';
 if(/\b(?:barons?|nashors?)\b/.test(s))return 'barons';
 if(/\b(?:towers?|turrets?)\b/.test(s))return 'towers';
 if(/\b(?:first\s+blood)\b/.test(s))return 'first_blood';
 if(/\b(?:kills?|frags?)\b/.test(s))return 'kills';
 if(/\b(?:rounds?)\b/.test(s))return 'rounds';
 if(/\b(?:total\s+maps|maps\s+played|number\s+of\s+maps|maps\s+total)\b/.test(s))return 'maps';
 if(/\b(?:total\s+games|games\s+played)\b/.test(s))return 'games';
 if(/\b(?:total\s+sets|sets\s+played)\b/.test(s))return 'sets';
 return null; // ambiguous metric MUST NOT contribute to exact source depth
}
export function exactEsportsTotalFamily(tp={},outside={}){
 const a=esportsTotalFamily(tp.label||tp.name||'');
 const b=esportsTotalFamily(outside.name||outside.title||'');
 if(!a||a!==b)return false;
 const tpMap=numeric(tp.scope?.map),outsideMap=numeric(outside.scope?.map);
 const tpRound=numeric(tp.scope?.round),outsideRound=numeric(outside.scope?.round);
 if(tpMap!==outsideMap||tpRound!==outsideRound)return false;
 if(a==='maps'&&(tpMap!==null||outsideMap!==null))return false;
 const tpLine=numeric(tp.selections?.[0]?.point);
 const tpOtherLine=numeric(tp.selections?.[1]?.point);
 const outsideLine=numeric(outside.line??outside.baseLine??outside.outcomes?.[0]?.point);
 if(tpLine===null||tpOtherLine===null||outsideLine===null)return false;
 if(tpLine!==tpOtherLine||tpLine!==outsideLine)return false;
 const outsidePoints=(outside.outcomes||[]).map(o=>numeric(o.point)).filter(x=>x!==null);
 if(outsidePoints.some(x=>x!==outsideLine))return false;
 return true;
}
