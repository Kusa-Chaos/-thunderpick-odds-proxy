export const DIRECT_EVENT_PREFIXES = [
  'stake-direct:',
  'betway-direct:',
  'cloudbet-direct:',
  'cloudbet-objective:',
  'pinnacle-direct:',
  'pinnwire-direct:',
  'unibet-kambi-direct:',
  'unibet-kambi-objective:',
  'bovada-nfl-direct:',
  'bovada-traditional-direct:',
  'fanduel-direct:',
  'fanduel-props-direct:',
  'draftkings-nfl-direct:',
  'draftkings-traditional-direct:',
];

export function isDirectSnapshotEvent(event = {}) {
  const id = String(event?.id || '');
  return DIRECT_EVENT_PREFIXES.some(prefix => id.startsWith(prefix));
}

export function replaceDirectSnapshot(existing = [], incoming = []) {
  const preserved = (existing || []).filter(event => !isDirectSnapshotEvent(event));
  const dedupIncoming = new Map();
  for (const event of incoming || []) {
    const id = String(event?.id || '');
    if (!id) continue;
    dedupIncoming.set(id, event);
  }
  return [...preserved, ...dedupIncoming.values()];
}
