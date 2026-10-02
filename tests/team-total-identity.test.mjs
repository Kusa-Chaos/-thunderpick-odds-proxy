import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {exactIdentity,exactKey} from '../scripts/market-identity.mjs';

function teamTotal(team){
  return {sport:'american-football',eventId:'game-1',match:'Team A vs Team B',marketKey:'totals',market:`${team} Total Points`,contractTarget:team,target:'Over 20.5',side:'over',line:20.5,state:'prematch'};
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

test('screening admits explicit outside team_total only through totals matching and preserves contractTarget', () => {
  const screen=fs.readFileSync('scripts/screen-thunderpick-ev.mjs','utf8');
  const board=fs.readFileSync('scripts/simple-opportunity-board.mjs','utf8');
  assert.match(screen, /key==='totals'[^\n]*team_total/);
  assert.match(screen, /contractTarget/);
  assert.match(board, /contractTarget:r\.contractTarget/);
});
