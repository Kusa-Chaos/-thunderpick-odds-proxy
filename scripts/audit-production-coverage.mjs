import fs from 'node:fs';

const boardPath = process.argv[2] || 'data/simple-opportunity-latest.json';
const contractPath = process.argv[3] || 'config/production-coverage-contract.json';
const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const direct = board?.sourceHealth?.direct || {};
const sportAudit = board?.coverageAudit || {};
const failures = [];
const degraded = [];
const optionalDegraded = [];
const familyStatus = {};

for (const sport of contract.sports) {
  if (board?.sourceHealth?.thunderpickFreshBySport?.[sport] !== true) failures.push(`Thunderpick not fresh: ${sport}`);
  if (!sportAudit[sport]) failures.push(`Missing coverageAudit sport: ${sport}`);
}

const expectedCollectors = ['stake','pinnacle','kambi','kambiTraditional','kambiNfl','bovadaNfl','bovadaTraditional','fanduel','fanduelProps','draftkingsNfl','draftkingsTraditional'];
for (const name of expectedCollectors) {
  const h=direct[name];
  const errors=Array.isArray(h?.errors)?h.errors:[];
  // Pinnacle's public guest API can geo-deny GitHub-hosted runners with HTTP 403.
  // It is an additive source, so a pure 403 must not invalidate a board whose
  // Thunderpick baseline and other independent collectors are healthy.
  const optionalPinnacle403=name==='pinnacle' && errors.length>0 && errors.every(e=>/HTTP\s+403\b/i.test(String(e)));
  if (optionalPinnacle403) {
    optionalDegraded.push(`optional collector unavailable: pinnacle (${String(errors[0]).slice(0,120)})`);
    continue;
  }
  if (!h) degraded.push(`collector missing from sourceHealth: ${name}`);
  else if (h.ok !== true) degraded.push(`collector degraded: ${name}`);
  else if (errors.length) degraded.push(`collector degraded: ${name} (${String(errors[0]).slice(0,120)})`);
}
if (direct.kalshi && (direct.kalshi.ok !== true || (Array.isArray(direct.kalshi.errors) && direct.kalshi.errors.length))) degraded.push(`collector degraded: kalshi (${direct.kalshi.error || direct.kalshi.errors?.[0] || 'unknown'})`);

const familyEvidence = {
  map_winner: Number(direct.kambi?.mapWinnerMarkets || 0),
  map_handicap: Number(direct.kambi?.mapHandicapMarkets || board?.marketFamilyAudit?.map_handicap?.outsideComparisonRows || 0),
  round_handicap: Number(direct.kambi?.roundHandicapMarkets || 0),
  round_total: Number(direct.kambi?.roundTotalMarkets || 0),
  esports_player_kills: Number(direct.kambi?.playerKillMarkets || 0),
  esports_player_deaths: Number(direct.kambi?.playerDeathMarkets || 0),
  sports_spread_handicap: Number(direct.kambiNfl?.spreads || 0) + Number(direct.fanduel?.bySport?.['american-football']?.spreads || 0) + Number(direct.fanduel?.bySport?.basketball?.spreads || 0) + Number(direct.fanduel?.bySport?.baseball?.spreads || 0),
  sports_total: Number(direct.kambiNfl?.totals || 0) + Number(direct.fanduel?.bySport?.['american-football']?.totals || 0) + Number(direct.fanduel?.bySport?.basketball?.totals || 0) + Number(direct.fanduel?.bySport?.baseball?.totals || 0),
  team_total: Number(direct.kambiNfl?.teamTotals || 0) + Number(direct.bovadaNfl?.teamTotals || 0),
  player_prop: ['stake','kambiTraditional','kambiNfl','bovadaNfl','bovadaTraditional','fanduelProps','draftkingsNfl','draftkingsTraditional'].reduce((n,k)=>n+Number(direct[k]?.playerPropMarkets || 0),0)
};

const familyCollectors = {
  map_winner:['kambi'], map_handicap:['kambi'], round_handicap:['kambi'], round_total:['kambi'],
  esports_player_kills:['kambi'], esports_player_deaths:['kambi'],
  sports_spread_handicap:['kambiNfl','fanduel'], sports_total:['kambiNfl','fanduel'], team_total:['kambiNfl','bovadaNfl'],
  player_prop:['stake','kambiTraditional','kambiNfl','bovadaNfl','bovadaTraditional','fanduelProps','draftkingsNfl','draftkingsTraditional']
};

function collectorExplicitlyEnumerated(name,family){
  const h=direct[name];
  if (!h || h.ok!==true || (Array.isArray(h.errors)&&h.errors.length)) return false;
  if (family==='team_total') {
    if (name==='kambiNfl') return Number(h.nflEvents||0)>0 && Number(h.deepRequests||0)>0 && Object.hasOwn(h,'teamTotals');
    if (name==='bovadaNfl') return Number(h.rawEvents||0)>0 && Object.hasOwn(h,'teamTotals');
    return false;
  }
  if (family==='map_handicap') return Number(h.deepEventRequests||0)>0 && Object.hasOwn(h,'mapHandicapMarkets');
  return true;
}

for (const [family,evidence] of Object.entries(familyEvidence)) {
  const collectors=familyCollectors[family]||[];
  const present=collectors.filter(k=>direct[k]);
  const healthy=present.filter(k=>direct[k]?.ok===true && !(Array.isArray(direct[k]?.errors)&&direct[k].errors.length));
  const enumerated=healthy.some(k=>collectorExplicitlyEnumerated(k,family));
  if (evidence>0) familyStatus[family]={status:'OK',inventory:evidence,collectors:healthy,enumerated:true};
  else if (present.length===0 || healthy.length===0 || !enumerated) {
    familyStatus[family]={status:'COVERAGE_FAILURE',inventory:0,collectors:healthy,enumerated:false};
    failures.push(`COVERAGE_FAILURE ${family}: zero inventory was not explicitly enumerated by a healthy collector`);
  } else {
    familyStatus[family]={status:'NO_MARKETS_AVAILABLE',inventory:0,collectors:healthy,enumerated:true};
  }
}

const result = {
  generatedAt:new Date().toISOString(), boardGeneratedAt:board.generatedAt||null,
  status:failures.length?'COVERAGE_FAILURE':degraded.length?'DEGRADED':'OK',
  familyEvidence, familyStatus, failures, degraded, optionalDegraded,
  rule:'Healthy collector + explicit zero inventory = NO_MARKETS_AVAILABLE. Missing/unhealthy required enumeration = COVERAGE_FAILURE. Required collector error arrays count as degradation even when ok=true. A pure Pinnacle HTTP 403 is recorded as optional degradation and does not block publication because Pinnacle is additive and not the sole required collector for any coverage family.'
};
fs.mkdirSync('data',{recursive:true});
fs.writeFileSync('data/production-coverage-audit-latest.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
await import('./build-results-display.mjs');
if(failures.length) process.exitCode=2;
