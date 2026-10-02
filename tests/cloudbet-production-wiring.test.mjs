import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/thunderpick-simple-hourly.yml','utf8');
const discovery = fs.readFileSync('scripts/simple-direct-discovery.mjs','utf8');
const boardBuilder = fs.readFileSync('scripts/simple-opportunity-board.mjs','utf8');
const cloudbet = fs.readFileSync('scripts/cloudbet-direct.py','utf8');

test('Cloudbet is collected before each normal and retry discovery snapshot', () => {
  const discoveryExecutions = [...workflow.matchAll(/node scripts\/simple-direct-discovery\.mjs/g)].length;
  assert.ok(discoveryExecutions >= 2, `expected discovery in normal and retry paths, found ${discoveryExecutions}`);
  const invoke = discovery.indexOf('cloudbet-direct.py');
  const readDirect = discovery.indexOf('await read(directPath)');
  assert.ok(invoke >= 0, 'Cloudbet collector must be invoked by discovery');
  assert.ok(readDirect >= 0 && invoke < readDirect, 'Cloudbet must run before discovery reads the direct-source snapshot');
});

test('Cloudbet discovers sport slugs then ingests odds by active competition', () => {
  assert.match(cloudbet, /request_sports/);
  assert.match(cloudbet, /\/sports\//);
  assert.match(cloudbet, /\/competitions\//);
  assert.match(cloudbet, /ThreadPoolExecutor/);
  assert.match(cloudbet, /competitionStats/);
  assert.match(cloudbet, /WINDOW_DAYS/);
  for (const market of ['american_football.moneyline','baseball.moneyline','basketball.moneyline','soccer.match_odds','tennis.winner','counter_strike.winner','dota_2.winner','league_of_legends.winner','esport_valorant.winner']) {
    assert.ok(cloudbet.includes(market), `missing Cloudbet market key ${market}`);
  }
});

test('Cloudbet health distinguishes catalog inventory and usable normalized events', () => {
  assert.match(cloudbet, /sportInventory/);
  assert.match(cloudbet, /eventCount/);
  assert.match(cloudbet, /competitionCount/);
  assert.match(cloudbet, /bySport/);
  assert.match(cloudbet, /events/);
  assert.match(cloudbet, /usable/);
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
  assert.match(discovery, /spawnSync/);
  assert.match(discovery, /providerHealth\.cloudbet/);
});

test('Cloudbet HTTP failures retain a sanitized response body for diagnosis', () => {
  assert.match(cloudbet, /HTTPError/);
  assert.match(cloudbet, /\.read\(\)/);
  assert.match(cloudbet, /sanitize_error/);
});

test('Cloudbet provider health is propagated to the published board', () => {
  assert.match(cloudbet, /out\.setdefault\(['\"]providerHealth['\"]/);
  assert.match(cloudbet, /health\[['\"]cloudbet['\"]\]/);
  assert.match(boardBuilder, /sourceHealth:\{direct:direct\.providerHealth\|\|null/);
});
