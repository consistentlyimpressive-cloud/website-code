import os
import cv2
import time
import base64
import numpy as np
import re
import sys

# Load .env if it exists
if os.path.exists(".env"):
    with open(".env") as f:
        for line in f:
            if '=' in line and not line.startswith('#'):
                k, v = line.strip().split('=', 1)
                os.environ[k] = v.strip('"\'')

print("[DEBUG] Phase 1: Importing SDKs...")
try:
    from google import genai
    from google.genai import types
    print("[DEBUG] Analysis Engine A Loaded.")
except ImportError:
    print("[DEBUG] Engine A MISSING. Run: pip install google-genai")

try:
    from openai import OpenAI
    print("[DEBUG] Analysis Engine B Loaded.")
except ImportError:
    print("[DEBUG] Engine B MISSING. Run: pip install openai")

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
# ðŸ”‘ API KEY VAULT
# ==========================================================
OR_KEY = "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"
KIMI_KEY = "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"

DEFAULT_GEMINI_KEYS = [
    "AIzaSyAm-3t_Ct4YKGKhWYWyzFcsiBIGAtwTPNg", 
    "AIzaSyBbSOqX-NlD4ruxKt52AXtIhAPi6CgjKdA", 
    "AIzaSyCdCJD94NBBxIYohMKzdfKqep1W3hJ7Geg",
    "AIzaSyCpAVTxcUfUdUHCPVM4lukrx-O5rRZ0Kzc",
    "AIzaSyAybEzlJqP4-VBJaE9PTtgk1GECoLAAoJU"
]

GEMINI_KEYS = [
    os.getenv("GEMINI_KEY_1", DEFAULT_GEMINI_KEYS[0]),
    os.getenv("GEMINI_KEY_2", DEFAULT_GEMINI_KEYS[1]),
    os.getenv("GEMINI_KEY_3", DEFAULT_GEMINI_KEYS[2]),
    os.getenv("GEMINI_KEY_4", DEFAULT_GEMINI_KEYS[3]),
    os.getenv("GEMINI_KEY_5", DEFAULT_GEMINI_KEYS[4])
]

# Clients
client_or = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=OR_KEY)
client_kimi = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=KIMI_KEY)

def encode_image(image_path):
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode('utf-8')

def consult_ai_with_selection(unified_prompt, img_path, choice):
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
            for key in GEMINI_KEYS:
                if not key: continue
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
                    if res.text:
                        duration = round(time.time() - start_time, 2)
                        return res.text, friendly_name, duration
                except Exception as e:
                    if "User interrupted" in str(e): raise
                    print(f"      [!] {friendly_name} failed on current key. Trying next...")
                    continue
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
                    duration = round(time.time() - start_time, 2)
                    return content, friendly_name, duration
            except Exception as e:
                print(f"      [!] {friendly_name} failed: {e}")

    except KeyboardInterrupt:
        print("\n[!] User Cancelled. Stopping request...")
        return "CANCELLED", "None", 0

    return "Error: Model selection failed or invalid choice.", "None", 0

