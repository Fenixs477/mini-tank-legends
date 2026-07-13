/* ============================================================
   projectile.js — Shells + Helix flamethrower particles
   - Shell: travels, blocked by walls; flies OVER lakes (per spec)
   - Flame: short-lived particles, DPS at close range
   ============================================================ */

let _nextProjId = 1;

class Shell {
  constructor(owner, pos, dir, def, physicsWorld){
    this.id = 'p' + (_nextProjId++);
    this.owner = owner;
    this.x = pos.x; this.y = pos.y; this.z = pos.z;
    this.dir = dir.clone().normalize();
    this.speed = def.shellSpeed;
    this.damage = def.damage;
    this.life = def.shellRange / def.shellSpeed; // distance-based life
    this.dead = false;
    this.type = 'shell';
    this.radius = 0.4;
    this._physBody = null;
    this._physWorld = physicsWorld || null;
    this._hitByPhysics = false;
    this._initPhysBody();
    this._build();
  }

  _initPhysBody(){
    if(!this._physWorld || typeof RAPIER === 'undefined') return;
    try {
      var desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.x, this.y, this.z)
        .setGravityScale(0)
        .setCcdEnabled(true);
      this._physBody = this._physWorld.createRigidBody(desc);
      var col = RAPIER.ColliderDesc.ball(this.radius)
        .setUserData({type:'shell', shell:this});
      this._physWorld.createCollider(col, this._physBody);
      var vx = this.dir.x * this.speed;
      var vz = this.dir.z * this.speed;
      this._physBody.setLinvel({x: vx, y: 0, z: vz}, true);
    } catch(e){ this._physBody = null; }
  }

  _build(){
    const mat = new THREE.MeshStandardMaterial({color:0xffd24a, emissive:0xff7a1a, emissiveIntensity:0.6, roughness:0.4});
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), mat);
    this.mesh.position.set(this.x, this.y, this.z);
    // trail
    const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.22, 2.0, 6),
      new THREE.MeshBasicMaterial({color:0xffb12b, transparent:true, opacity:0.5}));
    trail.rotation.x = Math.PI/2;
    trail.position.z = -1.0;
    this.mesh.add(trail);
  }

  /* Ricochet check when hitting a tank. Returns true if shell ricochets. */
  _tryRicochet(t, game){
    const fwdX = Math.sin(t.heading);
    const fwdZ = Math.cos(t.heading);

    const fromX = this.x - t.x;
    const fromZ = this.z - t.z;
    const fromLen = Math.hypot(fromX, fromZ);
    if(fromLen < 0.01) return false;
    const fromDirX = fromX / fromLen;
    const fromDirZ = fromZ / fromLen;
    const facingDot = fromDirX * fwdX + fromDirZ * fwdZ;

    let armorVal;
    let nx, nz;

    if(facingDot > 0.5){
      armorVal = t.def.armor.front;
      nx = fwdX; nz = fwdZ;
    } else if(facingDot < -0.5){
      armorVal = t.def.armor.back;
      nx = -fwdX; nz = -fwdZ;
    } else {
      armorVal = t.def.armor.sides;
      const sideX = Math.cos(t.heading);
      const sideZ = -Math.sin(t.heading);
      const sideDot = fromDirX * sideX + fromDirZ * sideZ;
      if(sideDot > 0){ nx = sideX; nz = sideZ; }
      else{ nx = -sideX; nz = -sideZ; }
    }

    // Angle between shell travel direction and armor surface (0 = grazing, 90 = perpendicular)
    const dotNorm = Math.abs(this.dir.x * nx + this.dir.z * nz);
    const angleFromSurface = 90 - Math.acos(Math.min(1, dotNorm)) * 180 / Math.PI;

      if(angleFromSurface < armorVal){
        if(typeof Menu !== 'undefined' && Menu.toast) Menu.toast('Ricochet!');
        const reflectDot = this.dir.x * nx + this.dir.z * nz;
        this.dir.x -= 2 * reflectDot * nx;
        this.dir.z -= 2 * reflectDot * nz;
        this.dir.normalize();

        this.life /= 1.5;

        // Label at ricochet point
        const tankRad = Math.max(t.def.body.w, t.def.body.l)/2;
        const impactX = t.x + fromDirX * tankRad;
        const impactZ = t.z + fromDirZ * tankRad;
        game.spawnRicoLabel(impactX, impactZ);

        // Place shell at impact point on tank perimeter, then offset in reflected dir
        this.x = impactX + this.dir.x * 0.8;
        this.z = impactZ + this.dir.z * 0.8;
        this.mesh.position.set(this.x, this.y, this.z);
        this.mesh.lookAt(this.x + this.dir.x, this.y, this.z + this.dir.z);
        game.spawnExplosion(this.x, 1.0, this.z, 0xffeeaa, 4);

        return true;
      }
    return false;
  }

  attach(scene){ scene.add(this.mesh); this.scene=scene; }
  detach(){
    this._removePhysBody();
    if(this.scene){ this.scene.remove(this.mesh); this.scene=null; }
  }
  _removePhysBody(){
    if(this._physBody && this._physWorld){
      try { this._physWorld.removeRigidBody(this._physBody); } catch(e){}
      this._physBody = null;
    }
  }

  update(dt, world, game){
    if(this.dead) return;
    this.life -= dt;
    if(this.life <= 0){ this.dead = true; return; }

    // Network-controlled: don't move, position set by host snapshots
    if(this._networked){ return; }

    // Use Rapier body position if available, otherwise manual movement
    if(this._physBody){
      var t = this._physBody.translation();
      this.x = t.x; this.y = t.y; this.z = t.z;
      // Kill if below world
      if(this.y < -10){ this.dead = true; return; }
      // Defensive wall check (fallback if Rapier collision event missed)
      if(world.collidesWallsOnly(this.x, this.z, this.radius)){
        this.dead = true;
        game.spawnExplosion(this.x, 1.0, this.z, 0xffaa33, 6);
        return;
      }
    } else {
      const nx = this.x + this.dir.x * this.speed * dt;
      const nz = this.z + this.dir.z * this.speed * dt;
      if(world.collidesWallsOnly(nx, nz, this.radius)){
        this.dead = true;
        game.spawnExplosion(this.x, 1.0, this.z, 0xffaa33, 6);
        return;
      }
      this.x = nx; this.z = nz;
    }

    // world border
    if(Math.abs(this.x) > world.half || Math.abs(this.z) > world.half){ this.dead = true; return; }
    this.mesh.position.set(this.x, this.y, this.z);
    // orient trail
    this.mesh.lookAt(this.x + this.dir.x, this.y, this.z + this.dir.z);

    // Tank hit fallback (skip if already handled by Rapier collision events)
    for(const t of game.tanks){
      if(!t.alive || this.dead || this._hitByPhysics) continue;
      if(t === this.owner && this.life > (this.owner.def.shellRange/this.speed) - 0.15) continue;
      const dx = t.x - this.x, dz = t.z - this.z;
      const rad = Math.max(t.def.body.w, t.def.body.l)/2 + this.radius;
      if(dx*dx + dz*dz < rad*rad){
        const armor = t.def.armor;
        if(armor && this._tryRicochet(t, game)){ continue; }
        t.takeDamage(this.damage, this.owner, game);
        game.spawnExplosion(this.x, 1.2, this.z, 0xff6a2a, 8);
        this.dead = true;
        return;
      }
    }
  }
}

