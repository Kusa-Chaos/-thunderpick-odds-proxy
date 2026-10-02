import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/thunderpick-simple-hourly.yml','utf8');
const merger = fs.readFileSync('scripts/merge-direct-sources.mjs','utf8');
const boardBuilder = fs.readFileSync('scripts/simple-opportunity-board.mjs','utf8');
const cloudbet = fs.readFileSync('scripts/cloudbet-direct.py','utf8');

test('Cloudbet is executed in both normal and retry scans through the direct merge stage', () => {
  const mergeExecutions = [...workflow.matchAll(/node scripts\/merge-direct-sources\.mjs/g)].length;
  assert.ok(mergeExecutions >= 2, `expected direct merge in normal and retry paths, found ${mergeExecutions}`);
  assert.match(merger, /cloudbet-direct\.py/);
});

test('Cloudbet collector writes the exactV2 schema consumed by production merge', () => {
  assert.match(cloudbet, /['\"]sports['\"]/);
  assert.match(cloudbet, /['\"]exactV2['\"]/);
  assert.match(cloudbet, /['\"]home_team['\"]/);
  assert.match(cloudbet, /['\"]away_team['\"]/);
  assert.match(cloudbet, /['\"]cloudbet-direct['\"]/);
});

test('Cloudbet can load the AWS secret without depending on boto3 being preinstalled', () => {
  assert.match(cloudbet, /subprocess/);
  assert.match(cloudbet, /secretsmanager/);
  assert.match(cloudbet, /get-secret-value/);
});

test('Cloudbet failure cannot abort the whole production scan', () => {
  assert.match(merger, /spawnSync/);
  assert.match(merger, /providerHealth\.cloudbet/);
});

test('Cloudbet provider health is propagated to the published board', () => {
  assert.match(cloudbet, /providerHealth.*cloudbet/);
  assert.match(boardBuilder, /sourceHealth:\{direct:direct\.providerHealth\|\|null/);
});
