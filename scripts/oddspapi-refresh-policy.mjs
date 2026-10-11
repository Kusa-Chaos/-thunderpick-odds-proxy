// OddsPapi has a monthly request allowance. Preflight NEVER calls OddsPapi.
// Schedule may check each hour, but billable requests require a nearby
// Thunderpick esports match and a strict daily / monthly quota budget.
export const ESPORTS=['lol','dota2','cs2','valorant'];
const DAY_MS=86400000, HOUR_MS=3600000;
function time(v){const n=Date.parse(v||'');return Number.isFinite(n)?n:null;}
function dayHistory(previous,nowMs){
 const supplied=Array.isArray(previous?.refreshHistory)?previous.refreshHistory:[];
 const fallback=previous?.generatedAt?[{at:previous.generatedAt,requests:previous?.counts?.requests||5}]:[];
 return (supplied.length?supplied:fallback).map(x=>({at:String(x?.at||''),requests:Number(x?.requests)||0}))
  .filter(x=>{const t=time(x.at);return t!==null&&t<=nowMs+60000&&t>nowMs-DAY_MS}).slice(-10);
}
export function eligibleEsportsMatches(inventory={},nowMs=Date.now(),hours=20){
 const result=[];
 for(const sport of ESPORTS) {
  const bucket=inventory?.sports?.[sport];
  const data=bucket?.data?.data||bucket?.data||[];
  for(const e of Array.isArray(data)?data:[]){
   const start=time(e?.startTime||e?.commence_time);
   const name=String(e?.name||[e?.teams?.home?.name||e?.market?.home?.name,e?.teams?.away?.name||e?.market?.away?.name].filter(Boolean).join(' vs ')).trim();
   if(!start||start<=nowMs+5*60000||start>nowMs+hours*HOUR_MS||e?.isLive===true)continue;
   if(!/\s(?:vs\.?|v\.)\s/i.test(name))continue;
   if(/\b(?:virtual|esoccer|ebasketball|madden|synthetic)\b/i.test(name))continue;
   if(/mouz\s+vs\s+nrg|tes\s+vs\s+ig/i.test(name))continue;
   result.push({sport,name,startTime:new Date(start).toISOString(),hoursUntil:(start-nowMs)/HOUR_MS});
  }
 }
 return result.sort((a,b)=>a.hoursUntil-b.hoursUntil);
}
export function decideOddsPapiRefresh({previous={},inventory={},nowMs=Date.now(),manual=false}={}){
 const events=eligibleEsportsMatches(inventory,nowMs);
 const history=dayHistory(previous,nowMs);
 const lastMs=history.length?Math.max(...history.map(x=>time(x.at))):null;
 const declared=Number(previous?.entitlement?.remaining);
 const usedLast=Number(previous?.counts?.requests||0);
 const remaining=Number.isFinite(declared)&&declared>=0?Math.max(0,declared-usedLast):null;
 // This small paid quota cannot cover the whole 20-hour discovery horizon.
 // Only pay when a target actually starts in <=2.5 hours. The hourly preflight
 // itself remains free and does not touch the existing :40 scanner.
 const reserve=25, eligibleCount=events.length, soon=events.some(x=>x.hoursUntil<=2.5);
 const imminent=events.find(x=>x.hoursUntil<=2.5)||null;
 const windowOpens=imminent?time(imminent.startTime)-2.5*HOUR_MS:null;
 const inEventWindow=windowOpens===null?[]:history.filter(x=>time(x.at)>=windowOpens&&time(x.at)<=nowMs);
 // Earlier manual tests may have spent the daily allowance many hours before
 // kickoff. Recover at most ONE such wasted-window scan, only with >=100
 // validated requests left, never after an event-window refresh.
 const earlyTestRecovery=soon&&remaining!==null&&remaining>=100&&
   history.length>=2&&history.length<=3&&inEventWindow.length===0&&
   (lastMs===null||nowMs-lastMs>=2*HOUR_MS);
 // An off-cycle manual test can be fresh when published but expire seconds
 // before the next :40 collector. Permit only ONE automatic alignment repair
 // per rolling 24h, and only when the new snapshot has not been consumed by a
 // later official TP scan. Do not weaken the 40-minute betting-data gate.
 const previousSnapshotTime=time(previous?.generatedAt);
 const inventoryTime=time(inventory?.generatedAt);
 const nextCollector=new Date(nowMs);nextCollector.setUTCMinutes(40,30,0);
 if(nextCollector.getTime()<=nowMs)nextCollector.setUTCHours(nextCollector.getUTCHours()+1);
 const unconsumed=previousSnapshotTime!==null&&inventoryTime!==null&&inventoryTime<previousSnapshotTime;
 const minute=previousSnapshotTime===null?null:new Date(previousSnapshotTime).getUTCMinutes();
 const offCycle=minute!==null&&(minute<20||minute>35);
 const collectorWillReject=previousSnapshotTime!==null&&nextCollector.getTime()-previousSnapshotTime>40*60000;
 const alignmentRepair=soon&&history.length===2&&remaining!==null&&remaining>=105&&
   unconsumed&&offCycle&&collectorWillReject&&lastMs!==null&&nowMs-lastMs<60*60000&&
   nextCollector.getTime()-nowMs>=3*60000&&nextCollector.getTime()-nowMs<=20*60000;
 let reason=null;
 if(!eligibleCount)reason='NO_MATCHING_UPCOMING_ESPORTS_EVENTS';
 else if(!soon)reason='WAITING_FOR_NEAR_MATCH_NO_API_SPEND';
 else if(remaining===null)reason='QUOTA_UNVERIFIED';
 else if(remaining<=reserve+5)reason='MONTHLY_QUOTA_RESERVED';
 else if(!alignmentRepair&&!earlyTestRecovery&&lastMs!==null&&nowMs-lastMs<4*HOUR_MS)reason='COOLDOWN_TO_AVOID_EXCESS_REQUESTS';
 else if(!alignmentRepair&&!earlyTestRecovery&&history.length>=(remaining>=100?2:1))reason='DAILY_REQUEST_CAP';
 return {shouldRefresh:!reason,reason:reason||(earlyTestRecovery?'ONE_PREMATCH_RECOVERY_AFTER_EARLY_TESTS':alignmentRepair?'ONE_TIME_COLLECTOR_ALIGNMENT_REPAIR':'TARGETED_REFRESH_DUE'),events:events.slice(0,24),
  eligibleEvents:eligibleCount,urgentEvent:soon,eventWindowPreviousRuns:inEventWindow.length,previous24hRuns:history.length,
  lastAttemptAt:lastMs?new Date(lastMs).toISOString():null,estimatedRemaining:remaining,
  requestCap:5,reservedRequests:reserve,checkedAt:new Date(nowMs).toISOString()};
}
export function attachOddsPapiRefreshHistory(snapshot={},previous={},nowMs=Date.now()){
 const history=dayHistory(previous,nowMs);
 const at=snapshot.generatedAt||new Date(nowMs).toISOString();
 const requests=Math.max(0,Math.min(10,Number(snapshot?.counts?.requests)||0));
 return {...snapshot,refreshHistory:[...history,{at,requests}].slice(-10),
  refreshPolicy:{mode:'quota-gated-hourly-preflight',attemptedAt:at,requests,reserve:25}};
}
