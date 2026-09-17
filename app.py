import os
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, APIRouter
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

import database
import parser
import seed_data

# Initialize DB and seed initial data if empty
database.init_db()
try:
    seed_data.seed()
except Exception as e:
    print(f"[Init] Seed data check note: {e}")

# Read and normalize DEFAULT_PREFIX environment variable
raw_prefix = os.environ.get("DEFAULT_PREFIX", "myresolution").strip()
PREFIX = f"/{raw_prefix.strip('/')}" if raw_prefix and raw_prefix.strip('/') else ""

app = FastAPI(
    title="말씀 나눔 매거진 웹앱",
    description="모바일 설교 나눔지 매거진 웹앱 API",
    docs_url=f"{PREFIX}/docs" if PREFIX else "/docs",
    openapi_url=f"{PREFIX}/openapi.json" if PREFIX else "/openapi.json"
)

# --- Pydantic Models ---

class ParseRequest(BaseModel):
    raw_text: str

class TopicItem(BaseModel):
    id: Optional[int] = None
    topic_order: int
    topic_title: str
    explanation: Optional[str] = ""
    meditation_questions: Optional[List[str]] = []
    gospel_decision: Optional[str] = ""

class CardCreateRequest(BaseModel):
    date_display: Optional[str] = ""
    series: Optional[str] = ""
    title: str
    subtitle: Optional[str] = ""
    scripture_ref: Optional[str] = ""
    scripture_text: Optional[str] = ""
    summary: Optional[str] = ""
    key_message: Optional[str] = ""
    raw_content: Optional[str] = ""
    topics: List[TopicItem] = []

# --- API Router ---
api_router = APIRouter(prefix="/api")

@api_router.get("/status")
def get_health_status():
    """헬스체크 및 시스템 구동 상태 확인 엔드포인트"""
    cards = database.get_all_cards()
    return {
        "status": "healthy",
        "prefix": PREFIX,
        "database_file": database.DB_FILE,
        "database_exists": os.path.exists(database.DB_FILE),
        "cards_count": len(cards)
    }

@api_router.get("/cards")
def list_cards():
    return {"cards": database.get_all_cards()}

@api_router.get("/cards/{card_id}")
def get_card_detail(card_id: int):
    card = database.get_card(card_id)
    if not card:
        raise HTTPException(status_code=404, detail="카드를 찾을 수 없습니다.")
    return card

@api_router.post("/cards/parse")
def parse_text(req: ParseRequest):
    if not req.raw_text or not req.raw_text.strip():
        raise HTTPException(status_code=400, detail="분석할 텍스트가 비어 있습니다.")
    result = parser.parse_sermon_text(req.raw_text)
    return result

@api_router.post("/cards")
def create_new_card(req: CardCreateRequest):
    card_dict = req.model_dump()
    topics = card_dict.pop("topics", [])
    card_id = database.create_card(card_dict, topics)
    return {"success": True, "id": card_id, "message": "새 나눔 카드가 등록되었습니다."}

@api_router.put("/cards/{card_id}")
def update_existing_card(card_id: int, req: CardCreateRequest):
    existing = database.get_card(card_id)
    if not existing:
        raise HTTPException(status_code=404, detail="수정할 카드를 찾을 수 없습니다.")
    card_dict = req.model_dump()
    topics = card_dict.pop("topics", [])
    database.update_card(card_id, card_dict, topics)
    return {"success": True, "id": card_id, "message": "나눔 카드가 성공적으로 수정되었습니다."}

@api_router.delete("/cards/{card_id}")
def delete_existing_card(card_id: int):
    existing = database.get_card(card_id)
    if not existing:
        raise HTTPException(status_code=404, detail="삭제할 카드를 찾을 수 없습니다.")
    database.delete_card(card_id)
    return {"success": True, "message": "나눔 카드가 삭제되었습니다."}

@api_router.get("/sample")
def get_sample_text():
    txt_path = os.path.join(os.path.dirname(__file__), "20260913.txt")
    if os.path.exists(txt_path):
        with open(txt_path, "r", encoding="utf-8") as f:
            return {"text": f.read()}
    return {"text": ""}

# --- Router Registration ---
# 1) Register router under the configured prefix (e.g. /myresolution/api/...)
if PREFIX:
    app.include_router(api_router, prefix=PREFIX)

# 2) Also register under root (/api/...) for direct or reverse-proxy path-stripping compatibility
app.include_router(api_router)

# 3) Fallback: if custom prefix differs from "/myresolution", still route /myresolution for fixed healthchecks
if PREFIX != "/myresolution":
    app.include_router(api_router, prefix="/myresolution")

# --- Static Files & Frontend HTML ---
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir, exist_ok=True)

# Mount static directory under prefix and root
if PREFIX:
    app.mount(f"{PREFIX}/static", StaticFiles(directory=static_dir), name="static_prefix")
app.mount("/static", StaticFiles(directory=static_dir), name="static_root")

def render_index_html():
    index_path = os.path.join(static_dir, "index.html")
    if not os.path.exists(index_path):
        return HTMLResponse("<h1>index.html not found</h1>", status_code=404)
    with open(index_path, "r", encoding="utf-8") as f:
        content = f.read()

    base_href = f"{PREFIX}/" if PREFIX else "/"
    injection = f"""  <base href="{base_href}">
  <script>window.__BASE_PREFIX__ = "{PREFIX}";</script>"""
    if "<head>" in content:
        content = content.replace("<head>", f"<head>\n{injection}", 1)
    return HTMLResponse(content)

if PREFIX:
    @app.get(f"{PREFIX}")
    def serve_prefix_without_slash():
        return RedirectResponse(url=f"{PREFIX}/", status_code=308)

    @app.get(f"{PREFIX}/")
    def serve_prefix_index():
        return render_index_html()

    @app.get("/")
    def serve_root():
        return RedirectResponse(url=f"{PREFIX}/", status_code=307)
else:
    @app.get("/")
    def serve_root_index():
        return render_index_html()

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 5000))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True)
