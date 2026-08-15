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
      const h = ctx.createRadialGradient(26,24,0,26,24,10);
      h.addColorStop(0, 'rgba(120,130,150,0.35)');
      h.addColorStop(1, 'rgba(120,130,150,0)');
      ctx.fillStyle = h; ctx.fillRect(0,0,64,64);
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
    } else if(name === 'puff'){
      /* Fluffy smoke cloud: several soft overlapping lobes (organic, not a circle) */
      const lobes = [[20,20,15],[40,17,13],[32,32,17],[48,30,12],[22,40,12],[40,45,13]];
      for(const bl of lobes){
        const g = ctx.createRadialGradient(bl[0],bl[1],0,bl[0],bl[1],bl[2]);
        g.addColorStop(0, 'rgba(205,205,205,0.55)');
        g.addColorStop(0.65, 'rgba(150,150,150,0.32)');
        g.addColorStop(1, 'rgba(110,115,120,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(bl[0],bl[1],bl[2],0,Math.PI*2); ctx.fill();
      }
    } else if(name === 'ring'){
      /* Shockwave ring: crisp stroke with a soft outer glow */
      const g = ctx.createRadialGradient(32,32,12,32,32,26);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.72, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0,0,64,64);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(32,32,18,0,Math.PI*2); ctx.stroke();
    } else if(name === 'spark'){
      /* 4-point star spark: two thin crossing diamonds, bright core */
      ctx.fillStyle = 'rgba(255,255,240,0.35)';
      ctx.beginPath(); ctx.arc(32,32,20,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.98)';
      ctx.beginPath();
      ctx.moveTo(32,3); ctx.lineTo(36,32); ctx.lineTo(32,61); ctx.lineTo(28,32);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(3,32); ctx.lineTo(32,36); ctx.lineTo(61,32); ctx.lineTo(32,28);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,244,200,1)';
      ctx.beginPath(); ctx.arc(32,32,4.5,0,Math.PI*2); ctx.fill();
    } else if(name === 'shard'){
      /* Chunky triangular debris with a bright top edge */
      const g = ctx.createLinearGradient(16,8,52,44);
      g.addColorStop(0, 'rgba(255,235,170,0.95)');
      g.addColorStop(0.45, 'rgba(210,170,90,0.85)');
      g.addColorStop(1, 'rgba(120,90,45,0.65)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(10,48);
      ctx.lineTo(46,10);
      ctx.lineTo(54,46);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,245,210,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(46,10); ctx.lineTo(54,46);
      ctx.stroke();
    } else if(name === 'hex'){
      /* Hexagonal shard plate with bevel */
      const r = 20;
      ctx.beginPath();
      for(let i=0;i<6;i++){
        const a = Math.PI/6 + i*Math.PI/3;
        const x = 32 + r*Math.cos(a), y = 32 + r*Math.sin(a);
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.closePath();
      const g = ctx.createRadialGradient(32,32,0,32,32,r);
      g.addColorStop(0, 'rgba(230,225,215,0.95)');
      g.addColorStop(0.7, 'rgba(160,160,165,0.88)');
      g.addColorStop(1, 'rgba(90,95,105,0.7)');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else if(name === 'streak'){
      /* Horizontal motion streak with a bright dash core */
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(1,32);
      ctx.quadraticCurveTo(26,27, 63,32);
      ctx.quadraticCurveTo(26,37, 1,32);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,190,0.9)';
      ctx.beginPath();
      ctx.moveTo(20,32);
      ctx.lineTo(63,32);
      ctx.lineTo(26,35);
      ctx.closePath(); ctx.fill();
    } else if(name === 'cross'){
      /* Spiky 4-ray cross starburst */
      const g = ctx.createRadialGradient(32,32,0,32,32,28);
      g.addColorStop(0, 'rgba(255,255,240,0.5)');
      g.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = g; ctx.fillRect(0,0,64,64);
      ctx.fillStyle = 'rgba(255,255,255,0.98)';
      ctx.beginPath();
      for(let i=0;i<4;i++){
        const ang = i*Math.PI/2;
        ctx.moveTo(32 + 30*Math.cos(ang), 32 + 30*Math.sin(ang));
        ctx.lineTo(32 + 7*Math.cos(ang + 0.28), 32 + 7*Math.sin(ang + 0.28));
        ctx.lineTo(32 + 7*Math.cos(ang - 0.28), 32 + 7*Math.sin(ang - 0.28));
        ctx.closePath();
      }
      ctx.fill();
    } else if(name === 'flame'){
      /* Flickering flame teardrop core */
      const g = ctx.createRadialGradient(32,42,0,32,42,24);
      g.addColorStop(0, 'rgba(255,255,210,0.95)');
      g.addColorStop(0.4, 'rgba(255,190,60,0.85)');
      g.addColorStop(0.8, 'rgba(255,90,10,0.5)');
      g.addColorStop(1, 'rgba(200,40,0,0)');
      ctx.fillStyle = g; ctx.fillRect(8,18,48,44);
      ctx.fillStyle = 'rgba(255,245,190,0.6)';
      ctx.beginPath();
      ctx.moveTo(32,8);
      ctx.quadraticCurveTo(40,24, 38,40);
      ctx.quadraticCurveTo(34,52, 32,58);
      ctx.quadraticCurveTo(28,52, 26,40);
      ctx.quadraticCurveTo(24,24, 32,8);
      ctx.fill();
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