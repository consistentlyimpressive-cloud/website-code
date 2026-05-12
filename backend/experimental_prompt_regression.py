import argparse
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))


def load_runs(limit):
    runs = sorted((BACKEND_DIR / "tmp-analysis").glob("scan-*"), key=lambda p: p.stat().st_mtime, reverse=True)
    usable = []
    for run in runs:
        if not (run / "mog_report.txt").exists():
            continue
        if not (run / "temp_analysis.jpg").exists():
            continue
        usable.append(run)
        if len(usable) >= limit:
            break
    return usable


def capture_prompt(final_engine, run, choice, phase, variant=None):
    old_phase = os.environ.get("MOGCHECK_ANALYSIS_PHASE")
    old_output_dir = os.environ.get("MOGCHECK_RUN_OUTPUT_DIR")
    old_core_path = os.environ.get("MOGCHECK_CORE_ANALYSIS_PATH")
    old_variant = os.environ.get("MOGCHECK_EXPERIMENTAL_PROMPT_VARIANT")
    out_dir = Path(tempfile.mkdtemp(prefix="mogcheck-regression-"))
    os.environ["MOGCHECK_ANALYSIS_PHASE"] = phase
    os.environ["MOGCHECK_RUN_OUTPUT_DIR"] = str(out_dir)
    if variant:
        os.environ["MOGCHECK_EXPERIMENTAL_PROMPT_VARIANT"] = variant
    if phase == "report":
        core_path = run / "core_output.txt"
        if core_path.exists():
            os.environ["MOGCHECK_CORE_ANALYSIS_PATH"] = str(core_path)

    captured = {}
    original_consult = final_engine.consult_ai_with_selection
    original_animation = getattr(final_engine, "generate_scan_animation", None)

    def fake_consult(prompt, img_path, model_choice, side_img_path=None):
        captured["prompt"] = prompt
        captured["img_path"] = img_path
        captured["side_img_path"] = side_img_path
        return "{}", "fake", 0

    final_engine.consult_ai_with_selection = fake_consult
    if original_animation:
        final_engine.generate_scan_animation = lambda *args, **kwargs: None

    try:
        clinical = (run / "mog_report.txt").read_text(encoding="utf-8", errors="ignore")
        final_engine.run_final_stack(str(run / "temp_analysis.jpg"), clinical, choice, "")
    finally:
        final_engine.consult_ai_with_selection = original_consult
        if original_animation:
            final_engine.generate_scan_animation = original_animation
        if old_phase is None:
            os.environ.pop("MOGCHECK_ANALYSIS_PHASE", None)
        else:
            os.environ["MOGCHECK_ANALYSIS_PHASE"] = old_phase
        if old_output_dir is None:
            os.environ.pop("MOGCHECK_RUN_OUTPUT_DIR", None)
        else:
            os.environ["MOGCHECK_RUN_OUTPUT_DIR"] = old_output_dir
        if old_core_path is None:
            os.environ.pop("MOGCHECK_CORE_ANALYSIS_PATH", None)
        else:
            os.environ["MOGCHECK_CORE_ANALYSIS_PATH"] = old_core_path
        if old_variant is None:
            os.environ.pop("MOGCHECK_EXPERIMENTAL_PROMPT_VARIANT", None)
        else:
            os.environ["MOGCHECK_EXPERIMENTAL_PROMPT_VARIANT"] = old_variant

    return captured


def parse_rating(output):
    text = str(output or "")
    patterns = [
        r"Final Frontal Rating:\s*(\d+(?:\.\d+)?)",
        r"Final Rating:\s*(\d+(?:\.\d+)?)",
        r'"finalRating"\s*:\s*(\d+(?:\.\d+)?)',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return float(match.group(1))
    return None


def extract_json(raw):
    text = str(raw or "")
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        ch = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:index + 1])
                except Exception:
                    return None
    return None


def summarize_live_output(output, choice):
    data = extract_json(output) if choice == "2" else None
    return {
        "rating": data.get("finalRating") if isinstance(data, dict) else parse_rating(output),
        "tier": data.get("tier") if isinstance(data, dict) else None,
        "metric_count": len(data.get("keyRatios") or data.get("metrics") or []) if isinstance(data, dict) else None,
        "strengths": [item.get("title") for item in (data.get("bestFeatures") or [])[:5] if isinstance(item, dict)] if isinstance(data, dict) else None,
        "weaknesses": [item.get("title") for item in (data.get("primaryFlaws") or [])[:5] if isinstance(item, dict)] if isinstance(data, dict) else None,
        "main_limiting_factor": data.get("mainLimitingFactor") if isinstance(data, dict) else None,
        "json_valid": isinstance(data, dict) if choice == "2" else None,
        "raw_chars": len(str(output or "")),
    }


