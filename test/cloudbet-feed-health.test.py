import pathlib
p=pathlib.Path('scripts/cloudbet-feed-health.py')
s=p.read_text()
assert "CLOUDBET_API_KEY" in s
assert "sports-api.cloudbet.com/pub/v2/odds/sports" in s
assert "X-API-Key" in s
assert "load_key" in s
assert "thunderpick/cloudbet-api-key" in s
for marker in ['SECRET_LOAD_FAILED','HTTP_401','HTTP_403','HTTP_404','NETWORK_ERROR']:
    assert marker in s, marker
print('cloudbet sanitized diagnostics contract test ok')
