import assert from 'node:assert/strict';
import {batchBookmakers,chooseTournament,fuseTournamentQuote,collectOddsPapiTournamentShadow} from './oddspapi-tournament-shadow-collector.mjs';
import {normalizeOddsPapiEvent} from './oddspapi-exact-normalizer.mjs';

const at='2026-10-11T17:00:00Z',soon='2026-10-11T18:00:00Z';
const bookmakerAccounts=Object.fromEntries(['bet365','betano','roobet','1xbet','unibet'].map(s=>[s,{}]));
const account={current_subscription_id:'active',subscriptions:[{subscription_id:'active',is_active:true,
 sport_ids:[17,18,16,61],request_limit:500,request_count:200,bookmakers:bookmakerAccounts}]};
const market={sportId:17,marketId:181,marketName:'Winner',marketType:'moneyline',
 period:'result',outcomes:[{outcomeId:181,outcomeName:'1'},{outcomeId:182,outcomeName:'2'}]};
const fixtures=[{sportId:17,statusId:0,hasOdds:true,fixtureId:'fixture1',tournamentId:444,
 participant1Name:'Team Alpha',participant2Name:'Team Beta',startTime:soon}];
const inventory={sports:{cs2:{data:{data:[{name:'Alpha vs Beta',startTime:soon,isLive:false}]}}}};
const quoteTime='2026-10-11T16:55:00Z';
const bm=()=>{
 const m={marketActive:true,outcomes:{
  181:{players:{'0':{active:true,price:2.02,changedAt:quoteTime}}},
  182:{players:{'0':{active:true,price:1.8,changedAt:quoteTime}}}
 }};
 return {bookmakerIsActive:true,suspended:false,markets:{181:m}};
};
const response=(bookmakers)=>[{fixtureId:'fixture1',tournamentId:444,sportId:17,statusId:0,startTime:soon,
 bookmakerOdds:Object.fromEntries(bookmakers.map(b=>[b,bm()]))},
 {fixtureId:'unlisted-inventory',tournamentId:444,sportId:17,statusId:0,startTime:soon,
 bookmakerOdds:{bet365:bm()}}];
assert.deepEqual(batchBookmakers(bookmakerAccounts),[['bet365','betano','roobet'],['1xbet','unibet']]);
assert.equal(chooseTournament(fixtures,{sport:'cs2',targets:['Alpha vs Beta'],nowMs:Date.parse(at)}).tournamentId,444);
assert.equal(chooseTournament(fixtures,{sport:'cs2',targets:['Wrong vs Match'],nowMs:Date.parse(at)}),null);
assert.equal(fuseTournamentQuote(response(['bet365'])[0],fixtures[0]).participant1Name,'Team Alpha');
assert.equal(fuseTournamentQuote({...response(['bet365'])[0],sportId:18},fixtures[0]),null);
assert.equal(fuseTournamentQuote({...response(['bet365'])[0],statusId:1},fixtures[0]),null);
let requested=[],marketCalls=0;
async function get(path,params={}){
 requested.push({path,params});
 if(path==='/account')return account;
 if(path==='/markets'){marketCalls++;return [market];}
 if(path==='/fixtures')return fixtures;
 if(path==='/odds-by-tournaments'){
  assert.equal(params.tournamentIds,'444');
  assert(params.bookmakers.split(',').length<=3,'Never request more than three permitted bookmakers');
  return response(params.bookmakers.split(','));
 }
 throw Error('UNKNOWN_ENDPOINT');
}
const success=await collectOddsPapiTournamentShadow({get,inventory,nowIso:at,maxBillableCalls:5});
assert.equal(success.state,'COLLECTED',JSON.stringify(success));
assert.equal(success.counts.requests,4,'unmetered account should not consume monthly quota');
assert.equal(success.counts.events,1,'one matching tracked event only');
assert.equal(success.counts.books,5);
assert.equal(success.counts.markets,5);
assert.equal(success.counts.batchedEvents,4);
assert.equal(success.bookmakerFamilies.length,5);
assert.equal(success.sports.cs2.exactV2.length,1);
assert.equal(success.sports.cs2.exactV2[0].bookmakers.length,5);
assert(success.sports.cs2.exactV2[0].bookmakers.every(b=>b.markets.every(m=>m.last_update===quoteTime&&m.quoteTimestampVerified===true)));
assert.equal(marketCalls,1);
assert(requested.every(x=>!String(x.params.bookmakers||'').includes('pinnacle')),'No unlicensed source requests');
let hitMarket=false;
const cached=await collectOddsPapiTournamentShadow({get:async(p,q)=>{if(p==='/markets'){hitMarket=true;throw Error('CACHED_CATALOG_REFETCH')}return get(p,q);},
 inventory,nowIso:at,previous:{marketCatalog:success.marketCatalog},maxBillableCalls:5});
assert.equal(cached.state,'COLLECTED');assert.equal(cached.counts.requests,3);assert.equal(hitMarket,false,'catalog reusable between scans');
const tiny=await collectOddsPapiTournamentShadow({get,inventory,nowIso:at,maxBillableCalls:3});
assert.equal(tiny.state,'COLLECTED');assert.equal(tiny.counts.books,3,'tight budget should use only three bookmaker slugs');
assert.equal(tiny.counts.requests,3);
const staleRaw=response(['bet365'])[0];
for(const o of Object.values(staleRaw.bookmakerOdds.bet365.markets[181].outcomes))o.players['0'].changedAt='2026-10-11T13:00:00Z';
assert.equal(normalizeOddsPapiEvent({...fixtures[0],bookmakerOdds:staleRaw.bookmakerOdds},[market],{fetchedAt:at,requireQuoteTimestamps:true}),null,'older outcome change is never refreshed synthetically');
const staleGet=async(path,params={})=>{
 if(path!=='/odds-by-tournaments')return get(path,params);
 const events=response(params.bookmakers.split(','));
 for(const e of events)for(const book of Object.values(e.bookmakerOdds||{}))
  for(const market of Object.values(book.markets||{}))
   for(const outcome of Object.values(market.outcomes||{}))
    for(const player of Object.values(outcome.players||{}))player.changedAt='2026-10-11T13:00:00Z';
 return events;
};
const stale=await collectOddsPapiTournamentShadow({get:staleGet,inventory,nowIso:at,maxBillableCalls:5});
assert.equal(stale.state,'NO_FRESH_EXACT_QUOTE_TIMESTAMPS');
assert.equal(stale.counts.events,0);
assert(stale.counts.quoteAgeRejected>=1);
assert(success.productionEligible===false&&success.mode==='TOURNAMENT_SHADOW_ONLY');
console.log('ODDSPAPI_TOURNAMENT_BATCH_TEST_VERIFIED',JSON.stringify({billableCalls:success.counts.requests,matched:success.counts.events,books:success.counts.books,quotes:success.counts.markets,catalogCached:cached.cacheUsed,staleRejected:stale.counts.quoteAgeRejected}));
