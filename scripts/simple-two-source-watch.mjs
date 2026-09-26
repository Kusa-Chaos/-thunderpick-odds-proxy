import fs from 'node:fs/promises';

const read=async p=>{try{return JSON.parse(await fs.readFile(p,'utf8'));}catch{return null;}};
const tp=await read('data/owls-latest.json');
const direct=await read('data/direct-sources-latest.json');
const screen=await read('data/screen-latest.json');
const meta=await read('data/owls-meta.json');
if(!tp||!direct||!screen) throw new Error('required scan inputs missing');

const SPORTS=['american-football','baseball','basketball','soccer','tennis','cs2','dota2','lol','valorant'];
const aliases=new Map([
  ['natusvincere','navi'],['navi','navi'],['teamvitality','vitality'],['invictusgaming','invictus'],
  ['jdgaming','jdg'],['dpluskiachallengers','dpluskiachallengers'],['dnsooperschallengers','dnsooperschallengers'],
  ['nrgesports','nrg'],['nrg','nrg']
]);
const now=Date.now();
function norm(v=''){let x=String(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,'and').replace(/\b(team|esports|gaming|club|fc)\b/g,'').replace(/[^a-z0-9]/g,'');return aliases.get(x)||x;}
function same(a,b){return Boolean(norm(a))&&norm(a)===norm(b);}
function pairExact(t,o){const th=t?.teams?.home?.name||t?.market?.home?.name,ta=t?.teams?.away?.name||t?.market?.away?.name;return(same(th,o?.home_team)&&same(ta,o?.away_team))||(same(th,o?.away_team)&&same(ta,o?.home_team));}
function timeMs(v){const t=Date.parse(v||'');return Number.isFinite(t)?t:null;}
function timeCompatible(t,o){const a=timeMs(t?.startTime),b=timeMs(o?.commence_time);return a!=null&&b!=null&&Math.abs(a-b)<=2*3600e3;}
function sportFresh(sport){const m=meta?.sports?.[sport];return Boolean(m&&m.httpOk!==false&&!m.usedFallback&&Number(m.status||200)<400);}
function tpH2h(e){const a=e?.market?.home,b=e?.market?.away;if(Number(a?.odds)>1&&Number(b?.odds)>1)return[{name:a.name,role:'home',odds:Number(a.odds),point:null},{name:b.name,role:'away',odds:Number(b.odds),point:null}];for(const m of e?.preferredMarkets||[]){if(!/winner|moneyline/i.test(`${m.name||''} ${m.nickName||''}`)||/map|round|half/i.test(`${m.name||''} ${m.nickName||''}`))continue;const s=(m.selections||[]).filter(x=>Number(x.odds)>1);if(s.length===2)return s.map((x,i)=>({name:x.name,role:i===0?'side1':'side2',odds:Number(x.odds),point:null}));}return null;}
function h2hQuotes(o){const rows=[];for(const b of o?.bookmakers||[])for(const m of b.markets||[]){if(!['h2h','moneyline','match_winner'].includes(String(m.key||'').toLowerCase()))continue;const s=(m.outcomes||m.selections||[]).filter(x=>Number(x.price??x.odds)>1);if(s.length===2)rows.push({book:String(b.key||b.title||'direct'),title:String(b.title||b.key||'direct'),lastUpdate:m.last_update||null,selections:s.map(x=>({name:String(x.name),odds:Number(x.price??x.odds)}))});}return rows;}
function canonicalBook(b=''){const x=String(b).toLowerCase();if(x.includes('stake')||x.includes('oddin'))return'stake-direct';if(x.includes('betway'))return'betway-direct';if(x.includes('pinnacle'))return'pinnacle-direct';if(x.includes('kalshi'))return'kalshi-direct';if(x.includes('polymarket'))return'polymarket-direct';return x.replace(/[^a-z0-9]/g,'');}
function orient(q,tpSel){const a=q.selections.find(x=>same(x.name,tpSel[0].name)),b=q.selections.find(x=>same(x.name,tpSel[1].name));if(!a||!b)return null;const ia=1/a.odds,ib=1/b.odds,z=ia+ib;return{book:canonicalBook(q.book),title:q.title,a:a.odds,b:b.odds,pA:ia/z,pB:ib/z,identityVerified:true,identityReason:null,lastUpdate:q.lastUpdate};}

