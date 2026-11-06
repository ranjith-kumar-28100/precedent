#!/usr/bin/env bash
# Emergency stop: ends the Precedent API and the Hindsight server so nothing can call the LLMs.
ps -eo pid,args | awk '$2 ~ /\.venv\/bin\/python/ && ($0 ~ /uvicorn app.main/ || $3 ~ /hindsight-api/) {print $1}' | xargs -r kill
echo "stopped API and Hindsight"
