import fs from 'node:fs/promises';

const read=async p=>{try{return JSON.parse(await fs.readFile(p,'utf8'));}catch{return null;}};
const tp=await read('data/owls-latest.json');
const direct=await read('data/direct-sources-latest.json');
const OUT='data/simple-direct-discovery-latest.json';
const sports=['american-football','baseball','basketball','soccer','tennis','cs2','dota2','lol','valorant'];
const aliases=new Map([['natusvincere','navi'],['navi','navi'],['teamvitality','vitality'],['invictusgaming','invictus'],['jdgaming','jdg']]);
function norm(v=''){let x=String(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,'and').replace(/\b(team|esports|gaming|club|fc)\b/g,'').replace(/[^a-z0-9]/g,'');return aliases.get(x)||x;}
function similar(a,b){a=norm(a);b=norm(b);if(!a||!b)return false;if(a===b)return true;if(Math.min(a.length,b.length)>=5&&(a.includes(b)||b.includes(a)))return true;return false;}
function eventMatch(t,o){const th=t?.teams?.home?.name||t?.market?.home?.name,ta=t?.teams?.away?.name||t?.market?.away?.name,oh=o?.home_team,oa=o?.away_team;return (similar(th,oh)&&similar(ta,oa))||(similar(th,oa)&&similar(ta,oh));}
function tpH2h(e){const a=e?.market?.home,b=e?.market?.away;if(Number(a?.odds)>1&&Number(b?.odds)>1)return [{name:a.name,odds:Number(a.odds)},{name:b.name,odds:Number(b.odds)}];for(const m of e?.preferredMarkets||[]){if(!/winner|moneyline/i.test(`${m.name||''} ${m.nickName||''}`)||/map|round|half/i.test(`${m.name||''} ${m.nickName||''}`))continue;const s=(m.selections||[]).filter(x=>Number(x.odds)>1);if(s.length===2)return s.map(x=>({name:x.name,odds:Number(x.odds)}));}return null;}
function outsideH2h(e){const rows=[];for(const b of e?.bookmakers||[])for(const m of b.markets||[]){if(!['h2h','moneyline','match_winner'].includes(String(m.key||'').toLowerCase()))continue;const s=(m.outcomes||m.selections||[]).filter(x=>Number(x.price??x.odds)>1);if(s.length===2)rows.push({book:b.title||b.key||'direct',selections:s.map(x=>({name:x.name,odds:Number(x.price??x.odds)}))});}return rows;}
function impliedFair(pair,target){const ps=pair.map(x=>1/x.odds),z=ps[0]+ps[1];const i=pair.findIndex(x=>similar(x.name,target));return i<0?null:ps[i]/z;}
function targetPrice(pair,target){const x=pair.find(v=>similar(v.name,target));return Number(x?.odds)>1?Number(x.odds):null;}
const rows=[];
for(const sport of sports){const tes=tp?.sports?.[sport]?.data?.data||[], oes=direct?.sports?.[sport]?.exactV2||[];for(const t of tes){const th=tpH2h(t);if(!th)continue;for(const o of oes){if(!eventMatch(t,o))continue;const books=outsideH2h(o);for(const target of th){const comps=[];for(const b of books){const fair=impliedFair(b.selections,target.name),price=targetPrice(b.selections,target.name);if(fair&&price)comps.push({book:b.book,price,fairProbability:fair,fairDecimal:1/fair,selections:b.selections});}if(!comps.length)continue;const avg=comps.reduce((s,x)=>s+x.fairProbability,0)/comps.length;const ev=target.odds*avg-1;rows.push({tier:ev>=.0025?'SCREENING':'PRICE BOARD',sport,match:t.name||`${t?.teams?.home?.name} vs ${t?.teams?.away?.name}`,target:target.name,market:'Match Winner',marketKey:'h2h',line:null,scope:{map:null,round:null},thunderpick:target.odds,outside:comps,independentSources:new Set(comps.map(x=>x.book)).size,fairProbability:avg,fairDecimal:1/avg,estimatedEV:ev,startTime:t.startTime||null,blocker:'Loose event discovery; exact contract verification required before ACTION'});}}}}
rows.sort((a,b)=>(b.estimatedEV??-99)-(a.estimatedEV??-99));
const out={generatedAt:new Date().toISOString(),mode:'loose-direct-discovery-priced-v2',providerHealth:direct?.providerHealth||{},counts:{rows:rows.length,screening:rows.filter(x=>x.tier==='SCREENING').length,priceBoard:rows.filter(x=>x.tier==='PRICE BOARD').length},rows:rows.slice(0,250)};
await fs.writeFile(OUT,JSON.stringify(out,null,2));
console.log('SIMPLE_DIRECT_DISCOVERY',out.counts,JSON.stringify(out.providerHealth));
