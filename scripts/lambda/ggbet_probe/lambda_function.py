import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36"
DEFAULT_PAGE = "https://gg.bet/esports/match/lgd-gaming-vs-gamerlegion-03-10"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=20) as response:
        return response.status, response.read().decode("utf-8", "replace")


def next_env(body):
    m = re.search(r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', body, re.I | re.S)
    if not m:
        return None
    root = json.loads(html.unescape(m.group(1)))
    wanted = {"PUBLIC_PLATFORM_GQL_CLIENT_ENDPOINT", "BETTING_APP_ID_HEADER", "BETTING_ACCESS_TOKEN"}
    stack = [root]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            if wanted.issubset(value.keys()):
                return value
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    return None


def resolve_endpoint(raw, page_url):
    host = urllib.parse.urlparse(page_url).netloc
    value = str(raw or "").replace("{host}", host)
    if value.startswith("//"):
        value = "https:" + value
    elif value.startswith("/"):
        value = urllib.parse.urljoin(page_url, value)
    return value


def gql(page_url, slug, query):
    _, page = fetch(page_url)
    env = next_env(page)
    if not env:
        return {"ok": False, "error": "public-env-not-found"}
    endpoint = resolve_endpoint(env["PUBLIC_PLATFORM_GQL_CLIENT_ENDPOINT"], page_url)
    payload = json.dumps({"query": query, "variables": {"slug": slug}}).encode()
    headers = {
        "User-Agent": UA,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Origin": "https://gg.bet",
        "Referer": page_url,
        "X-App-Id": env["BETTING_APP_ID_HEADER"],
        "X-App-Access-Token": env["BETTING_ACCESS_TOKEN"],
        "X-Gc-Locale": "en",
    }
    req = urllib.request.Request(endpoint, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            text = response.read().decode("utf-8", "replace")
            try:
                data = json.loads(text)
            except Exception:
                data = {"raw": text[:5000]}
            return {"ok": response.status == 200, "status": response.status, "endpoint": endpoint, "data": data}
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", "replace")
        return {"ok": False, "status": exc.code, "endpoint": endpoint, "errorBody": text[:5000]}


OBJECTIVE_QUERY = r"""
query ObjectiveEvent($slug: String!) {
  match: sportEventBySlug(slug: $slug) {
    id
    slug
    fixture { title status startTime sportId }
    markets {
      id
      name
      status
      typeId
      tags
      settlementRules
      features
      specifiers { name value }
      meta { name value }
      odds { id name value isActive status competitorIds }
    }
  }
}
"""


def lambda_handler(event, context):
    event = event or {}
    url = event.get("url") or DEFAULT_PAGE
    try:
        if event.get("mode") == "graphql":
            slug = event.get("slug") or url.rstrip("/").split("/")[-1]
            result = gql(url, slug, event.get("query") or OBJECTIVE_QUERY)
            data = result.get("data") or {}
            match = (data.get("data") or {}).get("match") if isinstance(data, dict) else None
            markets = (match or {}).get("markets") or []
            objective = []
            pat = re.compile(r"first.*(kill|blood|tower|turret|baron|dragon|roshan|barracks)|race.*kill|total.*(kill|tower|turret|baron|dragon|roshan|barracks)|team.*(kill|tower|turret)", re.I)
            for market in markets:
                blob = " ".join([str(market.get("name") or ""), json.dumps(market.get("specifiers") or [])])
                if pat.search(blob):
                    objective.append(market)
            return {
                "ok": result.get("ok"), "status": result.get("status"), "endpoint": result.get("endpoint"),
                "errors": data.get("errors") if isinstance(data, dict) else None,
                "errorBody": result.get("errorBody"),
                "match": {"id": (match or {}).get("id"), "slug": (match or {}).get("slug"), "fixture": (match or {}).get("fixture")},
                "marketCount": len(markets), "objectiveCount": len(objective), "objective": objective[:100],
            }
        status, body = fetch(url)
        if event.get("mode") == "raw":
            limit = max(1, min(int(event.get("limit") or 100000), 250000))
            return {"status": status, "bytes": len(body), "body": body[:limit]}
        if event.get("mode") == "search":
            tokens = [str(x) for x in (event.get("tokens") or [])][:30]
            width = max(100, min(int(event.get("width") or 4000), 20000))
            hits = {}
            lower = body.lower()
            for token in tokens:
                pos = lower.find(token.lower())
                if pos >= 0:
                    hits[token] = body[max(0, pos - width // 4): pos + width]
            return {"status": status, "bytes": len(body), "hits": hits}
        env = next_env(body)
        return {
            "status": status, "bytes": len(body),
            "blocked": "not accepting visitors from your region" in body.lower(),
            "gqlEndpoint": resolve_endpoint((env or {}).get("PUBLIC_PLATFORM_GQL_CLIENT_ENDPOINT"), url) if env else None,
            "hasAppId": bool((env or {}).get("BETTING_APP_ID_HEADER")),
            "hasAccessToken": bool((env or {}).get("BETTING_ACCESS_TOKEN")),
        }
    except Exception as exc:
        return {"error": repr(exc)}
