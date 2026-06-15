import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { getQuestions, FLASHCARDS, TOPICS } from "./data/questions.js";
import { TUTOR } from "./data/tutor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === "application/pdf" || file.mimetype.startsWith("image/") || file.mimetype === "text/plain";
    cb(null, ok);
  },
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

async function callClaude(system, userContent, apiKey) {
  if (!apiKey) throw new Error("Ingen API-nøgle angivet.");
  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: userContent }],
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`API ${res.status}: ${e.slice(0,200)}`); }
  const data = await res.json();
  return data.content.map(b => b.type === "text" ? b.text : "").join("");
}

// ── PDF analyse (quiz, flashcards, podcast-script, videnhuller) ──
app.post("/api/pdf", upload.single("file"), async (req, res) => {
  const { mode = "quiz", count = "10", apiKey } = req.body;
  const key = apiKey || process.env.ANTHROPIC_API_KEY || "";
  if (!key) return res.status(400).json({ error: "Ingen API-nøgle." });

  const n = Math.min(parseInt(count, 10), 20);

  // Byg file-content blok
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
    return res.status(400).json({ error: "Ingen fil eller tekst." });
  }

  const systems = {
    quiz: `Du er eksamenscoach. Lav ${n} multiple choice-spørgsmål fra materialet.
Regler: 4 svarmuligheder, kun 1 korrekt, inkludér forklaring, variér sværhedsgrad (let/mellem/svaer).
Svar KUN med JSON-array, ingen markdown:
[{"question":"...","options":["A","B","C","D"],"answer":"A","explain":"...","level":"let"}]`,

    flash: `Du er eksamenscoach. Lav ${n} flashcards fra materialet.
Svar KUN med JSON-array, ingen markdown:
[{"front":"Begreb/formel","back":"Kort forklaring, max 2 sætninger."}]`,

    podcast: `Du er en engageret fysik-underviser. Lav et podcast-manuskript på dansk om indholdet i materialet.
Manuskriptet skal: være 400-600 ord, tale direkte til lytteren (brug "du"), forklare kernebegreberne tydeligt, bruge konkrete eksempler, have en kort intro og outro.
Svar KUN med den rå tekst (ingen JSON, ingen overskrifter, ingen markdown).`,

    gaps: `Du er eksamenscoach. Analyser materialet og find de 5-8 vigtigste begreber/formler.
For hvert begreb lav en "udfyld-hullet"-sætning hvor kerneinformationen er erstattet med ___.
Svar KUN med JSON-array, ingen markdown:
[{"sentence":"Newtons 2. lov siger at F = ___ · a","answer":"m","hint":"Hvad er enheden kg?"}]`,

    explain: `Du er eksamenscoach. Lav ${n} "forklar-med-dine-egne-ord"-opgaver fra materialet.
Hvert emne skal eleven forklare mundtligt. Du giver også en model-forklaring.
Svar KUN med JSON-array, ingen markdown:
[{"concept":"Kinetisk energi","prompt":"Forklar hvad kinetisk energi er og giv et eksempel","modelAnswer":"Kinetisk energi er den energi et legeme har pga. sin bevægelse. E=½mv². Fx en cyklist der kører hurtigt har høj kinetisk energi."}]`,
  };

  try {
    const system = systems[mode] || systems.quiz;
    const raw = await callClaude(system, [fileBlock, { type: "text", text: `Analyser dette materiale og lav outputtet som beskrevet. Tilstand: mode=${mode}` }], key);
    if (mode === "podcast") return res.json({ ok: true, text: raw });
    const clean = raw.replace(/```json|```/gi, "").trim();
    res.json({ ok: true, items: JSON.parse(clean) });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── AI Chat (tutor + mundtlig eksamen feedback) ──
app.post("/api/chat", async (req, res) => {
  const { messages, mode = "tutor", apiKey, context = "" } = req.body;
  const key = apiKey || process.env.ANTHROPIC_API_KEY || "";
  if (!key) return res.status(400).json({ error: "Ingen API-nøgle." });

  const systems = {
    tutor: `Du er en venlig og tydelig fysik-tutor der hjælper gymnasie- og universitetsstuderende.
Svar på dansk, kortfattet (max 3 afsnit), brug konkrete eksempler. Inkludér relevante formler når det giver mening.
${context ? `Kontekst fra brugerens materiale:\n${context}` : ""}`,

    oral: `Du er eksaminator ved en mundtlig fysikeksamen. Studerende skal forklare begreber med egne ord.
Dit job: lyt til forklaringen, giv konstruktiv feedback (hvad var godt, hvad manglede), giv en karakter 1-7 med begrundelse.
Svar på dansk. Vær opmuntrende men ærlig. Format: 
**Feedback:** [din feedback]
**Karakter:** [1-7] — [kort begrundelse]`,
  };

  try {
    const body = {
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systems[mode] || systems.tutor,
      messages: messages.slice(-10),
    };
    const res2 = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    if (!res2.ok) throw new Error(`API ${res2.status}`);
    const data = await res2.json();
    res.json({ reply: data.content.map(b => b.type === "text" ? b.text : "").join("") });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Eksisterende endpoints ──
app.get("/api/topics", (_req, res) => res.json(TOPICS));
app.get("/api/questions", (req, res) => {
  const { topic = "alle", level = "alle", count = "10" } = req.query;
  res.json(getQuestions({ topic, level, count: Math.min(parseInt(count, 10), 30) }));
});
app.get("/api/flashcards", (req, res) => {
  const { topic = "alle" } = req.query;
  res.json(topic === "alle" ? FLASHCARDS : FLASHCARDS.filter(c => c.topic === topic));
});
app.post("/api/tutor", (req, res) => {
  const msg = (req.body.message || "").toLowerCase();
  let best = null, bs = 0;
  for (const e of TUTOR) {
    const s = e.keys.reduce((a, k) => msg.includes(k) ? a + 1 : a, 0);
    if (s > bs) { bs = s; best = e; }
  }
  res.json({ reply: best && bs > 0 ? best.answer : "Prøv at spørge om et fysikemne, fx \"forklar Ohms lov\" eller \"hvad er kinetisk energi\"." });
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`Fysik-eksamen kører på port ${PORT}`));
