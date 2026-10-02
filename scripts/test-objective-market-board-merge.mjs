import fs from 'node:fs/promises';
function expect(cond,msg){if(!cond)throw new Error(msg);}
const path='scripts/objective-market-board-merge.mjs';
let exists=true;try{await fs.access(path);}catch{exists=false;}
expect(exists,'objective-market-board-merge.mjs must exist');
const {mergeObjectiveRowsIntoBoard}=await import('./objective-market-board-merge.mjs');
const board={generatedAt:new Date().toISOString(),counts:{ACTION:0,WATCH:0,SCREENING:1,'PRICE BOARD':0,INFORMATIONAL:0},coverageAudit:{lol:{screening:1,watch:0,action:0},dota2:{screening:0,watch:0,action:0}},rows:[{tier:'SCREENING',sport:'lol',match:'Existing vs Row',market:'Match Winner',marketKey:'ml',side:'existing',state:'prematch',settlementScope:'standard',independentSources:1,estimatedEV:0.01,identityComplete:true}]};
const objectiveRows=[
  {tier:'SCREENING',sport:'lol',match:'Alpha vs Beta',market:'Map 1 - First to Reach Kills',marketKey:'race_to_kills',line:5,scope:{map:1},side:'alpha',state:'prematch',settlementScope:'standard',thunderpick:2.05,outside:[{sourceFamily:'stake-oddin',price:1.85}],independentSources:1,fairProbability:0.5067,estimatedEV:0.0387},
  {tier:'WATCH',sport:'dota2',match:'Spirit vs Yandex',market:'Map 1 - Total Towers Destroyed',marketKey:'total_towers',line:11.5,scope:{map:1},side:'under',state:'prematch',settlementScope:'standard',thunderpick:2.25,outside:[{sourceFamily:'stake-oddin',price:1.85},{sourceFamily:'ggbet',price:1.87}],independentSources:2,fairProbability:0.51,estimatedEV:0.1475}
];
const out=mergeObjectiveRowsIntoBoard({board,objectiveRows});
expect(out.rows.length===3,'objective rows must be merged without dropping existing board rows');
expect(out.counts.SCREENING===2&&out.counts.WATCH===1,'tier counts must include objective rows');
const towers=out.rows.find(r=>r.marketKey==='total_towers');
expect(towers?.identityComplete===true,'merged objective rows must carry complete exact identity');
expect(towers?.identity?.map==='1'&&towers?.identity?.line==='11.5','merged tower identity must retain Map 1 and 11.5');
expect(out.coverageAudit.dota2.watch===1,'coverage audit must count promoted objective WATCH rows');
console.log('OBJECTIVE_MARKET_BOARD_MERGE_VERIFIED',out.rows.length);
