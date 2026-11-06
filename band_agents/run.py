"""Start Scout, Negotiator and Ledger in one asyncio process.  Usage: uv run python run.py"""
import asyncio
import sys
from pathlib import Path

CONFIG = Path("agent_config.yaml")
NAMES = ("scout", "negotiator", "ledger")


def check_config() -> str | None:
    if not CONFIG.exists():
        return ("agent_config.yaml not found in the current directory.\n"
                "Copy agent_config.example.yaml to agent_config.yaml and fill in the ID/API key of each "
                "Band remote agent (see README.md), then run from band_agents/.")
    import yaml
    cfg = yaml.safe_load(CONFIG.read_text()) or {}
    bad = [n for n in NAMES if not (cfg.get(n) or {}).get("agent_id") or "<" in str((cfg.get(n) or {}).get("api_key", "<"))
           or "<" in str((cfg.get(n) or {}).get("agent_id", "<"))]
    if bad:
        return f"agent_config.yaml is missing or has placeholder credentials for: {', '.join(bad)}"
    return None


async def main() -> None:
    from band import Agent
    from band.adapters import LangGraphAdapter

    from precedent_band.api import PrecedentApi
    from precedent_band.commands import ledger_reply, load_bench, negotiator_reply, scout_reply
    from precedent_band.wiring import make_graph_factory

    api = PrecedentApi()
    bench = load_bench()

    async def scout(text):
        try:
            vendors = await api.vendors()
        except Exception:
            vendors = None
        return scout_reply(text, bench, vendors)

    handlers = {"scout": scout,
                "negotiator": lambda t: negotiator_reply(t, api),
                "ledger": lambda t: ledger_reply(t, api)}
    agents = [Agent.from_config(n, adapter=LangGraphAdapter(graph_factory=make_graph_factory(h)))
              for n, h in handlers.items()]
    print("Starting Scout, Negotiator, Ledger ... (Ctrl+C to stop)")
    await asyncio.gather(*(a.run() for a in agents))


if __name__ == "__main__":
    err = check_config()
    if err:
        sys.exit(err)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
