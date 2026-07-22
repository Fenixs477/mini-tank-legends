class WaterShader {

  static vertex(){
    return `
      uniform float uTime;
      varying vec2  vUv;
      varying vec3  vWorldPos;
      varying float vElevation;

      void main(){
        vUv = uv;
        vec3 pos = position;

        float w1 = sin(pos.x * 0.30 + uTime * 1.30) * 0.22;
        float w2 = sin(pos.z * 0.35 + uTime * 0.85) * 0.18;
        float w3 = sin((pos.x + pos.z) * 0.18 + uTime * 0.95) * 0.14;
        float w4 = sin(pos.x * 0.20 - pos.z * 0.28 + uTime * 0.60) * 0.10;
        pos.y += w1 + w2 + w3 + w4;
        vElevation = pos.y;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `;
  }

  static fragment(){
    return `
      uniform float uTime;
      uniform vec3  uShallowColor;
      uniform vec3  uDeepColor;
      uniform vec3  uFoamColor;

      varying vec2  vUv;
      varying vec3  vWorldPos;
      varying float vElevation;

      /* ---- hash / noise helpers ---- */
      float hash(vec2 p){
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float noise2d(vec2 p){
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      float fbm(vec2 p){
        float val = 0.0;
        float amp = 0.5;
        float freq = 1.0;
        for(int i = 0; i < 4; i++){
          val += amp * noise2d(p * freq);
          freq *= 2.0;
          amp *= 0.5;
        }
        return val;
      }

      /* ---- 2D rotation helper ---- */
      vec2 rot(vec2 p, float a){
        float s = sin(a), c = cos(a);
        return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
      }

      void main(){
        float dist = distance(vUv, vec2(0.5));
        float edgeFade = 1.0 - smoothstep(0.30, 0.48, dist);

        // Use world XZ for noise sampling (more natural than UV)
        vec2 wp = vWorldPos.xz;

        // Layer A — slow swell for deep ↔ shallow blend
        vec2 uvA = wp * 0.04 + uTime * 0.008;
        float nA = fbm(uvA);

        // Layer B — finer, counter-rotating
        vec2 uvB = rot(wp * 0.06, 0.6) + uTime * -0.005;
        float nB = fbm(uvB);

        float depthMix = (nA + nB) * 0.5;
        vec3 waterColor = mix(uShallowColor, uDeepColor, depthMix);

        // ---- Surface foam / caustics (high-frequency) ----
        vec2 foamUV = rot(wp * 0.12, uTime * 0.015);
        float foamFbm = fbm(foamUV + uTime * 0.04);
        float foam = smoothstep(0.48, 0.62, foamFbm);
        vec3 finalColor = mix(waterColor, uFoamColor, foam * 0.55);

        // ---- Shore contact foam (edge ring) ----
        float shoreFoam = smoothstep(0.38, 0.46, dist);
        float shoreNoise = fbm(wp * 0.15 + uTime * 0.03);
        shoreFoam *= smoothstep(0.35, 0.55, shoreNoise);
        finalColor = mix(finalColor, uFoamColor, shoreFoam * 0.65);

        // Alpha: base 0.75 with smooth edge fade
        float alpha = 0.75 * edgeFade;

        gl_FragColor = vec4(finalColor, alpha);
      }
    `;
  }

  static createMaterial(){
    return new THREE.ShaderMaterial({
      vertexShader:   WaterShader.vertex(),
      fragmentShader: WaterShader.fragment(),
      uniforms: {
        uTime:         { value: 0 },
        uShallowColor: { value: new THREE.Color('#4deeea') },
        uDeepColor:    { value: new THREE.Color('#004e92') },
        uFoamColor:    { value: new THREE.Color('#ffffff') },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
}
