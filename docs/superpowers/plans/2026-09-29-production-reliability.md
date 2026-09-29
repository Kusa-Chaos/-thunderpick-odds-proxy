# Thunderpick Production Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing Thunderpick production pipeline so delayed schedules, duplicate triggers, stale boards, and failed attempts cannot create a misleading :05 delivery.

**Architecture:** Preserve all sportsbook collectors, exact matching, EV math, tiering, and coverage semantics. Add a small reliability layer: heartbeat generation, compact/full publication validation, and a proactive watchdog that dispatches one current-main scan when the verified board exceeds 25 minutes and no scan is active.

**Tech Stack:** GitHub Actions YAML, Node.js 22, existing JSON board artifacts and scanner scripts, deterministic Node tests with no sportsbook calls.

**Spec:** `docs/superpowers/specs/2026-09-29-production-reliability-design.md`

## Global Constraints
- Do not change Thunderpick market collection semantics, EV math, tier thresholds, exact-contract identity rules, source-family deduplication, or add sportsbooks.
- GitHub Actions remains authoritative; AWS remains optional input only in this phase.
- Preserve `concurrency.group: thunderpick-simple-hourly` and `cancel-in-progress: false`.
- Preserve one degraded-collector retry, hard coverage gate, pre-publication freshness validation, and post-publication verification.
- Cover american-football, baseball, basketball, soccer, tennis, cs2, dota2, lol, valorant.
- Require `deepSelectedEvents == deepSuccessfulEvents` and `deepFailedEvents == 0` before publication.
- No paid service.

## Review Focus
- Missing/invalid `generatedAt` must trigger recovery, never be treated as fresh.
- Multiple watchdog ticks while a long scan is active must not stack or cancel production runs.
- Compact/full generatedAt or ACTION/WATCH mismatch must fail before repository data is replaced.
- Failure after board construction but before verification must preserve the prior verified board.
- AWS snapshot failure must remain non-fatal unless existing coverage rules independently fail.

---

### Task 1: Reliability helper and deterministic tests

**Files:**
- Create: `scripts/production-reliability.mjs`
- Create: `tests/production-reliability.test.mjs`

**Interfaces:**
- Produces `boardAgeMinutes(generatedAt, nowMs)`, `decideFreshness({generatedAt, nowMs, activeCurrentCodeRun})`, `validatePublication({fullBoard, displayBoard, coverageAudit})`, and `buildHeartbeat(input)`.
- `decideFreshness` returns one of `HEALTHY`, `WAIT_ACTIVE`, `DISPATCH`, `STALE_DISPATCH` and never performs network calls.
- `validatePublication` throws on stale/full-display mismatch/coverage/deep-pull failure.

- [ ] Write failing tests for <=25m healthy, >25m idle dispatch, >25m active wait, missing generatedAt dispatch, >40m stale dispatch, compact/full generatedAt mismatch, ACTION/WATCH count mismatch, coverage failure, deep mismatch, and deepFailedEvents >0.
- [ ] Run `node --test tests/production-reliability.test.mjs`; expect failure because helper does not exist.
- [ ] Implement the minimal pure helper functions in `scripts/production-reliability.mjs`.
- [ ] Run `node --test tests/production-reliability.test.mjs`; expect all tests PASS.
- [ ] Commit helper + tests.

### Task 2: Heartbeat artifact without changing scanner semantics

**Files:**
- Modify: `.github/workflows/thunderpick-simple-hourly.yml`
- Use: `scripts/production-reliability.mjs`
- Publish: `data/production-heartbeat-latest.json`

**Interfaces:**
- Workflow writes `RUNNING` diagnostic state at scan start in the runner workspace.
- Successful verified publication produces `CURRENT` with run ID/attempt, code SHA, started/finished timestamps, board generatedAt, coverage summary, recovery reason/count, publication and verification status.
- Failure state is diagnostic only and must not replace the prior authoritative betting board.

