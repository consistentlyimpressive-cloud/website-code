import os
import cv2
import time
import base64
import numpy as np
import sys
import json
import random
import re
from pathlib import Path

# Load .env if it exists
if os.path.exists(".env"):
    with open(".env", encoding="utf-8") as f:
        for line in f:
            if '=' in line and not line.startswith('#'):
                k, v = line.strip().split('=', 1)
                os.environ[k] = v.strip('"\'')

RUN_OUTPUT_DIR = Path(os.getenv("MOGCHECK_RUN_OUTPUT_DIR") or ".").resolve()
RUN_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def run_output_path(filename):
    return str(RUN_OUTPUT_DIR / filename)


def read_text_context(path_value, max_chars=24000):
    if not path_value:
        return ""
    try:
        path = Path(path_value).resolve()
        if not path.exists() or not path.is_file():
            return ""
        text = path.read_text(encoding="utf-8", errors="ignore")
        return text[-max_chars:]
    except Exception:
        return ""


TOKEN_USAGE_LOG_PATH = Path(__file__).resolve().parent / "token-usage-log.jsonl"


def parse_metric_lines(text):
    metrics = {}
    for line in str(text or "").splitlines():
        if ":" not in line:
            continue
        clean = line.strip().lstrip("-").strip()
        if not clean or clean.startswith("=") or clean.startswith("["):
            continue
        label, value_text = clean.split(":", 1)
        label = " ".join(label.split())
        try:
            import re
            match = re.search(r"-?\d+(?:\.\d+)?", value_text)
        except Exception:
            match = None
        if not label or not match:
            continue
        try:
            metrics[label] = float(match.group(0))
        except Exception:
            continue
    return metrics


def compact_metric_summary(clinical_data, side_data=None, max_side_chars=1800):
    front_metrics = parse_metric_lines(clinical_data)
    preferred_order = [
        "Bigonial_Width_Index",
        "IPD_Index (Geometric)",
        "Mouth_Width_Index",
        "Nose_Width_Index",
        "Upper_Third_Length",
        "Middle_Third_Length",
        "Lower_Third_Length",
        "Eye_Width_Index (Horizontal)",
        "Eye_Height_Index",
        "Brow_Compactness_Index (distance from center of eye to bottom of brow)",
        "Philtrum_Height_Index",
        "Total_Lip_Height_Index",
        "fWHR (Zygo / Upper_Face)",
        "Midface_Ratio (Mid/IPD)",
        "Canthal_Tilt_Degrees",
    ]
    compact_front = {}
    for key in preferred_order:
        if key in front_metrics:
            compact_front[key] = front_metrics[key]
    for key, value in front_metrics.items():
        if key not in compact_front and len(compact_front) < 18:
            compact_front[key] = value

    payload = {"front_metrics": compact_front}
    if side_data and side_data != "IGNORE_SIDE_ANALYSIS":
        payload["side_profile_summary"] = str(side_data).strip()[:max_side_chars]
    else:
        payload["side_profile_summary"] = None
    return json.dumps(payload, ensure_ascii=True, separators=(",", ":"))


def estimate_text_tokens(text):
    return int(round(len(str(text or "")) / 4))


def estimate_image_tokens(image_path):
    if not image_path or not os.path.exists(image_path):
        return 0
    try:
        img = cv2.imread(image_path)
        if img is None:
            return 258
        height, width = img.shape[:2]
        if width <= 384 and height <= 384:
            return 258
        tiles = max(1, int(np.ceil(width / 768))) * max(1, int(np.ceil(height / 768)))
        return tiles * 258
    except Exception:
        return 258


def usage_value(metadata, name):
    if not metadata:
        return None
    if hasattr(metadata, name):
        return getattr(metadata, name)
    camel = "".join([name.split("_")[0], *[part.capitalize() for part in name.split("_")[1:]]])
    if hasattr(metadata, camel):
        return getattr(metadata, camel)
    return None


def log_token_usage(event):
    try:
        event["timestamp"] = int(time.time() * 1000)
        with TOKEN_USAGE_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=True, separators=(",", ":")) + "\n")
        print("[TOKEN_USAGE] " + json.dumps(event, ensure_ascii=True, separators=(",", ":")))
    except Exception as error:
        print(f"[TOKEN_USAGE] Failed to write token usage: {error}")

print("[DEBUG] Phase 1: Importing SDKs...")
try:
    from google import genai
    from google.genai import types
    print("[DEBUG] Analysis Engine A Loaded.")
except ImportError:
    print("[DEBUG] Engine A MISSING. Run: pip install google-genai")

# Internal Module Imports
try:
    from engine import get_clinical_biometrics
    print("[DEBUG] Engine.py Linked Successfully.")
except ImportError:
    print("[DEBUG] CRITICAL: Ensure your measurement script is named 'engine.py' in this folder!")

try:
    from animation_engine import generate_scan_animation
    print("[DEBUG] Animation_Engine.py Loaded.")
except ImportError:
    print("[DEBUG] WARNING: animation_engine.py not found in directory.")

# NEW: Side Engine Import
try:
    import engineside
    print("[DEBUG] engineside.py Linked Successfully.")
except ImportError:
    print("[DEBUG] WARNING: engineside.py not found. Side profile analysis will be skipped.")

# ==========================================================
# API KEY VAULT (GOOGLE AI STUDIO / GEMMA API)
# ==========================================================
GOOGLE_GENAI_KEYS = [
    (index, (os.getenv(f"GEMINI_KEY_{index}") or "").strip())
    for index in range(1, 6)
]
GOOGLE_GENAI_KEYS = [(index, key) for index, key in GOOGLE_GENAI_KEYS if key]
GEMINI_31_PRO_MODEL_ID = (os.getenv("GEMINI_3_1_PRO_MODEL_ID") or "gemini-3.1-pro-preview").strip()
GEMINI_31_PRO_KEYS = [
    ("GEMINI_3_1_PRO_API_KEY", (os.getenv("GEMINI_3_1_PRO_API_KEY") or "").strip())
]
GEMINI_31_PRO_KEYS = [(label, key) for label, key in GEMINI_31_PRO_KEYS if key]
GEMMA_PER_KEY_TIMEOUT_MS = int(os.getenv("GEMMA_PER_KEY_TIMEOUT_MS") or "186000")
EXPERT_31B_FALLBACK_AFTER_MS = int(os.getenv("EXPERT_31B_FALLBACK_AFTER_MS") or "200000")
_raw_disabled_keys = os.getenv("GEMINI_DISABLED_KEYS") or ""
GEMINI_DISABLED_KEYS = {
    int(part)
    for part in _raw_disabled_keys.replace(" ", "").split(",")
    if part.isdigit()
}
GEMINI_ENABLE_KEY_QUARANTINE = (os.getenv("GEMINI_ENABLE_KEY_QUARANTINE") or "0").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
KEY_HEALTH_STATE_PATH = Path(__file__).resolve().parent / "key-health-state.json"

BENCHMARK_CALIBRATION_PATH = Path(__file__).resolve().parent / "gemini-benchmark-calibration.json"


def remove_score_cap_rules_for_premium_model(prompt):
    cap_pattern = re.compile(
        r"\b(?:cap|caps|capped|ceiling)\b|must\s+not\s+exceed\s+40|female\s+counterbalance|deduct\s+10\s+points",
        re.IGNORECASE,
    )
    kept_lines = []
    for line in str(prompt or "").splitlines():
        if cap_pattern.search(line):
            continue
        kept_lines.append(line)
    return "\n".join(kept_lines)


def _utc_now_ms():
    return int(time.time() * 1000)


