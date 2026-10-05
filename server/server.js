import { createHash, timingSafeEqual } from "node:crypto";
import "dotenv/config";
import cors from "cors";
import express from "express";
import OpenAI from "openai";
import { rateLimit } from "express-rate-limit";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_TOKEN = process.env.MECACHECK_API_TOKEN || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

function parseAllowedOrigins(value) {
  const origins = (value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!origins.length) {
    throw new Error("ALLOWED_ORIGINS must contain at least one origin.");
  }

  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Invalid origin in ALLOWED_ORIGINS: ${origin}`);
    }
    if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== origin) {
      throw new Error(`ALLOWED_ORIGINS values must be exact origins: ${origin}`);
    }
  }

  return new Set(origins);
}

let allowedOrigins;
try {
  allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (API_TOKEN.length < 32) {
  console.error("MECACHECK_API_TOKEN must be configured with at least 32 characters.");
  process.exit(1);
}

if (process.env.RENDER === "true") {
  // Render terminates TLS at its proxy and forwards the client address one hop away.
  app.set("trust proxy", 1);
} else if (process.env.TRUST_PROXY_HOPS) {
  const hops = Number(process.env.TRUST_PROXY_HOPS);
  if (!Number.isInteger(hops) || hops < 1) {
    console.error("TRUST_PROXY_HOPS must be a positive integer.");
    process.exit(1);
  }
  app.set("trust proxy", hops);
}

const client = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

app.use(cors({
  origin(origin, callback) {
    callback(null, Boolean(origin && allowedOrigins.has(origin)));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 600,
  optionsSuccessStatus: 204
}));

// CORS controls browser access to responses; this explicit check also refuses
// disallowed browser origins before they can reach the paid AI endpoint.
app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ error: "Origine non autorisée." });
  }
  next();
});

const diagnoseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler(_req, res) {
    res.status(429).json({ error: "Trop de demandes. Réessaie dans quelques minutes." });
  }
});

app.use("/api/diagnose", diagnoseLimiter);
app.use("/api/diagnose", requireApiToken);
app.use(express.json({ limit: "128kb", strict: true }));

function tokenMatches(candidate) {
  if (!candidate) return false;
  const expectedHash = createHash("sha256").update(API_TOKEN).digest();
  const candidateHash = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(expectedHash, candidateHash);
}

function requireApiToken(req, res, next) {
  const authorization = req.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match || !tokenMatches(match[1])) {
    return res.status(401).json({ error: "Jeton d’accès manquant ou invalide." });
  }
  next();
}

function boundedJsonValue(value, depth = 0) {
  if (depth > 4) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= 4000;
  if (Array.isArray(value)) {
    return value.length <= 20 && value.every((item) => boundedJsonValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length <= 30 && entries.every(([key, item]) =>
      key.length <= 100 && boundedJsonValue(item, depth + 1)
    );
  }
  return false;
}

function validateDiagnosticBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const allowedKeys = new Set(["vehicle", "mileage", "symptoms", "dtcs", "measurements", "history"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) return null;

  const vehicle = body.vehicle ?? {};
  const mileage = body.mileage ?? null;
  const symptoms = body.symptoms ?? "";
  const dtcs = body.dtcs ?? [];
  const measurements = body.measurements ?? [];
  const history = body.history ?? [];

  if (!boundedJsonValue(vehicle) || JSON.stringify(vehicle).length > 2000) return null;
  if (mileage !== null && !(typeof mileage === "string" || typeof mileage === "number")) return null;
  if (typeof mileage === "string" && mileage.length > 40) return null;
  if (typeof mileage === "number" && !Number.isFinite(mileage)) return null;
  if (typeof symptoms !== "string" || symptoms.length > 8000) return null;
  if (!Array.isArray(dtcs) || dtcs.length > 20 || !dtcs.every((item) =>
    item && typeof item === "object" && !Array.isArray(item) && boundedJsonValue(item)
  )) return null;
  for (const list of [measurements, history]) {
    if (!Array.isArray(list) || list.length > 20 || !list.every((item) =>
      boundedJsonValue(item) && JSON.stringify(item).length <= 4000
    )) return null;
  }
  if (!symptoms.trim() && !dtcs.length && !measurements.length) return null;

  return { vehicle, mileage, symptoms, dtcs, measurements, history };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "MecaCheck AI", aiConfigured: Boolean(client) });
});

app.post("/api/diagnose", async (req, res, next) => {
  const dossierData = validateDiagnosticBody(req.body);
  if (!dossierData) {
    return res.status(400).json({ error: "Données de diagnostic invalides ou incomplètes." });
  }

  if (!client) {
    return res.status(503).json({ error: "Le service IA n’est pas configuré." });
  }

  const system = `
Tu es MecaCheck AI, un assistant de diagnostic automobile destiné aux techniciens.

Tu dois :
- analyser les symptômes, DTC, mesures et informations véhicule ;
- distinguer clairement les faits, hypothèses et contrôles ;
- ne jamais condamner une pièce uniquement à partir d'un DTC ;
- proposer un ordre de contrôle pratique ;
- demander les mesures manquantes lorsqu'elles sont nécessaires ;
- ne jamais inventer une valeur constructeur ;
- signaler lorsqu'une donnée constructeur est nécessaire ;
- tenir compte des réparations déjà effectuées ;
- répondre en français.

Structure ta réponse :
1. Résumé du problème
2. Hypothèses possibles
3. Contrôles prioritaires
4. Mesures à effectuer
5. Ce qui confirmerait chaque hypothèse
6. Ce qui permettrait de l'écarter
7. Prochaine action recommandée
`;

  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-mini",
      instructions: system,
      input: `Dossier diagnostic MecaCheck :\n${JSON.stringify(dossierData, null, 2)}`
    });

    res.json({ ok: true, answer: response.output_text || "Aucune réponse." });
  } catch (error) {
    const errorCode = typeof error?.status === "number" ? `HTTP ${error.status}` : "unexpected error";
    console.error(`OpenAI request failed (${errorCode}).`);
    next(new Error("OPENAI_UPSTREAM_ERROR"));
  }
});

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "La requête dépasse la taille maximale autorisée." });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "Le corps JSON de la requête est invalide." });
  }
  if (error?.message === "OPENAI_UPSTREAM_ERROR") {
    return res.status(502).json({ error: "Le moteur IA est temporairement indisponible." });
  }
  console.error("Unhandled request error.");
  return res.status(500).json({ error: "Erreur interne du serveur." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MecaCheck AI server listening on port ${PORT}`);
});
