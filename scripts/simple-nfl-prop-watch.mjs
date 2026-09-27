import fs from 'node:fs/promises';

const read=async p=>{try{return JSON.parse(await fs.readFile(p,'utf8'));}catch{return null;}};
const tp=await read('data/owls-latest.json');
const direct=await read('data/direct-sources-latest.json');
const screen=await read('data/screen-latest.json');
const meta=await read('data/owls-meta.json');
if(!tp||!direct||!screen) throw new Error('required NFL prop inputs missing');

const now=Date.now();
const STAT_MAP=new Map([
  ['passing yards','passing_yards'],
  ['rushing yards','rushing_yards'],
  ['receiving yards','receiving_yards'],
  ['receptions','receptions'],
  ['passing touchdowns','passing_touchdowns'],
  ['passing touchdown','passing_touchdowns'],
  ['touchdown passes thrown','passing_touchdowns']
]);
const KEY_TO_STAT={
  player_passing_yards:'passing_yards',
  player_rushing_yards:'rushing_yards',
  player_receiving_yards:'receiving_yards',
  player_receptions:'receptions',
  player_passing_touchdowns:'passing_touchdowns'
};
const STAT_LABEL={passing_yards:'Passing Yards',rushing_yards:'Rushing Yards',receiving_yards:'Receiving Yards',receptions:'Receptions',passing_touchdowns:'Passing Touchdowns'};

function norm(v=''){return String(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,'and').replace(/\b(team|football club|club)\b/g,'').replace(/[^a-z0-9]/g,'');}
function same(a,b){return Boolean(norm(a))&&norm(a)===norm(b);}
function pairKey(a,b){return [norm(a),norm(b)].sort().join('|');}
function timeMs(v){const n=Number(v);if(Number.isFinite(n)&&n>1e11)return n;const t=Date.parse(v||'');return Number.isFinite(t)?t:null;}
function timeCompatible(a,b){const x=timeMs(a),y=timeMs(b);return x!=null&&y!=null&&Math.abs(x-y)<=2*3600e3;}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function lineOfSelection(s={}){for(const v of [s.total,s.point,s.line,s.handicap]){const n=num(v);if(n!=null)return n;}return null;}
function specText(spec='',key){const m=String(spec).match(new RegExp('(?:^|[;&,|])\\s*'+key+'=([^;&,|]+)','i'));return m?decodeURIComponent(String(m[1]).trim()):null;}
function specNum(spec='',key){const v=specText(spec,key);return v==null?null:num(v);}
function canonicalBook(v=''){const x=String(v).toLowerCase();if(x.includes('unibet')||x.includes('kambi'))return'unibet-kambi';if(x.includes('bovada'))return'bovada';if(x.includes('stake')||x.includes('oddin'))return'stake-oddin';if(x.includes('pinnacle'))return'pinnacle';if(x.includes('betway'))return'betway';if(x.includes('kalshi'))return'kalshi';if(x.includes('polymarket'))return'polymarket';return x.replace(/[^a-z0-9]/g,'');}
function tpFresh(){const m=meta?.sports?.['american-football'];return Boolean(m&&m.httpOk!==false&&!m.usedFallback&&Number(m.status||200)<400);}

