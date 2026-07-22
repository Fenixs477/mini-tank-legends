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

        float w1 = sin(pos.x * 0.5 + uTime * 2.0) * 0.3;
        float w2 = sin(pos.z * 0.4 + uTime * 1.5) * 0.2;
        pos.y += w1 + w2;
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
      uniform vec3  uTankPosition;

      varying vec2  vUv;
      varying vec3  vWorldPos;
      varying float vElevation;

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

      vec2 rot(vec2 p, float a){
        float s = sin(a), c = cos(a);
        return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
      }

      void main(){
        float dist = distance(vUv, vec2(0.5));
        float edgeFade = 1.0 - smoothstep(0.30, 0.50, dist);

        vec2 wp = vWorldPos.xz;

        /* ---- depth blend ---- */
        vec2 uvA = wp * 0.04 + uTime * 0.008;
        vec2 uvB = rot(wp * 0.06, 0.6) + uTime * -0.005;
        float depthMix = (fbm(uvA) + fbm(uvB)) * 0.5;
        vec3 waterColor = mix(uShallowColor, uDeepColor, depthMix);

        /* ---- crisp surface foam (step = toon) ---- */
        vec2 foamUV = rot(wp * 0.15, uTime * 0.015);
        float foamRaw = fbm(foamUV + uTime * 0.04);
        float foam = step(0.50, foamRaw);
        vec3 finalColor = mix(waterColor, uFoamColor, foam * 0.55);

        /* ---- wave-crest foam (crisp white lines on peaks) ---- */
        float crestNoise = fbm(wp * 0.3 + uTime * 0.06);
        float crestFoam = step(0.08, vElevation) * step(0.45, crestNoise);
        finalColor = mix(finalColor, uFoamColor, crestFoam * 0.70);

        /* ---- shore foam ring (at lake edge) ---- */
        float shoreFbm = fbm(wp * 0.15 + uTime * 0.03);
        float shore = step(0.38, dist) * step(0.40, shoreFbm);
        finalColor = mix(finalColor, uFoamColor, shore * 0.70);

        /* ---- tank contact foam ---- */
        float distToTank = distance(wp, uTankPosition.xz);
        float tankRing = step(distToTank, 2.5) * step(1.5, distToTank);
        float tankNoise = fbm(wp * 0.3 + uTime * 0.05);
        tankRing *= step(0.40, tankNoise);
        finalColor = mix(finalColor, uFoamColor, tankRing * 0.80);

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
        uTankPosition: { value: new THREE.Vector3(0, 0, 0) },
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
