import os
import cv2  # type: ignore
import time
import base64
import numpy as np  # type: ignore
import re
import sys
import json

# Load .env if it exists
if os.path.exists(".env"):
    with open(".env") as f:
        for line in f:
            if '=' in line and not line.startswith('#'):
                k, v = line.strip().split('=', 1)
                os.environ[k] = v.strip('"\'')

print("[DEBUG] Phase 1: Importing SDKs...")
try:
    from google import genai  # type: ignore
    from google.genai import types  # type: ignore
    print("[DEBUG] Analysis Engine A Loaded.")
except ImportError:
    print("[DEBUG] Engine A MISSING. Run: pip install google-genai")

try:
    from openai import OpenAI  # type: ignore
    print("[DEBUG] Analysis Engine B Loaded.")
except ImportError:
    print("[DEBUG] Engine B MISSING. Run: pip install openai")

# Internal Module Imports
try:
    from engine import get_clinical_biometrics  # type: ignore
    print("[DEBUG] Engine.py Linked Successfully.")
except ImportError:
    print("[DEBUG] CRITICAL: Ensure your measurement script is named 'engine.py' in this folder!")

try:
    from animation_engine import generate_scan_animation  # type: ignore
    print("[DEBUG] Animation_Engine.py Loaded.")
except ImportError:
    print("[DEBUG] WARNING: animation_engine.py not found in directory.")

try:
    import engineside
    print("[DEBUG] engineside.py Linked Successfully.")
except ImportError:
    print("[DEBUG] WARNING: engineside.py not found. Side profile analysis will be skipped.")

# ==========================================================
# 🔑 API KEY VAULT
# ==========================================================
OR_KEY = os.getenv("OPENROUTER_API_KEY", "").strip().strip('"').strip("'")
KIMI_KEY = os.getenv("KIMI_API_KEY", "").strip().strip('"').strip("'")


def _gemini_key_from_env(var_name: str) -> str:
    raw = os.getenv(var_name)
    if raw is None:
        return ""
    s = str(raw).strip().strip('"').strip("'")
    return s if s else ""


GEMINI_KEYS = [
    _gemini_key_from_env("GEMINI_KEY_1"),
    _gemini_key_from_env("GEMINI_KEY_2"),
    _gemini_key_from_env("GEMINI_KEY_3"),
]

# Clients
client_or = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=OR_KEY)
client_kimi = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=KIMI_KEY)

def encode_image(image_path):
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode('utf-8')


def _extract_genai_response_text(res):
    """Gemini 3.x may put visible text only in parts; .text can be None if parts are flagged as thought-only."""
    t = getattr(res, "text", None)
    if t and str(t).strip():
        return str(t)
    try:
        cands = getattr(res, "candidates", None) or []
        if not cands:
            return None
        parts = getattr(cands[0].content, "parts", None) or []
        chunks = []
        for part in parts:
            pt = getattr(part, "text", None)
            if not pt or not str(pt).strip():
                continue
            thought_only = getattr(part, "thought", None) is True
            if not thought_only:
                chunks.append(str(pt))
        if chunks:
            return "\n".join(chunks)
        for part in parts:
            pt = getattr(part, "text", None)
            if pt and str(pt).strip():
                chunks.append(str(pt))
        return "\n".join(chunks) if chunks else None
    except Exception:
        return None