/* Flamethrower cone (Helix) — particles stream from muzzle outward within a fixed cone triangle.
   Damage high up close, falls off with distance. Visual + damage cone share same angle. */
class FlameCone {
  constructor(owner, pos, dir, def){
    this.id = 'p' + (_nextProjId++);
    this.owner = owner;
    this.x = pos.x; this.y = pos.y; this.z = pos.z;
    this.dir = dir.clone().normalize();
    this.range = 25;
    this.damage = def.damage;
    this.life = 0.22;
    this.dead = false;
    this.type = 'flame';
    this.particles = [];
    this._build();
  }

  _build(){
    this.group = new THREE.Group();
    this.group.position.set(this.x, this.y, this.z);

    const perp = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
    this._perp = perp;
    const tex = VFX.getTex('flame');
    const tanHalf = 0.12;

    for(let i=0; i<57; i++){
      // All particles target the full 20m range so density is even at all distances
      const targetDist = this.range * (0.85 + Math.random() * 0.15);
      const coneR = targetDist * tanHalf;
      const latNorm = (Math.random() - 0.5) * 2;
      const lateral = perp.clone().multiplyScalar(latNorm * coneR);
      lateral.y += (Math.random() - 0.5) * coneR * 0.6;

      const targetPos = this.dir.clone().multiplyScalar(targetDist).add(lateral);
      const dir = targetPos.clone().normalize();

      const maxLife = 0.18 + Math.random() * 0.06;
      const speed = targetDist / maxLife;

      const sz = (0.6 + targetDist / this.range * 1.4) * (0.8 + Math.random() * 0.6);
      const mat = new THREE.SpriteMaterial({map:tex, transparent:true, opacity:0.8, blending:THREE.AdditiveBlending, depthWrite:false});
      const s = new THREE.Sprite(mat);
      s.scale.set(sz * 0.7, sz * 1.1, 1);
      s.userData.dir = dir;
      s.userData.speed = speed;
      s.userData.maxLife = maxLife;
      s.userData.age = Math.random() * maxLife;
      s.userData.baseScale = sz;
      s.position.set(0, 0, 0);
      this.group.add(s);
      this.particles.push(s);
    }
  }

