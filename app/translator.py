"""Plain-language translation using the LoRA-tuned Qwen2.5-1.5B base model.

The model is loaded lazily on first use so the app can run without it until a
/translate call (or the precompute script) actually needs it.

Prompt format matches the base-finetune training format exactly:
    {source}\n\nEasy Read:\n -> {easy_read}
(labels masked to the Easy Read completion only; at inference we feed the
source and let the model complete it.)
"""
import os
import threading

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

# Base model is public on HuggingFace: on a laptop it auto-downloads to the HF
# cache; on the cluster the same id resolves to the local /scratch cache.
DEFAULT_BASE = os.environ.get("PLAIN_BASE_MODEL", "Qwen/Qwen2.5-1.5B")

# LoRA adapter ships inside the project (models/finetuned-base) so it travels
# with the code. Override with PLAIN_ADAPTER if you keep it elsewhere.
_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_ADAPTER = os.path.join(_HERE, "models", "finetuned-base")

_lock = threading.Lock()
_tokenizer = None
_model = None
_model_device = None


def _pick_device():
    """Return (device, dtype) that works on CUDA, Apple Silicon, or plain CPU."""
    if torch.cuda.is_available():
        return "cuda:0", torch.bfloat16
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps", torch.float32
    return "cpu", torch.float32


def _load():
    global _tokenizer, _model, _model_device
    base = os.environ.get("PLAIN_BASE_MODEL", DEFAULT_BASE)
    adapter = os.environ.get("PLAIN_ADAPTER", DEFAULT_ADAPTER)
    device, dtype = _pick_device()
    print(f"[translator] loading base={base} adapter={adapter} device={device}", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(base)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(base, torch_dtype=dtype,
                                                 low_cpu_mem_usage=True)
    model = model.to(device)
    model = PeftModel.from_pretrained(model, adapter)
    model.eval()
    _tokenizer = tokenizer
    _model = model
    _model_device = device


def _ensure_loaded():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                _load()
    return _tokenizer, _model


def translate(text: str, max_new_tokens: int = 400) -> str:
    tok, model = _ensure_loaded()
    prompt = f"{text}\n\nEasy Read:\n"
    ids = tok(prompt, return_tensors="pt")
    ids = {k: v.to(model.device) for k, v in ids.items()}
    with torch.no_grad():
        out = model.generate(**ids, do_sample=False, max_new_tokens=max_new_tokens,
                             pad_token_id=tok.pad_token_id, eos_token_id=tok.eos_token_id)
    gen = out[0][ids["input_ids"].shape[1]:]
    return tok.decode(gen, skip_special_tokens=True).strip()


def model_loaded() -> bool:
    return _model is not None
