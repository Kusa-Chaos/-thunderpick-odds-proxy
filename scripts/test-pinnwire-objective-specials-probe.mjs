import assert from 'node:assert/strict';
import {summarizePinnwireSpecials} from './pinnwire-objective-specials-probe.mjs';
const fixture={events:[
 {event_id:123,league_name:'League of Legends LCK',home:'Alpha',away:'Beta',
  specials:[{special:'First Blood - Map 1',special_markets:{num_1:[
   {id:66,name:'First Blood',prices:[{name:'Alpha',price:1.8},{name:'Beta',price:2.0}]}
  ]}},
  {special:'Map 2 Total Kills',special_markets:{num_2:[
   {name:'Total Kills',prices:[{name:'Over',price:1.91,points:26.5},{name:'Under',price:1.91,points:26.5}]}
  ]}}]},
 {event_id:456,league_name:'Dota 2',home:'Gamma',away:'Delta',
  specials:[{special:'First Roshan',special_markets:{num_1:[{
   name:'Roshan',prices:[{name:'Gamma',price:1.7},{name:'Delta',price:2.0}]
  }]}}]},
 {event_id:999,league_name:'Tennis',home:'C',away:'D',specials:[]}
]};
const result=summarizePinnwireSpecials(fixture);
assert.equal(result.totalEvents,3);
assert.equal(result.validTwoSidedObjectiveMarkets,3);
assert.equal(result.namedObjectiveMarkets,3);
assert.equal(result.sportCounts.lol,1);
assert.equal(result.sportCounts.dota2,1);
assert.equal(result.sportCounts.other,1);
const none=summarizePinnwireSpecials({events:[{league_name:'LoL',specials:[]}]});
assert.equal(none.validTwoSidedObjectiveMarkets,0);
const malformed=summarizePinnwireSpecials({events:[{league_name:'Dota 2',specials:[{special:'First Blood',
 special_markets:{num_1:[{prices:[{name:'A',price:0},{name:'B',price:2}]}]}}]}]});
assert.equal(malformed.validTwoSidedObjectiveMarkets,0);
console.log('PINNWIRE_OBJECTIVE_SPECIALS_SHADOW_PARSER_VERIFIED');
