import assert from 'node:assert/strict';
import {normalizeOddsPapiEvent} from './oddspapi-exact-normalizer.mjs';
const catalog=[
 {marketId:181,marketName:'Winner',marketType:'moneyline',period:'result',outcomes:[{outcomeId:181,outcomeName:'2'},{outcomeId:182,outcomeName:'1'}]},
 {marketId:185,marketName:'Total Maps Over Under',marketType:'totals',period:'result',handicap:3.5,outcomes:[{outcomeId:190,outcomeName:'Under'},{outcomeId:191,outcomeName:'Over'}]},
 {marketId:1847,marketName:'First Map Winner (incl. overtime)',marketType:'moneyline',period:'p1',outcomes:[{outcomeId:320,outcomeName:'1'},{outcomeId:321,outcomeName:'2'}]},
 {marketId:1821,marketName:'Maps Handicap',marketType:'spreads',period:'result',handicap:-2.5,outcomes:[{outcomeId:322,outcomeName:'1'},{outcomeId:323,outcomeName:'2'}]}
];
const m=(pairs)=>({marketActive:true,outcomes:Object.fromEntries(pairs.map(([id,price])=>[id,{players:{'0':{active:true,price}}}]))});
const q={fixtureId:'id180001',participant1Name:'Fuego',participant2Name:'T1 Academy',sportId:18,statusId:0,startTime:'2026-10-12T12:00:00Z',bookmakerOdds:{
 bet365:{bookmakerIsActive:true,suspended:false,markets:{181:m([[181,1.9],[182,1.91]]),185:m([[190,1.82],[191,1.98]]),1847:m([[320,1.75],[321,2.08]]),1821:m([[322,2],[323,1.8]])}},
 bet365nj:{bookmakerIsActive:true,suspended:false,markets:{181:m([[181,1.55],[182,2.4]])}},
 '1xbet':{bookmakerIsActive:true,suspended:false,markets:{181:m([[181,2.03],[182,1.79]])}},
 betano:{bookmakerIsActive:true,suspended:false,markets:{181:m([[181,1.97],[182,1.84]])}},
 unibet:{bookmakerIsActive:true,suspended:false,markets:{181:m([[181,1.86],[182,1.96]])}},
 roobet:{bookmakerIsActive:true,suspended:false,markets:{181:m([[181,1.94],[182,1.91]])}},
 pinnacle:{bookmakerIsActive:true,suspended:false,markets:{181:m([[181,1.9],[182,1.9]])}}
}};
const r=normalizeOddsPapiEvent(q,catalog,{fetchedAt:'2026-10-10T12:40:00Z'});
assert.equal(r.id,'oddspapi-direct:id180001');
assert.deepEqual(r.bookmakers.map(b=>b.sourceFamily),['bet365','1xbet','betano','unibet-kambi','roobet']);
const bm=r.bookmakers[0];
assert.equal(bm.markets.length,3,'skip unverified handicap');
const win=bm.markets.find(x=>x.key==='h2h');
assert.deepEqual(win.outcomes.map(x=>x.name),['Fuego','T1 Academy']);
assert.deepEqual(win.outcomes.map(x=>x.price),[1.91,1.9],'outcome IDs must be oriented by 1/2 not object order');
const tot=bm.markets.find(x=>x.name==='Total Maps');
assert.equal(tot.line,3.5);assert.deepEqual(tot.outcomes.map(x=>x.name),['Over','Under']);
assert.equal(tot.outcomes[0].point,3.5);
const map=bm.markets.find(x=>x.key==='map_winner');
assert.equal(map.scope.map,1);assert.equal(map.name,'Map 1 Winner');
assert(!r.bookmakers.some(x=>/pinnacle|stake|hlTV/i.test(x.sourceFamily)));
assert.equal(normalizeOddsPapiEvent({...q,statusId:1},catalog,{fetchedAt:'2026-10-10T12:40:00Z'}),null,'do not mix live with prematch');
const wrong=catalog.map(x=>x.marketId===1847?{...x,period:'p2'}:x);
const rw=normalizeOddsPapiEvent(q,wrong,{fetchedAt:'2026-10-10T12:40:00Z'});
assert(!rw.bookmakers[0].markets.some(x=>x.key==='map_winner'),'scope mismatch cannot be promoted');
console.log('ODDSPAPI_EXACT_NORMALIZER_VERIFIED');