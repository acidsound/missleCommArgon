import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { SoundManager } from './audio.js';
import { DefenseWorld } from './world.js';
import {
  CounterMissile,
  EnemyMissile,
  OrbitalBomber,
  PlasmaExplosion,
  ParticleSystem
} from './entities.js';
import { WebXRSubsystem } from './xr.js';

const CAMERA_PRESETS = {
  COMMAND: {
    name: 'COMMAND',
    pos: new THREE.Vector3(0, 62, 108),
    target: new THREE.Vector3(0, 18, -6)
  },
  OVERHEAD: {
    name: 'OVERHEAD',
    pos: new THREE.Vector3(0, 132, 42),
    target: new THREE.Vector3(0, 4, -8)
  },
  CINEMATIC: {
    name: 'LOW ANGLE',
    pos: new THREE.Vector3(0, 25, 92),
    target: new THREE.Vector3(0, 30, -14)
  }
};

const DIFFICULTY_SETTINGS = {
  CADET: { speedMult: 0.78, countMult: 0.85, spawnRateMult: 0.85, label: 'CADET' },
  COMMANDER: { speedMult: 1.0, countMult: 1.0, spawnRateMult: 1.0, label: 'COMMANDER' },
  VANGUARD: { speedMult: 1.25, countMult: 1.25, spawnRateMult: 1.2, label: 'VANGUARD' }
};

class MissileCommand3D {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.radarCanvas = document.getElementById('radar-canvas');
    this.radarCtx = this.radarCanvas ? this.radarCanvas.getContext('2d') : null;
    this.floatingLayer = document.getElementById('floating-labels');

    this.sound = new SoundManager();

    // Game State
    this.state = 'MENU'; // 'MENU' | 'PLAYING' | 'PAUSED' | 'TALLY' | 'GAMEOVER'
    this.difficulty = 'COMMANDER';
    this.score = 0;
    this.highScore = parseInt(localStorage.getItem('aegis_3d_highscore') || '0', 10);
    this.nextBonusCityScore = 10000;
    this.wave = 1;
    this.empCharge = 50; // Starts at 50% so player can earn first EMP quickly
    this.totalKills = 0;
    this.maxChain = 1;

    // Wave Spawning State
    this.enemiesToSpawn = 0;
    this.enemiesSpawned = 0;
    this.spawnTimer = 0;
    this.bomberTimer = 0;

    // Active Entities
    this.counterMissiles = [];
    this.enemyMissiles = [];
    this.bombers = [];
    this.explosions = [];
    this.chainTracker = new Map(); // rootCounterId -> kill count
    this.counterSeq = 1;

    // 3D Aiming & Camera
    this.mouseNDC = new THREE.Vector2(0, 0.15);
    this.mouseScreen = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.raycaster = new THREE.Raycaster();
    this.aimWorldPos = new THREE.Vector3(0, 38, 0);
    this.manualAltitude = 40;
    this.lockedThreat = null;
    this.lockedLeadPos = null;
    this.cameraPresetKey = 'COMMAND';
    this.cameraModeOrbit = false;
    this.screenShake = 0;
    this.bloomEnabled = true;

