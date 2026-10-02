import json
import re
import urllib.request


def lambda_handler(event, context):
    url = (event or {}).get("url") or "https://gg.bet/esports/match/lgd-gaming-vs-gamerlegion-03-10"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            body = response.read().decode("utf-8", "replace")
            return {
                "status": response.status,
                "bytes": len(body),
                "blocked": "not accepting visitors from your region" in body.lower(),
                "race": bool(re.search(r"Race to Kills", body, re.I)),
                "firstBlood": bool(re.search(r"First Blood", body, re.I)),
                "totalKills": bool(re.search(r"Total Kills", body, re.I)),
                "dataLabels": re.findall(r'data-label=["\']([^"\']+)', body)[:8],
                "snippet": body[:500],
            }
    except Exception as exc:
        return {"error": repr(exc)}
