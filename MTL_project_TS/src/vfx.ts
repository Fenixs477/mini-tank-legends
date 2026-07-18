// VFX texture registry (procedural canvas textures)
import * as THREE from 'three';

type TexCache = Record<string, THREE.CanvasTexture>;

const _texCache: TexCache = {};

function _makeCanvas(name: string): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  if (name === 'flare') {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.15, 'rgba(255,240,180,1)');
    g.addColorStop(0.4, 'rgba(255,200,80,0.8)');
    g.addColorStop(0.7, 'rgba(255,100,20,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  } else if (name === 'smoke') {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0, 'rgba(180,180,180,0.5)');
    g.addColorStop(0.4, 'rgba(140,140,140,0.3)');
    g.addColorStop(0.8, 'rgba(80,80,80,0.1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  } else {
    const g = ctx.createRadialGradient(28, 38, 0, 28, 38, 30);
    g.addColorStop(0, 'rgba(255,255,230,1)');
    g.addColorStop(0.15, 'rgba(255,220,120,0.95)');
    g.addColorStop(0.35, 'rgba(255,140,30,0.85)');
    g.addColorStop(0.6, 'rgba(220,60,5,0.5)');
    g.addColorStop(0.85, 'rgba(120,20,0,0.15)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    const g2 = ctx.createRadialGradient(40, 22, 0, 40, 22, 16);
    g2.addColorStop(0, 'rgba(255,240,180,0.6)');
    g2.addColorStop(0.5, 'rgba(255,160,40,0.3)');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, 64, 64);
  }
  return c;
}

export const VFX = {
  getTex(name: string): THREE.CanvasTexture {
    if (_texCache[name]) return _texCache[name];
    const t = new THREE.CanvasTexture(_makeCanvas(name));
    _texCache[name] = t;
    return t;
  }
};
