// Configuration de l'application Milo
window.MiloConfig = {
    // Configuration automatique selon l'environnement
    BACKEND_URL: (() => {
        const hostname = window.location.hostname;
        
        // Environnement de développement local
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return "http://localhost:5000";
        }
        
        // Environnement de production
        // Remplacez cette URL par l'URL de votre backend déployé
        // Par exemple sur Render, Railway, Heroku, etc.
        return "https://your-backend-domain.com";
    })(),
    
    // Autres configurations
    VERSION: "1.0.0",
    DEBUG: window.location.hostname === 'localhost'
};

// Log de la configuration pour debug
if (window.MiloConfig.DEBUG) {
    console.log("🔧 Configuration Milo:", window.MiloConfig);
} 