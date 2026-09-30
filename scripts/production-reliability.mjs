import fs from 'node:fs';

export const REQUIRED_SPORTS = ['american-football','baseball','basketball','soccer','tennis','cs2','dota2','lol','valorant'];

export function boardAgeMinutes(generatedAt, nowMs = Date.now()) {
  const t = Date.parse(generatedAt || '');
  if (!Number.isFinite(t)) return Infinity;
  return Math.max(0, (nowMs - t) / 60000);
}

export function validatePublication({ full, compact, audit, nowMs = Date.now(), maxAgeMinutes = 10 }) {
  const errors = [];
  if (!full || !compact || !audit) errors.push('PUBLICATION INPUT MISSING');
  if (full?.generatedAt !== compact?.generatedAt) errors.push('DISPLAY BOARD ERROR: generatedAt mismatch');
  for (const tier of ['ACTION','WATCH']) {
    if (Number(full?.counts?.[tier] ?? 0) !== Number(compact?.counts?.[tier] ?? 0)) errors.push(`DISPLAY BOARD ERROR: ${tier} count mismatch`);
  }
  if ((compact?.actionRows ?? []).length !== Number(full?.counts?.ACTION ?? 0)) errors.push('DISPLAY BOARD ERROR: ACTION rows missing');
  if ((compact?.watchRows ?? []).length !== Number(full?.counts?.WATCH ?? 0)) errors.push('DISPLAY BOARD ERROR: WATCH rows missing');
  if (audit?.status !== 'OK' || (audit?.failures ?? []).length) errors.push('PRODUCTION COVERAGE FAILURE');
  const coverage = full?.coverageAudit ?? full?.coverage ?? {};
  for (const sport of REQUIRED_SPORTS) {
    const c = coverage?.[sport];
    if (!c) { errors.push(`COVERAGE FAILURE: ${sport} missing`); continue; }
    if (Number(c.deepSelectedEvents ?? -1) !== Number(c.deepSuccessfulEvents ?? -2) || Number(c.deepFailedEvents ?? 1) !== 0) errors.push(`DEEP COVERAGE FAILURE: ${sport}`);
  }
  if (boardAgeMinutes(full?.generatedAt, nowMs) > maxAgeMinutes) errors.push('BOARD TOO OLD FOR PUBLICATION');
  return { ok: errors.length === 0, errors };
}

if (process.argv[2] === 'validate-publication') {
  const [fullPath, compactPath, auditPath] = process.argv.slice(3);
  const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
  const result = validatePublication({ full: read(fullPath), compact: read(compactPath), audit: read(auditPath) });
  console.log(JSON.stringify(result));
  if (!result.ok) process.exit(1);
}
