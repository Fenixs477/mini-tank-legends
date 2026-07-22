class WaterShader {

  static vertex(){
    return `
      uniform float uTime;
      varying vec3  vWorldPos;

      void main(){
        vec3 pos = position;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;

        /* subtle wave displacement in world space */
        pos.y += sin(worldPos.x * 0.20 + uTime * 2.0) *
                 cos(worldPos.z * 0.20 + uTime * 1.5) * 0.10;

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
        /* all noise sampled in world space — seamless across chunks */
        vec2 wp = vWorldPos.xz;

        /* deep vibrant toon blue base */
        vec3 waterColor = vec3(0.0, 0.45, 0.85);

        /* surface wave foam — world-space noise, step for sharp toon */
        float noiseVal = fbm(wp * 0.18 + uTime * 0.03);
        float surfaceFoam = step(0.65, noiseVal);

        /* tank contact foam — world-space distance */
        float distToTank = distance(wp, uTankPosition.xz);
        float tankFoam = step(distToTank, 2.5) * step(1.0, distToTank);
        float tankNoise = fbm(wp * 0.30 + uTime * 0.05);
        tankFoam *= step(0.40, tankNoise);

        float totalFoam = clamp(surfaceFoam + tankFoam, 0.0, 1.0);
        vec3 finalColor = mix(waterColor, uFoamColor, totalFoam);

        gl_FragColor = vec4(finalColor, 0.95);
      }
    `;
  }

  static createMaterial(){
    return new THREE.ShaderMaterial({
      vertexShader:   WaterShader.vertex(),
      fragmentShader: WaterShader.fragment(),
      uniforms: {
        uTime:         { value: 0 },
        uBaseColor:    { value: new THREE.Color('#0073d9') },
        uFoamColor:    { value: new THREE.Color('#ffffff') },
        uTankPosition: { value: new THREE.Vector3(0, 0, 0) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
}
