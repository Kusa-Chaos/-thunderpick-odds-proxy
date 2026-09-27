# Full-board normalizer v2 checkpoint — 2026-09-27

Production commit: `ec094c04bc60fa736d764067353cf346c78b85db`
Prior known-good rollback anchor: `ac1120e1781c2ca8b3dbc7f970e2fb9f9cf3aabd`
Validation workflow: `Thunderpick Simple Hourly Board` run `36353694767` — SUCCESS.
Fresh authoritative board generated: `2026-09-27T22:03:58.830Z`.
Board mode: `simple-discovery-first-full-board-v2`.

## Upgrade now in production

- Thunderpick first-party collector deep-scans all nine categories: american-football, baseball, basketball, soccer, tennis, CS2, Dota 2, LoL, Valorant.
- Universal exact-contract identity: sport + event + market family + target + stat + exact line + period/map/round/set + side + prematch/live state + settlement scope.
- Player props require exact player/target + recognized stat + exact line before WATCH/ACTION eligibility.
- Same-provider adapters are collapsed to one source family.
- Source families explicitly normalize Unibet/Kambi, Stake/Oddin, DraftKings, FanDuel, Caesars, BetMGM, Bovada, Pinnacle, Betway, Kalshi and Polymarket.
- Sport-specific prop vocabulary covers football passing/rushing/receiving/receptions/TDs/completions/attempts/interceptions/rush attempts; basketball points/rebounds/assists/threes/steals/blocks/turnovers/PRA; baseball strikeouts/hits/total bases/runs/RBI/HR/walks; tennis aces/double faults; soccer shots/SOT/goals/cards; esports kills/deaths/headshots plus map/round derivatives.
- Existing direct-source expansion remains active: Stake/Oddin, Betway, Pinnacle, Kambi esports, Kambi traditional, Kambi NFL, Bovada NFL/traditional, FanDuel NFL/NBA/MLB lines+props, DraftKings NFL/NBA/MLB props, Kalshi/Polymarket supplemental exact contracts.
- Authoritative board now publishes `coverageAudit` per sport with event count, TP market count, deep-market count, exact 1-source / 2-source / 3+-source counts, ACTION/WATCH/SCREENING counts, and incomplete-identity count.
- Authoritative board row cap increased from 250 to 500.
- Stale Thunderpick remains suppressed and cannot promote to current ACTION/WATCH.
- ACTION remains 3+ independent exact sources + EV >=2%; WATCH 2+ + EV >=1%; SCREENING 1+ + EV >=0.25% or exactness verification required.

## Rollback

If production degrades, compare against this checkpoint first. The earlier known-good architecture remains recoverable at `ac1120e1781c2ca8b3dbc7f970e2fb9f9cf3aabd`.
