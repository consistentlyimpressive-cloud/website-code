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
LOWER_FACE_WIDTH_PAIRS = [(93, 323), (132, 361), (58, 288), (172, 397), (136, 365), (150, 379)]


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
    best_idx = candidate_ids[len(candidate_ids) // 2]
    best_score = -1.0

    for i in range(1, len(candidate_ids) - 1):
        prev_idx = candidate_ids[i - 1]
        curr_idx = candidate_ids[i]
        next_idx = candidate_ids[i + 1]
        score = _corner_strength(lms[prev_idx], lms[curr_idx], lms[next_idx])
        if score > best_score:
            best_score = score
            best_idx = curr_idx

    return lms[best_idx].copy()


def nudge_gonion(point, lms):
    zygo_w = np.linalg.norm(lms[234] - lms[454])
    center_x = (lms[234][0] + lms[454][0]) / 2.0
    adjusted = point.copy().astype(np.float32)
    direction = -1.0 if adjusted[0] < center_x else 1.0
    adjusted[0] += direction * zygo_w * 0.022
    adjusted[1] += zygo_w * 0.026
    return adjusted


def estimate_lower_face_width_points(lms):
    zygo_w = np.linalg.norm(lms[234] - lms[454])
    subnasale_y = float(lms[2][1])
    chin_y = float(lms[152][1])
    lower_span = chin_y - subnasale_y
    if zygo_w <= 1e-6 or lower_span <= 1e-6:
        return lms[172].copy(), lms[397].copy()

    min_y = subnasale_y + lower_span * 0.10
    max_y = subnasale_y + lower_span * 0.78
    best_pair = None
    best_width = -1.0

    for right_idx, left_idx in LOWER_FACE_WIDTH_PAIRS:
        right = lms[right_idx]
        left = lms[left_idx]
        pair_y = float((right[1] + left[1]) / 2.0)
        y_mismatch = abs(float(right[1] - left[1]))
        width = abs(float(left[0] - right[0]))
        if pair_y < min_y or pair_y > max_y:
            continue
        if y_mismatch > zygo_w * 0.12:
            continue
        if width > best_width:
            best_width = width
            best_pair = (right.copy(), left.copy())

    if best_pair is None:
        return lms[172].copy(), lms[397].copy()
    return best_pair


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
    brow_y = float(glabella[1])
    face_center_x = int(np.clip((temple_l[0] + temple_r[0]) / 2.0, 0, w - 1))
    face_width = max(abs(temple_l[0] - temple_r[0]), np.linalg.norm(lms[234] - lms[454]))
    band_half = max(6, int(face_width * 0.10))
    x0 = int(np.clip(face_center_x - band_half, 0, w - 1))
    x1 = int(np.clip(face_center_x + band_half, x0 + 1, w))
    search_y0 = int(np.clip(estimated[1] - h * 0.05, 0, h - 1))
    search_y1 = int(np.clip(brow_y - h * 0.04, search_y0 + 1, h - 1))
    best_y = estimated[1]

    if search_y1 > search_y0:
        best_strength = -1.0
        for y in range(search_y0, search_y1):
            top = gray[max(y - 5, 0):max(y - 1, 1), x0:x1]
            bottom = gray[min(y + 1, h - 1):min(y + 6, h), x0:x1]
            if top.size == 0 or bottom.size == 0:
                continue
            # Hairline is estimated from the strongest dark-hair / brighter-forehead edge.
            luminance_edge = float(np.mean(bottom) - np.mean(top))
            gradient = abs(float(np.mean(bottom)) - float(np.mean(top)))
            strength = luminance_edge + (gradient * 0.25)
            if luminance_edge > 3.0 and strength > best_strength:
                best_strength = strength
                best_y = y

    estimated[1] = float(np.clip(best_y, min_y, max_y))
    estimated[0] = float(face_center_x)
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

        # 4. Gonions: use the widest plausible lower-face contour pair.
        synth_gonion_r, synth_gonion_l = estimate_lower_face_width_points(lms)

        synth_start = len(lms)
        lms = np.vstack([lms, synth_hairline, synth_glabella, synth_brow_ridge, synth_gonion_r, synth_gonion_l])

        p = {
            "zygo_r": 234,
            "zygo_l": 454,
            "gonion_r": synth_start + 3,
            "gonion_l": synth_start + 4,
            "pupil_r": 468,
            "pupil_l": 473,
            "glabella": synth_start + 1,
            "subnasale": 2,
            "chin": 152,
            "hairline": synth_start,
            "brow_ridge": synth_start + 2,
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
