# Guide de Test - Milo Frontend

## 🚀 Fonctionnalités Implémentées

### ✅ Interface Vocale
- Affichage par défaut au lancement
- Animation vidéo Milo
- Statut d'écoute affiché
- Bouton "+" pour upload de fichier
- Bouton pour basculer vers l'interface texte

### ✅ Interface Textuelle  
- Chat avec historique des messages
- Input texte avec envoi par "Entrée"
- Bouton "+" pour upload de fichier
- Bouton d'envoi
- Bouton pour retour au mode vocal

### ✅ Fonctionnalités Unifiées
- **Historique partagé** : Les messages écrits en mode texte apparaissent dans les deux interfaces
- **Upload de fichier** : Disponible dans les deux modes (images + PDFs)
- **Navigation fluide** : Transitions entre modes vocal et texte
- **Responsive design** : S'adapte mobile/desktop

## 🧪 Tests à Effectuer

### 1. Test Interface Seule (Frontend seul)
```bash
cd Milo-Front
python -m http.server 8000
```
Ouvrir http://localhost:8000

**Vérifications :**
- [ ] Interface vocale s'affiche correctement
- [ ] Boutons cliquables et icônes visibles
- [ ] Passage en mode texte fonctionne
- [ ] Retour en mode vocal fonctionne
- [ ] Input texte focusable
- [ ] Boutons upload ouvrent sélecteur de fichier

### 2. Test Backend
```bash
cd Back-Milo
# Configurer .env avec vos clés API
python app.py
```

**Vérifications :**
- [ ] Serveur démarre sur http://localhost:5000
- [ ] Socket.io accessible
- [ ] Logs de connexion visible

### 3. Test Intégration Complète
Avec les deux serveurs lancés :

**Tests Navigation :**
- [ ] Clic sur "Chat" → Bascule vers interface texte
- [ ] Clic sur "Vocal" → Retour interface vocale
- [ ] Transitions fluides sans erreurs console

**Tests Messaging :**
- [ ] Taper message + Entrée → Message envoyé
- [ ] Clic bouton envoi → Message envoyé  
- [ ] Messages s'affichent dans le chat
- [ ] Réponses Milo streaming en temps réel

**Tests Upload :**
- [ ] Clic "+" → Sélecteur fichier s'ouvre
- [ ] Upload image → Aperçu affiché
- [ ] Upload PDF → Nom de fichier affiché
- [ ] Envoi fichier + texte → Traitement backend

**Tests Vocal :**
- [ ] Mode vocal démarre automatiquement la reconnaissance
- [ ] Parole transcrite → Message envoyé
- [ ] Réponse audio jouée automatiquement

## 📝 Structure des Fichiers Finaux

```
Milo-Front/
├── index.html          # Interface unifiée
├── style.css           # Styles propres et responsive  
├── script.js           # Logique complète Socket.io
├── README_TEST.md      # Ce guide
└── assets/             # Assets complets
    ├── icons/          # Icônes utilisées
    ├── logos/          # Logos Milo + ECE
    ├── fonts/          # Police Helvetica
    └── videos/         # Animations Milo
```

## 🔧 Corrections Apportées

1. **Sélecteurs DOM** : Tous corrigés pour correspondre au HTML
2. **Gestion unifiée** : Messages partagés entre les deux interfaces  
3. **Event Listeners** : Suppression onclick, utilisation addEventListener
4. **Upload de fichiers** : Fonctionnel dans les deux modes
5. **Historique** : Maintenu et affiché dans les deux interfaces
6. **CSS nettoyé** : Suppression des conflits, taille police réduite
7. **Socket.io** : Communication backend correctement configurée

## 🚨 Notes importantes

- **Mode vocal** : Pas d'historique vocal persistant (comme demandé)
- **Taille police** : Réduite à 14px global 
- **Backend requis** : Pour fonctionnalités IA et TTS
- **API Keys** : Configurer .env pour Azure OpenAI + ElevenLabs 