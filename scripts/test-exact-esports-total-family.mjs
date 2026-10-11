import assert from 'node:assert/strict';
import {esportsTotalFamily,exactEsportsTotalFamily} from './exact-esports-total-family.mjs';

const total=(name,line=4.5,map=null)=>({label:name,scope:{map,round:null},selections:[{role:'over',point:line},{role:'under',point:line}]});
const outside=(name,line=4.5,map=null)=>({key:'totals',name,scope:{map,round:null},line,outcomes:[{name:'Over',point:line,price:4.3},{name:'Under',point:line,price:1.2}]});
for(const map of [1,2,3,4,5]){
 assert.equal(exactEsportsTotalFamily(total('Total Elemental Dragons - Map '+map,4.5,map),outside('Total Maps',4.5)),false,'Total Maps must never compare to Map '+map+' Dragons');
}
assert.equal(esportsTotalFamily('Total Maps'),'maps');
assert.equal(esportsTotalFamily('Total Elemental Dragons - Map 1'),'elemental_dragons');
assert.equal(exactEsportsTotalFamily(total('Total Maps',3.5),outside('Total Maps',3.5)),true,'Same maps total with identical full match scope is eligible');
assert.equal(exactEsportsTotalFamily(total('Total Maps',4.5),outside('Total Maps',3.5)),false,'Line must be exact');
assert.equal(exactEsportsTotalFamily(total('Total Kills - Map 1',26.5,1),outside('Total Kills - Map 1',26.5,1)),true,'Same kill metric, line, map can compare');
assert.equal(exactEsportsTotalFamily(total('Total Kills - Map 1',26.5,1),outside('Total Kills - Map 2',26.5,2)),false,'Map 1 versus Map 2 blocked');
assert.equal(exactEsportsTotalFamily(total('Total Kills - Map 1',26.5,1),outside('Total Maps',26.5)),false,'Kills versus Maps blocked');
assert.equal(exactEsportsTotalFamily(total('Total Dragons - Map 1',4.5,1),outside('Total Elemental Dragons - Map 1',4.5,1)),false,'Ambiguous dragon contract vs elemental dragons blocked');
assert.equal(exactEsportsTotalFamily(total('Total Kills - Map 1',26.5,1),outside('Total Kills',26.5)),false,'Missing map scope blocked');
assert.equal(exactEsportsTotalFamily(total('Total Maps',3.5),outside('Total',3.5)),false,'Unspecified metric blocked');
assert.equal(exactEsportsTotalFamily(total('Total Maps',3.5),outside('Total Maps',null)),false,'Missing line blocked');
assert.equal(exactEsportsTotalFamily(total('Total Maps',3.5),outside('Total Maps',3.5,2)),false,'Contradictory scope blocked');
assert.equal(exactEsportsTotalFamily(total('Total Maps',3.5),outside('Total Maps',3.5,null,{bogus:true})),true);
console.log('EXACT_ESPORTS_TOTAL_IDENTITY_VERIFIED',16);
