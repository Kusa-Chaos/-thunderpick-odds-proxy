import fs from 'node:fs/promises';

const SNAP='data/aws-thunderpick-direct-latest.json';
const META='data/aws-thunderpick-direct-meta.json';
const TARGET='data/owls-latest.json';
const TARGET_META='data/owls-meta.json';
const SPORT='american-football';
const MAX_AGE_MS=25*60*1000;

const read=async(p,f={})=>{try{return JSON.parse(await fs.readFile(p,'utf8'));}catch{return f;}};
const aws=await read(SNAP,null);
const awsMeta=await read(META,null);
if(!aws||!awsMeta){console.log('AWS_TP_SEED_SKIP missing snapshot/meta');process.exit(0);}
const record=aws?.sports?.[SPORT];
const fetchedAt=record?.fetchedAt||aws?.generatedAt||awsMeta?.generatedAt;
const age=Date.now()-Date.parse(fetchedAt||'');
const rows=record?.data?.data;
const failures=Number(record?.deepMarketFailures??awsMeta?.sports?.[SPORT]?.deepMarketFailures??0);
const successes=Number(record?.deepMarketSuccess??awsMeta?.sports?.[SPORT]?.deepMarketSuccess??0);
const requested=Number(record?.deepMarketRequests??awsMeta?.sports?.[SPORT]?.deepMarketRequests??0);
const complete=failures===0&&successes>0&&successes===requested;
const healthy=record?.ok===true&&record?.httpOk===true&&Number(record?.status)===200&&record?.usedFallback!==true&&complete&&Array.isArray(rows)&&rows.length===successes&&Number.isFinite(age)&&age>=-5*60*1000&&age<=MAX_AGE_MS;
if(!healthy){console.log('AWS_TP_SEED_SKIP',JSON.stringify({fetchedAt,age,eventCount:record?.eventCount,status:record?.status,ok:record?.ok,requested,successes,failures}));process.exit(0);}

const target=await read(TARGET,{generatedAt:null,source:null,format:null,sports:{}});
const targetMeta=await read(TARGET_META,{generatedAt:null,source:null,format:null,sports:{}});
target.sports={...(target.sports||{}),[SPORT]:record};
target.generatedAt=fetchedAt;
target.source=`AWS freshness seed: ${aws.source||'Thunderpick first-party public reader'}`;
target.format='aws-seeded-'+String(aws.format||'snapshot');

targetMeta.sports={...(targetMeta.sports||{}),[SPORT]:{...record,data:undefined}};
targetMeta.generatedAt=fetchedAt;
targetMeta.source=target.source;
targetMeta.format=target.format;
targetMeta.quotaExhausted=false;
targetMeta.quotaResetMonth=null;
targetMeta.successfulSports=[...new Set([...(targetMeta.successfulSports||[]).filter(x=>x!==SPORT),SPORT])];
targetMeta.failedSports=(targetMeta.failedSports||[]).filter(x=>x!==SPORT);
targetMeta.coverageAnomalies=(targetMeta.coverageAnomalies||[]).filter(x=>x?.sport!==SPORT);
targetMeta.awsSeed={ok:true,fetchedAt,ageMs:age,eventCount:rows.length,retainedMarketCount:record?.retainedMarketCount??null,playerPropLikeMarkets:record?.playerPropLikeMarkets??null,deepMarketRequests:requested,deepMarketSuccess:successes,deepMarketFailures:failures,source:record?.source||aws?.source||null};

await fs.writeFile(TARGET,JSON.stringify(target));
await fs.writeFile(TARGET_META,JSON.stringify(targetMeta,null,2));
console.log('AWS_TP_SEED_OK',JSON.stringify(targetMeta.awsSeed));
