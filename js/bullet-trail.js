class BulletTrailManager {
  constructor(scene, opts){
    this.scene = scene;
    const o = opts || {};
    this.maxTrails = o.maxTrails || 48;
    this.fadeTime = o.fadeTime || 0.18;
    this.burstTime = o.burstTime || 0.14;
    this.width = o.width || 0.12;
    this.burstWidthMul = o.burstWidthMul || 4;
    this.color = new THREE.Color(o.color || 0xffcc00);
    this._white = new THREE.Color(0xffffff);
    this._pool = [];
    this._active = [];
    this._sparks = [];
    this._sparkPool = [];
    this._sparkTex = this._makeSparkTex();
    this._v = new THREE.Vector3();
    this._mid = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._toCam = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._d = new THREE.Vector3();
    for(let i = 0; i < this.maxTrails; i++) this._pool.push(this._createTrail());
  }

  _createTrail(){
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint8Array([0,1,2, 1,3,2]), 1));
    const mat = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.scene.add(mesh);
    return { mesh, start: new THREE.Vector3(), end: new THREE.Vector3(), fading: false, fadeTimer: 0, burstTimer: 0, _burstStart: new THREE.Vector3() };
  }

  _makeSparkTex(){
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,200,100,1)');
    g.addColorStop(1, 'rgba(255,200,100,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  }

  _createSpark(pos){
    const mat = new THREE.SpriteMaterial({ map: this._sparkTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const spr = new THREE.Sprite(mat);
    spr.position.copy(pos);
    spr.scale.setScalar(0.3);
    this.scene.add(spr);
    return { sprite: spr, vel: new THREE.Vector3(), life: 0.3, maxLife: 0.3 };
  }

  _burstSparks(pos, count){
    for(let i = 0; i < count; i++){
      const s = this._sparkPool.length ? this._sparkPool.pop() : this._createSpark(pos);
      s.sprite.position.copy(pos);
      s.sprite.material.opacity = 1;
      s.sprite.visible = true;
      s.life = 0.2 + Math.random() * 0.15;
      s.maxLife = s.life;
      const angle = Math.random() * Math.PI * 2;
      const elev = (Math.random() - 0.5) * Math.PI * 0.6;
      const speed = 3 + Math.random() * 5;
      s.vel.set(Math.cos(angle) * Math.cos(elev) * speed, Math.sin(elev) * speed * 0.6, Math.sin(angle) * Math.cos(elev) * speed);
      s.sprite.scale.setScalar(0.15 + Math.random() * 0.25);
      this._sparks.push(s);
    }
  }

  spawn(startPos){
    if(!this._pool.length) return null;
    const t = this._pool.pop();
    t.start.copy(startPos);
    t.end.copy(startPos);
    t.fading = false;
    t.fadeTimer = 0;
    t.burstTimer = 0;
    t.mesh.material.color.copy(this.color);
    t.mesh.material.opacity = 1;
    t.mesh.visible = true;
    this._active.push(t);
    return t;
  }

  pushPosition(trail, x, y, z){
    if(!trail || !trail.mesh.visible) return;
    trail.end.set(x, y, z);
  }

  endTrail(trail){
    if(!trail || trail.fading) return;
    trail.fading = true;
    trail.fadeTimer = this.fadeTime;
    trail.burstTimer = this.burstTime;
    trail._burstStart.copy(trail.start);
    this._burstSparks(trail.end, 4 + Math.floor(Math.random() * 4));
  }

  update(dt, camera){
    const arr = this._active;
    const camPos = camera.position;
    const v = this._v, mid = this._mid, dir = this._dir;
    const toCam = this._toCam, right = this._right;
    const r = this._r, d = this._d;

    for(let i = arr.length - 1; i >= 0; i--){
      const t = arr[i];
      const m = t.mesh;
      const posAttr = m.geometry.attributes.position;
      const verts = posAttr.array;

      if(t.fading){
        t.fadeTimer -= dt;
        const burstLeft = t.burstTimer;
        if(burstLeft > 0){
          t.burstTimer -= dt;
          const bp = 1 - (t.burstTimer / this.burstTime);
          t.start.lerpVectors(t._burstStart, t.end, bp);
          const easeOut = 1 - (1 - bp) * (1 - bp);
          const widthMul = 1 + (this.burstWidthMul - 1) * (easeOut < 0.5 ? easeOut * 2 : 2 * (1 - easeOut));
          t.mesh.material.color.copy(this.color).lerp(this._white, Math.sin(bp * Math.PI) * 0.6);
          const burstOpacity = 1 + Math.sin(bp * Math.PI * 2) * 0.3;
          t.mesh.material.opacity = Math.min(1, Math.max(burstOpacity, t.fadeTimer / this.fadeTime));
        } else {
          t.mesh.material.color.copy(this.color);
          t.mesh.material.opacity = Math.max(0, t.fadeTimer / this.fadeTime);
        }

        if(t.fadeTimer <= 0 && t.burstTimer <= 0){
          m.visible = false;
          t.mesh.material.color.copy(this.color);
          this._pool.push(t);
          arr.splice(i, 1);
          continue;
        }
      }

      v.copy(t.end).sub(t.start);
      const len = v.length();
      if(len < 0.05 && !t.fading){ m.visible = false; continue; }
      if(len < 0.05) continue;
      dir.copy(v).divideScalar(len);

      mid.addVectors(t.start, t.end).multiplyScalar(0.5);
      toCam.copy(camPos).sub(mid);
      const camDist = toCam.length();
      toCam.divideScalar(camDist);

      right.crossVectors(dir, toCam);
      if(right.lengthSq() < 1e-6){
        right.set(1, 0, 0);
        if(Math.abs(dir.dot(right)) > 0.9) right.set(0, 0, 1);
        right.cross(dir).normalize();
      } else {
        right.normalize();
      }

      const burstScale = t.fading && t.burstTimer > 0
        ? 1 + (this.burstWidthMul - 1) * (1 - Math.abs(1 - t.burstTimer / this.burstTime * 2))
        : 1;
      const hw = this.width * 0.5 * burstScale;
      const hl = len * 0.5;
      r.copy(right).multiplyScalar(hw);
      d.copy(dir).multiplyScalar(hl);

      verts[0]  = mid.x + r.x + d.x; verts[1]  = mid.y + r.y + d.y; verts[2]  = mid.z + r.z + d.z;
      verts[3]  = mid.x - r.x + d.x; verts[4]  = mid.y - r.y + d.y; verts[5]  = mid.z - r.z + d.z;
      verts[6]  = mid.x + r.x - d.x; verts[7]  = mid.y + r.y - d.y; verts[8]  = mid.z + r.z - d.z;
      verts[9]  = mid.x - r.x - d.x; verts[10] = mid.y - r.y - d.y; verts[11] = mid.z - r.z - d.z;

      posAttr.needsUpdate = true;
      m.visible = true;
    }

    for(let i = this._sparks.length - 1; i >= 0; i--){
      const s = this._sparks[i];
      s.life -= dt;
      if(s.life <= 0){
        s.sprite.visible = false;
        this._sparkPool.push(s);
        this._sparks.splice(i, 1);
        continue;
      }
      const p = s.life / s.maxLife;
      s.sprite.material.opacity = p * p;
      s.sprite.scale.multiplyScalar(1 - dt * 1.5);
      s.sprite.position.x += s.vel.x * dt;
      s.sprite.position.y += s.vel.y * dt;
      s.sprite.position.z += s.vel.z * dt;
      s.vel.y -= 9.8 * dt;
    }
  }

  dispose(){
    [...this._active, ...this._pool].forEach(t => {
      this.scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
    });
    this._active.length = 0;
    this._pool.length = 0;
    this._sparks.forEach(s => { this.scene.remove(s.sprite); s.sprite.material.dispose(); });
    this._sparkPool.forEach(s => { this.scene.remove(s.sprite); s.sprite.material.dispose(); });
    this._sparks.length = 0;
    this._sparkPool.length = 0;
    if(this._sparkTex) this._sparkTex.dispose();
  }
}
