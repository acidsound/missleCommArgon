import * as THREE from 'three';

// Shared geometries for performance
const SHARED_GEO = {
  warheadCone: new THREE.ConeGeometry(0.65, 2.4, 8),
  mirvCone: new THREE.OctahedronGeometry(1.15, 0),
  smartCone: new THREE.ConeGeometry(0.8, 2.8, 4),
  counterCone: new THREE.ConeGeometry(0.5, 2.0, 8),
  targetMarker: new THREE.OctahedronGeometry(0.95, 0),
  sphereCore: new THREE.SphereGeometry(1, 20, 16),
  sphereShell: new THREE.SphereGeometry(1, 24, 18),
  sphereWire: new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.03, 1)),
  shockRing: new THREE.RingGeometry(0.88, 1.0, 32),
  impactRing: new THREE.RingGeometry(5.5, 6.2, 24),
  particleBox: new THREE.BoxGeometry(0.45, 0.45, 0.45)
};

// Orient cones so +Z is forward for lookAt()
SHARED_GEO.warheadCone.rotateX(Math.PI / 2);
SHARED_GEO.smartCone.rotateX(Math.PI / 2);
SHARED_GEO.counterCone.rotateX(Math.PI / 2);
SHARED_GEO.shockRing.rotateX(-Math.PI / 2);
SHARED_GEO.impactRing.rotateX(-Math.PI / 2);

export class CounterMissile {
  constructor(scene, startPos, targetPos, speed, blastRadius, color = 0x00f0ff, isHyper = false) {
    this.scene = scene;
    this.startPos = startPos.clone();
    this.position = startPos.clone();
    this.targetPos = targetPos.clone();
    this.speed = speed;
    this.blastRadius = blastRadius;
    this.color = color;
    this.isHyper = isHyper;
    this.alive = true;

    const diff = new THREE.Vector3().subVectors(this.targetPos, this.startPos);
    this.totalDist = Math.max(0.01, diff.length());
    this.direction = diff.normalize();
    this.traveled = 0;

    // 1. Missile mesh
    this.mesh = new THREE.Mesh(
      SHARED_GEO.counterCone,
      new THREE.MeshBasicMaterial({ color: this.isHyper ? 0x55ffcc : 0x00f7ff })
    );
    this.mesh.position.copy(this.position);
    this.mesh.lookAt(this.targetPos);
    this.scene.add(this.mesh);

    // 2. Contrail line from startPos to current position
    const trailPositions = new Float32Array(6);
    trailPositions[0] = this.startPos.x;
    trailPositions[1] = this.startPos.y;
    trailPositions[2] = this.startPos.z;
    trailPositions[3] = this.position.x;
    trailPositions[4] = this.position.y;
    trailPositions[5] = this.position.z;

    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    this.trailMat = new THREE.LineBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.85
    });
    this.trailLine = new THREE.Line(this.trailGeo, this.trailMat);
    this.scene.add(this.trailLine);

    // 3. 3D Target Beacon at destination + vertical drop line
    this.markerGroup = new THREE.Group();
    this.markerGroup.position.copy(this.targetPos);

    this.markerMesh = new THREE.Mesh(
      SHARED_GEO.targetMarker,
      new THREE.MeshBasicMaterial({
        color: this.color,
        wireframe: true,
        transparent: true,
        opacity: 0.9
      })
    );
    this.markerGroup.add(this.markerMesh);

    // Drop line to ground so 3D depth of queued intercept is unmistakable
    const dropPts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -this.targetPos.y, 0)
    ];
    this.dropGeo = new THREE.BufferGeometry().setFromPoints(dropPts);
    this.dropMat = new THREE.LineBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.25
    });
    this.dropLine = new THREE.Line(this.dropGeo, this.dropMat);
    this.markerGroup.add(this.dropLine);

    this.scene.add(this.markerGroup);
  }

  update(dt, particleSystem) {
    if (!this.alive) return false;

    const step = this.speed * dt;
    this.traveled += step;

    if (this.traveled >= this.totalDist) {
      this.position.copy(this.targetPos);
      this.alive = false;
      return true; // Reached detonation point
    }

    this.position.addScaledVector(this.direction, step);
    this.mesh.position.copy(this.position);

    // Update contrail endpoint
    const posAttr = this.trailGeo.attributes.position;
    posAttr.setXYZ(1, this.position.x, this.position.y, this.position.z);
    posAttr.needsUpdate = true;

    this.markerMesh.rotation.y += dt * 5;
    this.markerMesh.rotation.x += dt * 3;

    if (particleSystem && Math.random() < 0.65) {
      particleSystem.spawn(this.position, this.color, 1, 2.5, 0.25);
    }

    return false;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.scene.remove(this.trailLine);
    this.scene.remove(this.markerGroup);
    this.trailGeo.dispose();
    this.trailMat.dispose();
    this.dropGeo.dispose();
    this.dropMat.dispose();
    this.mesh.material.dispose();
    this.markerMesh.material.dispose();
  }
}

