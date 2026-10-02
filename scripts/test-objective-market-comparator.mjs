import {extractObjectiveContract,compareObjectiveContractSets} from './objective-market-comparator.mjs';

function expect(cond,msg){if(!cond)throw new Error(msg);}

const tpEvent={home:'Vitality',away:'FearX',name:'Vitality vs FearX',state:'prematch'};
const stakeEvent={home:'Team Vitality',away:'FearX',name:'Team Vitality vs FearX',state:'prematch'};
const tpBarons=extractObjectiveContract({sport:'lol',source:'thunderpick',event:tpEvent,market:{name:'Total Barons Slain Over/Under - Map 1',baseLine:'1.5',period:{type:'map',number:1},selections:[{name:'Over',odds:2.6,total:'1.5'},{name:'Under',odds:1.42,total:'1.5'}]}});
const stakeBarons=extractObjectiveContract({sport:'lol',source:'stake-direct',event:stakeEvent,market:{name:'Map 1 - Total Barons',scope:{map:1},outcomes:[{name:'Over 1.5',price:2.7,point:1.5},{name:'Under 1.5',price:1.4,point:1.5}]}});
expect(tpBarons&&stakeBarons,'baron fixtures must parse');
let rows=compareObjectiveContractSets([tpBarons],[stakeBarons]);
expect(rows.length===1,'Team Vitality alias must exact-match Vitality for same event');
expect(rows[0].family==='total_barons'&&rows[0].map===1&&rows[0].line===1.5,'exact family/map/line must survive comparison');
expect(rows[0].independentOutsideSources===1,'Stake/Oddin must count as one source family');
expect(rows[0].outsideQuotes[0].prices.over===2.7&&rows[0].outsideQuotes[0].prices.under===1.4,'outside prices must survive comparison');

const wrongLine=extractObjectiveContract({sport:'lol',source:'stake-direct',event:stakeEvent,market:{name:'Map 1 - Total Barons',scope:{map:1},outcomes:[{name:'Over 2.5',price:2.1,point:2.5},{name:'Under 2.5',price:1.7,point:2.5}]}});
expect(compareObjectiveContractSets([tpBarons],[wrongLine]).length===0,'different objective line must never match');

const wrongMap=extractObjectiveContract({sport:'lol',source:'stake-direct',event:stakeEvent,market:{name:'Map 2 - Total Barons',scope:{map:2},outcomes:[{name:'Over 1.5',price:2.7,point:1.5},{name:'Under 1.5',price:1.4,point:1.5}]}});
expect(compareObjectiveContractSets([tpBarons],[wrongMap]).length===0,'different map must never match');

const tpTeamKills=extractObjectiveContract({sport:'lol',source:'thunderpick',event:{home:'RED Canids',away:'Natus Vincere',name:'RED Canids vs Natus Vincere',state:'prematch'},market:{name:'Natus Vincere Total Kills - Map 1',baseLine:'16.5',period:{type:'map',number:1},selections:[{name:'Over',odds:1.85,total:'16.5'},{name:'Under',odds:1.85,total:'16.5'}]}});
const wrongTarget=extractObjectiveContract({sport:'lol',source:'stake-direct',event:{home:'RED Canids',away:'Natus Vincere',name:'RED Canids vs Natus Vincere',state:'prematch'},market:{name:'Map 1 - home Total Kills',scope:{map:1},outcomes:[{name:'Over 16.5',price:1.8,point:16.5},{name:'Under 16.5',price:1.9,point:16.5}]}});
expect(tpTeamKills&&wrongTarget,'team-total fixtures must parse');
expect(compareObjectiveContractSets([tpTeamKills],[wrongTarget]).length===0,'team total for opposing target must never match');

const tpRace=extractObjectiveContract({sport:'dota2',source:'thunderpick',event:{home:'Team Spirit',away:'Team Yandex',name:'Team Spirit vs Team Yandex',state:'prematch'},market:{name:'First to Reach Kills - Map 1',baseLine:'5',period:{type:'map',number:1},selections:[{name:'Team Spirit',odds:1.95,total:'5'},{name:'Team Yandex',odds:1.77,total:'5'}]}});
const outsideRace=extractObjectiveContract({sport:'dota2',source:'roobet',event:{home:'Team Spirit',away:'Team Yandex',name:'Team Spirit vs Team Yandex',state:'prematch'},market:{name:'Map 1 - Race to 5 Kills',scope:{map:1},outcomes:[{name:'Team Spirit',price:2.02},{name:'Team Yandex',price:1.72}]}});
expect(tpRace&&outsideRace,'race-to-kills fixtures must parse');
expect(compareObjectiveContractSets([tpRace],[outsideRace]).length===1,'same race-to-5 map contract must match');

const liveRace={...outsideRace,state:'live'};
expect(compareObjectiveContractSets([tpRace],[liveRace]).length===0,'live and prematch objective contracts must never match');

console.log('OBJECTIVE_MARKET_COMPARATOR_VERIFIED',8);
