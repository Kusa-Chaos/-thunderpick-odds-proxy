import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const dir=await fs.mkdtemp(path.join(os.tmpdir(),'objective-inventory-'));
const tpFile=path.join(dir,'tp.json'),directFile=path.join(dir,'direct.json'),outFile=path.join(dir,'out.json');
const tp={sports:{
  lol:{data:{data:[{name:'Cloud9 vs LYON',teams:{home:{name:'Cloud9'},away:{name:'LYON'}},preferredMarkets:[{name:'First to Reach Kills - Map 1',baseLine:'5',period:{type:'map',number:1},selections:[{name:'Cloud9',odds:2.05},{name:'LYON',odds:1.68}]}]}]}},
  dota2:{data:{data:[{name:'Team Spirit vs Team Yandex',teams:{home:{name:'Team Spirit'},away:{name:'Team Yandex'}},preferredMarkets:[{name:'Total Towers Destroyed Over/Under - Map 1',baseLine:'11.5',period:{type:'map',number:1},selections:[{name:'Over',odds:1.54},{name:'Under',odds:2.22}]}]}]}}
}};
const direct={sports:{
  lol:{exactV2:[{home_team:'LGD Gaming',away_team:'FlyQuest',bookmakers:[{key:'stake-direct',markets:[{name:'Map 1 - Total Barons',key:'totals',outcomes:[{name:'Over 1.5',price:2.7,point:1.5},{name:'Under 1.5',price:1.4,point:1.5}]}]}]}]},
  dota2:{exactV2:[{home_team:'LGD Gaming',away_team:'GamerLegion',bookmakers:[{key:'stake-direct',markets:[{name:'Map 1 - Total Roshans 2.5',key:'totals',outcomes:[{name:'Over 2.5',price:2.35,point:2.5},{name:'Under 2.5',price:1.52,point:2.5}]}]}]}]}
}};
await fs.writeFile(tpFile,JSON.stringify(tp));
await fs.writeFile(directFile,JSON.stringify(direct));
execFileSync(process.execPath,['scripts/objective-market-inventory.mjs'],{cwd:process.cwd(),env:{...process.env,TP_FILE:tpFile,DIRECT_FILE:directFile,OUT_FILE:outFile},stdio:'pipe'});
const out=JSON.parse(await fs.readFile(outFile,'utf8'));
function fam(sport,source,family){return out?.sports?.[sport]?.sources?.[source]?.families?.[family];}
if(fam('lol','thunderpick','race_to_kills')?.contracts!==1)throw new Error('missing Thunderpick LoL race_to_kills inventory');
if(!fam('lol','thunderpick','race_to_kills')?.lines?.includes(5))throw new Error('race_to_kills threshold 5 not preserved');
if(fam('dota2','thunderpick','total_towers')?.contracts!==1)throw new Error('missing Thunderpick Dota total_towers inventory');
if(!fam('dota2','thunderpick','total_towers')?.lines?.includes(11.5))throw new Error('Dota tower line 11.5 not preserved');
if(fam('lol','stake-oddin','total_barons')?.contracts!==1)throw new Error('missing Stake LoL total_barons inventory');
if(fam('dota2','stake-oddin','total_roshans')?.contracts!==1)throw new Error('missing Stake Dota total_roshans inventory');
console.log('OBJECTIVE_MARKET_INVENTORY_VERIFIED');
