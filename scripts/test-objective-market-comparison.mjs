import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

function expect(cond,msg){if(!cond)throw new Error(msg);}
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'objective-comparison-'));
const tpFile=path.join(dir,'tp.json'),directFile=path.join(dir,'direct.json'),outFile=path.join(dir,'out.json');
const tp={sports:{lol:{data:{data:[{name:'Vitality vs FearX',isLive:false,teams:{home:{name:'Vitality'},away:{name:'FearX'}},preferredMarkets:[{name:'Total Barons Slain Over/Under - Map 1',baseLine:'1.5',period:{type:'map',number:1},selections:[{name:'Over',odds:2.6,total:'1.5'},{name:'Under',odds:1.42,total:'1.5'}]}]}]}}},dota2:{data:{data:[]}}}};
const direct={sports:{lol:{exactV2:[{home_team:'Team Vitality',away_team:'FearX',bookmakers:[{key:'stake-direct',markets:[{name:'Map 1 - Total Barons',scope:{map:1},outcomes:[{name:'Over 1.5',price:2.7,point:1.5},{name:'Under 1.5',price:1.4,point:1.5}]},{name:'Map 2 - Total Barons',scope:{map:2},outcomes:[{name:'Over 1.5',price:3,point:1.5},{name:'Under 1.5',price:1.3,point:1.5}]}]}]}]},dota2:{exactV2:[]}}};
await fs.writeFile(tpFile,JSON.stringify(tp));await fs.writeFile(directFile,JSON.stringify(direct));
execFileSync(process.execPath,['scripts/objective-market-comparison.mjs'],{cwd:process.cwd(),env:{...process.env,TP_FILE:tpFile,DIRECT_FILE:directFile,OUT_FILE:outFile},stdio:'pipe'});
const out=JSON.parse(await fs.readFile(outFile,'utf8'));
expect(out.mode==='objective-market-comparison-shadow-v1','comparison output must stay shadow mode');
expect(out.sports.lol.summary.tpContracts===1,'must count one Thunderpick objective contract');
expect(out.sports.lol.summary.exactMatches===1,'must produce one exact comparison and reject wrong-map lookalike');
expect(out.sports.lol.rows[0].family==='total_barons'&&out.sports.lol.rows[0].line===1.5&&out.sports.lol.rows[0].map===1,'row identity must retain family/line/map');
expect(out.sports.lol.rows[0].independentOutsideSources===1,'same provider family must count once');
console.log('OBJECTIVE_MARKET_COMPARISON_ARTIFACT_VERIFIED');
