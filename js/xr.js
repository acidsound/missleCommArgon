import * as THREE from 'three';

export const XR_SCALE_PRESETS = [
  {
    key: 'TABLETOP',
    label: 'TABLETOP WAR ROOM (1:40)',
    scale: 40,
    position: new THREE.Vector3(0, -14, 72)
  },
  {
    key: 'COMMANDER',
    label: 'TACTICAL COMMANDER (1:16)',
    scale: 16,
    position: new THREE.Vector3(0, 6, 86)
  },
  {
    key: 'CITADEL',
    label: 'GIANT CITADEL (1:1)',
    scale: 1.0,
    position: new THREE.Vector3(0, 34, 96)
  }
];

export class WebXRSubsystem {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.renderer = game.renderer;
    this.camera = game.camera;

    this.isSupportedVR = false;
    this.isSupportedAR = false;
    this.currentSession = null;
    this.sessionMode = null; // 'immersive-vr' | 'immersive-ar'

    this.scaleIndex = 0; // Default to TABLETOP WAR ROOM for comfortable stereo depth
    this.activeControllerIndex = 1; // Default right hand (1) or whichever moved/triggered last

    // XR Rig holds the camera, controllers, and 3D Holographic Command Deck
    this.xrRig = new THREE.Group();
    this.xrRig.name = 'XRRig';
    this.scene.add(this.xrRig);

    this.controllers = [];
    this.SnapTurnCooldown = 0;
    this.buttonStates = [
      { a: false, b: false },
      { a: false, b: false }
    ];

    this.tempMatrix = new THREE.Matrix4();
    this.rayOrigin = new THREE.Vector3();
    this.rayDir = new THREE.Vector3();

