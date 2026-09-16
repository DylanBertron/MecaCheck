
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  : null;

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "MecaCheck AI",
    aiConfigured: !!client
  });
});

app.post("/api/diagnose", async (req, res) => {
  const {
    vehicle = {},
    symptoms = "",
    dtcs = [],
    measurements = [],
    history = []
  } = req.body || {};

  if (!symptoms && !dtcs.length && !measurements.length) {
    return res.status(400).json({
      error: "Décris au moins un symptôme, un DTC ou une mesure."
    });
  }

  if (!client) {
    return res.status(503).json({
      error: "IA non configurée sur le serveur."
    });
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

  const dossier = JSON.stringify(
    {
      vehicle,
      symptoms,
      dtcs,
      measurements,
      history
    },
    null,
    2
  );

  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-mini",
      instructions: system,
      input: `Dossier diagnostic MecaCheck :\n${dossier}`
    });

    res.json({
      ok: true,
      answer: response.output_text || "Aucune réponse."
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Erreur du moteur IA."
    });
  }
});

app.listen(PORT, () => {
  console.log(`MecaCheck AI server listening on port ${PORT}`);
});
