class World {
  constructor(scene){
    this.scene = scene;
    this.walls = [];
    this.trees = [];
    this.bushes = [];
    this.lakes = [];
    this._waterMaterials = [];
    this._quality = 'default';
    this.size = CONFIG.WORLD_SIZE;
    this.half = this.size / 2;
    this._build();
  }

  _build(){
    const loader = new THREE.TextureLoader();
    const base = 'assets/kenney/';
    this.texGround = loader.load(base + 'texture_01.png');
    this.texGround.wrapS = this.texGround.wrapT = THREE.RepeatWrapping;
    this.texGround.repeat.set(8, 8);
    this.texWall = loader.load(base + 'texture_04.png');
    this.texWall.wrapS = this.texWall.wrapT = THREE.RepeatWrapping;
    this.texWall.repeat.set(1, 1);
    this._makeGround();
    this._makeSkybox();
    this._makeLights();
    this._makeLake();
    this._makeWalls();
  }

  _makeGround(){
    const mat = new THREE.MeshStandardMaterial({ map: this.texGround, roughness: 0.9, metalness: 0 });
    this.groundMat = mat;
    const geo = new THREE.PlaneGeometry(this.size, this.size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.ground.position.set(0, 0, 0);
    this.scene.add(this.ground);
  }

  _makeSkybox(){
    this.scene.background = new THREE.Color(0x87CEEB);
  }

  _makeLights(){
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x6a7040, 0.7);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4dc, 2.0);
    sun.position.set(80, 160, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 4096;
    sun.shadow.mapSize.height = 4096;
    sun.shadow.bias = -0.001;
    sun.shadow.normalBias = 0.0005;
    const d = 120;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 500;
    sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sunLight = sun;
    const amb = new THREE.AmbientLight(0x7a7a8a, 0.3);
    this.scene.add(amb);
  }

