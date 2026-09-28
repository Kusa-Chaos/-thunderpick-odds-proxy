# Thunderpick production coverage requirements

The production scanner must use Thunderpick as the inventory baseline and must never interpret a missing collector/family as `0 opportunities`.

## Required market families

- ML / H2H / Match Winner
- Sports spreads / handicaps
- Sports game totals OVER/UNDER
- Team totals OVER/UNDER
- Map Winner
- Map Handicap
- Round Handicap
- Round Totals OVER/UNDER
- Player props with exact OVER/UNDER, player, stat, line and period/map/round/set scope
- Esports player kills OVER/UNDER
- Esports player deaths OVER/UNDER

## Required hourly family audit

Every family must publish: Thunderpick inventory; rows with outside comparison; exact matched rows; 1-source, 2-source and 3+-source counts; ACTION, WATCH and SCREENING counts; strongest SCREENING candidate; and coverage status.

Coverage status is one of `OK`, `NO_MARKETS_AVAILABLE`, `DEGRADED`, or `COVERAGE_FAILURE`.

`NO_MARKETS_AVAILABLE` is allowed only when the relevant collector succeeded and explicitly verified no current markets. Missing enumeration is `COVERAGE_FAILURE`.

## Source health

Same-provider adapters count once. HTTP 429, geo blocks, parsing errors, anomalous inventory drops and missing collectors are reported as degraded. A required-family collection failure gets one retry. It must not silently become a no-bet result.

## Freshness and identity

Board age must be <=30 minutes. Never mix live Thunderpick with prematch outside prices. Contract identity is sport + event + market family + target + stat + exact line + period/map/round/set + side + prematch/live + settlement scope.

## Validation

Run `node scripts/audit-production-coverage.mjs` after building the opportunity board. It writes `data/production-coverage-audit-latest.json`. A `COVERAGE_FAILURE` means the board is incomplete and must not be described as full-market coverage.
