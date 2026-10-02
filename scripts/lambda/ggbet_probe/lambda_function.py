import re
import urllib.parse
import urllib.request


def fetch(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        return response.status, response.read().decode("utf-8", "replace")


def lambda_handler(event, context):
    url = (event or {}).get("url") or "https://gg.bet/esports/match/lgd-gaming-vs-gamerlegion-03-10"
    try:
        status, body = fetch(url)
        scripts = re.findall(r'<script[^>]+src=["\']([^"\']+)', body, re.I)
        links = re.findall(r'(?:href|src)=["\']([^"\']+)', body, re.I)
        absolute = [urllib.parse.urljoin(url, value) for value in links + scripts]
        raw_urls = re.findall(r'https?://[^"\'<>\\\s]+', body, re.I)
        urls = []
        seen = set()
        for value in absolute + raw_urls:
            value = value.replace("&amp;", "&")
            if value not in seen:
                seen.add(value)
                urls.append(value)
        interesting = [
            value
            for value in urls
            if re.search(r'api|odds|market|event|gin\.bet|databet|stat\.gg|sportsbook|betting', value, re.I)
        ]
        keywords = {}
        for token in ["databet", "api", "market", "odds", "event", "efd696", "__NEXT_DATA__", "self.__next_f.push"]:
            pos = body.lower().find(token.lower())
            if pos >= 0:
                keywords[token] = body[max(0, pos - 250): pos + 750]
        return {
            "status": status,
            "bytes": len(body),
            "blocked": "not accepting visitors from your region" in body.lower(),
            "race": bool(re.search(r"Race to Kills", body, re.I)),
            "scriptCount": len(scripts),
            "scripts": [urllib.parse.urljoin(url, s) for s in scripts[:80]],
            "interestingUrls": interesting[:100],
            "keywords": keywords,
        }
    except Exception as exc:
        return {"error": repr(exc)}
