import os
import cv2
import time
import base64
import numpy as np
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
# API KEY VAULT (GOOGLE AI STUDIO ONLY)
# ==========================================================
GEMINI_KEYS = [
    os.getenv("GEMINI_KEY_1", "AIzaSyC_c4vtU4j6gjA8MGeO7Nz1bb_Jo4wfuJc")
]


def consult_ai_with_selection(unified_prompt, img_path, choice):
    start_time = time.time()

    try:
        # --- MODEL MAPPING ---
        mapping = {
            "1": ("gemma-4-31b-it", "ULTRA - Highest Quality"),
            "2": ("gemma-4-26b-a4b-it", "ULTRA - Fast"),
            "3": ("gemma-4-26b-a4b-it", "OPTIC"),
            "4": ("gemma-4-26b-a4b-it", "CORE"),
            "5": ("gemma-4-26b-a4b-it", "GENEVA")
        }

        if choice not in mapping:
            return "Error: Model selection failed.", "None", 0

        model_id, friendly_name = mapping[choice]

        print(f"[DEBUG] Consulting {friendly_name}... (Press Ctrl+C to Cancel)")
        for key in GEMINI_KEYS:
            if not key:
                continue
            try:
                client = genai.Client(api_key=key, http_options=types.HttpOptions(timeout=240000))
                with open(img_path, "rb") as f:
                    image_bytes = f.read()
                contents = [
                    types.Part.from_text(text=unified_prompt),
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
                ]
                res = client.models.generate_content(
                    model=model_id,
                    config=types.GenerateContentConfig(temperature=0),
                    contents=contents
                )
                if res.text:
                    duration = round(time.time() - start_time, 2)
                    return res.text, friendly_name, duration
            except Exception as e:
                if "User interrupted" in str(e):
                    raise
                print(f"      [!] {friendly_name} failed on current key.")
                continue

    except KeyboardInterrupt:
        print("\n[!] User Cancelled. Stopping request...")
        return "CANCELLED", "None", 0

    return "Error: Model selection failed or invalid choice.", "None", 0


