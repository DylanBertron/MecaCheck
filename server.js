import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import OpenAI from 'openai';

const app = express();
const port = process.env.PORT || 3000;
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://dylanbertron.github.io';
const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigin === '*' || origin === allowedOrigin) return callback(null, true);
    return callback(new Error('Origin non autorisée.'));
  }
}));
app.use(express.json({ limit: '2mb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }));

const developerInstructions = `Tu es MecaCheck AI, assistant de diagnostic automobile destiné à des techniciens.

Règles impératives :
- Raisonne uniquement à partir des données fournies et indique clairement ce qui manque.
- Un DTC ne condamne jamais automatiquement une pièce.
- Sépare les constats, hypothèses, contrôles et conclusions.
- Propose un ordre de contrôle pratique, logique et sûr.
- N'invente aucune valeur constructeur. Si une spécification est nécessaire, indique qu'il faut la documentation constructeur.
- Pour les systèmes haute pression, électrique, carburant et freinage, rappelle les précautions pertinentes.
- Réponds en français, de façon claire pour un technicien.
- Structure la réponse avec : Résumé, Hypothèses, Contrôles prioritaires, Mesures à relever, Ce qui confirmerait/infirmerait, Prochaine action.`;

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'MecaCheck AI', aiConfigured: Boolean(client), model: process.env.OPENAI_MODEL || 'gpt-5.6-luna' });
});

app.post('/api/diagnose', async (req, res) => {
  const { vehicle = {}, symptoms = '', dtcs = [], measurements = [], history = [] } = req.body || {};
  if (!symptoms && !dtcs.length && !measurements.length) {
    return res.status(400).json({ error: 'Décris au moins un symptôme, un DTC ou une mesure.' });
  }
  if (!client) return res.status(503).json({ error: 'IA non configurée sur le serveur.' });

  const dossier = JSON.stringify({ vehicle, symptoms, dtcs, measurements, history });
  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
      instructions: developerInstructions,
      input: `Dossier MecaCheck :\n${dossier}`,
      max_output_tokens: 1800
    });
    res.json({ ok: true, answer: response.output_text || 'Aucune réponse.', model: process.env.OPENAI_MODEL || 'gpt-5.6-luna' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur du moteur IA.' });
  }
});

app.listen(port, () => console.log(`MecaCheck AI server listening on ${port}`));
