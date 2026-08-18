// Shortest signed angle diff from b to a, in (-PI, PI]
function _angDiff(a, b){
  let d = (a - b) % (Math.PI * 2);
  if(d > Math.PI) d -= Math.PI * 2;
  if(d < -Math.PI) d += Math.PI * 2;
  return d;
}

class Tank {
  constructor(def, opts={}){
    this.def = def;
    this.id   = opts.id   || ('tank_'+Math.random().toString(36).slice(2,8));
    this.name = opts.name || 'Tank';
    this.isLocal = !!opts.isLocal;
    this.isBot   = !!opts.isBot;
    this.color   = opts.color != null ? opts.color : def.color;
    this.ownerPeer = opts.ownerPeer || null;

    this.x = opts.x || 0;
    this.z = opts.z || 0;
    this.heading = opts.heading || 0;
    this.turretAngle = opts.turretAngle || 0;
    this.speed = 0;
    this.vx = 0; this.vz = 0;
    this.drifting = false;

    this.trailSegments = [];
    this._trailTimer = 0;

    this.maxHp = def.hp; this.hp = this.maxHp;
    this.mass  = def.mass || 30;
    this.viewRange = def.viewRange || 70;
    this.alive = true; this.respawnAt = 0;
    this.damageDealt = 0; this.kills = 0;
    this.reloadLeft = 0;
    this.mag = def.magSize || 1;
    this.magReloadLeft = 0;

    // Super ability state
    this.superCdLeft = 0;
    this.superCdTotal = (CONFIG && CONFIG.SUPER_COOLDOWN) || 60;
    this.superState = null;   // targeting|strike|windup|cloaked|panzer_drop|oil_fill|oil_burn
    this.superTimer = 0;
    this.superTarget = null;
    this.myBushes = [];
    this.allyId = null;
    this._cloakedMats = [];

    this.heat = 0;
    this.overheated = false;

    // Gladiator power: 1 power = +1% damage, +1% max HP, +1% size
    this.power = 0;
    this.hitScale = 1;

    this.camoState = null;
    this.camoFactor = 1;

    this.dying = false;
    this.deathT = 0;
    this.removeAt = -1;
    this._uiScale = 1.0;

    const _edOv = (window.TANK_EDITOR_OVERRIDES && window.TANK_EDITOR_OVERRIDES[def.id]) || null;
    this._edOv = _edOv;
    this._modelYaw = (def && def.modelYaw != null) ? def.modelYaw * Math.PI / 180 : 0;
    this._modelOff = new THREE.Vector3();
    this.colHalfW = def.body.w*0.55;
    this.colHalfL = def.body.l*0.55;
    if(_edOv && _edOv.body){
      // Tank Editor override: collision hitbox front/sides/height
      const _b = _edOv.body;
      this.colHalfW = Math.max(0.1, _b.w || def.body.w) * 0.55;
      this.colHalfL = Math.max(0.1, _b.l || def.body.l) * 0.55;
    }

    this._physBody = null;
    this._physCollider = null;
    this._physWorld = opts.physicsWorld || null;
    this._createPhysBody();

    this._inWater = false;

    this._buildCubeMesh();
    if(Models && this.def.model && Models.hasModel(this.def.model)) this._loadModel();
  }

