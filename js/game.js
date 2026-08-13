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
    this.casings = [];
    this._eventQueue = null;
    this._helixVideos = new Map();
    this.glad = null;
    this._gladBoxes = [];
    this._gladPickups = [];
    this._adapT = 0;
    this._gladChunkMeshes = [];
    this._gladChunkOverlays = [];
    this._gladCorruptedChunks = new Set();
    this._gladNextCorruptionIndex = 0;
    this._gladChunkGlowTime = 0;
    this._gladZoneCanvas = null;
    this._gladZoneTex = null;
    this._gladZoneMesh = null;
  }

  /* ---------- Three.js bootstrap ---------- */
  init(){
    // MSAA only helps at 1x DPR; at higher pixel ratios supersampling already
    // smooths edges, and antialias+high-res is the classic fill-rate killer.
    this.renderer = new THREE.WebGLRenderer({antialias: devicePixelRatio <= 1, powerPreference: 'high-performance', stencil:false, depth:true});
    this._maxPixelRatio = Math.min(devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(this._maxPixelRatio);
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
    this.camMode = 'arrows';

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

    /* ---- Performance overlay (hold P) ---- */
    this._buildPerfOverlay();
    this._onKeyDown = (e) => {
      if (e.code === 'KeyP') { this._perfOverlay.style.display = 'block'; }
    };
    this._onKeyUp = (e) => {
      if (e.code === 'KeyP') { this._perfOverlay.style.display = 'none'; }
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    
    // F11 fullscreen support (delegates to Menu._initFullscreen's handlers)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F11') {
        e.preventDefault();
        const inFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
        if (inFS) {
          document.exitFullscreen();
        } else {
          document.documentElement.requestFullscreen().catch(()=>{});
        }
      }
    });
    
    // Hide fullscreen prompt when entering fullscreen (also handled by Menu, but add safety)
    document.addEventListener('fullscreenchange', () => {
      const prompt = document.getElementById('menu-fullscreen-prompt');
      if (prompt) {
        const inFS = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
        if (inFS) {
          prompt.classList.add('hidden');
        }
      }
    });
    
    // Hide fullscreen prompt on desktop by default - use DOM ready check
    const checkAndHideDesktopPrompt = () => {
      const prompt = document.getElementById('menu-fullscreen-prompt');
      if (prompt) {
        const ua = navigator.userAgent;
        const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
        const isAndroid = /Android/.test(ua);
        const isDesktop = !isIOS && !isAndroid;
        if (isDesktop) {
          // Set Menu's _fsDismissed flag so it doesn't re-show
          if (window.Menu && window.Menu._initFullscreen) {
            // Temporarily prevent Menu from showing overlay
            window.Menu._desktopNoPrompt = true;
          }
          prompt.classList.add('hidden');
        }
      }
    };
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', checkAndHideDesktopPrompt);
    } else {
      checkAndHideDesktopPrompt();
    }
    
    // Ensure fullscreen buttons work even if DOM loaded later
    document.addEventListener('DOMContentLoaded', () => {
      const enterBtn = document.getElementById('btn-enter-fullscreen');
      if (enterBtn && !enterBtn._onclickAttached) {
        enterBtn._onclickAttached = true;
        enterBtn.onclick = (e) => {
          e.preventDefault();
          document.documentElement.requestFullscreen().catch(()=>{});
          const prompt = document.getElementById('menu-fullscreen-prompt');
          if (prompt) prompt.classList.add('hidden');
          if (window.Menu) {
            window.Menu._fsDismissed = true;
            window.Menu._checkRenderingTips && window.Menu._checkRenderingTips();
          }
        };
      }
      const dismissBtn = document.getElementById('btn-dismiss-fullscreen');
      if (dismissBtn && !dismissBtn._onclickAttached) {
        dismissBtn._onclickAttached = true;
        dismissBtn.onclick = (e) => {
          e.preventDefault();
          const prompt = document.getElementById('menu-fullscreen-prompt');
          if (prompt) prompt.classList.add('hidden');
          if (window.Menu) {
            window.Menu._fsDismissed = true;
            window.Menu._checkRenderingTips && window.Menu._checkRenderingTips();
          }
        };
      }
      const closeBtn = document.getElementById('btn-fs-close');
      if (closeBtn && !closeBtn._onclickAttached) {
        closeBtn._onclickAttached = true;
        closeBtn.onclick = (e) => {
          e.preventDefault();
          const prompt = document.getElementById('menu-fullscreen-prompt');
          if (prompt) prompt.classList.add('hidden');
          if (window.Menu) {
            window.Menu._fsDismissed = true;
            window.Menu._checkRenderingTips && window.Menu._checkRenderingTips();
          }
        };
      }
    });
  }

  /** Build the custom full-screen performance overlay DOM */
  _buildPerfOverlay(){
    this._perfFpsHistory = [];
    this._perfGpuLoadSamples = [];
    this._perfLastThrottle = 0;
    this._perfFrameStart = 0;
    this._perfUpdateEnd = 0;

    var gl = this.renderer.getContext();
    var gpuName = 'Unknown GPU';
    try {
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) gpuName = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    } catch(e){}

    var d = document.createElement('div');
    d.id = 'perf-overlay';
    d.style.cssText = [
      'position:fixed', 'top:0', 'right:0', 'z-index:99999',
      'background:rgba(8,12,18,0.88)', 'border-left:1px solid rgba(0,255,170,0.12)',
      'padding:14px 18px', 'font-family:"Consolas","Courier New",monospace',
      'font-size:12px', 'line-height:1.7', 'color:#b0e0c0',
      'min-width:280px', 'display:none', 'user-select:none', 'pointer-events:none',
    ].join(';');

    d.innerHTML =
      '<div style="color:#0f6;font-size:13px;font-weight:700;letter-spacing:1px;border-bottom:1px solid rgba(0,255,170,0.15);padding-bottom:6px;margin-bottom:6px">PERFORMANCE MONITOR</div>' +
      '<div id="perf-row-gpu" style="color:#8af"></div>' +
      '<div id="perf-row-fps"></div>' +
      '<div id="perf-row-frametime"></div>' +
      '<div id="perf-row-ping"></div>' +
      '<div id="perf-row-mem-used"></div>' +
      '<div id="perf-row-mem-total"></div>' +
      '<div id="perf-row-mem-pct"></div>' +
      '<div id="perf-row-cpu"></div>' +
      '<div id="perf-row-gpu-load"></div>' +
      '<div style="border-top:1px solid rgba(0,255,170,0.15);padding-top:6px;margin-top:6px" id="perf-row-rating"></div>';

    document.body.appendChild(d);
    this._perfOverlay = d;
    document.getElementById('perf-row-gpu').textContent = 'GPU  ' + gpuName;
  }

  /** Throttled overlay update — called every frame but only rewrites DOM ~3x/sec */
  _updatePerfOverlay(now){
    if (now - this._perfLastThrottle < 350) return;
    this._perfLastThrottle = now;

    // FPS: rolling average over last 30 frames
    var fps = 0;
    var hist = this._perfFpsHistory;
    if (hist.length > 1){
      var sum = 0;
      for (var i = 1; i < hist.length; i++) sum += (1000 / (hist[i] - hist[i-1]));
      fps = sum / (hist.length - 1);
    }
    var frt = hist.length > 1 ? (hist[hist.length-1] - hist[hist.length-2]) : 0;

    // CPU Load %: fraction of frame spent in _update / total frame time
    var cpuLoad = 0;
    if (this._perfFrameStart > 0 && this._perfUpdateEnd > 0){
      var frameElapsed = now - this._perfFrameStart;
      var updateElapsed = this._perfUpdateEnd - this._perfFrameStart;
      cpuLoad = frameElapsed > 0 ? Math.min(100, Math.round((updateElapsed / frameElapsed) * 100)) : 0;
    }

    // GPU Load %: rough estimate based on raf-to-draw timing
    var gpuLoad = 0;
    var samples = this._perfGpuLoadSamples;
    if (samples.length > 0){
      var gSum = 0;
      for (var si = 0; si < samples.length; si++) gSum += samples[si];
      gpuLoad = Math.min(100, Math.round(gSum / samples.length));
      samples.length = 0;
    }

    // Memory
    var memUsed = 0, memTotal = 0, memLimit = 0, memPct = 0;
    if (self.performance && self.performance.memory){
      memUsed = (performance.memory.usedJSHeapSize / 1048576).toFixed(1);
      memTotal = (performance.memory.totalJSHeapSize / 1048576).toFixed(1);
      memLimit = (performance.memory.jsHeapSizeLimit / 1048576).toFixed(1);
      memPct = (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit * 100).toFixed(1);
    }

    // Ping
    var pingStr = 'N/A (offline)';
    if (this.mode === 'host' || this.mode === 'client'){
      try {
        if (typeof Net !== 'undefined' && Net.peer && Net.peer._lastPing){
          pingStr = Math.round(Net.peer._lastPing) + ' ms';
        }
      } catch(e){}
    }

    // Write DOM (3/sec — safe)
    document.getElementById('perf-row-fps').textContent =
      'FPS        ' + fps.toFixed(1) + (fps >= 55 ? '  ✓' : fps >= 30 ? '  ⚠' : '  ✗');
    document.getElementById('perf-row-frametime').textContent =
      'Frame time ' + frt.toFixed(1) + ' ms';
    document.getElementById('perf-row-ping').textContent =
      'Ping       ' + pingStr;
    document.getElementById('perf-row-mem-used').textContent =
      'Heap used  ' + memUsed + ' MB';
    document.getElementById('perf-row-mem-total').textContent =
      'Heap total ' + memTotal + ' MB';
    document.getElementById('perf-row-mem-pct').textContent =
      'Heap load  ' + memPct + ' %  (limit ' + memLimit + ' MB)';
    document.getElementById('perf-row-cpu').textContent =
      'CPU load   ' + cpuLoad + ' %';
    document.getElementById('perf-row-gpu-load').textContent =
      'GPU load   ' + gpuLoad + ' %  (est.)';

    // Performance rating
    var ratingEl = document.getElementById('perf-row-rating');
    if (fps > 55 && frt < 18){
      ratingEl.innerHTML = '<span style="color:#0f0">PERFORMANCE: EXCELLENT  (Smooth gameplay)</span>';
    } else if (fps >= 30){
      ratingEl.innerHTML = '<span style="color:#ff0">PERFORMANCE: GOOD  (Stable but limited)</span>';
    } else if (fps > 0){
      ratingEl.innerHTML = '<span style="color:#f44">PERFORMANCE: POOR  (Bottleneck detected! Check instancing/grass density)</span>';
    } else {
      ratingEl.innerHTML = '<span style="color:#888">PERFORMANCE: —  (gathering data)</span>';
    }
  }

  _initPhysics(){
    try {
      if(typeof RAPIER === 'undefined') return;
      this.physicsWorld = new RAPIER.World({x:0, y:-20, z:0});
      this._eventQueue = new RAPIER.EventQueue(false);
      // Ground body
      var gDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
      var gBody = this.physicsWorld.createRigidBody(gDesc);
      var gCol = this.physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(160, 0.5, 160), gBody);
      if(gCol && typeof gCol.setActiveEvents === 'function') gCol.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      gCol.userData = {type:'ground'};
      this._physBodies.push(gBody);
      // Wall colliders
      if(this.world && this.world.walls){
        for(const w of this.world.walls){
          try {
            var wDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(w.x, 0.5, w.z);
            var wBody = this.physicsWorld.createRigidBody(wDesc);
            var wCol = this.physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(w.w/2, 5.0, w.d/2), wBody);
            if(wCol && typeof wCol.setActiveEvents === 'function') wCol.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
            wCol.userData = {type:'wall'};
            this._physBodies.push(wBody);
          } catch(e2){}
        }
      }
    } catch(e){ console.warn('Rapier init:', e); }
  }

  /* Rapier collision event handler (compat: drainCollisionEvents gives
     collider handles, resolved back to wrappers via getCollider) */
  _onCollision(c1Handle, c2Handle){
    if(!this.physicsWorld) return;
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
    this.camMode = s.camMode || 'arrows';
    if(this.input){
      this.input.binds = s.binds;
      this.input.settings = s;
      this.input.resetCamSwipe();
    }
    this.refreshAimLineStyle();
    this.refreshViewRangeStyle();
    this.refreshViewRangeWidth();
    this.applyGraphicsSettings();
    this.camAngle = Math.PI + (s.camRotation || 0);
  }

  applyGraphicsSettings(){
    const q = this.settings.graphicsQuality;
    this.isFancy = q === 'fancy';
    this.renderer.shadowMap.enabled = true;
    this._maxPixelRatio = Math.min(devicePixelRatio, this.isFancy ? 2 : 1.5);
    this.renderer.setPixelRatio(this._maxPixelRatio);
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
      if(!m && typeof DEFAULT_MAP !== 'undefined' && DEFAULT_MAP) m = DEFAULT_MAP;
      if(m) this.world.loadCustomMapData(m);
    } catch(e){ console.warn('Map load error:', e); }
    try {
      this._spawnLocal();
      for(let i=0;i<20;i++) this._spawnBot();
      this._spawnDummy();
    } catch(e){ console.warn('Spawn error:', e); }
    if(window.Menu && Menu.bumpStat) Menu.bumpStat('battles', 1);
    this._begin();
  }

  /* ---------- GLADIATOR (battle royale, SP) ---------- */
  startGladiator(){
    this.mode='sp'; this._resetArena();
    try {
      var m = this._useCustomMap ? loadCustomMap() : null;
      if(!m && typeof GLADIATOR_MAP !== 'undefined' && GLADIATOR_MAP) m = GLADIATOR_MAP;
      if(!m) m = loadMainMap();
      if(!m && typeof DEFAULT_MAP !== 'undefined' && DEFAULT_MAP) m = DEFAULT_MAP;
      if(m) this.world.loadCustomMapData(m);
    } catch(e){ console.warn('Map load error:', e); }
    const cfg = GAMEMODES.gladiator;
    const spawns = this._gladSpawnList();
    this._initGladiator();
    const localSp = spawns.length ? spawns.shift() : this.world.randomSpawn();
    this._spawnLocal(localSp.x, localSp.z, localSp.ry);
    for(let i=0;i<cfg.botCount;i++){
      const sp = spawns.length ? spawns.shift() : this.world.randomSpawn();
      this._spawnBot(sp.x, sp.z, sp.ry);
    }
    if(window.Menu && Menu.bumpStat) Menu.bumpStat('battles', 1);
    this._begin();
  }

  _gladSpawnList(){
    let pts = (this.world.spawnPoints && this.world.spawnPoints.gladiator) ? this.world.spawnPoints.gladiator.slice() : [];
    pts = pts.filter(p => !this.world._inLake(p.x, p.z, 3) && !this.world.collides(p.x, p.z, 3));
    const hf = this.world.half;
    const h80 = Math.round(hf * 0.8), h37 = Math.round(hf * 0.37);
    const fallback = [
      {x:-h80,z:-h80},{x:h80,z:-h80},{x:-h80,z:h80},{x:h80,z:h80},
      {x:-h80,z:0},{x:h80,z:0},{x:0,z:-h80},{x:0,z:h80},
      {x:-h37,z:-h37},{x:h37,z:h37},
    ];
    const had = pts.length;
    for(let i=0;i<fallback.length && pts.length<10;i++){
      if(!pts.some(p => Math.hypot(p.x-fallback[i].x, p.z-fallback[i].z) < 12)){
        pts.push({x:fallback[i].x, z:fallback[i].z, ry:Math.random()*6});
      }
    }
    for(let i=pts.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=pts[i]; pts[i]=pts[j]; pts[j]=t; }
    if(had < 10 && pts.length < 10) Menu.toast('Map has only '+had+' gladiator spawn points — filling in corners');
    return pts.slice(0, 10);
  }

  _initGladiator(){
    const cfg = Object.assign({}, GAMEMODES.gladiator);
    // Scale the zone shrink to the world size so matches keep a sane length
    cfg.zone = Object.assign({}, cfg.zone, {
      chunk: Math.max(12, Math.round(this.world.half / 5)),
      minHalf: Math.round(this.world.half * 0.1),
    });
    this.glad = {
      cfg, stage:0,
      safeHalf: this.world.half, orangeHalf: null, phase:'grace', phaseTimer: cfg.zone.graceTime,
      alive:0, winner:null, ended:false,
      airdrop:null, airdropTimer: cfg.airdrop.firstDelay,
    };
    this._gladBoxes = [];
    this._gladPickups = [];
    
    // ZONE SYSTEM - CHUNK-BASED GRID
    this._gladZoneChunks = null;
    this._gladChunkMeshes = [];
    this._gladChunkOverlays = [];
    this._gladCorruptedChunks = new Set(); // chunks that have turned red
    this._gladNextCorruptionIndex = 0;
    this._gladChunkGlowTime = 0;
    
    // Zone ground overlay (canvas texture, regenerated on state change)
    this._gladZoneCanvas = document.createElement('canvas');
    this._gladZoneCanvas.width = this._gladZoneCanvas.height = 256;
    this._gladZoneTex = new THREE.CanvasTexture(this._gladZoneCanvas);
    const zmat = new THREE.MeshBasicMaterial({map:this._gladZoneTex, transparent:true, opacity:0.55, depthWrite:false});
    const zgeo = new THREE.PlaneGeometry(this.world.size, this.world.size);
    zgeo.rotateX(-Math.PI/2);
    this._gladZoneMesh = new THREE.Mesh(zgeo, zmat);
    this._gladZoneMesh.position.y = 0.06;
    this._gladZoneMesh.renderOrder = 5;
    this.scene.add(this._gladZoneMesh);
    
    // Initialize chunk grid for zone representation
    this._initGladChunkGrid();
    
    this._refreshGladZone();
    // Blue boxes placed via the map editor
    (this.world.blueBoxes || []).forEach(b => this._gladSpawnBox(b.x, b.z));
    const gh = document.getElementById('glad-hud');
    if(gh) gh.classList.remove('hidden');
  }

   _clearGladState(){
     this.glad = null;
     if(this._gladZoneMesh){ this.scene.remove(this._gladZoneMesh); this._gladZoneMesh.geometry.dispose(); this._gladZoneMesh.material.dispose(); this._gladZoneMesh = null; }
     if(this._gladZoneTex) this._gladZoneTex.dispose();
     this._gladBoxes.forEach(b => { if(b.mesh){ this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); } });
     this._gladBoxes = [];
     this._gladPickups.forEach(p => { if(p.mesh){ this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); } });
     this._gladPickups = [];
     this._gladClearAirdropVisuals();
     
     // Clean up chunk system
     if(this._gladChunkMeshes){
       this._gladChunkMeshes.forEach(mesh => {
         if(mesh){ this.scene.remove(mesh); if(mesh.geometry) mesh.geometry.dispose(); if(mesh.material) mesh.material.dispose(); }
       });
       this._gladChunkMeshes = [];
     }
     if(this._gladChunkOverlays){
       this._gladChunkOverlays.forEach(overlay => {
         if(overlay){ this.scene.remove(overlay); if(overlay.geometry) overlay.geometry.dispose(); if(overlay.material) overlay.material.dispose(); }
       });
       this._gladChunkOverlays = [];
     }
     this._gladZoneChunks = null;
     this._gladCorruptedChunks.clear();
     this._gladNextCorruptionIndex = 0;
     this._gladChunkGlowTime = 0;
     if(this._gladZoneCanvas){
       this._gladZoneCanvas.width = this._gladZoneCanvas.height = 256;
       if(this._gladZoneTex) this._gladZoneTex.dispose();
       this._gladZoneTex = new THREE.CanvasTexture(this._gladZoneCanvas);
     }
     
     const gh = document.getElementById('glad-hud');
     if(gh) gh.classList.add('hidden');
     const gb = document.getElementById('glad-banner');
     if(gb) gb.classList.add('hidden');
     const gr = document.getElementById('glad-result');
     if(gr) gr.classList.add('hidden');
   }

  _gladClearAirdropVisuals(){
    if(this._gladAirBeam){ this.scene.remove(this._gladAirBeam); this._gladAirBeam.geometry.dispose(); this._gladAirBeam.material.dispose(); this._gladAirBeam = null; }
    if(this._gladAirCrate){ this.scene.remove(this._gladAirCrate); this._gladAirCrate.geometry.dispose(); this._gladAirCrate.material.dispose(); this._gladAirCrate = null; }
    if(this._gladAirRing){ this.scene.remove(this._gladAirRing); this._gladAirRing.geometry.dispose(); this._gladAirRing.material.dispose(); this._gladAirRing = null; }
  }

  _gladSpawnBox(x, z, id){
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 2.4, 2.4),
      new THREE.MeshStandardMaterial({color:0x2299ff, emissive:0x0a4a7a, emissiveIntensity:0.25, roughness:0.4, metalness:0.4})
    );
    mesh.position.set(x, 1.2, z);
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    this._gladBoxIdSeq = (this._gladBoxIdSeq || 0) + 1;
    const box = { id: id || ('gb'+this._gladBoxIdSeq), x, z, hp:30, alive:true, mesh };
    this._gladBoxes.push(box);
    return box;
  }

  _gladDropPickup(x, z, power){
    const grp = new THREE.Group();
    const bm = new THREE.MeshStandardMaterial({color:0x2a7fff, emissive:0x1a5fdd, emissiveIntensity:0.8, roughness:0.3});
    const seg1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.85, 0.14), bm);
    const seg2 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.7, 0.14), bm);
    seg1.position.y = 0.3;
    seg2.position.set(0.08, -0.3, 0); seg2.rotation.z = 0.55;
    grp.add(seg1, seg2);
    grp.position.set(x, 1.15, z);
    this.scene.add(grp);
    this._gladPickups.push({ x, z, power, type:'power', mesh:grp, phase:Math.random()*6.28 });
    return this._gladPickups[this._gladPickups.length-1];
  }

  _gladBoxHit(shell){
    if(!this._gladBoxes) return false;
    for(const b of this._gladBoxes){
      if(!b.alive) continue;
      const dx = shell.x - b.x, dz = shell.z - b.z;
      const rr = 1.7 + (shell.radius || 0.4);
      if(dx*dx + dz*dz < rr*rr){
        b.hp -= shell.damage;
        this.spawnExplosion(b.x, 1.5, b.z, 0x44ccff, 6);
        if(b.hp <= 0){
          b.alive = false;
          if(b.mesh){ this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); b.mesh = null; }
          this._gladDropPickup(b.x, b.z, GAMEMODES.gladiator.power.box);
          if(shell.owner === this.localTank) Menu.toast('\u26A1 Blue box destroyed! +5 power dropped');
        }
        return true;
      }
    }
    return false;
  }

  _inGladRed(x, z){
    const g = this.glad;
    if(!g) return false;
    const h = g.safeHalf;
    if(h <= 0) return true;
    return Math.abs(x) > h || Math.abs(z) > h;
  }

   _initGladChunkGrid(){
     const g = this.glad;
     const cfg = g.cfg;
     const zoneHalf = this.world.half;
     const chunkSize = cfg.zone.chunk;
     
     // Create a chunk grid covering the entire map
     // Each chunk is a rectangle of the map grid
     const chunkGridSize = Math.ceil(zoneHalf / chunkSize) + 1;
     
     this._gladZoneChunks = [];
     for(let gx = -chunkGridSize; gx <= chunkGridSize; gx++){
       for(let gz = -chunkGridSize; gz <= chunkGridSize; gz++){
         const cx = gx * chunkSize;
         const cz = gz * chunkSize;
         // Check if this chunk is within the world
         if(this.world._inLake(cx, cz, 1) || this.world.collidesWallsOnly(cx, cz, 1)) continue;
         this._gladZoneChunks.push({
           x: cx, z: cz,
           id: gx + ',' + gz,
           state: 'grace', // 'grace' | 'orange' | 'red'
           glowTime: 0,
           edgeDist: Infinity,
         });
       }
     }
     // Track which chunks are close to player for countdown
     this._gladPlayerChunkDist = null;
   }

   _refreshGladZone(){
     if(!this._gladZoneMesh || !this._gladZoneCanvas) return;
     const g = this.glad, ctx = this._gladZoneCanvas.getContext('2d'), S = this._gladZoneCanvas.width;
     const scale = S / this.world.size;
     const toPx = (v) => S/2 + v * scale;
     ctx.clearRect(0, 0, S, S);
     if(g.phase === 'grace'){ this._gladZoneMesh.visible = false; return; }
     this._gladZoneMesh.visible = true;
     // Draw zone boundaries and chunk overlays
     this._drawGladZone();
     this._gladZoneTex.needsUpdate = true;
   }

   _drawGladZone(){
     const g = this.glad;
     if(!g || g.phase === 'grace') return;
     const ctx = this._gladZoneCanvas.getContext('2d');
     const S = this._gladZoneCanvas.width;
     const scale = S / this.world.size;
     const toPx = (v) => S/2 + v * scale;
     const safeHalf = Math.max(0, g.safeHalf);
     
     // Draw the zone boundary (green line for orange, red line for red)
     const isRed = g.phase === 'red';
     const zoneColor = isRed ? [255, 40, 40] : [255, 165, 0];
     const zoneAlpha = isRed ? 0.95 : 0.75;
     
     ctx.strokeStyle = `rgba(${zoneColor[0]},${zoneColor[1]},${zoneColor[2]},${zoneAlpha})`;
     ctx.lineWidth = Math.max(3, S * 0.008);
     
     // Draw zone edge
     const sh = Math.max(0, safeHalf);
     const sX = toPx(-sh), sW = Math.max(1, toPx(sh) - sX);
     ctx.strokeRect(sX, sX, sW, sW);
     
     // Draw glow outline for zone
     ctx.strokeStyle = `rgba(${zoneColor[0]},${zoneColor[1]},${zoneColor[2]},0.3)`;
     ctx.lineWidth = Math.max(5, S * 0.02);
     ctx.strokeRect(sX, sX, sW, sW);
     
     // Draw chunk overlays
     for(const chunk of this._gladZoneChunks){
       const cx = toPx(chunk.x);
       const cz = toPx(chunk.z);
       // Check if chunk is in current zone
       const inZone = this._gladChunkInZone(chunk);
       const isRed = inZone && (g.phase === 'red');
       const isOrange = inZone && (g.phase === 'orange');
       
       if(inZone && !isRed){
         // Orange zone - draw chunk with orange indicator
         ctx.fillStyle = 'rgba(255,165,0,0.15)';
         ctx.fillRect(cx - 3, cz - 3, 6, 6);
         // Add glow
         ctx.fillStyle = 'rgba(255,165,0,0.4)';
         ctx.fillRect(cx - 6, cz - 6, 12, 12);
       } else if(inZone && isRed){
         // Red zone - draw chunk with red glowing X
         // Glow outline
         ctx.fillStyle = 'rgba(255,40,40,0.25)';
         ctx.fillRect(cx - 3, cz - 3, 6, 6);
         ctx.fillStyle = 'rgba(255,40,40,0.5)';
         ctx.fillRect(cx - 6, cz - 6, 12, 12);
         // Glowing X mark
         this._drawGlowX(ctx, cx, cz, 12, 16, isRed);
       } else {
         // Outside zone
         ctx.fillStyle = 'rgba(0,0,0,0.1)';
         ctx.fillRect(cx - 3, cz - 3, 6, 6);
       }
     }
   }

   _drawGlowX(ctx, cx, cz, size, gap, isRed){
     // Draw a glowing X mark in the center of each chunk
     const lineThickness = isRed ? 4 : 3;
     ctx.strokeStyle = isRed ? '#ff0000' : '#ff8800';
     ctx.lineWidth = lineThickness;
     ctx.lineCap = 'round';
     
     const s = gap;
     ctx.beginPath();
     ctx.moveTo(cx - s, cz - s);
     ctx.lineTo(cx + s, cz + s);
     ctx.moveTo(cx + s, cz - s);
     ctx.lineTo(cx - s, cz + s);
     ctx.stroke();
     
     // Glow effect
     ctx.strokeStyle = isRed ? 'rgba(255,0,0,0.2)' : 'rgba(255,140,0,0.2)';
     ctx.lineWidth = lineThickness + 4;
     ctx.stroke();
   }

   _gladChunkInZone(chunk){
     const g = this.glad;
     if(!g) return false;
     const h = Math.max(0, g.safeHalf);
     // Chunk center is at (chunk.x, chunk.z) which is in world coordinates
     // The zone is a square from -h to h
     return Math.abs(chunk.x) <= h && Math.abs(chunk.z) <= h;
   }

