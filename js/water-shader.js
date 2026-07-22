/* ============================================================
   water-shader.js — Stylized lake shader with depth-based
   color blending and animated waves (Alexander Ameye style).
   Requires a depth pre-pass to compute water depth.
   ============================================================ */

class WaterShader {

  /* ---- GLSL vertex ---- */
  static vertex(){
    return `
      varying vec2 vUv;
      varying vec4 vScreenPos;
      varying vec3 vViewPosition;

      uniform float uTime;

      void main(){
        vUv = uv;

        vec3 pos = position;

        // Animated waves (modify height / Y axis)
        pos.y += sin(pos.x * 2.0 + uTime * 1.5) * 0.12;
        pos.y += cos(pos.z * 1.5 + uTime * 1.0) * 0.08;

        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
        vViewPosition = mvPos.xyz;
        vec4 proj = projectionMatrix * mvPos;
        vScreenPos = proj;
        gl_Position  = proj;
      }
    `;
  }

  /* ---- GLSL fragment ---- */
  static fragment(){
    return `
      uniform sampler2D   uDepthTexture;
      uniform vec2        uResolution;
      uniform float       uCameraNear;
      uniform float       uCameraFar;
      uniform float       uTime;

      uniform vec3  uShallowColor;
      uniform vec3  uDeepColor;
      uniform vec3  uFoamColor;

      varying vec2  vUv;
      varying vec4  vScreenPos;
      varying vec3  vViewPosition;

      float readDepth(sampler2D depthTex, vec2 coord){
        float z = texture2D(depthTex, coord).x;
        return (uCameraNear * uCameraFar) / ((uCameraFar - uCameraNear) * z - uCameraFar);
      }

      void main(){
        vec2 screenUV = (vScreenPos.xy / vScreenPos.w) * 0.5 + 0.5;

        float sceneDepth = readDepth(uDepthTexture, screenUV);
        float waterDepth = vViewPosition.z - sceneDepth;

        // Colour blend shallow → deep
        float depthFactor = clamp(waterDepth / 3.0, 0.0, 1.0);
        vec3 waterColor = mix(uShallowColor, uDeepColor, depthFactor);

        // Foam at shore
        float foamNoise = sin(vUv.x * 25.0 + uTime * 3.0) * 0.08 +
                          cos(vUv.y * 20.0 + uTime * 2.5) * 0.06;
        float foam = step(waterDepth, 0.35 + foamNoise);
        vec3 finalColor = mix(waterColor, uFoamColor, foam);

        float alpha = clamp(waterDepth / 0.5, 0.35, 0.88);

        gl_FragColor = vec4(finalColor, alpha);
      }
    `;
  }

  /* ---- factory: create material for a lake mesh ---- */
  static createMaterial(depthTexture, camera){
    return new THREE.ShaderMaterial({
      vertexShader:   WaterShader.vertex(),
      fragmentShader: WaterShader.fragment(),
      uniforms: {
        uTime:           { value: 0 },
        uDepthTexture:   { value: depthTexture },
        uResolution:     { value: new THREE.Vector2(innerWidth, innerHeight) },
        uCameraNear:     { value: camera.near },
        uCameraFar:      { value: camera.far },
        uShallowColor:   { value: new THREE.Color('#4deeea') },
        uDeepColor:      { value: new THREE.Color('#0a1a4a') },
        uFoamColor:      { value: new THREE.Color('#ffffff') },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
}
