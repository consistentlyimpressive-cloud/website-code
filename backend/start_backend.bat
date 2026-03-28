@echo off
echo Starting FastAPI Backend...
call venv\Scripts\activate.bat
python -m uvicorn main:app --host 0.0.0.0 --port 3001 --reload
