// Production comparison orchestrator. Existing Owls/OddsPapi/PropLine-compatible
// comparison runs first; quota-free public collectors are then merged before screening.
// This preserves existing behavior while preventing aggregator quota exhaustion from
// reducing every outside-source path to zero.
await import('./owls-comparison.mjs');
await import('./direct-public-sources.mjs');
await import('./merge-direct-sources.mjs');
