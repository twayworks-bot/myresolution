import sqlite3
import json
import os
from typing import List, Dict, Any, Optional

# Persistent volume PATH support
DEFAULT_DB_FILE = os.path.join(os.path.dirname(__file__), "sermon_sharing.db")
DB_ENV_PATH = os.environ.get("DB_PATH", os.environ.get("DATABASE_PATH", DEFAULT_DB_FILE)).strip()

# If directory path is given, append default filename
if os.path.isdir(DB_ENV_PATH) or DB_ENV_PATH.endswith("/") or DB_ENV_PATH.endswith("\\"):
    DB_FILE = os.path.join(DB_ENV_PATH, "sermon_sharing.db")
else:
    DB_FILE = DB_ENV_PATH

# Ensure directory for DB_FILE exists
db_dir = os.path.dirname(os.path.abspath(DB_FILE))
if db_dir and not os.path.exists(db_dir):
    os.makedirs(db_dir, exist_ok=True)

def get_connection():
    # Double-check directory exists before connecting
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    
    # 1. Sermon Cards Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sermon_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_display TEXT,
        series TEXT,
        title TEXT NOT NULL,
        subtitle TEXT,
        scripture_ref TEXT,
        scripture_text TEXT,
        summary TEXT,
        key_message TEXT,
        raw_content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 2. Discussion Topics Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS discussion_topics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id INTEGER NOT NULL,
        topic_order INTEGER NOT NULL,
        topic_title TEXT NOT NULL,
        explanation TEXT,
        meditation_questions TEXT,
        gospel_decision TEXT,
        FOREIGN KEY (card_id) REFERENCES sermon_cards (id) ON DELETE CASCADE
    );
    """)
    
    conn.commit()
    conn.close()

def get_all_cards() -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT c.*, COUNT(t.id) as topic_count
        FROM sermon_cards c
        LEFT JOIN discussion_topics t ON c.id = t.card_id
        GROUP BY c.id
        ORDER BY c.id DESC
    """)
    rows = cursor.fetchall()
    cards = []
    for r in rows:
        d = dict(r)
        cards.append(d)
    conn.close()
    return cards

def get_card(card_id: int) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM sermon_cards WHERE id = ?", (card_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return None
    
    card = dict(row)
    cursor.execute("""
        SELECT * FROM discussion_topics 
        WHERE card_id = ? 
        ORDER BY topic_order ASC, id ASC
    """, (card_id,))
    topic_rows = cursor.fetchall()
    
    topics = []
    for tr in topic_rows:
        td = dict(tr)
        try:
            td["meditation_questions"] = json.loads(td["meditation_questions"] or "[]")
        except Exception:
            td["meditation_questions"] = []
        topics.append(td)
        
    card["topics"] = topics
    conn.close()
    return card

def create_card(card_data: Dict[str, Any], topics: List[Dict[str, Any]]) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        INSERT INTO sermon_cards (
            date_display, series, title, subtitle,
            scripture_ref, scripture_text, summary,
            key_message, raw_content, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    """, (
        card_data.get("date_display", ""),
        card_data.get("series", ""),
        card_data.get("title", ""),
        card_data.get("subtitle", ""),
        card_data.get("scripture_ref", ""),
        card_data.get("scripture_text", ""),
        card_data.get("summary", ""),
        card_data.get("key_message", ""),
        card_data.get("raw_content", "")
    ))
    card_id = cursor.lastrowid
    
    for t in topics:
        q_json = json.dumps(t.get("meditation_questions", []), ensure_ascii=False)
        cursor.execute("""
            INSERT INTO discussion_topics (
                card_id, topic_order, topic_title,
                explanation, meditation_questions, gospel_decision
            ) VALUES (?, ?, ?, ?, ?, ?)
        """, (
            card_id,
            t.get("topic_order", 1),
            t.get("topic_title", ""),
            t.get("explanation", ""),
            q_json,
            t.get("gospel_decision", "")
        ))
        
    conn.commit()
    conn.close()
    return card_id

def update_card(card_id: int, card_data: Dict[str, Any], topics: List[Dict[str, Any]]) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        UPDATE sermon_cards SET
            date_display = ?,
            series = ?,
            title = ?,
            subtitle = ?,
            scripture_ref = ?,
            scripture_text = ?,
            summary = ?,
            key_message = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (
        card_data.get("date_display", ""),
        card_data.get("series", ""),
        card_data.get("title", ""),
        card_data.get("subtitle", ""),
        card_data.get("scripture_ref", ""),
        card_data.get("scripture_text", ""),
        card_data.get("summary", ""),
        card_data.get("key_message", ""),
        card_id
    ))
    
    # Delete existing topics and re-insert
    cursor.execute("DELETE FROM discussion_topics WHERE card_id = ?", (card_id,))
    for t in topics:
        q_json = json.dumps(t.get("meditation_questions", []), ensure_ascii=False)
        cursor.execute("""
            INSERT INTO discussion_topics (
                card_id, topic_order, topic_title,
                explanation, meditation_questions, gospel_decision
            ) VALUES (?, ?, ?, ?, ?, ?)
        """, (
            card_id,
            t.get("topic_order", 1),
            t.get("topic_title", ""),
            t.get("explanation", ""),
            q_json,
            t.get("gospel_decision", "")
        ))
        
    conn.commit()
    conn.close()
    return True

def delete_card(card_id: int) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM sermon_cards WHERE id = ?", (card_id,))
    conn.commit()
    conn.close()
    return True
