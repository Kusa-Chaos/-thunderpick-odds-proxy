import pathlib
p=pathlib.Path('scripts/cloudbet-feed-health.py')
s=p.read_text()
assert "CLOUDBET_API_KEY" in s
assert "sports-api.cloudbet.com/pub/v2/odds/sports" in s
assert "X-API-Key" in s
assert "load_key" in s
assert "thunderpick/cloudbet-api-key" in s
print('cloudbet probe contract test ok')
