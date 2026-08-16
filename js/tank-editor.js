/* ============================================================
   tank-editor.js — Tank Editor (Editor123 suite)

   Edit a tank's collision hitbox (front/sides/height), turret
   rotation pivot and shell/muzzle spawn point with a LIVE three.js
   TransformControls gizmo. Values are saved per tank id to
   localStorage (tankparty_tankeditor) and pushed to the shared API
   so every game client applies the same settings; tank.js reads them
   at spawn time via window.TANK_EDITOR_OVERRIDES.

   UX: drag the gizmo arrows to edit (never moves the camera). The
   top-right orientation widget + the bottom axis bar snap the camera
   to Side X / Top Y / Front Z / Perspective views. Ctrl+Z / Ctrl+Y
   undo/redo, Ctrl+S saves for all clients.
   ============================================================ */

window.TankEditor = (function(){

  var LS_KEY = 'tankparty_tankeditor';

  function loadOverrides(){
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') || {}; } catch(e){ return {}; }
  }
  function saveOverrides(){
    try { localStorage.setItem(LS_KEY, JSON.stringify(window.TANK_EDITOR_OVERRIDES)); } catch(e){}
  }
  window.TANK_EDITOR_OVERRIDES = loadOverrides();

  var state = {
    selected: 'coolbuddy',
    mode: 'hitbox',
    scene: null, renderer: null, camera: null, controls: null, gizmo: null,
    tank: null, bodyBox: null, boxWire: null, pivotMarker: null, turretMarker: null, shellMarker: null,
    values: { body:{w:3,h:1,l:4.4}, pivot:{x:0,y:0,z:0}, turret:{x:0,y:0,z:0}, shell:{x:0,y:0,z:0} },
    raf: 0, running: false, resizeHandler: null, keyHandler: null,
    axesCanvas: null,
    spinTurret: false,
    history: [], historyIdx: -1,
    onDispose: null,
  };
  var dragged = false;

  function round(v){ return Math.round(v * 1000) / 1000; }
  function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

  function $id(id){ return document.getElementById(id); }

  function toast(msg){
    var el = $id('te-toast');
    if(el){
      el.textContent = msg;
      el.classList.add('te-show');
      clearTimeout(el._t);
      el._t = setTimeout(function(){ el.classList.remove('te-show'); }, 3200);
      return;
    }
    if(window.Menu && typeof Menu.toast === 'function'){ Menu.toast(msg); return; }
    if(window.Editor123 && typeof Editor123.toast === 'function'){ Editor123.toast(msg); return; }
    console.log('[TankEditor]', msg);
  }

  /* ------------------------------------------------------------
     Shared overrides (all game clients)
     The save button pushes the override map to the clan API worker;
     every client fetches it at boot and when the editor opens, so a
     tank's hitbox/pivot/spawn behave identically for everyone.
     ------------------------------------------------------------ */
  function apiBase(){
    return (typeof CONFIG !== 'undefined' && CONFIG.CLAN_API_URL) ? CONFIG.CLAN_API_URL : '';
  }

  function syncRemoteOverrides(){
    var base = apiBase();
    if(!base) return Promise.resolve();
    return fetch(base + '/tankoverrides')
      .then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; })
      .then(function(data){
        if(!data || !data.overrides) return;
        // Server is authoritative for shared play
        window.TANK_EDITOR_OVERRIDES = data.overrides || {};
        saveOverrides();
      });
  }

  function pushRemoteOverrides(){
    var base = apiBase();
    if(!base) return Promise.resolve(false);
    return fetch(base + '/tankoverrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides: window.TANK_EDITOR_OVERRIDES || {}, savedAt: Date.now() })
    }).then(function(r){ return r.ok; }).catch(function(){ return false; });
  }

  // Callable from the game boot so in-match tanks get shared values
  function syncGlobal(){
    return syncRemoteOverrides();
  }

  /* ------------------------------------------------------------
     Override store
     ------------------------------------------------------------ */
  function ovFor(id){
    return (window.TANK_EDITOR_OVERRIDES && window.TANK_EDITOR_OVERRIDES[id]) || null;
  }
  function setOv(id, patch){
    if(!window.TANK_EDITOR_OVERRIDES) window.TANK_EDITOR_OVERRIDES = {};
    var cur = window.TANK_EDITOR_OVERRIDES[id] || {};
    window.TANK_EDITOR_OVERRIDES[id] = Object.assign(cur, patch);
    saveOverrides();
  }
  function clearOv(id){
    if(window.TANK_EDITOR_OVERRIDES) delete window.TANK_EDITOR_OVERRIDES[id];
    saveOverrides();
  }

  /* ------------------------------------------------------------
     Main entry (called from Editor123 launcher)
     ------------------------------------------------------------ */
  function render(){
    Editor123._mode = 'tank';
    var c = document.getElementById('editor123-content');
    if(!c) return;

    c.innerHTML =
      '<div class="te-side">' +
        '<div class="te-side-title">TANK EDITOR</div>' +
        '<label class="te-label">Tank</label>' +
        '<select id="te-tank" class="te-input">' + tankOptions() + '</select>' +

        '<div class="te-mode-title">EDIT</div>' +
        '<div id="te-modes" class="te-modes">' +
          '<div class="te-mode' + (state.mode==='hitbox' ? ' te-on' : '') + '" data-mode="hitbox">Hitbox (front/sides)</div>' +
          '<div class="te-mode' + (state.mode==='pivot' ? ' te-on' : '') + '" data-mode="pivot">Turret pivot</div>' +
          '<div class="te-mode' + (state.mode==='turret' ? ' te-on' : '') + '" data-mode="turret">Turret position</div>' +
          '<div class="te-mode' + (state.mode==='shell' ? ' te-on' : '') + '" data-mode="shell">Firing point (muzzle)</div>' +
        '</div>' +

        '<div class="te-mode-title">VALUES</div>' +
        '<div id="te-fields"></div>' +

        '<div class="te-mode-title">TEST</div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<div id="te-spin" class="te-btn" style="flex:1">↺ Spin turret</div>' +
          '<span id="te-angle-readout" class="te-angle">0°</span>' +
        '</div>' +
        '<label class="te-field"><span>Turret angle (test)</span><input id="te-angle" type="range" min="0" max="360" value="0" step="1" style="accent-color:#ffb12b"></label>' +

        '<div id="te-note" class="te-note"></div>' +

        '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">' +
          '<div id="te-save" class="te-btn te-btn-primary">Save &amp; apply</div>' +
          '<div id="te-reset" class="te-btn">Reset this tank</div>' +
          '<div id="te-back" class="te-btn">← Launcher</div>' +
        '</div>' +
      '</div>' +

      '<div class="te-stage">' +
        '<div class="te-stage-hint">Drag the gizmo arrows to edit — use the corner widget or axis bar to move the camera</div>' +
        '<div id="te-toast" class="te-toast"></div>' +
        '<div id="te-view" class="te-view"><canvas id="te-axes"></canvas></div>' +
        '<div id="te-axisbar">' +
          '<span class="te-axis" data-axis="x">Side X</span>' +
          '<span class="te-axis" data-axis="y">Top Y</span>' +
          '<span class="te-axis" data-axis="z">Front Z</span>' +
          '<span class="te-axis" data-axis="p">Persp</span>' +
        '</div>' +
      '</div>';

    injectCss();

    $id('te-tank').value = state.selected;
    $id('te-tank').onchange = function(){ pickTank(this.value); };

    $id('te-modes').querySelectorAll('.te-mode').forEach(function(m){
      m.onclick = function(){
        setMode(this.dataset.mode);
      };
    });

    $id('te-save').onclick = doSave;
    $id('te-reset').onclick = doReset;
    $id('te-back').onclick = doClose;

    var spinBtn = $id('te-spin');
    if(spinBtn){
      spinBtn.onclick = function(){
        state.spinTurret = !state.spinTurret;
        spinBtn.classList.toggle('te-on', state.spinTurret);
        if(!state.spinTurret && state.tank){
          state.tank.turretAngle = 0;
          state.tank._syncTransform();
          applyValuesToScene();
        }
        syncSpinUI();
        toast(state.spinTurret ? 'Turret spinning — watch the pivot &amp; firing point' : 'Turret spin off');
      };
    }
    var angleIn = $id('te-angle');
    if(angleIn){
      state.spinTurret = false;
      angleIn.oninput = function(){
        var deg = parseInt(angleIn.value, 10);
        if(isNaN(deg)) return;
        if(state.tank && state.tank._syncTransform){
          state.tank.turretAngle = deg * Math.PI / 180;
          state.tank._syncTransform();
          applyValuesToScene();
          renderFields();
        }
        syncSpinUI();
      };
    }
    state.spinTurret = false;

    $id('te-axisbar').querySelectorAll('.te-axis').forEach(function(a){
      a.onclick = function(){ setAxisView(this.dataset.axis); };
    });

    state.running = true;
    state.keyHandler = function(e){
      if(e.code === 'Escape'){ doClose(); return; }
      var mod = e.ctrlKey || e.metaKey;
      if(mod && e.code === 'KeyZ'){
        if(e.shiftKey) redo(); else undo();
        e.preventDefault();
      } else if(mod && e.code === 'KeyY'){
        redo();
        e.preventDefault();
      } else if(mod && e.code === 'KeyS'){
        e.preventDefault();
        doSave();
      }
    };
    document.addEventListener('keydown', state.keyHandler);

    buildStage();
    syncRemoteOverrides().then(function(){
      if(!state.running) return;
      pushHistory();
      pickTank(state.selected);
    });
  }

  function tankOptions(){
    var ids = (typeof TANK_ORDER !== 'undefined' && TANK_ORDER.length) ? TANK_ORDER : ['coolbuddy'];
    return ids.map(function(id){
      var d = (typeof TANKS !== 'undefined' && TANKS[id]) ? TANKS[id] : null;
      var nm = d ? (d.name || id) : id;
      return '<option value="' + id + '">' + nm + ' (' + id + ')</option>';
    }).join('');
  }

  /* ------------------------------------------------------------
     3D stage
     ------------------------------------------------------------ */
  function buildStage(){
    var view = $id('te-view');
    if(!view) return;
    view.innerHTML = '';

    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x11151a);

    var W = view.clientWidth || 640, H = view.clientHeight || 480;
    state.camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 500);
    state.camera.position.set(8, 6, 12);
    state.camera.lookAt(0, 1, 0);

    state.renderer = new THREE.WebGLRenderer({antialias: true});
    state.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    state.renderer.setSize(W, H);
    state.renderer.shadowMap.enabled = true;
    view.appendChild(state.renderer.domElement);

    var hemi = new THREE.HemisphereLight(0xdfeaff, 0x22262c, 0.7);
    state.scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(10, 18, 8);
    sun.castShadow = true;
    state.scene.add(sun);
    state.scene.add(new THREE.AmbientLight(0x999999, 0.4));

    // Ground grid so axis movement is readable
    var grid = new THREE.GridHelper(20, 20, 0x2a3038, 0x1f242b);
    grid.position.y = -0.01;
    state.scene.add(grid);

    state.controls = new THREE.OrbitControls(state.camera, state.renderer.domElement);
    state.controls.enableDamping = true;
    state.controls.dampingFactor = 0.12;
    state.controls.target.set(0, 1, 0);
    state.controls.update();

    state.gizmo = new THREE.TransformControls(state.camera, state.renderer.domElement);
    state.gizmo.setSize(0.85);
    state.gizmo.space = 'local';
    state.scene.add(state.gizmo);
    // r128 does NOT emit 'dragging-changed', so gate OrbitControls via
    // mouseDown/mouseUp. IMPORTANT: never move the camera here — grabbing a
    // gizmo arrow to drag must not rotate the view (that lives in the
    // top-right orientation widget only).
    state.gizmo.addEventListener('mouseDown', function(){
      if(state.controls) state.controls.enabled = false;
    });
    state.gizmo.addEventListener('mouseUp', function(){
      if(state.controls) state.controls.enabled = true;
      if(dragged) pushHistory();
      dragged = false;
    });
    state.gizmo.addEventListener('objectChange', function(){
      syncFromGizmo();
      dragged = true;
    });

    state.resizeHandler = function(){ fitViewport(); };
    window.addEventListener('resize', state.resizeHandler);

    // ---- Top-right orientation widget (a "different thing from the moving
    //      arrows": a read-only axis indicator + camera-snap control) ----
    state.axesCanvas = $id('te-axes');
    if(state.axesCanvas){
      state.axesCanvas.width = 112;
      state.axesCanvas.height = 112;
      state.axesCanvas.onclick = function(ev){
        var r = state.axesCanvas.getBoundingClientRect();
        var x = ev.clientX - r.left, y = ev.clientY - r.top;
        var ax = axesWidgetPick(x, y);
        if(ax) setAxisView(ax);
      };
    }

    function loop(){
      if(!state.running) return;
      state.raf = requestAnimationFrame(loop);
      if(state.controls && state.controls.enabled) state.controls.update();
      if(state.gizmo) state.gizmo.updateMatrixWorld();
      if(state.tank && state.tank._animMixer) state.tank._animMixer.update(1 / 60);
      if(state.tank && state.tank._syncTransform && state.spinTurret){
        state.tank.turretAngle = ((state.tank.turretAngle || 0) + 2.2 * (1 / 60)) % (Math.PI * 2);
        state.tank._syncTransform();
        applyValuesToScene();
        syncSpinUI();
      }
      if(state.renderer && state.scene) state.renderer.render(state.scene, state.camera);
      if(state.axesCanvas) drawAxesWidget();
    }
    loop();
  }

  /* Sync the turret-angle readout + slider with the preview tank */
  function syncSpinUI(){
    var deg = 0;
    if(state.tank && state.tank.turretAngle != null){
      deg = Math.round(state.tank.turretAngle * 180 / Math.PI) % 360;
      if(deg < 0) deg += 360;
    }
    var readEl = $id('te-angle-readout');
    if(readEl) readEl.textContent = deg + '\u00B0';
    if(state.spinTurret){
      var sl = $id('te-angle');
      if(sl) sl.value = String(deg);
    }
  }

  function fitViewport(){
    var view = $id('te-view');
    if(!view || !state.renderer || !state.camera) return;
    var W = view.clientWidth, H = view.clientHeight;
    if(!W || !H) return;
    state.renderer.setSize(W, H);
    state.camera.aspect = W / H;
    state.camera.updateProjectionMatrix();
  }

  /* ------------------------------------------------------------
     Top-right orientation widget
     ------------------------------------------------------------ */
  var widgetTips = { X:{x:0,y:0}, Y:{x:0,y:0}, Z:{x:0,y:0}, C:{x:56,y:56} };
  var widgetDirs = { X:null, Y:null, Z:null };

  function widgetProject(v){
    v.project(state.camera);
    var w = state.axesCanvas.width, h = state.axesCanvas.height;
    return { x: (v.x + 1) * 0.5 * w, y: (1 - v.y) * 0.5 * h, z: v.z };
  }
  function widgetDir(v){
    // screen-space unit direction of a world axis (fixed length)
    var a = widgetProject(new THREE.Vector3());
    var b = widgetProject(v.clone().add(new THREE.Vector3(1, 1, 1)));
    // project toward delta of axis vector: use dv = v (axis) projected difference
    var ep = widgetProject(v);
    var dx = ep.x - a.x, dy = ep.y - a.y;
    var len = Math.max(0.0001, Math.sqrt(dx*dx + dy*dy));
    return { x: dx / len, y: dy / len };
  }

  function drawAxesWidget(){
    var ctx = state.axesCanvas.getContext('2d');
    var W = state.axesCanvas.width, H = state.axesCanvas.height;
    ctx.clearRect(0, 0, W, H);
    var c = { x: W / 2, y: H / 2 };
    var L = 34;
    var cr = 8.5;
    var axes = [
      { v: new THREE.Vector3(1, 0, 0), col: '#ff5b5b', key: 'X' },
      { v: new THREE.Vector3(0, 1, 0), col: '#7bd36e', key: 'Y' },
      { v: new THREE.Vector3(0, 0, 1), col: '#5b9dff', key: 'Z' }
    ];
    // backdrop
    ctx.fillStyle = 'rgba(14,17,22,0.55)';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c.x, c.y, L + 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    axes.forEach(function(a){
      var d = widgetDir(a.v);
      var tip = { x: c.x + d.x * L, y: c.y + d.y * L };
      widgetDirs[a.key] = d;
      widgetTips[a.key] = tip;
      // shaft
      ctx.strokeStyle = a.col;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      // arrow head
      var ang = Math.atan2(d.y, d.x);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - 9 * Math.cos(ang - 0.5), tip.y - 9 * Math.sin(ang - 0.5));
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - 9 * Math.cos(ang + 0.5), tip.y - 9 * Math.sin(ang + 0.5));
      ctx.stroke();
      // label
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(a.key, tip.x + d.x * 10, tip.y + d.y * 10);
    });
    // center perspective button
    widgetTips.C = { x: c.x, y: c.y };
    ctx.fillStyle = 'rgba(255,177,44,0.16)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, cr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffb12b';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillText('P', c.x, c.y + 0.5);
    ctx.globalAlpha = 1;
  }

  function axesWidgetPick(x, y){
    var best = null, bestD = 999;
    ['X', 'Y', 'Z'].forEach(function(k){
      var t = widgetTips[k];
      var d = Math.hypot(t.x - x, t.y - y);
      if(d < bestD){ bestD = d; best = k.toLowerCase(); }
    });
    if(bestD <= 20) return best;
    var t = widgetTips.C;
    if(Math.hypot(t.x - x, t.y - y) <= 12) return 'p';
    return null;
  }

  /* ------------------------------------------------------------
     Tank loading + markers
     ------------------------------------------------------------ */
  function pickTank(id){
    state.selected = id;
    state.history = [];
    state.historyIdx = -1;
    state.spinTurret = false;
    var spinBtn = $id('te-spin');
    if(spinBtn) spinBtn.classList.remove('te-on');
    var angleIn0 = $id('te-angle');
    if(angleIn0) angleIn0.value = '0';
    var readEl0 = $id('te-angle-readout');
    if(readEl0) readEl0.textContent = '0\u00B0';
    var ov = ovFor(id);
    var def = (typeof TANKS !== 'undefined' && TANKS[id]) ? TANKS[id] : TANKS.coolbuddy;
    if(ov && ov.body) state.values.body = Object.assign({}, def.body, ov.body);
    else state.values.body = Object.assign({}, def.body);
    if(ov && ov.pivot) state.values.pivot = Object.assign({}, ov.pivot);
    if(ov && ov.turret) state.values.turret = Object.assign({}, ov.turret);
    if(ov && ov.shell) state.values.shell = Object.assign({}, ov.shell);

    clearTank();
    renderFields();

    function build(){
      try{
        state.tank = new Tank(def, { physicsWorld: null });
        state.tank.root.position.set(0, 0, 0);
        if(state.tank._overlayGroup) state.tank._overlayGroup.visible = false;
        state.scene.add(state.tank.root);
        // Re-apply saved overrides so the preview matches runtime
        if(state.tank._applyEditorOverrides) state.tank._applyEditorOverrides();
      }catch(e){ console.error('tank build:', e); }
      whenModelReady(state.tank, function(){ buildMarkers(); });
    }

    if(window.Models && Models.probe){
      Models.probe([id]).then(build).catch(build);
    } else {
      build();
    }
  }

  function whenModelReady(t, cb){
    if(!t){ cb(); return; }
    if(t._modelReady){ t._modelReady.then(cb).catch(cb); return; }
    // Cube path — ready immediately
    cb();
  }

  function clearTank(){
    if(state.gizmo) state.gizmo.detach();
    if(state.tank){
      try{ if(state.scene) state.scene.remove(state.tank.root); }catch(e){}
      state.tank = null;
    }
    if(state.bodyBox){ try{ state.scene.remove(state.bodyBox); }catch(e){} state.bodyBox = null; }
    if(state.boxWire){ try{ state.scene.remove(state.boxWire); }catch(e){} state.boxWire = null; }
    if(state.pivotMarker){ try{ state.scene.remove(state.pivotMarker); }catch(e){} state.pivotMarker = null; }
    if(state.turretMarker){ try{ state.scene.remove(state.turretMarker); }catch(e){} state.turretMarker = null; }
    if(state.shellMarker){ try{ state.scene.remove(state.shellMarker); }catch(e){} state.shellMarker = null; }
  }

  function makeMarker(color, size){
    var m = new THREE.Mesh(
      new THREE.OctahedronGeometry(size || 0.22, 0),
      new THREE.MeshBasicMaterial({color: color})
    );
    m.castShadow = false;
    return m;
  }

  function buildMarkers(){
    if(!state.tank) return;
    if(state.scene) state.scene.updateMatrixWorld(true);
    var t = state.tank;
    var def = t.def;

    // ---- Hitbox box (matches def.body dims; scaled by the gizmo) ----
    var b = state.values.body;
    state.bodyBox = new THREE.Mesh(
      new THREE.BoxGeometry(b.w, b.h, b.l),
      new THREE.MeshBasicMaterial({color: 0x22ff88, transparent: true, opacity: 0.22, depthWrite: false})
    );
    state.bodyBox.position.y = b.h / 2 + 0.45;
    state.boxWire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(b.w, b.h, b.l)),
      new THREE.LineBasicMaterial({color: 0x22ff88})
    );
    state.boxWire.position.copy(state.bodyBox.position);
    state.scene.add(state.bodyBox);
    state.scene.add(state.boxWire);

    // ---- Pivot marker (local offset from the turret parts origin) ----
    // If the model has a dedicated pivot node, read it (it already carries
    // any saved override via _applyEditorOverrides); otherwise the turret
    // rotates about the hull center.
    var pivotLocal = { x: 0, y: 0, z: 0 };
    if(t._modelTurretPivot){
      pivotLocal = { x: t._modelTurretPivot.position.x, y: t._modelTurretPivot.position.y, z: t._modelTurretPivot.position.z };
    }
    var pivotParent = t._modelTurretPivot ? t._modelTurretPivot.parent : t.turretGroup;
    state.pivotMarker = makeMarker(0x33ccff);
    state.pivotMarker.userData.parent = pivotParent;
    state.pivotMarker.position.copy(pivotParent.localToWorld(new THREE.Vector3(pivotLocal.x, pivotLocal.y, pivotLocal.z)));
    state.scene.add(state.pivotMarker);
    state.values.pivot = { x: round(pivotLocal.x), y: round(pivotLocal.y), z: round(pivotLocal.z) };

    // ---- Turret mount marker (where the turret sits on the hull at 0°) ----
    // Only named models carry a real home point; cube tanks have no separate
    // turret part to move, so no marker.
    var turretParent = t._modelTurretPivot ? t._modelTurretPivot.parent : null;
    var home = t._turretHome;
    if(turretParent && home){
      state.turretMarker = makeMarker(0xffd24a, 0.2);
      state.turretMarker.userData.parent = turretParent;
      state.turretMarker.position.copy(turretParent.localToWorld(new THREE.Vector3(home.x, home.y, home.z)));
      state.scene.add(state.turretMarker);
      state.values.turret = { x: round(home.x), y: round(home.y), z: round(home.z) };
    }

    // ---- Shell spawn marker (local offset inside the barrel/turret) ----
    var shellLocal = { x: 0, y: 0, z: 0 };
    var shellParent = t.turretGroup;
    if(t.barrelEnd && t.barrelEnd.parent){
      shellLocal = { x: t.barrelEnd.position.x, y: t.barrelEnd.position.y, z: t.barrelEnd.position.z };
      shellParent = t.barrelEnd.parent;
    }
    state.shellMarker = makeMarker(0xff5566, 0.18);
    state.shellMarker.userData.parent = shellParent;
    state.shellMarker.position.copy(shellParent.localToWorld(new THREE.Vector3(shellLocal.x, shellLocal.y, shellLocal.z)));
    state.scene.add(state.shellMarker);
    state.values.shell = { x: round(shellLocal.x), y: round(shellLocal.y), z: round(shellLocal.z) };

    // The values above already include any saved override (they are read from
    // the live nodes) — just pin the gizmo target to them and show the axes.
    applyValuesToScene();
    setMode(state.mode);
    pushHistory();
    showNote();
    syncSpinUI();
  }

  /* ------------------------------------------------------------
     Value <-> scene sync
     ------------------------------------------------------------ */
  function applyValuesToScene(){
    if(!state.tank) return;
    var v = state.values;

    if(state.bodyBox && state.boxWire){
      var b = v.body;
      state.bodyBox.scale.set(
        clamp(b.w / state.bodyBox.geometry.parameters.width, 0.05, 20),
        clamp(b.h / state.bodyBox.geometry.parameters.height, 0.05, 20),
        clamp(b.l / state.bodyBox.geometry.parameters.depth, 0.05, 20)
      );
      // keep the box bottom pinned on the ground plane
      var hs = (b.h / 2) * state.bodyBox.scale.y;
      state.bodyBox.position.y = hs + 0.45;
      state.boxWire.scale.copy(state.bodyBox.scale);
      state.boxWire.position.copy(state.bodyBox.position);
    }

    if(state.pivotMarker && state.pivotMarker.userData.parent && state.pivotMarker.userData.parent.isObject3D){
      var pLocal = new THREE.Vector3(v.pivot.x, v.pivot.y, v.pivot.z);
      state.pivotMarker.position.copy(state.pivotMarker.userData.parent.localToWorld(pLocal));
    }

    if(state.turretMarker && state.turretMarker.userData.parent && state.turretMarker.userData.parent.isObject3D){
      var uLocal = new THREE.Vector3(v.turret.x, v.turret.y, v.turret.z);
      state.turretMarker.position.copy(state.turretMarker.userData.parent.localToWorld(uLocal));
    }

    // Live-apply pivot + turret placement to the preview tank so the model
    // follows the marker drags (pivot moves rotation only; turret marker
    // moves the mount point only) and the firing marker rides along.
    if(state.tank && state.tank._modelTurretPivot && state.tank._turretHome && state.tank._turretG){
      state.tank._modelTurretPivot.position.set(v.pivot.x, v.pivot.y, v.pivot.z);
      state.tank._turretHome.set(v.turret.x, v.turret.y, v.turret.z);
      if(state.tank._applyTurretPlacement) state.tank._applyTurretPlacement();
    }

    if(state.shellMarker && state.shellMarker.userData.parent && state.shellMarker.userData.parent.isObject3D){
      var sLocal = new THREE.Vector3(v.shell.x, v.shell.y, v.shell.z);
      state.shellMarker.position.copy(state.shellMarker.userData.parent.localToWorld(sLocal));
    }
  }

  function syncFromGizmo(){
    if(!state.tank) return;
    var g = state.gizmo.object;

    if(g === state.bodyBox){
      var gp = state.bodyBox.geometry.parameters;
      state.values.body.w = round(gp.width * state.bodyBox.scale.x);
      state.values.body.h = round(gp.height * state.bodyBox.scale.y);
      state.values.body.l = round(gp.depth * state.bodyBox.scale.z);
      // re-clamp & re-pin
      state.bodyBox.scale.set(
        clamp(state.values.body.w / gp.width, 0.05, 20),
        clamp(state.values.body.h / gp.height, 0.05, 20),
        clamp(state.values.body.l / gp.depth, 0.05, 20)
      );
      var hs = (state.values.body.h / 2) * state.bodyBox.scale.y;
      state.bodyBox.position.y = hs + 0.45;
      state.boxWire.scale.copy(state.bodyBox.scale);
      state.boxWire.position.copy(state.bodyBox.position);
      state.values.body.w = round(gp.width * state.bodyBox.scale.x);
      state.values.body.h = round(gp.height * state.bodyBox.scale.y);
      state.values.body.l = round(gp.depth * state.bodyBox.scale.z);
    }

    if(g === state.pivotMarker && state.pivotMarker.userData.parent){
      var pLocal = state.pivotMarker.userData.parent.worldToLocal(state.pivotMarker.position.clone());
      state.values.pivot = { x: round(pLocal.x), y: round(pLocal.y), z: round(pLocal.z) };
    }

    if(g === state.turretMarker && state.turretMarker.userData.parent){
      var uLocal = state.turretMarker.userData.parent.worldToLocal(state.turretMarker.position.clone());
      state.values.turret = { x: round(uLocal.x), y: round(uLocal.y), z: round(uLocal.z) };
    }

    if(g === state.shellMarker && state.shellMarker.userData.parent){
      var sLocal = state.shellMarker.userData.parent.worldToLocal(state.shellMarker.position.clone());
      state.values.shell = { x: round(sLocal.x), y: round(sLocal.y), z: round(sLocal.z) };
    }

    renderFields();
  }

  /* ------------------------------------------------------------
     Undo / redo (Ctrl+Z / Ctrl+Y) + the top-right orientation
     widget. History snapshots the whole values object each time a
     drag or field edit ends.
     ------------------------------------------------------------ */
  function deepClone(v){ return JSON.parse(JSON.stringify(v)); }

  function pushHistory(){
    var snap = deepClone(state.values);
    var h = state.history;
    // drop any redo tail
    if(state.historyIdx < h.length - 1) h = h.slice(0, state.historyIdx + 1);
    // don't stack identical consecutive snapshots
    if(h.length && JSON.stringify(h[h.length - 1]) === JSON.stringify(snap)) return;
    h.push(snap);
    if(h.length > 80) h.shift();
    state.historyIdx = h.length - 1;
    state.history = h;
  }

  function restoreSnapshot(snap){
    state.values = deepClone(snap);
    if(state.gizmo) state.gizmo.detach();
    rebuildBodyBox();
    applyValuesToScene();
    setMode(state.mode);
    renderFields();
  }

  function undo(){
    if(state.historyIdx <= 0) return;
    state.historyIdx--;
    restoreSnapshot(state.history[state.historyIdx]);
  }

  function redo(){
    if(state.historyIdx >= state.history.length - 1) return;
    state.historyIdx++;
    restoreSnapshot(state.history[state.historyIdx]);
  }

  function rebuildBodyBox(){
    if(!state.bodyBox || !state.boxWire) return;
    var b = state.values.body;
    var gp = state.bodyBox.geometry.parameters;
    var same = gp && Math.abs(gp.width - b.w) < 0.001 &&
                     Math.abs(gp.height - b.h) < 0.001 &&
                     Math.abs(gp.depth - b.l) < 0.001;
    if(same) return;
    state.bodyBox.geometry.dispose();
    state.bodyBox.geometry = new THREE.BoxGeometry(b.w, b.h, b.l);
    state.boxWire.geometry.dispose();
    state.boxWire.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(b.w, b.h, b.l));
  }

  function setMode(mode){
    state.mode = mode;
    $id('te-modes').querySelectorAll('.te-mode').forEach(function(m){
      m.classList.toggle('te-on', m.dataset.mode === mode);
    });
    if(state.gizmo){
      if(mode === 'hitbox' && state.bodyBox){
        state.gizmo.attach(state.bodyBox);
        state.gizmo.setMode('scale');
      } else if(mode === 'pivot' && state.pivotMarker){
        state.gizmo.attach(state.pivotMarker);
        state.gizmo.setMode('translate');
      } else if(mode === 'turret' && state.turretMarker){
        state.gizmo.attach(state.turretMarker);
        state.gizmo.setMode('translate');
      } else if(mode === 'shell' && state.shellMarker){
        state.gizmo.attach(state.shellMarker);
        state.gizmo.setMode('translate');
      } else {
        try{ state.gizmo.detach(); }catch(e){}
      }
    }
    renderFields();
    showNote();
  }

  function showNote(){
    var el = $id('te-note');
    if(!el) return;
    var msg = '';
    if(state.mode === 'hitbox'){
      if(!state.tank || !state.tank._modelTurretPivot){
        msg = 'Scale the green box to set the collision hitbox. Green = front length (Z), width (X) is the sides, height (Y).';
      } else {
        msg = 'Scale the green box to set the collision hitbox. Green = front length (Z), width (X) is the sides, height (Y).';
      }
    } else if(state.mode === 'pivot'){
      if(!state.tank || !state.tank._modelTurretPivot){
        msg = 'This model has no dedicated turret pivot — it rotates about the hull center. Pick a model with a named "turret" group (Cool Buddy etc.) to move its rotation point.';
      } else {
        msg = 'Drag the blue marker to move the turret ROTATION point. The turret stays in place — only the axis it spins about moves. Saved as an offset from the hull center.';
      }
    } else if(state.mode === 'turret'){
      if(!state.tank || !state.tank._turretHome){
        msg = 'This model has no separate turret part to move (it\'s the simple cube build). Use the Pivot mode to adjust its rotation instead.';
      } else {
        msg = 'Drag the gold marker to move where the turret SITS on the hull (0° position). Rotation still happens about the blue pivot point, so it stays wherever you put it.';
      }
    } else if(state.mode === 'shell'){
      msg = 'Drag the red marker to set the FIRING point (muzzle) — where shells/rigid bodies actually spawn. The ejected casing stays at the model\'s "shell" port.';
    }
    el.textContent = msg;
  }

  /* ------------------------------------------------------------
     Numeric fields
     ------------------------------------------------------------ */
  function renderFields(){
    var el = $id('te-fields');
    if(!el) return;
    var v = state.values;
    var html = '';
    if(state.mode === 'hitbox'){
      html += field('body.w', 'Width X (sides)', v.body.w, 0.1, 20);
      html += field('body.l', 'Length Z (front/back)', v.body.l, 0.1, 20);
      html += field('body.h', 'Height Y', v.body.h, 0.1, 20);
    } else if(state.mode === 'pivot'){
      html += field('pivot.x', 'Pivot X', v.pivot.x, -10, 10);
      html += field('pivot.y', 'Pivot Y', v.pivot.y, -10, 10);
      html += field('pivot.z', 'Pivot Z', v.pivot.z, -10, 10);
    } else if(state.mode === 'turret'){
      html += field('turret.x', 'Turret X', v.turret.x, -10, 10);
      html += field('turret.y', 'Turret Y', v.turret.y, -10, 10);
      html += field('turret.z', 'Turret Z (forward)', v.turret.z, -10, 10);
    } else if(state.mode === 'shell'){
      html += field('shell.x', 'Muzzle X', v.shell.x, -10, 10);
      html += field('shell.y', 'Muzzle Y', v.shell.y, -10, 10);
      html += field('shell.z', 'Muzzle Z (forward)', v.shell.z, -10, 10);
    }
    el.innerHTML = html;
    el.querySelectorAll('input').forEach(function(inp){
      inp.oninput = function(){
        var key = inp.dataset.key; // e.g. 'body.w'
        var parts = key.split('.');
        var val = parseFloat(inp.value);
        if(isNaN(val)) return;
        if(state.values[parts[0]]) state.values[parts[0]][parts[1]] = val;
        applyValuesToScene();
        if(state.gizmo && state.gizmo.object) state.gizmo.updateMatrixWorld(true);
      };
      inp.onchange = function(){ pushHistory(); renderFields(); };
    });
  }

  function field(key, label, val, min, max){
    return '<label class="te-field"><span>' + label + '</span><input type="number" step="0.05" min="' + min + '" max="' + max + '" data-key="' + key + '" value="' + round(val) + '"></label>';
  }

  /* ------------------------------------------------------------
     Camera axis views
     ------------------------------------------------------------ */
  function focusTarget(){
    if(state.tank){
      var v = new THREE.Vector3();
      state.tank.root.getWorldPosition(v);
      v.y = 1.2;
      return v;
    }
    return new THREE.Vector3(0, 1.2, 0);
  }

  function setAxisView(axis){
    if(!state.camera) return;
    var target = focusTarget();
    var dist = state.camera.position.distanceTo(target);
    if(!dist || dist < 1) dist = 12;
    var pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    if(axis === 'x'){ pos.set(dist, 0, 0); }
    else if(axis === 'y'){ pos.set(0, dist, 0.0001); up.set(0, 0, -1); }
    else if(axis === 'z'){ pos.set(0, 0, dist); }
    else { pos.set(8, 6, 12); } // persp
    state.camera.position.copy(target).add(pos);
    state.camera.up.copy(up);
    state.camera.lookAt(target);
    if(state.controls){ state.controls.target.copy(target); state.controls.update(); }
  }

  /* ------------------------------------------------------------
     Save / reset / close
     ------------------------------------------------------------ */
  function doSave(){
    var id = state.selected;
    var v = state.values;
    var patch = { body: Object.assign({}, v.body), pivot: Object.assign({}, v.pivot), turret: Object.assign({}, v.turret), shell: Object.assign({}, v.shell) };
    setOv(id, patch);
    if(state.tank && state.tank._applyEditorOverrides) state.tank._applyEditorOverrides();
    if(state.tank) applyValuesToScene();
    pushHistory();
    // Send the whole override map so every game client gets identical tanks
    pushRemoteOverrides().then(function(ok){
      toast('Saved "' + id + '"' + (ok ? ' — applied to all clients' : ' (cloud sync failed, saved locally)'));
    });
  }

  function doReset(){
    clearOv(state.selected);
    var def = (typeof TANKS !== 'undefined' && TANKS[state.selected]) ? TANKS[state.selected] : TANKS.coolbuddy;
    state.values.body = Object.assign({}, def.body);
    state.values.pivot = { x:0, y:0, z:0 };
    state.values.turret = { x:0, y:0, z:0 };
    state.values.shell = { x:0, y:0, z:0 };
    pickTank(state.selected);
    toast('"' + state.selected + '" reset to defaults');
  }

  function dispose(){
    if(state.keyHandler){ document.removeEventListener('keydown', state.keyHandler); state.keyHandler = null; }
    if(state.resizeHandler){ window.removeEventListener('resize', state.resizeHandler); state.resizeHandler = null; }
    if(state.gizmo){ try{ state.gizmo.detach(); state.gizmo.dispose(); }catch(e){} state.gizmo = null; }
    if(state.controls){ try{ state.controls.dispose(); }catch(e){} state.controls = null; }
    clearTank();
    if(state.renderer){ try{ state.renderer.dispose(); }catch(e){} state.renderer = null; }
    state.scene = null; state.camera = null;
    state.running = false;
    if(state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  function doClose(){
    dispose();
    if(Editor123 && Editor123._renderLauncher) Editor123._renderLauncher();
  }

  /* ------------------------------------------------------------
     Styles
     ------------------------------------------------------------ */
  function injectCss(){
    if(document.getElementById('te-css')) return;
    var st = document.createElement('style');
    st.id = 'te-css';
    st.textContent =
      '.te-side{width:250px;min-width:250px;background:#1a1e24;padding:14px;overflow-y:auto;border-right:1px solid #252a32;color:#ddd}' +
      '.te-side-title{color:#ffb12b;font-weight:800;font-size:15px;letter-spacing:.5px;margin-bottom:12px}' +
      '.te-label{display:block;font-size:11px;color:#888;margin:8px 0 4px}' +
      '.te-input{width:100%;background:#22272e;border:1px solid #2a2f36;color:#eee;border-radius:7px;padding:7px;font-size:13px}' +
      '.te-mode-title{color:#777;font-size:11px;letter-spacing:.5px;margin:16px 0 6px;text-transform:uppercase}' +
      '.te-modes{display:flex;flex-direction:column;gap:5px}' +
      '.te-mode{padding:8px 10px;background:#22272e;border:1px solid #2a2f36;border-radius:8px;cursor:pointer;font-size:12px;color:#bbb}' +
      '.te-mode:hover{border-color:#ffb12b}' +
      '.te-mode.te-on{background:#2a3138;border-color:#ffb12b;color:#fff}' +
      '.te-field{display:flex;flex-direction:column;gap:3px;margin-bottom:7px}' +
      '.te-field span{font-size:11px;color:#888}' +
      '.te-field input{background:#22272e;border:1px solid #2a2f36;color:#fff;border-radius:6px;padding:6px;font-size:13px;width:100%;box-sizing:border-box}' +
      '.te-note{font-size:11px;color:#9aa;margin-top:10px;line-height:1.45}' +
      '.te-angle{color:#ffb12b;font-weight:700;font-size:12px;min-width:36px;text-align:right}' +
      '.te-btn{padding:9px 12px;background:#2a2f36;border-radius:8px;cursor:pointer;font-size:12px;color:#bbb;text-align:center;flex:1;border:1px solid #2a2f36}' +
      '.te-btn:hover{border-color:#ffb12b;color:#fff}' +
      '.te-btn.te-on{background:#b8811f;color:#111;font-weight:700;border-color:#b8811f}' +
      '.te-btn-primary{background:#b8811f;color:#111;font-weight:700;border-color:#b8811f}' +
      '.te-stage{flex:1;display:flex;flex-direction:column;position:relative}' +
      '.te-view{flex:1;position:relative;overflow:hidden}' +
      '#te-axes{position:absolute;top:10px;right:12px;width:112px;height:112px;z-index:6;cursor:pointer;border-radius:14px;touch-action:none}' +
      '.te-stage-hint{position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:5;background:rgba(10,12,16,.7);color:#9aa;font-size:11px;padding:4px 10px;border-radius:99px;pointer-events:none}' +
      '.te-toast{position:absolute;bottom:58px;left:50%;transform:translateX(-50%);z-index:8;background:#ffb12b;color:#111;font-weight:700;font-size:13px;padding:9px 18px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .18s;white-space:nowrap}' +
      '.te-toast.te-show{opacity:1}' +
      '#te-axisbar{display:flex;gap:6px;padding:8px;justify-content:center}' +
      '.te-axis{padding:6px 14px;background:#22272e;border:1px solid #2a2f36;border-radius:7px;cursor:pointer;font-size:12px;color:#ccc}' +
      '.te-axis:hover{border-color:#ffb12b;color:#fff}';
    document.head.appendChild(st);
  }

  return {
    render: render,
    dispose: dispose,
    getOverrides: function(){ return window.TANK_EDITOR_OVERRIDES; },
    syncGlobal: syncGlobal,
  };
})();
