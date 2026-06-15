// ═══════════════════════════════════════════════════════
//  FysikEksamen – fuld app
// ═══════════════════════════════════════════════════════

// ── Storage helpers ──────────────────────────────────
const S = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

// ── State ─────────────────────────────────────────────
let state = S.get("state", {
  examDate: "", level: "alle",
  progress: { solved: 0, correct: 0, streak: 0, lastDay: null },
  spaced: [],   // {id, front, back, due, ease}
  material: null, // { type:"text"|"pdf", content, name }
});
function saveState() { S.set("state", state); }

// ── TOPICS (loaded from server) ───────────────────────
let TOPICS = [];
async function loadTopics() {
  TOPICS = await (await fetch("/api/topics")).json();
  buildTopicChips();
}

// ═══════════════════════════════════════════════════════
//  ONBOARDING
// ═══════════════════════════════════════════════════════
const obOverlay = document.getElementById("onboarding");
const mainApp   = document.getElementById("mainApp");

function obStep(n) {
  document.querySelectorAll(".ob-step").forEach(s => s.classList.toggle("active", s.dataset.step == n));
}

// Step 0: Velkomst
document.querySelector(".ob-next[data-next='1']").addEventListener("click", () => {
  obStep(1);
});

// Skip
document.querySelectorAll("[data-skip]").forEach(b => b.addEventListener("click", finishOnboarding));

// Step 1: Bekymring (auto-advance)
document.getElementById("obWorry").querySelectorAll(".ob-choice").forEach(c => {
  c.addEventListener("click", () => {
    document.getElementById("obWorry").querySelectorAll(".ob-choice").forEach(x => x.classList.remove("sel"));
    c.classList.add("sel"); state.worry = c.dataset.val; saveState();
    setTimeout(() => obStep(2), 300);
  });
});

// Step 2: Humør
document.getElementById("obMood").querySelectorAll(".ob-choice").forEach(c => {
  c.addEventListener("click", () => {
    document.getElementById("obMood").querySelectorAll(".ob-choice").forEach(x => x.classList.remove("sel"));
    c.classList.add("sel"); state.mood = c.dataset.val; saveState();
    setTimeout(() => obStep(3), 300);
  });
});

// Step 3: Vidensniveau
document.getElementById("obLevel").querySelectorAll(".ob-choice").forEach(c => {
  c.addEventListener("click", () => {
    document.getElementById("obLevel").querySelectorAll(".ob-choice").forEach(x => x.classList.remove("sel"));
    c.classList.add("sel"); state.level = c.dataset.val; saveState();
    setTimeout(() => obStep(4), 300);
  });
});

// Step 4: Upload materiale
const obFileIn = document.getElementById("obFileIn");
document.getElementById("obPasteOpt").addEventListener("click", () => {
  const ta = document.getElementById("obPasteText");
  ta.style.display = ta.style.display === "none" ? "block" : "none";
});
obFileIn.addEventListener("change", () => {
  const f = obFileIn.files[0];
  if (f) { document.getElementById("obFileLabel").textContent = `✅ ${f.name}`; state.pendingFile = true; }
});
document.querySelector(".ob-next[data-next='5']").addEventListener("click", async () => {
  const ta = document.getElementById("obPasteText");
  if (ta.value.trim()) { state.material = { type: "text", content: ta.value.trim(), name: "Indsat tekst" }; saveState(); }
  if (obFileIn.files[0]) {
    // We store the file reference in memory (not localStorage); we'll pass it when needed
    window._pendingFile = obFileIn.files[0];
  }
  obStep(5);
  updateObPlanPreview();
});

function updateObPlanPreview() {
  const dateInput = document.getElementById("obExamDate");
  const prev = document.getElementById("obPlanPreview");
  dateInput.addEventListener("change", () => {
    const d = daysUntil(dateInput.value);
    prev.innerHTML = d > 0 ? `📅 <b>${d} dage</b> til eksamen. Vi fordeler pensum dag for dag.` : d === 0 ? "⚡ Eksamen er i dag!" : "Vælg en dato i fremtiden.";
  });
}
document.getElementById("obFinish").addEventListener("click", () => {
  const d = document.getElementById("obExamDate").value;
  if (d) { state.examDate = d; saveState(); }
  finishOnboarding();
});

function finishOnboarding() {
  obOverlay.style.display = "none";
  mainApp.style.display = "block";
  initApp();
}

// Hvis allerede sat op, spring onboarding over
if (S.get("skipOnboarding", false)) {
  obOverlay.style.display = "none";
  mainApp.style.display = "block";
  initApp();
}
S.set("skipOnboarding", true);

// ═══════════════════════════════════════════════════════
//  APP INIT
// ═══════════════════════════════════════════════════════
function initApp() {
  loadTopics();
  renderStats();
  renderHomeCountdown();
  renderDailyCard();
  // Indlæs gemt dato
  const pd = document.getElementById("planDate");
  if (pd && state.examDate) pd.value = state.examDate;
  // Settings modal
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
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + view));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Stats ───────────────────────────────────────────────
function renderStats() {
  const p = state.progress;
  document.getElementById("statSolved").textContent = p.solved;
  document.getElementById("statAcc").textContent = p.solved ? Math.round(p.correct / p.solved * 100) + "%" : "–";
  document.getElementById("statStreak").textContent = p.streak;
}
function addProgress(ok) {
  const p = state.progress;
  p.solved++; if (ok) p.correct++;
  const today = new Date().toISOString().slice(0, 10);
  if (p.lastDay !== today) {
    const yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    p.streak = p.lastDay === yest ? p.streak + 1 : 1;
    p.lastDay = today;
  }
  saveState(); renderStats();
}

