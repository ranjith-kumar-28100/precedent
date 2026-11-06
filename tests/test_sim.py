import random

import pytest

from app import sim

PROFILE = {"floor_discount": 0.20, "works": "competing_quote", "fails": "escalate_to_exec",
           "decision_maker": "Regional Sales Director", "quirk": ""}


def run(tactic, ask, seed=1):
    return sim.respond(PROFILE, tactic, ask, random.Random(seed))


def test_working_tactic_with_full_ask_wins():
    r = run("competing_quote", 0.20)
    assert r["outcome"] == "won"
    assert r["final_discount"] == pytest.approx(0.20 * 0.97, abs=0.011)


def test_working_tactic_is_capped_by_the_ask():
    # a low ask makes a good tactic look weak: the reason for the "never under-ask" rule
    assert run("competing_quote", 0.05)["outcome"] == "lost"


def test_failing_tactic_backfires():
    r = run("escalate_to_exec", 0.20)
    assert r["outcome"] == "lost"
    assert "backfired" in r["notes"]


def test_neutral_tactic_gives_partial_concession():
    r = run("bundle", 0.20)
    assert r["final_discount"] <= 0.20 * 0.40 + 0.01
    assert r["outcome"] in ("partial", "lost")


def test_over_ask_is_penalised():
    fair = run("competing_quote", 0.20)["final_discount"]
    greedy = run("competing_quote", 0.30)["final_discount"]  # 0.30 > 0.20 * 1.25
    assert greedy < fair
    assert "well above" in run("competing_quote", 0.30)["notes"]


def test_same_seed_is_deterministic():
    assert run("bundle", 0.15, seed=7) == run("bundle", 0.15, seed=7)


def test_discount_never_negative():
    tiny = {**PROFILE, "floor_discount": 0.001}
    assert sim.respond(tiny, "escalate_to_exec", 0.5, random.Random(3))["final_discount"] >= 0


def test_savings_pct_normalises_and_caps():
    assert sim.savings_pct(PROFILE, 0.10) == 50.0
    assert sim.savings_pct(PROFILE, 0.30) == 100.0


def test_every_tactic_has_a_phrase():
    for t in sim.TACTICS:
        assert t in run(t, 0.1)["notes"] or run(t, 0.1)["notes"].startswith("We ")
