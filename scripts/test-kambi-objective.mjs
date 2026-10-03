import {normalizeKambiObjectiveOffer} from './kambi-objective-normalizer.mjs';
function o(label,line,odds,status='OPEN'){return {label,line,odds,status,changedDate:'2026-10-02T08:44:02Z'}}
const event={homeName:'Team Spirit',awayName:'Team Yandex'};
let m=normalizeKambiObjectiveOffer({criterion:{englishLabel:'Map 1 - Total Towers Destroyed'},outcomes:[o('Over',12500,1820),o('Under',12500,1880)]},event);
if(!m||m.name!=='Map 1 - Total Towers Destroyed'||m.line!==12.5||m.scope.map!==1||m.outcomes[0].price!==1.82)throw new Error('tower total failed');
m=normalizeKambiObjectiveOffer({criterion:{englishLabel:'Map 1 - Total Roshans Killed'},outcomes:[o('Over',2500,2180),o('Under',2500,1610)]},event);
if(!m||m.line!==2.5||m.name!=='Map 1 - Total Roshans Killed')throw new Error('roshan failed');
const lol={homeName:'Cloud9',awayName:'Lyon Gaming'};
m=normalizeKambiObjectiveOffer({criterion:{englishLabel:'Map 1 - Total Kills by Cloud9'},outcomes:[o('Over',10500,1830),o('Under',10500,1870)]},lol);
if(!m||m.line!==10.5||m.name!=='Map 1 - Cloud9 Total Kills')throw new Error('team kills failed');
for(const [label,want] of [['Map 1 - Total Kills','Map 1 - Total Kills'],['Map 3 - Total Barons Slain','Map 3 - Total Barons'],['Map 2 - Total Dragons Slain','Map 2 - Total Dragons'],['Map 1 - Total Turrets destroyed','Map 1 - Total Towers Destroyed']]){
  m=normalizeKambiObjectiveOffer({criterion:{englishLabel:label},outcomes:[o('Over',13500,1900),o('Under',13500,1900)]},lol);
  if(!m||m.name!==want)throw new Error(`${label} failed ${JSON.stringify(m)}`);
}
for(const label of ['Total Turrets destroyed','Map 1 - Total Kills (Odd/Even)','Map 1 - Team Kills Handicap','Map 1 - Total Kills by the Player']){
  m=normalizeKambiObjectiveOffer({criterion:{englishLabel:label},outcomes:[o('Over',12500,1900),o('Under',12500,1900)]},lol);
  if(m)throw new Error(`should reject ${label}`);
}
console.log('KAMBI_OBJECTIVE_TESTS_VERIFIED 8');
