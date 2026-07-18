/* ============================================================
   types.ts — All TypeScript interfaces for Mini Tank Legends
   ============================================================ */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

/* ---------- Tank definitions ---------- */
export interface TankBody {
  w: number; h: number; l: number;
}
export interface TankTurret {
  w: number; h: number; l: number;
}
export interface TankArmor {
  front: number; sides: number; back: number;
}
export interface TankDef {
  id: string; name: string; tier: number; collection: number;
  color: number; turretColor: number;
  body: TankBody; turret: TankTurret;
  barrelLen: number; barrelR: number;
  hp: number; speed: number; turn: number;
  turretTurn: number;
  damage: number; reload: number; shellSpeed: number; shellRange: number;
  accel: number; shellType: string;
  mass: number; viewRange: number;
  model: string; modelScale: number;
  armor: TankArmor;
  desc: string;
  friction: number;
  fireConeHalfAngle?: number;
}
export type TankRoster = Record<string, TankDef>;

/* ---------- Tank instance ---------- */
export interface TankSnapshot {
  id: string; x: number; z: number; h: number; t: number;
  sp: number; hp: number; alive: boolean; dying: boolean;
  dd: number; k: number; tank: string; name: string; col: number;
}
export interface TankOptions {
  id?: string; name?: string; isLocal?: boolean; isBot?: boolean;
  color?: number; ownerPeer?: string;
  x?: number; z?: number; heading?: number; turretAngle?: number;
  physicsWorld?: RAPIER.World;
}

/* ---------- Input ---------- */
export interface InputState {
  throttle: number; turn: number; turretAngle: number; fire: boolean;
}
export interface TouchInputValue {
  x: number; y: number; firing?: boolean;
  relAngle?: number; armed?: boolean;
}
export interface TouchInputResult {
  throttle: number; turn: number;
  turretRelAngle: number; armed: boolean;
  isTouch: boolean;
}
export interface BindDef {
  key: string; label: string;
}
export type BindMap = Record<string, string>;

export interface Settings {
  binds: BindMap;
  selectedTank: string;
  playerName: string;
  playerClan: string;
  coins: number;
  crystals: number;
  aimLineOpacity: number;
  aimLineColor: string;
  aimLineDesign: string;
  ricochetIndicator: boolean;
  viewRangeOpacity: number;
  viewRangeColor: string;
  viewRangeWidth: number;
  graphicsQuality: string;
  camRotation: number;
  unlockedTanks: string[];
  allUnlocked: boolean;
}

/* ---------- World ---------- */
export interface WallData {
  x: number; z: number; w: number; d: number; mesh?: THREE.Group; border?: boolean;
}
export interface TreeData {
  x: number; z: number; mesh: THREE.Object3D;
}
export interface BushData {
  x: number; z: number; mesh?: THREE.Object3D; r?: number;
}
export interface LakeData {
  x: number; z: number; r: number; seed?: number; mesh?: THREE.Object3D;
}
export interface WavePlaneData {
  angle: number; radius: number; speed: number;
  spawnR: number; lake: LakeData; delay: number;
}

/* ---------- Shell/Projectile ---------- */
export interface ProjectileDef {
  shellSpeed: number; damage: number; shellRange: number;
}

/* ---------- Bot ---------- */
export interface BotDecision {
  throttle: number; turn: number; turretWorldAngle: number; fire: boolean;
}

/* ---------- Network ---------- */
export interface PeerInfo {
  peerId: string; name?: string; tank?: string; color?: number;
}
export interface NetMsg {
  t: string; [key: string]: unknown;
}
export interface WelcomeData {
  peerId?: string; roomCode?: string;
}

/* ---------- Camera ---------- */
export interface CameraState {
  angle: number; height: number; dist: number; pitch: number;
}

/* ---------- Menu Editor ---------- */
export interface MenuCommand {
  value: string; label: string;
}
export interface EditorElement {
  type: string; x: number; y: number; w: number; h: number;
  label?: string; name?: string;
  bgColor?: string; command?: string;
  image?: HTMLImageElement; imageData?: string;
  hitbox?: { x: number; y: number; w: number; h: number };
}
export interface EditorSettings {
  _isOpen: boolean;
  elements: EditorElement[];
  selected: EditorElement | null;
  _dragMode: string | null;
}

/* ---------- Game loop ---------- */
export interface GameSettings {
  settings: Settings;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  world: import('./world').World;
  tanks: import('./tank').Tank[];
  projectiles: import('./projectile').Shell[];
  time: number;
  dt: number;
  localTank: import('./tank').Tank | null;
  input: import('./input').Input | null;
}

/* ---------- Host config ---------- */
export interface HostConfig {
  maxPlayers: number; isPublic: boolean; fakePlayers: number;
  code: string; useCustomMap: boolean;
}

/* ---------- Color palette ---------- */
export interface ColorPalette {
  grass1: number; grass2: number;
  path: number; pathDark: number;
  rock: number; rockDark: number;
  bush: number; bush2: number; bushBig: number;
  treeTrunk: number; treeLeaf: number; treeLeaf2: number;
  water1: number; water2: number;
  fog: number;
}
