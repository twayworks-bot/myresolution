@echo off
chcp 65001 > nul
echo ===================================================
echo   말씀 나눔 매거진 웹앱을 시작합니다.
echo   브라우저 주소: http://127.0.0.1:8000
echo ===================================================

if not exist ".venv\Scripts\python.exe" (
    echo 가상환경을 생성하고 패키지를 설치합니다...
    uv venv
    uv pip install fastapi uvicorn httpx
    .\.venv\Scripts\python.exe seed_data.py
)

.\.venv\Scripts\python.exe -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload
pause
