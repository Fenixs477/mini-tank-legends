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

        /* subtle wave displacement — 0.15 max */
        pos.y += sin(pos.x * 0.2 + uTime * 1.5) * cos(pos.z * 0.2 + uTime * 1.0) * 0.15;
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

      void main(){
        vec2 wp = vWorldPos.xz;

        /* water color — shallow / deep blend */
        float waveMix = 0.5 + 0.5 * sin(wp.x * 0.02 + wp.y * 0.03 + uTime * 0.05);
        vec3 waterColor = mix(uShallowColor, uDeepColor, waveMix);

        /* 1. SOLID SHARP SHORE FOAM — no alpha fade */
        float shoreDist = length(vUv - vec2(0.5));
        float shoreFoam = step(0.44, shoreDist);
        float shoreNoise = fbm(wp * 0.20 + uTime * 0.04);
        shoreFoam *= step(0.35, shoreNoise);

        /* 2. TANK CONTACT FOAM */
        float distToTank = distance(wp, uTankPosition.xz);
        float tankFoam = step(distToTank, 2.8) * step(1.2, distToTank);
        float tankNoise = fbm(wp * 0.35 + uTime * 0.06);
        tankFoam *= step(0.40, tankNoise);

        /* 3. WAVE-CREST FOAM */
        float crestNoise = fbm(wp * 0.25 + uTime * 0.05);
        float surfaceWaveFoam = step(0.03, vElevation) * step(0.48, crestNoise);

        float totalFoam = clamp(shoreFoam + tankFoam + surfaceWaveFoam, 0.0, 1.0);
        vec3 finalColor = mix(waterColor, uFoamColor, totalFoam);

        /* fully opaque — solid toon look */
        gl_FragColor = vec4(finalColor, 1.0);
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