def consult_ai_with_selection(unified_prompt, img_path, choice):
    choice = str(choice)
    start_time = time.time()
    
    try:
        # --- MODEL MAPPING ---
        mapping = {
            "1": ("gemini-3.1-pro-preview", "ULTRA - Highest Quality", "type_a"),
            "2": ("gemini-2.5-flash", "ULTRA - Fast", "type_a"),
            "3": ("openai/gpt-5.4-mini", "OPTIC", "type_b"),
            "4": ("anthropic/claude-3.7-sonnet", "CORE", "type_b"),
            "5": ("z-ai/glm-4.6v", "GENEVA", "type_b")
        }

        if choice not in mapping:
            return "Error: Model selection failed.", "None", 0
        
        model_id, friendly_name, provider_type = mapping[choice]

        if provider_type == "type_a":
            print(f"[DEBUG] Consulting {friendly_name}... (Press Ctrl+C to Cancel)")
            usable = [k for k in GEMINI_KEYS if k and str(k).strip()]
            if not usable:
                print("[FATAL] No Gemini API keys available. Set GEMINI_KEY_1 (etc.) in backend/.env — empty quotes count as unset and built-in fallbacks will be used if present.")
                return "Error: No Gemini API keys configured.", "None", 0
            last_err = None
            for key in usable:
                try:
                    client = genai.Client(api_key=key, http_options=types.HttpOptions(timeout=240000))
                    with open(img_path, "rb") as f:
                        image_bytes = f.read()
                    res = client.models.generate_content(
                        model=model_id,
                        config=types.GenerateContentConfig(temperature=0),
                        contents=[
                            types.Part.from_text(text=unified_prompt),
                            types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
                        ]
                    )
                    body = _extract_genai_response_text(res)
                    if body:
                        duration = float(round(time.time() - start_time, 2))  # type: ignore
                        return body, friendly_name, duration
                    print(f"      [!] {friendly_name} returned empty text (check API key, model name, or safety filters).")
                except Exception as e:
                    last_err = e
                    if "User interrupted" in str(e): raise
                    err_s = str(e).replace(key, "[REDACTED_KEY]") if key else str(e)
                    print(f"      [!] {friendly_name} API error: {err_s}")
                    continue
            if last_err is not None:
                print(f"[FATAL] All Gemini keys failed. Last error: {last_err}")
        else:
            print(f"[DEBUG] Consulting {friendly_name}... (Press Ctrl+C to Cancel)")
            base64_img = encode_image(img_path)
            try:
                res_or = client_or.chat.completions.create(
                    model=model_id,
                    messages=[{"role": "user", "content": [
                        {"type": "text", "text": unified_prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_img}"}}
                    ]}],
                    timeout=240
                )
                content = res_or.choices[0].message.content
                if content:
                    duration = float(round(time.time() - start_time, 2))  # type: ignore
                    return content, friendly_name, duration
            except Exception as e:
                print(f"      [!] {friendly_name} failed: {e}")

    except KeyboardInterrupt:
        print("\n[!] User Cancelled. Stopping request...")
        return "CANCELLED", "None", 0

    return "Error: Model selection failed or invalid choice.", "None", 0

