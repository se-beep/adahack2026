#!/usr/bin/env bash
# Package the demo into a single self-contained tarball you can copy to your
# laptop. Extracts into a clean edinburgh-plain-services/ folder. Includes the
# app code + the small LoRA adapter (models/finetuned-base). The 1.5B base model
# is NOT bundled - it downloads from HuggingFace on the laptop.
#
# On the cluster:
#   ./bundle.sh                     # writes edinburgh-plain-services.tgz
#   scp edinburgh-plain-services.tgz you@laptop:~/
#
# On the laptop:
#   tar xzf edinburgh-plain-services.tgz
#   cd edinburgh-plain-services && ./setup_local.sh && ./run.sh
set -euo pipefail

cd "$(dirname "$0")"
OUT="edinburgh-plain-services.tgz"
NAME="edinburgh-plain-services"

# Make sure the adapter is bundled inside the project.
ADAPTER="models/finetuned-base"
if [ ! -f "$ADAPTER/adapter_model.safetensors" ]; then
  echo "Copying LoRA adapter into $ADAPTER ..."
  mkdir -p "$ADAPTER"
  SRC="/home/data/wolfflab/btdixon/Dixon/finetune-plain-language/models/finetuned-base"
  cp "$SRC/adapter_config.json" "$SRC/adapter_model.safetensors" "$ADAPTER/"
fi

STAGE="$(mktemp -d)"
DEST="$STAGE/$NAME"
mkdir -p "$DEST"
cp -r app models db scripts "$DEST/"
cp run.sh setup_local.sh requirements.txt README_LAPTOP.md "$DEST/"

tar --exclude='__pycache__' --exclude='*.pyc' -C "$STAGE" -czf "$OUT" "$NAME"
rm -rf "$STAGE"

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1)). Copy it to your laptop, then:"
echo "  tar xzf $OUT && cd edinburgh-plain-services && ./setup_local.sh && ./run.sh"
