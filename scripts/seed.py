"""Load the synthetic negotiation history into the Hindsight bank (idempotent per document id)."""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import config, memory  # noqa: E402

vendors = {v["id"]: v for v in json.loads((config.DATA_DIR / "vendors.json").read_text())}
history = sorted(json.loads((config.DATA_DIR / "history.json").read_text()), key=lambda e: e["date"])

memory.ensure_bank(config.BANK_ID)
memory.ensure_directives(config.BANK_ID)
for v in vendors.values():
    memory.ensure_playbook(config.BANK_ID, v["id"], v["name"])
t0 = time.time()
for i, ep in enumerate(history, 1):
    for attempt in range(4):
        try:
            memory.retain_episode(config.BANK_ID, ep, vendors[ep["vendor_id"]])
            break
        except Exception as e:  # rate limit / transient: back off
            print(f"  retry {attempt + 1} ({str(e)[:80]})", flush=True)
            time.sleep(10 * (attempt + 1))
    print(f"[{i}/{len(history)}] {ep['vendor_id']} {ep['date']}  {time.time() - t0:.0f}s", flush=True)
print("done")
