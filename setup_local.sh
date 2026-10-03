#!/usr/bin/env bash
# One-time setup to run the demo on a fresh laptop (or the cluster).
# Creates a venv and installs the Python dependencies.
#
# The 1.5B base model is downloaded from HuggingFace automatically on the first
# /api/translate call (or first run of scripts/precompute_plain.py). The LoRA
# adapter is bundled in models/finetuned-base and needs no download.
set -euo pipefail

cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
echo "Creating virtualenv with: $PY"
"$PY" -m venv .venv

echo "Upgrading pip..."
.venv/bin/pip install --upgrade pip

echo "Installing requirements (this may take a while for torch)..."
.venv/bin/pip install -r requirements.txt

echo
echo "Setup complete. Start the demo with:  ./run.sh"
echo "First /api/translate call will download Qwen/Qwen2.5-1.5B (~3 GB) from HuggingFace."
