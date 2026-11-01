// Base Prefix & API Helper
const BASE_PREFIX = (typeof window.__BASE_PREFIX__ !== 'undefined')
  ? window.__BASE_PREFIX__
  : (window.location.pathname.startsWith('/myresolution') ? '/myresolution' : '');

function getApiUrl(endpoint) {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${BASE_PREFIX}${cleanEndpoint}`;
}

// State
let cardsData = [];
let currentCard = null;
let currentTone = 'deepblue'; // 'deepblue' | 'warmbeige'
let currentFontSize = 16;
let allExpanded = false;
let parsedDataCache = null;

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
  await loadCards();
  if (window.lucide) {
    window.lucide.createIcons();
  }
  // 개별 카드 링크(/card/{id} 또는 ?card={id})로 진입한 경우 해당 카드 상세를 바로 엽니다.
  const linkedId = getCardIdFromUrl();
  if (linkedId) {
    openDetailView(linkedId, { history: 'replace' });
  }
});

// 브라우저 뒤로가기/앞으로가기 지원
window.addEventListener('popstate', () => {
  const cardId = getCardIdFromUrl();
  if (cardId) {
    openDetailView(cardId, { history: 'none' });
  } else {
    showMainView({ history: 'none' });
  }
});

// ----------------------------------------------------
// 0. CARD LINK (고유 링크) HELPERS
// ----------------------------------------------------
// 현재 URL에서 카드 ID 추출: {prefix}/card/{id} 또는 ?card={id}
function getCardIdFromUrl() {
  const m = window.location.pathname.match(/\/card\/(\d+)\/?$/);
  if (m) return parseInt(m[1], 10);
  const q = new URLSearchParams(window.location.search).get('card');
  return q && /^\d+$/.test(q) ? parseInt(q, 10) : null;
}

function getCardPath(cardId) {
  return `${BASE_PREFIX}/card/${cardId}`;
}

// 카드별 공유용 절대 URL
function getCardShareUrl(cardId) {
  return `${window.location.origin}${getCardPath(cardId)}`;
}

function getMainPath() {
  return `${BASE_PREFIX}/`;
}

// 클립보드 복사 (HTTP 환경 등 clipboard API 미지원 시 fallback)
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fallback below */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

async function copyCardLink(cardId, event) {
  if (event) event.stopPropagation();
  const url = getCardShareUrl(cardId);
  const ok = await copyText(url);
  if (ok) {
    showToast('링크가 복사되었습니다. 카톡/문자에 붙여넣어 공유하세요.');
  } else {
    window.prompt('아래 링크를 복사하세요.', url);
  }
}

// 모바일에서는 시스템 공유 시트, 그 외에는 링크 복사
async function shareCurrentCard() {
  if (!currentCard) return;
  const url = getCardShareUrl(currentCard.id);
  if (navigator.share) {
    try {
      await navigator.share({
        title: currentCard.title || '말씀 나눔 카드',
        text: [currentCard.date_display, currentCard.title].filter(Boolean).join(' - '),
        url
      });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 사용자가 공유 취소
    }
  }
  copyCardLink(currentCard.id);
}

let toastTimer = null;
function showToast(message) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.className = 'app-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2400);
}

// Refresh Lucide Icons safely
function refreshIcons() {
  if (window.lucide) {
    setTimeout(() => window.lucide.createIcons(), 50);
  }
}

// ----------------------------------------------------
// 1. DATA FETCHING & LIST RENDERING
// ----------------------------------------------------
async function loadCards() {
  const container = document.getElementById('cards-container');
  try {
    const res = await fetch(getApiUrl('/api/cards'));
    const data = await res.json();
    cardsData = data.cards || [];

    document.getElementById('card-count-badge').textContent = cardsData.length;
    document.getElementById('admin-card-count').textContent = cardsData.length;

    if (cardsData.length === 0) {
      container.innerHTML = `
        <div class="bg-stone-900/70 border border-white/10 rounded-2xl p-8 text-center text-stone-300 backdrop-blur-md">
          <i data-lucide="book-open" class="w-10 h-10 text-amber-400 mx-auto mb-3 stroke-1"></i>
          <p class="font-semibold text-base text-white">등록된 나눔 카드가 없습니다</p>
          <p class="text-xs text-stone-400 mt-1 mb-4">우측 하단의 관리 아이콘(+)을 눌러 나눔지 텍스트를 붙여넣어 보세요.</p>
          <button onclick="openAdminModal()" class="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-xl text-xs shadow">
            나눔지 등록하기
          </button>
        </div>
      `;
    } else {
      container.innerHTML = cardsData.map(card => renderMagazineCard(card)).join('');
    }
    renderAdminCardsList();
    refreshIcons();
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="p-4 text-center text-rose-400 text-sm">데이터를 불러오는 중 오류가 발생했습니다.</div>`;
  }
}

