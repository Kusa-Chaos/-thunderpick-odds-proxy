const BOOKMAKER_ALIASES=[
  ['thunderpick','thunderpick'],
  ['pinnwire','pinnacle'],['pinnacle','pinnacle'],
  ['oddin','stake-oddin'],['stake','stake-oddin'],
  ['unibet','unibet-kambi'],['kambi','unibet-kambi'],
  ['ggbet','ggbet'],['cloudbet','cloudbet'],['betway','betway'],
  ['bet365','bet365'],['rivalry','rivalry'],['1xbet','1xbet'],
  ['betano','betano'],['roobet','roobet'],['fanduel','fanduel'],
  ['draftkings','draftkings'],['bovada','bovada'],
];
export const NEW_BOOKMAKER_FAMILIES=['1xbet','bet365','betano','rivalry','roobet','unibet-kambi'];
export function canonicalBookmakerFamily(raw){
  const x=String(raw||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  for(const [needle,name] of BOOKMAKER_ALIASES)if(x.includes(needle))return name;
  return null;
}
export const ODDS_PAPI_ESPORT_SPORTS=Object.freeze({cs2:17,dota2:16,lol:18,valorant:61});
const validCount=v=>typeof v==='number'&&Number.isInteger(v)&&v>=0?v:null;
export function readOddsPapiEntitlement(account={}){
  const subs=Array.isArray(account.subscriptions)?account.subscriptions:[];
  const active=subs.find(s=>s?.subscription_id===account.current_subscription_id&&s?.is_active===true)
    || subs.find(s=>s?.is_active===true);
  if(!active)return {state:'NO_ACTIVE_SUBSCRIPTION',sports:[],remaining:null,candidateFamilies:[],hasPinnacle:false};
  const ids=new Set(Array.isArray(active.sport_ids)?active.sport_ids.map(Number):[]);
  const sports=Object.entries(ODDS_PAPI_ESPORT_SPORTS).filter(([,id])=>ids.has(id)).map(([name])=>name);
  const books=Object.keys(active.bookmakers&&typeof active.bookmakers==='object'?active.bookmakers:{});
  const families=new Set(books.map(canonicalBookmakerFamily).filter(Boolean));
  const candidateFamilies=NEW_BOOKMAKER_FAMILIES.filter(f=>families.has(f));
  const limit=validCount(active.request_limit),used=validCount(active.request_count);
  const remaining=limit===null||used===null?null:Math.max(0,limit-used);
  const state=!sports.length?'ESPORTS_NOT_AUTHORIZED':
    remaining===null?'QUOTA_UNVERIFIED':
    remaining===0?'QUOTA_EXHAUSTED':
    !candidateFamilies.length?'NO_NEW_FAMILIES':'ESPORTS_ELIGIBLE';
  return {state,sports,remaining,candidateFamilies,hasPinnacle:families.has('pinnacle'),
    licensedBookmakerFamilies:[...families].sort()};
}
