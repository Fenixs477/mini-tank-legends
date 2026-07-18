/* projectile.ts — Shells, FlameCone, Explosion */
import * as THREE from 'three';
import { VFX } from './vfx';
import type { TankDef } from './types';

let _nextProjId = 1;

export class Shell {
  id: string;
  owner: any;
  x: number; y: number; z: number;
  dir: THREE.Vector3;
  speed: number;
  damage: number;
  life: number;
  dead = false;
  type = 'shell';
  radius = 0.4;
  _physBody: any = null;
  _physWorld: any = null;
  _hitByPhysics = false;
  _networked = false;
  mesh: THREE.Mesh;
  scene: THREE.Scene | null = null;

  constructor(owner: any, pos: THREE.Vector3, dir: THREE.Vector3, def: TankDef, physicsWorld?: any) {
    this.id = 'p' + (_nextProjId++);
    this.owner = owner;
    this.x = pos.x; this.y = pos.y; this.z = pos.z;
    this.dir = dir.clone().normalize();
    this.speed = def.shellSpeed;
    this.damage = def.damage;
    this.life = def.shellRange / def.shellSpeed;
    this._physWorld = physicsWorld || null;
    this._initPhysBody();
    this.mesh = this._build();
  }

  _initPhysBody(): void {
    if (!this._physWorld || typeof RAPIER === 'undefined') return;
    try {
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.x, this.y, this.z)
        .setGravityScale(0)
        .setCcdEnabled(true);
      this._physBody = this._physWorld.createRigidBody(desc);
      const col = RAPIER.ColliderDesc.ball(this.radius)
        .setUserData({ type: 'shell', shell: this });
      this._physWorld.createCollider(col, this._physBody);
      this._physBody.setLinvel({ x: this.dir.x * this.speed, y: 0, z: this.dir.z * this.speed }, true);
    } catch (_e) { this._physBody = null; }
  }

  _build(): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xff7a1a, emissiveIntensity: 0.6, roughness: 0.4 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), mat);
    mesh.position.set(this.x, this.y, this.z);
    const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.22, 2.0, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb12b, transparent: true, opacity: 0.5 }));
    trail.rotation.x = Math.PI / 2;
    trail.position.z = -1.0;
    mesh.add(trail);
    return mesh;
  }

  _tryRicochet(t: any, game: any): boolean {
    const fwdX = Math.sin(t.heading);
    const fwdZ = Math.cos(t.heading);
    const fromX = this.x - t.x;
    const fromZ = this.z - t.z;
    const fromLen = Math.hypot(fromX, fromZ);
    if (fromLen < 0.01) return false;
    const fromDirX = fromX / fromLen, fromDirZ = fromZ / fromLen;
    const facingDot = fromDirX * fwdX + fromDirZ * fwdZ;
    let armorVal: number, nx: number, nz: number;
    if (facingDot > 0.5) {
      armorVal = t.def.armor.front; nx = fwdX; nz = fwdZ;
    } else if (facingDot < -0.5) {
      armorVal = t.def.armor.back; nx = -fwdX; nz = -fwdZ;
    } else {
      armorVal = t.def.armor.sides;
      const sideX = Math.cos(t.heading), sideZ = -Math.sin(t.heading);
      const sideDot = fromDirX * sideX + fromDirZ * sideZ;
      if (sideDot > 0) { nx = sideX; nz = sideZ; } else { nx = -sideX; nz = -sideZ; }
    }
    const dotNorm = Math.abs(this.dir.x * nx + this.dir.z * nz);
    const angleFromSurface = 90 - Math.acos(Math.min(1, dotNorm)) * 180 / Math.PI;
    if (angleFromSurface < armorVal) {
      if (typeof Menu !== 'undefined' && (Menu as any).toast) (Menu as any).toast('Ricochet!');
      const reflectDot = this.dir.x * nx + this.dir.z * nz;
      this.dir.x -= 2 * reflectDot * nx;
      this.dir.z -= 2 * reflectDot * nz;
      this.dir.normalize();
      this.life /= 1.5;
      const tankRad = Math.max(t.def.body.w, t.def.body.l) / 2;
      const impactX = t.x + fromDirX * tankRad;
      const impactZ = t.z + fromDirZ * tankRad;
      game.spawnRicoLabel(impactX, impactZ);
      this.x = impactX + this.dir.x * 0.8;
      this.z = impactZ + this.dir.z * 0.8;
      this.mesh.position.set(this.x, this.y, this.z);
      this.mesh.lookAt(this.x + this.dir.x, this.y, this.z + this.dir.z);
      game.spawnExplosion(this.x, 1.0, this.z, 0xffeeaa, 4);
      return true;
    }
    return false;
  }

  attach(scene: THREE.Scene): void { scene.add(this.mesh); this.scene = scene; }

  detach(): void {
    this._removePhysBody();
    if (this.scene) { this.scene.remove(this.mesh); this.scene = null; }
  }

  _removePhysBody(): void {
    if (this._physBody && this._physWorld) {
      try { this._physWorld.removeRigidBody(this._physBody); } catch (_e) { }
      this._physBody = null;
    }
  }

  update(dt: number, world: any, game: any): void {
    if (this.dead) return;
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    if (this._networked) return;
    if (this._physBody) {
      const t = this._physBody.translation();
      this.x = t.x; this.y = t.y; this.z = t.z;
      if (this.y < -10) { this.dead = true; return; }
      if (world.collidesWallsOnly(this.x, this.z, this.radius)) {
        this.dead = true;
        game.spawnExplosion(this.x, 1.0, this.z, 0xffaa33, 6);
        return;
      }
    } else {
      const nx = this.x + this.dir.x * this.speed * dt;
      const nz = this.z + this.dir.z * this.speed * dt;
      if (world.collidesWallsOnly(nx, nz, this.radius)) {
        this.dead = true;
        game.spawnExplosion(this.x, 1.0, this.z, 0xffaa33, 6);
        return;
      }
      this.x = nx; this.z = nz;
    }
    if (Math.abs(this.x) > world.half || Math.abs(this.z) > world.half) { this.dead = true; return; }
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.lookAt(this.x + this.dir.x, this.y, this.z + this.dir.z);
    for (const t of game.tanks) {
      if (!t.alive || this.dead || this._hitByPhysics) continue;
      if (t === this.owner && this.life > (this.owner.def.shellRange / this.speed) - 0.15) continue;
      const dx = t.x - this.x, dz = t.z - this.z;
      const rad = Math.max(t.def.body.w, t.def.body.l) / 2 + this.radius;
      if (dx * dx + dz * dz < rad * rad) {
        const armor = t.def.armor;
        if (armor && this._tryRicochet(t, game)) continue;
        t.takeDamage(this.damage, this.owner, game);
        game.spawnExplosion(this.x, 1.2, this.z, 0xff6a2a, 8);
        this.dead = true;
        return;
      }
    }
  }
}

