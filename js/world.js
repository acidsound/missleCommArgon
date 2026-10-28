import * as THREE from 'three';

// Generate a procedural emissive skyscraper window texture
function createBuildingTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#050b16';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cols = 8;
  const rows = 24;
  const padX = 4;
  const padY = 4;
  const cellW = (canvas.width - padX * 2) / cols;
  const cellH = (canvas.height - padY * 2) / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rand = Math.random();
      if (rand > 0.28) {
        if (rand > 0.88) {
          ctx.fillStyle = '#7ef9ff';
        } else if (rand > 0.55) {
          ctx.fillStyle = '#1ec8ff';
        } else {
          ctx.fillStyle = '#0d5b8c';
        }
        ctx.fillRect(
          padX + c * cellW + 2,
          padY + r * cellH + 2,
          cellW - 4,
          cellH - 4
        );
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

const BUILDING_TEXTURE = createBuildingTexture();

export class City {
  constructor(scene, config) {
    this.scene = scene;
    this.id = config.id;
    this.name = config.name;
    this.position = config.position.clone();
    this.alive = true;
    this.shieldPulse = Math.random() * Math.PI * 2;

    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    this.scene.add(this.group);

    this.intactGroup = new THREE.Group();
    this.ruinGroup = new THREE.Group();
    this.ruinGroup.visible = false;
    this.group.add(this.intactGroup);
    this.group.add(this.ruinGroup);

    this.buildGeometry();
  }

  buildGeometry() {
    // Base platform
    const baseGeo = new THREE.CylinderGeometry(7.2, 8.2, 1.0, 8);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x0f1e36,
      metalness: 0.7,
      roughness: 0.35,
      emissive: 0x05182e
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = 0.5;
    this.group.add(baseMesh);

    // Glowing ring around base
    const ringGeo = new THREE.RingGeometry(7.3, 7.8, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75
    });
    const ringMesh = new THREE.Mesh(ringGeo, this.ringMat);
    ringMesh.position.y = 0.12;
    this.group.add(ringMesh);

    // Intact Skyscrapers
    const buildingDefs = [
      { x: 0, z: 0, w: 2.2, d: 2.2, h: 9.5 },
      { x: -2.6, z: -1.4, w: 1.7, d: 1.7, h: 6.8 },
      { x: 2.5, z: -1.6, w: 1.8, d: 1.6, h: 7.4 },
      { x: -2.2, z: 2.1, w: 1.6, d: 1.8, h: 5.5 },
      { x: 2.3, z: 2.0, w: 1.9, d: 1.7, h: 6.2 },
      { x: 0.1, z: -3.1, w: 1.5, d: 1.4, h: 4.8 },
      { x: -0.2, z: 3.3, w: 1.6, d: 1.4, h: 4.3 }
    ];

    const bMat = new THREE.MeshStandardMaterial({
      color: 0x162b4d,
      emissive: 0xffffff,
      emissiveMap: BUILDING_TEXTURE,
      emissiveIntensity: 0.85,
      roughness: 0.25,
      metalness: 0.8
    });

    const roofMat = new THREE.MeshBasicMaterial({ color: 0x00f7ff });

    buildingDefs.forEach((b) => {
      const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      const mesh = new THREE.Mesh(geo, bMat);
      mesh.position.set(b.x, 1.0 + b.h / 2, b.z);
      this.intactGroup.add(mesh);

      // Neon roof trim
      const trimGeo = new THREE.BoxGeometry(b.w * 0.85, 0.18, b.d * 0.85);
      const trim = new THREE.Mesh(trimGeo, roofMat);
      trim.position.set(b.x, 1.0 + b.h + 0.09, b.z);
      this.intactGroup.add(trim);
    });

    // Central Spire & Beacon
    const spireGeo = new THREE.CylinderGeometry(0.08, 0.35, 3.5, 6);
    const spireMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const spire = new THREE.Mesh(spireGeo, spireMat);
    spire.position.set(0, 12.2, 0);
    this.intactGroup.add(spire);

    this.beaconMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.55, 0),
      new THREE.MeshBasicMaterial({ color: 0x7ef9ff })
    );
    this.beaconMesh.position.set(0, 14.2, 0);
    this.intactGroup.add(this.beaconMesh);

    // Geodesic Bio-Dome Shield
    const domeGeo = new THREE.SphereGeometry(7.1, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
    this.domeMat = new THREE.MeshStandardMaterial({
      color: 0x00d8ff,
      emissive: 0x0077aa,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.16,
      roughness: 0.1,
      metalness: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const domeMesh = new THREE.Mesh(domeGeo, this.domeMat);
    domeMesh.position.y = 0.8;
    this.intactGroup.add(domeMesh);

    // Wireframe overlay on dome
    const domeWireGeo = new THREE.EdgesGeometry(domeGeo);
    const domeWireMat = new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.32
    });
    const domeWire = new THREE.LineSegments(domeWireGeo, domeWireMat);
    domeWire.position.y = 0.8;
    this.intactGroup.add(domeWire);

    // Ruin Geometry (shown when destroyed)
    const rubbleMat = new THREE.MeshStandardMaterial({
      color: 0x1a1412,
      emissive: 0x551600,
      emissiveIntensity: 0.6,
      roughness: 0.9
    });
    for (let i = 0; i < 9; i++) {
      const rx = (Math.random() - 0.5) * 8;
      const rz = (Math.random() - 0.5) * 8;
      const rh = 1.0 + Math.random() * 2.4;
      const rGeo = new THREE.BoxGeometry(1.4 + Math.random(), rh, 1.4 + Math.random());
      const rMesh = new THREE.Mesh(rGeo, rubbleMat);
      rMesh.position.set(rx, 0.8 + rh / 2, rz);
      rMesh.rotation.set(
        (Math.random() - 0.5) * 0.4,
        Math.random() * Math.PI,
        (Math.random() - 0.5) * 0.4
      );
      this.ruinGroup.add(rMesh);
    }

    // Glowing crater core in ruins
    const craterGeo = new THREE.CircleGeometry(4.8, 16);
    craterGeo.rotateX(-Math.PI / 2);
    this.craterMat = new THREE.MeshBasicMaterial({
      color: 0xff3b00,
      transparent: true,
      opacity: 0.65
    });
    const crater = new THREE.Mesh(craterGeo, this.craterMat);
    crater.position.y = 1.05;
    this.ruinGroup.add(crater);
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.intactGroup.visible = false;
    this.ruinGroup.visible = true;
    this.ringMat.color.setHex(0xff2a00);
    this.ringMat.opacity = 0.4;
  }

  rebuild() {
    this.alive = true;
    this.intactGroup.visible = true;
    this.ruinGroup.visible = false;
    this.ringMat.color.setHex(0x00e5ff);
    this.ringMat.opacity = 0.75;
  }

  update(dt, elapsed) {
    if (this.alive) {
      this.beaconMesh.rotation.y += dt * 2.2;
      this.beaconMesh.position.y = 14.2 + Math.sin(elapsed * 3 + this.shieldPulse) * 0.25;
      this.domeMat.opacity = 0.14 + Math.sin(elapsed * 2 + this.shieldPulse) * 0.03;
    } else {
      this.craterMat.opacity = 0.4 + Math.sin(elapsed * 7 + this.shieldPulse) * 0.2;
    }
  }
}