def _load_key_health_state():
    try:
        if KEY_HEALTH_STATE_PATH.exists():
            data = json.loads(KEY_HEALTH_STATE_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def _save_key_health_state(state):
    try:
        state["disabledKeys"] = sorted(GEMINI_DISABLED_KEYS)
        state["updatedAt"] = int(time.time() * 1000)
        KEY_HEALTH_STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")
    except Exception as error:
        print(f"[KEY_HEALTH] Failed to save key state: {error}")


def _quarantine_key(key_index, reason, detail, duration_ms):
    if not GEMINI_ENABLE_KEY_QUARANTINE:
        print(f"[KEY_HEALTH] Quarantine disabled; keeping GEMINI_KEY_{key_index} available after: {reason}")
        return
    state = _load_key_health_state()
    quarantines = state.get("quarantines")
    if not isinstance(quarantines, dict):
        quarantines = {}
    until_ms = _utc_now_ms() + int(duration_ms)
    quarantines[str(key_index)] = {
        "untilMs": until_ms,
        "reason": reason,
        "detail": str(detail or "")[:260],
        "updatedAtMs": _utc_now_ms(),
    }
    state["quarantines"] = quarantines
    _save_key_health_state(state)
    minutes = max(1, round(duration_ms / 60000))
    print(f"[KEY_HEALTH] GEMINI_KEY_{key_index} quarantined for ~{minutes}m: {reason}")


def _key_label(key_index):
    if isinstance(key_index, int):
        return f"GEMINI_KEY_{key_index}"
    return str(key_index)


def _healthy_key_attempts(keys=None):
    keys = keys or GOOGLE_GENAI_KEYS
    state = _load_key_health_state()
    _save_key_health_state(state)
    quarantines = (
        state.get("quarantines")
        if GEMINI_ENABLE_KEY_QUARANTINE and isinstance(state.get("quarantines"), dict)
        else {}
    )
    now_ms = _utc_now_ms()
    attempts = []
    skipped = []

    for key_index, key in keys:
        label = _key_label(key_index)
        if isinstance(key_index, int) and key_index in GEMINI_DISABLED_KEYS:
            skipped.append(f"{label}:disabled")
            continue
        quarantine = quarantines.get(str(key_index))
        if quarantine and int(quarantine.get("untilMs") or 0) > now_ms:
            skipped.append(f"{label}:quarantined")
            continue
        attempts.append((key_index, key))

    if skipped:
        print(f"[KEY_HEALTH] Skipping keys this scan: {', '.join(skipped)}")
    return attempts


def _quarantine_for_error(error_text):
    text = str(error_text or "")
    low = text.lower()
    if "permission_denied" in low or "project has been denied access" in low or "403" in low:
        return ("permission_denied", 24 * 60 * 60 * 1000)
    if "resource_exhausted" in low or "quota" in low or "429" in low:
        return ("quota_exhausted", 45 * 60 * 1000)
    if "read operation timed out" in low or "timed out" in low or "503" in low or "unavailable" in low or "high demand" in low:
        return ("provider_unavailable", 10 * 60 * 1000)
    return (None, 0)


def _is_transient_provider_error(error_text):
    low = str(error_text or "").lower()
    return any(
        marker in low
        for marker in (
            "500 internal",
            "internal error encountered",
            "empty model response",
            "read operation timed out",
            "timed out",
            "503",
            "unavailable",
            "high demand",
        )
    )


def _mean(values):
    values = [float(v) for v in values if isinstance(v, (int, float))]
    return round(sum(values) / len(values), 3) if values else None


def load_benchmark_calibration_summary():
    """Keep Gemma anchored to the local Codex training buckets without dumping huge data."""
    if not BENCHMARK_CALIBRATION_PATH.exists():
        return "No local benchmark calibration file found. Use the written rating anchors only."

    try:
        rows = json.loads(BENCHMARK_CALIBRATION_PATH.read_text(encoding="utf-8"))
    except Exception as error:
        return f"Local benchmark calibration could not be loaded: {error}"

    bucket_order = [
        ("Uncanny training", "uncanny / synthetic / overbuilt examples", "about 48"),
        ("Exatraggted But not uncanny", "exaggerated but coherent / striking examples", "about 76"),
        ("The 3s", "3-range / very low tier", "about 35"),
        ("The 4s", "4-range / low tier", "about 45"),
        ("The 5s", "5-range / lower-average tier", "about 55"),
        ("The 6s", "6-range / decent-above-average tier", "about 65"),
        ("7s", "7-range / attractive high-tier baseline", "about 75"),
        ("The 8s", "8-range / elite natural high-tier examples", "about 85"),
    ]
    metric_keys = ("fWHR", "Midface", "Bigonial", "IPD", "Eye", "Brow", "Philtrum", "Canthal")
    lines = [
        "LOCAL BENCHMARK CALIBRATION FROM CODEX TRAINING FOLDERS:",
        "Use these as soft anchors together with the photo. Do not blindly copy a bucket; classify by overall visual harmony plus measurements.",
        "Especially important: the 7s folder contains faces that should generally remain in the 70s when they look natural/coherent.",
        "The 'Exatraggted But not uncanny' folder contains striking / high-fashion / over-the-top faces that are still coherent and should usually stay in the 70s rather than being collapsed into uncanny penalties.",
        "The 'Uncanny training' folder contains synthetic / overbuilt / artificial-looking faces that should be punished very heavily even when some local ratios look strong.",
    ]

    for folder, label, target in bucket_order:
        entries = [entry for entry in rows if isinstance(entry, dict) and entry.get("sourceFolder") == folder]
        if not entries:
            continue
        metric_bits = []
        for key in metric_keys:
            value = _mean([entry.get("metrics", {}).get(key) for entry in entries])
            if value is not None:
                metric_bits.append(f"{key}~{value}")
        lines.append(f"- {label}: target {target}; {len(entries)} examples; mean metrics: {', '.join(metric_bits)}.")

    return "\n".join(lines)


def consult_ai_with_selection(unified_prompt, img_path, choice, side_img_path=None):
    start_time = time.time()

    try:
        # --- MODEL MAPPING ---
        mapping = {
            "1": ("gemma-4-31b-it", "Premium Model"),
            "2": ("gemma-4-31b-it", "Backup Model"),
            "3": ("gemma-4-26b-a4b-it", "OPTIC"),
            "4": ("gemma-4-26b-a4b-it", "CORE"),
            "5": ("gemma-4-26b-a4b-it", "GENEVA"),
            "6": ("gemma-4-31b-it", "Premium Model"),
            "7": (GEMINI_31_PRO_MODEL_ID, "Premium Model"),
            "8": (GEMINI_31_PRO_MODEL_ID, "Premium Model"),
            "9": ("gemma-4-31b-it", "Premium Model")
        }

        if choice not in mapping:
            return "Error: Model selection failed.", "None", 0

        model_id, friendly_name = mapping[choice]
        model_attempts = [(model_id, friendly_name, None)]
        if choice == "6":
            model_attempts = [
                (model_id, friendly_name, EXPERT_31B_FALLBACK_AFTER_MS),
                ("gemma-4-26b-a4b-it", f"{friendly_name} fallback", None),
            ]

        print(f"[DEBUG] Consulting {friendly_name}... (Press Ctrl+C to Cancel)")
        if choice == "6":
            available_keys = GOOGLE_GENAI_KEYS
            key_help = "GEMINI_KEY_1 through GEMINI_KEY_5 for Gemma"
        elif choice in {"7", "8"}:
            available_keys = GEMINI_31_PRO_KEYS
            key_help = "GEMINI_3_1_PRO_API_KEY"
        else:
            available_keys = GOOGLE_GENAI_KEYS
            key_help = "GEMINI_KEY_1 or more keys for Gemma"
        if not available_keys:
            return (
                f"Error: No Google GenAI keys are configured in backend/.env. Add {key_help}.",
                friendly_name,
                0,
            )

        provider_errors = []
        provider_error_texts = []
        key_attempts = _healthy_key_attempts(available_keys)
        random.shuffle(key_attempts)
        if not key_attempts:
            return (
                "Error: No healthy Google GenAI/Gemma keys are available. All keys are disabled or quarantined.",
                friendly_name,
                0,
            )
        key_pool_label = "Gemma" if choice not in {"7", "8"} else "Gemini 3.1 Pro"
        print(f"[DEBUG] {key_pool_label} key order this scan: {', '.join(_key_label(index) for index, _ in key_attempts)}")
        analysis_phase = (os.getenv("MOGCHECK_ANALYSIS_PHASE") or "full").strip().lower()
        request_type = "protocol" if analysis_phase == "report" else analysis_phase
        scan_id = os.getenv("MOGCHECK_SCAN_REQUEST_ID") or None
        include_image = not (choice in {"2", "6", "7", "8", "9"} and analysis_phase == "report")
        max_output_tokens = None
        if choice in {"2", "6", "9"}:
            max_output_tokens = 1400 if analysis_phase == "report" else 1500
        elif choice in {"7", "8"}:
            # Gemini 3.x can spend a large part of maxOutputTokens on hidden thinking.
            # Give it more visible room and cap thinking so the JSON is not truncated.
            max_output_tokens = 2400 if analysis_phase == "report" else 4096
        estimated_input_tokens = estimate_text_tokens(unified_prompt)
        if include_image:
            estimated_input_tokens += estimate_image_tokens(img_path)
            if side_img_path and os.path.exists(side_img_path):
                estimated_input_tokens += estimate_image_tokens(side_img_path)

        for model_attempt_number, (attempt_model_id, attempt_friendly_name, fallback_after_ms) in enumerate(model_attempts, start=1):
            if model_attempt_number > 1:
                if not provider_error_texts or not all(_is_transient_provider_error(error) for error in provider_error_texts):
                    break
                print(f"[DEBUG] Premium Model 31B hit transient failures or the {EXPERT_31B_FALLBACK_AFTER_MS / 1000:.0f}s budget; trying {attempt_model_id} fallback.")
            model_started_at = time.time()

            for attempt_number, (key_index, key) in enumerate(key_attempts, start=1):
                if not key:
                    continue
                if fallback_after_ms:
                    elapsed_ms = int((time.time() - model_started_at) * 1000)
                    if elapsed_ms >= fallback_after_ms:
                        print(f"[DEBUG] {attempt_model_id} exceeded {fallback_after_ms / 1000:.0f}s Expert budget before {_key_label(key_index)}; moving to fallback.")
                        break
                attempt_started_at = time.time()
                try:
                    key_label = _key_label(key_index)
                    print(f"[DEBUG] Trying Google GenAI {key_label} ({attempt_number}/{len(key_attempts)}) on {attempt_model_id}...")
                    request_timeout_ms = GEMMA_PER_KEY_TIMEOUT_MS
                    if fallback_after_ms:
                        elapsed_ms = int((time.time() - model_started_at) * 1000)
                        remaining_ms = max(1000, fallback_after_ms - elapsed_ms)
                        request_timeout_ms = min(GEMMA_PER_KEY_TIMEOUT_MS, remaining_ms)
                    http_options = {"timeout": request_timeout_ms}
                    if attempt_model_id.startswith("gemini-3"):
                        http_options["apiVersion"] = "v1alpha"
                    client = genai.Client(api_key=key, http_options=types.HttpOptions(**http_options))
                    contents = [
                        types.Part.from_text(text=unified_prompt)
                    ]
                    if include_image:
                        with open(img_path, "rb") as f:
                            image_bytes = f.read()
                        contents.append(types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"))
                    if include_image and side_img_path and os.path.exists(side_img_path):
                        with open(side_img_path, "rb") as f:
                            side_image_bytes = f.read()
                        contents.append(types.Part.from_bytes(data=side_image_bytes, mime_type="image/jpeg"))
                    config_kwargs = {"temperature": 0}
                    if max_output_tokens:
                        config_kwargs["max_output_tokens"] = max_output_tokens
                    if attempt_model_id.startswith("gemini-3"):
                        config_kwargs["response_mime_type"] = "application/json"
                        config_kwargs["thinking_config"] = types.ThinkingConfig(includeThoughts=False, thinkingBudget=256)
                    res = client.models.generate_content(
                        model=attempt_model_id,
                        config=types.GenerateContentConfig(**config_kwargs),
                        contents=contents
                    )
                    usage = getattr(res, "usage_metadata", None)
                    prompt_tokens = usage_value(usage, "prompt_token_count")
                    output_tokens = usage_value(usage, "candidates_token_count")
                    total_tokens = usage_value(usage, "total_token_count")
                    if res.text:
                        duration = round(time.time() - start_time, 2)
                        log_token_usage({
                            "scan_id": scan_id,
                            "request_type": request_type,
                            "provider": "google-genai",
                            "model": attempt_model_id,
                            "key_index": key_index,
                            "attempt_number": attempt_number,
                            "success": True,
                            "duration_ms": int((time.time() - attempt_started_at) * 1000),
                            "input_token_count": prompt_tokens,
                            "output_token_count": output_tokens,
                            "total_token_count": total_tokens,
                            "estimated_input_tokens": estimated_input_tokens,
                            "max_output_tokens": max_output_tokens,
                            "image_included": include_image,
                        })
                        return res.text, friendly_name, duration
                    provider_errors.append(f"{_key_label(key_index)}: empty model response")
                    provider_error_texts.append("empty model response")
                    log_token_usage({
                        "scan_id": scan_id,
                        "request_type": request_type,
                        "provider": "google-genai",
                        "model": attempt_model_id,
                        "key_index": key_index,
                        "attempt_number": attempt_number,
                        "success": False,
                        "duration_ms": int((time.time() - attempt_started_at) * 1000),
                        "error": "empty model response",
                        "estimated_input_tokens": estimated_input_tokens,
                        "max_output_tokens": max_output_tokens,
                        "image_included": include_image,
                    })
                    _quarantine_key(key_index, "empty_response", "empty model response", 10 * 60 * 1000)
                except Exception as e:
                    if "User interrupted" in str(e):
                        raise
                    error_text = str(e).replace("\n", " ").strip()
                    short_error = error_text[:260] if error_text else "Unknown provider error"
                    provider_errors.append(f"{_key_label(key_index)}: {short_error}")
                    provider_error_texts.append(short_error)
                    log_token_usage({
                        "scan_id": scan_id,
                        "request_type": request_type,
                        "provider": "google-genai",
                        "model": attempt_model_id,
                        "key_index": key_index,
                        "attempt_number": attempt_number,
                        "success": False,
                        "duration_ms": int((time.time() - attempt_started_at) * 1000),
                        "error": short_error,
                        "estimated_input_tokens": estimated_input_tokens,
                        "max_output_tokens": max_output_tokens,
                        "image_included": include_image,
                    })
                    quota_hit = "RESOURCE_EXHAUSTED" in error_text or "quota" in error_text.lower()
                    quarantine_reason, quarantine_ms = _quarantine_for_error(error_text)
                    if quarantine_reason:
                        _quarantine_key(key_index, quarantine_reason, short_error, quarantine_ms)
                    if quota_hit:
                        print(f"      [!] {attempt_friendly_name} Google GenAI {_key_label(key_index)} quota exhausted. Trying next key...")
                    else:
                        print(f"      [!] {attempt_friendly_name} {_key_label(key_index)} failed: {short_error}")
                    continue

    except KeyboardInterrupt:
        print("\n[!] User Cancelled. Stopping request...")
        return "CANCELLED", "None", 0

    duration = round(time.time() - start_time, 2)
    if provider_errors:
        return (
            "Error: All configured Google GenAI/Gemma keys failed or hit quota. "
            + " | ".join(provider_errors[-3:]),
            "None",
            duration,
        )
    return "Error: Model selection failed or invalid choice.", "None", duration


def run_final_stack(img_path, clinical_data_json_str=None, choice_override=None, side_img_path=None):
    print("\n" + "=" * 30)
    print("      MODEL SELECTOR")
    print("=" * 30)
    print("1. Premium Model")
    print("2. Backup Model")
    print("-" * 30)
    print("3. OPTIC (Balance & Alignment)")
    print("4. CORE (Objective Attractiveness)")
    print("5. GENEVA (Mathematical Beauty)")
    print("6. Premium Model")
    print("7. Premium Model")
    print("8. Premium Model")
    print("9. Premium Model")

    if choice_override is not None and str(choice_override).strip():
        choice = str(choice_override).strip()
        print(f"\n[DEBUG] Model selected via API args: {choice}")
    else:
        try:
            choice = input("\nSelect Model [1, 2, 3-5]: ").strip()
        except KeyboardInterrupt:
            print("\nExiting script...")
            return

    if choice not in {"1", "2", "3", "4", "5", "6", "7", "8", "9"}:
        print(f"[ERROR] Invalid model choice: {choice}")
        return "Error: Model selection failed."

    # --- SIDE PROFILE DATA COLLECTION ---
    side_data = "IGNORE_SIDE_ANALYSIS"
    if choice in {"1", "2", "6", "7", "8", "9"}:
        print("[ðŸš€] Gathering Lateral Data from engineside.py...")
        if side_img_path and os.path.exists(side_img_path):
            try:
                side_data = engineside.get_profile_analysis(side_img_path)
            except Exception:
                side_data = "Lateral metadata unavailable. Focus on frontal visuals and input."
        else:
            side_data = "IGNORE_SIDE_ANALYSIS"
    has_side_profile = bool(
        choice in {"1", "2", "6", "7", "8", "9"} and side_img_path and os.path.exists(side_img_path) and side_data != "IGNORE_SIDE_ANALYSIS"
    )
    side_prompt_policy = """
        FRONT-ONLY MODE:
        No side profile image was provided. Use ONLY the frontal image and frontal metadata.
        Do NOT mention, infer, estimate, average with, or output any side-profile result.
        Ignore all side-profile instructions/templates below when they conflict with this rule.
        Output ONLY **Final Frontal Rating** and omit **Final Side Rating**, side hexagon ratings, side category scores, [SIDE] best features/flaws, side protocols, and side debug justification.
    """ if not has_side_profile else """
        SIDE PROFILE MODE:
        A side profile image was provided. Use INPUT B only for the side-profile result and keep the frontal result separate.
    """

    print(f"\n--- ANALYZING: {img_path} ---")
    if not os.path.exists(img_path):
        return

    try:
        generate_scan_animation(img_path, output_path=run_output_path("loading_scan.mp4"))
    except NameError:
        pass

    if clinical_data_json_str:
        clinical_data = clinical_data_json_str
    else:
        print("[1/3] Extracting Biometrics...")
        try:
            get_clinical_biometrics(img_path)
        except KeyboardInterrupt:
            print("\n[!] Analysis cancelled.")
            return

        if not os.path.exists(run_output_path("mog_report.txt")):
            return
        with open(run_output_path("mog_report.txt"), "r") as f:
            clinical_data = f.read()

    print("[2/3] Preparing Image...")
    img = cv2.imread(img_path)
    temp_analysis_path = run_output_path("temp_analysis.jpg")
    cv2.imwrite(temp_analysis_path, img, [int(cv2.IMWRITE_JPEG_QUALITY), 95])

    print("[3/3] Consulting AI...")

    prompt_visual_inputs = "INPUT C (Frontal Visual): High-resolution frontal image provided."
    if side_img_path and os.path.exists(side_img_path):
        prompt_visual_inputs += "\n        INPUT D (Side Visual): High-resolution side profile image provided."
    content_safety_rules = """
        CONTENT SAFETY GATE:
        - Before any facial rating or descriptive analysis, check every submitted image, including the side profile image, for explicit sexual content, pornographic framing, visible nudity, exposed genitals, exposed nipples, sexual acts, fetish content, or sexually suggestive minors.
        - If any of those are present, do NOT analyze attractiveness, do NOT rate the face, and do NOT continue the normal output format.
        - Instead output exactly:
        ### CONTENT_REJECTED
        This image cannot be analyzed. Please upload a non-explicit face photo.
    """
    feature_selection_rules = """
        BEST/WORST FEATURE SELECTION RULES:
        - Choose BEST FEATURES and PRIMARY FLAWS using BOTH the measurement data in mog_report / side metadata AND the actual visual appearance in the photo(s).
        - Do NOT blindly choose the best or worst raw ratio.
        - If a visually obvious issue is more appearance-limiting than any bad ratio, it should be the primary flaw even if the ratios are only mildly bad.
        - If a visually obvious strength is the most impressive trait, it should be the best feature even if it is not the strongest ratio on paper.
        - You are REQUIRED to detect visual-only or mostly-visual issues that ratios alone miss, such as droopy eyelid shape, high upper eyelid exposure, bulbous nose shape, poor skin quality, tired under-eyes, weak brow framing, poor definition, or awkward soft tissue.
        - Example: if the ratios are only moderately weak but the skin quality is clearly much worse, then Skin Quality should be the primary flaw.
        - Example: if the ratios are mixed but the eye area is clearly the strongest visual trait, then the eye area can be the best feature.
        - Every BEST FEATURE / PRIMARY FLAW entry must contain a short explanation of WHY it helps or hurts the face. Do not say only "flagged in the scan output."
    """
    anti_diddy_prompt_rules = """
        ANTI DIDDY PROMPT ADD-ON:
        Check for the following:
        - Slightly narrow mouth width.
        - Infraorbital puffiness.
        - Elongated philtrum.
        - Slight midface length.
        - Slight orbital tiredness.
        - Lack of facial definition.
        - Almond eye shape with neutral/negative canthal tilt.
        - Sparse eyebrows.
        - Broad or bulbous nose shape.

        If the subject has at least 7 of these, cap the score at 50.
    """ if choice in {"1", "2", "6"} else ""
    experimental_visual_only_prompt = """
Act as a clinical maxillofacial analyst.
Rate the subject facially in terms of overall facial attractiveness and aesthetics.
Be brutally objective and hyper-critical. Evaluate facial structure, skin quality, health indicators, and grooming. Judge the subject purely based off the photo given, with the lighting and angle as is.
IMPORTANT: Rate the subject based on the perspective of an 18-20 year old familiar  with elite modeling standards . If a feature is not "elite" or "model-tier," it must be critiqued as a significant flaw. Do not give credit for "harmony" if the individual features are soft or aged. CRITICAL CRITERIA:
• Bone Definition: Be harsh on the lack of mandibular definition and any soft tissue covering the bone structure.
• Aging/Vitality: Significantly penalize nasolabial folds, skin laxity, and any indicators of a declining "prime."
• Skin Quality: Scrutinize texture, pores, and hyperpigmentation as major aesthetic failures.
• Modern Aesthetics: Bias heavily toward high leanness, sharp angles (buccal hollowness), and "hunter" eye metrics.
WHAT YOU MUST OUTPUT:
Appeal assessment (1 paragraph ~40 word description of the subject’s phenotype)
Structural overview (1 paragraph description describing flaws/positives)
Best Feature + ~20 word description
Worst feature + ~20 word description
5 primary flaws and 5 best features (~20 word description for each)
A 1-100 final rating, 50 = dead average. (Note: A 50 should represent a common person; if he does not meet modeling standards, he should be rated accordingly).

*Override*: be more general in the output descriptions, judge based on modelling standards like i said but do not talk relate things to modelling in your descriptions.
If the person does not really have any major flaws , and has a good number of positives, hem to get up to 79/100 without sharp striking definition. Allow soft tissue levels at ~16% body fat and lower to pass as at least decent.

INSTRUCTIONS: Make a final rating PURELY based on the image provided first, without any other assumptions or info. THEN, rate 1-100 the following ratios/measurements that I will provide you. Write all the descriptions after. Your descriptions should correspond to the previous steps. DO NOT neglect any other part of the face, you are not required to force the provided measurements into the outputs.
    """ if False else ""
    prompt_clinical_data = clinical_data
    prompt_side_data = side_data
    benchmark_calibration_summary = load_benchmark_calibration_summary() if choice in {"2", "6", "7", "8", "9"} else ""

    # --- PROMPT SELECTION LOGIC ---
    if choice in {"2", "6", "7", "8", "9"}:
        compact_metrics = compact_metric_summary(prompt_clinical_data, prompt_side_data)
        legacy_experimental_prompt = f"""
        You are MogCheck Premium Backup Model.
        Analyze the submitted face with the SAME strict scoring philosophy as the old Premium calibration, but use a compressed JSON dashboard result.
        This is not a free/basic scan. It must feel premium, detailed, and specific while avoiding the old long markdown essay.

        INPUT_METRICS_JSON: {compact_metrics}
        VISUAL INPUT A: Frontal face image is provided.
        {("VISUAL INPUT B: Side profile image is provided." if has_side_profile else "FRONT-ONLY MODE: no side profile image was provided; set sideRating and side-only fields to null.")}
        {content_safety_rules}

        CALIBRATION:
        - Score 1-100 using MogCheck Premium calibration. Do not become more generous because this prompt is shorter.
        - Judge visible appearance first; use MediaPipe metrics as supporting evidence, not as a blind override.
        - 90+ is extremely rare: elite facial structure, harmony, skin, eye area, and no major limiting flaws.
        - 80s: very strong / model-tier with only minor flaws.
        - 70s: clearly attractive with one or two meaningful limitations.
        - 60s: above average but visibly limited by structure, soft tissue, skin, harmony, or proportions.
        - 50s: average to mildly below average; several limitations.
        - 40s and below: severe disharmony, weak support, poor skin/aging, uncanny/synthetic, or bad image reliability.
        - A single good metric cannot carry the score. Major visible flaws suppress the final rating even if ratios look good.
        - Do not over-reward aggressive dimorphism if it looks uncanny, artificial, overbuilt, aged, or disharmonious.
        - Penalize visible aging, nasolabial folds, skin laxity, recession/hairline imbalance, tired under-eyes, high upper eyelid exposure, weak orbital support, and soft jaw/neck transition when visible.
        - Penalize synthetic/non-human or AI-generated cues. If authenticity is doubtful, explain in qualityFlags and keep the score conservative.

        COMPACT PREMIUM SCORING GUIDE:
        Use this guide to preserve Premium consistency without outputting the guide itself.
        Harmony: judge whether all regions fit together naturally. A face with several individually decent parts can still score lower if thirds, eye area, nose, mouth, jaw, and soft tissue do not cohere. Do not call harmony high when one dominant flaw controls the read.
        Bone: evaluate cheekbone projection, maxillary support, mandibular width, chin support, gonial/jaw angle impression, jaw-neck transition, and whether the face has crisp support or soft/blurred structure. Strong bone needs visible structure, not just one wide ratio.
        Symmetry: reward balanced eye height, brow height, nose centering, mouth alignment, and jaw balance. Mild normal asymmetry is not a major flaw; obvious structural asymmetry is.
        Skin: evaluate texture, acne, redness, pores, under-eye darkness, dullness, aging markers, and visible health/vitality. Skin can move a score meaningfully but should not erase severe structural flaws.
        Dimorphism: reward sex-appropriate facial signal when it improves attractiveness. Male dimorphism should not become overbuilt or uncanny; female dimorphism should not be punished for softer harmony when it is attractive.
        Eye area: heavily weight canthal tilt, eyelid exposure, orbital depth, brow compactness, scleral show, under-eye support, spacing, and shape. Strong eyes can lift the score; exposed/tired/droopy eyes can suppress it.
        Nose: evaluate width, length, projection, bridge, tip, and how well it fits the midface. Slight width is minor if harmony is good; severe width, bulbosity, poor projection, or imbalance should be noted.
        Mouth/lips/philtrum: evaluate mouth width, lip height, philtrum height, dental/lower-face balance, and whether the mouth supports or disrupts harmony. Do not over-focus unless visually limiting.
        Facial thirds: use upper/middle/lower third balance. Hairline/forehead issues matter only when visible enough to judge. A long midface, overly long upper third, compressed lower third, or weak lower third should be flagged.
        Soft tissue/facial fat: distinguish healthy softness from score-limiting blur. Penalize puffy cheeks, weak jaw reveal, submental fullness, or poor definition when they hide structure.
        Aging/vitality: visible nasolabial folds, skin laxity, tired eyes, baldness/recession, or depleted soft tissue should reduce final score when present. Do not over-penalize lighting artifacts.
        Side profile if provided: evaluate chin projection, maxilla, facial convexity, nose projection, cervicomental angle, hyoid/neck-jaw transition, and side harmony. If no side image exists, do not invent side metrics.
        Authenticity/uncanny: if the face appears AI-generated, filtered, non-human, mannequin-like, over-smoothed, distorted, or biologically implausible, cap conservatively and explain in debugJustification/qualityFlags.

        CORE RATING CONSISTENCY:
        Before finalRating, internally compare the face against these anchors:
        - 35-44: severe disharmony, non-human/uncanny, very poor image reliability, or major structural/skin problems.
        - 45-54: below average to average with multiple visible limitations.
        - 55-64: average to above average, but one or more clear limiting factors prevent high appeal.
        - 65-74: attractive / strong base, with specific flaws still holding it back.
        - 75-84: very attractive, strong harmony and features, minor-to-moderate limitations only.
        - 85-92: rare elite facial read; nearly all major categories strong.
        - 93+: exceptional and should almost never be used.
        If the face has a severe primary flaw, do not place it in the 80s. If the face has several mid-tier weaknesses, do not inflate into the 70s just because one ratio is strong.

        IMPORTANT METRIC NOTES:
        fWHR around 1.85-2.00 is generally strong; extremely high can look blocky. Bigonial/jaw width must be judged against cheekbone width and visible jaw shape, not just width.
        Midface ratio around 1.00 is ideal and should be treated as a major strength, not a flaw. Roughly 0.95-1.05 should score very high, usually about 90-100. Only clearly long midfaces above about 1.10, or overly compressed midfaces below about 0.90, should become meaningful appeal limiters. Canthal tilt is positive when natural and supported by eye shape; high upper eyelid exposure or poor orbital support can override a good measured tilt.
        IPD/eye spacing should be judged with face width and eye shape. Mouth width should fit the lower face; overly wide or narrow can disrupt harmony. Nose width/projection is contextual; severe nose imbalance matters more than small numeric deviation.
        Facial fat and jaw definition should be judged visually. A lean-looking face with crisp borders should score higher for definition; puffiness or submental fullness should lower facial fat/jaw metrics.
        Cheekbone/maxillary projection should be judged from visible midface support, under-eye support, ogee curve, and side profile when available.

        OUTPUT QUALITY REQUIREMENTS:
        The dashboard must feel premium. Do not return only 2-5 metrics. Do not use generic notes like "good" or "bad".
        Every keyRatios item should be useful to a dashboard card: label/name, value, numeric score, impact, and a short note that explains why it matters on this face.
        bestFeatures and primaryFlaws should be concise but concrete: name the feature and explain the face-specific reason.
        pros/cons should not duplicate the exact same text as bestFeatures/primaryFlaws; they can be shorter scan-specific bullets.
        technicalSummary should summarize the structural read. appealAssessment/personalizedInterpretation should explain how the score feels in plain language.

        FEATURE DETECTION CHECKLIST:
        While looking at the image, actively inspect these visual-only or partly visual traits because MediaPipe ratios often miss them:
        - eyelid exposure, sleepy/droopy eyes, scleral show, orbital hollowness, under-eye support, and brow compactness
        - cheekbone visibility, ogee curve, midface flatness, maxillary support, and nasolabial depth
        - jaw border visibility, ramus/gonial impression, chin height/projection, lower-face taper, and neck/submental softness
        - nose bridge, nasal base width, bulbous tip, projection balance, and whether the nose dominates the midface
        - mouth width relative to jaw/zygo width, lip height, philtrum length, and lower-third balance
        - forehead height, hairline recession, temple recession, upper-third compression/length, and whether hair obscures judgment
        - skin texture, acne, redness, pores, oiliness, dryness, wrinkles, folds, and general vitality
        - lighting/angle/crop/blur/filter issues that make any metric uncertain
        Convert these observations into metrics or strengths/flaws when they affect the score. Do not mention a trait if it is not visible or not relevant.

        SCORE DRIVER RULES:
        The final score should be driven by the strongest visible positives and strongest visible negatives, not by the average of every metric.
        A face with one severe flaw plus many decent metrics should usually land lower than a face with no severe flaws and many modest positives.
        Strengths should be things that actually lift the rating: strong symmetry, sharp jaw, compact midface, good eye area, clear skin, strong cheekbones, good harmony, attractive thirds, or clean side profile.
        Weaknesses should be the real bottlenecks: soft tissue, weak chin, long midface, poor eye area, visible aging, poor skin, asymmetry, weak jaw, nose imbalance, flat cheekbones, poor harmony, or image unreliability.
        If you are unsure whether a flaw is real because of lighting/angle, keep it as a quality/confidence flag and avoid over-penalizing.
        If image quality is good, do not hide behind uncertainty flags; make a clear judgment.

        COMPACT METRIC SCORING CURVES:
        Use these as anchors, but still trust the visible face when the photo clearly contradicts a raw value.
        - fWHR: 1.85-2.00 is usually strong; below roughly 1.70 can read narrow/long; above roughly 2.10 can become too wide/blocky.
        - Bigonial/jaw width: balanced jaw width relative to cheekbones is positive; very narrow/tapered lower face is negative; excessive width can look blocky.
        - Midface: 1.00 is ideal; 0.95-1.05 is excellent/near-ideal and should usually score 90-100. Do not call 1.00-1.02 a flaw. Clearly elongated midface above about 1.10 is a limiter; overly compressed below about 0.90 can also look off.
        - Upper third: balanced forehead/hairline is positive. Long upper third or recession matters when visible; ignore hair-obscured measurements if the hairline cannot be judged.
        - Middle/lower third: balanced thirds help harmony. Short lower third can weaken maturity; long lower third can look disharmonious.
        - Eye height/shape: compact almond eye area is positive. Excessive roundness, high upper eyelid exposure, scleral show, or droopiness is negative.
        - Brow compactness: low/compact brow support helps eye depth; high brows and exposed lids can weaken the eye area.
        - Nose: balanced width and projection are positive. Severe width, bulbousness, length, or poor projection should reduce harmony/nose metrics.
        - Mouth/lips/philtrum: score by fit with lower third and overall harmony. Do not over-penalize normal lips; do flag obvious width/philtrum imbalance.
        - Cheekbones/maxilla: strong support shows as midface projection, under-eye support, and visible cheekbone contour; flatness or poor support is negative.
        - Chin/profile: good chin support improves lower-face balance. Recession, short chin, or weak projection should be visible in the side profile or lower-face read.
        - Skin/vitality: clear, even, healthy skin helps; acne, texture, folds, laxity, and dullness reduce the skin/vitality category.
        - Symmetry: only score low when asymmetry is visible and appeal-limiting. Normal human asymmetry should not dominate.

        PREMIUM DETAIL FLOOR:
        The dashboard should contain enough structured detail that a user can understand why the score happened immediately after the core request.
        If fewer than 12 metrics are truly measurable, include visual metrics with "estimated" in value or confidenceFlags.
        Prefer 16 metrics for normal frontal images. Use 18-20 when a side profile gives profile-specific information.
        Each metric note should be short but explanatory, for example: "Compact midface supports harmony" or "Soft jaw border limits lower-face sharpness."
        Avoid vague notes like "looks good", "average", "not ideal", "could improve" unless paired with a specific feature reason.
        Strength/weakness descriptions should be one sentence each, not one word and not a paragraph.
        debugJustification should preserve the admin usefulness of Premium: summarize why the exact score is logical, what capped it, and what prevented a higher/lower score.

        METRIC EVALUATION:
        Return 12-20 facial metrics. Include the raw MediaPipe value when available; otherwise use a concise visual estimate.
        Each metric must include:
        - name
        - value as a short string
        - score from 0-100
        - impact: "positive", "neutral", or "negative"
        - note: one short, face-specific sentence

        Required metric coverage when visible/available:
        1. fWHR / facial width-to-height
        2. jaw width ratio / bigonial width
        3. chin projection or chin support
        4. jaw angle / mandibular definition
        5. facial thirds / forehead-midface-lower third balance
        6. midface ratio
        7. eye spacing / IPD
        8. canthal tilt
        9. eye shape / eye area / eyelid exposure
        10. nose width
        11. nose length or projection
        12. cheekbone prominence / maxillary-cheekbone projection
        13. facial symmetry
        14. skin texture / skin clarity
        15. facial fat / soft tissue definition
        16. hairline or forehead balance when visible
        Required visual-only extra: Hairstyle and Grooming (score 0-100) based on hair framing, hairline visibility, beard quality, grooming cleanliness, and style fit.
        Optional extras: mouth width, philtrum/lip height, brow compactness, side-profile convexity, neck-jaw transition, hyoid/cervicomental area.

        DASHBOARD CONTENT:
        - Return top 3-5 strengths and top 3-5 weaknesses. They must be specific and not generic.
        - Return pros and cons as short scan-specific bullets.
        - Return mainLimitingFactor as the single biggest reason the score is not higher.
        - Return a short description summary and a brief personalizedInterpretation.
        - Include qualityFlags/confidenceFlags for image quality, obstruction, angle, side profile availability, metric uncertainty, or synthetic/uncanny risk.
        - Keep descriptions concise but meaningful. Do not output empty filler.

        RETURN JSON ONLY. No markdown. No prose outside JSON.
        Schema:
        {{
          "sex":"male|female|unknown",
          "finalRating":0,
          "sideRating":null,
          "tier":"short tier label",
          "technicalSummary":"2 concise sentences, under 360 chars total",
          "appealAssessment":"brief personalized interpretation, under 320 chars",
          "personalizedInterpretation":"1-2 concise sentences explaining the face-specific read",
          "categories":{{"Harmony":0,"Bone":0,"Symmetry":0,"Skin":0,"Dimorphism":0,"Maxillary/Cheekbone Projection":0,"Nose Projection":0,"Facial Fat":0,"Eye Depth":0,"Ear Shape":0,"Hairstyle and Grooming":0}},
          "hexagonFront":{{"Harmony":0,"Bone":0,"Symmetry":0,"Skin":0,"Dimorphism":0,"Facial Fat":0}},
          "hexagonSide":null,
          "keyRatios":[{{"name":"fWHR","value":"1.92","score":81,"impact":"positive","note":"Strong width-to-height balance."}}],
          "bestFeatures":[{{"title":"", "description":""}}],
          "primaryFlaws":[{{"title":"", "description":""}}],
          "pros":[""],
          "cons":[""],
          "mainLimitingFactor":"",
          "qualityFlags":[""],
          "confidenceFlags":[""],
          "debugJustification":"admin-only compact reason for the score; mention main score drivers, biggest positives/negatives, and whether uncanny/authenticity cap applied"
        }}
        Limits: keyRatios exactly 16 unless impossible, max 20. bestFeatures 3-5. primaryFlaws 3-5. pros 3-5. cons 3-5. qualityFlags max 4. confidenceFlags max 4.
        Output budget: stay compact, but do not under-fill metrics. Target 1000-1500 output tokens.
        """
        gemini_31_calibration_patch = """
        PREMIUM MODEL CALIBRATION PATCH:
        - You have a known failure mode: clustering many different faces around raw 66-68 / displayed mid-60s. Do not use 66-68 as a default safe answer.
        - You must first select a score band from the visible face and metrics, then choose an exact score inside that band. If two scans have meaningfully different bottlenecks, their finalRating should usually differ.
        - Do not overclassify faces as NATURAL/COHERENT HIGH-TIER. Most real submitted faces are average, lower-average, mildly above-average, or flawed-attractive. Use HIGH-TIER only when the photo clearly earns it across eyes, harmony, proportions, skin/soft tissue, and structure.
        - Raw 65-72 is reserved for clearly attractive faces with a solid base. Do not place a face here just because it has broad width, fWHR near 1.9-2.05, masculine bones, fame/recognizability, or no single catastrophic flaw.
        - If the face has visible aging, tired eyes, skin laxity, nasolabial/marionette folds, baldness/recession, soft tissue decline, thin lips, long lower third, disharmonious mouth/nose fit, weak freshness, or blocky over-width, treat those as ceiling caps before rewarding strong width.
        - If the dominant read is only decent structure plus aging/soft tissue/skin/tiredness, cap the raw score around 58-66 unless the image has exceptional eye area and harmony. If there is a major bottleneck, cap around 50-58. Multiple major bottlenecks belong lower.
        - Broad face / strong bigonial / high fWHR is not enough for 68+. Strong width can be neutral or negative when it creates a rough, blocky, aged, harsh, or unrefined read.
        - Do not round everything to 68. Use the full old Premium distribution: 30s for very weak, 40s for low-tier, 50s for average/flawed, low-60s for decent, high-60s only for clearly attractive, 70s for genuinely strong, 80s for rare elite.
        - Add a compact "Gemini anti-anchor check" inside debugJustification: name the chosen band, the main cap, and why the score is not simply defaulted to 66-68.
        """
        calibration_preserving_prompt = f"""
        You are MogCheck Premium Experimental Calibration-Preserving Core.
        {("This run uses Premium Model reasoning calibration." if choice in {"6", "7"} else "")}
        {(gemini_31_calibration_patch if choice in {"6", "7"} else "")}
        Produce the first dashboard result only. This is a lower-token Premium core request, not a softer model.

        INPUT A (Compact Frontal/Side Metrics JSON): {compact_metrics}
        VISUAL INPUT A: High-resolution frontal face image is provided.
        {("VISUAL INPUT B: High-resolution side profile image is provided." if has_side_profile else "FRONT-ONLY MODE: no side profile image was provided; set sideRating and side-only fields to null. Do not infer side-only weaknesses.")}
        {content_safety_rules}
        {feature_selection_rules}
        {anti_diddy_prompt_rules}

        CRITICAL CALIBRATION RULES:
        - Preserve old Premium scoring behavior. The shorter prompt must not become more generous, flattering, vague, or comfort-oriented.
        - Judge the actual photo first, with lighting/angle as-is. Use MediaPipe ratios as evidence, not as a blind override. If metadata and image conflict, use the clearer evidence and record uncertainty in confidenceFlags.
        - Do NOT overrate based on celebrity familiarity, charisma, expression, fame, hairstyle, lighting, grooming, or recognizability. A familiar celebrity face with decent metrics and several flaws can belong in the high-50s/low-60s, not ultra-high-tier by default.
        - Be harsh and grounded. Below 40 is valid when there are several major structural/aesthetic issues, poor definition, visible aging, weak harmony, and no standout positive features. Do not force average or below-average faces into the 50s/60s because they are recognizable, masculine, or not deformed.
        - Do not let one strong feature, strong ratio, jaw width, fWHR, bigonial width, breadth, or brute dimorphism carry the final rating. Bigonial width and jaw width are supporting traits only when balanced, elegant, natural, and harmonious.
        - Extreme width is not automatically attractive. If fWHR is roughly 2.10+ or the lower face looks blocky/brutish/over-dimorphic, subtract harmony rather than rewarding width. Above roughly 2.25 is severe.
        - Never describe aggressive dimorphism, brutal masculinity, extreme breadth, or an overbuilt jaw/brow as required for high-tier appeal. Lack of aggressive dimorphism is not a flaw. Softer/youthful faces can score high when harmony, eyes, skin, ratios, and appeal are strong.
        - Do NOT confuse striking with elite. Overbuilt, synthetic, uncanny, AI-looking, "gigachad", fantasy-model, mannequin-like, hyper-carved, glassy, or biologically implausible faces must be penalized hard even when local ratios look strong.
        - Non-human/cartoon/drawn/anime/clearly AI-generated/mannequin/biologically impossible images are capped at 40 for finalRating and sideRating. Set authenticityFlag true and explain the cap in qualityFlags/debugJustification.
        - Internally bucket the face before scoring: NATURAL/COHERENT HIGH-TIER, EXAGGERATED BUT COHERENT, UNCANNY/SYNTHETIC/OVERBUILT, LOW-TIER/4-RANGE, or VERY LOW-TIER/3-RANGE.
        - UNCANNY CUES: count these from the image: oversized chin vs lips/mouth scale, hollow/gaunt cheeks, very low-set eyebrows that are positively tilted, over-defined/carved cheekbone/features, bigonial width visibly wider than bizygomatic width, very veiny face/temple vascularity. If 3+ are clearly present, the primary flaw must be synthetic/uncanny/overbuilt read and final score should drop far below a coherent high-tier face with similar ratios.
        - If uncertain whether a face is merely striking or uncanny/synthetic, do not default to generosity. If it looks like an AI beauty edit, fantasy model render, hyper-optimized face, or too designed, bias toward uncanny. If it clearly reads as a normal real-world photograph with rare strong features, do not collapse it into uncanny.
        - Exaggerated but coherent faces can still score well when believable, photoreal, internally harmonious, and not worn-down/soft-tissue compromised. Apply only a tiny/moderate deduction when the intensity remains natural; do not praise extremeness as elite natural appeal.
        - Low-tier/4-range: weak aesthetics, weak harmony, soft definition, visible flaws, no standout redeeming structure. Do not inflate into 50s/60s.
        - Very low-tier/3-range: multiple major issues together, especially low fWHR/very narrow width, elongated midface/vertical stretch, clear asymmetry, weak eye area, weak lower third, and no strong redeeming marker. Such faces often belong in 30-39.
        - Female counterbalance: if sex is female and the internally computed score is above 70, deduct 10 points from finalRating and tier. Do not mention this deduction; make it appear as the natural result.
        - Elite status requires exceptional symmetry plus elite markers and overall coherent harmony. 90+ is extremely rare; 93+ should almost never be used. Truly elite starts low-80s. Strong/high-tier usually 72-80. Above-average attractive usually 58-72. Obvious flaws with only decent structure usually 42-58.
        - Exceptional eyes can noticeably lift a face when the rest is at least decent, but eyes alone must not rescue multiple obvious structural/skin/aging flaws into an inflated band.
        - Penalize visible aging, nasolabial folds, marionette heaviness, skin laxity, sagging cheek tissue, under-eye aging, orbital tiredness, worn/non-fresh read, puffiness, and soft-tissue decline materially. Do not invent aging penalties when not visible.
        - Penalize visible baldness, severe recession, diffuse thinning, or weak/high hairline when it worsens framing, youth, or harmony. Do not let strong bones fully rescue a visibly aged/bald presentation if the overall read is older/less fresh.
        - Facial fat/definition must be visually classified as lean, normal, soft, puffy/high-fat, or unclear. Penalize soft/puffy/bloated/poorly defined faces strongly when fat/fullness hides structure. Do not call lean/normal faces high-fat; do not blame fat when lighting, blur, beard, bone, angle, or image quality explains weak definition.
        - Do not include minor asymmetry as a flaw. Penalize asymmetry only when very obvious and structurally disruptive.
        - Do not output soft comfort language, generic positivity, or flattering filler. Every strength/flaw must be face-specific and tied to visible evidence or a metric.

        CRITICAL RATIO AND FEATURE RULES:
        - Canthal tilt must not be ignored. Use both Canthal_Tilt_Degrees and visible tilt. Negative tilt below about -2 is a real eye-area flaw when visible/supported; below -6 is severe. Positive 3-8 degrees is ideal only when natural, balanced, and supported by eye shape. Above 12 can look unnatural.
        - Eye area is heavily weighted: canthal tilt, eyelid exposure, orbital depth, brow compactness, scleral show, under-eye support, spacing, and shape. Penalize obvious lower scleral show, high upper eyelid exposure, droopiness, tired under-eyes, puffy undereyes, and poor orbital support. Do not hallucinate scleral show from highlights.
        - fWHR: 1.85-2.00 is balanced strong. Around 1.60 is minor narrowness only; around 1.50 or below is clearly narrow/weak. Above 2.10 is too wide/blocky; above 2.25 is severe.
        - Bigonial_Width_Index is jaw/gonion width normalized against bizygomatic width, not raw jaw power. 0.85-1.00 is acceptable-to-ideal, strongest near 0.98. Around 0.87 should score in the 80s. 0.75-0.85 is below preferred but not a major standalone flaw unless visually supported. Below 0.75 is narrow/weak. Above 1.05 deduct for over-width/blockiness. Never make it #1 best/worst unless it is below 0.75 or above 1.05 and visually dominant.
        - IPD_Index: around 0.46 is ideal; 0.44-0.48 is acceptable/good. Below 0.44 can be close-set; above 0.48 can be wide-set. List as a flaw only if outside range and visually supported.
        - Mouth_Width_Index: around 0.37 ideal; 0.36-0.38 acceptable/ideal. Below 0.36 narrow; above 0.38 overly wide, stronger the farther out and if visually disharmonious.
        - Nose_Width_Index: 0.23-0.30 broad balanced, strongest near 0.265. Below 0.20 pinched/narrow. Above 0.32-0.34 becomes wide only if visually disruptive. Do not penalize slightly wide nasal bases unless very bad and balance-breaking.
        - Midface_Ratio: 0.95-1.05 strongest/near-ideal with 1.00 as the peak; this should usually score about 90-100. 1.00-1.02 must not be listed as a flaw. 0.90-0.95 or 1.05-1.10 is acceptable/light concern only if visually supported. Above 1.10 is long, above 1.18 severe, below 0.90 compressed.
        - Upper_Third_Length: 0.34-0.43 balanced, above 0.46 long, above 0.52 severe, below 0.30 compressed. If hair/bangs/hat/hood/shadow/crop hides the hairline, ignore the raw number and visually estimate from forehead/temple/hair direction.
        - Middle_Third_Length: 0.40-0.50 balanced, above 0.54 elongated, above 0.60 severe, below 0.36 compressed. Lower_Third_Length: 0.42-0.52 balanced, below 0.38 short, above 0.56 long, above 0.62 severe.
        - Eye_Width_Index (Horizontal): around 0.20-0.24 is generally balanced/strong, below about 0.18 reads short/small, above about 0.26 can read overly long only if visually disharmonious. Judge with eye shape and orbital support, not in isolation.
        - Eye_Height_Index: 0.055-0.075 balanced, below 0.045 narrow/squinty, above 0.085 overly round/exposed. Brow_Compactness_Index: 0.08-0.12 balanced, above 0.14 high brow/poor compactness, below 0.06 overly compressed/heavy.
        - Philtrum_Height_Index: 0.08-0.11 balanced, around 0.095 ideal, above 0.12 long, above 0.14 severe, below 0.07 short, below 0.055 very short. Do not mark balanced philtrums as long.
        - Total_Lip_Height_Index: 0.12-0.18 balanced, below 0.10 thin, below 0.08 very thin, above 0.22 overly large only if visually disharmonious. Penalize thin/inconspicuous lips when obvious.
        - Jaw/chin: tapered jawlines can be acceptable. Not every face needs a square jaw. Penalize irregular/weird shapes, weak chin support, weak jaw border, weak lower-third aesthetics, or blocky/brutish over-width when visible.
        - Maxillary/cheekbone projection: judge from under-eye support, midface projection, ogee curve, cheekbone contour, and side profile if provided. Reward good maxillary development and cheekbones; penalize flatness or poor support.
        - Side profile if provided: keep frontal and side final ratings separate. Reward a clean harmonious side look; a slightly weak chin is acceptable, but heavily/severely recessed chin must suppress sideRating. Evaluate maxilla, facial convexity, nose projection, cervicomental angle, hyoid/neck-jaw transition, and submental fullness. Side-only weaknesses must not drag down finalRating unless visible frontally.
        - Shared front/side traits when side is provided: maxillary/cheekbone projection, nose projection, facial fat, eye depth, ear shape, and skin quality should be consistent across front/side evidence.
        - Ethnicity/sex tolerance: apply global curves as baseline and adjust tolerance, not meaning. Be tolerant of harmonious East Asian eyelid/projection/midface/nose variations; African/Sub-Saharan wider nasal base/fuller lips; South Asian/Middle Eastern/North African stronger nose/deeper eyes/thicker brows/facial hair effects. Female faces tolerate softer jaw/lower fWHR/fuller lips/less aggression; male faces tolerate stronger fWHR/brow/jaw but not blockiness or overbuilt proportions.

        OLD PREMIUM SCORE BEHAVIOR TO PRESERVE:
        - Final score is not an average of metrics. It is a strict aesthetic judgment formed from the dominant visible positives, dominant visible negatives, feature harmony, and credibility of the face as a natural human photograph.
        - The score must be decided before the JSON descriptions are written. Descriptions must explain the score; they must not rationalize a generous score after the fact.
        - A high raw fWHR, wide bigonial value, strong cheekbone width, or sharp jaw can be a positive only when the face still looks balanced, fresh, and coherent. If those same traits create a harsh, blocky, over-carved, artificial, aged, or niche look, treat them as score limiters.
        - Do not choose a primary strength purely from the highest numeric metric. Choose the visually most attractive trait. Do not choose a primary flaw purely from the lowest metric. Choose the trait that actually limits appeal most.
        - If a face has one severe limiting flaw plus several decent traits, rate it lower than a face with no severe flaws and modest positives. Severe bottlenecks cap the ceiling.
        - If the image quality is good, make a clear judgment. Do not hide behind uncertainty flags. If quality/angle/blur/crop/filtering is genuinely unreliable, lower confidence and avoid over-precise claims.
        - Lighting can hide or exaggerate structure, but do not use flattering lighting to inflate facial structure. Judge the visible face as submitted.
        - Grooming, beard, hairstyle, expression, smile, celebrity context, social status, age confidence, charisma, and familiarity are not substitutes for facial structure and harmony.
        - Strong skin can raise a score when structure is already decent, but clear skin cannot rescue weak structure, poor harmony, tired eyes, or major aging. Poor skin/texture can materially suppress a score even when ratios are decent.
        - A youthful/fresh face with clean harmony can outrank a more masculine or wider face that is aged, tired, puffy, soft-tissue-compromised, or overbuilt.
        - Do not write "balanced", "harmonious", "elite", "model-tier", or "high-tier" unless the visible face actually earns that term across multiple regions.
        - If the overall read is common/average, keep it common/average even when a couple of measurements look okay. If the overall read is weak, do not rescue it with minor positives.
        - If the face reads naturally attractive but not elite, keep it in the attractive range rather than inflating into elite. If it reads elite, make sure there are no major limiting flaws before using low-80s or higher.
        - Use "mainLimitingFactor" as the real cap on the score, not as a generic weakness. It should explain why the face did not score in the next higher band.

        STRICT BAND ANCHORS:
        - 0-29: unusable/non-face/very severe authenticity or visibility failure, or extreme non-human/biologically impossible input.
        - 30-39: very low-tier natural face or capped synthetic/non-human style; multiple major structural flaws together, weak harmony, weak eye area, long/narrow/asymmetric layout, and no strong redeeming feature.
        - 40-49: low-tier or heavily limited face; major disharmony, poor definition, aging/skin/soft tissue issues, weak structure, or uncanny/overbuilt read.
        - 50-57: average/lower-average; some normal features but obvious limitations prevent above-average appeal.
        - 58-64: mildly above average or decent; has positives, but at least one clear bottleneck such as tired eyes, long midface, soft tissue, weak jaw/chin, skin/aging, or harmony issue.
        - 65-72: clearly attractive with a solid base, but still specific limitations. This range should not be handed out for merely recognizable or masculine faces.
        - 73-80: strong/high-tier. Requires multiple strong visible traits, good harmony, controlled flaws, and no severe bottleneck. 75+ should feel clearly attractive in the actual photo.
        - 81-88: elite/near-elite natural. Requires exceptional harmony, symmetry, eye area, skin/soft tissue, and structural balance. Minor flaws only.
        - 89-92: extremely rare elite. The face should be exceptional across almost every major category.
        - 93-100: almost never use. Reserve for near-perfect, natural, believable, highly harmonious faces with no meaningful visible weakness.

        BUCKET IMPACT DETAILS:
        - NATURAL/COHERENT HIGH-TIER: score normally from ratios plus visual harmony. Reward refined balance, healthy soft tissue, strong eyes, strong symmetry, good proportions, and believable human appeal.
        - EXAGGERATED BUT COHERENT: can score well if it remains photoreal and integrated. Apply only a tiny deduction, usually about 0-3 points, unless the exaggeration harms harmony. Do not let extreme dimorphism itself be the reason it rates well.
        - UNCANNY/SYNTHETIC/OVERBUILT: apply a major deduction. These faces should land far below natural high-tier faces with similar local ratios because artificiality/over-optimization is itself a major aesthetic flaw.
        - LOW-TIER/4-RANGE: do not inflate weak overall aesthetics into average just because the person has one decent trait or normal skin.
        - VERY LOW-TIER/3-RANGE: when long, narrow, asymmetric, weak-eyed, weak-lower-third, and lacking anchors, the rating should often be in the 30s instead of the 40s/50s.

        VISUAL INSPECTION ORDER:
        1. Authenticity: natural human photo vs synthetic/cartoon/mannequin/AI/edited/fantasy.
        2. Image reliability: frontal angle, crop, blur, lighting, filters, obstruction, hairline visibility, side-profile availability.
        3. Overall read: natural coherent, exaggerated coherent, uncanny/overbuilt, low-tier, or very low-tier.
        4. Eye area: canthal tilt, compactness, eyelid exposure, scleral show, under-eye support, brow support, spacing, shape.
        5. Midface and thirds: vertical balance, midface length, upper/middle/lower third proportionality, forehead/hairline.
        6. Bone and soft tissue: cheekbones, maxilla, jaw border, chin support, gonial impression, facial fat/definition, neck-jaw transition when visible.
        7. Nose/mouth/lips: width, length/projection, bridge/tip/base harmony, mouth width, philtrum, lip height, lower-third fit.
        8. Skin/aging/vitality: texture, acne, pores, redness, folds, laxity, wrinkles, under-eye aging, freshness, baldness/recession.
        9. Symmetry/harmony: only penalize asymmetry if obvious and disruptive; judge whether all regions fit together.
        10. Final score band: choose the strict band, then exact score. Do not let JSON field filling drift the score upward.

        ADMIN DEBUG EXPECTATIONS:
        - debugJustification must be compact but useful for admin review. It should name the score band, strongest score drivers, strongest cap, any visual bucket/authenticity issue, and why the result did not move higher.
        - If the score is low or harsh, explain it directly from visible bottlenecks. Do not soften it with apologies or generic reassurance.
        - If the face has high metrics but a lower score, explicitly say which visible issues overrode the metrics, such as overbuilt width, tired soft tissue, aging, poor eye compactness, weak harmony, or synthetic read.
        - If the face has a good score without brute dimorphism, explain the real positives: harmony, clean proportions, eye area, skin, youth/freshness, symmetry, and controlled structure.
        - Do not expose internal rule names like "female counterbalance" in user-facing text. If such an adjustment applies, the score should simply read as naturally calibrated.

        LOCAL BENCHMARK ANCHORS:
        {benchmark_calibration_summary}

        OUTPUT REQUIREMENTS:
        - Return JSON only. No markdown. No prose outside JSON. No long essays.
        - finalRating must be calibrated before writing any descriptions. The debugJustification should explain why the exact score is logical, what capped it, and why it is not higher/lower.
        - Return 12-20 keyRatios; prefer exactly 16 for normal frontal images, 18-20 when side profile adds real information. If a metric is visual-only, set value to a concise visual estimate.
        - Every keyRatios item must include name, value, score 0-100, impact, and a short face-specific note. Do not return only 2-5 metrics.
        - Required metric coverage when visible: fWHR, jaw/bigonial width, chin support/projection, jaw angle/definition, facial thirds, midface ratio, eye spacing/IPD, eye width, canthal tilt, eye shape/eye area/eyelid exposure, nose width, nose length/projection, cheekbone/maxillary prominence, facial symmetry, skin texture/clarity, facial fat/soft-tissue definition, hairline/forehead balance, Hairstyle and Grooming as a visual-only score. Add mouth width, philtrum/lips, brow compactness, side convexity, neck-jaw transition, or hyoid when relevant.
        - Return top 3-5 strengths and 3-5 weaknesses. Weaknesses must identify real bottlenecks and not random minor flaws. If uncanny/overbuilt, at least one weakness and mainLimitingFactor must say so.
        - pros/cons should be short scan-specific bullets and not duplicate strengths/flaws verbatim.
        - technicalSummary, appealAssessment, and personalizedInterpretation should be concise but not empty or fake. Keep them dashboard-ready.

        JSON schema:
        {{
          "sex":"male|female|unknown",
          "finalRating":0,
          "sideRating":null,
          "tier":"short tier label",
          "authenticityFlag":false,
          "uncannyCueCount":0,
          "uncannyCues":[],
          "visualBucket":"NATURAL/COHERENT HIGH-TIER|EXAGGERATED BUT COHERENT|UNCANNY/SYNTHETIC/OVERBUILT|LOW-TIER/4-RANGE|VERY LOW-TIER/3-RANGE",
          "facialFatDefinitionRead":"lean|normal|soft|puffy-high-fat|unclear",
          "technicalSummary":"2 concise sentences, under 380 chars total",
          "appealAssessment":"brief calibrated interpretation, under 340 chars",
          "personalizedInterpretation":"1-2 concise sentences explaining the face-specific read",
          "categories":{{"Harmony":0,"Bone":0,"Symmetry":0,"Skin":0,"Dimorphism":0,"Maxillary/Cheekbone Projection":0,"Nose Projection":0,"Facial Fat":0,"Eye Depth":0,"Ear Shape":0,"Hairstyle and Grooming":0}},
          "hexagonFront":{{"Harmony":0,"Bone":0,"Symmetry":0,"Skin":0,"Dimorphism":0,"Facial Fat":0}},
          "hexagonSide":null,
          "keyRatios":[{{"name":"fWHR","value":"1.92","score":81,"impact":"positive|neutral|negative","note":"Strong width-to-height balance without blockiness."}}],
          "bestFeatures":[{{"title":"", "description":""}}],
          "primaryFlaws":[{{"title":"", "description":""}}],
          "pros":[""],
          "cons":[""],
          "mainLimitingFactor":"",
          "qualityFlags":[""],
          "confidenceFlags":[""],
          "debugJustification":"admin-only compact reason for score; mention score drivers, cap/uncanny/authenticity/female counterbalance if internally applied without exposing forbidden wording"
        }}
        Limits: keyRatios 16-20 unless impossible. bestFeatures 3-5. primaryFlaws 3-5. pros 3-5. cons 3-5. qualityFlags max 4. confidenceFlags max 4. Target output 1100-1500 tokens.
        """
        experimental_prompt_variant = os.getenv("MOGCHECK_EXPERIMENTAL_PROMPT_VARIANT", "calibration").strip().lower()
        active_prompt = legacy_experimental_prompt if experimental_prompt_variant in {"7k", "legacy", "current"} else calibration_preserving_prompt
        if choice == "2":
            active_prompt += """

        BACKUP MODEL OUTPUT COUNT OVERRIDE:
        - Return exactly 5 bestFeatures when possible.
        - Return exactly 5 primaryFlaws when possible.
        - Do not return only 3 unless the image is unusable or content-rejected.
        """
        if choice == "7":
            active_prompt = remove_score_cap_rules_for_premium_model(calibration_preserving_prompt)
        elif choice == "8":
            active_prompt = f"""
        You are MogCheck Premium Model, a clinical maxillofacial analyst for elite standards.
        Produce the first dashboard result in the same dashboard-compatible JSON shape as the Premium Model.
        Preserve the scoring logic below exactly in spirit. Do not soften, average out, or replace it with generic Premium calibration.

        INPUT A (Metadata): {prompt_clinical_data}
        INPUT B (Visuals): High-resolution frontal image provided.
        {("INPUT C (Side Profile Metadata): " + prompt_side_data if has_side_profile else "FRONT-ONLY MODE: no side profile image was provided; set sideRating and side-only fields to null. Do not infer side-only weaknesses.")}
        {content_safety_rules}
        {feature_selection_rules}

        SCORING LOGIC TO PRESERVE:
        STRICT RULE: HAIRLINE OCCLUSION OVERRIDE
        - If hair blocks the forehead, DISREGARD 'Upper Third' data from INPUT A.
        - Visually estimate skull structure. Do NOT penalize for a "large forehead" if it's just hair volume.

        BIMODAL SCALING LOGIC:
        1. THE "LEAN & YOUNG" BUFFER (Target: 68-75):
           - Buffer subjects with high leanness, youthful skin (no nasolabial folds), and clear "pretty-boy" appeal.
           - Prioritize bone-to-skin tightness over rigid vertical ratios.
        2. THE "SOFT & AGED" PENALTY (Target: 40-48):
           - Punish oiliness, nasolabial folds, skin laxity, facial fat, or unrefined wide noses.
           - These subjects are DISQUALIFIED from elite status and must be rated in the 40s.

        DASHBOARD OUTPUT ADAPTATION:
        - Return JSON only. No markdown. No prose outside JSON.
        - Keep the above scoring behavior; only adapt the output into dashboard fields.
        - The delayed report request will generate ACTIONABLE PROTOCOLS and personalized feedback after the dashboard loads. For the core response, include concise dashboard fields only.
        - finalRating must be decided before writing descriptions.
        - technicalSummary should correspond to the requested STRUCTURAL OVERVIEW and mention the hairline override if applicable.
        - appealAssessment should be about 40 words.
        - bestFeatures should contain exactly 5 entries when possible.
        - primaryFlaws should contain exactly 5 entries when possible.
        - keyRatios should contain 12-20 relevant 1-100 ratings from INPUT A and visual interpretation using the bimodal scaling logic.

        JSON schema:
        {{
          "sex":"male|female|unknown",
          "finalRating":0,
          "sideRating":null,
          "tier":"short tier label",
          "technicalSummary":"Bone vs soft tissue structural overview. Mention hairline override if applicable.",
          "appealAssessment":"~40 word calibrated appeal assessment",
          "personalizedInterpretation":"1-2 concise sentences summarizing the bimodal read",
          "categories":{{"Harmony":0,"Bone":0,"Symmetry":0,"Skin":0,"Dimorphism":0,"Maxillary/Cheekbone Projection":0,"Nose Projection":0,"Facial Fat":0,"Eye Depth":0,"Ear Shape":0,"Hairstyle and Grooming":0}},
          "hexagonFront":{{"Harmony":0,"Bone":0,"Symmetry":0,"Skin":0,"Dimorphism":0,"Facial Fat":0}},
          "hexagonSide":null,
          "keyRatios":[{{"name":"fWHR","value":"1.92","score":81,"impact":"positive|neutral|negative","note":"Short face-specific note."}}],
          "bestFeatures":[{{"title":"", "description":""}}],
          "primaryFlaws":[{{"title":"", "description":""}}],
          "pros":[""],
          "cons":[""],
          "mainLimitingFactor":"",
          "qualityFlags":[""],
          "confidenceFlags":[""],
          "debugJustification":"admin-only reason for the score; explicitly mention whether Lean & Young Buffer or Soft & Aged Penalty drove the result"
        }}
        Limits: bestFeatures exactly 5 when possible. primaryFlaws exactly 5 when possible. keyRatios 12-20. pros 3-5. cons 3-5. Keep text concise.
        """
        elif choice == "9":
            side_profile_metadata = (
                str(prompt_side_data).strip()
                if has_side_profile and prompt_side_data
                else "Side profile image was provided, but side-profile metadata could not be extracted. Analyze the side image visually and keep side-only fields conservative."
            )
            active_prompt = f"""
        You are MogCheck Premium Model, an elite-tier aesthetic consultant and clinical maxillofacial analyst.
        Your goal is to provide a brutally objective rating based on modern modeling standards, dimorphism, and facial harmony.
        Produce the first dashboard result in the same dashboard-compatible JSON shape as the Premium Model.
        Preserve the scoring logic below exactly in spirit. Do not replace it with generic Premium calibration.

        DATA INPUTS:
        1. METADATA (MediaPipe): {prompt_clinical_data}
           - NOTE: Use these measurements as supplemental evidence only. Do NOT be limited by them. If the visual image contradicts a measurement, such as hair blocking a measurement point, trust the visual image.
        2. VISUALS: High-resolution image provided. Analyze texture, angularity, and grooming.
        {("3. SIDE PROFILE METADATA: " + side_profile_metadata if has_side_profile else "FRONT-ONLY MODE: no side profile image was provided; set sideRating and side-only fields to null. Do not infer side-only weaknesses.")}
        {content_safety_rules}
        {feature_selection_rules}

        CALIBRATION BENCHMARKS (1-100 SCALE):
        - 83-88/100: Elite commercial/model-tier or rare leading-man appeal. Requires multiple elite markers, strong harmony, healthy skin/soft tissue, and no severe bottleneck. Does NOT require runway-level cheek hollows if the face is naturally harmonious, masculine/refined, and highly attractive.
        - 80-83/100: Entry elite / model-adjacent. Strong face with clear standout structure or eye area, good symmetry, coherent proportions, and only moderate or minor flaws.
        - 72-80/100: High-tier attractiveness. Strong and clearly attractive, but held below elite by one meaningful bottleneck such as visible aging, skin/soft-tissue blur, weak eye area, poor harmony, or side-profile limitation.
        - 65-72/100: Clearly attractive, "pretty boy" or "masculine-sharp" appeal. Above average in any room, but not consistently model-tier.
        - 50/100: Dead average.
        - 40-45/100: Below average/Failing (Example: Diddy phenotype - due to soft tissue, aging, and unrefined features).

        MANDATORY RATING LOGIC:
        1. THE ANGULARITY GATE: No subject can score above 65 if they possess significant facial fat AND also lack a defined jawline or visible bone structure. Angularity is the baseline for "attractive."
           - Do NOT require extreme sub-zygomatic hollowing for 80+. Extreme hollows are a high-fashion/runway marker, not the only path to elite appeal.
           - A face with a defined jawline, strong cheekbone/maxillary support, good symmetry, strong eyes, and coherent proportions can enter the low-to-mid 80s with normal healthy soft tissue.
           - Treat "not extremely hollow" as a mild cap only when the face otherwise reads soft, puffy, bloated, or poorly defined. Do not list lack of extreme hollowing as a primary flaw by itself.
           - Allow subjects to still score up to 60 despite failing the Angularity Gate and having bad skin, as long as they are not severely obese, do not have severely bad skin, and the bone structure is decent.
        1B. 75+ SCORE GATE: The subject can only score higher than 75 if at least one of these is true:
           - They have very good proportions, such as near-perfect facial thirds and strong global proportional balance.
           - They have at least above-average harmony plus very good features, such as good skin, strong eyebrow thickness/framing, low upper eyelid exposure, deep-set eyes, or similarly strong visible markers.
           If neither condition is met, keep the finalRating at 75 max
        1C. VERTICAL THIRDS + BROW STRICTNESS:
           - If Upper Third, Middle Third, and Lower Third are not all at least 75/100, the finalRating must not exceed 79.
           - Be only slightly harsher on vertical thirds than the raw ranges alone below that cap. Do not over-penalize small or moderate thirds imperfections once the cap is respected.
           - Do not call facial thirds "near-perfect" unless the upper, middle, and lower thirds look balanced together in the actual image, but do not over-penalize small or moderate thirds imperfections.
           - If brow compactness is below 75/100, the finalRating must not exceed 75.
           - Strong canthal tilt should not fully rescue weak brow compactness or high UEE; the eye area must look compact and well-framed overall to be considered high-tier.
        2. THE SKIN/TEXTURE TAX: Punish heavily for oily/greasy texture and visible large pores, active acne or significant scarring, nasolabial folds, and deep tear troughs as major age/vitality penalties.
        3. ORBITAL & NASAL REFINEMENT:
           - Penalize droopy eyelids (ptosis), significant scleral show, or lack of brow support.
           - Only punish for obvious droopy eyelid plus upper eyelid exposure. Do not punish just because someone has almond shaped eyes.
           - Deep brow support and low eyebrow setedness should not be required to reach 70/100, especially in faces with good harmony or faces whose appeal leans more toward good harmony than striking dimorphism. Examples: Cha Eun-woo, Haruma Miura.
           - Critique nose shape based on refinement. For African phenotypes, penalize a lack of bridge definition or excessive alar flaring that disrupts harmony.
        4. GROOMING & STYLING: Hairstyles and beard grooming contribute +/- 5 points. Punish patchy beards, neckbeards, or unkempt, greasy hair.
        Penalize if hairstyle looks bad, frames the face poorly, has balding signs
        5. PHENOTYPE STANDARDS: For Asian phenotypes, use the "Cha Eun-woo" standard (80) - prioritize extreme skin clarity, orbital compactness, and elegant bone structure.
                   6. Be stricter when judging nose width and punish exponentially the further it is from ideal. People with african noses tend to be severely overrated. ALso punish if there is a lot of nostril show.
        Punish exponentially for facial fat the further it is from ideal. >20% body fat should be seen as quite a big flaw. Jaw definition should be related to facial fat - if jaw definition is clearly bad then facial fat
         cannot be that good either.

        *NEW OVERRIDE: Punish severely for an overly wide african nose. Be a lot stricter on african phenotypes when it comes to nasal width, brow compactness, eyebrow shape and sparseness.
        Treat visible eyebags, upper eyelid exposure, not deep set eyes, almond shaped eyes, low brow ridge protrusion, flat maxilla, facial fat, as major flaws when it comes to african phenotypes.
        Be VERY VERY STRICT and deduct HEAVILY. When a subject fits the phenotype i described with those flaws, theres a very high chance they're a 40-55/100 and NOT a >55.
        you can CONSIDER raising the score past 55 if the subject has at least several of these features: Very good skin, low set eyebrows, thick eyebrows, low facial fat, hunter shaped eyes
        Do not allow subject to score more than 60 if they have: sparse eyebrows, too wide nose, very bulbous nose, protruding ears, weak brow ridge protrusion, BUT Do not overrate simply because they do not have those features.

        *OVERRIDE 2: Punish harsh ageing signs VERY VERY STRICTLY. Do not give ratings from a "age-relative" perspective (eg. he's a 60/100 because he looks good for his age). You are rating closer to like how
        attractive the subject would be perceived by 18-30 year olds. Punish for wrinkles, saggy skin, crows feet eyes, saggy neck, balding, etc.
        *OVERRIDE 3: Be very consistent on philtrum scoring. 0.090-0.100 is ideal and should score very high. 0.080-0.110 is balanced. 0.111-0.120 is mildly long. 0.121-0.140 is clearly long and should score noticeably lower than balanced values. Above 0.140 is severe. 0.070-0.079 is mildly short. Below 0.070 is clearly short. Do not let a clearly long philtrum outscore a balanced one unless the image is ambiguous or the landmark is unreliable. 0.11 and longer are considered flaws.

        DASHBOARD OUTPUT ADAPTATION:
        - Return JSON only. No markdown. No prose outside JSON.
        - Keep the above scoring behavior; only adapt the output into dashboard fields.
        - The delayed report request will generate ACTIONABLE PROTOCOLS and personalized feedback after the dashboard loads. For the core response, include concise dashboard fields only.
        - finalRating must be decided before writing descriptions.
        - appealAssessment should provide the requested ~50-word phenotype, dimorphism, and vibe analysis.
        - technicalSummary should correspond to the requested STRUCTURAL OVERVIEW: detail bone-to-soft-tissue ratio, whether the subject passed the Angularity Gate, and whether grooming/hair helps or hurts the score.
        - bestFeatures should contain exactly 5 entries when possible.
        - Prefer something structural for the top Best Feature when the scan has a real structural strength, such as harmony, cheekbones, jaw, chin, thirds, eye structure, or symmetry. Do not default to skin quality as the top best feature unless structure is genuinely weak and skin is the clearest standout strength.
        - primaryFlaws should contain exactly 5 entries when possible and should target the biggest visible score limiters. Only target facial fat, nasolabial folds, eyelid/brow issues, skin texture, or unrefined nasal structure when they are actually visible and rating-relevant.
        - Do not invent or overstate "soft tissue fullness" or "lack of sub-zygomatic hollowing" on a lean/defined face. If definition is normal-to-good, keep it neutral and choose a more real limiting factor.
        - keyRatios should list corrected 1-100 ratings from METADATA plus visual reality.
        - Required metric coverage should match Backup Model when visible: fWHR, jaw/bigonial width, chin support/projection, jaw angle/definition, facial thirds, midface ratio, eye spacing/IPD, eye width, canthal tilt, eye shape/eye area/eyelid exposure, nose width, nose length/projection, cheekbone/maxillary prominence, facial symmetry, skin texture/clarity, facial fat/soft-tissue definition, hairline/forehead balance, Hairstyle and Grooming as a visual-only score, mouth width, philtrum/lips, and brow compactness. Always include Upper Third, Middle Third, and Lower Third as separate keyRatios when the frontal metadata contains them. Add side convexity, neck-jaw transition, and hyoid/cervicomental area when side profile exists.
        - Do not stop at only fWHR, midface ratio, bigonial width, IPD index, eye width, canthal tilt, mouth width, and philtrum height. Fill 16-20 metrics unless impossible.

        JSON schema:
        {{
          "sex":"male|female|unknown",
          "finalRating":0,
          "sideRating":null,
          "tier":"short tier label",
          "technicalSummary":"Bone-to-soft-tissue overview. State Angularity Gate result and grooming/hair impact.",
          "appealAssessment":"~50-word phenotype, dimorphism, and vibe analysis",
          "personalizedInterpretation":"1-2 concise sentences summarizing the modern modeling-standard read",
          "categories":{{"Harmony":0,"Bone":0,"Symmetry":0,"Skin":0,"Dimorphism":0,"Maxillary/Cheekbone Projection":0,"Nose Projection":0,"Facial Fat":0,"Eye Depth":0,"Ear Shape":0,"Hairstyle and Grooming":0}},
          "hexagonFront":{{"Harmony":0,"Bone":0,"Symmetry":0,"Skin":0,"Dimorphism":0,"Facial Fat":0}},
          "hexagonSide":null,
          "keyRatios":[{{"name":"fWHR","value":"1.92","score":81,"impact":"positive|neutral|negative","note":"Corrected visual-reality note."}}],
          "bestFeatures":[{{"title":"", "description":""}}],
          "primaryFlaws":[{{"title":"", "description":""}}],
          "pros":[""],
          "cons":[""],
          "mainLimitingFactor":"",
          "qualityFlags":[""],
          "confidenceFlags":[""],
          "debugJustification":"admin-only reason for the score; explicitly mention Angularity Gate, Skin/Texture Tax, orbital/nasal refinement, grooming adjustment, and phenotype benchmark when relevant"
        }}
        Limits: bestFeatures exactly 5 when possible. primaryFlaws exactly 5 when possible. keyRatios 16-20 unless impossible. pros 3-5. cons 3-5. Keep text concise.
        """
    elif choice == "1":
        active_prompt = f"""
        MANDATE: Conduct a DUAL-INPUT structural evaluation (FRONTAL + LATERAL).
        INPUT A (Frontal Metadata): {prompt_clinical_data}
        INPUT B (Side Profile Metadata): {prompt_side_data}
        {prompt_visual_inputs}
        {content_safety_rules}
        {side_prompt_policy}
        TECHNICAL VISIBILITY & OVERRIDE RULES:
        - CANTHAL TILT MUST NOT BE IGNORED: Use BOTH the Canthal_Tilt_Degrees value from INPUT A and the actual visible eye tilt in the frontal image.
        If the metadata and the photo disagree, explain the uncertainty internally and use the clearer evidence, but never discard the canthal tilt measurement by default.
        Negative canthal tilt is a real eye-area flaw and must reduce eye-area, harmony, and final frontal score when it is visually obvious or supported by the metadata.
        Positive canthal tilt can help only when it looks natural, balanced, and harmonious; do not over-reward tiny positive values.
        - SIDE PROFILE JUDGMENT CRITERIA: Reward a nice, clean, and harmonious look.
        Bone structure does not necessarily have to be amazingly projected to score well.
        A slightly weak chin is acceptable as long as it is not completely terrible/recessed.
        A heavily, severely, very, markedly, or significantly recessed chin must strongly suppress the Final Side Rating and should not be treated as a minor profile issue.
        - SIDE PROFILE REWARDS: Explicitly reward good maxillary development and prominent cheekbones when viewed from the side.
        - RACIAL/ETHNIC CALIBRATION: Identify the subject's likely ethnicity/race from the profile.
        Apply scoring standards that correlate with that specific race (e.g., if Asian, account for naturally different averages in facial convexity).
        - MAXILLARY PROJECTION: Rate maxillary projection based on the provided lateral metadata and visual evidence.
        - NOSE BASE LENIENCY: Do not penalize for slightly wide nose bases unless it is very bad and severely disrupts facial balance.
        - DO NOT include minor asymmetries as flaws. ONLY penalize for asymmetry if it is VERY OBVIOUS and structurally disruptive.
        - Only override eye area data if signs of poor infraorbital growth are SEVERE and CLEARLY visible.
        - SCLERAL SHOW: Punish scleral show when it is very obvious, especially lower scleral show that creates a tired, exposed, droopy, or weak orbital look.
        Minor lighting/reflection artifacts should not be over-penalized, but clear visible white beneath the iris should materially reduce Eye Area, Harmony, and Appeal.
        - SIDE HYOID / NECK-JAW TRANSITION: On the side profile, evaluate the hyoid/cervicomental area from visual evidence and side metadata.
        A low hyoid, soft under-chin area, weak neck-jaw transition, obtuse cervicomental angle, or sagging submental fullness should punish the Final Side Rating and side Harmony/Bone categories.
        A clean, high, tight hyoid/neck-jaw transition can help the side profile, but it must not boost the frontal rating unless it is also visible frontally.
        - NON-HUMAN / CARTOON / AI-GENERATED IMAGE DETECTION:
        Before scoring, check whether the submitted image appears non-human, cartoon/anime/drawn, AI-generated, faceapp-like, mannequin-like, biologically impossible, or otherwise not a natural human photograph.
        If the image is clearly non-human, cartoon/drawn, inanimate, AI-generated, or biologically impossible, the Final Frontal Rating and Final Side Rating MUST NOT exceed 40.
        Do not score these images as normal human faces just because some ratios look symmetrical or strong.
        If the image is merely edited/stylized but still plausibly a real human photograph, use the normal uncanny/overbuilt rules instead of this hard cap.
        When this cap is used, include exactly one line after the final ratings:
        **Authenticity Flag:** Likely synthetic/non-human image - score capped.
        - HIGHLIGHTING & FORMATTING: In your insights and descriptions, highlight *key words* and *core concepts* by wrapping them in single asterisks for bold emphasis.
        - Do NOT use color-code wrappers like &blue&, &green&, $red$, #blue#, or @yellow@ anywhere in the output.
        - DIMORPHISM LANGUAGE RULE: Never describe aggressive dimorphism, brutal masculinity, extreme breadth, or an overbuilt jaw/brow as something "required" for high-tier appeal.
        A face should NOT be criticized for lacking aggressive dimorphism.
        High-tier appeal comes from balanced harmony, clean proportions, health, symmetry, attractive eye area, refined soft tissue, and a controlled mix of masculine and feminine traits.
        If a face is soft, youthful, or less aggressively masculine but harmonious, describe it as conventional / balanced / youthful rather than "missing" a required feature.
        If a face is extremely masculine, very broad, brutalist, or hyper-dimorphic, treat that as a possible limitation once it disrupts harmony or universal appeal.
        Forbidden wording/logic: "lacks the aggressive dimorphism required for high-tier appeal", "needs more aggressive dimorphism", "more masculine means better", "extreme dimorphism is elite by default".
{feature_selection_rules}
{anti_diddy_prompt_rules}

        SHARED RATING PROTOCOL:
        The following ratings MUST be identical for both the Front and Side profiles.
        Do not allow them to differ:
        1. Maxillary/Cheekbone Projection (Note: AI should use visual cues from both angles to determine this).
        2. Nose Projection.
        3. Facial Fat.
        4. Eye Depth.
        5. Ear Shape.
        6. Skin Quality.
        IMPORTANT FRONT/SIDE SEPARATION:
        - Final Frontal Rating must be judged primarily from the frontal image plus frontal measurements.
        - Final Side Rating must be judged from the side metadata/side visual evidence.
        - Do NOT let side-only weaknesses drag down the Final Frontal Rating unless the weakness is also visible from the front.
        - Shared traits can be checked from both angles, but the two final ratings must stay separate.
        SCORING LOGIC & THRESHOLDS:
        1. RATIO ANCHORS (STRICT SCALING):
           - fWHR: The ideal is BALANCED, not extreme.
           Penalize clearly when fWHR drops significantly below the ideal because the face becomes too narrow/weak.
           A merely decent or strong fWHR should NOT skyrocket the score by itself.
           Do NOT treat "more width = more attractive" or "more masculine = better" as valid logic.
           If fWHR becomes obviously too high / too wide, start subtracting harmony rather than rewarding it.
           If fWHR reaches roughly 2.10 or above, treat that as clearly over-dimorphic and less aesthetic.
           If it becomes extremely wide / brutish / blocky, the deduction should be strong rather than light.
           Never frame extreme width, extreme breadth, or extreme masculinity as premium strengths by themselves.
           Raw breadth / fWHR / bigonial width can only help when they stay balanced, elegant, and natural-looking.
           - BIGONIAL / BIZYGOMATIC RELATIONSHIP:
           Bigonial_Width_Index is a jaw/gonion width measurement normalized against bizygomatic cheekbone width.
           Read it as the bigonial-to-bizygomatic relationship, NOT as raw jaw power.
           A 0.85-1.00 ratio is the acceptable-to-ideal range, with the strongest score near 0.98 rather than every value in the range receiving 10/10.
           Never call a 0.85-1.00 ratio narrow, weak, subpar, or a flaw.
           Ratios around 0.87 should score in the 80s, then rise toward 100 as they approach roughly 0.98.
           Ratios from 0.75-0.85 are below the preferred range but should not become a major standalone flaw unless the face visually supports that read.
           Anything below 0.75 can be considered a narrow/weak lower-face flaw.
           Anything above 1.05 should be deducted for over-width/blockiness and can be considered a flaw.
           Never make Bigonial_Width_Index the #1 best feature or #1 worst feature unless the ratio is below 0.75, above 1.05, and visibly dominant.
           - IPD / EYE SPACING:
           IPD_Index (Geometric) is interpupillary distance normalized against bizygomatic cheekbone width.
           Around 0.46 is ideal balanced eye spacing and should score closest to 100.
           A 0.44-0.48 range is acceptable-to-good; do not call it close-set, wide-set, hypertelorism, or a flaw.
           Below 0.44 can be considered close-set / esotropia-leaning, with stronger deductions the farther below 0.44 it gets.
           Above 0.48 can be considered wide-set / hypertelorism-leaning, with stronger deductions the farther above 0.48 it gets.
           Close-set or wide-set eyes may be listed as one of the primary flaws when IPD_Index (Geometric) is outside the 0.44-0.48 balanced range and the visual appearance supports it.
           - MOUTH WIDTH:
           Mouth_Width_Index is mouth width normalized against bizygomatic cheekbone width.
           Around 0.37 is ideal harmonious mouth width and should score closest to 100.
           A 0.36-0.38 range is acceptable-to-ideal; do not call it narrow, overly wide, or a flaw.
           Below 0.36 can be considered a narrow mouth flaw, with stronger deductions the farther below 0.36 it gets.
           Above 0.38 can be considered an overly wide mouth flaw, with stronger deductions the farther above 0.38 it gets.
           - GLOBAL BASELINE CURVES FOR OTHER FRONTAL RATIOS:
           Nose_Width_Index: 0.23-0.30 is the broad balanced range, strongest around 0.265; below 0.20 is pinched/narrow, above 0.32-0.34 becomes wide only if visually disruptive.
           fWHR: 1.85-2.00 is the balanced strong range. Around 1.60 is only a minor narrowness flaw and should not be treated as a major standalone issue. Around 1.50 or lower is clearly narrow/weak and should be punished harshly. Above 2.10 is too wide/blocky, and above 2.25 is severe.
           Midface_Ratio: 0.88-0.98 is strongest, 0.98-1.07 is acceptable, above 1.08 is long, above 1.15 is severe, and below 0.82 is overly compressed.
           Upper_Third_Length: 0.34-0.43 is balanced, above 0.46 is long, above 0.52 is severe, below 0.30 is compressed. If hair, bangs, hats, hood, shadow, or cropping covers the hairline, disregard the MediaPipe Upper_Third_Length number, visually estimate where the hairline would naturally sit from visible forehead shape/temples/hair direction, and rate Upper_Third_Length from that visual estimate instead.
           Middle_Third_Length: 0.40-0.50 is balanced, above 0.54 is elongated, above 0.60 is severe, below 0.36 is compressed.
           Lower_Third_Length: 0.42-0.52 is balanced, below 0.38 is short, above 0.56 is long, above 0.62 is severe.
           Eye_Width_Index (Horizontal): around 0.20-0.24 is balanced/strong, below about 0.18 is short/small, and above about 0.26 is overly long only if it visibly hurts harmony.
           Eye_Height_Index: 0.055-0.075 is balanced, below 0.045 is narrow/squinty, above 0.085 is overly round/exposed.
           Brow_Compactness_Index: 0.08-0.12 is balanced, above 0.14 means high brow/poor compactness, below 0.06 means overly compressed/heavy.
           Philtrum_Height_Index: 0.08-0.11 is balanced, around 0.095 is ideal, above 0.12 is long, above 0.14 is severe, below 0.07 is short, and below 0.055 is very short.
           Total_Lip_Height_Index: 0.12-0.18 is balanced, below 0.10 is thin, below 0.08 is very thin, above 0.22 is overly large only if visually disharmonious.
           Canthal_Tilt_Degrees: 3-8 degrees is ideal positive tilt, 0-10 is acceptable, below -2 is negative, below -6 is severe, and above 12 can look unnatural.
           - ETHNICITY / SEX ADJUSTMENTS:
           Use the global curves as the baseline, then adjust tolerance rather than changing the meaning of the raw measurement.
           East Asian faces: be more tolerant of epicanthal folds, monolid/double-eyelid variation, flatter side projection, wider midface/fWHR, and different nose bridge/alar balance when harmonious.
           African/Sub-Saharan faces: be more tolerant of wider nasal base and fuller lips; do not mark those as flaws unless extreme relative to total harmony.
           South Asian / Middle Eastern / North African faces: be more tolerant of stronger noses, deeper-set eyes, thicker brows, facial hair effects, and sharper/broader nasal structures.
           Female faces: tolerate softer jaw/bigonial structure, lower fWHR, fuller lips, and less aggressive dimorphism.
           Male faces: tolerate stronger fWHR, lower-third structure, brow, and jaw width, but still penalize blockiness or overbuilt proportions when harmony suffers.
           - MIDFACE: Do NOT treat mildly long midfaces as a major flaw.
           A Midface_Ratio around 0.98-1.07 is only a light concern and by itself should usually NOT become the #1 WORST FEATURE.
           Treat elongated midface as a true structural flaw only when it is clearly long (roughly 1.08+) and make it a high-priority flaw when it is more obvious (roughly 1.15+) or when it combines with other long-face signals like elongated thirds, narrow facial width, or vertically stretched harmony.
           If the overall face reads horse-faced, long, narrow, stretched, or vertically dragged out, punish that harshly even if one or two local ratios are not catastrophic.
           - UPPER THIRD: Penalize strictly for an elongated upper third/forehead relative to the rest of the face.
           - PHILTRUM: Do NOT mark a philtrum as long when Philtrum_Height_Index is in the balanced 0.08-0.11 range. Penalize long philtrums only when the ratio is clearly high (roughly 0.12+) and the visual read also disrupts lower-third harmony.
           - EYE AREA: Penalize for puffy undereyes (eye bags/fat prolapse).
           Penalize clearly negative canthal tilt when visible or when the Canthal_Tilt_Degrees measurement supports it.
           Penalize very obvious scleral show, especially lower scleral show, because it weakens compactness, alertness, and orbital harmony.
           Do not hallucinate scleral show from normal eye highlights or tiny eyelid gaps; only punish it when the white exposure is obvious.
           Reward genuinely exceptional eye areas more than you currently do.
           If the subject has compact, attractive, well-framed eyes with good shape, good spacing, low upper eyelid exposure, and a strong overall orbital aesthetic, allow that to lift harmony and attractiveness in a noticeable but controlled way.
           Elite eyes should be able to add a meaningful boost, but they should NOT completely rescue a face with multiple obvious structural problems.
           Think of exceptional eyes as a moderate score amplifier, not an automatic override.
           - EYEBROWS: Be less strict on sparse eyebrows;
           only penalize if they are really obviously sparse and affect framing.
           - EYELID EXPOSURE: Penalize strictly for high upper eyelid exposure on double eyelids (lack of hooding/compactness).
           - NOSE: Only apply width penalties if the alar base is extremely wide; ignore slight width variations.
           - LIPS: Penalize strictly for thin/inconspicuous lips.
           - JAW/CHIN: Be accepting of tapered jawlines.
           Not every jaw requires a "square" aesthetic to be elite. Penalize only irregular/weird shapes.
           Strong jaw width, bigonial width, or brute lower-third breadth should be treated as SUPPORTING traits, not as major carry traits.
           A wide jaw / bigonial width alone should never rescue weak harmony, tired soft tissue, mediocre eyes, aging, or an overall non-elite read.
           Bigonial width by itself should carry less weight than overall harmony, eye area, skin/soft tissue, facial thirds, and the jaw-to-cheekbone relationship.
           If the jaw or gonial width becomes too expanded, too blocky, or too brutish relative to the rest of the face, treat it as a harmony negative rather than a bonus.
           - SIDE HYOID / CERVICOMENTAL AREA: For the side profile only, punish a bad hyoid/neck-jaw transition when visible.
           A low hyoid, soft submental area, obtuse cervicomental angle, weak under-chin definition, or sagging throat/neck line should noticeably reduce the Final Side Rating.
           Do not let a strong jaw or chin fully rescue a bad hyoid area if the side profile still reads soft, saggy, or poorly defined under the mandible.
           A clean hyoid and sharp neck-jaw transition should help the side profile, but should not affect the frontal rating unless visible from the front.
           - DEFINITION / FACIAL FAT: Penalize visibly high facial fat and poor definition more harshly than you currently do.
           Before applying any facial-fat penalty, visually classify the face as one of: lean, normal, soft, puffy/high-fat, or unclear.
           A soft, puffy, bloated, or poorly defined face should noticeably hurt harmony, bone visibility, and perceived attractiveness.
           If the cheek/jaw/under-chin definition is weak due to visible body fat or facial fullness, this should produce a major meaningful deduction rather than just a tiny one.
           IMPORTANT: Do NOT penalize normal, lean, or merely average facial fat. If the face does not visually look high body fat / puffy / bloated, do not change the rating because of facial fat.
           If the face is lean, sharp, hollow, gaunt, or visibly low body fat, you MUST NOT list high facial fat, puffiness, bloating, or poor definition from fat as a flaw.
           If weak definition is caused by lighting, blur, beard, image quality, angle, soft bone structure, or lack of cheekbone/jaw projection rather than visible fat, do NOT call it high facial fat.
           - AGING / SOFT TISSUE / ORBITAL TIREDNESS / OVERALL READ:
           Penalize visible soft-tissue decline, orbital tiredness, under-eye fatigue, nasolabial folds, laxity, puffiness, and a generally worn / non-elite facial read more harshly than you currently do.
           Nasolabial folds are especially important: visible moderate-to-deep nasolabial folds should materially lower skin/soft-tissue freshness, harmony, and final rating because they age the face and reduce a fresh high-tier look.
           Deep nasolabial folds, marionette-line heaviness, sagging cheek tissue, or pronounced midface/lower-face creasing should be treated as a major aging/soft-tissue flaw when obvious.
           Even if some bone metrics are decent, a face that looks tired, aged, puffy, saggy, or generally non-elite should not float into an inflated band.
           "Overall non-elite read" is a real penalty factor and should materially lower the final score when it is obvious.
           - BALDNESS / HAIRLINE: Penalize visible baldness, severe recession, diffuse thinning, or a high/weak hairline more than you currently do when it hurts facial framing or makes the face look older.
           Baldness should reduce perceived youth, harmony, and overall appeal when it is visually obvious, especially if the scalp is exposed, the hairline is heavily receded, or the face loses upper-third framing.
           Do not let strong facial bones fully rescue a visibly aged/bald presentation if the overall read becomes older, harsher, or less fresh.
        1B. INTERNAL VISUAL BUCKETING (VERY IMPORTANT):
           Before deciding the final score, internally classify the face into ONE of these buckets:
           - NATURAL / COHERENT HIGH-TIER: Strong features that still read human, believable, and harmonious.
           - EXAGGERATED BUT COHERENT: Striking or high-fashion features that are intense, but still fit the face and remain believable.
           - UNCANNY / SYNTHETIC / OVERBUILT: Faces that look artificial, too carved, too aggressive, biologically implausible, AI-generated, filter-generated, or "fantasy male model" in a way that harms harmony.
           - LOW-TIER / 4-RANGE: Faces with weak overall aesthetics, weak harmony, weak definition, visible flaws, and no standout redeeming structure.
           - VERY LOW-TIER / 3-RANGE: Faces with multiple major structural issues at once, especially long narrow proportions, very low facial width, obvious asymmetry, weak eye area, and no genuinely strong redeeming feature.

           DISTINCTION RULE:
           Do NOT confuse "striking" with "elite". A face can have attention-grabbing dimorphism and still be aesthetically worse because it looks forced, synthetic, overbuilt, tired, or aesthetically unbalanced.

           EXAMPLE ANCHORS FOR CALIBRATION:
           - A normal attractive celebrity face with decent harmony but not extreme structure belongs in NATURAL / COHERENT, not in uncanny and not in overbuilt.
           - A strong editorial / model face with intense jaw, cheekbones, eyes, or dimorphism can still belong in EXAGGERATED BUT COHERENT if it remains believable, photoreal, internally harmonious, and not worn-down / soft-tissue-compromised.
           - A face with impossible jaw width, over-carved hollows, compressed soft tissue, fake-looking eye rendering, or "AI beauty render" energy belongs in UNCANNY / SYNTHETIC / OVERBUILT even if some local ratios look strong.
           - A face that is very long, narrow, low-fWHR, visibly asymmetric, and lacking standout positives belongs in VERY LOW-TIER / 3-RANGE rather than 4-range or average-tier.

           UNCANNY / OVERBUILT CUES:
           Explicitly check these 6 uncanny facial cues from the actual image, not just the measurements:
           1. Very big chin compared to the lips / mouth scale.
           2. Hollow cheeks or gaunt cheek hollows.
           3. Very low-set eyebrows that are also positively tilted.
           4. Very defined / over-carved facial features, especially around the cheekbone area.
           5. Bigonial width that is significantly wider than bizygomatic width.
           6. Very veiny face / visible facial or temple vascularity.
           Count how many are clearly present.
           If 3 or more of these 6 cues are clearly present, treat the face as a synthetic uncanny face even if some individual ratios look strong.
           In that case, the #1 WORST FEATURE / primary flaw MUST be the synthetic uncanny read, and the output MUST include:
           **Uncanny Cue Count:** [0-6] ([brief comma-separated cues detected])
           **Uncanny Flag:** Synthetic uncanny face detected.
           If fewer than 3 cues are clearly present, still output the cue count but do NOT include the Uncanny Flag line.

           EXAGGERATED BUT COHERENT CUES:
           If the face is strong, sharp, or highly dimorphic but still reads naturally human and harmonious, only apply a VERY SMALL harmony deduction.
           These faces can still score well if the structure is genuinely coherent.
           This bucket is ONLY for faces that still look unmistakably like a believable real human photograph.
           Think "editorial", "male model", or "high-fashion" intensity that still feels like a real person rather than a synthetic facial design.
           Strong bizygomatic width, a sharp jaw, compact eyes, strong brow support, or high dimorphism by themselves do NOT make a face uncanny.
           If the features are extreme but proportionally integrated, the deduction should be extremely light rather than harsh.
           If the face instead reads like an AI beauty render, FaceApp-style hyper-edit, fantasy-male model, mannequin, or over-optimized "internet mog" face, do NOT place it here.
           In those cases, treat the face as uncanny / synthetic even if some individual ratios look strong.
           IMPORTANT: Do NOT praise this bucket with wording like "extreme dimorphism", "elite breadth and definition", or "highly masculine and striking phenotype" as if those are elite natural positives.
           If the face is strong mainly because it is aggressive, overbuilt, very broad, or overly masculine, explicitly frame that as niche / editorial / limiting rather than universally high-tier.

           DOUBT RULE:
           If you are uncertain whether a face is merely "striking" or actually "uncanny / synthetic", do NOT default to generosity.
           If it looks like an AI beauty edit, a fantasy-male-model render, a hyper-optimized gigachad, or a face with too many aggressively maximized features at once, bias toward the uncanny bucket rather than the coherent bucket.
           Do NOT call such faces "natural" or "coherent" just because the local ratios are strong.
           If the eye rendering, jaw width, cheek hollows, brow compression, or overall skull proportions look "too designed" or too perfect in an artificial way, assume uncanny rather than coherent.
           However, if the photo clearly reads as a normal real-world photograph and the features are simply strong / rare / model-tier, do NOT collapse it into the uncanny bucket.

           LOW-TIER / 4-RANGE CUES:
           If the face has average-to-weak structure, weak harmony, soft definition, visible flaws, and no standout redeeming markers, do not inflate it into the 50s or 60s.

           VERY LOW-TIER / 3-RANGE CUES:
           If SEVERAL of the following appear together, strongly consider a rating in the 30s:
           - very low fWHR / visibly narrow facial width that makes the face look weak rather than refined
           - elongated midface or strong vertical length that creates a long, narrow, stretched appearance
           - clearly visible asymmetry in the eyes, brows, jaw, nose, or mouth
           - weak eye area, poor compactness, or generally tired / droopy feature layout
           - weak lower-third aesthetics without a compensating high-tier feature
           - no genuinely strong redeeming marker that could anchor the face into a higher bracket
           IMPORTANT:
           A face with this combination should NOT be saved by "average skin", "not terrible lips", or one small decent feature.
           If the overall read is weak, narrow, asymmetric, and long-faced, do not be generous.
           These faces often belong in roughly the 30-39 range, and can go lower when the flaws are severe enough.

           BUCKET IMPACT ON FINAL RATING:
           - NATURAL / COHERENT HIGH-TIER: score normally from the ratios + visual harmony.
           - EXAGGERATED BUT COHERENT: apply only a tiny deduction, usually around 0-3 points total unless harmony is clearly disrupted. These faces can still land in the 75-85 range when the structure is genuinely strong, but do NOT let extreme dimorphism alone be the reason they rate well.
           - UNCANNY / SYNTHETIC / OVERBUILT: apply a major deduction. These faces should usually land far below a coherent high-tier face with similar local ratios, because the synthetic / overbuilt look is itself a major aesthetic flaw.
           - VERY LOW-TIER / 3-RANGE: when the face is long, narrow, asymmetric, and structurally weak with no redeeming anchors, the score should often land in the 30s instead of the 40s or 50s.
        2. GENDER COUNTERBALANCE (INTERNAL RULE):
           - If Sex = Female AND the score is > 70, deduct 10 points from the Final Rating and potential tiers.
           - DO NOT mention this deduction in the output or justification. It must appear as the "natural" result.
        3. CONDITIONAL NON-HUMAN / AI CAP:
           - NON-HUMAN / CARTOON / BIOLOGICALLY IMPOSSIBLE CAP 40: If the input is clearly not a natural human photograph, clearly cartoon/drawn/anime, clearly AI-generated, mannequin-like, or biologically impossible, the Final Frontal Rating and Final Side Rating MUST NOT exceed 40. Include the required Authenticity Flag line in the output.
           - LOW-TIER FLOOR LOGIC: If the face is clearly very narrow, elongated, asymmetric, and weak overall, do NOT keep it artificially in the 40s or 50s just because a few isolated measurements are not disastrous.
           - VERY IMPORTANT: a face that looks "striking" because it is over-optimized, hyper-carved, or synthetic is NOT the same as a naturally elite face.
           - UNCANNY/OVERLY DIMORPHIC PENALTY: If a face appears overly dimorphic, unnatural, synthetic, or uncanny (for example an AI-generated "gigachad" or overbuilt fantasy face), penalize it HARD.
           The more artificial, over-carved, biologically implausible, or brutalist the look becomes, the harsher the deduction should be.
           A clearly uncanny face should usually NOT score like a true elite natural face, even if some isolated measurements look strong.
           In severe uncanny cases, reduce the rating according to how distorted, synthetic, or harmony-breaking the exaggeration is, but do not apply an automatic numeric ceiling unless the image is clearly non-human / AI-generated under the authenticity cap.
           In moderate uncanny cases, reduce the rating proportionally rather than forcing it into a fixed band.
           Faces that resemble AI-generated male beauty edits with giant jaws, hollow cheeks, compressed soft tissue, glassy eyes, extreme brow compression, or hyper-clean mannequin-like harmony should be penalized if they harm natural harmony, but do not apply an automatic numeric ceiling unless the authenticity cap applies.
           If the face is only exaggerated but still coherent and natural-looking, apply only a minor-to-moderate deduction instead.
           Extreme masculinity is NOT automatically a positive. The ideal is balanced beauty: a clean mix of masculinity and femininity.
           Faces that become too brutish, too wide, too heavy, too hollowed, too aged, too tired, or too aggressively dimorphic should lose harmony points once the extremes are visually obvious.
           Lack of aggressive dimorphism is NOT a flaw by itself. A softer or more youthful face can still score high when harmony, eyes, skin, ratios, and overall appeal are strong.
           Do not write that a face lacks "required aggressive dimorphism"; this is incorrect.
           - NATURAL PENALTY PHRASING: NEVER explicitly state "the face is hard capped at 60 due to X" or mention internal rule names directly.
           Instead, make the limitation sound natural and logically explain it.
           For example: "the rating is limited by several overly dimorphic features" or "structural harmony is disrupted by unnatural proportions".
           - If the eye area is genuinely exceptional, it should carry more weight in helping the face break into a higher band, especially when the rest of the face is at least decent and not heavily flawed.
           - However, exceptional eyes alone should not push a structurally flawed face into an inflated score band.
           - ELITE STATUS (85-100): Requires exceptional symmetry AND elite markers (Chico/Cha Eunwoo phenotype balance).
        4. CALIBRATION ANCHORS (VERY IMPORTANT):
           - Do NOT overrate based on celebrity familiarity, charisma, expression, fame, hairstyle, or lighting.
           - Use the measurement data objectively. The final rating should feel harsh and grounded, not generous.
           - If the subject has multiple major flaws and very few redeeming traits, DO NOT be afraid to rate below 40.
           - 40 or below is valid for faces with several major structural or aesthetic issues, poor definition, visible aging, and no standout positive features.
           - Do NOT force average-looking or below-average faces into the 50s or 60s just because they are recognizable, masculine, or not deformed.
           - Do NOT force uncanny, AI-looking, overbuilt, "gigachad", or fantasy-model faces into the high 70s or 80s just because the jaw, brow, or width is extreme.
           - Do NOT let bigonial width, jaw width, broadness, or brute dimorphism act like elite carry traits by themselves.
           - Do NOT inflate the final score because Bigonial_Width_Index is high. Judge whether the jaw-to-cheekbone relationship is balanced; only extreme narrowness or extreme blocky width should matter heavily.
           - A face with only decent metrics but clear aging, orbital tiredness, soft-tissue decline, puffiness, or an overall non-elite read should fall much lower than a clean youthful harmonious face.
           - A face that is exaggerated but still coherent can still rate well.
           - A face that is exaggerated AND uncanny should drop notably because the exaggeration itself is hurting harmony.
           - A face that is exaggerated, editorial, or brutalist should NOT automatically read as high-tier. If the extremeness itself is the main thing carrying the look, do not score it like a balanced elite face.
           - A face with an AI-generated hypermasculine look should not be described as elite natural harmony unless it truly looks believable and human first.
           - If the visual read says "edited / synthetic / fantasy-male aesthetic", do not let strong numbers rescue it into a score band meant for real high-tier faces.
           - Calibration example: a face with a giant carved jaw, hollow cheeks, compressed brow/eye area, glassy symmetry, and "male-model render" energy should usually land somewhere around the upper-40s to high-50s depending on how distorted or synthetic it looks, not around 78-85.
           - Do NOT call raw breadth / bigonial width / fWHR / zygomatic breadth the BEST FEATURE if those very traits are what make the face read overbuilt, aggressive, editorial, or niche.
           - If the face is overbuilt or over-dimorphic, prefer strengths like eye area, symmetry, skin, or one genuinely elegant feature over praising the exaggerated width itself.
           - Faces with obvious flaws and only decent structure usually land around 42-58.
           - Above-average attractive faces usually land around 58-72.
           - Strong/high-tier attractive faces usually land around 72-80.
           - Truly elite faces begin in the low 80s.
           - 90+ should be extremely rare.
           - Example anchor: a face like Will Smith should NOT be treated as ultra-high-tier by default; if the metrics are only decent and several flaws exist, a result around the high-50s / low-60s is more realistic.
           - A face with truly exceptional eyes and otherwise decent harmony should not get stuck too low purely because the bone structure is less aggressive or less brute-dimorphic.
        5. SIGNS OF AGING:
           - Penalize visible aging signs MORE harshly than you currently do.
           - Nasolabial folds, especially moderate-to-deep folds, should be punished more strongly because they visually age the midface and lower face.
           - Under-eye aging, wrinkles, sagging skin, skin laxity, orbital tiredness, and a worn / non-fresh look should reduce the rating in a clearly noticeable way when visible.
           - Visible aging, weak definition, soft-tissue decline, and a generally non-elite read should matter materially, not just cosmetically.
           - If the face looks noticeably older, puffier, more tired, or less structurally fresh than the metrics alone would suggest, let that lower the final score in a meaningful way.
           - If aging signs are not visible, do not invent an aging penalty.
           - Visible baldness, severe recession, diffuse thinning, or a weak/high hairline should count as an aging/presentation penalty when it noticeably worsens facial framing.




        OUTPUT FORMAT:
        ### ANALYSIS [SEX]
        **Final Frontal Rating: [Score]/100**
        **Final Side Rating: [Score]/100**
        **Authenticity Flag:** [Only include this line if the image is clearly non-human, cartoon/drawn, AI-generated, mannequin-like, or biologically impossible. Otherwise omit this line completely.]
        **Uncanny Cue Count:** [0-6] ([brief comma-separated cues detected from: oversized chin vs lips, hollow cheeks, low-set positively tilted eyebrows, over-defined cheekbones/features, bigonial wider than bizygomatic, very veiny face])
        **Uncanny Flag:** [Only include this line if 3 or more uncanny cues are clearly detected. Exact text: Synthetic uncanny face detected. Otherwise omit this line completely.]
        **Facial Fat / Definition Read:** [lean/normal/soft/puffy-high-fat/unclear] - [brief visual reason from the actual image. If lean/normal/unclear, do not apply a high-fat penalty.]
        **Max Natural Potential: [Score]/100** [Required. Estimate the realistic ceiling from non-surgical changes only: lower facial fat, skincare, grooming, orthodontic/dental optimization, health, sleep, and presentation. Do not invent dramatic structural changes.]
        **Max Potential with Surgery: [Score]/100** [Required. Estimate the realistic ceiling if proportionate, tasteful surgical/orthodontic correction addressed the main structural flaws. Do not assume impossible perfection or uncanny overcorrection.]

        **Technical Summary:** [Blend Frontal Metadata with Side Profile Metadata.
        Use *bolding* sparingly when emphasis is helpful].

        **Appeal Assessment:** [Start by clearly stating likely race/ethnicity and sex in plain language, then explain phenotype and target audience appeal. Example opening: "Likely race/ethnicity: [group or mixed/uncertain]. Sex: [male/female/uncertain]." If uncertain, say so instead of guessing too confidently. If the face falls into the EXAGGERATED BUT COHERENT bucket, explicitly say that the appeal is more niche / editorial / high-fashion rather than universally conventional. Do NOT frame extreme masculinity or aggressive breadth as elite natural appeal. Do NOT say aggressive dimorphism is required for high-tier appeal; balanced harmony is the goal.]
        **Category Signal Ratings (front)**
        - Skin: [Score 1-10]
        - Bone: [Score 1-10]
        - Harmony: [Score 1-10]
        - Symmetry: [Score 1-10]
        - Dimorphism: [Score 1-10]

        **Category Signal Ratings (side)**
        - Skin: [Score 1-10]
        - Bone: [Score 1-10]
        - Harmony: [Score 1-10]
        - Symmetry: [Score 1-10]
        - Dimorphism: [Score 1-10]

        **CORE CATEGORY SCORES (Front | Side):**
        - Harmony: [Score] | [Score]
        - Bone: [Score] | [Score]
        - Symmetry: [Score] | N/A
        - Skin: [Score] | [Score] (Shared)
        - Dimorphism: [Score] | [Score]
        - Maxillary/Cheekbone Projection: [Score] | [Score] (Shared)
        - Nose Projection: [Score] | [Score] (Shared)
        - Facial Fat: [Score] | [Score] (Shared)
        - Eye Depth: [Score] | [Score] (Shared)
        - Ear Shape: [Score] | [Score] (Shared)
        - Hairstyle and Grooming: [Score] | [Score] (Shared visual-only)

        **CRITICAL MARKERS:**
        - #1 BEST FEATURE: [Feature Name] - [Brief explanation based on both visuals and measurements]
        - #1 WORST FEATURE: [Feature Name] - [Brief explanation based on both visuals and measurements]

        ### DASHBOARD_DATA
        IMPORTANT DASHBOARD_DATA FORMAT RULE:
        Do NOT write BEST FEATURES or PRIMARY FLAWS as inline bracket lists.
        You MUST write each entry on its own numbered line exactly like the template below, with a short explanation after a dash.
        BEST FEATURES (10):
        1. [FRONT] [Feature Name] - [Brief explanation]
        2. [FRONT] [Feature Name] - [Brief explanation]
        3. [FRONT] [Feature Name] - [Brief explanation]
        4. [FRONT] [Feature Name] - [Brief explanation]
        5. [FRONT] [Feature Name] - [Brief explanation]
        6. [SIDE] [Feature Name] - [Brief explanation]
        7. [SIDE] [Feature Name] - [Brief explanation]
        8. [SIDE] [Feature Name] - [Brief explanation]
        9. [SIDE] [Feature Name] - [Brief explanation]
        10. [SIDE] [Feature Name] - [Brief explanation]
        PRIMARY FLAWS (10):
        1. [FRONT] [Feature Name] - [Brief explanation]
        2. [FRONT] [Feature Name] - [Brief explanation]
        3. [FRONT] [Feature Name] - [Brief explanation]
        4. [FRONT] [Feature Name] - [Brief explanation]
        5. [FRONT] [Feature Name] - [Brief explanation]
        6. [SIDE] [Feature Name] - [Brief explanation]
        7. [SIDE] [Feature Name] - [Brief explanation]
        8. [SIDE] [Feature Name] - [Brief explanation]
        9. [SIDE] [Feature Name] - [Brief explanation]
        10. [SIDE] [Feature Name] - [Brief explanation]
        If the face falls into the UNCANNY / SYNTHETIC / OVERBUILT bucket, at least 2 of the PRIMARY FLAWS must explicitly mention things like Synthetic / Uncanny Look, Over-aggressive Dimorphism, Overbuilt Lower Third, Over-stylized Eye Area, Brutalist Aesthetic, or Artificial Harmony.
        If the face is uncanny / overbuilt, the #1 WORST FEATURE should point to that unnatural / synthetic / over-aggressive trait rather than a random minor flaw.
        ### RATINGS (USE THIS)
        [Look at the following data from INPUT A (mog_report) and rate them from 1-100 using the global baseline curves above, with ethnicity/sex tolerance adjustments. If hair, bangs, hats, hood, cropping, or shadow covers the hairline, ignore the MediaPipe Upper_Third_Length number and visually estimate the natural hairline position before scoring Upper_Third_Length. For Bigonial_Width_Index, score on a curve: around 0.87 should be in the 80s, the score should approach 100 near 0.98, below 0.75 is a flaw, and above 1.05 deducts for over-width/blockiness. For IPD_Index (Geometric), score around 0.46 closest to 100, keep 0.44-0.48 acceptable-to-good, below 0.44 close-set, and above 0.48 wide-set. For Eye_Width_Index (Horizontal), score around 0.20-0.24 strongest, below about 0.18 short/small, and above about 0.26 only negative if visually disharmonious. For Mouth_Width_Index, score around 0.37 closest to 100, keep 0.36-0.38 acceptable-to-ideal, below 0.36 narrow, and above 0.38 overly wide.]
        - Bigonial_Width_Index: [Score]/100
        - IPD_Index (Geometric): [Score]/100
        - Mouth_Width_Index: [Score]/100
        - Nose_Width_Index: [Score]/100
        - Upper_Third_Length: [Score]/100
        - Middle_Third_Length: [Score]/100
        - Lower_Third_Length: [Score]/100
        - Eye_Width_Index (Horizontal): [Score]/100
        - Eye_Height_Index: [Score]/100
        - Brow_Compactness_Index: [Score]/100
        - Philtrum_Height_Index: [Score]/100
        - Total_Lip_Height_Index: [Score]/100
        - fWHR (Zygo / Upper_Face): [Score]/100
        - Midface_Ratio (Mid/IPD): [Score]/100
        - Canthal_Tilt_Degrees: [Score]/100

        ### Personalised feedback
        [Provide exactly 5 pieces of personalized advice based on the user's submitted images.
        Format each as a numbered list item with a capitalized title. Each piece must be 1-3 paragraphs max.
        Focus strictly on real-world, physical issues and changes (e.g., facial fat, bone growth, surgical interventions) rather than surface fixes like posture or lighting.
        Be very explicit about what is causing the problem and the exact physical fix required.
        Answer all the user's unasked questions so they aren't left wondering.]
        Example formatting:
        1. IMPROVING YOUR AESTHETICS IN PICTURES
        You have a harmonious, well rounded face with *balanced features*.
        However, you have suboptimal bone growth in the cheekbones and chin.
        You have moderate upper eyelid exposure which can throw off your look in certain lighting.
        To fix this, you can try to compensate by *losing facial fat* which could bring your score up to about a 58-65 depending on lighting and angle.
        Surgical intervention would be needed to fix the rest of the issues completely.
        ### ACTIONABLE PROTOCOLS
        [List exactly 20 actionable protocols.
        Sorted from HIGHEST IMPACT to LOWEST IMPACT.]
        [Address both Frontal and Lateral structural issues based on the dual analysis.]
        [Every protocol must target a score-limiting weakness and describe an improvement path, not maintenance of existing strengths.]
        [Use no more than 10 surgical/procedural protocols. The remaining protocols must be non-surgical softmaxxes that can still raise the score.]
        [Softmax examples include eyebrow dermastamping/minoxidil, volufiline, hairstyle/grooming changes, caffeine eye serums, skincare, conditioning, fat loss, and styling.]
        [Makeup protocol cap: for male subjects, maximum 2 makeup protocols such as subtle eyeshadow or concealer; for female subjects, maximum 5.]
        [If the face does not already show at least slight hollow cheeks / clear cheek leanness, one protocol must explicitly recommend getting leaner or reducing facial fat to improve definition.]
        1. [Protocol Name]: [Description].
        [Impact Rating]
        ...
        20. [Protocol Name]: [Description].
        [Impact Rating]

        ### MOG_REPORT_REVISION
        [Re-list every feature from INPUT A and Side features from INPUT B. Ensure Shared Ratings match.
        Format: "Feature Name: Score". NO EXPLANATIONS.]

        **Debug Rating Justification:** [Admin-only. Explain exactly why the subject received the Final Frontal Rating and Final Side Rating in clear debugging terms. Mention the biggest score drivers and whether the non-human / AI authenticity cap was applied. Then include exactly two labeled lists: "Positive reasons:" with 15 numbered positive reasons, and "Negative reasons:" with 15 numbered negative reasons. Keep each reason short and specific to this scan. Do not mention the hidden female counterbalance rule by name.]
        """
    else:
        # FREE AI SPECIALIZED PROMPTS (No scores, ignores side profile)
        free_guidelines = """
        STRICT MANDATE: Do NOT mention, hint at, or include any numerical scores, percentages, or overall ratings in your assessment.
        Focus entirely on descriptive analysis. Use vague descriptors like 'Above Average', 'Below Average', or 'Significantly Above Average' to describe the tier if necessary.
        Do NOT use color-code wrappers like &blue&, &green&, $red$, #blue#, or @yellow@ anywhere in the output.
        PERSONALIZATION MANDATE:
        - The best feature and worst feature MUST be chosen uniquely for the submitted face.
        - Do NOT reuse generic labels or descriptions across scans.
        - Do NOT output placeholders such as "[Feature Name]", "[Brief explanation]", "Best Feature", or "Primary Flaw".
        - Every feature explanation must reference the actual visible face and/or INPUT A measurements for this scan.
        - If a visual issue is more obvious than any ratio issue, name the visual issue instead.
        DASHBOARD FEATURE FORMAT:
        After the two headline feature lines, include a dashboard-compatible block with exactly this structure:
        ### DASHBOARD_DATA
        BEST FEATURES (5):
        1. [FRONT] Actual feature name - Actual personalized reason from this face
        2. [FRONT] Actual feature name - Actual personalized reason from this face
        3. [FRONT] Actual feature name - Actual personalized reason from this face
        4. [FRONT] Actual feature name - Actual personalized reason from this face
        5. [FRONT] Actual feature name - Actual personalized reason from this face
        PRIMARY FLAWS (5):
        1. [FRONT] Actual flaw name - Actual personalized reason from this face
        2. [FRONT] Actual flaw name - Actual personalized reason from this face
        3. [FRONT] Actual flaw name - Actual personalized reason from this face
        4. [FRONT] Actual flaw name - Actual personalized reason from this face
        5. [FRONT] Actual flaw name - Actual personalized reason from this face
        """

        if choice == "3":  # OPTIC
            active_prompt = f"""{free_guidelines}
            MANDATE: Conduct a specialized evaluation focused on BALANCE and ALIGNMENT.
            INPUT A: {clinical_data}
            INPUT B: Frontal visual provided.
            {content_safety_rules}
            Focus on how features align on the vertical and horizontal planes.
            Analyze the symmetry of the orbit and jawline, the centering of the nose, and the overall structural equilibrium.
            Choose the best and worst feature using BOTH the raw measurements and the actual visual appearance.
            If a visual issue is more obvious than any ratio issue, name that instead.
            Give a brief explanation after each feature label.
            OUTPUT FORMAT:
            ### ANALYSIS [MALE or FEMALE]
            **Technical Summary:** Write a personalized balance/alignment summary for this exact face.
            **#1 BEST FEATURE:** Actual feature name - Actual personalized reason from this face.
            **#1 WORST FEATURE:** Actual flaw name - Actual personalized reason from this face.
            """
        elif choice == "4":  # CORE
            active_prompt = f"""{free_guidelines}
            MANDATE: Conduct a specialized evaluation focused on OBJECTIVE ATTRACTIVENESS.
            INPUT A: {clinical_data}
            INPUT B: Frontal visual provided.
            {content_safety_rules}
            Focus on balanced attractiveness, mass-market appeal, and 'pretty' harmony. Assess how well the features project an image of health, vitality, and aesthetic refinement. Do NOT treat aggressive dimorphism as required or automatically better; extreme masculinity should be framed as niche/limiting when it disrupts harmony.
            Choose the best and worst feature using BOTH the raw measurements and the actual visual appearance.
            If a visual issue is more obvious than any ratio issue, name that instead.
            Give a brief explanation after each feature label.
            OUTPUT FORMAT:
            ### ANALYSIS [MALE or FEMALE]
            **Technical Summary:** Write a personalized attractiveness/appeal summary for this exact face.
            **#1 BEST FEATURE:** Actual feature name - Actual personalized reason from this face.
            **#1 WORST FEATURE:** Actual flaw name - Actual personalized reason from this face.
            """
        elif choice == "5":  # GENEVA
            active_prompt = f"""{free_guidelines}
            MANDATE: Conduct a specialized evaluation focused on MATHEMATICAL BEAUTY.
            INPUT A: {clinical_data}
            INPUT B: Frontal visual provided.
            {content_safety_rules}
            Focus on Golden Ratio proportions, specific craniofacial angles (Gonial, Nasolabial), and the geometric 'perfection' of feature placement.
            Analyze the face as a series of mathematical vectors and ratios.
            Choose the best and worst feature using BOTH the raw measurements and the actual visual appearance.
            If a visual issue is more obvious than any ratio issue, name that instead.
            Give a brief explanation after each feature label.
            OUTPUT FORMAT:
            ### ANALYSIS [MALE or FEMALE]
            **Technical Summary:** Write a personalized geometry/ratio summary for this exact face.
            **#1 BEST FEATURE:** Actual feature name - Actual personalized reason from this face.
            **#1 WORST FEATURE:** Actual flaw name - Actual personalized reason from this face.
            """

    analysis_phase = (os.getenv("MOGCHECK_ANALYSIS_PHASE") or "full").strip().lower()
    if choice in {"2", "6", "7", "8", "9"} and analysis_phase == "report":
        core_analysis = read_text_context(os.getenv("MOGCHECK_CORE_ANALYSIS_PATH"), 9000)
        active_prompt = f"""
        You are MogCheck Premium Backup Model.
        {("This run uses Premium Model reasoning calibration." if choice in {"6", "7", "8", "9"} else "")}
        Generate ONLY the delayed protocols and personalized feedback for an already-scored scan.

        LOCKED_CORE_RESULT:
        {core_analysis}

        RULES:
        - Do not change or recalculate the score.
        - Use the locked score, pros, cons, weakest features, key ratios, and main limiting factor.
        - Do not ask for another image. Do not output dashboard ratings.
        - Keep advice physical/structural and specific to the locked findings.
        - Protocols must focus on improving the score by addressing the locked score-limiting weaknesses, not maintaining existing strengths.
        - Use no more than 10 surgical/procedural protocols; all remaining protocols must be non-surgical softmaxxes that can improve the score.
        - Softmax examples include eyebrow dermastamping/minoxidil, volufiline, hairstyle/grooming changes, caffeine eye serums, skincare, conditioning, fat loss, and styling.
        - Makeup protocol cap: male subjects max 2 makeup protocols such as subtle eyeshadow or concealer; female subjects max 5.
        - If the face does not already show at least slight hollow cheeks / clear cheek leanness, one protocol must explicitly recommend getting leaner or reducing facial fat to improve definition.
        - Avoid generic maintenance filler unless it clearly improves a limiting issue found in the scan.

        RETURN JSON ONLY. No markdown. No prose outside JSON.
        Schema:
        {{
          "personalizedFeedback":[{{"title":"", "description":""}}],
          "protocols":[{{"name":"", "description":"", "impact":"High Impact|Medium Impact|Low Impact"}}],
          "reportDebugJustification":"one compact sentence confirming protocols align with locked core result"
        }}
        Limits: exactly 5 personalizedFeedback items, exactly 20 protocols. Each description max 26 words.
        """
    elif choice == "1" and analysis_phase == "core":
        feedback_marker = "### Personalised feedback"
        audit_marker = "### MOG_REPORT_REVISION"
        if feedback_marker in active_prompt:
            prompt_before_feedback = active_prompt.split(feedback_marker, 1)[0]
            prompt_audit_tail = ""
            if audit_marker in active_prompt:
                prompt_audit_tail = f"{audit_marker}{active_prompt.split(audit_marker, 1)[1]}"
            active_prompt = f"""{prompt_before_feedback}

        CORE SCORING SELF-AUDIT:
        Before writing the final score, internally perform the same strict full Premium reasoning you would have used in the old unsplit one-pass analysis.
        Do not inflate the rating because the output is shorter.
        Do not skip hidden consistency checks, score-driver checks, uncanny/synthetic checks, aging/soft-tissue checks, or flaw severity checks.
        The Final Frontal Rating and Final Side Rating must match the score you would give if Personalised feedback and ACTIONABLE PROTOCOLS were also being generated in this same request.

        {prompt_audit_tail}
        """
        active_prompt = f"""{active_prompt}

        SPLIT DELIVERY MODE - CORE RESULT ONLY:
        Do NOT output Personalised feedback or ACTIONABLE PROTOCOLS in this pass.
        Keep the strict MOG_REPORT_REVISION and Debug Rating Justification audit if present.
        The detailed report will be generated in a second background request after the dashboard score is already visible.
        """
    elif choice == "1" and analysis_phase == "report":
        core_analysis = read_text_context(os.getenv("MOGCHECK_CORE_ANALYSIS_PATH"), 32000)
        report_visual_inputs = "VISUAL INPUT A: High-resolution frontal image provided."
        if side_img_path and os.path.exists(side_img_path):
            report_visual_inputs += "\n        VISUAL INPUT B: High-resolution side profile image provided."
        report_side_policy = """
        REPORT FRONT-ONLY MODE:
        No side profile image was provided. Keep all advice frontal-only and do not mention side-profile findings.
        """ if not has_side_profile else """
        REPORT SIDE PROFILE MODE:
        A side profile image was provided. You may include side-profile advice when it matches the locked core analysis.
        """
        active_prompt = f"""
        MANDATE: Generate ONLY the delayed detailed report for an already-scored Premium analysis.
        INPUT A (Frontal Metadata): {prompt_clinical_data}
        INPUT B (Side Profile Metadata): {prompt_side_data}
        INPUT C (Core Analysis Already Returned): {core_analysis}
        {report_visual_inputs}
        {content_safety_rules}
        {report_side_policy}

        STRICT CONTINUITY RULES:
        - Treat INPUT C as locked. Do not change, recalculate, or restate the final score, side score, categories, hexagon ratings, best features, primary flaws, or biometrics.
        - Build all advice and protocols from the exact weaknesses and strengths already identified in INPUT C plus the submitted visuals.
        - Do not output dashboard data, ratings, category tables, MOG_REPORT_REVISION, or new score sections.
        - If a side profile was not provided, keep advice frontal-only and do not mention side-profile findings.
        - Protocols must focus on improving the score by addressing score-limiting weaknesses, not preserving strengths.
        - Use no more than 10 surgical/procedural protocols; all remaining protocols must be non-surgical softmaxxes that can improve the score.
        - Softmax examples include eyebrow dermastamping/minoxidil, volufiline, hairstyle/grooming changes, caffeine eye serums, skincare, conditioning, fat loss, and styling.
        - Makeup protocol cap: male subjects max 2 makeup protocols such as subtle eyeshadow or concealer; female subjects max 5.
        - If the face does not already show at least slight hollow cheeks / clear cheek leanness, one protocol must explicitly recommend getting leaner or reducing facial fat to improve definition.
        - Minimize maintenance-only advice unless it directly improves a weakness that held the score down.

        OUTPUT FORMAT:
        ### Personalised feedback
        Provide exactly 5 pieces of personalized advice based on the user's submitted images and INPUT C.
        Format each as a numbered list item with a capitalized title. Each piece must be 1-3 paragraphs max.
        Focus strictly on real-world, physical issues and changes rather than lighting, posing, or generic grooming.
        Be explicit about what is causing the problem and what realistic fix or improvement path applies.

        ### ACTIONABLE PROTOCOLS
        List exactly 20 actionable protocols sorted from highest impact to lowest impact.
        Address frontal and lateral structural issues only when the relevant image/profile was provided.
        Make each protocol an improvement path tied to a specific limiting feature or ratio from INPUT C.
        Format every protocol exactly:
        1. [Protocol Name]: [Description].
        [Impact Rating]

        **Debug Rating Justification:** Explain why the already-returned score from INPUT C makes sense. Mention the biggest score drivers and whether any authenticity/uncanny cap was applied. Keep this aligned with INPUT C and do not invent a new score.
        """

    result, model_used, duration = consult_ai_with_selection(
        active_prompt,
        temp_analysis_path,
        choice,
        side_img_path if has_side_profile else None
    )

    if result == "CANCELLED":
        return

    print("\n" + "=" * 40 + "\nOFFICIAL RATING\n" + "=" * 40)
    print(f"[Using: {model_used} | Latency: {duration}s]")
    print(result)
    return result


if __name__ == "__main__":
    img_target = sys.argv[1] if len(sys.argv) > 1 else "test.jpg"
    model_choice = sys.argv[2] if len(sys.argv) > 2 and str(sys.argv[2]).strip() else None
    clinical_arg = sys.argv[3] if len(sys.argv) > 3 and str(sys.argv[3]).strip() else None
    side_img_arg = sys.argv[4] if len(sys.argv) > 4 and str(sys.argv[4]).strip() else None
    run_final_stack(img_target, clinical_arg, model_choice, side_img_arg)
