import {classifyArbTier} from './arb-tier.mjs';

const cases=[
  {sum:0.99,identity:true,want:'ARB FOUND'},
  {sum:0.99,identity:false,want:'ARB WATCH'},
  {sum:1.0,identity:true,want:'ARB WATCH'},
  {sum:1.01,identity:true,want:'ARB WATCH'},
  {sum:1.010001,identity:true,want:'ARB SCREENING'},
  {sum:1.02,identity:true,want:'ARB SCREENING'},
  {sum:1.03,identity:true,want:'ARB SCREENING'},
  {sum:1.030001,identity:true,want:null},
];
for(const c of cases){
  const got=classifyArbTier(c.sum,c.identity);
  if(got!==c.want) throw new Error(`sum=${c.sum} identity=${c.identity} expected ${c.want} got ${got}`);
}
console.log('ARB_TIER_THRESHOLDS_VERIFIED',cases.length);