// Render Single Magazine Card for Main Feed
function renderMagazineCard(card) {
  const topicCount = card.topic_count || (card.topics ? card.topics.length : 0);
  
  return `
    <article onclick="openDetailView(${card.id})" class="magazine-card group cursor-pointer bg-stone-900/80 border border-white/15 hover:border-amber-400/50 rounded-3xl p-5 shadow-2xl overflow-hidden relative">
      <!-- Ambient Glow in Top Right -->
      <div class="absolute -top-12 -right-12 w-36 h-36 bg-amber-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-amber-500/20 transition"></div>

      <!-- Card Top Badge: Date & Series -->
      <div class="flex items-center justify-between gap-2 mb-3">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-300 text-[11px] font-semibold">
            <i data-lucide="calendar" class="w-3 h-3"></i>
            ${escapeHtml(card.date_display || '주일설교')}
          </span>
          ${card.series ? `
            <span class="inline-block px-2.5 py-1 rounded-full bg-white/10 text-stone-300 text-[11px] font-medium border border-white/10">
              ${escapeHtml(card.series)}
            </span>
          ` : ''}
        </div>
        <span class="text-[11px] font-medium text-stone-400 flex items-center gap-1">
          <i data-lucide="help-circle" class="w-3 h-3 text-amber-400"></i>
          나눔 ${topicCount}개
        </span>
      </div>

      <!-- Card Title & Subtitle -->
      <div class="mb-4">
        <h2 class="text-xl sm:text-2xl font-bold text-white tracking-tight group-hover:text-amber-200 transition-colors leading-snug">
          ${escapeHtml(card.title)}
        </h2>
        ${card.subtitle ? `
          <p class="text-xs text-stone-300/85 mt-1 font-editorial tracking-wide">
            ${escapeHtml(card.subtitle)}
          </p>
        ` : ''}
      </div>

      <!-- Scripture Reference Tag & Quote Box Preview -->
      ${card.scripture_ref ? `
        <div class="mb-4 p-3 bg-amber-950/30 border-l-4 border-amber-500 rounded-r-xl text-xs text-amber-100/90 font-editorial flex items-start gap-2">
          <i data-lucide="bookmark" class="w-4 h-4 text-amber-400 shrink-0 mt-0.5"></i>
          <div>
            <span class="font-bold text-amber-300 block mb-0.5">참고 본문 : ${escapeHtml(card.scripture_ref)}</span>
            ${card.scripture_text ? `
              <p class="text-[11px] text-stone-300 line-clamp-2 leading-relaxed">
                ${escapeHtml(card.scripture_text)}
              </p>
            ` : ''}
          </div>
        </div>
      ` : ''}

      <!-- Sermon Summary Preview (Essay Column Typography style) -->
      ${card.summary ? `
        <div class="mb-3">
          <span class="text-[10px] uppercase font-bold text-amber-400/90 tracking-wider block mb-1">■ 설교 요약</span>
          <p class="text-xs text-stone-300/90 leading-relaxed font-editorial line-clamp-3">
            ${escapeHtml(card.summary)}
          </p>
        </div>
      ` : ''}

      <!-- Key Message Callout -->
      ${card.key_message ? `
        <div class="p-3 bg-white/5 border border-white/10 rounded-2xl text-xs mb-4">
          <div class="flex items-center gap-1.5 text-amber-300 font-semibold text-[11px] mb-1">
            <i data-lucide="lightbulb" class="w-3.5 h-3.5"></i>
            <span>핵심 메시지</span>
          </div>
          <p class="text-[12px] text-stone-200 leading-relaxed font-editorial line-clamp-2">
            ${escapeHtml(card.key_message)}
          </p>
        </div>
      ` : ''}

      <!-- Card Action Footer -->
      <div class="pt-3 border-t border-white/10 flex items-center justify-between text-xs font-semibold text-amber-400 group-hover:text-amber-300 transition">
        <span class="flex items-center gap-1">
          <i data-lucide="message-square" class="w-3.5 h-3.5"></i>
          소그룹 나눔과 복음적 결단 보기
        </span>
        <span class="flex items-center gap-1.5">
          <button onclick="copyCardLink(${card.id}, event)" title="이 카드 링크 복사" class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/5 hover:bg-white/15 text-stone-300 text-[11px] font-medium transition">
            <i data-lucide="link" class="w-3 h-3"></i> 링크
          </button>
          <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/5 group-hover:bg-amber-400 group-hover:text-stone-950 transition">
            <i data-lucide="arrow-right" class="w-4 h-4"></i>
          </span>
        </span>
      </div>
    </article>
  `;
}

