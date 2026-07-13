/* ============================================================
   config.js — game balance + world constants + tank roster
   ============================================================ */

const CONFIG = {
  // Nakama (Heroic Cloud / self-hosted)
  NAKAMA: {
    HOST:     'localhost',     // change to your Heroic Cloud deployment URL when live
    PORT:     7350,
    USE_SSL:  false,
    SERVER_KEY: 'defaultkey',  // your Nakama server key
  },

  // PeerJS — STUN + free TURN relay so P2P works behind strict NAT
  PEER_ICE: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  ],

  // World
  WORLD_SIZE:      300,   // small map
  GRID_DIVISIONS:  60,    // ground shader grid lines
  TANK_Y:          1.2,   // all tanks drive at this Y (flat, like the reference)

  // Camera (over-the-shoulder / angled top-down follow, see camera.js)
  CAM_DIST_MIN:    12,
  CAM_DIST_MAX:    80,
  CAM_DIST:        22,    // default
  CAM_HEIGHT:      16,
  CAM_PITCH:       0.95,  // downward tilt factor
  CAM_LERP:        0.14,
  CAM_ZOOM_STEP:   2.5,
  CAM_ROTATE_SPEED: 2.0,  // radians per second for keyboard camera orbit

  // Drift / handbrake
  DRIFT_MIN_KMH:   5,    // need at least this speed to drift
  DRIFT_TURN_BOOST:3.0,   // body turns this many times faster while drifting
  DRIFT_FRICTION:  0.72,  // velocity retained per second while drifting (higher = slides more)
  U_TO_KMH:        3.6 * 0.6,

  // Combat
  SHELL_SPEED:     90,
  SHELL_LIFE:      3.0,
  FLAME_RANGE:     18,
  FLAME_DPS:       0,

  // Trajectory line (aim assist)
  AIM_LINE_OPACITY: 0.5,
  AIM_LINE_COLOR:   '#ffffff',

  // View range circle (spotting)
  VIEW_RANGE_OPACITY: 0.25,
  VIEW_RANGE_COLOR:   '#ffffff',
  VIEW_RANGE_WIDTH:   0.5,   // 0 = narrow ring, 1 = fat ring

  // Camouflage
  BUSH_HIDE_RADIUS:   3.2,   // a tank within this distance of a bush is hidden
  TREE_HIDE_RADIUS:   4.0,   // tree canopy gives partial camo (less effective)

  // Models
  MODEL_DIR:   'mini_tank_legends_models/',
  MODEL_EXT:   '.gltf',

  // Networking
  PEER_PREFIX:     'tankparty-v1-',
};

