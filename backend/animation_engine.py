import cv2  # type: ignore
import numpy as np  # type: ignore
import mediapipe as mp  # type: ignore
import os
from mediapipe.tasks import python  # type: ignore
from mediapipe.tasks.python import vision  # type: ignore


def generate_scan_animation(img_path, output_path="loading_scan.mp4", duration_seconds=2.0, fps=30.0):
    model_path = 'face_landmarker.task'
    if not os.path.exists(model_path): return

    base_options = python.BaseOptions(model_asset_path=model_path)
    options = vision.FaceLandmarkerOptions(base_options=base_options, running_mode=vision.RunningMode.IMAGE)

    with vision.FaceLandmarker.create_from_options(options) as landmarker:
        img_temp = cv2.imread(img_path)
        image_mp = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img_temp, cv2.COLOR_BGR2RGB))
        res = landmarker.detect(image_mp)
        if not res.face_landmarks: return

        img = cv2.imread(img_path)
        h, w, _ = img.shape
        # Use all 468 landmarks for a dense, high-quality mesh
        lms = np.array([(int(lm.x * w), int(lm.y * h)) for lm in res.face_landmarks[0]])
        
        # Calculate Delaunay Triangulation for a perfect network shape
        rect = (0, 0, w, h)
        subdiv = cv2.Subdiv2D(rect)
        for p in lms:
            subdiv.insert((float(p[0]), float(p[1])))
        triangle_list = subdiv.getTriangleList()

        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(output_path, fourcc, fps, (w, h))

        frames = max(int(duration_seconds * fps), 1)
        long_scan_mode = duration_seconds >= 20
        scan_cycles = max(1, int(round(duration_seconds / 12.5))) if long_scan_mode else 1
        active_band_px = max(int(h * 0.14), 42)

        for f in range(frames):
            frame_img = img.copy()

            progress = f / max(frames - 1, 1)
            if long_scan_mode:
                cycle_progress_total = progress * scan_cycles
                cycle_index = min(int(cycle_progress_total), scan_cycles - 1)
                cycle_progress = cycle_progress_total - cycle_index
                if cycle_index % 2 == 1:
                    cycle_progress = 1.0 - cycle_progress
                scan_y = int(cycle_progress * h)
            else:
                scan_y = int(progress * h)

            # Draw the mesh. For long premium scans, keep the network alive with a moving
            # active band so the animation does not "finish" halfway through the wait.
            for t in triangle_list:
                pts = [(int(t[0]), int(t[1])), (int(t[2]), int(t[3])), (int(t[4]), int(t[5]))]
                if all(0 <= p[0] < w and 0 <= p[1] < h for p in pts):
                    avg_y = sum(p[1] for p in pts) / 3
                    if long_scan_mode:
                        distance = abs(avg_y - scan_y)
                        if distance <= active_band_px:
                            intensity = 1.0 - (distance / active_band_px)
                            color = (
                                int(70 + 125 * intensity),
                                int(215 + 40 * intensity),
                                255,
                            )
                            thickness = 1 if intensity < 0.66 else 2
                            cv2.polylines(frame_img, [np.array(pts)], True, color, thickness, cv2.LINE_AA)
                    else:
                        if avg_y < scan_y + 20:
                            cv2.polylines(frame_img, [np.array(pts)], True, (255, 255, 255), 1, cv2.LINE_AA)

            # Draw scanning bar with glow.
            cv2.line(frame_img, (0, scan_y), (w, scan_y), (0, 255, 0), 2)
            glow = np.zeros_like(frame_img)
            cv2.line(glow, (0, scan_y), (w, scan_y), (0, 255, 0), 10)
            glow = cv2.GaussianBlur(glow, (15, 15), 0)
            frame_img = cv2.addWeighted(frame_img, 1, glow, 0.5, 0)

            out.write(frame_img)
            
        out.release()
        # ASCII-only: Windows cp1252 consoles crash on Unicode checkmarks (UnicodeEncodeError).
        print(f"[OK] High-Tech Animation saved: {output_path}")