export class FlameCone {
  id: string;
  owner: any;
  x: number; y: number; z: number;
  dir: THREE.Vector3;
  range = 25;
  damage: number;
  life: number;
  dead = false;
  type = 'flame';
  _networked = false;
  _perp: THREE.Vector3;
  particles: THREE.Sprite[] = [];
  group: THREE.Group;
  scene: THREE.Scene | null = null;

  constructor(owner: any, pos: THREE.Vector3, dir: THREE.Vector3, def: TankDef) {
    this.id = 'p' + (_nextProjId++);
    this.owner = owner;
    this.x = pos.x; this.y = pos.y; this.z = pos.z;
    this.dir = dir.clone().normalize();
    this.damage = def.damage;
    this.life = 0.22;
    this._perp = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
    this.group = this._build();
  }

  _build(): THREE.Group {
    const group = new THREE.Group();
    group.position.set(this.x, this.y, this.z);
    const perp = this._perp;
    const tex = VFX.getTex('flame');
    const tanHalf = 0.12;
    for (let i = 0; i < 57; i++) {
      const targetDist = this.range * (0.85 + Math.random() * 0.15);
      const coneR = targetDist * tanHalf;
      const lateral = perp.clone().multiplyScalar((Math.random() - 0.5) * 2 * coneR);
      lateral.y += (Math.random() - 0.5) * coneR * 0.6;
      const targetPos = this.dir.clone().multiplyScalar(targetDist).add(lateral);
      const dir = targetPos.clone().normalize();
      const maxLife = 0.18 + Math.random() * 0.06;
      const speed = targetDist / maxLife;
      const sz = (0.6 + targetDist / this.range * 1.4) * (0.8 + Math.random() * 0.6);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.scale.set(sz * 0.7, sz * 1.1, 1);
      s.userData.dir = dir;
      s.userData.speed = speed;
      s.userData.maxLife = maxLife;
      s.userData.age = Math.random() * maxLife;
      s.userData.baseScale = sz;
      s.position.set(0, 0, 0);
      group.add(s);
      this.particles.push(s);
    }
    return group;
  }

