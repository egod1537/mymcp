import { escapeHtml, serializeForInlineScript } from "./html-escape.js";
import type { FlashcardWord } from "./types.js";

export function renderFlashcardHtml(
  words: FlashcardWord[],
  title: string,
  shuffleOnStart: boolean,
): string {
  const safeTitle = escapeHtml(title);
  const wordData = serializeForInlineScript(words);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${safeTitle}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;700&family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root { --teal:#4ab8bf; --teal-dark:#1e5f65; --teal-btn:#2e9098; --bg:#0f1218; --surface:#181d26; --surface2:#1f2530; --border:#2a313d; --dark-btn:#1f2530; --text:#dde2ec; --text-muted:#5a6272; --gold:#f0b429; --orange:#f97316; --orange-muted:#c2622a; --green:#3cb371; }
    * { box-sizing: border-box; }
    html, body { background:#0f1218 !important; margin:0; }
    body { min-height:100dvh; display:flex; flex-direction:column; max-width:480px; margin:0 auto; color:var(--text); font-family:'Noto Sans KR','Helvetica Neue',sans-serif; border-left:1px solid var(--border); border-right:1px solid var(--border); }
    header { padding:18px 18px 12px; display:flex; justify-content:space-between; gap:12px; align-items:center; }
    h1 { margin:0; font-size:16px; font-weight:500; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    #headerCounter { color:var(--text-muted); font-variant-numeric:tabular-nums; flex-shrink:0; }
    #timerBar { text-align:center; color:var(--teal); font-size:14px; padding:6px; border-top:1px solid var(--border); border-bottom:1px solid var(--border); font-variant-numeric:tabular-nums; }
    .options-row { display:grid; grid-template-columns:1fr 1fr 2fr 1fr; gap:8px; padding:10px 16px; }
    .opt-btn, #optRemaining { min-height:40px; border:1px solid var(--border); border-radius:12px; background:var(--surface); color:var(--text-muted); display:flex; align-items:center; justify-content:center; font:inherit; }
    .opt-btn { cursor:pointer; font-size:18px; }
    .opt-btn.active { color:var(--gold); border-color:var(--gold); }
    #optRemaining { font-size:13px; }
    main { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; }
    #mainArea { flex:1; min-height:280px; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:20px; }
    .kanji-display { font-family:'Noto Sans JP',sans-serif; font-size:clamp(48px,16vw,80px); font-weight:300; color:var(--teal); word-break:break-word; line-height:1.15; text-align:center; }
    .nuance-context { font-family:'Noto Sans KR',sans-serif; font-size:clamp(13px,3.8vw,15px); color:var(--gold); font-weight:500; text-align:center; margin-top:8px; min-height:1.2em; }
    .hint-area { width:100%; max-height:35vh; overflow-y:auto; text-align:center; margin-top:24px; display:grid; gap:10px; }
    .hint-text { visibility:hidden; opacity:0; }
    .hint-text.visible { visibility:visible; opacity:1; transition:opacity .18s ease; }
    #hintKr, #hintRd { color:var(--orange); font-weight:500; }
    #hintKr { font-family:'Noto Sans KR',sans-serif; font-size:clamp(15px,4.5vw,19px); }
    #hintRd { font-family:'Noto Sans JP',sans-serif; font-size:clamp(14px,4vw,18px); }
    #doneScreen { display:none; flex:1; padding:32px 22px; align-items:center; justify-content:center; flex-direction:column; text-align:center; }
    .done-title { color:var(--teal); font-size:30px; margin-bottom:12px; }
    .done-stats { color:var(--text); line-height:1.9; margin-bottom:28px; }
    .done-actions { width:100%; display:grid; gap:10px; }
    .btn-restart-primary { width:100%; padding:16px; border-radius:14px; border:none; background:var(--teal-btn); color:white; font-size:17px; font-weight:700; cursor:pointer; font-family:inherit; transition:opacity .15s; }
    .btn-restart-primary:hover { opacity:.85; }
    .btn-restart-secondary { width:100%; padding:13px; border-radius:14px; border:2px solid var(--border); background:transparent; color:var(--text-muted); font-size:14px; font-weight:500; cursor:pointer; font-family:inherit; transition:border-color .15s,color .15s; }
    .btn-restart-secondary:hover { border-color:var(--teal); color:var(--teal); }
    .progress-wrap { padding:10px 18px; }
    .progress-track { height:5px; border-radius:999px; overflow:hidden; background:var(--surface2); }
    #progressFill { width:0; height:100%; background:var(--teal); transition:width .2s ease; }
    #progressLabel { margin-top:7px; text-align:center; color:var(--text-muted); font-size:12px; }
    #bottomArea { flex-shrink:0; padding:10px 14px max(32px,env(safe-area-inset-bottom)); border-top:1px solid var(--border); background:var(--bg); display:grid; gap:9px; }
    .hint-btns, .action-btns { display:grid; grid-template-columns:1fr 1fr; gap:9px; }
    .btn-hint, .btn-action { border:none; border-radius:13px; font-family:inherit; font-size:clamp(13px,3.5vw,16px); padding:clamp(12px,3vw,18px) 12px; cursor:pointer; color:var(--text); }
    .btn-hint { background:var(--dark-btn); border:1px solid var(--border); }
    .btn-hint.revealed { color:var(--orange); border-color:var(--orange-muted); }
    #btnStudy { background:#2a4a6e; }
    #btnKnow { background:var(--teal-btn); }
    @keyframes swipeLeft { to { transform:translateX(-70px); opacity:0; } }
    @keyframes swipeRight { to { transform:translateX(70px); opacity:0; } }
    .swipe-left { animation:swipeLeft .22s ease forwards; }
    .swipe-right { animation:swipeRight .22s ease forwards; }
    @media (max-height:700px) { .kanji-display { font-size:clamp(40px,12vw,60px); } .hint-area { max-height:25vh; } .btn-hint,.btn-action { padding:12px; } .options-row { padding:6px 16px; } }
    @media (max-width:360px) { .hint-btns,.action-btns { gap:6px; } .btn-hint,.btn-action { font-size:13px; } }
  </style>
</head>
<body>
  <header><h1>${safeTitle}</h1><div id="headerCounter">0 / 0</div></header>
  <div id="timerBar">00:00</div>
  <div class="options-row">
    <button class="opt-btn" id="btnStar" type="button" aria-label="즐겨찾기">★</button>
    <button class="opt-btn" id="btnInfinite" type="button" aria-label="무한 반복">∞</button>
    <div id="optRemaining">남은 카드 0</div>
    <button class="opt-btn" id="btnSpeak" type="button" aria-label="음성 읽기">🔊</button>
  </div>
  <main>
    <section id="mainArea">
      <div class="kanji-display" id="kanjiDisplay"></div>
      <div class="nuance-context" id="nuanceContext"></div>
      <div class="hint-area">
        <div class="hint-text" id="hintKr"></div>
        <div class="hint-text" id="hintRd"></div>
      </div>
    </section>
    <section id="doneScreen">
      <div class="done-title">학습 완료</div>
      <div class="done-stats"><div id="studyCount"></div><div id="knowCount"></div></div>
      <div class="done-actions">
        <button class="btn-restart-primary" id="btnRetry" type="button"></button>
        <button class="btn-restart-secondary" id="btnRestart" type="button">처음부터 다시</button>
      </div>
    </section>
  </main>
  <div class="progress-wrap"><div class="progress-track"><div id="progressFill"></div></div><div id="progressLabel">0 / 0 완료</div></div>
  <div id="bottomArea">
    <div class="hint-btns"><button class="btn-hint" id="btnKr" type="button">한국어</button><button class="btn-hint" id="btnRd" type="button">ひらがな</button></div>
    <div class="action-btns"><button class="btn-action" id="btnStudy" type="button">공부하겠음</button><button class="btn-action" id="btnKnow" type="button">알고있음</button></div>
  </div>
  <script>
    const words = ${wordData};
    const shuffleOnStart = ${shuffleOnStart ? "true" : "false"};
    let deck = [];
    let idx = 0;
    let studyList = [];
    let knowList = [];
    let infiniteMode = false;
    let bookmarks = new Set();
    let elapsed = 0;
    let timerId;

    function shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }
    function cardKey(w) { return w.id || String(w.n); }
    function formatTime(seconds) { const m = String(Math.floor(seconds / 60)).padStart(2, '0'); const s = String(seconds % 60).padStart(2, '0'); return m + ':' + s; }
    function startTimer() { clearInterval(timerId); elapsed = 0; document.getElementById('timerBar').textContent = '00:00'; timerId = setInterval(function() { elapsed += 1; document.getElementById('timerBar').textContent = formatTime(elapsed); }, 1000); }
    function hideHints() {
      ['hintKr', 'hintRd'].forEach(function(id) { document.getElementById(id).classList.remove('visible'); });
      document.getElementById('btnKr').classList.remove('revealed');
      document.getElementById('btnRd').classList.remove('revealed');
    }
    function updateHeaderCounter() { document.getElementById('headerCounter').textContent = (idx + 1) + ' / ' + deck.length; }
    function updateProgress() { const done = knowList.length + studyList.length; const total = deck.length; document.getElementById('progressFill').style.width = (total ? done / total * 100 : 0) + '%'; document.getElementById('progressLabel').textContent = done + ' / ' + total + ' 완료'; document.getElementById('optRemaining').textContent = '남은 카드 ' + Math.max(0, total - done); }
    function showCard() {
      const w = deck[idx];
      document.getElementById('kanjiDisplay').textContent = w.jp;
      const nuanceCtxEl = document.getElementById('nuanceContext');
      nuanceCtxEl.textContent = w.nuance ? '「' + w.nuance + '」' : '';
      document.getElementById('hintKr').textContent = w.kr;
      document.getElementById('hintRd').textContent = w.rd;
      document.getElementById('btnKr').classList.remove('revealed');
      document.getElementById('btnRd').classList.remove('revealed');
      document.getElementById('hintKr').classList.remove('visible');
      document.getElementById('hintRd').classList.remove('visible');
      document.getElementById('btnStar').classList.toggle('active', bookmarks.has(cardKey(w)));
      updateProgress();
      updateHeaderCounter();
    }
    function toggleHint(id, buttonId) { document.getElementById(id).classList.toggle('visible'); document.getElementById(buttonId).classList.toggle('revealed'); }
    function showDone() { clearInterval(timerId); document.getElementById('mainArea').style.display = 'none'; document.getElementById('bottomArea').style.display = 'none'; document.getElementById('doneScreen').style.display = 'flex'; document.getElementById('studyCount').textContent = '공부하겠음 ' + studyList.length + '장'; document.getElementById('knowCount').textContent = '알고있음 ' + knowList.length + '장'; const retry = document.getElementById('btnRetry'); retry.style.display = studyList.length ? 'block' : 'none'; retry.textContent = '✗ 모르는 것만 다시 (' + studyList.length + '장)'; updateProgress(); }
    function restart(onlyStudy) { const source = onlyStudy ? studyList.slice() : words.slice(); if (!source.length) return; deck = shuffle(source); idx = 0; studyList = []; knowList = []; hideHints(); document.getElementById('doneScreen').style.display = 'none'; document.getElementById('mainArea').style.display = 'flex'; document.getElementById('bottomArea').style.display = 'grid'; startTimer(); showCard(); }
    function next(action) {
      hideHints();
      const w = deck[idx];
      if (action === 'study') studyList.push(w); else knowList.push(w);
      updateProgress();
      const main = document.getElementById('mainArea');
      const animation = action === 'study' ? 'swipe-left' : 'swipe-right';
      main.classList.add(animation);
      setTimeout(function() { main.classList.remove(animation); idx += 1; if (idx >= deck.length) { if (infiniteMode) restart(false); else showDone(); } else showCard(); }, 220);
    }
    document.getElementById('btnKr').addEventListener('click', function() { toggleHint('hintKr', 'btnKr'); });
    document.getElementById('btnRd').addEventListener('click', function() { toggleHint('hintRd', 'btnRd'); });
    document.getElementById('btnStudy').addEventListener('click', function() { next('study'); });
    document.getElementById('btnKnow').addEventListener('click', function() { next('know'); });
    document.getElementById('btnRetry').addEventListener('click', function() { restart(true); });
    document.getElementById('btnRestart').addEventListener('click', function() { restart(false); });
    document.getElementById('btnInfinite').addEventListener('click', function() { infiniteMode = !infiniteMode; this.classList.toggle('active', infiniteMode); });
    document.getElementById('btnStar').addEventListener('click', function() { const key = cardKey(deck[idx]); if (bookmarks.has(key)) bookmarks.delete(key); else bookmarks.add(key); this.classList.toggle('active', bookmarks.has(key)); });
    document.getElementById('btnSpeak').addEventListener('click', function() { if (!('speechSynthesis' in window)) return; const utter = new SpeechSynthesisUtterance(deck[idx].jp); utter.lang = 'ja-JP'; speechSynthesis.cancel(); speechSynthesis.speak(utter); });
    deck = shuffleOnStart ? shuffle(words) : words.slice();
    startTimer();
    showCard();
  </script>
</body>
</html>`;
}
