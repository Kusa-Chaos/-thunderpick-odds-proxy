from cloudbet_objective import normalize_objective_market, build_objective_event_row

def sel(outcome,price,params,status='SELECTION_ENABLED'):
    return {'outcome':outcome,'price':price,'params':params,'status':status,'side':'BACK'}

def test_lol_race_to_5():
    market={'submarkets':{'period=default&map=1&xth=5':{'selections':[sel('home',1.82,'map=1&xth=5'),sel('away',1.92,'map=1&xth=5')]}}}
    rows=normalize_objective_market('league_of_legends.map_xth_kill',market,'T1','Gen.G')
    assert len(rows)==1
    r=rows[0]
    assert r['name']=='Map 1 - First to 5 Kills'
    assert r['scope']['map']==1 and r['line']==5
    assert {o['name'] for o in r['outcomes']}=={'T1','Gen.G'}

def test_lol_first_tower_baron_dragon():
    for key,label in [
      ('league_of_legends.map_xth_tower','First Tower'),
      ('league_of_legends.map_xth_baron','First Baron'),
      ('league_of_legends.map_xth_dragon','First Dragon')]:
        market={'submarkets':{'period=default&map=2&xth=1':{'selections':[sel('home',1.7,'map=2&xth=1'),sel('away',2.05,'map=2&xth=1')]}}}
        rows=normalize_objective_market(key,market,'T1','Gen.G')
        assert len(rows)==1 and rows[0]['name']==f'Map 2 - {label}' and rows[0]['scope']['map']==2

def test_lol_total_kills_and_team_kills():
    total={'submarkets':{'period=default&period=map1kills&map=1':{'selections':[sel('over',1.9,'map=1&total=25.5'),sel('under',1.9,'map=1&total=25.5')]}}}
    rows=normalize_objective_market('league_of_legends.map_total_kills',total,'T1','Gen.G')
    assert len(rows)==1 and rows[0]['name']=='Map 1 - Total Kills' and rows[0]['line']==25.5
    team={'submarkets':{'period=default&period=map1kills&map=1&team=home':{'selections':[sel('over',1.85,'map=1&team=home&total=13.5'),sel('under',1.95,'map=1&team=home&total=13.5')]}}}
    rows=normalize_objective_market('league_of_legends.map_team_total_kills',team,'T1','Gen.G')
    assert len(rows)==1 and rows[0]['name']=='Map 1 - T1 Total Kills' and rows[0]['line']==13.5

def test_dota_race_and_totals():
    race={'submarkets':{'period=default&map=1&xth=10':{'selections':[sel('home',1.77,'map=1&xth=10'),sel('away',2.0,'map=1&xth=10')]}}}
    rows=normalize_objective_market('dota_2.map_race_to_xth_kills',race,'Spirit','Yandex')
    assert len(rows)==1 and rows[0]['name']=='Map 1 - First to 10 Kills' and rows[0]['line']==10
    total={'submarkets':{'period=default&period=map1kills':{'selections':[sel('over',1.91,'map=1&total=48.5'),sel('under',1.91,'map=1&total=48.5')]}}}
    rows=normalize_objective_market('dota_2.map_total_kills_v2',total,'Spirit','Yandex')
    assert len(rows)==1 and rows[0]['line']==48.5

def test_fail_closed_mismatched_total_lines_and_disabled():
    market={'submarkets':{'x':{'selections':[sel('over',1.9,'map=1&total=25.5'),sel('under',1.9,'map=1&total=26.5')]}}}
    assert normalize_objective_market('league_of_legends.map_total_kills',market,'T1','Gen.G')==[]
    market={'submarkets':{'x':{'selections':[sel('home',1.8,'map=1&xth=5','SELECTION_DISABLED'),sel('away',2.0,'map=1&xth=5')]}}}
    assert normalize_objective_market('league_of_legends.map_xth_kill',market,'T1','Gen.G')==[]

def test_objective_event_row_shape():
    event={'id':'abc','home':{'name':'T1'},'away':{'name':'Gen.G'},'cutoffTime':'2026-10-20T12:00:00Z','markets':{
      'league_of_legends.map_xth_kill':{'submarkets':{'period=default&map=1&xth=5':{'selections':[sel('home',1.8,'map=1&xth=5'),sel('away',2.0,'map=1&xth=5')]}}}
    }}
    row=build_objective_event_row(event)
    assert row['id']=='cloudbet-objective:abc'
    assert row['home_team']=='T1' and row['away_team']=='Gen.G'
    bm=row['bookmakers'][0]
    assert bm['key']=='cloudbet-objective' and bm['title']=='Cloudbet'
    assert bm['markets'][0]['name']=='Map 1 - First to 5 Kills'

def test_grouping_parameters_fallback_and_selection_override():
    market={'submarkets':{'default':{'selections':[
        {'outcome':'home','price':1.82,'grouping_parameters':'map=1&xth=5','status':'SELECTION_ENABLED','side':'BACK'},
        {'outcome':'away','price':1.92,'grouping_parameters':'map=1&xth=5','status':'SELECTION_ENABLED','side':'BACK'}]}}}
    rows=normalize_objective_market('league_of_legends.map_xth_kill',market,'T1','Gen.G')
    assert len(rows)==1 and rows[0]['scope']['map']==1 and rows[0]['line']==5
    market['submarkets']['default']['selections'][1]['params']='map=2&xth=5'
    assert normalize_objective_market('league_of_legends.map_xth_kill',market,'T1','Gen.G')==[]

if __name__=='__main__':
    tests=[v for k,v in sorted(globals().items()) if k.startswith('test_') and callable(v)]
    for t in tests:
        t();print('PASS',t.__name__)
    print('CLOUDBET_OBJECTIVE_TESTS_VERIFIED',len(tests))
