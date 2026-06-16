// ═══════════════════════════════════════════════════════
//  FysikEksamen – komplet, fejlsikret app
// ═══════════════════════════════════════════════════════

// ── Hjælpere ──────────────────────────────────────────
const S = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// Sikker fetch med timeout og fejlhåndtering
async function apiFetch(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(tid);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  } catch (e) {
    clearTimeout(tid);
    if (e.name === "AbortError") throw new Error("Serveren svarer ikke (timeout). Prøv igen.");
    throw e;
  }
}

// Ryd global TTS og timere ved navigation
let _activeSpeech = false;
let _activeTimers = [];
function clearAll() {
  if (_activeSpeech) { try { speechSynthesis.cancel(); } catch {} _activeSpeech = false; }
  _activeTimers.forEach(id => clearInterval(id));
  _activeTimers = [];
}
function safeInterval(fn, ms) {
  const id = setInterval(fn, ms);
  _activeTimers.push(id);
  return id;
}

// ── State ──────────────────────────────────────────────
const DEFAULT_STATE = {
  examDate: "", level: "alle",
  progress: { solved: 0, correct: 0, streak: 0, lastDay: null },
  spaced: [],
};
let state = S.get("state", DEFAULT_STATE);
// Rens ugyldige felter fra gamle versioner
if (!state.progress) state.progress = DEFAULT_STATE.progress;
if (!Array.isArray(state.spaced)) state.spaced = [];

function saveState() { S.set("state", state); }

// ── Topics ─────────────────────────────────────────────
let TOPICS = [];
async function loadTopics() {
  try {
    TOPICS = await apiFetch("/api/topics");
    buildTopicChips();
    populateSelects();
  } catch (e) {
    console.error("Kunne ikke hente emner:", e.message);
  }
}

// Fyld alle topic-selects dynamisk
function populateSelects() {
  const opts = `<option value="alle">Alle emner</option>` +
    TOPICS.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
  document.querySelectorAll(".topic-select").forEach(s => { s.innerHTML = opts; });
}

// ═══════════════════════════════════════════════════════
//  ONBOARDING
// ═══════════════════════════════════════════════════════
const obOverlay = document.getElementById("onboarding");
const mainApp   = document.getElementById("mainApp");

function obStep(n) {
  document.querySelectorAll(".ob-step").forEach(s =>
    s.classList.toggle("active", s.dataset.step == n));
}

// Step 0 → 1
document.querySelector(".ob-next[data-next='1']")
  .addEventListener("click", () => obStep(1));

// Skip-knapper
document.querySelectorAll("[data-skip]")
  .forEach(b => b.addEventListener("click", finishOnboarding));

// Step 1: Bekymring
document.getElementById("obWorry").querySelectorAll(".ob-choice").forEach(c => {
  c.addEventListener("click", () => {
    document.getElementById("obWorry").querySelectorAll(".ob-choice")
      .forEach(x => x.classList.remove("sel"));
    c.classList.add("sel");
    state.worry = c.dataset.val;
    saveState();
    setTimeout(() => obStep(2), 280);
  });
});

// Step 2: Humør
document.getElementById("obMood").querySelectorAll(".ob-choice").forEach(c => {
  c.addEventListener("click", () => {
    document.getElementById("obMood").querySelectorAll(".ob-choice")
      .forEach(x => x.classList.remove("sel"));
    c.classList.add("sel");
    state.mood = c.dataset.val;
    saveState();
    setTimeout(() => obStep(3), 280);
  });
});

// Step 3: Niveau
document.getElementById("obLevel").querySelectorAll(".ob-choice").forEach(c => {
  c.addEventListener("click", () => {
    document.getElementById("obLevel").querySelectorAll(".ob-choice")
      .forEach(x => x.classList.remove("sel"));
    c.classList.add("sel");
    state.level = c.dataset.val;
    saveState();
    setTimeout(() => obStep(4), 280);
  });
});

// Step 4: Upload
const obFileIn = document.getElementById("obFileIn");
document.getElementById("obPasteOpt").addEventListener("click", () => {
  const ta = document.getElementById("obPasteText");
  ta.style.display = ta.style.display === "none" ? "block" : "none";
});
obFileIn.addEventListener("change", () => {
  const f = obFileIn.files[0];
  if (f) document.getElementById("obFileLabel").textContent = `✅ ${f.name}`;
});
document.querySelector(".ob-next[data-next='5']").addEventListener("click", () => {
  const ta = document.getElementById("obPasteText");
  if (ta.value.trim()) {
    state.material = { type: "text", content: ta.value.trim(), name: "Indsat tekst" };
    saveState();
  }
  if (obFileIn.files[0]) window._pendingFile = obFileIn.files[0];
  obStep(5);
  // Bind dato-preview
  const dateInput = document.getElementById("obExamDate");
  const prev = document.getElementById("obPlanPreview");
  dateInput.addEventListener("change", () => {
    const d = daysUntil(dateInput.value);
    prev.innerHTML = d > 0
      ? `📅 <b>${d} dage</b> til eksamen. Vi lægger en plan dag for dag.`
      : d === 0 ? "⚡ Eksamen er i dag!"
      : "Vælg en dato i fremtiden.";
  });
});

document.getElementById("obFinish").addEventListener("click", () => {
  const d = document.getElementById("obExamDate").value;
  if (d) { state.examDate = d; saveState(); }
  finishOnboarding();
});

function finishOnboarding() {
  obOverlay.style.display = "none";
  mainApp.style.display = "block";
  S.set("skipOnboarding", true);
  initApp();
}

// Spring onboarding over hvis allerede gennemført
if (S.get("skipOnboarding", false)) {
  obOverlay.style.display = "none";
  mainApp.style.display = "block";
  initApp();
}

// ═══════════════════════════════════════════════════════
//  APP INIT
// ═══════════════════════════════════════════════════════
let _appInited = false;
function initApp() {
  if (_appInited) return; // Forhindrer dobbelt init
  _appInited = true;
  loadTopics();
  renderStats();
  renderHomeCountdown();
  renderDailyCard();
  const pd = document.getElementById("planDate");
  if (pd && state.examDate) pd.value = state.examDate;
  document.getElementById("settingsBtn").addEventListener("click", openSettings);
  document.getElementById("closeSettings").addEventListener("click", closeSettings);
  document.getElementById("saveSettings").addEventListener("click", saveSettings);
  const sd = document.getElementById("settingsDate");
  if (sd) sd.value = state.examDate || "";
}

// ── Navigation ─────────────────────────────────────────
document.querySelectorAll("[data-view]").forEach(b => {
  b.addEventListener("click", () => show(b.dataset.view));
});
function show(view) {
  clearAll(); // Stop TTS og timere ved sideskift
  document.querySelectorAll(".view").forEach(v =>
    v.classList.toggle("active", v.id === "view-" + view));
  document.querySelectorAll(".nav-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Progress & stats ───────────────────────────────────
function renderStats() {
  const p = state.progress;
  const solved = document.getElementById("statSolved");
  const acc    = document.getElementById("statAcc");
  const streak = document.getElementById("statStreak");
  if (solved) solved.textContent = p.solved;
  if (acc)    acc.textContent = p.solved ? Math.round(p.correct / p.solved * 100) + "%" : "–";
  if (streak) streak.textContent = p.streak;
}
function addProgress(ok) {
  const p = state.progress;
  p.solved++;
  if (ok) p.correct++;
  const today = new Date().toISOString().slice(0, 10);
  if (p.lastDay !== today) {
    const yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    p.streak = (p.lastDay === yest) ? p.streak + 1 : 1;
    p.lastDay = today;
  }
  saveState();
  renderStats();
}

// ── Countdown ──────────────────────────────────────────
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 864e5);
}
function renderHomeCountdown() {
  const el = document.getElementById("homeCountdown");
  if (!el) return;
  const d = daysUntil(state.examDate);
  if (d === null) {
    el.innerHTML = `<span class="lbl2">Sæt din eksamensdato i <b>Plan</b> for at starte nedtællingen.</span>`;
  } else if (d === 0) {
    el.innerHTML = `<span class="big">🎓</span><span class="lbl2">Eksamen er i dag — held og lykke!</span>`;
  } else if (d < 0) {
    el.innerHTML = `<span class="lbl2">Eksamen er overstået. Sæt en ny dato.</span>`;
  } else {
    const ds = new Date(state.examDate + "T00:00:00")
      .toLocaleDateString("da-DK", { weekday:"long", day:"numeric", month:"long" });
    el.innerHTML = `<span class="big">${d}</span><span class="lbl2">dage til eksamen · ${ds}</span>`;
  }
}
function renderDailyCard() {
  const el = document.getElementById("dailyCard");
  if (!el) return;
  const d = daysUntil(state.examDate);
  if (!d || d < 0) { el.innerHTML = ""; return; }
  const today = new Date().toLocaleDateString("da-DK",
    { weekday:"long", day:"numeric", month:"short" });
  el.innerHTML = `
    <p class="eyebrow" style="margin-bottom:8px">I dag · ${today}</p>
    <h4 style="margin-bottom:12px">Din daglige plan</h4>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:center;gap:10px;color:var(--muted)">🎙️ <span>Lyt til en podcast om dit materiale</span></div>
      <div style="display:flex;align-items:center;gap:10px;color:var(--muted)">🔤 <span>10 quizspørgsmål</span></div>
      <div style="display:flex;align-items:center;gap:10px;color:var(--muted)">🎤 <span>Mundtlig gennemgang af ét begreb</span></div>
    </div>`;
}

