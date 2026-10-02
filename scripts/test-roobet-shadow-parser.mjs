import fs from 'node:fs/promises';

function expect(cond,msg){if(!cond)throw new Error(msg);}

const parserPath='scripts/roobet-shadow-parser.mjs';
try{await fs.access(parserPath);}catch{throw new Error('Roobet shadow parser is missing');}
const {parseRoobetOddsPapiFixture}=await import('./roobet-shadow-parser.mjs');

const fixture={
  fixtureId:77,
  participant1Name:'Team Spirit',
  participant2Name:'Team Yandex',
  startTime:'2026-10-03T12:00:00Z',
  bookmakerOdds:{
    roobet:{markets:{
      race5:{marketName:'Map 1 - Race to 5 Kills',period:'Map 1',outcomes:[
        {name:'Team Spirit',price:2.02},{name:'Team Yandex',price:1.72}
      ]},
      towers115:{marketName:'Map 1 - Total Towers Destroyed',period:'Map 1',handicap:11.5,outcomes:[
        {name:'Over',price:1.62,point:11.5},{name:'Under',price:2.15,point:11.5}
      ]},
      wrongMap:{marketName:'Map 2 - Total Towers Destroyed',period:'Map 2',handicap:11.5,outcomes:[
        {name:'Over',price:1.75,point:11.5},{name:'Under',price:1.95,point:11.5}
      ]}
    }},
    otherbook:{markets:{race5:{marketName:'Map 1 - Race to 5 Kills',period:'Map 1',outcomes:[{name:'Team Spirit',price:2.2},{name:'Team Yandex',price:1.6}]}}}
  }
};

const rows=parseRoobetOddsPapiFixture({sport:'dota2',fixture});
expect(Array.isArray(rows)&&rows.length===1,'must return exactly one Roobet event');
expect(rows[0].bookmakers.length===1&&rows[0].bookmakers[0].key==='roobet','must keep only Roobet');
const markets=rows[0].bookmakers[0].markets;
expect(markets.length===3,'must preserve all valid Roobet objective markets');
const race=markets.find(m=>m.family==='race_to_kills');
expect(race?.scope?.map===1&&race?.line===5,'race-to-5 must retain exact map and threshold');
const towers=markets.find(m=>m.family==='total_towers'&&m.scope?.map===1);
expect(towers?.line===11.5,'tower total must retain exact 11.5 line');
const wrong=markets.find(m=>m.family==='total_towers'&&m.scope?.map===2);
expect(wrong?.line===11.5,'Map 2 tower total must remain distinct from Map 1');
expect(markets.every(m=>m.state==='prematch'),'shadow parser must persist prematch state');

const nativeFixture={
  fixtureId:88,
  participant1Name:'Team Spirit',
  participant2Name:'Team Yandex',
  bookmakerOdds:{
    roobet:{markets:{
      '9001':{
        outcomes:{
          '101':{players:{'0':{price:1.62}}},
          '102':{players:{'0':{price:2.15}}}
        }
      }
    }}
  }
};
const nativeMeta=new Map([['9001',{
  marketId:9001,
  marketName:'Total Towers Destroyed',
  sportId:16,
  handicap:11.5,
  period:'Map 1',
  marketType:'totals',
  outcomes:[
    {outcomeId:101,outcomeName:'Over'},
    {outcomeId:102,outcomeName:'Under'}
  ]
}]]);
const nativeRows=parseRoobetOddsPapiFixture({sport:'dota2',fixture:nativeFixture,marketMeta:nativeMeta});
expect(nativeRows.length===1,'native OddsPapi nested Roobet fixture must parse');
const nativeMarket=nativeRows[0].bookmakers[0].markets[0];
expect(nativeMarket?.family==='total_towers','native nested market must normalize to total_towers');
expect(nativeMarket?.scope?.map===1&&nativeMarket?.line===11.5,'native nested market must retain Map 1 and 11.5');
expect(nativeMarket?.outcomes?.some(o=>o.name==='Under'&&o.price===2.15),'native nested market must attach catalog outcome name to executable price');

console.log('ROOBET_SHADOW_PARSER_VERIFIED',markets.length+1);
