// VFX texture registry (procedural canvas textures - no external files needed)
const VFX = {
  _texCache: {},
  _makeCanvas(name){
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    if(name === 'flare'){
      const g = ctx.createRadialGradient(32,32,0,32,32,32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.15, 'rgba(255,240,180,1)');
      g.addColorStop(0.4, 'rgba(255,200,80,0.8)');
      g.addColorStop(0.7, 'rgba(255,100,20,0.3)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0,0,64,64);
    } else if(name === 'smoke'){
      const g = ctx.createRadialGradient(32,32,0,32,32,30);
      g.addColorStop(0, 'rgba(180,180,180,0.5)');
      g.addColorStop(0.4, 'rgba(140,140,140,0.3)');
      g.addColorStop(0.8, 'rgba(80,80,80,0.1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0,0,64,64);
    } else if(name === 'oil'){
      const g = ctx.createRadialGradient(32,32,0,32,32,30);
      g.addColorStop(0, 'rgba(14,15,18,0.95)');
      g.addColorStop(0.45, 'rgba(20,22,28,0.9)');
      g.addColorStop(0.75, 'rgba(30,36,44,0.55)');
      g.addColorStop(1, 'rgba(40,50,60,0)');
      ctx.fillStyle = g; ctx.fillRect(0,0,64,64);
      // glossy highlight
      const h = ctx.createRadialGradient(26,24,0,26,24,10);
      h.addColorStop(0, 'rgba(120,130,150,0.35)');
      h.addColorStop(1, 'rgba(120,130,150,0)');
      ctx.fillStyle = h; ctx.fillRect(0,0,64,64);
      // wobble rings
      ctx.strokeStyle = 'rgba(70,85,105,0.35)';
      ctx.lineWidth = 1.5;
      for(const r of [14, 22]){
        ctx.beginPath(); ctx.arc(32,32,r,0,Math.PI*2); ctx.stroke();
      }
    } else if(name === 'fire'){
      const g = ctx.createRadialGradient(32,32,0,32,32,31);
      g.addColorStop(0, 'rgba(255,255,210,0.95)');
      g.addColorStop(0.25, 'rgba(255,200,60,0.9)');
      g.addColorStop(0.55, 'rgba(255,110,15,0.75)');
      g.addColorStop(0.8, 'rgba(200,40,5,0.35)');
      g.addColorStop(1, 'rgba(120,10,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0,0,64,64);
      const g2 = ctx.createRadialGradient(40,20,0,40,20,18);
      g2.addColorStop(0, 'rgba(255,250,200,0.7)');
      g2.addColorStop(0.5, 'rgba(255,170,40,0.35)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2; ctx.fillRect(0,0,64,64);
    } else {
      const g = ctx.createRadialGradient(28,38,0,28,38,30);
      g.addColorStop(0, 'rgba(255,255,230,1)');
      g.addColorStop(0.15, 'rgba(255,220,120,0.95)');
      g.addColorStop(0.35, 'rgba(255,140,30,0.85)');
      g.addColorStop(0.6, 'rgba(220,60,5,0.5)');
      g.addColorStop(0.85, 'rgba(120,20,0,0.15)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0,0,64,64);
      const g2 = ctx.createRadialGradient(40,22,0,40,22,16);
      g2.addColorStop(0, 'rgba(255,240,180,0.6)');
      g2.addColorStop(0.5, 'rgba(255,160,40,0.3)');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2; ctx.fillRect(0,0,64,64);
    }
    return c;
  },
  getTex(name){
    if(this._texCache[name]) return this._texCache[name];
    const t = new THREE.CanvasTexture(this._makeCanvas(name));
    this._texCache[name] = t;
    return t;
  }
};
