import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { getQuestions, FLASHCARDS, TOPICS } from "./data/questions.js";
import { TUTOR } from "./data/tutor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || "";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === "application/pdf"
             || file.mimetype.startsWith("image/")
             || file.mimetype === "text/plain";
    cb(null, ok);
  },
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

async function callClaude(system, userContent) {
  if (!API_KEY) throw new Error("ANTHROPIC_API_KEY er ikke sat på serveren.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`API ${res.status}: ${e.slice(0, 200)}`); }
  const data = await res.json();
  return data.content.map(b => b.type === "text" ? b.text : "").join("");
}

async function callClaudeChat(system, messages) {
  if (!API_KEY) throw new Error("ANTHROPIC_API_KEY er ikke sat på serveren.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data.content.map(b => b.type === "text" ? b.text : "").join("");
}

// ── PDF / materiale → quiz, flashcards, podcast, gaps ──
app.post("/api/pdf", upload.single("file"), async (req, res) => {
  const { mode = "quiz", count = "10" } = req.body;
  const n = Math.min(parseInt(count, 10), 20);

  let fileBlock;
  if (req.file) {
    const b64 = req.file.buffer.toString("base64");
    if (req.file.mimetype === "application/pdf") {
      fileBlock = { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } };
    } else if (req.file.mimetype.startsWith("image/")) {
      fileBlock = { type: "image", source: { type: "base64", media_type: req.file.mimetype, data: b64 } };
    } else {
      fileBlock = { type: "text", text: req.file.buffer.toString("utf-8") };
    }
  } else if (req.body.text) {
    fileBlock = { type: "text", text: req.body.text.slice(0, 8000) };
  } else {
    return res.status(400).json({ error: "Ingen fil eller tekst modtaget." });
  }

  const systems = {
    quiz: `Du er eksamenscoach. Lav ${n} multiple choice-spørgsmål fra materialet.
Regler: 4 svarmuligheder, kun 1 korrekt, inkludér forklaring, variér sværhedsgrad (let/mellem/svaer).
Svar KUN med JSON-array, ingen markdown:
[{"question":"...","options":["A","B","C","D"],"answer":"A","explain":"...","level":"let"}]`,

    flash: `Du er eksamenscoach. Lav ${n} flashcards fra materialet.
Svar KUN med JSON-array, ingen markdown:
[{"front":"Begreb/formel","back":"Kort forklaring, max 2 sætninger."}]`,

    podcast: `Du er en karismatisk dansk fysik-lærer der laver en podcast til gymnasieelever.

Lav et manuskript der LYDER NATURLIGT når det læses op af en computer-stemme.

Regler for naturlig tale-rytme:
- Skriv i korte, mundtlige sætninger. Maksimalt 15 ord per sætning.
- Brug naturlige pauser ved at slutte sætninger med punktum. Ingen lange sætninger med mange kommaer.
- Sig "For eksempel..." og "Tænk på..." og "Forestil dig..." for at guide lytteren.
- Brug tal og formler som ord: skriv "m gange a" ikke "m·a". Skriv "halvt m v i anden" ikke "½mv²".
- Undgå specialtegn: ingen ·, ², ½, Δ, Ω — skriv dem som ord.
- Tal direkte til lytteren med "du" og "dig".
- Vær entusiastisk men naturlig — som en lærer der virkelig synes det er fedt.
- Længde: 350-450 ord. Ikke mere.
- Start med en fængende åbning. Slut med en opmuntrende sætning.

Svar KUN med den rå tale-tekst. Ingen overskrifter, ingen markdown, ingen instruktioner.`,

    gaps: `Du er eksamenscoach. Find 5-8 vigtige begreber og lav "udfyld-hullet"-sætninger.
Svar KUN med JSON-array, ingen markdown:
[{"sentence":"F = ___ gange a","answer":"m","hint":"Hvad måles i kg?"}]`,
  };

  try {
    const system = systems[mode] || systems.quiz;
    const raw = await callClaude(system, [
      fileBlock,
      { type: "text", text: `Analyser materialet og lav outputtet som beskrevet (mode=${mode}).` },
    ]);
    if (mode === "podcast") return res.json({ ok: true, text: raw });
    const clean = raw.replace(/```json|```/gi, "").trim();
    res.json({ ok: true, items: JSON.parse(clean) });
  } catch (e) {
    console.error("PDF fejl:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── AI Chat ──────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages, mode = "tutor", context = "" } = req.body;

  const systems = {
    tutor: `Du er AI Allan — en passioneret og jordnær fysik-tutor der hjælper danske gymnasieelever med at forstå fysik.

Din personlighed:
- Varm, tålmodig og entusiastisk. Du elsker fysik og det smitter.
- Du forklarer som en klog ven, ikke som en lærebog.
- Du bruger hverdagseksempler: cykler, køleskabe, smartphones, fodbold.
- Du stiller gerne et enkelt opklarende spørgsmål hvis noget er uklart.
- Du roser fremskridt og normaliserer forvirring ("Det her forvirrer mange — godt du spørger!").
- Du bruger aldrig unødvendig faglig jargon uden at forklare den.

Sådan svarer du:
- Svar ALTID på dansk.
- Hold svar korte og konkrete — 2-4 afsnit maksimalt.
- Brug gerne et regneeksempel med tal for at gøre det konkret.
- Inkludér formlen, men forklar hvad hvert led betyder.
- Slut gerne med et lille spørgsmål der inviterer til dialog, men KUN hvis det er naturligt.
- Brug ikke bullet points — skriv som du taler.

${context ? `Eleven har uploadet materiale om:\n${context}\nBrug dette som udgangspunkt når det er relevant.\n` : ""}`,

    oral: `Du er en erfaren mundtlig eksaminator i fysik ved en dansk gymnasium.

En elev skal forklare et fysikbegreb med egne ord. Dit job:
1. Lyt til forklaringen — hvad forstod eleven, hvad manglede?
2. Giv konkret, konstruktiv feedback (ikke bare "godt forsøgt").
3. Peg på hvad der var stærkt, og hvad der skal præciseres.
4. Giv en karakter på 7-trinsskalen: -3, 00, 02, 4, 7, 10, 12.

Karakterskala (brug den korrekt):
12 = fremragende, dækker alt inkl. nuancer
10 = fortrinlig, mangler kun småting  
7 = god, kerneidéen er der men detaljer mangler
4 = jævn, forståelse men væsentlige huller
02 = tilstrækkelig, lige bestået
00 = utilstrækkelig
-3 = ingen reel forståelse vist

Svar på dansk. Vær opmuntrende men ærlig — det hjælper eleven mere end tom ros.
Brug præcis dette format:
**Hvad du ramte rigtigt:** [konkret]
**Hvad du kan tilføje:** [konkret]  
**Karakter:** [tal] — [én sætning begrundelse]`,
  };

  try {
    const reply = await callClaudeChat(systems[mode] || systems.tutor, messages.slice(-12));
    res.json({ reply });
  } catch (e) {
    console.error("Chat fejl:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Standard endpoints ───────────────────────────────────
app.get("/api/topics", (_req, res) => res.json(TOPICS));

app.get("/api/questions", (req, res) => {
  const { topic = "alle", level = "alle", count = "10" } = req.query;
  res.json(getQuestions({ topic, level, count: Math.min(parseInt(count, 10), 30) }));
});

app.get("/api/flashcards", (req, res) => {
  const { topic = "alle" } = req.query;
  res.json(topic === "alle" ? FLASHCARDS : FLASHCARDS.filter(c => c.topic === topic));
});

// Regelbaseret fallback (ingen API-nøgle)
app.post("/api/tutor", (req, res) => {
  const msg = (req.body.message || "").toLowerCase();
  let best = null, bs = 0;
  for (const e of TUTOR) {
    const s = e.keys.reduce((a, k) => msg.includes(k) ? a + 1 : a, 0);
    if (s > bs) { bs = s; best = e; }
  }
  res.json({ reply: best && bs > 0 ? best.answer : "Prøv at spørge om et fysikemne, fx \"forklar Ohms lov\" eller \"hvad er kinetisk energi\"." });
});

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, aiReady: !!API_KEY }));

app.get("*", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`FysikEksamen kører på port ${PORT}`);
  console.log(`AI aktiv: ${API_KEY ? "✅ JA" : "❌ NEJ – sæt ANTHROPIC_API_KEY"}`);
});
