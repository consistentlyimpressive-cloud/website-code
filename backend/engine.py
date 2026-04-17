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
NOSE_BASE_SHRINK_FACTOR = 0.94

RIGHT_JAW_CANDIDATES = [234, 93, 132, 58, 172, 136, 150]
LEFT_JAW_CANDIDATES = [454, 323, 361, 288, 397, 365, 379]


def _safe_normalize(vec):
    norm = np.linalg.norm(vec)
    if norm <= 1e-6:
        return np.array([0.0, -1.0], dtype=np.float32)
    return vec / norm


def _corner_strength(a, b, c):
    ba = _safe_normalize(a - b)
    bc = _safe_normalize(c - b)
    dot = float(np.clip(np.dot(ba, bc), -1.0, 1.0))
    return np.degrees(np.arccos(dot))


def refine_gonion(lms, side="right"):
    candidate_ids = RIGHT_JAW_CANDIDATES if side == "right" else LEFT_JAW_CANDIDATES
    raw_idx = 172 if side == "right" else 397
    chin = lms[152]
    mouth = (lms[61] + lms[291]) / 2.0
    jaw_height = max(chin[1] - mouth[1], 1.0)
    y_min = mouth[1] + jaw_height * 0.28
    y_max = chin[1] - jaw_height * 0.10

    lateral_ref = lms[234][0] if side == "right" else lms[454][0]
    raw_point = lms[raw_idx]
    best_idx = raw_idx
    best_score = -1.0

    for i in range(1, len(candidate_ids) - 1):
        prev_idx = candidate_ids[i - 1]
        curr_idx = candidate_ids[i]
        next_idx = candidate_ids[i + 1]
        curr = lms[curr_idx]
        if curr[1] < y_min or curr[1] > y_max:
            continue
        if side == "right" and curr[0] > lateral_ref + 4:
            continue
        if side == "left" and curr[0] < lateral_ref - 4:
            continue
        score = _corner_strength(lms[prev_idx], lms[curr_idx], lms[next_idx])
        # Favor candidates near the original landmark so the point stays in the true jaw-angle neighborhood.
        score -= np.linalg.norm(curr - raw_point) * 0.08
        if score > best_score:
            best_score = score
            best_idx = curr_idx

    candidate = lms[best_idx].copy()
    # Blend with MediaPipe's original gonion landmark so the refined point doesn't drift into the cheek.
    blended = (raw_point * 0.72) + (candidate * 0.28)
    # Small presentation nudge: move gonions slightly upward and slightly farther outward
    # while keeping them anchored in the jaw-angle region.
    lateral_push = jaw_height * 0.035
    upward_push = jaw_height * 0.06
    if side == "right":
        blended[0] -= lateral_push
    else:
        blended[0] += lateral_push
    blended[1] -= upward_push
    blended[1] = float(np.clip(blended[1], y_min, y_max))
    return blended.astype(np.float32)


def refine_hairline(lms, img_bgr):
    h, w = img_bgr.shape[:2]
    glabella = ((lms[282] + lms[52]) / 2.0).astype(np.float32)
    forehead_top = lms[10].astype(np.float32)
    temple_l = lms[251].astype(np.float32)
    temple_r = lms[21].astype(np.float32)

    forehead_vec = forehead_top - glabella
    up_dir = _safe_normalize(forehead_vec)
    if up_dir[1] > -0.2:
        up_dir = np.array([0.0, -1.0], dtype=np.float32)

    temple_avg_y = (temple_l[1] + temple_r[1]) / 2.0
    base_distance = np.linalg.norm(forehead_vec)
    travel = max(base_distance * 0.42, h * 0.03)
    estimated = forehead_top + (up_dir * travel)

    # Keep the synthetic point above the temple line but do not let it jump unrealistically high.
    min_y = temple_avg_y - (h * 0.18)
    max_y = temple_avg_y - (h * 0.03)
    estimated[1] = float(np.clip(estimated[1], min_y, max_y))
    estimated[0] = float(np.clip(estimated[0], min(temple_r[0], temple_l[0]) + 4, max(temple_r[0], temple_l[0]) - 4))

    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    search_x = int(np.clip(estimated[0], 0, w - 1))
    search_y0 = int(np.clip(estimated[1] - h * 0.06, 0, h - 1))
    search_y1 = int(np.clip(forehead_top[1] - 2, 0, h - 1))
    best_y = estimated[1]

    if search_y1 > search_y0:
        best_strength = -1.0
        for y in range(search_y0, search_y1):
            top = gray[max(y - 4, 0):max(y - 1, 1), max(search_x - 3, 0):min(search_x + 4, w)]
            bottom = gray[min(y + 1, h - 1):min(y + 5, h), max(search_x - 3, 0):min(search_x + 4, w)]
            if top.size == 0 or bottom.size == 0:
                continue
            # Hairline often appears as a darker band above a brighter forehead.
            strength = float(np.mean(bottom) - np.mean(top))
            if strength > best_strength:
                best_strength = strength
                best_y = y

    estimated[1] = float(best_y)
    return estimated.astype(np.float32)

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

        # --- SYNTHETIC / REFINED POINTS ---
        # 1. Refined Hairline: use forehead geometry plus a small contrast search
        synth_hairline = refine_hairline(lms, img_leveled)
        
        # 2. FIXED GLABELLA
        synth_glabella = (lms[282] + lms[52]) / 2.0
        
        # 3. Brow Ridge Midpoint
        synth_brow_ridge = (lms[282] + lms[52]) / 2.0
        # 4. Refined Gonions: use jaw contour corner strength instead of trusting one fixed raw landmark
        refined_gonion_r = refine_gonion(lms, "right")
        refined_gonion_l = refine_gonion(lms, "left")

        lms = np.vstack([lms, synth_hairline, synth_glabella, synth_brow_ridge, refined_gonion_r, refined_gonion_l])

        p = {
            "zygo_r": 234,
            "zygo_l": 454,
            "gonion_r": len(lms) - 2,
            "gonion_l": len(lms) - 1,
            "pupil_r": 468,
            "pupil_l": 473,
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
            dist = np.linalg.norm(lms[p[a]] - lms[p[b]])
            if {a, b} == {"nostril_r", "nostril_l"}:
                return dist * NOSE_BASE_SHRINK_FACTOR
            return dist

        def ratio(a, b):
            return round(get_dist(a, b) / zygo_w, 3)

        def get_adjusted_width_points(a, b):
            point_a = lms[p[a]].copy()
            point_b = lms[p[b]].copy()
            if {a, b} != {"nostril_r", "nostril_l"}:
                return point_a, point_b

            midpoint = (point_a + point_b) / 2.0
            point_a = midpoint + ((point_a - midpoint) * NOSE_BASE_SHRINK_FACTOR)
            point_b = midpoint + ((point_b - midpoint) * NOSE_BASE_SHRINK_FACTOR)
            return point_a, point_b
        
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
            point_1, point_2 = get_adjusted_width_points(p1, p2)
            y = int((point_1[1] + point_2[1]) / 2.0)
            x1 = int(point_1[0])
            x2 = int(point_2[0])
            x_left = min(x1, x2)
            x_right = max(x1, x2)
            cv2.line(img_r, (x_left, y), (x_right, y), color, t)
            cv2.putText(img_r, f"{lbl}: {ratio(p1, p2)}", (x_right + 5, y), cv2.FONT_HERSHEY_SIMPLEX, fs, color, 1)

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