export class Battery {
  constructor(scene, config) {
    this.scene = scene;
    this.index = config.index;
    this.code = config.code; // ALPHA, BRAVO, CHARLIE
    this.keyLabel = config.keyLabel; // '1', '2', '3'
    this.position = config.position.clone();
    this.maxAmmo = config.maxAmmo || 10;
    this.ammo = this.maxAmmo;
    this.missileSpeed = config.missileSpeed || 95;
    this.blastRadius = config.blastRadius || 12.5;
    this.color = config.color || 0x00f0ff;
    this.isHyper = !!config.isHyper;
    this.alive = true;

    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    this.scene.add(this.group);

    this.yawGroup = new THREE.Group();
    this.pitchGroup = new THREE.Group();
    this.ammoPips = [];
    this.recoilOffset = 0;

    this.buildGeometry();
  }

  buildGeometry() {
    // Armored Raised Bastion Pedestal
    const pedestalGeo = new THREE.CylinderGeometry(6.2, 8.5, 3.2, 8);
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: 0x122238,
      metalness: 0.75,
      roughness: 0.3,
      emissive: 0x061529
    });
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestal.position.y = 1.6;
    this.group.add(pedestal);

    // Pedestal wireframe accent
    const pedEdges = new THREE.EdgesGeometry(pedestalGeo);
    const pedLine = new THREE.LineSegments(
      pedEdges,
      new THREE.LineBasicMaterial({ color: this.color, transparent: true, opacity: 0.5 })
    );
    pedLine.position.y = 1.6;
    this.group.add(pedLine);

    // Base perimeter ring
    const ringGeo = new THREE.RingGeometry(8.6, 9.3, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: this.color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const ring = new THREE.Mesh(ringGeo, this.ringMat);
    ring.position.y = 0.15;
    this.group.add(ring);

    // Ammo Pip Indicators around the bastion rim
    const pipRadius = 5.4;
    for (let i = 0; i < this.maxAmmo; i++) {
      const angle = (i / this.maxAmmo) * Math.PI * 2 - Math.PI / 2;
      const pipGeo = new THREE.BoxGeometry(0.65, 0.45, 1.2);
      const pipMat = new THREE.MeshBasicMaterial({ color: this.color });
      const pip = new THREE.Mesh(pipGeo, pipMat);
      pip.position.set(
        Math.cos(angle) * pipRadius,
        3.35,
        Math.sin(angle) * pipRadius
      );
      pip.rotation.y = -angle;
      this.group.add(pip);
      this.ammoPips.push(pip);
    }

    // Rotating Turret Yaw Assembly
    this.yawGroup.position.set(0, 3.4, 0);
    this.group.add(this.yawGroup);

    const turretBodyGeo = new THREE.CylinderGeometry(2.8, 3.4, 1.8, 8);
    const turretBodyMat = new THREE.MeshStandardMaterial({
      color: 0x1d3557,
      metalness: 0.8,
      roughness: 0.25,
      emissive: 0x0a1e38
    });
    const turretBody = new THREE.Mesh(turretBodyGeo, turretBodyMat);
    turretBody.position.y = 0.9;
    this.yawGroup.add(turretBody);

    // Pitching Dual Launcher Pods
    this.pitchGroup.position.set(0, 1.6, 0);
    this.yawGroup.add(this.pitchGroup);

    this.podContainer = new THREE.Group();
    this.pitchGroup.add(this.podContainer);

    const podGeo = new THREE.BoxGeometry(1.5, 1.5, 4.6);
    const podMat = new THREE.MeshStandardMaterial({
      color: 0x243f66,
      metalness: 0.85,
      roughness: 0.2
    });

    const leftPod = new THREE.Mesh(podGeo, podMat);
    leftPod.position.set(-2.3, 0, -0.5);
    this.podContainer.add(leftPod);

    const rightPod = new THREE.Mesh(podGeo, podMat);
    rightPod.position.set(2.3, 0, -0.5);
    this.podContainer.add(rightPod);

    // Glowing muzzle barrels pointing along +Z in local space (we'll use lookAt)
    const barrelGeo = new THREE.CylinderGeometry(0.38, 0.38, 1.4, 12);
    barrelGeo.rotateX(Math.PI / 2);
    this.barrelMat = new THREE.MeshBasicMaterial({ color: this.color });

    const leftBarrel = new THREE.Mesh(barrelGeo, this.barrelMat);
    leftBarrel.position.set(-2.3, 0, 2.1);
    this.podContainer.add(leftBarrel);

    const rightBarrel = new THREE.Mesh(barrelGeo, this.barrelMat);
    rightBarrel.position.set(2.3, 0, 2.1);
    this.podContainer.add(rightBarrel);

    // Center sensor eye
    const eyeGeo = new THREE.SphereGeometry(0.75, 12, 12);
    this.eyeMat = new THREE.MeshBasicMaterial({ color: this.color });
    const eye = new THREE.Mesh(eyeGeo, this.eyeMat);
    eye.position.set(0, 0.2, 1.1);
    this.podContainer.add(eye);
  }

  aimAt(targetWorldPos) {
    if (!this.alive) return;
    const dx = targetWorldPos.x - this.position.x;
    const dy = targetWorldPos.y - (this.position.y + 5.0);
    const dz = targetWorldPos.z - this.position.z;

    const targetYaw = Math.atan2(dx, dz);
    const horizDist = Math.max(0.1, Math.hypot(dx, dz));
    const targetPitch = -Math.atan2(dy, horizDist);

    this.yawGroup.rotation.y = targetYaw;
    this.pitchGroup.rotation.x = Math.max(-Math.PI * 0.48, Math.min(0.05, targetPitch));
  }

  canFire() {
    return this.alive && this.ammo > 0;
  }

  consumeAmmo() {
    if (!this.canFire()) return false;
    this.ammo--;
    this.recoilOffset = -1.1;
    this.updatePips();
    return true;
  }

  getMuzzleWorldPosition() {
    const side = (this.ammo % 2 === 0) ? 2.3 : -2.3;
    const localOffset = new THREE.Vector3(side, 0, 2.7);
    this.podContainer.updateWorldMatrix(true, false);
    return localOffset.applyMatrix4(this.podContainer.matrixWorld);
  }

  refill() {
    this.alive = true;
    this.ammo = this.maxAmmo;
    this.ringMat.color.setHex(this.color);
    this.barrelMat.color.setHex(this.color);
    this.eyeMat.color.setHex(this.color);
    this.updatePips();
  }

  destroy() {
    this.alive = false;
    this.ammo = 0;
    this.ringMat.color.setHex(0xff2200);
    this.barrelMat.color.setHex(0x551100);
    this.eyeMat.color.setHex(0xff2200);
    this.updatePips();
  }

  updatePips() {
    for (let i = 0; i < this.ammoPips.length; i++) {
      const pip = this.ammoPips[i];
      if (!this.alive) {
        pip.material.color.setHex(0x441111);
        pip.scale.y = 0.4;
      } else if (i < this.ammo) {
        pip.material.color.setHex(this.color);
        pip.scale.y = 1.0;
      } else {
        pip.material.color.setHex(0x162638);
        pip.scale.y = 0.35;
      }
    }
  }

  update(dt) {
    if (this.recoilOffset < 0) {
      this.recoilOffset = Math.min(0, this.recoilOffset + dt * 5.5);
      this.podContainer.position.z = this.recoilOffset;
    }
  }
}

