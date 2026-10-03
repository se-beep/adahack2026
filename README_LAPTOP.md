# LifeLine - run it on your laptop

The whole demo, including the plain-language LLM, runs locally on your laptop.
The heavy 1.5B base model is pulled from HuggingFace automatically; only the small
LoRA adapter (~70 MB) is bundled with the code.

## Requirements on your laptop
- Python 3.10+ (tested on 3.12)
- Internet on first run (to download the base model once)

Works on CPU (slow but fine for a demo), Apple Silicon (MPS), or an NVIDIA GPU.

## Steps

1. **Copy the bundle from the cluster:**
   ```
   # on the cluster:
   ./bundle.sh
   scp edinburgh-plain-services.tgz you@laptop:/somewhere/

   # on the laptop:
   tar xzf edinburgh-plain-services.tgz
   cd edinburgh-plain-services
   ```

2. **Install dependencies (one time):**
   ```
   ./setup_local.sh
   ```

3. **Start the demo:**
   ```
   ./run.sh
   ```

4. **Open** http://127.0.0.1:8000 in a browser. You'll see the phone frame.

## Notes
- The **first** time you use "Make any text simpler" (on the FAQ screen) (or any `/api/translate`), the app
  downloads `Qwen/Qwen2.5-1.5B` (~3 GB) from HuggingFace and loads the LoRA adapter.
  It takes a moment; afterwards the model stays loaded in memory.
- Precomputed service descriptions already ship in plain language in
  `app/data/services.json`, so the list/detail/map all work even before the model loads.
- To regenerate plain descriptions with your local model: `.venv/bin/python scripts/precompute_plain.py --overwrite`
- Port: default 8000. Use `./run.sh 8080` for another port.

## Replacing the data
Swap in real Edinburgh services by editing `app/data/services.json`, or point the app at
another file with the `SERVICES_PATH` env var. The schema is defined in `app/schemas.py`
(id, name, category, description_original, description_plain, address, location, hours,
phone, website, free, tags).
