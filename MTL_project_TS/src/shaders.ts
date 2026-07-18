/* shaders.ts — GLSL: water, metallic tank, ground, walls, trees, etc. */
import * as THREE from 'three';

interface ShaderDef {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

interface ShaderMap {
  [key: string]: ShaderDef;
}

export const SHADERS: ShaderMap = {
  water: {
    uniforms: {
      uTime: { value: 0 },
      uColorDeep: { value: new THREE.Color(0x1a3a5c) },
      uColorMid: { value: new THREE.Color(0x59c0e8) },
      uColorHighlight: { value: new THREE.Color(0xffffff) },
      uFoamColor: { value: new THREE.Color(0xffffff) },
      uNoiseTex: { value: null },
      uShoreRadius: { value: 18 },
      uNoiseScale: { value: 0.6 },
      uMidPos: { value: 0.35 },
      uFadeDistance: { value: 90 },
      uFadeStrength: { value: 1.4 },
      uProxPositions: { value: (function () { const a: THREE.Vector3[] = []; for (let i = 0; i < 48; i++) a.push(new THREE.Vector3(0, -999, 0)); return a; })() },
      uProxCount: { value: 0 },
    },
    vertexShader: `varying vec2 vWorldXZ; varying vec3 vWorld; varying vec3 vNormal;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldXZ = wp.xz; vWorld = wp.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uColorDeep; uniform vec3 uColorMid;
      uniform vec3 uColorHighlight; uniform vec3 uFoamColor; uniform sampler2D uNoiseTex;
      uniform float uShoreRadius; uniform float uNoiseScale; uniform float uMidPos;
      uniform float uFadeDistance; uniform float uFadeStrength;
      uniform vec3 uProxPositions[48]; uniform int uProxCount;
      varying vec2 vWorldXZ; varying vec3 vWorld; varying vec3 vNormal;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      void main(){
        vec3 N = normalize(vNormal); vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(vec3(0.5, 1.0, 0.3));
        vec2 flowUV = vWorldXZ * 0.2 + vec2(uTime * 0.07, uTime * -0.23);
        float noise1 = texture2D(uNoiseTex, flowUV * uNoiseScale).r;
        float noise2 = texture2D(uNoiseTex, flowUV * uNoiseScale * 1.7 + 0.3).r;
        float cellNoise = noise1 * noise2;
        float cell = smoothstep(0.1, 0.7, cellNoise + sin(vWorldXZ.x * 1.5 + vWorldXZ.y * 1.3 + uTime * 0.4) * 0.3);
        float mid = uMidPos; vec3 col;
        if(cell < mid) col = mix(uColorDeep, uColorMid, cell / mid);
        else col = mix(uColorMid, uColorHighlight, (cell - mid) / (1.0 - mid));
        float diff = max(dot(N, L), 0.0); col *= (0.7 + 0.3 * diff);
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 32.0); col += vec3(1.0) * spec * 0.04;
        float edgeDist = length(vWorldXZ) / uShoreRadius;
        float shoreW = 1.0 - smoothstep(0.85, 1.0, edgeDist);
        if(shoreW > 0.0){
          vec2 g = floor(vWorldXZ * 1.2 + uTime * 0.05);
          float dth = hash(g); float sz = smoothstep(0.15, 0.7, dth);
          float ns = texture2D(uNoiseTex, vWorldXZ * 0.4).r;
          float sf = shoreW * sz * (0.5 + 0.5 * ns);
          sf = smoothstep(0.1, 0.4, sf); col = mix(col, uFoamColor, sf * 0.7);
        }
        float ringAcc = 0.0, foamAcc = 0.0;
        for(int i = 0; i < 48; i++){ if(i >= uProxCount) break;
          vec2 op = uProxPositions[i].xz; float d = length(vWorldXZ - op);
          float age = uTime * 0.8; float r = age * 1.5;
          float rd = abs(d - r); float ring = 1.0 - smoothstep(0.0, 0.15, rd);
          ringAcc += ring * exp(-age * 0.8) * 0.6;
          if(d < 3.0){
            float fm = 1.0 - smoothstep(0.0, 3.0, d);
            float ph = sin(uTime * 1.2 + d * 2.0) * 0.5 + 0.5;
            vec2 off = vec2(sin(uTime * 0.5), cos(uTime * 0.6)) * 0.3;
            vec2 fg = floor((vWorldXZ + off) * 3.0);
            float fd = hash(fg + floor(uTime * 0.2)); float fs = smoothstep(0.1, 0.6, fd);
            float fn = texture2D(uNoiseTex, vWorldXZ * 0.5 + uTime * 0.01).r;
            float f = fm * fs * (0.4 + 0.6 * fn) * (0.4 + 0.6 * ph);
            f = smoothstep(0.05, 0.35, f); foamAcc = max(foamAcc, f);
          }
        }
        col = mix(col, uColorHighlight, clamp(ringAcc, 0.0, 1.0) * 0.5);
        col = mix(col, uFoamColor, foamAcc * 0.7);
        float dist = length(vWorldXZ);
        col *= 1.0 - pow(clamp(dist / uFadeDistance, 0.0, 1.0), uFadeStrength);
        gl_FragColor = vec4(col, 0.90);
      }`,
  },
  tank: {
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x8a8f98) } },
    vertexShader: `varying vec3 vNormal; varying vec3 vWorld;
      void main(){ vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime;
      varying vec3 vNormal; varying vec3 vWorld;
      void main(){
        vec3 N = normalize(vNormal); vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0);
        float fres = pow(1.0 - max(dot(N,V),0.0), 3.0);
        vec3 base = uColor * (0.35 + 0.65*diff);
        base += vec3(0.9,0.95,1.0) * fres * 0.5;
        float line = step(0.93, fract(vWorld.x*0.5 + vWorld.z*0.5));
        base *= (1.0 - line*0.25);
        gl_FragColor = vec4(base, 1.0);
      }`,
  },
  ground: {
    uniforms: { tMap: { value: null }, uTime: { value: 0 }, uFog: { value: new THREE.Color(0x2a2a2a) }, uHalf: { value: 300 } },
    vertexShader: `varying vec2 vUv; varying vec3 vWorld;
      void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform sampler2D tMap; uniform float uTime, uHalf; uniform vec3 uFog;
      varying vec2 vUv; varying vec3 vWorld;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      void main(){
        vec3 base = texture2D(tMap, vUv).rgb;
        float dither = (hash(floor(vWorld.xz*2.0))-0.5)*0.04;
        vec3 col = base + dither; float dist = length(vWorld.xz) / uHalf;
        float fog = smoothstep(0.6, 1.05, dist);
        col = mix(col, uFog, fog*0.8); gl_FragColor = vec4(col, 1.0);
      }`,
  },
  rock: {
    uniforms: { uColor: { value: new THREE.Color(0x55585c) }, uColorDark: { value: new THREE.Color(0x3c3e42) } },
    vertexShader: `varying vec3 vNormal; varying vec3 vWorld; varying float vHeight;
      void main(){ vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz; vHeight = position.y;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uColorDark;
      varying vec3 vNormal; varying vec3 vWorld; varying float vHeight;
      void main(){
        vec3 N = normalize(vNormal); vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0);
        float h = smoothstep(0.0, 5.0, vHeight);
        vec3 base = mix(uColorDark, uColor, h);
        float n = fract(sin(dot(floor(vWorld.xz*1.5), vec2(12.9898,78.233)))*43758.5453);
        base += (n - 0.5) * 0.06; base *= (0.4 + 0.6 * diff);
        gl_FragColor = vec4(base, 1.0);
      }`,
  },
  rockDark: {
    uniforms: { uColor: { value: new THREE.Color(0x3c3e42) } },
    vertexShader: `varying vec3 vNormal; varying vec3 vWorld; varying float vHeight;
      void main(){ vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz; vHeight = position.y;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor;
      varying vec3 vNormal; varying vec3 vWorld; varying float vHeight;
      void main(){
        vec3 N = normalize(vNormal); vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0);
        float grain = fract(sin(dot(floor(vWorld.xz*2.0), vec2(98.1,51.7)))*21345.3);
        vec3 col = uColor + (grain - 0.5) * 0.08; col *= (0.35 + 0.65 * diff);
        gl_FragColor = vec4(col, 1.0);
      }`,
  },
  treeTrunk: {
    uniforms: { uColor: { value: new THREE.Color(0x4a3320) } },
    vertexShader: `varying vec3 vNormal; varying vec3 vWorld;
      void main(){ vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vNormal; varying vec3 vWorld;
      void main(){
        vec3 N = normalize(vNormal); vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0);
        float bark = sin(vWorld.y * 2.0 + vWorld.x * 0.5) * 0.5 + 0.5;
        float grain = fract(sin(dot(floor(vWorld.xz*4.0), vec2(51.3,27.9)))*59423.7);
        vec3 col = uColor * (0.7 + 0.3 * bark) + (grain - 0.5) * 0.05;
        col *= (0.3 + 0.7 * diff); gl_FragColor = vec4(col, 1.0);
      }`,
  },
  treeLeaf: {
    uniforms: { uColor: { value: new THREE.Color(0x2e5d2a) }, uTime: { value: 0 } },
    vertexShader: `uniform float uTime; varying vec3 vNormal; varying vec3 vWorld; varying float vWind;
      void main(){ vNormal = normalize(normalMatrix * normal);
        vec3 p = position;
        float wind = sin(p.y * 0.8 + uTime * 1.3) * 0.03 + cos(p.x * 0.5 + uTime * 0.9) * 0.02;
        p.x += wind; p.z += wind * 0.6; vWind = wind;
        vec4 wp = modelMatrix * vec4(p,1.0); vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vNormal; varying vec3 vWorld; varying float vWind;
      void main(){
        vec3 N = normalize(vNormal); vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0); float ss = max(0.0, dot(N, -L)) * 0.3;
        vec3 col = uColor * (0.3 + 0.7 * diff + ss);
        float variation = sin(vWorld.x * 0.7 + vWorld.y * 1.2 + vWorld.z * 0.5) * 0.1;
        col += variation; gl_FragColor = vec4(col, 1.0);
      }`,
  },
  treeLeaf2: {
    uniforms: { uColor: { value: new THREE.Color(0x356b30) }, uTime: { value: 0 } },
    vertexShader: `uniform float uTime; varying vec3 vNormal; varying vec3 vWorld;
      void main(){ vNormal = normalize(normalMatrix * normal);
        vec3 p = position; float wind = sin(p.y*0.8 + uTime*1.3)*0.03 + cos(p.x*0.5 + uTime*0.9)*0.02;
        p.x += wind; p.z += wind*0.6; vec4 wp = modelMatrix * vec4(p,1.0); vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vNormal; varying vec3 vWorld;
      void main(){
        vec3 N = normalize(vNormal); vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0); float ss = max(0.0, dot(N, -L)) * 0.3;
        vec3 col = uColor * (0.3 + 0.7 * diff + ss);
        float variation = sin(vWorld.x*0.7 + vWorld.y*1.2 + vWorld.z*0.5)*0.1;
        col += variation; gl_FragColor = vec4(col, 1.0);
      }`,
  },
  bush: {
    uniforms: { uColor: { value: new THREE.Color(0x2c5a2a) }, uColor2: { value: new THREE.Color(0x357a33) } },
    vertexShader: `varying vec3 vNormal; varying vec3 vWorld; varying float vNoise;
      void main(){ vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz;
        vNoise = fract(sin(dot(floor(vWorld.xz*2.3), vec2(87.1,41.7)))*34251.3);
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uColor2; varying vec3 vNormal; varying vec3 vWorld; varying float vNoise;
      void main(){
        vec3 N = normalize(vNormal); vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0); vec3 base = mix(uColor, uColor2, vNoise);
        float depth = sin(vWorld.x*1.3 + vWorld.y*0.8 + vWorld.z*1.1) * 0.15;
        base += depth; base *= (0.35 + 0.65 * diff); gl_FragColor = vec4(base, 1.0);
      }`,
  },
  bushBig: {
    uniforms: { uColor: { value: new THREE.Color(0x1e4520) } },
    vertexShader: `varying vec3 vNormal; varying vec3 vWorld;
      void main(){ vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vNormal; varying vec3 vWorld;
      void main(){
        vec3 N = normalize(vNormal); vec3 L = normalize(vec3(0.5,1.0,0.3));
        float diff = max(dot(N,L),0.0);
        float grain = fract(sin(dot(floor(vWorld.xz*1.8), vec2(91.3,43.7)))*43127.5);
        vec3 col = uColor + (grain - 0.5) * 0.06; col *= (0.3 + 0.7 * diff);
        gl_FragColor = vec4(col, 1.0);
      }`,
  },
  shell: {
    uniforms: { uColor: { value: new THREE.Color(0xffdd44) }, uTime: { value: 0 } },
    vertexShader: `uniform float uTime; varying float vAlpha;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0);
        vAlpha = 0.7 + 0.3 * sin(uTime * 30.0 + position.x * 10.0);
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; varying float vAlpha;
      void main(){
        vec3 col = uColor; float glow = 1.0 - abs(vAlpha - 0.8) * 3.0;
        col += vec3(1.0, 0.6, 0.2) * max(0.0, glow);
        gl_FragColor = vec4(col, vAlpha * 0.9);
      }`,
  },
  flame: {
    uniforms: { uColor1: { value: new THREE.Color(0xff6600) }, uColor2: { value: new THREE.Color(0xffdd00) }, uTime: { value: 0 } },
    vertexShader: `uniform float uTime; varying vec3 vLocal; varying float vLife;
      void main(){ vec3 p = position; float life = 1.0 - (uTime * 0.5);
        vLife = clamp(life, 0.0, 1.0); p.x *= 1.0 + (1.0 - vLife) * 0.5;
        p.z *= 1.0 + (1.0 - vLife) * 0.5; vLocal = p;
        vec4 wp = modelMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor1; uniform vec3 uColor2; uniform float uTime;
      varying vec3 vLocal; varying float vLife;
      void main(){
        float d = length(vLocal.xz) / 0.8; float alpha = smoothstep(1.0, 0.0, d) * vLife;
        vec3 col = mix(uColor1, uColor2, d);
        float pulse = 0.8 + 0.2 * sin(uTime * 40.0 + vLocal.y * 5.0);
        col *= pulse; gl_FragColor = vec4(col, alpha * 0.7);
      }`,
  },
  explosion: {
    uniforms: { uColor: { value: new THREE.Color(0xff6622) }, uTime: { value: 0 } },
    vertexShader: `uniform float uTime; attribute float aLife; attribute vec3 aVel; varying float vAlpha;
      void main(){ float t = uTime; vec3 p = position + aVel * t;
        float life = 1.0 - t; vAlpha = clamp(life, 0.0, 1.0);
        float size = 0.3 + 0.5 * (1.0 - life);
        vec4 wp = modelMatrix * vec4(p, 1.0);
        gl_PointSize = size * (300.0 / -wp.z); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; varying float vAlpha;
      void main(){ vec2 c = gl_PointCoord - vec2(0.5); float d = length(c);
        if(d > 0.5) discard; float glow = 1.0 - smoothstep(0.0, 0.5, d);
        vec3 col = uColor * (1.0 + glow); gl_FragColor = vec4(col, vAlpha * glow); }`,
  },
  fireParticle: {
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xff7a1a) } },
    vertexShader: `uniform float uTime; attribute float aPhase; varying float vBright;
      void main(){ float flicker = 0.7 + 0.3 * sin(uTime * 8.0 + aPhase);
        vBright = flicker; float s = 1.0 + 0.2 * sin(uTime * 10.0 + aPhase);
        vec3 p = position * s; vec4 wp = modelMatrix * vec4(p, 1.0);
        gl_PointSize = 0.8 * (300.0 / -wp.z); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; varying float vBright;
      void main(){ vec2 c = gl_PointCoord - vec2(0.5); float d = length(c);
        if(d > 0.5) discard; float alpha = 1.0 - smoothstep(0.0, 0.5, d);
        vec3 col = uColor * (0.5 + 0.5 * vBright);
        col = mix(col, vec3(1.0, 0.9, 0.5), vBright * 0.3);
        gl_FragColor = vec4(col, alpha * 0.8); }`,
  },
  starDecal: {
    uniforms: { uColor: { value: new THREE.Color(0x000000) } },
    vertexShader: `varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; varying vec2 vUv;
      void main(){ vec2 c = vUv - vec2(0.5); float d = length(c);
        float alpha = smoothstep(0.5, 0.48, d); gl_FragColor = vec4(uColor, alpha * 0.85); }`,
  },
  dirtRim: {
    uniforms: { uColor: { value: new THREE.Color(0x5a4a2a) } },
    vertexShader: `varying vec3 vWorld;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vWorld;
      void main(){ float grain = fract(sin(dot(floor(vWorld.xz*3.0), vec2(67.1,33.7)))*23451.3);
        vec3 col = uColor + (grain - 0.5) * 0.05; gl_FragColor = vec4(col, 1.0); }`,
  },
  tread: {
    uniforms: { uColor: { value: new THREE.Color(0x222226) } },
    vertexShader: `varying vec3 vWorld; void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vWorld;
      void main(){ float lines = step(0.5, fract(vWorld.z * 2.0));
        vec3 col = uColor * (0.8 + 0.2 * lines); gl_FragColor = vec4(col, 1.0); }`,
  },
  barrel: {
    uniforms: { uColor: { value: new THREE.Color(0x2a2a2e) } },
    vertexShader: `varying vec3 vNormal; varying vec3 vWorld;
      void main(){ vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vNormal; varying vec3 vWorld;
      void main(){
        vec3 N = normalize(vNormal); vec3 L = normalize(vec3(0.5, 1.0, 0.3));
        float diff = max(dot(N, L), 0.0);
        float spec = pow(max(dot(N, normalize(L + normalize(cameraPosition - vWorld))), 0.0), 16.0);
        vec3 col = uColor * (0.3 + 0.7 * diff); col += vec3(0.6) * spec * 0.5;
        gl_FragColor = vec4(col, 1.0);
      }`,
  },
};

