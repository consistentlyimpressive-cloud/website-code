import os
import sys
import base64

if os.path.exists(os.path.join(os.path.dirname(__file__), ".env")):
    with open(os.path.join(os.path.dirname(__file__), ".env"), encoding="utf-8", errors="ignore") as f:
        for line in f:
            if '=' in line and not line.startswith('#'):
                k, v = line.strip().split('=', 1)
                os.environ[k] = v.strip('"\'')

try:
    from google import genai  # type: ignore
    from google.genai import types  # type: ignore
except ImportError:
    print("Error: google-genai not installed.")
    sys.exit(1)

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

PROMPT = (
    "Edit this face image: Add subtle changes without changing anything else, "
    "improve skin quality, if acne spotted then get rid of it, make the face "
    "leaner make the face a bit more defined, increase the general contrast of "
    "the face, so lips appear more saturated, eye brows are darker. "
    "Return only the edited image, no text."
)

def main():
    if len(sys.argv) < 2:
        print("Error: No image path provided.")
        sys.exit(1)

    image_path = sys.argv[1]
    if not os.path.exists(image_path):
        print(f"Error: File {image_path} does not exist.")
        sys.exit(1)

    usable_keys = [k for k in GEMINI_KEYS if k and str(k).strip()]
    if not usable_keys:
        print("Error: No Gemini API keys configured.")
        sys.exit(1)

    with open(image_path, "rb") as f:
        img_bytes = f.read()

    last_err = None
    for key in usable_keys:
        try:
            client = genai.Client(api_key=key)

            response = client.models.generate_content(
                model='gemini-2.5-flash-image',
                contents=[
                    types.Part.from_text(text=PROMPT),
                    types.Part.from_bytes(data=img_bytes, mime_type='image/jpeg')
                ],
                config=types.GenerateContentConfig(
                    response_modalities=['IMAGE']
                )
            )

            for part in response.candidates[0].content.parts:
                if hasattr(part, 'inline_data') and part.inline_data:
                    b64 = base64.b64encode(part.inline_data.data).decode('utf-8')
                    print(b64)
                    sys.exit(0)

            raise Exception("No image returned in response")

        except Exception as e:
            last_err = e
            continue

    print(f"Error: All API keys failed. Last error: {last_err}")
    sys.exit(1)

if __name__ == "__main__":
    main()
