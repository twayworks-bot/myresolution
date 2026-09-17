import os
import database
import parser

def seed():
    database.init_db()
    
    # Check if cards already exist
    existing = database.get_all_cards()
    if existing:
        print(f"Database already contains {len(existing)} cards. Skipping seed or re-seeding.")
        return
    
    txt_path = os.path.join(os.path.dirname(__file__), "20260913.txt")
    if not os.path.exists(txt_path):
        print("20260913.txt not found.")
        return
        
    with open(txt_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    parsed = parser.parse_sermon_text(content)
    topics = parsed.pop("topics")
    card_id = database.create_card(parsed, topics)
    print(f"Successfully seeded 20260913.txt into SQLite DB! Created Card ID: {card_id}, with {len(topics)} topics.")

if __name__ == "__main__":
    seed()
