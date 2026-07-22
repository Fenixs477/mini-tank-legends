class WaterShader {

  static vertex(){
    return `
      uniform float uTime;
      varying vec2  vUv;
      varying float vElevation;

      void main(){
        vUv = uv;
        vec3 pos = position;

        float w1 = sin(pos.x * 0.30 + uTime * 1.2) * 0.35;
        float w2 = sin(pos.z * 0.25 + uTime * 0.9) * 0.30;
        float w3 = sin(pos.x * 0.18 + pos.z * 0.22 + uTime * 0.7) * 0.20;
        pos.y += w1 + w2 + w3;
        vElevation = pos.y;

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
      varying float vElevation;

      // --- hash / noise helpers ---
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
        vec2 uv = vUv * 6.0;

        // depth-like blend using UV-based noise (no scene depth needed)
        float depthMix = fbm(uv * 0.4);
        vec3 waterColor = mix(uShallowColor, uDeepColor, depthMix);

        // toon banding
        float band = floor(depthMix * 4.0 + 0.5) / 4.0;
        waterColor = mix(uShallowColor, uDeepColor, band);

        // foam lines
        float foamNoise = fbm(uv * 1.2 + uTime * 0.06);
        float foam = smoothstep(0.48, 0.56, foamNoise);
        vec3 finalColor = mix(waterColor, uFoamColor, foam);

        // shore ring foam — distance from center
        float dist = distance(vUv, vec2(0.5));
        float edgeFoam = smoothstep(0.36, 0.50, dist);
        finalColor = mix(finalColor, uFoamColor, edgeFoam * 0.55);

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
        uShallowColor: { value: new THREE.Color('#4deeea') },
        uDeepColor:    { value: new THREE.Color('#0a3060') },
        uFoamColor:    { value: new THREE.Color('#ffffff') },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
}