export class DefenseWorld {
  constructor(scene) {
    this.scene = scene;
    this.cities = [];
    this.batteries = [];
    this.radarAngle = 0;

    this.buildLighting();
    this.buildStarfield();
    this.buildTerrainAndGrid();
    this.buildAegisSkyDome();
    this.buildCitiesAndBatteries();
  }

  buildLighting() {
    const ambient = new THREE.AmbientLight(0x284b7e, 1.3);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0x8be8ff, 1.6);
    dirLight.position.set(60, 120, 50);
    this.scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0xff4d6d, 0.7);
    rimLight.position.set(-80, 50, -90);
    this.scene.add(rimLight);
  }

  buildStarfield() {
    const starCount = 1400;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      // Hemisphere + deep sky distribution
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.92 + 0.05);
      const r = 240 + Math.random() * 140;

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      const tint = Math.random();
      if (tint > 0.8) {
        colors[i * 3] = 0.5;
        colors[i * 3 + 1] = 0.95;
        colors[i * 3 + 2] = 1.0;
      } else if (tint > 0.6) {
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = 0.75;
        colors[i * 3 + 2] = 0.6;
      } else {
        colors[i * 3] = 0.85;
        colors[i * 3 + 1] = 0.9;
        colors[i * 3 + 2] = 1.0;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 1.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.85
    });

    this.starField = new THREE.Points(geo, mat);
    this.scene.add(this.starField);
  }

  buildTerrainAndGrid() {
    // 1. Procedural Valley + Perimeter Mountain Ridge
    const size = 320;
    const segments = 72;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const dist = Math.hypot(x, z);

      let y = 0;
      if (dist > 82) {
        const ridgeFactor = Math.min(1.0, (dist - 82) / 55);
        const angle = Math.atan2(z, x);
        // Keep front camera view (positive Z > 55) lower so it never blocks camera
        const frontSuppression = (z > 40) ? Math.max(0.18, 1.0 - (z - 40) / 80) : 1.0;
        const n1 = Math.sin(x * 0.065) * Math.cos(z * 0.065);
        const n2 = Math.sin(angle * 7) * 0.5 + Math.cos(dist * 0.09) * 0.5;
        y = (Math.pow(ridgeFactor, 1.45) * 32 + (n1 + n2) * 6.5 * ridgeFactor) * frontSuppression;
        y = Math.max(0, y);
      }
      pos.setY(i, y);
    }
    geo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0x050d1a,
      emissive: 0x020710,
      roughness: 0.85,
      metalness: 0.25,
      flatShading: true
    });
    this.terrainMesh = new THREE.Mesh(geo, terrainMat);
    this.scene.add(this.terrainMesh);

    // Wireframe tactical contour overlay on terrain
    const wireGeo = new THREE.WireframeGeometry(geo);
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x00a8cc,
      transparent: true,
      opacity: 0.16
    });
    const terrainWire = new THREE.LineSegments(wireGeo, wireMat);
    terrainWire.position.y = 0.06;
    this.scene.add(terrainWire);

    // 2. Central Tactical Radar Rings on Basin Floor
    const radii = [25, 50, 75, 100];
    radii.forEach((r, idx) => {
      const rGeo = new THREE.RingGeometry(r - 0.25, r + 0.25, 96);
      rGeo.rotateX(-Math.PI / 2);
      const rMat = new THREE.MeshBasicMaterial({
        color: idx === 2 ? 0x00f0ff : 0x007799,
        transparent: true,
        opacity: idx === 2 ? 0.45 : 0.25,
        side: THREE.DoubleSide
      });
      const rMesh = new THREE.Mesh(rGeo, rMat);
      rMesh.position.y = 0.08;
      this.scene.add(rMesh);
    });

    // Crosshair axes on floor
    const axisMat = new THREE.LineBasicMaterial({
      color: 0x0088aa,
      transparent: true,
      opacity: 0.28
    });
    const axisPts = [
      new THREE.Vector3(-100, 0.09, 0),
      new THREE.Vector3(100, 0.09, 0),
      new THREE.Vector3(0, 0.09, -100),
      new THREE.Vector3(0, 0.09, 100)
    ];
    const axisGeo = new THREE.BufferGeometry().setFromPoints(axisPts);
    this.scene.add(new THREE.LineSegments(axisGeo, axisMat));

    // Rotating Radar Sweep Sector on ground
    const sweepGeo = new THREE.CircleGeometry(82, 24, 0, Math.PI * 0.18);
    sweepGeo.rotateX(-Math.PI / 2);
    const sweepMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.radarSweep = new THREE.Mesh(sweepGeo, sweepMat);
    this.radarSweep.position.y = 0.11;
    this.scene.add(this.radarSweep);
  }

  buildAegisSkyDome() {
    const domeGeo = new THREE.SphereGeometry(115, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.48);
    const domeEdges = new THREE.EdgesGeometry(domeGeo);
    const domeMat = new THREE.LineBasicMaterial({
      color: 0x00c8ff,
      transparent: true,
      opacity: 0.06
    });
    this.skyDome = new THREE.LineSegments(domeEdges, domeMat);
    this.scene.add(this.skyDome);
  }

  buildCitiesAndBatteries() {
    const cityConfigs = [
      { id: 'c0', name: 'NEO-TOKYO', position: new THREE.Vector3(-44, 0, -10) },
      { id: 'c1', name: 'VALKYRIE', position: new THREE.Vector3(-25, 0, 12) },
      { id: 'c2', name: 'AEGIS-7', position: new THREE.Vector3(-13, 0, -22) },
      { id: 'c3', name: 'HELIOS', position: new THREE.Vector3(13, 0, -22) },
      { id: 'c4', name: 'HYPERION', position: new THREE.Vector3(25, 0, 12) },
      { id: 'c5', name: 'ZION', position: new THREE.Vector3(44, 0, -10) }
    ];

    this.cities = cityConfigs.map((cfg) => new City(this.scene, cfg));

    const batteryConfigs = [
      {
        index: 0,
        code: 'ALPHA',
        keyLabel: '1',
        position: new THREE.Vector3(-60, 0, 6),
        maxAmmo: 10,
        missileSpeed: 105,
        blastRadius: 13.5,
        color: 0x00e5ff,
        isHyper: false
      },
      {
        index: 1,
        code: 'BRAVO',
        keyLabel: '2',
        position: new THREE.Vector3(0, 0, 18),
        maxAmmo: 12,
        missileSpeed: 165, // Fast Center Battery!
        blastRadius: 14.5,
        color: 0x00ffaa,
        isHyper: true
      },
      {
        index: 2,
        code: 'CHARLIE',
        keyLabel: '3',
        position: new THREE.Vector3(60, 0, 6),
        maxAmmo: 10,
        missileSpeed: 105,
        blastRadius: 13.5,
        color: 0x00e5ff,
        isHyper: false
      }
    ];

    this.batteries = batteryConfigs.map((cfg) => new Battery(this.scene, cfg));
  }

  update(dt, elapsed, targetPos) {
    this.radarAngle += dt * 0.85;
    if (this.radarSweep) {
      this.radarSweep.rotation.y = -this.radarAngle;
    }
    if (this.starField) {
      this.starField.rotation.y += dt * 0.008;
    }

    for (const city of this.cities) {
      city.update(dt, elapsed);
    }

    for (const battery of this.batteries) {
      if (targetPos) {
        battery.aimAt(targetPos);
      }
      battery.update(dt);
    }
  }
}
