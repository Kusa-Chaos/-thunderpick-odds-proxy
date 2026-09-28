import fs from 'node:fs';

const boardPath = process.argv[2] || 'data/simple-opportunity-latest.json';
const contractPath = process.argv[3] || 'config/production-coverage-contract.json';
const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const direct = board?.sourceHealth?.direct || {};
const sportAudit = board?.coverageAudit || {};
const failures = [];
const degraded = [];
const familyStatus = {};

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
  map_handicap: Number(direct.kambi?.mapHandicapMarkets || board?.marketFamilyAudit?.map_handicap?.outsideComparisonRows || 0),
  round_handicap: Number(direct.kambi?.roundHandicapMarkets || 0),
  round_total: Number(direct.kambi?.roundTotalMarkets || 0),
  esports_player_kills: Number(direct.kambi?.playerKillMarkets || 0),
  esports_player_deaths: Number(direct.kambi?.playerDeathMarkets || 0),
  sports_spread_handicap: Number(direct.kambiNfl?.spreads || 0) + Number(direct.fanduel?.bySport?.['american-football']?.spreads || 0) + Number(direct.fanduel?.bySport?.basketball?.spreads || 0) + Number(direct.fanduel?.bySport?.baseball?.spreads || 0),
  sports_total: Number(direct.kambiNfl?.totals || 0) + Number(direct.fanduel?.bySport?.['american-football']?.totals || 0) + Number(direct.fanduel?.bySport?.basketball?.totals || 0) + Number(direct.fanduel?.bySport?.baseball?.totals || 0),
  team_total: Number(direct.kambiNfl?.teamTotals || 0),
  player_prop: ['stake','kambiTraditional','kambiNfl','bovadaNfl','bovadaTraditional','fanduelProps','draftkingsNfl','draftkingsTraditional'].reduce((n,k)=>n+Number(direct[k]?.playerPropMarkets || 0),0)
};

const familyCollectors = {
  map_winner:['kambi'], map_handicap:['kambi'], round_handicap:['kambi'], round_total:['kambi'],
  esports_player_kills:['kambi'], esports_player_deaths:['kambi'],
  sports_spread_handicap:['kambiNfl','fanduel'], sports_total:['kambiNfl','fanduel'], team_total:['kambiNfl'],
  player_prop:['stake','kambiTraditional','kambiNfl','bovadaNfl','bovadaTraditional','fanduelProps','draftkingsNfl','draftkingsTraditional']
};

for (const [family,evidence] of Object.entries(familyEvidence)) {
  const collectors=familyCollectors[family]||[];
  const present=collectors.filter(k=>direct[k]);
  const healthy=present.filter(k=>direct[k]?.ok===true);
  if (evidence>0) familyStatus[family]={status:'OK',inventory:evidence,collectors:healthy};
  else if (present.length===0) {
    familyStatus[family]={status:'COVERAGE_FAILURE',inventory:0,collectors:[]};
    failures.push(`COVERAGE_FAILURE ${family}: no collector enumerated this family`);
  } else if (healthy.length===0) {
    familyStatus[family]={status:'COVERAGE_FAILURE',inventory:0,collectors:present};
    failures.push(`COVERAGE_FAILURE ${family}: collectors present but none healthy`);
  } else {
    familyStatus[family]={status:'NO_MARKETS_AVAILABLE',inventory:0,collectors:healthy};
  }
}

const result = {
  generatedAt:new Date().toISOString(), boardGeneratedAt:board.generatedAt||null,
  status:failures.length?'COVERAGE_FAILURE':degraded.length?'DEGRADED':'OK',
  familyEvidence, familyStatus, failures, degraded,
  rule:'Healthy collector + explicit zero inventory = NO_MARKETS_AVAILABLE. Missing/unhealthy enumeration = COVERAGE_FAILURE. Zero opportunities are never inferred from collection failure.'
};
fs.mkdirSync('data',{recursive:true});
fs.writeFileSync('data/production-coverage-audit-latest.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if(failures.length) process.exitCode=2;
