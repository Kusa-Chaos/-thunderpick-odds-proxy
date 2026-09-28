import fs from 'node:fs';

const boardPath = process.argv[2] || 'data/simple-opportunity-latest.json';
const contractPath = process.argv[3] || 'config/production-coverage-contract.json';
const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const direct = board?.sourceHealth?.direct || {};
const sportAudit = board?.coverageAudit || {};
const failures = [];
const degraded = [];

for (const sport of contract.sports) {
  if (board?.sourceHealth?.thunderpickFreshBySport?.[sport] !== true) failures.push(`Thunderpick not fresh: ${sport}`);
  if (!sportAudit[sport]) failures.push(`Missing coverageAudit sport: ${sport}`);
}

const expectedCollectors = ['stake','pinnacle','kambi','kambiTraditional','kambiNfl','bovadaNfl','bovadaTraditional','fanduel','fanduelProps','draftkingsNfl','draftkingsTraditional'];
for (const name of expectedCollectors) {
  if (!direct[name]) degraded.push(`collector missing from sourceHealth: ${name}`);
  else if (direct[name].ok !== true) degraded.push(`collector degraded: ${name}`);
}
if (direct.kalshi && direct.kalshi.ok !== true) degraded.push(`collector degraded: kalshi (${direct.kalshi.error || 'unknown'})`);

const familyEvidence = {
  map_winner: Number(direct.kambi?.mapWinnerMarkets || 0),
  round_handicap: Number(direct.kambi?.roundHandicapMarkets || 0),
  round_total: Number(direct.kambi?.roundTotalMarkets || 0),
  esports_player_kills: Number(direct.kambi?.playerKillMarkets || 0),
  esports_player_deaths: Number(direct.kambi?.playerDeathMarkets || 0),
  sports_spread_handicap: Number(direct.kambiNfl?.spreads || 0) + Number(direct.fanduel?.bySport?.['american-football']?.spreads || 0) + Number(direct.fanduel?.bySport?.basketball?.spreads || 0) + Number(direct.fanduel?.bySport?.baseball?.spreads || 0),
  sports_total: Number(direct.kambiNfl?.totals || 0) + Number(direct.fanduel?.bySport?.['american-football']?.totals || 0) + Number(direct.fanduel?.bySport?.basketball?.totals || 0) + Number(direct.fanduel?.bySport?.baseball?.totals || 0),
  team_total: Number(direct.kambiNfl?.teamTotals || 0),
  player_prop: ['stake','kambiTraditional','kambiNfl','bovadaNfl','bovadaTraditional','fanduelProps','draftkingsNfl','draftkingsTraditional'].reduce((n,k)=>n+Number(direct[k]?.playerPropMarkets || 0),0)
};

for (const [family, evidence] of Object.entries(familyEvidence)) {
  if (evidence === 0) failures.push(`COVERAGE_FAILURE ${family}: zero enumerated markets; cannot treat as zero opportunity`);
}

// Map handicap must have an explicit family counter. Generic spread normalization is not sufficient.
const explicitMapHandicap = Number(board?.marketFamilyAudit?.map_handicap?.thunderpickInventory || direct.kambi?.mapHandicapMarkets || 0);
if (explicitMapHandicap === 0) failures.push('COVERAGE_FAILURE map_handicap: no explicit inventory counter');

const result = {
  generatedAt: new Date().toISOString(),
  boardGeneratedAt: board.generatedAt || null,
  status: failures.length ? 'COVERAGE_FAILURE' : degraded.length ? 'DEGRADED' : 'OK',
  familyEvidence,
  failures,
  degraded,
  rule: 'Zero collected markets is never silently converted to zero opportunities.'
};
fs.mkdirSync('data', {recursive:true});
fs.writeFileSync('data/production-coverage-audit-latest.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 2;