const added=[];
for(const sport of SPORTS){const tes=tp?.sports?.[sport]?.data?.data||[],oes=direct?.sports?.[sport]?.exactV2||[];for(const t of tes){const start=timeMs(t?.startTime);if(start!=null&&start<now-5*60e3)continue;const selections=tpH2h(t);if(!selections)continue;const byBook=new Map();for(const o of oes){if(!pairExact(t,o)||!timeCompatible(t,o))continue;for(const q of h2hQuotes(o)){const oriented=orient(q,selections);if(oriented&&!byBook.has(oriented.book))byBook.set(oriented.book,oriented);}}const quotes=[...byBook.values()];if(quotes.length<2)continue;const pA=quotes.reduce((n,x)=>n+x.pA,0)/quotes.length,pB=quotes.reduce((n,x)=>n+x.pB,0)/quotes.length;const evA=selections[0].odds*pA-1,evB=selections[1].odds*pB-1,maxEv=Math.max(evA,evB);if(maxEv<0.01)continue;const fresh=sportFresh(sport),sourceCount=quotes.length;const actionEligible=fresh&&sourceCount>=3&&maxEv>=0.02;const blocker=actionEligible?null:sourceCount>=3&&!fresh?'3+ independent exact Match Winner sources, but Thunderpick refresh is stale/fallback; WATCH until fresh verification':sourceCount===2?'2 independent exact Match Winner sources; WATCH pending third source and fresh Thunderpick verification':'Below ACTION freshness/EV requirements';added.push({sport,eventId:t.id,name:t.name||`${selections[0].name} vs ${selections[1].name}`,startTime:t.startTime||null,marketKey:'h2h',marketLabel:'Match Winner',scope:{map:null,round:null},thunderpick:{a:selections[0],b:selections[1]},sourceDepth:sourceCount,verifiedIdentityDepth:sourceCount,independentSources:sourceCount,verifiedIndependentSources:sourceCount,verificationTier:actionEligible?'ACTION_ELIGIBLE':'WATCH_ONLY',actionEligible,watchEligible:true,outside:quotes,fair:{aProbability:pA,bProbability:pB,aOdds:1/pA,bOdds:1/pB},ev:{a:evA,b:evB},identityVerified:true,plausible:true,blocker});}}

const k=r=>[r.sport,r.eventId||r.name,r.marketKey,r.scope?.map??'',r.scope?.round??''].join('|');
const candidates=screen.candidates||(screen.candidates=[]);const existing=new Map(candidates.map((r,i)=>[k(r),i]));for(const r of added){const kk=k(r);if(existing.has(kk))candidates[existing.get(kk)]=r;else candidates.push(r);}
const watches=screen.watchCandidates||(screen.watchCandidates=[]),watchExisting=new Map(watches.map((r,i)=>[k(r),i]));for(const r of added.filter(x=>!x.actionEligible)){const kk=k(r);if(watchExisting.has(kk))watches[watchExisting.get(kk)]=r;else watches.push(r);}
const actions=screen.actionCandidates||(screen.actionCandidates=[]),actionExisting=new Map(actions.map((r,i)=>[k(r),i]));for(const r of added.filter(x=>x.actionEligible)){const kk=k(r);if(actionExisting.has(kk))actions[actionExisting.get(kk)]=r;else actions.push(r);}
screen.simpleExactH2h={generatedAt:new Date().toISOString(),count:added.length,actionCount:added.filter(x=>x.actionEligible).length,watchCount:added.filter(x=>!x.actionEligible).length,rows:added};
await fs.writeFile('data/screen-latest.json',JSON.stringify(screen,null,2));
console.log('SIMPLE_EXACT_H2H',JSON.stringify({count:added.length,action:added.filter(x=>x.actionEligible).length,watch:added.filter(x=>!x.actionEligible).length,rows:added.map(r=>({sport:r.sport,match:r.name,sources:r.outside.map(x=>x.book),ev:Math.max(r.ev.a,r.ev.b),fresh:sportFresh(r.sport),tier:r.verificationTier}))}));
