// Animation Three.js pour Milo
class MiloAnimation {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.points = null;
        this.geometry = null;
        this.material = null;
        
        // Paramètres d'animation (adaptés pour Milo)
        this.density = 15000;
        this.speed = 2.5;
        this.reactivity = 0.5;
        this.baseReactivity = 0.5; // Réactivité de base
        this.audioReactivity = 0; // Réactivité audio additionnelle (initialisée à 0)
        this.offsetAmplitude = 500;
        this.waveAmplitude = 500;
        this.globalTime = 0;
        this.animationId = null;
        
        // Pas de capture audio microphone (seule la voix ElevenLabs réagit)
        
        // États de Milo
        this.currentState = 'idle'; // 'idle', 'thinking', 'speaking'
        
        this.init();
    }
    
    // Plus de capture microphone - seule la voix ElevenLabs contrôle la réactivité
    
    init() {
        if (!this.container) {
            console.error('Container for Milo animation not found');
            return;
        }
        
        // Scene setup
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(
            75, 
            this.container.clientWidth / this.container.clientHeight, 
            0.1, 
            3000
        );
        this.camera.position.z = 750;
        
        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true, 
            alpha: true,
            premultipliedAlpha: false
        });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setClearColor(0x000000, 0); // Transparent background
        this.container.appendChild(this.renderer.domElement);
        
        // Handle resize
        window.addEventListener('resize', () => this.onWindowResize());
        
        this.regeneratePoints();
        this.animate();
        
        // Régénération périodique pour l'animation continue
        setInterval(() => this.regeneratePoints(), 1000 / 30);
    }
    
    regeneratePoints() {
        if (this.points) this.scene.remove(this.points);
        
        this.geometry = new THREE.BufferGeometry();
        const perForm = Math.floor(this.density / 4);
        
        const form1 = this.generateSpline(perForm, -60, 0, 1.9, [
            [0, 120], [80, 100], [120, 40], [100, -40], [40, -120], [-40, -100], [-120, -40], [-100, 40], [-40, 120]
        ]);

        const form2 = this.generateSpline(perForm, 60, 0, 1.8, [
            [0, 140], [70, 130], [140, 80], [130, 20], [80, -120], [20, -130], [-80, -120], [-130, -20], [-140, 80], [-70, 130]
        ]);

        const form3 = this.generateSpline(perForm, 0, -60, 1.7, [
            [0, 130], [110, 110], [130, 60], [110, -60], [60, -130], [-60, -110], [-130, -60], [-110, 60], [-60, 130]
        ]);

        const form4 = this.generateSpline(perForm, 0, 60, 1.0, [
            [-100, 220], [-180, 160], [-220, 40], [-180, -80], [-100, -220], [40, -220], [160, -140], [220, 0], [180, 120], [100, 220], [20, 220]
        ]);

        const allPoints = [...form1, ...form2, ...form3, ...form4];
        const count = allPoints.length;

        const positions = new Float32Array(count * 3);
        const normals = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const phases = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const p = allPoints[i];
            const idx = i * 3;
            positions[idx] = p.x;
            positions[idx + 1] = p.y;
            positions[idx + 2] = p.z;

            normals[idx] = 0;
            normals[idx + 1] = 0;
            normals[idx + 2] = 1;

            sizes[i] = 8.0 + Math.random() * 6.0;
            phases[i] = Math.random() * Math.PI * 2;
        }

        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        this.geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        this.geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

        this.material = new THREE.ShaderMaterial({
            vertexShader: document.getElementById('vertexShader').textContent,
            fragmentShader: document.getElementById('fragmentShader').textContent,
            uniforms: {
                time: { value: 0.0 },
                reactivity: { value: this.reactivity }
            },
            transparent: true,
            depthWrite: false
        });

        this.points = new THREE.Points(this.geometry, this.material);
        this.scene.add(this.points);
    }
    
    generateSpline(count, offsetX, offsetY, scale, points2D) {
        const controlPoints = points2D.map((p, i) => {
            const angle = this.globalTime * 0.002 + i;
            const sinOffset = Math.sin(angle + i) * this.waveAmplitude * this.reactivity;
            return new THREE.Vector3(
                p[0] * scale + offsetX + sinOffset * 0.2,
                p[1] * scale + offsetY + sinOffset * 0.2,
                Math.cos(angle + i) * this.waveAmplitude * 0.2 * this.reactivity
            );
        });

        controlPoints.push(controlPoints[0].clone());
        const curve = new THREE.CatmullRomCurve3(controlPoints, true);
        const pts = [];

        for (let i = 0; i < count; i++) {
            const t = i / count;
            const p = curve.getPoint(t);

            const jitter = new THREE.Vector3(
                (Math.random() - 0.5) * 25,
                (Math.random() - 0.5) * 25,
                (Math.random() - 0.5) * 120
            );

            pts.push({ x: p.x + jitter.x, y: p.y + jitter.y, z: p.z + jitter.z });
        }
        return pts;
    }
    
    getStateMultiplier() {
        switch(this.currentState) {
            case 'thinking': return 1.2;
            case 'speaking': return 1.5;
            case 'idle':
            default: return 1.0;
        }
    }
    
    setState(state) {
        this.currentState = state;
        
        // Modifier les paramètres selon l'état
        switch(state) {
            case 'thinking':
                this.speed = 3.0;
                this.baseReactivity = 0.7;
                break;
            case 'speaking':
                this.speed = 2.5;
                this.baseReactivity = 0.5;
                // La réactivité audio s'ajoutera dynamiquement
                break;
            case 'idle':
            default:
                this.speed = 2.0;
                this.baseReactivity = 0.3;
                this.audioReactivity = 0; // Pas de réactivité audio en idle
                break;
        }
        
        console.log(`🎬 Animation état changé: ${state}, baseReactivity: ${this.baseReactivity}, speed: ${this.speed}`);
    }
    
    // Méthode pour mettre à jour la réactivité audio en temps réel
    updateAudioReactivity(intensity) {
        if (this.currentState === 'speaking') {
            // Normaliser l'intensité audio (0-1) et l'amplifier
            this.audioReactivity = Math.min(intensity * 2.0, 2.0); // Maximum 2.0
        } else {
            this.audioReactivity = 0;
        }
    }
    
    animate(time) {
        this.animationId = requestAnimationFrame((t) => this.animate(t));
        this.globalTime = time || 0;
        
        // Mettre à jour la réactivité totale en temps réel
        this.reactivity = this.baseReactivity + (this.audioReactivity || 0);
        
        if (this.material) {
            this.material.uniforms.time.value = (time || 0) * 0.001 * this.speed;
            // Mettre à jour la réactivité dans les uniforms du shader
            this.material.uniforms.reactivity.value = this.reactivity;
        }
        
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }
    
    onWindowResize() {
        if (!this.container || !this.camera || !this.renderer) return;
        
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
    
    destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        if (this.renderer && this.container) {
            this.container.removeChild(this.renderer.domElement);
            this.renderer.dispose();
        }
        
        if (this.geometry) this.geometry.dispose();
        if (this.material) this.material.dispose();
        
        window.removeEventListener('resize', this.onWindowResize);
    }
}

// Export pour utilisation dans l'application principale
window.MiloAnimation = MiloAnimation; 