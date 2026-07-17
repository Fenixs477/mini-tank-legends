/* ============================================================
   menu.js — All UI: main menu, multiplayer, host/join, hidden
   code (copy + 5s toast), collections, settings (rebindable keys
   + aim-line opacity/color + view-range width), map editor
   launcher, ESC menu, background images, host map selection.
   ============================================================ */

const Menu = {
  settings: loadSettings(),
  hostCfg: { maxPlayers:8, isPublic:true, fakePlayers:4, code:'------', useCustomMap:false },
  escOpen: false,


  init(game){
    this.game = game;
    this._wireButtons();
    this._renderBinds();
    this._renderAimSettings();
    this._renderViewSettings();
    this._renderCamSettings();
    this._renderGraphicsSettings();
    this._renderCollections();
    this._wireSettingsTabs();
    this._renderProfile();
    this._applyBackgrounds();
    this._wireEsc();
    this._wireCodes();
    this._wireCollectionEdit();
    this._loadMysteryImg();
    this._initFullscreen();
    this._initScaling();
    this.show('menu-main');
    // Auto-join from URL param ?room=CODE
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room');
    if(roomCode && roomCode.length >= 4 && this.game){
      setTimeout(() => this.game.startClient(roomCode.toUpperCase()), 500);
    }
  },

  /* ============================================================
     Fullscreen / Orientation system
     ============================================================ */

  /* --- Platform detection --- */
  _detectPlatform(){
    const ua = navigator.userAgent;
    // iPadOS 13+ reports as Mac but has touch support
    const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(ua) && 'ontouchstart' in window && navigator.maxTouchPoints > 0);
    const isAndroid = /Android/i.test(ua);
    if(isIOS){
      if(window.navigator.standalone === true) return 'ios-standalone';
      try {
        if(window.matchMedia('(display-mode: standalone)').matches) return 'ios-standalone';
        if(window.matchMedia('(display-mode: fullscreen)').matches) return 'ios-standalone';
        if(window.matchMedia('(display-mode: minimal-ui)').matches) return 'ios-standalone';
      } catch(e){}
      return 'ios';
    }
    if(isAndroid) return 'android';
    return 'desktop';
  },

  _isFullscreen(){
    if(document.fullscreenElement || document.webkitFullscreenElement) return true;
    const w = window.innerWidth, h = window.innerHeight;
    if(h >= screen.height - 2 || h >= screen.availHeight - 2) return true;
    if(h >= screen.width - 2) return true;
    if(w >= screen.width - 1 && h >= screen.availHeight - 30) return true;
    if(w >= screen.height - 1 && h >= screen.availWidth - 30) return true;
    return false;
  },

  _requestFullscreen(){
    const el = document.documentElement;
    if(el.requestFullscreen){
      el.requestFullscreen().catch(() => {});
    } else if(el.webkitRequestFullscreen){
      el.webkitRequestFullscreen();
    }
  },

  /* --- Show only one section inside the overlay --- */
  _showSection(id){
    document.querySelectorAll('.fs-section').forEach(s => s.classList.add('hidden'));
    const el = document.getElementById(id);
    if(el) el.classList.remove('hidden');
  },

  /* --- Orientation polling --- */
  _startOrientationPoll(callback, interval){
    this._stopOrientationPoll();
    this._orientTimer = setInterval(() => {
      const result = callback();
      if(result === 'stop'){
        this._stopOrientationPoll();
      }
    }, interval || 200);
  },

  _stopOrientationPoll(){
    if(this._orientTimer){
      clearInterval(this._orientTimer);
      this._orientTimer = null;
    }
  },

  /* --- UI scaling --- */
  _initScaling(){
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Always treat viewport as landscape: longer side = width, shorter = height
      const vpW = Math.max(w, h);
      const vpH = Math.min(w, h);
      const scale = Math.min(vpW / 896, vpH / 414, 1.5); // cap at 1.5x
      document.documentElement.style.setProperty('--ui-scale', scale);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', () => setTimeout(update, 200));
  },

  /* --- Init: entry point --- */
  _initFullscreen(){
    this._fsDismissed = false;
    const overlay = document.getElementById('menu-fullscreen-prompt');
    if(!overlay) return;
    this._fullscreenOverlay = overlay;

    // Determine which sections to show/hide
    const update = (forceShow) => {
      if(overlay.classList.contains('hidden') && !forceShow) return;
      const isLandscape = window.innerWidth > window.innerHeight;
      const plat = this._detectPlatform();
      const isMobile = plat === 'ios' || plat === 'ios-standalone' || plat === 'android';

      if(!isMobile || isLandscape || this._fsDismissed){
        overlay.classList.add('hidden');
        return;
      }
      // Portrait on mobile
      this._showSection(plat === 'android' ? 'fs-android-rotate' : 'fs-ios-rotate');
      overlay.classList.remove('hidden');
    };

    // Also show during gameplay when rotated to portrait
    this._refreshFullscreenState = update;

    // Listen for orientation changes
    const onResize = () => {
      if(overlay.classList.contains('hidden') && !this._fsDismissed){
        // Show if we just rotated to portrait
        const isLandscape = window.innerWidth > window.innerHeight;
        const plat = this._detectPlatform();
        const isMobile = plat === 'ios' || plat === 'ios-standalone' || plat === 'android';
        if(isMobile && !isLandscape && !this._fsDismissed){
          update(true);
        }
      } else {
        // Hide if we just rotated to landscape
        update();
      }
    };
    window.addEventListener('resize', onResize);

    // Dismiss buttons
    document.getElementById('btn-ios-rotate-dismiss').onclick = () => {
      this._fsDismissed = true;
      overlay.classList.add('hidden');
    };
    document.getElementById('btn-android-rotate-dismiss').onclick = () => {
      this._fsDismissed = true;
      overlay.classList.add('hidden');
    };

    // Initial check
    update(true);
  },

  /* Re-check when returning to a menu or during gameplay */
  _refreshFullscreenState(){}, // placeholder, overridden in _initFullscreen

  _loadMysteryImg(){
    const img = new Image();
    img.src = 'mystery_mtl.png';
    this._mysteryImg = img;
  },

  show(id){
    this._stopMainPreview();
    document.querySelectorAll('.menu').forEach(m=> m.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('ui-layer').classList.remove('game-active');
    // Re-evaluate fullscreen overlay when returning to any menu
    this._refreshFullscreenState();
    if(id === 'menu-main'){
      if(!this._customMenuActive()){
        this._startMainPreview();
      }
      if(this._customMenuActive()) this._renderCustomMainMenu();
      else this._restoreDefaultMainMenu();
      this._renderProfile();
    }
    if(id === 'menu-collections'){
      this._collectionsFrames = null;
      this._collectionsEditMode = false;
      document.getElementById('ce-toggle').classList.remove('hidden');
      document.getElementById('ce-controls').classList.add('hidden');
      setTimeout(() => {
        this._renderCollections();
      }, 50);
    }
    if(id === 'menu-storage'){
      this._initStorageGrid();
    }
    if(id === 'menu-codes'){
      const revertBtn = document.getElementById('btn-revert-map');
      if(revertBtn) this._refreshRevertBtn(revertBtn);
    }
  },
  _customMenuActive(){ return localStorage.getItem('tankparty_custommainmenu') === '1'; },

  _renderCustomMainMenu(){
    const useCustom = localStorage.getItem('tankparty_custommainmenu') === '1';
    if(!useCustom) return;
    let data;
    try{ data = JSON.parse(localStorage.getItem('tankparty_menueditor')); }catch(e){}
    if(!data || !data.length){
      localStorage.removeItem('tankparty_custommainmenu');
      return;
    }
    // Hide sidebar, crates, and play button, show custom card
    const side = document.getElementById('main-menu-side');
    if(side) side.style.display = 'none';
    const crates = document.getElementById('main-menu-crates');
    if(crates) crates.style.display = 'none';
    const play = document.getElementById('btn-play');
    if(play) play.style.display = 'none';
    const card = document.getElementById('menu-custom-card');
    if(!card) return;
    card.classList.remove('hidden');
    card.innerHTML = '';
    card.style.cssText = 'width:100%;max-width:100%;height:100%;border:none;background:transparent;backdrop-filter:none;box-shadow:none;padding:0;position:relative;overflow:hidden';
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;inset:0;overflow:hidden';
    data.forEach(d=>{
      if(d.type === 'image' && d.imageData){
        const img = document.createElement('img');
        img.src = d.imageData;
        img.style.cssText = `position:absolute;left:${d.x}px;top:${d.y}px;width:${d.w}px;height:${d.h}px;pointer-events:none`;
        container.appendChild(img);
      } else if(d.type === 'button'){
        const btn = document.createElement('div');
        btn.textContent = d.label || 'Button';
        const hx = d.hitbox?.x != null ? d.hitbox.x : 0;
        const hy = d.hitbox?.y != null ? d.hitbox.y : 0;
        const hw = d.hitbox?.w || d.w;
        const hh = d.hitbox?.h || d.h;
        btn.style.cssText = `position:absolute;left:${d.x+hx}px;top:${d.y+hy}px;width:${hw}px;height:${hh}px;margin:0;background:${d.bgColor||'#383838'};color:#fff;display:flex;align-items:center;justify-content:center;border-radius:12px;cursor:pointer;font-weight:600;font-size:15px;letter-spacing:.5px;transition:.15s`;
        btn.onmouseover = ()=> btn.style.background = '#444';
        btn.onmouseout = ()=> btn.style.background = d.bgColor || '#383838';
        if(d.command && d.command !== 'none'){
          btn.onclick = ()=>{
            if(d.command === 'back'){
              localStorage.removeItem('tankparty_custommainmenu');
              Menu.show('menu-main');
              return;
            }
            if(d.command === 'singleplayer' && Menu.game){ Menu.game.startSingleplayer(); return; }
            if(d.command === 'preview'){ Menu.show('menu-preview'); return; }
            const el = document.querySelector(`[data-open="${d.command}"]`);
            if(el) el.click();
          };
        }
        container.appendChild(btn);
      }
    });
    const resetBtn = document.createElement('div');
    resetBtn.textContent = '← Default Menu';
    resetBtn.style.cssText = 'position:absolute;bottom:10px;left:50%;transform:translateX(-50%);color:var(--muted);font-size:12px;cursor:pointer;padding:8px 16px';
    resetBtn.onclick = ()=>{
      localStorage.removeItem('tankparty_custommainmenu');
      this.show('menu-main');
    };
    container.appendChild(resetBtn);
    card.appendChild(container);
  },

  _restoreDefaultMainMenu(){
    const side = document.getElementById('main-menu-side');
    if(side) side.style.display = '';
    const crates = document.getElementById('main-menu-crates');
    if(crates) crates.style.display = '';
    const play = document.getElementById('btn-play');
    if(play) play.style.display = '';
    const card = document.getElementById('menu-custom-card');
    if(card) card.classList.add('hidden');
  },
  _renderProfile(){
    const s = this.settings;
    const nameEl = document.getElementById('profile-name');
    const clanEl = document.getElementById('profile-clan');
    const coinEl = document.querySelector('.profile-coin');
    const crystalEl = document.querySelector('.profile-crystal');
    if(nameEl){
      nameEl.textContent = s.playerName || 'Player';
      nameEl.style.cursor = 'pointer';
      nameEl.title = 'Click to rename';
      nameEl.onclick = (e) => {
        e.stopPropagation();
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = s.playerName || 'Player';
        inp.maxLength = 16;
        inp.className = 'profile-name-input';
        inp.style.cssText = 'font:inherit;background:rgba(255,255,255,0.1);border:1px solid var(--accent);border-radius:4px;color:#fff;padding:2px 6px;width:140px;outline:none';
        nameEl.replaceWith(inp);
        inp.focus();
        inp.select();
        const done = () => {
          const v = inp.value.trim() || 'Player';
          s.playerName = v;
          saveSettings(s);
          nameEl.textContent = v;
          inp.replaceWith(nameEl);
        };
        inp.onblur = done;
        inp.onkeydown = (ke) => { if(ke.code==='Enter'){ ke.preventDefault(); inp.blur(); } };
      };
    }
    if(clanEl) clanEl.textContent = s.playerClan || '';
    if(coinEl) coinEl.textContent = (s.coins||0) + ' 🪙';
    if(crystalEl) crystalEl.textContent = (s.crystals||0) + ' 💎';
  },
  showHUD(){ document.querySelectorAll('.menu').forEach(m=> m.classList.add('hidden'));
    document.getElementById('hud').classList.remove('hidden'); },

  toast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(()=> t.classList.add('hidden'), 5000);
  },

  /* ---------- background images (auto-detect; falls back to gradient) ---------- */
  _applyBackgrounds(){
    const tryImg = (url, el)=>{
      const i = new Image();
      i.onload = ()=>{ el.style.backgroundImage = `linear-gradient(rgba(10,10,10,.55),rgba(10,10,10,.75)), url(${url})`; el.style.backgroundSize='cover'; el.style.backgroundPosition='center'; };
      i.onerror = ()=>{};
      i.src = url;
    };
    tryImg('tank party.jpg', document.getElementById('menu-main'));
    tryImg('tank party.jpg', document.getElementById('menu-multiplayer'));
  },

  /* ---------- free roam ---------- */
  _startFreeRoam(){
    if(typeof NakamaNet === 'undefined'){
      this.toast('Nakama not available — use Battle Mode → Private Room');
      return;
    }
    if(!NakamaNet.socket || !NakamaNet.socket.isConnected){
      this.toast('Connecting to world server...');
      NakamaNet.connectSocket().then(() => {
        this.game.startFreeRoam();
      }).catch(e => {
        this.toast('Could not connect: ' + (e.message || 'server offline'));
      });
      return;
    }
    this.game.startFreeRoam();
  },

  /* ---------- wiring ---------- */
  _wireButtons(){
    document.querySelectorAll('[data-open]').forEach(b=>{
      b.onclick = ()=>{
        const t = b.dataset.open;
        if(t==='singleplayer'){ this.game.startSingleplayer(); return; }
        this.show('menu-'+t);
      };
    });
    document.querySelectorAll('[data-back]').forEach(b=>{
      b.onclick = ()=> this.show(b.dataset.back);
    });

    // multiplayer screen
    document.getElementById('btn-host-room').onclick = ()=>{
      this.hostCfg.code = Net.staticCode();
      this._refreshHostCode();
      this._refreshMapChoice();
      this.show('menu-host');
    };
    document.getElementById('btn-join-room').onclick = async ()=>{
      this.show('menu-join');
      const list = document.getElementById('room-list');
      list.innerHTML = '<div class="muted">Searching for public rooms…</div>';
      const rooms = await Net.listPublicRooms();
      if(!rooms.length){
        list.innerHTML = '<div class="muted">No public rooms found.<br>You can host one, or join a hidden room with a code.</div>';
        return;
      }
      list.innerHTML='';
      rooms.forEach(r=>{
        const row = document.createElement('div'); row.className='room-row';
        row.innerHTML = `<div><div class="rn">Room ${r.code}</div><div class="rm">${r.name||'Public'} • ${r.count||0}/${r.max||8}</div></div><div>Join →</div>`;
        row.onclick = ()=> this.game.startClient(r.code);
        list.appendChild(row);
      });
    };
    document.getElementById('btn-join-hidden').onclick = ()=> this.show('menu-join-hidden');

    // host settings
    document.querySelectorAll('.seg-opt').forEach(o=>{
      o.onclick = ()=>{
        o.parentElement.querySelectorAll('.seg-opt').forEach(x=>x.classList.remove('active'));
        o.classList.add('active');
        this.hostCfg.isPublic = (o.dataset.vis === 'public');
        document.getElementById('host-code-row').classList.toggle('hidden', this.hostCfg.isPublic);
      };
    });
    document.getElementById('host-maxplayers').oninput = e=> this.hostCfg.maxPlayers = Math.max(1,Math.min(20,+e.target.value||1));
    document.getElementById('host-fakeplayers').oninput = e=> this.hostCfg.fakePlayers = Math.max(0,Math.min(20,+e.target.value||0));
    document.getElementById('host-code').onclick = ()=> this._copyCode();
    document.getElementById('btn-copy-link').onclick = ()=> this._copyInviteLink();
    document.getElementById('btn-start-host').onclick = ()=>{
      this.game.setUseCustomMap(this.hostCfg.useCustomMap);
      this.game.startHost(this.hostCfg);
    };
    // map choice in host screen
    const mapBig = document.getElementById('host-map-big');
    const mapMine = document.getElementById('host-map-mine');
    if(mapBig) mapBig.onclick = ()=>{ this.hostCfg.useCustomMap=false; this._refreshMapChoice(); };
    if(mapMine) mapMine.onclick = ()=>{ this.hostCfg.useCustomMap=true; this._refreshMapChoice(); };

    // hidden join
    document.getElementById('btn-connect-hidden').onclick = ()=>{
      const code = document.getElementById('hidden-code-input').value.trim().toUpperCase();
      if(code.length<4){ this.toast('Enter a valid code'); return; }
      this.game.startClient(code);
    };
    document.getElementById('bigmap-close').onclick = ()=> document.getElementById('bigmap').classList.add('hidden');
    document.getElementById('minimap-btn').onclick = ()=> this.game.openBigMap();

    // Play buttons
    const btnPlay = document.getElementById('btn-play');
    if(btnPlay) btnPlay.onclick = ()=> this.show('menu-play-select');
    // Free Roam / Battle Mode (index.html)
    const btnPlayFree = document.getElementById('btn-play-freeroam');
    if(btnPlayFree) btnPlayFree.onclick = ()=>{ if(this.game) this._startFreeRoam(); };
    const btnPlayBattle = document.getElementById('btn-play-battle');
    if(btnPlayBattle) btnPlayBattle.onclick = ()=> this.show('menu-battle-select');
    const btnBattleSP = document.getElementById('btn-battle-sp');
    if(btnBattleSP) btnBattleSP.onclick = ()=>{ if(this.game) this.game.startSingleplayer(); };
    const btnBattleMP = document.getElementById('btn-battle-mp');
    if(btnBattleMP) btnBattleMP.onclick = ()=> this.show('menu-multiplayer');
    const btnPlayBack = document.getElementById('btn-play-back');
    if(btnPlayBack) btnPlayBack.onclick = ()=> this.show('menu-main');
    // Legacy (tank-party.html)
    const btnPlaySP = document.getElementById('btn-play-sp');
    if(btnPlaySP) btnPlaySP.onclick = ()=>{ if(this.game) this.game.startSingleplayer(); };
    const btnPlayMP = document.getElementById('btn-play-mp');
    if(btnPlayMP) btnPlayMP.onclick = ()=> this.show('menu-multiplayer');

    // Settings: reset and save&exit
    const btnReset = document.getElementById('btn-settings-reset');
    const btnSaveExit = document.getElementById('btn-settings-saveexit');
    if(btnReset) btnReset.onclick = ()=>{
      this.settings = resetSettings();
      saveSettings(this.settings);
      this._renderBinds();
      this._renderAimSettings();
      this._renderViewSettings();
      this._renderCamSettings();
      this._renderGraphicsSettings();
      this._wireSettingsTabs();
      if(this.game) this.game.applySettings(this.settings);
      this.toast('Settings reset to defaults');
    };
    if(btnSaveExit) btnSaveExit.onclick = ()=>{
      saveSettings(this.settings);
      this.show('menu-main');
    };

    // Preview back button
    const pb = document.getElementById('btn-preview-back');
    if(pb) pb.onclick = ()=>{ this._closePreview(); this.show('menu-main'); };

    // ESC menu buttons
    document.getElementById('esc-yes').onclick = ()=>{ this._closeEsc(); this.game.leaveToMenu(); };
    document.getElementById('esc-no').onclick  = ()=> this._closeEsc();
  },

  /* ---------- Tank Preview ---------- */
  _previewRenderer: null,
  _previewScene: null,
  _previewCamera: null,
  _previewTank: null,
  _previewLoopId: null,

  _initPreview(){
    this._closePreview(); // cleanup any previous
    const id = this.settings.selectedTank;
    const def = TANKS[id];
    if(!def) return;

    document.getElementById('preview-name').textContent = def.name;
    document.getElementById('preview-loading').style.display = 'flex';
    document.getElementById('preview-stats').innerHTML =
      `HP ${def.hp} &bull; DMG ${def.damage} &bull; Speed ${def.speed} &bull; Reload ${def.reload}s<br>Mass ${def.mass} &bull; View Range ${def.viewRange}m`;

    const host = document.getElementById('preview-canvas-host');
    const W = host.clientWidth || 480;
    const H = host.clientHeight || 320;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x20242a);
    this._previewScene = scene;

    const cam = new THREE.PerspectiveCamera(40, W/H, 0.1, 100);
    cam.position.set(8, 6, 8);
    cam.lookAt(0, 0, 0);
    this._previewCamera = cam;

    const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    host.innerHTML = '';
    host.appendChild(renderer.domElement);
    this._previewRenderer = renderer;

    // Lights
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x55502e, 1.2);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4dc, 1.5);
    sun.position.set(10, 20, 10);
    sun.castShadow = true;
    scene.add(sun);
    scene.add(sun.target);
    const amb = new THREE.AmbientLight(0x6a6a78, 0.5);
    scene.add(amb);

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(16, 16);
    groundGeo.rotateX(-Math.PI/2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2a2f2a, roughness: 0.9, metalness: 0.05
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    // Build tank
    const previewTank = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: def.color, roughness: 0.65, metalness: 0.2
    });
    const b = def.body;
    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.l), bodyMat);
    bodyMesh.position.y = b.h/2;
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    previewTank.add(bodyMesh);
    try{ previewTank.add(Tank.createOutlineMesh(bodyMesh)); }catch(e){}
    // Treads
    const treadMat = new THREE.MeshStandardMaterial({color: 0x222226, roughness: 1});
    [-1, 1].forEach(s => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, b.l+0.2), treadMat);
      t.position.set(s*(b.w/2+0.05), 0.25, 0);
      t.castShadow = true;
      previewTank.add(t);
    });

    // Turret
    const turretGroup = new THREE.Group();
    const tDef = def.turret;
    const turretMat = new THREE.MeshStandardMaterial({
      color: def.turretColor, roughness: 0.65, metalness: 0.2
    });
    const turretMesh = new THREE.Mesh(new THREE.BoxGeometry(tDef.w, tDef.h, tDef.l), turretMat);
    turretMesh.position.y = tDef.h/2;
    turretMesh.castShadow = true;
    turretGroup.add(turretMesh);
    try{ turretGroup.add(Tank.createOutlineMesh(turretMesh)); }catch(e){}

    // Barrel
    const barrelMat = new THREE.MeshStandardMaterial({color: 0x2a2a2e, roughness: 0.65, metalness: 0.2});
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(def.barrelR, def.barrelR, def.barrelLen, 10),
      barrelMat
    );
    barrel.rotation.x = Math.PI/2;
    barrel.position.set(0, tDef.h*0.4, tDef.l/2 + def.barrelLen/2);
    barrel.castShadow = true;
    turretGroup.add(barrel);

    turretGroup.position.y = b.h;
    previewTank.add(turretGroup);
    previewTank.position.y = 0;

    scene.add(previewTank);
    this._previewTank = previewTank;

    document.getElementById('preview-loading').style.display = 'none';

    // Animation loop
    let angle = 0;
    const loop = () => {
      this._previewLoopId = requestAnimationFrame(loop);
      angle += 0.008;
      previewTank.rotation.y = angle;
      turretGroup.rotation.y = Math.sin(angle * 0.7) * 0.4;
      renderer.render(scene, cam);
    };
    loop();
  },

  _closePreview(){
    if(this._previewLoopId){
      cancelAnimationFrame(this._previewLoopId);
      this._previewLoopId = null;
    }
    if(this._previewRenderer){
      this._previewRenderer.dispose();
      this._previewRenderer = null;
    }
    this._previewScene = null;
    this._previewCamera = null;
    this._previewTank = null;
  },

  /* ---------- Main Menu Inline Preview ---------- */
  _mainPreviewRenderer: null,
  _mainPreviewScene: null,
  _mainPreviewCam: null,
  _mainPreviewTank: null,
  _mainPreviewLoopId: null,
  _mainPreviewTurretGroup: null,

  _startMainPreview(){
    const host = document.getElementById('main-menu-preview-canvas');
    if(!host) return;
    const def = TANKS[this.settings.selectedTank];
    if(!def) return;

    const W = host.clientWidth || 320;
    const H = host.clientHeight || 220;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    this._mainPreviewScene = scene;

    const previewDist = 7, previewH = previewDist*0.78+3;
    const cam = new THREE.PerspectiveCamera(55, W/H, 0.1, 100);
    cam.position.set(0, previewH, -previewDist);
    cam.lookAt(0, 1.2, 0);
    this._mainPreviewCam = cam;

    const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.innerHTML = '';
    host.appendChild(renderer.domElement);
    this._mainPreviewRenderer = renderer;

    const hemi = new THREE.HemisphereLight(0xdfeaff, 0xbbbbbb, 0.8);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(10, 20, 10);
    scene.add(sun);
    const amb = new THREE.AmbientLight(0xaaaaaa, 0.6);
    scene.add(amb);

    const previewTank = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({color: def.color, roughness: 0.65, metalness: 0.2});
    const b = def.body;
    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.l), bodyMat);
    bodyMesh.position.y = b.h/2;
    bodyMesh.castShadow = true;
    previewTank.add(bodyMesh);
    try{ previewTank.add(Tank.createOutlineMesh(bodyMesh)); }catch(e){}

    const treadMat = new THREE.MeshStandardMaterial({color: 0x222226, roughness: 1});
    [-1, 1].forEach(s => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, b.l+0.2), treadMat);
      t.position.set(s*(b.w/2+0.05), 0.25, 0);
      t.castShadow = true;
      previewTank.add(t);
    });

    const turretGroup = new THREE.Group();
    const tDef = def.turret;
    const turretMat = new THREE.MeshStandardMaterial({color: def.turretColor, roughness: 0.65, metalness: 0.2});
    const turretMesh = new THREE.Mesh(new THREE.BoxGeometry(tDef.w, tDef.h, tDef.l), turretMat);
    turretMesh.position.y = tDef.h/2;
    turretMesh.castShadow = true;
    turretGroup.add(turretMesh);
    try{ turretGroup.add(Tank.createOutlineMesh(turretMesh)); }catch(e){}

    const barrelMat = new THREE.MeshStandardMaterial({color: 0x2a2a2e, roughness: 0.65, metalness: 0.2});
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(def.barrelR, def.barrelR, def.barrelLen, 10), barrelMat);
    barrel.rotation.x = Math.PI/2;
    barrel.position.set(0, tDef.h*0.4, tDef.l/2 + def.barrelLen/2);
    barrel.castShadow = true;
    turretGroup.add(barrel);

    turretGroup.position.y = b.h;
    previewTank.add(turretGroup);
    scene.add(previewTank);
    this._mainPreviewTank = previewTank;
    this._mainPreviewTurretGroup = turretGroup;
    this._mainPreviewTrails = [];
    let trailTimer = 0;
    let turretAim = 0;
    let turretTimer = 0;

    let t = 0;
    let heading = 0;
    const turnSpeed = 1.5;

    const loop = () => {
      this._mainPreviewLoopId = requestAnimationFrame(loop);
      t += 0.016;

      const fwd = Math.max(0.02, 0.4 + 0.55 * Math.sin(t * 0.05));
      let turnDir = 0;
      const turnPulse = Math.sin(t * 0.045) + Math.sin(t * 0.033) + Math.sin(t * 0.019);
      if(Math.abs(turnPulse) > 2.15) turnDir = Math.sign(turnPulse) * 0.6;
      heading += turnDir * turnSpeed * 0.016;
      const sx = Math.sin(heading) * fwd * 3.5 * 0.016;
      const sz = Math.cos(heading) * fwd * 3.5 * 0.016;
      const px = previewTank.position.x + sx;
      const pz = previewTank.position.z + sz;
      previewTank.position.set(px, 0, pz);
      previewTank.rotation.y = heading;
      turretTimer += 0.016;
      if(turretTimer > 2.5 + Math.sin(t * 0.11) * 1.2){
        turretTimer = 0;
        turretAim = Math.sin(t * 0.23) * 0.9 + Math.sin(t * 0.09) * 0.3;
      }
      turretGroup.rotation.y += (turretAim - turretGroup.rotation.y) * 0.045;

      cam.position.lerp(new THREE.Vector3(
        px - Math.sin(heading) * previewDist,
        previewH,
        pz - Math.cos(heading) * previewDist
      ), 0.08);
      cam.lookAt(px, 1.2, pz);

      // Track trails
      const spd = Math.abs(fwd) * 3.5;
      if(spd > 0.5){
        trailTimer += 0.016;
        if(trailTimer >= Math.max(0.05, 0.8 / spd)){
          trailTimer = 0;
          if(!Menu._trailGeo){
            Menu._trailGeo = new THREE.BoxGeometry(0.35, 0.02, 0.5);
          }
          const off = def.body.w/2 + 0.05;
          const back = -def.body.l/2;
          const ch = Math.cos(heading), sh = Math.sin(heading);
          const order = this._mainPreviewTrails.length;
          [-1, 1].forEach(side => {
            const mat = new THREE.MeshBasicMaterial({color:0x1a1a1a, transparent:true, opacity:0.45, depthWrite:false});
            const mesh = new THREE.Mesh(Menu._trailGeo, mat);
            mesh.position.set(px + side*off*ch + back*sh, 0.01, pz - side*off*sh + back*ch);
            mesh.rotation.y = heading;
            mesh.renderOrder = order;
            scene.add(mesh);
            this._mainPreviewTrails.push({mesh, life:2, maxLife:2});
          });
        }
      }

      for(let i=this._mainPreviewTrails.length-1; i>=0; i--){
        const seg = this._mainPreviewTrails[i];
        seg.life -= 0.016;
        seg.mesh.material.opacity = (seg.life / seg.maxLife) * 0.45;
        if(seg.life <= 0){
          scene.remove(seg.mesh);
          seg.mesh.material.dispose();
          this._mainPreviewTrails.splice(i, 1);
        }
      }
      while(this._mainPreviewTrails.length > 200){
        const old = this._mainPreviewTrails.shift();
        scene.remove(old.mesh);
        old.mesh.material.dispose();
      }

      renderer.render(scene, cam);
    };

    // Resize handler for orientation changes
    const onResize = () => {
      const w = host.clientWidth || 320;
      const h = host.clientHeight || 220;
      renderer.setSize(w, h);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    this._mainPreviewResizeHandler = onResize;

    loop();
  },

  _stopMainPreview(){
    if(this._mainPreviewResizeHandler){
      window.removeEventListener('resize', this._mainPreviewResizeHandler);
      this._mainPreviewResizeHandler = null;
    }
    if(this._mainPreviewLoopId){
      cancelAnimationFrame(this._mainPreviewLoopId);
      this._mainPreviewLoopId = null;
    }
    if(this._mainPreviewRenderer){
      this._mainPreviewRenderer.dispose();
      this._mainPreviewRenderer = null;
    }
    if(this._mainPreviewTrails){
      this._mainPreviewTrails.forEach(s => {
        if(this._mainPreviewScene) this._mainPreviewScene.remove(s.mesh);
        s.mesh.material.dispose();
      });
      this._mainPreviewTrails = null;
    }
    this._mainPreviewScene = null;
    this._mainPreviewCam = null;
    this._mainPreviewTank = null;
    this._mainPreviewTurretGroup = null;
    const host = document.getElementById('main-menu-preview-canvas');
    if(host) host.innerHTML = '';
  },

  _refreshHostCode(){
    document.getElementById('host-code').textContent = this.hostCfg.code;
    document.getElementById('host-code-row').classList.toggle('hidden', this.hostCfg.isPublic);
  },
  _refreshMapChoice(){
    const big = document.getElementById('host-map-big');
    const mine = document.getElementById('host-map-mine');
    if(!big || !mine) return;
    big.classList.toggle('selected', !this.hostCfg.useCustomMap);
    mine.classList.toggle('selected', this.hostCfg.useCustomMap);
    mine.classList.toggle('disabled', !hasCustomMap());
    if(!hasCustomMap() && this.hostCfg.useCustomMap){ this.hostCfg.useCustomMap=false; big.classList.add('selected'); }
  },

  async _copyCode(){
    try{
      await navigator.clipboard.writeText(this.hostCfg.code);
      this.toast('Copied to clipboard');
    }catch(e){
      const ta=document.createElement('textarea'); ta.value=this.hostCfg.code;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      this.toast('Copied to clipboard');
    }
  },

  _copyInviteLink(){
    const url = window.location.origin + window.location.pathname + '?room=' + this.hostCfg.code;
    try{
      navigator.clipboard.writeText(url).then(() => this.toast('Invite link copied!')).catch(() => this._fallbackCopy(url));
    }catch(e){
      this._fallbackCopy(url);
    }
  },
  _fallbackCopy(text){
    const ta=document.createElement('textarea'); ta.value=text;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    this.toast('Invite link copied!');
  },

  /* ---------- ESC menu (works anywhere) ---------- */
  _wireEsc(){
    var self = this;
    window.addEventListener('keydown', e=>{
      if(e.code!=='Escape') return;
      // ignore ESC while typing in an input
      if(document.activeElement && /input|textarea/i.test(document.activeElement.tagName)) return;
      // ignore if a big map is open
      if(!document.getElementById('bigmap').classList.contains('hidden')){
        document.getElementById('bigmap').classList.add('hidden'); return;
      }
      // Settings/storage/collections/store → go to main menu directly (no confirmation popup)
      var visibleMenu = document.querySelector('.menu:not(.hidden)');
      if(visibleMenu){
        var mid = visibleMenu.id;
        if(mid === 'menu-settings' || mid === 'menu-storage' || mid === 'menu-collections' || mid === 'menu-store'){
          if(mid === 'menu-settings' && self.settings) saveSettings(self.settings);
          self.show('menu-main');
          return;
        }
      }
      this.toggleEsc();
    });
  },
  toggleEsc(){
    if(this.escOpen){ this._closeEsc(); }
    else{
      document.getElementById('esc-menu').classList.remove('hidden');
      this.escOpen = true;
    }
  },
  _closeEsc(){
    document.getElementById('esc-menu').classList.add('hidden');
    this.escOpen = false;
  },

  /* ---------- settings binds ---------- */
  _renderBinds(){
    const wrap = document.getElementById('bind-list');
    wrap.innerHTML='';
    Object.keys(DEFAULT_BINDS).forEach(action=>{
      const row = document.createElement('div'); row.className='bind-row';
      row.innerHTML = `<div class="bl">${DEFAULT_BINDS[action].label}</div><div class="bind-key" data-action="${action}">${this._keyLabel(this.settings.binds[action])}</div>`;
      wrap.appendChild(row);
    });
    wrap.querySelectorAll('.bind-key').forEach(el=>{
      el.onclick = async ()=>{
        el.classList.add('binding'); el.textContent='Press a key / wheel…';
        const captured = await Input.captureBind();
        this.settings.binds[el.dataset.action] = captured;
        saveSettings(this.settings);
        el.classList.remove('binding');
        el.textContent = this._keyLabel(captured);
        this.game.applySettings(this.settings);
      };
    });
  },
  _keyLabel(k){
    if(k==='LMB') return 'LMB';
    if(k==='WheelUp') return 'Wheel ↑';
    if(k==='WheelDown') return 'Wheel ↓';
    if(k==='Space') return 'Space';
    if(k.startsWith('Key')) return k.slice(3);
    if(k.startsWith('Arrow')) return k.slice(5)+' arrow';
    return k;
  },

  /* ---------- aim line settings ---------- */
  _renderAimSettings(){
    const wrap = document.getElementById('aim-settings');
    if(!wrap) return;
    const des = this.settings.aimLineDesign || 'default';
    wrap.innerHTML = `
      <label>Trajectory line opacity: <span id="aim-op-val">${Math.round(this.settings.aimLineOpacity*100)}%</span></label>
      <input type="range" id="aim-op" min="0" max="100" value="${Math.round(this.settings.aimLineOpacity*100)}">
      <label>Trajectory line color</label>
      <input type="color" id="aim-color" value="${this.settings.aimLineColor}">
      <label>Trajectory line design</label>
      <div class="seg">
        <div class="seg-opt${des==='default'?' active':''}" data-aimdes="default">Default</div>
        <div class="seg-opt${des==='professional'?' active':''}" data-aimdes="professional">Professional</div>
      </div>
      <label style="margin-top:18px">
        <input type="checkbox" id="rico-toggle" ${this.settings.ricochetIndicator?'checked':''}>
        Ricochet indicator <span style="color:var(--muted);font-size:11px">(colored lines on target)</span>
      </label>`;
    document.getElementById('aim-op').oninput = e=>{
      this.settings.aimLineOpacity = +e.target.value/100;
      document.getElementById('aim-op-val').textContent = e.target.value+'%';
      saveSettings(this.settings); this.game.applySettings(this.settings);
    };
    document.getElementById('aim-color').oninput = e=>{
      this.settings.aimLineColor = e.target.value;
      saveSettings(this.settings); this.game.applySettings(this.settings);
    };
    wrap.querySelectorAll('[data-aimdes]').forEach(el=>{
      el.onclick = ()=>{
        wrap.querySelectorAll('[data-aimdes]').forEach(x=>x.classList.remove('active'));
        el.classList.add('active');
        this.settings.aimLineDesign = el.dataset.aimdes;
        saveSettings(this.settings); this.game.applySettings(this.settings);
      };
    });
    const ricoToggle = document.getElementById('rico-toggle');
    if(ricoToggle) ricoToggle.onchange = e=>{
      this.settings.ricochetIndicator = e.target.checked;
      saveSettings(this.settings); this.game.applySettings(this.settings);
    };
  },

  /* Tab switching for settings */
  _wireSettingsTabs(){
    document.querySelectorAll('.settings-tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        const content = document.getElementById('tab-' + tab.dataset.tab);
        if(content) content.classList.add('active');
      };
    });
  },

  /* ---------- view-range settings (opacity + color + WIDTH) ---------- */
  _renderViewSettings(){
    const wrap = document.getElementById('view-settings');
    if(!wrap) return;
    const w = Math.round(this.settings.viewRangeWidth * 100);
    wrap.innerHTML = `
      <label>View-range circle opacity: <span id="view-op-val">${Math.round(this.settings.viewRangeOpacity*100)}%</span></label>
      <input type="range" id="view-op" min="0" max="100" value="${Math.round(this.settings.viewRangeOpacity*100)}">
      <label>View-range circle color</label>
      <input type="color" id="view-color" value="${this.settings.viewRangeColor}">
      <label>View-range circle width (0% = thin ring, 100% = fat ring): <span id="view-width-val">${w}%</span></label>
      <input type="range" id="view-width" min="0" max="100" value="${w}">`;
    document.getElementById('view-op').oninput = e=>{
      this.settings.viewRangeOpacity = +e.target.value/100;
      document.getElementById('view-op-val').textContent = e.target.value+'%';
      saveSettings(this.settings); this.game.applySettings(this.settings);
    };
    document.getElementById('view-color').oninput = e=>{
      this.settings.viewRangeColor = e.target.value;
      saveSettings(this.settings); this.game.applySettings(this.settings);
    };
    document.getElementById('view-width').oninput = e=>{
      this.settings.viewRangeWidth = +e.target.value/100;
      document.getElementById('view-width-val').textContent = e.target.value+'%';
      saveSettings(this.settings); this.game.applySettings(this.settings);
    };
  },

  /* ---------- camera rotation (desktop arrows, phone auto-buttons) ---------- */
  _renderCamSettings(){
    const wrap = document.getElementById('cam-settings');
    if(!wrap) return;
    wrap.innerHTML = `
      <label>Camera Rotation</label>
      <div class="cam-rotate-row">
        <span class="cam-rotate-btn" id="cam-rotate-left">←</span>
        <span class="cam-rotate-label">rotate left / right</span>
        <span class="cam-rotate-btn" id="cam-rotate-right">→</span>
      </div>
      <div class="hint">Keyboard: ArrowLeft / ArrowRight (rebindable in Controls above)</div>`;
    document.getElementById('cam-rotate-left').onclick = ()=>{
      this.settings.camRotation = (this.settings.camRotation || 0) - Math.PI/4;
      saveSettings(this.settings);
      if(this.game) this.game.applySettings(this.settings);
    };
    document.getElementById('cam-rotate-right').onclick = ()=>{
      this.settings.camRotation = (this.settings.camRotation || 0) + Math.PI/4;
      saveSettings(this.settings);
      if(this.game) this.game.applySettings(this.settings);
    };
  },

  /* ---------- graphics quality ---------- */
  _renderGraphicsSettings(){
    const wrap = document.getElementById('graphics-settings');
    if(!wrap) return;
    const q = this.settings.graphicsQuality || 'default';
    wrap.innerHTML = `
      <label>Graphics Quality</label>
      <div class="seg">
        <div class="seg-opt${q==='default'?' active':''}" data-gfx="default">Default</div>
        <div class="seg-opt${q==='fancy'?' active':''}" data-gfx="fancy">Fancy</div>
      </div>
      <div class="hint">Fancy enables ground shadows &amp; longer view distance</div>`;
    wrap.querySelectorAll('[data-gfx]').forEach(el=>{
      el.onclick = ()=>{
        wrap.querySelectorAll('[data-gfx]').forEach(x=>x.classList.remove('active'));
        el.classList.add('active');
        this.settings.graphicsQuality = el.dataset.gfx;
        saveSettings(this.settings);
        this.game.applySettings(this.settings);
      };
    });
  },

  /* ---------- collections ---------- */
  _wireCollectionEdit(){
    document.getElementById('ce-toggle').onclick = () => this._toggleCollectionsEdit();
  },
  _loadCollectionsLayout(){
    try{
      const d = JSON.parse(localStorage.getItem('tankparty_collections_layout'));
      if(d && d.frames && Array.isArray(d.frames)){ this._savedLayout = d.frames; return; }
    }catch(e){}
    this._savedLayout = null;
  },
  _applyCollectionsLayout(){
    if(!this._savedLayout || !this._savedLayout.length) return;
    const defs = [
      { tankId:'coolbuddy' }, { tankId:'striker', scale:1.1 }, { tankId:'ghost' },
      { tankId:null, label:'Coming Soon!', scale:0.8 }, { tankId:'sturmratte' },
      { tankId:null, label:'Coming Soon!' }, { tankId:null, label:'Coming Soon!' },
      { tankId:null, label:'Coming Soon!' }, { tankId:null, label:'Coming Soon!' },
      { tankId:null, label:'Coming Soon!' }, { tankId:null, label:'Coming Soon!' },
      { tankId:null, label:'Coming Soon!' }, { tankId:null, label:'Coming Soon!' },
      { tankId:null, label:'Coming Soon!' }, { tankId:'helix' },
    ];
    this._collectionsFrames = this._savedLayout.map((s, i) => ({
      x: s.x, y: s.y, w: s.w, h: s.h, scale: s.scale || 1,
      tankId: s.tankId !== undefined ? s.tankId : (defs[i]?.tankId || null),
      label: s.tankId !== undefined ? (s.tankId ? undefined : (s.label || 'Coming Soon!')) : (defs[i]?.label || 'Coming Soon!')
    }));
  },

  _renderCollections(){
    const canvas = document.getElementById('collections-overlay');
    if(!canvas) return;
    const img = document.getElementById('collections-img');
    if(!img) return;
    const W = img.offsetWidth || img.naturalWidth;
    const H = img.offsetHeight || img.naturalHeight;
    if (!W || !H) { setTimeout(() => this._renderCollections(), 100); return; }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const imgW = 3782, imgH = 691;
    const scaleX = W / imgW;
    const scaleY = H / imgH;

    if(!this._collectionsFrames){
      this._loadCollectionsLayout();
      this._collectionsFrames = [
        { x:129, y:142, w:270, h:140, tankId:'coolbuddy', scale:1 },
        { x:125, y:308, w:270, h:195, tankId:'striker', scale:1.1 },
        { x:471, y:138, w:270, h:140, tankId:'ghost', scale:1 },
        { x:440, y:333, w:344, h:188, tankId:null, label:'Coming Soon!', scale:0.8 },
        { x:785, y:136, w:320, h:140, tankId:'sturmratte', scale:1 },
        { x:1466, y:134, w:276, h:149, tankId:null, label:'Coming Soon!', scale:1 },
        { x:1812, y:135, w:276, h:149, tankId:null, label:'Coming Soon!', scale:1 },
        { x:2159, y:136, w:276, h:149, tankId:null, label:'Coming Soon!', scale:1 },
        { x:1813, y:349, w:276, h:149, tankId:null, label:'Coming Soon!', scale:1 },
        { x:2806, y:137, w:276, h:149, tankId:null, label:'Coming Soon!', scale:1 },
        { x:2806, y:351, w:276, h:149, tankId:null, label:'Coming Soon!', scale:1 },
        { x:3152, y:137, w:276, h:149, tankId:null, label:'Coming Soon!', scale:1 },
        { x:3151, y:351, w:276, h:149, tankId:null, label:'Coming Soon!', scale:1 },
        { x:3497, y:136, w:276, h:149, tankId:null, label:'Coming Soon!', scale:1 },
        { x:1461, y:318, w:280, h:180, tankId:'helix', scale:1 },
      ];
      this._applyCollectionsLayout();
    }

    const isUnlocked = (id) => this.settings.allUnlocked || (this.settings.unlockedTanks||[]).includes(id);

    const drawMystery = (x, y, w, h) => {
      const pad = 4;
      ctx.fillStyle = 'rgba(60,60,60,0.85)';
      ctx.beginPath();
      const r = 6;
      ctx.moveTo(x+pad+r, y+pad);
      ctx.lineTo(x+w-pad-r, y+pad);
      ctx.quadraticCurveTo(x+w-pad, y+pad, x+w-pad, y+pad+r);
      ctx.lineTo(x+w-pad, y+h-pad-r);
      ctx.quadraticCurveTo(x+w-pad, y+h-pad, x+w-pad-r, y+h-pad);
      ctx.lineTo(x+pad+r, y+h-pad);
      ctx.quadraticCurveTo(x+pad, y+h-pad, x+pad, y+h-pad-r);
      ctx.lineTo(x+pad, y+pad+r);
      ctx.quadraticCurveTo(x+pad, y+pad, x+pad+r, y+pad);
      ctx.closePath();
      ctx.fill();
      if(this._mysteryImg && this._mysteryImg.complete && this._mysteryImg.naturalWidth) {
        const mw = this._mysteryImg.naturalWidth;
        const mh = this._mysteryImg.naturalHeight;
        const s = Math.min((w-pad*4)/mw, (h-pad*4)/mh);
        ctx.drawImage(this._mysteryImg, x+(w-mw*s)/2, y+(h-mh*s)/2, mw*s, mh*s);
      }
    };

    const drawTankSvg = (x, y, w, h, tankId, turretAngle) => {
      const t = TANKS[tankId];
      if(!t) return;
      const pad = Math.min(w, h) * 0.12;
      const sx = x + pad, sy = y + pad;
      const sw = w - pad*2, sh = h - pad*2;
      const color = '#' + t.color.toString(16).padStart(6,'0');
      const tColor = '#' + t.turretColor.toString(16).padStart(6,'0');
      const bodyW = sw*0.75, bodyH = sh*0.35;
      const bodyX = sx+(sw-bodyW)/2, bodyY = sy+sh-bodyH-sh*0.05;
      const turretW = sw*0.45, turretH = sh*0.3;
      const turretX = sx+(sw-turretW)/2, turretY = bodyY-turretH+turretH*0.15;

      if(turretAngle !== undefined){
        ctx.save();
        ctx.translate(turretX+turretW/2, turretY+turretH/2);
        ctx.rotate(turretAngle);
        const hw = turretW/2, hh = turretH/2;
        ctx.fillStyle = tColor;
        const r = Math.min(hw, hh)*0.12;
        ctx.beginPath();
        ctx.moveTo(-hw+r, -hh);
        ctx.lineTo(hw-r, -hh);
        ctx.quadraticCurveTo(hw, -hh, hw, -hh+r);
        ctx.lineTo(hw, hh-r);
        ctx.quadraticCurveTo(hw, hh, hw-r, hh);
        ctx.lineTo(-hw+r, hh);
        ctx.quadraticCurveTo(-hw, hh, -hw, hh-r);
        ctx.lineTo(-hw, -hh+r);
        ctx.quadraticCurveTo(-hw, -hh, -hw+r, -hh);
        ctx.closePath();
        ctx.fill();
        const bw = sw*0.28, bh = sh*0.07;
        ctx.fillStyle = '#2a2a2e';
        ctx.fillRect(hw, -bh/2, bw, bh);
        ctx.restore();
      } else {
        ctx.fillStyle = tColor;
        const r = Math.min(turretW, turretH)*0.08;
        ctx.beginPath();
        ctx.moveTo(turretX+r, turretY);
        ctx.lineTo(turretX+turretW-r, turretY);
        ctx.quadraticCurveTo(turretX+turretW, turretY, turretX+turretW, turretY+r);
        ctx.lineTo(turretX+turretW, turretY+turretH-r);
        ctx.quadraticCurveTo(turretX+turretW, turretY+turretH, turretX+turretW-r, turretY+turretH);
        ctx.lineTo(turretX+r, turretY+turretH);
        ctx.quadraticCurveTo(turretX, turretY+turretH, turretX, turretY+turretH-r);
        ctx.lineTo(turretX, turretY+r);
        ctx.quadraticCurveTo(turretX, turretY, turretX+r, turretY);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#2a2a2e';
        ctx.fillRect(turretX+turretW, turretY+turretH/2-sh*0.035, sw*0.28, sh*0.07);
      }
      ctx.fillStyle = color;
      const br = Math.min(bodyW, bodyH)*0.08;
      ctx.beginPath();
      ctx.moveTo(bodyX+br, bodyY);
      ctx.lineTo(bodyX+bodyW-br, bodyY);
      ctx.quadraticCurveTo(bodyX+bodyW, bodyY, bodyX+bodyW, bodyY+br);
      ctx.lineTo(bodyX+bodyW, bodyY+bodyH-br);
      ctx.quadraticCurveTo(bodyX+bodyW, bodyY+bodyH, bodyX+bodyW-br, bodyY+bodyH);
      ctx.lineTo(bodyX+br, bodyY+bodyH);
      ctx.quadraticCurveTo(bodyX, bodyY+bodyH, bodyX, bodyY+bodyH-br);
      ctx.lineTo(bodyX, bodyY+br);
      ctx.quadraticCurveTo(bodyX, bodyY, bodyX+br, bodyY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#222226';
      ctx.fillRect(bodyX-2, bodyY+bodyH*0.1, 3, bodyH*0.8);
      ctx.fillRect(bodyX+bodyW-1, bodyY+bodyH*0.1, 3, bodyH*0.8);
    };

    const drawText = (x, y, w, h, text) => {
      ctx.fillStyle = 'rgba(40,40,40,0.85)';
      ctx.beginPath();
      const r = 6;
      ctx.moveTo(x+4+r, y+4);
      ctx.lineTo(x+w-4-r, y+4);
      ctx.quadraticCurveTo(x+w-4, y+4, x+w-4, y+4+r);
      ctx.lineTo(x+w-4, y+h-4-r);
      ctx.quadraticCurveTo(x+w-4, y+h-4, x+w-4-r, y+h-4);
      ctx.lineTo(x+4+r, y+h-4);
      ctx.quadraticCurveTo(x+4, y+h-4, x+4, y+h-4-r);
      ctx.lineTo(x+4, y+4+r);
      ctx.quadraticCurveTo(x+4, y+4, x+4+r, y+4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ccc';
      ctx.font = `bold ${Math.min(w,h)*0.1}px Segoe UI`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x+w/2, y+h/2);
    };

    ctx.clearRect(0, 0, W, H);
    this._collectionsFrames.forEach(f => {
      const fx = f.x * scaleX, fy = f.y * scaleY;
      const fw = f.w * scaleX, fh = f.h * scaleY;
      const sc = f.scale || 1;
      const showTank = f.tankId && (this._collectionsEditMode || isUnlocked(f.tankId));
      if (showTank) {
        drawTankSvg(fx+fw*(1-sc)/2, fy+fh*(1-sc)/2, fw*sc, fh*sc, f.tankId);
      } else if (f.tankId) {
        drawMystery(fx+fw*(1-sc)/2, fy+fh*(1-sc)/2, fw*sc, fh*sc);
      } else {
        drawText(fx+fw*(1-sc)/2, fy+fh*(1-sc)/2, fw*sc, fh*sc, f.label || 'Coming Soon!');
      }
    });

    // Editor overlay
    if(this._collectionsEditMode){
      const hs = 7;
      this._collectionsFrames.forEach((f, i) => {
        const fx = f.x * scaleX, fy = f.y * scaleY;
        const fw = f.w * scaleX, fh = f.h * scaleY;
        const sel = this._selectedFrameIdx === i;
        ctx.strokeStyle = sel ? '#ffcc00' : 'rgba(255,255,255,0.3)';
        ctx.lineWidth = sel ? 2 : 1;
        ctx.setLineDash(sel ? [] : [4,4]);
        ctx.strokeRect(fx, fy, fw, fh);
        ctx.setLineDash([]);
        if(sel){
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = '#222';
          ctx.lineWidth = 1.5;
          [[fx, fy], [fx+fw, fy], [fx, fy+fh], [fx+fw, fy+fh]].forEach(([hx, hy]) => {
            ctx.fillRect(hx-hs/2, hy-hs/2, hs, hs);
            ctx.strokeRect(hx-hs/2, hy-hs/2, hs, hs);
          });
        }
      });
    }

    // One-time event wiring
    if(!this._collectionsEventsWired){
      this._collectionsEventsWired = true;

      const imgCoord = (e) => {
        const cr = canvas.getBoundingClientRect();
        const cx = e.clientX - cr.left, cy = e.clientY - cr.top;
        return { ix: cx * imgW / (canvas.offsetWidth||cr.width), iy: cy * imgH / (canvas.offsetHeight||cr.height) };
      };
      const hitFrame = (ix, iy) => {
        for(let i=this._collectionsFrames.length-1; i>=0; i--){
          const f = this._collectionsFrames[i];
          if(ix >= f.x && ix < f.x+f.w && iy >= f.y && iy < f.y+f.h) return i;
        }
        return -1;
      };

      canvas.onmousedown = (e) => {
        const {ix, iy} = imgCoord(e);
        if(this._collectionsEditMode && this._selectedFrameIdx >= 0){
          const f = this._collectionsFrames[this._selectedFrameIdx];
          const hs = 8 / scaleX;
          for(const c of [{id:'tl',x:f.x,y:f.y},{id:'tr',x:f.x+f.w,y:f.y},{id:'bl',x:f.x,y:f.y+f.h},{id:'br',x:f.x+f.w,y:f.y+f.h}]){
            if(Math.abs(ix-c.x) < hs && Math.abs(iy-c.y) < hs){
              this._dragState = {type:'resize',corner:c.id,idx:this._selectedFrameIdx,startX:ix,startY:iy,orig:{...f}};
              return;
            }
          }
        }
        if(this._collectionsEditMode){
          const idx = hitFrame(ix, iy);
          if(idx >= 0){
            this._selectCollectionFrame(idx);
            this._dragState = {type:'move',idx,startX:ix,startY:iy,orig:{...this._collectionsFrames[idx]}};
          } else {
            this._selectCollectionFrame(-1);
          }
          return;
        }
        // View mode
        const idx = hitFrame(ix, iy);
        if(idx >= 0){
          const f = this._collectionsFrames[idx];
          if(f.tankId && isUnlocked(f.tankId) && this.settings.selectedTank !== f.tankId){
            this.settings.selectedTank = f.tankId;
            saveSettings(this.settings);
            this.toast(`Selected ${TANKS[f.tankId]?.name || f.tankId}`);
          }
        }
      };

      canvas.onmousemove = (e) => {
        if(!this._dragState) return;
        const {ix, iy} = imgCoord(e);
        const d = this._dragState;
        const f = this._collectionsFrames[d.idx];
        const dx = ix - d.startX, dy = iy - d.startY;
        if(d.type === 'move'){ f.x = d.orig.x + dx; f.y = d.orig.y + dy; }
        else {
          const o = d.orig;
          if(d.corner === 'tl'){ f.x=o.x+dx; f.y=o.y+dy; f.w=o.w-dx; f.h=o.h-dy; }
          else if(d.corner === 'tr'){ f.y=o.y+dy; f.w=o.w+dx; f.h=o.h-dy; }
          else if(d.corner === 'bl'){ f.x=o.x+dx; f.w=o.w-dx; f.h=o.h+dy; }
          else if(d.corner === 'br'){ f.w=o.w+dx; f.h=o.h+dy; }
          if(f.w < 20) f.w = 20;
          if(f.h < 20) f.h = 20;
        }
        this._updateEditorPanel();
        this._renderCollections();
      };

      canvas.onmouseup = canvas.onmouseleave = () => {
        if(this._dragState){ this._dragState = null; this._updateEditorPanel(); }
      };
    }
  },

  _selectCollectionFrame(idx){
    this._selectedFrameIdx = idx;
    this._updateEditorPanel();
    this._renderCollections();
  },

  _updateEditorPanel(){
    const f = this._selectedFrameIdx >= 0 ? this._collectionsFrames[this._selectedFrameIdx] : null;
    ['ce-x','ce-y','ce-w','ce-h'].forEach(id => {
      const p = id.split('-')[1];
      document.getElementById(id).value = f ? Math.round(f[p]) : '';
    });
    document.getElementById('ce-scale').value = f ? (f.scale||1) : 1;
    document.getElementById('ce-scale-val').textContent = f ? (f.scale||1).toFixed(2) : '1.00';
    const sel = document.getElementById('ce-tank-id');
    if(f && sel.options.length){
      const val = f.tankId || '';
      if(sel.value !== val) sel.value = val;
    }
  },

  _toggleCollectionsEdit(){
    this._collectionsEditMode = !this._collectionsEditMode;
    if(this._collectionsEditMode) this._enterCollectionsEdit();
    else this._exitCollectionsEdit();
  },

  _enterCollectionsEdit(){
    document.getElementById('ce-toggle').classList.add('hidden');
    document.getElementById('ce-controls').classList.remove('hidden');
    this._selectedFrameIdx = -1;
    this._dragState = null;

    ['ce-x','ce-y','ce-w','ce-h'].forEach(id => {
      const el = document.getElementById(id);
      const prop = id.split('-')[1];
      el.onchange = el.oninput = () => {
        if(this._selectedFrameIdx < 0) return;
        const v = parseFloat(el.value);
        if(!isNaN(v) && v >= 0){ this._collectionsFrames[this._selectedFrameIdx][prop] = Math.round(v); this._renderCollections(); }
      };
    });

    const scaleEl = document.getElementById('ce-scale');
    scaleEl.onchange = scaleEl.oninput = () => {
      if(this._selectedFrameIdx < 0) return;
      const v = parseFloat(scaleEl.value);
      this._collectionsFrames[this._selectedFrameIdx].scale = v;
      document.getElementById('ce-scale-val').textContent = v.toFixed(2);
      this._renderCollections();
    };

    // Populate tank dropdown
    const tankSel = document.getElementById('ce-tank-id');
    tankSel.innerHTML = '<option value="">Coming Soon</option>';
    const allTanks = Object.keys(TANKS).filter(id => id !== 'tankdisplay' && id !== 'dummy');
    allTanks.forEach(id => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = TANKS[id].name || id;
      tankSel.appendChild(opt);
    });
    tankSel.onchange = () => {
      if(this._selectedFrameIdx < 0) return;
      const f = this._collectionsFrames[this._selectedFrameIdx];
      const val = tankSel.value || null;
      f.tankId = val;
      if(!val) f.label = 'Coming Soon!';
      else delete f.label;
      this._renderCollections();
    };

    // Duplicate
    document.getElementById('ce-dup').onclick = () => {
      if(this._selectedFrameIdx < 0) return;
      const orig = this._collectionsFrames[this._selectedFrameIdx];
      const copy = { ...orig, x: orig.x + 30, y: orig.y + 30 };
      this._collectionsFrames.splice(this._selectedFrameIdx + 1, 0, copy);
      this._selectCollectionFrame(this._selectedFrameIdx + 1);
    };

    // Delete
    document.getElementById('ce-del').onclick = () => {
      if(this._selectedFrameIdx < 0 || this._collectionsFrames.length <= 1) return;
      const idx = this._selectedFrameIdx;
      this._collectionsFrames.splice(idx, 1);
      this._selectCollectionFrame(Math.min(idx, this._collectionsFrames.length - 1));
    };

    document.getElementById('ce-save').onclick = () => {
      const layout = { frames: this._collectionsFrames.map(f => ({x:f.x, y:f.y, w:f.w, h:f.h, scale:f.scale||1, tankId:f.tankId||null})) };
      localStorage.setItem('tankparty_collections_layout', JSON.stringify(layout));
      this._savedLayout = layout.frames;
      this.toast('Collections layout saved');
    };
    document.getElementById('ce-export').onclick = () => {
      const json = JSON.stringify({ frames: this._collectionsFrames.map(f => ({x:f.x, y:f.y, w:f.w, h:f.h, scale:f.scale||1, tankId:f.tankId||null})) }, null, 2);
      navigator.clipboard.writeText(json).then(() => this.toast('Layout JSON copied to clipboard')).catch(() => {
        const ta = document.createElement('textarea'); ta.value = json;
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        this.toast('Layout JSON copied to clipboard');
      });
    };
    document.getElementById('ce-import').onclick = () => {
      const json = prompt('Paste layout JSON:');
      if(!json) return;
      try {
        const data = JSON.parse(json);
        if(!data.frames || !Array.isArray(data.frames) || !data.frames.length) throw new Error('Invalid format');
        const nf = data.frames.map(s => ({
          x: s.x, y: s.y, w: s.w, h: s.h, scale: s.scale || 1,
          tankId: s.tankId || null,
          label: s.tankId ? undefined : 'Coming Soon!'
        }));
        this._collectionsFrames = nf;
        this._selectedFrameIdx = -1;
        this.toast(`Imported ${nf.length} frames`);
        this._renderCollections();
      } catch(e) {
        this.toast('Invalid JSON: ' + e.message);
      }
    };
    document.getElementById('ce-done').onclick = () => this._toggleCollectionsEdit();
    this._renderCollections();
  },

  _exitCollectionsEdit(){
    document.getElementById('ce-toggle').classList.remove('hidden');
    document.getElementById('ce-controls').classList.add('hidden');
    this._selectedFrameIdx = -1;
    this._dragState = null;
    this._renderCollections();
  },

  showConnecting(msg){ document.getElementById('connecting').querySelector('h2').textContent = msg||'Connecting…';
    document.getElementById('connecting').classList.remove('hidden'); },
  hideConnecting(){ document.getElementById('connecting').classList.add('hidden'); },

  /* ---------- Codes ---------- */
  _wireCodes(){
    const input = document.getElementById('codes-input');
    const btn = document.getElementById('btn-redeem-code');
    if(!btn) return;
    btn.onclick = ()=>{
      const code = input.value.trim();
      if(code === 'ghadwg3u23989syf9ewnasduiuwghda'){
        this.toast('Code redeemed! Opening Menu Editor...');
        MenuEditor.open();
      } else if(code === 'editor123'){
        console.log('editor123: typeof Editor123 =', typeof Editor123);
        if(typeof Editor123 === 'undefined' || !Editor123.open){
          this.toast('Error: Editor123 not loaded. Check console.');
          return;
        }
        this.toast('Code redeemed! Opening Editor Suite...');
        try { Editor123.open(); } catch(e){ console.error(e); this.toast('Error: '+e.message); }
      } else if(code === 'op321'){
        this.settings.allUnlocked = true;
        saveSettings(this.settings);
        this.toast('All tanks unlocked!');
      } else if(code === 'revertmap'){
        this._revertMap();
      } else {
        this.toast('Invalid code');
      }
    };
    input.onkeydown = (e)=>{
      if(e.code==='Enter') btn.click();
    };
    // Revert map button
    const revertBtn = document.getElementById('btn-revert-map');
    if(revertBtn){
      revertBtn.onclick = ()=>{ this._revertMap(); };
      this._refreshRevertBtn(revertBtn);
    }
  },
  _revertMap(){
    if(!hasMainMap()){
      this.toast('No saved main map to revert.');
      return;
    }
    clearMainMap();
    this.toast('Main map reverted to original!');
    const revertBtn = document.getElementById('btn-revert-map');
    if(revertBtn) revertBtn.style.display = 'none';
  },
  _refreshRevertBtn(el){
    el.style.display = hasMainMap() ? '' : 'none';
  },

  /* ---------- storage ---------- */
  _initStorageGrid(){
    const grid = document.getElementById('storage-grid');
    if(!grid) return;
    if(grid.children.length) return;
    for(let i = 0; i < 48; i++){
      const slot = document.createElement('div');
      slot.className = 'storage-slot';
      slot.dataset.index = i;
      grid.appendChild(slot);
    }
  },

};