// ── Topic chips ────────────────────────────────────────
let selTopics = new Set();
function buildTopicChips() {
  const chips = document.getElementById("topicChips");
  if (!chips) return;
  chips.innerHTML = "";
  TOPICS.forEach(t => {
    const c = document.createElement("div");
    c.className = "chip"; c.textContent = t.name; c.dataset.id = t.id;
    c.addEventListener("click", () => {
      c.classList.toggle("on");
      c.classList.contains("on") ? selTopics.add(t.id) : selTopics.delete(t.id);
    });
    chips.appendChild(c);
  });
}

// ── Settings ───────────────────────────────────────────
function openSettings() {
  const sd = document.getElementById("settingsDate");
  if (sd) sd.value = state.examDate || "";
  document.getElementById("settingsModal").style.display = "flex";
}
function closeSettings() {
  document.getElementById("settingsModal").style.display = "none";
}
function saveSettings() {
  const sd = document.getElementById("settingsDate");
  if (sd) state.examDate = sd.value;
  saveState();
  closeSettings();
  renderHomeCountdown();
  renderDailyCard();
  const pd = document.getElementById("planDate");
  if (pd) pd.value = state.examDate;
}
document.getElementById("settingsModal").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeSettings();
});

// ── Drag-and-drop hjælper ──────────────────────────────
function bindDropZone(dropEl, fileInput, labelEl) {
  dropEl.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const f = fileInput.files[0];
    if (f && labelEl) labelEl.textContent = `✅ ${f.name}`;
    else if (f) dropEl.textContent = `✅ ${f.name}`;
    if (f) dropEl.classList.add("has-file");
  });
  ["dragover", "dragleave", "drop"].forEach(ev =>
    dropEl.addEventListener(ev, e => {
      e.preventDefault();
      if (ev === "dragover") { dropEl.classList.add("over"); return; }
      dropEl.classList.remove("over");
      if (ev === "drop" && e.dataTransfer.files[0]) {
        // DataTransfer til input via ny FileList ikke muligt – gem direkte
        const f = e.dataTransfer.files[0];
        window._lastDropFile = f; // midlertidig buffer
        const dt = new DataTransfer();
        dt.items.add(f);
        fileInput.files = dt.files;
        dropEl.textContent = `✅ ${f.name}`;
        dropEl.classList.add("has-file");
      }
    })
  );
}

// ═══════════════════════════════════════════════════════
//  LÆR
// ═══════════════════════════════════════════════════════
document.querySelectorAll("#view-laer .mode-card").forEach(c => {
  c.addEventListener("click", () => {
    document.querySelectorAll("#view-laer .mode-card").forEach(x => x.classList.remove("active-card"));
    c.classList.add("active-card");
    const el = document.getElementById("laerContent");
    el.innerHTML = "";
    clearAll();
    const m = c.dataset.mode;
    if (m === "intro")      renderIntroLektion(el);
    else if (m === "podcast")    renderPodcast(el);
    else if (m === "smarttekst") renderSmartTekst(el);
    else if (m === "videnhuller") renderVidenhuller(el);
    else if (m === "chat")   renderChat(el, "tutor");
  });
});

// ── Intro-lektion ──────────────────────────────────────
function renderIntroLektion(el) {
  el.innerHTML = `<div class="card" style="margin-bottom:14px">
    <p style="color:var(--muted)">Skriv et emne til AI Allan — han introducerer det for dig med eksempler og formler.</p>
  </div>`;
  renderChat(el, "tutor");
}

// ── Podcast ────────────────────────────────────────────
// ── TTS stemmehåndtering ──────────────────────────────
// Finder den bedste tilgængelige stemme (prioriterer dansk, så norsk/svensk, så engelsk)
let _cachedVoice = null;
function getBestVoice() {
  if (_cachedVoice) return _cachedVoice;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;

  // Prioriteret søgning
  const prefs = [
    v => v.lang === "da-DK" && !v.localService === false, // Online dansk
    v => v.lang === "da-DK",                              // Lokal dansk
    v => v.lang.startsWith("da"),                          // Dansk variant
    v => v.lang === "nb-NO" || v.lang === "nn-NO",        // Norsk (ligner dansk)
    v => v.lang === "sv-SE",                               // Svensk
    v => v.lang === "en-GB",                               // Britisk engelsk
    v => v.lang.startsWith("en"),                          // Engelsk
  ];
  for (const test of prefs) {
    const match = voices.find(test);
    if (match) { _cachedVoice = match; return match; }
  }
  _cachedVoice = voices[0];
  return voices[0];
}

