import fs from 'node:fs/promises';
import {exactIdentity,identityComplete,exactKey} from './market-identity.mjs';

function expect(cond,msg){if(!cond)throw new Error(msg);}

const identityRow={
  sport:'dota2',match:'Team Spirit vs Team Yandex',market:'Map 1 - Total Towers Destroyed',marketKey:'total_towers',line:11.5,scope:{map:1},side:'under',state:'prematch',settlementScope:'standard'
};
expect(identityComplete(identityRow),'objective Total Towers 11.5 identity must be complete');
const otherMap={...identityRow,scope:{map:2}};
const otherLine={...identityRow,line:12.5};
expect(exactKey(identityRow)!==exactKey(otherMap),'Map 1 and Map 2 objective contracts must not collide');
expect(exactKey(identityRow)!==exactKey(otherLine),'11.5 and 12.5 objective contracts must not collide');
expect(exactIdentity(identityRow).family==='total_towers','objective family must survive exact identity');

const modulePath='scripts/objective-market-promotion.mjs';
let exists=true;try{await fs.access(modulePath);}catch{exists=false;}
expect(exists,'objective-market-promotion.mjs must exist');
const {promoteObjectiveComparison}=await import('./objective-market-promotion.mjs');
const comparison={generatedAt:new Date().toISOString(),sports:{
  lol:{rows:[
    {sport:'lol',event:'Alpha vs Beta',family:'race_to_kills',target:null,map:1,line:5,state:'prematch',settlement:'standard',exactIdentity:true,thunderpick:{label:'Map 1 - First to Reach Kills',prices:{alpha:2.05,beta:1.72},sideLabels:{alpha:'Alpha',beta:'Beta'}},outsideQuotes:[{source:'stake-oddin',prices:{alpha:1.85,beta:1.90}}],independentOutsideSources:1,fairProbabilities:{alpha:0.5066666667,beta:0.4933333333},ev:{alpha:0.0386666667,beta:-0.1514666667},bestArb:null}
  ]},
  dota2:{rows:[
    {sport:'dota2',event:'Spirit vs Yandex',family:'total_towers',target:null,map:1,line:11.5,state:'prematch',settlement:'standard',exactIdentity:true,thunderpick:{label:'Map 1 - Total Towers Destroyed',prices:{over:1.70,under:2.25},sideLabels:{over:'Over',under:'Under'}},outsideQuotes:[{source:'stake-oddin',prices:{over:1.95,under:1.85}},{source:'ggbet',prices:{over:1.93,under:1.87}}],independentOutsideSources:2,fairProbabilities:{over:0.49,under:0.51},ev:{over:-0.167,under:0.1475},bestArb:null}
  ]}
}};
const promoted=promoteObjectiveComparison({comparison,tpFreshBySport:{lol:true,dota2:true},now:Date.now()});
expect(promoted.length===2,'must promote one best-side row per exact objective contract');
const lol=promoted.find(r=>r.sport==='lol');
expect(lol?.tier==='SCREENING','one-source +EV objective contract must remain SCREENING');
expect(lol?.marketKey==='race_to_kills'&&lol?.line===5&&lol?.scope?.map===1,'race-to-5 identity must be retained');
const dota=promoted.find(r=>r.sport==='dota2');
expect(dota?.tier==='WATCH','two-source objective contract with EV >=1% must be WATCH');
expect(dota?.side==='under'&&dota?.line===11.5&&dota?.scope?.map===1,'tower Under 11.5 exact identity must be retained');

const boardSource=await fs.readFile('scripts/simple-opportunity-board.mjs','utf8');
expect(boardSource.includes("objective-market-promotion.mjs"),'hourly board must import objective promotion');
expect(boardSource.includes('objective-market-comparison-latest.json'),'hourly board must read objective comparison artifact');
expect(boardSource.includes('promoteObjectiveComparison'),'hourly board must execute objective promotion');
console.log('OBJECTIVE_MARKET_PROMOTION_VERIFIED',promoted.length);
