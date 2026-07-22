class WaterShader {

  static vertex(){
    return `
      uniform float uTime;
      varying vec2  vUv;
      varying vec3  vWorldPos;

      void main(){
        vUv = uv;
        vec3 pos = position;

        float w1 = sin(pos.x * 0.30 + uTime * 1.6) * 0.08;
        float w2 = sin(pos.z * 0.28 + uTime * 1.2) * 0.06;
        pos.y += w1 + w2;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `;
  }

  static fragment(){
    return `
      uniform float uTime;
      uniform vec3  uBaseColor;
      uniform vec3  uFoamColor;
      uniform vec3  uTankPosition;

      varying vec2  vUv;
      varying vec3  vWorldPos;

      /* ---- noise helpers ---- */
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

      void main(){
        vec2 wp = vWorldPos.xz;

        /* base colour — deep blue */
        vec3 waterColor = uBaseColor;

        /* ---- beautiful animated surface foam (2 layers) ---- */
        /* layer A — large slow swirls */
        vec2 uvA = wp * 0.12 + uTime * 0.025;
        float foamA = fbm(uvA);

        /* layer B — finer, counter-rotating, warped by layer A */
        vec2 uvB = wp * 0.20 - uTime * 0.035;
        uvB += foamA * 0.35;
        float foamB = fbm(uvB);

        float foamMix = (foamA + foamB) * 0.5;
        float surfaceFoam = smoothstep(0.42, 0.58, foamMix);
        vec3 finalColor = mix(waterColor, uFoamColor, surfaceFoam * 0.50);

        /* ---- clean shoreline contact foam ---- */
        float shoreDist = distance(vUv, vec2(0.5));
        float shoreWobble = fbm(wp * 0.25 + uTime * 0.03) * 0.035;
        float shore = smoothstep(0.44 + shoreWobble, 0.48 + shoreWobble, shoreDist);
        finalColor = mix(finalColor, uFoamColor, shore * 0.85);

        /* ---- tank contact foam ---- */
        float distToTank = distance(wp, uTankPosition.xz);
        float tankRing = step(distToTank, 2.0) * step(0.8, distToTank);
        float tankNoise = fbm(wp * 0.35 + uTime * 0.06);
        tankRing *= step(0.35, tankNoise);
        finalColor = mix(finalColor, uFoamColor, tankRing * 0.80);

        gl_FragColor = vec4(finalColor, 0.88);
      }
    `;
  }

  static createMaterial(){
    return new THREE.ShaderMaterial({
      vertexShader:   WaterShader.vertex(),
      fragmentShader: WaterShader.fragment(),
      uniforms: {
        uTime:         { value: 0 },
        uBaseColor:    { value: new THREE.Color('#005fa3') },
        uFoamColor:    { value: new THREE.Color('#ffffff') },
        uTankPosition: { value: new THREE.Vector3(0, 0, 0) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
}