// Rens tekst så den lyder naturlig som tale
function cleanForSpeech(text) {
  return text
    // Matematik til ord
    .replace(/½/g, "en halv ")
    .replace(/²/g, " i anden")
    .replace(/³/g, " i tredje")
    .replace(/·/g, " gange ")
    .replace(/×/g, " gange ")
    .replace(/÷/g, " divideret med ")
    .replace(/≈/g, " er cirka ")
    .replace(/=/g, " er lig med ")
    .replace(/Δ/g, "delta ")
    .replace(/λ/g, "lambda ")
    .replace(/Ω/g, " ohm")
    .replace(/μ/g, "mikro")
    // Enheder
    .replace(/m\/s²/g, "meter per sekund i anden")
    .replace(/m\/s/g, "meter per sekund")
    .replace(/J\/\(kg·K\)/g, "joule per kilogram kelvin")
    // Potenser skrevet som fx 10⁻³⁴
    .replace(/(\d+)⁻(\d+)/g, "$1 i minus $2")
    .replace(/·10⁻(\d+)/g, " gange ti i minus $1")
    .replace(/·10(\d+)/g, " gange ti i $1")
    // Symboler
    .replace(/E_kin/g, "den kinetiske energi")
    .replace(/E_pot/g, "den potentielle energi")
    .replace(/R_total/g, "den samlede modstand")
    // Forkortelser udtalt som ord
    .replace(/ca\./g, "cirka")
    .replace(/fx/gi, "for eksempel")
    .replace(/bl\.a\./gi, "blandt andet")
    // Naturlige pauser ved linjeskift
    .replace(/\n\n/g, ". ")
    .replace(/\n/g, ". ")
    // Ryd op
    .replace(/\.\s*\./g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function renderPodcast(el) {
  // Hent stemmer asynkront (Chrome indlæser dem med forsinkelse)
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = () => { _cachedVoice = null; };
  }

  el.innerHTML = `
    <div class="podcast-box">
      <h3 style="margin-bottom:10px">🎙️ Podcast fra dit materiale</h3>
      <p style="color:var(--muted);font-size:.9rem;margin-bottom:16px">
        AI genererer et naturligt manuskript som læses op. Upload dine noter eller skriv et emne.
      </p>

      <div class="upload-area" id="podDrop">📄 Træk fil hertil eller klik for at vælge</div>
      <input type="file" id="podFile" accept=".pdf,image/*,.txt" style="display:none"/>
      <textarea id="podText" class="ob-textarea"
        placeholder="Eller skriv/indsæt tekst her — fx 'Forklar kinetisk og potentiel energi med eksempler'"
        style="margin-top:8px;min-height:80px;width:100%"></textarea>

      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;align-items:center">
        <button class="btn primary" id="genPodcast">Generer podcast</button>
        <div class="field" style="flex-direction:row;align-items:center;gap:8px;margin:0">
          <label style="font-size:.8rem;color:var(--muted);white-space:nowrap">Stemme:</label>
          <select id="voiceSelect" style="min-width:140px;padding:8px 10px">
            <option value="">Indlæser stemmer…</option>
          </select>
        </div>
      </div>

      <div class="status" id="podStatus"></div>

      <div id="podPlayer" style="display:none;margin-top:18px">
        <div class="podcast-wave paused" id="podWave">
          ${Array(9).fill('<div class="wave-bar"></div>').join("")}
        </div>
        <div class="podcast-controls" style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn primary" id="podPlay">▶ Afspil</button>
          <button class="btn ghost"   id="podPause" disabled>⏸ Pause</button>
          <button class="btn ghost"   id="podStop"  disabled>⏹ Stop</button>
          <div style="display:flex;align-items:center;gap:6px">
            <label style="font-size:.8rem;color:var(--muted)">Tempo:</label>
            <select id="podRate">
              <option value="0.75">Langsom</option>
              <option value="0.9" selected>Normal</option>
              <option value="1.1">Hurtig</option>
              <option value="1.3">Meget hurtig</option>
            </select>
          </div>
        </div>
        <div id="podProgress" style="margin-top:12px;display:none">
          <div class="pbar" style="margin:0"><div class="pbar-fill" id="podProgBar" style="animation:none;background:var(--accent2)"></div></div>
        </div>
        <div class="podcast-text" id="podScript" style="margin-top:16px"></div>
      </div>
    </div>`;

  const podDrop   = document.getElementById("podDrop");
  const podFileIn = document.getElementById("podFile");
  const voiceSel  = document.getElementById("voiceSelect");
  bindDropZone(podDrop, podFileIn);

  // Fyld stemmevælger
  function populateVoices() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    voiceSel.innerHTML = "";
    // Sorter: dansk først, derefter andre
    const sorted = [...voices].sort((a, b) => {
      const aScore = a.lang.startsWith("da") ? 0 : a.lang.startsWith("nb") || a.lang.startsWith("nn") ? 1 : a.lang.startsWith("sv") ? 2 : a.lang.startsWith("en") ? 3 : 4;
      const bScore = b.lang.startsWith("da") ? 0 : b.lang.startsWith("nb") || b.lang.startsWith("nn") ? 1 : b.lang.startsWith("sv") ? 2 : b.lang.startsWith("en") ? 3 : 4;
      return aScore - bScore;
    });
    sorted.forEach((v, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      const flag = v.lang.startsWith("da") ? "🇩🇰" : v.lang.startsWith("nb") || v.lang.startsWith("nn") ? "🇳🇴" : v.lang.startsWith("sv") ? "🇸🇪" : v.lang.startsWith("en-GB") ? "🇬🇧" : v.lang.startsWith("en") ? "🇺🇸" : "🌐";
      opt.textContent = `${flag} ${v.name} (${v.lang})`;
      if (i === 0) opt.selected = true;
      voiceSel.appendChild(opt);
    });
    return sorted;
  }

  let voiceList = populateVoices();
  speechSynthesis.onvoiceschanged = () => { voiceList = populateVoices(); };

  let podScript = "";
  let podChunks = [];  // Opdelt i sætninger for bedre kontrol
  let currentChunk = 0;

  document.getElementById("genPodcast").addEventListener("click", async () => {
    const st   = document.getElementById("podStatus");
    const file = podFileIn.files[0] || window._pendingFile;
    const txt  = document.getElementById("podText").value.trim();
    if (!file && !txt && !state.material) {
      st.textContent = "Upload en fil eller skriv et emne du vil høre om.";
      st.className = "status err"; return;
    }
    document.getElementById("genPodcast").disabled = true;
    st.innerHTML = `<div class="pbar"><div class="pbar-fill"></div></div>AI skriver manuskript…`;

    const form = new FormData();
    if (file)                         form.append("file", file);
    else if (txt)                     form.append("text", txt);
    else if (state.material?.content) form.append("text", state.material.content);
    form.append("mode", "podcast");

    try {
      const d = await apiFetch("/api/pdf", { method:"POST", body:form }, 90000);
      podScript = d.text || "";
      if (!podScript) throw new Error("Tomt manuskript fra serveren.");

      // Vis den rå tekst (pænt formateret)
      const scriptEl = document.getElementById("podScript");
      scriptEl.textContent = podScript;

      // Opdel i sætninger til progressiv afspilning
      podChunks = podScript
        .split(/(?<=[.!?])\s+/)
        .filter(s => s.trim().length > 0);

      document.getElementById("podPlayer").style.display = "block";
      st.textContent = `✅ Klar — ${podChunks.length} sætninger · vælg stemme og tryk Afspil`;
      st.className = "status ok";
    } catch(e) {
      st.textContent = "⚠️ " + e.message; st.className = "status err";
    } finally {
      document.getElementById("genPodcast").disabled = false;
    }
  });

  // TTS motor
  const playBtn  = document.getElementById("podPlay");
  const pauseBtn = document.getElementById("podPause");
  const stopBtn  = document.getElementById("podStop");
  const wave     = document.getElementById("podWave");

  function getSelectedVoice() {
    if (!voiceList?.length) return null;
    const idx = parseInt(voiceSel.value);
    return isNaN(idx) ? voiceList[0] : voiceList[idx];
  }

  function ttsSetPlaying(playing) {
    wave.classList.toggle("paused", !playing);
    playBtn.disabled  = playing;
    pauseBtn.disabled = !playing;
    stopBtn.disabled  = !playing;
    _activeSpeech     = playing;
  }

  function highlightLine(idx) {
    const scriptEl = document.getElementById("podScript");
    if (!scriptEl || !podChunks.length) return;
    // Fremhæv nuværende sætning i teksten
    const pct = Math.round((idx / podChunks.length) * 100);
    const bar = document.getElementById("podProgBar");
    if (bar) bar.style.width = pct + "%";
  }

  playBtn.addEventListener("click", () => {
    if (!podScript) return;
    speechSynthesis.cancel();
    currentChunk = 0;
    document.getElementById("podProgress").style.display = "block";

    const voice = getSelectedVoice();
    const rate  = parseFloat(document.getElementById("podRate").value);

    // Spil hele teksten som én utterance (bedre prosodi end chunk-vis)
    const cleaned = cleanForSpeech(podScript);
    const utt = new SpeechSynthesisUtterance(cleaned);
    if (voice) utt.voice = voice;
    utt.lang  = voice?.lang || "da-DK";
    utt.rate  = rate;
    utt.pitch = 1.0;

    utt.onstart    = () => ttsSetPlaying(true);
    utt.onend      = () => { ttsSetPlaying(false); document.getElementById("podProgress").style.display = "none"; };
    utt.onerror    = (e) => { if (e.error !== "interrupted") ttsSetPlaying(false); };
    utt.onboundary = (e) => {
      // Opdater progress bar via char position
      const pct = Math.round((e.charIndex / cleaned.length) * 100);
      const bar = document.getElementById("podProgBar");
      if (bar) bar.style.width = pct + "%";
    };

    speechSynthesis.speak(utt);
  });

  pauseBtn.addEventListener("click", () => {
    if (speechSynthesis.paused) {
      speechSynthesis.resume();
      wave.classList.remove("paused");
    } else {
      speechSynthesis.pause();
      wave.classList.add("paused");
    }
  });

  stopBtn.addEventListener("click", () => {
    speechSynthesis.cancel();
    ttsSetPlaying(false);
    const bar = document.getElementById("podProgBar");
    if (bar) bar.style.width = "0%";
  });
}