def run_final_stack(img_path, clinical_data_json_str=None):
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

    # --- SIDE PROFILE DATA COLLECTION ---
    side_data = "IGNORE_SIDE_ANALYSIS"
    if choice in ["1", "2"]:
        print("[ðŸš€] Gathering Lateral Data from engineside.py...")
        try:
            side_data = engineside.get_profile_analysis("testside.jpg") 
        except:
            side_data = "Lateral metadata unavailable. Focus on frontal visuals and input."

    print(f"\n--- ANALYZING: {img_path} ---")
    if not os.path.exists(img_path): return

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
            return
            
        if not os.path.exists("mog_report.txt"): return
        with open("mog_report.txt", "r") as f: 
            clinical_data = f.read()

    print("[2/3] Preparing Image...")
    img = cv2.imread(img_path)
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
        - TROLL/NON-HUMAN IMAGE DETECTION: If the input image is clearly not a human face (e.g., a cat, a dog, a drawn cartoon, or an inanimate object), rate its symmetry and ratios normally from 1-100, but prominently include a humorous disclaimer in the Technical Summary or insights (e.g., "Ratings may be inaccurate as the face appears to be a cat!"). Do not let this affect the actual structural math generation.
        - HIGHLIGHTING & FORMATTING: In your insights and descriptions, highlight **key words** and **core concepts** by making them bold.
        - COLOR CODING: Sparingly use color coding for emphasis in your long text descriptions using the syntax `&color text&`. Available colors: blue, green, red, white, yellow. For example: `&red severe upper eyelid exposure&` or `&green excellent maxilla development&`. Do not overdo the colors.

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
           - UNCANNY/OVERLY DIMORPHIC PENALTY: If a face appears overly dimorphic, unnatural, or uncanny (e.g., an artificial "gigachad" phenotype), exponentially penalize points. The more uncanny or unnatural the face, the harsher the penalty. A face that is clearly very uncanny MUST NOT score higher than 60.
           - NATURAL PENALTY PHRASING: NEVER explicitly state "the face is hard capped at 60 due to X" or mention the internal caps directly. Instead, make the limitation sound natural and logically explain it. For example: "the rating is limited by several overly dimorphic features" or "structural harmony is disrupted by unnatural proportions".
           - BREAKING 60: Requires at least one high-tier feature (refined nose, elite eyes, good lips).
           - CLEAN HARMONY (No Flaws/Standard Dimorphism): Cap at 85.
           - ELITE STATUS (85-100): Requires exceptional symmetry AND elite markers (Chico/Cha Eunwoo phenotype balance).

        OUTPUT FORMAT:
        ### ANALYSIS [SEX]
        **Final Frontal Rating: [Score]/100**
        **Final Side Rating: [Score]/100**
        **Max Natural Potential: [Score]/100**
        **Max Potential with Surgery: [Score]/100**
        
        **Technical Summary:** [Blend Frontal Metadata with Side Profile Metadata. Use **bolding** and `&color text&` sparingly].

        **Appeal Assessment:** [Identify phenotype and target audience appeal].

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
        - #1 BEST FEATURE: [Feature Name] - [Brief explanation]
        - #1 WORST FEATURE: [Feature Name] - [Brief explanation]

        ### DASHBOARD_DATA
        BEST FEATURES (10): [List 5 Frontal features and 5 Lateral features].
        PRIMARY FLAWS (10): [List 5 Frontal flaws and 5 Lateral flaws].

        ### RATINGS (USE THIS)
        [Look at the following data from INPUT A (mog_report) and rate them from 1-100 based on how close they are to the ideals of the subject's race:]
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
        [Provide exactly 5 pieces of personalized advice based on the user's submitted images. Format each as a numbered list item with a capitalized title. Each piece must be 1-3 paragraphs max. Focus strictly on real-world, physical issues and changes (e.g., facial fat, bone growth, surgical interventions) rather than surface fixes like posture or lighting. Be very explicit about what is causing the problem and the exact physical fix required. Answer all the user's unasked questions so they aren't left wondering.]
        Example formatting:
        1. IMPROVING YOUR AESTHETICS IN PICTURES
        You have a harmonious, well rounded face with **balanced features**. However, you have &red suboptimal bone growth& in the cheekbones and chin. You have moderate upper eyelid exposure which can throw off your look in certain lighting. To fix this, you can try to compensate by **losing facial fat** which could bring your score up to about a 58-65 depending on lighting and angle. &yellow Surgical intervention& would be needed to fix the rest of the issues completely.

        ### ACTIONABLE PROTOCOLS
        [List exactly 25 actionable protocols. Sorted from HIGHEST IMPACT to LOWEST IMPACT.]
        [Address both Frontal and Lateral structural issues based on the dual analysis.]
        1. [Protocol Name]: [Description]. [Impact Rating]
        ...
        25. [Protocol Name]: [Description]. [Impact Rating]

        ### MOG_REPORT_REVISION
        [Re-list every feature from INPUT A and Side features from INPUT B. Ensure Shared Ratings match. Format: "Feature Name: Score". NO EXPLANATIONS.]

        **JUSTIFICATION:** [Briefly explain why it didn't score higher or lower for debugging purposes. Never use the terms "hard cap" or "penalty" here either].
        """
    else:
        # FREE AI SPECIALIZED PROMPTS (No scores, ignores side profile)
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
            **#1 BEST FEATURE:** [Detail]
            **#1 WORST FEATURE:** [Detail]
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
            **#1 BEST FEATURE:** [Detail]
            **#1 WORST FEATURE:** [Detail]
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
            **#1 BEST FEATURE:** [Detail]
            **#1 WORST FEATURE:** [Detail]
            """

    result, model_used, duration = consult_ai_with_selection(active_prompt, "temp_analysis.jpg", choice)
    
    if result == "CANCELLED":
        return
        
    print("\n" + "="*40 + "\nOFFICIAL RATING\n" + "="*40)
    print(f"[Using: {model_used} | Latency: {duration}s]")
    print(result)
    return result

if __name__ == "__main__":
    img_target = sys.argv[1] if len(sys.argv) > 1 else "test.jpg"
    run_final_stack(img_target)
