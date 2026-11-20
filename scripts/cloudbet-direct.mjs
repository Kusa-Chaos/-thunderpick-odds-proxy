import fs from 'node:fs/promises';

export const cloudbetSourceFamily='cloudbet';
const SPORTS=new Map([
 ['american football','american-football'],['baseball','baseball'],['basketball','basketball'],['soccer','soccer'],['tennis','tennis'],
 ['counter-strike 2','cs2'],['counter strike 2','cs2'],['cs2','cs2'],['dota 2','dota2'],['league of legends','lol'],['valorant','valorant']
]);
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const point=s=>{const m=String(s||'').match(/([+-]?\d+(?:\.\d+)?)\s*$/);return m?Number(m[1]):null};
const mapFrom=s=>{const m=String(s||'').match(/\bmap\s*(\d+)\b/i);return m?Number(m[1]):null};
const roundFrom=s=>{const m=String(s||'').match(/\bround\s*(\d+)\b/i);return m?Number(m[1]):null};
function sportOf(ev){const raw=String(ev?.sport?.name||ev?.sport||'').toLowerCase().trim();return SPORTS.get(raw)||null}
function pair(ev){if(ev?.home&&ev?.away)return[String(ev.home),String(ev.away)];const m=String(ev?.name||'').match(/^(.+?)\s+(?:vs\.?|v\.)\s+(.+)$/i);return m?[m[1].trim(),m[2].trim()]:null}
function odds(s){const p=Number(s?.price??s?.odds);return p>1?p:null}
function scopeOf(m){const s=m?.scope||{};return{map:num(s.map)??mapFrom(m?.name),round:num(s.round)??roundFrom(m?.name),half:num(s.half),period:s.period??null,series:s.series===true}}
function normalizeMarket(m){
 const name=String(m?.name||m?.type||''); const lower=name.toLowerCase(); const scope=scopeOf(m); const sels=(m?.selections||m?.outcomes||[]).filter(x=>x?.status!=='SUSPENDED');
 if(sels.length<2)return{reject:'shape'};
 let key=null,needsScope=false,player=null,stat=null,line=num(m?.line);
 if(/player/.test(lower)&&/(kills?|assists?|deaths?|points?|rebounds?|yards?|receptions?)/.test(lower)){key='player_prop';needsScope=true;const pm=name.match(/player\s*[:\-]?\s*(.+?)\s+(?:total\s+)?(kills?|assists?|deaths?|points?|rebounds?|yards?|receptions?)/i);player=m?.player||pm?.[1]?.trim()||null;stat=m?.stat||pm?.[2]?.toLowerCase()||null}
 else if(/map\s*\d+.*winner|map winner/.test(lower)){key='map_winner';needsScope=true}
 else if(/map handicap/.test(lower)){key='map_handicap';needsScope=true}
 else if(/round handicap/.test(lower)){key='round_handicap';needsScope=true}
 else if(/round.*total|total rounds/.test(lower)){key='round_totals';needsScope=true}
 else if(/total maps|maps total/.test(lower)){key='totals';scope.series=true}
 else if(/handicap|spread|run line/.test(lower)){key='spreads'}
 else if(/total|over.?under/.test(lower)){key='totals'}
 else if(/match winner|moneyline|money line|h2h/.test(lower)){key='h2h'}
 else return{reject:'unknownMarket'};
 if(needsScope&&scope.map==null&&scope.round==null&&!scope.series)return{reject:'missingScope'};
 const outcomes=sels.map(s=>({name:String(s.name||s.label||''),price:odds(s),point:point(s.name),description:player||undefined,player:player||undefined}));
 if(outcomes.some(o=>!(o.price>1)))return{reject:'price'};
 if(['spreads','map_handicap','round_handicap'].includes(key)){
   if(outcomes.length!==2||outcomes.some(o=>o.point==null)||Math.abs(outcomes[0].point+outcomes[1].point)>.001)return{reject:'line'};
 }
 if(['totals','round_totals','player_prop'].includes(key)){
   const over=outcomes.find(o=>/^over\b/i.test(o.name)),under=outcomes.find(o=>/^under\b/i.test(o.name)); if(!over||!under)return{reject:'sides'}; line=line??over.point??under.point; if(line==null)return{reject:'line'}; over.point=line;under.point=line;
 }
 if(key==='player_prop'&&(!player||!stat))return{reject:'playerIdentity'};
 return{market:{key,name,title:name,scope,line,player:player||undefined,stat:stat||undefined,outcomes}};
}
export function normalizeCloudbetEvent(ev){
 const rejections={live:0,unsupportedSport:0,eventIdentity:0,missingScope:0,unknownMarket:0,shape:0,price:0,line:0,sides:0,playerIdentity:0};
 if(ev?.live===true||/live|in.?play/i.test(String(ev?.status||''))){rejections.live++;return{sport:sportOf(ev),exactV2:[],rejections}}
 const sport=sportOf(ev);if(!sport){rejections.unsupportedSport++;return{sport:null,exactV2:[],rejections}}
 const teams=pair(ev);if(!teams){rejections.eventIdentity++;return{sport,exactV2:[],rejections}}
 const markets=[];for(const raw of ev?.markets||[]){const n=normalizeMarket(raw);if(n.reject){rejections[n.reject]=(rejections[n.reject]||0)+1;continue}markets.push(n.market)}
 if(!markets.length)return{sport,exactV2:[],rejections};
 return{sport,rejections,exactV2:[{id:`cloudbet:${ev.id||ev.key||teams.join('-')}`,home_team:teams[0],away_team:teams[1],commence_time:ev.startTime||ev.start_time||null,live:false,bookmakers:[{key:'cloudbet',title:'Cloudbet',sourceFamily:cloudbetSourceFamily,markets}]}]};
}
export function normalizeCloudbetFeed(payload){const sports=Object.fromEntries([...new Set(SPORTS.values())].map(s=>[s,{exactV2:[]}]));const totals={events:0,acceptedEvents:0,markets:0,rejections:{}};for(const ev of payload?.events||payload||[]){totals.events++;const r=normalizeCloudbetEvent(ev);for(const[k,v]of Object.entries(r.rejections||{}))totals.rejections[k]=(totals.rejections[k]||0)+v;if(r.sport&&r.exactV2.length){sports[r.sport].exactV2.push(...r.exactV2);totals.acceptedEvents++;totals.markets+=r.exactV2[0].bookmakers[0].markets.length}}return{sports,totals}}