export class EnemyMissile {
  constructor(scene, config) {
    this.scene = scene;
    this.type = config.type || 'ICBM'; // 'ICBM' | 'MIRV' | 'SMART'
    this.startPos = config.startPos.clone();
    this.position = config.startPos.clone();
    this.targetObj = config.targetObj; // City or Battery
    this.targetPos = config.targetPos.clone();
    this.speed = config.speed || 18;
    this.alive = true;
    this.hasSplit = false;
    this.splitFraction = 0.42 + Math.random() * 0.14;

    if (this.type === 'MIRV') {
      this.color = 0xd946ef; // Magenta/Purple
      this.basePoints = 75;
      this.hitRadius = 1.6;
    } else if (this.type === 'SMART') {
      this.color = 0xffbe0b; // Gold/Yellow
      this.basePoints = 100;
      this.hitRadius = 1.4;
    } else {
      this.color = 0xff3344; // Crimson/Orange
      this.basePoints = 25;
      this.hitRadius = 1.4;
    }

    const diff = new THREE.Vector3().subVectors(this.targetPos, this.startPos);
    this.totalDist = Math.max(0.01, diff.length());
    this.direction = diff.clone().normalize();
    this.velocity = this.direction.clone().multiplyScalar(this.speed);
    this.traveled = 0;

    // 1. Warhead Mesh
    const geo =
      this.type === 'MIRV'
        ? SHARED_GEO.mirvCone
        : this.type === 'SMART'
        ? SHARED_GEO.smartCone
        : SHARED_GEO.warheadCone;

    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: this.color })
    );
    this.mesh.position.copy(this.position);
    this.mesh.lookAt(this.targetPos);
    this.scene.add(this.mesh);

    // 2. Trail polyline (supports curved paths for SMART warheads too)
    this.maxTrailPts = 36;
    this.trailPts = [this.startPos.clone(), this.position.clone()];
    this.trailBuffer = new Float32Array(this.maxTrailPts * 3);
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailBuffer, 3));
    this.trailMat = new THREE.LineBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.85
    });
    this.trailLine = new THREE.Line(this.trailGeo, this.trailMat);
    this.scene.add(this.trailLine);
    this.updateTrailGeometry();

    // 3. Predicted flight path line to ground target (subtle tactical aid)
    const predPts = [this.position.clone(), this.targetPos.clone()];
    this.predGeo = new THREE.BufferGeometry().setFromPoints(predPts);
    this.predMat = new THREE.LineBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 0.16
    });
    this.predLine = new THREE.Line(this.predGeo, this.predMat);
    this.scene.add(this.predLine);

    // 4. Ground Target Warning Ring (appears when missile gets close)
    this.warnMat = new THREE.MeshBasicMaterial({
      color: this.color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0
    });
    this.warnRing = new THREE.Mesh(SHARED_GEO.impactRing, this.warnMat);
    this.warnRing.position.set(this.targetPos.x, 0.25, this.targetPos.z);
    this.scene.add(this.warnRing);

    this.trailTimer = 0;
  }

  updateTrailGeometry() {
    const count = Math.min(this.trailPts.length, this.maxTrailPts);
    for (let i = 0; i < count; i++) {
      const pt = this.trailPts[i];
      this.trailBuffer[i * 3] = pt.x;
      this.trailBuffer[i * 3 + 1] = pt.y;
      this.trailBuffer[i * 3 + 2] = pt.z;
    }
    this.trailGeo.setDrawRange(0, count);
    this.trailGeo.attributes.position.needsUpdate = true;
  }

  update(dt, elapsed, explosions, particleSystem) {
    if (!this.alive) return { hitGround: false, shouldSplit: false };

    const toTarget = new THREE.Vector3().subVectors(this.targetPos, this.position);
    const distRemaining = toTarget.length();

    // Check ground/target impact
    if (distRemaining <= this.speed * dt * 1.15 || this.position.y <= 0.8) {
      this.position.copy(this.targetPos);
      this.alive = false;
      return { hitGround: true, shouldSplit: false };
    }

    // Smart bomb evasive steering around nearby expanding explosions
    const desiredDir = toTarget.normalize();
    if (this.type === 'SMART' && explosions && explosions.length > 0) {
      const evadeVec = new THREE.Vector3();
      for (const exp of explosions) {
        if (!exp.alive) continue;
        const fromExp = new THREE.Vector3().subVectors(this.position, exp.position);
        const d = fromExp.length();
        const dangerZone = exp.maxRadius * 1.85;
        if (d > 0.1 && d < dangerZone) {
          fromExp.normalize().multiplyScalar((dangerZone - d) / dangerZone);
          evadeVec.add(fromExp);
        }
      }
      if (evadeVec.lengthSq() > 0.001) {
        // Blend evade with target homing, keep downward descent
        desiredDir.addScaledVector(evadeVec, 1.35).normalize();
        if (desiredDir.y > -0.15) desiredDir.y = -0.15;
        desiredDir.normalize();
      }
    }

    this.direction.lerp(desiredDir, Math.min(1.0, dt * 8)).normalize();
    this.velocity.copy(this.direction).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, dt);
    this.traveled += this.speed * dt;

    this.mesh.position.copy(this.position);
    if (this.type === 'MIRV') {
      this.mesh.rotation.y += dt * 4.5;
      this.mesh.rotation.z += dt * 2.5;
    } else {
      const lookTarget = new THREE.Vector3().addVectors(this.position, this.direction);
      this.mesh.lookAt(lookTarget);
    }

    // Update trail history
    this.trailTimer += dt;
    if (this.trailTimer > 0.12) {
      this.trailTimer = 0;
      if (this.trailPts.length >= this.maxTrailPts) {
        // Keep origin point at index 0 for classic streak look, shift intermediate points
        this.trailPts.splice(1, 1);
      }
      this.trailPts[this.trailPts.length - 1].copy(this.position);
      this.trailPts.push(this.position.clone());
    } else {
      this.trailPts[this.trailPts.length - 1].copy(this.position);
    }
    this.updateTrailGeometry();

    // Update predicted line
    const predAttr = this.predGeo.attributes.position;
    predAttr.setXYZ(0, this.position.x, this.position.y, this.position.z);
    predAttr.needsUpdate = true;

    // Ground warning ring pulse when low altitude
    if (this.position.y < 42) {
      const urgency = 1.0 - Math.max(0, this.position.y / 42);
      this.warnMat.opacity = (0.25 + 0.35 * Math.sin(elapsed * 14)) * urgency;
      const s = 0.85 + 0.25 * Math.sin(elapsed * 10);
      this.warnRing.scale.set(s, s, s);
    }

    if (particleSystem && Math.random() < 0.35) {
      particleSystem.spawn(this.position, this.color, 1, 1.8, 0.28);
    }

    // Check MIRV split condition
    const progress = this.traveled / this.totalDist;
    if (
      this.type === 'MIRV' &&
      !this.hasSplit &&
      progress >= this.splitFraction &&
      this.position.y > 28
    ) {
      this.hasSplit = true;
      return { hitGround: false, shouldSplit: true };
    }

    return { hitGround: false, shouldSplit: false };
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.scene.remove(this.trailLine);
    this.scene.remove(this.predLine);
    this.scene.remove(this.warnRing);
    this.trailGeo.dispose();
    this.trailMat.dispose();
    this.predGeo.dispose();
    this.predMat.dispose();
    this.warnMat.dispose();
    this.mesh.material.dispose();
  }
}

