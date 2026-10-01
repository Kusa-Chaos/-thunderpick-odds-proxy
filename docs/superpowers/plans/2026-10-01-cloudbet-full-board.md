# Cloudbet Full-Board Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add Cloudbet as one independent full-board comparison source for all nine production categories, with EMEA Masters as the first acceptance case rather than the scope.

**Architecture:** Add a dedicated Cloudbet Feed API collector that emits the repository's existing exactV2/direct-source shape. Normalize only contracts whose event, market family, side/target, line, period/map/round and live/prematch scope are explicit; merge through the existing contract-safety and independent-source pipeline. Cloudbet is exactly one source family regardless of endpoint/adapter count.

**Tech Stack:** Node.js ESM, native fetch, Cloudbet Feed API v2, existing direct-source/contract-safety/production pipeline.

**Spec:** Approved chat design: Cloudbet full-board across american-football, baseball, basketball, soccer, tennis, cs2, dota2, lol, valorant; EMEA validates map handicap coverage.

## Global Constraints

- Never mix live Thunderpick with prematch Cloudbet.
- Never reinterpret Round Handicap as Map Handicap.
- Cloudbet counts once as an independent source family.
- Missing exact identity fields are rejected, not loosely promoted.
- Existing nine-category production health gates must remain green.
- No Cloudbet trading/bet-placement API calls; odds/feed reads only.

## Review Focus

- Cloudbet API key absent/expired: collector reports degraded health without breaking the existing scan.
- Market-key drift/unknown markets: reject and count; never guess contract identity.
- Same event with reversed home/away naming: canonical event matching must preserve selection side.
- Live event returned beside prematch event: scope must prevent cross-state matching.
- Map/round/period line missing: derivative market must be suppressed.

---

### Task 1: Cloudbet feed collector and normalizer

**Files:**
- Create: `scripts/cloudbet-direct.mjs`
- Create: `tests/cloudbet-direct.test.mjs`

**Interfaces:**
- Consumes: `CLOUDBET_API_KEY` and Cloudbet Feed API v2 JSON.
- Produces: `data/cloudbet-direct-latest.json` with `providerHealth.cloudbet` and `sports.<sport>.exactV2[]` compatible with existing direct sources.

- [ ] Write failing fixture-driven tests for nine-sport routing, ML/H2H, spreads/handicaps, totals, Map Winner, Map Handicap, series/map totals, round derivatives and player props when exact identity exists.
- [ ] Run tests and verify RED because collector/normalizer does not exist.
- [ ] Implement minimal collector/normalizer with API-key auth, bounded requests, freshness/status handling and rejection counters.
- [ ] Run tests and verify GREEN.

### Task 2: Exact-source merge integration

**Files:**
- Modify: `scripts/direct-public-sources.mjs` or the production direct-source orchestration point discovered during implementation.
- Test: extend Cloudbet integration tests.

**Interfaces:**
- Consumes: Cloudbet exactV2 output from Task 1.
- Produces: Cloudbet rows available to the existing contract-safety/independent-source merge with source family `cloudbet`.

- [ ] Write failing test proving Cloudbet contributes one independent source and cannot double-count multiple Cloudbet adapters/endpoints.
- [ ] Verify RED.
- [ ] Wire Cloudbet into direct-source orchestration/merge without changing existing source semantics.
- [ ] Verify GREEN and run existing tests.

### Task 3: EMEA + map-handicap acceptance diagnostics

**Files:**
- Modify: production coverage/audit output as needed.
- Test: add fixture acceptance tests.

**Interfaces:**
- Consumes: normalized Cloudbet rows.
- Produces: health counters for events fetched, markets fetched, map handicaps, exact TP matches and rejection reasons.

- [ ] Write failing EMEA fixture test proving +1.5/-1.5 Map Handicap remains Map Handicap with exact map/series scope and never becomes Round Handicap.
- [ ] Verify RED.
- [ ] Add diagnostics and exact rejection reasons.
- [ ] Verify GREEN.

### Task 4: Full-board regression and deployment readiness

**Files:**
- Modify only files required by test findings.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: branch ready for production deployment.

- [ ] Run complete repository tests and syntax checks.
- [ ] Run collector in no-key mode and verify graceful degraded health.
- [ ] If a Cloudbet API key is already present in the deployment environment, run a live read-only probe across all nine categories and verify health/market counters; otherwise record API key as the only deployment blocker.
- [ ] Verify existing Thunderpick health and source outputs are unchanged when Cloudbet is unavailable.
- [ ] Perform final verification-before-completion review before any merge/deployment claim.