  _createPhysBody(){
    if(!this._physWorld || typeof RAPIER === 'undefined') return;
    try {
      var desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.x, 0.9, this.z)
        .setEnabledRotations(false, true, false)
        .setEnabledTranslations(true, false, true)
        .setLinearDamping(0.5)
        .setAngularDamping(2.0)
        .setMass(this.mass);
      this._physBody = this._physWorld.createRigidBody(desc);
      var col = RAPIER.ColliderDesc.cuboid(this.colHalfW, 0.5, this.colHalfL)
        .setFriction(0.8)
        .setRestitution(0.05)
        .setDensity(this.mass / (this.colHalfW * 2 * this.colHalfL * 2))
        .setSolverGroups(1)
        .setCollisionGroups(1);
      this._physCollider = this._physWorld.createCollider(col, this._physBody);
      if(this._physCollider && typeof this._physCollider.setActiveEvents === 'function'){
        this._physCollider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      }
      this._physCollider.userData = {type:'tank', tank:this};
    } catch(e){ this._physBody = null; }
  }

  _applyEditorOverrides(){
    // Tank Editor (Editor123) overrides: reapplied after the model finishes
    // building so the hitbox, turret pivot, turret position and firing point
    // match the saved values.
    const ov = this._edOv;
    if(!ov) return;
    if(ov.body && this.bodyMesh && this.bodyMesh.geometry && this.bodyMesh.geometry.parameters){
      const g = this.bodyMesh.geometry.parameters;
      const s = ov.body;
      this.bodyMesh.scale.set(
        (s.w && g.width) ? Math.max(0.05, s.w / g.width) : 1,
        (s.h && g.height) ? Math.max(0.05, s.h / g.height) : 1,
        (s.l && g.depth) ? Math.max(0.05, s.l / g.depth) : 1
      );
    }
    if(ov.pivot && this._modelTurretPivot){
      this._modelTurretPivot.position.set(ov.pivot.x || 0, ov.pivot.y || 0, ov.pivot.z || 0);
    }
    if(ov.turret && this._turretHome){
      this._turretHome.set(ov.turret.x || 0, ov.turret.y || 0, ov.turret.z || 0);
    }
    // Re-home the turret mesh so a moved pivot only changes the ROTATION
    // point and a moved turret marker only changes where the turret sits
    // on the hull (never let the two drag each other).
    this._applyTurretPlacement();
    if(ov.casing && this._casingOffset){
      this._casingOffset.set(ov.casing.x || 0, ov.casing.y || 0, ov.casing.z || 0);
    }
    if(ov.shell && this.barrelEnd){
      this.barrelEnd.position.set(ov.shell.x || 0, ov.shell.y || 0, ov.shell.z || 0);
    }
    if(ov.model && this._syncTransform){
      const defYaw = (this.def && this.def.modelYaw != null) ? this.def.modelYaw : 0;
      this._modelYaw = (typeof ov.model.yaw === 'number') ? ov.model.yaw * Math.PI / 180 : defYaw * Math.PI / 180;
      if(!this._modelOff) this._modelOff = new THREE.Vector3();
      this._modelOff.set(ov.model.x || 0, ov.model.y || 0, ov.model.z || 0);
      this._syncTransform();
    }
  }

  /* turretG lives inside turretPivot, so its world position would follow the
     pivot's position. Keep the turret mesh planted at _turretHome (its mount
     point, in turretParts space) and let the pivot handle rotation only:
     turretG.local = home - pivot. */
  _applyTurretPlacement(){
    if(!this._turretG || !this._modelTurretPivot) return;
    const O = this._turretHome || new THREE.Vector3(0, 0, 0);
    const P = this._modelTurretPivot.position;
    this._turretG.position.set(O.x - P.x, O.y - P.y, O.z - P.z);
    this._turretG.updateMatrixWorld(true);
  }

  /* Create an AnimationMixer for the model's GLB clips and loop the
     requested animation (default: the first clip, e.g. Cool Buddy's
     "gun firing" fire effect). Tracks resolve by node name against
     this.root, so they keep working after the named hull/turret groups
     are re-parented into bodyParts/turretParts. */
  _setupAnims(grp){
    if(this._animMixer){
      try{ this._animMixer.stopAllAction(); }catch(e){}
      this._animMixer = null;
    }
    if(this._edOv && this._edOv.model && this._edOv.model.anim === false) return;
    if(this.def && this.def.playAnims === false) return;
    const clips = (grp && grp.userData && grp.userData.anims) || null;
    if(!clips || !clips.length) return;
    const wanted = [];
    const want = (this.def && this.def.fireAnim) || null;
    if(want){
      const lw = String(want).toLowerCase();
      for(let i = 0; i < clips.length; i++){
        if(clips[i] && clips[i].name && String(clips[i].name).toLowerCase() === lw) wanted.push(clips[i]);
      }
    }
    if(!wanted.length){
      // No specific clip requested: play every clip. A model's firing
      // animation is often split across several tracks (one per barrel part),
      // so all of them must run together for the recoil to look right.
      for(const c of clips){ if(c) wanted.push(c); }
    }
    if(!wanted.length) return;
    try{
      const mixer = new THREE.AnimationMixer(this.root);
      for(const clip of wanted){
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = true;
        action.play();
      }
      this._animMixer = mixer;
    }catch(e){ console.warn('tank anim:', e); this._animMixer = null; }
  }

  _tankMat(color){
    return new THREE.MeshStandardMaterial({color, roughness:0.65, metalness:0.2, flatShading:false});
  }

  _buildCubeMesh(){
    this.bodyGroup = new THREE.Group();
    const b = this.def.body;
    this.bodyMat = this._tankMat(this.color);
    this.bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.l), this.bodyMat);
    this.bodyMesh.position.y = b.h/2 + 0.45;
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.bodyGroup.add(this.bodyMesh);

    const treadMat = new THREE.MeshStandardMaterial({color:0x222226, roughness:1});
    [-1,1].forEach(s=>{
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, b.l+0.2), treadMat);
      t.position.set(s*(b.w/2+0.05), 0.35, 0);
      t.castShadow = true;
      t.receiveShadow = true;
      this.bodyGroup.add(t);
      this._addOutline(t, this.bodyGroup);
    });

    this.turretGroup = new THREE.Group();
    const t = this.def.turret;
    this.turretMat = this._tankMat(this.def.turretColor);
    this.turretMesh = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.l), this.turretMat);
    this.turretMesh.position.y = t.h/2;
    this.turretMesh.castShadow = true;
    this.turretMesh.receiveShadow = true;
    this.turretGroup.add(this.turretMesh);

    this.barrelMat = new THREE.MeshStandardMaterial({color:0x2a2a2e, roughness:0.65, metalness:0.2});
    const barrelMat = this.barrelMat;
    const bl = this.def.barrelLen, br = this.def.barrelR;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(br, br, bl, 10), barrelMat);
    barrel.rotation.x = Math.PI/2;
    barrel.position.set(0, t.h*0.4, t.l/2 + bl/2);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    this.turretGroup.add(barrel);
    this._addOutline(barrel, this.turretGroup);
    this.barrelEnd = new THREE.Object3D();
    this.barrelEnd.position.set(0, t.h*0.4, t.l/2 + bl + 0.2);
    this.turretGroup.add(this.barrelEnd);

    this._addOutline(this.bodyMesh, this.bodyGroup);
    this._addOutline(this.turretMesh, this.turretGroup);

    this.root = new THREE.Group();
    this.root.add(this.bodyGroup);
    this.root.add(this.turretGroup);
    this._addOverlays(t.h);
    this._syncTransform();
    this._applyEditorOverrides();
  }

  static createOutlineMesh(mesh, thickness){
    const t = thickness != null ? thickness : 0.04;
    const geo = mesh.geometry.clone();
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    if (pos && norm) {
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i,
          pos.getX(i) + norm.getX(i) * t,
          pos.getY(i) + norm.getY(i) * t,
          pos.getZ(i) + norm.getZ(i) * t
        );
      }
      pos.needsUpdate = true;
    }
    const mat = new THREE.MeshBasicMaterial({color: 0x000000, side: THREE.BackSide});
    const outline = new THREE.Mesh(geo, mat);
    outline.position.copy(mesh.position);
    outline.rotation.copy(mesh.rotation);
    outline.scale.copy(mesh.scale);
    outline.renderOrder = -1;
    outline.userData.isOutline = true;
    return outline;
  }

  _wantsOutline(){
    if(this._edOv && this._edOv.model && this._edOv.model.outline === false) return false;
    if(this.def && this.def.outline === false) return false;
    return true;
  }

  _addOutline(mesh, group, thickness){
    // Parent the outline INTO the mesh itself (identity local transform) so it
    // inherits the mesh's own rotation — turret-pivot meshes rotate with the
    // turretAngle, and the outline must follow instead of staying fixed as a
    // group sibling.
    if(!this._wantsOutline()) return;
    const outline = Tank.createOutlineMesh(mesh, thickness);
    outline.position.set(0, 0, 0);
    outline.rotation.set(0, 0, 0);
    outline.scale.set(1, 1, 1);
    mesh.add(outline);
  }

  _loadModel(){
    if(!this.def.model){ this._modelReady = Promise.resolve(); return; } // cube model unless explicitly requested
    this._modelReady = Models.load(this.def.model).then(grp=>{
      if(!grp) return;
      this._clearGroup(this.bodyGroup);
      this._clearGroup(this.turretGroup);
      const scale = this.def.modelScale || 1.0;
      grp.scale.setScalar(scale);

      // --- Named-group rig: the model carries "hull" / "turret" /
      //     "gun" / "shell" groups so parts are found by name ---
      const norm = (s) => String(s).toLowerCase().replace(/[\s_]/g, '');
      const findNamed = (root, name) => {
        const t = norm(name);
        let out = null;
        root.traverse(o => { if(!out && o.name && norm(o.name) === t) out = o; });
        return out;
      };
      const hullG = findNamed(grp, 'hull');
      const turretG = findNamed(grp, 'turret');
      const shellG = findNamed(grp, 'shell') || findNamed(grp, 'shell_ejection') || findNamed(grp, 'gun');
      if(hullG && turretG && hullG !== turretG){
        this._attachNamedModel(grp, hullG, turretG, shellG, scale);
        return;
      }

      // --- Named-empty rig: models like ghost.glb carry "firing" (muzzle),
      //     "shell_ejection" (casing port) and "attachment" (cosmetic, unused)
      //     empties instead of hull/turret groups. The model is used as
      //     authored (front = +Z); the Tank Editor can fix the facing via a
      //     saved modelYaw override. Wire muzzle + shell markers below.
      const firingG = findNamed(grp, 'firing');
      const ejectG = findNamed(grp, 'shell_ejection') || findNamed(grp, 'shell');
      // The model is authored with its front/barrel facing +Z. Do not rotate
      // the whole model here: authors can fix the facing from the Tank
      // Editor's "Model front" mode (saved as a modelYaw override).
      // Center the model on its x/z bounds so the tank pivot sits at the
      // geometric center (the game steers about its origin), and rest the
      // lowest point on the ground plane.
      {
        const gb = new THREE.Box3().setFromObject(grp);
        const gc = gb.getCenter(new THREE.Vector3());
        grp.position.x -= gc.x;
        grp.position.z -= gc.z;
        grp.position.y -= gb.min.y;
        grp.updateMatrixWorld(true);
      }

      let minY = Infinity, maxY = -Infinity;
      const meshes = [];
      grp.traverse(o => { if(o.isMesh){ meshes.push(o); const b=new THREE.Box3().setFromObject(o); minY=Math.min(minY,b.min.y); maxY=Math.max(maxY,b.max.y); } });
      const midY = minY + (maxY - minY) * 0.4;

      const bodyParts = new THREE.Group();
      const turretParts = new THREE.Group();
      const tmp = new THREE.Vector3();
      const yOff = this.def.body.h + 0.45;

      const applyMatColor = (m, col) => {
        if(Array.isArray(m.material)) m.material.forEach(mat => mat.color.set(col));
        else m.material.color.set(col);
      };

      meshes.forEach(m => {
        m.getWorldPosition(tmp);
        m.castShadow = true;
        m.receiveShadow = true;
        if(tmp.y > midY){
          applyMatColor(m, this.def.turretColor);
          turretParts.attach(m);
          m.position.y -= yOff;
        } else {
          applyMatColor(m, this.color);
          bodyParts.attach(m);
        }
      });

      const outlineT = 0.04 / scale;
      // Collect meshes first, then add outlines afterwards: a traverse that
      // adds a child INTO a visited mesh would descend into the fresh outline
      // and recurse forever, so never add outlines during a live traversal.
      let srcMeshes = [];
      bodyParts.traverse(o => { if(o.isMesh) srcMeshes.push(o); });
      srcMeshes.forEach(m => this._addOutline(m, m.parent, outlineT));
      srcMeshes = [];
      turretParts.traverse(o => { if(o.isMesh) srcMeshes.push(o); });
      srcMeshes.forEach(m => this._addOutline(m, m.parent, outlineT));

      this.bodyGroup.add(bodyParts);
      this.turretGroup.add(turretParts);
      const t = this.def.turret;
      this.barrelEnd = new THREE.Object3D();
      this.barrelEnd.position.set(0, t.h*0.6, t.l + this.def.barrelLen);
      this.turretGroup.add(this.barrelEnd);

      // Named-empty markers: place the muzzle at the "firing" empty and the
      // casing port at "shell_ejection" so they ride the turret rotation.
      this.root.updateMatrixWorld(true);
      if(firingG){
        grp.updateMatrixWorld(true);
        const wp = new THREE.Vector3();
        firingG.getWorldPosition(wp);
        this.barrelEnd.position.copy(this.turretGroup.worldToLocal(wp));
      }
      if(ejectG){
        grp.updateMatrixWorld(true);
        const wp2 = new THREE.Vector3();
        ejectG.getWorldPosition(wp2);
        this._shellNode = new THREE.Object3D();
        this._shellNode.position.copy(this.turretGroup.worldToLocal(wp2));
        this.turretGroup.add(this._shellNode);
        this._casingOffset = this._shellNode.position.clone();
      }
      this._addOverlays(t.h);
      this._syncTransform();
      this._applyEditorOverrides();
      this._setupAnims(grp);
    });
  }

  _attachNamedModel(grp, hullG, turretG, shellG, scale){
    grp.updateMatrixWorld(true);
    // Center the model on its own bounds: x/z centered so the tank
    // pivot sits at the model center, y resting on the ground plane
    const bb = new THREE.Box3().setFromObject(grp);
    const c = bb.getCenter(new THREE.Vector3());
    grp.position.set(grp.position.x - c.x, grp.position.y - bb.min.y, grp.position.z - c.z);
    // The game aims turrets along +Z. The coolbuddy model is authored with
    // the whole tank's front/back sides swapped relative to the game AND the
    // barrel is baked into the turret mesh itself, so for def.modelFlipY we
    // bake a 180° Y-flip into the hull and turret MESH GEOMETRIES (each about
    // its own center, so pivots stay put) — the barrel/mantlet and the hull
    // front then face the game's +Z forward while the turret rotation still
    // works. Other models keep the auto whole-model flip.
    let flippedTurret = false;
    if(this.def.modelFlipY && turretG && hullG){
      const bakeFlip = (g) => {
        // Models.load returns a clone that SHARES geometry with the cached
        // scene (three.js clone() clones the object tree but not buffers), so
        // never mutate that shared geometry in place: cloning it here makes
        // every rebuild of the same tank flip its own copy exactly once.
        if(!g.geometry || !g.geometry.attributes) return;
        g.geometry = g.geometry.clone();
        const a = g.geometry.attributes.position;
        const box = new THREE.Box3();
        const v = new THREE.Vector3();
        for(let i=0;i<a.count;i++){
          v.fromBufferAttribute(a, i);
          box.expandByPoint(v);
        }
        const ctr = box.getCenter(new THREE.Vector3());
        g.geometry.translate(-ctr.x, -ctr.y, -ctr.z)
          .rotateY(Math.PI)
          .translate(ctr.x, ctr.y, ctr.z);
      };
      bakeFlip(turretG);
      bakeFlip(hullG);
      // Marker empties (gun muzzle / shell port) ride inside the turret
      // pivot: flip them with a 180° group so they sit at the flipped
      // barrel tip and shell port positions.
      const flipT = new THREE.Group();
      flipT.rotation.y = Math.PI;
      turretG.children.slice().forEach(ch => flipT.add(ch));
      turretG.add(flipT);
      flippedTurret = true;
    } else if(shellG && this.def.modelAutoFlip !== false){
      grp.updateMatrixWorld(true);
      const p = new THREE.Vector3();
      shellG.getWorldPosition(p);
      if(p.z < 0) grp.rotation.y = Math.PI;
    }
    grp.updateMatrixWorld(true);

    const bodyParts = new THREE.Group();
    const turretParts = new THREE.Group();
    // Recolor only untextured materials: textured models keep the
    // authored paint job; clone so hull/turret colors never conflict
    const tint = (g, col) => g.traverse(o => {
      if(!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const colored = mats.map(m => {
        const c = m.clone();
        if(!c.map) c.color.set(col);
        else c.alphaTest = Math.max(c.alphaTest || 0, 0.5);
        return c;
      });
      o.material = Array.isArray(o.material) ? colored : colored[0];
    });
    tint(hullG, this.color);
    tint(turretG, this.def.turretColor);
    bodyParts.attach(hullG);
    turretParts.attach(turretG);
    // Outlines are inflated in authored units, but the model is scaled
    // ~9x in world units: shrink the inflation so the rim stays thin
    const outlineT = 0.04 / (scale || 1);
    let srcMeshes = [];
    bodyParts.traverse(o => { if(o.isMesh) srcMeshes.push(o); });
    srcMeshes.forEach(m => this._addOutline(m, m.parent, outlineT));
    srcMeshes = [];
    turretParts.traverse(o => { if(o.isMesh) srcMeshes.push(o); });
    srcMeshes.forEach(m => this._addOutline(m, m.parent, outlineT));
    this.bodyGroup.add(bodyParts);
    this.turretGroup.add(turretParts);

    // Give every named model a dedicated pivot at the turret's geometric
    // center so the turret+outline swing around the turret's own center bolt
    // by default. The Tank Editor can move it (rotation-only; the turret
    // mesh stays planted at its mount point).
    this.root.updateMatrixWorld(true);
    // Mount point of the turret (where it sits on the hull, at 0°). Kept in
    // turretParts space: the pivot below can then move freely and change the
    // ROTATION point without dragging the turret mesh along.
    const homeV = new THREE.Vector3();
    turretG.getWorldPosition(homeV);
    this._turretHome = turretParts.worldToLocal(homeV);
    this._turretG = turretG;
    const pivotBox = new THREE.Box3().setFromObject(turretG);
    const pivotC = pivotBox.getCenter(new THREE.Vector3());
    const turretPivotLocal = turretParts.worldToLocal(pivotC);
    const turretPivot = new THREE.Group();
    turretPivot.position.copy(turretPivotLocal);
    turretParts.add(turretPivot);
    turretPivot.updateMatrixWorld(true);
    turretPivot.attach(turretG);
    // Keep the turret mesh at its authored home (attach already sets
    // turretG.local = home - pivot).
    this._applyTurretPlacement();

    // The turret group rotates about this dedicated front pivot node
    this._modelTurretPivot = turretPivot;
    // Shell-casing eject node (marked in the model: "shell")
    this._shellNode = shellG || null;
    // Cache the casing port's offset relative to the turret at bind pose so
    // casing eject never rides a firing/casing animation keyframed on that
    // node (Cool Buddy's "gun firing" clip scatters/rotates it).
    this.root.updateMatrixWorld(true);
    this._casingOffset = null;
    if(this._shellNode){
      const wpv = new THREE.Vector3();
      this._shellNode.getWorldPosition(wpv);
      this._casingOffset = this.turretGroup.worldToLocal(wpv);
    }
    // Muzzle spawn point (the FIRING point). Prefer an explicit "firing" /
    // "muzzle" empty if the model has one, else auto-derive it just past the
    // front-most extent of the turret (which contains the baked barrel).
    this.barrelEnd = new THREE.Object3D();
    const t = this.def.turret;
    const findNamedL = (root, name) => {
      const s = String(name).toLowerCase();
      let out = null;
      root.traverse(o => { if(!out && o.name && String(o.name).toLowerCase() === s) out = o; });
      return out;
    };
    const firingG = findNamedL(grp, 'firing') || findNamedL(grp, 'muzzle');
    if(firingG){
      grp.updateMatrixWorld(true);
      const wp = new THREE.Vector3();
      firingG.getWorldPosition(wp);
      this.barrelEnd.position.copy(turretG.worldToLocal(wp));
    } else if(shellG && flippedTurret){
      // Muzzle just past the front-most extent of the (now flipped) turret
      // so shells spawn right at the barrel tip. Computed on the turret's
      // own bounds so it works at any modelScale without hardcoding.
      const bb = new THREE.Box3().setFromObject(turretG);
      const off = (this.def.muzzleZOff != null ? this.def.muzzleZOff : 0.6);
      const muzzle = new THREE.Vector3(
        (bb.min.x + bb.max.x) / 2,
        (bb.min.y + bb.max.y) / 2,
        bb.max.z + off
      );
      const inv = new THREE.Matrix4().copy(turretG.matrixWorld).invert();
      muzzle.applyMatrix4(inv);
      this.barrelEnd.position.copy(muzzle);
    } else {
      this.barrelEnd.position.set(0, t.h*0.6, t.l + this.def.barrelLen);
    }
    turretG.add(this.barrelEnd);
    this._addOverlays(t.h);
    this._syncTransform();
    this._applyEditorOverrides();
    this._setupAnims(grp);
  }

  /* World position the ejected shell-casing flies out from. Uses the cached
     bind-pose offset so the firing/casing animation can't skew it. */
  casingPos(){
    this.root.updateMatrixWorld(true);
    if(this._casingOffset){
      const tmp = new THREE.Vector3().copy(this._casingOffset);
      return this.turretGroup.localToWorld(tmp);
    }
    if(this._shellNode){
      const p = new THREE.Vector3();
      this._shellNode.getWorldPosition(p);
      return p;
    }
    // No casing port on this model: eject from the muzzle instead
    const m = this.muzzle();
    return m.pos;
  }

  _clearGroup(g){
    for(let i=g.children.length-1;i>=0;i--){
      const c = g.children[i];
      if(c.userData && c.userData.isOverlay) continue;
      g.remove(c);
    }
  }

  _addOverlays(turretH){
    if(this._overlayGroup && this.hpSprite && this.hpSprite.parent === this._overlayGroup) return;
    this._overlayGroup = new THREE.Group();
    this.hpSprite = this._makeHpSprite();
    this.hpSprite.userData.isOverlay = true;
    this.hpSprite.renderOrder = 999;
    this.hpSprite.position.y = turretH + 2.4;
    this._overlayGroup.add(this.hpSprite);

    this._drownBar = this._makeDrownBar();
    this._drownBar.userData.isOverlay = true;
    this._drownBar.renderOrder = 999;
    this._drownBar.position.y = turretH + 1.5;
    this._overlayGroup.add(this._drownBar);
    this.root.add(this._overlayGroup);
    this._applyPowerScale();
  }

  _makeHpSprite(){
    const c = document.createElement('canvas'); c.width=256; c.height=80;
    this._hpCanvas = c; this._hpCtx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    this._hpTex = tex;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, depthTest:false, transparent:true}));
    spr.scale.set(3.4, 0.8, 1);
    this._drawHp();
    return spr;
  }
  _drawHp(){
    const c=this._hpCanvas, g=this._hpCtx;
    g.clearRect(0,0,256,80);
    // Name text (white with black outline, no background bar)
    g.font='bold 33px Segoe UI'; g.textAlign='center'; g.textBaseline='middle';
    g.strokeStyle='#000'; g.lineWidth=5; g.lineJoin='round';
    g.strokeText(this.name, 128, 26);
    g.fillStyle='#fff'; g.fillText(this.name, 128, 26);
    // HP bar background
    g.fillStyle='rgba(0,0,0,0.6)'; g.fillRect(8,44,240,20);
    // HP bar outline
    g.strokeStyle='#000'; g.lineWidth=3; g.strokeRect(8,44,240,20);
    // HP bar fill
    const pct = Math.max(0, this.hp/this.maxHp);
    const col = pct>0.6?'#3ad17a':(pct>0.3?'#ffb12b':'#ff3b3b');
    g.fillStyle=col; g.fillRect(11,47,234*pct,14);
    if(this._hpTex) this._hpTex.needsUpdate=true;
  }

  _makeDrownBar(){
    const c = document.createElement('canvas'); c.width=256; c.height=16;
    this._dbCtx = c.getContext('2d');
    this._dbTex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({map:this._dbTex, depthTest:false, transparent:true}));
    spr.scale.set(3.4, 0.21, 1);
    spr.userData.isOverlay = true;
    spr.visible = false;
    return spr;
  }
  _drawDrownBar(pct){
    const g = this._dbCtx;
    g.clearRect(0,0,256,16);
    g.fillStyle='rgba(0,0,0,0.6)'; g.fillRect(8,0,240,14);
    g.fillStyle='#44aaff'; g.fillRect(11,2,234*Math.min(1,pct),10);
    this._dbTex.needsUpdate = true;
  }

  _makeNameTag(text){
    const c = document.createElement('canvas'); c.width=256; c.height=64;
    const g = c.getContext('2d');
    g.fillStyle='rgba(0,0,0,0.5)'; g.fillRect(0,18,256,30);
    g.font='bold 22px Segoe UI'; g.fillStyle='#fff'; g.textAlign='center'; g.textBaseline='middle';
    g.fillText(text, 128, 33);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, depthTest:false, transparent:true}));
    spr.scale.set(3.2, 0.8, 1);
    return spr;
  }

  attach(scene){ this.scene = scene; scene.add(this.root); }
  detach(){ this.clearTrails(); if(this.scene){ this.scene.remove(this.root); this.scene=null; } this._removePhysBody(); }
  _removePhysBody(){
    if(this._physBody && this._physWorld){
      try { this._physWorld.removeRigidBody(this._physBody); } catch(e){}
      this._physBody = null;
    }
  }

  makeViewRangeCircle(){
    const w = this.def;
    const viewRange = w.viewRange || 70;
    const wf = Menu && Menu.settings ? Menu.settings.viewRangeWidth : 0.5;
    const innerR = viewRange * (1 - wf * 0.4);
    const geo = new THREE.RingGeometry(Math.max(0.1, innerR), viewRange, 64);
    geo.rotateX(-Math.PI/2);
    const mat = new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.25, side:THREE.DoubleSide, depthWrite:false});
    this.viewCircle = new THREE.Mesh(geo, mat);
    this.viewCircle.position.y = 0.2;
    this.root.add(this.viewCircle);
    return this.viewCircle;
  }

  refreshViewRangeWidth(){
    if(!this.viewCircle) return;
    const wf = Menu && Menu.settings ? Menu.settings.viewRangeWidth : 0.5;
    const viewRange = this.def.viewRange || 70;
    const innerR = viewRange * (1 - wf * 0.4);
    this.viewCircle.geometry.dispose();
    this.viewCircle.geometry = new THREE.RingGeometry(Math.max(0.1, innerR), viewRange, 64);
    this.viewCircle.geometry.rotateX(-Math.PI/2);
  }

  setViewRangeStyle(opacity, color){
    if(!this.viewCircle) return;
    this.viewCircle.material.opacity = opacity;
    this.viewCircle.material.color.set(color);
  }

  setInput(input){ this._input = input; }

  _readPhysicsState(){
    if(!this._physBody) return;
    try {
      var p = this._physBody.translation();
      this.x = p.x;
      this.z = p.z;
      var vel = this._physBody.linvel();
      this.vx = vel.x;
      this.vz = vel.z;
      var q = this._physBody.rotation();
      this.heading = 2 * Math.atan2(q.y, q.w);
      const fwdX = Math.sin(this.heading);
      const fwdZ = Math.cos(this.heading);
      this.speed = vel.x * fwdX + vel.z * fwdZ;
    } catch(e){}
  }

  update(dt, world, game){
    if(this._animMixer) this._animMixer.update(dt);
    this._updateTrails(dt, game);
    if(this.dying){
      this._updateDeath(dt, game);
      return;
    }
    if(!this.alive) return;

    if(this.netDriven){
      // Position/heading come from host snapshots (interpolated every frame);
      // skip local movement integration so snapshots don't fight the sim.
      this._netSmoothTick();
      if(world){
        this.camoState = world.hidingIn(this.x, this.z);
        this.camoFactor = world.camoFactor(this.x, this.z);
      }
      this._applyCamoVisual();
      this._syncTransform();
      return;
    }

    if(this._physBody){
      this._readPhysicsState();
    }

    const d = this.def;
    const inp = this._input || {};

    this.camoState = world.hidingIn(this.x, this.z);
    this.camoFactor = world.camoFactor(this.x, this.z);
    if(this.superState === 'cloaked'){
      this.camoFactor = 0;
      this.camoState = 'cloak';
    }
    this._applyCamoVisual();

    this.drifting = false;
    const hasTurn = !!inp.turn && Math.abs(inp.turn) > 0.001;
    const kmh = Math.abs(this.speed) * CONFIG.U_TO_KMH;
    // Drift needs genuine momentum: pass the hard speed floor AND a fraction
    // of this tank's own top speed, so heavy/slow tanks must be near their
    // max before traction breaks.
    const driftCap = d.speed * (1 - Math.min(0.35, (this.mass-18)/120));
    const hasMomentum = Math.abs(this.speed) >= driftCap * (CONFIG.DRIFT_MIN_SPEED_FRAC != null ? CONFIG.DRIFT_MIN_SPEED_FRAC : 0.6);
    if(inp.handbrake && kmh >= CONFIG.DRIFT_MIN_KMH && hasMomentum && hasTurn){
      this.drifting = true;
    }

    const effThrottle = this.drifting ? 0 : (inp.throttle||0);
    const speedCap = d.speed * (1 - Math.min(0.35, (this.mass-18)/120));
    const target = effThrottle * speedCap * (effThrottle < 0 ? 0.5 : 1);

    if(this._physBody){
      const fwdX = Math.sin(this.heading);
      const fwdZ = Math.cos(this.heading);
      const speedDeficit = target - this.speed;
      // Flip into reverse instantly: reversing against forward motion adds a
      // strong brake/backwards kick instead of coasting to a stop first.
      const reversing = target < 0 && this.speed > 0;
      const engineForce = speedDeficit * d.accel * this.mass * 2.0 * (reversing ? 3 : 1);
      this._physBody.addForce({x: fwdX * engineForce, y: 0, z: fwdZ * engineForce}, true);
      const turnRate = this.drifting ? d.turn * CONFIG.DRIFT_TURN_BOOST : d.turn;
      const targetAngVel = hasTurn ? inp.turn * turnRate * 3.0 : 0;
      this._physBody.setAngvel({x: 0, y: targetAngVel, z: 0}, true);
      if(this.drifting){
        this._physCollider.setFriction(0.05);
      } else {
        this._physCollider.setFriction(d.friction || 0.8);
      }
    } else {
      if(this.speed < target){
        this.speed = Math.min(target, this.speed + d.accel * dt);
      } else if(this.speed > target){
        const noThrottle = Math.abs(effThrottle) < 0.08;
        // Flip into reverse instantly: reversing against forward motion
        // brakes hard so the tank swings backwards right away instead of
        // coasting to a stop and only then accelerating in reverse.
        const reversing = target < 0 && this.speed > 0;
        const brakeMul = reversing ? 10.0 : ((noThrottle && !this.drifting) ? 5.0 : 1.4);
        this.speed = Math.max(target, this.speed - d.accel * dt * brakeMul);
      }

      if(this.drifting){
        this.heading += inp.turn * d.turn * CONFIG.DRIFT_TURN_BOOST * dt;
      } else if(hasTurn){
        this.heading += inp.turn * d.turn * dt;
      }

      const fx = Math.sin(this.heading) * this.speed;
      const fz = Math.cos(this.heading) * this.speed;
      const alignRate = this.drifting ? 2 : 40;
      this.vx += (fx - this.vx) * Math.min(1, alignRate * dt);
      this.vz += (fz - this.vz) * Math.min(1, alignRate * dt);
      const frictionPerSec = this.drifting ? 0.65 : 0.25;
      this.vx *= Math.pow(frictionPerSec, dt);
      this.vz *= Math.pow(frictionPerSec, dt);
      const noThrottle = Math.abs(inp.throttle||0) < 0.08;
      if(noThrottle){
        this.vx *= Math.pow(0.001, dt);
        this.vz *= Math.pow(0.001, dt);
        if(Math.hypot(this.vx, this.vz) < 0.02){
          this.vx = 0; this.vz = 0; this.speed = 0;
        }
      }
      var nx = this.x + this.vx * dt;
      var nz = this.z + this.vz * dt;
      const inWater = !!(world && world.lakeAt(nx, nz));
      if(inWater){
        this.speed *= 0.5; this.vx *= 0.5; this.vz *= 0.5;
      }
      this._inWater = inWater;
      const r = Math.max(this.colHalfW, this.colHalfL);
      if(!world.collides(nx, this.z, r)) this.x = nx;
      else { this.speed *= 0.5; this.vx *= 0.4; }
      if(!world.collides(this.x, nz, r)) this.z = nz;
      else { this.speed *= 0.5; this.vz *= 0.4; }
      const lim = world.half - 3;
      this.x = Math.max(-lim, Math.min(lim, this.x));
      this.z = Math.max(-lim, Math.min(lim, this.z));
    }

    if(game) this._ramCheck(game);

    // Smoke from tracks when drifting (fancy only)
    if(this.drifting && game && game.isFancy){
      this._driftSmokeTimer = (this._driftSmokeTimer || 0) + dt;
      if(this._driftSmokeTimer >= 0.08){
        this._driftSmokeTimer = 0;
        const bw = this.def.body.w / 2 + 0.3, bl = this.def.body.l / 2;
        const perpX = Math.cos(this.heading), perpZ = -Math.sin(this.heading);
        for(let side=-1; side<=1; side+=2){
          const sx = this.x + perpX * bw * side + (Math.random() - 0.5) * 0.3;
          const sz = this.z + perpZ * bw * side + (Math.random() - 0.5) * 0.3;
          game.spawnExhaust(sx, 0.08, sz, this.heading + Math.PI * 0.5 * side, 20);
        }
      }
    }

    if(inp.turretWorldAngle != null){
      let diff = ((inp.turretWorldAngle - this.turretAngle + Math.PI) % (Math.PI*2)) - Math.PI;
      const maxStep = d.turretTurn * dt;
      diff = Math.max(-maxStep, Math.min(maxStep, diff));
      this.turretAngle += diff;
    }

    if(this.reloadLeft > 0) this.reloadLeft -= dt;

    if(this.superCdLeft > 0) this.superCdLeft -= dt;

    if(this.magReloadLeft > 0){
      this.magReloadLeft -= dt;
      if(this.magReloadLeft <= 0){
        this.magReloadLeft = 0;
        this.mag = d.magSize || 1;
        this.reloadLeft = 0;
      }
    }

    if(this.superState === 'windup'){
      this.superTimer -= dt;
      if(this.superTimer <= 0){
        this.superState = 'cloaked';
        this.superTimer = d.cloakMax || 10;
        this._applyCloakVisual(true);
      }
    } else if(this.superState === 'cloaked'){
      this.superTimer -= dt;
      if(this.superTimer <= 0){
        this.superTimer = 0;
        this.endCloak();
      }
    }

    if(d.shellType === 'flame'){
      if(inp.fire && !this.overheated){
        this.heat += (1000 / 7.5) * dt;
        if(this.heat >= 1000){
          this.heat = 1000;
          this.overheated = true;
        }
      } else if(this.overheated){
        this.heat -= 125 * dt;
        if(this.heat <= 0){ this.heat = 0; this.overheated = false; }
      } else {
        this.heat -= 500 * dt;
        if(this.heat <= 0){ this.heat = 0; }
      }
      if(this.barrelMat){
        const t = this.heat / 1000;
        const r = 0x16 + Math.round(t * 0xe9);
        const g = 0x2e - Math.round(t * 0x2e);
        const b = 0x2e - Math.round(t * 0x2e);
        this.barrelMat.color.setRGB(r/255, g/255, b/255);
        this.barrelMat.emissive = new THREE.Color(t * 0.8, t * 0.15, 0);
        this.barrelMat.emissiveIntensity = t * 0.5;
      }
    }

    this._syncTransform();

    if(inp.fire && this.reloadLeft <= 0 && this.magReloadLeft <= 0 && !this.overheated && (this.mag > 0 || !d.magSize)){
      this.reloadLeft = d.reload;
      if(d.magSize){
        this.mag--;
        if(this.mag <= 0) this.magReloadLeft = d.magReload || d.reload;
      }
      if(this.superState === 'cloaked') this.endCloak();
      if(d.ejectShell && this._shellNode && game){
        // Eject a physical shell casing from the "shell" port and fire the
        // projectile from the muzzle immediately (no artificial delay).
        game.ejectShell(this);
      }
      if(game) game.spawnShot(this);
    }
  }

  reloadInfo(){
    const d = this.def;
    if(this.magReloadLeft > 0) return { active:true, total:d.magReload||d.reload, left:Math.max(0,this.magReloadLeft), mag:0, magSize:d.magSize||0 };
    if(this.reloadLeft > 0 || d.magSize) return { active:this.reloadLeft > 0, total:d.reload, left:Math.max(0,this.reloadLeft), mag:this.mag, magSize:d.magSize||0 };
    return { active:false, total:d.reload, left:0, mag:1, magSize:0 };
  }

  /* ---------- Super abilities ---------- */

  hasSuper(){ return !!this.def.superType; }

  activateSuper(){
    if(!this.hasSuper() || this.superCdLeft > 0 || this.superState) return false;
    const t = this.def.superType;
    if(t === 'airstrike'){
      this.superState = 'targeting';
      this.superTarget = null;
    } else if(t === 'cloak'){
      this.superState = 'windup';
      this.superTimer = this.def.cloakWindup || 3;
      this.superCdLeft = this.superCdTotal;
    } else if(t === 'bush'){
      this.superState = 'done';
      this.superCdLeft = this.superCdTotal;
      if(this._onBushSuper) this._onBushSuper();
    } else if(t === 'panzers'){
      this.superState = 'panzer_drop';
      this.superTimer = this.def.panzerDelay || 8;
      this.superCdLeft = this.superCdTotal;
    } else if(t === 'oil'){
      this.superState = 'oil_fill';
      this.superTimer = this.def.oilFill || 4;
      this.superCdLeft = this.superCdTotal;
    } else {
      this.superState = 'done';
      this.superCdLeft = this.superCdTotal;
    }
    return true;
  }

  cancelSuper(){
    if(this.superState === 'targeting'){
      this.superState = 'done';
      this.superTarget = null;
    }
  }

  endCloak(){
    if(this.superState !== 'cloaked') return;
    this.superState = 'done';
    this._applyCloakVisual(false);
  }

  superInfo(){
    return {
      type: this.def.superType || null,
      ready: this.superCdLeft <= 0,
      cdLeft: Math.max(0, this.superCdLeft),
      cdTotal: this.superCdTotal,
      state: this.superState,
      timer: Math.max(0, this.superTimer),
      cd: Math.max(0, this.superCdLeft),
    };
  }

  _applyCloakVisual(on){
    if(on) this._cloakedMats = [];
    const mats = this._cloakedMats;
    if(on && this.root && mats.length === 0){
      this.root.traverse(o => {
        if(o.isMesh && o.material && !o.userData.isOutline){
          mats.push(o.material);
        }
      });
    }
    mats.forEach(m => {
      if(Array.isArray(m)) return;
      m.transparent = !!on;
      m.opacity = on ? 0.25 : 1;
      m.depthWrite = !on;
    });
  }

  _applyCamoVisual(){
    const op = this.camoFactor;
    if(this.hpSprite) this.hpSprite.material.opacity = op;

  }

  _ramCheck(game){
    for(const o of game.tanks){
      if(o===this || !o.alive || o.dying) continue;
      if(this.allyId && (o.id === this.allyId || o.allyId === this.id)) continue;
      
      // Physics-based collision handling - let RAPIER handle pushing
      if(this._physBody && o._physBody){
        // Calculate relative velocity for damage
        try {
          const v1 = this._physBody.linvel();
          const v2 = o._physBody.linvel();
          const relSpeed = Math.sqrt(Math.pow(v1.x - v2.x, 2) + Math.pow(v1.z - v2.z, 2));
          
          if(relSpeed > 6){
            const heavier = this.mass >= o.mass ? this : o;
            const lighter = heavier === this ? o : this;
            const massRatio = heavier.mass / Math.max(1, lighter.mass);
            const baseDmg = relSpeed * 0.15 * massRatio;
            lighter.takeDamage(Math.min(25, baseDmg), heavier, game);
            heavier.takeDamage(Math.min(12, baseDmg / massRatio), lighter, game);
          }
        } catch(e){}
        continue;
      }
      
      // Fallback manual collision for non-physics tanks
      const dx = o.x - this.x, dz = o.z - this.z;
      const overlapX = (this.colHalfW + o.colHalfW) - Math.abs(dx);
      const overlapZ = (this.colHalfL + o.colHalfL) - Math.abs(dz);
      if(overlapX>0 && overlapZ>0){
        const heavier = this.mass >= o.mass ? this : o;
        const lighter = heavier === this ? o : this;
        const massRatio = heavier.mass / Math.max(1, lighter.mass);
        if(overlapX < overlapZ){
          const sign = dx < 0 ? 1 : -1;
          lighter.x += overlapX * sign;
          if(lighter.vx * sign < 0) lighter.vx = 0;
        } else {
          const sign = dz < 0 ? 1 : -1;
          lighter.z += overlapZ * sign;
          if(lighter.vz * sign < 0) lighter.vz = 0;
        }
        if(lighter._physBody){
          try { lighter._physBody.setTranslation({x: lighter.x, y: 0.9, z: lighter.z}, true); } catch(e){}
        }
        const relSpeed = Math.abs(this.speed) + Math.abs(o.speed);
        if(relSpeed > 6){
          const baseDmg = relSpeed * 0.2 * massRatio;
          lighter.takeDamage(Math.min(32, baseDmg), heavier, game);
          heavier.takeDamage(Math.min(15, baseDmg / massRatio), lighter, game);
        }
        const factor = 1 - lighter.mass / (heavier.mass + lighter.mass);
        lighter.speed *= Math.max(0.15, factor * 0.5);
        lighter.vx *= 0.2;
        lighter.vz *= 0.2;
      }
    }
  }

  /** Scale sprites and outlines based on distance from camera */
  updateDistanceScaling(cameraPos, camDist){
    const dx = this.x - cameraPos.x;
    const dz = this.z - cameraPos.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    const target = Math.min(4.0, Math.max(0.6, 0.15 + dist * 0.035));
    this._uiScale += (target - this._uiScale) * 0.15;
    const s = this._uiScale;
    if(this.hpSprite) this.hpSprite.scale.set(3.4 * s, 1.1 * s, 1);
    if(this._drownBar) this._drownBar.scale.set(3.4 * s, 0.21 * s, 1);
    // Outline scales with zoom level only (camDist), not per-tank distance
    if(camDist){
      const outlineS = Math.min(1.8, Math.max(1.0, 0.4 + camDist * 0.01));
      const outlineScale = 1 + (outlineS - 1) * 0.2;
      this._applyOutlineScale(outlineScale);
    }
  }
  _applyOutlineScale(scale){
    [this.bodyGroup, this.turretGroup].forEach(group => {
      if(!group) return;
      group.traverse(child => {
        if(child.userData && child.userData.isOutline) child.scale.setScalar(scale);
      });
    });
  }
  _syncTransform(){
    if(this._physBody){
      try {
        var p = this._physBody.translation();
        this.x = p.x;
        this.z = p.z;
        var q = this._physBody.rotation();
        this.heading = 2 * Math.atan2(q.y, q.w);
      } catch(e){}
    }
    this.root.position.set(this.x, 0, this.z);
    const myaw = this._modelYaw || 0;
    const mo = this._modelOff || (this._modelOff = new THREE.Vector3());
    this.bodyGroup.rotation.y = this.heading + myaw;
    this.bodyGroup.position.set(mo.x, mo.y, mo.z);
    if(this._modelTurretPivot){
      this.turretGroup.rotation.y = myaw;
      this.turretGroup.position.set(mo.x, mo.y, mo.z);
      this._modelTurretPivot.rotation.y = this.turretAngle;
    } else {
      this.turretGroup.rotation.y = this.turretAngle + myaw;
      this.turretGroup.position.set(mo.x, this.def.body.h + 0.45 + mo.y, mo.z);
    }
    if(this.drifting){
      this.bodyGroup.rotation.z = THREE.MathUtils.lerp(this.bodyGroup.rotation.z, -0.18, 0.25);
      this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, 0.06, 0.25);
    } else {
      this.bodyGroup.rotation.z = THREE.MathUtils.lerp(this.bodyGroup.rotation.z, 0, 0.2);
      this.bodyGroup.rotation.x = THREE.MathUtils.lerp(this.bodyGroup.rotation.x, 0, 0.2);
    }
  }

  _updateTrails(dt, game){
    const scene = game ? game.scene : null;
    if(!scene) { this.clearTrails(); return; }

    if(this.alive && !this.dying){
      const speed = Math.hypot(this.vx, this.vz);
      if(speed >= 0.5){
        this._trailTimer += dt;
        const interval = Math.max(0.1, 1.2 / speed);
        if(this._trailTimer >= interval){
          this._trailTimer = 0;
          if(!Tank._trailGeo){
            Tank._trailGeo = new THREE.BoxGeometry(0.35, 0.02, 0.5);
          }
          const b = this.def.body;
          const off = b.w/2 + 0.05;
          const back = -b.l/2;
          const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
          const order = this.trailSegments.length;
          [-1, 1].forEach(side => {
            const tx = this.x + side * off * ch + back * sh;
            const tz = this.z - side * off * sh + back * ch;
            const mesh = new THREE.Mesh(Tank._trailGeo, new THREE.MeshBasicMaterial({color:0x1a1a1a, transparent:true, opacity:0.45, depthWrite:false}));
            mesh.position.set(tx, 0.01, tz);
            mesh.rotation.y = this.heading;
            mesh.renderOrder = order;
            scene.add(mesh);
            this.trailSegments.push({mesh, life:2, maxLife:2});
          });
        }
      }
    }

    for(let i=this.trailSegments.length-1; i>=0; i--){
      const seg = this.trailSegments[i];
      seg.life -= dt;
      seg.mesh.material.opacity = Math.max(0, (seg.life / seg.maxLife) * 0.45);
      if(seg.life <= 0){
        scene.remove(seg.mesh);
        seg.mesh.material.dispose();
        this.trailSegments.splice(i, 1);
      }
    }

    while(this.trailSegments.length > 200){
      const old = this.trailSegments.shift();
      scene.remove(old.mesh);
      old.mesh.material.dispose();
    }
  }

  clearTrails(){
    const scene = this.scene;
    this.trailSegments.forEach(s => {
      if(scene) scene.remove(s.mesh);
      else if(s.mesh.parent) s.mesh.parent.remove(s.mesh);
      s.mesh.material.dispose();
    });
    this.trailSegments = [];
  }

  takeDamage(amount, fromTank, game, accumulate){
    if(!this.alive || this.dying) return;
    this.hp -= amount;
    if(fromTank && fromTank !== this) fromTank.damageDealt += amount;
    if(this.superState === 'cloaked') this.endCloak();
    if(accumulate && game){
      game._accumFlameDamage(this, amount);
    } else if(game && game.spawnDamageLabel){
      game.spawnDamageLabel(this.x, this.def.turret.h + this.def.body.h + 3.6, this.z, amount);
    }
    if(this.hp <= 0){
      this.hp = 0; this.alive = false;
      if(fromTank && fromTank !== this) fromTank.kills++;
      this._startDeath(game, fromTank);
    }
    this._drawHp();
  }
  heal(amount){ this.hp = Math.min(this.maxHp, this.hp + amount); this._drawHp(); }

  /* ---------- Gladiator power ---------- */
  powerMult(){ return 1 + (this.power || 0) / 100; }

  applyPower(n, game){
    if(!n || !this.alive) return;
    const oldMax = this.maxHp;
    this.power = (this.power || 0) + n;
    this.maxHp = Math.round(this.def.hp * this.powerMult());
    this.hp = Math.min(this.maxHp, this.hp + Math.max(0, this.maxHp - oldMax));
    this.hitScale = this.powerMult();
    this._applyPowerScale();
    this._drawHp();
    if(game && game.onPowerGained) game.onPowerGained(this, n);
  }

  setPowerFromSnapshot(pw){
    if(pw == null || pw === this.power) return;
    const oldMax = this.maxHp;
    this.power = pw;
    this.maxHp = Math.round(this.def.hp * this.powerMult());
    if(this.alive && !this.dying) this.hp = Math.min(this.maxHp, this.hp + Math.max(0, this.maxHp - oldMax));
    this.hitScale = this.powerMult();
    this._applyPowerScale();
    this._drawHp();
  }

  _applyPowerScale(){
    if(!this.root) return;
    const s = this.hitScale || 1;
    this.root.scale.set(s, s, s);
    if(this._overlayGroup){
      const inv = 1 / s;
      this._overlayGroup.scale.set(inv, inv, inv);
    }
  }

  _startDeath(game, killer){
    this.dying = true; this.deathT = 0;
    this.removeAt = (game? game.time : 0) + 48;
    if(this._physBody){
      try { this._physBody.setEnabled(false); } catch(e){}
    }

    if(this.hpSprite) this.hpSprite.visible = false;
    if(this.viewCircle) this.viewCircle.visible = false;

    this._turretVel = new THREE.Vector3(
      (Math.random()-0.5)*4, 14 + Math.random()*4, (Math.random()-0.5)*4);
    this._turretSpin = new THREE.Vector3((Math.random()-0.5)*4,(Math.random()-0.5)*6,(Math.random()-0.5)*4);
    // Fancy graphics: launch the turret harder so its fly-off is dramatic
    if(game && game.isFancy){
      this._turretVel.y += 6;
      this._turretVel.x *= 1.8;
      this._turretVel.z *= 1.8;
      this._turretSpin.x *= 2;
      this._turretSpin.z *= 2;
    }

    if(this.bodyMat){ this.bodyMat.color.setHex(0x141414); this.bodyMat.emissive=new THREE.Color(0x3a1500); this.bodyMat.emissiveIntensity=0.6; }
    if(this.turretMat){ this.turretMat.color.setHex(0x1a1a1a); this.turretMat.emissive=new THREE.Color(0x2a1000); this.turretMat.emissiveIntensity=0.5; }
    if(this.bodyMesh && this.bodyMesh.material !== this.bodyMat){
      this.bodyMesh.material.color.setHex(0x141414);
      this.bodyMesh.material.emissive = new THREE.Color(0x3a1500);
      this.bodyMesh.material.emissiveIntensity = 0.6;
    }
    if(this.turretMesh && this.turretMesh.material !== this.turretMat){
      this.turretMesh.material.color.setHex(0x1a1a1a);
      this.turretMesh.material.emissive = new THREE.Color(0x2a1000);
      this.turretMesh.material.emissiveIntensity = 0.5;
    }

    this._firePts = this._makeFireParticles();
    this._firePts.position.y = 0;
    this.root.add(this._firePts);

    this._star = this._makeStarDecal();
    this._star.position.set(0, 0.25, 0);
    this.root.add(this._star);

    if(game) game.onTankKilled(this, killer);
  }

  _makeFireParticles(){
    const g = new THREE.Group();
    const tex = VFX.getTex('flame');
    const starR = 3.2;
    for(let i=0;i<30;i++){
      const mat = new THREE.SpriteMaterial({map:tex, transparent:true, opacity:0.9, blending:THREE.AdditiveBlending, depthWrite:false, depthTest:true});
      const s = new THREE.Sprite(mat);
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * starR;
      s.position.set(Math.cos(angle)*r, 0.5+Math.random()*0.6, Math.sin(angle)*r);
      const sz = 0.6+Math.random()*0.9;
      s.scale.set(sz, sz*1.5, 1);
      s.userData.phase = Math.random()*6.28;
      s.userData.baseY = s.position.y;
      s.userData.baseScale = sz;
      g.add(s);
    }
    return g;
  }

  _makeStarDecal(){
    const shape = new THREE.Shape();
    const spikes=8, outer=13.6, inner=4.8;
    for(let i=0;i<spikes*2;i++){
      const r = (i%2===0)?outer:inner;
      const a = (i/(spikes*2))*Math.PI*2;
      const px=Math.cos(a)*r, py=Math.sin(a)*r;
      if(i===0) shape.moveTo(px,py); else shape.lineTo(px,py);
    }
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI/2);
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color:0x000000, transparent:true, opacity:1.0, depthWrite:false}));
  }

  _updateDeath(dt, game){
    this.deathT += dt;

    if(this._turretVel){
      this.turretGroup.position.x += this._turretVel.x*dt;
      this.turretGroup.position.y += this._turretVel.y*dt;
      this.turretGroup.position.z += this._turretVel.z*dt;
      this._turretVel.y -= 22*dt;
      this.turretGroup.rotation.x += this._turretSpin.x*dt;
      this.turretGroup.rotation.z += this._turretSpin.z*dt;
      const baseY = this._modelTurretPivot ? 0 : this.def.body.h+0.45;
      if(this.turretGroup.position.y <= baseY && this._turretVel.y<0){
        this.turretGroup.position.y = baseY;
        this._turretVel.y *= -0.3;
        this._turretVel.x *= 0.5; this._turretVel.z *= 0.5;
        if(Math.abs(this._turretVel.y)<1){ this._turretVel=null; }
      }
    }

    if(this._firePts){
      this._firePts.children.forEach((p,i)=>{
        p.position.y = p.userData.baseY + Math.sin(game.time*6+p.userData.phase)*0.04;
        const sc = p.userData.baseScale * (1+Math.sin(game.time*8+p.userData.phase)*0.2);
        p.scale.set(sc, sc * 1.3, 1);
      });
    }

    if(this.deathT > 3){
      const sink = (this.deathT-3);
      this.root.position.y = -sink*1.2;
      if(this._firePts){ this._firePts.children.forEach(p=>{ p.material.opacity=Math.max(0, 0.9 - this.deathT/45); }); }
    }

    if(this._star){
      this._star.material.opacity = Math.max(0, 1.0 - this.deathT / 45);
    }

    if(this.deathT > 4 && game && this.isLocal && !this._notifiedDeath){
      this._notifiedDeath = true;
      game.onLocalDeath();
    }
    if(this.deathT > 48){
      this.root.visible = false;
    }
  }

  respawn(world, game){
    const sp = world.randomSpawn();
    this.x = sp.x; this.z = sp.z;
    this.heading = Math.random()*Math.PI*2;
    this.turretAngle = this.heading;
    this.hp = this.maxHp; this.alive = true;
    this.dying = false; this.deathT = 0;
    this.speed = 0; this.vx = 0; this.vz = 0; this.reloadLeft = 0;
    this.heat = 0; this.overheated = false;
    if(this.barrelMat){
      this.barrelMat.color.setHex(0x2a2a2e);
      this.barrelMat.emissive = new THREE.Color(0,0,0);
      this.barrelMat.emissiveIntensity = 0;
    }
    this.root.visible = true;
    this.root.position.y = 0;
    if(this.hpSprite) this.hpSprite.visible = true;
    if(this.viewCircle) this.viewCircle.visible = true;
    if(this._drownBar) this._drownBar.visible = false;
    this._drowning = false;
    this._drownTimer = 0;
    this._drawHp();
    if(this._physBody){
      try {
        this._physBody.setEnabled(true);
        var half = this.heading * 0.5;
        this._physBody.setTranslation({x: this.x, y: 0.9, z: this.z}, true);
        this._physBody.setLinvel({x: 0, y: 0, z: 0}, true);
        this._physBody.setAngvel({x: 0, y: 0, z: 0}, true);
      } catch(e){}
    }
  }

  _updateHpBar(){ this._drawHp(); }

  muzzle(){
    this.root.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    this.barrelEnd.getWorldPosition(p);
    const dir = new THREE.Vector3(Math.sin(this.turretAngle), 0, Math.cos(this.turretAngle));
    return {pos:p, dir};
  }

  getWorldVelocity(){
    if(this._physBody){
      try {
        const v = this._physBody.linvel();
        return {x: v.x, z: v.z};
      } catch(e){}
    }
    return {x: this.vx, z: this.vz};
  }

  snapshot(){
    return {
      id:this.id, x:this.x, z:this.z, h:this.heading, t:this.turretAngle,
      sp:this.speed, hp:this.hp, alive:this.alive, dying:this.dying,
      dd:this.damageDealt, k:this.kills, tank:this.def.id, name:this.name, col:this.color,
      cam:this.camoFactor, ally:this.allyId, pw:this.power, pl:this.placement||0, gt:this._gladHoldTime||0,
    };
  }
  applySnapshot(s){
    this.x=s.x; this.z=s.z; this.heading=s.h; this.turretAngle=s.t;
    this.speed=s.sp; this.hp=s.hp; this.alive=s.alive;
    this.damageDealt=s.dd; this.kills=s.k;
    if(s.cam != null) this.camoFactor = s.cam;
    if(s.ally != null) this.allyId = s.ally;
    if(s.pl != null) this.placement = s.pl;
    if(s.pw != null) this.setPowerFromSnapshot(s.pw);
    if(s.gt != null) this._gladHoldTime = s.gt;
    this.root.visible=this.alive; this._syncTransform(); this._drawHp();
  }
  /* Network-driven tanks: movement follows interpolated host snapshots */
  beginNetDriven(){
    this.netDriven = true;
    this._netSmooth = null;
  }
  applyNetSnapshot(s){
    const wasAlive = this.alive;
    // Causal state applies instantly; only movement is interpolated.
    this.hp = s.hp;
    this.alive = !!s.alive;
    this.dying = !!s.dying;
    this.damageDealt = s.dd;
    this.kills = s.k;
    if(s.cam != null) this.camoFactor = s.cam;
    if(s.ally != null) this.allyId = s.ally;
    if(s.pl != null) this.placement = s.pl;
    if(s.pw != null) this.setPowerFromSnapshot(s.pw);
    if(s.gt != null) this._gladHoldTime = s.gt;
    this.root.visible = this.alive;
    this._drawHp();

    const now = performance.now();
    const sm = this._netSmooth;
    const bigJump = Math.hypot(s.x - this.x, s.z - this.z) > 4.5;
    const stateFlip = wasAlive !== this.alive || !this.alive;
    if(!sm || bigJump || stateFlip){
      // First snapshot / teleport / respawn: snap directly.
      this.x = s.x; this.z = s.z;
      this.heading = s.h; this.turretAngle = s.t;
      this._netSmooth = {
        p0x:s.x, p0z:s.z, p0h:s.h, p0t:s.t,
        p1x:s.x, p1z:s.z, p1h:s.h, p1t:s.t,
        t0:now, t1:now + 150
      };
      this._syncTransform();
      return;
    }
    // Buffer previous rendered state -> new target; lerp over the snapshot window.
    sm.p0x = this.x; sm.p0z = this.z;
    sm.p0h = this.heading; sm.p0t = this.turretAngle;
    sm.p1x = s.x; sm.p1z = s.z;
    sm.p1h = s.h; sm.p1t = s.t;
    sm.t0 = now; sm.t1 = now + 150;
  }
  _netSmoothTick(){
    const sm = this._netSmooth;
    if(!sm) return;
    const span = sm.t1 - sm.t0;
    let k = span > 0 ? (performance.now() - sm.t0) / span : 1;
    if(k > 1) k = 1;
    this.x = sm.p0x + (sm.p1x - sm.p0x) * k;
    this.z = sm.p0z + (sm.p1z - sm.p0z) * k;
    this.heading = sm.p0h + _angDiff(sm.p1h, sm.p0h) * k;
    this.turretAngle = sm.p0t + _angDiff(sm.p1t, sm.p0t) * k;
    this._syncTransform();
  }
}