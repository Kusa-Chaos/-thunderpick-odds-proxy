export default async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  const url='https://api-g-c7818b61-607.sptpub.com/api/v4/prematch/brand/2186449803775455232/en/0';
  try{
    const r=await fetch(url,{headers:{
      Origin:'https://roobet.com',
      Referer:'https://roobet.com/',
      'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept:'application/json'
    }});
    const text=await r.text();
    let parsed=null;
    try{parsed=JSON.parse(text)}catch{}
    return res.status(200).json({
      probe:true,
      upstreamStatus:r.status,
      ok:r.ok,
      contentType:r.headers.get('content-type'),
      keys:parsed&&typeof parsed==='object'?Object.keys(parsed):null,
      topEventsVersions:Array.isArray(parsed?.top_events_versions)?parsed.top_events_versions.slice(0,5):null,
      restEventsVersions:Array.isArray(parsed?.rest_events_versions)?parsed.rest_events_versions.slice(0,5):null,
      bodyHead:text.slice(0,300),
      fetchedAt:new Date().toISOString()
    });
  }catch(error){
    return res.status(200).json({probe:true,ok:false,error:error?.message||String(error),fetchedAt:new Date().toISOString()});
  }
}
