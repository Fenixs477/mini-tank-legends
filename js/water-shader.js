class WaterShader {

  static vertex(){
    return `
      uniform float uTime;
      varying vec2  vUv;
      varying float vElevation;

      void main(){
        vUv = uv;
        vec3 pos = position;

        float w1 = sin(pos.x * 0.30 + uTime * 1.2) * 0.12;
        float w2 = sin(pos.z * 0.25 + uTime * 0.9) * 0.10;
        float w3 = sin(pos.x * 0.18 + pos.z * 0.22 + uTime * 0.7) * 0.08;
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
        float dist = distance(vUv, vec2(0.5));
        float edgeAlpha = 1.0 - smoothstep(0.30, 0.50, dist);

        // Two noise layers for organic water mixing
        vec2 uv1 = vUv * 8.0 + uTime * 0.02;
        vec2 uv2 = vUv * 6.0 + uTime * -0.015;
        float n1 = fbm(uv1);
        float n2 = fbm(uv2);

        // Blend shallow ↔ deep using combined noise
        float depthMix = (n1 + n2) * 0.5;
        vec3 waterColor = mix(uShallowColor, uDeepColor, depthMix);

        // Caustic / foam lines from higher-frequency noise
        vec2 foamUV = vUv * 10.0 + uTime * 0.04;
        float foamNoise = fbm(foamUV);
        float foam = smoothstep(0.45, 0.62, foamNoise);
        vec3 finalColor = mix(waterColor, uFoamColor, foam * 0.6);

        // Final alpha: base 0.7 with smooth edge fade
        float alpha = 0.70 * edgeAlpha;

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
        uShallowColor: { value: new THREE.Color('#40e0d0') },
        uDeepColor:    { value: new THREE.Color('#0077be') },
        uFoamColor:    { value: new THREE.Color('#ffffff') },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
}
