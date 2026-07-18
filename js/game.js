/* ============================================================
   game.js — main controller: renderer, scene, world, tanks,
   projectiles, camera, loop, HUD, minimap, entry modes
   (singleplayer / host / client).
   FULLY WORKING P2P MULTIPLAYER.
   ============================================================ */

class Game {
  constructor(){
    this.settings = Menu.settings;
    this.mode = null;
    this.running = false;
    this.tanks = [];
    this.projectiles = [];
    this.explosions = [];
    this.localTank = null;
    this.time = 0;
    this.dt = 0;
    this._last = 0;
    this._netSendAcc = 0;
    this.clientTankInputs = {};
    this.clientTanks = {};
    this._shake = 0;
    this._myRemoteId = null;
    this.physicsWorld = null;
    this._physBodies = [];
    this._eventQueue = null;
  }

  /* ---------- Three.js bootstrap ---------- */
  init(){
    this.renderer = new THREE.WebGLRenderer({antialias:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('game-root').appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.__renderer = this.renderer;
    this.camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.1, 1000);
    this.camera.position.set(0, CONFIG.CAM_HEIGHT, -CONFIG.CAM_DIST);
    this.camera.lookAt(0, 1.2, 0);

    this.world = new World(this.scene);
    this._initPhysics();
    this.input = new Input(this.settings);

    // camera zoom and orbit state
    this.camDist = CONFIG.CAM_DIST;
    this.camAngle = Math.PI; // radians, π = behind the tank

    // aim/trajectory line (from muzzle, length = shellRange)
    this._initAimLine();
    // ricochet indicator (2 colored lines on target tank faces)
    this._initRicoIndicator();
    // water foam (created on the fly in _updateWaterFoam)

    // probe available tank models (async)
    Models.probe(TANK_ORDER).catch(()=>{});
    if(window.NatureAssets){
      NatureAssets.loadAll().then(() => {
        if(this.world){
          this.world.treesPlaced = false;
          this.world.tryPlaceTrees();
        }
      });
    }

    addEventListener('resize', ()=> this._onResize());
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    this.applyGraphicsSettings();
  }

  _initPhysics(){
    try {
      if(typeof RAPIER === 'undefined') return;
      this.physicsWorld = new RAPIER.World({x:0, y:-20, z:0});
      this._eventQueue = new RAPIER.EventQueue(true);
      // Ground body
      var gDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
      var gBody = this.physicsWorld.createRigidBody(gDesc);
      var gCol = RAPIER.ColliderDesc.cuboid(160, 0.5, 160)
        .setUserData({type:'ground'});
      this.physicsWorld.createCollider(gCol, gBody);
      this._physBodies.push(gBody);
      // Wall colliders
      if(this.world && this.world.walls){
        for(const w of this.world.walls){
          try {
            var wDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(w.x, 0.5, w.z);
            var wBody = this.physicsWorld.createRigidBody(wDesc);
            var wCol = RAPIER.ColliderDesc.cuboid(w.w/2, 5.0, w.d/2)
              .setUserData({type:'wall'});
            this.physicsWorld.createCollider(wCol, wBody);
            this._physBodies.push(wBody);
          } catch(e2){}
        }
      }
    } catch(e){ console.warn('Rapier init:', e); }
  }

  /* Rapier collision event handler */
  _onCollision(event){
    if(!this.physicsWorld) return;
    var c1Handle = event.collider1();
    var c2Handle = event.collider2();
    var c1 = this.physicsWorld.getCollider(c1Handle);
    var c2 = this.physicsWorld.getCollider(c2Handle);
    if(!c1 || !c2) return;
    var d1 = c1.userData;
    var d2 = c2.userData;
    if(!d1 || !d2) return;

    // Shell-wall
    if(d1.type === 'shell' && d2.type === 'wall'){
      if(!d1.shell.dead){
        d1.shell.dead = true;
        var sp1 = d1.shell._physBody ? d1.shell._physBody.translation() : null;
        this.spawnExplosion(sp1 ? sp1.x : d1.shell.x, 1.0, sp1 ? sp1.z : d1.shell.z, 0xffaa33, 6);
      }
      return;
    }
    if(d1.type === 'wall' && d2.type === 'shell'){
      if(!d2.shell.dead){
        d2.shell.dead = true;
        var sp2 = d2.shell._physBody ? d2.shell._physBody.translation() : null;
        this.spawnExplosion(sp2 ? sp2.x : d2.shell.x, 1.0, sp2 ? sp2.z : d2.shell.z, 0xffaa33, 6);
      }
      return;
    }

    // Shell-tank
    if(d1.type === 'shell' && d2.type === 'tank'){
      if(!d1.shell.dead) this._onShellHitTank(d1.shell, d2.tank);
      return;
    }
    if(d1.type === 'tank' && d2.type === 'shell'){
      if(!d2.shell.dead) this._onShellHitTank(d2.shell, d1.tank);
      return;
    }
  }

  _onShellHitTank(shell, tank){
    if(shell.dead) return;
    shell._hitByPhysics = true;
    // Sync position from physics body for accurate collision point
    if(shell._physBody){
      var t = shell._physBody.translation();
      shell.x = t.x; shell.y = t.y; shell.z = t.z;
    }
    if(tank === shell.owner && shell.life > (shell.owner.def.shellRange/shell.speed) - 0.15) return;
    var armor = tank.def.armor;
    if(armor && shell._tryRicochet(tank, this)){
      // Shell bounced - update physics body to match reflected state
      if(shell._physBody){
        shell._physBody.setTranslation({x: shell.x, y: shell.y, z: shell.z}, true);
        shell._physBody.setLinvel({x: shell.dir.x * shell.speed, y: 0, z: shell.dir.z * shell.speed}, true);
      }
      return;
    }
    tank.takeDamage(shell.damage, shell.owner, this);
    this.spawnExplosion(shell.x, 1.2, shell.z, 0xff6a2a, 8);
    shell.dead = true;
  }

  /* Trajectory / aim line: main line + optional 10m markers (professional) */
  _initAimLine(){
    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent:true, opacity:this.settings.aimLineOpacity,
    });
    // Triangle cone: muzzle → left → right → muzzle (4 vertices)
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    this.aimLine = new THREE.Line(geo, mat);
    this.aimLine.visible = false;
    this.aimLine.frustumCulled = false;
    this.scene.add(this.aimLine);