// ----------------------------------------------------
// 2. DETAIL VIEW & ACCORDION RENDERING
// ----------------------------------------------------
async function openDetailView(cardId, options = {}) {
  const historyMode = options.history || 'push'; // 'push' | 'replace' | 'none'
  try {
    const res = await fetch(getApiUrl(`/api/cards/${cardId}`));
    if (!res.ok) throw new Error('카드를 찾을 수 없습니다. 삭제되었거나 잘못된 링크입니다.');
    currentCard = await res.json();

    // 주소창을 카드 고유 링크로 변경 (새로고침/공유 시 같은 카드가 열림)
    const path = getCardPath(cardId);
    if (historyMode === 'push' && window.location.pathname !== path) {
      history.pushState({ cardId }, '', path);
    } else if (historyMode === 'replace') {
      history.replaceState({ cardId }, '', path);
    }
    document.title = `${currentCard.title || '말씀 나눔 카드'} | 말씀 나눔 매거진`;

    document.getElementById('view-main').classList.add('hidden');
    document.getElementById('view-detail').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    renderDetailView();
    refreshIcons();
  } catch (err) {
    alert(err.message);
    // 잘못된 링크로 진입한 경우 목록 화면으로
    if (historyMode !== 'push') showMainView({ history: 'replace' });
  }
}

