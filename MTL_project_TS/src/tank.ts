/* tank.ts — Tank class with physics (Rapier + manual fallback), mesh rendering, HP, death */
import * as THREE from 'three';
import { CONFIG, TANKS } from './config';
import { Models } from './models';
import { VFX } from './vfx';
import type { TankDef, TankOptions, TankSnapshot, InputState, BotDecision } from './types';
import type { World } from './world';

let _trailGeo: THREE.BoxGeometry | null = null;

export class Tank {
  def: TankDef;
  id: string;
  name: string;
  isLocal: boolean;
  isBot: boolean;
  color: number;
  ownerPeer: string | null;

  x = 0; z = 0;
  heading = 0;
  turretAngle = 0;
  speed = 0;
  vx = 0; vz = 0;
  drifting = false;

  trailSegments: { mesh: THREE.Mesh; life: number; maxLife: number }[] = [];
  _trailTimer = 0;

  maxHp: number; hp: number;
  mass: number;
  viewRange: number;
  alive = true; respawnAt = 0;
  damageDealt = 0; kills = 0;
  reloadLeft = 0;

  heat = 0;
  overheated = false;

  camoState: string | null = null;
  camoFactor = 1;

  dying = false;
  deathT = 0;
  removeAt = -1;

  colHalfW: number;
  colHalfL: number;

  _physBody: any = null;
  _physCollider: any = null;
  _physWorld: any = null;
  _inWater = false;
  _drowning = false;
  _drownTimer = 0;
  _notifiedDeath = false;

  bodyGroup: THREE.Group = new THREE.Group();
  turretGroup: THREE.Group = new THREE.Group();
  root: THREE.Group = new THREE.Group();
  bodyMesh: THREE.Mesh | null = null;
  bodyMat: THREE.MeshStandardMaterial | null = null;
  turretMesh: THREE.Mesh | null = null;
  turretMat: THREE.MeshStandardMaterial | null = null;
  barrelMat: THREE.MeshStandardMaterial | null = null;
  barrelEnd: THREE.Object3D = new THREE.Object3D();
  hpSprite: THREE.Sprite | null = null;
  nameSprite: THREE.Sprite | null = null;
  viewCircle: THREE.Mesh | null = null;
  _hpCanvas: HTMLCanvasElement | null = null;
  _hpCtx: CanvasRenderingContext2D | null = null;
  _hpTex: THREE.CanvasTexture | null = null;
  _drownBar: THREE.Sprite | null = null;
  _dbCtx: CanvasRenderingContext2D | null = null;
  _dbTex: THREE.CanvasTexture | null = null;
  _turretVel: THREE.Vector3 | null = null;
  _turretSpin: THREE.Vector3 | null = null;
  _firePts: THREE.Group | null = null;
  _star: THREE.Mesh | null = null;
  _input: InputState | null = null;
  scene: THREE.Scene | null = null;

  constructor(def: TankDef, opts: TankOptions = {}) {
    this.def = def;
    this.id = opts.id || ('tank_' + Math.random().toString(36).slice(2, 8));
    this.name = opts.name || 'Tank';
    this.isLocal = !!opts.isLocal;
    this.isBot = !!opts.isBot;
    this.color = opts.color != null ? opts.color : def.color;
    this.ownerPeer = opts.ownerPeer || null;
    this.x = opts.x || 0;
    this.z = opts.z || 0;
    this.heading = opts.heading || 0;
    this.turretAngle = opts.turretAngle || 0;
    this.maxHp = def.hp; this.hp = this.maxHp;
    this.mass = def.mass || 30;
    this.viewRange = def.viewRange || 70;
    this.colHalfW = def.body.w * 0.55;
    this.colHalfL = def.body.l * 0.55;
    this._physWorld = opts.physicsWorld || null;
    this._createPhysBody();
    this._buildCubeMesh();
    if (Models && Models.hasModel(def.model || def.id)) this._loadModel();
  }