// ── Smart tekst ────────────────────────────────────────
function renderSmartTekst(el) {
  const texts = {
    mekanik: `<b>Mekanik & bevægelse</b><br><br>Newtons 1. lov: Et legeme forbliver i hvile eller jævn bevægelse medmindre en resulterende kraft virker på det.<br><br>Newtons 2. lov: <b>F = m · a</b> — kraften (N) er masse (kg) gange acceleration (m/s²).<br><br>Newtons 3. lov: Til enhver kraft hører en lige stor og modsatrettet kraft.<br><br>Frit fald fra hvile: <b>h = ½ · g · t²</b> og <b>v = g · t</b>, med g ≈ 9,82 m/s².`,
    energi: `<b>Energi, arbejde & effekt</b><br><br>Kinetisk energi: <b>E_kin = ½ · m · v²</b><br>Potentiel energi (tyngde): <b>E_pot = m · g · h</b><br>Effekt: <b>P = W / t</b> (watt = joule/sekund)<br><br>Energibevarelse: I et lukket system uden friktion er den samlede mekaniske energi konstant.`,
    el: `<b>Elektricitet</b><br><br>Ohms lov: <b>U = R · I</b> (volt = ohm × ampere)<br>Elektrisk effekt: <b>P = U · I</b><br>Seriekobling: R_total = R₁ + R₂ + …<br>Parallelkobling: 1/R_total = 1/R₁ + 1/R₂ + …<br><br>Ladning måles i coulomb (C), strøm i ampere (A).`,
    termodynamik: `<b>Termodynamik & varme</b><br><br>Varmeenergi: <b>Q = m · c · ΔT</b><br>For vand: c ≈ 4186 J/(kg·K)<br>Termodynamikkens 1. lov: <b>ΔU = Q − W</b> (energibevarelse)<br>Absolut nulpunkt: 0 K = −273,15 °C<br>Kelvin: <b>T(K) = T(°C) + 273,15</b>`,
    boelger: `<b>Bølger & optik</b><br><br>Bølgeligning: <b>v = f · λ</b> (fart = frekvens × bølgelængde)<br>Periode: <b>T = 1 / f</b><br>Lysets fart i vakuum: c ≈ 3,0 · 10⁸ m/s<br><br>Lydbølger er longitudinale trykbølger. Lys er transversale elektromagnetiske bølger.`,
    moderne: `<b>Moderne fysik & atomfysik</b><br><br>Fotonenergi: <b>E = h · f</b> (h = 6,63 · 10⁻³⁴ J·s)<br>Einsteins: <b>E = m · c²</b><br>Massetal: A = Z (protoner) + N (neutroner)<br>Halveringstid: tid til halvdelen af radioaktive kerner henfalder.<br>Alfapartikler = heliumkerner · Betapartikler = elektroner · Gamma = fotoner`,
  };
  el.innerHTML = `
    <div class="card">
      <h4 style="margin-bottom:14px">📖 Kernebegreber</h4>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px" id="stTopicSel"></div>
      <div id="stContent" style="color:var(--muted);line-height:1.8;font-size:.97rem"></div>
    </div>`;
  const sel = document.getElementById("stTopicSel");
  const content = document.getElementById("stContent");
  TOPICS.forEach(t => {
    const c = document.createElement("div");
    c.className = "chip"; c.textContent = t.name;
    c.addEventListener("click", () => {
      sel.querySelectorAll(".chip").forEach(x => x.classList.remove("on"));
      c.classList.add("on");
      content.innerHTML = texts[t.id] || "Indhold ikke tilgængeligt for dette emne.";
    });
    sel.appendChild(c);
  });
  // Vis første emne som standard
  if (TOPICS.length) {
    sel.querySelectorAll(".chip")[0]?.classList.add("on");
    content.innerHTML = texts[TOPICS[0]?.id] || "";
  }
}

// ── Videnhuller ────────────────────────────────────────
function renderVidenhuller(el) {
  el.innerHTML = `
    <div class="card">
      <h4 style="margin-bottom:10px">🕳️ Find dine videnhuller</h4>
      <p style="color:var(--muted);font-size:.9rem;margin-bottom:14px">Upload materiale for AI-genererede opgaver, eller brug den faste bank.</p>
      <div class="upload-area" id="vhDrop">📄 Upload materiale (valgfrit)</div>
      <input type="file" id="vhFile" accept=".pdf,image/*,.txt" style="display:none"/>
      <button class="btn primary" id="vhStart" style="margin-top:12px">Find mine videnhuller</button>
      <div class="status" id="vhStatus"></div>
      <div id="vhOut" style="margin-top:16px"></div>
    </div>`;

  bindDropZone(document.getElementById("vhDrop"), document.getElementById("vhFile"));

  document.getElementById("vhStart").addEventListener("click", async () => {
    const file   = document.getElementById("vhFile").files[0];
    const st     = document.getElementById("vhStatus");
    const out    = document.getElementById("vhOut");
    const btn    = document.getElementById("vhStart");

    if (file) {
      btn.disabled = true;
      st.innerHTML = `<div class="pbar"><div class="pbar-fill"></div></div>Analyserer materiale…`;
      const form = new FormData();
      form.append("file", file); form.append("mode", "gaps"); form.append("count", "8");
      try {
        const d = await apiFetch("/api/pdf", { method:"POST", body:form }, 60000);
        st.textContent = `✅ ${d.items.length} videnhuller fundet`;
        st.className = "status ok";
        renderGapsOut(out, d.items);
      } catch(e) {
        st.textContent = "⚠️ " + e.message + " — bruger fast bank i stedet.";
        st.className = "status err";
        renderGapsOut(out, fixedGaps());
      } finally { btn.disabled = false; }
    } else {
      st.textContent = "";
      renderGapsOut(out, fixedGaps());
    }
  });
}

function fixedGaps() {
  return [
    { sentence:"Newtons 2. lov: F = ___ · a",    answer:"m",  hint:"Hvad måles i kg?" },
    { sentence:"Kinetisk energi: E = ½ · ___ · v²", answer:"m", hint:"Massen" },
    { sentence:"Ohms lov: U = R · ___",           answer:"I",  hint:"Strøm i ampere" },
    { sentence:"Bølgeligning: v = f · ___",        answer:"λ",  hint:"Bølgelængden (lambda)" },
    { sentence:"Varmeenergi: Q = m · c · ___",    answer:"ΔT", hint:"Temperaturændring" },
    { sentence:"Fotonenergi: E = ___ · f",        answer:"h",  hint:"Plancks konstant" },
    { sentence:"Effekt: P = W / ___",             answer:"t",  hint:"Tid i sekunder" },
    { sentence:"Frit fald: h = ½ · ___ · t²",    answer:"g",  hint:"Tyngdeaccelerationen ≈ 9,82" },
  ];
}

function renderGapsOut(out, items) {
  let idx = 0;
  let answered = false;

  function showGap() {
    if (idx >= items.length) {
      out.innerHTML = `<div class="card" style="text-align:center;padding:24px">
        <b style="font-size:1.1rem">✅ Alle huller lukket!</b>
        <br><button class="btn ghost" style="margin-top:14px" id="gapRestart">Kør igen</button>
      </div>`;
      document.getElementById("gapRestart").addEventListener("click", () => {
        idx = 0; showGap();
      });
      return;
    }
    const g = items[idx];
    answered = false;
    out.innerHTML = `
      <div class="gap-card">
        <div class="q-progress">Videnhul ${idx + 1} af ${items.length}</div>
        <div class="gap-sent">${g.sentence.replace("___", "<b style='color:var(--accent)'>___</b>")}</div>
        <p class="gap-hint">💡 Hint: ${g.hint || "Tænk over sammenhængen"}</p>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <input class="gap-inp" type="text" id="gapInp" placeholder="Dit svar…" autocomplete="off"/>
          <button class="btn primary" id="gapCheck">Tjek</button>
        </div>
        <div class="status" id="gapSt"></div>
        <button class="btn ghost" id="gapNext" style="display:none;margin-top:12px">Næste →</button>
      </div>`;

    const inp  = document.getElementById("gapInp");
    const check = document.getElementById("gapCheck");
    const next  = document.getElementById("gapNext");

    function checkAnswer() {
      if (answered) return;
      answered = true;
      const ans     = inp.value.trim().toLowerCase();
      const correct = g.answer.toLowerCase();
      const ok = ans === correct || ans.includes(correct) || correct.includes(ans);
      const st2 = document.getElementById("gapSt");
      st2.textContent = ok
        ? `✅ Korrekt! Svaret er "${g.answer}"`
        : `❌ Ikke helt. Svaret er "${g.answer}"`;
      st2.className = ok ? "status ok" : "status err";
      addProgress(ok);
      check.disabled = true;
      next.style.display = "inline-block";
      inp.disabled = true;
    }

    check.addEventListener("click", checkAnswer);
    next.addEventListener("click", () => { idx++; showGap(); });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") checkAnswer(); });
    setTimeout(() => inp.focus(), 50);
  }
  showGap();
}

