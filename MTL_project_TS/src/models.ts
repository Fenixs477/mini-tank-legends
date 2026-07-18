/* models.ts — GLTF/GLB/Collada loader + cache + nature OBJ preloader */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { CONFIG } from './config';

interface CacheEntry {
  gltf: THREE.Group | null;
  tried: boolean;
}
type CacheMap = Record<string, CacheEntry>;
type AvailableMap = Record<string, boolean>;

export const Models = {
  _cache: {} as CacheMap,
  _loader: null as GLTFLoader | null,
  _colladaLoader: null as ColladaLoader | null,
  _available: null as AvailableMap | null,

  loader(): GLTFLoader | null {
    if (!this._loader) {
      try { this._loader = new GLTFLoader(); } catch (_e) { this._loader = null; }
    }
    return this._loader;
  },

  colladaLoader(): ColladaLoader | null {
    if (!this._colladaLoader) {
      try { this._colladaLoader = new ColladaLoader(); } catch (_e) { this._colladaLoader = null; }
    }
    return this._colladaLoader;
  },

  async probe(names: string[]): Promise<AvailableMap> {
    const out: AvailableMap = {};
    await Promise.all(names.map(async (n) => {
      out[n] = await this._exists(CONFIG.MODEL_DIR + n + '.glb');
      if (!out[n]) out[n] = await this._exists(CONFIG.MODEL_DIR + n + '.gltf');
      if (!out[n]) out[n] = await this._exists(CONFIG.MODEL_DIR + n + '.dae');
    }));
    this._available = out;
    return out;
  },

  _exists(url: string): Promise<boolean> {
    return new Promise(res => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('HEAD', url, true);
        xhr.onload = () => {
          if (xhr.status === 0) this._getProbe(url).then(res);
          else res(xhr.status >= 200 && xhr.status < 300);
        };
        xhr.onerror = () => this._getProbe(url).then(res);
        xhr.send();
      } catch (_e) { this._getProbe(url).then(res); }
    });
  },

  _getProbe(url: string): Promise<boolean> {
    return new Promise(res => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.onreadystatechange = () => { if (xhr.readyState >= 2) { res(xhr.status === 0 || xhr.status < 400); xhr.abort(); } };
        xhr.onerror = () => res(false);
        xhr.send();
      } catch (_e) { res(false); }
    });
  },

  hasModel(name: string): boolean {
    if (this._available && this._available[name]) return true;
    return typeof (window as any).__GLB_DATA__ !== 'undefined' && !!(window as any).__GLB_DATA__[name];
  },

  load(name: string): Promise<THREE.Group | null> {
    if (this._cache[name]) return Promise.resolve(this._cache[name].gltf && this._clone(name));
    this._cache[name] = { gltf: null, tried: false };
    if (!this.hasModel(name)) {
      this._cache[name].tried = true;
      return Promise.resolve(null);
    }
    const loader = this.loader();
    if (!loader) return this._loadCollada(name);
    return this._tryLoad(name, '.glb')
      .catch(() => this._tryLoad(name, '.gltf'))
      .catch(() => this._loadCollada(name))
      .catch(() => { this._cache[name].tried = true; return null; });
  },

  _tryLoad(name: string, ext: string): Promise<THREE.Group | null> {
    return new Promise((resolve, reject) => {
      if (typeof (window as any).__GLB_DATA__ !== 'undefined' && (window as any).__GLB_DATA__[name] && ext === '.glb') {
        const url = 'data:application/octet-stream;base64,' + (window as any).__GLB_DATA__[name];
        this.loader()!.load(url, (gltf: any) => {
          this._cache[name].gltf = gltf.scene || gltf;
          this._cache[name].tried = true;
          resolve(this._clone(name));
        }, undefined, reject);
        return;
      }
      this.loader()!.load(
        CONFIG.MODEL_DIR + name + ext,
        (gltf: any) => {
          this._cache[name].gltf = gltf.scene || gltf;
          this._cache[name].tried = true;
          resolve(this._clone(name));
        },
        undefined,
        reject
      );
    });
  },

  _loadCollada(name: string): Promise<THREE.Group | null> {
    return new Promise(resolve => {
      const loader = this.colladaLoader();
      if (!loader) { this._cache[name].tried = true; resolve(null); return; }
      loader.load(
        CONFIG.MODEL_DIR + name + '.dae',
        (result: any) => {
          const scene = result.scene;
          if (!scene) { this._cache[name].tried = true; resolve(null); return; }
          scene.scale.setScalar(0.5);
          scene.traverse((o: THREE.Object3D) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).castShadow = true; (o as THREE.Mesh).receiveShadow = true; } });
          this._cache[name].gltf = scene;
          this._cache[name].tried = true;
          resolve(this._clone(name));
        },
        undefined,
        () => { this._cache[name].tried = true; resolve(null); }
      );
    });
  },

  _clone(name: string): THREE.Group | null {
    const src = this._cache[name].gltf;
    if (!src) return null;
    return src.clone(true);
  },
};

