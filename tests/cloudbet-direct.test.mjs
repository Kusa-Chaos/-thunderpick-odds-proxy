import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCloudbetEvent } from '../scripts/cloudbet-direct-lib.mjs';

test('normalizes prematch Cloudbet moneyline as one exact source family', () => {
  const event={id:123,status:'TRADING',sport:{key:'basketball'},home:{name:'Seattle'},away:{name:'Portland'},markets:{'basketball.moneyline':{submarkets:{'period=ft':{selections:[{outcome:'home',price:'2.10',status:'SELECTION_ENABLED'},{outcome:'away',price:'1.80',status:'SELECTION_ENABLED'}]}}}}};
  const rows=normalizeCloudbetEvent(event);
  assert.equal(rows.length,1);
  assert.equal(rows[0].bookmakers[0].key,'cloudbet-direct');
  assert.equal(rows[0].bookmakers[0].markets[0].key,'h2h');
  assert.deepEqual(rows[0].bookmakers[0].markets[0].outcomes.map(x=>x.price),[2.1,1.8]);
});

test('rejects live events so live Cloudbet never mixes with prematch Thunderpick',()=>{
  const event={id:1,status:'TRADING_LIVE',sport:{key:'basketball'},home:{name:'A'},away:{name:'B'},markets:{}};
  assert.deepEqual(normalizeCloudbetEvent(event),[]);
});

test('does not promote unknown Cloudbet market identity',()=>{
  const event={id:2,status:'TRADING',sport:{key:'cs2'},home:{name:'A'},away:{name:'B'},markets:{'esports.unknown_market':{submarkets:{'':{selections:[{outcome:'home',price:'2'}]}}}}};
  assert.deepEqual(normalizeCloudbetEvent(event),[]);
});
