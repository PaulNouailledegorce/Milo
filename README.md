# 🧐 Milo — Chatbot IA Éducatif avec TTS/STT en Streaming

**Milo** est un chatbot éducatif permettant des échanges fluides texte/voix, conçu pour simuler des entretiens, aider à la compréhension d'exercices, et faire du coaching. Il s'appuie sur des API IA modernes (Azure OpenAI, ElevenLabs) et une architecture légère en Flask + Socket.IO pour offrir un retour **texte et audio en streaming**.

---

## 📊 Architecture

```
[Front HTML + JS] <----Socket.IO + REST----> [Flask Backend in Docker] <----API----> Azure OpenAI / ElevenLabs
```

### ⚙️ Technologies utilisées

| Composant          | Détail technique                           |
| ------------------ | ------------------------------------------ |
| Backend            | Flask + Flask-SocketIO + Gunicorn (Docker) |
| Frontend           | HTML, JS natif, Web Speech API             |
| Modèle IA          | GPT-4o via Azure OpenAI                    |
| TTS (voix)         | ElevenLabs SDK                             |
| STT (voix > texte) | Web Speech API (navigateur)                |
| Streaming          | Texte et audio (buffer audio 64Ko)         |
| Authentification   | Clés API (via `.env`)                      |

---

## 🔐 API utilisées

### 🔹 Azure OpenAI

- Endpoint : `https://paul-mc2dtdvj-eastus2.openai.azure.com/`
- Deployment : `gpt-4o_for_milo`
- API Version : `2024-02-01`
- Authentification : `AZURE_OPENAI_API_KEY` (clé dans `.env`)

### 🔹 ElevenLabs

La voix fonctionne bien, l'Api vocale à juste été shut down. 

- Modèle : `eleven_multilingual_v2`
- Format audio : `mp3_44100_128`
- Authentification : `ELEVENLABS_API_KEY` (clé dans `.env`)

---

## 🗂️ Contenu du repo

```
Milo/
├── Back-Milo/
│   ├── app.py               → Backend principal Flask + SocketIO
│   ├── Dockerfile           → Image Docker du backend
│   ├── requirements.txt     → Dépendances Python
│   ├── .env                 → Clés et endpoints (à configurer)
│   └── system_prompt.py     → Prompt système injecté aux requêtes
└── Front-Milo/
    └── front-milo-test.html → Interface HTML test (chat + TTS + STT)
```

---

## ✨ Lancement du projet

### 1. 🐳 Démarrer le backend (depuis `Back-Milo/`)

```bash
# Construire l'image Docker
docker build -t back-milo .

# Lancer le serveur Flask dans Docker
docker run -p 5000:5000 --env-file .env back-milo
```

### 2. 🌐 Lancer le frontend (depuis `Front-Milo/`)

```bash
# Démarrer un serveur HTTP simple
python -m http.server 8080

# Ouvrir dans le navigateur
http://localhost:8080/front-milo-test.html
```

---

## 📋 Exemple de logs (backend)

```txt
[INFO] Listening at: http://0.0.0.0:5000
[INFO] ElevenLabs SDK client initialized.
[INFO] Client connected: abc123XYZ
[INFO] Starting processing for client (TTS: enabled)
[INFO] Starting LLM stream...
[INFO] Finished streaming audio via SDK
[INFO] Emitting 'complete' signal.
```

---

## 💠 Problèmes courants

| Erreur                                             | Cause possible                     | Solution                                                                          |
| -------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| `CORS: No 'Access-Control-Allow-Origin'`           | CORS mal configuré                 | Vérifier `CORS_ORIGINS` dans `.env` et `SocketIO(cors_allowed_origins=...)`       |
| `404 DeploymentNotFound`                           | Nom de déploiement Azure incorrect | Vérifie `AZURE_OPENAI_DEPLOYMENT_NAME` dans `.env`                                |
| `handle_disconnect() takes 0 positional arguments` | Mauvais handler                    | Modifier la fonction : `def handle_disconnect():` → `def handle_disconnect(arg):` |
| `favicon.ico 404`                                  | Requête auto du navigateur         | Sans conséquence                                                                  |

---

## ✅ Prochaines évolutions

-

---

## 🥺 Tests rapides

> Pour tester si tout fonctionne :

1. Lancer backend + frontend
2. Aller sur `http://localhost:8080/front-milo-test.html`
3. Écrire "hi" → Le texte doit apparaître, puis être lu à voix haute

---

## 📾 Auteurs et crédit

Projet développé par [Ton Nom] dans le cadre du stage IA Lab @ ECE\
Voix TTS fournies par [ElevenLabs](https://www.elevenlabs.io)\
Modèle GPT-4o fourni via [Azure OpenAI](https://azure.microsoft.com/en-us/products/cognitive-services/openai-service)

---