function parseTpProp(m={}){
  const text=[m.nickName,m.name].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  const pm=text.match(/\bPlayer\s+(.+?)\s*-\s*Total\s+(Passing Yards|Rushing Yards|Receiving Yards|Receptions|Passing Touchdowns?|Touchdown Passes Thrown)\s+Over\/Under\b/i);
  if(!pm)return null;
  const player=pm[1].trim(),stat=STAT_MAP.get(pm[2].toLowerCase());if(!player||!stat)return null;
  const sels=(m.selections||[]).filter(s=>Number(s.odds)>1);
  const over=sels.find(s=>/^over\b/i.test(String(s.name||''))),under=sels.find(s=>/^under\b/i.test(String(s.name||'')));
  if(!over||!under)return null;
  const lo=lineOfSelection(over),lu=lineOfSelection(under),line=lo??lu;if(line==null||(lo!=null&&lu!=null&&Math.abs(lo-lu)>.001))return null;
  return{player,stat,line,overOdds:Number(over.odds),underOdds:Number(under.odds),label:text};
}
function tpEvents(){return tp?.sports?.['american-football']?.data?.data||[];}
function outsideEvents(){return direct?.sports?.['american-football']?.exactV2||[];}
function tpPair(e={}){return[e?.teams?.home?.name||e?.market?.home?.name,e?.teams?.away?.name||e?.market?.away?.name];}
function outsidePlayer(m={}){return m.player||m.player_name||m.playerName||m.description||specText(m.specifiers,'player')||(m.outcomes||[]).map(o=>o.player||o.description).find(Boolean)||null;}
function outsideStat(m={}){const k=String(m.key||'').toLowerCase().replace(/[- ]/g,'_');return KEY_TO_STAT[k]||STAT_MAP.get(String(specText(m.specifiers,'stat')||'').toLowerCase())||null;}
function outsideLine(m={}){for(const v of [m.line,specNum(m.specifiers,'threshold'),specNum(m.specifiers,'line')]){const n=num(v);if(n!=null)return n;}for(const o of m.outcomes||[]){for(const v of [o.point,o.total,o.line,o.handicap]){const n=num(v);if(n!=null)return n;}}return null;}
function side(o={}){const s=String(o.name||o.label||o.side||o.type||'').toLowerCase();if(/\bover\b|^o$/.test(s))return'over';if(/\bunder\b|^u$/.test(s))return'under';return null;}
function quote(m,bm,prop){
  const stat=outsideStat(m),player=outsidePlayer(m),line=outsideLine(m);if(stat!==prop.stat||!same(player,prop.player)||line==null||Math.abs(line-prop.line)>.001)return null;
  const os=(m.outcomes||m.selections||[]).filter(o=>Number(o.price??o.odds)>1),over=os.find(o=>side(o)==='over'),under=os.find(o=>side(o)==='under');if(!over||!under)return null;
  const a=Number(over.price??over.odds),b=Number(under.price??under.odds);if(!(a>1.01&&b>1.01&&a<20&&b<20))return null;const sum=1/a+1/b;if(sum<0.90||sum>1.15)return null;
  const ia=1/a,ib=1/b,z=ia+ib;return{book:canonicalBook(bm.key||bm.title),title:String(bm.title||bm.key||''),a,b,pA:ia/z,pB:ib/z,identityVerified:true,identityReason:null,lastUpdate:m.last_update||direct?.providerHealth?.[canonicalBook(bm.key||bm.title)]?.fetchedAt||null};
}

const outsideByPair=new Map();
for(const e of outsideEvents()){
  if(e?.live===true||String(e?.status||'').toLowerCase()==='live')continue;
  const k=pairKey(e.home_team,e.away_team);if(!k)continue;
  if(!outsideByPair.has(k))outsideByPair.set(k,[]);outsideByPair.get(k).push(e);
}

