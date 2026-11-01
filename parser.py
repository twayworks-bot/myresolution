import re
from typing import Dict, Any, List, Optional


def normalize_text(raw_text: str) -> str:
    """
    Normalizes pasted text before parsing.
    - Unifies line endings (\\r\\n, \\r -> \\n)
    - Removes leading/trailing whitespace on EVERY line (incl. NBSP / full-width spaces).
      Text copied from terminals, messengers or e-mail is often indented
      (e.g. every line starts with 2 spaces), which broke line-start based detection.
    - Collapses 3+ consecutive blank lines into one blank line
    """
    text = raw_text.replace('\r\n', '\n').replace('\r', '\n')
    text = text.replace('\u00a0', ' ').replace('\u3000', ' ').replace('\ufeff', '')
    lines = [line.strip() for line in text.split('\n')]
    text = '\n'.join(lines)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

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
    text = normalize_text(raw_text)
    
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
    
    # Find start of topics: the first real topic header ("N. 제목" followed by "해설").
    # Meditation-question numbers are ignored, so key_message is cut at the right place.
    first_header = _first_topic_header_pos(after_msg_hdr)
    if first_header is not None:
        key_message = after_msg_hdr[:first_header].strip()
        topics_section = after_msg_hdr[first_header:].strip()
    else:
        key_message = after_msg_hdr.strip()
        topics_section = ""
        
    # If topics_section is empty, search in the whole text
    if not topics_section:
        topic_start = _first_topic_header_pos(text)
        if topic_start is not None:
            topics_section = text[topic_start:].strip()

    topics = parse_topics(topics_section)

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


# ----------------------------------------------------------------------
# Discussion topic parsing (marker-based, colon-tolerant)
# ----------------------------------------------------------------------
# Section markers. The colon (":" / "：") and other separators ("-", "–")
# after a marker are OPTIONAL, and the arrow (➡ / → / ▶ / ■ ...) and inner
# spaces are optional too. Examples that all match:
#   "➡ 복음적 결단 : ...", "➡ 복음적 결단", "➡복음적결단 ...", "복음적 결단- ..."
_ARROW = r'(?:[➡→▶►▷■●◆\-•]\s*)?'
_SEP = r'[ \t]*(?:[:：\-–—][ \t]*)?'

# "해설" marker: must be at the start of a line.
_EXPLANATION_RE = re.compile(r'^[ \t]*' + _ARROW + r'해[ \t]*설' + _SEP, re.MULTILINE)
# "묵상질문" marker: whole line (questions follow on the next lines).
_QUESTIONS_RE = re.compile(r'^[ \t]*' + _ARROW + r'묵[ \t]*상[ \t]*질[ \t]*문' + _SEP, re.MULTILINE)
# "복음적 결단" marker: decision text may be on the same line or the next lines.
_DECISION_RE = re.compile(r'^[ \t]*' + _ARROW + r'복[ \t]*음[ \t]*적[ \t]*결[ \t]*단' + _SEP, re.MULTILINE)

# Numbered line "N. text"
_NUMBERED_LINE_RE = re.compile(r'^[ \t]*(\d+)[.)][ \t]*(\S.*)$', re.MULTILINE)


def _find_topic_headers(section: str) -> List[re.Match]:
    """
    Returns numbered lines that are real topic headers.

    Meditation questions are also numbered ("1. ...", "2. ..."), so a numbered
    line is treated as a topic header only when the next non-empty line is the
    "해설" marker. If the text has no "해설" markers at all, numbered lines that
    are NOT inside a 묵상질문 block are used instead.
    """
    candidates = list(_NUMBERED_LINE_RE.finditer(section))

    headers = []
    for m in candidates:
        rest = section[m.end():].lstrip()
        if _EXPLANATION_RE.match(rest):
            headers.append(m)
    if headers:
        return headers

    # Fallback (no "해설" markers): skip numbered lines that live between a
    # 묵상질문 marker and the following 복음적 결단 marker.
    question_spans = []
    for qm in _QUESTIONS_RE.finditer(section):
        dm = _DECISION_RE.search(section, qm.end())
        question_spans.append((qm.start(), dm.start() if dm else len(section)))
    return [
        m for m in candidates
        if not any(s <= m.start() < e for s, e in question_spans)
    ]


def _first_topic_header_pos(text: str) -> Optional[int]:
    """Start offset of the first real topic header in text, or None."""
    headers = _find_topic_headers('\n' + text)
    if not headers:
        return None
    return max(headers[0].start() - 1, 0)


def _split_questions(raw: str) -> List[str]:
    """Split a 묵상질문 block into individual questions (numbered or one per line)."""
    raw = raw.strip()
    if not raw:
        return []
    numbered = list(_NUMBERED_LINE_RE.finditer(raw))
    if numbered:
        questions = []
        for i, m in enumerate(numbered):
            end = numbered[i + 1].start() if i + 1 < len(numbered) else len(raw)
            # Join wrapped continuation lines of the same question
            q = ' '.join(line.strip() for line in raw[m.start(2):end].split('\n') if line.strip())
            if q:
                questions.append(q)
        return questions
    return [line.strip() for line in raw.split('\n') if line.strip()]


def parse_topics(section: str) -> List[Dict[str, Any]]:
    """
    Parses the discussion topic area into a list of topics:

        {order}. {title}
        해설 [:] {explanation}
        ➡ 묵상질문 [:]
        1. ... 2. ... 3. ...
        ➡ 복음적 결단 [:] {decision}   (same line or following lines)
    """
    if not section:
        return []
    section = '\n' + normalize_text(section)

    headers = _find_topic_headers(section)
    topics: List[Dict[str, Any]] = []

    for i, h in enumerate(headers):
        block_end = headers[i + 1].start() if i + 1 < len(headers) else len(section)
        body = section[h.end():block_end]

        exp_m = _EXPLANATION_RE.search(body)
        q_m = _QUESTIONS_RE.search(body)
        d_m = _DECISION_RE.search(body)

        # Explanation: after "해설" (or block start) until the next marker
        exp_start = exp_m.end() if exp_m else 0
        exp_end_candidates = [m.start() for m in (q_m, d_m) if m and m.start() >= exp_start]
        exp_end = min(exp_end_candidates) if exp_end_candidates else len(body)
        explanation = body[exp_start:exp_end].strip()

        # Meditation questions: after "묵상질문" until "복음적 결단" (or block end)
        questions: List[str] = []
        if q_m:
            q_end = d_m.start() if d_m and d_m.start() > q_m.end() else len(body)
            questions = _split_questions(body[q_m.end():q_end])

        # Gospel decision: after "복음적 결단" until block end
        decision = body[d_m.end():].strip() if d_m else ""

        topics.append({
            "topic_order": int(h.group(1)),
            "topic_title": h.group(2).strip(),
            "explanation": explanation,
            "meditation_questions": questions,
            "gospel_decision": decision,
        })

    return topics