  _createPhysBody(): void {
    if (!this._physWorld || typeof RAPIER === 'undefined') return;
    try {
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.x, 0.9, this.z)
        .setEnabledRotations(false, true, false)
        .setEnabledTranslations(true, false, true)
        .setLinearDamping(0.0)
        .setAngularDamping(0.0);
      this._physBody = this._physWorld.createRigidBody(desc);
      const col = RAPIER.ColliderDesc.cuboid(this.colHalfW, 0.5, this.colHalfL)
        .setFriction(0.5)
        .setRestitution(0.05)
        .setDensity(this.mass / (this.colHalfW * 2 * this.colHalfL * 2))
        .setUserData({ type: 'tank', tank: this });
      this._physCollider = this._physWorld.createCollider(col, this._physBody);
    } catch (_e) { this._physBody = null; }
  }

  _tankMat(color: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.2, flatShading: false });
  }

  _buildCubeMesh(): void {
    this.bodyGroup = new THREE.Group();
    const b = this.def.body;
    this.bodyMat = this._tankMat(this.color);
    this.bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.l), this.bodyMat);
    this.bodyMesh.position.y = b.h / 2 + 0.45;
    this.bodyMesh.castShadow = true; this.bodyMesh.receiveShadow = true;
    this.bodyGroup.add(this.bodyMesh);
    const treadMat = new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 1 });
    [-1, 1].forEach(s => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, b.l + 0.2), treadMat);
      t.position.set(s * (b.w / 2 + 0.05), 0.35, 0);
      t.castShadow = true; t.receiveShadow = true;
      this.bodyGroup.add(t);
      this._addOutline(t, this.bodyGroup);
    });
    this.turretGroup = new THREE.Group();
    const td = this.def.turret;
    this.turretMat = this._tankMat(this.def.turretColor);
    this.turretMesh = new THREE.Mesh(new THREE.BoxGeometry(td.w, td.h, td.l), this.turretMat);
    this.turretMesh.position.y = td.h / 2;
    this.turretMesh.castShadow = true; this.turretMesh.receiveShadow = true;
    this.turretGroup.add(this.turretMesh);
    this.barrelMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.65, metalness: 0.2 });
    const bl = this.def.barrelLen, br = this.def.barrelR;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(br, br, bl, 10), this.barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, td.h * 0.4, td.l / 2 + bl / 2);
    barrel.castShadow = true; barrel.receiveShadow = true;
    this.turretGroup.add(barrel);
    this._addOutline(barrel, this.turretGroup);
    this.barrelEnd = new THREE.Object3D();
    this.barrelEnd.position.set(0, td.h * 0.4, td.l / 2 + bl + 0.2);
    this.turretGroup.add(this.barrelEnd);
    this._addOutline(this.bodyMesh, this.bodyGroup);
    this._addOutline(this.turretMesh, this.turretGroup);
    this.root.add(this.bodyGroup);
    this.root.add(this.turretGroup);
    this._addOverlays(td.h);
    this._syncTransform();
  }

  static createOutlineMesh(mesh: THREE.Mesh, thickness = 0.04): THREE.Mesh {
    const t = thickness;
    const geo = mesh.geometry.clone();
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    if (pos && norm) {
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i,
          pos.getX(i) + norm.getX(i) * t,
          pos.getY(i) + norm.getY(i) * t,
          pos.getZ(i) + norm.getZ(i) * t
        );
      }
      pos.needsUpdate = true;
    }
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
    const outline = new THREE.Mesh(geo, mat);
    outline.position.copy(mesh.position);
    outline.rotation.copy(mesh.rotation);
    outline.scale.copy(mesh.scale);
    outline.renderOrder = -1;
    return outline;
  }

  _addOutline(mesh: THREE.Mesh, group: THREE.Group, thickness?: number): void {
    group.add(Tank.createOutlineMesh(mesh, thickness));
  }

  _loadModel(): void {
    Models.load(this.def.model || this.def.id).then(grp => {
      if (!grp) return;
      this._clearGroup(this.bodyGroup);
      this._clearGroup(this.turretGroup);
      const scale = this.def.modelScale || 1.0;
      grp.scale.setScalar(scale);
      let minY = Infinity, maxY = -Infinity;
      const meshes: THREE.Mesh[] = [];
      grp.traverse(o => { if ((o as THREE.Mesh).isMesh) { meshes.push(o as THREE.Mesh); const b = new THREE.Box3().setFromObject(o); minY = Math.min(minY, b.min.y); maxY = Math.max(maxY, b.max.y); } });
      const midY = minY + (maxY - minY) * 0.4;
      const bodyParts = new THREE.Group();
      const turretParts = new THREE.Group();
      const tmp = new THREE.Vector3();
      const yOff = this.def.body.h + 0.45;
      const applyMatColor = (m: THREE.Mesh, col: number) => {
        if (Array.isArray(m.material)) m.material.forEach(mat => (mat as THREE.MeshStandardMaterial).color.set(col));
        else (m.material as THREE.MeshStandardMaterial).color.set(col);
      };
      meshes.forEach(m => {
        m.getWorldPosition(tmp);
        m.castShadow = true; m.receiveShadow = true;
        if (tmp.y > midY) {
          applyMatColor(m, this.def.turretColor);
          turretParts.attach(m);
          m.position.y -= yOff;
        } else {
          applyMatColor(m, this.color);
          bodyParts.attach(m);
        }
      });
      bodyParts.traverse(o => { if ((o as THREE.Mesh).isMesh) this._addOutline(o as THREE.Mesh, o.parent!); });
      turretParts.traverse(o => { if ((o as THREE.Mesh).isMesh) this._addOutline(o as THREE.Mesh, o.parent!); });
      this.bodyGroup.add(bodyParts);
      this.turretGroup.add(turretParts);
      const td = this.def.turret;
      this.barrelEnd = new THREE.Object3D();
      this.barrelEnd.position.set(0, td.h * 0.6, td.l + this.def.barrelLen);
      this.turretGroup.add(this.barrelEnd);
      this._addOverlays(td.h);
      this._syncTransform();
    });
  }

  _clearGroup(g: THREE.Group): void {
    for (let i = g.children.length - 1; i >= 0; i--) {
      const c = g.children[i];
      if ((c as any).userData && (c as any).userData.isOverlay) continue;
      g.remove(c);
    }
  }

  _addOverlays(turretH: number): void {
    this.hpSprite = this._makeHpSprite();
    this.hpSprite.userData.isOverlay = true;
    this.hpSprite.position.y = turretH + 2.0;
    this.root.add(this.hpSprite);
    this.nameSprite = this._makeNameTag(this.name);
    this.nameSprite.userData.isOverlay = true;
    this.nameSprite.position.y = turretH + 2.8;
    this.root.add(this.nameSprite);
    this._drownBar = this._makeDrownBar();
    this._drownBar.position.y = turretH + 1.5;
    this.root.add(this._drownBar);
  }

  _makeHpSprite(): THREE.Sprite {
    const c = document.createElement('canvas'); c.width = 256; c.height = 40;
    this._hpCanvas = c; this._hpCtx = c.getContext('2d')!;
    const tex = new THREE.CanvasTexture(c);
    this._hpTex = tex;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.scale.set(3.4, 0.53, 1);
    this._drawHp();
    return spr;
  }

  _drawHp(): void {
    const c = this._hpCanvas!; const g = this._hpCtx!;
    g.clearRect(0, 0, 256, 40);
    const pct = Math.max(0, this.hp / this.maxHp);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(8, 10, 240, 20);
    const col = pct > 0.6 ? '#3ad17a' : (pct > 0.3 ? '#ffb12b' : '#ff3b3b');
    g.fillStyle = col; g.fillRect(11, 13, 234 * pct, 14);
    if (this._hpTex) this._hpTex.needsUpdate = true;
  }

  _makeDrownBar(): THREE.Sprite {
    const c = document.createElement('canvas'); c.width = 256; c.height = 16;
    this._dbCtx = c.getContext('2d')!;
    this._dbTex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._dbTex, depthTest: false, transparent: true }));
    spr.scale.set(3.4, 0.21, 1);
    spr.userData.isOverlay = true;
    spr.visible = false;
    return spr;
  }

  _drawDrownBar(pct: number): void {
    const g = this._dbCtx!;
    g.clearRect(0, 0, 256, 16);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(8, 0, 240, 14);
    g.fillStyle = '#44aaff'; g.fillRect(11, 2, 234 * Math.min(1, pct), 10);
    if (this._dbTex) this._dbTex.needsUpdate = true;
  }

  _makeNameTag(text: string): THREE.Sprite {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 18, 256, 30);
    g.font = 'bold 22px Segoe UI'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 33);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.scale.set(3.2, 0.8, 1);
    return spr;
  }

  attach(scene: THREE.Scene): void { this.scene = scene; scene.add(this.root); }
  detach(): void { this.clearTrails(); if (this.scene) { this.scene.remove(this.root); this.scene = null; } this._removePhysBody(); }

  _removePhysBody(): void {
    if (this._physBody && this._physWorld) {
      try { this._physWorld.removeRigidBody(this._physBody); } catch (_e) { }
      this._physBody = null;
    }
  }

  makeViewRangeCircle(): THREE.Mesh {
    const w = this.def;
    const viewRange = w.viewRange || 70;
    const wf = (window as any).Menu && (window as any).Menu.settings ? (window as any).Menu.settings.viewRangeWidth : 0.5;
    const innerR = viewRange * (1 - wf * 0.4);
    const geo = new THREE.RingGeometry(Math.max(0.1, innerR), viewRange, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false });
    this.viewCircle = new THREE.Mesh(geo, mat);
    this.viewCircle.position.y = 0.2;
    this.root.add(this.viewCircle);
    return this.viewCircle;
  }

  refreshViewRangeWidth(): void {
    if (!this.viewCircle) return;
    const wf = (window as any).Menu && (window as any).Menu.settings ? (window as any).Menu.settings.viewRangeWidth : 0.5;
    const viewRange = this.def.viewRange || 70;
    const innerR = viewRange * (1 - wf * 0.4);
    this.viewCircle.geometry.dispose();
    this.viewCircle.geometry = new THREE.RingGeometry(Math.max(0.1, innerR), viewRange, 64);
    this.viewCircle.geometry.rotateX(-Math.PI / 2);
  }

  setViewRangeStyle(opacity: number, color: string): void {
    if (!this.viewCircle) return;
    this.viewCircle.material.opacity = opacity;
    this.viewCircle.material.color.set(color);
  }

  setInput(input: InputState): void { this._input = input; }

  _readPhysicsState(): void {
    if (!this._physBody) return;
    try {
      const p = this._physBody.translation();
      this.x = p.x;
      this.z = p.z;
      const vel = this._physBody.linvel();
      this.vx = vel.x;
      this.vz = vel.z;
      this.speed = vel.z >= 0 ? Math.hypot(vel.x, vel.z) : -Math.hypot(vel.x, vel.z);
    } catch (_e) { }
  }

  update(dt: number, world: World, game: any): void {
    this._updateTrails(dt, game);
    if (this.dying) { this._updateDeath(dt, game); return; }
    if (!this.alive) return;
    if (this._physBody) this._readPhysicsState();
    const d = this.def;
    const inp = this._input || ({} as InputState);
    this.camoState = world.hidingIn(this.x, this.z);
    this.camoFactor = world.camoFactor(this.x, this.z);
    this._applyCamoVisual();
    this.drifting = false;
    const hasTurn = !!inp.turn && Math.abs(inp.turn) > 0.001;
    const kmh = Math.abs(this.speed) * CONFIG.U_TO_KMH;
    if (inp.handbrake && kmh >= CONFIG.DRIFT_MIN_KMH && hasTurn) this.drifting = true;
    const effThrottle = this.drifting ? 0 : (inp.throttle || 0);
    const speedCap = d.speed * (1 - Math.min(0.35, (this.mass - 18) / 120));
    const target = effThrottle * speedCap * (effThrottle < 0 ? 0.5 : 1);
    if (this.speed < target) {
      this.speed = Math.min(target, this.speed + d.accel * dt);
    } else if (this.speed > target) {
      const noThrottle = Math.abs(effThrottle) < 0.08;
      const brakeMul = (noThrottle && !this.drifting) ? 5.0 : 1.4;
      this.speed = Math.max(target, this.speed - d.accel * dt * brakeMul);
    }
    if (this.drifting) {
      this.heading += inp.turn * d.turn * CONFIG.DRIFT_TURN_BOOST * dt;
    } else if (hasTurn) {
      this.heading += inp.turn * d.turn * dt;
    }
    if (this._physBody) {
      const fwdX = Math.sin(this.heading);
      const fwdZ = Math.cos(this.heading);
      const targetVx = fwdX * this.speed;
      const targetVz = fwdZ * this.speed;
      this._physBody.setLinvel({ x: targetVx, y: 0, z: targetVz }, true);
      const half = this.heading * 0.5;
      this._physBody.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true);
      if (this.drifting) this._physCollider.setFriction(0.05);
      else this._physCollider.setFriction(d.friction || 0.5);
    } else {
      const fx = Math.sin(this.heading) * this.speed;
      const fz = Math.cos(this.heading) * this.speed;
      const alignRate = this.drifting ? 2 : 40;
      this.vx += (fx - this.vx) * Math.min(1, alignRate * dt);
      this.vz += (fz - this.vz) * Math.min(1, alignRate * dt);
      const frictionPerSec = this.drifting ? 0.65 : 0.25;
      this.vx *= Math.pow(frictionPerSec, dt);
      this.vz *= Math.pow(frictionPerSec, dt);
      const noThrottle = Math.abs(inp.throttle || 0) < 0.08;
      if (noThrottle) {
        this.vx *= Math.pow(0.001, dt);
        this.vz *= Math.pow(0.001, dt);
        if (Math.hypot(this.vx, this.vz) < 0.02) { this.vx = 0; this.vz = 0; this.speed = 0; }
      }
      let nx = this.x + this.vx * dt;
      let nz = this.z + this.vz * dt;
      const inWater = !!(world && world.lakeAt(nx, nz));
      if (inWater) { this.speed *= 0.5; this.vx *= 0.5; this.vz *= 0.5; }
      this._inWater = inWater;
      const r = Math.max(this.colHalfW, this.colHalfL);
      if (!world.collides(nx, this.z, r)) this.x = nx;
      else { this.speed *= 0.5; this.vx *= 0.4; }
      if (!world.collides(this.x, nz, r)) this.z = nz;
      else { this.speed *= 0.5; this.vz *= 0.4; }
      const lim = world.half - 3;
      this.x = Math.max(-lim, Math.min(lim, this.x));
      this.z = Math.max(-lim, Math.min(lim, this.z));
    }
    if (game) this._ramCheck(game);
    if (inp.turretWorldAngle != null) {
      let diff = ((inp.turretWorldAngle - this.turretAngle + Math.PI) % (Math.PI * 2)) - Math.PI;
      const maxStep = d.turretTurn * dt;
      diff = Math.max(-maxStep, Math.min(maxStep, diff));
      this.turretAngle += diff;
    }
    if (this.reloadLeft > 0) this.reloadLeft -= dt;
    if (d.shellType === 'flame') {
      if (inp.fire && !this.overheated) {
        this.heat += (1000 / 7.5) * dt;
        if (this.heat >= 1000) { this.heat = 1000; this.overheated = true; }
      } else if (this.overheated) {
        this.heat -= 125 * dt;
        if (this.heat <= 0) { this.heat = 0; this.overheated = false; }
      } else {
        this.heat -= 500 * dt;
        if (this.heat <= 0) { this.heat = 0; }
      }
      if (this.barrelMat) {
        const t = this.heat / 1000;
        const r = 0x16 + Math.round(t * 0xe9);
        const g = 0x2e - Math.round(t * 0x2e);
        const b = 0x2e - Math.round(t * 0x2e);
        this.barrelMat.color.setRGB(r / 255, g / 255, b / 255);
        this.barrelMat.emissive = new THREE.Color(t * 0.8, t * 0.15, 0);
        this.barrelMat.emissiveIntensity = t * 0.5;
      }
    }
    this._syncTransform();
    if (inp.fire && this.reloadLeft <= 0 && !this.overheated) {
      this.reloadLeft = d.reload;
      if (game) game.spawnShot(this);
    }
  }

  _applyCamoVisual(): void {
    const op = this.camoFactor;
    if (this.hpSprite) this.hpSprite.material.opacity = op;
    if (this.nameSprite) this.nameSprite.material.opacity = op;
  }

  _ramCheck(game: any): void {
    for (const o of game.tanks) {
      if (o === this || !o.alive || o.dying) continue;
      const dx = o.x - this.x, dz = o.z - this.z;
      const overlapX = (this.colHalfW + o.colHalfW) - Math.abs(dx);
      const overlapZ = (this.colHalfL + o.colHalfL) - Math.abs(dz);
      if (overlapX > 0 && overlapZ > 0) {
        const heavier = this.mass >= o.mass ? this : o;
        const lighter = heavier === this ? o : this;
        const massRatio = heavier.mass / Math.max(1, lighter.mass);
        if (overlapX < overlapZ) {
          const sign = dx < 0 ? 1 : -1;
          lighter.x += overlapX * sign;
          if (lighter.vx * sign < 0) lighter.vx = 0;
        } else {
          const sign = dz < 0 ? 1 : -1;
          lighter.z += overlapZ * sign;
          if (lighter.vz * sign < 0) lighter.vz = 0;
        }
        if (lighter._physBody) {
          try { lighter._physBody.setTranslation({ x: lighter.x, y: 0.9, z: lighter.z }, true); } catch (_e) { }
        }
        const relSpeed = Math.abs(this.speed) + Math.abs(o.speed);
        if (relSpeed > 6) {
          const baseDmg = relSpeed * 0.2 * massRatio;
          lighter.takeDamage(Math.min(32, baseDmg), heavier, game);
          heavier.takeDamage(Math.min(15, baseDmg / massRatio), lighter, game);
        }
        const factor = 1 - lighter.mass / (heavier.mass + lighter.mass);
        lighter.speed *= Math.max(0.15, factor * 0.5);
        lighter.vx *= 0.2; lighter.vz *= 0.2;
      }
    }
  }

  _syncTransform(): void {
    if (this._physBody) {
      try {
        const p = this._physBody.translation();
        this.x = p.x; this.z = p.z;
      } catch (_e) { }
    }
    this.root.position.set(this.x, 0, this.z);
    this.bodyGroup.rotation.y = this.heading;
    this.turretGroup.rotation.y = this.turretAngle;
    this.turretGroup.position.y = this.def.body.h + 0.45;
    if (this.drifting) {
      this.bodyGroup.rotation.z = THREE.MathUtils.lerp(this.bodyGroup.rotation.z, -0.18, 0.25);
      this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, 0.06, 0.25);
    } else {
      this.bodyGroup.rotation.z = THREE.MathUtils.lerp(this.bodyGroup.rotation.z, 0, 0.2);
      this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, 0, 0.2);
    }
  }

  _updateTrails(dt: number, game: any): void {
    const scene = game ? game.scene : null;
    if (!scene) { this.clearTrails(); return; }
    if (this.alive && !this.dying) {
      const speed = Math.hypot(this.vx, this.vz);
      if (speed >= 0.5) {
        this._trailTimer += dt;
        const interval = Math.max(0.1, 1.2 / speed);
        if (this._trailTimer >= interval) {
          this._trailTimer = 0;
          if (!_trailGeo) _trailGeo = new THREE.BoxGeometry(0.35, 0.02, 0.5);
          const b = this.def.body;
          const off = b.w / 2 + 0.05;
          const back = -b.l / 2;
          const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
          const order = this.trailSegments.length;
          [-1, 1].forEach(side => {
            const tx = this.x + side * off * ch + back * sh;
            const tz = this.z - side * off * sh + back * ch;
            const mesh = new THREE.Mesh(_trailGeo!, new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.45, depthWrite: false }));
            mesh.position.set(tx, 0.01, tz);
            mesh.rotation.y = this.heading;
            mesh.renderOrder = order;
            scene.add(mesh);
            this.trailSegments.push({ mesh, life: 2, maxLife: 2 });
          });
        }
      }
    }
    for (let i = this.trailSegments.length - 1; i >= 0; i--) {
      const seg = this.trailSegments[i];
      seg.life -= dt;
      seg.mesh.material.opacity = Math.max(0, (seg.life / seg.maxLife) * 0.45);
      if (seg.life <= 0) {
        scene.remove(seg.mesh);
        seg.mesh.material.dispose();
        this.trailSegments.splice(i, 1);
      }
    }
    while (this.trailSegments.length > 200) {
      const old = this.trailSegments.shift()!;
      scene.remove(old.mesh);
      old.mesh.material.dispose();
    }
  }

  clearTrails(): void {
    const scene = this.scene;
    this.trailSegments.forEach(s => {
      if (scene) scene.remove(s.mesh);
      else if (s.mesh.parent) s.mesh.parent.remove(s.mesh);
      s.mesh.material.dispose();
    });
    this.trailSegments = [];
  }

  takeDamage(amount: number, fromTank: Tank | null, game: any): void {
    if (!this.alive || this.dying) return;
    this.hp -= amount;
    if (fromTank && fromTank !== this) fromTank.damageDealt += amount;
    if (this.hp <= 0) {
      this.hp = 0; this.alive = false;
      if (fromTank && fromTank !== this) fromTank.kills++;
      this._startDeath(game, fromTank);
    }
    this._drawHp();
  }

  heal(amount: number): void { this.hp = Math.min(this.maxHp, this.hp + amount); this._drawHp(); }

  _startDeath(game: any, killer: Tank | null): void {
    this.dying = true; this.deathT = 0;
    this.removeAt = (game ? game.time : 0) + 48;
    if (this._physBody) { try { this._physBody.setEnabled(false); } catch (_e) { } }
    if (this.hpSprite) this.hpSprite.visible = false;
    if (this.nameSprite) this.nameSprite.visible = false;
    if (this.viewCircle) this.viewCircle.visible = false;
    this._turretVel = new THREE.Vector3((Math.random() - 0.5) * 4, 14 + Math.random() * 4, (Math.random() - 0.5) * 4);
    this._turretSpin = new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4);
    if (this.bodyMat) { this.bodyMat.color.setHex(0x141414); this.bodyMat.emissive = new THREE.Color(0x3a1500); this.bodyMat.emissiveIntensity = 0.6; }
    if (this.turretMat) { this.turretMat.color.setHex(0x1a1a1a); this.turretMat.emissive = new THREE.Color(0x2a1000); this.turretMat.emissiveIntensity = 0.5; }
    if (this.bodyMesh && this.bodyMesh.material !== this.bodyMat) {
      (this.bodyMesh.material as THREE.MeshStandardMaterial).color.setHex(0x141414);
      (this.bodyMesh.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x3a1500);
      (this.bodyMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6;
    }
    if (this.turretMesh && this.turretMesh.material !== this.turretMat) {
      (this.turretMesh.material as THREE.MeshStandardMaterial).color.setHex(0x1a1a1a);
      (this.turretMesh.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x2a1000);
      (this.turretMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5;
    }
    this._firePts = this._makeFireParticles();
    this._firePts.position.y = 0;
    this.root.add(this._firePts);
    this._star = this._makeStarDecal();
    this._star.position.set(0, 0.25, 0);
    this.root.add(this._star);
    if (game) game.onTankKilled(this, killer);
  }

  _makeFireParticles(): THREE.Group {
    const g = new THREE.Group();
    const tex = VFX.getTex('flame');
    const starR = 3.2;
    for (let i = 0; i < 30; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true });
      const s = new THREE.Sprite(mat);
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * starR;
      s.position.set(Math.cos(angle) * r, 0.5 + Math.random() * 0.6, Math.sin(angle) * r);
      const sz = 0.6 + Math.random() * 0.9;
      s.scale.set(sz, sz * 1.5, 1);
      s.userData.phase = Math.random() * 6.28;
      s.userData.baseY = s.position.y;
      s.userData.baseScale = sz;
      g.add(s);
    }
    return g;
  }

  _makeStarDecal(): THREE.Mesh {
    const shape = new THREE.Shape();
    const spikes = 8, outer = 13.6, inner = 4.8;
    for (let i = 0; i < spikes * 2; i++) {
      const r = (i % 2 === 0) ? outer : inner;
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) shape.moveTo(px, py); else shape.lineTo(px, py);
    }
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 1.0, depthWrite: false }));
  }

  _updateDeath(dt: number, game: any): void {
    this.deathT += dt;
    if (this._turretVel) {
      this.turretGroup.position.x += this._turretVel.x * dt;
      this.turretGroup.position.y += this._turretVel.y * dt;
      this.turretGroup.position.z += this._turretVel.z * dt;
      this._turretVel.y -= 22 * dt;
      this.turretGroup.rotation.x += this._turretSpin.x * dt;
      this.turretGroup.rotation.z += this._turretSpin.z * dt;
      if (this.turretGroup.position.y <= this.def.body.h + 0.45 && this._turretVel.y < 0) {
        this.turretGroup.position.y = this.def.body.h + 0.45;
        this._turretVel.y *= -0.3;
        this._turretVel.x *= 0.5; this._turretVel.z *= 0.5;
        if (Math.abs(this._turretVel.y) < 1) this._turretVel = null;
      }
    }
    if (this._firePts) {
      this._firePts.children.forEach((p, i) => {
        p.position.y = (p as any).userData.baseY + Math.sin(game.time * 6 + (p as any).userData.phase) * 0.04;
        const sc = (p as any).userData.baseScale * (1 + Math.sin(game.time * 8 + (p as any).userData.phase) * 0.2);
        p.scale.set(sc, sc * 1.3, 1);
      });
    }
    if (this.deathT > 3) {
      const sink = (this.deathT - 3);
      this.root.position.y = -sink * 1.2;
      if (this._firePts) { this._firePts.children.forEach(p => { (p as THREE.Sprite).material.opacity = Math.max(0, 0.9 - this.deathT / 45); }); }
    }
    if (this._star) this._star.material.opacity = Math.max(0, 1.0 - this.deathT / 45);
    if (this.deathT > 4 && game && this.isLocal && !this._notifiedDeath) {
      this._notifiedDeath = true;
      game.onLocalDeath();
    }
    if (this.deathT > 48) this.root.visible = false;
  }

  respawn(world: World, game: any): void {
    const sp = world.randomSpawn();
    this.x = sp.x; this.z = sp.z;
    this.heading = Math.random() * Math.PI * 2;
    this.turretAngle = this.heading;
    this.hp = this.maxHp; this.alive = true;
    this.dying = false; this.deathT = 0;
    this.speed = 0; this.vx = 0; this.vz = 0; this.reloadLeft = 0;
    this.heat = 0; this.overheated = false;
    if (this.barrelMat) {
      this.barrelMat.color.setHex(0x2a2a2e);
      this.barrelMat.emissive = new THREE.Color(0, 0, 0);
      this.barrelMat.emissiveIntensity = 0;
    }
    this.root.visible = true;
    this.root.position.y = 0;
    if (this.hpSprite) this.hpSprite.visible = true;
    if (this.nameSprite) this.nameSprite.visible = true;
    if (this.viewCircle) this.viewCircle.visible = true;
    if (this._drownBar) this._drownBar.visible = false;
    this._drowning = false;
    this._drownTimer = 0;
    this._drawHp();
    if (this._physBody) {
      try {
        this._physBody.setEnabled(true);
        this._physBody.setTranslation({ x: this.x, y: 0.9, z: this.z }, true);
        this._physBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this._physBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      } catch (_e) { }
    }
  }

  _updateHpBar(): void { this._drawHp(); }

  muzzle(): { pos: THREE.Vector3; dir: THREE.Vector3 } {
    const p = new THREE.Vector3();
    this.barrelEnd.getWorldPosition(p);
    const dir = new THREE.Vector3(Math.sin(this.turretAngle), 0, Math.cos(this.turretAngle));
    return { pos: p, dir };
  }

  snapshot(): TankSnapshot {
    return {
      id: this.id, x: this.x, z: this.z, h: this.heading, t: this.turretAngle,
      sp: this.speed, hp: this.hp, alive: this.alive, dying: this.dying,
      dd: this.damageDealt, k: this.kills, tank: this.def.id, name: this.name, col: this.color,
    };
  }

  applySnapshot(s: TankSnapshot): void {
    this.x = s.x; this.z = s.z; this.heading = s.h; this.turretAngle = s.t;
    this.speed = s.sp; this.hp = s.hp; this.alive = s.alive;
    this.damageDealt = s.dd; this.kills = s.k;
    this.root.visible = this.alive; this._syncTransform(); this._drawHp();
  }

  applyPartialSnapshot(s: TankSnapshot): void {
    this.x += (s.x - this.x) * 0.3;
    this.z += (s.z - this.z) * 0.3;
    this.heading = s.h; this.turretAngle = s.t;
    this.hp = s.hp; this.alive = s.alive; this.dying = s.dying || false;
    this.damageDealt = s.dd; this.kills = s.k;
    this.root.visible = this.alive; this._syncTransform(); this._drawHp();
    if (this._physBody && this.alive && !this.dying) {
      try {
        this._physBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this._physBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        const half = this.heading * 0.5;
        this._physBody.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true);
        this._physBody.setTranslation({ x: this.x, y: 0.9, z: this.z }, true);
      } catch (_e) { }
    }
  }
}
