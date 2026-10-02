import {normalizeObjectiveMarket,objectiveContractKey} from './objective-market-normalizer.mjs';

function expect(cond,msg){if(!cond)throw new Error(msg);}

const lolRace=normalizeObjectiveMarket({
  sport:'lol',source:'thunderpick',
  event:{home:'Cloud9',away:'LYON'},
  market:{name:'First to Reach Kills - Map 1',baseLine:'5',period:{type:'map',number:1},selections:[{name:'Cloud9',odds:2.05},{name:'LYON',odds:1.68}]}
});
expect(lolRace?.family==='race_to_kills','LoL First to Reach Kills must normalize to race_to_kills');
expect(lolRace?.map===1,'LoL race-to-kills must retain Map 1');
expect(lolRace?.line===5,'LoL race-to-kills must retain threshold 5');

const dotaTowers=normalizeObjectiveMarket({
  sport:'dota2',source:'thunderpick',
  event:{home:'Team Spirit',away:'Team Yandex'},
  market:{name:'Total Towers Destroyed Over/Under - Map 1',baseLine:'11.5',period:{type:'map',number:1},selections:[{name:'Over',odds:1.54},{name:'Under',odds:2.22}]}
});
expect(dotaTowers?.family==='total_towers','Dota tower total must normalize to total_towers');
expect(dotaTowers?.map===1,'Dota tower total must retain Map 1');
expect(dotaTowers?.line===11.5,'Dota tower total must retain 11.5 line');

const teamTowers=normalizeObjectiveMarket({
  sport:'dota2',source:'thunderpick',
  event:{home:'Team Spirit',away:'Team Yandex'},
  market:{name:'Team Spirit Total Towers Destroyed Over/Under - Map 1',baseLine:'5.5',period:{type:'map',number:1},selections:[{name:'Over',odds:1.8},{name:'Under',odds:1.9}]}
});
expect(teamTowers?.family==='team_towers','team tower total must be distinct from total_towers');
expect(teamTowers?.target==='Team Spirit','team tower total must retain exact team target');

const stakeBarons=normalizeObjectiveMarket({
  sport:'lol',source:'stake',
  event:{home:'LGD Gaming',away:'FlyQuest'},
  market:{name:'Map 1 - Total Barons',key:'totals',outcomes:[{name:'Over 1.5',price:2.7,point:1.5},{name:'Under 1.5',price:1.4,point:1.5}]}
});
expect(stakeBarons?.family==='total_barons','Stake Total Barons must normalize to total_barons');
expect(stakeBarons?.map===1,'Stake Total Barons must retain Map 1');
expect(stakeBarons?.line===1.5,'Stake Total Barons must retain 1.5 line');

const firstBlood=normalizeObjectiveMarket({
  sport:'lol',source:'thunderpick',event:{home:'Cloud9',away:'LYON'},
  market:{name:'Team to Draw First Blood - Map 1',period:{type:'map',number:1}}
});
expect(firstBlood?.family==='first_blood','First Blood must have its own family');
expect(firstBlood?.line===null,'First Blood must not invent a numeric line');

const towerHandicap=normalizeObjectiveMarket({
  sport:'dota2',source:'thunderpick',event:{home:'Team Spirit',away:'Team Yandex'},
  market:{name:'Total Towers Destroyed Handicap - Map 1',period:{type:'map',number:1},selections:[{name:'Team Spirit',handicap:3.5,odds:1.8},{name:'Team Yandex',handicap:-3.5,odds:1.9}]}
});
expect(towerHandicap===null,'Tower handicap must not be normalized as tower Over/Under');

const oddEvenKills=normalizeObjectiveMarket({
  sport:'lol',source:'thunderpick',event:{home:'Cloud9',away:'LYON'},
  market:{name:'Total Kills Odd/Even - Map 1',period:{type:'map',number:1},selections:[{name:'Even',odds:1.9},{name:'Odd',odds:1.9}]}
});
expect(oddEvenKills===null,'Odd/Even kills must not be normalized as kill totals');

const compoundKills=normalizeObjectiveMarket({
  sport:'dota2',source:'thunderpick',event:{home:'Team Spirit',away:'Team Yandex'},
  market:{name:'Team Spirit Win Map and Total Kills Over/Under - Map 1',baseLine:'25.5',period:{type:'map',number:1},selections:[{name:'Over',odds:2.2},{name:'Under',odds:1.6}]}
});
expect(compoundKills===null,'Win Map + Total Kills compound must not normalize as team_kills');

const base={sport:'dota2',event:'Team Spirit|Team Yandex',target:'',side:'under',state:'prematch',settlement:'standard'};
const towerM1=objectiveContractKey({...base,family:'total_towers',map:1,line:11.5});
const towerM2=objectiveContractKey({...base,family:'total_towers',map:2,line:11.5});
const teamTower=objectiveContractKey({...base,family:'team_towers',target:'Team Spirit',map:1,line:11.5});
const race5=objectiveContractKey({...base,family:'race_to_kills',target:'Team Spirit',map:1,line:5,side:'team'});
const race10=objectiveContractKey({...base,family:'race_to_kills',target:'Team Spirit',map:1,line:10,side:'team'});
expect(towerM1!==towerM2,'Map 1 and Map 2 tower totals must never collide');
expect(towerM1!==teamTower,'game total towers and team towers must never collide');
expect(race5!==race10,'First to 5 and First to 10 kills must never collide');

console.log('OBJECTIVE_MARKET_NORMALIZER_VERIFIED',10);
