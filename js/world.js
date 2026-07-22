/* ============================================================
   world.js — generates the big battlefield with 4 Minecraft-style
   biomes (forest, lake, rock_valley, plains):
     - grass ground (shaded) + brown paths
     - procedural stone walls (big rocks, hard cover)
     - nature-pack OBJ trees & procedural trees
     - bush clusters
     - irregular lakes (drive-through, shoot-over)
   Tanks all drive on the same Y plane.
   Shadows enabled via directional light + renderer.
   ============================================================ */

class World {
  constructor(scene){
    this.scene = scene;
    this.walls = [];
    this.trees = [];
    this.bushes = [];
    this.lakes = [];
    this.size = CONFIG.WORLD_SIZE;
    this.half = this.size/2;
    this.treesPlaced = true;
    this._build();
  }

  _build(){
    this._makeGround();
    this._makeSkybox();
    this._makeLights();
    this._makeLakes();
    this._makeWalls();
  }

  _makeGround(){
    // Procedural grass texture (natural dark green, no external files needed)
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const g = c.getContext('2d');
    // Base dark olive green (same as original game)
    g.fillStyle = '#33401f'; g.fillRect(0,0,1024,1024);
    // Grass blade strokes for realistic look
    for(let i=0;i<4000;i++){
      const x=Math.random()*1024, y=Math.random()*1024;
      const len = 3+Math.random()*12;
      const angle = Math.random()*Math.PI*2;
      const sh = 15+Math.random()*30;
      g.strokeStyle = `rgba(${sh+8},${sh+50},${sh+5},${0.25+Math.random()*0.2})`;
      g.lineWidth = 1+Math.random()*2;
      g.beginPath(); g.moveTo(x,y); g.lineTo(x+Math.cos(angle)*len, y+Math.sin(angle)*len); g.stroke();
    }
    // Dark patches
    for(let i=0;i<150;i++){
      const x=Math.random()*1024, y=Math.random()*1024, r=8+Math.random()*35;
      g.fillStyle = `rgba(0,20,0,${0.08+Math.random()*0.1})`;
      g.beginPath(); g.arc(x,y,r,0,7); g.fill();
    }
    // Brown dirt paths
    g.strokeStyle = '#4a3520'; g.lineWidth = 20; g.lineCap='round';
    for(let p=0;p<4;p++){
      g.beginPath();
      let x=Math.random()*1024, y=Math.random()*1024;
      g.moveTo(x,y);
      for(let s=0;s<6;s++){ x += (Math.random()-0.5)*200; y += (Math.random()-0.5)*200; g.lineTo(x,y); }
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(18,18);

    const mat = new THREE.MeshStandardMaterial({map: tex, roughness: 0.95, metalness: 0});
    this.groundMat = mat;
    const geo = new THREE.PlaneGeometry(this.size, this.size, 1, 1);
    geo.rotateX(-Math.PI/2);
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }

  _makeSkybox(){
    this.scene.background = new THREE.Color(0x87CEEB);
  }

  _makeLights(){
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x6a7040, 1.3);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4dc, 1.6);
    sun.position.set(80,160,40);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.bias = -0.005;
    sun.shadow.normalBias = 0.02;
    // Shadow camera must cover the entire 3000x3000 world
    const d = 1200;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 2000;
    sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sunLight = sun;
    const amb = new THREE.AmbientLight(0x7a7a8a, 0.6);
    this.scene.add(amb);
  }

  /* ---------- Lakes (irregular shapes, animated wave foam) ---- */
  _makeLakes(){
    const lakeData = [
      {x: -40, z: -30, r: 14, seed: 0.7},
      {x:  50, z:  20, r: 18, seed: 2.3},
    ];
    this._waterMaterials = [];
    for(const l of lakeData){
      const geo = new THREE.PlaneGeometry(100, 100, 64, 64);
      geo.rotateX(-Math.PI/2);
      const mat = WaterShader.createMaterial();
      const m = new THREE.Mesh(geo, mat);
      m.position.set(l.x, 0.15, l.z);
      m.frustumCulled = false;
      m.renderOrder = 1;
      this.scene.add(m);
      this._waterMaterials.push(mat);
      this.lakes.push({x: l.x, z: l.z, r: l.r, seed: l.seed});
    }
  }

  /* Lake radius at a given angle (matches the irregular shape) */
  _lakeRad(l, a){
    if(l.seed == null) return l.r;
    const wave1 = Math.sin(a * 3 + l.seed) * 0.1;
    const wave2 = Math.cos(a * 5 + 1 + l.seed) * 0.06;
    return l.r * (1.0 + wave1 + wave2);
  }

  /* Wave height at a world position for a given time (matches shader) */
  waveHeight(x, z, time){
    return Math.sin(x * 0.30 + time * 1.2) * 0.12
         + Math.sin(z * 0.25 + time * 0.9) * 0.10
         + Math.sin(x * 0.18 + z * 0.22 + time * 0.7) * 0.08;
  }

  update(dt, time, tankPos){
    for(const mat of this._waterMaterials){
      mat.uniforms.uTime.value = time;
      if(tankPos && mat.uniforms.uTankPosition){
        mat.uniforms.uTankPosition.value.set(tankPos.x, 0, tankPos.z);
      }
    }
  }
  _makeWalls(){
    const rockMat = new THREE.MeshStandardMaterial({color:0x6a6e72, roughness:0.9, metalness:0.05, flatShading:true});
    const step = this.size / 8;
    for(let i=0; i<=8; i++){
      for(let j=0; j<8; j++){
        const wx = -this.half + j*step, wz = -this.half + i*step;
        if(Math.random() < 0.22){
          const ww = step*0.5 + Math.random()*4;
          const dd = 3 + Math.random()*2;
          if(this._inLake(wx,wz, Math.max(ww,dd)*0.5)) continue;
          if(Math.abs(wx) > this.half-10 || Math.abs(wz) > this.half-10) continue;
          const h = 3+Math.random()*1.5;
          const group = new THREE.Group();
          const count = 3 + Math.floor(Math.random() * 3);
          for(let k=0; k<count; k++){
            const m = new THREE.Mesh(new THREE.BoxGeometry(
              ww * (0.3 + Math.random() * 0.5),
              h * (0.4 + Math.random() * 0.6),
              dd * (0.3 + Math.random() * 0.5)
            ), rockMat);
            m.position.set((Math.random()-0.5)*ww*0.6, h*(0.15+Math.random()*0.6), (Math.random()-0.5)*dd*0.6);
            m.rotation.set((Math.random()-0.5)*0.2, (Math.random()-0.5)*0.2, (Math.random()-0.5)*0.2);
            m.castShadow = true; m.receiveShadow = true;
            group.add(m);
          }
          group.position.set(wx, 0, wz);
          this.scene.add(group);
          this.walls.push({x:wx, z:wz, w:ww, d:dd, mesh:group});
        }
      }
    }
  }

  /* ---------- Camouflage queries ---------- */
  hidingIn(x, z){
    for(const b of this.bushes){
      if(Math.hypot(x-b.x, z-b.z) < (b.r||CONFIG.BUSH_HIDE_RADIUS)) return 'bush';
    }
    for(const t of this.trees){
      if(Math.hypot(x-t.x, z-t.z) < CONFIG.TREE_HIDE_RADIUS) return 'tree';
    }
    return null;
  }
  camoFactor(x, z){
    const h = this.hidingIn(x, z);
    if(h==='bush') return 0;
    if(h==='tree') return 0.5;
    return 1;
  }

  tryPlaceTrees(){
  }

  /* ---------- Helpers ---------- */
  _inLake(x,z,pad=0){
    for(const l of this.lakes){
      const dx = x - l.x, dz = z - l.z;
      const dist = Math.hypot(dx, dz);
      const a = Math.atan2(dz, dx);
      const lakeR = this._lakeRad(l, -a);
      if(dist < lakeR + pad) return true;
    }
    return false;
  }
  lakeAt(x,z){
    for(const l of this.lakes){
      const dx = x - l.x, dz = z - l.z;
      const dist = Math.hypot(dx, dz);
      const a = Math.atan2(dz, dx);
      if(dist < this._lakeRad(l, -a)) return l;
    }
    return null;
  }

  collides(x, z, r){
    return this.collidesWallsOnly(x, z, r);
  }
  collidesWallsOnly(x, z, r){
    for(const w of this.walls){
      const hx = w.w/2 + r, hz = w.d/2 + r;
      if(Math.abs(x-w.x) < hx && Math.abs(z-w.z) < hz) return true;
    }
    return false;
  }
  randomSpawn(){
    for(let tries=0; tries<200; tries++){
      const x = (Math.random()-0.5)*this.size*0.9;
      const z = (Math.random()-0.5)*this.size*0.9;
      if(this._inLake(x,z,4)) continue;
      if(this.collides(x,z,3)) continue;
      return {x,z};
    }
    return {x:0,z:0};
  }

  loadCustomMapData(data){
    if(!data || !data.objects) return;
    const rockMat = new THREE.MeshStandardMaterial({color:COLORS.rock, roughness:0.9, flatShading:true});
    const bushMat = new THREE.MeshStandardMaterial({color:COLORS.bush, roughness:1, flatShading:true});
    
    data.objects.forEach(d=>{
      let mesh;
      
      // Handle model assets
      if(d.isModel && d.modelName){
        // Create a placeholder box while model loads
        const geo = new THREE.BoxGeometry(4,4,4);
        const mat = new THREE.MeshStandardMaterial({color:d.color||0x888888});
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(d.x, d.y, d.z);
        mesh.scale.set(d.sx, d.sy, d.sz);
        mesh.rotation.y = d.ry;
        mesh.castShadow = mesh.receiveShadow = true;
        this.scene.add(mesh);
        
        if(d.type==='water'){
          const r = Math.max(d.sx, d.sz)*3;
          this._lakeColliders = this._lakeColliders || [];
          this._lakeColliders.push({x:d.x, z:d.z, r});
          this.lakes.push({x:d.x, z:d.z, r});
        } else if(d.type==='bush'){
          this.bushes.push({x:d.x, z:d.z, mesh});
        } else {
          const w = 4*d.sx, dd = 4*d.sz;
          this.walls.push({x:d.x, z:d.z, w, d:dd, mesh});
        }
        
        // Try to load the actual model async
        const loadModel = (grp) => {
          if(!grp) return;
          const clone = grp.clone(true);
          clone.position.set(d.x, d.y, d.z);
          clone.scale.set(d.sx, d.sy, d.sz);
          clone.rotation.y = d.ry;
          clone.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
          this.scene.add(clone);
          this.scene.remove(mesh);
          if(d.type==='water'){
            const idx = this.lakes.findIndex(l=> l.x===d.x && l.z===d.z);
            if(idx>=0) this.lakes[idx].mesh = clone;
          } else if(d.type==='bush'){
            const idx = this.bushes.findIndex(b=> b.mesh===mesh);
            if(idx>=0) this.bushes[idx].mesh = clone;
          } else {
            const idx = this.walls.findIndex(w=> w.mesh===mesh);
            if(idx>=0){ this.walls[idx].mesh = clone; }
          }
        };
        if(d.modelData){
          // Load from embedded base64 data (editor-imported GLB)
          const loader = Models.loader();
          if(loader){
            const bin = atob(d.modelData);
            const buf = new ArrayBuffer(bin.length);
            const view = new Uint8Array(buf);
            for(let i=0;i<bin.length;i++) view[i]=bin.charCodeAt(i);
            loader.parse(buf, '', (result) => {
              loadModel(result && result.scene ? result.scene : result);
            }, () => {});
          }
        } else if(window.Models){
          Models.load(d.modelName).then(grp => loadModel(grp));
        }
        return;
      }
      
      // Regular figures
      let geo;
      switch(d.kind){
        case 'cube':     geo = new THREE.BoxGeometry(6,6,6); break;
        case 'pyramid':  geo = new THREE.ConeGeometry(4,7,4); break;
        case 'cone':     geo = new THREE.ConeGeometry(3.5,7,18); break;
        case 'torus':    geo = new THREE.TorusGeometry(3,1.2,12,24); break;
        case 'cylinder': geo = new THREE.CylinderGeometry(3,3,6,18); break;
        default: geo = new THREE.BoxGeometry(6,6,6);
      }
      const mat = (d.type==='water') ? new THREE.MeshBasicMaterial({color:0x61B2FF, transparent:true, opacity:0.85})
                 : (d.type==='bush' ? bushMat : rockMat);
      mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(d.x, d.y, d.z);
      mesh.scale.set(d.sx, d.sy, d.sz);
      mesh.rotation.y = d.ry;
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);

      if(d.type==='water'){
        const r = Math.max(d.sx, d.sz)*3;
        this._lakeColliders = this._lakeColliders || [];
        this._lakeColliders.push({x:d.x, z:d.z, r});
        this.lakes.push({x:d.x, z:d.z, r});
      } else if(d.type==='bush'){
        this.bushes.push({x:d.x, z:d.z, mesh});
      } else {
        const w = 6*d.sx, dd = 6*d.sz;
        this.walls.push({x:d.x, z:d.z, w, d:dd, mesh});
      }
    });
  }

  clearCustomMapData(){
    if(this._customMeshes){
      this._customMeshes.forEach(m=>{ this.scene.remove(m); });
    }
    this._customMeshes = [];
  }

  setQuality(quality){
  }

  renderToCanvas(ctx, w, h, opts={}){
    const scale = w / this.size;
    const ox = w/2, oy = h/2;
    const toPx = (x,z)=> [ox + x*scale, oy + z*scale];
    ctx.fillStyle = '#4a6a2a'; ctx.fillRect(0,0,w,h);
    ctx.fillStyle = 'rgba(90,67,41,0.15)'; ctx.fillRect(0,0,w,h);
    this.lakes.forEach(l=>{
      const [px,py] = toPx(l.x,l.z);
      ctx.fillStyle = '#2a8aba';
      ctx.beginPath(); ctx.arc(px,py, l.r*scale, 0, 7); ctx.fill();
    });
    ctx.fillStyle = '#6a6e72';
    this.walls.forEach(wl=>{
      if(wl.border) return;
      ctx.fillRect(ox+(wl.x-wl.w/2)*scale, oy+(wl.z-wl.d/2)*scale, wl.w*scale, wl.d*scale);
    });
    ctx.strokeStyle='#888'; ctx.lineWidth=2;
    ctx.strokeRect(1,1,w-2,h-2);
  }

  worldToMap(x, z, canvasSize){
    const scale = canvasSize / this.size;
    return [canvasSize/2 + x*scale, canvasSize/2 + z*scale];
  }
}