/* ---------- TANK ROSTER ---------- */
const TANKS = {
  coolbuddy: {
    id:'coolbuddy', name:'Cool Buddy', tier:1, collection:1,
    color:0x8a8f98, turretColor:0xb9bfc9,
    body:{ w:3.0, h:1.0, l:4.4 },
    turret:{ w:1.8, h:0.8, l:2.4 },
    barrelLen:1.6, barrelR:0.16,
    hp:200, speed:22, turn:1.8,
    turretTurn:2.4,
    damage:34, reload:1.6, shellSpeed:90, shellRange:40,
    accel:18, shellType:'shell',
    mass:30, viewRange:105,
    model:'coolbuddy', modelScale:1.0,
    armor:{front:10, sides:30, back:10},
    desc:'Balanced all-rounder.',
    friction: 0.88,
  },

  helix: {
    id:'helix', name:'Helix', tier:2, collection:2,
    color:0xb5482a, turretColor:0xd86a3a,
    body:{ w:3.2, h:1.1, l:4.6 },
    turret:{ w:2.0, h:0.9, l:2.4 },
    barrelLen:1.2, barrelR:0.22,
    hp:220, speed:21, turn:1.7,
    turretTurn:2.6,
    damage:10, reload:0.10, shellSpeed:42, shellRange:20,
    accel:18, shellType:'flame',
    mass:34, viewRange:78,
    model:'helix', modelScale:1.0,
    fireConeHalfAngle:0.12,
    armor:{front:30, sides:30, back:30},
    desc:'Flamethrower. Devastating up close.',
    friction: 0.85,
  },

  striker: {
    id:'striker', name:'Striker', tier:2, collection:2,
    color:0x3a6ea5, turretColor:0x5a93cf,
    body:{ w:2.8, h:0.95, l:4.2 },
    turret:{ w:1.7, h:0.75, l:2.6 },
    barrelLen:2.2, barrelR:0.13,
    hp:140, speed:23, turn:1.9,
    turretTurn:2.8,
    damage:30, reload:1.4, shellSpeed:140, shellRange:50,
    accel:20, shellType:'shell',
    mass:28, viewRange:135,
    model:'striker', modelScale:1.0,
    armor:{front:30, sides:30, back:30},
    desc:'Glass cannon. Fast, long-range shells.',
    friction: 0.90,
  },

  ghost: {
    id:'ghost', name:'Ghost', tier:3, collection:3,
    color:0x4a4f55, turretColor:0x6c7278,
    body:{ w:2.3, h:0.85, l:3.6 },
    turret:{ w:1.4, h:0.7, l:1.9 },
    barrelLen:1.1, barrelR:0.11,
    hp:120, speed:34, turn:2.6,
    turretTurn:3.2,
    damage:14, reload:0.45, shellSpeed:95, shellRange:35,
    accel:30, shellType:'shell',
    mass:18, viewRange:110,
    model:'ghost', modelScale:1.0,
    armor:{front:30, sides:30, back:30},
    desc:'Tiny, fast, hit-and-run.',
    friction: 0.82,
  },

  dummy: {
    id:'dummy', name:'Dummy', tier:0, collection:0,
    color:0x8a8f98, turretColor:0xb9bfc9,
    body:{ w:3.0, h:1.0, l:4.4 },
    turret:{ w:1.8, h:0.8, l:2.4 },
    barrelLen:1.6, barrelR:0.16,
    hp:200, speed:0, turn:0,
    turretTurn:0,
    damage:0, reload:999, shellSpeed:0, shellRange:0,
    accel:0, shellType:'shell',
    mass:999, viewRange:0,
    model:'helix', modelScale:1.0,
    armor:{front:10, sides:30, back:10},
    desc:'Target dummy. Respawns on death.',
    friction: 1.0,
  },

  tankdisplay: {
    id:'tankdisplay', name:'Tank Display', tier:0, collection:0,
    color:0x6a8a3a, turretColor:0x8aaa5a,
    body:{ w:2.5, h:1.8, l:2.0 },
    turret:{ w:1.2, h:0.6, l:1.2 },
    barrelLen:0.8, barrelR:0.1,
    hp:99999, speed:0, turn:0,
    turretTurn:0,
    damage:0, reload:999, shellSpeed:0, shellRange:0,
    accel:0, shellType:'shell',
    mass:999, viewRange:0,
    model:'tankdisplay', modelScale:1.0,
    armor:{front:999, sides:999, back:999},
    desc:'Display tank.',
    friction: 1.0,
  },

  sturmratte: {
    id:'sturmratte', name:'Sturmratte', tier:3, collection:3,
    color:0x5a5648, turretColor:0x7d7a67,
    body:{ w:4.0, h:1.4, l:5.8 },
    turret:{ w:2.6, h:1.1, l:3.2 },
    barrelLen:2.6, barrelR:0.24,
    hp:440, speed:13, turn:1.0,
    turretTurn:1.4,
    damage:42, reload:4.2, shellSpeed:80, shellRange:40,
    accel:10, shellType:'shell',
    mass:60, viewRange:95,
    model:'sturmratte', modelScale:2.0,
    armor:{front:30, sides:30, back:30},
    desc:'Juggernaut. Massive shells, very slow.',
    friction: 0.92,
  },
};

const TANK_ORDER = ['coolbuddy','helix','striker','ghost','sturmratte','tankdisplay'];
const U_TO_KMH = CONFIG.U_TO_KMH;

/* World palette */
const COLORS = {
  grass1:0x4a6a2a, grass2:0x5a8a30,
  path:0x8b7050, pathDark:0x7a6040,
  rock:0x6a6e72, rockDark:0x4a4e52,
  bush:0x3a7a38, bush2:0x4a9a48, bushBig:0x2a5a2a,
  treeTrunk:0x5a4030, treeLeaf:0x3a7a34, treeLeaf2:0x4a8a40,
  water1:0x1a6a9a, water2:0x2a8aba,
  fog:0x2a2a2a,
};

