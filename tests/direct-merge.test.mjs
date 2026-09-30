import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceDirectSnapshot} from '../scripts/direct-merge.mjs';

test('direct snapshot replacement removes stale prior direct entries and keeps non-direct data', () => {
  const existing = [
    {id:'pinnacle-direct:1', version:'old'},
    {id:'stake-direct:2', version:'stale-vanished'},
    {id:'owls:pinnacle:99', version:'keep-owls'},
  ];
  const incoming = [
    {id:'pinnacle-direct:1', version:'new'},
    {id:'fanduel-direct:3', version:'new-fd'},
  ];
  const out = replaceDirectSnapshot(existing, incoming);
  assert.deepEqual(out.map(x => [x.id,x.version]), [
    ['owls:pinnacle:99','keep-owls'],
    ['pinnacle-direct:1','new'],
    ['fanduel-direct:3','new-fd'],
  ]);
});

test('all known direct collector prefixes are recognized even when absent from incoming snapshot', () => {
  const existing = [
    {id:'unibet-kambi-direct:1'},
    {id:'bovada-traditional-direct:2'},
    {id:'draftkings-nfl-direct:3'},
    {id:'bovada-nfl-direct:4'},
    {id:'betway-direct:5'},
    {id:'fanduel-props-direct:6'},
    {id:'draftkings-traditional-direct:7'},
    {id:'owls-v2:8'},
  ];
  assert.deepEqual(replaceDirectSnapshot(existing, []).map(x=>x.id), ['owls-v2:8']);
});