  _makeLake(){
    const r = 12;
    const segs = 32;
    const geo = new THREE.CircleGeometry(r, segs);
    geo.rotateX(-Math.PI / 2);
    const mat = WaterShader.createMaterial(r);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, 0.05, 0);
    m.frustumCulled = false;
    this.scene.add(m);
    this._waterMaterials.push(mat);
    this.lakes.push({ x: 0, z: 0, r: r });
  }

  _makeWalls(){
    const wallMat = new THREE.MeshStandardMaterial({ map: this.texWall, roughness: 0.8, metalness: 0.1 });
    const hw = 4;
    const hh = 6;
    const half = this.half - hw / 2;

    const addBox = (x, z, w, d, h) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(geo, wallMat);
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this.walls.push({ x, z, w, d, mesh: m });
      return m;
    };

    // Border walls
    addBox(0, -half, this.size - hw, hw, hh);
    addBox(0, half, this.size - hw, hw, hh);
    addBox(-half, 0, hw, this.size - hw, hh);
    addBox(half, 0, hw, this.size - hw, hh);

    // Corner pillars
    const pSize = 3;
    const pOff = half - pSize / 2;
    addBox(-pOff, -pOff, pSize, pSize, hh);
    addBox(pOff, -pOff, pSize, pSize, hh);
    addBox(-pOff, pOff, pSize, pSize, hh);
    addBox(pOff, pOff, pSize, pSize, hh);

    // Internal symmetrical walls — 4 blocks around the lake
    const blockW = 5, blockD = 3;
    const dist = 22;
    addBox(dist, 0, blockW, blockD, hh);
    addBox(-dist, 0, blockW, blockD, hh);
    addBox(0, dist, blockD, blockW, hh);
    addBox(0, -dist, blockD, blockW, hh);

    // 4 diagonal blocks
    const dd = 16;
    addBox(dd, dd, blockW * 0.6, blockW * 0.6, hh * 0.7);
    addBox(-dd, dd, blockW * 0.6, blockW * 0.6, hh * 0.7);
    addBox(dd, -dd, blockW * 0.6, blockW * 0.6, hh * 0.7);
    addBox(-dd, -dd, blockW * 0.6, blockW * 0.6, hh * 0.7);
  }

  collides(x, z, r){
    return this.collidesWallsOnly(x, z, r);
  }

  collidesWallsOnly(x, z, r){
    for(const w of this.walls){
      const hx = w.w / 2 + r, hz = w.d / 2 + r;
      if(Math.abs(x - w.x) < hx && Math.abs(z - w.z) < hz) return true;
    }
    return false;
  }

  _inLake(x, z, pad = 0){
    for(const l of this.lakes){
      if(Math.hypot(x - l.x, z - l.z) < l.r + pad) return true;
    }
    return false;
  }

  lakeAt(x, z){
    for(const l of this.lakes){
      if(Math.hypot(x - l.x, z - l.z) < l.r) return l;
    }
    return null;
  }

  waveHeight(x, z, time){
    const wave = Math.sin(x * 0.2 + time * 1.5) * Math.cos(z * 0.2 + time * 1.2) * 0.04;
    return Math.max(0, wave);
  }

  randomSpawn(){
    for(let tries = 0; tries < 200; tries++){
      const x = (Math.random() - 0.5) * this.size * 0.85;
      const z = (Math.random() - 0.5) * this.size * 0.85;
      if(this._inLake(x, z, 4)) continue;
      if(this.collides(x, z, 3)) continue;
      return { x, z };
    }
    return { x: 0, z: 0 };
  }

  hidingIn(x, z){
    for(const b of this.bushes){
      if(Math.hypot(x - b.x, z - b.z) < CONFIG.BUSH_HIDE_RADIUS) return 'bush';
    }
    return null;
  }
  camoFactor(x, z){
    for(const b of this.bushes){
      if(Math.hypot(x - b.x, z - b.z) < CONFIG.BUSH_HIDE_RADIUS + 2) return 0.3;
    }
    return 1;
  }
  tryPlaceTrees(){}

  update(dt, time, tankPos){
    for(const mat of this._waterMaterials){
      mat.uniforms.uTime.value = time;
      if(tankPos && mat.uniforms.uTankPosition){
        mat.uniforms.uTankPosition.value.set(tankPos.x, 0, tankPos.z);
      }
    }
  }

  loadCustomMapData(data){
    if(!data || !data.objects) return;
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a6e72, roughness: 0.9, flatShading: true });
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x3a7a38, roughness: 1, flatShading: true });
    data.objects.forEach(d => {
      let mesh;
      if(d.isModel && d.modelName){
        const geo = new THREE.BoxGeometry(4, 4, 4);
        const mat = new THREE.MeshStandardMaterial({ color: d.color || 0x888888 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(d.x, d.y, d.z);
        mesh.scale.set(d.sx, d.sy, d.sz);
        mesh.rotation.y = d.ry;
        mesh.castShadow = mesh.receiveShadow = true;
        this.scene.add(mesh);
        if(d.type === 'water'){
          const r = Math.max(d.sx, d.sz) * 3;
          this.lakes.push({ x: d.x, z: d.z, r });
        } else {
          const w = 4 * d.sx, dd = 4 * d.sz;
          this.walls.push({ x: d.x, z: d.z, w, d: dd, mesh });
        }
        const loadModel = (grp) => {
          if(!grp) return;
          const clone = grp.clone(true);
          clone.position.set(d.x, d.y, d.z);
          clone.scale.set(d.sx, d.sy, d.sz);
          clone.rotation.y = d.ry;
          clone.traverse(o => { if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
          this.scene.add(clone);
          this.scene.remove(mesh);
          const idx = this.walls.findIndex(w => w.mesh === mesh);
          if(idx >= 0) this.walls[idx].mesh = clone;
        };
        if(d.modelData){
          const loader = Models.loader();
          if(loader){
            const bin = atob(d.modelData);
            const buf = new ArrayBuffer(bin.length);
            const view = new Uint8Array(buf);
            for(let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
            loader.parse(buf, '', (result) => {
              loadModel(result && result.scene ? result.scene : result);
            }, () => {});
          }
        } else if(window.Models){
          Models.load(d.modelName).then(grp => loadModel(grp));
        }
        return;
      }
      let geo;
      switch(d.kind){
        case 'cube':     geo = new THREE.BoxGeometry(6, 6, 6); break;
        case 'pyramid':  geo = new THREE.ConeGeometry(4, 7, 4); break;
        case 'cone':     geo = new THREE.ConeGeometry(3.5, 7, 18); break;
        case 'torus':    geo = new THREE.TorusGeometry(3, 1.2, 12, 24); break;
        case 'cylinder': geo = new THREE.CylinderGeometry(3, 3, 6, 18); break;
        default: geo = new THREE.BoxGeometry(6, 6, 6);
      }
      const mat = (d.type === 'water') ? new THREE.MeshBasicMaterial({ color: 0x61B2FF, transparent: true, opacity: 0.85 })
                 : (d.type === 'bush' ? bushMat : rockMat);
      mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(d.x, d.y, d.z);
      mesh.scale.set(d.sx, d.sy, d.sz);
      mesh.rotation.y = d.ry;
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      if(d.type === 'water'){
        const r = Math.max(d.sx, d.sz) * 3;
        this.lakes.push({ x: d.x, z: d.z, r });
      } else if(d.type === 'bush'){
        this.bushes.push({ x: d.x, z: d.z, mesh });
      } else {
        const w = 6 * d.sx, dd = 6 * d.sz;
        this.walls.push({ x: d.x, z: d.z, w, d: dd, mesh });
      }
    });
  }

  clearCustomMapData(){
    if(this._customMeshes){
      this._customMeshes.forEach(m => { this.scene.remove(m); });
    }
    this._customMeshes = [];
  }

  setQuality(quality){
    this._quality = quality || 'default';
  }

  renderToCanvas(ctx, w, h, opts = {}){
    const scale = w / this.size;
    const ox = w / 2, oy = h / 2;
    const toPx = (x, z) => [ox + x * scale, oy + z * scale];
    ctx.fillStyle = '#4a6a2a';
    ctx.fillRect(0, 0, w, h);
    this.lakes.forEach(l => {
      const [px, py] = toPx(l.x, l.z);
      ctx.fillStyle = '#2a8aba';
      ctx.beginPath();
      ctx.arc(px, py, l.r * scale, 0, 7);
      ctx.fill();
    });
    ctx.fillStyle = '#6a6e72';
    this.walls.forEach(wl => {
      if(wl.border) return;
      ctx.fillRect(ox + (wl.x - wl.w / 2) * scale, oy + (wl.z - wl.d / 2) * scale, wl.w * scale, wl.d * scale);
    });
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  }

  worldToMap(x, z, canvasSize){
    const scale = canvasSize / this.size;
    return [canvasSize / 2 + x * scale, canvasSize / 2 + z * scale];
  }
}
