import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCloudbetEvent, cloudbetSourceFamily } from '../scripts/cloudbet-direct.mjs';

const event=(sport,markets)=>({id:'e1',sport:{name:sport},name:'Alpha vs Beta',home:'Alpha',away:'Beta',startTime:'2026-10-02T12:00:00Z',status:'TRADING',markets});
const market=(name,selections,extra={})=>({name,status:'TRADING',...extra,selections:selections.map(x=>({name:x[0],price:x[1]}))});

test('Cloudbet is exactly one independent source family',()=>assert.equal(cloudbetSourceFamily,'cloudbet'));
test('routes all nine supported categories',()=>{
 const names=['American Football','Baseball','Basketball','Soccer','Tennis','Counter-Strike 2','Dota 2','League of Legends','Valorant'];
 const expected=['american-football','baseball','basketball','soccer','tennis','cs2','dota2','lol','valorant'];
 assert.deepEqual(names.map(n=>normalizeCloudbetEvent(event(n,[market('Match Winner',[['Alpha',1.8],['Beta',2.0]])]))?.sport),expected);
});
test('normalizes prematch match winner',()=>{
 const r=normalizeCloudbetEvent(event('Soccer',[market('Match Winner',[['Alpha',1.8],['Beta',2.0]])]));
 assert.equal(r.exactV2[0].bookmakers[0].markets[0].key,'h2h');
 assert.equal(r.exactV2[0].live,false);
});
test('keeps map handicap distinct from round handicap and exact line/scope',()=>{
 const r=normalizeCloudbetEvent(event('League of Legends',[market('Map Handicap',[['Alpha +1.5',1.5],['Beta -1.5',2.4]],{line:1.5,scope:{series:true}})]));
 const m=r.exactV2[0].bookmakers[0].markets[0];
 assert.equal(m.key,'map_handicap'); assert.equal(m.scope.series,true); assert.equal(m.outcomes[0].point,1.5); assert.equal(m.outcomes[1].point,-1.5);
});
test('normalizes map winner and totals only with explicit scope',()=>{
 const r=normalizeCloudbetEvent(event('Counter-Strike 2',[
  market('Map 1 Winner',[['Alpha',1.7],['Beta',2.1]],{scope:{map:1}}),
  market('Map 1 Total Rounds',[['Over 20.5',1.9],['Under 20.5',1.9]],{line:20.5,scope:{map:1}})
 ]));
 assert.deepEqual(r.exactV2[0].bookmakers[0].markets.map(m=>m.key),['map_winner','round_totals']);
});
test('rejects derivative with missing exact identity instead of guessing',()=>{
 const r=normalizeCloudbetEvent(event('League of Legends',[market('Map Handicap',[['Alpha +1.5',1.5],['Beta -1.5',2.4]])]));
 assert.equal(r.exactV2.length,0); assert.equal(r.rejections.missingScope,1);
});
test('never accepts live event into prematch output',()=>{
 const e=event('Tennis',[market('Match Winner',[['Alpha',1.8],['Beta',2.0]])]); e.live=true;
 const r=normalizeCloudbetEvent(e); assert.equal(r.exactV2.length,0); assert.equal(r.rejections.live,1);
});
