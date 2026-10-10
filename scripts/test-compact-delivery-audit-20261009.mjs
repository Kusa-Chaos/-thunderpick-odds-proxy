import assert from 'node:assert/strict';
import {buildCompactDeliveryAudit} from './build-compact-delivery-audit.mjs';
const nine=['american-football','baseball','basketball','soccer','tennis','cs2','dota2','lol','valorant'];
const c=Object.fromEntries(nine.map((sp,i)=>[sp,{events:i+5,tpMarkets:(i+1)*200,deepMarkets:(i+1)*170,deepSelectedEvents:i+4,deepSuccessfulEvents:i+4,deepFailedEvents:0,exact1Source:8,exact2Source:3,exact3Plus:0,objectiveContracts:sp==='dota2'?80:sp==='lol'?25:0,action:0,watch:0,screening:i+1,identityIncomplete:0}]));
const board={
 generatedAt:'2026-10-10T01:50:51.420Z',builtAt:'2026-10-10T01:50:52.383Z',
 strictSnapshotHealthy:true,productionCoverageStatus:'OK',productionCoverageFailures:[],
 counts:{ACTION:0,WATCH:1,SCREENING:233,'PRICE BOARD':603,INFORMATIONAL:282,'ARB FOUND':0,'ARB WATCH':2,'ARB SCREENING':1},
 parseErrors:{identity:0,price:0},coverageAudit:c,
 sourceHealth:{direct:{cloudbet:{ok:true,usable:true,events:296,fetchedAt:'2026-10-10T01:47:45Z'},ggbet:{ok:true,usable:true,state:'CONNECTED_USABLE',events:6,markets:595},pinnwire:{ok:true,usable:true,events:16,markets:70},pinnacle:{ok:false,status:500,errors:['HTTP 403']},kambi:{ok:false,status:500,errors:['HTTP 410']},stake:{ok:true,status:200,acceptedEvents:228}},strictSnapshotHealthy:true},
 informationalBreakdown:{player_prop:123,map_winner:50},
 arbitrageAudit:{marketsTested:878,screensEvaluated:2,rejectedIncomplete:8,found:[],watch:[{legs:[{book:'secret'}]}],screening:[]},
 actionRows:[{identity:'should not be in audit',token:'SECRET'}],
};
const audit=buildCompactDeliveryAudit(board);
assert.equal(audit.generatedAt,board.generatedAt,'must tie to exact production board');
assert.equal(audit.health.strictSnapshotHealthy,true);
assert.equal(audit.counts.WATCH,1);
assert.equal(audit.sourceHealth.ggbet.markets,595);
assert.equal(audit.sourceHealth.cloudbet.events,296);
assert.equal(audit.sourceHealth.pinnwire.markets,70);
assert.equal(audit.sourceHealth.kambi.status,500);
assert.deepEqual(Object.keys(audit.coverageAudit),nine,'all nine deep-pull categories must remain');
assert.equal(audit.coverageAudit.lol.objectiveContracts,25);
assert.equal(audit.objectiveAudit.dota2.exact2Source,3);
assert.equal(audit.arbitrageAudit.marketsTested,878);
assert.equal(audit.arbitrageAudit.arbWatch,1);
assert.equal(audit.informationalBreakdown.player_prop,123);
const serialized=JSON.stringify(audit);
assert(serialized.length<12000,'audit must remain safely compact');
assert(!serialized.includes('SECRET')&&!serialized.includes('secret'),'never include full betting rows');
assert.throws(()=>buildCompactDeliveryAudit({...board,coverageAudit:{}}),/nine|sport/i,'incomplete coverage must not masquerade as a complete audit');
console.log('COMPACT_DELIVERY_AUDIT_VERIFIED',{bytes:serialized.length,sports:nine.length,sources:Object.keys(audit.sourceHealth).length});
