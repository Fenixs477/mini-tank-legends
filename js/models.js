/* ============================================================
   models.js — GLTF / GLB / Collada loader + cache. Tries to load
   the real tank model from mini_tank_legends_models/<name>.glb,
   .gltf, or .dae; if missing it falls back to the cube body+turret.
   Uses Three.js GLTFLoader or ColladaLoader.
   ============================================================ */

const Models = {
  _cache: {},        // key -> {gltf:Scene|null, tried:bool}
  _loader: null,
  _colladaLoader: null,
  _available: null,  // null = not yet probed

  loader(){
    if(!this._loader){
      if(window.THREE && window.THREE.GLTFLoader){
        this._loader = new THREE.GLTFLoader();
      } else if(window.GLTFLoader){
        this._loader = new GLTFLoader();
      } else {
        this._loader = null; // addon not present; cube fallback always
      }
    }
    return this._loader;
  },

  colladaLoader(){
    if(!this._colladaLoader){
      if(window.THREE && window.THREE.ColladaLoader){
        this._colladaLoader = new THREE.ColladaLoader();
      } else if(window.ColladaLoader){
        this._colladaLoader = new ColladaLoader();
      } else {
        this._colladaLoader = null;
      }
    }
    return this._colladaLoader;
  },

  /* Probe which model files exist. We can't list a dir from the
     browser, so we HEAD each candidate URL once and cache the result. */
  async probe(names){
    const out = {};
    await Promise.all(names.map(async n=>{
      // Check .glb first, then .gltf, then .dae
      out[n] = await this._exists(CONFIG.MODEL_DIR + n + '.glb');
      if(!out[n]) out[n] = await this._exists(CONFIG.MODEL_DIR + n + '.gltf');
      if(!out[n]) out[n] = await this._exists(CONFIG.MODEL_DIR + n + '.dae');
    }));
    this._available = out;
    return out;
  },

  _exists(url){
    return new Promise(res=>{
      try{
        const xhr = new XMLHttpRequest();
        xhr.open('HEAD', url, true);
        xhr.onload = ()=> {
          // status 0 = file:// protocol, fall back to GET probe
          if(xhr.status===0) this._getProbe(url).then(res);
          else res(xhr.status>=200 && xhr.status<300);
        };
      // Some servers don't allow HEAD; fall back to GET probe
        xhr.onerror = ()=> this._getProbe(url).then(res);
        xhr.send();
      }catch(e){ this._getProbe(url).then(res); }
    });
  },
  _getProbe(url){
    return new Promise(res=>{
      try{
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.onreadystatechange = ()=>{ if(xhr.readyState>=2){ res(xhr.status===0 || xhr.status<400); xhr.abort(); } };
        xhr.onerror = ()=> res(false);
        xhr.send();
      }catch(e){ res(false); }
    });
  },

  hasModel(name){
    if(this._available && this._available[name]) return true;
    // Also check embedded data (for file:// protocol)
    return typeof window.__GLB_DATA__ !== 'undefined' && !!window.__GLB_DATA__[name];
  },

  /* Load a model async; returns a Promise<THREE.Group|null> */
  load(name){
    if(this._cache[name]) return Promise.resolve(this._cache[name].gltf && this._clone(name));
    this._cache[name] = {gltf:null, tried:false};
    if(!this.hasModel(name)){
      this._cache[name].tried = true;
      return Promise.resolve(null);
    }
    const loader = this.loader();
    if(!loader) return this._loadCollada(name);
    // Try .glb → .gltf → .dae
    return this._tryLoad(name, '.glb')
      .catch(()=> this._tryLoad(name, '.gltf'))
      .catch(()=> this._loadCollada(name))
      .catch(()=>{ this._cache[name].tried = true; return null; });
  },

  _tryLoad(name, ext){
    return new Promise((resolve, reject)=>{
      // Use embedded data URL when available (works from file://)
      if(typeof window.__GLB_DATA__ !== 'undefined' && window.__GLB_DATA__[name] && ext === '.glb'){
        const url = 'data:application/octet-stream;base64,' + window.__GLB_DATA__[name];
        this.loader().load(url, (gltf)=>{
          this._cache[name].gltf = gltf.scene;
          this._cache[name].tried = true;
          resolve(this._clone(name));
        }, undefined, reject);
        return;
      }
      // Fall back to XHR load
      this.loader().load(
        CONFIG.MODEL_DIR + name + ext,
        (gltf)=>{
          this._cache[name].gltf = gltf.scene;
          this._cache[name].tried = true;
          resolve(this._clone(name));
        },
        undefined,
        reject
      );
    });
  },

  _loadCollada(name){
    return new Promise(resolve=>{
      const loader = this.colladaLoader();
      if(!loader){ this._cache[name].tried = true; resolve(null); return; }
      loader.load(
        CONFIG.MODEL_DIR + name + '.dae',
        (result)=>{
          const scene = result.scene;
          if(!scene){ this._cache[name].tried = true; resolve(null); return; }
          // Scale the model appropriately for our game
          scene.scale.setScalar(0.5);
          scene.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
          this._cache[name].gltf = scene;
          this._cache[name].tried = true;
          resolve(this._clone(name));
        },
        undefined,
        (err)=>{ this._cache[name].tried = true; resolve(null); }
      );
    });
  },

  _clone(name){
    const src = this._cache[name].gltf;
    if(!src) return null;
    return src.clone(true);
  },
};