    this.initXRConfig();
    this.buildControllers();
    this.build3DHoloConsole();
    this.detectXRCapabilities();
  }

  initXRConfig() {
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');

    this.renderer.xr.addEventListener('sessionstart', () => this.onSessionStart());
    this.renderer.xr.addEventListener('sessionend', () => this.onSessionEnd());
  }

  async detectXRCapabilities() {
    const vrBtn = document.getElementById('btn-enter-vr');
    const arBtn = document.getElementById('btn-enter-ar');
    const menuVrBtn = document.getElementById('btn-menu-vr');
    const statusBadge = document.getElementById('xr-status-badge');

    if (!('xr' in navigator) || !navigator.xr) {
      if (statusBadge) {
        statusBadge.textContent = 'WEBXR: BROWSER / HTTPS REQUIRED';
        statusBadge.classList.add('warn');
      }
      this.setupFallbackButtonListeners(vrBtn, arBtn, menuVrBtn);
      return;
    }

    try {
      this.isSupportedVR = await navigator.xr.isSessionSupported('immersive-vr');
    } catch (e) {
      this.isSupportedVR = false;
    }

    try {
      this.isSupportedAR = await navigator.xr.isSessionSupported('immersive-ar');
    } catch (e) {
      this.isSupportedAR = false;
    }

    if (statusBadge) {
      if (this.isSupportedVR || this.isSupportedAR) {
        const modes = [
          this.isSupportedVR ? 'VR' : null,
          this.isSupportedAR ? 'MR/AR' : null
        ]
          .filter(Boolean)
          .join(' + ');
        statusBadge.textContent = `WEBXR READY (${modes})`;
        statusBadge.classList.add('ready');
      } else {
        statusBadge.textContent = 'WEBXR: HEADSET / EMULATOR STANDBY';
      }
    }

    if (vrBtn) {
      vrBtn.classList.toggle('xr-ready', this.isSupportedVR);
      vrBtn.textContent = this.isSupportedVR ? 'ENTER VR' : 'VR (NO HEADSET)';
    }
    if (arBtn) {
      arBtn.classList.toggle('xr-ready', this.isSupportedAR);
      arBtn.textContent = this.isSupportedAR ? 'ENTER MR/AR' : 'MR/AR';
    }
    if (menuVrBtn) {
      menuVrBtn.classList.toggle('xr-ready', this.isSupportedVR || this.isSupportedAR);
      menuVrBtn.textContent = this.isSupportedVR
        ? 'LAUNCH IN WEBXR (VR HEADSET)'
        : this.isSupportedAR
        ? 'LAUNCH IN WEBXR (MR / AR)'
        : 'LAUNCH WEBXR (HEADSET / EMULATOR)';
    }

    this.setupButtonListeners(vrBtn, arBtn, menuVrBtn);
  }

  setupFallbackButtonListeners(vrBtn, arBtn, menuVrBtn) {
    const notify = () => {
      this.game.flashHUDMessage(
        'WEBXR NOT DETECTED — CONNECT QUEST/VISION PRO OR INSTALL WEBXR EMULATOR',
        '#ffbe0b'
      );
    };
    if (vrBtn) vrBtn.addEventListener('click', notify);
    if (arBtn) arBtn.addEventListener('click', notify);
    if (menuVrBtn) menuVrBtn.addEventListener('click', notify);
  }

  setupButtonListeners(vrBtn, arBtn, menuVrBtn) {
    if (vrBtn) {
      vrBtn.addEventListener('click', () => this.toggleXRSession('immersive-vr'));
    }
    if (arBtn) {
      arBtn.addEventListener('click', () => this.toggleXRSession('immersive-ar'));
    }
    if (menuVrBtn) {
      menuVrBtn.addEventListener('click', () => {
        const preferred = this.isSupportedVR
          ? 'immersive-vr'
          : this.isSupportedAR
          ? 'immersive-ar'
          : 'immersive-vr';
        this.toggleXRSession(preferred);
      });
    }
  }

  async toggleXRSession(mode = 'immersive-vr') {
    if (this.currentSession) {
      await this.currentSession.end();
      return;
    }

    if (!navigator.xr) {
      this.game.flashHUDMessage('WEBXR API UNAVAILABLE IN THIS BROWSER', '#ff2a55');
      return;
    }

    try {
      const sessionInit = {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
      };
      const session = await navigator.xr.requestSession(mode, sessionInit);
      this.sessionMode = mode;
      this.currentSession = session;
      await this.renderer.xr.setSession(session);
    } catch (err) {
      console.warn('WebXR session request failed:', err);
      this.game.flashHUDMessage(
        `WEBXR ${mode.toUpperCase()} UNAVAILABLE: CONNECT HEADSET OR ENABLE EMULATOR`,
        '#ffbe0b'
      );
    }
  }

  buildControllers() {
    for (let i = 0; i < 2; i++) {
      const targetRaySpace = this.renderer.xr.getController(i);
      const gripSpace = this.renderer.xr.getControllerGrip(i);

      // 1. Laser Pointer Ray Line
      const rayGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1)
      ]);
      const rayColor = i === 0 ? 0x00e5ff : 0x00ffaa;
      const rayMat = new THREE.LineBasicMaterial({
        color: rayColor,
        transparent: true,
        opacity: 0.85
      });
      const rayLine = new THREE.Line(rayGeo, rayMat);
      rayLine.scale.z = 3.5; // Local length in rig space
      targetRaySpace.add(rayLine);

      // Muzzle emitter ring on controller tip
      const tipGeo = new THREE.OctahedronGeometry(0.018, 0);
      const tipMat = new THREE.MeshBasicMaterial({ color: rayColor, wireframe: true });
      const tipMesh = new THREE.Mesh(tipGeo, tipMat);
      tipMesh.position.set(0, 0, -0.04);
      targetRaySpace.add(tipMesh);

      // 2. Procedural Sci-Fi Tactical Grip Mesh (zero external assets required)
      const gripGroup = new THREE.Group();
      const bodyGeo = new THREE.BoxGeometry(0.036, 0.032, 0.13);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x10243d,
        emissive: 0x051324,
        metalness: 0.8,
        roughness: 0.25
      });
      const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
      gripGroup.add(bodyMesh);

      const trimGeo = new THREE.EdgesGeometry(bodyGeo);
      const trimLine = new THREE.LineSegments(
        trimGeo,
        new THREE.LineBasicMaterial({ color: rayColor, transparent: true, opacity: 0.75 })
      );
      gripGroup.add(trimLine);
      gripSpace.add(gripGroup);

      // Bind controller events
      targetRaySpace.addEventListener('selectstart', () => this.onControllerSelect(i));
      targetRaySpace.addEventListener('squeezestart', () => this.onControllerSqueeze(i));
      targetRaySpace.addEventListener('connected', (event) => {
        targetRaySpace.userData.inputSource = event.data;
        targetRaySpace.userData.handedness = event.data.handedness || (i === 0 ? 'left' : 'right');
        targetRaySpace.visible = true;
        gripSpace.visible = true;
      });
      targetRaySpace.addEventListener('disconnected', () => {
        delete targetRaySpace.userData.inputSource;
        targetRaySpace.visible = false;
        gripSpace.visible = false;
      });

      this.xrRig.add(targetRaySpace);
      this.xrRig.add(gripSpace);

      this.controllers.push({
        index: i,
        targetRaySpace,
        gripSpace,
        rayLine,
        rayMat,
        tipMesh,
        aimWorldPos: new THREE.Vector3()
      });
    }
  }

  build3DHoloConsole() {
    // Diegetic 3D Holographic Command Panel inside XR Rig so VR/AR users can see telemetry & buttons
    this.holoCanvas = document.createElement('canvas');
    this.holoCanvas.width = 640;
    this.holoCanvas.height = 280;
    this.holoCtx = this.holoCanvas.getContext('2d');

    this.holoTexture = new THREE.CanvasTexture(this.holoCanvas);
    this.holoTexture.minFilter = THREE.LinearFilter;

    const panelGeo = new THREE.PlaneGeometry(0.76, 0.33);
    const panelMat = new THREE.MeshBasicMaterial({
      map: this.holoTexture,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide
    });

    this.holoPanel = new THREE.Mesh(panelGeo, panelMat);
    // Positioned slightly below eye level in front of the player inside the XR rig
    this.holoPanel.position.set(0, 0.78, -0.75);
    this.holoPanel.rotation.x = -0.42;
    this.holoPanel.visible = false;

    // Interactive 3D hit zones on the holo console
    this.holoButtons = [
      { id: 'SCALE', label: 'SCALE MODE', uMin: 0.04, uMax: 0.34, vMin: 0.06, vMax: 0.26 },
      { id: 'EMP', label: 'AEGIS EMP', uMin: 0.37, uMax: 0.66, vMin: 0.06, vMax: 0.26 },
      { id: 'EXIT', label: 'EXIT XR', uMin: 0.69, uMax: 0.96, vMin: 0.06, vMax: 0.26 }
    ];

    this.xrRig.add(this.holoPanel);
  }

  applyScalePreset(index) {
    this.scaleIndex = ((index % XR_SCALE_PRESETS.length) + XR_SCALE_PRESETS.length) % XR_SCALE_PRESETS.length;
    const preset = XR_SCALE_PRESETS[this.scaleIndex];
    this.xrRig.scale.setScalar(preset.scale);
    this.xrRig.position.copy(preset.position);
    this.xrRig.rotation.set(0, 0, 0);
    this.xrRig.updateMatrixWorld(true);
    this.updateHoloConsole();
  }

  onSessionStart() {
    this.game.sound.init();

    // Parent camera into xrRig so scale & rig positioning work seamlessly
    this.savedCameraPos = this.camera.position.clone();
    this.savedCameraQuat = this.camera.quaternion.clone();
    this.camera.near = 0.05;
    this.camera.updateProjectionMatrix();
    this.xrRig.add(this.camera);

    this.applyScalePreset(this.scaleIndex);
    this.holoPanel.visible = true;

    // If entering AR/MR passthrough mode, make background transparent
    if (this.sessionMode === 'immersive-ar') {
      this.scene.background = null;
      this.scene.fog = null;
      if (this.game.world.starField) this.game.world.starField.visible = false;
    }

    // If on title screen or game over, start game automatically so VR player is immediately in action
    if (this.game.state === 'MENU' || this.game.state === 'GAMEOVER') {
      this.game.startNewGame();
    }

    const vrBtn = document.getElementById('btn-enter-vr');
    if (vrBtn) vrBtn.textContent = 'EXIT XR';

    this.triggerHaptic(0, 0.6, 80);
    this.triggerHaptic(1, 0.6, 80);
    this.updateHoloConsole();
  }

  onSessionEnd() {
    this.currentSession = null;
    this.holoPanel.visible = false;

    // Restore camera to scene root & desktop camera preset
    this.scene.add(this.camera);
    this.xrRig.scale.setScalar(1);
    this.xrRig.position.set(0, 0, 0);
    this.xrRig.rotation.set(0, 0, 0);

    this.scene.background = new THREE.Color(0x02060d);
    this.scene.fog = new THREE.FogExp2(0x02060d, 0.0028);
    if (this.game.world.starField) this.game.world.starField.visible = true;

    this.camera.near = 0.5;
    this.camera.updateProjectionMatrix();
    this.game.applyCameraPreset(this.game.cameraPresetKey);

    const vrBtn = document.getElementById('btn-enter-vr');
    if (vrBtn) vrBtn.textContent = this.isSupportedVR ? 'ENTER VR' : 'VR (NO HEADSET)';
  }

  onControllerSelect(controllerIndex) {
    if (!this.renderer.xr.isPresenting) return;

    this.activeControllerIndex = controllerIndex;
    const ctrl = this.controllers[controllerIndex];

    // 1. Check if pointing at the 3D Holo Console buttons
    const raycaster = this.getControllerRaycaster(controllerIndex);
    if (this.holoPanel.visible) {
      const hits = raycaster.intersectObject(this.holoPanel, false);
      if (hits.length > 0 && hits[0].uv) {
        const { x: u, y: v } = hits[0].uv;
        for (const btn of this.holoButtons) {
          if (u >= btn.uMin && u <= btn.uMax && v >= btn.vMin && v <= btn.vMax) {
            this.handleHoloButtonClick(btn.id);
            this.triggerHaptic(controllerIndex, 0.5, 45);
            return;
          }
        }
      }
    }

    // 2. If in Game Over or Menu state, trigger restarts
    if (this.game.state === 'GAMEOVER' || this.game.state === 'MENU') {
      this.game.startNewGame();
      this.triggerHaptic(controllerIndex, 0.7, 90);
      return;
    }

    if (this.game.state === 'PAUSED') {
      this.game.togglePause();
      return;
    }

    if (this.game.state !== 'PLAYING') return;

    // 3. Update aim point from this specific controller and fire!
    this.updateControllerAim(controllerIndex);
    this.game.aimWorldPos.copy(ctrl.aimWorldPos);

    // Left controller prefers West/Center, Right controller prefers East/Center, or auto-optimal
    this.game.fireInterceptor(null);
    this.triggerHaptic(controllerIndex, 0.65, 55);
    this.updateHoloConsole();
  }

  onControllerSqueeze(controllerIndex) {
    if (!this.renderer.xr.isPresenting) return;
    if (this.game.state !== 'PLAYING') return;

    this.activeControllerIndex = controllerIndex;
    this.updateControllerAim(controllerIndex);
    this.game.aimWorldPos.copy(this.controllers[controllerIndex].aimWorldPos);

    // Squeeze fires Center Hyper-Velocity Battery (BRAVO - index 1) directly!
    this.game.fireInterceptor(1);
    this.triggerHaptic(controllerIndex, 0.9, 75);
    this.updateHoloConsole();
  }

  handleHoloButtonClick(btnId) {
    if (btnId === 'SCALE') {
      this.applyScalePreset(this.scaleIndex + 1);
    } else if (btnId === 'EMP') {
      this.game.triggerEmpOverdrive();
      this.triggerHaptic(0, 1.0, 180);
      this.triggerHaptic(1, 1.0, 180);
    } else if (btnId === 'EXIT') {
      if (this.currentSession) {
        this.currentSession.end();
      }
    }
    this.updateHoloConsole();
  }

  getControllerRaycaster(controllerIndex) {
    const ctrl = this.controllers[controllerIndex];
    ctrl.targetRaySpace.updateMatrixWorld(true);
    this.tempMatrix.identity().extractRotation(ctrl.targetRaySpace.matrixWorld);
    this.rayOrigin.setFromMatrixPosition(ctrl.targetRaySpace.matrixWorld);
    this.rayDir.set(0, 0, -1).applyMatrix4(this.tempMatrix).normalize();

    const raycaster = new THREE.Raycaster();
    raycaster.ray.origin.copy(this.rayOrigin);
    raycaster.ray.direction.copy(this.rayDir);
    return raycaster;
  }

  updateControllerAim(controllerIndex) {
    const ctrl = this.controllers[controllerIndex];
    if (!ctrl || !ctrl.targetRaySpace.visible) return false;

    const raycaster = this.getControllerRaycaster(controllerIndex);
    const ray = raycaster.ray;

    // Use the game's ray-based smart 3D targeting logic with the controller's 3D world ray!
    this.game.computeAimFromWorldRay(ray, ctrl.aimWorldPos);

    // Adjust laser beam length to reach the aimed 3D point
    const worldDist = ray.origin.distanceTo(ctrl.aimWorldPos);
    const rigScale = Math.max(0.01, this.xrRig.scale.x);
    ctrl.rayLine.scale.z = Math.min(8.0, Math.max(0.4, worldDist / rigScale));

    return true;
  }

  pollControllerGamepads(dt) {
    this.SnapTurnCooldown = Math.max(0, this.SnapTurnCooldown - dt);

    for (let i = 0; i < 2; i++) {
      const ctrl = this.controllers[i];
      const inputSource = ctrl.targetRaySpace.userData.inputSource;
      if (!inputSource || !inputSource.gamepad) continue;

      const gp = inputSource.gamepad;
      const handedness = inputSource.handedness || (i === 0 ? 'left' : 'right');

      // Poll A/X button (buttons[4]) -> Trigger EMP Overdrive
      const btnA = gp.buttons[4] && gp.buttons[4].pressed;
      if (btnA && !this.buttonStates[i].a) {
        if (this.game.state === 'PLAYING') {
          this.game.triggerEmpOverdrive();
          this.triggerHaptic(0, 1.0, 160);
          this.triggerHaptic(1, 1.0, 160);
        }
      }
      this.buttonStates[i].a = !!btnA;

      // Poll B/Y button (buttons[5]) -> Cycle XR Scale Mode
      const btnB = gp.buttons[5] && gp.buttons[5].pressed;
      if (btnB && !this.buttonStates[i].b) {
        this.applyScalePreset(this.scaleIndex + 1);
        this.triggerHaptic(i, 0.5, 40);
      }
      this.buttonStates[i].b = !!btnB;

      // Poll Thumbsticks (axes[2], axes[3])
      if (gp.axes && gp.axes.length >= 4) {
        const axX = gp.axes[2];
        const axY = gp.axes[3];

        if (handedness === 'right') {
          // Right stick Y adjusts 3D engagement dome altitude
          if (Math.abs(axY) > 0.25) {
            this.game.manualAltitude = Math.max(
              14,
              Math.min(84, this.game.manualAltitude - axY * 32 * dt)
            );
          }
          // Right stick X snap-turns rig around Y
          if (Math.abs(axX) > 0.65 && this.SnapTurnCooldown <= 0) {
            this.xrRig.rotation.y -= Math.sign(axX) * (Math.PI / 6);
            this.SnapTurnCooldown = 0.35;
          }
        } else if (handedness === 'left') {
          // Left stick translates XR rig horizontally
          const moveSpeed = 35 * dt;
          if (Math.abs(axX) > 0.2) {
            this.xrRig.position.x = Math.max(-90, Math.min(90, this.xrRig.position.x + axX * moveSpeed));
          }
          if (Math.abs(axY) > 0.2) {
            this.xrRig.position.z = Math.max(-40, Math.min(130, this.xrRig.position.z + axY * moveSpeed));
          }
        }
      }
    }
  }

  triggerHaptic(controllerIndex, intensity = 0.6, durationMs = 50) {
    const ctrl = this.controllers[controllerIndex];
    if (!ctrl) return;
    const inputSource = ctrl.targetRaySpace.userData.inputSource;
    if (!inputSource || !inputSource.gamepad) return;

    const actuators = inputSource.gamepad.hapticActuators;
    if (actuators && actuators.length > 0 && actuators[0].pulse) {
      actuators[0].pulse(Math.min(1.0, Math.max(0.0, intensity)), durationMs).catch(() => {});
    }
  }

  updateHoloConsole() {
    if (!this.holoCtx || !this.holoPanel.visible) return;
    const ctx = this.holoCtx;
    const w = this.holoCanvas.width;
    const h = this.holoCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // Frame background
    ctx.fillStyle = 'rgba(4, 15, 32, 0.88)';
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 3;
    ctx.fillRect(4, 4, w - 8, h - 8);
    ctx.strokeRect(4, 4, w - 8, h - 8);

    // Header
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('AEGIS DOME // XR TACTICAL CONSOLE', 22, 34);

    const preset = XR_SCALE_PRESETS[this.scaleIndex];
    ctx.fillStyle = '#00ffaa';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(preset.label, 385, 34);

    // Telemetry Row
    ctx.fillStyle = '#7aa6c2';
    ctx.font = '14px monospace';
    ctx.fillText('SCORE', 24, 68);
    ctx.fillText('WAVE', 175, 68);
    ctx.fillText('THREATS', 285, 68);
    ctx.fillText('BIO-CITIES', 415, 68);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px monospace';
    ctx.fillText(this.game.score.toLocaleString(), 24, 96);
    ctx.fillText(`${this.game.wave} (${this.game.getWaveMultiplier()}X)`, 175, 96);

    const threats =
      Math.max(0, this.game.enemiesToSpawn - this.game.enemiesSpawned) +
      this.game.enemyMissiles.length +
      this.game.bombers.length;
    ctx.fillStyle = '#ffbe0b';
    ctx.fillText(String(threats), 285, 96);

    const aliveCities = this.game.world.cities.filter((c) => c.alive).length;
    ctx.fillStyle = aliveCities > 2 ? '#00ffaa' : '#ff2a55';
    ctx.fillText(`${aliveCities} / 6`, 415, 96);

    // Battery Status Bars
    this.game.world.batteries.forEach((b, idx) => {
      const bx = 24 + idx * 202;
      const by = 122;
      ctx.strokeStyle = b.alive && b.ammo > 0 ? '#00f0ff' : '#ff2a55';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, by, 186, 52);

      ctx.fillStyle = b.isHyper ? '#00ffaa' : '#00f0ff';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(`${b.code}: ${b.alive ? b.ammo + '/' + b.maxAmmo : 'OFFLINE'}`, bx + 10, by + 22);

      const barW = 166;
      const fillW = b.alive ? (b.ammo / b.maxAmmo) * barW : 0;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(bx + 10, by + 32, barW, 10);
      ctx.fillStyle = b.isHyper ? '#00ffaa' : '#00f0ff';
      ctx.fillRect(bx + 10, by + 32, fillW, 10);
    });

    // Bottom Interactive 3D Buttons (Note UV V-axis is inverted relative to canvas Y)
    // v in [0.06..0.26] corresponds to y in [h * 0.74 .. h * 0.94] -> y ~ 207..263
    const btnY = 198;
    const btnH = 58;

    // 1. Scale Mode Button
    ctx.fillStyle = 'rgba(0, 240, 255, 0.18)';
    ctx.strokeStyle = '#00f0ff';
    ctx.fillRect(25, btnY, 192, btnH);
    ctx.strokeRect(25, btnY, 192, btnH);
    ctx.fillStyle = '#00f0ff';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('[B/Y] CHANGE SCALE', 38, btnY + 34);

    // 2. EMP Button
    const empReady = this.game.empCharge >= 100;
    ctx.fillStyle = empReady ? 'rgba(0, 255, 170, 0.32)' : 'rgba(0, 80, 120, 0.25)';
    ctx.strokeStyle = empReady ? '#00ffaa' : '#007799';
    ctx.fillRect(236, btnY, 186, btnH);
    ctx.strokeRect(236, btnY, 186, btnH);
    ctx.fillStyle = empReady ? '#00ffaa' : '#7aa6c2';
    ctx.fillText(
      empReady ? '[A/X] FIRE EMP!' : `EMP ${Math.floor(this.game.empCharge)}%`,
      254,
      btnY + 34
    );

    // 3. Exit XR Button
    ctx.fillStyle = 'rgba(255, 42, 85, 0.22)';
    ctx.strokeStyle = '#ff2a55';
    ctx.fillRect(441, btnY, 172, btnH);
    ctx.strokeRect(441, btnY, 172, btnH);
    ctx.fillStyle = '#ff2a55';
    ctx.fillText('EXIT WEBXR', 480, btnY + 34);

    this.holoTexture.needsUpdate = true;
  }

  update(dt) {
    if (!this.renderer.xr.isPresenting) return false;

    this.pollControllerGamepads(dt);

    // Update aiming from active controller (or fallback to headset gaze if using hand/gaze without controllers)
    const activeCtrl = this.controllers[this.activeControllerIndex];
    const otherIdx = 1 - this.activeControllerIndex;
    const otherCtrl = this.controllers[otherIdx];

    let updated = false;
    if (otherCtrl && otherCtrl.targetRaySpace.visible) {
      this.updateControllerAim(otherIdx);
    }
    if (activeCtrl && activeCtrl.targetRaySpace.visible) {
      updated = this.updateControllerAim(this.activeControllerIndex);
      if (updated) {
        this.game.aimWorldPos.copy(activeCtrl.aimWorldPos);
      }
    }

    if (!updated) {
      // Headset center gaze fallback (e.g. Apple Vision Pro eye/gaze or 3DoF headset)
      const xrCam = this.renderer.xr.getCamera();
      xrCam.getWorldPosition(this.rayOrigin);
      xrCam.getWorldDirection(this.rayDir);
      const gazeRay = new THREE.Ray(this.rayOrigin, this.rayDir);
      this.game.computeAimFromWorldRay(gazeRay, this.game.aimWorldPos);
    }

    this.game.syncReticleToAimWorldPos();
    return true;
  }
}
