/* prototipe-map.js — GLB battle map importer
   Handles Blender → GLB workflow:
   - Any mesh is loaded as static visual + Rapier collider (trimesh or cuboid)
   - Empty objects with name prefixes spawn game objects:
     spawn_*          → spawnpoints (subType deduced from name: neon/gladiator/battle)
     wall_*           → walls (continuous collider)
     floor_* / track_* / ground_* → track floors (trackZones)
     ramp_*           → inclined floors
     checkpoint_* / gate_* → checkpoints
     finish*          → finish line
     laser_* / pusher_* / slow_* / boost_* → neon zones
   Naming is case-insensitive; separator can be _, -, . or space.
*/
const PROTOTIPE_GLB_URL = 'assets/prototipe.glb';
var PROTOTIPE_MAP_FALLBACK = {
  name: 'Prototipe — Fallback',
  objects: [
    {type:'spawnpoint', subType:'battle', x:0,z:0,ry:0},
    {type:'spawnpoint', subType:'battle', x:8,z:0,ry:0},
    {type:'spawnpoint', subType:'battle', x:-8,z:0,ry:3.14},
  ]
};
function parsePrototipeScene(gltfScene){
  const objects=[]; const meshInfos=[];
  const R=v=>Math.round(v*100)/100;
  gltfScene.updateMatrixWorld(true);
  const re = s=>String(s||'').toLowerCase();
  // Collect empties / nodes
  gltfScene.traverse(o=>{
    const nm = re(o.name);
    if(!nm) return;
    // world pos from matrixWorld
    const wp = new THREE.Vector3(); o.getWorldPosition(wp);
    const wq = new THREE.Quaternion(); o.getWorldQuaternion(wq);
    const eul = new THREE.Euler().setFromQuaternion(wq,'YXZ');
    const ry = eul.y;
    const hasMesh = !!(o.isMesh && o.geometry);
    // Empty detection: no mesh or name contains spawn/gate etc
    const isSpawn = nm.includes('spawn');
    const isWall = nm.includes('wall');
    const isFloor = nm.includes('floor')||nm.includes('track')||nm.includes('ground');
    const isRamp = nm.includes('ramp');
    const isCheckpoint = nm.includes('checkpoint')||nm.includes('gate');
    const isFinish = nm.includes('finish');
    const isLaser = nm.includes('laser');
    const isPusher = nm.includes('pusher');
    const isSlow = nm.includes('slow');
    const isBoost = nm.includes('boost');
    if(isSpawn){
      let sub='battle';
      if(nm.includes('neon')) sub='neon';
      else if(nm.includes('gladiator')) sub='gladiator';
      objects.push({type:'spawnpoint', subType:sub, x:R(wp.x), z:R(wp.z), y:R(wp.y), ry:R(ry)});
      return;
    }
    if(isCheckpoint){
      // index from trailing number
      let idx = 0; const m=nm.match(/(\d+)/); if(m) idx=parseInt(m[1],10);
      objects.push({type:'neoncheckpoint', x:R(wp.x), z:R(wp.z), y:R(wp.y), index:idx, ry:R(ry), spawnX:R(wp.x), spawnZ:R(wp.z), spawnRy:R(ry)});
      return;
    }
    if(isFinish){
      objects.push({type:'neonfinish', x:R(wp.x), z:R(wp.z), y:R(wp.y), ry:R(ry)});
      return;
    }
    if(isRamp && hasMesh){
      // store ramp info but also keep mesh visual via meshInfos path
      // We'll let meshInfos handle visual, and add a floor object for physics sampling
      const bb=new THREE.Box3().setFromObject(o);
      const sz=bb.getSize(new THREE.Vector3());
      objects.push({type:'neonfloor', isRamp:true, x:R(wp.x), z:R(wp.z), y:R(wp.y), sx:R(Math.max(0.5, sz.x/6)), sz:R(Math.max(0.5, sz.z/6)), ry:R(ry), tilt: eul.x});
      return;
    }
    if(isFloor && hasMesh){
      const bb=new THREE.Box3().setFromObject(o);
      const sz=bb.getSize(new THREE.Vector3());
      objects.push({type:'neonfloor', x:R(wp.x), z:R(wp.z), y:R(wp.y), sx:R(Math.max(0.5, sz.x/6)), sz:R(Math.max(0.5, sz.z/6)), ry:R(ry)});
      return;
    }
    // Zones without mesh (empties placed on ground)
    if(isLaser) { objects.push({type:'neonlaser', x:R(wp.x), z:R(wp.z), y:R(wp.y+0.3), sx:0.2, sy:0.6, sz:3.7, ry:R(ry), index:0}); return; }
    if(isPusher) { objects.push({type:'neonpusher', x:R(wp.x), z:R(wp.z), y:R(wp.y+0.06), sx:1.34, sy:0.12, sz:1.34, ry:R(ry), dirX: Math.sin(ry), dirZ: Math.cos(ry)}); return; }
    if(isSlow) { objects.push({type:'neonslow', x:R(wp.x), z:R(wp.z), y:R(wp.y+0.06), sx:2, sy:0.12, sz:1.33, ry:R(ry)}); return; }
    if(isBoost) { objects.push({type:'neonboost', x:R(wp.x), z:R(wp.z), y:R(wp.y+0.06), sx:1, sy:0.12, sz:0.67, ry:R(ry)}); return; }
    if(isWall && hasMesh){
      const bb=new THREE.Box3().setFromObject(o);
      const sz=bb.getSize(new THREE.Vector3());
      objects.push({type:'neonwall', kind:'cube', x:R(wp.x), z:R(wp.z), y:R(wp.y + sz.y/2), sx:R(Math.max(0.3, sz.x/6)), sy:R(Math.max(0.3, sz.y/6)), sz:R(Math.max(0.3, sz.z/6)), ry:R(ry)});
      return;
    }
    // Otherwise if it's a mesh with no special name, keep it as static visual/collider
    if(hasMesh){
      // Extract geometry info for Rapier trimesh — store reference mesh for world to clone
      const clone = o.clone(true);
      // world position already baked via matrixWorld clone path: we will let world.addStaticMesh handle transform
      meshInfos.push({orig:o, clone:clone, name:nm, pos:wp.clone(), quat:wq.clone(), scale:o.getWorldScale(new THREE.Vector3())});
    }
  });
  return {objects, meshInfos, scene:gltfScene};
}
function loadPrototipeGLB(url){
  url=url||PROTOTIPE_GLB_URL;
  return new Promise((res,rej)=>{
    if(typeof THREE==='undefined' || !THREE.GLTFLoader){ console.warn('GLTFLoader missing'); return res(null); }
    const loader = new THREE.GLTFLoader();
    loader.load(url, gltf=>{
      try{
        const parsed = parsePrototipeScene(gltf.scene);
        // Keep original glTF scene for direct World injection (cloned meshes)
        parsed.gltf=gltf;
        res(parsed);
      }catch(e){ rej(e); }
    }, undefined, e=>{ console.warn('prototipe load failed',e); res(null); });
  });
}
window.loadPrototipeGLB=loadPrototipeGLB;
window.PROTOTIPE_GLB_URL=PROTOTIPE_GLB_URL;