export async function collectCloudbet({apiKey=process.env.CLOUDBET_API_KEY,fetchImpl=fetch,endpoint=process.env.CLOUDBET_FEED_URL||'https://sports-api.cloudbet.com/pub/v2/odds/events'}={}){
 const base={generatedAt:new Date().toISOString(),source:'cloudbet',providerHealth:{cloudbet:{ok:false}},sports:Object.fromEntries([...new Set(SPORTS.values())].map(s=>[s,{exactV2:[]}]))};
 if(!apiKey){base.providerHealth.cloudbet={ok:false,degraded:true,error:'missing_api_key',fetchedAt:new Date().toISOString()};return base}
 try{const r=await fetchImpl(endpoint,{headers:{Accept:'application/json','X-API-Key':apiKey},signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);const body=await r.json();const n=normalizeCloudbetFeed(body);base.sports=n.sports;base.providerHealth.cloudbet={ok:true,status:r.status,...n.totals,fetchedAt:new Date().toISOString()};return base}catch(e){base.providerHealth.cloudbet={ok:false,degraded:true,error:String(e?.message||e),fetchedAt:new Date().toISOString()};return base}
}

if(import.meta.url===`file://${process.argv[1]}`){const out=await collectCloudbet();await fs.mkdir('data',{recursive:true});await fs.writeFile('data/cloudbet-direct-latest.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out.providerHealth.cloudbet));}
