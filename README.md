# MecaCheck AI backend

Backend Node/Express pour MecaCheck. La clé OpenAI reste côté serveur et n'est jamais placée dans `index.html`.

## Local

```bash
npm install
cp .env.example .env
# renseigner OPENAI_API_KEY dans .env
npm start
```

Puis ouvrir MecaCheck et renseigner `http://localhost:3000` dans **Assistant IA → Moteur IA sécurisé**.

## Production

Déployer ce dossier sur un hébergeur Node (Render, Railway, Fly.io, VPS, etc.).
Définir les variables d'environnement :

- `OPENAI_API_KEY`
- `OPENAI_MODEL=gpt-5.6-luna`
- `ALLOWED_ORIGIN=https://dylanbertron.github.io`
- `PORT` est généralement fourni par l'hébergeur

Ne jamais mettre la clé OpenAI dans le dépôt GitHub ou dans l'application mobile.