/* Nature OBJ pre-loader */
export const NatureAssets = {
  trees: [] as THREE.Group[],
  rocks: [] as THREE.Group[],
  bushes: [] as THREE.Group[],
  loaded: false,
  _loading: false,

  async loadAll(): Promise<void> {
    if (this._loading || this.loaded) return;
    this._loading = true;
    const loader = new OBJLoader();
    const base = 'nature/';
    const files = {
      trees: ['BirchTree_1', 'BirchTree_2', 'BirchTree_3', 'CommonTree_1', 'CommonTree_2'],
      rocks: ['Rock_1', 'Rock_2', 'Rock_3', 'Rock_Moss_1', 'Rock_Moss_2'],
      bushes: ['Bush_1', 'Bush_2', 'BushBerries_1'],
    };
    const colors = {
      trees: [0x5a8a30, 0x4a7a28, 0x6a9a40],
      rocks: [0x8a8a7a, 0x7a7a6a, 0x9a9a8a, 0x6a7a5a, 0x7a8a6a],
      bushes: [0x4a7a28, 0x5a8a30, 0x3a6a1a],
    };
    const addColors = (group: THREE.Group, colList: number[]) => {
      group.traverse(c => {
        if ((c as THREE.Mesh).isMesh) {
          (c as THREE.Mesh).material = new THREE.MeshStandardMaterial({
            color: colList[Math.floor(Math.random() * colList.length)],
            roughness: 0.9, flatShading: true,
          });
          (c as THREE.Mesh).castShadow = true;
          (c as THREE.Mesh).receiveShadow = true;
        }
      });
    };
    const loadOne = (name: string, colorList: number[]): Promise<THREE.Group | null> =>
      new Promise(resolve => {
        if (typeof (window as any).__OBJ_DATA__ !== 'undefined' && (window as any).__OBJ_DATA__[name]) {
          try {
            const text = atob((window as any).__OBJ_DATA__[name]).replace(/^(mtllib |usemtl ).*/gm, '');
            const grp = loader.parse(text);
            addColors(grp, colorList);
            resolve(grp);
            return;
          } catch (_e) { /* fall through */ }
        }
        loader.load(base + name + '.obj', group => { addColors(group, colorList); resolve(group); }, undefined, () => resolve(null));
      });

    const [trees, rocks, bushes] = await Promise.all([
      Promise.all(files.trees.map(f => loadOne(f, colors.trees))),
      Promise.all(files.rocks.map(f => loadOne(f, colors.rocks))),
      Promise.all(files.bushes.map(f => loadOne(f, colors.bushes))),
    ]);
    this.trees = trees.filter(Boolean) as THREE.Group[];
    this.rocks = rocks.filter(Boolean) as THREE.Group[];
    this.bushes = bushes.filter(Boolean) as THREE.Group[];
    this.loaded = true;
  },
};