  attach(scene: THREE.Scene): void { scene.add(this.group); this.scene = scene; }
  detach(): void { if (this.scene) { this.scene.remove(this.group); this.scene = null; } }

  _damageAtDist(dist: number): number {
    if (dist < 10) return this.damage;
    if (dist < this.range) return this.damage * 0.5;
    return 0;
  }

  update(dt: number, world: any, game: any): void {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    if (this._networked) return;
    let coneBlocked = false;
    if (world) {
      const steps = Math.ceil(this.range / 6);
      for (let s = 1; s <= steps; s++) {
        const frac = s / steps;
        const cx = this.x + this.dir.x * this.range * frac;
        const cz = this.z + this.dir.z * this.range * frac;
        const r = this.range * 0.12 * frac + 0.4;
        if (world.collidesWallsOnly(cx, cz, r)) { coneBlocked = true; break; }
      }
    }
    const tanHalf = 0.15;
    for (const t of game.tanks) {
      if (!t.alive || t === this.owner) continue;
      const dx = t.x - this.x, dz = t.z - this.z;
      const dist = Math.hypot(dx, dz);
      if (dist > this.range) continue;
      const along = dx * this.dir.x + dz * this.dir.z;
      if (along <= 0) continue;
      const perp = Math.sqrt(Math.max(0, dist * dist - along * along));
      const maxPerp = along * tanHalf + 0.6;
      if (perp > maxPerp) continue;
      if (coneBlocked) continue;
      t.takeDamage(this._damageAtDist(dist) * dt * 10, this.owner, game);
    }
    this.particles.forEach(p => {
      p.userData.age += dt;
      if (p.userData.age >= p.userData.maxLife) {
        p.position.set(0, 0, 0);
        p.userData.age = 0;
        p.userData.maxLife = 0.18 + Math.random() * 0.06;
      }
      p.position.addScaledVector(p.userData.dir, p.userData.speed * dt);
      const lifeFrac = 1 - (p.userData.age / p.userData.maxLife);
      p.material.opacity = coneBlocked ? 0 : lifeFrac * lifeFrac * 0.85;
      const grow = 1.5 - lifeFrac * 0.5;
      p.scale.setScalar(p.userData.baseScale * grow);
    });
  }
}

export class Explosion {
  x: number; y: number; z: number;
  life: number;
  maxLife: number;
  dead = false;
  group: THREE.Group;
  parts: (THREE.Sprite | THREE.Mesh)[] = [];
  scene: THREE.Scene | null = null;

  constructor(x: number, y: number, z: number, color: number, count: number) {
    this.x = x; this.y = y; this.z = z;
    this.life = 0.5; this.maxLife = 0.5;
    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    const flareTex = VFX.getTex('flare');
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTex, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.scale.set(4, 4, 1);
    this.group.add(flash); this.parts.push(flash);
    const smokeTex = VFX.getTex('smoke');
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0.7, depthWrite: false });
      const s = new THREE.Sprite(mat);
      const dir = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.5, (Math.random() - 0.5)).normalize();
      s.userData.v = dir.multiplyScalar(3 + Math.random() * 4);
      s.scale.set(0.5 + Math.random() * 0.5, 0.5 + Math.random() * 0.5, 1);
      this.group.add(s); this.parts.push(s);
    }
  }

  attach(scene: THREE.Scene): void { scene.add(this.group); this.scene = scene; }
  detach(): void { if (this.scene) { this.scene.remove(this.group); this.scene = null; } }

  update(dt: number): void {
    this.life -= dt;
    this.parts.forEach((p, i) => {
      if (i === 0) {
        const sc = 4 * (this.life / this.maxLife);
        p.scale.set(sc, sc, 1);
        (p as THREE.Sprite).material.opacity = this.life / this.maxLife;
      } else {
        (p as THREE.Sprite).position.addScaledVector((p as any).userData.v, dt);
        (p as any).userData.v.y -= 3 * dt;
        (p as THREE.Sprite).material.opacity = Math.max(0, 0.7 * (this.life / this.maxLife));
        const sc = p.scale.x + 1.5 * dt;
        p.scale.set(sc, sc, 1);
      }
    });
    if (this.life <= 0) this.dead = true;
  }
}