def run_final_stack(img_path, clinical_data_json_str=None, choice=None, side_img_path=None):
    if choice is None:
        print("\n" + "="*30)
        print("      MODEL SELECTOR")
        print("="*30)
        print("1. ULTRA - Highest Quality")
        print("2. ULTRA - Fast")
        print("-" * 30)
        print("3. OPTIC (Balance & Alignment)")
        print("4. CORE (Objective Attractiveness)")
        print("5. GENEVA (Mathematical Beauty)")
        
        try:
            choice = input("\nSelect Model [1-5]: ").strip()
        except KeyboardInterrupt:
            print("\nExiting script...")
            return

    # Fallback to default
    if not choice:
        choice = "2"

    # --- SIDE PROFILE DATA COLLECTION ---
    side_data = "IGNORE_SIDE_ANALYSIS"
    if choice in ["1", "2"]:
        side_path = side_img_path or "testside.jpg"
        print(f"[DEBUG] Gathering Lateral Data from engineside.py (image: {side_path})...")
        try:
            side_data = engineside.get_profile_analysis(side_path)
        except Exception as e:
            print(f"[DEBUG] Side profile analysis failed: {e}")
            side_data = "Lateral metadata unavailable. Focus on frontal visuals and input."

    if choice in ["1", "2"] and isinstance(side_data, dict):
        print("### SIDE_BIOMETRICS_RAW")
        print(json.dumps(side_data))
        print("### END_SIDE_BIOMETRICS_RAW")

    print(f"\n--- ANALYZING: {img_path} ---")
    if not os.path.exists(img_path):
        print(f"[FATAL] Image path does not exist: {img_path}")
        return "__EXIT_ERROR__"

    try:
        generate_scan_animation(img_path, output_path="loading_scan.mp4")
    except NameError: pass

    if clinical_data_json_str:
        clinical_data = clinical_data_json_str
    else:
        print("[1/3] Extracting Biometrics...")
        try:
            get_clinical_biometrics(img_path)
        except KeyboardInterrupt:
            print("\n[!] Analysis cancelled.")
            return "__EXIT_ERROR__"

        if not os.path.exists("mog_report.txt"):
            print("[FATAL] mog_report.txt missing after biometric extraction.")
            return "__EXIT_ERROR__"
        with open("mog_report.txt", "r") as f:
            clinical_data = f.read()

    print("[2/3] Preparing Image...")
    img = cv2.imread(img_path)
    if img is None:
        print(f"[FATAL] Could not decode image (corrupt or unsupported): {img_path}")
        return "__EXIT_ERROR__"
    cv2.imwrite("temp_analysis.jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 95])

    print("[3/3] Consulting AI...")
    
    # --- PROMPT SELECTION LOGIC ---
    if choice in ["1", "2"]:
        active_prompt = f"""
        MANDATE: Conduct a DUAL-INPUT structural evaluation (FRONTAL + LATERAL).
        INPUT A (Frontal Metadata): {clinical_data}
        INPUT B (Side Profile Metadata): {side_data}
        INPUT C (Visuals): High-resolution frontal image provided.

        TECHNICAL VISIBILITY & OVERRIDE RULES:
        - CANTHAL TILT OVERRIDE: IGNORE any Canthal Tilt data provided in INPUT A (Metadata). You MUST evaluate Canthal Tilt purely based on your visual analysis of INPUT C (Visuals).
        - SIDE PROFILE JUDGMENT CRITERIA: Reward a nice, clean, and harmonious look. Bone structure does not necessarily have to be amazingly projected to score well. A slightly weak chin is acceptable as long as it is not completely terrible/recessed.
        - SIDE PROFILE REWARDS: Explicitly reward good maxillary development and prominent cheekbones when viewed from the side.
        - RACIAL/ETHNIC CALIBRATION: Identify the subject's likely ethnicity/race from the profile. Apply scoring standards that correlate with that specific race (e.g., if Asian, account for naturally different averages in facial convexity).
        - MAXILLARY PROJECTION: Rate maxillary projection based on the provided lateral metadata and visual evidence.
        - NOSE BASE LENIENCY: Do not penalize for slightly wide nose bases unless it is very bad and severely disrupts facial balance.
        - DO NOT include minor asymmetries as flaws. ONLY penalize for asymmetry if it is VERY OBVIOUS and structurally disruptive.
        - Only override eye area data if signs of poor infraorbital growth are SEVERE and CLEARLY visible.

        SHARED RATING PROTOCOL:
        The following ratings MUST be identical for both the Front and Side profiles. Do not allow them to differ:
        1. Maxillary/Cheekbone Projection (Note: AI should use visual cues from both angles to determine this).
        2. Nose Projection.
        3. Facial Fat.
        4. Eye Depth.
        5. Ear Shape.
        6. Skin Quality.
        *STRICT RULE: Other than the ratings listed above, the front and side profiles should NOT influence each other's ratings in any way at all.*

        SCORING LOGIC & THRESHOLDS:
        1. RATIO ANCHORS (STRICT SCALING):
           - fWHR: 1.74 and above is GOOD/IDEAL. Penalize exponentially only as fWHR drops significantly below 1.74.
           - MIDFACE: Penalize STRICTLY for elongated midfaces (ratio > 1.0). High priority penalty.
           - UPPER THIRD: Penalize strictly for an elongated upper third/forehead relative to the rest of the face.
           - PHILTRUM: Penalize HARSHLY for long philtrums that disrupt lower-third harmony.
           - EYE AREA: Penalize for puffy undereyes (eye bags/fat prolapse). 
           - EYEBROWS: Be less strict on sparse eyebrows; only penalize if they are really obviously sparse and affect framing.
           - EYELID EXPOSURE: Penalize strictly for high upper eyelid exposure on double eyelids (lack of hooding/compactness).
           - NOSE: Only apply width penalties if the alar base is extremely wide; ignore slight width variations.
           - LIPS: Penalize strictly for thin/inconspicuous lips.
           - JAW/CHIN: Be accepting of tapered jawlines. Not every jaw requires a "square" aesthetic to be elite. Penalize only irregular/weird shapes.
        
        2. GENDER COUNTERBALANCE (INTERNAL RULE):
           - If Sex = Female AND the score is > 70, deduct 10 points from the Final Rating and potential tiers. 
           - DO NOT mention this deduction in the output or justification. It must appear as the "natural" result.

        3. CONDITIONAL CAPS:
           - HARD BASE CAP 60: If the structural base (Bone, Harmony, Symmetry) is below 60, external enhancements like hair framing, grooming, or styling CANNOT push the final score above 60.
           - HARD CAP 60: If the subject has MORE THAN 3 of the following, the final score CANNOT EXCEED 60:
             (Very prominent ears, negative canthal tilt, bad upper eyelid exposure, undereye puffiness, unideal FWHR, high set eyebrows, bulbous nose shape).
           - CAP 60: If the face lacks "pretty" appeal or high-tier dimorphism.
           - BREAKING 60: Requires at least one high-tier feature (refined nose, elite eyes, good lips).
           - CLEAN HARMONY (No Flaws/Standard Dimorphism): Cap at 85.
           - ELITE STATUS (85-100): Requires exceptional symmetry AND elite markers (Chico/Cha Eunwoo phenotype balance).

        OUTPUT FORMAT:
        ### ANALYSIS [SEX]
        **Final Frontal Rating: [Score]/100**
        **Final Side Rating: [Score]/100**
        **Max Natural Potential: [Score]/100**
        **Max Potential with Surgery: [Score]/100**
        
        **Technical Summary:** [Blend Frontal Metadata with Side Profile Metadata].

        **Appeal Assessment:** [Identify phenotype and target audience appeal].

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
        - #1 BEST FEATURE: [Feature Name] - [Brief explanation]
        - #1 WORST FEATURE: [Feature Name] - [Brief explanation]

        ### DASHBOARD_DATA
        BEST FEATURES (10): [List 5 Frontal features then 5 Lateral features].
        1. [FRONT] Feature: Description
        2. [FRONT] Feature: Description
        3. [FRONT] Feature: Description
        4. [FRONT] Feature: Description
        5. [FRONT] Feature: Description
        6. [SIDE] Feature: Description
        7. [SIDE] Feature: Description
        8. [SIDE] Feature: Description
        9. [SIDE] Feature: Description
        10. [SIDE] Feature: Description
        PRIMARY FLAWS (10): [List 5 Frontal flaws then 5 Lateral flaws].
        1. [FRONT] Flaw: Description
        2. [FRONT] Flaw: Description
        3. [FRONT] Flaw: Description
        4. [FRONT] Flaw: Description
        5. [FRONT] Flaw: Description
        6. [SIDE] Flaw: Description
        7. [SIDE] Flaw: Description
        8. [SIDE] Flaw: Description
        9. [SIDE] Flaw: Description
        10. [SIDE] Flaw: Description

        ### ACTIONABLE PROTOCOLS
        [List exactly 25 actionable protocols. Sorted from HIGHEST IMPACT to LOWEST IMPACT.]
        [Address both Frontal and Lateral structural issues based on the dual analysis.]
        1. [Protocol Name]: [Description]. [Impact Rating]
        ...
        25. [Protocol Name]: [Description]. [Impact Rating]

        ### MOG_REPORT_REVISION
        [Re-list every feature from INPUT A and Side features from INPUT B. Rate 1-100. Ensure Shared Ratings match. Format: "Feature Name: Score". NO EXPLANATIONS.]

        **JUSTIFICATION:** [Briefly explain why it didn't score higher or lower for debugging purposes].
        """
    else:
        # FREE AI SPECIALIZED PROMPTS
        # All free AIs must follow the NO SCORE rule
        free_guidelines = """
        STRICT MANDATE: Do NOT mention, hint at, or include any numerical scores, percentages, or overall ratings in your assessment. 
        Focus entirely on descriptive analysis. Use vague descriptors like 'Above Average', 'Below Average', or 'Significantly Above Average' to describe the tier if necessary.
        """
        
        if choice == "3": # OPTIC
            active_prompt = f"""{free_guidelines}
            MANDATE: Conduct a specialized evaluation focused on BALANCE and ALIGNMENT.
            INPUT A: {clinical_data}
            INPUT B: Visuals provided.
            
            Focus on how features align on the vertical and horizontal planes. Analyze the symmetry of the orbit and jawline, the centering of the nose, and the overall structural equilibrium.
            
            OUTPUT FORMAT:
            ### ANALYSIS [SEX]
            **Technical Summary:** [Focus on balance/alignment]
            
            **CRITICAL MARKERS:**
            **#1 BEST FEATURE:** [Detail]
            **#1 WORST FEATURE:** [Detail]
            
            ### DASHBOARD_DATA
            **BEST FEATURES:**
            1. BEST FEATURE: [Detail]
            **PRIMARY FLAWS:**
            1. WORST FEATURE: [Detail]
            """
        elif choice == "4": # CORE
            active_prompt = f"""{free_guidelines}
            MANDATE: Conduct a specialized evaluation focused on OBJECTIVE ATTRACTIVENESS.
            INPUT A: {clinical_data}
            INPUT B: Visuals provided.
            
            Focus on sexual dimorphism, mass-market appeal, and 'pretty' harmony. Assess how well the features project an image of health, vitality, and aesthetic refinement.
            
            OUTPUT FORMAT:
            ### ANALYSIS [SEX]
            **Technical Summary:** [Focus on attractiveness/appeal]
            
            **CRITICAL MARKERS:**
            **#1 BEST FEATURE:** [Detail]
            **#1 WORST FEATURE:** [Detail]

            ### DASHBOARD_DATA
            **BEST FEATURES:**
            1. BEST FEATURE: [Detail]
            **PRIMARY FLAWS:**
            1. WORST FEATURE: [Detail]
            """
        elif choice == "5": # GENEVA
            active_prompt = f"""{free_guidelines}
            MANDATE: Conduct a specialized evaluation focused on MATHEMATICAL BEAUTY.
            INPUT A: {clinical_data}
            INPUT B: Visuals provided.
            
            Focus on Golden Ratio proportions, specific craniofacial angles (Gonial, Nasolabial), and the geometric 'perfection' of feature placement. Analyze the face as a series of mathematical vectors and ratios.
            
            OUTPUT FORMAT:
            ### ANALYSIS [SEX]
            **Technical Summary:** [Focus on geometry/ratios]
            
            **CRITICAL MARKERS:**
            **#1 BEST FEATURE:** [Detail]
            **#1 WORST FEATURE:** [Detail]

            ### DASHBOARD_DATA
            **BEST FEATURES:**
            1. BEST FEATURE: [Detail]
            **PRIMARY FLAWS:**
            1. WORST FEATURE: [Detail]
            """

    result, model_used, duration = consult_ai_with_selection(active_prompt, "temp_analysis.jpg", choice)

    if result == "CANCELLED":
        return "__EXIT_ERROR__"

    if not result or (isinstance(result, str) and result.startswith("Error:")):
        print(f"[FATAL] AI consultation failed: {result}")
        return "__EXIT_ERROR__"

    print("\n" + "="*40 + "\nOFFICIAL RATING\n" + "="*40)
    print(f"[Using: {model_used} | Latency: {duration}s]")
    print(result)
    return result

if __name__ == "__main__":
    # Invoked from Node: python final_engine.py <imagePath> <choice> [statsJson] [sideImagePath]
    img_target = sys.argv[1] if len(sys.argv) > 1 else "test.jpg"
    choice_arg = sys.argv[2] if len(sys.argv) > 2 else None
    clinical_json = sys.argv[3] if len(sys.argv) > 3 else None
    side_img_arg = sys.argv[4] if len(sys.argv) > 4 else None
    out = run_final_stack(img_target, clinical_data_json_str=clinical_json, choice=choice_arg, side_img_path=side_img_arg)
    if out == "__EXIT_ERROR__" or out is None:
        sys.exit(1)
    sys.exit(0)