// ── Chat ───────────────────────────────────────────────
function renderChat(el, mode = "tutor", context = "") {
  const chatId = "chat_" + Math.random().toString(36).slice(2, 8);
  const isOral = mode === "oral";
  const div = document.createElement("div");
  div.className = "chat-wrap";
  div.id = chatId;
  div.innerHTML = `
    <div class="allan-header">
      <div class="allan-avatar">🧑‍🏫</div>
      <div>
        <div class="allan-name">AI Allan</div>
        <div class="allan-sub">${isOral ? "Mundtlig eksaminator" : "Din fysik-tutor"}</div>
      </div>
      <div class="allan-dot" title="Online"></div>
    </div>
    <div class="chat-msgs" id="msgs_${chatId}"></div>
    <div class="chat-input-row">
      <input type="text" id="inp_${chatId}" placeholder="${isOral ? "Skriv din forklaring…" : "Spørg AI Allan om hvad som helst…"}" autocomplete="off"/>
      <button class="btn primary" id="send_${chatId}">Send</button>
    </div>`;
  el.appendChild(div);

  const msgs    = document.getElementById("msgs_" + chatId);
  const inp     = document.getElementById("inp_" + chatId);
  const sendBtn = document.getElementById("send_" + chatId);
  const history = [];
  let sending   = false;

  function addBubble(text, who) {
    const b = document.createElement("div");
    b.className = "bubble " + who;
    b.textContent = text;
    msgs.appendChild(b);
    msgs.scrollTop = msgs.scrollHeight;
    return b;
  }

  // Varierede velkomstbeskeder fra AI Allan
  const tutorGreets = [
    "Hej! Jeg er AI Allan. Hvad vil du forstå bedre i dag? 😊",
    "Hej igen! Klar til at knække et svært fysikemne? Hvad skal vi tage fat på?",
    "Hejsa! Spørg mig om alt fra Ohms lov til kvantefysik — jeg er her.",
    "Goddag! Hvad sidder du fast i? Ingen spørgsmål er for dumme.",
  ];
  const oralGreet = "Klar til mundtlig eksamen! Skriv din forklaring, og jeg giver dig konstruktiv feedback og en karakter. 🎤";
  addBubble(mode === "tutor"
    ? tutorGreets[Math.floor(Math.random() * tutorGreets.length)]
    : oralGreet, "bot");

  async function send() {
    const msg = inp.value.trim();
    if (!msg || sending) return;
    sending = true;
    sendBtn.disabled = true;
    inp.value = "";
    addBubble(msg, "user");
    history.push({ role:"user", content:msg });
    const thinking = addBubble("…", "bot");

    try {
      const d = await apiFetch("/api/chat", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ messages: history, mode, context }),
      }, 30000);
      thinking.textContent = d.reply;
      history.push({ role:"assistant", content:d.reply });
    } catch(e) {
      thinking.textContent = "⚠️ " + e.message;
    } finally {
      sending = false;
      sendBtn.disabled = false;
      inp.focus();
    }
  }

  sendBtn.addEventListener("click", send);
  inp.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
}

// ═══════════════════════════════════════════════════════
//  ØV DIG
// ═══════════════════════════════════════════════════════
document.querySelectorAll("#view-oev .mode-card").forEach(c => {
  c.addEventListener("click", () => {
    document.querySelectorAll("#view-oev .mode-card").forEach(x => x.classList.remove("active-card"));
    c.classList.add("active-card");
    const el = document.getElementById("oevContent");
    el.innerHTML = "";
    clearAll();
    const m = c.dataset.mode;
    if (m === "quiz")       renderQuizSetup(el, false);
    else if (m === "sandtfalsk") renderSandtFalsk(el);
    else if (m === "flash")  renderFlashSetup(el);
    else if (m === "gentagelse") renderGentagelse(el);
    else if (m === "gaps")   renderVidenhuller(el);
  });
});

// ── Quiz setup ─────────────────────────────────────────
function renderQuizSetup(el, examMode = false) {
  el.innerHTML = `
    <div class="card setup" style="margin-bottom:18px">
      <div class="field"><label>Emne</label>
        <select class="topic-select" id="qTopic"></select>
      </div>
      <div class="field"><label>Niveau</label>
        <select id="qLevel">
          <option value="alle">Alle</option>
          <option value="let">Let</option>
          <option value="mellem">Mellem</option>
          <option value="svaer">Svær</option>
        </select>
      </div>
      <div class="field"><label>Antal</label>
        <select id="qCount">
          <option>5</option><option selected>10</option><option>15</option><option>20</option>
        </select>
      </div>
      <button class="btn primary" id="qStart">Start quiz</button>
    </div>
    <div class="card setup" style="margin-bottom:18px">
      <div style="flex:1">
        <p style="font-size:.9rem;color:var(--muted);margin-bottom:10px">AI-spørgsmål fra dit eget materiale:</p>
        <div class="upload-area" id="qDrop">📄 Upload PDF / billede / tekst</div>
        <input type="file" id="qFile" accept=".pdf,image/*,.txt" style="display:none"/>
        <button class="btn ghost" id="qAiStart" style="margin-top:10px">Generer spørgsmål fra materiale</button>
      </div>
    </div>
    <div class="status" id="qStatus"></div>
    <div id="qArea"></div>`;

  // Fyld topic-select
  const topicSel = document.getElementById("qTopic");
  topicSel.innerHTML = `<option value="alle">Alle emner</option>` +
    TOPICS.map(t => `<option value="${t.id}">${t.name}</option>`).join("");

  const qArea = document.getElementById("qArea");
  const qStatus = document.getElementById("qStatus");

  document.getElementById("qStart").addEventListener("click", async () => {
    const t = topicSel.value;
    const l = document.getElementById("qLevel").value;
    const n = document.getElementById("qCount").value;
    qStatus.innerHTML = `<div class="pbar"><div class="pbar-fill"></div></div>`;
    document.getElementById("qStart").disabled = true;
    try {
      const items = await apiFetch(`/api/questions?topic=${t}&level=${l}&count=${n}`);
      if (!items?.length) throw new Error("Ingen spørgsmål fundet.");
      qStatus.textContent = "";
      startQuiz(qArea, items, examMode);
    } catch(e) {
      qStatus.textContent = "⚠️ " + e.message; qStatus.className = "status err";
    } finally { document.getElementById("qStart").disabled = false; }
  });

  bindDropZone(document.getElementById("qDrop"), document.getElementById("qFile"));

  document.getElementById("qAiStart").addEventListener("click", async () => {
    const file = document.getElementById("qFile").files[0];
    if (!file) { qStatus.textContent = "Vælg en fil først."; qStatus.className = "status err"; return; }
    qStatus.innerHTML = `<div class="pbar"><div class="pbar-fill"></div></div>AI genererer spørgsmål…`;
    document.getElementById("qAiStart").disabled = true;
    const form = new FormData();
    form.append("file", file); form.append("mode", "quiz"); form.append("count", "10");
    try {
      const d = await apiFetch("/api/pdf", { method:"POST", body:form }, 60000);
      qStatus.textContent = `✅ ${d.items.length} spørgsmål klar!`;
      qStatus.className = "status ok";
      startQuiz(qArea, d.items, examMode);
    } catch(e) {
      qStatus.textContent = "⚠️ " + e.message; qStatus.className = "status err";
    } finally { document.getElementById("qAiStart").disabled = false; }
  });
}

