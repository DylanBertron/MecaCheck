# MecaCheck AI backend

Backend Node/Express pour l’assistant IA MecaCheck. La clé OpenAI reste exclusivement sur le serveur. L’application web utilise un jeton d’accès MecaCheck distinct, fourni par l’administrateur et conservé en mémoire dans la page jusqu’à son rechargement.

## Développement local

Prérequis : Node.js 20.19 ou plus récent et pnpm 11.19.0 (ou une version compatible avec le lockfile).

```bash
cd server
pnpm install --frozen-lockfile
cp .env.example .env
```

Générer un jeton d’accès aléatoire d’au moins 32 caractères :

```bash
openssl rand -hex 32
```

Placer le résultat dans `MECACHECK_API_TOKEN` du fichier `server/.env`, puis renseigner `OPENAI_API_KEY`. Ne jamais committer ce fichier. Pour le développement, `ALLOWED_ORIGINS` autorise GitHub Pages ainsi que `http://localhost:5500` ; adapte la deuxième origine au serveur local utilisé pour servir `index.html`.

Démarrer le backend depuis `server/` :

```bash
pnpm start
```

Dans **Assistant IA → Moteur IA sécurisé**, renseigner l’URL du backend et le jeton `MECACHECK_API_TOKEN`. Le jeton est envoyé dans l’en-tête Bearer uniquement pour `/api/diagnose`, n’est pas enregistré dans `localStorage` et disparaît au rechargement de la page. `/health` reste accessible sans jeton et indique seulement si la clé OpenAI est configurée.

## Production sur Render

Le Blueprint utilise `rootDir: server`, installe les dépendances avec le lockfile pnpm et fixe Node.js à une version prise en charge par Render. Après création ou mise à jour du service, configurer dans Render :

- `OPENAI_API_KEY` : clé secrète OpenAI, à renseigner dans le tableau de bord Render ;
- `MECACHECK_API_TOKEN` : générer un jeton avec `openssl rand -hex 32`, le définir dans le tableau de bord Render et saisir la même valeur dans l’application ;
- `ALLOWED_ORIGINS` : origines exactes séparées par des virgules, sans chemin, par exemple `https://dylanbertron.github.io` ;
- `OPENAI_MODEL` : modèle OpenAI à utiliser ;
- `PORT` : fourni par Render.

Ne jamais placer `OPENAI_API_KEY` ou `MECACHECK_API_TOKEN` dans `index.html`, dans un dépôt public ou dans une URL. Le jeton MecaCheck est un secret partagé : toute personne qui le possède peut utiliser l’endpoint jusqu’à sa rotation.

## Protections de l’API

- `POST /api/diagnose` exige `Authorization: Bearer <MECACHECK_API_TOKEN>`.
- Le serveur refuse les origines navigateur absentes de `ALLOWED_ORIGINS` et n’autorise que les méthodes et en-têtes nécessaires. Les requêtes sans en-tête `Origin` restent possibles pour les clients non navigateur, mais doivent toujours fournir le jeton.
- Le point d’entrée de diagnostic est limité à 20 requêtes par adresse IP sur 15 minutes. Le limiteur utilise le stockage mémoire ; pour plusieurs instances, configurer un stockage partagé avant de les activer.
- Les corps JSON sont limités à 128 Ko et les champs de diagnostic sont validés et bornés avant tout appel à OpenAI.
- Les erreurs renvoyées au client sont génériques et ne divulguent pas les détails de la clé ou les erreurs internes du fournisseur.

Le contrôle CORS ne remplace pas l’authentification. Le jeton partagé convient à un déploiement contrôlé ; une application multi-utilisateur publique nécessiterait une authentification par utilisateur et des quotas associés.