// ── Countdown ───────────────────────────────────────────
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 864e5);
}
function renderHomeCountdown() {
  const el = document.getElementById("homeCountdown");
  const d = daysUntil(state.examDate);
  if (d === null) { el.innerHTML = `<span class="lbl2">Sæt din eksamensdato i <b>Plan</b> for at starte nedtællingen.</span>`; return; }
  if (d === 0) { el.innerHTML = `<span class="big">🎓</span><span class="lbl2">Eksamen er i dag — held og lykke!</span>`; return; }
  if (d < 0) { el.innerHTML = `<span class="lbl2">Eksamen er overstået.</span>`; return; }
  el.innerHTML = `<span class="big">${d}</span><span class="lbl2">dage til eksamen · ${new Date(state.examDate + "T00:00:00").toLocaleDateString("da-DK", { weekday:"long", day:"numeric", month:"long" })}</span>`;
}
function renderDailyCard() {
  const el = document.getElementById("dailyCard");
  const d = daysUntil(state.examDate);
  if (!d || d < 0) { el.innerHTML = ""; return; }
  const today = new Date().toLocaleDateString("da-DK", { weekday:"long", day:"numeric", month:"short" });
  el.innerHTML = `
    <p style="font-family:'Space Mono',monospace;font-size:.68rem;text-transform:uppercase;letter-spacing:.12em;color:var(--accent2);margin-bottom:8px">I dag · ${today}</p>
    <h4 style="margin-bottom:12px">Din daglige plan</h4>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:center;gap:10px;color:var(--muted)">✅ <span>Lyt til en podcast om dagens emne</span></div>
      <div style="display:flex;align-items:center;gap:10px;color:var(--muted)">✅ <span>10 quizspørgsmål</span></div>
      <div style="display:flex;align-items:center;gap:10px;color:var(--muted)">✅ <span>Mundtlig gennemgang af ét begreb</span></div>
    </div>`;
}

// ── Topic chips (plan) ─────────────────────────────────
let selTopics = new Set();
function buildTopicChips() {
  const chips = document.getElementById("topicChips");
  if (!chips) return;
  chips.innerHTML = "";
  TOPICS.forEach(t => {
    const c = document.createElement("div"); c.className = "chip"; c.textContent = t.name; c.dataset.id = t.id;
    c.addEventListener("click", () => { c.classList.toggle("on"); c.classList.contains("on") ? selTopics.add(t.id) : selTopics.delete(t.id); });
    chips.appendChild(c);
  });
}

// ── Settings ────────────────────────────────────────────
function openSettings() {
  document.getElementById("settingsDate").value = state.examDate || "";
  document.getElementById("settingsModal").style.display = "flex";
}
function closeSettings() { document.getElementById("settingsModal").style.display = "none"; }
function saveSettings() {
  state.examDate = document.getElementById("settingsDate").value;
  saveState(); closeSettings(); renderHomeCountdown(); renderDailyCard();
}
document.getElementById("settingsModal").addEventListener("click", e => { if (e.target === e.currentTarget) closeSettings(); });

// ═══════════════════════════════════════════════════════
//  LÆR – mode cards
// ═══════════════════════════════════════════════════════
document.querySelectorAll("#view-laer .mode-card").forEach(c => {
  c.addEventListener("click", () => {
    document.querySelectorAll("#view-laer .mode-card").forEach(x => x.classList.remove("active-card"));
    c.classList.add("active-card");
    laerMode(c.dataset.mode);
  });
});
function laerMode(mode) {
  const el = document.getElementById("laerContent");
  el.innerHTML = "";
  if (mode === "intro") renderIntroLektion(el);
  else if (mode === "podcast") renderPodcast(el);
  else if (mode === "smarttekst") renderSmartTekst(el);
  else if (mode === "videnhuller") renderVidenhuller(el);
  else if (mode === "chat") renderChat(el, "tutor");
}

