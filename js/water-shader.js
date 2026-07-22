class WaterShader {

  static vertex(){
    return `
      uniform float uTime;
      varying vec2  vUv;
      varying vec3  vWorldPos;

      void main(){
        vUv = uv;
        vec3 pos = position;

        float wave = sin(pos.x * 0.3 + uTime * 2.0) * 0.08 +
                     sin(pos.z * 0.25 + uTime * 1.4) * 0.06;
        pos.y += wave;

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

        /* base water color */
        vec3 waterColor = uBaseColor;

        /* animated caustic lines on the surface */
        float causticNoise = fbm(wp * 0.22 + uTime * 0.04);
        float caustic = step(0.52, causticNoise);
        vec3 finalColor = mix(waterColor, uFoamColor, caustic * 0.40);

        /* sharp toon shoreline foam — at circle UV edge (dist ~0.5) */
        float shoreDist = distance(vUv, vec2(0.5));
        float shoreFoam = step(0.42, shoreDist);
        float shoreNoise = fbm(wp * 0.18 + uTime * 0.035);
        shoreFoam *= step(0.30, shoreNoise);
        finalColor = mix(finalColor, uFoamColor, shoreFoam * 0.85);

        /* tank contact foam ring */
        float distToTank = distance(wp, uTankPosition.xz);
        float tankFoam = step(distToTank, 2.0) * step(0.8, distToTank);
        float tankNoise = fbm(wp * 0.35 + uTime * 0.06);
        tankFoam *= step(0.40, tankNoise);
        finalColor = mix(finalColor, uFoamColor, tankFoam * 0.80);

        gl_FragColor = vec4(finalColor, 0.75);
      }
    `;
  }

  static createMaterial(){
    return new THREE.ShaderMaterial({
      vertexShader:   WaterShader.vertex(),
      fragmentShader: WaterShader.fragment(),
      uniforms: {
        uTime:         { value: 0 },
        uBaseColor:    { value: new THREE.Color('#3ccfde') },
        uFoamColor:    { value: new THREE.Color('#ffffff') },
        uTankPosition: { value: new THREE.Vector3(0, 0, 0) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
}