def run_final_stack(img_path, clinical_data_json_str=None, choice_override=None, side_img_path=None):
    print("\n" + "=" * 30)
    print("      MODEL SELECTOR")
    print("=" * 30)
    print("1. ULTRA - Highest Quality")
    print("2. ULTRA - Fast")
    print("-" * 30)
    print("3. OPTIC (Balance & Alignment)")
    print("4. CORE (Objective Attractiveness)")
    print("5. GENEVA (Mathematical Beauty)")

    if choice_override is not None and str(choice_override).strip():
        choice = str(choice_override).strip()
        print(f"\n[DEBUG] Model selected via API args: {choice}")
    else:
        try:
            choice = input("\nSelect Model [1-5]: ").strip()
        except KeyboardInterrupt:
            print("\nExiting script...")
            return

    if choice not in {"1", "2", "3", "4", "5"}:
        print(f"[ERROR] Invalid model choice: {choice}")
        return "Error: Model selection failed."

    # --- SIDE PROFILE DATA COLLECTION ---
    side_data = "IGNORE_SIDE_ANALYSIS"
    if choice in ["1", "2"]:
        print("[ðŸš€] Gathering Lateral Data from engineside.py...")
        if side_img_path and os.path.exists(side_img_path):
            try:
                side_data = engineside.get_profile_analysis(side_img_path)
            except Exception:
                side_data = "Lateral metadata unavailable. Focus on frontal visuals and input."
        else:
            side_data = "IGNORE_SIDE_ANALYSIS"

    print(f"\n--- ANALYZING: {img_path} ---")
    if not os.path.exists(img_path):
        return

    try:
        generate_scan_animation(img_path, output_path="loading_scan.mp4")
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

        if not os.path.exists("mog_report.txt"):
            return
        with open("mog_report.txt", "r") as f:
            clinical_data = f.read()

    print("[2/3] Preparing Image...")
    img = cv2.imread(img_path)
    cv2.imwrite("temp_analysis.jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 95])

    print("[3/3] Consulting AI...")

    prompt_visual_inputs = "INPUT C (Frontal Visual): High-resolution frontal image provided."
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

    # --- PROMPT SELECTION LOGIC ---
    if choice in ["1", "2"]:
        active_prompt = f"""
        MANDATE: Conduct a DUAL-INPUT structural evaluation (FRONTAL + LATERAL).
        INPUT A (Frontal Metadata): {clinical_data}
        INPUT B (Side Profile Metadata): {side_data}
        {prompt_visual_inputs}
        TECHNICAL VISIBILITY & OVERRIDE RULES:
        - CANTHAL TILT OVERRIDE: IGNORE any Canthal Tilt data provided in INPUT A (Metadata).
        You MUST evaluate Canthal Tilt primarily from the actual visual evidence in the image(s), not just the raw number.
        - SIDE PROFILE JUDGMENT CRITERIA: Reward a nice, clean, and harmonious look.
        Bone structure does not necessarily have to be amazingly projected to score well.
        A slightly weak chin is acceptable as long as it is not completely terrible/recessed.
        - SIDE PROFILE REWARDS: Explicitly reward good maxillary development and prominent cheekbones when viewed from the side.
        - RACIAL/ETHNIC CALIBRATION: Identify the subject's likely ethnicity/race from the profile.
        Apply scoring standards that correlate with that specific race (e.g., if Asian, account for naturally different averages in facial convexity).
        - MAXILLARY PROJECTION: Rate maxillary projection based on the provided lateral metadata and visual evidence.
        - NOSE BASE LENIENCY: Do not penalize for slightly wide nose bases unless it is very bad and severely disrupts facial balance.
        - DO NOT include minor asymmetries as flaws. ONLY penalize for asymmetry if it is VERY OBVIOUS and structurally disruptive.
        - Only override eye area data if signs of poor infraorbital growth are SEVERE and CLEARLY visible.
        - TROLL/NON-HUMAN IMAGE DETECTION: If the input image is clearly not a human face (e.g., a cat, a dog, a drawn cartoon, or an inanimate object), rate its symmetry and ratios normally from 1-100, but prominently include a humorous disclaimer in the Technical Summary or insights (e.g., "Ratings may be inaccurate as the face appears to be a cat!").
        Do not let this affect the actual structural math generation.
        - HIGHLIGHTING & FORMATTING: In your insights and descriptions, highlight *key words* and *core concepts* by wrapping them in single asterisks for bold emphasis.
{feature_selection_rules}

        SHARED RATING PROTOCOL:
        The following ratings MUST be identical for both the Front and Side profiles.
        Do not allow them to differ:
        1. Maxillary/Cheekbone Projection (Note: AI should use visual cues from both angles to determine this).
        2. Nose Projection.
        3. Facial Fat.
        4. Eye Depth.
        5. Ear Shape.
        6. Skin Quality.
        SCORING LOGIC & THRESHOLDS:
        1. RATIO ANCHORS (STRICT SCALING):
           - fWHR: The ideal is BALANCED, not extreme.
           Penalize clearly when fWHR drops significantly below the ideal because the face becomes too narrow/weak.
           Also apply a LIGHT penalty when fWHR becomes TOO HIGH / TOO WIDE. If fWHR reaches 2.10 or above, treat that as slightly over-dimorphic and a bit less harmonious.
           Very high fWHR should NOT be rewarded as "more masculine = better", but do not over-penalize this unless the width looks clearly excessive and harms harmony.
           - MIDFACE: Do NOT treat mildly long midfaces as a major flaw.
           A Midface_Ratio around 1.00-1.07 is only a light concern and by itself should usually NOT become the #1 WORST FEATURE.
           Treat elongated midface as a true structural flaw only when it is clearly long (roughly 1.08+) and make it a high-priority flaw only when it is more obvious (roughly 1.12+) or when it combines with other long-face signals like elongated thirds, narrow facial width, or vertically stretched harmony.
           - UPPER THIRD: Penalize strictly for an elongated upper third/forehead relative to the rest of the face.
           - PHILTRUM: Penalize HARSHLY for long philtrums that disrupt lower-third harmony.
           - EYE AREA: Penalize for puffy undereyes (eye bags/fat prolapse).
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
           - DEFINITION / FACIAL FAT: Penalize high facial fat and poor definition, but in a MODERATE and proportionate way.
           A soft, puffy, bloated, or poorly defined face should hurt harmony and bone visibility, but it should not dominate the entire score unless it is severe.
           If the cheek/jaw/under-chin definition is weak due to visible body fat or facial fullness, apply a mild-to-moderate deduction rather than an aggressive one.
        1B. INTERNAL VISUAL BUCKETING (VERY IMPORTANT):
           Before deciding the final score, internally classify the face into ONE of these buckets:
           - NATURAL / COHERENT HIGH-TIER: Strong features that still read human, believable, and harmonious.
           - EXAGGERATED BUT COHERENT: Striking or high-fashion features that are intense, but still fit the face and remain believable.
           - UNCANNY / SYNTHETIC / OVERBUILT: Faces that look artificial, too carved, too aggressive, biologically implausible, AI-generated, filter-generated, or "fantasy male model" in a way that harms harmony.
           - LOW-TIER / 4-RANGE: Faces with weak overall aesthetics, weak harmony, weak definition, visible flaws, and no standout redeeming structure.
           - VERY LOW-TIER / 3-RANGE: Faces with multiple major structural issues at once, especially long narrow proportions, very low facial width, obvious asymmetry, weak eye area, and no genuinely strong redeeming feature.

           DISTINCTION RULE:
           Do NOT confuse "striking" with "elite". A face can have attention-grabbing dimorphism and still be aesthetically worse because it looks forced, synthetic, or overbuilt.

           EXAMPLE ANCHORS FOR CALIBRATION:
           - A normal attractive celebrity face with decent harmony but not extreme structure belongs in NATURAL / COHERENT, not in uncanny and not in overbuilt.
           - A strong editorial / model face with intense jaw, cheekbones, eyes, or dimorphism can still belong in EXAGGERATED BUT COHERENT if it remains believable, photoreal, and internally harmonious.
           - A face with impossible jaw width, over-carved hollows, compressed soft tissue, fake-looking eye rendering, or "AI beauty render" energy belongs in UNCANNY / SYNTHETIC / OVERBUILT even if some local ratios look strong.
           - A face that is very long, narrow, low-fWHR, visibly asymmetric, and lacking standout positives belongs in VERY LOW-TIER / 3-RANGE rather than 4-range or average-tier.

           UNCANNY / OVERBUILT CUES:
           If multiple of these appear together, treat the face as uncanny and punish it HARD:
           - impossibly sharp or over-expanded jaw / gonial width relative to the rest of the skull
           - extremely carved lower third with hollowed cheeks and compressed soft tissue
           - over-aggressive brow ridge / orbital depth / eye area that looks stylized rather than natural
           - excessive facial width, excessive angularity, or "gigachad" proportions that stop looking believable
           - severe mismatch where one or two elite-looking features overpower the rest of the face and create a synthetic result
           - AI-looking texture, over-clean symmetry, fake-looking eye rendering, or other signs the face is not a natural human photo
           - a brutalist / fantasy / mannequin-like look that attracts attention but reduces genuine harmony

           EXAGGERATED BUT COHERENT CUES:
           If the face is strong, sharp, or highly dimorphic but still reads naturally human and harmonious, only apply a VERY SMALL harmony deduction.
           These faces can still score well if the structure is genuinely coherent.
           This bucket is ONLY for faces that still look unmistakably like a believable real human photograph.
           Think "editorial", "male model", or "high-fashion" intensity that still feels like a real person rather than a synthetic facial design.
           Strong bizygomatic width, a sharp jaw, compact eyes, strong brow support, or high dimorphism by themselves do NOT make a face uncanny.
           If the features are extreme but proportionally integrated, the deduction should be extremely light rather than harsh.
           If the face instead reads like an AI beauty render, FaceApp-style hyper-edit, fantasy-male model, mannequin, or over-optimized "internet mog" face, do NOT place it here.
           In those cases, treat the face as uncanny / synthetic even if some individual ratios look strong.

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
           - EXAGGERATED BUT COHERENT: apply only a tiny deduction, usually around 0-3 points total unless harmony is clearly disrupted. These faces can still land in the 75-85 range or higher when the structure is genuinely strong.
           - UNCANNY / SYNTHETIC / OVERBUILT: apply a major deduction. These faces should usually land far below a coherent high-tier face with similar local ratios, because the synthetic / overbuilt look is itself a major aesthetic flaw.
           - VERY LOW-TIER / 3-RANGE: when the face is long, narrow, asymmetric, and structurally weak with no redeeming anchors, the score should often land in the 30s instead of the 40s or 50s.
        2. GENDER COUNTERBALANCE (INTERNAL RULE):
           - If Sex = Female AND the score is > 70, deduct 10 points from the Final Rating and potential tiers.
           - DO NOT mention this deduction in the output or justification. It must appear as the "natural" result.
        3. CONDITIONAL CAPS:
           - HARD BASE CAP 60: If the structural base (Bone, Harmony, Symmetry) is below 60, external enhancements like hair framing, grooming, or styling CANNOT push the final score above 60.
           - HARD CAP 60: If the subject has MORE THAN 3 of the following, the final score CANNOT EXCEED 60:
             (Very prominent ears, negative canthal tilt, bad upper eyelid exposure, undereye puffiness, unideal FWHR, high
             set eyebrows, bulbous nose shape).
           - CAP 60: If the face lacks "pretty" appeal or high-tier dimorphism.
           - LOW-TIER FLOOR LOGIC: If the face is clearly very narrow, elongated, asymmetric, and weak overall, do NOT keep it artificially in the 40s or 50s just because a few isolated measurements are not disastrous.
           - MODERATE UNCANNY CAP 60: If the face is clearly exaggerated, overbuilt, AI-looking, synthetic, or "fantasy male model" but still somewhat coherent, it should usually NOT exceed 60.
           - SEVERE UNCANNY CAP 54: If the face looks strongly artificial, biologically implausible, or obviously like an AI-generated hypermasculine edit, it should usually NOT exceed 54.
           - VERY IMPORTANT: a face that looks "striking" because it is over-optimized, hyper-carved, or synthetic is NOT the same as a naturally elite face.
           - UNCANNY/OVERLY DIMORPHIC PENALTY: If a face appears overly dimorphic, unnatural, synthetic, or uncanny (for example an AI-generated "gigachad" or overbuilt fantasy face), penalize it HARD.
           The more artificial, over-carved, biologically implausible, or brutalist the look becomes, the harsher the deduction should be.
           A clearly uncanny face should usually NOT score like a true elite natural face, even if some isolated measurements look strong.
           In severe uncanny cases, the score should often fall into the mid-40s to mid-50s depending on how distorted, synthetic, or harmony-breaking the exaggeration is.
           In moderate uncanny cases, the score should usually land around the mid-50s to about 60, not the upper-70s or 80s.
           Faces that resemble AI-generated male beauty edits with giant jaws, hollow cheeks, compressed soft tissue, glassy eyes, extreme brow compression, or hyper-clean mannequin-like harmony should usually be capped around the low-to-upper 50s even if they are visually striking.
           If the face is only exaggerated but still coherent and natural-looking, apply only a minor-to-moderate deduction instead.
           Extreme masculinity is NOT automatically a positive. The ideal is balanced beauty: a clean mix of masculinity and femininity.
           Faces that become too brutish, too wide, too heavy, too hollowed, or too aggressively dimorphic should lose harmony points once the extremes are visually obvious.
           - NATURAL PENALTY PHRASING: NEVER explicitly state "the face is hard capped at 60 due to X" or mention the internal caps directly.
           Instead, make the limitation sound natural and logically explain it.
           For example: "the rating is limited by several overly dimorphic features" or "structural harmony is disrupted by unnatural proportions".
           - BREAKING 60: Requires at least one high-tier feature (refined nose, elite eyes, good lips).
           - If the eye area is genuinely exceptional, it should carry more weight in helping the face break into a higher band, especially when the rest of the face is at least decent and not heavily flawed.
           - However, exceptional eyes alone should not push a structurally flawed face into an inflated score band.
           - CLEAN HARMONY (No Flaws/Standard Dimorphism): Cap at 85.
           - ELITE STATUS (85-100): Requires exceptional symmetry AND elite markers (Chico/Cha Eunwoo phenotype balance).
        4. CALIBRATION ANCHORS (VERY IMPORTANT):
           - Do NOT overrate based on celebrity familiarity, charisma, expression, fame, hairstyle, or lighting.
           - Use the measurement data objectively. The final rating should feel harsh and grounded, not generous.
           - If the subject has multiple major flaws and very few redeeming traits, DO NOT be afraid to rate below 40.
           - 40 or below is valid for faces with several major structural or aesthetic issues, poor definition, visible aging, and no standout positive features.
           - Do NOT force average-looking or below-average faces into the 50s just because they are recognizable, masculine, or not deformed.
           - Do NOT force uncanny, AI-looking, overbuilt, "gigachad", or fantasy-model faces into the high 70s or 80s just because the jaw, brow, or width is extreme.
           - A face that is exaggerated but still coherent can still rate well.
           - A face that is exaggerated AND uncanny should drop notably because the exaggeration itself is hurting harmony.
           - A face that is exaggerated, editorial, or brutalist should NOT automatically read as high-tier. If the extremeness itself is the main thing carrying the look, do not score it like a balanced elite face.
           - A face with an AI-generated hypermasculine look should not be described as elite natural harmony unless it truly looks believable and human first.
           - If the visual read says "edited / synthetic / fantasy-male aesthetic", do not let strong numbers rescue it into a score band meant for real high-tier faces.
           - Calibration example: a face with a giant carved jaw, hollow cheeks, compressed brow/eye area, glassy symmetry, and "male-model render" energy should usually land somewhere around the upper-40s to high-50s depending on how distorted or synthetic it looks, not around 78-85.
           - Faces with obvious flaws and only decent structure usually land around 42-58.
           - Above-average attractive faces usually land around 58-72.
           - Strong/high-tier attractive faces usually land around 72-80.
           - Truly elite faces begin in the low 80s.
           - 90+ should be extremely rare.
           - Example anchor: a face like Will Smith should NOT be treated as ultra-high-tier by default; if the metrics are only decent and several flaws exist, a result around the high-50s / low-60s is more realistic.
           - A face with truly exceptional eyes and otherwise decent harmony should not get stuck too low purely because the bone structure is less aggressive or less brute-dimorphic.
        5. SIGNS OF AGING:
           - Penalize visible aging signs in a MODERATE and realistic way.
           - Nasolabial folds, under-eye aging, wrinkles, sagging skin, skin laxity, and a worn/tired look should reduce the rating when clearly visible, but should not overwhelm the full score unless severe.
           - Visible aging and weak definition should matter, but keep the deduction proportional to how strong and obvious those signs really are.


        OUTPUT FORMAT:
        ### ANALYSIS [SEX]
        **Final Frontal Rating: [Score]/100**
        **Final Side Rating: [Score]/100**
        **Max Natural Potential: [Score]/100**
        **Max Potential with Surgery: [Score]/100**

        **Technical Summary:** [Blend Frontal Metadata with Side Profile Metadata.
        Use *bolding* sparingly when emphasis is helpful].

        **Appeal Assessment:** [Identify phenotype and target audience appeal. If the face falls into the EXAGGERATED BUT COHERENT bucket, explicitly say that the appeal is more niche / editorial / high-fashion rather than universally conventional, but do NOT frame that alone as a major flaw.]
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

        **JUSTIFICATION:** [Briefly explain why it didn't score higher or lower for debugging purposes.
        Never use the terms "hard cap" or "penalty" here either].
        """
    else:
        # FREE AI SPECIALIZED PROMPTS (No scores, ignores side profile)
        free_guidelines = """
        STRICT MANDATE: Do NOT mention, hint at, or include any numerical scores, percentages, or overall ratings in your assessment.
        Focus entirely on descriptive analysis. Use vague descriptors like 'Above Average', 'Below Average', or 'Significantly Above Average' to describe the tier if necessary.
        """

        if choice == "3":  # OPTIC
            active_prompt = f"""{free_guidelines}
            MANDATE: Conduct a specialized evaluation focused on BALANCE and ALIGNMENT.
            INPUT A: {clinical_data}
            INPUT B: Frontal visual provided.
            Focus on how features align on the vertical and horizontal planes.
            Analyze the symmetry of the orbit and jawline, the centering of the nose, and the overall structural equilibrium.
            Choose the best and worst feature using BOTH the raw measurements and the actual visual appearance.
            If a visual issue is more obvious than any ratio issue, name that instead.
            Give a brief explanation after each feature label.
            OUTPUT FORMAT:
            ### ANALYSIS [SEX]
            **Technical Summary:** [Focus on balance/alignment]
            **#1 BEST FEATURE:** [Feature Name] - [Brief explanation]
            **#1 WORST FEATURE:** [Feature Name] - [Brief explanation]
            """
        elif choice == "4":  # CORE
            active_prompt = f"""{free_guidelines}
            MANDATE: Conduct a specialized evaluation focused on OBJECTIVE ATTRACTIVENESS.
            INPUT A: {clinical_data}
            INPUT B: Frontal visual provided.
            Focus on sexual dimorphism, mass-market appeal, and 'pretty' harmony. Assess how well the features project an image of health, vitality, and aesthetic refinement.
            Choose the best and worst feature using BOTH the raw measurements and the actual visual appearance.
            If a visual issue is more obvious than any ratio issue, name that instead.
            Give a brief explanation after each feature label.
            OUTPUT FORMAT:
            ### ANALYSIS [SEX]
            **Technical Summary:** [Focus on attractiveness/appeal]
            **#1 BEST FEATURE:** [Feature Name] - [Brief explanation]
            **#1 WORST FEATURE:** [Feature Name] - [Brief explanation]
            """
        elif choice == "5":  # GENEVA
            active_prompt = f"""{free_guidelines}
            MANDATE: Conduct a specialized evaluation focused on MATHEMATICAL BEAUTY.
            INPUT A: {clinical_data}
            INPUT B: Frontal visual provided.
            Focus on Golden Ratio proportions, specific craniofacial angles (Gonial, Nasolabial), and the geometric 'perfection' of feature placement.
            Analyze the face as a series of mathematical vectors and ratios.
            Choose the best and worst feature using BOTH the raw measurements and the actual visual appearance.
            If a visual issue is more obvious than any ratio issue, name that instead.
            Give a brief explanation after each feature label.
            OUTPUT FORMAT:
            ### ANALYSIS [SEX]
            **Technical Summary:** [Focus on geometry/ratios]
            **#1 BEST FEATURE:** [Feature Name] - [Brief explanation]
            **#1 WORST FEATURE:** [Feature Name] - [Brief explanation]
            """

    result, model_used, duration = consult_ai_with_selection(
        active_prompt,
        "temp_analysis.jpg",
        choice
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
