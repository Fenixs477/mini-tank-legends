class WaterShader {

  static vertex(){
    return `
      uniform float uTime;
      uniform float uLakeRadius;

      varying vec3  vWorldPos;
      varying float vEdgeDist;

      void main(){
        vec3 pos = position;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;

        /* 0 = center, 1 = shoreline edge */
        vEdgeDist = length(position.xz) / uLakeRadius;

        pos.y += sin(worldPos.x * 0.20 + uTime * 2.0) *
                 cos(worldPos.z * 0.20 + uTime * 1.5) * 0.10;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `;
  }

  static fragment(){
    return `
      uniform float uTime;
      uniform vec3  uDeepColor;
      uniform vec3  uAquaColor;
      uniform vec3  uFoamColor;
      uniform vec3  uTankPosition;

      varying vec3  vWorldPos;
      varying float vEdgeDist;

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

        /* layer 1 — deep blue ↔ aqua underwater edge */
        float aquaWobble = fbm(wp * 0.12 + uTime * 0.02) * 0.08;
        float shallowMask = smoothstep(0.45 + aquaWobble, 0.82 + aquaWobble, vEdgeDist);
        vec3 waterColor = mix(uDeepColor, uAquaColor, shallowMask);

        /* layer 2 — surface foam (world-space noise, seamless) */
        float surfNoise = fbm(wp * 0.18 + uTime * 0.03);
        float surfaceFoam = step(0.65, surfNoise);

        /* layer 3 — sharp shoreline white foam */
        float shoreWobble = fbm(wp * 0.25 + uTime * 0.035) * 0.04;
        float shorelineFoam = step(0.90 + shoreWobble, vEdgeDist);

        /* layer 4 — tank contact ring */
        float distToTank = distance(wp, uTankPosition.xz);
        float tankRing = step(distToTank, 2.5) * step(1.0, distToTank);
        float tankNoise = fbm(wp * 0.30 + uTime * 0.05);
        tankRing *= step(0.40, tankNoise);

        float totalCover = clamp(shorelineFoam + surfaceFoam + tankRing, 0.0, 1.0);
        vec3 finalColor = mix(waterColor, uFoamColor, totalCover);

        gl_FragColor = vec4(finalColor, 0.95);
      }
    `;
  }

  static createMaterial(radius){
    return new THREE.ShaderMaterial({
      vertexShader:   WaterShader.vertex(),
      fragmentShader: WaterShader.fragment(),
      uniforms: {
        uTime:         { value: 0 },
        uLakeRadius:   { value: radius },
        uDeepColor:    { value: new THREE.Color('#0066cc') },
        uAquaColor:    { value: new THREE.Color('#2cd5c4') },
        uFoamColor:    { value: new THREE.Color('#ffffff') },
        uTankPosition: { value: new THREE.Vector3(0, 0, 0) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
}