// ── Quiz motor ─────────────────────────────────────────
function startQuiz(container, items, examMode = false) {
  if (!items?.length) {
    container.innerHTML = `<div class="card"><p style="color:var(--muted)">Ingen spørgsmål at vise.</p></div>`;
    return;
  }
  let idx = 0, correct = 0;

  function showQ() {
    const q = items[idx];
    const tName = (TOPICS.find(t => t.id === q.topic) || {}).name || (q.topic || "Fra noter");
    // Beregn korrekt svar-indeks ved rendering (fejlsikkert)
    const answerIdx = q.options.indexOf(q.answer);

    container.innerHTML = `
      <p class="q-progress">Spørgsmål ${idx + 1} af ${items.length} · ${correct} rigtige${examMode ? " · ⏱ Eksamensmodus" : ""}</p>
      <div class="q-card">
        <div class="q-topic">${tName} · ${q.level || "–"}</div>
        <div class="q-text">${q.question}</div>
        <div class="opts">
          ${q.options.map((o, i) =>
            `<button class="opt" data-idx="${i}" data-correct="${i === answerIdx}">${o}</button>`
          ).join("")}
        </div>
        <div id="qAfter"></div>
      </div>`;

    container.querySelectorAll(".opt").forEach(btn =>
      btn.addEventListener("click", () => answerQ(btn, q, answerIdx))
    );
  }

  function answerQ(btn, q, answerIdx) {
    const opts = container.querySelectorAll(".opt");
    const chosenIdx = parseInt(btn.dataset.idx);
    const ok = (chosenIdx === answerIdx);
    opts.forEach(o => {
      o.disabled = true;
      if (parseInt(o.dataset.idx) === answerIdx) o.classList.add("correct");
      else if (o === btn && !ok)                 o.classList.add("wrong");
    });
    if (ok) correct++;
    addProgress(ok);

    const last = (idx === items.length - 1);
    const after = document.getElementById("qAfter");

    let html = "";
    if (!examMode) {
      html += `<div class="explain"><b>${ok ? "✅ Rigtigt!" : "❌ Ikke helt."}</b> ${q.explain || ""}</div>`;
    }
    html += `<div class="q-next">
      <button class="btn primary" id="qNextBtn">${last ? "Se resultat" : "Næste →"}</button>
    </div>`;
    after.innerHTML = html;

    document.getElementById("qNextBtn").addEventListener("click", () => {
      if (last) showResult();
      else { idx++; showQ(); }
    });
  }

  function showResult() {
    const pct   = Math.round(correct / items.length * 100);
    const grade = pct >= 93 ? 12 : pct >= 81 ? 10 : pct >= 69 ? 7 : pct >= 55 ? 4 : pct >= 40 ? 2 : -3;
    const msg   = pct >= 80 ? "Flot! Du er godt forberedt." :
                  pct >= 55 ? "Pænt — kør en runde til på de svære." :
                  "Gennemgå flashcards og prøv igen.";
    container.innerHTML = `
      <div class="card quiz-result">
        <div class="score">${correct}/${items.length}</div>
        <p style="color:var(--muted);margin:8px 0">${pct}% rigtige. ${msg}</p>
        ${examMode ? `<div class="grade-badge">${grade > 0 ? "+" : ""}${grade}</div>
          <p style="color:var(--muted);font-size:.82rem;margin-bottom:6px">Estimeret karakter (7-trinsskala)</p>` : ""}
        <div style="display:flex;gap:10px;justify-content:center;margin-top:18px;flex-wrap:wrap">
          <button class="btn primary" id="qAgain">Ny quiz (nye spørgsmål)</button>
          <button class="btn ghost"   id="qRestart">Samme spørgsmål igen</button>
        </div>
      </div>`;
    document.getElementById("qAgain").addEventListener("click", () => {
      container.innerHTML = "";
      renderQuizSetup(container, examMode);
    });
    document.getElementById("qRestart").addEventListener("click", () => {
      idx = 0; correct = 0; showQ();
    });
  }

  showQ();
}

// ── Sandt / Falsk ──────────────────────────────────────
const sfBank = [
  { stmt:"Newtons 2. lov: F = m · a",                                    ans:true,  explain:"Ja — kraft = masse × acceleration." },
  { stmt:"Potentiel energi afhænger af legemets fart",                   ans:false, explain:"Nej — E_pot = m·g·h. Farten giver kinetisk energi." },
  { stmt:"Ohms lov: U = R · I",                                          ans:true,  explain:"Korrekt. Spænding = modstand × strøm." },
  { stmt:"Bølgelængden stiger, når frekvensen stiger (konstant fart)",   ans:false, explain:"Nej — v = f·λ, så λ falder når f stiger." },
  { stmt:"Kelvin-skalaen starter ved −273,15 °C",                        ans:true,  explain:"Rigtigt. 0 K = det absolutte nulpunkt." },
  { stmt:"Alfapartikler er elektroner",                                   ans:false, explain:"Nej — alfapartikler er heliumkerner (2p + 2n)." },
  { stmt:"Effekt måles i watt",                                           ans:true,  explain:"Ja. 1 W = 1 J/s." },
  { stmt:"I en seriekobling er strømmen den samme overalt",              ans:true,  explain:"Korrekt. Strømmen er konstant i serie." },
  { stmt:"Lysets fart i vakuum er ca. 300.000 km/s",                    ans:true,  explain:"Ja — c ≈ 3,0·10⁸ m/s." },
  { stmt:"Energi kan skabes ud af ingenting",                            ans:false, explain:"Nej — energibevarelse: energi opstår eller forsvinder ikke." },
  { stmt:"Den specifikke varmekapacitet for vand er ca. 4186 J/(kg·K)", ans:true,  explain:"Korrekt. Det er derfor vand er godt til at lagre varme." },
  { stmt:"I en parallelkobling er spændingen den samme over hver gren", ans:true,  explain:"Ja — spændingen er parallel, strøm fordeles." },
];

function renderSandtFalsk(el) {
  const shuffled = [...sfBank].sort(() => Math.random() - 0.5);
  let idx = 0, correct = 0;

  function show() {
    if (idx >= shuffled.length) {
      el.innerHTML = `<div class="card quiz-result">
        <div class="score">${correct}/${shuffled.length}</div>
        <p style="color:var(--muted);margin:10px 0">${Math.round(correct/shuffled.length*100)}% rigtige.</p>
        <button class="btn primary" id="sfRestart" style="margin-top:14px">Spil igen</button>
      </div>`;
      document.getElementById("sfRestart").addEventListener("click", () => renderSandtFalsk(el));
      return;
    }
    const item = shuffled[idx];
    let answered = false;

    el.innerHTML = `
      <p class="q-progress">Påstand ${idx + 1} af ${shuffled.length} · ${correct} rigtige</p>
      <div class="sf-card">
        <div class="sf-stmt">${item.stmt}</div>
        <div class="sf-btns">
          <button class="sf-btn t" id="sfTrue">✅ Sandt</button>
          <button class="sf-btn f" id="sfFalse">❌ Falsk</button>
        </div>
        <div class="explain" id="sfEx" style="display:none"></div>
        <div class="q-next" id="sfNext" style="display:none">
          <button class="btn primary" id="sfNextBtn">Næste →</button>
        </div>
      </div>`;

    function answer(chosen) {
      if (answered) return;
      answered = true;
      const ok = (chosen === item.ans);
      if (ok) correct++;
      addProgress(ok);
      const ex = document.getElementById("sfEx");
      ex.innerHTML = `<b>${ok ? "✅ Rigtigt!" : "❌ Forkert."}</b> ${item.explain}`;
      ex.style.display = "block";
      document.getElementById("sfTrue").disabled  = true;
      document.getElementById("sfFalse").disabled = true;
      document.getElementById("sfNext").style.display = "flex";
    }

    document.getElementById("sfTrue").addEventListener("click",  () => answer(true));
    document.getElementById("sfFalse").addEventListener("click", () => answer(false));
    document.getElementById("sfNextBtn").addEventListener("click", () => { idx++; show(); });
  }
  show();
}

// ── Flashcards ─────────────────────────────────────────
function renderFlashSetup(el) {
  el.innerHTML = `
    <div class="card setup" style="margin-bottom:18px">
      <div class="field"><label>Emne</label>
        <select class="topic-select" id="fTopic"></select>
      </div>
      <button class="btn primary" id="fLoad">Hent kort</button>
    </div>
    <div class="card setup" style="margin-bottom:18px">
      <div style="flex:1">
        <p style="font-size:.9rem;color:var(--muted);margin-bottom:10px">AI-flashcards fra dit materiale:</p>
        <div class="upload-area" id="fDrop">📄 Upload fil</div>
        <input type="file" id="fFile" accept=".pdf,image/*,.txt" style="display:none"/>
        <button class="btn ghost" id="fAiLoad" style="margin-top:10px">Generer fra materiale</button>
      </div>
    </div>
    <div class="status" id="fStatus"></div>
    <div id="fArea" class="flash-grid"></div>`;

  const topicSel = document.getElementById("fTopic");
  topicSel.innerHTML = `<option value="alle">Alle emner</option>` +
    TOPICS.map(t => `<option value="${t.id}">${t.name}</option>`).join("");

  document.getElementById("fLoad").addEventListener("click", async () => {
    const st = document.getElementById("fStatus");
    st.innerHTML = `<div class="pbar"><div class="pbar-fill"></div></div>`;
    try {
      const cards = await apiFetch(`/api/flashcards?topic=${topicSel.value}`);
      st.textContent = "";
      renderFlashCards(document.getElementById("fArea"), cards);
    } catch(e) { st.textContent = "⚠️ " + e.message; st.className = "status err"; }
  });

  bindDropZone(document.getElementById("fDrop"), document.getElementById("fFile"));

  document.getElementById("fAiLoad").addEventListener("click", async () => {
    const file = document.getElementById("fFile").files[0];
    const st   = document.getElementById("fStatus");
    if (!file) { st.textContent = "Vælg en fil."; st.className = "status err"; return; }
    st.innerHTML = `<div class="pbar"><div class="pbar-fill"></div></div>Genererer flashcards…`;
    document.getElementById("fAiLoad").disabled = true;
    const form = new FormData();
    form.append("file", file); form.append("mode", "flash"); form.append("count", "12");
    try {
      const d = await apiFetch("/api/pdf", { method:"POST", body:form }, 60000);
      st.textContent = `✅ ${d.items.length} flashcards klar!`; st.className = "status ok";
      renderFlashCards(document.getElementById("fArea"), d.items);
    } catch(e) { st.textContent = "⚠️ " + e.message; st.className = "status err"; }
    finally { document.getElementById("fAiLoad").disabled = false; }
  });
}

