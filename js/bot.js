/* ============================================================
   bot.js — Simple but believable AI for bots / fake players.
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

    // pick nearest alive enemy (ignore cloaked/invisible tanks)
    let target=null, best=Infinity;
    for(const t of game.tanks){
      if(t===me || !t.alive) continue;
      if(t.camoFactor <= 0) continue;
      const d = Math.hypot(t.x-me.x, t.z-me.z);
      if(d<best){ best=d; target=t; }
    }

    let throttle=0, turn=0;
    let turretAngle = me.turretAngle;
    let fire=false;

    const glad = game.glad || null;

    // GLADIATOR: escaping the red zone has top priority
    if(glad && glad.phase !== 'grace' && game._inGladRed && game._inGladRed(me.x, me.z)){
      const a = Math.atan2(0-me.x, 0-me.z); // center of the safe square
      const angDiff = this._angleDiff(a, me.heading);
      turn = Math.max(-1, Math.min(1, angDiff*1.5));
      throttle = 1;
      if(target){
        turretAngle = Math.atan2(target.x-me.x, target.z-me.z);
        const dist = Math.hypot(target.x-me.x, target.z-me.z);
        if(dist < 20 && Math.abs(this._angleDiff(turretAngle, me.turretAngle)) < 0.15 && me.reloadLeft<=0){
          fire = true;
        }
      }
      const probeX = me.x + Math.sin(me.heading)*4;
      const probeZ = me.z + Math.cos(me.heading)*4;
      if(game.world.collides(probeX, probeZ, 2)){
        turn += 0.8; throttle = 0.5;
      }
      return {throttle, turn, turretWorldAngle:turretAngle, fire};
    }

    // GLADIATOR: go hold a landed airdrop when no enemy is close
    const air = (glad && glad.airdrop && glad.airdrop.landed) ? glad.airdrop : null;
    if(air && (!target || best > 30)){
      const dx = air.x-me.x, dz = air.z-me.z;
      const dist = Math.hypot(dx,dz);
      const a = Math.atan2(dx, dz);
      const angDiff = this._angleDiff(a, me.heading);
      turn = Math.max(-1, Math.min(1, angDiff*1.5));
      throttle = dist > 5 ? 1 : 0;
      if(target) turretAngle = Math.atan2(target.x-me.x, target.z-me.z);
      const probeX = me.x + Math.sin(me.heading)*4;
      const probeZ = me.z + Math.cos(me.heading)*4;
      if(game.world.collides(probeX, probeZ, 2)){
        turn += 0.8; throttle = 0.5;
      }
      return {throttle, turn, turretWorldAngle:turretAngle, fire};
    }

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
      // GLADIATOR: shoot blue boxes for power when no enemies are around
      let box=null, bdist=Infinity;
      if(game._gladBoxes){
        for(const b of game._gladBoxes){
          if(!b.alive) continue;
          const d = Math.hypot(b.x-me.x, b.z-me.z);
          if(d < bdist){ bdist = d; box = b; }
        }
      }
      if(box && bdist < me.def.shellRange){
        turretAngle = Math.atan2(box.x-me.x, box.z-me.z);
        const angDiff = this._angleDiff(turretAngle, me.heading);
        turn = Math.max(-1, Math.min(1, angDiff*1.5));
        throttle = bdist > 14 ? 1 : 0.2;
        const probeX = me.x + Math.sin(me.heading)*4;
        const probeZ = me.z + Math.cos(me.heading)*4;
        if(game.world.collides(probeX, probeZ, 2)){
          turn += 0.8; throttle = 0.5;
        }
        if(Math.abs(this._angleDiff(turretAngle, me.turretAngle)) < 0.15 && me.reloadLeft<=0){
          fire = true;
        }
      } else {
        // wander
        this.wanderTimer -= game.dt;
        if(this.wanderTimer<=0){ this.wanderHeading = Math.random()*Math.PI*2; this.wanderTimer = 2+Math.random()*3; }
        turn = Math.max(-1,Math.min(1,this._angleDiff(this.wanderHeading, me.heading)));
        throttle = 0.7;
      }
    }
    return {throttle, turn, turretWorldAngle:turretAngle, fire};
  }

  _angleDiff(a,b){
    let d = ((a-b+Math.PI)%(Math.PI*2))-Math.PI;
    return d;
  }
}

/* ============================================================
   PanzerBrain — escort AI for Sturmratte's super.
   Stays near the master tank, fights enemies in range.
   ============================================================ */
class PanzerBrain extends BotBrain {
  constructor(tank, master){
    super(tank);
    this.master = master;
  }

  decide(game){
    const me = this.tank;
    if(!me.alive) return {throttle:0, turn:0, turretWorldAngle:me.turretAngle, fire:false};

    const isAlly = (t) => t === me || (me.allyId && (t.id === me.allyId || t.allyId === me.id));

    let target = null, best = Infinity;
    for(const t of game.tanks){
      if(isAlly(t) || !t.alive) continue;
      if(t.camoFactor <= 0) continue;
      const d = Math.hypot(t.x - me.x, t.z - me.z);
      if(d < best){ best = d; target = t; }
    }

    let throttle = 0, turn = 0;
    let turretAngle = me.turretAngle;
    let fire = false;

    const m = this.master && this.master.alive ? this.master : null;
    const dMaster = m ? Math.hypot(me.x - m.x, me.z - m.z) : Infinity;

    if(m && dMaster > 10){
      const a = Math.atan2(m.x - me.x, m.z - me.z);
      const angDiff = this._angleDiff(a, me.heading);
      turn = Math.max(-1, Math.min(1, angDiff * 1.5));
      throttle = 1;
      turretAngle = a;
    } else if(target){
      const dx = target.x - me.x, dz = target.z - me.z;
      const dist = Math.hypot(dx, dz);
      const angleToTarget = Math.atan2(dx, dz);
      turretAngle = angleToTarget;
      const angDiff = this._angleDiff(angleToTarget, me.heading);
      turn = Math.max(-1, Math.min(1, angDiff * 1.5));
      const idealDist = Math.min(me.def.shellRange * 0.6, 26);
      if(dist > idealDist + 5) throttle = 1;
      else if(dist < idealDist - 5) throttle = -0.6;
      else throttle = 0.2 * Math.sin(game.time * 0.7 + me.x);

      const probeX = me.x + Math.sin(me.heading) * 4;
      const probeZ = me.z + Math.cos(me.heading) * 4;
      if(game.world.collides(probeX, probeZ, 2)){
        turn += 0.8; throttle = 0.5;
      }

      const turDiff = Math.abs(this._angleDiff(turretAngle, me.turretAngle));
      if(turDiff < 0.15 && dist < me.def.shellRange && me.reloadLeft <= 0){
        fire = true;
      }
    } else {
      this.wanderTimer -= game.dt;
      if(this.wanderTimer <= 0){ this.wanderHeading = Math.random() * Math.PI * 2; this.wanderTimer = 2 + Math.random() * 3; }
      turn = Math.max(-1, Math.min(1, this._angleDiff(this.wanderHeading, me.heading)));
      throttle = 0.7;
    }
    return {throttle, turn, turretWorldAngle: turretAngle, fire};
  }
}
