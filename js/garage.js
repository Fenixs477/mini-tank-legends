/* Garage — WoT-style hangar scene behind the main menu.
   Renders assets/garage/MTL_garage.glb, parks the player's selected tank
   at the "tank" anchor (bottom face of the hitbox on the floor), and orbits
   the camera around it (drag to rotate, wheel to zoom, slow idle spin).
   If the GLB can't load (e.g. the page is opened from file:// where fetch
   is blocked), a procedural hangar made of primitives is used instead, so
   the tank still stands in a garage. Only if even that fails does the
   legacy void preview run. */

window.Garage = (function(){
  'use strict';

  const GLB_URL = 'assets/garage/MTL_garage.glb';
  const MARKER_X = -0.9090448617935181;
  const MARKER_Z = -1.7285100221633911;
  const FALLBACK_FLOOR_Y = 9.48; // hangar floor slab top (from the GLB)
  const PROC_FLOOR_Y = 0;        // procedural hangar floor slab top

  let _gltfScene = null;   // cached parsed garage scene
  let _procedural = null;  // cached procedural fallback scene
  let _loading = null;     // promise while first load is in flight
  let _state = null;       // active preview state (null when stopped)

  /* Primitive-only hangar for environments where the GLB can't be fetched
     (file:// pages block fetch; the deployed site uses the real GLB). */
  function _buildProcedural(){
    const g = new THREE.Group();
    g.userData.procedural = true;
    const mat = o => new THREE.MeshStandardMaterial(o);
    const box = (w, h, d, m, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };

    const floorMat = mat({color: 0x33383f, roughness: 0.95, metalness: 0.05});
    box(46, 0.5, 46, floorMat, 0, -0.25, 0);
    const ringMat = mat({color: 0x1a1e24, roughness: 0.9});
    box(46.2, 0.7, 46.2, ringMat, 0, -0.6, 0);
    const grid = new THREE.GridHelper(40, 20, 0x2b3037, 0x24292f);
    grid.position.y = 0.01;
    g.add(grid);

    // Marker circle where the tank parks
    const markMat = mat({color: 0x14171c, roughness: 1});
    const mark = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.02, 48), markMat);
    mark.position.set(0, 0.02, 0);
    g.add(mark);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.15, 3.35, 48), mat({color: 0x4a525c, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide}));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.03, 0);
    g.add(ring);

    // Walls: one side is the hangar door, the rest are plain panels
    const wallMat = mat({color: 0x272c33, roughness: 0.95});
    const trimMat = mat({color: 0x3c434c, roughness: 0.9});
    const wallT = 0.6;
    box(46, 6.4, wallT, wallMat, 0, 3.2, -23);   // -Z (door wall, panelled below)
    box(wallT, 6.4, 46, wallMat, -23, 3.2, 0);   // -X
    box(wallT, 6.4, 46, wallMat, 23, 3.2, 0);    // +X
    box(46, 6.4, wallT, wallMat, 0, 3.2, 23);    // +Z
    [[-8, 0], [8, 0], [0, -10], [0, 10]].forEach(p => {
      box(2.6, 5.2, 0.15, trimMat, p[0], 3.3, p[1]);
    });
    // Door: dark recessed panel with slats on the -Z wall
    const doorMat = mat({color: 0x171a1f, roughness: 1});
    box(13, 5.8, 0.5, doorMat, 0, 3.0, -23.2);
    const slatMat = mat({color: 0x22262c, roughness: 1});
    for(let i = -5; i <= 5; i++){
      if(i === 0) continue;
      box(0.7, 5.8, 0.3, slatMat, i * 1.1, 3.0, -23.45);
    }
    // Door frame posts
    const postMat = mat({color: 0x4a525c, roughness: 0.7, metalness: 0.25});
    box(0.8, 6.6, 0.8, postMat, -6.6, 3.3, -23.3);
    box(0.8, 6.6, 0.8, postMat, 6.6, 3.3, -23.3);

    // Ceiling with glowing light strips
    const ceilMat = mat({color: 0x22262c, roughness: 0.95});
    box(46, 0.4, 46, ceilMat, 0, 6.6, 0);
    const glowMat = new THREE.MeshBasicMaterial({color: 0xdfe9f5});
    const glow1 = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 9), glowMat);
    glow1.position.set(-6, 6.44, 0);
    g.add(glow1);
    const glow2 = glow1.clone();
    glow2.position.set(0, 6.44, 0);
    g.add(glow2);
    const glow3 = glow1.clone();
    glow3.position.set(6, 6.44, 0);
    g.add(glow3);

    // A few crates for depth
    const crateMat = mat({color: 0x3e444c, roughness: 0.85});
    const crate = (s, x, z, ry) => {
      const c = box(s, s * 0.8, s, crateMat, x, s * 0.4, z);
      c.rotation.y = ry || 0;
    };
    crate(1.6, 8.2, 3.4, 0.5);
    crate(1.1, 9.4, 4.9, 0.15);
    crate(1.4, -9.0, -3.2, 0.9);
    crate(0.9, -10.1, -1.9, 0.3);
    crate(1.2, 3.4, 9.3, 0.05);

    return g;
  }

  function _load(){
    if(_gltfScene) return Promise.resolve(_gltfScene);
    if(_procedural) return Promise.resolve(_procedural);
    const Loader = (THREE && THREE.GLTFLoader) || window.GLTFLoader;
    if(!Loader) return Promise.resolve(_buildProcedural());
    const loader = new Loader();
    _loading = new Promise((resolve) => {
      loader.load(GLB_URL, gltf => {
        _gltfScene = gltf.scene;
        _loading = null;
        resolve(_gltfScene);
      }, undefined, () => {
        // fetch failed (file://, offline, CDN down) → procedural hangar
        _loading = null;
        _procedural = _buildProcedural();
        resolve(_procedural);
      });
    });
    return _loading;
  }

  function _floorYAt(gltfScene, x, z){
    if(!gltfScene || !window.THREE) return FALLBACK_FLOOR_Y;
    gltfScene.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    raycaster.ray.origin.set(x, 200, z);
    raycaster.ray.direction.set(0, -1, 0);
    raycaster.far = 400;
    const hits = raycaster.intersectObjects(gltfScene.children, true).filter(h => h.object.isMesh);
    return (hits.length ? hits[0].point.y : FALLBACK_FLOOR_Y);
  }

  /* Box-model tank, same look as the old menu preview */
  function _buildTank(def){
    const tank = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({color: def.color, roughness: 0.65, metalness: 0.2});
    const b = def.body;
    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.l), bodyMat);
    bodyMesh.position.y = b.h / 2;
    bodyMesh.castShadow = true;
    tank.add(bodyMesh);
    try{ tank.add(Tank.createOutlineMesh(bodyMesh)); }catch(e){}

    const treadMat = new THREE.MeshStandardMaterial({color: 0x222226, roughness: 1});
    [-1, 1].forEach(s => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, b.l + 0.2), treadMat);
      t.position.set(s * (b.w / 2 + 0.05), 0.25, 0);
      t.castShadow = true;
      tank.add(t);
    });

    const turretGroup = new THREE.Group();
    const tDef = def.turret;
    const turretMat = new THREE.MeshStandardMaterial({color: def.turretColor, roughness: 0.65, metalness: 0.2});
    const turretMesh = new THREE.Mesh(new THREE.BoxGeometry(tDef.w, tDef.h, tDef.l), turretMat);
    turretMesh.position.y = tDef.h / 2;
    turretMesh.castShadow = true;
    turretGroup.add(turretMesh);
    try{ turretGroup.add(Tank.createOutlineMesh(turretMesh)); }catch(e){}

    const barrelMat = new THREE.MeshStandardMaterial({color: 0x2a2a2e, roughness: 0.65, metalness: 0.2});
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(def.barrelR, def.barrelR, def.barrelLen, 10), barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, tDef.h * 0.4, tDef.l / 2 + def.barrelLen / 2);
    turretGroup.add(barrel);

    turretGroup.position.y = b.h;
    tank.add(turretGroup);
    return { tank, turretGroup };
  }

  /* ---------- public API ---------- */

  function start(host, selectedTankId){
    if(!host || !window.THREE) return false;
    const hasTanks = typeof TANKS !== 'undefined' && TANKS !== null;
    const def = (hasTanks && TANKS[selectedTankId]) || (hasTanks && TANKS.coolbuddy);
    if(!def) return false;
    stop();

    const _ = {
      host, def, floorY: FALLBACK_FLOOR_Y, tankGroup: null, turretGroup: null,
      scene: null, cam: null, renderer: null, rafId: 0,
      focusX: MARKER_X, focusZ: MARKER_Z,
      yaw: Math.PI * 0.22, pitch: 0.22, radius: 9.5,
      dragging: false, lastX: 0, lastY: 0, t: 0, ready: false,
    };
    _state = _;

    const W = host.clientWidth || 320;
    const H = host.clientHeight || 220;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d11);
    _.scene = scene;

    const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 800);
    _.cam = cam;

    const renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.setSize(W, H);
    host.innerHTML = '';
    host.appendChild(renderer.domElement);
    _.renderer = renderer;

    // Hangar lighting: dim base + hot spots over the tank
    const hemi = new THREE.HemisphereLight(0x9fb4d8, 0x2a2620, 0.55);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff2dc, 1.15);
    key.position.set(14, 22, 10);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fa8ff, 0.5);
    rim.position.set(-14, 18, -12);
    scene.add(rim);
    const amb = new THREE.AmbientLight(0x30343c, 0.8);
    scene.add(amb);

    // Tank (built now; positioned once the floor height is known)
    const built = _buildTank(def);
    _.tankGroup = built.tank;
    _.turretGroup = built.turretGroup;
    scene.add(built.tank);

    // Resize
    const onResize = () => {
      const w = host.clientWidth || 320, h = host.clientHeight || 220;
      renderer.setSize(w, h);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    _.onResize = onResize;

    // Orbit interaction (menu UI sits above this canvas, so only background drags land here)
    const onDown = e => {
      _.dragging = true; _.lastX = e.clientX; _.lastY = e.clientY;
      host.style.cursor = 'grabbing';
    };
    const onMove = e => {
      if(!_.dragging) return;
      const dx = e.clientX - _.lastX, dy = e.clientY - _.lastY;
      _.lastX = e.clientX; _.lastY = e.clientY;
      _.yaw -= dx * 0.006;
      _.pitch = Math.min(0.75, Math.max(0.05, _.pitch + dy * 0.006));
    };
    const onUp = () => { _.dragging = false; host.style.cursor = 'grab'; };
    const onWheel = e => {
      e.preventDefault();
      _.radius = Math.min(17, Math.max(5, _.radius + e.deltaY * 0.008));
    };
    host.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    host.addEventListener('wheel', onWheel, {passive: false});
    _.handlers = { onDown, onMove, onUp, onWheel };

    // Load the garage; procedural hangar replaces it if the GLB can't load
    _load().then(gltfScene => {
      if(_state !== _) return;
      if(_gltfScene) _gltfScene = gltfScene; // keep same instance
      scene.add(gltfScene);
      _.gltfScene = gltfScene;
      if(gltfScene.userData && gltfScene.userData.procedural){
        _.floorY = PROC_FLOOR_Y;
        _.tankGroup.position.set(0, PROC_FLOOR_Y, 0);
        _.tankGroup.rotation.y = Math.PI; // face the camera
      }else{
        // "tank" anchor in the export marks the tank hitbox centre; stand the
        // tank on the floor directly below it (bottom face of the hitbox)
        let anchor = gltfScene.getObjectByName('tank');
        if(anchor){
          anchor.updateWorldMatrix(true, false);
          const p = anchor.getWorldPosition(new THREE.Vector3());
          _.focusX = p.x;
          _.focusZ = p.z;
        }
        _.floorY = _floorYAt(gltfScene, _.focusX, _.focusZ);
        // Hide the exported stand-in tank parts so only our tank shows
        gltfScene.traverse(o => {
          if(o.isMesh && o.parent && /^(RootNode|RootNode\.\d+)$/.test(o.parent.name)){
            o.visible = false;
          }
        });
        _.tankGroup.position.set(_.focusX, _.floorY, _.focusZ);
        _.tankGroup.rotation.y = Math.atan2(_.focusX, _.focusZ) + Math.PI;
      }
      _.ready = true;
      host.style.backgroundImage = 'none';
      host.classList.add('garage-active');
    }).catch(err => {
      if(_state !== _) return;
      console.warn('Garage load failed:', err);
      stop();
      window.Garage._failed = true;
      if(Menu && Menu._startMainPreviewLegacy) Menu._startMainPreviewLegacy(host);
    });

    const loop = () => {
      _.rafId = requestAnimationFrame(loop);
      if(!_.ready) return;
      _.t += 0.016;

      // Slow idle spin until the user grabs the camera
      if(!_.dragging) _.yaw += 0.1 * 0.016;
      // Turret lazily scans
      if(_.turretGroup) _.turretGroup.rotation.y = Math.sin(_.t * 0.25) * 0.55;

      const cy = Math.cos(_.pitch), sy = Math.sin(_.pitch);
      const cx = Math.cos(_.yaw), sx = Math.sin(_.yaw);
      const tgtY = _.floorY + 1.6;
      cam.position.set(
        _.focusX + _.radius * cy * sx,
        tgtY + _.radius * sy,
        _.focusZ + _.radius * cy * cx
      );
      cam.lookAt(_.focusX, tgtY, _.focusZ);
      renderer.render(scene, cam);
    };
    _.rafId = requestAnimationFrame(loop);
    return true;
  }

  function stop(){
    const _ = _state;
    if(!_) return;
    _state = null;
    if(_.rafId) cancelAnimationFrame(_.rafId);
    if(_.handlers){
      _.host.removeEventListener('pointerdown', _.handlers.onDown);
      window.removeEventListener('pointermove', _.handlers.onMove);
      window.removeEventListener('pointerup', _.handlers.onUp);
      _.host.removeEventListener('wheel', _.handlers.onWheel);
    }
    if(_.onResize) window.removeEventListener('resize', _.onResize);
    if(_.renderer){ _.renderer.dispose(); }
    if(_.host){
      _.host.innerHTML = '';
      _.host.style.backgroundImage = '';
      _.host.classList.remove('garage-active');
    }
    // Keep the parsed GLB in memory so returning to the menu is instant
  }

  return {
    start, stop,
    get ready(){ return !!_gltfScene || !!_procedural; },
    get active(){ return !!_state; },
    get state(){ return _state; }
  };
})();