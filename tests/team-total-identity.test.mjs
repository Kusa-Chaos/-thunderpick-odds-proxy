import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {exactIdentity,exactKey} from '../scripts/market-identity.mjs';

function teamTotal(team){
  return {sport:'american-football',eventId:'game-1',match:'Team A vs Team B',marketKey:'totals',market:`${team} Team Total Points`,target:'Over 20.5',side:'over',line:20.5,state:'prematch'};
}

test('team totals retain the team target in exact identity and do not collide', () => {
  const a=teamTotal('Team A'), b=teamTotal('Team B');
  const ia=exactIdentity(a), ib=exactIdentity(b);
  assert.equal(ia.family,'total');
  assert.equal(ia.target,'team a');
  assert.equal(ib.target,'team b');
  assert.equal(ia.side,'over');
  assert.notEqual(exactKey(a),exactKey(b));
});

test('Bovada team totals use the existing totals matcher with explicit team attribution', () => {
  const bovada=fs.readFileSync('scripts/bovada-nfl-direct.mjs','utf8');
  const screen=fs.readFileSync('scripts/screen-thunderpick-ev.mjs','utf8');
  assert.match(bovada, /key:'totals'.*team/);
  assert.match(bovada, /m\.key==='totals'&&m\.team/);
  assert.match(screen, /const outTarget=totalTarget\(c\.market,row\.event\)/);
  assert.match(screen, /\(tpTarget\|\|null\)!==\(outTarget\|\|null\)/);
});
