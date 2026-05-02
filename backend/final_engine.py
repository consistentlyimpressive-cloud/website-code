import os
import cv2
import time
import base64
import numpy as np
import sys
import json
import random
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
GEMMA_PER_KEY_TIMEOUT_MS = int(os.getenv("GEMMA_PER_KEY_TIMEOUT_MS") or "186000")
_raw_disabled_keys = os.getenv("GEMINI_DISABLED_KEYS") or "1,3"
GEMINI_DISABLED_KEYS = {
    int(part)
    for part in _raw_disabled_keys.replace(" ", "").split(",")
    if part.isdigit()
}
KEY_HEALTH_STATE_PATH = Path(__file__).resolve().parent / "key-health-state.json"

BENCHMARK_CALIBRATION_PATH = Path(__file__).resolve().parent / "gemini-benchmark-calibration.json"


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


def _healthy_key_attempts():
    state = _load_key_health_state()
    _save_key_health_state(state)
    quarantines = state.get("quarantines") if isinstance(state.get("quarantines"), dict) else {}
    now_ms = _utc_now_ms()
    attempts = []
    skipped = []

    for key_index, key in GOOGLE_GENAI_KEYS:
        if key_index in GEMINI_DISABLED_KEYS:
            skipped.append(f"GEMINI_KEY_{key_index}:disabled")
            continue
        quarantine = quarantines.get(str(key_index))
        if quarantine and int(quarantine.get("untilMs") or 0) > now_ms:
            skipped.append(f"GEMINI_KEY_{key_index}:quarantined")
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
            "1": ("gemma-4-31b-it", "ULTRA - Highest Quality"),
            "3": ("gemma-4-26b-a4b-it", "OPTIC"),
            "4": ("gemma-4-26b-a4b-it", "CORE"),
            "5": ("gemma-4-26b-a4b-it", "GENEVA")
        }

        if choice not in mapping:
            return "Error: Model selection failed.", "None", 0

        model_id, friendly_name = mapping[choice]

        print(f"[DEBUG] Consulting {friendly_name}... (Press Ctrl+C to Cancel)")
        if not GOOGLE_GENAI_KEYS:
            return (
                "Error: No Google GenAI keys are configured in backend/.env. Add GEMINI_KEY_1 or more keys for Gemma.",
                friendly_name,
                0,
            )

        provider_errors = []
        key_attempts = _healthy_key_attempts()
        random.shuffle(key_attempts)
        if not key_attempts:
            return (
                "Error: No healthy Google GenAI/Gemma keys are available. All keys are disabled or quarantined.",
                friendly_name,
                0,
            )
        print(f"[DEBUG] Gemma key order this scan: {', '.join(f'GEMINI_KEY_{index}' for index, _ in key_attempts)}")
        for attempt_number, (key_index, key) in enumerate(key_attempts, start=1):
            if not key:
                continue
            try:
                print(f"[DEBUG] Trying Google GenAI/Gemma GEMINI_KEY_{key_index} ({attempt_number}/{len(key_attempts)})...")
                client = genai.Client(api_key=key, http_options=types.HttpOptions(timeout=GEMMA_PER_KEY_TIMEOUT_MS))
                with open(img_path, "rb") as f:
                    image_bytes = f.read()
                contents = [
                    types.Part.from_text(text=unified_prompt),
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
                ]
                if side_img_path and os.path.exists(side_img_path):
                    with open(side_img_path, "rb") as f:
                        side_image_bytes = f.read()
                    contents.append(types.Part.from_bytes(data=side_image_bytes, mime_type="image/jpeg"))
                res = client.models.generate_content(
                    model=model_id,
                    config=types.GenerateContentConfig(temperature=0),
                    contents=contents
                )
                if res.text:
                    duration = round(time.time() - start_time, 2)
                    return res.text, friendly_name, duration
                provider_errors.append(f"GEMINI_KEY_{key_index}: empty model response")
                _quarantine_key(key_index, "empty_response", "empty model response", 10 * 60 * 1000)
            except Exception as e:
                if "User interrupted" in str(e):
                    raise
                error_text = str(e).replace("\n", " ").strip()
                short_error = error_text[:260] if error_text else "Unknown provider error"
                provider_errors.append(f"GEMINI_KEY_{key_index}: {short_error}")
                quota_hit = "RESOURCE_EXHAUSTED" in error_text or "quota" in error_text.lower()
                quarantine_reason, quarantine_ms = _quarantine_for_error(error_text)
                if quarantine_reason:
                    _quarantine_key(key_index, quarantine_reason, short_error, quarantine_ms)
                if quota_hit:
                    print(f"      [!] {friendly_name} Google GenAI GEMINI_KEY_{key_index} quota exhausted. Trying next key...")
                else:
                    print(f"      [!] {friendly_name} GEMINI_KEY_{key_index} failed: {short_error}")
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
    print("1. ULTRA - Highest Quality")
    print("-" * 30)
    print("3. OPTIC (Balance & Alignment)")
    print("4. CORE (Objective Attractiveness)")
    print("5. GENEVA (Mathematical Beauty)")

    if choice_override is not None and str(choice_override).strip():
        choice = str(choice_override).strip()
        print(f"\n[DEBUG] Model selected via API args: {choice}")
    else:
        try:
            choice = input("\nSelect Model [1, 3-5]: ").strip()
        except KeyboardInterrupt:
            print("\nExiting script...")
            return

    if choice not in {"1", "3", "4", "5"}:
        print(f"[ERROR] Invalid model choice: {choice}")
        return "Error: Model selection failed."

    # --- SIDE PROFILE DATA COLLECTION ---
    side_data = "IGNORE_SIDE_ANALYSIS"
    if choice == "1":
        print("[ðŸš€] Gathering Lateral Data from engineside.py...")
        if side_img_path and os.path.exists(side_img_path):
            try:
                side_data = engineside.get_profile_analysis(side_img_path)
            except Exception:
                side_data = "Lateral metadata unavailable. Focus on frontal visuals and input."
        else:
            side_data = "IGNORE_SIDE_ANALYSIS"
    has_side_profile = bool(
        choice == "1" and side_img_path and os.path.exists(side_img_path) and side_data != "IGNORE_SIDE_ANALYSIS"
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
    """ if choice == "1" else ""
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

    # --- PROMPT SELECTION LOGIC ---
    if choice == "1":
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
        **Hexagon Chart Ratings (front)**
        - Skin: [Score 1-10]
        - Bone: [Score 1-10]
        - Harmony: [Score 1-10]
        - Symmetry: [Score 1-10]
        - Dimorphism: [Score 1-10]

        **Hexagon Chart Ratings (side)**
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
        [Look at the following data from INPUT A (mog_report) and rate them from 1-100 using the global baseline curves above, with ethnicity/sex tolerance adjustments. If hair, bangs, hats, hood, cropping, or shadow covers the hairline, ignore the MediaPipe Upper_Third_Length number and visually estimate the natural hairline position before scoring Upper_Third_Length. For Bigonial_Width_Index, score on a curve: around 0.87 should be in the 80s, the score should approach 100 near 0.98, below 0.75 is a flaw, and above 1.05 deducts for over-width/blockiness. For IPD_Index (Geometric), score around 0.46 closest to 100, keep 0.44-0.48 acceptable-to-good, below 0.44 close-set, and above 0.48 wide-set. For Mouth_Width_Index, score around 0.37 closest to 100, keep 0.36-0.38 acceptable-to-ideal, below 0.36 narrow, and above 0.38 overly wide.]
        - Bigonial_Width_Index: [Score]/100
        - IPD_Index (Geometric): [Score]/100
        - Mouth_Width_Index: [Score]/100
        - Nose_Width_Index: [Score]/100
        - Upper_Third_Length: [Score]/100
        - Middle_Third_Length: [Score]/100
        - Lower_Third_Length: [Score]/100
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
        [List exactly 25 actionable protocols.
        Sorted from HIGHEST IMPACT to LOWEST IMPACT.]
        [Address both Frontal and Lateral structural issues based on the dual analysis.]
        1. [Protocol Name]: [Description].
        [Impact Rating]
        ...
        25. [Protocol Name]: [Description].
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