    this.initThree();
    this.initAimReticle3D();
    this.xr = new WebXRSubsystem(this);
    this.bindEvents();
    this.updateHUD();
    this.renderer.setAnimationLoop(() => this.onAnimationFrame());
  }

  initThree() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02060d);
    this.scene.fog = new THREE.FogExp2(0x02060d, 0.0028);

    this.camera = new THREE.PerspectiveCamera(
      52,
      window.innerWidth / window.innerHeight,
      0.5,
      600
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    // Post-processing with UnrealBloomPass
    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.85, // strength
      0.45, // radius
      0.22  // threshold
    );
    this.composer.addPass(this.bloomPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);

    // OrbitControls (Right-click drag or Middle-click drag rotates, or when Orbit Mode is toggled)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.475;
    this.controls.minPolarAngle = 0.08;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 210;
    this.controls.enablePan = false;
    this.controls.enableZoom = false; // Scroll wheel adjusts 3D intercept altitude unless Ctrl/Alt held
    this.controls.mouseButtons = {
      LEFT: null, // Left-click is dedicated to firing interceptors!
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };

    this.applyCameraPreset('COMMAND');

    // Build 3D World & Particle System
    this.world = new DefenseWorld(this.scene);
    this.particles = new ParticleSystem(this.scene, 420);
    this.clock = new THREE.Clock();
  }

  initAimReticle3D() {
    this.reticleGroup = new THREE.Group();
    this.scene.add(this.reticleGroup);

    // 1. Blast Radius Preview Wireframe Sphere at 3D cursor
    const previewGeo = new THREE.SphereGeometry(13.5, 16, 12);
    const previewEdges = new THREE.EdgesGeometry(previewGeo);
    this.reticleSphereMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.28
    });
    this.reticleSphere = new THREE.LineSegments(previewEdges, this.reticleSphereMat);
    this.reticleGroup.add(this.reticleSphere);

    // 2. Inner 3D Diamond Core at exact detonation point
    const coreGeo = new THREE.OctahedronGeometry(1.3, 0);
    this.reticleCoreMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: true
    });
    this.reticleCore = new THREE.Mesh(coreGeo, this.reticleCoreMat);
    this.reticleGroup.add(this.reticleCore);

    // 3. Vertical Laser Drop-Line to Ground Grid (Y=0)
    const dropPts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -40, 0)];
    this.reticleDropGeo = new THREE.BufferGeometry().setFromPoints(dropPts);
    this.reticleDropMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.45
    });
    this.reticleDropLine = new THREE.Line(this.reticleDropGeo, this.reticleDropMat);
    this.reticleGroup.add(this.reticleDropLine);

    // 4. Ground Footprint Ring on the Tactical Grid Floor
    const footGeo = new THREE.RingGeometry(2.6, 3.2, 24);
    footGeo.rotateX(-Math.PI / 2);
    this.reticleFootMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65
    });
    this.reticleFootRing = new THREE.Mesh(footGeo, this.reticleFootMat);
    this.scene.add(this.reticleFootRing);

    // 5. Threat Lock Highlight Box & Predictive Lead Indicator in 3D
    const lockGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(3.8, 3.8, 3.8));
    this.lockBoxMat = new THREE.LineBasicMaterial({ color: 0xff2a55, transparent: true, opacity: 0.9 });
    this.lockBox = new THREE.LineSegments(lockGeo, this.lockBoxMat);
    this.lockBox.visible = false;
    this.scene.add(this.lockBox);

    const leadGeo = new THREE.RingGeometry(1.7, 2.2, 20);
    this.leadRingMat = new THREE.MeshBasicMaterial({
      color: 0x00ffaa,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9
    });
    this.leadRing = new THREE.Mesh(leadGeo, this.leadRingMat);
    this.leadRing.visible = false;
    this.scene.add(this.leadRing);
  }

  applyCameraPreset(key) {
    const preset = CAMERA_PRESETS[key] || CAMERA_PRESETS.COMMAND;
    this.cameraPresetKey = key;
    this.camera.position.copy(preset.pos);
    this.controls.target.copy(preset.target);
    this.controls.update();

    document.querySelectorAll('.cam-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.cam === key);
    });
  }

  bindEvents() {
    window.addEventListener('resize', () => this.onResize());

    // Prevent context menu on right-click drag
    this.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    // Pointer move -> update 3D aim
    window.addEventListener('pointermove', (e) => {
      this.mouseScreen.x = e.clientX;
      this.mouseScreen.y = e.clientY;
      this.mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;

      const cursorEl = document.getElementById('hud-crosshair');
      if (cursorEl) {
        cursorEl.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      }
    });

    // Left-click on canvas fires interceptor
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (this.state !== 'PLAYING') return;
      if (e.button === 0 && !this.cameraModeOrbit) {
        this.update3DAimPoint();
        this.fireInterceptor(null); // Auto-select optimal battery
      }
    });

    // Scroll wheel adjusts default 3D engagement altitude plane
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.state !== 'PLAYING') return;
        const delta = -Math.sign(e.deltaY) * 3.5;
        this.manualAltitude = Math.max(14, Math.min(82, this.manualAltitude + delta));
        const altSlider = document.getElementById('altitude-slider');
        if (altSlider) altSlider.value = this.manualAltitude;
      },
      { passive: true }
    );

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const code = e.code;

      if (code === 'KeyM') {
        this.toggleAudio();
        return;
      }
      if (code === 'KeyG') {
        this.toggleBloom();
        return;
      }
      if (code === 'KeyC') {
        const keys = Object.keys(CAMERA_PRESETS);
        const nextIdx = (keys.indexOf(this.cameraPresetKey) + 1) % keys.length;
        this.applyCameraPreset(keys[nextIdx]);
        return;
      }
      if (code === 'KeyP' || code === 'Escape') {
        if (this.state === 'PLAYING' || this.state === 'PAUSED') {
          this.togglePause();
        }
        return;
      }

      if (this.state !== 'PLAYING') return;

      // Battery 1 (Alpha - West)
      if (code === 'Digit1' || code === 'KeyQ' || code === 'KeyA') {
        this.fireInterceptor(0);
      }
      // Battery 2 (Bravo - Center Hyper)
      else if (code === 'Digit2' || code === 'KeyW' || code === 'KeyS') {
        this.fireInterceptor(1);
      }
      // Battery 3 (Charlie - East)
      else if (code === 'Digit3' || code === 'KeyE' || code === 'KeyD') {
        this.fireInterceptor(2);
      }
      // Auto-Fire Optimal Battery
      else if (code === 'Space') {
        e.preventDefault();
        this.fireInterceptor(null);
      }
      // Aegis EMP Overdrive
      else if (code === 'KeyF' || code === 'ShiftLeft' || code === 'ShiftRight') {
        this.triggerEmpOverdrive();
      }
    });

    // UI Buttons
    document.querySelectorAll('.diff-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.diff-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.difficulty = btn.dataset.diff;
      });
    });

    const startBtn = document.getElementById('btn-start-game');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        this.sound.init();
        this.startNewGame();
      });
    }

    const restartBtn = document.getElementById('btn-restart-game');
    if (restartBtn) {
      restartBtn.addEventListener('click', () => {
        this.sound.init();
        this.startNewGame();
      });
    }

    const resumeBtn = document.getElementById('btn-resume-game');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => this.togglePause());
    }

    const muteBtn = document.getElementById('btn-mute');
    if (muteBtn) {
      muteBtn.addEventListener('click', () => this.toggleAudio());
    }

    const bloomBtn = document.getElementById('btn-bloom');
    if (bloomBtn) {
      bloomBtn.addEventListener('click', () => this.toggleBloom());
    }

    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => this.togglePause());
    }

    const orbitBtn = document.getElementById('btn-orbit-mode');
    if (orbitBtn) {
      orbitBtn.addEventListener('click', () => {
        this.cameraModeOrbit = !this.cameraModeOrbit;
        this.controls.mouseButtons.LEFT = this.cameraModeOrbit ? THREE.MOUSE.ROTATE : null;
        orbitBtn.classList.toggle('active', this.cameraModeOrbit);
        orbitBtn.textContent = this.cameraModeOrbit ? 'ORBIT DRAG: ON' : 'ORBIT DRAG: R-CLICK';
      });
    }

    document.querySelectorAll('.cam-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.applyCameraPreset(btn.dataset.cam);
      });
    });

    const empBtn = document.getElementById('btn-emp');
    if (empBtn) {
      empBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.state === 'PLAYING') {
          this.triggerEmpOverdrive();
        }
      });
    }

    const altSlider = document.getElementById('altitude-slider');
    if (altSlider) {
      altSlider.addEventListener('input', (e) => {
        this.manualAltitude = parseFloat(e.target.value);
      });
    }

    // Clicking battery cards fires from that specific battery or selects it
    document.querySelectorAll('.battery-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.state === 'PLAYING') {
          const idx = parseInt(card.dataset.battery, 10);
          this.fireInterceptor(idx);
        }
      });
    });
  }

  toggleAudio() {
    const muted = this.sound.toggleMute();
    const btn = document.getElementById('btn-mute');
    if (btn) {
      btn.textContent = muted ? 'AUDIO: OFF' : 'AUDIO: ON';
      btn.classList.toggle('muted', muted);
    }
  }

  toggleBloom() {
    this.bloomEnabled = !this.bloomEnabled;
    const btn = document.getElementById('btn-bloom');
    if (btn) {
      btn.textContent = this.bloomEnabled ? 'BLOOM: ON' : 'BLOOM: OFF';
      btn.classList.toggle('active', this.bloomEnabled);
    }
  }

  togglePause() {
    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
      document.getElementById('modal-pause').classList.remove('hidden');
    } else if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
      this.clock.getDelta();
      document.getElementById('modal-pause').classList.add('hidden');
    }
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  // =========================================================================
  // 3D SMART TARGETING & PREDICTIVE INTERCEPT SYSTEM
  // =========================================================================
  computePredictedIntercept(threat, battery) {
    const speed = battery ? battery.missileSpeed : 130;
    const start = battery ? battery.position : new THREE.Vector3(0, 4, 10);
    const dist = start.distanceTo(threat.position);
    const t = dist / speed;
    const leadPos = threat.position.clone().addScaledVector(threat.velocity, t * 0.85);
    leadPos.y = Math.max(8, leadPos.y);
    return leadPos;
  }

  update3DAimPoint() {
    this.raycaster.setFromCamera(this.mouseNDC, this.camera);
    this.computeAimFromWorldRay(this.raycaster.ray, this.aimWorldPos);
    this.syncReticleToAimWorldPos();
  }

  computeAimFromWorldRay(ray, outTargetPos) {
    const bestBattery = this.findOptimalBattery(outTargetPos) || this.world.batteries[1];

    // 1. Check proximity of ray to any active threat or its predicted lead point
    let closestThreat = null;
    let closestLead = null;
    let closestRayTargetPoint = null;
    let bestScreenScore = 11.5; // Snap radius in 3D world units perpendicular to ray

    const allThreats = [...this.enemyMissiles, ...this.bombers];
    const tmpClosestOnRay = new THREE.Vector3();

    for (const threat of allThreats) {
      if (!threat.alive) continue;

      const leadPos = this.computePredictedIntercept(threat, bestBattery);

      // Distance from ray to threat's current position
      ray.closestPointToPoint(threat.position, tmpClosestOnRay);
      const distToCurrent = tmpClosestOnRay.distanceTo(threat.position);

      // Distance from ray to threat's predicted lead position
      const tmpRayLead = new THREE.Vector3();
      ray.closestPointToPoint(leadPos, tmpRayLead);
      const distToLead = tmpRayLead.distanceTo(leadPos);

      const minDist = Math.min(distToCurrent, distToLead);
      if (minDist < bestScreenScore) {
        bestScreenScore = minDist;
        closestThreat = threat;
        closestLead = leadPos;
        // Project cursor onto the exact depth distance of the threat/lead along the ray
        const targetDepthDist =
          distToLead < distToCurrent
            ? ray.origin.distanceTo(leadPos)
            : ray.origin.distanceTo(threat.position);
        closestRayTargetPoint = new THREE.Vector3()
          .copy(ray.direction)
          .multiplyScalar(targetDepthDist)
          .add(ray.origin);
      }
    }

    if (closestThreat && closestRayTargetPoint) {
      this.lockedThreat = closestThreat;
      this.lockedLeadPos = closestLead;
      if (closestRayTargetPoint.distanceTo(closestLead) < 6.5) {
        outTargetPos.copy(closestRayTargetPoint).lerp(closestLead, 0.45);
      } else {
        outTargetPos.copy(closestRayTargetPoint);
      }
    } else {
      this.lockedThreat = null;
      this.lockedLeadPos = null;

      // 2. Intersect with sloped Tactical Engagement Plane at `manualAltitude`
      const planeNormal = new THREE.Vector3(0, 0.94, 0.34).normalize();
      const planePoint = new THREE.Vector3(0, this.manualAltitude, 0);
      const tacticalPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, planePoint);

      const hitPoint = new THREE.Vector3();
      const hit = ray.intersectPlane(tacticalPlane, hitPoint);
      if (hit) {
        outTargetPos.copy(hitPoint);
      } else {
        outTargetPos.copy(ray.direction).multiplyScalar(110).add(ray.origin);
      }
    }

    // Clamp to valid tactical defense airspace
    outTargetPos.x = Math.max(-88, Math.min(88, outTargetPos.x));
    outTargetPos.z = Math.max(-68, Math.min(48, outTargetPos.z));
    outTargetPos.y = Math.max(9, Math.min(92, outTargetPos.y));
  }

  syncReticleToAimWorldPos() {
    const bestBattery = this.findOptimalBattery(this.aimWorldPos) || this.world.batteries[1];

    // Update 3D Reticle Visuals
    this.reticleGroup.position.copy(this.aimWorldPos);
    this.reticleCore.rotation.y += 0.06;
    this.reticleCore.rotation.x += 0.04;

    const dropAttr = this.reticleDropGeo.attributes.position;
    dropAttr.setXYZ(1, 0, -this.aimWorldPos.y + 0.15, 0);
    dropAttr.needsUpdate = true;

    this.reticleFootRing.position.set(this.aimWorldPos.x, 0.18, this.aimWorldPos.z);

    if (this.lockedThreat && this.lockedLeadPos) {
      this.reticleCoreMat.color.setHex(0x00ffaa);
      this.reticleSphereMat.color.setHex(0x00ffaa);
      this.reticleSphereMat.opacity = 0.42;
      this.reticleFootMat.color.setHex(0x00ffaa);

      this.lockBox.visible = true;
      this.lockBox.position.copy(this.lockedThreat.position);
      this.lockBox.rotation.y += 0.08;

      this.leadRing.visible = true;
      this.leadRing.position.copy(this.lockedLeadPos);
      const camPos = new THREE.Vector3();
      this.camera.getWorldPosition(camPos);
      this.leadRing.lookAt(camPos);
    } else {
      this.reticleCoreMat.color.setHex(0x00f0ff);
      this.reticleSphereMat.color.setHex(0x00f0ff);
      this.reticleSphereMat.opacity = 0.22;
      this.reticleFootMat.color.setHex(0x00f0ff);
      this.lockBox.visible = false;
      this.leadRing.visible = false;
    }

    // Update 2D Crosshair telemetry
    const lockReadout = document.getElementById('crosshair-readout');
    if (lockReadout) {
      const alt = Math.round(this.aimWorldPos.y * 10);
      const eta = bestBattery
        ? (bestBattery.position.distanceTo(this.aimWorldPos) / bestBattery.missileSpeed).toFixed(1)
        : '--';
      const lockStr = this.lockedThreat ? `LOCK: ${this.lockedThreat.type}` : `ALT: ${alt}m`;
      lockReadout.textContent = `${lockStr} · T-${eta}s`;
      lockReadout.classList.toggle('locked', !!this.lockedThreat);
    }
  }

  findOptimalBattery(targetPos) {
    let best = null;
    let bestScore = Infinity;

    for (const b of this.world.batteries) {
      if (!b.canFire()) continue;
      const dist = b.position.distanceTo(targetPos);
      const flightTime = dist / b.missileSpeed;
      // Weight flight time + slight preference for batteries with more ammo remaining
      const score = flightTime - (b.ammo / b.maxAmmo) * 0.14;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  fireInterceptor(batteryIndex = null) {
    let battery = null;
    if (batteryIndex !== null && batteryIndex >= 0 && batteryIndex < this.world.batteries.length) {
      battery = this.world.batteries[batteryIndex];
      // If requested battery is out of ammo, fallback to optimal available
      if (!battery.canFire()) {
        battery = this.findOptimalBattery(this.aimWorldPos);
      }
    } else {
      battery = this.findOptimalBattery(this.aimWorldPos);
    }

    if (!battery || !battery.canFire()) {
      this.sound.playEmptyClick();
      this.flashHUDMessage('ALL BATTERIES DEPLETED!', '#ff3344');
      return;
    }

    battery.aimAt(this.aimWorldPos);
    battery.consumeAmmo();

    const muzzlePos = battery.getMuzzleWorldPosition();
    const cm = new CounterMissile(
      this.scene,
      muzzlePos,
      this.aimWorldPos,
      battery.missileSpeed,
      battery.blastRadius,
      battery.color,
      battery.isHyper
    );
    cm.id = this.counterSeq++;
    this.counterMissiles.push(cm);

    this.particles.spawn(muzzlePos, battery.color, 8, 12, 0.35);
    this.sound.playLaunch(battery.isHyper);
    this.updateHUD();
  }

  triggerEmpOverdrive() {
    if (this.empCharge < 100) {
      this.sound.playEmptyClick();
      return;
    }

    this.empCharge = 0;
    this.sound.playEmpPulse();
    this.screenShake = Math.max(this.screenShake, 1.3);
    this.flashHUDMessage('AEGIS EMP OVERDRIVE DETONATED!', '#00ffaa');

    // Sort all threats by lowest altitude (most urgent first) and detonate flak spheres on up to 7 threats
    const threats = [...this.enemyMissiles, ...this.bombers]
      .filter((t) => t.alive)
      .sort((a, b) => a.position.y - b.position.y);

    const targets = threats.slice(0, 7);
    const empRootId = this.counterSeq++;

    if (targets.length === 0) {
      // Decorative sky dome burst if no threats currently present
      for (let i = 0; i < 4; i++) {
        const pos = new THREE.Vector3((i - 1.5) * 32, 42, -10);
        this.spawnExplosion(pos, 16, {
          isPlayerOriginated: true,
          baseColor: 0x00ffaa,
          rootCounterId: empRootId
        });
      }
    } else {
      targets.forEach((t) => {
        this.spawnExplosion(t.position.clone(), 16.5, {
          isPlayerOriginated: true,
          baseColor: 0x00ffaa,
          rootCounterId: empRootId
        });
      });
    }

    this.updateHUD();
  }

  // =========================================================================
  // WAVE & GAME FLOW MANAGEMENT
  // =========================================================================
  startNewGame() {
    this.clearAllEntities();

    this.score = 0;
    this.wave = 1;
    this.empCharge = 50;
    this.totalKills = 0;
    this.maxChain = 1;
    this.nextBonusCityScore = 10000;

    for (const city of this.world.cities) city.rebuild();
    for (const battery of this.world.batteries) battery.refill();

    document.getElementById('modal-menu').classList.add('hidden');
    document.getElementById('modal-gameover').classList.add('hidden');
    document.getElementById('modal-tally').classList.add('hidden');
    document.getElementById('modal-pause').classList.add('hidden');

    this.startWave(1);
  }

  clearAllEntities() {
    this.counterMissiles.forEach((c) => c.dispose());
    this.enemyMissiles.forEach((m) => m.dispose());
    this.bombers.forEach((b) => b.dispose());
    this.explosions.forEach((e) => e.dispose());

    this.counterMissiles = [];
    this.enemyMissiles = [];
    this.bombers = [];
    this.explosions = [];
    this.chainTracker.clear();
  }

  getWaveMultiplier() {
    return Math.min(6, Math.floor((this.wave + 1) / 2));
  }

  startWave(waveNum) {
    this.wave = waveNum;
    this.state = 'PLAYING';

    // Refill all 3 batteries at start of each wave
    for (const battery of this.world.batteries) {
      battery.refill();
    }

    const diff = DIFFICULTY_SETTINGS[this.difficulty] || DIFFICULTY_SETTINGS.COMMANDER;
    this.enemiesToSpawn = Math.round((8 + waveNum * 4) * diff.countMult);
    this.enemiesSpawned = 0;
    this.spawnTimer = 0.6;
    this.bomberTimer = waveNum >= 2 ? 4.5 : 999;

    this.sound.playWaveStart();
    this.flashHUDMessage(`WAVE ${waveNum} INCOMING · ${this.getWaveMultiplier()}X SCORE`, '#00f0ff');
    this.updateHUD();
  }

  pickRandomTarget() {
    const aliveCities = this.world.cities.filter((c) => c.alive);
    const aliveBatteries = this.world.batteries.filter((b) => b.alive);

    // 72% chance to target a surviving city, 28% chance to target a battery
    if (aliveCities.length > 0 && (Math.random() < 0.72 || aliveBatteries.length === 0)) {
      const city = aliveCities[Math.floor(Math.random() * aliveCities.length)];
      return { obj: city, pos: city.position.clone().add(new THREE.Vector3(0, 1.5, 0)) };
    }
    if (aliveBatteries.length > 0) {
      const bat = aliveBatteries[Math.floor(Math.random() * aliveBatteries.length)];
      return { obj: bat, pos: bat.position.clone().add(new THREE.Vector3(0, 3.0, 0)) };
    }
    // Fallback if all destroyed
    const fallback = this.world.cities[Math.floor(Math.random() * this.world.cities.length)];
    return { obj: fallback, pos: fallback.position.clone() };
  }

  spawnEnemyWaveMissile(customOrigin = null, forcedType = null) {
    const diff = DIFFICULTY_SETTINGS[this.difficulty] || DIFFICULTY_SETTINGS.COMMANDER;
    const target = this.pickRandomTarget();

    const startPos =
      customOrigin ||
      new THREE.Vector3(
        (Math.random() - 0.5) * 145,
        88 + Math.random() * 16,
        -48 + (Math.random() - 0.5) * 45
      );

    let type = forcedType || 'ICBM';
    if (!forcedType) {
      const r = Math.random();
      if (this.wave >= 3 && r < 0.2 + Math.min(0.18, this.wave * 0.02)) {
        type = 'SMART';
      } else if (this.wave >= 2 && r < 0.42) {
        type = 'MIRV';
      }
    }

    const baseSpeed = (13.5 + this.wave * 1.65) * diff.speedMult;
    const speed =
      type === 'SMART'
        ? baseSpeed * 1.22
        : type === 'MIRV'
        ? baseSpeed * 0.92
        : baseSpeed * (0.9 + Math.random() * 0.25);

    const missile = new EnemyMissile(this.scene, {
      type,
      startPos,
      targetObj: target.obj,
      targetPos: target.pos,
      speed
    });
    this.enemyMissiles.push(missile);
  }

  spawnOrbitalBomber() {
    const diff = DIFFICULTY_SETTINGS[this.difficulty] || DIFFICULTY_SETTINGS.COMMANDER;
    const fromLeft = Math.random() < 0.5;
    const alt = 54 + Math.random() * 14;
    const z = -22 + (Math.random() - 0.5) * 28;
    const startPos = new THREE.Vector3(fromLeft ? -105 : 105, alt, z);
    const endPos = new THREE.Vector3(fromLeft ? 105 : -105, alt, z + (Math.random() - 0.5) * 16);

    const bomber = new OrbitalBomber(this.scene, {
      startPos,
      endPos,
      speed: (18 + this.wave * 1.2) * diff.speedMult,
      dropInterval: Math.max(2.0, 3.6 - this.wave * 0.15),
      maxDrops: 2 + Math.min(3, Math.floor(this.wave / 2))
    });
    this.bombers.push(bomber);
    this.flashHUDMessage('WARNING: ORBITAL BOMBER IN SECTOR!', '#ff0055');
  }

  spawnExplosion(position, maxRadius, options = {}) {
    const exp = new PlasmaExplosion(this.scene, position, maxRadius, options);
    this.explosions.push(exp);
    return exp;
  }

  addScore(points, worldPos = null, labelPrefix = '') {
    const prevScore = this.score;
    this.score += points;

    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('aegis_3d_highscore', String(this.highScore));
    }

    // Check bonus city threshold (every 10,000 pts)
    if (this.score >= this.nextBonusCityScore && prevScore < this.nextBonusCityScore) {
      this.nextBonusCityScore += 10000;
      const deadCity = this.world.cities.find((c) => !c.alive);
      if (deadCity) {
        deadCity.rebuild();
        this.particles.spawn(deadCity.position.clone().add(new THREE.Vector3(0, 8, 0)), 0x00ffaa, 28, 22, 1.1);
        this.flashHUDMessage(`BONUS CITY REBUILT: ${deadCity.name}!`, '#00ffaa');
      }
    }

    if (worldPos) {
      this.spawnFloatingText(
        worldPos,
        labelPrefix ? `${labelPrefix} +${points}` : `+${points}`,
        labelPrefix ? '#00ffaa' : '#7ef9ff'
      );
    }
  }

  spawnFloatingText(worldPos, text, color = '#00f0ff') {
    if (!this.floatingLayer) return;
    const screenPos = worldPos.clone().project(this.camera);
    if (screenPos.z > 1) return;

    const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(screenPos.y * 0.5) + 0.5) * window.innerHeight;

    const el = document.createElement('div');
    el.className = 'floating-score';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.color = color;
    el.textContent = text;
    this.floatingLayer.appendChild(el);

    setTimeout(() => {
      el.remove();
    }, 950);
  }

  flashHUDMessage(text, color = '#00f0ff') {
    const banner = document.getElementById('hud-alert-banner');
    if (!banner) return;
    banner.textContent = text;
    banner.style.borderColor = color;
    banner.style.color = color;
    banner.classList.remove('hidden');
    clearTimeout(this.bannerTimeout);
    this.bannerTimeout = setTimeout(() => {
      banner.classList.add('hidden');
    }, 2600);
  }

  // =========================================================================
  // END OF WAVE TALLY & GAME OVER
  // =========================================================================
  triggerWaveEnd() {
    const survivingCities = this.world.cities.filter((c) => c.alive);
    if (survivingCities.length === 0) {
      this.triggerGameOver();
      return;
    }

    this.state = 'TALLY';
    const mult = this.getWaveMultiplier();
    const remainingAmmo = this.world.batteries.reduce((acc, b) => acc + (b.alive ? b.ammo : 0), 0);
    const ammoBonus = remainingAmmo * 10 * mult;
    const cityBonus = survivingCities.length * 100 * mult;
    const totalWaveBonus = ammoBonus + cityBonus;

    this.addScore(totalWaveBonus);
    this.sound.playTallyTick(1.25);

    const modal = document.getElementById('modal-tally');
    document.getElementById('tally-wave-title').textContent = `WAVE ${this.wave} DEFEATED`;
    document.getElementById('tally-ammo-val').textContent = `${remainingAmmo} × ${10 * mult} = +${ammoBonus}`;
    document.getElementById('tally-city-val').textContent = `${survivingCities.length} × ${100 * mult} = +${cityBonus}`;
    document.getElementById('tally-total-val').textContent = `+${totalWaveBonus}`;
    modal.classList.remove('hidden');

    this.updateHUD();

    setTimeout(() => {
      if (this.state === 'TALLY') {
        modal.classList.add('hidden');
        this.startWave(this.wave + 1);
      }
    }, 3200);
  }

  triggerGameOver() {
    this.state = 'GAMEOVER';
    this.sound.playCityDestroyed();

    const modal = document.getElementById('modal-gameover');
    document.getElementById('go-score').textContent = this.score.toLocaleString();
    document.getElementById('go-highscore').textContent = this.highScore.toLocaleString();
    document.getElementById('go-waves').textContent = this.wave;
    document.getElementById('go-kills').textContent = this.totalKills;
    document.getElementById('go-chain').textContent = `${this.maxChain}x`;
    modal.classList.remove('hidden');
  }

  // =========================================================================
  // MAIN SIMULATION STEP
  // =========================================================================
  updateGameplay(dt, elapsed) {
    const diff = DIFFICULTY_SETTINGS[this.difficulty] || DIFFICULTY_SETTINGS.COMMANDER;

    // 1. Spawn Wave Threats
    const totalAmmoRemaining = this.world.batteries.reduce((s, b) => s + (b.alive ? b.ammo : 0), 0);
    // Fast-forward enemy speed if player is completely out of ammo and no counter-missiles remain
    const timeScale =
      totalAmmoRemaining === 0 && this.counterMissiles.length === 0 && this.explosions.length === 0
        ? 3.2
        : 1.0;
    const simDt = dt * timeScale;

    if (this.enemiesSpawned < this.enemiesToSpawn) {
      this.spawnTimer -= simDt;
      if (this.spawnTimer <= 0) {
        // Spawn a salvo of 1 to 3 warheads
        const maxSalvo = Math.min(3, 1 + Math.floor(this.wave / 2));
        const salvoCount = Math.min(
          this.enemiesToSpawn - this.enemiesSpawned,
          1 + Math.floor(Math.random() * maxSalvo)
        );
        for (let i = 0; i < salvoCount; i++) {
          this.spawnEnemyWaveMissile();
          this.enemiesSpawned++;
        }
        const baseInterval = Math.max(0.85, 2.5 - this.wave * 0.14) / diff.spawnRateMult;
        this.spawnTimer = baseInterval * (0.75 + Math.random() * 0.5);
      }
    }

    if (this.wave >= 2 && this.enemiesSpawned < this.enemiesToSpawn) {
      this.bomberTimer -= simDt;
      if (this.bomberTimer <= 0 && this.bombers.length < 1) {
        this.spawnOrbitalBomber();
        this.bomberTimer = 14 + Math.random() * 8;
      }
    }

    // 2. Update Counter-Missiles
    for (let i = this.counterMissiles.length - 1; i >= 0; i--) {
      const cm = this.counterMissiles[i];
      const detonated = cm.update(simDt, this.particles);
      if (detonated) {
        this.spawnExplosion(cm.targetPos, cm.blastRadius, {
          isPlayerOriginated: true,
          baseColor: cm.color,
          rootCounterId: cm.id,
          chainGeneration: 0
        });
        this.particles.spawn(cm.targetPos, cm.color, 18, 22, 0.65);
        this.sound.playExplosion(1.0, false);
        this.screenShake = Math.max(this.screenShake, 0.25);
        cm.dispose();
        this.counterMissiles.splice(i, 1);
      }
    }

    // 3. Update Plasma Explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const exp = this.explosions[i];
      exp.update(simDt, elapsed);
      if (!exp.alive) {
        exp.dispose();
        this.explosions.splice(i, 1);
      }
    }

    // 4. Update Enemy Missiles & Check Intercepts / Impacts / Splits
    for (let i = this.enemyMissiles.length - 1; i >= 0; i--) {
      const em = this.enemyMissiles[i];

      // Check collision with any active PlasmaExplosion
      let interceptedBy = null;
      for (const exp of this.explosions) {
        if (exp.containsPoint(em.position, em.hitRadius)) {
          interceptedBy = exp;
          break;
        }
      }

      if (interceptedBy) {
        em.alive = false;
        this.handleEnemyKilled(em, interceptedBy);
        em.dispose();
        this.enemyMissiles.splice(i, 1);
        continue;
      }

      const status = em.update(simDt, elapsed, this.explosions, this.particles);

      if (status.shouldSplit) {
        // MIRV splits into 2-3 new warheads!
        this.sound.playMirvSplit();
        this.particles.spawn(em.position, 0xd946ef, 14, 16, 0.5);
        const childrenCount = 2 + (this.wave >= 4 ? 1 : 0);
        for (let c = 0; c < childrenCount; c++) {
          this.spawnEnemyWaveMissile(em.position.clone(), 'ICBM');
        }
      }

      if (status.hitGround) {
        this.handleGroundImpact(em);
        em.dispose();
        this.enemyMissiles.splice(i, 1);
      }
    }

    // 5. Update Orbital Bombers
    for (let i = this.bombers.length - 1; i >= 0; i--) {
      const bomber = this.bombers[i];

      let interceptedBy = null;
      for (const exp of this.explosions) {
        if (exp.containsPoint(bomber.position, bomber.hitRadius)) {
          interceptedBy = exp;
          break;
        }
      }

      if (interceptedBy) {
        bomber.alive = false;
        this.handleEnemyKilled(bomber, interceptedBy);
        bomber.dispose();
        this.bombers.splice(i, 1);
        continue;
      }

      const bStatus = bomber.update(simDt, this.particles);
      if (bStatus.dropPayload) {
        this.spawnEnemyWaveMissile(bomber.position.clone(), 'ICBM');
        this.sound.playMirvSplit();
      }
      if (bStatus.exited) {
        bomber.dispose();
        this.bombers.splice(i, 1);
      }
    }

    // 6. Check if all cities are destroyed -> instant Game Over
    const aliveCities = this.world.cities.filter((c) => c.alive).length;
    if (aliveCities === 0 && this.explosions.length === 0) {
      this.triggerGameOver();
      return;
    }

    // 7. Check if Wave is complete
    if (
      this.enemiesSpawned >= this.enemiesToSpawn &&
      this.enemyMissiles.length === 0 &&
      this.bombers.length === 0 &&
      this.counterMissiles.length === 0 &&
      this.explosions.length === 0
    ) {
      this.triggerWaveEnd();
    }
  }

  handleEnemyKilled(enemy, causeExplosion) {
    this.totalKills++;
    const rootId = causeExplosion.rootCounterId || 0;
    const chainCount = (this.chainTracker.get(rootId) || 0) + 1;
    this.chainTracker.set(rootId, chainCount);
    if (chainCount > this.maxChain) {
      this.maxChain = chainCount;
    }

    // Spawn secondary chain-reaction plasma explosion at the destroyed warhead's 3D position!
    this.spawnExplosion(enemy.position, 11.5, {
      isPlayerOriginated: true,
      baseColor: enemy.color,
      rootCounterId: rootId,
      chainGeneration: (causeExplosion.chainGeneration || 0) + 1
    });

    this.particles.spawn(enemy.position, enemy.color, 22, 24, 0.75);
    this.sound.playExplosion(1.1, true);
    this.sound.playComboChime(chainCount);
    this.screenShake = Math.max(this.screenShake, 0.35);

    const waveMult = this.getWaveMultiplier();
    const chainBonusMult = chainCount > 1 ? chainCount : 1;
    const pts = enemy.basePoints * waveMult * chainBonusMult;
    const prefix = chainCount > 1 ? `CHAIN ${chainCount}X` : enemy.type !== 'ICBM' ? enemy.type : '';

    this.addScore(pts, enemy.position, prefix);

    // Charge Aegis EMP Overdrive
    this.empCharge = Math.min(100, this.empCharge + (chainCount > 1 ? 14 : 9));
    if (this.xr && this.renderer.xr.isPresenting) {
      this.xr.triggerHaptic(this.xr.activeControllerIndex, Math.min(1.0, 0.35 + chainCount * 0.15), 60);
    }
    this.updateHUD();
  }

  handleGroundImpact(enemy) {
    this.spawnExplosion(enemy.targetPos, 15.0, {
      isPlayerOriginated: false,
      baseColor: 0xff2a00,
      expandDuration: 0.55,
      holdDuration: 0.35
    });
    this.particles.spawn(enemy.targetPos, 0xff4400, 35, 28, 1.0);
    this.screenShake = Math.max(this.screenShake, 1.4);

    if (this.xr && this.renderer.xr.isPresenting) {
      this.xr.triggerHaptic(0, 1.0, 220);
      this.xr.triggerHaptic(1, 1.0, 220);
    }

    if (enemy.targetObj && enemy.targetObj.alive) {
      enemy.targetObj.destroy();
      this.sound.playCityDestroyed();
      if (enemy.targetObj.name) {
        this.flashHUDMessage(`CRITICAL: ${enemy.targetObj.name} DESTROYED!`, '#ff2a55');
      } else if (enemy.targetObj.code) {
        this.flashHUDMessage(`BATTERY ${enemy.targetObj.code} KNOCKED OUT!`, '#ff8800');
      }
    } else {
      this.sound.playExplosion(1.3, false);
    }

    this.updateHUD();
  }

  // =========================================================================
  // RADAR MINIMAP & HUD RENDERING
  // =========================================================================
  renderRadarMinimap() {
    if (!this.radarCtx || !this.radarCanvas) return;
    const ctx = this.radarCtx;
    const w = this.radarCanvas.width;
    const h = this.radarCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = w * 0.45;
    const worldScale = r / 95; // Maps [-95..95] world X/Z onto radar circle

    ctx.clearRect(0, 0, w, h);

    // Background circle
    ctx.fillStyle = 'rgba(3, 14, 28, 0.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Range rings
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
    ctx.lineWidth = 1;
    [0.33, 0.66, 1.0].forEach((frac) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r * frac, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // Rotating sweep line
    const sweepAngle = this.world.radarAngle;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.65)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweepAngle) * r, cy + Math.sin(sweepAngle) * r);
    ctx.stroke();

    // Draw Cities
    for (const city of this.world.cities) {
      const px = cx + city.position.x * worldScale;
      const py = cy + city.position.z * worldScale;
      ctx.fillStyle = city.alive ? '#00f0ff' : '#ff2244';
      ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
    }

    // Draw Batteries
    for (const bat of this.world.batteries) {
      const px = cx + bat.position.x * worldScale;
      const py = cy + bat.position.z * worldScale;
      ctx.fillStyle = bat.alive && bat.ammo > 0 ? '#00ffaa' : '#663333';
      ctx.beginPath();
      ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw Player 3D Reticle ground footprint
    const rx = cx + this.aimWorldPos.x * worldScale;
    const ry = cy + this.aimWorldPos.z * worldScale;
    ctx.strokeStyle = '#00ffaa';
    ctx.beginPath();
    ctx.arc(rx, ry, 4.5, 0, Math.PI * 2);
    ctx.stroke();

    // Draw Enemy Blips
    for (const em of this.enemyMissiles) {
      const px = cx + em.position.x * worldScale;
      const py = cy + em.position.z * worldScale;
      if (Math.hypot(px - cx, py - cy) > r) continue;
      ctx.fillStyle =
        em.type === 'MIRV' ? '#d946ef' : em.type === 'SMART' ? '#ffbe0b' : '#ff3344';
      ctx.beginPath();
      ctx.arc(px, py, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const b of this.bombers) {
      const px = cx + b.position.x * worldScale;
      const py = cy + b.position.z * worldScale;
      if (Math.hypot(px - cx, py - cy) > r) continue;
      ctx.fillStyle = '#ff0055';
      ctx.fillRect(px - 3.5, py - 3.5, 7, 7);
    }
  }

  updateHUD() {
    const scoreEl = document.getElementById('hud-score');
    const highEl = document.getElementById('hud-highscore');
    const waveEl = document.getElementById('hud-wave');
    const multEl = document.getElementById('hud-mult');
    const threatsEl = document.getElementById('hud-threats');
    const citiesEl = document.getElementById('hud-cities');

    if (scoreEl) scoreEl.textContent = this.score.toLocaleString();
    if (highEl) highEl.textContent = this.highScore.toLocaleString();
    if (waveEl) waveEl.textContent = this.wave;
    if (multEl) multEl.textContent = `${this.getWaveMultiplier()}X`;

    const remainingThreats =
      Math.max(0, this.enemiesToSpawn - this.enemiesSpawned) +
      this.enemyMissiles.length +
      this.bombers.length;
    if (threatsEl) threatsEl.textContent = remainingThreats;

    const aliveCities = this.world.cities.filter((c) => c.alive).length;
    if (citiesEl) citiesEl.textContent = `${aliveCities} / 6`;

    // Update Battery Cards
    this.world.batteries.forEach((b, idx) => {
      const card = document.getElementById(`battery-card-${idx}`);
      const countEl = document.getElementById(`battery-ammo-${idx}`);
      const pipsEl = document.getElementById(`battery-pips-${idx}`);

      if (card) {
        card.classList.toggle('depleted', !b.alive || b.ammo === 0);
      }
      if (countEl) {
        countEl.textContent = b.alive ? `${b.ammo}/${b.maxAmmo}` : 'OFFLINE';
      }
      if (pipsEl) {
        pipsEl.innerHTML = '';
        for (let i = 0; i < b.maxAmmo; i++) {
          const span = document.createElement('span');
          span.className = 'ammo-pip' + (b.alive && i < b.ammo ? ' active' : '');
          pipsEl.appendChild(span);
        }
      }
    });

    // Update EMP Bar
    const empFill = document.getElementById('emp-bar-fill');
    const empBtn = document.getElementById('btn-emp');
    if (empFill) {
      empFill.style.width = `${this.empCharge}%`;
    }
    if (empBtn) {
      const ready = this.empCharge >= 100;
      empBtn.classList.toggle('ready', ready);
      empBtn.textContent = ready
        ? '[F] AEGIS EMP READY!'
        : `EMP CHARGE ${Math.floor(this.empCharge)}%`;
    }

    if (this.xr && this.renderer.xr.isPresenting) {
      this.xr.updateHoloConsole();
    }
  }

  // =========================================================================
  // ANIMATION LOOP (WEBXR + DESKTOP COMPATIBLE)
  // =========================================================================
  onAnimationFrame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.elapsedTime;
    const isXR = this.renderer.xr.isPresenting;

    if (isXR) {
      this.xr.update(dt);
      this.world.update(dt, elapsed, this.aimWorldPos);
      if (this.state === 'PLAYING') {
        this.updateGameplay(dt, elapsed);
      }
      this.particles.update(dt);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.state === 'MENU') {
      // Gently orbit camera around the defended sector on title screen
      const angle = elapsed * 0.14;
      this.camera.position.x = Math.sin(angle) * 105;
      this.camera.position.z = Math.cos(angle) * 105;
      this.camera.position.y = 56 + Math.sin(elapsed * 0.3) * 8;
      this.camera.lookAt(0, 14, 0);
      this.world.update(dt, elapsed, new THREE.Vector3(Math.sin(elapsed) * 35, 45, 0));
    } else {
      this.controls.update();
      this.update3DAimPoint();
      this.world.update(dt, elapsed, this.aimWorldPos);

      if (this.state === 'PLAYING') {
        this.updateGameplay(dt, elapsed);
      }
    }

    this.particles.update(dt);
    this.renderRadarMinimap();

    // Apply subtle camera shake if active
    let shakeOffset = null;
    if (this.screenShake > 0.01) {
      shakeOffset = new THREE.Vector3(
        (Math.random() - 0.5) * this.screenShake * 1.6,
        (Math.random() - 0.5) * this.screenShake * 1.6,
        (Math.random() - 0.5) * this.screenShake * 1.6
      );
      this.camera.position.add(shakeOffset);
      this.screenShake = Math.max(0, this.screenShake - dt * 3.8);
    }

    if (this.bloomEnabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (shakeOffset) {
      this.camera.position.sub(shakeOffset);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.game = new MissileCommand3D();
});
