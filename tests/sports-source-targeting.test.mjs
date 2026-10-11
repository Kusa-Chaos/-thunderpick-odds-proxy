import test from 'node:test';
import assert from 'node:assert/strict';
import { polymarketMatchRow, selectPolymarketSeries, kalshiSeriesURL } from '../scripts/sports-source-targeting.mjs';

const NOW = Date.parse('2026-10-11T09:00:00Z');
const match = {
  title: 'LoL: Team One vs Team Two (BO3)', startDate: '2025-12-01T00:00:00Z',
  startTime: '2026-10-12T09:00:00Z', active: true, closed: false,
  teams: [{name: 'Team One'}, {name:'Team Two'}]
};
const mk = {
  id:'market-1', sportsMarketType:'moneyline', active:true, closed:false, acceptingOrders:true,
  gameStartTime:'2026-10-12 09:00:00+00', outcomes:'["Team One","Team Two"]',
  outcomePrices:'["0.5","0.5"]', bestAsk:0.64, bestBid:0.59,
  question:'Team One vs Team Two Match Winner', updatedAt:'2026-10-11T08:55:00Z'
};

test('Polymarket uses actual match start, not old event listing date', () => {
  const row=polymarketMatchRow(match,mk,'lol',NOW);
  assert.ok(row);
  assert.equal(row.commence_time,'2026-10-12T09:00:00.000Z');
  assert.equal(row.home_team,'Team One');
  assert.equal(row.away_team,'Team Two');
});
test('Polymarket uses tradable ask-side prices, never midpoint outcomePrices', () => {
  const row=polymarketMatchRow(match,mk,'lol',NOW);
  const odds=row.bookmakers[0].markets[0].outcomes;
  assert.ok(Math.abs(odds[0].price-1/0.64)<0.00001);
  assert.ok(Math.abs(odds[1].price-1/0.41)<0.00001);
  assert.notEqual(odds[0].price,2);
});
test('Polymarket rejects game/map child winner and prop markets as match winner', () => {
  assert.equal(polymarketMatchRow(match,{...mk,sportsMarketType:'child_moneyline'},'lol',NOW),null);
  assert.equal(polymarketMatchRow(match,{...mk,sportsMarketType:'totals'},'lol',NOW),null);
});
test('Polymarket rejects expired, missing-match-clock, inactive and unquoted markets', () => {
  assert.equal(polymarketMatchRow({...match,startTime:'2026-10-10T09:00:00Z'},{...mk,gameStartTime:'2026-10-10 09:00:00+00'},'lol',NOW),null);
  assert.equal(polymarketMatchRow({...match,startTime:null},{...mk,gameStartTime:null},'lol',NOW),null);
  assert.equal(polymarketMatchRow(match,{...mk,bestBid:null},'lol',NOW),null);
  assert.equal(polymarketMatchRow(match,{...mk,acceptingOrders:false},'lol',NOW),null);
});
test('Polymarket excludes unrelated Yes/No futures and returns exact sports series only', () => {
  assert.equal(polymarketMatchRow(match,{...mk,outcomes:'["Yes","No"]'},'lol',NOW),null);
  const selected=selectPolymarketSeries([
    {sport:'lol',series:'10311'}, {sport:'dota2',series:'10309'},
    {sport:'nfl',series:'12185'}, {sport:'cricpsl',series:'8888'}
  ]);
  assert.ok(selected.some(x=>x.sport==='lol'&&x.series==='10311'));
  assert.ok(selected.some(x=>x.sport==='american-football'&&x.series==='12185'));
  assert.ok(!selected.some(x=>x.series==='8888'));
});
test('Kalshi query restricts to one sport series and excludes multivariate markets', () => {
  const url=new URL(kalshiSeriesURL('KXNFLGAME','next-cursor'));
  assert.equal(url.searchParams.get('series_ticker'),'KXNFLGAME');
  assert.equal(url.searchParams.get('mve_filter'),'exclude');
  assert.equal(url.searchParams.get('status'),'open');
  assert.equal(url.searchParams.get('cursor'),'next-cursor');
  assert.throws(()=>kalshiSeriesURL('KXNFLGAME&limit=999999'));
});