function renderFlashCards(area, cards) {
  if (!cards?.length) { area.innerHTML = `<p style="color:var(--muted)">Ingen flashcards.</p>`; return; }
  area.innerHTML = "";
  cards.forEach(c => {
    const topic = (TOPICS.find(t => t.id === c.topic) || {}).name || "Fra noter";
    const el = document.createElement("div");
    el.className = "fcard";
    el.innerHTML = `
      <div class="fcard-inner">
        <div class="fcard-face fcard-front">
          <div class="ft">${topic}</div>
          <h4>${c.front}</h4>
          <div class="fcard-hint">Tryk for at vende →</div>
        </div>
        <div class="fcard-face fcard-back">${c.back}</div>
      </div>`;
    el.addEventListener("click", () => el.classList.toggle("flip"));
    area.appendChild(el);
  });
}

// ── Gentagelse (Spaced Repetition) ────────────────────
function renderGentagelse(el) {
  // Bootstrap spaced-kort fra flashcards hvis tomt
  if (!state.spaced?.length) {
    // Vi henter flashcards via API for at sikre frisk data
    apiFetch("/api/flashcards?topic=alle").then(cards => {
      state.spaced = cards.map((c, i) => ({
        id: i, front: c.front, back: c.back,
        due: 0, ease: 2.5, interval: 1,
      }));
      saveState();
      _renderGentagelseCards(el);
    }).catch(() => {
      el.innerHTML = `<div class="card"><p style="color:var(--muted)">Kunne ikke hente kort.</p></div>`;
    });
    return;
  }
  _renderGentagelseCards(el);
}

function _renderGentagelseCards(el) {
  const now  = Date.now();
  const due  = state.spaced.filter(c => c.due <= now);

  if (!due.length) {
    const next = Math.min(...state.spaced.map(c => c.due));
    const mins = Math.max(1, Math.round((next - now) / 60000));
    el.innerHTML = `<div class="card" style="text-align:center;padding:30px">
      <h3 style="margin-bottom:10px">✅ Alt er repeteret!</h3>
      <p style="color:var(--muted)">Næste kort om ${mins} minut${mins > 1 ? "ter" : ""}.</p>
      <button class="btn ghost" id="genForce" style="margin-top:14px">Gennemgå alle alligevel</button>
    </div>`;
    document.getElementById("genForce").addEventListener("click", () => {
      state.spaced.forEach(c => c.due = 0);
      saveState();
      _renderGentagelseCards(el);
    });
    return;
  }

  const shuffled = [...due].sort(() => Math.random() - 0.5);
  let idx = 0;

  function showCard() {
    if (idx >= shuffled.length) {
      el.innerHTML = `<div class="card" style="text-align:center;padding:30px">
        <h3>✅ Runde færdig!</h3>
        <p style="color:var(--muted);margin:10px 0">${shuffled.length} kort gennemgået.</p>
        <button class="btn primary" id="genRestart" style="margin-top:14px">Ny runde</button>
      </div>`;
      document.getElementById("genRestart").addEventListener("click", () => renderGentagelse(el));
      return;
    }

    const c = shuffled[idx];
    el.innerHTML = `
      <p class="q-progress">${idx + 1} af ${shuffled.length} due-kort</p>
      <div class="gentagelse-card">
        <div class="gen-q"><b>${c.front}</b></div>
        <button class="btn ghost" id="genReveal">Vis svar</button>
        <div id="genBack" style="display:none;margin:16px 0;padding:14px;background:var(--panel2);border-radius:10px">${c.back}</div>
        <div class="gen-btns" id="genBtns" style="display:none">
          <button class="gen-btn easy" data-q="5">Nem 😊</button>
          <button class="gen-btn ok"   data-q="3">OK 🙂</button>
          <button class="gen-btn hard" data-q="1">Svær 😰</button>
        </div>
      </div>`;

    document.getElementById("genReveal").addEventListener("click", () => {
      document.getElementById("genBack").style.display = "block";
      document.getElementById("genBtns").style.display = "flex";
      document.getElementById("genReveal").style.display = "none";
    });

    document.querySelectorAll(".gen-btn").forEach(btn =>
      btn.addEventListener("click", () => {
        const q    = parseInt(btn.dataset.q);
        const card = state.spaced.find(x => x.id === c.id);
        if (card) {
          card.ease     = Math.max(1.3, card.ease + 0.1 - (5 - q) * 0.08);
          card.interval = q >= 4 ? Math.round(card.interval * card.ease) : q >= 2 ? 1 : 0.5;
          card.due      = Date.now() + card.interval * 24 * 3600 * 1000;
          saveState();
        }
        addProgress(q >= 4);
        idx++;
        showCard();
      })
    );
  }
  showCard();
}

// ═══════════════════════════════════════════════════════
//  EKSAMEN
// ═══════════════════════════════════════════════════════
document.querySelectorAll("#view-eksamen .mode-card").forEach(c => {
  c.addEventListener("click", () => {
    document.querySelectorAll("#view-eksamen .mode-card").forEach(x => x.classList.remove("active-card"));
    c.classList.add("active-card");
    const el = document.getElementById("eksamenContent");
    el.innerHTML = "";
    clearAll();
    if (c.dataset.mode === "testsim") renderTestsim(el);
    else if (c.dataset.mode === "mundtlig") renderMundtlig(el);
  });
});

// ── Testsimulering ─────────────────────────────────────
function renderTestsim(el) {
  el.innerHTML = `
    <div class="card setup" style="margin-bottom:18px">
      <div class="field"><label>Emne</label>
        <select class="topic-select" id="tsTopic"></select>
      </div>
      <div class="field"><label>Antal</label>
        <select id="tsCount">
          <option>5</option><option selected>10</option><option>15</option><option>20</option>
        </select>
      </div>
      <div class="field"><label>Tid (min)</label>
        <select id="tsTime">
          <option value="5">5</option><option value="10" selected>10</option>
          <option value="15">15</option><option value="20">20</option><option value="0">Ingen</option>
        </select>
      </div>
      <button class="btn primary" id="tsStart">Start eksamen</button>
    </div>
    <div id="tsArea"></div>`;

  document.getElementById("tsTopic").innerHTML =
    `<option value="alle">Alle emner</option>` +
    TOPICS.map(t => `<option value="${t.id}">${t.name}</option>`).join("");

  document.getElementById("tsStart").addEventListener("click", async () => {
    const topic = document.getElementById("tsTopic").value;
    const count = document.getElementById("tsCount").value;
    const mins  = parseInt(document.getElementById("tsTime").value);
    const area  = document.getElementById("tsArea");
    const btn   = document.getElementById("tsStart");

    btn.disabled = true;
    area.innerHTML = `<div class="pbar"><div class="pbar-fill"></div></div>`;

    try {
      const items = await apiFetch(`/api/questions?topic=${topic}&count=${count}`);
      if (!items?.length) throw new Error("Ingen spørgsmål.");

      if (mins > 0) {
        area.innerHTML = `
          <p class="timer-label" id="timerLabel">⏱ ${mins}:00</p>
          <div class="timer-bar-wrap"><div class="timer-bar" id="timerBar" style="width:100%"></div></div>
          <div id="tsQ"></div>`;
        let secs  = mins * 60;
        const tot = secs;
        const iv  = safeInterval(() => {
          secs--;
          const tl = document.getElementById("timerLabel");
          const tb = document.getElementById("timerBar");
          if (!tl) { clearInterval(iv); return; } // DOM forsvundet
          const m = Math.floor(secs / 60), s = secs % 60;
          tl.textContent = `⏱ ${m}:${s.toString().padStart(2, "0")}`;
          if (tb) tb.style.width = Math.max(0, secs / tot * 100) + "%";
          if (secs <= 0) {
            clearInterval(iv);
            tl.textContent = "⏱ Tid er gået!";
            tl.style.color = "var(--bad)";
          }
        }, 1000);
      } else {
        area.innerHTML = `<div id="tsQ"></div>`;
      }

      startQuiz(document.getElementById("tsQ") || area, items, true);
    } catch(e) {
      area.innerHTML = `<p style="color:var(--bad)">⚠️ ${e.message}</p>`;
    } finally { btn.disabled = false; }
  });
}

