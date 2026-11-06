#!/usr/bin/env bash
# Starts the Precedent API + dashboard on :8000 (needs ./run_hindsight.sh running)
cd "$(dirname "$0")"
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
