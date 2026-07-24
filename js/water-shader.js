class WaterShader {

  static vertex(){
    return `
      uniform float uTime;

      varying vec3  vWorldPos;
      varying vec2  vUv;

      void main(){
        vec3 pos = position;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;
        vUv = uv;

        float wave = sin(worldPos.x * 0.2 + uTime * 1.5) *
                     cos(worldPos.z * 0.2 + uTime * 1.2) * 0.04;
        pos.y += max(0.0, wave);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `;
  }

  static fragment(){
    return `
      uniform float uTime;
      uniform vec3  uDeepColor;
      uniform vec3  uSurfaceColor;
      uniform vec3  uAquaColor;
      uniform vec3  uFoamColor;
      uniform vec3  uTankPosition;

      varying vec3  vWorldPos;
      varying vec2  vUv;

      float hash(vec2 p){
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float noise(vec2 p){
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      void main(){
        /* â€” underwater depth currents (slow) â€” */
        vec2 depthUV = vWorldPos.xz * 0.08 + vec2(uTime * 0.05, uTime * 0.03);
        float depthNoise = noise(depthUV);
        vec3 baseWater = mix(uSurfaceColor, uDeepColor,
                             smoothstep(-0.2, 0.5, depthNoise));

        /* â€” shore edge with heavy noise distortion â€” */
        vec2 centerOffset = vUv - vec2(0.5);
        float distFromCenter = length(centerOffset) * 2.0;
        float angle = atan(centerOffset.y, centerOffset.x);
        distFromCenter += sin(angle * 5.0 + uTime * 0.3) * 0.04 +
                          sin(angle * 8.0 + uTime * 0.2 + 1.2) * 0.025 +
                          sin(angle * 3.0 + uTime * 0.15 + 3.1) * 0.03;
        vec2 shoreUV = vWorldPos.xz * 0.2 +
                       vec2(sin(uTime * 1.5) * 0.4, sin(uTime * 0.4) * 0.6);
        vec2 shoreUV2 = vWorldPos.xz * 0.4 +
                        vec2(sin(uTime * 0.7) * 0.6, sin(uTime * 0.25) * 0.8);
        float shoreEdge = distFromCenter +
                          noise(shoreUV) * 0.25 +
                          noise(shoreUV2) * 0.12;

        /* aqua rim near shore */
        baseWater = mix(baseWater, uAquaColor,
                        smoothstep(0.6, 0.85, shoreEdge));

        /* sharp shoreline foam â€” ragged inner edge toward lake */
        float foamJitter = noise(vWorldPos.xz * 0.8 + sin(uTime * 0.3) * 0.4) * 0.10;
        float foamBreath = sin(uTime * 0.3) * 0.04;
        float shorelineFoam = step(0.93 + foamJitter + foamBreath, shoreEdge);

        /* â€” floating surface foam patches â€” */
        vec2 surfaceUV = vWorldPos.xz * 0.35 +
                         vec2(sin(uTime * 0.25) * 0.6, sin(uTime * 0.18) * 0.4);
        float surfaceFoam = step(0.75, noise(surfaceUV));

        /* â€” tank contact ring â€” */
        float distToTank = distance(vWorldPos.xz, uTankPosition.xz);
        float tankRing = step(distToTank, 2.5) * step(1.0, distToTank);
        float tankNoise = noise(vWorldPos.xz * 0.3 + uTime * 0.05);
        tankRing *= step(0.4, tankNoise);

        /* â€” final assembly â€” */
        vec3 finalColor = mix(baseWater, uFoamColor,
                              max(surfaceFoam * 0.7, shorelineFoam + tankRing));

        gl_FragColor = vec4(finalColor, 0.93);
      }
    `;
  }

  static createMaterial(radius){
    return new THREE.ShaderMaterial({
      vertexShader:   WaterShader.vertex(),
      fragmentShader: WaterShader.fragment(),
      uniforms: {
        uTime:         { value: 0 },
        uDeepColor:    { value: new THREE.Color(0.318, 0.529, 1.0) },
        uSurfaceColor: { value: new THREE.Color(0.0, 0.45, 0.85) },
        uAquaColor:    { value: new THREE.Color(0.318, 0.667, 1.0) },
        uFoamColor:    { value: new THREE.Color(1.0, 1.0, 1.0) },
        uTankPosition: { value: new THREE.Vector3(0, 0, 0) },
      },
      transparent: true,
      opacity: 0.93,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
}
