const FlamethrowerEffect = (() => {

  /**
   * Build a solid cone volume with concentric rings.
   * The cone lies along +Z: narrow at z=0, wide at z=1.
   * UV.x = Z (0â†’1), UV.y = radial fraction (0 center â†’ 1 surface).
   */
  function _coneVolume(rings, slices, segs) {
    const P = [], UV = [], I = [];
    const R = rings, S = slices, G = segs;
    // stride = vertices per Z-slice
    const stride = (R + 1) * G;

    // vertices
    for (let s = 0; s <= S; s++) {
      const z = s / S;
      const maxR = z;                     // cone radius at this Z
      for (let r = 0; r <= R; r++) {
        const f = r / R;
        const rad = maxR * f;
        for (let g = 0; g < G; g++) {
          const a = (g / G) * Math.PI * 2;
          P.push(rad * Math.cos(a), rad * Math.sin(a), z);
          UV.push(z, f);
        }
      }
    }

    // indices â€” each cell is a hexahedron (or degenerate triangular prism at r=0)
    for (let s = 0; s < S; s++) {
      for (let r = 0; r < R; r++) {
        for (let g = 0; g < G; g++) {
          const ng = (g + 1) % G;

          // vertex helpers
          const v = (zs, ri, gi) => zs * stride + ri * G + gi;
          const f_ir = v(s,   r,   g);    // front, inner ring,  current seg
          const f_in = v(s,   r,   ng);   // front, inner ring,  next seg
          const f_or = v(s,   r+1, g);    // front, outer ring,  current seg
          const f_on = v(s,   r+1, ng);   // front, outer ring,  next seg
          const b_ir = v(s+1, r,   g);    // back,  inner ring,  current seg
          const b_in = v(s+1, r,   ng);   // back,  inner ring,  next seg
          const b_or = v(s+1, r+1, g);    // back,  outer ring,  current seg
          const b_on = v(s+1, r+1, ng);   // back,  outer ring,  next seg

          // 6 faces Ã— 2 triangles = 12 tris

          // 1. front face (segment g face, between Z-slices & rings)
          I.push(f_ir, f_or, b_ir);
          I.push(b_or, b_ir, f_or);

          // 2. back face (segment g+1 face)
          I.push(f_in, b_in, f_on);
          I.push(b_on, f_on, b_in);

          // 3. top face (outer ring, between Z-slices & segments)
          I.push(f_or, f_on, b_or);
          I.push(b_on, b_or, f_on);

          // 4. bottom face (inner ring)
          I.push(f_ir, b_in, f_in);
          I.push(b_in, f_ir, b_ir);

          // 5. left face (current Z-slice, between rings & segments)
          I.push(f_ir, f_in, f_or);
          I.push(f_on, f_or, f_in);

          // 6. right face (next Z-slice)
          I.push(b_ir, b_or, b_in);
          I.push(b_on, b_in, b_or);
        }
      }
    }

    return { positions: new Float32Array(P), uvs: new Float32Array(UV), indices: I };
  }

  /* â”€â”€â”€ shaders â”€â”€â”€ */
  const VSH = `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const FSH = `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    uniform float uSpeed;
    uniform float uIntensity;

    vec3 mod289(vec3 x){ return x - floor(x*(1./289.))*289.; }
    vec3 permute(vec3 x){ return mod289(((x*34.)+1.)*x); }

    float snoise(vec2 v){
      const vec4 C=vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
      vec2 i=floor(v+dot(v,C.yy));
      vec2 x0=v-i+dot(i,C.xx);
      vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
      vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1;
      i=mod289(i);
      vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
      vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
      m=m*m; m=m*m;
      vec3 x=2.*fract(p*C.www)-1.;
      return dot(m,x);
    }

    void main(){
      float z  = vUv.x;       // 0 at barrel, 1 at tip
      float rd = vUv.y;       // 0 at centre, 1 at surface

      float t = uTime * uSpeed;

      // multi-octave noise for organic flame shape
      float n1 = snoise(vec2(z*5. + t*1.3, rd*8.));
      float n2 = snoise(vec2(z*9. - t*.8 + 30., rd*12.));
      float n3 = snoise(vec2(z*3. + t*1.7 + 70., rd*5.));
      float noise = n1*.5 + n2*.3 + n3*.2;

      // edge erosion â€” keep centre solid, erode toward surface
      float core = 1. - smoothstep(0., .65 + .25*(1.-z), rd);
      float edgeErode = smoothstep(-.15, .5, noise + core*.7 - .3);
      float alpha = core * edgeErode;

      // fade tip
      alpha *= 1. - smoothstep(.35, 1., z);

      // intensity ramp
      alpha *= uIntensity;

      // colour gradient: white â†’ yellow â†’ orange â†’ red
      vec3 c1 = vec3(1.,1.,1.);
      vec3 c2 = vec3(1.,.92,.35);
      vec3 c3 = vec3(1.,.48,.04);
      vec3 c4 = vec3(.75,.12,0.);
      float m1 = smoothstep(0., .18, z);
      float m2 = smoothstep(.18, .45, z);
      float m3 = smoothstep(.45, .75, z);
      vec3 col = mix(c1,c2,m1);
      col = mix(col,c3,m2);
      col = mix(col,c4,m3);

      // brighten inner core
      col *= .8 + .5*(1.-rd);

      // alpha gradient along barrel
      alpha *= .5 + .7*(1.-z);

      // high-frequency flicker
      alpha *= .85 + .15*snoise(vec2(z*12. + t*3., rd*14.));

      gl_FragColor = vec4(col, alpha);
    }
  `;

  /* â”€â”€â”€ class â”€â”€â”€ */
  return class FlamethrowerEffect {
    constructor(scene) {
      this._scene = scene;
      this._isFiring = false;
      this._intensity = 0;

      this.uniforms = {
        uTime:      { value: 0 },
        uSpeed:     { value: 2.5 },
        uIntensity: { value: 0 },
      };

      const { positions, uvs, indices } = _coneVolume(8, 14, 10);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();

      this._material = new THREE.ShaderMaterial({
        vertexShader: VSH,
        fragmentShader: FSH,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });

      this._mesh = new THREE.Mesh(geo, this._material);
      this._mesh.visible = false;
      scene.add(this._mesh);
    }

    trigger(on) {
      this._isFiring = on;
    }

    update(dt) {
      this.uniforms.uTime.value += dt;
      if (this._isFiring) {
        this._intensity = Math.min(1, this._intensity + dt * 4);
      } else {
        this._intensity = Math.max(0, this._intensity - dt * 6);
      }
      this.uniforms.uIntensity.value = this._intensity;
      this._mesh.visible = this._intensity > 0.005;
    }

    setPosition(x, y, z) { this._mesh.position.set(x, y, z); }

    setDirection(q) { this._mesh.quaternion.copy(q); }

    setLength(v) { this._mesh.scale.z = v; }

    setWidth(v) { this._mesh.scale.x = this._mesh.scale.y = v; }

    setSpeed(v) { this.uniforms.uSpeed.value = v; }

    dispose() {
      this._scene.remove(this._mesh);
      this._mesh.geometry.dispose();
      this._material.dispose();
    }
  };
})();