  attach(scene){ scene.add(this.group); this.scene=scene; }
  detach(){ if(this.scene){ this.scene.remove(this.group); this.scene=null; } }

  _damageAtDist(dist){
    if(dist < 10) return this.damage;
    if(dist < this.range) return this.damage * 0.5;
    return 0;
  }

  update(dt, world, game){
    this.life -= dt;
    if(this.life <= 0){ this.dead = true; return; }

    // Network-controlled: don't move, position set by host snapshots
    if(this._networked){ return; }

    let coneBlocked = false;
    if(world){
      const steps = Math.ceil(this.range / 6);
      for(let s=1; s<=steps; s++){
        const frac = s / steps;
        const cx = this.x + this.dir.x * this.range * frac;
        const cz = this.z + this.dir.z * this.range * frac;
        const r = this.range * 0.12 * frac + 0.4;
        if(world.collidesWallsOnly(cx, cz, r)){ coneBlocked = true; break; }
      }
    }

    // Damage: sweep tanks inside the cone
    const tanHalf = 0.15;
    for(const t of game.tanks){
      if(!t.alive || t === this.owner) continue;
      const dx = t.x - this.x, dz = t.z - this.z;
      const dist = Math.hypot(dx, dz);
      if(dist > this.range) continue;
      const along = dx * this.dir.x + dz * this.dir.z;
      if(along <= 0) continue;
      const perp = Math.sqrt(Math.max(0, dist*dist - along*along));
      const maxPerp = along * tanHalf + 0.6;
      if(perp > maxPerp) continue;
      if(coneBlocked) continue;
      t.takeDamage(this._damageAtDist(dist) * dt * 10, this.owner, game);
    }

    // Animate particles: stream from muzzle toward fixed cone position
    this.particles.forEach(p => {
      p.userData.age += dt;

      if(p.userData.age >= p.userData.maxLife){
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

    if(this.life <= 0) this.dead = true;
  }
}

/* Visual-only explosion */
class Explosion {
  constructor(x,y,z,color,count){
    this.x=x;this.y=y;this.z=z;this.life=0.5;this.maxLife=0.5;this.dead=false;
    this.group=new THREE.Group(); this.group.position.set(x,y,z);
    this.parts=[];
    // Flash (flare sprite)
    const flareTex = VFX.getTex('flare');
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({map:flareTex, transparent:true, opacity:1, blending:THREE.AdditiveBlending, depthWrite:false}));
    flash.scale.set(4,4,1);
    this.group.add(flash); this.parts.push(flash);
    // Smoke particles
    const smokeTex = VFX.getTex('smoke');
    for(let i=0;i<count;i++){
      const mat = new THREE.SpriteMaterial({map:smokeTex, transparent:true, opacity:0.7, depthWrite:false});
      const s = new THREE.Sprite(mat);
      const dir=new THREE.Vector3((Math.random()-0.5),Math.random()*0.5,(Math.random()-0.5)).normalize();
      s.userData.v=dir.multiplyScalar(3+Math.random()*4);
      s.scale.set(0.5+Math.random()*0.5, 0.5+Math.random()*0.5, 1);
      this.group.add(s); this.parts.push(s);
    }
  }
  attach(scene){ scene.add(this.group); this.scene=scene; }
  detach(){ if(this.scene){ this.scene.remove(this.group); this.scene=null; } }
  update(dt){
    this.life-=dt;
    this.parts.forEach((p,i)=>{
      if(i===0){
        // Flash: shrink fast
        const sc = 4 * (this.life/this.maxLife);
        p.scale.set(sc,sc,1);
        p.material.opacity = this.life/this.maxLife;
      } else {
        // Smoke: fly outward, fade, grow
        p.position.addScaledVector(p.userData.v, dt);
        p.userData.v.y -= 3*dt;
        p.material.opacity = Math.max(0, 0.7 * (this.life/this.maxLife));
        const sc = p.scale.x + 1.5*dt;
        p.scale.set(sc,sc,1);
      }
    });
    if(this.life<=0) this.dead=true;
  }
}
