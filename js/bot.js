/* ============================================================
   bot.js â€” Simple but believable AI for bots / fake players.
   Drives toward nearest enemy, dodges walls, fires when aligned.
   ============================================================ */

class BotBrain {
  constructor(tank){
    this.tank = tank;
    this.repathTimer = 0;
    this.targetId = null;
    this.wanderHeading = Math.random()*Math.PI*2;
    this.wanderTimer = 0;
    this.fireCooldown = 0;
  }

  decide(game){
    const me = this.tank;
    if(!me.alive) return {throttle:0, turn:0, turretWorldAngle:me.turretAngle, fire:false};

    // pick nearest alive enemy
    let target=null, best=Infinity;
    for(const t of game.tanks){
      if(t===me || !t.alive) continue;
      const d = Math.hypot(t.x-me.x, t.z-me.z);
      if(d<best){ best=d; target=t; }
    }

    let throttle=0, turn=0;
    let turretAngle = me.turretAngle;
    let fire=false;

    if(target){
      const dx= target.x-me.x, dz=target.z-me.z;
      const dist = Math.hypot(dx,dz);
      const angleToTarget = Math.atan2(dx, dz);

      // turret aims at target (lead a bit)
      turretAngle = angleToTarget;
      // body steers toward target but keeps distance based on tank role
      const idealDist = me.def.shellType==='flame' ? 10 : Math.min(me.def.shellRange*0.7, 60);
      const angDiff = this._angleDiff(angleToTarget, me.heading);
      turn = Math.max(-1, Math.min(1, angDiff*1.5));
      if(dist > idealDist+6) throttle = 1;
      else if(dist < idealDist-6) throttle = -0.6;
      else throttle = 0.2 * Math.sin(game.time*0.7+me.x); // strafe-ish

      // wall avoidance: probe ahead
      const probeX = me.x + Math.sin(me.heading)*4;
      const probeZ = me.z + Math.cos(me.heading)*4;
      if(game.world.collides(probeX, probeZ, 2)){
        turn += 0.8; throttle = 0.5;
      }

      // fire if aligned & in range
      this.fireCooldown -= game.dt;
      const turDiff = Math.abs(this._angleDiff(turretAngle, me.turretAngle));
      if(turDiff < 0.15 && dist < me.def.shellRange && me.reloadLeft<=0){
        fire = true;
      }
    } else {
      // wander
      this.wanderTimer -= game.dt;
      if(this.wanderTimer<=0){ this.wanderHeading = Math.random()*Math.PI*2; this.wanderTimer = 2+Math.random()*3; }
      turn = Math.max(-1,Math.min(1,this._angleDiff(this.wanderHeading, me.heading)));
      throttle = 0.7;
    }
    return {throttle, turn, turretWorldAngle:turretAngle, fire};
  }

  _angleDiff(a,b){
    let d = ((a-b+Math.PI)%(Math.PI*2))-Math.PI;
    return d;
  }
}