function showMainView(options = {}) {
  const historyMode = options.history || 'push';
  const mainPath = getMainPath();
  if (historyMode === 'push' && window.location.pathname !== mainPath) {
    history.pushState({}, '', mainPath);
  } else if (historyMode === 'replace') {
    history.replaceState({}, '', mainPath);
  }
  currentCard = null;
  document.title = '말씀 나눔 매거진';
  document.getElementById('view-detail').classList.add('hidden');
  document.getElementById('view-main').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderDetailView() {
  if (!currentCard) return;
  const c = currentCard;
  const container = document.getElementById('detail-content');

  // Scripture Quote Box
  let scriptureSection = '';
  if (c.scripture_ref || c.scripture_text) {
    scriptureSection = `
      <section class="scripture-quote-box p-4 sm:p-5 text-stone-900 border-l-4 border-amber-600 dark:border-amber-500">
        <div class="flex items-center justify-between mb-2">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-600/10 text-amber-800 text-xs font-bold tracking-wide">
            <i data-lucide="scroll" class="w-3.5 h-3.5"></i>
            참고 성경말씀 본문
          </span>
          <span class="text-xs font-bold text-amber-900">${escapeHtml(c.scripture_ref || '')}</span>
        </div>
        ${c.scripture_text ? `
          <div id="full-scripture-box" class="relative mt-2">
            <blockquote class="text-xs sm:text-sm text-stone-800 font-editorial leading-relaxed pl-2 border-l-2 border-stone-300 italic">
              "${escapeHtml(c.scripture_text)}"
            </blockquote>
          </div>
        ` : ''}
      </section>
    `;
  }

  // Sermon Summary & Key Message in Editorial Column Typography
  const editorialSection = `
    <section class="bg-stone-900/85 backdrop-blur-md border border-white/15 rounded-3xl p-5 sm:p-6 shadow-xl space-y-5">
      <!-- Title Header in Detail View -->
      <div class="border-b border-white/10 pb-4">
        <div class="flex items-center gap-2 mb-1.5 flex-wrap">
          <span class="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-semibold">
            ${escapeHtml(c.date_display || '')}
          </span>
          ${c.series ? `
            <span class="px-2.5 py-1 rounded-full bg-white/10 text-stone-300 text-[11px]">
              ${escapeHtml(c.series)}
            </span>
          ` : ''}
        </div>
        <h2 class="text-xl sm:text-2xl font-bold text-white tracking-tight leading-snug">
          ${escapeHtml(c.title)}
        </h2>
        ${c.subtitle ? `
          <p class="text-xs sm:text-sm text-stone-300/85 mt-1 font-editorial italic">
            ${escapeHtml(c.subtitle)}
          </p>
        ` : ''}

        <!-- 카드 고유 링크 (바로가기 / 공유) -->
        <div class="mt-3 flex items-center gap-2 p-2 pl-3 rounded-xl bg-white/5 border border-white/10">
          <i data-lucide="link" class="w-3.5 h-3.5 text-amber-400 shrink-0"></i>
          <a href="${escapeHtml(getCardPath(c.id))}" onclick="event.preventDefault()" class="flex-1 min-w-0 truncate text-[11px] text-stone-300 font-mono" title="이 카드의 고유 링크">
            ${escapeHtml(getCardShareUrl(c.id))}
          </a>
          <button onclick="copyCardLink(${c.id}, event)" class="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[11px] font-semibold transition flex items-center gap-1">
            <i data-lucide="copy" class="w-3 h-3"></i> 복사
          </button>
        </div>
      </div>

      <!-- 본문 핵심 요약 (Essay Typography Column) -->
      ${c.summary ? `
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-amber-400"></span>
            <h3 class="text-xs font-bold uppercase tracking-wider text-amber-400">본문 핵심 요약</h3>
          </div>
          <div class="essay-text text-stone-200 text-xs sm:text-sm bg-white/5 p-4 rounded-2xl border border-white/10">
            ${formatEssayParagraphs(c.summary)}
          </div>
        </div>
      ` : ''}

      <!-- 본문 핵심 메시지 (Reflective Callout Typography) -->
      ${c.key_message ? `
        <div class="space-y-2 pt-1">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-indigo-400"></span>
            <h3 class="text-xs font-bold uppercase tracking-wider text-indigo-300">본문 핵심 메시지</h3>
          </div>
          <div class="essay-text text-stone-100 text-xs sm:text-sm bg-gradient-to-br from-indigo-950/40 via-stone-900/60 to-indigo-950/30 p-4 rounded-2xl border border-indigo-500/30 shadow-inner">
            ${formatEssayParagraphs(c.key_message)}
          </div>
        </div>
      ` : ''}
    </section>
  `;

  // Discussion Topics Accordion Section
  const topics = c.topics || [];
  const decisionThemeClass = currentTone === 'warmbeige' ? 'gospel-decision-warmbeige' : 'gospel-decision-deepblue';

  const topicsHtml = topics.map((t, idx) => {
    const qList = Array.isArray(t.meditation_questions) ? t.meditation_questions : [];
    
    return `
      <div id="topic-item-${t.id || idx}" class="accordion-item bg-stone-900/85 border border-white/15 rounded-2xl overflow-hidden shadow-lg transition-all mb-4">
        
        <!-- ============================================== -->
        <!-- ACCORDION HEADER (ALWAYS VISIBLE)              -->
        <!-- 1. 나눔 질문 제목                              -->
        <!-- 2. 복음적 결단 (차분한 톤앤매너 상시 노출)      -->
        <!-- ============================================== -->
        <div onclick="toggleAccordion('topic-item-${t.id || idx}')" class="cursor-pointer p-4 sm:p-5 hover:bg-white/[0.02] transition select-none">
          <!-- Topic Number & Title -->
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-start gap-2.5 flex-1">
              <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/20 text-amber-300 font-bold text-xs shrink-0 mt-0.5">
                ${t.topic_order || (idx + 1)}
              </span>
              <h4 class="font-bold text-sm sm:text-base text-white tracking-tight leading-snug">
                ${escapeHtml(t.topic_title)}
              </h4>
            </div>
            <button class="chevron-icon p-1 rounded-full bg-white/5 hover:bg-white/10 text-stone-300 shrink-0">
              <i data-lucide="chevron-down" class="w-4 h-4"></i>
            </button>
          </div>

          <!-- 복음적 결단 카드 (상시 노출! 마음을 차분하게 정리하는 톤) -->
          ${t.gospel_decision ? `
            <div class="mt-3.5 p-3.5 sm:p-4 rounded-xl ${decisionThemeClass} transition-colors duration-300">
              <div class="flex items-center justify-between pb-1.5 mb-1.5 decision-label">
                <span class="text-[11px] font-bold tracking-wider flex items-center gap-1.5">
                  <span>🕊️</span>
                  <span>복음적 결단 (기도와 다짐)</span>
                </span>
                <span class="text-[10px] opacity-75 font-medium">아멘으로 함께 결단하기</span>
              </div>
              <p class="decision-body text-xs sm:text-sm font-editorial italic tracking-wide">
                "${escapeHtml(t.gospel_decision)}"
              </p>
            </div>
          ` : ''}

          <!-- Hint to expand explanation -->
          <div class="mt-2.5 flex items-center justify-between text-[11px] text-stone-400 font-medium">
            <span class="flex items-center gap-1">
              <i data-lucide="book-marked" class="w-3.5 h-3.5 text-amber-400/80"></i>
              <span>세부 해설 및 묵상질문 (${qList.length}개)</span>
            </span>
            <span class="text-amber-400/90 flex items-center gap-0.5 text-[10px]">
              터치하여 펼치기 <i data-lucide="chevrons-down" class="w-3 h-3 inline"></i>
            </span>
          </div>
        </div>

        <!-- ============================================== -->
        <!-- ACCORDION BODY (EXPANDABLE CONTENT)            -->
        <!-- 1. 세부 해설 (에세이 컬럼 타이포그래피)        -->
        <!-- 2. 묵상 질문 (번호 매겨진 나눔 질문 리스트)     -->
        <!-- ============================================== -->
        <div class="accordion-content border-t border-white/10 bg-stone-950/60">
          <div class="p-4 sm:p-5 space-y-4">
            
            <!-- 세부 해설 -->
            ${t.explanation ? `
              <div class="space-y-1.5">
                <div class="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                  <i data-lucide="feather" class="w-3.5 h-3.5"></i>
                  <span>말씀 해설</span>
                </div>
                <div class="essay-text text-stone-200 text-xs sm:text-sm bg-white/5 p-3.5 rounded-xl border border-white/10">
                  ${formatEssayParagraphs(t.explanation)}
                </div>
              </div>
            ` : ''}

            <!-- 묵상 질문 리스트 -->
            ${qList.length > 0 ? `
              <div class="space-y-2 pt-1">
                <div class="flex items-center gap-1.5 text-xs font-bold text-indigo-300">
                  <i data-lucide="help-circle" class="w-3.5 h-3.5"></i>
                  <span>소그룹 묵상 및 나눔 질문</span>
                </div>
                <div class="space-y-2">
                  ${qList.map((q, qIdx) => `
                    <div class="flex items-start gap-2.5 p-2.5 rounded-xl bg-indigo-950/20 border border-indigo-500/20 text-xs sm:text-sm text-stone-200 font-editorial">
                      <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-500/30 text-indigo-300 font-bold text-[11px] shrink-0 mt-0.5">
                        ${qIdx + 1}
                      </span>
                      <p class="leading-relaxed flex-1">${escapeHtml(q)}</p>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

          </div>
        </div>

      </div>
    `;
  }).join('');

  container.innerHTML = `
    ${scriptureSection}
    ${editorialSection}

    <!-- Discussion Section Header -->
    <section class="pt-2">
      <div class="flex items-center justify-between mb-3 px-1">
        <div>
          <h3 class="text-base sm:text-lg font-bold text-white flex items-center gap-2">
            <i data-lucide="users" class="w-4 h-4 text-amber-400"></i>
            성도 나눔 및 결단 (${topics.length}개)
          </h3>
          <p class="text-xs text-stone-400">각 질문과 복음적 결단을 묵상하며 나누어 보세요</p>
        </div>
      </div>

      <!-- Topics Accordion List -->
      <div id="accordion-list">
        ${topicsHtml}
      </div>
    </section>
  `;
}

// Format text paragraphs for elegant editorial reading
function formatEssayParagraphs(text) {
  if (!text) return '';
  const paragraphs = text.split('\n').filter(p => p.trim());
  return paragraphs.map(p => `<p class="mb-2.5 last:mb-0 leading-relaxed">${escapeHtml(p)}</p>`).join('');
}

// ----------------------------------------------------
// 3. ACCORDION & UX INTERACTION HELPERS
// ----------------------------------------------------
function toggleAccordion(itemId) {
  const el = document.getElementById(itemId);
  if (!el) return;
  el.classList.toggle('is-open');
}

function toggleAllAccordions() {
  allExpanded = !allExpanded;
  const items = document.querySelectorAll('.accordion-item');
  items.forEach(item => {
    if (allExpanded) {
      item.classList.add('is-open');
    } else {
      item.classList.remove('is-open');
    }
  });

  const btnText = document.getElementById('toggle-all-text');
  if (btnText) {
    btnText.textContent = allExpanded ? '모두 접기' : '모두 펼치기';
  }
}

function changeFontSize(delta) {
  currentFontSize = Math.min(22, Math.max(13, currentFontSize + delta));
  document.documentElement.style.setProperty('--app-font-size', currentFontSize + 'px');
}

// Toggle Decision Tone: Deep Blue vs Warm Beige
function toggleDecisionTone() {
  currentTone = currentTone === 'deepblue' ? 'warmbeige' : 'deepblue';
  
  const icon = document.getElementById('tone-icon');
  const text = document.getElementById('tone-text');
  
  if (currentTone === 'deepblue') {
    if (icon) icon.textContent = '🌙';
    if (text) text.textContent = '딥블루 결단';
  } else {
    if (icon) icon.textContent = '🌾';
    if (text) text.textContent = '베이지 결단';
  }

  // If we are on detail view, update existing cards smoothly
  if (currentCard) {
    renderDetailView();
    refreshIcons();
  }
}

// ----------------------------------------------------
// 4. ADMIN MODAL & CREATION / EDITING
// ----------------------------------------------------
function openAdminModal() {
  document.getElementById('admin-modal').classList.remove('hidden');
  switchAdminTab('create');
  refreshIcons();
}

function closeAdminModal() {
  document.getElementById('admin-modal').classList.add('hidden');
}

function switchAdminTab(tab) {
  const createTab = document.getElementById('tab-create');
  const manageTab = document.getElementById('tab-manage');
  const createBtn = document.getElementById('tab-create-btn');
  const manageBtn = document.getElementById('tab-manage-btn');

  if (tab === 'create') {
    createTab.classList.remove('hidden');
    manageTab.classList.add('hidden');
    createBtn.className = 'py-3 px-4 border-b-2 border-amber-400 text-amber-300 transition';
    manageBtn.className = 'py-3 px-4 border-b-2 border-transparent text-stone-400 hover:text-stone-200 transition';
  } else {
    createTab.classList.add('hidden');
    manageTab.classList.remove('hidden');
    createBtn.className = 'py-3 px-4 border-b-2 border-transparent text-stone-400 hover:text-stone-200 transition';
    manageBtn.className = 'py-3 px-4 border-b-2 border-amber-400 text-amber-300 transition';
    renderAdminCardsList();
  }
}

async function loadSampleText() {
  try {
    const res = await fetch(getApiUrl('/api/sample'));
    const data = await res.json();
    if (data.text) {
      document.getElementById('raw-text-input').value = data.text;
      alert('20260913.txt 샘플 나눔지 원문을 성공적으로 불러왔습니다!\n"스마트 자동 분석 & 미리보기" 버튼을 눌러보세요.');
    } else {
      alert('샘플 파일을 찾을 수 없습니다.');
    }
  } catch (err) {
    alert('샘플 텍스트 로드 실패: ' + err.message);
  }
}

async function handleParseText() {
  const rawText = document.getElementById('raw-text-input').value.trim();
  if (!rawText) {
    alert('붙여넣을 나눔지 텍스트를 입력해주세요.');
    return;
  }

  const parseBtn = document.getElementById('parse-preview-btn');
  parseBtn.disabled = true;
  parseBtn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-stone-950 border-t-transparent rounded-full mr-2"></span> 분석 중...`;

  try {
    const res = await fetch(getApiUrl('/api/cards/parse'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_text: rawText })
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '파싱에 실패했습니다.');
    }

    const data = await res.json();
    parsedDataCache = data;

    // Fill the interactive edit form
    document.getElementById('edit-date').value = data.date_display || '';
    document.getElementById('edit-series').value = data.series || '';
    document.getElementById('edit-title').value = data.title || '';
    document.getElementById('edit-subtitle').value = data.subtitle || '';
    document.getElementById('edit-scripture-ref').value = data.scripture_ref || '';
    document.getElementById('edit-scripture-text').value = data.scripture_text || '';
    document.getElementById('edit-summary').value = data.summary || '';
    document.getElementById('edit-key-message').value = data.key_message || '';

    // Topics summary preview
    const topics = data.topics || [];
    document.getElementById('parsed-topic-badge').textContent = `질문 ${topics.length}개 감지됨`;
    
    const previewList = document.getElementById('parsed-topics-preview-list');
    previewList.innerHTML = topics.map(t => `
      <div class="p-2 rounded bg-stone-950/60 border border-white/5 text-[11px]">
        <div class="font-bold text-amber-300">[Q${t.topic_order}] ${escapeHtml(t.topic_title)}</div>
        <div class="text-stone-400 text-[10px] mt-0.5 truncate">🕊️ 결단: ${escapeHtml(t.gospel_decision)}</div>
      </div>
    `).join('');

    document.getElementById('parse-result-container').classList.remove('hidden');
    refreshIcons();
  } catch (err) {
    alert('파싱 오류: ' + err.message);
  } finally {
    parseBtn.disabled = false;
    parseBtn.innerHTML = `<i data-lucide="wand-2" class="w-4 h-4"></i><span>스마트 자동 분석 & 미리보기</span>`;
    refreshIcons();
  }
}

async function saveParsedCard() {
  if (!parsedDataCache) {
    alert('먼저 텍스트를 분석해주세요.');
    return;
  }

  const saveBtn = document.getElementById('save-card-btn');
  saveBtn.disabled = true;

  const payload = {
    date_display: document.getElementById('edit-date').value,
    series: document.getElementById('edit-series').value,
    title: document.getElementById('edit-title').value,
    subtitle: document.getElementById('edit-subtitle').value,
    scripture_ref: document.getElementById('edit-scripture-ref').value,
    scripture_text: document.getElementById('edit-scripture-text').value,
    summary: document.getElementById('edit-summary').value,
    key_message: document.getElementById('edit-key-message').value,
    raw_content: parsedDataCache.raw_content || '',
    topics: parsedDataCache.topics || []
  };

  try {
    const res = await fetch(getApiUrl('/api/cards'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || '저장에 실패했습니다.');
    }

    const resData = await res.json();
    closeAdminModal();
    await loadCards();
    // Directly open the created card (주소창이 카드 고유 링크로 바뀜)
    if (resData.id) {
      await openDetailView(resData.id);
      showToast('나눔 카드가 등록되었습니다. 상단 "공유" 버튼으로 링크를 전달하세요.');
    }
  } catch (err) {
    alert('저장 오류: ' + err.message);
  } finally {
    saveBtn.disabled = false;
  }
}

function renderAdminCardsList() {
  const container = document.getElementById('admin-cards-list');
  if (!container) return;

  if (cardsData.length === 0) {
    container.innerHTML = `<div class="text-center py-6 text-xs text-stone-500">등록된 카드가 없습니다.</div>`;
    return;
  }

  container.innerHTML = cardsData.map(c => `
    <div class="p-3 bg-stone-950/70 border border-white/10 rounded-xl flex items-center justify-between gap-2">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-1.5 text-[10px] text-amber-400">
          <span>${escapeHtml(c.date_display || '')}</span>
          ${c.series ? `<span>• ${escapeHtml(c.series)}</span>` : ''}
        </div>
        <h5 class="text-xs font-bold text-white truncate">${escapeHtml(c.title)}</h5>
        <span class="text-[10px] text-stone-400">나눔 질문 ${c.topic_count || 0}개</span>
      </div>
      <div class="flex items-center gap-1">
        <button onclick="copyCardLink(${c.id}, event)" class="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-medium transition">
          링크 복사
        </button>
        <button onclick="deleteCard(${c.id})" class="px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-medium transition">
          삭제
        </button>
      </div>
    </div>
  `).join('');
}

async function deleteCard(cardId) {
  if (!confirm('정말로 이 나눔 카드를 삭제하시겠습니까?')) return;

  try {
    const res = await fetch(getApiUrl(`/api/cards/${cardId}`), { method: 'DELETE' });
    if (!res.ok) throw new Error('삭제 실패');
    alert('카드가 삭제되었습니다.');
    await loadCards();
    showMainView();
  } catch (err) {
    alert(err.message);
  }
}

// Utility: HTML Escaper
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
