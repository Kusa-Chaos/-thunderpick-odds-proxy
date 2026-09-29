# Thunderpick Production Reliability Hardening Design

## Goal
Keep the existing GitHub Actions Thunderpick sports + esports scanner authoritative while preventing a delayed cron, failed collector, stale publication, or duplicate trigger from producing a missing, misleading, or stale :05 delivery.

## Non-goals
- Do not change Thunderpick market collection semantics, EV math, tier thresholds, exact-contract identity rules, or source-family deduplication.
- Do not add paid monitoring services.
- Do not add new sportsbooks in this reliability change.
- Do not migrate the scanner itself to AWS.

## Existing invariants to preserve
- GitHub Actions remains the authoritative production scanner.
- Cover american-football, baseball, basketball, soccer, tennis, cs2, dota2, lol, valorant.
- Production publication requires the hard coverage audit to pass.
- deepSelectedEvents must equal deepSuccessfulEvents and deepFailedEvents must equal 0.
- Existing single-run concurrency remains `group: thunderpick-simple-hourly` with `cancel-in-progress: false`.
- Existing degraded-collector retry remains one retry before final coverage enforcement.
- Existing pre-publication freshness and post-publication authoritative-board verification remain mandatory.
- A failed/degraded attempt must never replace the last verified authoritative board.

## Architecture

### 1. Heartbeat/status artifact
Add `data/production-heartbeat-latest.json` as a small diagnostic artifact describing the latest production attempt without changing betting-board semantics. It records schema version, workflow/run identity when available, code SHA, started/finished timestamps, board generatedAt, board state, source/coverage health summary, recovery reason/count, and publication/verification status.

Heartbeat states are explicit: `RUNNING`, `CURRENT`, `FAILED_PRESERVED`, and `STALE`. The betting board remains authoritative for opportunities; the heartbeat is authoritative only for operational state.

### 2. Proactive freshness controller
Keep the scanner workflow unchanged as the execution engine. Add/modify the lightweight watchdog so it checks frequently and dispatches exactly one current-main production scan when the last verified authoritative board is older than 25 minutes and no current-code production scan is queued/in progress.

The controller never performs scanning itself. It must inspect `generatedAt` from the authoritative board, not workflow `updated_at`. It must not dispatch old-code runs and must verify GitHub accepted a dispatch. Existing scanner concurrency remains the second line of duplicate protection.

Operational interpretation:
- board age <=25m: healthy; no dispatch
- board age >25m and current-code scan active: wait; no duplicate
- board age >25m and no current-code scan active: dispatch one current-main scan
- board age 30-40m: recovery/warning state
- board age >40m: stale; delivery must say `STALE — DO NOT BET`

### 3. Transactional publication validation
Before publication is accepted, require all existing production gates plus compact/full consistency:
- nine-category coverage passes
- deepSelectedEvents == deepSuccessfulEvents
- deepFailedEvents == 0
- exact-identity/parse safeguards remain enforced
- source-family deduplication remains enforced by existing scanner logic
- full board is fresh
- compact display `generatedAt` equals full board `generatedAt`
- compact ACTION/WATCH counts equal authoritative full-board ACTION/WATCH counts

If any validation fails, publication fails and the prior verified board remains intact.

### 4. Delivery states
Delivery uses board + heartbeat to distinguish:
- `CURRENT`: verified board within 40 minutes
- `RECOVERY RUNNING`: stale/aging board but a current-code production scan is active
- `STALE — DO NOT BET`: no verified board within 40 minutes and no successful recovery yet

A stale prior board may be shown only as historical context and must not be represented as a current recommendation.

### 5. Regression/self-tests
Add deterministic tests for the reliability layer without calling sportsbooks:
- board <=25m does not dispatch
- board >25m dispatches exactly once when no scan is active
- active scan suppresses duplicate dispatch
- stale/missing generatedAt triggers recovery
- failed collector/coverage audit blocks publication
- AWS snapshot unavailable does not by itself corrupt publication
- compact/full generatedAt mismatch blocks publication
- compact/full ACTION/WATCH count mismatch blocks publication
- malformed odds and missing player identity remain non-actionable under existing safeguards
- deepSelectedEvents/deepSuccessfulEvents mismatch or deepFailedEvents >0 blocks publication
- long-running scan cannot be cancelled/replaced by a new watchdog trigger

## AWS role
AWS remains optional input/backup infrastructure in this phase. Existing S3 snapshot seeding may continue, but the reliability change must not require AWS availability for a valid scan unless an existing production coverage rule already requires the underlying data. EventBridge or another independent AWS clock is explicitly deferred until the GitHub-only controller and heartbeat prove stable.

## Rollout
1. Add heartbeat generation and tests without changing scanner scheduling.
2. Add compact/full transactional validation and tests.
3. Change watchdog to proactive 25-minute freshness control, preserving duplicate protection.
4. Observe successful production cycles and confirm no duplicate scans, no stale publication, and valid heartbeat transitions.
5. Only after stable observation consider an independent AWS trigger as a separate change.

## Rollback
Each stage is independently revertible. If the heartbeat or validation layer causes unexpected production behavior, revert that stage while leaving the scanner/source collectors untouched. If proactive scheduling causes excess/duplicate runs, revert the watchdog threshold/controller commit; scanner production logic and last verified board remain unchanged.

## Acceptance criteria
- Existing scanner/source/EV behavior is unchanged.
- No watchdog action stacks a duplicate current-code scan.
- A verified board older than 25 minutes causes one recovery dispatch when idle.
- No board can be newly published unless all existing production gates and compact/full consistency checks pass.
- Failed attempts preserve the last verified authoritative board.
- Delivery can determine CURRENT / RECOVERY RUNNING / STALE from repository state without inferring from unrelated workflow timestamps.
- Nine-category coverage remains intact with deepSelectedEvents=deepSuccessfulEvents and deepFailedEvents=0.
- No paid service is introduced.
