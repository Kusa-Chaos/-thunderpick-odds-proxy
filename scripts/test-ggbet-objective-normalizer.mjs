import {normalizeGGBetEvent} from './ggbet-objective-normalizer.mjs';

function expect(cond,msg){if(!cond)throw new Error(msg);}

const raw={
  id:'5:efd696a5-9eae-4059-9e67-bbef3c0868bd',
  slug:'lgd-gaming-vs-gamerlegion-03-10',
  fixture:{
    title:'LGD Gaming vs GamerLegion',status:'NOT_STARTED',startTime:'2026-10-03T13:00:00+00:00',sportId:'esports_dota_2',
    competitors:[{id:'gt:3',name:'LGD Gaming'},{id:'gin:5223',name:'GamerLegion'}]
  },
  markets:[
    {id:'49m1x5',name:'Map 1 - Race to kills',status:'ACTIVE',typeId:49,specifiers:[{name:'mapnr',value:'1'},{name:'xth',value:'5'}],odds:[{id:'1',name:'LGD Gaming 5',value:'1.83',status:'NOT_RESULTED',competitorIds:['gt:3']},{id:'2',name:'GamerLegion 5',value:'1.91',status:'NOT_RESULTED',competitorIds:['gin:5223']}]},
    {id:'79m1',name:'Map 1 - First Blood',status:'ACTIVE',typeId:79,specifiers:[{name:'mapnr',value:'1'}],odds:[{id:'1',name:'LGD Gaming',value:'2.58',status:'NOT_RESULTED',competitorIds:['gt:3']},{id:'2',name:'GamerLegion',value:'1.47',status:'NOT_RESULTED',competitorIds:['gin:5223']}]},
    {id:'358m1',name:'Map 1 - Destroy first tower',status:'ACTIVE',typeId:358,specifiers:[{name:'mapnr',value:'1'}],odds:[{id:'1',name:'LGD Gaming',value:'1.56',status:'NOT_RESULTED',competitorIds:['gt:3']},{id:'2',name:'GamerLegion',value:'2.34',status:'NOT_RESULTED',competitorIds:['gin:5223']}]},
    {id:'175m1',name:'Map 1 - Kill first Roshan',status:'ACTIVE',typeId:175,specifiers:[{name:'mapnr',value:'1'}],odds:[{id:'1',name:'LGD Gaming',value:'2.08',status:'NOT_RESULTED',competitorIds:['gt:3']},{id:'2',name:'GamerLegion',value:'1.70',status:'NOT_RESULTED',competitorIds:['gin:5223']}]},
    {id:'351m1t52_5',name:'Map 1 - Total kills',status:'ACTIVE',typeId:351,specifiers:[{name:'mapnr',value:'1'},{name:'total',value:'52.5'}],odds:[{id:'1',name:'over 52.5',value:'1.98',status:'NOT_RESULTED',competitorIds:[]},{id:'2',name:'under 52.5',value:'1.77',status:'NOT_RESULTED',competitorIds:[]}]},
    {id:'294m1t28_5',name:'Map 1 - LGD Gaming total kills',status:'ACTIVE',typeId:294,specifiers:[{name:'mapnr',value:'1'},{name:'total',value:'28.5'}],odds:[{id:'1',name:'over 28.5',value:'2.19',status:'NOT_RESULTED',competitorIds:[]},{id:'2',name:'under 28.5',value:'1.63',status:'NOT_RESULTED',competitorIds:[]}]},
    {id:'840m1t52_5',name:'Map 1 - LGD Gaming Win map + Total kills',status:'ACTIVE',typeId:840,specifiers:[{name:'mapnr',value:'1'},{name:'total',value:'52.5'}],odds:[{id:'1',name:'over 52.5 kills',value:'1.71',status:'NOT_RESULTED',competitorIds:[]},{id:'2',name:'under 52.5 kills',value:'2.07',status:'NOT_RESULTED',competitorIds:[]}]},
    {id:'351m1t49_5',name:'Map 1 - Total kills',status:'DEACTIVATED',typeId:351,specifiers:[{name:'mapnr',value:'1'},{name:'total',value:'49.5'}],odds:[{id:'1',name:'over 49.5',value:'1.72',status:'NOT_RESULTED',competitorIds:[]},{id:'2',name:'under 49.5',value:'2.04',status:'NOT_RESULTED',competitorIds:[]}]}
  ]
};

const out=normalizeGGBetEvent(raw,'dota2');
expect(out?.bookmakers?.[0]?.key==='ggbet','bookmaker source must be ggbet');
expect(out.name==='LGD Gaming vs GamerLegion','event name must survive');
expect(out.bookmakers[0].markets.length===6,'must retain six active plain objective markets and reject compound/deactivated lookalikes');
const byName=Object.fromEntries(out.bookmakers[0].markets.map(m=>[m.name,m]));
expect(byName['Map 1 - Race to kills']?.mapNumber===1 && byName['Map 1 - Race to kills']?.baseLine===5,'Race to 5 must retain map and threshold');
expect(byName['Map 1 - Total kills']?.baseLine===52.5,'Total Kills must retain exact total');
expect(byName['Map 1 - LGD Gaming total kills']?.baseLine===28.5,'Team Total Kills must retain exact line');
expect(byName['Map 1 - Destroy first tower']?.mapNumber===1,'First Tower must retain map');
expect(byName['Map 1 - Kill first Roshan']?.mapNumber===1,'First Roshan must retain map');
expect(byName['Map 1 - Total kills']?.outcomes?.[0]?.price===1.98,'decimal price must parse');
console.log('GGBET_OBJECTIVE_NORMALIZER_VERIFIED',out.bookmakers[0].markets.length);