_gladZoneNotice(text){
     Menu.toast(text);
   }

   _drawCountdownPlaceholder(ctx, x, z, orangeHalf){
     const g = this.glad;
     if(!g || !this.localTank || !this.localTank.alive) return;
     
     const S = this._gladZoneCanvas.width;
     const scale = S / this.world.size;
     const px = S/2 + x * scale;
     const pz = S/2 + z * scale;
     const radius = Math.max(8, (orangeHalf - g.safeHalf) * scale * 0.4);
     const countdown = Math.max(0, g.phaseTimer);
     const seconds = Math.ceil(countdown);
     
     // Orange ring
     ctx.beginPath();
     ctx.arc(px, pz, radius, 0, Math.PI * 2);
     ctx.strokeStyle = 'rgba(255,165,0,0.9)';
     ctx.lineWidth = 3;
     ctx.stroke();
     
     // Inner red fill
     ctx.beginPath();
     ctx.arc(px, pz, radius - 4, 0, Math.PI * 2);
     ctx.fillStyle = 'rgba(255,40,40,0.5)';
     ctx.fill();
     
     // Countdown number
     ctx.fillStyle = 'rgba(255,255,255,0.95)';
     ctx.font = 'bold 14px Arial';
     ctx.textAlign = 'center';
     ctx.textBaseline = 'middle';
     ctx.fillText(seconds, px, pz);
   }

   _gladSpawnForNew(){
    const pts = this._gladSpawnList();
    const taken = this.tanks.filter(t=>t.alive).map(t=>({x:t.x, z:t.z}));
    let best = null, bestD = -1;
    for(const p of pts){
      let minD = Infinity;
      for(const tk of taken){ const d = Math.hypot(p.x-tk.x, p.z-tk.z); if(d<minD) minD = d; }
      if(minD > bestD){ bestD = minD; best = p; }
    }
    return best || {x:0, z:0, ry:0};
  }

  /* ---------- GLADIATOR per-frame engine ---------- */
  _gladUpdate(dt){
    if(this._matchStartDelay > 0) return;
    const g = this.glad;
    if(!g || g.ended) return;
    const cfg = g.cfg;

    // Zone stage machine: grace -> orange (warning) -> corruption -> red -> shrink -> orange...
    g.phaseTimer -= dt;
    if(g.phase === 'grace' && g.phaseTimer <= 0){
      g.phase = 'orange';
      g.orangeHalf = this.world.half;
      g.phaseTimer = cfg.zone.stageTime;
      this._refreshGladZone();
      Menu.toast('Zone incoming!');
    } else if(g.phase === 'orange' && g.phaseTimer <= 0){
      g.corruptionTimer = 0;
      let next = g.safeHalf - cfg.zone.chunk;
      if(next < cfg.zone.minHalf) next = (g.safeHalf <= cfg.zone.minHalf) ? cfg.zone.finalHalf : cfg.zone.minHalf;
      g.safeHalf = Math.max(0, next);
      g.orangeHalf = g.safeHalf + cfg.zone.chunk;
      g.stage++;
      g.phaseTimer = cfg.zone.stageTime;
      this._refreshGladZone();
      Menu.toast('Zone shrinking!');
    }

    // Corruption phase: one chunk at a time from edges, one by one
    if(g.phase === 'orange' && g.corruptionTimer <= 0){
      // Start corrupting
      g.corruptionTimer = 5; // 5 seconds before corruption starts
    }

    // Update corruption state
    if(g.phase === 'orange'){
      g.corruptionTimer -= dt;
      if(g.corruptionTimer <= 0){
        // Corrupt one random edge chunk
        const edgeChunks = this._gladZoneChunks.filter(c =>
          Math.abs(c.x) >= g.safeHalf - this.glad.cfg.zone.chunk ||
          Math.abs(c.z) >= g.safeHalf - this.glad.cfg.zone.chunk
        );
        if(edgeChunks.length > 0){
          // Random order corruption
          const idx = Math.floor(Math.random() * edgeChunks.length);
          const chunk = edgeChunks[idx];
          chunk.state = 'red';
          chunk.corruptionTime = 0;
          this._gladCorruptedChunks.add(chunk.id);
          this._refreshGladZone();
          Menu.toast('Zone shifting...');
        }
      }
    }

    // Countdown placeholder: show orange zone hint at player's edge location
    if(g.phase === 'orange' && this.localTank && this.localTank.alive){
      const orangeHalf = g.orangeHalf;
      let px = this.localTank.x, pz = this.localTank.z;
      
      // Project to orange zone boundary: find the nearest point on orange boundary
      if(px > -orangeHalf && px < orangeHalf && pz > -orangeHalf && pz < orangeHalf){
        // Inside orange zone, push to boundary
        const distX = orangeHalf - Math.abs(px);
        const distZ = orangeHalf - Math.abs(pz);
        if(distX < distZ) px = (px >= 0 ? orangeHalf : -orangeHalf);
        else pz = (pz >= 0 ? orangeHalf : -orangeHalf);
      } else {
        // Outside orange zone - find nearest point on boundary rectangle
        const closestX = Math.max(-orangeHalf, Math.min(orangeHalf, px));
        const closestZ = Math.max(-orangeHalf, Math.min(orangeHalf, pz));
        px = closestX;
        pz = closestZ;
      }
      
// Find which chunk this placeholder is in (chunk size available for future use)
      // const chunkX = Math.round(px / chunkSize) * chunkSize;
      // const chunkZ = Math.round(pz / chunkSize) * chunkSize;
      
      // Display countdown for this chunk area
      this._drawCountdownPlaceholder(ctx, px, pz, orangeHalf);
    }

    // Handle red zone chunks: update corruption time and apply damage visuals
    if(g.phase === 'orange' || g.phase === 'red'){
      for(const chunk of this._gladZoneChunks){
        if(chunk.state === 'red'){
          chunk.corruptionTime += dt;
          // Red chunks glow more as they "corrupt"
          const glowIntensity = Math.min(1, chunk.corruptionTime / 30);
          ctx.fillStyle = `rgba(255,40,40,${0.25 + glowIntensity * 0.3})`;
          ctx.fillRect(
            toPx(chunk.x) - 3,
            toPx(chunk.z) - 3,
            6, 6
          );
        }
      }
    }

    // Red zone damage (10 HP/s while outside the safe square)
    if(g.phase !== 'grace'){
      for(const t of this.tanks){
        if(!t.alive || t.dying || t.isDummy) continue;
        if(this._inGladRed(t.x, t.z)){
          t.takeDamage(cfg.redDps * dt, null, this, true);
          if(t.alive && !t.dying) this.spawnExplosion(t.x, 0.5, t.z, 0xff3030, 2);
        }
      }
    }

    // Airdrops
    g.airdropTimer -= dt;
    if(!g.airdrop && g.airdropTimer <= 0){
      g.airdrop = this._gladSpawnAirdrop();
      g.airdropTimer = cfg.airdrop.interval;
      Menu.toast('Airdrop incoming!');
    } else if(g.airdrop){
      if(!g.airdrop.landed){
        g.airdrop.countdown -= dt;
        if(this._gladAirBeam){
          this._gladAirBeam.material.opacity = 0.25 + 0.2 * Math.sin(this.time * 5);
        }
        if(g.airdrop.countdown <= 0){
          g.airdrop.landed = true;
          g.airdrop.life = 60;
          Menu.toast('Airdrop landed — stand inside the blue circle!');
        }
      } else {
        g.airdrop.life -= dt;
        if(g.airdrop.life <= 0){
          this._gladClearAirdropVisuals();
          this._gladDropPickup(g.airdrop.x, g.airdrop.z, cfg.power.airdrop);
          Menu.toast('Airdrop expired — power dropped as pickup');
          g.airdrop = null;
        } else {
          for(const t of this.tanks){
            if(!t.alive || t.dying || t.isDummy) continue;
            const d = Math.hypot(t.x - g.airdrop.x, t.z - g.airdrop.z);
            if(d < 4.5){
              t._gladHoldTime = (t._gladHoldTime || 0) + dt;
              if(t === this.localTank) g.airdrop.localHold = t._gladHoldTime;
              if(t._gladHoldTime >= cfg.airdrop.holdTime){
                t.applyPower(cfg.power.airdrop, this);
                if(t === this.localTank) Menu.toast('Airdrop secured! +40 power');
                else if(g.winner && t === g.winner) Menu.toast('The winner grabbed the airdrop!');
                this.tanks.forEach(x=>{ x._gladHoldTime = 0; });
                this._gladClearAirdropVisuals();
                g.airdrop = null;
                break;
              }
            }
          }
        }
      }
    }

    // Shared power pickups: spin + collect (host-authoritative; any tank can grab)
    for(let i = this._gladPickups.length - 1; i >= 0; i--){
      const p = this._gladPickups[i];
      p.phase = (p.phase || 0) + dt * 3;
      if(p.mesh){
        p.mesh.rotation.y = p.phase;
        p.mesh.position.y = 1.15 + Math.sin(p.phase * 1.4) * 0.12;
      }
      for(const t of this.tanks){
        if(!t.alive || t.dying || t.isDummy) continue;
        const d = Math.hypot(t.x - p.x, t.z - p.z);
        if(d < 2.6){
          t.applyPower(p.power, this);
          if(t === this.localTank) Menu.toast('+' + p.power + ' power!');
          if(p.mesh){
            this.scene.remove(p.mesh);
            p.mesh.children.forEach(c => { c.geometry.dispose(); c.material.dispose(); });
          }
          this._gladPickups.splice(i, 1);
          break;
        }
      }
    }

    // Blue boxes idle pulse
    for(const b of this._gladBoxes){
      if(b.alive && b.mesh){
        b.mesh.rotation.y += dt * 0.6;
        b.mesh.position.y = 1.2 + Math.sin(this.time * 2 + b.x) * 0.06;
      }
    }

    // Alive count & win check
    const alive = this.tanks.filter(t => t.alive && !t.dying && !t.isDummy);
    g.alive = alive.length;
    if(!g.winner && alive.length === 1){
      g.winner = alive[0];
      g.ended = true;
      this._gladAwardClanXP();
      this._gladShowResult(false);
    } else if(!g.winner && alive.length === 0){
      g.ended = true;
      this._gladAwardClanXP();
      this._gladShowResult(false);
    }
  }

  _gladSpawnAirdrop(){
    const cfg = this.glad.cfg;
    const half = Math.max(12, this.glad.safeHalf - 10);
    let x = 0, z = 0, tries = 0;
    do {
      x = (Math.random() * 2 - 1) * half;
      z = (Math.random() * 2 - 1) * half;
      tries++;
    } while(tries < 40 && (this.world._inLake(x, z, 4) || this.world.collidesWallsOnly(x, z, 5)));
    const geo = new THREE.CylinderGeometry(3.2, 3.2, 260, 20, 1, true);
    geo.translate(0, 130, 0);
    const mat = new THREE.MeshBasicMaterial({color:0x00ddff, transparent:true, opacity:0.35, depthWrite:false});
    this._gladAirBeam = new THREE.Mesh(geo, mat);
    this._gladAirBeam.position.set(x, 0, z);
    this.scene.add(this._gladAirBeam);
    return { x, z, countdown: cfg.airdrop.countdown, hold: cfg.airdrop.holdTime, landed:false, life:0, localHold:0 };
  }

  _gladSnapshot(){
    const g = this.glad;
    if(!g) return null;
    return {
      stage: g.stage,
      safeHalf: g.safeHalf,
      orangeHalf: g.orangeHalf,
      phase: g.phase,
      phaseTimer: g.phaseTimer,
      alive: g.alive,
      winner: g.winner ? g.winner.id : null,
      ended: !!g.ended,
      airdropTimer: g.airdropTimer,
      airdrop: g.airdrop ? {
        x: g.airdrop.x, z: g.airdrop.z,
        countdown: g.airdrop.countdown, landed: g.airdrop.landed,
        life: g.airdrop.life, hold: g.airdrop.hold
      } : null,
      boxes: this._gladBoxes.filter(b => b.alive).map(b => ({id: b.id, x: b.x, z: b.z, hp: b.hp})),
      pickups: this._gladPickups.map(p => ({x: p.x, z: p.z, power: p.power})),
    };
  }

  _gladApplyHostSnapshot(gs){
    const cfg = GAMEMODES.gladiator;
    if(!this.glad){
      this.glad = {
        cfg, stage:0, safeHalf:this.world.half, orangeHalf:null, phase:'grace', phaseTimer:0,
        alive:0, winner:null, winnerId:null, ended:false, airdrop:null, airdropTimer:0, _client:true,
      };
      this._gladBoxes = [];
      this._gladPickups = [];
      this._gladZoneCanvas = document.createElement('canvas');
      this._gladZoneCanvas.width = this._gladZoneCanvas.height = 256;
      this._gladZoneTex = new THREE.CanvasTexture(this._gladZoneCanvas);
      const zmat = new THREE.MeshBasicMaterial({map:this._gladZoneTex, transparent:true, opacity:0.9, depthWrite:false});
      const zgeo = new THREE.PlaneGeometry(this.world.size, this.world.size);
      zgeo.rotateX(-Math.PI/2);
      this._gladZoneMesh = new THREE.Mesh(zgeo, zmat);
      this._gladZoneMesh.position.y = 0.06;
      this._gladZoneMesh.renderOrder = 5;
      this.scene.add(this._gladZoneMesh);
      const gh = document.getElementById('glad-hud');
      if(gh) gh.classList.remove('hidden');
    }
    const g = this.glad;
    const prevEnded = g.ended;
    g.stage = gs.stage;
    g.safeHalf = gs.safeHalf;
    g.orangeHalf = gs.orangeHalf;
    g.phase = gs.phase;
    g.phaseTimer = gs.phaseTimer;
    g.alive = gs.alive;
    g.winnerId = gs.winner;
    g.ended = !!gs.ended;
    g.airdropTimer = gs.airdropTimer;
    if(gs.airdrop){
      if(!g.airdrop){
        g.airdrop = {x:0, z:0, countdown:0, landed:false, life:0, hold:0, localHold:0};
        const geo = new THREE.CylinderGeometry(3.2, 3.2, 260, 20, 1, true);
        geo.translate(0, 130, 0);
        const mat = new THREE.MeshBasicMaterial({color:0x00ddff, transparent:true, opacity:0.35, depthWrite:false});
        this._gladAirBeam = new THREE.Mesh(geo, mat);
        this._gladAirBeam.position.set(gs.airdrop.x, 0, gs.airdrop.z);
        this.scene.add(this._gladAirBeam);
      } else if(this._gladAirBeam && g.airdrop.landed !== gs.airdrop.landed){
        this._gladAirBeam.material.opacity = 0.4;
      }
      g.airdrop.x = gs.airdrop.x;
      g.airdrop.z = gs.airdrop.z;
      g.airdrop.countdown = gs.airdrop.countdown;
      const wasLanded = g.airdrop.landed;
      g.airdrop.landed = gs.airdrop.landed;
      g.airdrop.life = gs.airdrop.life;
      g.airdrop.hold = gs.airdrop.hold;
      if(this._gladAirBeam){
        this._gladAirBeam.position.set(gs.airdrop.x, 0, gs.airdrop.z);
        if(wasLanded && !gs.airdrop.landed) this._gladAirBeam.material.opacity = 0.3;
      }
    } else if(g.airdrop){
      g.airdrop = null;
      this._gladClearAirdropVisuals();
    }
    // Blue boxes: reconcile meshes with snapshot
    const want = new Set((gs.boxes || []).map(b => b.id));
    for(let i = this._gladBoxes.length - 1; i >= 0; i--){
      if(!want.has(this._gladBoxes[i].id)){
        const b = this._gladBoxes[i];
        if(b.mesh){ this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
        this._gladBoxes.splice(i, 1);
      }
    }
    (gs.boxes || []).forEach(sb => {
      let b = this._gladBoxes.find(x => x.id === sb.id);
      if(!b){
        b = this._gladSpawnBox(sb.x, sb.z, sb.id);
      }
      b.x = sb.x; b.z = sb.z; b.hp = sb.hp; b.alive = true;
    });
    // Pickups
    for(let i = this._gladPickups.length - 1; i >= 0; i--){
      const p = this._gladPickups[i];
      if(p.mesh){
        this.scene.remove(p.mesh);
        p.mesh.children.forEach(c => { c.geometry.dispose(); c.material.dispose(); });
      }
      this._gladPickups.splice(i, 1);
    }
    (gs.pickups || []).forEach(sp => this._gladDropPickup(sp.x, sp.z, sp.power));
    // Zone overlay texture is static (client-side red/green approximation is fine;
    // the authoritative visual comes from safeHalf) — regenerate cheap canvas
    this._refreshGladZoneClient();
    // End-of-match notification
    if(!prevEnded && g.ended){
      this._gladShowResult(false);
    }
  }

  _refreshGladZoneClient(){
    this._refreshGladZone();
  }

  _gladZoneNotice(text){
    Menu.toast(text);
  }

  _gladShowResult(eliminated){
    const el = document.getElementById('glad-result');
    if(!el) return;
    const g = this.glad;
    if(!g) return;
    // The result overlay must always sit on top: close any ESC menu first
    const esc = document.getElementById('esc-menu');
    if(esc) esc.classList.add('hidden');
    if(window.Menu) Menu.escOpen = false;
    const txtEl = document.getElementById('glad-result-text');
    if(eliminated){
      if(g._elimShown) return;
      g._elimShown = true;
      if(txtEl) txtEl.textContent = 'ELIMINATED — you placed #' + (this.localTank ? (this.localTank.placement || '?') : '?');
      el.classList.remove('hidden');
      const watchBtn = document.getElementById('glad-watch-btn');
      if(watchBtn) watchBtn.classList.remove('hidden');
    } else {
      if(g._finalShown) return;
      g._finalShown = true;
      let winner = g.winner;
      if(!winner && g.winnerId) winner = this.tanks.find(t => t.id === g.winnerId) || null;
      let txt = 'MATCH OVER';
      if(winner === this.localTank){
        txt = 'VICTORY! Last tank standing!';
        if(window.Menu && Menu.bumpStat) Menu.bumpStat('wins', 1);
      }
      else if(winner) txt = 'WINNER: ' + winner.name;
      else if(g.winnerId) txt = 'MATCH OVER';
      if(txtEl) txtEl.textContent = txt;
      el.classList.remove('hidden');
      const watchBtn = document.getElementById('glad-watch-btn');
      if(watchBtn) watchBtn.classList.add('hidden');
    }
  }

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
      if(!m && cfg.gamemode === 'gladiator' && typeof GLADIATOR_MAP !== 'undefined' && GLADIATOR_MAP) m = GLADIATOR_MAP;
      if(!m) m = loadMainMap();
      if(!m && typeof DEFAULT_MAP !== 'undefined' && DEFAULT_MAP) m = DEFAULT_MAP;
      if(m) this.world.loadCustomMapData(m);
    } catch(e){ console.warn('Map load error:', e); }
    if(cfg.gamemode === 'gladiator'){
      const spawns = this._gladSpawnList();
      this._initGladiator();
      const localSp = spawns.length ? spawns.shift() : this.world.randomSpawn();
      this._spawnLocal(localSp.x, localSp.z, localSp.ry);
      for(let i=0;i<cfg.fakePlayers;i++){
        const sp = spawns.length ? spawns.shift() : this.world.randomSpawn();
        this._spawnBot(sp.x, sp.z, sp.ry);
      }
    } else {
      this._spawnLocal();
      // fake players (bots)
      for(let i=0;i<cfg.fakePlayers;i++) this._spawnBot();
    }
    
    // Network callbacks
    Net.onPlayerJoin = (info)=> this._onClientJoin(info);
    Net.onPlayerLeave = (peerId)=> this._onClientLeave(peerId);
    Net.onInput = (peerId, inp)=> { this.clientTankInputs[peerId] = inp; };
    
    this._begin();
  }

  _onClientJoin(info){
    // info = {peerId, name, tank, color}
    const def = TANKS[info.tank] || TANKS.coolbuddy;
    const sp = this.glad ? this._gladSpawnForNew() : this.world.randomSpawn();
    const t = new Tank(def, {
      id:'remote-'+info.peerId,
      name: info.name || 'Player',
      ownerPeer: info.peerId,
      x: sp.x,
      z: sp.z,
      heading: sp.ry != null ? sp.ry : Math.random()*6,
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
      glad: this.glad ? this._gladSnapshot() : null,
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
    if(snap.glad) this._gladApplyHostSnapshot(snap.glad);
    
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
        this.localTank.placement = mySnap.pl || 0;
        this.localTank.power = mySnap.pw || 0;
        this.localTank._gladHoldTime = mySnap.gt || 0;
        if(this.localTank.setPowerFromSnapshot) this.localTank.setPowerFromSnapshot(mySnap.pw || 0);
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
        t.beginNetDriven();
      }
      const wasAlive = t.alive;
      t.applyNetSnapshot(s);
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
    this._clearGladState();
    this.tanks.forEach(t=>t.detach());
    this.projectiles.forEach(p=>p.detach());
    this.explosions.forEach(e=>e.detach());
    this.casings.forEach(c=>c.detach());
    if(this._strikeBombs){ this._strikeBombs.forEach(b=>{ this.scene.remove(b.mesh); if(b.mesh.geometry) b.mesh.geometry.dispose(); if(b.mesh.material) b.mesh.material.dispose(); }); this._strikeBombs = []; }
    if(this._oilPuddles){ this._oilPuddles.forEach(p=>{ this.scene.remove(p.mesh); if(p.mesh.material) p.mesh.material.dispose(); p.mesh.geometry.dispose(); }); this._oilPuddles = []; }
    if(this._panzerRing){ this._panzerRing.forEach(p=>this.scene.remove(p.mesh)); this._panzerRing = null; }
    this.tanks.forEach(t => { if(t._strikeRing) this.scene.remove(t._strikeRing); });
    this.tanks.forEach(t => { if(t.myBushes){ t.myBushes.forEach(b => this.world.removePlayerBush(b)); t.myBushes = []; } });
    this.tanks=[]; this.projectiles=[]; this.explosions=[];
    this.localTank=null; this.time=0;
    if(this._helixVideos){
      for(const [, hv] of this._helixVideos){
        hv.el.pause(); hv.el.currentTime = 0;
        if(hv.parent) hv.parent.remove(hv.mesh);
        hv.mesh.geometry.dispose();
        hv.mesh.material.dispose();
        hv.tex.dispose();
      }
      this._helixVideos.clear();
    }
    this._resetPhysics();
  }

  _resetPhysics(){
    this._physBodies.forEach(b=>{ try{ this.physicsWorld.removeRigidBody(b); }catch(e){} });
    this._physBodies = [];
    this._eventQueue = null;
    this.trailManager = new BulletTrailManager(this.scene, {
      maxTrails: 48, fadeTime: 0.18, width: 0.12, color: 0xffffff,
    });
    this._initPhysics();
  }

  _spawnLocal(px, pz, pheading){
    this.camAngle = Math.PI + (this.settings.camRotation || 0);
    const def = TANKS[this.settings.selectedTank] || TANKS.coolbuddy;
    const sp = (px != null && pz != null) ? {x:px, z:pz} : this.world.randomSpawn();
    const localId = this.mode === 'host' ? 'host-player' : 'local';
    const t = new Tank(def, {id:localId, name:this.settings.playerName, isLocal:true, x:sp.x, z:sp.z, heading:(pheading != null ? pheading : Math.random()*6), physicsWorld:this.physicsWorld});
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

  _spawnBot(px, pz, pheading){
    const ids = TANK_ORDER.filter(id=>id!==this.settings.selectedTank && id!=='tankdisplay' && id!=='dummy');
    if(!ids.length) return;
    const id = ids[Math.floor(Math.random()*ids.length)];
    const def = TANKS[id];
    if(!def) return;
    const sp = (px != null && pz != null) ? {x:px, z:pz} : this.world.randomSpawn();
    const t = new Tank(def, {id:'bot-'+Math.random().toString(36).slice(2,6), name:BOTNAMES[Math.floor(Math.random()*BOTNAMES.length)], isBot:true, x:sp.x, z:sp.z, heading:(pheading != null ? pheading : Math.random()*6), physicsWorld:this.physicsWorld});
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
    if(t.isLocal && t.hasSuper()){
      t._onBushSuper = () => this._deployBush(t);
    }
    return t;
  }

  _begin(){
    Menu.showHUD();
    document.getElementById('ui-layer').classList.add('game-active');
    this.running = true;
    this._last = performance.now();
    // Match start countdown (5s before play)
    this._matchStartDelay = 5;
    this._matchCdShown = false;
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
    var _mc = document.getElementById('match-cd');
    if(_mc) _mc.classList.add('hidden');
    this._matchStartDelay = 0; this._matchCdShown = false;
    if (this._perfOverlay) this._perfOverlay.style.display = 'none';
    if(Menu.escOpen) Menu.escOpen = false;
    Menu.show(window.__PLATOON_BATTLE ? 'menu-platoon' : 'menu-main');
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
    const rawDt = Math.max(0, (now - this._last)/1000) || 0;
    const dt = Math.min(0.05, rawDt);
    this._last = now;
    this._perfFrameStart = performance.now();

    // Push FPS sample (keep last 60)
    this._perfFpsHistory.push(now);
    if (this._perfFpsHistory.length > 60) this._perfFpsHistory.shift();

    if(this.running){
      // Match start countdown: freeze input for 5s
      if(this._matchStartDelay > 0){
        this._matchStartDelay -= rawDt;
        if(this._matchStartDelay <= 0){
          this._matchStartDelay = 0;
          var mc = document.getElementById('match-cd');
          if(mc) mc.classList.add('hidden');
        } else {
          var mc = document.getElementById('match-cd');
          if(mc && !this._matchCdShown){
            mc.classList.remove('hidden');
            this._matchCdShown = true;
          }
          var num = document.querySelector('.match-cd-num');
          var label = document.querySelector('.match-cd-label');
          var go = document.querySelector('.match-cd-go');
          if(num){
            if(this._matchStartDelay > 0.5){
              num.textContent = Math.ceil(this._matchStartDelay);
              if(label) label.style.display = '';
              if(go) go.style.display = 'none';
            } else {
              num.style.display = 'none';
              if(label) label.style.display = 'none';
              if(go) go.style.display = 'block';
            }
          }
        }
      }
      this.dt = dt; this.time += dt;
      // Play-time stats: +1s while a match runs
      this._playAcc = (this._playAcc || 0) + dt;
      if(this._playAcc >= 1){
        this._playAcc -= 1;
        if(window.Menu && Menu.settings){
          const st = Menu.settings.stats || (Menu.settings.stats = {});
          st.playSec = (st.playSec || 0) + 1;
          this._playSaveAcc = (this._playSaveAcc || 0) + 1;
          if(this._playSaveAcc >= 60){ this._playSaveAcc = 0; try{ saveSettings(Menu.settings); }catch(e){} }
        }
      }
      try {
        if(this.physicsWorld){
          this.physicsWorld.timestep = Math.min(dt, 0.033);
          this.physicsWorld.step(this._eventQueue);
          if(this._eventQueue) this._eventQueue.drainCollisionEvents((h1, h2, started) => {
            if(!started) return;
            this._onCollision(h1, h2);
          });
        }
      } catch(e){ console.warn('Physics step:', e); }
      if(this._matchStartDelay <= 0){
        this._update(dt);
      } else {
        // During countdown: still step physics but skip input/bot updates
        if(this.physicsWorld){
          this.physicsWorld.timestep = Math.min(dt, 0.033);
          this.physicsWorld.step(this._eventQueue);
          if(this._eventQueue) this._eventQueue.drainCollisionEvents((h1, h2, started) => {
            if(!started) return;
            this._onCollision(h1, h2);
          });
        }
      }
    }
    this._perfUpdateEnd = performance.now();

    // Adaptive resolution: if frames are heavy, scale render resolution down
    // (and back up when the GPU keeps up) so the game stays smooth on weak GPUs
    if(now - this._adapT > 2000){
      this._adapT = now;
      const hist = this._perfFpsHistory;
      if(hist.length > 30){
        let s = 0;
        for(let i = hist.length - 30; i < hist.length; i++) s += (1000 / (hist[i] - hist[i-1]));
        const fps30 = s / 29;
        const cur = this.renderer.getPixelRatio();
        if(fps30 < 35 && cur > 0.8){
          this.renderer.setPixelRatio(Math.max(0.8, cur - 0.25));
        } else if(fps30 > 50 && cur < this._maxPixelRatio){
          this.renderer.setPixelRatio(Math.min(this._maxPixelRatio, cur + 0.2));
        }
      }
    }

    // GPU load estimate: sample the delta between rAF start and render completion
    this._perfGpuLoadSamples.push(Math.round((performance.now() - this._perfFrameStart) / 1.66));

    this._updatePerfOverlay(now);
    this.renderer.render(this.scene, this.camera);
  }

  _update(dt){
    try {
    this.world.update(dt, this.time, this.localTank);
    if(this.glad && !this.glad._client) this._gladUpdate(dt);

    // Camera zoom & orbit
    const zoom = this.input.consumeZoom();
    if(zoom !== 0){
      this.camDist = Math.max(CONFIG.CAM_DIST_MIN, Math.min(CONFIG.CAM_DIST_MAX,
        this.camDist - zoom*CONFIG.CAM_ZOOM_STEP));
    }
    const camRot = this.input.consumeCamRotate();
    const camMode = this.camMode || 'arrows';
    if(camMode === 'arrows'){
      if(camRot !== 0){
        const inv = (this.settings && this.settings.invertCamRot) ? -1 : 1;
        this.camAngle -= camRot * inv * CONFIG.CAM_ROTATE_SPEED * dt;
      }
    } else if(camMode === 'swipe'){
      const swipe = this.input.consumeCamSwipe();
      if(swipe !== 0){
        this.camAngle += swipe * CONFIG.CAM_SWIPE_SENSITIVITY;
      }
    }

    // Local tank input (keyboard/mouse OR touch)
    if(this._matchStartDelay > 0){
      // Skip all input during match start countdown
    } else if(this.localTank && this.localTank.alive && !this.localTank.dying && !(this.glad && this.glad.ended)){
      let throttle, turn, turretAngle, fire, handbrake;
      
      const touchInput = this.input.getTouchInput();
      
      if(touchInput && touchInput.isTouch){
        // Tank-relative controls (WASD-like): joystick maps directly to tank body
        const mThrottle = touchInput.throttle;
        const mTurn = touchInput.turn;
        const moveMag = Math.sqrt(mThrottle*mThrottle + mTurn*mTurn);
        if(moveMag > 0.15){
          throttle = mThrottle;
          turn = mTurn;
        } else {
          throttle = 0;
          turn = 0;
        }

        // Turret: camera-relative aim
        if(this.input._turretJoystick && this.input._turretJoystick.active){
          turretAngle = (this.camAngle || Math.PI) + Math.PI - (touchInput.turretRelAngle || 0);
        }

        // Fire only when knob is dragged to max distance (armed)
        fire = !!touchInput.armed;
        handbrake = false;
      } else {
        // Desktop: tank-relative controls
        throttle = (this.input.pressed('forward')?1:0) - (this.input.pressed('backward')?1:0);
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

    // Super ability activation (PC key / mobile button already wired via #super-btn)
    if(this.localTank && this.localTank.alive && !this.localTank.dying && !(this.glad && this.glad.ended)){
      const superPressed = this.input.consumePressed('super');
      if(superPressed && !this.localTank.superState) this.localTank.activateSuper();
      else if(superPressed && this.localTank.superState === 'targeting') this.localTank.cancelSuper();
      this._updateSupers(dt);
    }

    // Update all tanks
    this.tanks.forEach(t=>{
      if(this._matchStartDelay > 0 && t.brain){
        // Skip bot AI during match start countdown
        t.setInput({throttle:0,turn:0,turretWorldAngle:t.turretAngle,fire:false});
        t.update(dt, this.world, this);
        return;
      }
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
    this.projectiles = this.projectiles.filter(p=>{ if(p.dead){ if(p._trail) this.trailManager.endTrail(p._trail); p.detach(); return false;} return true; });
    // Push shell positions to active trails
    for(const p of this.projectiles){
      if(p._trail && !p.dead) this.trailManager.pushPosition(p._trail, p.x, p.y, p.z);
    }
    this.explosions.forEach(e=> e.update(dt));
    this.explosions = this.explosions.filter(e=>{ if(e.dead){e.detach(); return false;} return true; });
    // Shell casings (physics-driven, self-lifetime)
    this.casings.forEach(c=> c.update(dt, this.world, this));
    this.casings = this.casings.filter(c=>{ if(c.dead){c.detach(); return false;} return true; });
    // Muzzle flash sprites
    if(this._muzzleFlashes){
      this._muzzleFlashes.forEach(p=>{
        p.life -= dt;
        if(p.vx != null){
          p.sprite.position.x += p.vx * dt;
          p.sprite.position.z += p.vz * dt;
          p.sprite.position.y += p.vy * dt;
          p.vy -= 1.5 * dt;
        }
        p.sprite.material.opacity = Math.max(0, p.life / p.maxLife);
        p.sprite.scale.x = p.sprite.scale.y = (p.baseScale || 2.0) * (1 + (1 - p.life / p.maxLife) * 0.5);
      });
      this._muzzleFlashes = this._muzzleFlashes.filter(p=>{
        if(p.life <= 0){ this.scene.remove(p.sprite); /* shared VFX tex */ p.sprite.material.dispose(); return false; }
        return true;
      });
    }
    // Muzzle lights (pooled — fade out after each shot)
    if(this._muzzleLights){
      this._muzzleLights.forEach(l=>{
        if(!l.active) return;
        const k = (l.life -= dt) / l.maxLife;
        l.light.intensity = k <= 0 ? 0 : 26 * k;
        if(k <= 0) l.active = false;
      });
    }
    // Helix video overlay
    if(this._helixVideos.size){
      for(const [tankId, hv] of this._helixVideos){
        const tank = this.tanks.find(t => t.id === tankId);
        if(!tank){ hv.fadeTimer = 0.15; continue; }
        const hasFlame = this.projectiles.some(p => p.type === 'flame' && p.owner && p.owner.id === tankId);
        if(hasFlame){
          hv.firing = true;
          hv.fadeTimer = 0;
          hv.mesh.material.opacity = 1;
          if(hv.el.paused) hv.el.play().catch(() => {});
        } else if(hv.firing){
          hv.firing = false;
          hv.fadeTimer = 0.15;
        }
        if(!hv.firing){
          hv.fadeTimer -= dt;
          hv.mesh.material.opacity = Math.max(0, hv.fadeTimer / 0.15);
          if(hv.fadeTimer <= 0){
            hv.el.pause(); hv.el.currentTime = 0;
            hv.parent.remove(hv.mesh);
            hv.mesh.geometry.dispose();
            hv.mesh.material.dispose();
            hv.tex.dispose();
            this._helixVideos.delete(tankId);
          }
        }
      }
    }
    // Ricochet labels
    if(this._ricoLabels){
      this._ricoLabels.forEach(l=>{ l.life -= dt; l.sprite.material.opacity = Math.max(0, l.life / l.maxLife); });
      this._ricoLabels = this._ricoLabels.filter(l=>{
        if(l.life <= 0){ this.scene.remove(l.sprite); l.sprite.material.map.dispose(); l.sprite.material.dispose(); return false; }
        return true;
      });
    }
    // Floating damage numbers
    if(this._dmgLabels){
      this._dmgLabels.forEach(l=>{
        l.life -= dt;
        l.sprite.position.y += l.vy * dt;
        l.sprite.material.opacity = Math.max(0, l.life / l.maxLife);
      });
      this._dmgLabels = this._dmgLabels.filter(l=>{
        if(l.life <= 0){ this.scene.remove(l.sprite); l.sprite.material.dispose(); if(l.canvas) this._putDmgCanvas(l.canvas); return false; }
        return true;
      });
    }
    // Muzzle smoke
    if(this._muzzleSmokes){
      this._muzzleSmokes.forEach(p=>{
        p.life -= dt;
        p.sprite.position.x += p.vx * dt;
        p.sprite.position.z += p.vz * dt;
        p.sprite.position.y += p.vy * dt;
        p.vy -= 0.3 * dt;
        const grow = 1 + (1 - p.life / p.maxLife) * 1.2;
        p.sprite.scale.x = p.sprite.scale.y = p.baseScale * grow;
        p.sprite.material.opacity = Math.max(0, (p.life / p.maxLife) * 0.65);
      });
      this._muzzleSmokes = this._muzzleSmokes.filter(p=>{
        if(p.life <= 0){ this.scene.remove(p.sprite); /* shared VFX tex */ p.sprite.material.dispose(); return false; }
        return true;
      });
    }
    // Destruction / burst particles
    if(this._bursts){
      this._bursts.forEach(p=>{
        p.life -= dt;
        p.sprite.position.x += p.vx * dt;
        p.sprite.position.z += p.vz * dt;
        p.sprite.position.y += p.vy * dt;
        p.vy -= p.gravity * dt;
        const k = 1 - p.life / p.maxLife;
        p.sprite.scale.x = p.sprite.scale.y = p.baseScale * (1 + k * p.grow);
        p.sprite.material.opacity = Math.max(0, (p.life / p.maxLife) * p.fade);
      });
      this._bursts = this._bursts.filter(p=>{
        if(p.life <= 0){ this.scene.remove(p.sprite); /* shared VFX tex */ p.sprite.material.dispose(); return false; }
        return true;
      });
    }
    // Exhaust / drift smoke particles
    if(this._exhaustParts){
      this._exhaustParts.forEach(p=>{
        p.life -= dt;
        p.sprite.position.x += p.vx * dt;
        p.sprite.position.z += p.vz * dt;
        p.sprite.position.y += p.vy * dt;
        p.vy -= 0.2 * dt;
        const grow = 1 + (1 - p.life / p.maxLife) * 1.5;
        p.sprite.scale.x = p.sprite.scale.y = p.baseScale * grow;
        p.sprite.material.opacity = Math.max(0, (p.life / p.maxLife) * 0.4);
      });
      this._exhaustParts = this._exhaustParts.filter(p=>{
        if(p.life <= 0){ this.scene.remove(p.sprite); /* shared VFX tex */ p.sprite.material.dispose(); return false; }
        return true;
      });
    }
    // Flamethrower damage accumulators — live stacking counter
    if(this._flameAccums){
      for(const [id, entry] of this._flameAccums){
        const tank = this.tanks.find(t => t.id === id);
        if(!tank || (!tank.alive && entry.damage === 0)){
          if(entry.sprite){ this.scene.remove(entry.sprite); entry.sprite.material.dispose(); }
          this._flameAccums.delete(id);
          continue;
        }
        entry.timer -= dt;
        if(entry.timer <= 0 || !tank.alive){
          // Stop accumulating — let the sprite fade out
          entry.fading = true;
          if(!this._flameFading) this._flameFading = [];
          this._flameFading.push(entry);
          this._flameAccums.delete(id);
        } else if(entry.sprite){
          // Follow tank position
          entry.sprite.position.x = tank.x + (Math.random() - 0.5) * 0.2;
          entry.sprite.position.z = tank.z + (Math.random() - 0.5) * 0.2;
          entry.sprite.position.y = tank.def.turret.h + tank.def.body.h + 3.6;
        }
      }
    }
    // Fading flame labels
    if(this._flameFading){
      for(let i = this._flameFading.length - 1; i >= 0; i--){
        const f = this._flameFading[i];
        f.life = (f.life || 0.6) - dt;
        if(f.sprite){
          f.sprite.material.opacity = Math.max(0, (f.life || 0) / 0.6);
          if(f.life <= 0){
            this.scene.remove(f.sprite);
            f.sprite.material.dispose();
            this._flameFading.splice(i, 1);
          }
        } else {
          this._flameFading.splice(i, 1);
        }
      }
    }
    // Water foam around tanks in lakes
    this._updateWaterFoam(dt);

    // Bullet trails
    this.trailManager.update(dt, this.camera);

    // Camera (orbits around tank; auto mode locks behind hull front)
    if(this.localTank && this.localTank.alive && !this.localTank.dying){
      const t = this.localTank;
      if((this.camMode || 'arrows') === 'auto'){
        this.camAngle = t.heading + Math.PI;
      }
      const angle = this.camAngle;
      const camTarget = new THREE.Vector3(
        t.x + Math.sin(angle) * this.camDist,
        this.camDist * 1.43 + 1.2,
        t.z + Math.cos(angle) * this.camDist);
      // Never let the camera cross a border wall (keeps walls out of view)
      const camLim = (this.world && this.world.half || 75) - 8;
      camTarget.x = Math.max(-camLim, Math.min(camLim, camTarget.x));
      camTarget.z = Math.max(-camLim, Math.min(camLim, camTarget.z));
      this.camera.position.lerp(camTarget, CONFIG.CAM_LERP);
      this.camera.lookAt(t.x, 1.2, t.z);
      if(this._shake > 0){
        this._shake = Math.max(0, this._shake - dt*2.5);
        const shScale = (this.settings && typeof this.settings.screenShake === 'number') ? this.settings.screenShake / 100 : 1;
        const s = this._shake * shScale;
        this.camera.position.x += (Math.random()-0.5)*s;
        this.camera.position.y += (Math.random()-0.5)*s;
        this.camera.position.z += (Math.random()-0.5)*s;
      }
    } else if(this.localTank && !this.localTank.alive){
      // Keep camera at last position when dead (don't follow dying tank)
    }

    // Dynamic UI and outline scaling based on camera distance
    for(const t of this.tanks) t.updateDistanceScaling(this.camera.position, this.camDist);

    // Aim line
    this._updateAimLine();

    // Visibility
    this._updateVisibility();

    // Networking: Host broadcasts state
    if(this.mode==='host'){
      this._netSendAcc += dt;
      if(this._netSendAcc > 0.05){ // ~20Hz
        this._netSendAcc = 0;
        Net.broadcast({time:this.time, glad:this.glad ? this._gladSnapshot() : null, tanks:this.tanks.map(t=>t.snapshot()), projs:this.projectiles.filter(p=>!p.dead).map(p=>({id:p.id,x:p.x,y:p.y,z:p.z,dx:p.dir.x,dz:p.dir.z,type:p.type,life:p.life}))});
        if(window.__PLATOON_BATTLE){
          window.__PLATOON_BATTLE.score = this.tanks.filter(t=>!t.isDummy).map(t=>({name:t.name||'Player', kills:t.kills||0, dd:Math.round(t.damageDealt||0)}));
        }
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
        const rad = (Math.max(enemy.def.body.w, enemy.def.body.l)/2 + 0.4) * (enemy.hitScale || 1);
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
    g.font = 'bold 42px "Segoe UI", "Arial Black", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.strokeStyle = '#000'; g.lineWidth = 6; g.lineJoin = 'round';
    g.strokeText('Ricochet!', 128, 48);
    g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 12;
    g.fillStyle = '#ff6a2a';
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

  _getDmgCanvas(){
    if(!this._dmgCanvasPool) this._dmgCanvasPool = [];
    let c = this._dmgCanvasPool.pop();
    if(!c){ c = document.createElement('canvas'); c.width = 128; c.height = 64; }
    return c;
  }
  _putDmgCanvas(c){
    if(!this._dmgCanvasPool) this._dmgCanvasPool = [];
    if(this._dmgCanvasPool.length < 20) this._dmgCanvasPool.push(c);
  }

  spawnDamageLabel(x, y, z, amount){
    const c = this._getDmgCanvas();
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 64);
    g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 6;
    g.font = 'bold 38px "Segoe UI", "Arial Black", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.strokeStyle = '#000'; g.lineWidth = 5; g.lineJoin = 'round';
    g.strokeText('-' + Math.round(amount), 64, 32);
    g.fillStyle = '#ff4444';
    g.fillText('-' + Math.round(amount), 64, 32);
    const tex = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false, depthWrite:false}));
    s.renderOrder = 999;
    s.position.set(x + (Math.random()-0.5)*1.5, y, z + (Math.random()-0.5)*1.5);
    s.scale.set(2.8, 1.4, 1);
    this.scene.add(s);
    if(!this._dmgLabels) this._dmgLabels = [];
    this._dmgLabels.push({sprite:s, life:1.0, maxLife:1.0, vy:1.2 + Math.random()*0.8});
  }

  _accumFlameDamage(tank, amount){
    if(!this._flameAccums) this._flameAccums = new Map();
    let entry = this._flameAccums.get(tank.id);
    if(!entry){
      const c = document.createElement('canvas'); c.width = 128; c.height = 64;
      const g = c.getContext('2d');
      const tex = new THREE.CanvasTexture(c);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false, depthWrite:false}));
      s.renderOrder = 999;
      s.position.set(tank.x, tank.def.turret.h + tank.def.body.h + 3.6, tank.z);
      s.scale.set(2.8, 1.4, 1);
      this.scene.add(s);
      entry = {sprite:s, canvas:c, ctx:g, tex, damage:0, timer:0.3};
      this._flameAccums.set(tank.id, entry);
    }
    entry.damage += amount;
    entry.timer = 0.3;
    // Redraw canvas with climbing number
    const g = entry.ctx;
    const c = entry.canvas;
    g.clearRect(0, 0, c.width, c.height);
    g.font = 'bold 38px "Segoe UI", "Arial Black", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 6;
    g.strokeStyle = '#000'; g.lineWidth = 5; g.lineJoin = 'round';
    g.strokeText('-' + Math.round(entry.damage), 64, 32);
    g.fillStyle = '#ff6644';
    g.fillText('-' + Math.round(entry.damage), 64, 32);
    entry.tex.needsUpdate = true;
  }

  spawnExhaust(x, y, z, dirAngle, kmh){
    if(!this.isFancy) return;
    if(!this._exhaustParts) this._exhaustParts = [];
    if(this._exhaustParts.length > 30) return;
    const tex = VFX.getTex('smoke');
    const mat = new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false, depthWrite:false, opacity:0.5});
    const s = new THREE.Sprite(mat);
    const baseScale = 0.3 + Math.random() * 0.25;
    const sc = baseScale * (0.7 + kmh / 200);
    s.position.set(x, y, z);
    s.scale.set(sc, sc, 1);
    this.scene.add(s);
    const spd = 0.8 + kmh / 60;
    this._exhaustParts.push({
      sprite:s, life:0.6 + Math.random() * 0.4, maxLife:1.0,
      vx: Math.sin(dirAngle) * spd + (Math.random() - 0.5) * 0.4,
      vz: Math.cos(dirAngle) * spd + (Math.random() - 0.5) * 0.4,
      vy: 0.5 + Math.random() * 0.6,
      baseScale: sc
    });
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
          p.speed *= 0.97;
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
     SUPERS
     =========================================================== */
  _groundPoint(ndcX, ndcY){
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, hit) ? hit : null;
  }

  _makeGroundRing(x, z, r, color, opacity){
    const grp = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.18, r + 0.18, 48),
      new THREE.MeshBasicMaterial({ color, transparent:true, opacity: opacity || 0.8, side:THREE.DoubleSide, depthWrite:false })
    );
    ring.rotation.x = -Math.PI/2;
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(r * 0.92, 48),
      new THREE.MeshBasicMaterial({ color, transparent:true, opacity: 0.22, depthWrite:false })
    );
    fill.rotation.x = -Math.PI/2;
    fill.position.y = 0.02;
    grp.add(ring);
    grp.add(fill);
    grp.position.set(x, 0.04, z);
    this.scene.add(grp);
    return grp;
  }

  _updateSupers(dt){
    const t = this.localTank;
    if(!t || !t.hasSuper()) return;
    const d = t.def;
    const st = t.superState;
    if(st === 'targeting' && this._lastSuperState !== 'targeting'){
      this._superMousePrev = this.input.mouse.down;
    }
    this._lastSuperState = st;

    // --- Airstrike: waiting for ground selection ---
    if(st === 'targeting'){
      if((this.input.keys['Escape'] || this.input.keys['ContextMenu']) && !this._superEscPrev){
        this._superEscPrev = true;
        t.cancelSuper();
      } else if(!this.input.keys['Escape'] && !this.input.keys['ContextMenu']){
        this._superEscPrev = false;
      }
      let picked = null;
      const click = this.input.consumePressed('fire') || (this.input.mouse.down && !this._superMousePrev);
      this._superMousePrev = this.input.mouse.down;
      const tap = this.input.consumeTap();
      if(tap){ picked = this._groundPoint(tap.ndcX, tap.ndcY); }
      else if(click){ picked = this._groundPoint(this.input.mouse.ndcX, this.input.mouse.ndcY); }
      if(picked){
        const r = d.airstrikeRadius || 4;
        t.superTarget = { x: picked.x, z: picked.z };
        t.superState = 'strike';
        t.superTimer = d.airstrikeDelay || 3;
        t.superCdLeft = t.superCdTotal;
        if(t._strikeRing) this.scene.remove(t._strikeRing);
        t._strikeRing = this._makeGroundRing(picked.x, picked.z, r, 0xffffff, 0.9);
        this._superWarned = false;
      }
    } else if(st === 'strike'){
      t.superTimer -= dt;
      const total = d.airstrikeDelay || 3;
      const remain = t.superTimer;
      if(t._strikeRing){
        const ring = t._strikeRing;
        if(remain <= 1 && !this._superWarned){
          this._superWarned = true;
          ring.children.forEach(c => {
            if(c.material){ c.material.color.set(0xff4422); c.material.opacity = c.material.opacity > 0.5 ? 0.85 : 0.25; }
          });
        }
        ring.scale.setScalar(1.15 - 0.15 * (remain / total));
      }
      if(t.superTimer <= 0){
        if(t._strikeRing){ this.scene.remove(t._strikeRing); t._strikeRing = null; }
        this._dropStrikeBombs(t);
        t.superState = 'done';
        t.superTimer = 0;
      }
    }

    // --- Sturmratte: panzer drop marker ---
    else if(st === 'panzer_drop'){
      t.superTimer -= dt;
      if(!this._panzerRing){
        this._panzerRing = [];
        for(const side of [-1, 1]){
          const a = t.heading + Math.PI/2 * side;
          const ox = Math.sin(a) * 3.2, oz = Math.cos(a) * 3.2;
          const ring = this._makeGroundRing(t.x + ox, t.z + oz, 1.6, 0x88ccff, 0.7);
          this._panzerRing.push({ mesh: ring, side });
        }
      } else {
        this._panzerRing.forEach(p => {
          const a = t.heading + Math.PI/2 * p.side;
          p.mesh.position.set(t.x + Math.sin(a) * 3.2, 0.04, t.z + Math.cos(a) * 3.2);
        });
      }
      if(t.superTimer <= 0){
        this._panzerRing.forEach(p => this.scene.remove(p.mesh));
        this._panzerRing = null;
        this._spawnPanzers(t);
        t.superState = 'done';
        t.superTimer = 0;
      }
    }

    // --- Helix: oil fill then burn ---
    else if(st === 'oil_fill'){
      t.superTimer -= dt;
      this._oilPuddleTimer = (this._oilPuddleTimer || 0) - dt;
      if(this._oilPuddleTimer <= 0){
        this._oilPuddleTimer = 0.12;
        this._spawnOilPuddle(t);
      }
      (this._oilPuddles || []).forEach(p => {
        if(p.cur < p.sc){
          p.cur = Math.min(p.sc, p.cur + p.sc * dt * 3);
          p.mesh.scale.setScalar(p.cur);
        }
      });
      if(t.superTimer <= 0){
        t.superState = 'oil_burn';
        t.superTimer = d.oilBurn || 1;
        this._oilBurnTimer = 0;
        (this._oilPuddles || []).forEach(p => {
          p.burning = true;
          if(p.mesh.material) p.mesh.material.dispose();
          p.mesh.material = new THREE.MeshBasicMaterial({ map: VFX.getTex('fire'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
          p.mesh.scale.setScalar(p.cur * 1.25);
        });
        this.spawnExplosion(t.x, 0.4, t.z, 0xff6600, 6);
      }
    }
    else if(st === 'oil_burn'){
      t.superTimer -= dt;
      this._oilBurnTimer = (this._oilBurnTimer || 0) - dt;
      (this._oilPuddles || []).forEach(p => {
        const fl = 0.7 + 0.3 * Math.sin(this.time * 30 + p.phase) * Math.sin(this.time * 11 + p.phase * 2);
        p.mesh.scale.setScalar(p.cur * 1.25 * fl);
        if(p.mesh.material) p.mesh.material.opacity = 0.75 + 0.25 * Math.sin(this.time * 23 + p.phase);
      });
      if(this._oilBurnTimer <= 0){
        this._oilBurnTimer = d.oilTick || 0.25;
        for(const o of this.tanks){
          if(!o.alive || o === t || o.allyId === t.id || t.allyId === o.id) continue;
          for(const p of (this._oilPuddles || [])){
            const pr = p.cur * 1.15;
            const ddx = o.x - p.x, ddz = o.z - p.z;
            if(ddx*ddx + ddz*ddz < pr*pr){
              o.takeDamage(d.oilDamage || 4, t, this);
              this.spawnDamageLabel(o.x, o.def.turret.h + o.def.body.h + 3.6, o.z, d.oilDamage || 4);
              break;
            }
          }
        }
      }
      if(t.superTimer <= 0){
        (this._oilPuddles || []).forEach(p => {
          this.scene.remove(p.mesh);
          if(p.mesh.material) p.mesh.material.dispose();
          p.mesh.geometry.dispose();
        });
        this._oilPuddles = [];
        t.superState = 'done';
        t.superTimer = 0;
      }
    }

    // --- Update falling strike bombs ---
    if(this._strikeBombs && this._strikeBombs.length){
      this._strikeBombs.forEach(b => {
        b.y -= (b.fallSpeed || 60) * dt;
        b.mesh.position.set(b.x, b.y, b.z);
        b.mesh.rotation.x += 3 * dt;
        b.mesh.rotation.z += 2 * dt;
        if(b.y <= 0.5 && !b.hit){
          b.hit = true;
          this.spawnExplosion(b.x, 1.2, b.z, 0xffaa33, 10);
          const rad = b.radius, dmg = b.damage;
          for(const o of this.tanks){
            if(!o.alive || o === b.owner) continue;
            const ddx = o.x - b.x, ddz = o.z - b.z;
            if(ddx*ddx + ddz*ddz < rad*rad){
              o.takeDamage(dmg, b.owner, this);
              this.spawnDamageLabel(o.x, o.def.turret.h + o.def.body.h + 3.6, o.z, dmg);
            }
          }
        }
      });
      this._strikeBombs = this._strikeBombs.filter(b => {
        if(b.hit && b.y <= -2){
          this.scene.remove(b.mesh);
          b.mesh.geometry.dispose();
          b.mesh.material.dispose();
          return false;
        }
        return true;
      });
    }
  }

  _dropStrikeBombs(t){
    const d = t.def;
    const cx = t.superTarget.x, cz = t.superTarget.z;
    const r = d.airstrikeRadius || 4;
    if(!this._strikeBombs) this._strikeBombs = [];
    for(let i = 0; i < (d.airstrikeBombs || 3); i++){
      const a = Math.random() * Math.PI * 2;
      const off = Math.random() * r * 0.7;
      const geo = new THREE.SphereGeometry(0.28, 10, 10);
      const mat = new THREE.MeshStandardMaterial({ color: 0x333338, roughness: 0.6, metalness: 0.4 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      const x = cx + Math.cos(a) * off, z = cz + Math.sin(a) * off;
      const y = 46 + Math.random() * 4;
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      this._strikeBombs.push({ mesh, x, z, y, hit:false, owner:t, radius:r, damage:d.airstrikeDamage || 60, fallSpeed: 55 + Math.random()*15 });
    }
  }

  _deployBush(t){
    const d = t.def;
    const max = d.bushMax || 3;
    while(t.myBushes.length >= max){
      const oldest = t.myBushes.shift();
      this.world.removePlayerBush(oldest);
    }
    const a = Math.random() * Math.PI * 2;
    const entry = this.world.addPlayerBush(t.x + Math.cos(a) * 1.2, t.z + Math.sin(a) * 1.2);
    t.myBushes.push(entry);
    this.spawnExplosion(t.x, 0.5, t.z, 0x55aa55, 4);
  }

  _spawnPanzers(t){
    for(const side of [-1, 1]){
      const a = t.heading + Math.PI/2 * side;
      const ox = Math.sin(a) * 3.2, oz = Math.cos(a) * 3.2;
      const def = TANKS.panzer;
      const p = new Tank(def, {
        id:'panzer-' + t.id + '-' + side + '-' + Math.random().toString(36).slice(2,6),
        name: side < 0 ? 'Panzer 1' : 'Panzer 2',
        x: t.x + ox, z: t.z + oz,
        heading: t.heading,
        physicsWorld: this.physicsWorld,
      });
      p.allyId = t.id;
      p.isPanzer = true;
      p.brain = new PanzerBrain(p, t);
      this._finalizeTank(p);
      this.tanks.push(p);
      this.spawnExplosion(p.x, 0.6, p.z, 0x8899aa, 6);
    }
  }

  _spawnOilPuddle(t){
    if(!this._oilPuddles) this._oilPuddles = [];
    const rearA = t.heading + Math.PI;
    const off = 1.6 + Math.random() * 1.4;
    const x = t.x + Math.sin(rearA) * off + (Math.random() - 0.5) * 0.9;
    const z = t.z + Math.cos(rearA) * off + (Math.random() - 0.5) * 0.9;
    const sc = 1.1 + Math.random() * 1.1;
    const geo = new THREE.PlaneGeometry(2.2, 2.2);
    const mat = new THREE.MeshBasicMaterial({ map: VFX.getTex('oil'), transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI/2;
    mesh.rotation.z = Math.random() * Math.PI;
    mesh.scale.setScalar(0.3);
    mesh.position.set(x, 0.07, z);
    this.scene.add(mesh);
    this._oilPuddles.push({ mesh, x, z, sc, cur: 0.3, phase: Math.random() * 6.28, burning: false });
    if(this._oilPuddles.length > 30){
      const old = this._oilPuddles.shift();
      this.scene.remove(old.mesh);
      old.mesh.geometry.dispose();
      if(old.mesh.material) old.mesh.material.dispose();
    }
  }

  _updateSuperSlot(){
    const wrap = document.getElementById('super-wrap');
    const btn = document.getElementById('super-btn');
    const hint = document.getElementById('super-hint');
    const t = this.localTank;
    if(!wrap || !btn) return;
    const has = !!(t && t.hasSuper());
    wrap.classList.toggle('hidden', !has);
    if(!has || !t) return;
    if(!btn._wired){
      btn._wired = true;
      btn.onclick = () => { Audio && Audio.click && Audio.click(); if(this.localTank) this.localTank.activateSuper(); };
    }
    const info = t.superInfo();
    const icons = { airstrike:'✈', cloak:'👻', bush:'🌿', panzers:'⚙', oil:'🔥' };
    btn.querySelector('.super-icon').textContent = icons[info.type] || '★';
    const label = btn.querySelector('.super-label');
    const frac = info.cdTotal > 0 ? Math.min(1, info.cd / info.cdTotal) : 0;
    btn.style.setProperty('--cd', frac.toFixed(3));
    btn.classList.toggle('ready', info.ready && !info.state);
    btn.classList.toggle('active', !!info.state);
    if(info.state === 'targeting'){
      label.textContent = 'TARGET';
    } else if(info.state && info.timer > 0){
      label.textContent = Math.ceil(info.timer) + 's';
    } else if(info.ready){
      label.textContent = 'READY';
    } else {
      label.textContent = Math.ceil(info.cd) + 's';
    }
    if(hint){
      if(info.state === 'targeting'){
        hint.classList.remove('hidden');
        hint.textContent = 'Click / tap the ground to pick the strike point  (F / right-click to cancel)';
      } else {
        hint.classList.add('hidden');
      }
    }
  }

  /* ===========================================================
     COMBAT HOOKS
     =========================================================== */
  ejectShell(tank){
    // World position of the model's "shell" port (tracks turret rotation)
    tank.root.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    let fallbackPos = false;
    if(tank._shellNode){
      tank._shellNode.getWorldPosition(p);
    } else {
      const m = tank.muzzle();
      p.copy(m.pos);
      fallbackPos = true;
    }
    // Eject backwards/off-axis of the barrel, upward, plus a little of the
    // tank's own ground speed so it trails naturally.
    const a = tank.turretAngle + Math.PI + (Math.random() < 0.5 ? 1 : -1) * (Math.PI/2 + (Math.random()*0.4 - 0.2));
    const gv = tank.getWorldVelocity() || {x:0, z:0};
    const spd = 5 + Math.random() * 3;
    const vel = {
      x: Math.sin(a) * spd * 0.6 + gv.x * 0.35,
      y: 5 + Math.random() * 2.5,
      z: Math.cos(a) * spd * 0.6 + gv.z * 0.35,
    };
    if(fallbackPos) vel.y += 0.5;
    // Cap concurrent casings: keep the scene and physics cheap under rapid fire.
    if(this.casings.length >= 18){
      const oldest = this.casings.shift();
      if(oldest) oldest.detach();
    }
    const casing = new ShellCasing(p, vel, this.physicsWorld);
    casing.attach(this.scene);
    this.casings.push(casing);
  }

  spawnShot(tank){
    const {pos, dir} = tank.muzzle();
    const y = pos.y;
    // Gunshot sound: full volume from the local tank, quieter from others
    if(window.Audio && Audio.click) Audio.click('gun', tank === this.localTank ? 1 : 0.5);
    // Fancy-only: light recoil kick when the player's own tank fires
    if(this.isFancy && tank === this.localTank) this.addShake(0.12);
    // In client/freeroam mode, host sends projectiles via snapshots
    if(this.mode !== 'client' && this.mode !== 'freeroam'){
      const p = tank.def.shellType==='flame'
        ? new FlameCone(tank, new THREE.Vector3(pos.x, y, pos.z), dir, tank.def)
        : new Shell(tank, new THREE.Vector3(pos.x, y, pos.z), dir, tank.def, this.physicsWorld, tank.getWorldVelocity());
      p.attach(this.scene); this.projectiles.push(p);
      // Spawn bullet trail for shell projectiles
      if(tank.def.shellType !== 'flame'){
        p._trail = this.trailManager.spawn(
          new THREE.Vector3(pos.x, y, pos.z)
        );
      }
    }
    if(tank===this.localTank){
      this._muzzleFlash(pos, dir);
      if(tank.def.shellType === 'flame') this._ensureHelixVideo(tank);
    }
  }

  _ensureHelixVideo(tank){
    if(this._helixVideos.has(tank.id)) return;
    const el = document.createElement('video');
    el.src = 'assets/helix/fire.mp4';
    el.muted = true;
    el.loop = true;
    el.playsInline = true;
    el.crossOrigin = 'anonymous';
    el.playbackRate = 5; el.play().catch(() => {});
    const tex = new THREE.VideoTexture(el);
    tex.center.set(0.5, 0.5);
    tex.rotation = Math.PI / 2;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = -1;
    tex.offset.x = 1;
    const range = tank.def.shellRange || 22;
    const tanHalf = tank.def.fireConeHalfAngle || 0.12;
    const halfW = range * tanHalf;
    const w = halfW * 2;
    const h = range;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.translate(0, h / 2, 0);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.75, blending: THREE.NormalBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    mat.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('gl_FragColor = vec4( outgoingLight, diffuseColor.a );', 'float _lum=dot(outgoingLight,vec3(0.299,0.587,0.114));if(_lum<0.06)discard;gl_FragColor=vec4(outgoingLight,diffuseColor.a);'); };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.set(-Math.PI / 2, 0, Math.PI);
    if(tank.barrelEnd) { mesh.position.copy(tank.barrelEnd.position); mesh.position.x += 0.35; }
    tank.turretGroup.add(mesh);
    this._helixVideos.set(tank.id, { mesh, tex, el, parent: tank.turretGroup, firing: true, fadeTimer: 0 });
  }

  _muzzleFlash(pos, dir){
    if(this.settings && this.settings.muzzleFx === false) return;
    // Directional gun flash (stretched along barrel)
    const flareTex = VFX.getTex('flare');
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({map:flareTex, transparent:true, opacity:1, blending:THREE.AdditiveBlending, depthWrite:false}));
    flash.position.set(pos.x, pos.y + 0.15, pos.z);
    flash.scale.set(this.isFancy ? 3.0 : 2.0, this.isFancy ? 3.0 : 2.0, 1);
    this.scene.add(flash);
    const flashLife = 0.12;
    if(!this._muzzleFlashes) this._muzzleFlashes = [];
    this._muzzleFlashes.push({sprite:flash, life:flashLife, maxLife:flashLife});

    // Hot core flash — bright white burst right at the barrel tip
    const core = new THREE.Sprite(new THREE.SpriteMaterial({map:flareTex, transparent:true, opacity:1, blending:THREE.AdditiveBlending, depthWrite:false}));
    core.position.set(pos.x, pos.y + 0.15, pos.z);
    core.scale.set(0.9, 0.9, 1);
    this.scene.add(core);
    this._muzzleFlashes.push({sprite:core, life:0.08, maxLife:0.08});

    // Shell eject / spark puff (small directional burst)
    const sparkTex = VFX.getTex('smoke');
    for(let i=0; i<3; i++){
      const s = new THREE.Sprite(new THREE.SpriteMaterial({map:sparkTex, transparent:true, opacity:0.7, blending:THREE.AdditiveBlending, depthWrite:false}));
      const sc = 0.15 + Math.random() * 0.1;
      s.position.set(pos.x, pos.y + 0.1 + Math.random() * 0.15, pos.z);
      s.scale.set(sc, sc, 1);
      this.scene.add(s);
      if(!this._muzzleFlashes) this._muzzleFlashes = [];
      this._muzzleFlashes.push({
        sprite:s, life:0.1 + Math.random() * 0.08, maxLife:0.18,
        vx: (dir.x || 0) * 1.5 + (Math.random() - 0.5) * 1.0,
        vz: (dir.z || 0) * 1.5 + (Math.random() - 0.5) * 1.0,
        vy: 0.3 + Math.random() * 0.4,
        baseScale: sc
      });
    }

    // Muzzle smoke — follows shell path (fancy only)
    if(this.isFancy){
      // Pooled point light — briefly lights the scene at the barrel
      this._muzzleLight(pos.x, pos.y + 0.2, pos.z);
      const tex = VFX.getTex('smoke');
      for(let i=0; i<5; i++){
        const s = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false, depthWrite:false, opacity:0.5}));
        const sc = 0.5 + Math.random() * 0.4;
        s.position.set(pos.x, pos.y + 0.1 + Math.random() * 0.2, pos.z);
        s.scale.set(sc, sc, 1);
        this.scene.add(s);
        if(!this._muzzleSmokes) this._muzzleSmokes = [];
        const travelSpeed = 2.0 + Math.random() * 1.5;
        this._muzzleSmokes.push({
          sprite:s, life:0.5 + Math.random() * 0.4, maxLife:0.9,
          vx: (dir.x || 0) * travelSpeed + (Math.random() - 0.5) * 0.6,
          vz: (dir.z || 0) * travelSpeed + (Math.random() - 0.5) * 0.6,
          vy: 0.8 + Math.random() * 0.8,
          baseScale: sc
        });
      }
    }
  }

  spawnExplosion(x,y,z,color,count){
    const e = new Explosion(x,y,z,color,count||6);
    e.attach(this.scene); this.explosions.push(e);
  }

  /* Pooled muzzle light — reused between shots, capped at 6 active */
  _muzzleLight(x, y, z){
    if(!this._muzzleLights) this._muzzleLights = [];
    let l = this._muzzleLights.find(v => !v.active);
    if(!l){
      if(this._muzzleLights.length >= 6) return null;
      const pl = new THREE.PointLight(0xffc07a, 0, 12, 2);
      this.scene.add(pl);
      l = {light: pl, active: false, life: 0, maxLife: 0.1};
      this._muzzleLights.push(l);
    }
    l.active = true;
    l.life = l.maxLife = 0.1;
    l.light.position.set(x, y, z);
    l.light.intensity = 26;
    return l;
  }

  /* Lightweight sprite bursts — fire/smoke/spark particles, fancy only */
  spawnBurst(x, y, z, opts){
    if(!this._bursts) this._bursts = [];
    const o = opts || {};
    const count = o.count || 12;
    const tex = VFX.getTex(o.tex || 'flare');
    const additive = o.blend !== 'normal';
    for(let i = 0; i < count; i++){
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 1,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false
      }));
      const a = Math.random() * Math.PI * 2;
      const sp = (o.speed || 8) * (0.5 + Math.random() * 0.8);
      s.position.set(x, y + 0.2, z);
      const sc = (o.size || 1.2) * (0.6 + Math.random() * 0.8);
      s.scale.set(sc, sc, 1);
      this.scene.add(s);
      this._bursts.push({
        sprite: s,
        life: (o.life || 0.6) * (0.6 + Math.random() * 0.8),
        maxLife: o.life || 0.6,
        vx: Math.cos(a) * sp,
        vz: Math.sin(a) * sp,
        vy: (o.rise || 3) * (0.4 + Math.random() * 0.6) + Math.random() * 2,
        gravity: (o.gravity != null ? o.gravity : 9),
        baseScale: sc,
        grow: (o.grow != null ? o.grow : 1.5),
        fade: (o.fade != null ? o.fade : 1)
      });
    }
  }

  /* Destruction VFX — fireball, sparks, smoke column (fancy only) */
  _killVfx(tank){
    if(!this.isFancy) return;
    this.spawnBurst(tank.x, 1.6, tank.z, {count: 16, tex: 'fire', speed: 10, size: 1.7, life: 0.75, rise: 5, grow: 2.2});
    this.spawnBurst(tank.x, 1.5, tank.z, {count: 14, tex: 'flare', speed: 15, size: 0.5, life: 0.5, rise: 2, gravity: 16});
    this.spawnBurst(tank.x, 1.2, tank.z, {count: 8, tex: 'smoke', speed: 2.5, size: 2.1, life: 1.6, rise: 6, grow: 3.2, blend: 'normal', fade: 0.4});
    if(this.localTank){
      const d = Math.hypot(this.localTank.x - tank.x, this.localTank.z - tank.z);
      if(d < 60) this.addShake(1.2 * (1 - d / 60));
    }
  }

  _gladAwardClanXP(){
    const g = this.glad;
    if(!g || g._client || g.xpAwarded || this.mode !== 'sp' || !this.localTank) return;
    g.xpAwarded = true;
    const pl = (g.winner === this.localTank) ? 1 : (this.localTank.placement || 0);
    const xp = (typeof CLAN_GLAD_XP !== 'undefined' && CLAN_GLAD_XP[pl]) ? CLAN_GLAD_XP[pl] : 0;
    if(!xp) return;
    addClanXP(xp);
    Menu.toast('+' + xp + ' Clan XP (#' + pl + ' place)');
    if(pl === 1){
      const s = Menu.settings;
      s.clanWeekWins = (s.clanWeekWins || 0) + 1;
      saveSettings(s);
      if(!s.clanWeekWinsBonus && s.clanWeekWins >= (typeof CLAN_WIN_BONUS_COUNT !== 'undefined' ? CLAN_WIN_BONUS_COUNT : 10)){
        s.clanWeekWinsBonus = true;
        saveSettings(s);
        addClanXP(typeof CLAN_WIN_BONUS_XP !== 'undefined' ? CLAN_WIN_BONUS_XP : 2000);
        Menu.toast('10 wins this week! +2000 Clan XP bonus');
      }
    }
  }

  onTankKilled(tank, byTank){
    this._killVfx(tank);
    if(this.glad && !tank.isDummy){
      const g = this.glad;
      const aliveNow = this.tanks.filter(t => t.alive && !t.dying && !t.isDummy).length;
      tank.placement = aliveNow + 1;
      if(byTank && byTank.alive && !byTank.dying && !byTank.isDummy){
        byTank.applyPower(g.cfg.power.kill, this);
        if(byTank === this.localTank) Menu.toast('Kill! +' + g.cfg.power.kill + ' power');
      }
      if(tank === this.localTank && !g.ended){
        this._gladShowResult(true);
      }
      if(!g.ended && aliveNow === 1){
        g.winner = this.tanks.find(t => t.alive && !t.dying && !t.isDummy) || null;
        g.ended = true;
        this._gladAwardClanXP();
        this._gladShowResult(false);
      }
      this.spawnExplosion(tank.x, 1.4, tank.z, 0xff5b3b, 16);
      this.spawnExplosion(tank.x, 2.0, tank.z, 0xffaa33, 10);
      return;
    }
    this.spawnExplosion(tank.x, 1.4, tank.z, 0xff5b3b, 16);
    this.spawnExplosion(tank.x, 2.0, tank.z, 0xffaa33, 10);
    if(this.localTank){
      const d = Math.hypot(this.localTank.x-tank.x, this.localTank.z-tank.z);
      if(d < 45){
        this._shake = Math.max(this._shake, 0.9 * (1 - d/45));
      }
    }
    // Kill rewards for the local player
    if(byTank && byTank === this.localTank){
      const s = Menu.settings;
      const roll = Math.random();
      s.coins = (s.coins || 0) + 10;
      if(roll < 0.10) s.coins += 5;  // 10% for +15
      else if(roll < 0.15) s.coins += 15; // 5% for +25
      if(roll < 0.01) s.gems = (s.gems || 0) + 1; // 1% for 1 gem

      saveSettings(s);
      Menu.toast('+10 coins' + (roll < 0.15 ? ' (+bonus!)' : '') + (roll < 0.01 ? ' +1 gem!' : ''));
    }
  }

  onLocalDeath(){
    if(this.glad){
      this._gladShowResult(true);
      Menu.toast('Eliminated! You placed #' + (this.localTank ? (this.localTank.placement || '?') : '?'));
      return;
    }
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
    // FPS counter (updates ~4x per second)
    const fpsEl = document.getElementById('fps-counter');
    if(fpsEl){
      const show = this.settings && this.settings.showFps;
      if(fpsEl._shown !== !!show){
        fpsEl._shown = !!show;
        fpsEl.classList.toggle('hidden', !show);
      }
      if(show){
        if(this._fpsAcc === undefined) this._fpsAcc = 0;
        if(this._fpsPrev === undefined) this._fpsPrev = performance.now();
        this._fpsAcc++;
        const now = performance.now();
        const fps = Math.round(1000 / Math.max(1, now - this._fpsPrev));
        this._fpsPrev = now;
        if(this._fpsAcc >= 8){
          this._fpsAcc = 0;
          if(fpsEl.textContent !== String(fps)) fpsEl.textContent = fps + ' FPS';
        }
      }
    }
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
    
    // Flamethrower heat bar (shown inside the reload indicator slot)
    const heatWrap = document.getElementById('heat-wrap');
    const heatBar = document.getElementById('heat-bar');
    const heatText = document.getElementById('heat-text');
    if(heatWrap && heatBar && heatText){
      heatWrap.classList.add('hidden');
    }

    // Reload indicator: vertical bar + % time left to reload (+ magazine pips).
    // Flame tanks get their heat bar drawn in this same slot instead.
    const ri = document.getElementById('reload-indicator');
    if(ri){
      const rctx = ri.getContext('2d');
      rctx.clearRect(0, 0, ri.width, ri.height);
      const w = ri.width, h = ri.height;
      const barW = 10, barH = h - 30;
      const bx = w/2 - barW/2, by = 14;
      const rr = (x, y, bw, bh, rad) => {
        rctx.beginPath();
        if(rctx.roundRect) rctx.roundRect(x, y, bw, bh, rad);
        else rctx.rect(x, y, bw, bh);
        rctx.fill();
      };
      if(t.def.shellType === 'flame'){
        const pct = Math.min(1, Math.max(0, t.heat / 1000));
        rctx.fillStyle = 'rgba(0,0,0,0.55)';
        rr(bx, by, barW, barH, 5);
        const fh = Math.max(2, barH * pct);
        const grad = rctx.createLinearGradient(0, by + barH, 0, by);
        grad.addColorStop(0, '#ffb12b');
        grad.addColorStop(1, pct > 0.75 ? '#ff3b30' : '#ff6a00');
        rctx.fillStyle = grad;
        rr(bx, by + barH - fh, barW, fh, 5);
        rctx.fillStyle = t.overheated ? '#ff3b30' : '#fff';
        rctx.font = 'bold 13px Segoe UI, sans-serif';
        rctx.textAlign = 'center';
        rctx.textBaseline = 'bottom';
        rctx.fillText(t.overheated ? 'HOT!' : Math.round(pct * 100) + '%', w/2, h - 2);
      } else {
      const info = t.reloadInfo ? t.reloadInfo() : null;
      if(info && info.active && info.total > 0){
        const pct = Math.min(1, Math.max(0, info.left / info.total));
        rctx.fillStyle = 'rgba(0,0,0,0.55)';
        rr(bx, by, barW, barH, 5);
        const loaded = 1 - pct;
        const fh = Math.max(2, barH * loaded);
        rctx.fillStyle = '#ffb12b';
        rr(bx, by + barH - fh, barW, fh, 5);
        rctx.fillStyle = '#fff';
        rctx.font = 'bold 13px Segoe UI, sans-serif';
        rctx.textAlign = 'center';
        rctx.textBaseline = 'bottom';
        rctx.fillText(Math.ceil(pct * 100) + '%', w/2, h - 2);
        if(info.magSize > 0){
          const n = info.magSize, m = Math.max(0, info.mag);
          const pw = 5, gap = 3, totalW = n * pw + (n - 1) * gap;
          for(let i = 0; i < n; i++){
            rctx.fillStyle = i < m ? '#ffb12b' : 'rgba(255,255,255,0.25)';
            rr(w/2 - totalW/2 + i * (pw + gap), 4, pw, pw, 2);
          }
        }
      }
      }
    }

    // Leaderboard: ALL tanks sorted by damage
    const sorted = [...this.tanks]
      .sort((a,b)=> b.damageDealt - a.damageDealt).slice(0,5);
    const lb = document.getElementById('lb-list');
    lb.innerHTML = sorted.map((o,i)=> `<li><span class="lname">${o.name}</span><span class="ldmg">${Math.round(o.damageDealt)}</span></li>`).join('');

    // GLADIATOR HUD: power counter, alive counter, zone/airdrop status
    if(this.glad){
      const pe = document.getElementById('glad-power');
      if(pe) pe.textContent = 'PWR ' + (this.localTank.power || 0) + ' (+' + Math.round((this.localTank.powerMult ? (this.localTank.powerMult() - 1) * 100 : 0)) + '%)';
      const le = document.getElementById('glad-left');
      if(le) le.textContent = 'Alive: ' + (this.glad.alive != null ? this.glad.alive : '-');
      const be = document.getElementById('glad-banner');
      if(be){
        const g = this.glad;
        let txt = '';
        if(g.phase === 'grace') txt = 'Zone warning in ' + Math.ceil(g.phaseTimer) + 's';
        else txt = 'Zone closes in ' + Math.ceil(g.phaseTimer) + 's';
        if(g.airdrop){
          if(!g.airdrop.landed) txt += '  |  Airdrop in ' + Math.ceil(g.airdrop.countdown) + 's';
          else{
            const holdT = this.localTank._gladHoldTime || 0;
            if(holdT > 0) txt += '  |  Hold in circle ' + Math.max(0, Math.ceil(g.airdrop.hold - holdT)) + 's';
            else txt += '  |  Airdrop landed - stand in blue circle';
          }
        }
        be.textContent = txt;
        be.classList.remove('hidden');
      }
    }

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

    this._updateSuperSlot();
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
    // GLADIATOR zone + airdrop markers on the big map
    if(this.glad){
      const g = this.glad;
      const drawZone = (h, color, width) => {
        const [x1, y1] = this.world.worldToMap(-h, -h, S);
        const [x2, y2] = this.world.worldToMap(h, h, S);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      };
      if(g.phase !== 'grace'){
        drawZone(Math.max(0, g.safeHalf), '#ff3030', 6);
        const [cx, cy] = this.world.worldToMap(0, 0, S);
        ctx.strokeStyle = '#ff3030';
        ctx.lineWidth = 8;
        const xr = 16;
        ctx.beginPath();
        ctx.moveTo(cx - xr, cy - xr); ctx.lineTo(cx + xr, cy + xr);
        ctx.moveTo(cx - xr, cy + xr); ctx.lineTo(cx + xr, cy - xr);
        ctx.stroke();
      }
      if(g.airdrop){
        const [ax, ay] = this.world.worldToMap(g.airdrop.x, g.airdrop.z, S);
        ctx.fillStyle = g.airdrop.landed ? '#00eeff' : 'rgba(0,230,255,0.55)';
        ctx.beginPath();
        ctx.arc(ax, ay, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#003d5c';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('DROP', ax, ay - 14);
      }
    }
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
    if(location.hash.indexOf('__dbg') >= 0) window.__game = game;
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