def run_live(final_engine, run, choice, variant=None):
    out_dir = Path(tempfile.mkdtemp(prefix="mogcheck-live-regression-"))
    old_phase = os.environ.get("MOGCHECK_ANALYSIS_PHASE")
    old_output_dir = os.environ.get("MOGCHECK_RUN_OUTPUT_DIR")
    old_variant = os.environ.get("MOGCHECK_EXPERIMENTAL_PROMPT_VARIANT")
    os.environ["MOGCHECK_ANALYSIS_PHASE"] = "core"
    os.environ["MOGCHECK_RUN_OUTPUT_DIR"] = str(out_dir)
    if variant:
        os.environ["MOGCHECK_EXPERIMENTAL_PROMPT_VARIANT"] = variant
    try:
        clinical = (run / "mog_report.txt").read_text(encoding="utf-8", errors="ignore")
        started = time.time()
        output = final_engine.run_final_stack(str(run / "temp_analysis.jpg"), clinical, choice, "")
        elapsed = round(time.time() - started, 2)
        summary = summarize_live_output(output, choice)
        summary["elapsed_s"] = elapsed
        return summary
    finally:
        if old_phase is None:
            os.environ.pop("MOGCHECK_ANALYSIS_PHASE", None)
        else:
            os.environ["MOGCHECK_ANALYSIS_PHASE"] = old_phase
        if old_output_dir is None:
            os.environ.pop("MOGCHECK_RUN_OUTPUT_DIR", None)
        else:
            os.environ["MOGCHECK_RUN_OUTPUT_DIR"] = old_output_dir
        if old_variant is None:
            os.environ.pop("MOGCHECK_EXPERIMENTAL_PROMPT_VARIANT", None)
        else:
            os.environ["MOGCHECK_EXPERIMENTAL_PROMPT_VARIANT"] = old_variant


def main():
    parser = argparse.ArgumentParser(description="Compare old Premium, legacy 7k experimental, and calibration-preserving experimental core prompts.")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--live", action="store_true", help="Run real Gemma generations for old and experimental core. This can consume many API requests.")
    args = parser.parse_args()

    import final_engine

    rows = []
    for run in load_runs(args.limit):
        old_capture = capture_prompt(final_engine, run, "1", "core")
        legacy_capture = capture_prompt(final_engine, run, "2", "core", variant="7k")
        calibration_capture = capture_prompt(final_engine, run, "2", "core", variant="calibration")
        old_prompt = old_capture.get("prompt") or ""
        legacy_prompt = legacy_capture.get("prompt") or ""
        calibration_prompt = calibration_capture.get("prompt") or ""
        image_tokens = final_engine.estimate_image_tokens(calibration_capture.get("img_path"))
        row = {
            "run": run.name,
            "old_prompt_est_tokens": final_engine.estimate_text_tokens(old_prompt) + image_tokens,
            "legacy_7k_prompt_est_tokens": final_engine.estimate_text_tokens(legacy_prompt) + image_tokens,
            "calibration_prompt_est_tokens": final_engine.estimate_text_tokens(calibration_prompt) + image_tokens,
            "core_output_cap": 1500,
            "image_tokens": image_tokens,
        }
        if args.live:
            old_live = run_live(final_engine, run, "1")
            legacy_live = run_live(final_engine, run, "2", variant="7k")
            calibration_live = run_live(final_engine, run, "2", variant="calibration")
            row["old_live"] = old_live
            row["legacy_7k_live"] = legacy_live
            row["calibration_live"] = calibration_live
            if old_live.get("rating") is not None and legacy_live.get("rating") is not None:
                row["legacy_7k_rating_delta"] = round(float(legacy_live["rating"]) - float(old_live["rating"]), 2)
            if old_live.get("rating") is not None and calibration_live.get("rating") is not None:
                row["calibration_rating_delta"] = round(float(calibration_live["rating"]) - float(old_live["rating"]), 2)
        rows.append(row)

    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