const DEFAULT_BINDS = {
  forward:  { key:'KeyW',  label:'Go Forward' },
  backward: { key:'KeyS',  label:'Go Backward' },
  left:     { key:'KeyA',  label:'Turn Left' },
  right:    { key:'KeyD',  label:'Turn Right' },
  fire:     { key:'LMB',   label:'Fire' },
  handbrake:{ key:'Space', label:'Handbrake (Drift)' },
  zoomIn:   { key:'WheelUp',   label:'Zoom In' },
  zoomOut:  { key:'WheelDown', label:'Zoom Out' },
  camLeft:  { key:'ArrowLeft',  label:'Camera Left' },
  camRight: { key:'ArrowRight', label:'Camera Right' },
};

function loadSettings(){
  const defaults = () => Object.fromEntries(Object.keys(DEFAULT_BINDS).map(k=>[k,DEFAULT_BINDS[k].key]));
  try{
    const s = JSON.parse(localStorage.getItem('tankparty_settings')||'{}');
    return {
      binds: Object.assign(defaults(), s.binds||{}),
      selectedTank: s.selectedTank || 'coolbuddy',
      playerName: s.playerName || ('Player'+Math.floor(Math.random()*9000+1000)),
      playerClan: s.playerClan || '',
      coins: s.coins || 0,
      crystals: s.crystals || 0,
      aimLineOpacity: (s.aimLineOpacity!=null? s.aimLineOpacity : CONFIG.AIM_LINE_OPACITY),
      aimLineColor:   s.aimLineColor || CONFIG.AIM_LINE_COLOR,
      aimLineDesign:  s.aimLineDesign || 'professional',
      ricochetIndicator: s.ricochetIndicator !== false,
      viewRangeOpacity: (s.viewRangeOpacity!=null? s.viewRangeOpacity : CONFIG.VIEW_RANGE_OPACITY),
      viewRangeColor:   s.viewRangeColor || CONFIG.VIEW_RANGE_COLOR,
      viewRangeWidth:   (s.viewRangeWidth!=null? s.viewRangeWidth : CONFIG.VIEW_RANGE_WIDTH),
      graphicsQuality:  s.graphicsQuality || 'default',
      camRotation:      s.camRotation || 0,
      unlockedTanks:    s.unlockedTanks || ['coolbuddy'],
      allUnlocked:      s.allUnlocked || false,
    };
  }catch(e){
    return {binds:defaults(), selectedTank:'coolbuddy', playerName:'Player'+Math.floor(Math.random()*9000+1000), playerClan:'', coins:0, crystals:0,
            aimLineOpacity:CONFIG.AIM_LINE_OPACITY, aimLineColor:CONFIG.AIM_LINE_COLOR, aimLineDesign:'professional',
            viewRangeOpacity:CONFIG.VIEW_RANGE_OPACITY, viewRangeColor:CONFIG.VIEW_RANGE_COLOR,
            viewRangeWidth:CONFIG.VIEW_RANGE_WIDTH, graphicsQuality:'default', camRotation:0, ricochetIndicator:true,
            unlockedTanks:['coolbuddy'], allUnlocked:false};
  }
}
function saveSettings(s){
  localStorage.setItem('tankparty_settings', JSON.stringify(s));
}
function resetSettings(){
  localStorage.removeItem('tankparty_settings');
  return loadSettings();
}

function loadCustomMap(){
  try{ return JSON.parse(localStorage.getItem('tankparty_custommap')||'null'); }catch(e){ return null; }
}
function saveCustomMap(map){ localStorage.setItem('tankparty_custommap', JSON.stringify(map)); }
function hasCustomMap(){ return !!localStorage.getItem('tankparty_custommap'); }

const MAP_UNLOCK_CODE = 'TANKMASTER';
function isMapUnlocked(){ return localStorage.getItem('tankparty_mapunlocked')==='1'; }
function setMapUnlocked(v){ localStorage.setItem('tankparty_mapunlocked', v?'1':'0'); }