/* Noise texture generation */
function _shaderNoiseHash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return (h ^ (h >> 16)) & 0xFF;
}
function _shaderSmoothNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = _shaderNoiseHash(ix, iy);
  const n10 = _shaderNoiseHash(ix + 1, iy);
  const n01 = _shaderNoiseHash(ix, iy + 1);
  const n11 = _shaderNoiseHash(ix + 1, iy + 1);
  const top = n00 + (n10 - n00) * sx;
  const bot = n01 + (n11 - n01) * sx;
  return (top + (bot - top) * sy) / 255;
}
function _shaderFbm(x: number, y: number, octaves: number): number {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * _shaderSmoothNoise(x * freq, y * freq);
    amp *= 0.5; freq *= 2;
  }
  return val;
}

export function generateNoiseTexture(size: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = _shaderFbm(x / size * 4, y / size * 4, 4) * 255;
      const idx = (y * size + x) * 4;
      data[idx] = v; data[idx + 1] = v; data[idx + 2] = v; data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function generateDistortionTexture(size: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(size, size);
  const data = imgData.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const angle = Math.random() * Math.PI * 2;
      data[idx] = Math.floor((Math.cos(angle) * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor((Math.sin(angle) * 0.5 + 0.5) * 255);
      data[idx + 2] = 128;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