const rows=[];let eligible=0,exactOne=0,exactTwoPlus=0;
for(const e of tpEvents()){
  const start=timeMs(e.startTime);if(start==null||start<now-5*60e3||e.isLive)continue;
  const [home,away]=tpPair(e),oe=outsideByPair.get(pairKey(home,away))||[];
  for(const m of e.preferredMarkets||[]){
    const p=parseTpProp(m);if(!p)continue;eligible++;
    const byBook=new Map();
    for(const event of oe){if(!timeCompatible(e.startTime,event.commence_time))continue;for(const bm of event.bookmakers||[]){for(const om of bm.markets||[]){const q=quote(om,bm,p);if(!q?.book)continue;const old=byBook.get(q.book);if(!old||timeMs(q.lastUpdate)>timeMs(old.lastUpdate))byBook.set(q.book,q);}}}
    const quotes=[...byBook.values()];if(!quotes.length)continue;if(quotes.length===1)exactOne++;else exactTwoPlus++;
    const pOver=quotes.reduce((n,x)=>n+x.pA,0)/quotes.length,pUnder=quotes.reduce((n,x)=>n+x.pB,0)/quotes.length;
    const evOver=p.overOdds*pOver-1,evUnder=p.underOdds*pUnder-1,maxEv=Math.max(evOver,evUnder),sourceCount=quotes.length,fresh=tpFresh();
    if(maxEv<0.0025)continue;
    const actionEligible=fresh&&sourceCount>=3&&maxEv>=0.02;
    const blocker=actionEligible?null:sourceCount>=3&&!fresh?'3+ independent exact NFL prop sources, but Thunderpick refresh is stale/fallback; WATCH until fresh verification':sourceCount>=2?'2 independent exact NFL prop sources; WATCH pending third source and fresh Thunderpick verification':'1 independent exact NFL prop source; SCREENING only';
    const overSel={name:`${p.player} Over ${p.line}`,role:'over',odds:p.overOdds,point:p.line},underSel={name:`${p.player} Under ${p.line}`,role:'under',odds:p.underOdds,point:p.line};
    rows.push({sport:'american-football',eventId:e.id,name:e.name||`${home} vs ${away}`,startTime:e.startTime,prop:{player:p.player,stat:p.stat},marketKey:'player_prop',marketLabel:`${p.player} — ${STAT_LABEL[p.stat]} ${p.line}`,scope:{map:null,round:null},thunderpick:{a:overSel,b:underSel},sourceDepth:sourceCount,verifiedIdentityDepth:sourceCount,independentSources:sourceCount,verifiedIndependentSources:sourceCount,verificationTier:actionEligible?'ACTION_ELIGIBLE':sourceCount>=2?'WATCH_ONLY':'SCREENING_ONLY',actionEligible,watchEligible:sourceCount>=2&&maxEv>=0.01,outside:quotes,fair:{aProbability:pOver,bProbability:pUnder,aOdds:1/pOver,bOdds:1/pUnder},ev:{a:evOver,b:evUnder},identityVerified:true,plausible:true,blocker});
  }
}
rows.sort((a,b)=>Math.max(b.ev.a,b.ev.b)-Math.max(a.ev.a,a.ev.b));
const k=r=>[r.sport,r.eventId,r.marketKey,r.prop?.player,r.prop?.stat,r.thunderpick?.a?.point].join('|');
const candidates=screen.candidates||(screen.candidates=[]),ci=new Map(candidates.map((r,i)=>[k(r),i]));for(const r of rows){const kk=k(r);if(ci.has(kk))candidates[ci.get(kk)]=r;else candidates.push(r);}
const watches=screen.watchCandidates||(screen.watchCandidates=[]),wi=new Map(watches.map((r,i)=>[k(r),i]));for(const r of rows.filter(x=>x.watchEligible&&!x.actionEligible)){const kk=k(r);if(wi.has(kk))watches[wi.get(kk)]=r;else watches.push(r);}
const actions=screen.actionCandidates||(screen.actionCandidates=[]),ai=new Map(actions.map((r,i)=>[k(r),i]));for(const r of rows.filter(x=>x.actionEligible)){const kk=k(r);if(ai.has(kk))actions[ai.get(kk)]=r;else actions.push(r);}
screen.simpleNflProps={generatedAt:new Date().toISOString(),eligibleThunderpickProps:eligible,exactOneSource:exactOne,exactTwoPlusSources:exactTwoPlus,rows:rows.slice(0,250)};
await fs.writeFile('data/screen-latest.json',JSON.stringify(screen,null,2));
console.log('SIMPLE_NFL_PROPS',JSON.stringify({eligible,exactOne,exactTwoPlus,rows:rows.length,watch:rows.filter(x=>x.watchEligible&&!x.actionEligible).length,action:rows.filter(x=>x.actionEligible).length,top:rows.slice(0,12).map(r=>({match:r.name,player:r.prop.player,stat:r.prop.stat,line:r.thunderpick.a.point,sources:r.outside.map(x=>x.book),ev:Math.max(r.ev.a,r.ev.b),tier:r.verificationTier}))}));
