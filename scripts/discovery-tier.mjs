import {canonicalBookmakerFamily} from './third-source-eligibility.mjs';

/**
 * Loose discovery is never sufficient for WATCH/ACTION.
 * Only independently named outside bookmaker families may count.
 * An exact identity is required before a discovery row enters SCREENING.
 */
export function classifyDiscoveryTier(row={}) {
  const outside=Array.isArray(row.outside)?row.outside:[];
  const families=new Set(outside.map(q=>{
    const raw=String(q?.sourceFamily||q?.book||q?.title||q?.source||q?.provider||q?.name||'').toLowerCase();
    return canonicalBookmakerFamily(raw)||raw.replace(/[^a-z0-9]/g,'');
  }).filter(x=>x&&x!=='thunderpick'&&x!=='unknown'));
  return row.identityComplete===true&&families.size>=2?'SCREENING':'INFORMATIONAL';
}