export class OrbitalBomber {
  constructor(scene, config) {
    this.scene = scene;
    this.type = 'BOMBER';
    this.startPos = config.startPos.clone();
    this.endPos = config.endPos.clone();
    this.position = config.startPos.clone();
    this.speed = config.speed || 22;
    this.dropInterval = config.dropInterval || 3.4;
    this.dropTimer = 1.2 + Math.random() * 1.2;
    this.dropsRemaining = config.maxDrops || 3;
    this.basePoints = 150;
    this.hitRadius = 3.2;
    this.color = 0xff0055;
    this.alive = true;

    const diff = new THREE.Vector3().subVectors(this.endPos, this.startPos);
    this.totalDist = Math.max(0.1, diff.length());
    this.direction = diff.normalize();
    this.velocity = this.direction.clone().multiplyScalar(this.speed);
    this.traveled = 0;

    // Build delta-wing stealth bomber / satellite mesh
    this.group = new THREE.Group();
    this.group.position.copy(this.position);

    const wingGeo = new THREE.ConeGeometry(3.2, 4.8, 3);
    wingGeo.rotateX(Math.PI / 2);
    wingGeo.scale(1.4, 0.32, 1.0);
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0x2b0918,
      emissive: 0xff0055,
      emissiveIntensity: 0.7,
      roughness: 0.3,
      metalness: 0.8
    });
    const wingMesh = new THREE.Mesh(wingGeo, this.bodyMat);
    this.group.add(wingMesh);

    const coreGeo = new THREE.OctahedronGeometry(1.1, 0);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true });
    this.coreMesh = new THREE.Mesh(coreGeo, this.coreMat);
    this.group.add(this.coreMesh);

    this.group.lookAt(this.endPos);
    this.scene.add(this.group);
  }

  update(dt, particleSystem) {
    if (!this.alive) return { exited: false, dropPayload: false };

    const step = this.speed * dt;
    this.traveled += step;
    if (this.traveled >= this.totalDist) {
      this.alive = false;
      return { exited: true, dropPayload: false };
    }

    this.position.addScaledVector(this.direction, step);
    this.group.position.copy(this.position);
    this.coreMesh.rotation.z += dt * 4.0;

    if (particleSystem && Math.random() < 0.45) {
      particleSystem.spawn(this.position, 0xff0055, 1, 2.0, 0.3);
    }

    this.dropTimer -= dt;
    if (
      this.dropTimer <= 0 &&
      this.dropsRemaining > 0 &&
      Math.abs(this.position.x) < 62 &&
      Math.abs(this.position.z) < 45
    ) {
      this.dropTimer = this.dropInterval;
      this.dropsRemaining--;
      return { exited: false, dropPayload: true };
    }

    return { exited: false, dropPayload: false };
  }

  dispose() {
    this.scene.remove(this.group);
    this.bodyMat.dispose();
    this.coreMat.dispose();
  }
}

