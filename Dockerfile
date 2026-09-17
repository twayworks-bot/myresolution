# ===================================================================
# Dockerfile for 말씀 나눔 매거진 웹앱 (FastAPI)
# ===================================================================
FROM python:3.11-slim

# 파이썬 실행 환경 및 앱 설정 환경변수
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=5000 \
    DEFAULT_PREFIX=myresolution \
    DB_PATH=/app/data/sermon_sharing.db

# 작업 디렉토리 설정
WORKDIR /app

# 필수 유틸리티 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Persistent Volume 연동을 위한 데이터 디렉토리 생성
RUN mkdir -p /app/data

# 종속성 파일 복사 및 설치 (도커 레이어 캐싱 활용)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 전체 소스코드 복사
COPY . .

# 데이터베이스 영구 저장을 위한 Persistent Volume 마운트 포인트
VOLUME ["/app/data"]

# 웹 서버 노출 포트
EXPOSE 5000

# 컨테이너 헬스체크 정의 (DEFAULT_PREFIX 환경변수 동적 연동 및 기본 경로 보장)
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=5s \
    CMD python -c "import os, requests; prefix = os.getenv('DEFAULT_PREFIX', 'myresolution').strip('/'); url = f'http://localhost:5000/{prefix}/api/status' if prefix else 'http://localhost:5000/api/status'; res = requests.get(url); res.raise_for_status()"

# -------------------------------------------------------------------
# 서버 실행 CMD (FastAPI 표준 uvicorn 기본 적용)
# -------------------------------------------------------------------
# 1) Gunicorn 운영서버로 기동 (FastAPI ASGI 구동을 위해 uvicorn worker 적용)
# CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "-k", "uvicorn.workers.UvicornWorker", "--log-level", "debug", "--access-logfile", "-", "--error-logfile", "-", "--capture-output", "main:app"]

# 2) Run the FastAPI server using Uvicorn on port 5000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5000"]
