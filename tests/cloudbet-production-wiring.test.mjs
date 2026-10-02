import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/thunderpick-simple-hourly.yml','utf8');
const boardBuilder = fs.readFileSync('scripts/simple-opportunity-board.mjs','utf8');
const cloudbet = fs.readFileSync('scripts/cloudbet-direct.py','utf8');

test('Cloudbet is wired into production scan and retry paths', () => {
  assert.match(workflow, /scripts\/cloudbet-direct\.py/);
  const executions = [...workflow.matchAll(/python scripts\/cloudbet-direct\.py/g)].length;
  assert.ok(executions >= 2, `expected Cloudbet in normal and retry paths, found ${executions}`);
});

test('workflow installs the Cloudbet secret-loading dependency', () => {
  assert.match(workflow, /pip install[^\n]*boto3/);
});

test('Cloudbet provider health is propagated to the published board', () => {
  assert.match(cloudbet, /providerHealth.*cloudbet/);
  assert.match(boardBuilder, /sourceHealth:\{direct:direct\.providerHealth\|\|null/);
});
