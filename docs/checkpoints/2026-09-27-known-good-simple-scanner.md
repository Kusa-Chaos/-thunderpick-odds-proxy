# Thunderpick Simple Scanner — Known-Good Checkpoint

Checkpoint date: 2026-09-27 UTC
Repository: Kusa-Chaos/-thunderpick-odds-proxy
Known-good published commit before this documentation-only checkpoint: `ac1120e1781c2ca8b3dbc7f970e2fb9f9cf3aabd`

This checkpoint records the production architecture after the fresh Thunderpick first-party/public-reader path, expanded outside-book coverage, NFL player-prop matching, and source-family de-duplication were verified.

## Production scheduling

- Primary GitHub workflow: `.github/workflows/thunderpick-simple-hourly.yml`
- Workflow name: `Thunderpick Simple Hourly Board`
- Production cron: `27 * * * *` (hourly at :27 UTC-based GitHub cron)
- Manual `workflow_dispatch` remains enabled for tests.
- Concurrency group: `thunderpick-simple-hourly`, `cancel-in-progress: true`, so only the newest production scan survives if runs overlap.
- Watchdog: `.github/workflows/thunderpick-scan-watchdog.yml`, hourly at :47. It only dispatches the Simple Hourly Board if `data/simple-opportunity-latest.json` is more than 70 minutes old.
- Legacy workflows `thunderpick-comparison.yml`, `thunderpick-owls.yml`, `thunderpick-direct-production.yml`, and `thunderpick-scan.yml` are manual-only diagnostics and are not production schedulers.
- ChatGPT delivery task: `Fresh Thunderpick Combined Scan`, hourly at :35 America/Los_Angeles. It reads `data/simple-opportunity-latest.json` first and reports the newest completed Simple Hourly Board.

## Production Thunderpick acquisition

The scanner does not depend on Opera and does not require a paid odds API for current Thunderpick prices.

1. `scripts/thunderpick-firstparty-browser.mjs` attempts the first-party Thunderpick `/api/matches` and `/api/markets/<matchId>` paths from the unattended cloud workflow.
2. `scripts/thunderpick-public-reader.mjs` is the free first-party public-reader fallback, including NFL competition discovery, match metadata, and full market JSON.
3. A sport is considered fresh only when the current first-party acquisition succeeds. Stale/fallback Thunderpick prices are suppressed from ACTION/WATCH/SCREENING output rather than shown as current.
4. NFL deep markets include player props such as passing yards, rushing yards, receiving yards, receptions, passing touchdowns, attempts, and other first-party Thunderpick markets when available.

## Outside comparison sources

Current production source families include:

- Stake / Oddin
- Betway
- Pinnacle
- Unibet / Kambi
- Bovada (NFL deep markets/player props)
- Kalshi when the exact comparable contract exists
- Polymarket when the exact comparable contract exists and is current

Multiple adapters backed by the same provider family are de-duplicated. In particular, Unibet/Kambi general and NFL adapters count as ONE independent source family, never two.

## Supported categories

The combined production report covers:

- american-football
- baseball
- basketball
- soccer
- tennis
- cs2
- dota2
- lol
- valorant

Synthetic/virtual/eSoccer/eBasketball/Madden/eFootball simulations, completed/settled matches, and unverifiable events are excluded.

## Exact contract identity

Promotion beyond SCREENING requires the same contract, not merely the same event. Identity includes:

`SPORT + EVENT + MARKET TYPE + TARGET + EXACT LINE + PERIOD/MAP/ROUND + SIDE + LIVE/PREMATCH + SETTLEMENT SCOPE`

Player props additionally require the same player, stat, and exact line. Fuzzy matching may help discover the event/team alias but may not establish contract identity.

## Tiers

- ACTION: 3+ independent exact verified source families, EV >= 2%, and fresh Thunderpick verification.
- WATCH: 2+ independent exact source families, EV >= 1%, and fresh Thunderpick price.
- SCREENING: 1+ outside source and EV >= 0.25%, or a serious discrepancy that still needs exact verification.
- PRICE BOARD: outside comparison exists but does not meet positive screening threshold.
- INFORMATIONAL: inventory/context only; no usable current comparison or stale Thunderpick price.

EV formula: `Thunderpick decimal odds × vig-free fair probability − 1`.

## Production data flow

1. Refresh current Thunderpick first-party prices/markets.
2. Apply the free public-reader NFL fallback.
3. Collect quota-free/public outside sources.
4. Add Betway.
5. Add Pinnacle.
6. Add Unibet/Kambi esports/deep markets.
7. Add Unibet/Kambi NFL markets/player props.
8. Add Bovada NFL markets/player props.
9. Build broad loose discovery rows.
10. Merge direct sources.
11. Run exact contract safety screen.
12. Verify exact NFL player-prop rows.
13. Verify exact two-source WATCH rows.
14. Build the simplified combined board.
15. Publish `data/simple-opportunity-latest.json` and related data files.

## Authoritative output files

Delivery reads in this order:

1. `data/simple-opportunity-latest.json` — authoritative combined output.
2. `data/simple-direct-discovery-latest.json`.
3. `data/direct-sources-latest.json`.
4. `data/screen-latest.json`.
5. `data/owls-latest.json` / `data/owls-meta.json` — current Thunderpick snapshot/freshness diagnostics despite the historical filename.

Legacy `scan-report-latest.json`, `scan-display-latest.json`, and `owls-comparison-latest.json` must not override the simplified production board.

## Known-good verification

The production workflow was manually tested end-to-end after the free Thunderpick freshness path and source-family de-duplication changes. Critical Thunderpick refresh, public-reader fallback, outside source collection, exact safety screen, NFL prop verifier, WATCH verifier, simple board build, and publish all completed successfully.

A later bot-published board commit `ac1120e1781c2ca8b3dbc7f970e2fb9f9cf3aabd` is the rollback anchor for this checkpoint.

If a future change breaks production, compare/revert scanner code back to this commit rather than restoring any legacy Owls-first scanner.
