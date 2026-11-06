"""Real market benchmarks from Estonia's public procurement register (open data, CSV from
datahub.io/nimistu/estonia-public-procurement). Per our spend category we compute award-size
quartiles, typical bidder counts and how often a contract had a single bidder. The agent uses
these as real-world context; negotiation notes themselves are synthetic (no public dataset has them)."""
import csv, json, statistics as st
from pathlib import Path

HERE = Path(__file__).parent
CATS = {
    "SaaS licences": ["72", "48"],
    "Freight & logistics": ["60", "63"],
    "Raw materials": ["14", "03", "44"],
    "Contract manufacturing": ["42", "31", "34"],
    "Facilities services": ["90", "50", "70", "45"],
}
rows = list(csv.DictReader(open(HERE / "raw/estonia-public-procurement.csv", encoding="utf-8")))
out = {"source": "Estonian Public Procurement Register via datahub.io (nimistu/estonia-public-procurement)",
       "n_awards": len(rows), "categories": {}}
for cat, divs in CATS.items():
    sel = []
    for r in rows:
        try:
            amt, bc = float(r["amount"]), int(r["bidder_count"] or 0)
        except ValueError:
            continue
        if r["currency"] == "EUR" and amt > 0 and r["cpv_main"][:2] in divs:
            sel.append((amt, bc, r["procedure_type"]))
    amts = sorted(a for a, _, _ in sel)
    bcs = [b for _, b, _ in sel if b > 0]
    q = lambda p: round(amts[int(p * (len(amts) - 1))])
    out["categories"][cat] = {
        "cpv_divisions": divs, "awards": len(sel),
        "award_eur_p25": q(.25), "award_eur_median": q(.5), "award_eur_p75": q(.75),
        "avg_bidders": round(st.mean(bcs), 2) if bcs else None,
        "single_bidder_share": round(sum(b == 1 for b in bcs) / len(bcs), 3) if bcs else None,
        "negotiated_procedure_share": round(sum("neg" in p for _, _, p in sel) / len(sel), 3),
    }
(HERE / "market_benchmarks.json").write_text(json.dumps(out, indent=2))
print(json.dumps(out["categories"], indent=1))
