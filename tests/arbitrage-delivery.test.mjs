import test from 'node:test';
import assert from 'node:assert/strict';
import { detectArbitrage } from '../scripts/arbitrage.mjs';

test('detects exact two-way arbitrage and returns stake-independent margin', () => {
  const rows=[
    {identityKey:'nfl|a vs b|ml|a||||||||prematch|standard',eventKey:'nfl|a vs b|ml|||||||prematch|standard',target:'a',thunderpick:2.12,outside:[{sourceFamily:'book-a',price:1.8}]},
    {identityKey:'nfl|a vs b|ml|b||||||||prematch|standard',eventKey:'nfl|a vs b|ml|||||||prematch|standard',target:'b',thunderpick:1.8,outside:[{sourceFamily:'book-a',price:2.12}]}
  ];
  const arbs=detectArbitrage(rows);
  assert.equal(arbs.length,1);
  assert.ok(arbs[0].inverseSum < 1);
  assert.ok(arbs[0].arbMargin > 0);
  assert.equal(arbs[0].legs.length,2);
});

test('does not mix different exact scopes', () => {
  const rows=[
    {eventKey:'cs2|a vs b|map winner|map1|prematch|standard',target:'a',thunderpick:2.2,outside:[]},
    {eventKey:'cs2|a vs b|map winner|map2|prematch|standard',target:'b',thunderpick:2.2,outside:[]}
  ];
  assert.equal(detectArbitrage(rows).length,0);
});

test('does not treat two same-side player-prop prices as opposing arb legs', () => {
  const identity={sport:'cs2',event:'2723397',family:'player_prop',target:'jee',stat:'kills',line:'14.5',period:'',map:'2',round:'',set:'',side:'over',state:'prematch',settlement:'standard'};
  const rows=[
    {sport:'cs2',match:'Falcons vs TYLOO',target:'Over',side:'Over',market:'Player Jee - Total Kills Over/Under (Incl. Overtime) - Map 2',marketKey:'player_prop',line:14.5,scope:{map:2},state:'prematch',thunderpick:2.3,identity,identityComplete:true},
    {sport:'cs2',match:'Falcons vs TYLOO',target:'Over',side:'Over',market:'Player Jee - Total Kills Over/Under (Incl. Overtime) - Map 2',marketKey:'player_prop',line:14.5,scope:{map:2},state:'prematch',thunderpick:2.15,identity,identityComplete:true}
  ];
  assert.equal(detectArbitrage(rows).length,0);
});
