#!/usr/bin/env bash
# Boot the LifeLine demo (FastAPI backend + phone-frame frontend).
# Works on a laptop or the cluster. The translation model auto-selects its device
# (CUDA -> Apple Silicon/MPS -> CPU), so nothing special is needed on a laptop.
#
# Usage:
#   ./run.sh            # default port 8000 (laptop)
#   ./run.sh 8080       # different port
#
# On the cluster only (shared GPU node), the app must use a free port (8000 is
# taken by the vLLM endpoint) AND a free GPU. Example:
#   CUDA_VISIBLE_DEVICES=2 ./run.sh 8001
set -euo pipefail

cd "$(dirname "$0")"
PORT="${1:-8000}"
HOST="127.0.0.1"

# First run on a fresh machine: create the venv and install dependencies.
if [ ! -x .venv/bin/python ]; then
  echo "No .venv found - running setup (this downloads the base model on first use)."
  ./setup_local.sh
fi

# Optional local settings (email server for sign-up codes). See .env.example.
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

# Build the SQLite database from the committed data/*.csv files if it does not
# exist yet. This makes a fresh git clone fully runnable without any manual sync.
if [ ! -s db/services.db ]; then
  echo "No database found - building db/services.db from data/*.csv ..."
  mkdir -p db
  for csv in data/*.csv; do
    [ -f "$csv" ] || continue
    .venv/bin/python scripts/load_csv_to_db.py "$csv" --delete-source "$(basename "$csv")"
  done
fi

# On the cluster only: the inherited conda env's sqlite3/icu need its newer
# libstdc++ (CXXABI_1.3.15). Harmless elsewhere - the path simply won't exist.
ENV_LIB="/data/data/wolfflab/btdixon/conda/envs/parsing_cu12/lib"
if [ -f "$ENV_LIB/libstdc++.so.6" ]; then
  export LD_LIBRARY_PATH="$ENV_LIB:${LD_LIBRARY_PATH:-}"
fi

echo "Starting on http://${HOST}:${PORT}  (open in a browser, phone frame shown)"
exec .venv/bin/python -m uvicorn app.main:app --host "$HOST" --port "$PORT"
