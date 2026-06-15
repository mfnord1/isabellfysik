import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { getQuestions, FLASHCARDS, TOPICS } from "./data/questions.js";
import { TUTOR } from "./data/tutor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// API-nøgle KUN fra miljøvariabel — aldrig fra klienten
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

// ── Anthropic API-kald (nøgle kun server-side) ──────────
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
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1024, system, messages }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data.content.map(b => b.type === "text" ? b.text : "").join("");
}

// ── Endpoint: PDF/billede/tekst → quiz / flashcards / podcast / gaps ──
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

    podcast: `Du er en engageret fysik-underviser. Lav et dansk podcast-manuskript om indholdet.
400-600 ord, tal direkte til lytteren med "du", forklar tydeligt, brug eksempler, kort intro og outro.
Svar KUN med rå tekst (ingen JSON, ingen markdown).`,

    gaps: `Du er eksamenscoach. Find 5-8 vigtige begreber og lav "udfyld-hullet"-sætninger.
Svar KUN med JSON-array, ingen markdown:
[{"sentence":"F = ___ · a","answer":"m","hint":"Hvad måles i kg?"}]`,
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

// ── Endpoint: AI Chat (tutor + mundtlig eksamen) ────────
app.post("/api/chat", async (req, res) => {
  const { messages, mode = "tutor", context = "" } = req.body;

  const systems = {
    tutor: `Du er en venlig og tydelig fysik-tutor der hjælper gymnasie- og universitetsstuderende.
Svar på dansk, kortfattet (max 3 afsnit), brug konkrete eksempler. Inkludér formler når relevant.
${context ? `Kontekst fra brugerens materiale:\n${context}` : ""}`,

    oral: `Du er eksaminator ved en mundtlig fysikeksamen.
Eleven forklarer et begreb med egne ord. Giv konstruktiv feedback (hvad var godt, hvad manglede) og en karakter 1-7.
Svar på dansk. Vær opmuntrende men ærlig.
Format:
**Feedback:** [din feedback]
**Karakter:** [tal] — [kort begrundelse]`,
  };

  try {
    const reply = await callClaudeChat(systems[mode] || systems.tutor, messages.slice(-10));
    res.json({ reply });
  } catch (e) {
    console.error("Chat fejl:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Eksisterende endpoints ───────────────────────────────
app.get("/api/topics", (_req, res) => res.json(TOPICS));

app.get("/api/questions", (req, res) => {
  const { topic = "alle", level = "alle", count = "10" } = req.query;
  res.json(getQuestions({ topic, level, count: Math.min(parseInt(count, 10), 30) }));
});

app.get("/api/flashcards", (req, res) => {
  const { topic = "alle" } = req.query;
  res.json(topic === "alle" ? FLASHCARDS : FLASHCARDS.filter(c => c.topic === topic));
});

// Regelbaseret tutor-fallback (bruges hvis AI ikke svarer)
app.post("/api/tutor", (req, res) => {
  const msg = (req.body.message || "").toLowerCase();
  let best = null, bs = 0;
  for (const e of TUTOR) {
    const s = e.keys.reduce((a, k) => msg.includes(k) ? a + 1 : a, 0);
    if (s > bs) { bs = s; best = e; }
  }
  res.json({ reply: best && bs > 0 ? best.answer : "Prøv at spørge om et fysikemne, fx \"forklar Ohms lov\" eller \"hvad er kinetisk energi\"." });
});

// ── Health check (Railway bruger denne) ─────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, aiReady: !!API_KEY });
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => {
  console.log(`Fysik-eksamen kører på port ${PORT}`);
  console.log(`AI aktiv: ${API_KEY ? "✅ JA" : "❌ NEJ – sæt ANTHROPIC_API_KEY"}`);
});