const PALETTE_CYCLE = [0xffffff, 0x00f5ff, 0xffbe0b, 0xff006e, 0x7209b7];

export class PlasmaExplosion {
  constructor(scene, position, maxRadius = 13.5, options = {}) {
    this.scene = scene;
    this.position = position.clone();
    this.maxRadius = maxRadius;
    this.radius = 0.6;
    this.age = 0;
    this.expandDuration = options.expandDuration || 0.72;
    this.holdDuration = options.holdDuration || 0.42;
    this.collapseDuration = options.collapseDuration || 0.52;
    this.totalDuration = this.expandDuration + this.holdDuration + this.collapseDuration;

    this.isPlayerOriginated = options.isPlayerOriginated !== false;
    this.chainGeneration = options.chainGeneration || 0;
    this.rootCounterId = options.rootCounterId || null;
    this.alive = true;

    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    this.scene.add(this.group);

    // 1. White-hot inner core
    this.coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92
    });
    this.coreMesh = new THREE.Mesh(SHARED_GEO.sphereCore, this.coreMat);
    this.coreMesh.scale.setScalar(0.45);
    this.group.add(this.coreMesh);

    // 2. Outer translucent plasma shell
    this.shellMat = new THREE.MeshBasicMaterial({
      color: options.baseColor || 0x00f0ff,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.shellMesh = new THREE.Mesh(SHARED_GEO.sphereShell, this.shellMat);
    this.group.add(this.shellMesh);

    // 3. Geodesic wireframe shock-cage
    this.wireMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.65
    });
    this.wireMesh = new THREE.LineSegments(SHARED_GEO.sphereWire, this.wireMat);
    this.group.add(this.wireMesh);

    // 4. Horizontal expanding shockwave ring
    this.ringMat = new THREE.MeshBasicMaterial({
      color: options.baseColor || 0x00f0ff,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.ringMesh = new THREE.Mesh(SHARED_GEO.shockRing, this.ringMat);
    this.group.add(this.ringMesh);

    // Dynamic PointLight for dramatic illumination on terrain/cities
    this.light = new THREE.PointLight(options.baseColor || 0x00f0ff, 3.5, maxRadius * 3.8);
    this.group.add(this.light);
  }

  update(dt, elapsed) {
    if (!this.alive) return;
    this.age += dt;

    if (this.age >= this.totalDuration) {
      this.alive = false;
      return;
    }

    let normR = 0;
    let alpha = 1.0;

    if (this.age < this.expandDuration) {
      // Fast ease-out expansion
      const t = this.age / this.expandDuration;
      normR = 1 - Math.pow(1 - t, 2.6);
      alpha = 1.0;
    } else if (this.age < this.expandDuration + this.holdDuration) {
      // Shimmering hold at peak radius
      const t = (this.age - this.expandDuration) / this.holdDuration;
      normR = 0.96 + 0.05 * Math.sin(t * Math.PI * 4);
      alpha = 0.95;
    } else {
      // Collapse & fade
      const t = (this.age - this.expandDuration - this.holdDuration) / this.collapseDuration;
      normR = Math.max(0.05, 1.0 - t * 0.85);
      alpha = Math.max(0, 1.0 - t);
    }

    this.radius = Math.max(0.2, normR * this.maxRadius);

    this.shellMesh.scale.setScalar(this.radius);
    this.wireMesh.scale.setScalar(this.radius);
    this.coreMesh.scale.setScalar(this.radius * 0.62);

    const ringScale = this.radius * (1.08 + (this.age / this.totalDuration) * 0.35);
    this.ringMesh.scale.setScalar(ringScale);

    this.wireMesh.rotation.y += dt * 1.8;
    this.wireMesh.rotation.x += dt * 1.2;

    // Classic Missile Command color cycling
    const colorIdx = Math.floor(elapsed * 18 + this.chainGeneration * 2) % PALETTE_CYCLE.length;
    const cycleColor = PALETTE_CYCLE[colorIdx];
    this.shellMat.color.setHex(cycleColor);
    this.wireMat.color.setHex(PALETTE_CYCLE[(colorIdx + 1) % PALETTE_CYCLE.length]);

    this.shellMat.opacity = 0.36 * alpha;
    this.coreMat.opacity = 0.85 * alpha;
    this.wireMat.opacity = 0.65 * alpha;
    this.ringMat.opacity = Math.max(0, (1.0 - this.age / this.totalDuration) * 0.75);
    this.light.intensity = 3.5 * alpha;
  }

  containsPoint(pt, extraMargin = 0) {
    if (!this.alive) return false;
    const r = this.radius + extraMargin;
    return this.position.distanceToSquared(pt) <= r * r;
  }

  dispose() {
    this.scene.remove(this.group);
    this.coreMat.dispose();
    this.shellMat.dispose();
    this.wireMat.dispose();
    this.ringMat.dispose();
  }
}