- [ ] Add a deterministic test fixture asserting `buildHeartbeat` emits required schema/state fields.
- [ ] Run helper tests; expect the new assertion to fail before implementation.
- [ ] Add heartbeat construction to the workflow using the helper, without changing any collector commands or betting-board scripts.
- [ ] Run helper tests; expect PASS.
- [ ] Review workflow diff and verify no collector, EV, tier, identity, source-family, or retry command changed.
- [ ] Commit heartbeat stage.

### Task 3: Transactional compact/full publication gate

**Files:**
- Modify: `.github/workflows/thunderpick-simple-hourly.yml`
- Use: `scripts/production-reliability.mjs`

**Interfaces:**
- Pre-publication validation reads `data/simple-opportunity-latest.json`, `data/simple-opportunity-display-latest.json`, and `data/production-coverage-audit-latest.json`.
- Publication cannot begin unless full/display `generatedAt` match, ACTION/WATCH counts match, board is <=10m old at pre-publish, coverage passes, deepSelected==deepSuccessful, and deepFailed==0.

- [ ] Add fixture tests for a valid publish set and each mismatch/failure condition.
- [ ] Run tests; confirm failure before workflow integration where appropriate.
- [ ] Replace the inline freshness-only validation with the shared `validatePublication` gate while retaining existing coverage enforcement immediately before it.
- [ ] Run deterministic tests; expect PASS.
- [ ] Inspect publish step ordering and confirm `git reset --hard origin/main` plus data replacement occurs only after validation passes.
- [ ] Commit transactional validation.

### Task 4: Proactive 25-minute watchdog

**Files:**
- Modify: `.github/workflows/thunderpick-hourly-watchdog.yml`
- Use: authoritative `data/simple-opportunity-latest.json`

**Interfaces:**
- Schedule check frequency: every 5 minutes.
- Board <=25m: exit successfully with no dispatch.
- Board >25m + queued/in-progress current-main scan: exit successfully with no dispatch.
- Board >25m + idle: dispatch exactly one `thunderpick-simple-hourly.yml` run on `main` and verify a new workflow_dispatch run ID is observed.
- Board >40m follows the same single-dispatch rule but records stale/recovery context.

- [ ] Add/extend pure decision tests for repeated ticks and long-running active scans.
- [ ] Run tests; expect PASS for decision helper before workflow wiring.
- [ ] Change watchdog cadence to `*/5 * * * *` and threshold to 25 minutes, preserving active-run detection and accepted-dispatch verification.
- [ ] Verify watchdog never uses workflow `updated_at` as freshness and never reruns an old-code run.
- [ ] Verify scanner concurrency remains unchanged.
- [ ] Commit watchdog controller.

### Task 5: End-to-end static/regression verification

**Files:**
- Test existing workflow + new helper/test files.

**Interfaces:**
- No sportsbook network calls are required for regression tests.

- [ ] Run `node --test tests/production-reliability.test.mjs`; require all PASS.
- [ ] Inspect production workflow and confirm all existing collector commands remain present: Thunderpick, public reader, public sources, Kalshi, Betway, Pinnacle, Kambi esports/traditional/NFL, Bovada NFL/traditional, FanDuel lines/props, DraftKings NFL/traditional.
- [ ] Confirm hard coverage audit, one collector retry, final coverage enforcement, publication, and authoritative verification remain present and ordered.
- [ ] Confirm nine-category/deep-pull acceptance conditions are enforced by the publication validator/audit.
- [ ] Compare branch against main; reject unexpected changes to scanner source/EV scripts.
- [ ] Open a draft PR for review; do not merge until workflow diff and tests are verified.

### Task 6: Controlled production rollout

**Files:**
- Merge only reviewed reliability changes; scanner logic remains untouched.

**Interfaces:**
- Acceptance requires successful production cycles with no duplicate active scans and a fresh verified board/heartbeat.

- [ ] Merge after review.
- [ ] Observe the next production/watchdog cycle and verify one active scan maximum.
- [ ] Verify `production-heartbeat-latest.json` reaches `CURRENT` and matches the published board generatedAt.
- [ ] Verify compact/full counts and generatedAt match on the live board.
- [ ] Verify coverage audit passes with all nine categories and zero deep failures.
- [ ] If any acceptance check fails, revert the specific reliability commit; do not alter scanner/source logic.
