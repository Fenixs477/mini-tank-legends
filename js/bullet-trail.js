/* ============================================================
   bullet-trail.js — High-performance Tank Shell Trail System
   Custom ShaderMaterial ribbon with object pooling, billboarding,
   additive blending, tapered width, bright-to-fade gradient.
   Tracks actual shell position each frame (no prediction).
   ============================================================ */

class BulletTrailManager {
  constructor(scene, opts){
    this.scene = scene;
    const o = opts || {};
    this.maxTrails    = o.maxTrails    || 24;
    this.segments     = o.segments     || 32;
    this.trailWidth   = o.trailWidth   || 0.45;
    this.tailFadeTime = o.tailFadeTime || 0.15;

    this._pool   = [];
    this._active = [];

    for(let i = 0; i < this.maxTrails; i++) this._pool.push(this._createTrail());
  }

  _createTrail(){
    const S = this.segments;
    const verts = S * 2;
    const idx   = (S - 1) * 6;

    const pos  = new Float32Array(verts * 3);
    const corn = new Float32Array(verts * 2);

    for(let i = 0; i < S; i++){
      const t = 1 - i / (S - 1);  // 1 at head (highest i), 0 at tail (i=0)
      const li = i * 2, ri = i * 2 + 1;
      corn[li*2]   = -1; corn[li*2+1]   = t;
      corn[ri*2]   =  1; corn[ri*2+1]   = t;
    }

    const ind = new (verts < 256 ? Uint8Array : Uint16Array)(idx);
    for(let i = 0; i < S - 1; i++){
      const a = i*2, b = i*2+1, c = i*2+2, d = i*2+3;
      ind[i*6]   = a; ind[i*6+1] = b; ind[i*6+2] = c;
      ind[i*6+3] = b; ind[i*6+4] = d; ind[i*6+5] = c;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('corner',   new THREE.BufferAttribute(corn, 2));
    geo.setIndex(new THREE.BufferAttribute(ind, 1));
    geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        trailWidth: { value: this.trailWidth },
        fadeScale:  { value: 1.0 },
        cameraPos:  { value: new THREE.Vector3() },
        coreColor:  { value: new THREE.Color(1.0, 0.98, 0.7) },
        glowColor:  { value: new THREE.Color(1.0, 0.6, 0.15) },
      },
      vertexShader:   this._vertexShader(),
      fragmentShader: this._fragmentShader(),
      side:      THREE.DoubleSide,
      blending:  THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.scene.add(mesh);

    const buf = new Float32Array(S * 3);

    return { mesh, buf, head:0, count:0, alive:false,
             fadeTimer:0, vel:new THREE.Vector3() };
  }

  _vertexShader(){
    return `
      uniform float trailWidth;
      uniform float fadeScale;
      uniform vec3  cameraPos;

      attribute vec2 corner;

      varying float vTaper;

      void main(){
        vec3 wp = position;

        vec3 toCam = normalize(cameraPos - wp);
        vec3 right = normalize(cross(toCam, vec3(0.0, 1.0, 0.0)));

        float taper = 1.0 - corner.y;
        taper = pow(taper, 2.0);

        wp += right * corner.x * trailWidth * taper * fadeScale;

        vTaper = 1.0 - corner.y;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
      }
    `;
  }

  _fragmentShader(){
    return `
      uniform vec3 coreColor;
      uniform vec3 glowColor;

      varying float vTaper;

      void main(){
      float alpha = vTaper * 0.9 + 0.1;
      vec3 col = mix(glowColor, coreColor, vTaper);
      col = max(col, vec3(vTaper * 0.8));
      gl_FragColor = vec4(col, alpha);
      }
    `;
  }

  /* ---- spawn a new trail at world position ---- */
  spawn(pos){
    if(!this._pool.length) return null;
    const t = this._pool.pop();
    const S = this.segments;

    for(let i = 0; i < S; i++){
      t.buf[i*3]   = pos.x;
      t.buf[i*3+1] = pos.y;
      t.buf[i*3+2] = pos.z;
    }
    t.head = 0;
    t.count = 1;
    t.fadeTimer = -1;
    t.alive = true;
    t.mesh.visible = true;
    this._active.push(t);
    return t;
  }

  /* ---- push the shell's current world position (call each frame) ---- */
  pushPosition(trail, x, y, z){
    if(!trail || !trail.alive || trail.fadeTimer >= 0) return;
    const S = this.segments;
    trail.head = (trail.head + 1) % S;
    const idx = trail.head * 3;
    trail.buf[idx]   = x;
    trail.buf[idx+1] = y;
    trail.buf[idx+2] = z;
    trail.count = Math.min(trail.count + 1, S);
  }

  /* ---- mark trail for fade-out ---- */
  endTrail(trail){
    if(!trail || !trail.alive) return;
    trail.fadeTimer = this.tailFadeTime;
  }

  /* ---- main update: fill geometry, manage lifecycle ---- */
  update(dt, camera){
    const camPos = camera.position;
    const S = this.segments;

    for(let ti = this._active.length - 1; ti >= 0; ti--){
      const t = this._active[ti];
      const m = t.mesh;
      const posAttr = m.geometry.attributes.position;
      const arr = posAttr.array;

      if(t.fadeTimer >= 0){
        t.fadeTimer -= dt;
        t.count = Math.max(1, t.count - 1);
        if(t.count <= 1 || t.fadeTimer <= 0){
          this._recycle(t, ti);
          continue;
        }
      }

      // Fill geometry from ring buffer (oldest → newest)
      const first = (t.head - t.count + 1 + S * 2) % S;
      for(let i = 0; i < t.count; i++){
        const src = (first + i) % S;
        const dst = i * 6;
        const px = t.buf[src*3];
        const py = t.buf[src*3+1];
        const pz = t.buf[src*3+2];
        arr[dst]   = px; arr[dst+1] = py; arr[dst+2] = pz;
        arr[dst+3] = px; arr[dst+4] = py; arr[dst+5] = pz;
      }
      posAttr.needsUpdate = true;

      const segCount = Math.max(0, t.count - 1);
      m.geometry.setDrawRange(0, segCount * 6);
      m.material.uniforms.cameraPos.value.copy(camPos);

      if(t.fadeTimer >= 0){
        const frac = Math.max(0, t.fadeTimer / this.tailFadeTime);
        m.material.opacity = frac;
        m.material.uniforms.fadeScale.value = frac;
      } else {
        m.material.opacity = 1.0;
        m.material.uniforms.fadeScale.value = 1.0;
      }
    }
  }

  _recycle(t, idx){
    this._active.splice(idx, 1);
    t.mesh.visible = false;
    t.alive = false;
    t.mesh.geometry.setDrawRange(0, 0);
    t.mesh.material.opacity = 1.0;
    this._pool.push(t);
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
