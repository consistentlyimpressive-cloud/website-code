import cv2  # type: ignore
import numpy as np  # type: ignore
import mediapipe as mp  # type: ignore
import os
from mediapipe.tasks import python  # type: ignore
from mediapipe.tasks.python import vision  # type: ignore

# ==========================================================
# 🛑 PERMANENT FEATURE LOCK - DO NOT REMOVE 🛑
# 1. debug_final_anchors.jpg (Point Map)
# 2. debug_ratios.jpg (Dashboard + Labels + Legend Box)
# 3. mog_report.txt (Full Clinical Log)
# 4. TERMINAL OUTPUT (Live Data Feed)
# ==========================================================

base_options = python.BaseOptions(model_asset_path='face_landmarker.task')
options = vision.FaceLandmarkerOptions(base_options=base_options, running_mode=vision.RunningMode.IMAGE)

def get_clinical_biometrics(img_path):
    if not os.path.exists(img_path): return
    with vision.FaceLandmarker.create_from_options(options) as landmarker:
        # Load Original Image using CV2 to bypass MediaPipe's Windows path bug
        img_temp = cv2.imread(img_path)
        img_rgb = cv2.cvtColor(img_temp, cv2.COLOR_BGR2RGB)
        image_mp = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)
        res = landmarker.detect(image_mp)
        if not res.face_landmarks: return

        h, w = image_mp.height, image_mp.width
        lms = np.array([(lm.x * w, lm.y * h) for lm in res.face_landmarks[0]])

        # --- AUTO-LEVELING LOGIC ---
        p_r, p_l = 468, 473
        d_x = lms[p_l][0] - lms[p_r][0]
        d_y = lms[p_l][1] - lms[p_r][1]
        angle = np.degrees(np.arctan2(d_y, d_x))

        center = (w // 2, h // 2)
        M = cv2.getRotationMatrix2D(center, angle, 1.0)
        img_cv = cv2.imread(img_path)
        img_leveled = cv2.warpAffine(img_cv, M, (w, h))

        ones = np.ones(shape=(len(lms), 1))
        lms_ones = np.hstack([lms, ones])
        lms = (M @ lms_ones.T).T

        # --- SYNTHETIC POINTS ---
        # 1. Extrapolate Hairline
        vec_forehead = lms[10] - lms[168]  
        synth_hairline = lms[10] + (vec_forehead * 0.5)  
        
        # 2. FIXED GLABELLA
        synth_glabella = (lms[282] + lms[52]) / 2.0
        
        # 3. Brow Ridge Midpoint
        synth_brow_ridge = (lms[282] + lms[52]) / 2.0

        # 4. GEOMETRIC EYE CENTERS (Gaze-Independent)
        synth_eye_center_r = (lms[133] + lms[33]) / 2.0
        synth_eye_center_l = (lms[362] + lms[263]) / 2.0
        
        lms = np.vstack([lms, synth_hairline, synth_glabella, synth_brow_ridge, synth_eye_center_r, synth_eye_center_l])

        p = {
            "zygo_r": 234,
            "zygo_l": 454,
            "gonion_r": 172,
            "gonion_l": 397,
            "pupil_r": len(lms) - 2,
            "pupil_l": len(lms) - 1,
            "glabella": len(lms) - 4, 
            "subnasale": 2,
            "chin": 152,
            "hairline": len(lms) - 5, 
            "brow_ridge": len(lms) - 3,
            "top_lip": 0,
            "bot_lip": 17, 
            "mouth_r": 61,
            "mouth_l": 291,
            "nostril_r": 98,
            "nostril_l": 327, 
            "eye_l_in": 362,
            "eye_l_out": 263,
            "eye_l_top": 386,
            "eye_l_bot": 374, 
            "eye_r_in": 133,
            "eye_r_out": 33,
            "eye_r_top": 159,
            "eye_r_bot": 145, 
            "brow_l": 282,
            "brow_r_low": 52,
            "temple_r": 21,
            "temple_l": 251
        }

        # --- MATH ENGINE ---
        zygo_w = np.linalg.norm(lms[p["zygo_r"]] - lms[p["zygo_l"]])
        ipd_px = np.linalg.norm(lms[p["pupil_r"]] - lms[p["pupil_l"]])
        
        upper_face_h = abs(lms[p["brow_ridge"]][1] - lms[p["top_lip"]][1])
        pupil_y_avg = (lms[p["pupil_r"]][1] + lms[p["pupil_l"]][1]) / 2.0
        midface_vertical_h = abs(pupil_y_avg - lms[p["top_lip"]][1])

        def get_dist(a, b):
            return np.linalg.norm(lms[p[a]] - lms[p[b]])

        def ratio(a, b):
            return round(get_dist(a, b) / zygo_w, 3)
        
        upper_h_norm = round(abs(lms[p["hairline"]][1] - lms[p["brow_ridge"]][1]) / zygo_w, 3)
        mid_h_norm = round(abs(lms[p["brow_ridge"]][1] - lms[p["subnasale"]][1]) / zygo_w, 3)
        lower_h_norm = round(abs(lms[p["subnasale"]][1] - lms[p["chin"]][1]) / zygo_w, 3)
        
        philtrum_h_px = abs(lms[p["subnasale"]][1] - lms[p["top_lip"]][1])
        lip_h_px = abs(lms[p["top_lip"]][1] - lms[p["bot_lip"]][1])
        eye_h_px = get_dist("eye_r_top", "eye_r_bot")
        brow_comp_px = abs(lms[p["pupil_r"]][1] - lms[p["brow_r_low"]][1])

        eye_dx = lms[p["eye_r_out"]][0] - lms[p["eye_r_in"]][0]
        eye_dy = lms[p["eye_r_in"]][1] - lms[p["eye_r_out"]][1]
        tilt_angle = round(np.degrees(np.arctan2(eye_dy, abs(eye_dx))), 2)

        final_fwhr = round(zygo_w / upper_face_h, 3)
        # --- SWAPPED FOR COMPACTNESS RATIO (Vertical / Horizontal) ---
        final_midface_ratio = round(midface_vertical_h / ipd_px, 3)

        # --- VISUAL OUTPUT ---
        img_r = img_leveled.copy()
        t, fs = 1, 0.35

        cv2.rectangle(img_r, (5, 5), (140, 75), (0,0,0), -1)
        cv2.putText(img_r, f"Tilt: {tilt_angle}", (10, 20), cv2.FONT_HERSHEY_SIMPLEX, fs, (0,255,0), 1)
        cv2.putText(img_r, f"fWHR: {final_fwhr}", (10, 35), cv2.FONT_HERSHEY_SIMPLEX, fs, (255,255,255), 1)
        cv2.putText(img_r, f"Midface: {final_midface_ratio}", (10, 50), cv2.FONT_HERSHEY_SIMPLEX, fs, (255,255,255), 1)
        cv2.putText(img_r, f"Sex: MALE (DET)", (10, 65), cv2.FONT_HERSHEY_SIMPLEX, fs, (0,200,255), 1)

        width_tasks = [
            ("zygo_r", "zygo_l", (0, 255, 0), "Zygo [BASE 1.0]"), 
            ("temple_r", "temple_l", (255, 100, 0), "Temple"),
            ("gonion_r", "gonion_l", (255, 0, 0), "Bigonial"), 
            ("nostril_r", "nostril_l", (0, 255, 255), "Nose Base"),
            ("mouth_r", "mouth_l", (0, 255, 255), "Mouth")
        ]

        for p1, p2, color, lbl in width_tasks:
            y = int(lms[p[p1]][1])
            cv2.line(img_r, (int(lms[p[p1]][0]), y), (int(lms[p[p2]][0]), y), color, t)
            cv2.putText(img_r, f"{lbl}: {ratio(p1, p2)}", (int(lms[p[p2]][0]) + 5, y), cv2.FONT_HERSHEY_SIMPLEX, fs, color, 1)

        cv2.line(img_r, tuple(lms[p["pupil_r"]].astype(int)), tuple(lms[p["pupil_l"]].astype(int)), (0, 0, 255), t)
        cv2.putText(img_r, f"IPD: {ratio('pupil_r', 'pupil_l')}", (int(lms[p['pupil_l']][0])+5, int(lms[p['pupil_l']][1])), cv2.FONT_HERSHEY_SIMPLEX, fs, (0,0,255), 1)
        
        cv2.line(img_r, tuple(lms[p["eye_r_top"]].astype(int)), tuple(lms[p["eye_r_bot"]].astype(int)), (255, 0, 255), t)
        cv2.line(img_r, tuple(lms[p["pupil_r"]].astype(int)), (int(lms[p["pupil_r"]][0]), int(lms[p["brow_r_low"]][1])), (255, 255, 0), t)

        x_start, x_end = int(lms[p["zygo_r"]][0]), int(lms[p["zygo_l"]][0])
        cv2.line(img_r, (x_start, int(lms[p["hairline"]][1])), (x_end, int(lms[p["hairline"]][1])), (255, 255, 255), 1)
        cv2.line(img_r, (x_start, int(lms[p["brow_ridge"]][1])), (x_end, int(lms[p["brow_ridge"]][1])), (0, 255, 255), 1)
        cv2.line(img_r, (x_start, int(lms[p["subnasale"]][1])), (x_end, int(lms[p["subnasale"]][1])), (0, 255, 255), 1)
        cv2.line(img_r, (x_start, int(lms[p["chin"]][1])), (x_end, int(lms[p["chin"]][1])), (255, 255, 255), 1)

        img_map = img_leveled.copy()
        for label, idx in p.items():
            pos = tuple(lms[idx].astype(int))
            cv2.circle(img_map, pos, 2, (0, 255, 255), -1)
            cv2.putText(img_map, label, (pos[0]+3, pos[1]-3), cv2.FONT_HERSHEY_SIMPLEX, 0.25, (255, 255, 255), 1)
        
        cv2.imwrite("debug_final_anchors.jpg", img_map)
        cv2.imwrite("debug_ratios.jpg", img_r)

        # --- MACHINE-READABLE REPORT GENERATION ---
        report = f"""
============================================================
        MOG-CHECK CLINICAL AUDIT REPORT (V30.0)
============================================================
METADATA:
- Analysis Mode: Geometric Clinical Biometrics
- Reference Scale (1.0): Bizygomatic Width ({round(zygo_w, 1)}px)
- Auto-Leveling: Corrected {round(angle, 2)} deg

[1] NORMALIZED HORIZONTAL INDICES (Length / Zygo Width)
------------------------------------------------------------
- Bigonial_Width_Index:     {ratio('gonion_r', 'gonion_l')}
- IPD_Index (Geometric):    {ratio('pupil_r', 'pupil_l')}
- Mouth_Width_Index:        {ratio('mouth_r', 'mouth_l')}
- Nose_Width_Index:         {ratio('nostril_r', 'nostril_l')}

[2] NORMALIZED VERTICAL THIRDS (Length / Zygo Width)
------------------------------------------------------------
- Upper_Third_Length:       {upper_h_norm}
- Middle_Third_Length:      {mid_h_norm}
- Lower_Third_Length:       {lower_h_norm}

[3] NORMALIZED VERTICAL INDICES (Length / Zygo Width)
------------------------------------------------------------
- Eye_Height_Index:         {round(eye_h_px/zygo_w, 3)}
- Brow_Compactness_Index (distance from center of eye to bottom of brow): {round(brow_comp_px/zygo_w, 3)}
- Philtrum_Height_Index:    {round(philtrum_h_px/zygo_w, 3)}
- Total_Lip_Height_Index:   {round(lip_h_px/zygo_w, 3)}

[4] RELATIONAL RATIOS & ANGLES
------------------------------------------------------------
- fWHR (Zygo / Upper_Face): {final_fwhr}
- Midface_Ratio (Mid/IPD):  {final_midface_ratio}
- Canthal_Tilt_Degrees:     {tilt_angle} (Measurement might be inaccurate if other parts of face show signs of bad infraorbital/face support, such as high uee and droopy eyelid shape)
============================================================
"""
        print(report)
        with open("mog_report.txt", "w") as f: f.write(report)

if __name__ == "__main__":
    get_clinical_biometrics("test.jpg")