import re
from typing import Dict, Any, List

def parse_sermon_text(raw_text: str) -> Dict[str, Any]:
    """
    Parses church sermon sharing guide text into structured fields:
    - date_display
    - series
    - title
    - subtitle
    - scripture_ref
    - scripture_text
    - summary
    - key_message
    - topics: List of dicts (order, title, explanation, meditation_questions, gospel_decision)
    """
    text = raw_text.replace('\r\n', '\n').strip()
    
    # 1. Date (e.g., "2026년 9월 13일 주일설교" or similar pattern)
    date_match = re.search(r'(\d{4}년\s*\d{1,2}월\s*\d{1,2}일[^\n]*)', text)
    date_display = date_match.group(1).strip() if date_match else "날짜 미정"
    
    # 2. Series (e.g., "복음의 미친 사람들 요셉 시리즈 5편" or lines containing '시리즈')
    series_match = re.search(r'([^\n]+시리즈[^\n]*)', text)
    series = series_match.group(1).strip() if series_match else ""
    
    # 3. Title (제목 : ...)
    title_match = re.search(r'제목\s*[:：]\s*([^\n]+)', text)
    title = title_match.group(1).strip() if title_match else ""
    if not title:
        # Fallback if no "제목 :" prefix: check 1st or 2nd line
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        for line in lines[:5]:
            if "설교" not in line and "시리즈" not in line and not line.startswith("본문"):
                title = line
                break

    # 4. Subtitle (부제 : ...)
    subtitle_match = re.search(r'부제\s*[:：]\s*([^\n]+)', text)
    subtitle = subtitle_match.group(1).strip() if subtitle_match else ""
    
    # 5. Scripture Reference (본문 : ...)
    scrip_ref_match = re.search(r'본문\s*[:：]\s*([^\n]+)', text)
    scripture_ref = scrip_ref_match.group(1).strip() if scrip_ref_match else ""
    
    # 6. Major Sections split
    # ■ 본문 핵심 요약
    # ■ 본문 핵심 메시지
    summary_split = re.split(r'■\s*본문\s*핵심\s*요약', text)
    header_and_scripture = summary_split[0]
    after_summary_hdr = summary_split[1] if len(summary_split) > 1 else ""
    
    # Scripture text (between "본문 : ..." and "■ 본문 핵심 요약")
    scripture_text = ""
    if scrip_ref_match:
        pos = scrip_ref_match.end()
        scripture_text = header_and_scripture[pos:].strip()
    
    # Summary text & Key message text
    msg_split = re.split(r'■\s*본문\s*핵심\s*메시지', after_summary_hdr)
    summary = msg_split[0].strip() if len(msg_split) > 0 else ""
    after_msg_hdr = msg_split[1] if len(msg_split) > 1 else ""
    
    # Find start of topics (e.g. "\n1. ")
    first_topic_match = re.search(r'\n(?=1\.\s+)', after_msg_hdr)
    if first_topic_match:
        key_message = after_msg_hdr[:first_topic_match.start()].strip()
        topics_section = after_msg_hdr[first_topic_match.start():].strip()
    else:
        key_message = after_msg_hdr.strip()
        topics_section = ""
        
    # If topics_section is empty, search in the whole text
    if not topics_section:
        topic_start = re.search(r'\n(?=1\.\s+)', text)
        if topic_start:
            topics_section = text[topic_start.start():].strip()

    # 7. Discussion Topics parsing
    # Pattern:
    # {order}. {title}
    # 해설 : {explanation}
    # ➡ 묵상질문
    # {1. ... 2. ... 3. ...}
    # ➡ 복음적 결단 : {decision}
    topic_pattern = re.compile(
        r'(?:^|\n)(?P<order>\d+)\.\s*(?P<title>[^\n]+?)\s*\n+'
        r'해설\s*[:：]\s*(?P<explanation>[\s\S]*?)\s*'
        r'➡?\s*묵상\s*질문\s*\n*(?P<questions>[\s\S]*?)\s*'
        r'➡?\s*복음적\s*결단\s*[:：]\s*(?P<decision>[\s\S]*?)(?=(?:\n\d+\.\s+[^\n]+?\n+해설\s*[:：])|\Z)',
        re.MULTILINE
    )
    
    matches = list(topic_pattern.finditer(topics_section))
    topics: List[Dict[str, Any]] = []
    
    if matches:
        for m in matches:
            order = int(m.group('order'))
            t_title = m.group('title').strip()
            explanation = m.group('explanation').strip()
            raw_qs = m.group('questions').strip()
            # Split questions by numbered list (1., 2., 3.) or lines
            q_lines = [
                re.sub(r'^\d+\.\s*', '', line).strip() 
                for line in raw_qs.split('\n') 
                if line.strip()
            ]
            decision = m.group('decision').strip()
            
            topics.append({
                "topic_order": order,
                "topic_title": t_title,
                "explanation": explanation,
                "meditation_questions": q_lines,
                "gospel_decision": decision
            })
    else:
        # Fallback parser if custom format is slightly different
        raw_blocks = re.split(r'\n(?=\d+\.\s+)', '\n' + topics_section)
        for block in raw_blocks:
            block = block.strip()
            if not block:
                continue
            m = re.match(r'^(\d+)\.\s*([^\n]+)', block)
            if not m:
                continue
            order = int(m.group(1))
            t_title = m.group(2).strip()
            body = block[m.end():].strip()
            
            exp_match = re.search(r'해설\s*[:：]\s*([\s\S]*?)(?=(?:➡?\s*묵상|➡?\s*복음적|\Z))', body)
            explanation = exp_match.group(1).strip() if exp_match else body
            
            mq_match = re.search(r'묵상\s*질문\s*([\s\S]*?)(?=(?:➡?\s*복음적|\Z))', body)
            mq_text = mq_match.group(1).strip() if mq_match else ""
            q_lines = [re.sub(r'^\d+\.\s*', '', line).strip() for line in mq_text.split('\n') if line.strip()]
            
            dec_match = re.search(r'복음적\s*결단\s*[:：]\s*([\s\S]*)', body)
            decision = dec_match.group(1).strip() if dec_match else ""
            
            topics.append({
                "topic_order": order,
                "topic_title": t_title,
                "explanation": explanation,
                "meditation_questions": q_lines,
                "gospel_decision": decision
            })

    return {
        "date_display": date_display,
        "series": series,
        "title": title,
        "subtitle": subtitle,
        "scripture_ref": scripture_ref,
        "scripture_text": scripture_text,
        "summary": summary,
        "key_message": key_message,
        "raw_content": raw_text,
        "topics": topics
    }