// ── Mundtlig eksamen ───────────────────────────────────
const explainConcepts = [
  { concept:"Kinetisk energi",  prompt:"Forklar hvad kinetisk energi er og giv et hverdagseksempel." },
  { concept:"Ohms lov",         prompt:"Forklar Ohms lov og hvad U, R og I betyder." },
  { concept:"Newtons 2. lov",   prompt:"Forklar Newtons 2. lov og hvornår du ville bruge den." },
  { concept:"Bølgeligning",     prompt:"Forklar sammenhængen mellem fart, frekvens og bølgelængde." },
  { concept:"Energibevarelse",  prompt:"Forklar energibevarelse med et konkret eksempel." },
  { concept:"Halveringstid",    prompt:"Hvad er halveringstid, og hvad bruges det til?" },
  { concept:"Fotonenergi",      prompt:"Forklar hvad en foton er, og hvordan man beregner dens energi." },
  { concept:"Frit fald",        prompt:"Hvad sker der ved frit fald, og hvilke formler bruger du?" },
  { concept:"Elektrisk effekt", prompt:"Forklar hvad elektrisk effekt er og giv formlen." },
];

function renderMundtlig(el) {
  const concept = explainConcepts[Math.floor(Math.random() * explainConcepts.length)];
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

  el.innerHTML = `
    <div class="oral-box">
      <p class="q-topic">Mundtlig eksamen</p>
      <div class="oral-concept">${concept.concept}</div>
      <div class="oral-prompt">${concept.prompt}</div>
      <p style="color:var(--muted);font-size:.88rem;margin:14px 0">
        ${SpeechRec ? "Brug mikrofonen eller skriv din forklaring:" : "Skriv din forklaring:"}
      </p>
      ${SpeechRec ? `
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:14px">
          <button class="mic-btn" id="micBtn" title="Klik for at optage">🎤</button>
          <p style="font-size:.78rem;color:var(--muted)" id="micLabel">Klik for at starte optagelse</p>
        </div>` : ""}
      <textarea class="ob-textarea" id="oralText"
        placeholder="Din forklaring…"
        style="width:100%;min-height:120px;margin-bottom:12px"></textarea>
      <button class="btn primary" id="oralSubmit">Send til AI-bedømmelse</button>
      <div class="status" id="oralStatus"></div>
      <div class="feedback-box" id="oralFeedback" style="display:none;margin-top:16px"></div>
      <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
        <button class="btn ghost" id="oralNext">Nyt begreb →</button>
        <button class="btn ghost" id="oralChatBtn">Chat om dette begreb</button>
      </div>
      <div id="oralChatWrap" style="margin-top:14px"></div>
    </div>`;

  // Mikrofon
  if (SpeechRec) {
    const micBtn   = document.getElementById("micBtn");
    const micLabel = document.getElementById("micLabel");
    const oralText = document.getElementById("oralText");
    let rec = null, recording = false;

    micBtn.addEventListener("click", () => {
      if (recording) {
        rec?.stop();
        recording = false;
        micBtn.classList.remove("recording");
        micLabel.textContent = "Klik for at starte optagelse";
        return;
      }
      try {
        rec = new SpeechRec();
        rec.lang = "da-DK"; rec.continuous = true; rec.interimResults = true;
        rec.onresult = e => {
          let t = "";
          for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
          oralText.value = t;
        };
        rec.onerror = e => {
          micLabel.textContent = "Mikrofonfejl: " + e.error;
          recording = false; micBtn.classList.remove("recording");
        };
        rec.onend = () => {
          recording = false; micBtn.classList.remove("recording");
          micLabel.textContent = "Klik for at starte optagelse";
        };
        rec.start();
        recording = true;
        micBtn.classList.add("recording");
        micLabel.textContent = "Optager… klik for at stoppe";
      } catch(e) {
        micLabel.textContent = "Mikrofon ikke tilgængelig: " + e.message;
      }
    });
  }

  // Indsend
  document.getElementById("oralSubmit").addEventListener("click", async () => {
    const text = document.getElementById("oralText").value.trim();
    const st   = document.getElementById("oralStatus");
    const fb   = document.getElementById("oralFeedback");
    if (!text) { st.textContent = "Skriv eller optag din forklaring først."; st.className = "status err"; return; }

    document.getElementById("oralSubmit").disabled = true;
    st.innerHTML = `<div class="pbar"><div class="pbar-fill"></div></div>AI bedømmer…`;
    fb.style.display = "none";

    try {
      const d = await apiFetch("/api/chat", {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          messages: [{ role:"user", content:`Begrebet er: "${concept.concept}". Min forklaring: "${text}"` }],
          mode: "oral",
        }),
      }, 30000);
      fb.style.display = "block";
      fb.innerHTML = d.reply
        .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
        .replace(/\n/g, "<br>");
      st.textContent = "";
    } catch(e) {
      st.textContent = "⚠️ " + e.message; st.className = "status err";
    } finally {
      document.getElementById("oralSubmit").disabled = false;
    }
  });

  document.getElementById("oralNext").addEventListener("click", () => {
    clearAll();
    renderMundtlig(el);
  });
  document.getElementById("oralChatBtn").addEventListener("click", () => {
    const wrap = document.getElementById("oralChatWrap");
    if (wrap.children.length) { wrap.innerHTML = ""; return; }
    renderChat(wrap, "tutor", `Begrebet er: ${concept.concept}. ${concept.prompt}`);
  });
}

// ═══════════════════════════════════════════════════════
//  PLAN
// ═══════════════════════════════════════════════════════
document.getElementById("makePlan").addEventListener("click", () => {
  const dateVal = document.getElementById("planDate").value;
  const out     = document.getElementById("planOut");

  if (!dateVal) {
    out.innerHTML = `<div class="card"><p style="color:var(--muted)">Vælg en eksamensdato.</p></div>`;
    return;
  }
  state.examDate = dateVal;
  saveState();
  renderHomeCountdown();
  renderDailyCard();
  const sd = document.getElementById("settingsDate");
  if (sd) sd.value = dateVal;

  const d = daysUntil(dateVal);
  if (!d || d <= 0) {
    out.innerHTML = `<div class="card"><p style="color:var(--muted)">Vælg en dato i fremtiden.</p></div>`;
    return;
  }

  const topics   = selTopics.size ? [...selTopics] : TOPICS.map(t => t.id);
  const tName    = id => (TOPICS.find(t => t.id === id) || {}).name || id;
  const planDays = Math.min(d, 14);

  let html = `<p class="plan-head">Du har <b>${d} dage</b> til eksamen. Plan for de næste <b>${planDays} dage</b>:</p>`;
  for (let i = 0; i < planDays; i++) {
    const t    = topics[i % topics.length];
    const date = new Date(Date.now() + i * 864e5);
    const ds   = date.toLocaleDateString("da-DK",
      { weekday:"long", day:"numeric", month:"short" });
    let task;
    if      (i === planDays - 1) task = "🏁 Stor blandet quiz + flashcard-genopfriskning.";
    else if (i === planDays - 2) task = `⏱ Prøveeksamen i ${tName(t)} — eksamensmodus uden hjælp.`;
    else if (i % 4 === 3)        task = `🎤 Mundtlig gennemgang af ${tName(t)}.`;
    else if (i % 3 === 2)        task = `🔁 Gentagelse (spaced repetition) + quiz i ${tName(t)}.`;
    else                          task = `📖 Lær ${tName(t)}: podcast + 10 spørgsmål + flashcards.`;
    html += `
      <div class="day">
        <span class="d-num">Dag ${i + 1}</span>
        <div class="d-body"><strong>${ds}</strong><span>${task}</span></div>
      </div>`;
  }
  out.innerHTML = html;
});