    // Marker ticks + number labels (professional mode)
    const markerMat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent:true, opacity:this.settings.aimLineOpacity * 0.6,
    });
    const markerGeo = new THREE.BufferGeometry();
    const maxMarks = 10;
    this._aimMarkerArr = new Float32Array(maxMarks * 2 * 3);
    markerGeo.setAttribute('position', new THREE.BufferAttribute(this._aimMarkerArr, 3));
    this.aimMarkers = new THREE.LineSegments(markerGeo, markerMat);
    this.aimMarkers.visible = false;
    this.aimMarkers.frustumCulled = false;
    this.scene.add(this.aimMarkers);

    // Number sprites for each marker
    this._aimLabels = [];
    for(let i=1; i<=maxMarks; i++){
      const c = document.createElement('canvas');
      c.width = 128; c.height = 64;
      const g = c.getContext('2d');
      g.shadowColor = 'rgba(0,0,0,0.8)';
      g.shadowBlur = 6;
      g.fillStyle = '#ffffff';
      g.font = 'bold 28px Segoe UI, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText((i*10)+'m', 64, 32);
      const tex = new THREE.CanvasTexture(c);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, depthTest:false, transparent:true, opacity:this.settings.aimLineOpacity}));
      spr.scale.set(2.4, 1.2, 1);
      spr.visible = false;
      this.scene.add(spr);
      this._aimLabels.push(spr);
    }
  }
  refreshAimLineStyle(){
    if(!this.aimLine) return;
    this.aimLine.material.opacity = this.settings.aimLineOpacity;
    this.aimLine.material.color.set(this.settings.aimLineColor);
    if(this.aimMarkers){
      this.aimMarkers.material.opacity = this.settings.aimLineOpacity * 0.6;
      this.aimMarkers.material.color.set(this.settings.aimLineColor);
    }
    if(this._aimLabels){
      this._aimLabels.forEach(s=>s.material.opacity = this.settings.aimLineOpacity);
    }
  }

  _onResize(){
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth/innerHeight;
    this.camera.updateProjectionMatrix();
  }

  applySettings(s){
    this.settings = s;
    if(this.input) this.input.binds = s.binds;
    this.refreshAimLineStyle();
    this.refreshViewRangeStyle();
    this.refreshViewRangeWidth();
    this.applyGraphicsSettings();
    this.camAngle = Math.PI + (s.camRotation || 0);
  }

  applyGraphicsSettings(){
    const q = this.settings.graphicsQuality;
    const isFancy = q === 'fancy';
    this.renderer.shadowMap.enabled = isFancy;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, isFancy ? 2 : 1.5));
    if(this.world) this.world.setQuality(q);
  }

  setUseCustomMap(v){ this._useCustomMap = !!v; }

  refreshViewRangeStyle(){
    if(!this.tanks) return;
    for(const t of this.tanks){
      t.setViewRangeStyle(this.settings.viewRangeOpacity, this.settings.viewRangeColor);
    }
  }

  refreshViewRangeWidth(){
    if(!this.tanks) return;
    for(const t of this.tanks){
      if(t.refreshViewRangeWidth) t.refreshViewRangeWidth();
    }
  }

  /* ===========================================================
     ENTRY MODES
     =========================================================== */

  /* ---------- SINGLEPLAYER ---------- */
  startSingleplayer(){
    this.mode='sp'; this._resetArena();
    try {
      var m = this._useCustomMap ? loadCustomMap() : null;
      if(!m) m = loadMainMap();
      if(m) this.world.loadCustomMapData(m);
    } catch(e){ console.warn('Map load error:', e); }
    try {
      this._spawnLocal();
      for(let i=0;i<20;i++) this._spawnBot();
      this._spawnDummy();
    } catch(e){ console.warn('Spawn error:', e); }
    this._begin();
  }

  /* ---------- FREE ROAM (persistent world via Nakama) ---------- */
  async startFreeRoam(){
    Menu.showConnecting('Joining free roam world…');
    try {
      const match = await NakamaNet.joinOrCreateWorld();
    } catch(e) {
      Menu.hideConnecting();
      Menu.toast(e.message||'Failed to join world');
      return;
    }
    Menu.hideConnecting();
    this.mode = 'freeroam';
    if(NakamaNet.isHost) Menu.toast('You are the world host');
    this._resetArena();
    NakamaNet.onPlayerJoin = (info) => this._onFreeRoamJoin(info);
    NakamaNet.onPlayerLeave = (peerId) => this._onFreeRoamLeave(peerId);
    NakamaNet.onInput = (peerId, inp) => { this.clientTankInputs[peerId] = inp; };
    NakamaNet.onWelcome = (msg) => {
      // Host sent us our spawn position
      if(msg.x !== undefined && msg.z !== undefined){
        this.localTank.x = msg.x;
        this.localTank.z = msg.z;
      }
    };
    NakamaNet.onState = (snap) => this._applyHostState(snap);
    NakamaNet.onHostChange = (newHostId) => {
      if(newHostId === NakamaNet.userId){
        NakamaNet.isHost = true;
        Menu.toast('You are now the world host');
      }
    };
    this._spawnLocal();
    if(!NakamaNet.isHost){
      // Tell host who we are so they can assign a spawn and broadcast us
      const def = TANKS[this.settings.selectedTank] || TANKS.coolbuddy;
      NakamaNet.sendMatchData({
        t: 'join',
        name: this.settings.playerName,
        tank: this.settings.selectedTank,
        color: def.color
      });
    }
    this._begin();
  }

  _onFreeRoamJoin(info){
    // info = {peerId, name, tank, color}
    const def = TANKS[info.tank] || TANKS.coolbuddy;
    const sp = this.world.randomSpawn();
    const t = new Tank(def, {
      id: 'remote-'+info.peerId,
      name: info.name || 'Player',
      ownerPeer: info.peerId,
      x: sp.x,
      z: sp.z,
      heading: Math.random()*6,
      color: info.color || def.color
    });
    this._finalizeTank(t);
    this.tanks.push(t);
    this.clientTanks[info.peerId] = t;
    // Send spawn position back to joining client
    NakamaNet.sendMatchData({
      t: 'spawn',
      id: t.id,
      x: t.x,
      z: t.z,
      heading: t.heading,
      tankId: info.tank || 'coolbuddy',
      name: info.name || 'Player'
    });
    // Send full state so new client sees all existing tanks
    NakamaNet.sendMatchData({
      t: 'state',
      s: { time: this.time, tanks: this.tanks.map(tk => tk.snapshot()), projs: this.projectiles.filter(p=>!p.dead).map(p=>({id:p.id,x:p.x,y:p.y,z:p.z,dx:p.dir.x,dz:p.dir.z,type:p.type,life:p.life})) }
    });
  }

  _onFreeRoamLeave(peerId){
    this._onClientLeave(peerId);
    delete this.clientTankInputs[peerId];
  }

  /* ---------- HOST (P2P) ---------- */
  async startHost(cfg){
    Menu.showConnecting('Creating room…');
    try{
      await Net.hostRoom({maxPlayers:cfg.maxPlayers, isPublic:cfg.isPublic, fakePlayers:cfg.fakePlayers, code:cfg.code});
    }catch(e){
      Menu.hideConnecting();
      Menu.toast(e.message||'Failed to host');
      return;
    }
    Menu.hideConnecting();
    Menu.toast('Room live • Code: '+cfg.code);
    this.mode='host'; this._resetArena();
    try {
      var m = this._useCustomMap ? loadCustomMap() : null;
      if(!m) m = loadMainMap();
      if(m) this.world.loadCustomMapData(m);
    } catch(e){ console.warn('Map load error:', e); }
    this._spawnLocal();
    // fake players (bots)
    for(let i=0;i<cfg.fakePlayers;i++) this._spawnBot();
    
    // Network callbacks
    Net.onPlayerJoin = (info)=> this._onClientJoin(info);
    Net.onPlayerLeave = (peerId)=> this._onClientLeave(peerId);
    Net.onInput = (peerId, inp)=> { this.clientTankInputs[peerId] = inp; };
    
    this._begin();
  }

  _onClientJoin(info){
    // info = {peerId, name, tank, color}
    const def = TANKS[info.tank] || TANKS.coolbuddy;
    const sp = this.world.randomSpawn();
    const t = new Tank(def, {
      id:'remote-'+info.peerId,
      name: info.name || 'Player',
      ownerPeer: info.peerId,
      x: sp.x,
      z: sp.z,
      heading: Math.random()*6,
      color: info.color || def.color
    });
    this._finalizeTank(t);
    this.tanks.push(t);
    this.clientTanks[info.peerId] = t;
    
    // Send spawn data to this client so they know where they are
    Net.sendSpawnToClient(info.peerId, {
      id: t.id,
      x: t.x,
      z: t.z,
      heading: t.heading,
      tankId: info.tank || 'coolbuddy',
      name: info.name || 'Player'
    });
    
    // Send full current state to the newly joined client so they see everyone
    Net.sendFullStateToClient(info.peerId, {
      time: this.time,
      tanks: this.tanks.map(tk => tk.snapshot()),
      projs: this.projectiles.filter(p=>!p.dead).map(p=>({id:p.id,x:p.x,y:p.y,z:p.z,dx:p.dir.x,dz:p.dir.z,type:p.type,life:p.life}))
    });
  }
  
  _onClientLeave(peerId){
    const t = this.clientTanks[peerId];
    if(t){ t.detach(); this.tanks = this.tanks.filter(x=>x!==t); delete this.clientTanks[peerId]; }
    delete this.clientTankInputs[peerId];
  }

  /* ---------- CLIENT ---------- */
  async startClient(code){
    Menu.showConnecting('Joining room…');
    try{
      await Net.joinRoom(code);
    }catch(e){
      Menu.hideConnecting();
      Menu.toast(e.message||'Could not join room');
      return;
    }
    Menu.hideConnecting();
    this.mode='client'; this._resetArena();
    
    // Set up network callbacks for client
    Net.onWelcome = (msg)=> this._onClientWelcome(msg);
    Net.onState = (snap)=> this._applyHostState(snap);
    Net.onPlayerLeave = (peerId)=>{
      if(peerId==='host'){
        Menu.toast('Host disconnected');
        this.leaveToMenu();
      }
    };
    
    // Send our join info immediately
    const def = TANKS[this.settings.selectedTank] || TANKS.coolbuddy;
    Net.sendJoinInfo(this.settings.playerName, this.settings.selectedTank, def.color);
    
    // Spawn local tank (position will be corrected by host's spawn message)
    this._spawnLocal();
    this._begin();
  }

  _onClientWelcome(msg){
    // Host tells us we connected, optionally with spawn data
    if(msg.id && msg.id.indexOf('remote-') === 0){
      this._myRemoteId = msg.id;
    }
    if(msg.x !== undefined && this.localTank){
      this.localTank.x = msg.x;
      this.localTank.z = msg.z;
      if(msg.heading !== undefined) this.localTank.heading = msg.heading;
      this.localTank._syncTransform();
    }
  }

  _applyHostState(snap){
    if(!snap || !snap.tanks) return;
    if(snap.time) this.time = snap.time;
    
    // Apply host state to local tank via remote representation
    if(snap.tanks && this.localTank && this._myRemoteId){
      const mySnap = snap.tanks.find(s => s.id === this._myRemoteId);
      if(mySnap){
        const wasAlive = this.localTank.alive;
        this.localTank.x += (mySnap.x - this.localTank.x) * 0.15;
        this.localTank.z += (mySnap.z - this.localTank.z) * 0.15;
        this.localTank.hp = mySnap.hp;
        this.localTank.alive = mySnap.alive;
        this.localTank.damageDealt = mySnap.dd;
        this.localTank.kills = mySnap.k;
        this.localTank.dying = !!mySnap.dying;
        if(wasAlive && !mySnap.alive && !this.localTank.dying){
          this.localTank._startDeath(this, null);
        }
        this.localTank._syncTransform();
        this.localTank._drawHp();
      }
    }
    
    const seen = new Set([this.localTank ? this.localTank.id : '', this._myRemoteId].filter(Boolean));
    
    (snap.tanks||[]).forEach(s=>{
      if(seen.has(s.id)) return;
      let t = this.tanks.find(x=>x.id===s.id);
      if(!t){
        if(s.id === this._myRemoteId) return;
        const def = TANKS[s.tank]||TANKS.coolbuddy;
        t = new Tank(def, {id:s.id, name:s.name, x:s.x, z:s.z, heading:s.h, color:s.col});
        this._finalizeTank(t);
        this.tanks.push(t);
      }
      const wasAlive = t.alive;
      t.applyPartialSnapshot(s);
      if(wasAlive && !t.alive && !t.dying){
        t._startDeath(this, null);
      }
      seen.add(s.id);
    });
    
    // Remove unseen tanks (that aren't local)
    this.tanks = this.tanks.filter(t=>{
      if(t.isLocal) return true;
      if(!seen.has(t.id)){ t.detach(); return false; }
      return true;
    });
    
    // Handle projectiles from host
    if(snap.projs){
      const hostProjIds = new Set();
      snap.projs.forEach(sp => {
        hostProjIds.add(sp.id);
        let existing = this.projectiles.find(p => p.id === sp.id);
        if(!existing){
          const pos = new THREE.Vector3(sp.x, sp.y, sp.z);
          const dir = new THREE.Vector3(sp.dx, 0, sp.dz);
          const dummyDef = {shellSpeed:90, damage:34, shellRange:40, fireConeHalfAngle:0.12};
          if(sp.type === 'flame'){
            existing = new FlameCone(null, pos, dir, dummyDef);
          } else {
            existing = new Shell(null, pos, dir, dummyDef, null);
          }
          existing._networked = true;
          existing.attach(this.scene);
          this.projectiles.push(existing);
        }
        existing.x = sp.x;
        existing.y = sp.y;
        existing.z = sp.z;
        existing.life = sp.life;
        existing.dead = false;
        if(existing.dir){
          existing.dir.x = sp.dx;
          existing.dir.z = sp.dz;
        }
        if(existing.mesh){
          existing.mesh.position.set(sp.x, sp.y, sp.z);
          existing.mesh.lookAt(sp.x + sp.dx, sp.y, sp.z + sp.dz);
        }
        if(existing.group){
          existing.group.position.set(sp.x, sp.y, sp.z);
        }
      });
      for(let i = this.projectiles.length - 1; i >= 0; i--){
        const p = this.projectiles[i];
        if(!hostProjIds.has(p.id)){
          p.dead = true;
          p.detach();
          this.projectiles.splice(i, 1);
        }
      }
    }
  }

  /* ---------- arena reset / spawn ---------- */
  _resetArena(){
    this.tanks.forEach(t=>t.detach());
    this.projectiles.forEach(p=>p.detach());
    this.explosions.forEach(e=>e.detach());
    this.tanks=[]; this.projectiles=[]; this.explosions=[];
    this.localTank=null; this.time=0;
    this._resetPhysics();
  }

  _resetPhysics(){
    this._physBodies.forEach(b=>{ try{ this.physicsWorld.removeRigidBody(b); }catch(e){} });
    this._physBodies = [];
    this._eventQueue = null;
    this._initPhysics();
  }

  _spawnLocal(){
    const def = TANKS[this.settings.selectedTank] || TANKS.coolbuddy;
    const sp = this.world.randomSpawn();
    const localId = this.mode === 'host' ? 'host-player' : 'local';
    const t = new Tank(def, {id:localId, name:this.settings.playerName, isLocal:true, x:sp.x, z:sp.z, heading:Math.random()*6, physicsWorld:this.physicsWorld});
    this._finalizeTank(t); this.tanks.push(t); this.localTank = t;
    // Ensure trees are placed even if NatureAssets promise hasn't resolved yet
    if(this.world && !this.world.treesPlaced) this.world.tryPlaceTrees();
    // Place OBJ trees near spawn if already loaded
    if(window.NatureAssets && NatureAssets.loaded && NatureAssets.trees.length>0){
      for(let i=0;i<4;i++){
        const src = NatureAssets.trees[Math.floor(Math.random()*NatureAssets.trees.length)];
        const tree = src.clone(true);
        const a = Math.random()*Math.PI*2, d = 5+Math.random()*15;
        tree.position.set(sp.x+Math.cos(a)*d, 0, sp.z+Math.sin(a)*d);
        tree.scale.setScalar(1+Math.random()*0.5);
        this.world.scene.add(tree);
        this.world.trees.push({x:tree.position.x,z:tree.position.z,mesh:tree});
      }
    }
  }

  _spawnBot(){
    const ids = TANK_ORDER.filter(id=>id!==this.settings.selectedTank && id!=='tankdisplay' && id!=='dummy');
    if(!ids.length) return;
    const id = ids[Math.floor(Math.random()*ids.length)];
    const def = TANKS[id];
    if(!def) return;
    const sp = this.world.randomSpawn();
    const t = new Tank(def, {id:'bot-'+Math.random().toString(36).slice(2,6), name:BOTNAMES[Math.floor(Math.random()*BOTNAMES.length)], isBot:true, x:sp.x, z:sp.z, heading:Math.random()*6, physicsWorld:this.physicsWorld});
    t.brain = new BotBrain(t);
    this._finalizeTank(t); this.tanks.push(t);
  }

  _spawnDummy(){
    const def = TANKS.dummy;
    // Spawn 10 units in front of the local player
    const dx = Math.sin(this.localTank.heading) * 10;
    const dz = Math.cos(this.localTank.heading) * 10;
    const x = this.localTank.x + dx;
    const z = this.localTank.z + dz;
    const t = new Tank(def, {id:'dummy', name:'Dummy', x, z, heading:Math.random()*6, physicsWorld:this.physicsWorld});
    t.isDummy = true;
    t.dummySpawnX = x;
    t.dummySpawnZ = z;
    this._finalizeTank(t); this.tanks.push(t);

    // Spawn a display tank next to the dummy
    const displayDef = TANKS.tankdisplay;
    if(displayDef){
      const side = new THREE.Vector3(Math.cos(this.localTank.heading), 0, -Math.sin(this.localTank.heading)).multiplyScalar(5);
      const td = new Tank(displayDef, {id:'displaytank', name:'Display', x: x + side.x, z: z + side.z, heading:0, physicsWorld:this.physicsWorld});
      this._finalizeTank(td); this.tanks.push(td);
    }
  }

  _finalizeTank(t){
    t.attach(this.scene);
    t.makeViewRangeCircle();
    if(!t.isLocal) t.viewCircle.visible = false;
    t.setViewRangeStyle(this.settings.viewRangeOpacity, this.settings.viewRangeColor);
    return t;
  }

  _begin(){
    Menu.showHUD();
    document.getElementById('ui-layer').classList.add('game-active');
    this.running = true;
    this._last = performance.now();
    // Show touch joysticks when game starts (only on mobile)
    if(this.input && this.input.setJoysticksVisible){
      this.input.setJoysticksVisible(true);
    }
    // Lock to landscape on mobile
    if(screen.orientation && screen.orientation.lock){
      screen.orientation.lock('landscape').catch(() => {});
    }
  }

  leaveToMenu(){
    this.running = false;
    this.mode = null;
    try { Net.disconnect(); } catch(e){}
    try { NakamaNet.leaveMatch(); } catch(e){}
    this._resetArena();
    // Hide all overlays
    document.getElementById('esc-menu').classList.add('hidden');
    document.getElementById('bigmap').classList.add('hidden');
    if(Menu.escOpen) Menu.escOpen = false;
    Menu.show('menu-main');
    // Hide touch joysticks when returning to menu
    if(this.input && this.input.setJoysticksVisible){
      this.input.setJoysticksVisible(false);
    }
    // Clean up orientation poll timer if any
    Menu._stopOrientationPoll();
    // Remove in-game portrait warning
    const pw = document.getElementById('portrait-warning');
    if(pw) pw.classList.add('hidden');
    // Unlock orientation
    if(screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
  }

  /* ===========================================================
     GAME LOOP
     =========================================================== */
  _loop(now){
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (now - this._last)/1000 || 0);
    this._last = now;
    if(this.running){
      this.dt = dt; this.time += dt;
      try {
        if(this.physicsWorld){
          this.physicsWorld.step(Math.min(dt, 0.033), null, null, this._eventQueue);
          if(this._eventQueue) this._eventQueue.drainContactEvents((event) => {
            this._onCollision(event);
          });
        }
      } catch(e){ console.warn('Physics step:', e); }
      this._update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  _update(dt){
    try {
    this.world.update(dt, this.time);

    // Camera zoom & orbit
    const zoom = this.input.consumeZoom();
    if(zoom !== 0){
      this.camDist = Math.max(CONFIG.CAM_DIST_MIN, Math.min(CONFIG.CAM_DIST_MAX,
        this.camDist - zoom*CONFIG.CAM_ZOOM_STEP));
    }
    const camRot = this.input.consumeCamRotate();
    if(camRot !== 0){
      this.camAngle -= camRot * CONFIG.CAM_ROTATE_SPEED * dt;
    }

    // Local tank input (keyboard/mouse OR touch)
    if(this.localTank && this.localTank.alive && !this.localTank.dying){
      let throttle, turn, turretAngle, fire, handbrake;
      
      const touchInput = this.input.getTouchInput();
      
      if(touchInput && touchInput.isTouch){
        // Camera-relative controls: joystick direction maps to camera view
        if(this.localTank){
          const mThrottle = touchInput.throttle;
          const mTurn = touchInput.turn;
          const moveMag = Math.sqrt(mThrottle*mThrottle + mTurn*mTurn);
          const dz = 0.15;
          if(moveMag > dz){
            const joyAngle = Math.atan2(mTurn, mThrottle);
            const camFwdHeading = (this.camAngle || Math.PI) + Math.PI;
            const worldMoveHeading = camFwdHeading + joyAngle;
            let diff = worldMoveHeading - this.localTank.heading;
            while(diff > Math.PI) diff -= Math.PI*2;
            while(diff < -Math.PI) diff += Math.PI*2;
            throttle = moveMag;
            turn = -diff * 2;
          } else {
            throttle = 0;
            turn = 0;
          }
        } else {
          throttle = touchInput.throttle;
          turn = touchInput.turn;
        }

        // Turret: camera-relative aim
        if(this.input._turretJoystick && this.input._turretJoystick.active){
          turretAngle = (this.camAngle || Math.PI) + Math.PI - (touchInput.turretRelAngle || 0);
        }

        // Fire only when knob is dragged to max distance (armed)
        fire = !!touchInput.armed;
        handbrake = false;
      } else {
        // Desktop: keyboard + mouse
        throttle = (this.input.pressed('forward')?1:0) - (this.input.pressed('backward')?1:0);

        // Original: A = turn left, D = turn right
        turn = (this.input.pressed('right')?1:0) - (this.input.pressed('left')?1:0);

        turretAngle = this._mouseWorldAngle();
        fire = this.input.pressed('fire');
        handbrake = this.input.pressed('handbrake');
      }
      
      const input = {throttle, turn, turretWorldAngle:turretAngle, fire, handbrake};
      this.localTank.setInput(input);
      // Forward input to host (P2P or Free Roam)
      if(this.mode==='client'){
        Net.sendInput(input);
      } else if(this.mode==='freeroam' && !NakamaNet.isHost){
        NakamaNet.sendMatchData({t: 'input', input});
      }
    }

    // Update all tanks
    this.tanks.forEach(t=>{
      if(t.brain){
        t.setInput(t.brain.decide(this));
      } else if(t.ownerPeer && this.clientTankInputs[t.ownerPeer]){
        t.setInput(this.clientTankInputs[t.ownerPeer]);
      } else if(t === this.localTank){
        // Already set above
      } else {
        t.setInput({throttle:0,turn:0,turretWorldAngle:t.turretAngle,fire:false});
      }
      t.update(dt, this.world, this);
    });
    // Respawn dummy tank 2s after death at its original position
    for(const t of this.tanks){
      if(t.isDummy && t.dying && t.deathT > 0.5 && !t._dummyRespawning){
        t._dummyRespawning = true;
        setTimeout(() => {
          t.respawn(this.world, this);
          t.x = t.dummySpawnX;
          t.z = t.dummySpawnZ;
          t.root.position.x = t.x;
          t.root.position.z = t.z;
          t.turretGroup.position.set(0, 0, 0);
          t.turretGroup.rotation.set(0, 0, 0);
          t._drawHp();
          t._dummyRespawning = false;
        }, 2000);
      }
    }

    // Dummy rapidly regenerates health
    for(const t of this.tanks){
      if(t.isDummy && t.alive && !t.dying && t.hp < t.maxHp){
        t.heal(t.maxHp * 0.5 * dt);
      }
    }

    // Projectiles
    this.projectiles.forEach(p=> p.update(dt, this.world, this));
    this.projectiles = this.projectiles.filter(p=>{ if(p.dead){p.detach(); return false;} return true; });
    this.explosions.forEach(e=> e.update(dt));
    this.explosions = this.explosions.filter(e=>{ if(e.dead){e.detach(); return false;} return true; });
    // Ricochet labels
    if(this._ricoLabels){
      this._ricoLabels.forEach(l=>{ l.life -= dt; l.sprite.material.opacity = Math.max(0, l.life / l.maxLife); });
      this._ricoLabels = this._ricoLabels.filter(l=>{
        if(l.life <= 0){ this.scene.remove(l.sprite); l.sprite.material.map.dispose(); l.sprite.material.dispose(); return false; }
        return true;
      });
    }
    // Water foam around tanks in lakes
    this._updateWaterFoam(dt);

    // Camera (orbits around tank)
    if(this.localTank && this.localTank.alive && !this.localTank.dying){
      const t = this.localTank;
      const angle = this.camAngle;
      const camTarget = new THREE.Vector3(
        t.x + Math.sin(angle) * this.camDist,
        this.camDist*0.78 + 3,
        t.z + Math.cos(angle) * this.camDist);
      this.camera.position.lerp(camTarget, CONFIG.CAM_LERP);
      this.camera.lookAt(t.x, 1.2, t.z);
      if(this._shake > 0){
        this._shake = Math.max(0, this._shake - dt*2.5);
        const s = this._shake;
        this.camera.position.x += (Math.random()-0.5)*s;
        this.camera.position.y += (Math.random()-0.5)*s;
        this.camera.position.z += (Math.random()-0.5)*s;
      }
    } else if(this.localTank && !this.localTank.alive){
      // Keep camera at last position when dead (don't follow dying tank)
    }

    // Dynamic UI and outline scaling based on camera distance
    for(const t of this.tanks) t.updateDistanceScaling(this.camera.position);

    // Aim line
    this._updateAimLine();

    // Visibility
    this._updateVisibility();

    // Networking: Host broadcasts state
    if(this.mode==='host'){
      this._netSendAcc += dt;
      if(this._netSendAcc > 0.05){ // ~20Hz
        this._netSendAcc = 0;
        Net.broadcast({time:this.time, tanks:this.tanks.map(t=>t.snapshot()), projs:this.projectiles.filter(p=>!p.dead).map(p=>({id:p.id,x:p.x,y:p.y,z:p.z,dx:p.dir.x,dz:p.dir.z,type:p.type,life:p.life}))});
      }
    } else if(this.mode==='freeroam' && NakamaNet.isHost){
      this._netSendAcc += dt;
      if(this._netSendAcc > 0.05){
        this._netSendAcc = 0;
        NakamaNet.sendMatchData({t: 'state', s: {time:this.time, tanks:this.tanks.map(t=>t.snapshot()), projs:this.projectiles.filter(p=>!p.dead).map(p=>({id:p.id,x:p.x,y:p.y,z:p.z,dx:p.dir.x,dz:p.dir.z,type:p.type,life:p.life}))}});
      }
    }

    // HUD
    this._updateHUD();
    } catch(e){ console.warn('Update error:', e); }
  }

  _updateAimLine(){
    if(!this.aimLine) return;
    const t = this.localTank;
    if(!t || !t.alive){
      this.aimLine.visible = false; if(this.aimMarkers) this.aimMarkers.visible = false;
      return;
    }
    this.aimLine.visible = true;
    const {pos, dir} = t.muzzle();
    const startX = pos.x, startZ = pos.z;
    const range = t.def.shellRange;
    const step = 1.5;
    let endX = startX, endZ = startZ;
    let endDist = range;
    for(let d=0; d<=range; d+=step){
      const tx = startX + dir.x*d, tz = startZ + dir.z*d;
      if(this.world.collidesWallsOnly(tx, tz, 0.3)){ endX=tx; endZ=tz; endDist=d; break; }
      endX=tx; endZ=tz;
    }
    const arr = this.aimLine.geometry.attributes.position.array;
    const isCone = t.def.shellType === 'flame';
    let ricoX = endX, ricoZ = endZ, ricoEndX = endX, ricoEndZ = endZ;
    let ricoEntryDist = endDist, ricoRemaining = 0;
    let rDirX = 0, rDirZ = 0, ricoTarget = null;
    const y = t.def.body.h + 0.6;
    if(isCone){
      const tanHalf = t.def.fireConeHalfAngle || 0.12;
      const halfW = endDist * tanHalf;
      const perpX = -dir.z, perpZ = dir.x;
      arr[0]=startX; arr[1]=y; arr[2]=startZ;
      arr[3]=endX + perpX*halfW; arr[4]=y; arr[5]=endZ + perpZ*halfW;
      arr[6]=endX - perpX*halfW; arr[7]=y; arr[8]=endZ - perpZ*halfW;
      arr[9]=startX; arr[10]=y; arr[11]=startZ;
    } else {
      // Ricochet prediction — circle-ray intersection for exact entry point
      for(const enemy of this.tanks){
        if(enemy === t || !enemy.alive || !enemy.def.armor) continue;
        const rad = Math.max(enemy.def.body.w, enemy.def.body.l)/2 + 0.4;
        const edx = startX - enemy.x, edz = startZ - enemy.z;
        const b = 2 * (edx * dir.x + edz * dir.z);
        const c = edx*edx + edz*edz - rad*rad;
        const disc = b*b - 4*c;
        if(disc <= 0) continue;
        const sqrtD = Math.sqrt(disc);
        const t1 = (-b - sqrtD) / 2;
        const t2 = (-b + sqrtD) / 2;
        const entryT = (t1 > 0.01 && t1 < endDist) ? t1 : (t2 > 0.01 && t2 < endDist ? t2 : 0);
        if(entryT <= 0 || entryT > ricoEntryDist) continue;
        const ex = startX + dir.x * entryT, ez = startZ + dir.z * entryT;
        // Check if ricochet would happen
        const h = enemy.heading;
        const fwX = Math.sin(h), fwZ = Math.cos(h);
        const fx = ex - enemy.x, fz = ez - enemy.z;
        const fl = Math.hypot(fx, fz);
        if(fl > 0.01){
          const fdX = fx/fl, fdZ = fz/fl;
          const dot = fdX * fwX + fdZ * fwZ;
          let nxx, nzz, av;
          if(dot > 0.5){ nxx = fwX; nzz = fwZ; av = enemy.def.armor.front; }
          else if(dot < -0.5){ nxx = -fwX; nzz = -fwZ; av = enemy.def.armor.back; }
          else {
            const sX = Math.cos(h), sZ = -Math.sin(h);
            const sD = fdX * sX + fdZ * sZ;
            nxx = sD > 0 ? sX : -sX; nzz = sD > 0 ? sZ : -sZ;
            av = enemy.def.armor.sides;
          }
          const dN = Math.abs(dir.x * nxx + dir.z * nzz);
          const aFS = 90 - Math.acos(Math.min(1, dN)) * 180 / Math.PI;
          if(aFS < av){
            const rD = dir.x * nxx + dir.z * nzz;
            let rrx = dir.x - 2 * rD * nxx;
            let rrz = dir.z - 2 * rD * nzz;
            const rL = Math.hypot(rrx, rrz);
            if(rL > 0.01){
              rrx /= rL; rrz /= rL;
              let rEx = ex, rEz = ez, lastS = 0;
              const ricoMax = (range - entryT) / 1.5;
              for(let s=0; s<=ricoMax; s+=1.5){
                const tx = ex + rrx * s, tz = ez + rrz * s;
                if(this.world.collidesWallsOnly(tx, tz, 0.3)){ rEx=tx; rEz=tz; break; }
                rEx=tx; rEz=tz; lastS = s;
              }
              ricoX = ex; ricoZ = ez; ricoEntryDist = entryT;
              ricoEndX = rEx; ricoEndZ = rEz; ricoRemaining = lastS;
              rDirX = rrx; rDirZ = rrz;
            }
          } else {
            ricoX = ex; ricoZ = ez; ricoEntryDist = entryT;
            ricoEndX = ex; ricoEndZ = ez; ricoRemaining = 0;
          }
        }
        ricoTarget = enemy;
        break;
      }
      arr[0]=startX; arr[1]=y; arr[2]=startZ;
      arr[3]=ricoX; arr[4]=y; arr[5]=ricoZ;
      arr[6]=ricoX; arr[7]=y; arr[8]=ricoZ;
      arr[9]=ricoEndX; arr[10]=y; arr[11]=ricoEndZ;
    }
    // Ricochet indicator: 2 colored lines on target tank's visible faces
    if(this.settings.ricochetIndicator && ricoTarget && ricoTarget.alive){
      const en = ricoTarget, h = en.heading;
      const fwX = Math.sin(h), fwZ = Math.cos(h);
      const sX = Math.cos(h), sZ = -Math.sin(h);
      const cW = en.def.body.w / 2, cL = en.def.body.l / 2;
      // Direction from target to shooter (for face visibility)
      const dtx = startX - en.x, dtz = startZ - en.z, dl = Math.hypot(dtx, dtz) || 1;
      // 4 faces: {nx,nz} = normal, {mx,mz} = midpoint offset, {tx,tz} = tangent, len, armor
      const faces = [
        { nx:fwX, nz:fwZ, mx:fwX*cL, mz:fwZ*cL, tx:sX, tz:sZ, len:cW*2, armor:'front' },
        { nx:-fwX, nz:-fwZ, mx:-fwX*cL, mz:-fwZ*cL, tx:sX, tz:sZ, len:cW*2, armor:'back' },
        { nx:sX, nz:sZ, mx:sX*cW, mz:sZ*cW, tx:fwX, tz:fwZ, len:cL*2, armor:'sides' },
        { nx:-sX, nz:-sZ, mx:-sX*cW, mz:-sZ*cW, tx:fwX, tz:fwZ, len:cL*2, armor:'sides' },
      ];
      const scored = faces.map(f => ({...f, dot: (f.nx*dtx + f.nz*dtz)/dl }));
      scored.sort((a,b) => b.dot - a.dot);
      const yp = en.def.body.h * 0.4, off = 0.1, lf = 1.0;
      const farr = this._ricoFrame.geometry.attributes.position.array;
      let fi = 0;
      for(let i=0; i<this._ricoLines.length; i++){
        const f = scored[i];
        if(!f){ this._ricoLines[i].visible = false; continue; }
        const fmx = en.x + f.mx + f.nx*off;
        const fmz = en.z + f.mz + f.nz*off;
        const hf = f.len * lf * 0.5;
        const arr = this._ricoLines[i].geometry.attributes.position.array;
        // colored line
        arr[0] = fmx - f.tx*hf; arr[1] = yp; arr[2] = fmz - f.tz*hf;
        arr[3] = fmx + f.tx*hf; arr[4] = yp; arr[5] = fmz + f.tz*hf;
        this._ricoLines[i].geometry.attributes.position.needsUpdate = true;
        // white end-caps (perpendicular to tangent)
        const pX = -f.tz, pZ = f.tx, capHalf = 0.07;
        const lx = fmx - f.tx*hf, lz = fmz - f.tz*hf;
        farr[fi] = lx - pX*capHalf; farr[fi+1] = yp; farr[fi+2] = lz - pZ*capHalf;
        farr[fi+3] = lx + pX*capHalf; farr[fi+4] = yp; farr[fi+5] = lz + pZ*capHalf;
        fi += 6;
        const rx = fmx + f.tx*hf, rz = fmz + f.tz*hf;
        farr[fi] = rx - pX*capHalf; farr[fi+1] = yp; farr[fi+2] = rz - pZ*capHalf;
        farr[fi+3] = rx + pX*capHalf; farr[fi+4] = yp; farr[fi+5] = rz + pZ*capHalf;
        fi += 6;
        // color
        const dN = Math.abs(dir.x*f.nx + dir.z*f.nz);
        const aFS = 90 - Math.acos(Math.min(1, dN)) * 180 / Math.PI;
        const av = en.def.armor[f.armor], margin = aFS - av;
        let col = 0;
        if(margin >= 15) col = 0x33ee33;
        else if(margin >= 0){
          const t = margin/15;
          col = (Math.round(255-t*155)<<16) | (Math.round(128+t*110)<<8) | 0;
        } else col = 0xee3333;
        this._ricoLines[i].material.color.setHex(col);
        this._ricoLines[i].visible = true;
      }
      this._ricoFrame.geometry.attributes.position.needsUpdate = true;
      this._ricoFrame.visible = true;
    } else {
      this._ricoLines.forEach(l => l.visible = false);
      if(this._ricoFrame) this._ricoFrame.visible = false;
    }
    this.aimLine.geometry.attributes.position.needsUpdate = true;

    // Professional markers + labels every 10m (follow ricochet path)
    if(this.aimMarkers){
      const isPro = this.settings.aimLineDesign === 'professional';
      this.aimMarkers.visible = isPro;
      const markArr = this._aimMarkerArr;
      let idx = 0;
      let labelIdx = 0;
      const totalPath = ricoEntryDist + ricoRemaining;
      const isCone2 = t.def.shellType === 'flame';
      for(let d=10; d<=totalPath && !isCone2; d+=10){
        let mx, mz, perpX, perpZ;
        if(d <= ricoEntryDist){
          mx = startX + dir.x * d;
          mz = startZ + dir.z * d;
          perpX = -dir.z; perpZ = dir.x;
        } else {
          const rd = d - ricoEntryDist;
          mx = ricoX + rDirX * rd;
          mz = ricoZ + rDirZ * rd;
          perpX = -rDirZ; perpZ = rDirX;
        }
        const halfW = 0.4;
        if(isPro && idx+5 < markArr.length){
          markArr[idx] = mx + perpX * halfW;
          markArr[idx+1] = y;
          markArr[idx+2] = mz + perpZ * halfW;
          markArr[idx+3] = mx - perpX * halfW;
          markArr[idx+4] = y;
          markArr[idx+5] = mz - perpZ * halfW;
          idx += 6;
        }
        if(isPro && labelIdx < this._aimLabels.length){
          const lbl = this._aimLabels[labelIdx];
          lbl.visible = true;
          lbl.position.set(mx + perpX * 1.2, y + 0.6, mz + perpZ * 1.2);
          labelIdx++;
        }
      }
      if(idx < markArr.length){ markArr.fill(0, idx); }
      if(isPro){
        this.aimMarkers.geometry.attributes.position.needsUpdate = true;
        while(labelIdx < this._aimLabels.length){
          this._aimLabels[labelIdx].visible = false;
          labelIdx++;
        }
      } else {
        this._aimLabels.forEach(s=>s.visible = false);
      }
    }
  }

  /* Ricochet indicator: 2 colored lines + white end-caps on visible faces */
  _initRicoIndicator(){
    this._ricoLines = [];
    for(let i=0; i<2; i++){
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(6);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0x00ff00, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      line.frustumCulled = false;
      this.scene.add(line);
      this._ricoLines.push(line);
    }
    // White end-caps (frame): 4 caps (2 per face × 2 faces)
    const fgeo = new THREE.BufferGeometry();
    const fpos = new Float32Array(24); // 4 segments × 2 verts × 3 coords
    fgeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
    this._ricoFrame = new THREE.LineSegments(fgeo, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false,
    }));
    this._ricoFrame.visible = false;
    this._ricoFrame.frustumCulled = false;
    this.scene.add(this._ricoFrame);
  }

  spawnRicoLabel(x, z){
    const c = document.createElement('canvas');
    c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 12;
    g.fillStyle = '#ff6a2a'; g.font = 'bold 42px Segoe UI, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('Ricochet!', 128, 48);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false, depthWrite:false});
    const s = new THREE.Sprite(mat);
    s.position.set(x, 1.5, z);
    s.scale.set(4, 1.5, 1);
    this.scene.add(s);
    if(!this._ricoLabels) this._ricoLabels = [];
    this._ricoLabels.push({sprite:s, life:1.2, maxLife:1.2});
  }

  /* Check if any part of the tank intersects water */
  _tankInWater(t){
    const hw = t.def.body.w/2 + 0.6, hl = t.def.body.l/2 + 0.4;
    const ch = Math.cos(t.heading), sh = Math.sin(t.heading);
    const corners = [
      [ hw,  hl], [ hw, -hl], [-hw,  hl], [-hw, -hl],
    ];
    for(const [lx,lz] of corners){
      if(this.world.lakeAt(t.x + lx*ch + lz*sh, t.z - lx*sh + lz*ch)) return true;
    }
    return !!this.world.lakeAt(t.x, t.z);
  }

  _tankFullyInWater(t){
    const hw = t.def.body.w/2 + 0.6, hl = t.def.body.l/2 + 0.4;
    const ch = Math.cos(t.heading), sh = Math.sin(t.heading);
    const pts = [[0,0],[ hw, hl],[ hw,-hl],[-hw, hl],[-hw,-hl]];
    for(const [lx,lz] of pts){
      if(!this.world.lakeAt(t.x + lx*ch + lz*sh, t.z - lx*sh + lz*ch)) return false;
    }
    return true;
  }

  /* White outline line around tank at water level — only edges in water visible */
  _updateWaterFoam(dt){
    if(!this.world) return;
    // Animate shore foam rings — pulse scale for wave illusion
    const rings = this.world._foamRings;
    if(rings){
      for(const r of rings){
        const s = 1.0 + Math.sin(this.time * 2.0 + r.phase) * 0.015;
        r.mesh.scale.set(s, 1, s);
        r.mesh.material.opacity = 0.85;
      }
    }
    for(const t of this.tanks){
      if(!t.alive || t.dying){
        this._cleanupFoam(t);
        continue;
      }
      const inWater = this._tankInWater(t);
      const fullyIn = inWater && this._tankFullyInWater(t);
      if(fullyIn && !t._drowning){
        t._drowning = true;
        t._drownTimer = 0;
        t._drownBar.visible = true;
      } else if(!fullyIn && t._drowning){
        t._drowning = false;
        t._drownTimer = 0;
        t._drownBar.visible = false;
      }
      if(t._drowning){
        t._drownTimer += dt;
        t._drawDrownBar(t._drownTimer / 10);
        if(t._drownTimer >= 10){
          t._drowning = false;
          t._drownBar.visible = false;
          t.takeDamage(t.hp, null, null);
        }
      }
      if(inWater){
        if(!t._foamMeshes){
          const hw = t.def.body.w/2 + 0.5, hl = t.def.body.l/2 + 0.3, fat = 0.6;
          const mat = () => new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide,
          });
          const makeStrip = (pts) => {
            const sh = new THREE.Shape();
            sh.moveTo(pts[0][0], pts[0][1]);
            for(let i=1;i<pts.length;i++) sh.lineTo(pts[i][0], pts[i][1]);
            sh.closePath();
            const g = new THREE.ShapeGeometry(sh);
            g.rotateX(-Math.PI/2);
            const m = new THREE.Mesh(g, mat());
            m.renderOrder = 4;
            this.scene.add(m);
            return m;
          };
          t._foamMeshes = [
            makeStrip([[0, -hl], [hw, -hl], [hw, -hl+fat], [0, -hl+fat]]),
            makeStrip([[-hw, -hl], [0, -hl], [0, -hl+fat], [-hw, -hl+fat]]),
            makeStrip([[0, hl], [hw, hl], [hw, hl-fat], [0, hl-fat]]),
            makeStrip([[-hw, hl], [0, hl], [0, hl-fat], [-hw, hl-fat]]),
            makeStrip([[hw, 0], [hw, -hl], [hw-fat, -hl], [hw-fat, 0]]),
            makeStrip([[hw, 0], [hw, hl], [hw-fat, hl], [hw-fat, 0]]),
            makeStrip([[-hw, 0], [-hw, -hl], [-hw+fat, -hl], [-hw+fat, 0]]),
            makeStrip([[-hw, 0], [-hw, hl], [-hw+fat, hl], [-hw+fat, 0]]),
          ];
        }
        const ch = Math.cos(t.heading), sh = Math.sin(t.heading);
        const hw = t.def.body.w/2 + 0.5, hl = t.def.body.l/2 + 0.3;
        const edges = [
          { mid:[ hw/2,  hl], idx:0, ox: sh, oz: ch },
          { mid:[-hw/2,  hl], idx:1, ox: sh, oz: ch },
          { mid:[ hw/2, -hl], idx:2, ox:-sh, oz:-ch },
          { mid:[-hw/2, -hl], idx:3, ox:-sh, oz:-ch },
          { mid:[ hw,  hl/2], idx:4, ox: ch, oz:-sh },
          { mid:[ hw, -hl/2], idx:5, ox: ch, oz:-sh },
          { mid:[-hw,  hl/2], idx:6, ox:-ch, oz: sh },
          { mid:[-hw, -hl/2], idx:7, ox:-ch, oz: sh },
        ];
        for(const ed of edges){
          const m = t._foamMeshes[ed.idx];
          const mx = t.x + ed.mid[0]*ch + ed.mid[1]*sh;
          const mz = t.z - ed.mid[0]*sh + ed.mid[1]*ch;
          if(this.world.lakeAt(mx, mz)){
            const wh = this.world.waveHeight(mx, mz, this.time);
            m.position.set(t.x, 0.25 + wh + 0.02, t.z);
            m.rotation.y = t.heading;
            m.material.opacity = 0.85;
          } else {
            m.position.set(0, -999, 0);
            m.material.opacity = 0;
          }
        }
        // Spawn foam particles from visible edges
        if(!t._foamParticles) t._foamParticles = [];
        if(t._foamParticles.length < 30 && Math.random() < 0.3){
          const visible = edges.filter((_,i)=> {
            const m = t._foamMeshes[i];
            return m.position.y > -900;
          });
          if(visible.length){
            const ed = visible[Math.floor(Math.random()*visible.length)];
            const mx = t.x + ed.mid[0]*ch + ed.mid[1]*sh;
            const mz = t.z - ed.mid[0]*sh + ed.mid[1]*ch;
            let tooClose = false;
            for(const p of t._foamParticles){
              if(Math.hypot(mx-p.x, mz-p.z) < 0.6){ tooClose = true; break; }
            }
            if(!tooClose){
              if(!this._partGeo) this._partGeo = new THREE.PlaneGeometry(0.9, 0.15);
              const pm = new THREE.Mesh(this._partGeo, new THREE.MeshBasicMaterial({
                color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide,
              }));
              pm.renderOrder = 5;
              pm.position.set(mx, 0.27, mz);
              pm.rotation.x = -Math.PI/2;
              const perpAngle = Math.atan2(-ed.ox, -ed.oz) + (Math.random() - 0.5) * 0.35;
              pm.rotation.y = perpAngle;
              this.scene.add(pm);
              const maxLife = 0.8 + Math.random() * 1.0;
              t._foamParticles.push({
                mesh: pm, x: mx, z: mz,
                dx: ed.ox, dz: ed.oz,
                speed: 0.5 + Math.random() * 1.0,
                life: maxLife, maxLife,
              });
            }
          }
        }
        // Update particles
        for(let i = t._foamParticles.length-1; i>=0; i--){
          const p = t._foamParticles[i];
          p.x += p.dx * p.speed * dt;
          p.z += p.dz * p.speed * dt;
          p.life -= dt;
          if(p.life <= 0){
            this.scene.remove(p.mesh);
            p.mesh.material.dispose();
            t._foamParticles.splice(i,1);
          } else {
            p.mesh.position.set(p.x, 0.27, p.z);
            p.mesh.material.opacity = p.life / p.maxLife;
          }
        }
      } else {
        this._cleanupFoam(t);
      }
    }
  }
  _cleanupFoam(t){
    if(t._foamMeshes){
      t._foamMeshes.forEach(m=>{ this.scene.remove(m); m.material.dispose(); m.geometry.dispose(); });
      t._foamMeshes = null;
    }
    if(t._foamParticles){
      t._foamParticles.forEach(p=>{ this.scene.remove(p.mesh); p.mesh.material.dispose(); });
      t._foamParticles = null;
    }
  }

  _mouseWorldAngle(){
    if(!this.localTank) return 0;
    const ray = new THREE.Raycaster();
    const v = new THREE.Vector2(this.input.mouse.ndcX, this.input.mouse.ndcY);
    ray.setFromCamera(v, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0,1,0), -(this.localTank.def.body.h+0.5));
    const hit = new THREE.Vector3();
    if(!ray.ray.intersectPlane(plane, hit)) return this.localTank.turretAngle;
    return Math.atan2(hit.x - this.localTank.x, hit.z - this.localTank.z);
  }

  /* ===========================================================
     COMBAT HOOKS
     =========================================================== */
  spawnShot(tank){
    const {pos, dir} = tank.muzzle();
    const y = pos.y;
    // In client/freeroam mode, host sends projectiles via snapshots
    if(this.mode !== 'client' && this.mode !== 'freeroam'){
      const p = tank.def.shellType==='flame'
        ? new FlameCone(tank, new THREE.Vector3(pos.x, y, pos.z), dir, tank.def)
        : new Shell(tank, new THREE.Vector3(pos.x, y, pos.z), dir, tank.def, this.physicsWorld);
      p.attach(this.scene); this.projectiles.push(p);
    }
    if(tank===this.localTank) this._muzzleFlash(pos, dir);
  }

  _muzzleFlash(pos, dir){
    const ex = new Explosion(pos.x, pos.y+0.2, pos.z, 0xffe08a, 8);
    ex.attach(this.scene); this.explosions.push(ex);
  }

  spawnExplosion(x,y,z,color,count){
    const e = new Explosion(x,y,z,color,count||6);
    e.attach(this.scene); this.explosions.push(e);
  }

  onTankKilled(tank, byTank){
    this.spawnExplosion(tank.x, 1.4, tank.z, 0xff5b3b, 16);
    this.spawnExplosion(tank.x, 2.0, tank.z, 0xffaa33, 10);
    if(this.localTank){
      const d = Math.hypot(this.localTank.x-tank.x, this.localTank.z-tank.z);
      if(d < 45){
        this._shake = Math.max(this._shake, 0.9 * (1 - d/45));
      }
    }
  }

  onLocalDeath(){
    this.running = false;
    Menu.toast('Your tank was destroyed');
    setTimeout(()=> this.leaveToMenu(), 600);
  }

  addShake(amount){ this._shake = Math.max(this._shake, amount); }

  /* ---------- Visibility ---------- */
  _updateVisibility(){
    if(!this.localTank) return;
    const me = this.localTank;
    for(const t of this.tanks){
      if(t === me){ t.root.visible = true; continue; }
      if(t.dying){ t.root.visible = true; continue; }
      const d = Math.hypot(t.x-me.x, t.z-me.z);
      let visible;
      if(d < 18) visible = true;
      else if(d <= me.viewRange) visible = (t.camoFactor >= 0.5);
      else visible = false;
      t.root.visible = visible;
    }
  }

  /* ===========================================================
     HUD
     =========================================================== */
  _updateHUD(){
    if(!this.localTank) return;
    const t = this.localTank;
    document.getElementById('speed-val').textContent = Math.max(0, Math.round(Math.abs(t.speed) * U_TO_KMH));
    const hpBar = document.getElementById('hp-bar');
    const pct = Math.max(0, t.hp/t.maxHp);
    hpBar.style.width = (pct*100)+'%';
    document.getElementById('hp-text').textContent = `${Math.ceil(t.hp)} / ${t.maxHp}`;
    
    const drownWrap = document.getElementById('drown-bar-wrap');
    const drownBar = document.getElementById('drown-bar');
    if(drownWrap && drownBar){
      if(t._drowning){
        drownWrap.classList.remove('hidden');
        drownBar.style.width = Math.min(100, (t._drownTimer / 10) * 100) + '%';
      } else {
        drownWrap.classList.add('hidden');
        drownBar.style.width = '0%';
      }
    }
    
    const dot = document.getElementById('camo-dot');
    const camoTxt = document.getElementById('camo-text');
    if(dot && camoTxt){
      if(t.camoState === 'bush'){
        dot.className = 'camo-dot on'; camoTxt.textContent = 'You are in bush';
      } else if(t.camoState === 'tree'){
        dot.className = 'camo-dot mid'; camoTxt.textContent = 'Partial cover';
      } else {
        dot.className = 'camo-dot off'; camoTxt.textContent = '';
      }
    }
    
    // Flamethrower heat bar
    const heatWrap = document.getElementById('heat-wrap');
    const heatBar = document.getElementById('heat-bar');
    const heatText = document.getElementById('heat-text');
    if(heatWrap && heatBar && heatText){
      if(t.def.shellType === 'flame'){
        heatWrap.classList.remove('hidden');
        const pct = t.heat / 1000;
        heatBar.style.height = (pct * 100) + '%';
        heatText.textContent = t.overheated ? 'OVERHEATED' : Math.round(pct * 100) + '%';
      } else {
        heatWrap.classList.add('hidden');
      }
    }

    // Leaderboard: ALL tanks sorted by damage
    const sorted = [...this.tanks]
      .sort((a,b)=> b.damageDealt - a.damageDealt).slice(0,5);
    const lb = document.getElementById('lb-list');
    lb.innerHTML = sorted.map((o,i)=> `<li><span class="lname">${o.name}</span><span class="ldmg">${Math.round(o.damageDealt)}</span></li>`).join('');

    // In-game portrait warning
    const pw = document.getElementById('portrait-warning');
    if(pw){
      const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.navigator.standalone;
      const isPortrait = window.innerHeight > window.innerWidth;
      const orientPortrait = screen.orientation && screen.orientation.type && screen.orientation.type.startsWith('portrait');
      if(isMobile && (isPortrait || orientPortrait)){
        pw.classList.remove('hidden');
      } else {
        pw.classList.add('hidden');
      }
    }
  }

  /* ---------- Big map ---------- */
  toggleBigMap(){
    const wrap = document.getElementById('bigmap');
    if(!wrap.classList.contains('hidden')){
      wrap.classList.add('hidden'); return;
    }
    const cv = document.getElementById('bigmap-canvas');
    const S = 720;
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    this.world.renderToCanvas(ctx, S, S);
    if(this.localTank){
      const [px,py] = this.world.worldToMap(this.localTank.x, this.localTank.z, S);
      ctx.save(); ctx.translate(px,py); ctx.rotate(-this.localTank.heading);
      ctx.fillStyle='#ffb12b'; ctx.beginPath();
      ctx.moveTo(0,-8); ctx.lineTo(6,8); ctx.lineTo(-6,8); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    wrap.classList.remove('hidden');
  }
}

const BOTNAMES = ['Rommel','Patton','Guderian','Zhukov','Abrams','Leclerc','Tiger','Panther','Sherman','T-34','Challenger','Merkava','Karl','Bovington','Stug','Hetzer','IS-2','Comet','Cromwell','Hellcat'];

/* ---------- Bootstrap ---------- */
window.addEventListener('DOMContentLoaded', async ()=>{
  try {
    var RapierMod = await import('https://cdn.skypack.dev/@dimforge/rapier3d-compat@0.12.0');
    if(RapierMod.default){
      await RapierMod.default.init();
      window.RAPIER = RapierMod.default;
    }
  } catch(e){ console.warn('Rapier init failed, physics disabled:', e); }
  let game = null;
  try {
    game = new Game();
    game.init();
  } catch(e){
    console.error('BOOTSTRAP ERROR:', e, e.stack);
  }
  try {
    Menu.init(game);
  } catch(e){
    console.error('MENU INIT ERROR:', e, e.stack);
  }
  window.__game = game;
});