// ── Intro-lektion: chat med tutor ─────────────────────
function renderIntroLektion(el) {
  el.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <p style="color:var(--muted);font-size:.92rem">Skriv et emne du vil lære om, og din AI-tutor introducerer det for dig.</p>
    </div>`;
  renderChat(el, "tutor");
}

// ── Podcast ─────────────────────────────────────────────
function renderPodcast(el) {
  el.innerHTML = `
    <div class="podcast-box">
      <h3 style="margin-bottom:10px">🎙️ Podcast fra dit materiale</h3>
      <p style="color:var(--muted);font-size:.9rem;margin-bottom:16px">Upload dit materiale (eller brug det du uploadede ved start), og AI genererer et podcast-manuskript som browser-stemmen læser op.</p>
      <div class="upload-area" id="podDrop">📄 Træk fil hertil eller klik</div>
      <input type="file" id="podFile" accept=".pdf,image/*,.txt" style="display:none"/>
      <textarea id="podText" class="ob-textarea" placeholder="Eller indsæt tekst her…" style="margin-top:8px"></textarea>
      <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
        <button class="btn primary" id="genPodcast">Generer podcast</button>
      </div>
      <div class="status" id="podStatus"></div>
      <div id="podPlayer" style="display:none">
        <div class="podcast-wave" id="podWave">
          <div class="wave-bar" style="height:40%"></div><div class="wave-bar"></div>
          <div class="wave-bar"></div><div class="wave-bar"></div>
          <div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div>
        </div>
        <div class="podcast-controls">
          <button class="btn primary" id="podPlay">▶ Afspil</button>
          <button class="btn ghost" id="podPause">⏸ Pause</button>
          <button class="btn ghost" id="podStop">⏹ Stop</button>
          <select id="podRate" style="border-radius:10px;padding:8px 10px">
            <option value="0.8">0.8×</option><option value="1" selected>1×</option>
            <option value="1.2">1.2×</option><option value="1.5">1.5×</option>
          </select>
        </div>
        <div class="podcast-text" id="podScript"></div>
      </div>
    </div>`;

  let podDrop = document.getElementById("podDrop");
  let podFileIn = document.getElementById("podFile");
  let podScript = "";
  let utterance = null;

  podDrop.addEventListener("click", () => podFileIn.click());
  podFileIn.addEventListener("change", () => {
    if (podFileIn.files[0]) { podDrop.textContent = `✅ ${podFileIn.files[0].name}`; podDrop.classList.add("has-file"); }
  });
  ["dragover","dragleave","drop"].forEach(ev => podDrop.addEventListener(ev, e => {
    e.preventDefault();
    if (ev === "dragover") podDrop.classList.add("over");
    else if (ev === "dragleave") podDrop.classList.remove("over");
    else { podDrop.classList.remove("over"); if (e.dataTransfer.files[0]) { podFileIn.files = e.dataTransfer.files; podDrop.textContent = `✅ ${e.dataTransfer.files[0].name}`; podDrop.classList.add("has-file"); } }
  }));

  document.getElementById("genPodcast").addEventListener("click", async () => {
    const st = document.getElementById("podStatus");
    const file = podFileIn.files[0] || window._pendingFile;
    const txt = document.getElementById("podText").value.trim();
    if (!file && !txt && !state.material) { st.textContent = "Upload en fil eller indsæt tekst."; st.className = "status err"; return; }
    st.innerHTML = `<div class="pbar"><div class="pbar-fill"></div></div>Genererer manuskript…`;
    const form = new FormData();
    if (file) form.append("file", file);
    else if (txt) form.append("text", txt);
    else if (state.material?.type === "text") form.append("text", state.material.content);
    form.append("mode", "podcast");

    try {
      const r = await fetch("/api/pdf", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error);
      podScript = d.text;
      document.getElementById("podScript").textContent = podScript;
      document.getElementById("podPlayer").style.display = "block";
      st.textContent = "✅ Manuskript klar — tryk Afspil";
      st.className = "status ok";
    } catch(e) { st.textContent = "⚠️ " + e.message; st.className = "status err"; }
  });

  // TTS controls
  document.getElementById("podPlay").addEventListener("click", () => {
    if (!podScript) return;
    speechSynthesis.cancel();
    utterance = new SpeechSynthesisUtterance(podScript);
    utterance.lang = "da-DK"; utterance.rate = parseFloat(document.getElementById("podRate").value);
    utterance.onend = () => document.getElementById("podWave").classList.add("paused");
    speechSynthesis.speak(utterance);
    document.getElementById("podWave").classList.remove("paused");
  });
  document.getElementById("podPause").addEventListener("click", () => {
    speechSynthesis.paused ? speechSynthesis.resume() : speechSynthesis.pause();
    document.getElementById("podWave").classList.toggle("paused");
  });
  document.getElementById("podStop").addEventListener("click", () => {
    speechSynthesis.cancel();
    document.getElementById("podWave").classList.add("paused");
  });
}

// ── Smart tekst ──────────────────────────────────────────
function renderSmartTekst(el) {
  el.innerHTML = `
    <div class="card">
      <h4 style="margin-bottom:14px">📖 Kernebegreber i fysik</h4>
      <div id="stTopicSel" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px"></div>
      <div id="stContent" style="color:var(--muted);line-height:1.7"></div>
    </div>`;
  const texts = {
    mekanik: `<b>Mekanik & bevægelse</b><br>Newtons love danner grundlaget. 1. lov: et legeme i hvile forbliver i hvile (inerti). 2. lov: <b>F = m · a</b> — kraften er massen gange accelerationen. 3. lov: aktion = reaktion.<br><br>Ved frit fald: <b>h = ½ · g · t²</b> og <b>v = g · t</b> med g ≈ 9,82 m/s².`,
    energi: `<b>Energi, arbejde & effekt</b><br>Kinetisk energi: <b>E_kin = ½ · m · v²</b>. Potentiel energi: <b>E_pot = m · g · h</b>. Energibevarelse: summen er konstant i lukkede systemer. Effekt: <b>P = W / t</b> i watt.`,
    el: `<b>Elektricitet</b><br>Ohms lov: <b>U = R · I</b>. Elektrisk effekt: <b>P = U · I</b>. Serie: R_total = R₁ + R₂. Parallel: 1/R_total = 1/R₁ + 1/R₂. Ladning måles i coulomb, strøm i ampere.`,
    termodynamik: `<b>Termodynamik</b><br>Varmeenergi: <b>Q = m · c · ΔT</b>. For vand er c ≈ 4186 J/(kg·K). 1. hovedsætning: ΔU = Q − W (energibevarelse). Kelvin: T(K) = T(°C) + 273,15.`,
    boelger: `<b>Bølger & optik</b><br>Bølgeligning: <b>v = f · λ</b>. Periode: <b>T = 1 / f</b>. Lysets fart: c ≈ 3,0 · 10⁸ m/s. Lydbølger er longitudinale, lys er transversale elektromagnetiske bølger.`,
    moderne: `<b>Moderne fysik</b><br>Fotonenergi: <b>E = h · f</b> (Plancks konstant h = 6,63 · 10⁻³⁴ J·s). Massetal A = Z + N. Halveringstid: tid til halvdelen henfalder. Einsteins: E = m · c².`,
  };
  const topicSel = document.getElementById("stTopicSel");
  TOPICS.forEach(t => {
    const c = document.createElement("div"); c.className = "chip"; c.textContent = t.name;
    c.addEventListener("click", () => { document.getElementById("stContent").innerHTML = texts[t.id] || "Indhold ikke tilgængeligt."; });
    topicSel.appendChild(c);
  });
  document.getElementById("stContent").innerHTML = texts["mekanik"];
}

// ── Videnhuller ──────────────────────────────────────────
function renderVidenhuller(el) {
  el.innerHTML = `
    <div class="card">
      <h4 style="margin-bottom:10px">🕳️ Find dine videnhuller</h4>
      <p style="color:var(--muted);font-size:.9rem;margin-bottom:14px">Upload materiale for AI-analyse, eller brug den faste opgavebank.</p>
      <div class="upload-area" id="vhDrop">📄 Upload materiale (valgfrit)</div>
      <input type="file" id="vhFile" accept=".pdf,image/*,.txt" style="display:none"/>
      <div style="display:flex;gap:10px;margin-top:12px">
        <button class="btn primary" id="vhStart">Find mine videnhuller</button>
      </div>
      <div class="status" id="vhStatus"></div>
      <div id="vhOut"></div>
    </div>`;
  const drop = document.getElementById("vhDrop"), fi = document.getElementById("vhFile");
  drop.addEventListener("click", () => fi.click());
  fi.addEventListener("change", () => { if (fi.files[0]) { drop.textContent = `✅ ${fi.files[0].name}`; drop.classList.add("has-file"); } });

  document.getElementById("vhStart").addEventListener("click", async () => {
    const st = document.getElementById("vhStatus"), out = document.getElementById("vhOut");
    const file = fi.files[0] || window._pendingFile;
    if (file) {
      st.innerHTML = `<div class="pbar"><div class="pbar-fill"></div></div>Analyserer…`;
      const form = new FormData();
      form.append("file", file); form.append("mode", "gaps"); form.append("count", "8");
      try {
        const r = await fetch("/api/pdf", { method: "POST", body: form });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.error);
        st.textContent = `✅ ${d.items.length} videnhuller fundet`;
        renderGapsOut(out, d.items);
      } catch(e) { st.textContent = "⚠️ " + e.message; st.className = "status err"; }
    } else {
      // Brug fast gaps-bank
      const gaps = [
        {sentence:"Newtons 2. lov: F = ___ · a", answer:"m", hint:"Hvad måles i kg?"},
        {sentence:"Kinetisk energi: E = ½ · ___ · v²", answer:"m", hint:"Massen"},
        {sentence:"Ohms lov: U = R · ___", answer:"I", hint:"Strøm i ampere"},
        {sentence:"Bølgeligning: v = f · ___", answer:"λ", hint:"Bølgelængden (lambda)"},
        {sentence:"Varmeenergi: Q = m · c · ___", answer:"ΔT", hint:"Temperaturændring"},
      ];
      st.textContent = ""; renderGapsOut(out, gaps);
    }
  });
}
function renderGapsOut(out, items) {
  let idx = 0;
  function showGap() {
    if (idx >= items.length) { out.innerHTML = `<div class="card" style="text-align:center;padding:24px"><b>✅ Alle huller lukkede!</b></div>`; return; }
    const g = items[idx];
    out.innerHTML = `
      <div class="gap-card">
        <div class="q-progress">Videnhul ${idx+1} af ${items.length}</div>
        <div class="gap-sent">${g.sentence.replace("___","<b style='color:var(--accent)'>___</b>")}</div>
        <p class="gap-hint">💡 Hint: ${g.hint || "Tænk over sammenhængen"}</p>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <input class="gap-inp" type="text" id="gapInp" placeholder="Dit svar…"/>
          <button class="btn primary" id="gapCheck">Tjek</button>
        </div>
        <div class="status" id="gapSt"></div>
        <button class="btn ghost" id="gapNext" style="display:none;margin-top:10px">Næste →</button>
      </div>`;
    document.getElementById("gapCheck").addEventListener("click", () => {
      const ans = document.getElementById("gapInp").value.trim().toLowerCase();
      const correct = g.answer.toLowerCase();
      const st = document.getElementById("gapSt");
      const ok = ans === correct || ans.includes(correct) || correct.includes(ans);
      st.textContent = ok ? `✅ Korrekt! Svaret er "${g.answer}"` : `❌ Ikke helt. Svaret er "${g.answer}"`;
      st.className = ok ? "status ok" : "status err";
      addProgress(ok);
      document.getElementById("gapNext").style.display = "inline-block";
    });
    document.getElementById("gapNext").addEventListener("click", () => { idx++; showGap(); });
    document.getElementById("gapInp").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("gapCheck").click(); });
  }
  showGap();
}

// ── Chat ─────────────────────────────────────────────────
function renderChat(el, mode = "tutor", context = "") {
  const chatId = "chat_" + Date.now();
  el.insertAdjacentHTML("beforeend", `
    <div class="chat-wrap" id="${chatId}">
      <div class="chat-msgs" id="msgs_${chatId}"></div>
      <div class="chat-input-row">
        <input type="text" id="inp_${chatId}" placeholder="${mode==="oral"?"Fortæl hvad du ved…":"Stil et spørgsmål…"}"/>
        <button class="btn primary" id="send_${chatId}">Send</button>
      </div>
    </div>`);

  const msgs = document.getElementById("msgs_" + chatId);
  const inp  = document.getElementById("inp_" + chatId);
  const sendBtn = document.getElementById("send_" + chatId);
  const history = [];

  function addBubble(text, who) {
    const b = document.createElement("div"); b.className = "bubble " + who; b.textContent = text;
    msgs.appendChild(b); msgs.scrollTop = msgs.scrollHeight;
    return b;
  }

  if (mode === "tutor") addBubble("Hej! Jeg er din fysik-tutor. Hvad vil du lære om?", "bot");
  if (mode === "oral") addBubble("Klar til din forklaring! Send den når du er parat.", "bot");

  async function send() {
    const msg = inp.value.trim(); if (!msg) return;
    inp.value = ""; addBubble(msg, "user");
    history.push({ role: "user", content: msg });
    const thinking = addBubble("…", "bot");

    try {
      const r = await fetch("/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ messages: history, mode, context }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      thinking.textContent = d.reply;
      history.push({ role:"assistant", content:d.reply });
    } catch(e) { thinking.textContent = "⚠️ " + e.message; }
  }

  sendBtn.addEventListener("click", send);
  inp.addEventListener("keydown", e => { if (e.key === "Enter") send(); });
}

// ═══════════════════════════════════════════════════════
//  ØV DIG
// ═══════════════════════════════════════════════════════
document.querySelectorAll("#view-oev .mode-card").forEach(c => {
  c.addEventListener("click", () => {
    document.querySelectorAll("#view-oev .mode-card").forEach(x => x.classList.remove("active-card"));
    c.classList.add("active-card");
    oevMode(c.dataset.mode);
  });
});
function oevMode(mode) {
  const el = document.getElementById("oevContent"); el.innerHTML = "";
  if (mode === "quiz") renderQuizSetup(el, false);
  else if (mode === "sandtfalsk") renderSandtFalsk(el);
  else if (mode === "flash") renderFlashSetup(el);
  else if (mode === "gentagelse") renderGentagelse(el);
  else if (mode === "gaps") renderVidenhuller(el);
}

// ── Quiz ─────────────────────────────────────────────────
function renderQuizSetup(el, examMode = false, overrideItems = null) {
  if (overrideItems) { startQuiz(el, overrideItems, examMode); return; }
  el.innerHTML = `
    <div class="card setup" style="margin-bottom:18px">
      <div class="field"><label>Emne</label>
        <select id="qTopic"><option value="alle">Alle emner</option>${TOPICS.map(t=>`<option value="${t.id}">${t.name}</option>`).join("")}</select>
      </div>
      <div class="field"><label>Niveau</label>
        <select id="qLevel"><option value="alle">Alle</option><option value="let">Let</option><option value="mellem">Mellem</option><option value="svaer">Svær</option></select>
      </div>
      <div class="field"><label>Antal</label>
        <select id="qCount"><option>5</option><option selected>10</option><option>15</option><option>20</option></select>
      </div>
      <button class="btn primary" id="qStart">Start quiz</button>
    </div>
    <div class="card setup" style="margin-bottom:18px">
      <div style="flex:1">
        <p style="font-size:.9rem;color:var(--muted);margin-bottom:10px">Eller upload dit materiale for AI-genererede spørgsmål:</p>
        <div class="upload-area" id="qDrop" style="margin-bottom:8px">📄 Upload PDF/billede/tekst</div>
        <input type="file" id="qFile" accept=".pdf,image/*,.txt" style="display:none"/>
        <button class="btn ghost" id="qAiStart" style="margin-top:6px">Generer fra materiale</button>
      </div>
    </div>
    <div class="status" id="qStatus"></div>
    <div id="qArea"></div>`;

  document.getElementById("qStart").addEventListener("click", async () => {
    const t = document.getElementById("qTopic").value;
    const l = document.getElementById("qLevel").value;
    const n = document.getElementById("qCount").value;
    const st = document.getElementById("qStatus");
    st.innerHTML = `<div class="pbar"><div class="pbar-fill"></div></div>`;
    const items = await (await fetch(`/api/questions?topic=${t}&level=${l}&count=${n}`)).json();
    st.textContent = "";
    startQuiz(document.getElementById("qArea"), items, examMode);
  });

  const qDrop = document.getElementById("qDrop"), qFile = document.getElementById("qFile");
  qDrop.addEventListener("click", () => qFile.click());
  qFile.addEventListener("change", () => { if (qFile.files[0]) { qDrop.textContent = `✅ ${qFile.files[0].name}`; qDrop.classList.add("has-file"); } });
  document.getElementById("qAiStart").addEventListener("click", async () => {
    const file = qFile.files[0];
    const st = document.getElementById("qStatus");
    if (!file) { st.textContent = "Upload en fil først."; st.className = "status err"; return; }
    st.innerHTML = `<div class="pbar"><div class="pbar-fill"></div></div>AI genererer spørgsmål…`;
    const form = new FormData();
    form.append("file", file); form.append("mode", "quiz"); form.append("count", "10");
    try {
      const r = await fetch("/api/pdf", { method:"POST", body:form });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error);
      st.textContent = `✅ ${d.items.length} spørgsmål klar!`;
      startQuiz(document.getElementById("qArea"), d.items, examMode);
    } catch(e) { st.textContent = "⚠️ " + e.message; st.className = "status err"; }
  });
}

function startQuiz(container, items, examMode = false) {
  let idx = 0, correct = 0;
  function showQ() {
    const q = items[idx];
    const tName = (TOPICS.find(t => t.id === q.topic) || {}).name || (q.topic || "Fra noter");
    container.innerHTML = `
      <div class="q-progress">Spørgsmål ${idx+1} af ${items.length} · ${correct} rigtige${examMode?" · ⏱ Eksamensmodus":""}</div>
      <div class="q-card">
        <div class="q-topic">${tName} · ${q.level||"–"}</div>
        <div class="q-text">${q.question}</div>
        <div class="opts">${q.options.map(o=>`<button class="opt">${o}</button>`).join("")}</div>
        <div id="afterQ"></div>
      </div>`;
    container.querySelectorAll(".opt").forEach(btn => btn.addEventListener("click", () => answerQ(btn, q)));
  }
  function answerQ(btn, q) {
    const opts = container.querySelectorAll(".opt");
    const ok = btn.textContent === q.answer;
    opts.forEach(o => { o.disabled = true; if (o.textContent === q.answer) o.classList.add("correct"); else if (o === btn && !ok) o.classList.add("wrong"); });
    if (ok) correct++; addProgress(ok);
    const last = idx === items.length - 1;
    if (!examMode) {
      document.getElementById("afterQ").innerHTML = `
        <div class="explain"><b>${ok?"✅ Rigtigt!":"❌ Ikke helt."}</b> ${q.explain||""}</div>
        <div class="q-next"><button class="btn primary" id="nextQ">${last?"Se resultat":"Næste →"}</button></div>`;
    } else {
      document.getElementById("afterQ").innerHTML = `<div class="q-next"><button class="btn primary" id="nextQ">${last?"Se resultat":"Næste →"}</button></div>`;
    }
    document.getElementById("nextQ").addEventListener("click", () => { if (last) showResult(); else { idx++; showQ(); } });
  }
  function showResult() {
    const pct = Math.round(correct / items.length * 100);
    const grade = pct>=93?12:pct>=81?10:pct>=69?7:pct>=55?4:pct>=40?2:-3;
    const msg = pct>=80?"Stærkt! Du er godt forberedt.":pct>=55?"Pænt — kør en runde til.":"Gå flashcards igennem og prøv igen.";
    container.innerHTML = `
      <div class="card quiz-result">
        <div class="score">${correct}/${items.length}</div>
        <p style="color:var(--muted);margin:8px 0">${pct}% rigtige. ${msg}</p>
        ${examMode?`<div class="grade-badge">${grade>0?"+":""} ${grade}</div><p style="color:var(--muted);font-size:.85rem">Estimeret dansk karakter (7-trinsskala)</p>`:""}
        <div style="display:flex;gap:10px;justify-content:center;margin-top:18px">
          <button class="btn primary" id="qAgain">Ny quiz (nye spørgsmål)</button>
        </div>
      </div>`;
    document.getElementById("qAgain").addEventListener("click", () => { idx=0; correct=0; showQ(); });
  }
  showQ();
}

// ── Sandt/Falsk ──────────────────────────────────────────
const sfBank = [
  {stmt:"Newtons 2. lov siger: F = m · a",ans:true,explain:"Ja — kraft = masse × acceleration."},
  {stmt:"Potential energi afhænger af legemets fart",ans:false,explain:"Nej — potentiel energi afhænger af højde: E_pot = m·g·h. Farten giver kinetisk energi."},
  {stmt:"Ohms lov: U = R · I",ans:true,explain:"Korrekt. Spænding = modstand × strøm."},
  {stmt:"Bølgelængden stiger, når frekvensen stiger (ved konstant fart)",ans:false,explain:"Nej — v = f·λ, så ved konstant v falder λ når f stiger."},
  {stmt:"Kelvin-skalaen starter ved −273,15 °C",ans:true,explain:"Rigtigt. 0 K = absolutte nulpunkt = −273,15 °C."},
  {stmt:"Alfapartikler er elektroner",ans:false,explain:"Nej — alfapartikler er heliumkerner (2 protoner + 2 neutroner)."},
  {stmt:"Effekt måles i watt",ans:true,explain:"Ja. 1 W = 1 J/s."},
  {stmt:"I en seriekobling af modstande er strømmen den samme overalt",ans:true,explain:"Korrekt. Strømmen er konstant i serie; spændingen fordeles."},
  {stmt:"Lysets fart i vakuum er ca. 300.000 km/s",ans:true,explain:"Ja — c ≈ 3,0·10⁸ m/s = 300.000 km/s."},
  {stmt:"Energi kan skabes ud af ingenting",ans:false,explain:"Nej — energibevarelse: energi kan hverken opstå eller forsvinde."},
];
function renderSandtFalsk(el) {
  const shuffled = [...sfBank].sort(() => Math.random() - .5);
  let idx = 0, correct = 0;
  function show() {
    const item = shuffled[idx];
    el.innerHTML = `
      <div class="q-progress">Påstand ${idx+1} af ${shuffled.length} · ${correct} rigtige</div>
      <div class="sf-card">
        <div class="sf-stmt">${item.stmt}</div>
        <div class="sf-btns">
          <button class="sf-btn t">✅ Sandt</button>
          <button class="sf-btn f">❌ Falsk</button>
        </div>
        <div class="explain" id="sfEx" style="display:none"></div>
        <div class="q-next" id="sfNext" style="display:none"><button class="btn primary" id="sfNextBtn">${idx===shuffled.length-1?"Se resultat":"Næste →"}</button></div>
      </div>`;
    el.querySelectorAll(".sf-btn").forEach(b => b.addEventListener("click", () => {
      const chosen = b.classList.contains("t");
      const ok = chosen === item.ans;
      if (ok) correct++; addProgress(ok);
      const ex = document.getElementById("sfEx");
      ex.innerHTML = `<b>${ok?"✅ Rigtigt!":"❌ Forkert."}</b> ${item.explain}`;
      ex.style.display = "block";
      el.querySelectorAll(".sf-btn").forEach(x => x.disabled = true);
      document.getElementById("sfNext").style.display = "flex";
    }));
    document.getElementById("sfNextBtn").addEventListener("click", () => {
      if (idx === shuffled.length-1) { el.innerHTML=`<div class="card quiz-result"><div class="score">${correct}/${shuffled.length}</div><p style="color:var(--muted);margin:10px 0">${Math.round(correct/shuffled.length*100)}% rigtige.</p><button class="btn primary" id="sfRestart">Kør igen</button></div>`; document.getElementById("sfRestart").addEventListener("click",()=>renderSandtFalsk(el)); }
      else { idx++; show(); }
    });
  }
  show();
}

// ── Flashcards ───────────────────────────────────────────
function renderFlashSetup(el) {
  el.innerHTML = `
    <div class="card setup" style="margin-bottom:18px">
      <div class="field"><label>Emne</label>
        <select id="fTopic"><option value="alle">Alle emner</option>${TOPICS.map(t=>`<option value="${t.id}">${t.name}</option>`).join("")}</select>
      </div>
      <button class="btn primary" id="fLoad">Hent kort</button>
    </div>
    <div class="card setup" style="margin-bottom:18px">
      <div style="flex:1">
        <p style="font-size:.9rem;color:var(--muted);margin-bottom:10px">AI-flashcards fra dit materiale:</p>
        <div class="upload-area" id="fDrop">📄 Upload fil</div>
        <input type="file" id="fFile" accept=".pdf,image/*,.txt" style="display:none"/>
        <button class="btn ghost" id="fAiLoad" style="margin-top:8px">Generer fra materiale</button>
      </div>
    </div>
    <div class="status" id="fStatus"></div>
    <div id="fArea" class="flash-grid"></div>`;

  document.getElementById("fLoad").addEventListener("click", async () => {
    const t = document.getElementById("fTopic").value;
    const cards = await (await fetch(`/api/flashcards?topic=${t}`)).json();
    renderFlashCards(document.getElementById("fArea"), cards);
  });

  const fDrop = document.getElementById("fDrop"), fFile = document.getElementById("fFile");
  fDrop.addEventListener("click", () => fFile.click());
  fFile.addEventListener("change", () => { if (fFile.files[0]) { fDrop.textContent = `✅ ${fFile.files[0].name}`; fDrop.classList.add("has-file"); } });
  document.getElementById("fAiLoad").addEventListener("click", async () => {
    const file = fFile.files[0];
    const st = document.getElementById("fStatus");
    if (!file) { st.textContent = "Upload en fil."; st.className="status err"; return; }
    st.innerHTML = `<div class="pbar"><div class="pbar-fill"></div></div>Genererer flashcards…`;
    const form = new FormData();
    form.append("file", file); form.append("mode", "flash"); form.append("count", "12");
    try {
      const r = await fetch("/api/pdf", {method:"POST",body:form});
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error);
      st.textContent = `✅ ${d.items.length} flashcards klar!`;
      renderFlashCards(document.getElementById("fArea"), d.items);
    } catch(e) { st.textContent = "⚠️ " + e.message; st.className="status err"; }
  });
}
function renderFlashCards(area, cards) {
  area.innerHTML = "";
  cards.forEach(c => {
    const el = document.createElement("div"); el.className = "fcard";
    const topic = (TOPICS.find(t => t.id === c.topic) || {}).name || "Fra noter";
    el.innerHTML = `
      <div class="fcard-inner">
        <div class="fcard-face fcard-front">
          <div class="ft">${topic}</div><h4>${c.front}</h4>
          <div class="fcard-hint">Tryk for at vende →</div>
        </div>
        <div class="fcard-face fcard-back">${c.back}</div>
      </div>`;
    el.addEventListener("click", () => el.classList.toggle("flip"));
    area.appendChild(el);
  });
}

// ── Gentagelse (Spaced Repetition) ───────────────────────
function renderGentagelse(el) {
  // Byg kort fra flashcards hvis tom
  if (!state.spaced || state.spaced.length === 0) {
    state.spaced = FLASHCARDS.map((c, i) => ({ id: i, front: c.front, back: c.back, due: 0, ease: 2.5, interval: 1 }));
    saveState();
  }
  const now = Date.now();
  const due = state.spaced.filter(c => c.due <= now);
  if (due.length === 0) {
    const next = Math.min(...state.spaced.map(c => c.due));
    const mins = Math.round((next - now) / 60000);
    el.innerHTML = `<div class="card" style="text-align:center;padding:30px"><h3 style="margin-bottom:10px">✅ Alt er repeteret!</h3><p style="color:var(--muted)">Næste kort om ${mins} minut(ter).</p></div>`;
    return;
  }
  let idx = 0; const shuffled = [...due].sort(() => Math.random() - .5);
  let revealed = false;
  function showCard() {
    if (idx >= shuffled.length) {
      el.innerHTML = `<div class="card" style="text-align:center;padding:30px"><h3>✅ Runde færdig!</h3><p style="color:var(--muted);margin:10px 0">${shuffled.length} kort repeteret.</p><button class="btn primary" id="genRestart">Ny runde</button></div>`;
      document.getElementById("genRestart").addEventListener("click", () => renderGentagelse(el));
      return;
    }
    const c = shuffled[idx]; revealed = false;
    el.innerHTML = `
      <div class="q-progress">${idx+1} af ${shuffled.length} due · ${due.length} total</div>
      <div class="gentagelse-card">
        <div class="gen-q" style="margin-bottom:24px"><b>${c.front}</b></div>
        <button class="btn ghost" id="genReveal">Vis svar</button>
        <div id="genBack" style="display:none;margin:16px 0;padding:14px;background:var(--panel2);border-radius:10px;font-size:.95rem">${c.back}</div>
        <div class="gen-btns" id="genBtns" style="display:none">
          <button class="gen-btn easy" data-q="5">Nem 😊</button>
          <button class="gen-btn ok" data-q="3">OK 🙂</button>
          <button class="gen-btn hard" data-q="1">Svær 😰</button>
        </div>
      </div>`;
    document.getElementById("genReveal").addEventListener("click", () => {
      document.getElementById("genBack").style.display = "block";
      document.getElementById("genBtns").style.display = "flex";
      document.getElementById("genReveal").style.display = "none";
    });
    document.querySelectorAll(".gen-btn").forEach(b => b.addEventListener("click", () => {
      const q = parseInt(b.dataset.q);
      const card = state.spaced.find(x => x.id === c.id);
      if (card) {
        card.ease = Math.max(1.3, card.ease + 0.1 - (5-q)*0.08);
        card.interval = q >= 4 ? Math.round(card.interval * card.ease) : q >= 2 ? 1 : 0.5;
        card.due = Date.now() + card.interval * 24 * 3600 * 1000;
        saveState();
      }
      addProgress(q >= 4);
      idx++; showCard();
    }));
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
    eksamenMode(c.dataset.mode);
  });
});
function eksamenMode(mode) {
  const el = document.getElementById("eksamenContent"); el.innerHTML = "";
  if (mode === "testsim") renderTestsim(el);
  else if (mode === "mundtlig") renderMundtlig(el);
}

// ── Testsimulering ───────────────────────────────────────
function renderTestsim(el) {
  el.innerHTML = `
    <div class="card setup" style="margin-bottom:18px">
      <div class="field"><label>Emne</label>
        <select id="tsTopic"><option value="alle">Alle emner</option>${TOPICS.map(t=>`<option value="${t.id}">${t.name}</option>`).join("")}</select>
      </div>
      <div class="field"><label>Antal</label>
        <select id="tsCount"><option>5</option><option selected>10</option><option>15</option><option>20</option></select>
      </div>
      <div class="field"><label>Tid (minutter)</label>
        <select id="tsTime"><option value="5">5</option><option value="10" selected>10</option><option value="15">15</option><option value="20">20</option><option value="0">Ingen</option></select>
      </div>
      <button class="btn primary" id="tsStart">Start eksamen</button>
    </div>
    <div id="tsArea"></div>`;

  document.getElementById("tsStart").addEventListener("click", async () => {
    const topic = document.getElementById("tsTopic").value;
    const count = document.getElementById("tsCount").value;
    const mins  = parseInt(document.getElementById("tsTime").value);
    const area  = document.getElementById("tsArea");
    area.innerHTML = `<div class="pbar"><div class="pbar-fill"></div></div>`;
    const items = await (await fetch(`/api/questions?topic=${topic}&count=${count}`)).json();

    // Timer
    let timerEl = "";
    if (mins > 0) {
      area.innerHTML = `
        <p class="timer-label" id="timerLabel">Tid: ${mins}:00</p>
        <div class="timer-bar-wrap"><div class="timer-bar" id="timerBar" style="width:100%"></div></div>
        <div id="tsQ"></div>`;
      let secs = mins * 60;
      const total = secs;
      const iv = setInterval(() => {
        secs--;
        const m = Math.floor(secs/60), s = secs%60;
        const tl = document.getElementById("timerLabel");
        const tb = document.getElementById("timerBar");
        if (tl) tl.textContent = `Tid: ${m}:${s.toString().padStart(2,"0")}`;
        if (tb) tb.style.width = (secs/total*100)+"%";
        if (secs <= 0) { clearInterval(iv); if (tl) tl.textContent = "⏱ Tid er gået!"; }
      }, 1000);
    } else {
      area.innerHTML = `<div id="tsQ"></div>`;
    }
    startQuiz(document.getElementById("tsQ") || area, items, true);
  });
}

// ── Mundtlig eksamen ──────────────────────────────────────
const explainConcepts = [
  {concept:"Kinetisk energi", prompt:"Forklar hvad kinetisk energi er og giv et konkret eksempel fra hverdagen."},
  {concept:"Ohms lov", prompt:"Forklar Ohms lov og hvad U, R og I betyder."},
  {concept:"Newtons 2. lov", prompt:"Forklar Newtons 2. lov og hvornår du ville bruge den."},
  {concept:"Bølgeligning", prompt:"Forklar sammenhængen mellem fart, frekvens og bølgelængde."},
  {concept:"Energibevarelse", prompt:"Forklar princippet om energibevarelse med et eksempel."},
  {concept:"Halveringstid", prompt:"Hvad er halveringstid, og hvad bruges det til?"},
  {concept:"Fotonenergi", prompt:"Forklar hvad en foton er, og hvordan man beregner dens energi."},
];
function renderMundtlig(el) {
  const concept = explainConcepts[Math.floor(Math.random() * explainConcepts.length)];
  el.innerHTML = `
    <div class="oral-box">
      <p class="q-topic">Mundtlig eksamen</p>
      <div class="oral-concept">${concept.concept}</div>
      <div class="oral-prompt">${concept.prompt}</div>
      <p style="color:var(--muted);font-size:.88rem;margin-bottom:16px">Skriv din forklaring nedenfor (eller brug mikrofon-knappen til tale-til-tekst):</p>
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px;margin-bottom:16px">
        <button class="mic-btn" id="micBtn" title="Klik for at optage">🎤</button>
        <p style="font-size:.78rem;color:var(--muted)" id="micLabel">Klik for at starte optagelse</p>
      </div>
      <textarea class="ob-textarea" id="oralText" placeholder="Din forklaring…" style="width:100%;min-height:100px;margin-bottom:12px"></textarea>
      <button class="btn primary" id="oralSubmit">Send til AI-bedømmelse</button>
      <div class="status" id="oralStatus"></div>
      <div class="feedback-box" id="oralFeedback" style="display:none;margin-top:14px"></div>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn ghost" id="oralNext">Nyt begreb →</button>
        <button class="btn ghost" id="oralChat">Chat om dette begreb</button>
      </div>
      <div id="oralChatWrap"></div>
    </div>`;

  // Speech recognition
  const micBtn = document.getElementById("micBtn");
  const micLabel = document.getElementById("micLabel");
  const oralText = document.getElementById("oralText");
  let recognition = null;
  let recording = false;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = "da-DK"; recognition.continuous = true; recognition.interimResults = true;
    recognition.onresult = e => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      oralText.value = transcript;
    };
    recognition.onend = () => { recording = false; micBtn.classList.remove("recording"); micLabel.textContent = "Klik for at starte optagelse"; };
    micBtn.addEventListener("click", () => {
      if (recording) { recognition.stop(); }
      else { recognition.start(); recording = true; micBtn.classList.add("recording"); micLabel.textContent = "Optager… klik for at stoppe"; }
    });
  } else {
    micBtn.style.opacity = ".4"; micLabel.textContent = "Tale-til-tekst ikke understøttet i denne browser";
  }

  document.getElementById("oralSubmit").addEventListener("click", async () => {
    const text = oralText.value.trim();
    const st = document.getElementById("oralStatus"), fb = document.getElementById("oralFeedback");
    if (!text) { st.textContent = "Skriv eller optag din forklaring først."; st.className = "status err"; return; }
    st.innerHTML = `<div class="pbar"><div class="pbar-fill"></div></div>AI bedømmer…`;

    const messages = [{ role:"user", content:`Begrebet er: "${concept.concept}". Min forklaring: "${text}"` }];
    try {
      const r = await fetch("/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ messages, mode:"oral" }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      fb.style.display = "block"; fb.innerHTML = d.reply.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>").replace(/\n/g,"<br>");
      st.textContent = "";
    } catch(e) { st.textContent = "⚠️ " + e.message; st.className = "status err"; }
  });

  document.getElementById("oralNext").addEventListener("click", () => renderMundtlig(el));
  document.getElementById("oralChat").addEventListener("click", () => {
    const wrap = document.getElementById("oralChatWrap");
    if (wrap.innerHTML) { wrap.innerHTML = ""; return; }
    renderChat(wrap, "tutor", `Begrebet er: ${concept.concept}. ${concept.prompt}`);
  });
}

// ═══════════════════════════════════════════════════════
//  PLAN
// ═══════════════════════════════════════════════════════
document.getElementById("makePlan").addEventListener("click", () => {
  const dateVal = document.getElementById("planDate").value;
  const out = document.getElementById("planOut");
  if (!dateVal) { out.innerHTML = `<div class="card"><p style="color:var(--muted)">Vælg en eksamensdato.</p></div>`; return; }
  state.examDate = dateVal; saveState();
  renderHomeCountdown(); renderDailyCard();
  const d = daysUntil(dateVal);
  if (d <= 0) { out.innerHTML = `<div class="card"><p>Vælg en dato i fremtiden.</p></div>`; return; }
  const topics = selTopics.size ? [...selTopics] : TOPICS.map(t => t.id);
  const tName = id => (TOPICS.find(t => t.id === id)||{}).name || id;
  const planDays = Math.min(d, 14);
  let html = `<p class="plan-head">Du har <b>${d} dage</b> til eksamen. Plan for de næste <b>${planDays} dage</b>:</p>`;
  for (let i = 0; i < planDays; i++) {
    const t = topics[i % topics.length];
    const date = new Date(Date.now() + i * 864e5);
    const ds = date.toLocaleDateString("da-DK", { weekday:"long", day:"numeric", month:"short" });
    let task;
    if (i === planDays-1) task = "🏁 Stor blandet quiz + flashcard-genopfriskning.";
    else if (i === planDays-2) task = `⏱ Prøveeksamen i ${tName(t)} — eksamensmodus.`;
    else if (i % 4 === 3) task = `🎤 Mundtlig gennemgang af ${tName(t)}.`;
    else if (i % 3 === 2) task = `🔁 Gentagelse (spaced repetition) + quiz i ${tName(t)}.`;
    else task = `📖 Lær ${tName(t)}: podcast + 10 spørgsmål + flashcards.`;
    html += `<div class="day"><span class="d-num">Dag ${i+1}</span><div class="d-body"><strong>${ds}</strong><span>${task}</span></div></div>`;
  }
  out.innerHTML = html;
});
