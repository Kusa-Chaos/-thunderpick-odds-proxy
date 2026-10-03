import importlib.util
from pathlib import Path

p=Path('scripts/lambda/ggbet_objective_collector/lambda_function.py')
spec=importlib.util.spec_from_file_location('ggbet_objective_collector',p)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

html='''<a href="/esports/match/t1-vs-gen-g-03-10">A</a><a href="/esports/match/t1-vs-gen-g-03-10">dup</a><a href="/esports/match/lgd-vs-flyquest-03-10">B</a>'''
assert mod.extract_slugs(html)==['lgd-vs-flyquest-03-10','t1-vs-gen-g-03-10']
assert mod.is_objective_market('Map 1 - Race to kills')
assert mod.is_objective_market('Map 2 - First Blood')
assert mod.is_objective_market('Map 1 - Destroy first tower')
assert mod.is_objective_market('Map 1 - First Dragon')
assert mod.is_objective_market('Map 1 - First Baron')
assert mod.is_objective_market('Map 1 - Total kills')
assert not mod.is_objective_market('Map 1 - Win map + Total kills')
assert not mod.is_objective_market('Map 1 - Kill maker')
assert mod.sport_key('esports_league_of_legends')=='lol'
assert mod.sport_key('esports_dota_2')=='dota2'
assert mod.sport_key('esports_counter_strike') is None
print('GGBET_COLLECTOR_CORE_VERIFIED')
