import json
import re
from oddswrap import OddsClient

BOOKS = ["fanduel", "draftkings", "caesars", "betmgm"]
SPORTS = ["nfl", "nba", "mlb"]
TARGET_PROP_RE = {
    "nfl": re.compile(r"pass|receiv|rush|reception|touchdown|completion|attempt|interception", re.I),
    "nba": re.compile(r"point|rebound|assist|three|3|steal|block|turnover", re.I),
    "mlb": re.compile(r"hit|strikeout|total base|rbi|walk|home run", re.I),
}


def safe_len(fn):
    try:
        v = fn()
        return len(v or []), None
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"


def sample_props(client, book, sport):
    try:
        cats = client.get_prop_categories(sport, book=book) or []
    except Exception as e:
        return {"categories": 0, "selectedCategories": [], "props": 0, "error": f"categories: {type(e).__name__}: {e}"}
    rx = TARGET_PROP_RE[sport]
    selected = []
    for c in cats:
        text = f"{getattr(c, 'category_name', '')} {getattr(c, 'subcategory_name', '')}"
        if rx.search(text):
            selected.append(c)
    # Probe a bounded set so this stays lightweight and does not hammer the books.
    selected = selected[:8]
    prop_count = 0
    errors = []
    names = []
    for c in selected:
        names.append({
            "category": getattr(c, "category_name", None),
            "subcategory": getattr(c, "subcategory_name", None),
        })
        try:
            props = client.get_props(
                sport,
                category_id=str(getattr(c, "category_id", "")),
                subcategory_id=(str(getattr(c, "subcategory_id", "")) if getattr(c, "subcategory_id", None) is not None else None),
                book=book,
            ) or []
            prop_count += len(props)
        except Exception as e:
            errors.append(f"{getattr(c, 'subcategory_name', None) or getattr(c, 'category_name', None)}: {type(e).__name__}: {e}")
    return {
        "categories": len(cats),
        "selectedCategories": names,
        "props": prop_count,
        "errors": errors[:5],
    }


results = {}
for book in BOOKS:
    client = OddsClient(books=[book])
    b = {}
    for sport in SPORTS:
        ml, ml_err = safe_len(lambda s=sport: client.get_moneylines(s))
        sp, sp_err = safe_len(lambda s=sport: client.get_spreads(s))
        tot, tot_err = safe_len(lambda s=sport: client.get_totals(s))
        row = {
            "moneylines": ml,
            "spreads": sp,
            "totals": tot,
            "errors": [e for e in [ml_err, sp_err, tot_err] if e],
        }
        if book in {"fanduel", "draftkings"}:
            row["propProbe"] = sample_props(client, book, sport)
        b[sport] = row
    results[book] = b

print("MAJORBOOKS_PROBE", json.dumps(results, separators=(",", ":")))
