import {normalizeObjectiveMarket} from './objective-market-normalizer.mjs';

function num(v){
  if(v===null||v===undefined||v==='')return null;
  const n=Number(v);return Number.isFinite(n)?n:null;
}
function text(v=''){return String(v??'').trim();}
function isRoobet(v=''){return /\broobet\b/i.test(text(v));}
function mapFromText(v=''){
  const s=text(v);
  const d=(s.match(/\bmap\s*(?:=|:|#|-)?\s*(\d+)\b/i)||[])[1];
  if(d)return Number(d);
  const w=(s.match(/\b(first|second|third|fourth|fifth)\s+map\b/i)||[])[1];
  return ({first:1,second:2,third:3,fourth:4,fifth:5})[String(w||'').toLowerCase()]??null;
}
function normalizeOutcomes(market={}){
  const raw=Array.isArray(market.outcomes)?market.outcomes:Object.values(market.outcomes||{});
  const out=[];
  const walk=v=>{
    if(Array.isArray(v)){for(const x of v)walk(x);return;}
    if(!v||typeof v!=='object')return;
    const price=num(v.price??v.odds??v.decimalOdds??v.decimal_odds);
    const name=text(v.name??v.outcomeName??v.label??v.selectionName??v.selection);
    if(name&&price>1){
      const point=num(v.point??v.handicap??v.line??v.total??market.handicap??market.line??market.total);
      out.push({name,price,point});
      return;
    }
    if(v.players&&typeof v.players==='object')walk(Object.values(v.players));
  };
  walk(raw);
  const seen=new Set();
  return out.filter(o=>{const k=`${o.name}|${o.point??''}|${o.price}`;if(seen.has(k))return false;seen.add(k);return true;});
}
function eventPair(fixture={}){
  const home=text(fixture.participant1Name??fixture.home_team??fixture.home??fixture?.participants?.[0]?.name);
  const away=text(fixture.participant2Name??fixture.away_team??fixture.away??fixture?.participants?.[1]?.name);
  return home&&away?[home,away]:null;
}
function bookmakerEntries(fixture={}){
  const root=fixture.bookmakerOdds??fixture.bookmakers??fixture.odds??{};
  if(Array.isArray(root))return root.map((v,i)=>[v?.key??v?.slug??v?.name??String(i),v]);
  return Object.entries(root||{});
}
function marketEntries(book={}){
  const root=book?.markets??book?.marketOdds??book?.odds??{};
  if(Array.isArray(root))return root.map((v,i)=>[v?.marketId??v?.id??String(i),v]);
  return Object.entries(root||{});
}
function marketMetaFor(id,marketMeta){
  if(!marketMeta)return {};
  if(marketMeta instanceof Map)return marketMeta.get(String(id))||{};
  return marketMeta[String(id)]||marketMeta[id]||{};
}

export function parseRoobetOddsPapiFixture({sport='',fixture={},marketMeta=null}={}){
  const pair=eventPair(fixture);if(!pair)return [];
  const state=(fixture.live===true||fixture.isLive===true)?'live':'prematch';
  const markets=[];
  for(const [bookKey,book] of bookmakerEntries(fixture)){
    const bname=text(book?.title??book?.name??book?.bookmakerName??book?.bookmakerSlug??bookKey);
    if(!isRoobet(bookKey)&&!isRoobet(bname))continue;
    for(const [mid,raw] of marketEntries(book)){
      const meta=marketMetaFor(mid,marketMeta);
      const name=text(raw?.marketName??raw?.name??raw?.title??raw?.label??meta?.marketName??meta?.name);
      if(!name)continue;
      const period=text(raw?.period??raw?.periodName??meta?.period);
      const map=num(raw?.scope?.map??raw?.map??raw?.mapNumber)??mapFromText(`${name} ${period}`);
      const outcomes=normalizeOutcomes({...raw,handicap:raw?.handicap??meta?.handicap,line:raw?.line??meta?.line,total:raw?.total??meta?.total});
      if(outcomes.length<2)continue;
      const market={
        ...raw,
        name,
        title:name,
        period,
        scope:{map,round:null},
        baseLine:raw?.baseLine??raw?.handicap??raw?.line??raw?.total??meta?.handicap??meta?.line??meta?.total??null,
        outcomes
      };
      const n=normalizeObjectiveMarket({sport,source:'roobet',event:{home:pair[0],away:pair[1]},market});
      if(!n)continue;
      markets.push({
        key:n.family,
        family:n.family,
        name,
        title:name,
        scope:{map:n.map,round:null},
        line:n.line,
        target:n.target||null,
        state,
        live:state==='live',
        last_update:raw?.changedAt??raw?.updatedAt??raw?.lastUpdate??fixture?.updatedAt??null,
        outcomes
      });
    }
  }
  if(!markets.length)return [];
  return [{
    id:`roobet:${fixture.fixtureId??fixture.id??pair.join('-')}`,
    home_team:pair[0],away_team:pair[1],
    commence_time:fixture.startTime??fixture.start_time??fixture.commence_time??null,
    live:state==='live',state,
    bookmakers:[{key:'roobet',title:'Roobet',markets}]
  }];
}
