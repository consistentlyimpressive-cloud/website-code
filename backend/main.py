from fastapi import FastAPI, File, UploadFile, Form  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from fastapi.responses import FileResponse  # type: ignore
import shutil
import re
import os
import uvicorn  # type: ignore

from final_engine import run_final_stack  # type: ignore

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/analyze")
async def analyze_image(image: UploadFile = File(...), choice: str = Form("3")):
    # Save the file straight to disk as requested
    image_path = "test.jpg"
    with open(image_path, "wb") as buffer:
        shutil.copyfileobj(image.file, buffer)
        
    # Execute the vision AI pipeline natively in python
    raw_output = run_final_stack(image_path, choice=choice)
    if not raw_output:
        return {"success": False, "error": "AI Engine failed to return parsing data."}
    
    # 1. Regex final metric score
    rating_match = re.search(r'\*\*Final Rating:\s*(\d+(?:\.\d+)?)/100\*\*', raw_output, re.IGNORECASE)
    rating = float(rating_match.group(1)) if rating_match else 85.0
    
    # 2. Regex the complex analysis report section
    summary_match = re.search(r'\*\*Technical Summary:\*\*(.*?)(?=\*\*Appeal Assessment:\*\*|\*\*CORE CATEGORY SCORES)', raw_output, re.IGNORECASE | re.DOTALL)
    summary = summary_match.group(1).strip() if summary_match else "Could not generate technical summary."
    
    best_features: list[dict[str, str]] = []
    flaws: list[dict[str, str]] = []
    
    # 3. Regex feature breakdown extraction blocks
    best_match = re.search(r'BEST FEATURES[\*:]*(.*?)(?=PRIMARY FLAWS[\*:]*|$|###)', raw_output, re.IGNORECASE | re.DOTALL)
    if best_match:
        for line in best_match.group(1).strip().split('\n'):
            line = line.replace('**', '').strip()
            if re.match(r'^(\d+\.|-|\*)\s+', line):
                clean_line = re.sub(r'^(\d+\.|-|\*)\s+', '', line)
                parts = re.split(r':\s+|\s+-\s+', clean_line, maxsplit=1)
                if len(parts) >= 2:
                    best_features.append({"title": parts[0].strip(), "description": parts[1].strip()})
                elif len(parts) == 1 and len(parts[0]) > 5:
                    best_features.append({"title": "Highlighted Feature", "description": parts[0].strip()})
    
    flaw_match = re.search(r'PRIMARY FLAWS[\*:]*(.*?)(?=$|###)', raw_output, re.IGNORECASE | re.DOTALL)
    if flaw_match:
        for line in flaw_match.group(1).strip().split('\n'):
            line = line.replace('**', '').strip()
            if re.match(r'^(\d+\.|-|\*)\s+', line):
                clean_line = re.sub(r'^(\d+\.|-|\*)\s+', '', line)
                parts = re.split(r':\s+|\s+-\s+', clean_line, maxsplit=1)
                if len(parts) >= 2:
                    flaws.append({"title": parts[0].strip(), "description": parts[1].strip()})
                elif len(parts) == 1 and len(parts[0]) > 5:
                    flaws.append({"title": "Identified Flaw", "description": parts[0].strip()})
    
    # Extract Category Scores
    categories: dict[str, int] = {
        "Harmony": 85,
        "Bone": 80,
        "Symmetry": 85,
        "Skin": 80,
        "Dimorphism": 80
    }
    cat_match = re.search(r'\*\*CORE CATEGORY SCORES.*?\n(.*?)(?=\*\*CRITICAL MARKERS|\### DASHBOARD_DATA)', raw_output, re.IGNORECASE | re.DOTALL)
    if cat_match:
        content_block: str = str(cat_match.group(1))
        lines: list[str] = content_block.split('\n')
        for line in lines:
            for key in list(categories.keys()):
                if key.lower() in line.lower():
                    # Extract number
                    num = re.search(r'\b(\d+)\b', line)
                    if num:
                        categories[key] = min(100, max(0, int(num.group(1))))
    
    # 3.5 Read raw values from mog_report.txt
    raw_values = {}
    if os.path.exists("mog_report.txt"):
        try:
            with open("mog_report.txt", "r") as f:
                for line in f:
                    # Match "- Feature_Name: 0.88" or "Feature_Name: 0.88"
                    match = re.search(r'[-*]*\s*([^:]+):\s*([\d\.\-]+)', line)
                    if match:
                        key = match.group(1).replace('_', ' ').strip().title()
                        raw_values[key] = match.group(2)
        except Exception as e:
            print("Error reading mog_report.txt:", e)

    # 4. Extract biometric stats from MOG_REPORT_REVISION
    biometrics = []
    try:
        report_match = re.search(r'### MOG_REPORT_REVISION(.*?)(?:\*\*JUSTIFICATION|\Z)', raw_output, re.IGNORECASE | re.DOTALL)
        if report_match:
            for line in report_match.group(1).strip().split('\n'):
                match = re.search(r'[-*]*\s*([^:]+):\s*(\d+(?:\.\d+)?)', line)
                if match:
                    base_label = match.group(1).replace('_', ' ').strip().title()
                    score = min(max(float(match.group(2)), 0), 100)

                    final_label = base_label
                    # Append raw measurement if we successfully parsed it earlier
                    if base_label in raw_values:
                        val = raw_values[base_label]
                        if "Degree" in base_label or "Angle" in base_label or "Tilt" in base_label:
                            final_label = f"{base_label} ({val}°)"
                        else:
                            final_label = f"{base_label} ({val})"

                    biometrics.append({"label": final_label, "displayValue": f"{int(score)}/100", "score": score})
    except Exception as e:
        print("Error parsing MOG_REPORT_REVISION:", e)

    return {
        "success": True,
        "finalRating": rating,
        "technicalSummary": summary,
        "bestFeatures": best_features,
        "primaryFlaws": flaws,
        "categories": categories,
        "biometrics": biometrics,
        # Provide endpoint directly mapped loop back loading scan video 
        "videoUrl": "http://localhost:3001/loading_scan.mp4"
    }

@app.get("/loading_scan.mp4")
async def get_video():
    if os.path.exists("loading_scan.mp4"):
        return FileResponse("loading_scan.mp4", media_type="video/mp4")
    return {"error": "Video not found"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=3001, reload=True)
