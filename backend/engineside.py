import os
import cv2
import json
import numpy as np
from google import genai
from google.genai import types

# ==========================================================
# 🔑 API KEY VAULT (Gemini Only)
# ==========================================================
def _gemini_key_from_env(var_name):
    raw = os.getenv(var_name)
    if raw is None:
        return ""
    s = str(raw).strip().strip('"').strip("'")
    return s if s else ""


GEMINI_KEYS = [
    _gemini_key_from_env("GEMINI_KEY_1"),
    _gemini_key_from_env("GEMINI_KEY_2"),
    _gemini_key_from_env("GEMINI_KEY_3"),
    _gemini_key_from_env("GEMINI_KEY_4"),
    _gemini_key_from_env("GEMINI_KEY_5"),
]

def get_profile_analysis(img_path):
    model_id = "gemini-3.1-pro-preview"
    
    prompt = """
    Act as a board-certified Maxillofacial Surgeon. Analyze this lateral profile with the following MANDATE:
    
    JUDGING PHILOSOPHY:
    - Prioritize a "nice, clean, and harmonious" look above all else. 
    - Bone structure does NOT need to be "extreme" in projection to score well.
    - Leniency: A slightly weak chin is acceptable as long as it isn't severely recessed or disruptive to general harmony.

    RACIAL/ETHNIC CALIBRATION:
    - Identify the subject's likely ethnicity/race from the profile.
    - Apply scoring standards that correlate with that specific race. For example, if the subject is Asian, account for naturally different averages in facial convexity and maxillary/alveolar projection. 
    - Do not penalize for ethnic traits that are harmonious; judge based on structural support and health within that specific phenotype.

    CORE METRICS & REWARDS:
    - Award high scores for strong maxillary development and prominent cheekbone definition from the side.
    - Maxillary Projection: Specifically evaluate the support of the midface and subnasal area.

    UNCERTAINTY PROTOCOL:
    - You must be honest about what you cannot clearly see. If lighting, hair, or angle makes a specific measurement difficult, label it as "unsure" in the description.
    - IMPORTANT: If a measurement is labeled as "unsure," it will signal the final evaluation engine to reduce its impact on the frontal analysis.

    OUTPUT: 
    Return ONLY a raw JSON object with:
    1. Metrics: Each containing "val" (string/float) and "score" (int 1-100) for:
       maxillary_projection, chin_projection, nasolabial_angle, orbital_vector, 
       gonial_angle, facial_convexity, total_facial_convexity, mandibular_plane, 
       nasal_projection_shape, lip_projection, brow_ridge, overall_profile_harmony.
    2. detailed_description: (string) A very long, descriptive analysis of the side profile visuals. 
       Detail the transition of planes, bone support, and soft tissue. Explicitly state which parts you are "unsure" about.
    """

    # --- KEY ROTATION LOGIC ---
    for i, key in enumerate(GEMINI_KEYS):
        try:
            print(f"[🚀] Consulting Gemini 3.1 Pro (Using Key {i+1})...")
            client = genai.Client(api_key=key)
            
            with open(img_path, "rb") as f:
                img_bytes = f.read()
            
            res = client.models.generate_content(
                model=model_id,
                config=types.GenerateContentConfig(
                    temperature=0, 
                    response_mime_type="application/json"
                ),
                contents=[
                    types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"), 
                    prompt
                ]
            )
            
            if res.text:
                return json.loads(res.text)
                
        except Exception as e:
            print(f"[⚠️] Key {i+1} failed: {e}")
            if i < len(GEMINI_KEYS) - 1:
                print("[🔄] Rotating to next key...")
                continue
            else:
                print("[❌] All Gemini keys exhausted.")
    
    return None

if __name__ == "__main__":
    IMAGE_FILE = "testside.jpg"
    
    print("\n" + "="*35)
    print("    GEMINI 3.1 LATERAL ENGINE")
    print("="*35)

    if os.path.exists(IMAGE_FILE):
        data = get_profile_analysis(IMAGE_FILE)
        
        if data:
            print("\n" + "═"*65)
            print("         OFFICIAL MAXILLOFACIAL PROFILE REPORT")
            print("═"*65)
            
            # Print the metrics
            for k, v in data.items():
                if isinstance(v, dict):
                    display_name = k.replace('_',' ').title()
                    val_text = str(v.get('val', 'N/A'))
                    score = v.get('score', 0)
                    print(f"{display_name:<25} | {val_text:<20} | Score: {score}")
            
            print("\n" + "═"*65)
            print("TECHNICAL DESCRIPTION & UNCERTAINTY LOG:")
            print(data.get('detailed_description', 'No description provided.'))
            print("═"*65)

            # Extract harmony score safely
            harmony_obj = data.get('overall_profile_harmony', {})
            harmony = harmony_obj.get('score', 0) if isinstance(harmony_obj, dict) else 0
            
            print(f"OVERALL HARMONY: {harmony}/100")
            
            if harmony >= 90:
                print("\n🏆 STATUS: ELITE SKELETAL HARMONY.")
            elif harmony >= 75:
                print("\n✨ STATUS: HIGH TIER PROFILE.")
            
            print("═"*65)
        else:
            print("[❌] Analysis failed. Check your connection or keys.")
    else:
        print(f"[❌] {IMAGE_FILE} not found. Ensure the image is in this folder.")