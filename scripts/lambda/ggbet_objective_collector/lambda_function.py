import json
import re
from datetime import datetime, timezone

OBJECTIVE_RE = re.compile(
    r"race to kills|first blood|destroy first tower|first tower|first baron|kill first roshan|first roshan|first barrack|first barracks|total kills|total towers|total barons|total dragons|total roshans|total barracks",
    re.I,
)
EXCLUDE_RE = re.compile(r"win map.*total kills|total kills odd\s*/\s*even|kills handicap|kill maker|ultra kill|first dragon type|baron type|both teams", re.I)


def extract_slugs(html):
    return sorted(set(re.findall(r'href=["\']/esports/match/([^"\'?#]+)', html or '', re.I)))


def is_objective_market(name):
    text = str(name or '')
    return bool(OBJECTIVE_RE.search(text)) and not bool(EXCLUDE_RE.search(text))


def sport_key(value):
    key = str(value or '').lower()
    if key == 'esports_league_of_legends':
        return 'lol'
    if key == 'esports_dota_2':
        return 'dota2'
    return None


def lambda_handler(event, context):
    return {
        'statusCode': 200,
        'body': json.dumps({
            'generatedAt': datetime.now(timezone.utc).isoformat(),
            'connected': False,
            'sports': {'lol': {'events': []}, 'dota2': {'events': []}},
            'errors': ['collector network stage not yet enabled'],
        })
    }
