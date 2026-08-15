/* ============================================================
   projectile.js — Shells + Helix flamethrower particles
   - Shell: travels, blocked by walls; flies OVER lakes (per spec)
   - Flame: short-lived particles, DPS at close range
   ============================================================ */

let _nextProjId = 1;

class Shell {
  constructor(owner, pos, dir, def, physicsWorld, inheritVel){
    this.id = 'p' + (_nextProjId++);
    this.owner = owner;
    this.x = pos.x; this.y = pos.y; this.z = pos.z;
    this.dir = dir.clone().normalize();
    const iv = inheritVel || {x:0, z:0};
    this.speed = def.shellSpeed;
    this._baseSpeed = def.shellSpeed;
    this._inheritX = iv.x;
    this._inheritZ = iv.z;
    this.damage = Math.round((def.damage||34) * (owner && owner.powerMult ? owner.powerMult() : 1));
    this.life = def.shellRange / def.shellSpeed;
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
      var col = this._physWorld.createCollider(RAPIER.ColliderDesc.ball(this.radius), this._physBody);
      if(col && typeof col.setActiveEvents === 'function'){
        col.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      }
      col.userData = {type:'shell', shell:this};
      var vx = this.dir.x * this.speed + this._inheritX;
      var vz = this.dir.z * this.speed + this._inheritZ;
      this._physBody.setLinvel({x: vx, y: 0, z: vz}, true);
    } catch(e){ this._physBody = null; }
  }

  static _initShared(){
    if(!Shell._sharedGeo) Shell._sharedGeo = new THREE.SphereGeometry(0.32, 8, 8);
    if(!Shell._sharedMat) Shell._sharedMat = new THREE.MeshStandardMaterial({color:0xffd24a, emissive:0xff7a1a, emissiveIntensity:0.6, roughness:0.4});
  }
  _build(){
    Shell._initShared();
    this.mesh = new THREE.Mesh(Shell._sharedGeo, Shell._sharedMat);
    this.mesh.position.set(this.x, this.y, this.z);
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

        // Restart trail at ricochet point so it shows the bend
        if(this._trail && game.trailManager){
          game.trailManager.endTrail(this._trail);
          this._trail = game.trailManager.spawn(new THREE.Vector3(this.x, this.y, this.z));
        }

        return true;
      }
    return false;
  }

  attach(scene){ scene.add(this.mesh); this.scene=scene; }
  detach(){
    this._removePhysBody();
    if(this.scene){ this.scene.remove(this.mesh); this.scene=null; }
    if(this.mesh && this.mesh.geometry !== Shell._sharedGeo){
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
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
      const vx = this.dir.x * this.speed + this._inheritX;
      const vz = this.dir.z * this.speed + this._inheritZ;
      this._inheritX = 0; this._inheritZ = 0; // one-time boost
      const nx = this.x + vx * dt;
      const nz = this.z + vz * dt;
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

    // Gladiator destructible blue boxes
    if(game && game._gladBoxHit && game.glad && game._gladBoxHit(this)){ this.dead = true; return; }

    // Tank hit fallback (skip if already handled by Rapier collision events)
    for(const t of game.tanks){
      if(!t.alive || this.dead || this._hitByPhysics) continue;
      if(t === this.owner && this.life > (this.owner.def.shellRange/this.speed) - 0.15) continue;
      if(this.owner.allyId && (t.id === this.owner.allyId || t.allyId === this.owner.id)) continue;
      const dx = t.x - this.x, dz = t.z - this.z;
      const rad = (Math.max(t.def.body.w, t.def.body.l)/2 + this.radius) * (t.hitScale || 1);
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

/* Flamethrower cone (Helix) — damage-only cone. Video overlay handles visuals. */
class FlameCone {
  constructor(owner, pos, dir, def){
    this.id = 'p' + (_nextProjId++);
    this.owner = owner;
    this.x = pos.x; this.y = pos.y; this.z = pos.z;
    this.dir = dir.clone().normalize();
    this.range = 25;
    this.damage = Math.round((def.damage||34) * (owner && owner.powerMult ? owner.powerMult() : 1));
    this.life = 0.22;
    this.dead = false;
    this.type = 'flame';
    this.group = new THREE.Group();
    this.group.position.set(this.x, this.y, this.z);
  }

  attach(scene){ scene.add(this.group); this.scene=scene; }
  detach(){
    if(this.scene){ this.scene.remove(this.group); this.scene=null; }
  }

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
      if(this.owner.allyId && (t.id === this.owner.allyId || t.allyId === this.owner.id)) continue;
      const dx = t.x - this.x, dz = t.z - this.z;
      const dist = Math.hypot(dx, dz);
      if(dist > this.range) continue;
      const along = dx * this.dir.x + dz * this.dir.z;
      if(along <= 0) continue;
      const perp = Math.sqrt(Math.max(0, dist*dist - along*along));
      const maxPerp = along * tanHalf + 0.6;
      if(perp > maxPerp) continue;
      if(coneBlocked) continue;
      t.takeDamage(this._damageAtDist(dist) * dt * 10, this.owner, game, true);
    }

    // Damage: power boxes (Helix can burn through them too)
    if(game && game._gladBoxes){
      for(const b of game._gladBoxes){
        if(!b.alive) continue;
        const bdx = b.x - this.x, bdz = b.z - this.z;
        const bdist = Math.hypot(bdx, bdz);
        if(bdist > this.range) continue;
        const balong = bdx * this.dir.x + bdz * this.dir.z;
        if(balong <= 0) continue;
        const bperp = Math.sqrt(Math.max(0, bdist * bdist - balong * balong));
        if(bperp > balong * tanHalf + 0.6) continue;
        if(coneBlocked) continue;
        b.hp -= this._damageAtDist(bdist) * dt * 10;
        if(b.hp <= 0){
          game._gladKillBox(b);
          if(this.owner === game.localTank) Menu.toast('\u26A1 Blue box destroyed! +5 power dropped');
        }
      }
    }

    if(this.life <= 0) this.dead = true;
  }
}

/* Visual-only explosion */class Explosion {
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
  detach(){
    if(this.scene){ this.scene.remove(this.group); this.scene=null; }
    this.parts.forEach(p => { if(p.material) p.material.dispose(); });
    this.parts = [];
  }
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

/* ============================================================
   ShellCasing � yellow metallic fired-case that pops out of the
   tank's "shell" port, launched with a real Rapier rigidbody, then
   the tank fires the actual projectile ~1s later.
   ============================================================ */
class ShellCasing {
  constructor(pos, vel, physicsWorld){
    this.x = pos.x; this.y = pos.y; this.z = pos.z;
    this.life = 5; this.maxLife = 5; this.dead = false;
    this._physWorld = physicsWorld || null;
    this._physBody = null;
    // Manual-ballistic fallback (no physics world / Rapier missing)
    this._fallVX = vel.x || 0; this._fallVY = vel.y || 0; this._fallVZ = vel.z || 0;
    this._initPhysBody(vel);
    this._build();
  }

  _initPhysBody(vel){
    if(!this._physWorld || typeof RAPIER === 'undefined') return;
    try {
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.x, this.y, this.z)
        .setCcdEnabled(true)
        .setLinearDamping(0.3)
        .setAngularDamping(1.0);
      this._physBody = this._physWorld.createRigidBody(desc);
      const col = RAPIER.ColliderDesc.cylinder(0.09, 0.07)
        .setDensity(3)
        .setRestitution(0.25)
        .setFriction(0.7);
      this._physWorld.createCollider(col, this._physBody);
      this._physBody.setLinvel({x: vel.x || 0, y: vel.y || 0, z: vel.z || 0}, true);
      this._physBody.setAngvel({x:(Math.random()-0.5)*18, y:(Math.random()-0.5)*10, z:(Math.random()-0.5)*18}, true);
    } catch(e){ this._physBody = null; }
  }

  static _initShared(){
    if(!ShellCasing._sharedGeo) ShellCasing._sharedGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.18, 8);
    if(!ShellCasing._sharedMat) ShellCasing._sharedMat = new THREE.MeshStandardMaterial({color:0xe8b02a, metalness:0.85, roughness:0.35, emissive:0x6a4a00, emissiveIntensity:0.5});
  }
  _build(){
    ShellCasing._initShared();
    this.mesh = new THREE.Mesh(ShellCasing._sharedGeo, ShellCasing._sharedMat);
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.castShadow = true;
  }

  attach(scene){ scene.add(this.mesh); this.scene = scene; }
  detach(){
    this._removePhysBody();
    if(this.scene){ this.scene.remove(this.mesh); this.scene = null; }
    if(this.mesh && this.mesh.geometry !== ShellCasing._sharedGeo){
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
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

    if(this._physBody){
      try {
        const t = this._physBody.translation();
        this.x = t.x; this.y = t.y; this.z = t.z;
        const q = this._physBody.rotation();
        this.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      } catch(e){}
    } else {
      this._fallVY -= 18 * dt;
      this.x += this._fallVX * dt;
      this.y += this._fallVY * dt;
      this.z += this._fallVZ * dt;
      if(this.y <= 0.12 && this._fallVY < 0){
        this.y = 0.12;
        this._fallVY *= -0.3;
        this._fallVX *= 0.5; this._fallVZ *= 0.5;
        if(Math.abs(this._fallVY) < 0.8) this._fallVY = 0;
      }
    }
    this.mesh.position.set(this.x, this.y, this.z);
    // Shrink out during the last moments (keep shared material untouched)
    if(this.life < 0.4) this.mesh.scale.setScalar(Math.max(0.01, this.life / 0.4));
  }
}