export class ParticleSystem {
  constructor(scene, maxParticles = 350) {
    this.scene = scene;
    this.maxParticles = maxParticles;
    this.particles = [];

    for (let i = 0; i < maxParticles; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0
      });
      const mesh = new THREE.Mesh(SHARED_GEO.particleBox, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        mat,
        velocity: new THREE.Vector3(),
        age: 0,
        life: 0,
        active: false
      });
    }
    this.cursor = 0;
  }

  spawn(origin, colorHex, count = 8, speed = 14, life = 0.65) {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.cursor];
      this.cursor = (this.cursor + 1) % this.maxParticles;

      p.active = true;
      p.age = 0;
      p.life = life * (0.65 + Math.random() * 0.6);
      p.mat.color.setHex(colorHex);
      p.mat.opacity = 1.0;
      p.mesh.visible = true;
      p.mesh.position.copy(origin);
      p.mesh.scale.setScalar(0.6 + Math.random() * 0.9);

      // Random spherical velocity
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const spd = speed * (0.4 + Math.random() * 0.9);
      p.velocity.set(
        spd * Math.sin(phi) * Math.cos(theta),
        spd * Math.cos(phi),
        spd * Math.sin(phi) * Math.sin(theta)
      );
    }
  }

  update(dt) {
    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }

      p.mesh.position.addScaledVector(p.velocity, dt);
      p.velocity.multiplyScalar(Math.max(0, 1.0 - dt * 2.2));
      p.mesh.rotation.x += dt * 6;
      p.mesh.rotation.y += dt * 6;

      const t = 1.0 - p.age / p.life;
      p.mat.opacity = t;
      p.mesh.scale.setScalar(Math.max(0.1, t * 1.1));
    }
  }
}
