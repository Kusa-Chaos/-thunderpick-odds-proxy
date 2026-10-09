const integerOrNull=v=>Number.isInteger(Number(v))&&v!==null&&v!==undefined?Number(v):null;
export function buildGGBetHealth(artifact={}, {now=Date.now(),maxAgeMs=40*60*1000}={}){
  const fetchedAt=artifact.generatedAt??null;
  const t=Date.parse(fetchedAt||'');
  const present=Boolean(fetchedAt)&&Number.isFinite(t);
  const fresh=present&&t<=now+30000&&t>=now-maxAgeMs;
  const errors=Array.isArray(artifact.errors)?artifact.errors.map(String).slice(0,5):[];
  const ok=fresh&&artifact.connected===true&&artifact.usable===true&&errors.length===0;
  const fetched=artifact.fetched||{};
  return {
    source:'ggbet-objective',sourceFamily:'ggbet',ok,connected:artifact.connected===true,usable:ok,
    state:!present?'UNAVAILABLE':!fresh?'STALE':ok?'CONNECTED_USABLE':String(artifact.state||'UNAVAILABLE'),
    status:null,
    generatedAt:fetchedAt,fetchedAt,
    events:integerOrNull(artifact.events),markets:integerOrNull(artifact.markets),
    normalizedMarkets:integerOrNull(artifact.markets),
    fetchSelected:integerOrNull(fetched.selected),fetchSuccessful:integerOrNull(fetched.successful),
    fetchFailed:integerOrNull(fetched.failed),
    exactMatches:null,objectiveMatches:null,rejectedIdentity:null,
    discovery:artifact.discovery||null,errors
  };
}
export function buildPinnacleFamilyHealth(direct={}){
  const native=direct.pinnacle||{},fallback=direct.pinnwire||{};
  const nativeUsable=native.usable===true||(native.ok===true&&Number(native.acceptedEvents)>0);
  const fallbackUsable=fallback.ok===true&&fallback.usable===true;
  const usable=nativeUsable||fallbackUsable;
  return {
    sourceFamily:'pinnacle',ok:usable,usable,
    state:usable?'CONNECTED_USABLE':'UNAVAILABLE',
    preferredPath:nativeUsable?'native':fallbackUsable?'pinnwire':null,
    nativeDirectStatus:native.status??null,fallbackStatus:fallback.status??null,
    nativeUsable,fallbackUsable,
    events:fallbackUsable?integerOrNull(fallback.events):nativeUsable?integerOrNull(native.acceptedEvents):0,
    markets:fallbackUsable?integerOrNull(fallback.markets):nativeUsable?integerOrNull(native.acceptedMarkets):0
  };
}
