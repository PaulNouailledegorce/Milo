document.addEventListener('DOMContentLoaded', () => {

    // --- Configuration et variables globales ---
    const socket = io("http://localhost:5000");
    let currentMiloMessageDiv = null;
    let audioQueue = [];
    let isDiscussionModeActive = false;
    let isWaitingForResponse = false;
    let recognition;
    let stagedFile = null;
    let miloAnimation3D = null;
    let currentAudio = null;
    let audioContext = null;
    let analyser = null;

    // Mode change sera géré directement par les fonctions switchToVoice/switchToText

    // --- Sélection des éléments du DOM ---
    const voiceInterface = document.getElementById('voice-interface');
    const textInterface = document.getElementById('text-interface');
    
    const switchToTextBtn = document.getElementById('switch-to-text-btn');
    const switchToVoiceBtn = document.getElementById('switch-to-voice-btn');
    
    const statusText = document.getElementById('status-text');
    
    const sendBtn = document.getElementById('send-btn');
    const textInput = document.getElementById('text-input');
    const chatMessages = document.getElementById('chat-messages');
    
    const fileInput = document.getElementById('file-input');
    const voiceUploadBtn = document.getElementById('voice-upload-btn');
    const textUploadBtn = document.getElementById('text-upload-btn');

    // --- Initialisation de la reconnaissance vocale ---
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
        recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        recognition.lang = "fr-FR";
        recognition.continuous = false;

        recognition.onresult = (event) => {
            const text = event.results[event.results.length - 1][0].transcript;
            console.log("🎙️ Texte reconnu:", text);
            isWaitingForResponse = true;
            // S'assurer que le mode vocal est bien transmis
            console.log("🔊 Envoi message vocal avec mode discussion activé");
            handleSendMessage(text, true); // true = mode discussion
        };

        recognition.onend = () => {
            console.log("🎙️ Reconnaissance terminée, isDiscussionModeActive:", isDiscussionModeActive);
            // Ne pas redémarrer automatiquement ici, laisser le contrôle aux fonctions complete/audio
        };
        
        recognition.onerror = (event) => {
            console.error("❌ Erreur reconnaissance vocale:", event.error);
            if (event.error === 'no-speech' && isDiscussionModeActive && voiceInterface.classList.contains('active')) {
                console.log("🔄 Redémarrage après no-speech");
                setTimeout(() => startRecognition(), 1000);
            }
        };

        recognition.onstart = () => {
            console.log("🎙️ Reconnaissance démarrée");
        };
    }

    // --- Initialisation de l'animation 3D ---
    function initMiloAnimation() {
        console.log("🎬 Tentative d'initialisation de l'animation 3D...");
        console.log("THREE disponible:", !!window.THREE);
        console.log("MiloAnimation disponible:", !!window.MiloAnimation);
        console.log("Container existe:", !!document.getElementById('milo-animation-3d'));
        
        if (window.THREE && window.MiloAnimation && !miloAnimation3D) {
            try {
                miloAnimation3D = new window.MiloAnimation('milo-animation-3d');
                console.log("✅ Animation 3D Milo initialisée avec succès");
            } catch (error) {
                console.error("❌ Erreur lors de l'initialisation de l'animation 3D:", error);
            }
        } else {
            console.log("⏳ En attente des dépendances pour l'animation 3D");
            // Réessayer après un délai
            setTimeout(() => {
                if (!miloAnimation3D) {
                    initMiloAnimation();
                }
            }, 1000);
        }
    }

    // --- Analyse audio ElevenLabs ---
    function initElevenLabsAudioAnalysis() {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.8;
            console.log("🎵 Analyseur audio ElevenLabs initialisé");
        } catch (error) {
            console.error("❌ Erreur initialisation analyseur audio:", error);
        }
    }

    function analyzeElevenLabsAudio(audio) {
        if (!audioContext || !analyser || !miloAnimation3D) return;

        try {
            // Créer une source audio depuis l'élément audio
            const source = audioContext.createMediaElementSource(audio);
            source.connect(analyser);
            analyser.connect(audioContext.destination);

            // Démarrer l'analyse en temps réel
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            
            function analyze() {
                if (audio.paused || audio.ended) return;

                analyser.getByteFrequencyData(dataArray);
                
                // Calculer l'intensité moyenne
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i];
                }
                const average = sum / dataArray.length;
                const normalizedIntensity = average / 255;

                // Transmettre l'intensité à l'animation
                if (miloAnimation3D) {
                    miloAnimation3D.updateAudioReactivity(normalizedIntensity);
                }

                requestAnimationFrame(analyze);
            }
            
            analyze();
            console.log("🎤 Analyse audio ElevenLabs démarrée");
            
        } catch (error) {
            console.warn("⚠️ Erreur analyse audio ElevenLabs:", error);
        }
    }

    // --- Socket.IO Events ---
    socket.on("connect", () => {
        console.log("✅ Connecté à Milo");
        setMiloState('idle');
    });
    
    socket.on("connect_error", (error) => {
        console.error("❌ Erreur de connexion Socket.io:", error);
    });

    socket.on("text_chunk", (data) => {
        appendMessage("milo", data.text);
    });

    socket.on("audio_chunk", (data) => {
        console.log("🎵 Chunk audio reçu - format:", data.format, "taille base64:", data.audio ? data.audio.length : 0);
        
        if (data.audio && data.format) {
            try {
                const blob = base64ToBlob(data.audio, `audio/${data.format}`);
                console.log("🎵 Blob créé - taille:", blob.size, "type:", blob.type);
                audioQueue.push(blob);
                console.log("🎵 Audio ajouté à la queue - total chunks:", audioQueue.length);
            } catch (error) {
                console.error("❌ Erreur lors de la création du blob audio:", error);
            }
        } else {
            console.warn("⚠️ Chunk audio invalide:", data);
        }
    });

    socket.on("complete", () => {
        console.log("✅ Réponse complète.");
        console.log("📊 État actuel - audioQueue:", audioQueue.length, "isDiscussionModeActive:", isDiscussionModeActive, "interface:", voiceInterface.classList.contains('active') ? 'Vocal' : 'Texte');
        
        setMiloState('idle');
        isWaitingForResponse = false;
        
        if (audioQueue.length > 0) {
            console.log("🔊 Lecture de l'audio en attente (" + audioQueue.length + " chunks)");
            // Attendre un petit délai pour s'assurer que tous les chunks sont reçus
            setTimeout(() => {
                playAudioQueue();
            }, 100);
        } else {
            console.log("📝 Pas d'audio à jouer (mode texte ou erreur)");
            
            if (isDiscussionModeActive && voiceInterface.classList.contains('active')) {
                // Redémarrer automatiquement la reconnaissance vocale après la réponse
                console.log("🔄 Redémarrage automatique de la reconnaissance après réponse (pas d'audio)");
                setTimeout(() => {
                    startRecognition();
                }, 800); // Pause un peu plus longue sans audio
            }
        }
    });

    socket.on("error", (error) => {
        console.error("❌ Erreur:", error);
        setMiloState('idle');
        appendMessage("milo", "Désolé, une erreur s'est produite.");
    });

    socket.on("mode_change_confirmed", (data) => {
        console.log("✅ Changement de mode confirmé par le serveur:", data.newMode);
        console.log("✅ isDiscussionMode serveur:", data.isDiscussionMode);
    });

    // --- Fonctions de gestion d'état ---

    /**
     * Change l'état de l'animation et le texte de statut de Milo.
     * @param {'idle' | 'thinking' | 'speaking'} state - Le nouvel état de Milo.
     */
    function setMiloState(state) {
        let status = '';

        switch (state) {
            case 'thinking':
                status = 'Je réfléchis...';
                break;
            case 'speaking':
                status = 'Je parle...';
                break;
            case 'idle':
            default:
                status = 'Je t\'écoute...';
                break;
        }

        // Mettre à jour l'animation 3D selon l'état
        if (miloAnimation3D) {
            miloAnimation3D.setState(state);
        }
        
        if (statusText) {
            statusText.textContent = status;
        }
    }

    /**
     * Affiche l'interface vocale et cache l'interface textuelle.
     */
    function switchToVoice() {
        // Démarrer la transition fondu
        textInterface.classList.remove('active');
        
        // IMMÉDIATEMENT activer le mode discussion et notifier le serveur
        isDiscussionModeActive = true;
        isWaitingForResponse = false;
        notifyModeChange(true); // true = mode vocal
        console.log("🔄 Passage en mode vocal - Mode discussion activé");
        
        // Attendre un petit délai pour le fondu, puis activer l'interface vocale
        setTimeout(() => {
            voiceInterface.classList.add('active');
            setMiloState('idle');
            
            // Changer les logos et icônes pour le mode vocal avec transition
            const voiceMiloLogo = voiceInterface.querySelector('.milo-logo-img');
            const voiceEceLogo = voiceInterface.querySelector('.ece-logo');
            const voiceBurgerIcon = voiceInterface.querySelector('.burger-icon');
            
            if (voiceMiloLogo) {
                voiceMiloLogo.style.opacity = '0';
                setTimeout(() => {
                    voiceMiloLogo.src = 'assets/logos/MILO-BLANC.png';
                    voiceMiloLogo.style.opacity = '1';
                }, 200);
            }
            
            if (voiceEceLogo) {
                voiceEceLogo.style.opacity = '0';
                setTimeout(() => {
                    voiceEceLogo.src = 'assets/logos/ECE_LOGO.png';
                    voiceEceLogo.style.opacity = '1';
                }, 200);
            }

            if (voiceBurgerIcon) {
                voiceBurgerIcon.style.opacity = '0';
                setTimeout(() => {
                    voiceBurgerIcon.src = 'assets/icons/BURGER_blanc.png';
                    voiceBurgerIcon.style.opacity = '1';
                }, 200);
            }
        }, 100); // Délai pour permettre le fondu
    }

    /**
     * Affiche l'interface textuelle et cache l'interface vocale.
     */
    function switchToText() {
        // Démarrer la transition fondu
        voiceInterface.classList.remove('active');
        
        // IMMÉDIATEMENT arrêter la reconnaissance vocale, l'audio en cours et notifier le serveur
        stopRecognition();
        stopCurrentAudio();
        notifyModeChange(false); // false = mode texte
        isDiscussionModeActive = false;
        isWaitingForResponse = false;
        console.log("🔄 Passage en mode texte - Discussion mode désactivé + audio coupé");
        
        // Attendre un petit délai pour le fondu, puis activer l'interface texte
        setTimeout(() => {
            textInterface.classList.add('active');
            
            // Changer les logos et icônes pour le mode texte avec transition
            const textMiloLogo = textInterface.querySelector('.milo-logo-img');
            const textEceLogo = textInterface.querySelector('.ece-logo');
            const textBurgerIcon = textInterface.querySelector('.burger-icon');
            
            if (textMiloLogo) {
                textMiloLogo.style.opacity = '0';
                setTimeout(() => {
                    textMiloLogo.src = 'assets/logos/MILO-BLEU.png';
                    textMiloLogo.style.opacity = '1';
                }, 200);
            }
            
            if (textEceLogo) {
                textEceLogo.style.opacity = '0';
                setTimeout(() => {
                    // Vérifier si on est en format mobile/vertical
                    if (window.innerWidth <= 600) {
                        textEceLogo.src = 'assets/logos/ECE_LOGO_bleu.png';
                    } else {
                        textEceLogo.src = 'assets/logos/ECE_LOGO.png';
                    }
                    textEceLogo.style.opacity = '1';
                }, 200);
            }

            if (textBurgerIcon) {
                textBurgerIcon.style.opacity = '0';
                setTimeout(() => {
                    // Vérifier si on est en format mobile/vertical
                    if (window.innerWidth <= 600) {
                        textBurgerIcon.src = 'assets/icons/BURGER_bleu.png';
                    } else {
                        textBurgerIcon.src = 'assets/icons/BURGER_blanc.png';
                    }
                    textBurgerIcon.style.opacity = '1';
                }, 200);
            }
        }, 100); // Délai pour permettre le fondu
    }

    // --- Fonctions de gestion des messages ---

    /**
     * Envoie un message texte ou fichier
     */
    function handleSendMessage(messageText = null, isVoiceMode = false) {
        // Si on est en mode discussion actif, forcer le mode vocal
        if (isDiscussionModeActive && voiceInterface.classList.contains('active')) {
            isVoiceMode = true;
        }
        
        // Récupérer le texte depuis l'input ou le paramètre
        const text = messageText || (textInput ? textInput.value.trim() : '');
        
        if (stagedFile) {
            // Envoyer fichier + texte
            const promptText = text || 'Analyse ce document et décris son contenu.';
            
            // Afficher le message utilisateur avec le fichier
            displayUserMessage(promptText, stagedFile);
            
            // Envoyer via socket
            socket.emit("file_upload", {
                file: stagedFile.fileData,
                prompt: promptText
            });
            
            // Réinitialiser
            resetInput();
            stagedFile = null;
            
        } else if (text) {
            // Envoyer uniquement le texte
            displayUserMessage(text);
            
            console.log("📤 Envoi query - isVoiceMode:", isVoiceMode, "isDiscussionModeActive:", isDiscussionModeActive);
            
            socket.emit("query", {
                messages: [{ role: "user", content: text }],
                isDiscussionMode: isVoiceMode
            });
            
            resetInput();
        }
        
        if (text || stagedFile) {
            setMiloState('thinking');
            currentMiloMessageDiv = null;
        }
    }

    /**
     * Affiche un message utilisateur dans le chat
     */
    function displayUserMessage(text, file = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message user';
        
        let contentHtml = `<div class="text">${text}</div>`;
        
        if (file && file.fileType.startsWith('image/')) {
            contentHtml += `<img src="${file.fileData}" style="max-width: 200px; border-radius: 8px; margin-top: 5px;" />`;
        } else if (file) {
            contentHtml += `<div style="font-style: italic; font-size: 0.9em; margin-top: 5px;">📎 ${file.fileName}</div>`;
        }
        
        messageDiv.innerHTML = contentHtml;
        chatMessages.appendChild(messageDiv);
        scrollToBottom();
    }

    /**
     * Ajoute du texte à un message en cours (streaming)
     */
    function appendMessage(role, text) {
        if (role === 'milo') {
            if (!currentMiloMessageDiv) {
                currentMiloMessageDiv = document.createElement('div');
                currentMiloMessageDiv.className = 'message milo';
                currentMiloMessageDiv.innerHTML = '<div class="avatar"><img src="assets/icons/AI-MILO-2_bleu.png" alt="Milo"></div><div class="text"></div>';
                chatMessages.appendChild(currentMiloMessageDiv);
            }
            
            const textDiv = currentMiloMessageDiv.querySelector('.text');
            
            // Convertir les retours à la ligne en <br> et conserver le formatage
            const formattedText = text
                .replace(/\n\n/g, '<br><br>')  // Double saut de ligne
                .replace(/\n/g, '<br>');        // Simple saut de ligne
            
            // Ajouter le texte formaté en HTML
            textDiv.innerHTML += formattedText;
        }
        
        scrollToBottom();
    }

    /**
     * Fait défiler le chat vers le bas
     */
    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    /**
     * Remet à zéro l'input texte
     */
    function resetInput() {
        if (textInput) {
            textInput.value = '';
        }
    }

    // --- Gestion des fichiers ---

    /**
     * Gère la sélection d'un fichier
     */
    function handleFileUpload() {
        const file = fileInput.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            stagedFile = {
                fileData: e.target.result,
                fileName: file.name,
                fileType: file.type
            };
            
            console.log('📎 Fichier préparé:', file.name);
            // Optionnel: afficher un indicateur visuel que le fichier est prêt
        };
        reader.readAsDataURL(file);
        fileInput.value = ''; // Reset pour permettre de re-sélectionner
    }

    // --- Fonctions vocales ---

    function startRecognition() {
        if (recognition && !isWaitingForResponse) {
            console.log("🎙️ Tentative de démarrage reconnaissance, isDiscussionModeActive:", isDiscussionModeActive);
            
            // Arrêter d'abord toute reconnaissance en cours
            try {
                recognition.stop();
            } catch (e) {
                // Ignore les erreurs si pas de reconnaissance en cours
            }
            
            setTimeout(() => {
                if (voiceInterface.classList.contains('active') && !isWaitingForResponse) {
                    isDiscussionModeActive = true;
                    setMiloState('idle');
                    try {
                        recognition.start();
                        console.log("✅ Reconnaissance vocale démarrée avec succès");
                    } catch (e) {
                        console.warn("⚠️ Erreur démarrage reconnaissance:", e);
                        // Réessayer une fois après un délai
                        setTimeout(() => {
                            try {
                                if (!isWaitingForResponse) {
                                    recognition.start();
                                    console.log("✅ Reconnaissance redémarrée après erreur");
                                }
                            } catch (e2) {
                                console.error("❌ Impossible de démarrer la reconnaissance:", e2);
                            }
                        }, 2000);
                    }
                } else {
                    console.log("⏸️ Démarrage reconnaissance annulé (pas en mode vocal ou en attente de réponse)");
                }
            }, 200); // Délai un peu plus long pour permettre l'arrêt propre
        } else if (isWaitingForResponse) {
            console.log("⏸️ Reconnaissance en pause (attente de réponse)");
        }
    }

    function stopRecognition() {
        if (recognition) {
            console.log("🛑 Arrêt de la reconnaissance vocale");
            recognition.stop();
            isDiscussionModeActive = false;
        }
    }

    function stopCurrentAudio() {
        console.log("🛑 Arrêt de l'audio en cours");
        
        if (currentAudio) {
            console.log("🔇 Arrêt et suppression de l'audio actuel");
            
            // Enlever les event listeners pour éviter les erreurs
            currentAudio.onended = null;
            currentAudio.onerror = null;
            
            // Arrêter la lecture
            if (!currentAudio.paused) {
                currentAudio.pause();
            }
            currentAudio.currentTime = 0;
            
            // Libérer l'URL si elle existe
            if (currentAudio.src) {
                URL.revokeObjectURL(currentAudio.src);
            }
            
            currentAudio = null;
        }
        
        // Vider la queue audio
        audioQueue = [];
        console.log("🗑️ Queue audio vidée");
        
        // Remettre l'état visuel à idle
        setMiloState('idle');
        
        // Remettre la réactivité à zéro
        if (miloAnimation3D) {
            miloAnimation3D.updateAudioReactivity(0);
        }
    }

    function notifyModeChange(isVoiceMode) {
        console.log("📡 Notification changement de mode au serveur:", isVoiceMode ? "Vocal (TTS)" : "Texte (TTT)");
        console.log("📡 isDiscussionModeActive local:", isDiscussionModeActive);
        socket.emit("mode_change", {
            isDiscussionMode: isVoiceMode
        });
    }

    function playAudioQueue() {
        console.log("🔊 Tentative de lecture audio - Queue length:", audioQueue.length);
        
        if (audioQueue.length === 0) {
            console.log("⚠️ Aucun audio dans la queue");
            return;
        }
        
        console.log("🔊 Types d'audio dans la queue:", audioQueue.map(blob => blob.type));
        
        setMiloState('speaking');
        
        try {
            const fullAudioBlob = new Blob(audioQueue, { type: audioQueue[0].type });
            console.log("🔊 Blob audio créé - taille:", fullAudioBlob.size, "type:", fullAudioBlob.type);
            
            const audioUrl = URL.createObjectURL(fullAudioBlob);
            console.log("🔊 URL audio créée:", audioUrl);
            
            currentAudio = new Audio(audioUrl);
            console.log("🔊 Élément Audio créé");
            
            // Initialiser l'analyseur si pas encore fait
            if (!audioContext) {
                initElevenLabsAudioAnalysis();
            }
            
            console.log("🔊 Démarrage de la lecture audio...");
            currentAudio.play()
                .then(() => {
                    console.log("✅ Audio démarré avec succès");
                })
                .catch((error) => {
                    console.error("❌ Erreur lors du démarrage audio:", error);
                });
            
            // Démarrer l'analyse audio pour la réactivité visuelle
            if (audioContext && analyser) {
                analyzeElevenLabsAudio(currentAudio);
            }
            
            currentAudio.onended = () => {
                console.log("🔊 Audio terminé");
                setMiloState('idle');
                audioQueue = []; // Vider la queue
                
                // Libérer l'URL
                URL.revokeObjectURL(audioUrl);
                currentAudio = null;
                
                // Remettre la réactivité à zéro quand l'audio s'arrête
                if (miloAnimation3D) {
                    miloAnimation3D.updateAudioReactivity(0);
                }
                
                // Redémarrer la reconnaissance vocale uniquement si on est en mode vocal actif
                if (isDiscussionModeActive && voiceInterface.classList.contains('active')) {
                    setTimeout(() => {
                        console.log("🎙️ Redémarrage automatique de la reconnaissance vocale après audio");
                        startRecognition();
                    }, 500); // Courte pause après l'audio
                }
            };
            
            currentAudio.onerror = (error) => {
                console.error("❌ Erreur lecture audio:", error);
                console.error("❌ Détails currentAudio:", currentAudio ? {
                    src: currentAudio.src,
                    readyState: currentAudio.readyState,
                    networkState: currentAudio.networkState,
                    error: currentAudio.error
                } : "currentAudio est null");
                
                setMiloState('idle');
                audioQueue = [];
                
                // Libérer l'URL en cas d'erreur
                URL.revokeObjectURL(audioUrl);
                currentAudio = null;
                
                // Remettre la réactivité à zéro en cas d'erreur
                if (miloAnimation3D) {
                    miloAnimation3D.updateAudioReactivity(0);
                }
                
                if (isDiscussionModeActive && voiceInterface.classList.contains('active')) {
                    setTimeout(() => {
                        console.log("🎙️ Redémarrage reconnaissance après erreur audio");
                        startRecognition();
                    }, 1000);
                }
            };
            
        } catch (error) {
            console.error("❌ Erreur lors de la création de l'audio:", error);
            setMiloState('idle');
            audioQueue = [];
        }
    }

    // --- Fonctions utilitaires ---

    function base64ToBlob(base64, contentType = '') {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: contentType });
    }

    // --- Event Listeners ---

    // Navigation entre interfaces
    if (switchToTextBtn) {
        switchToTextBtn.addEventListener('click', switchToText);
    }
    
    if (switchToVoiceBtn) {
        switchToVoiceBtn.addEventListener('click', () => {
            switchToVoice();
            console.log("🔄 Retour au mode vocal, démarrage reconnaissance");
            setTimeout(() => {
                startRecognition(); // Démarrer automatiquement la reconnaissance vocale
            }, 500);
        });
    }

    // Envoi de message
    if (sendBtn) {
        sendBtn.addEventListener('click', () => handleSendMessage());
    }
    
    if (textInput) {
        textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
            }
        });
    }

    // Upload de fichier
    if (voiceUploadBtn) {
        voiceUploadBtn.addEventListener('click', () => fileInput.click());
    }
    
    if (textUploadBtn) {
        textUploadBtn.addEventListener('click', () => fileInput.click());
    }
    
    if (fileInput) {
        fileInput.addEventListener('change', handleFileUpload);
    }

    // --- Gestion responsive des logos et icônes ---
    function updateLogosForScreenSize() {
        const textEceLogo = textInterface.querySelector('.ece-logo');
        const textBurgerIcon = textInterface.querySelector('.burger-icon');
        
        if (textInterface.classList.contains('active')) {
            // Gestion du logo ECE avec transition
            if (textEceLogo) {
                textEceLogo.style.opacity = '0';
                setTimeout(() => {
                    if (window.innerWidth <= 600) {
                        textEceLogo.src = 'assets/logos/ECE_LOGO_bleu.png';
                    } else {
                        textEceLogo.src = 'assets/logos/ECE_LOGO.png';
                    }
                    textEceLogo.style.opacity = '1';
                }, 200);
            }

            // Gestion de l'icône burger avec transition
            if (textBurgerIcon) {
                textBurgerIcon.style.opacity = '0';
                setTimeout(() => {
                    if (window.innerWidth <= 600) {
                        textBurgerIcon.src = 'assets/icons/BURGER_bleu.png';
                    } else {
                        textBurgerIcon.src = 'assets/icons/BURGER_blanc.png';
                    }
                    textBurgerIcon.style.opacity = '1';
                }, 200);
            }
        }
    }

    // Écouter les changements de taille d'écran
    window.addEventListener('resize', updateLogosForScreenSize);

    // --- Initialisation ---
    console.log("🚀 Milo frontend en cours d'initialisation...");
    
    initMiloAnimation();
    
    window.addEventListener('load', () => {
        if (!miloAnimation3D) {
            console.log("🔄 Tentative d'initialisation de l'animation au load de la page");
            initMiloAnimation();
        }
    });
    
    setMiloState('idle');
    console.log("🚀 Milo frontend initialisé");
    
    // --- Auto-activation du micro au premier chargement (seulement si interface vocale active) ---
    function autoInitVoiceOnFirstLoad() {
        // Vérifier si l'interface vocale est active par défaut
        if (voiceInterface && voiceInterface.classList.contains('active') && recognition) {
            console.log("🎤 Interface vocale détectée au chargement - Auto-activation du micro dans 1.5s");
            setTimeout(() => {
                // Double vérification que l'interface vocale est toujours active
                if (voiceInterface.classList.contains('active') && !isDiscussionModeActive) {
                    console.log("🎤 Activation automatique du micro au premier chargement");
                    isDiscussionModeActive = true;
                    notifyModeChange(true);
                    startRecognition();
                }
            }, 1500); // 1.5 seconde comme demandé
        }
    }
    
    // Lancer l'auto-initialisation après le chargement complet
    setTimeout(autoInitVoiceOnFirstLoad, 100);
    
    // Fonction debug pour la console
    window.miloDebug = function() {
        console.log("=== État Milo Debug ===");
        console.log("isDiscussionModeActive:", isDiscussionModeActive);
        console.log("isWaitingForResponse:", isWaitingForResponse);
        console.log("Interface active:", voiceInterface.classList.contains('active') ? 'Vocal' : 'Texte');
        console.log("Recognition disponible:", !!recognition);
        console.log("audioQueue length:", audioQueue.length);
        console.log("currentAudio:", currentAudio ? {
            src: currentAudio.src,
            paused: currentAudio.paused,
            currentTime: currentAudio.currentTime,
            duration: currentAudio.duration,
            readyState: currentAudio.readyState,
            networkState: currentAudio.networkState
        } : null);
        console.log("audioContext:", !!audioContext);
        console.log("analyser:", !!analyser);
        console.log("Taille écran:", window.innerWidth + "x" + window.innerHeight);
        console.log("Animation 3D:", !!miloAnimation3D);
        console.log("THREE.js:", !!window.THREE);
        console.log("MiloAnimation class:", !!window.MiloAnimation);
        console.log("Container 3D:", !!document.getElementById('milo-animation-3d'));
        
        if (audioQueue.length > 0) {
            console.log("📊 Détails audioQueue:");
            audioQueue.forEach((blob, index) => {
                console.log(`  Chunk ${index}: taille=${blob.size}, type=${blob.type}`);
            });
        }
    };

    // Force l'initialisation de l'animation (fonction debug)
    window.forceInitAnimation = function() {
        console.log("🔧 Forçage de l'initialisation de l'animation...");
        miloAnimation3D = null;
        initMiloAnimation();
    };

    // Test manuel du changement de mode (fonction debug)
    window.testModeChange = function(voiceMode) {
        console.log("🧪 Test changement de mode:", voiceMode ? "Vocal" : "Texte");
        if (voiceMode) {
            switchToVoice();
        } else {
            switchToText();
        }
    };

    // Test d'envoi de message avec mode spécifique (fonction debug)
    window.testMessage = function(message, voiceMode) {
        console.log("🧪 Test message avec mode:", voiceMode ? "Vocal" : "Texte");
        
        // Forcer le mode
        if (voiceMode) {
            isDiscussionModeActive = true;
            notifyModeChange(true);
        } else {
            isDiscussionModeActive = false;
            notifyModeChange(false);
        }
        
        // Envoyer le message
        handleSendMessage(message, voiceMode);
    };

    // Test de la réactivité audio (fonction debug)
    window.testAudioReactivity = function(intensity = 0.5) {
        console.log("🧪 Test réactivité audio avec intensité:", intensity);
        if (miloAnimation3D) {
            miloAnimation3D.setState('speaking');
            miloAnimation3D.updateAudioReactivity(intensity);
            console.log("🎵 Réactivité audio mise à jour:", miloAnimation3D.audioReactivity);
            console.log("🎵 Réactivité totale:", miloAnimation3D.reactivity);
        }
    };

    // Test de lecture audio (fonction debug)
    window.testPlayAudio = function() {
        console.log("🧪 Test de lecture audio forcée");
        console.log("📊 audioQueue actuelle:", audioQueue.length, "chunks");
        
        if (audioQueue.length > 0) {
            console.log("🔊 Tentative de lecture de la queue actuelle");
            playAudioQueue();
        } else {
            console.log("⚠️ Aucun audio dans la queue pour tester");
            console.log("💡 Utilisez testMessage('test', true) pour générer de l'audio");
        }
    };

    // Test audio avec URL simple (fonction debug)
    window.testSimpleAudio = function() {
        console.log("🧪 Test audio simple");
        
        // Créer un ton de test
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 440; // La note 440Hz
        gainNode.gain.value = 0.1;
        
        oscillator.start();
        
        setTimeout(() => {
            oscillator.stop();
            console.log("✅ Test audio simple terminé");
        }, 1000);
    };
});