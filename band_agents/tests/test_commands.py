import pytest

from precedent_band.commands import *

VENDORS = [{"id": "v01", "name": "Northwind Cloudworks", "category": "SaaS licences"},
           {"id": "v03", "name": "Halvorsen Freight Lines", "category": "freight/logistics"},
           {"id": "v04", "name": "TransPacific Haulage Co.", "category": "freight/logistics"}]
BENCH = load_bench()


def test_split_and_strip():
    assert split_sender("[Ann]: @Ledger log x") == ("Ann", "@Ledger log x")
    assert strip_mentions("@Ledger  memory v01") == "memory v01"
    assert strip_mentions("@Band.Ledger brief x") == "brief x"


def test_resolve():
    assert resolve_vendor("v01", VENDORS)["id"] == "v01"
    assert resolve_vendor("northwind", VENDORS)["id"] == "v01"
    assert resolve_vendor("Halvorsen Freight Lines", VENDORS)["id"] == "v03"
    assert resolve_vendor("nobody", VENDORS) is None


def test_parse_brief():
    assert parse_brief("brief Northwind") == BriefCmd("Northwind", True)
    assert parse_brief("brief Northwind Cloudworks memory off") == BriefCmd("Northwind Cloudworks", False)
    assert parse_brief("hello") is None


def test_parse_log():
    c = parse_log("log Northwind tactic=multi_year ask=15 got=9% outcome=partial CFO pushed back, said Q4")
    assert (c.vendor_query, c.tactic, c.ask, c.got, c.outcome) == ("Northwind", "multi_year", 0.15, 0.09, "partial")
    assert c.notes == "CFO pushed back, said Q4"


@pytest.mark.parametrize("bad", ["log Northwind", "log N tactic=nope ask=1 got=1 outcome=won",
                                 "log N tactic=bundle ask=1 got=1 outcome=maybe",
                                 "log N tactic=bundle ask=x got=1 outcome=won",
                                 "log N tactic=bundle ask=1 outcome=won"])
def test_parse_log_errors(bad):
    with pytest.raises(ParseError):
        parse_log(bad)


def test_scout():
    assert "SaaS licences" in scout_reply("benchmarks for software licences", BENCH)
    assert "96,097" in scout_reply("what is typical for SaaS licences?", BENCH)
    assert "Freight" in scout_reply("Halvorsen Freight Lines market?", BENCH, VENDORS)
    assert "could not match" in scout_reply("pizza", BENCH)
    assert "Categories" in scout_reply("help", BENCH)


class Fake:
    def __init__(self): self.calls = []
    async def vendors(self): return VENDORS
    async def brief(self, vid, obj, um):
        self.calls.append(("brief", vid, um))
        return {"use_memory": um, "brief": {"summary": "S", "recommended_opening_ask_pct": 18, "decision_maker": "CFO",
                "tactics": [{"tactic": "multi_year", "why": "w", "confidence": "high"}], "watch_outs": ["x"]},
                "citations": [{"id": "a", "text": "obs text", "kind": "observation", "date": "2026-01-01"}]}
    async def outcome(self, p): self.calls.append(("outcome", p)); return {"retained": True}
    async def memory(self, vid): return {"observations": [{"text": "o", "proof_count": 3}], "mental_model": "mm", "facts": 5}


async def test_negotiator():
    f = Fake()
    r = await negotiator_reply("brief northwind memory off", f)
    assert f.calls == [("brief", "v01", False)] and "memory OFF" in r and "[1]" in r
    assert "Could not identify" in await negotiator_reply("brief zzz", f)


async def test_ledger():
    f = Fake()
    r = await ledger_reply("log v03 tactic=bundle ask=12 got=7 outcome=won nice", f)
    assert f.calls[0][1]["final_discount"] == 0.07 and "retained" in r
    assert "x3" in await ledger_reply("memory v01", f)
    assert "Usage" in await ledger_reply("log v03", f)
    assert "Ledger:" in await ledger_reply("hi", f)