/* Pre-loader for nature-pack OBJ models (trees, rocks, bushes) */
const NatureAssets = {
  trees: [], rocks: [], bushes: [], loaded: false, _loading: false,

  loadAll(){
    if(this._loading || this.loaded) return;
    this._loading = true;
    if(!window.THREE || !THREE.OBJLoader) return;
    const loader = new THREE.OBJLoader();
    const base = 'nature/';
    const files = {
      trees:   ['BirchTree_1','BirchTree_2','BirchTree_3','CommonTree_1','CommonTree_2'],
      rocks:   ['Rock_1','Rock_2','Rock_3','Rock_Moss_1','Rock_Moss_2'],
      bushes:  ['Bush_1','Bush_2','BushBerries_1'],
    };
    const colors = {
      trees:   [0x5a8a30, 0x4a7a28, 0x6a9a40],
      rocks:   [0x8a8a7a, 0x7a7a6a, 0x9a9a8a, 0x6a7a5a, 0x7a8a6a],
      bushes:  [0x4a7a28, 0x5a8a30, 0x3a6a1a],
    };
    /* Dynamic Cartoon Material Router — reads node names and assigns
       solid flat-shaded materials. Fixes white/hollow shell issue by
       forcing procedural colors + recomputing normals + double-sided shading. */
    const addColors = (group, colList) => {
      const leafColor  = 0x557a46;  // Stylized forest green
      const trunkColor = 0x7c5c43;  // Rich bark wood brown

      group.traverse(c => {
        if(!c.isMesh) return;

        // 1. Recalculate shading normals (fixes broken lighting vectors)
        c.geometry.computeVertexNormals();

        // 2. Dynamic material router based on Quaternius node naming
        const name = c.name.toLowerCase();

        if(name.includes("leave") || name.includes("foliage") || name.includes("branch")){
          c.material = new THREE.MeshStandardMaterial({
            color: leafColor,
            roughness: 1.0,
            metalness: 0.0,
            flatShading: true,
            side: THREE.DoubleSide  // Force solid look, no transparency holes!
          });
        } else {
          // Trunk, bark, wood, rock, or any other part
          c.material = new THREE.MeshStandardMaterial({
            color: trunkColor,
            roughness: 1.0,
            metalness: 0.0,
            flatShading: true,
            side: THREE.DoubleSide
          });
        }

        // 3. Refresh bounds for BoxHelper / collision outlines
        c.geometry.computeBoundingBox();
        c.geometry.computeBoundingSphere();

        // 4. Shadow map
        c.castShadow    = true;
        c.receiveShadow = true;
      });
    };
    const loadOne = (name, colorList) => new Promise(resolve => {
      // Try embedded OBJ data first (works from file://)
      if(typeof window.__OBJ_DATA__ !== 'undefined' && window.__OBJ_DATA__[name]){
        try{
          const text = atob(window.__OBJ_DATA__[name]).replace(/^(mtllib |usemtl ).*/gm, '');
          const grp = loader.parse(text);
          addColors(grp, colorList);
          resolve(grp);
          return;
        }catch(e){ /* fall through to XHR */ }
      }
      loader.load(base + name + '.obj', group => {
        addColors(group, colorList);
        resolve(group);
      }, undefined, () => resolve(null));
    });
    return Promise.all([
      Promise.all(files.trees.map(f => loadOne(f, colors.trees))),
      Promise.all(files.rocks.map(f => loadOne(f, colors.rocks))),
      Promise.all(files.bushes.map(f => loadOne(f, colors.bushes))),
    ]).then(([trees, rocks, bushes]) => {
      this.trees = trees.filter(Boolean);
      this.rocks = rocks.filter(Boolean);
      this.bushes = bushes.filter(Boolean);
      this.loaded = true;
    });
  },
};