import json
import os
import re
from pathlib import Path

from engine import get_clinical_biometrics


TRAINING_ROOT = Path(r"C:\Users\Laith abu amsheh\Downloads\Codexscript training")
CALIBRATION_PATH = Path(__file__).resolve().parent / "gemini-benchmark-calibration.json"
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}

TIER_SPECS = {
    "The 3s": {"target": 35, "slug": "tier_3s"},
    "The 4s": {"target": 45, "slug": "tier_4s"},
    "The 5s": {"target": 55, "slug": "tier_5s"},
    "The 6s": {"target": 65, "slug": "tier_6s"},
    "7s": {"target": 75, "slug": "tier_7s"},
}

REPORT_KEY_MAP = {
    "Bigonial_Width_Index": "Bigonial",
    "IPD_Index (Geometric)": "IPD",
    "Mouth_Width_Index": "Mouth",
    "Nose_Width_Index": "Nose",
    "Upper_Third_Length": "Upper",
    "Middle_Third_Length": "Middle",
    "Lower_Third_Length": "Lower",
    "Eye_Height_Index": "Eye",
    "Brow_Compactness_Index (distance from center of eye to bottom of brow)": "Brow",
    "Philtrum_Height_Index": "Philtrum",
    "Total_Lip_Height_Index": "Lip",
    "fWHR (Zygo / Upper_Face)": "fWHR",
    "Midface_Ratio (Mid/IPD)": "Midface",
    "Canthal_Tilt_Degrees": "Canthal",
}


def slugify(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "_", value.strip().lower())
    return re.sub(r"_+", "_", text).strip("_")


def parse_report_metrics(report_path: Path):
    if not report_path.exists():
        return None

    metrics = {}
    pattern = re.compile(r"^\s*-\s*([^:]+):\s*([-\d.]+)")
    for raw_line in report_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        match = pattern.match(raw_line)
        if not match:
            continue
        label = match.group(1).strip()
        mapped = REPORT_KEY_MAP.get(label)
        if not mapped:
            continue
        try:
            metrics[mapped] = float(match.group(2))
        except ValueError:
            continue

    if len(metrics) < len(REPORT_KEY_MAP):
        return None
    return metrics


def collect_images(folder: Path):
    return sorted(
        [
            path
            for path in folder.rglob("*")
            if path.is_file() and path.suffix.lower() in IMAGE_EXTS
        ],
        key=lambda path: str(path).lower(),
    )


def build_entry(image_path: Path, tier_name: str, target: int, slug: str):
    get_clinical_biometrics(str(image_path))
    metrics = parse_report_metrics(Path("mog_report.txt"))
    if not metrics:
        return None

    relative = image_path.relative_to(TRAINING_ROOT / tier_name)
    return {
        "id": f"{slug}_{slugify(str(relative))}",
        "target": target,
        "metrics": metrics,
        "sourceFolder": tier_name,
        "sourceImage": str(relative).replace("\\", "/"),
    }


def load_existing():
    if not CALIBRATION_PATH.exists():
        return []
    try:
        data = json.loads(CALIBRATION_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def main():
    existing = load_existing()
    preserved = [
        entry
        for entry in existing
        if not isinstance(entry, dict) or entry.get("sourceFolder") not in TIER_SPECS
    ]

    generated = []
    skipped = []

    for tier_name, spec in TIER_SPECS.items():
        folder = TRAINING_ROOT / tier_name
        if not folder.exists():
            skipped.append(f"{tier_name}: missing folder")
            continue

        for image_path in collect_images(folder):
            try:
                entry = build_entry(image_path, tier_name, spec["target"], spec["slug"])
                if entry:
                    generated.append(entry)
                else:
                    skipped.append(f"{tier_name}: failed to parse metrics for {image_path.name}")
            except Exception as error:
                skipped.append(f"{tier_name}: {image_path.name} -> {error}")

    final_entries = preserved + generated
    CALIBRATION_PATH.write_text(json.dumps(final_entries, indent=2), encoding="utf-8")

    print(f"[calibration] preserved={len(preserved)} generated={len(generated)} total={len(final_entries)}")
    if skipped:
        print("[calibration] skipped:")
        for line in skipped:
            print(f" - {line}")


if __name__ == "__main__":
    main()
