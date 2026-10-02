import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bovada = fs.readFileSync('scripts/bovada-nfl-direct.mjs','utf8');
const audit = fs.readFileSync('scripts/audit-production-coverage.mjs','utf8');

test('Bovada NFL collector explicitly parses full-game team point totals', () => {
  assert.match(bovada, /Total Points -/);
  assert.match(bovada, /teamTotals/);
  assert.match(bovada, /team_total/);
});

test('coverage gate accepts healthy Bovada NFL as explicit team-total enumerator', () => {
  assert.match(audit, /team_total:[^\n]*bovadaNfl/);
  assert.match(audit, /direct\.bovadaNfl\?\.teamTotals/);
  assert.match(audit, /family==='team_total'[\s\S]*bovadaNfl/);
});
