"""Deterministic vendor simulator. Each vendor has a hidden behaviour profile; the agent never
sees it and can only learn it from the notes of past negotiations it retained."""
import random

TACTICS = ["competing_quote", "volume_commit", "multi_year", "quarter_end_timing",
           "bundle", "escalate_to_exec", "payment_terms"]

_PHRASE = {
    "competing_quote": "put a competing quote from a rival on the table",
    "volume_commit": "offered a firm volume commitment",
    "multi_year": "proposed a multi-year term",
    "quarter_end_timing": "pushed to close right before their quarter end",
    "bundle": "bundled a second product line into the deal",
    "escalate_to_exec": "escalated to their executive sponsor",
    "payment_terms": "offered faster payment terms",
}


def respond(profile: dict, tactic: str, ask: float, rng: random.Random) -> dict:
    """Return {final_discount, outcome, notes} for one negotiation round."""
    floor = profile["floor_discount"]
    noise = rng.uniform(-0.01, 0.01)
    if tactic == profile["works"]:
        got = min(ask, floor) * 0.97 + noise
        reaction = (f"{profile['decision_maker']} engaged immediately and moved on price once we "
                    f"raised it; settled quickly")
    elif tactic == profile["fails"]:
        got = floor * 0.12 + noise
        reaction = (f"{profile['decision_maker']} visibly hardened and held list price; "
                    f"the tactic backfired")
    else:
        got = min(ask, floor * 0.40) + noise
        reaction = "vendor gave only small, grudging concessions and kept pointing to list pricing"
    if ask > floor * 1.25:
        got *= 0.6
        reaction += "; our ask was well above what they will ever give and they said so"
    got = max(0.0, round(got, 3))
    ratio = got / floor
    outcome = "won" if ratio >= 0.85 else "partial" if ratio >= 0.4 else "lost"
    notes = (f"We {_PHRASE[tactic]} and asked for {ask*100:.0f}% off. {reaction[0].upper()}{reaction[1:]}. "
             f"Final discount {got*100:.1f}%. {profile.get('quirk', '')}").strip()
    return {"final_discount": got, "outcome": outcome, "notes": notes}


def savings_pct(profile: dict, final_discount: float) -> float:
    return round(100 * min(1.0, final_discount / profile["floor_discount"]), 1)
