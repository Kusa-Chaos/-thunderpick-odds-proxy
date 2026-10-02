import fs from 'node:fs/promises';

const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const screen=await read('data/screen-latest.json');
const board=await read('data/simple-opportunity-latest.json');
const display=await read('data/simple-opportunity-display-latest.json');

if(!Array.isArray(screen.arbScreeningCandidates)) throw new Error('screen missing arbScreeningCandidates');
if(!board.arbitrageAudit||!Array.isArray(board.arbitrageAudit.screening)) throw new Error('board missing arbitrageAudit.screening');
if(!Array.isArray(display.arbWatchRows)) throw new Error('display missing arbWatchRows');
if(!Array.isArray(display.arbScreeningRows)) throw new Error('display missing arbScreeningRows');
if(!Array.isArray(display.watchBoardRows)) throw new Error('display missing first-class watchBoardRows');
if(!Array.isArray(display.screeningBoardRows)) throw new Error('display missing first-class screeningBoardRows');

const evWatch=Array.isArray(display.watchRows)?display.watchRows:[];
const arbWatch=display.arbWatchRows;
if(arbWatch.length!==(board.arbitrageAudit.watch||[]).length) throw new Error(`ARB WATCH display is capped/dropped: display=${arbWatch.length} board=${(board.arbitrageAudit.watch||[]).length}`);
if(display.watchBoardRows.length!==evWatch.length+arbWatch.length) throw new Error('watchBoardRows must contain every +EV WATCH and every ARB WATCH');
if(!display.watchBoardRows.every(r=>r.watchType==='+EV WATCH'||r.watchType==='ARB WATCH')) throw new Error('watchBoardRows missing normalized watchType');

const evScreen=Array.isArray(display.screeningRows)?display.screeningRows:[];
const arbScreen=display.arbScreeningRows;
if(arbScreen.length!==(board.arbitrageAudit.screening||[]).length) throw new Error(`ARB SCREENING display mismatch: display=${arbScreen.length} board=${(board.arbitrageAudit.screening||[]).length}`);
if(display.screeningBoardRows.length!==evScreen.length+arbScreen.length) throw new Error('screeningBoardRows must contain +EV SCREENING and ARB SCREENING');
if(!display.screeningBoardRows.every(r=>r.screenType==='+EV SCREENING'||r.screenType==='ARB SCREENING')) throw new Error('screeningBoardRows missing normalized screenType');

for(const r of arbScreen){
 const sum=Number(r.reciprocalSum);
 if(!(sum>1.01&&sum<=1.03)) throw new Error(`ARB SCREENING reciprocal sum outside (1.01,1.03]: ${sum}`);
}
console.log('WATCH_SCREEN_PARITY_VERIFIED',{evWatch:evWatch.length,arbWatch:arbWatch.length,evScreen:evScreen.length,arbScreen:arbScreen.length,watchBoard:display.watchBoardRows.length,screenBoard:display.screeningBoardRows.length});
