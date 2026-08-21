/* ============================================================
   neon-dash-map.js — UPGRADED Neon Dash race map.
   - Continuous long neon walls (one mesh per segment side) = correct hitboxes
   - Hills / elevation parkour: tanks drive up & down (Y-axis)
   - Stylized traps, richer parkour, smoother racing line
   Deterministic seeded RNG so every client builds identical track.
   ============================================================ */

var NEON_MAP = (function(){
  'use strict';
  const objects = [];
  const R = v => Math.round(v * 10) / 10;
  const push = o => objects.push(o);

  const mulberry32 = a => {
    return function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  };
  const rng = mulberry32(20260820);

  /* ---------- Track centerline (west -> east) WITH ELEVATION ---------- */
  // [x, z, yElev] — hills & valleys parkour: tank Y interpolates along this
  const WAY_E = [
    [-195,  0,  0],
    [-150, 28,  5.5],
    [-105,-12,  2.0],
    [ -60, 30,  7.0],
    [ -15,  0,  1.2],
    [  30,-32,  8.5],
    [  75, 10, 11.0],
    [ 120,-25,  3.0],
    [ 165,  8,  6.5],
    [ 195,  0,  0],
  ];
  const WAY = WAY_E.map(p=>[p[0],p[1]]);
  const ELEV = WAY_E.map(p=>p[2]);
  const HALF_W = 11;

  const segs = [];
  for(let i = 0; i < WAY.length - 1; i++){
    const x0 = WAY[i][0], z0 = WAY[i][1], y0 = ELEV[i];
    const x1 = WAY[i + 1][0], z1 = WAY[i + 1][1], y1 = ELEV[i+1];
    const dx = x1 - x0, dz = z1 - z0, dy = y1 - y0;
    const len2 = Math.hypot(dx, dz);
    const len3 = Math.hypot(len2, dy);
    segs.push({ x0, z0, y0, x1, z1, y1, dy, len: len2, len3, dx: dx/len2, dz: dz/len2, elev0:y0, elev1:y1, midY:(y0+y1)/2, tilt: Math.atan2(dy, len2) });
  }
  // Helper: sample elevation at any x,z by projecting to nearest seg centerline
  function sampleElev(x,z){
    let best = ELEV[0], bestD=Infinity;
    for(const s of segs){
      const vx = x - s.x0, vz = z - s.z0;
      const t = Math.max(0, Math.min(1, (vx*s.dx + vz*s.dz)/s.len));
      const px = s.x0 + s.dx*t*s.len, pz = s.z0 + s.dz*t*s.len;
      const d = Math.hypot(x-px, z-pz);
      if(d < bestD){ bestD=d; best = s.y0 + (s.y1-s.y0)*t; }
    }
    return best;
  }

  /* ---------- Corridor walls — ONE LONG BOX per side per segment (continuous) ---------- */
  for(const s of segs){
    const px = -s.dz, pz = s.dx;
    const mx = (s.x0 + s.x1)/2, mz = (s.z0 + s.z1)/2;
    const angle = Math.atan2(s.dx, s.dz);
    const wallLen = s.len + 0.8; // slight overlap so no hairline gaps at joints
    const wallH = 4.2; // tall enough to cover hill slopes
    for(const side of [-1, 1]){
      const wx = R(mx + px * HALF_W * side);
      const wz = R(mz + pz * HALF_W * side);
      const wy = R(s.midY + wallH/2 + 0.15);
      push({ type: 'neonwall', kind: 'cube',
        x: wx, z: wz, y: wy,
        sx: R(wallLen/6), sy: R(wallH/6), sz: 0.22,
        ry: R(angle),
        continuous: true });
    }
  }

  /* ---------- Track floor : sloped ramps following elevation ---------- */
  for(const s of segs){
    const mx = (s.x0 + s.x1)/2, mz = (s.z0 + s.z1)/2;
    const my = s.midY;
    const angle = Math.atan2(s.dx, s.dz);
    // Ramp box: length along track, width = corridor, thin
    push({ type: 'neonfloor', isRamp:true,
      x: R(mx), z: R(mz), y: R(my),
      sx: R((s.len + 2)/6), sz: R((HALF_W*2)/6), sy: 0.02,
      ry: R(angle), tilt: s.tilt });
  }
  // Extra start pad (flat)
  push({ type: 'neonfloor', x: -188, z: 1, sx: 2.2, sz: 4, y: R(sampleElev(-188,1)+0.02) });

  /* ---------- Start line: 10 spawns facing east, ON the ramp height ---------- */
  const s1 = segs[0];
  const spawnRy = Math.atan2(s1.dx, s1.dz);
  for(let k = 0; k < 10; k++){
    const sx = -193 + (rng()-0.5)*1.2;
    const sz = 1.2 + (k - 4.5)*1.8 + (rng()-0.5)*0.4;
    push({ type: 'spawnpoint', subType: 'neon',
      x: R(sx), z: R(sz),
      y: R(sampleElev(sx,sz)+0.6),
      ry: R(spawnRy + (rng()-0.5)*0.1) });
  }

  /* ---------- Checkpoint gates (cross in order) + finish — lifted to ramp height ---------- */
  const gate = (x, z, dirX, dirZ, index) => {
    const eh = sampleElev(x,z);
    push({ type: 'neoncheckpoint', x, z, index,
      y: R(eh),
      spawnX: R(x - dirX * 5), spawnZ: R(z - dirZ * 5),
      spawnY: R(sampleElev(x - dirX*5, z - dirZ*5)+0.6),
      spawnRy: R(Math.atan2(dirX, dirZ)) });
  };
  gate(-55, 28, 0.83, 0.55, 0);
  gate(80, 6, 0.79, 0.61, 1);
  gate(163, 6, 0.97, 0.26, 2);
  push({ type: 'neonfinish', x: 197, z: 0, y: R(sampleElev(197,0)) });

  /* ---------- Traps — Y placed at ramp height, stylized in world.js ---------- */
  function addTrap(type, x,z, opts){
    const eh = sampleElev(x,z);
    const o = { type, x, z, y: R(eh + (opts.yOff!=null?opts.yOff:0.06)) };
    Object.assign(o, opts);
    delete o.yOff;
    push(o);
  }
  // Lasers (cycling walls)
  addTrap('neonlaser', -35, 14, { index:0, sx:0.2, sy:0.6, sz:3.7, ry:R(Math.atan2(-0.55,0.83)), yOff:1.86 });
  addTrap('neonlaser', 100, -9, { index:1, sx:0.2, sy:0.6, sz:3.7, ry:R(Math.atan2(-0.59,0.81)), yOff:1.86 });
  // Pushers (green launch pads)
  addTrap('neonpusher', -95, 14, { sx:1.34, sy:0.12, sz:1.34, ry:0, dirX:0.68, dirZ:-0.73 });
  addTrap('neonpusher', 135, 3, { sx:1.34, sy:0.12, sz:1.34, ry:0, dirX:0.59, dirZ:-0.81 });
  // Slow zones
  addTrap('neonslow', -50, 10, { sx:3, sy:0.12, sz:1.67, ry:0 });
  addTrap('neonslow', 148, 4, { sx:2, sy:0.12, sz:1.33, ry:0 });
  // Boost pads (cyan)
  addTrap('neonboost', -140, 24, { sx:1, sy:0.12, sz:0.67, ry:0 });
  addTrap('neonboost', 55, 0, { sx:1, sy:0.12, sz:0.67, ry:0 });
  // Additional hill-top boost & valley slow for parkour flow
  addTrap('neonboost', 30, -28, { sx:1, sy:0.12, sz:0.67, ry:0 });
  addTrap('neonslow',  75,  8, { sx:2.2, sy:0.12, sz:1.4, ry:0.2 });
  addTrap('neonpusher', 10,  6, { sx:1.2, sy:0.12, sz:1.2, ry:0.3, dirX:-0.4, dirZ:0.9 });

  /* ---------- Parkour obstacles inside corridor — lifted to ramp height ---------- */
  function addWall(x,z, sx,sy,sz, ry){
    const eh = sampleElev(x,z);
    push({ type: 'neonwall', kind: 'cube', x, z, y: R(eh + sy*3 + 0.5), sx, sy, sz, ry });
  }
  addWall(-128, 21, 1, 0.55, 1, 0.3);
  addWall(86, 8, 1, 0.55, 1, -0.2);
  addWall(148, -6, 0.83, 0.55, 1.33, 0.4);
  // Hill-crest jump obstacles
  addWall(-60, 28, 1.2, 0.7, 0.9, 0.6);
  addWall(74,  9, 1.4, 0.65, 1.1, -0.4);
  addWall(30,-30, 0.9, 0.6, 1.0, 0.8);

  // Export elevation samples for world.js so tank Y can interpolate without recomputing
  return { name: 'Neon Dash Circuit — Hills Edition', objects, _elevWay: WAY_E, _sampleElev: sampleElev };
})();
