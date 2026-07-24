class BulletTrailManager {
  constructor(scene, opts){
    this.scene = scene;
    const o = opts || {};
    this.maxTrails = o.maxTrails || 48;
    this.fadeTime = o.fadeTime || 0.18;
    this.width = o.width || 0.12;
    this.color = new THREE.Color(o.color || 0xffcc00);
    this._pool = [];
    this._active = [];
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
    return { mesh, start: new THREE.Vector3(), end: new THREE.Vector3(), fading: false, fadeTimer: 0 };
  }

  spawn(startPos){
    if(!this._pool.length) return null;
    const t = this._pool.pop();
    t.start.copy(startPos);
    t.end.copy(startPos);
    t.fading = false;
    t.fadeTimer = 0;
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
        m.material.opacity = Math.max(0, t.fadeTimer / this.fadeTime);
        if(t.fadeTimer <= 0){
          m.visible = false;
          this._pool.push(t);
          arr.splice(i, 1);
          continue;
        }
      }

      v.copy(t.end).sub(t.start);
      const len = v.length();
      if(len < 0.05){ m.visible = false; continue; }
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

      const hw = this.width * 0.5;
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
  }

  dispose(){
    [...this._active, ...this._pool].forEach(t => {
      this.scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
    });
    this._active.length = 0;
    this._pool.length = 0;
  }
}
