#!/usr/bin/env bash
# Starts the open-source Hindsight server using settings from .env
cd "$(dirname "$0")"
set -a; . ./.env; set +a
exec .venv/bin/hindsight-api --port 8888
