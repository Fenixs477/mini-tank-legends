/* ============================================================
   input.js — keyboard + mouse + wheel + TOUCH (mobile dual joystick),
   with rebindable keybinds.
   ============================================================ */

class TouchJoystick {
  constructor(containerId, opts={}){
    this.container = document.getElementById(containerId);
    if(!this.container) return;
    this.opts = Object.assign({
      size: 130,
      deadZone: 0.08,

      // movement joystick:
      //   - getValue() -> {x,y,firing:false}
      // turret joystick:
      //   - getValue() -> {x,y,relAngle,armed,firePulse}
      turretFireMode: 'none',   // 'none' | 'armedPress'
      armedThreshold: 0.98,    // normalized distance for "drag to max"
      maxFireDistance: 1.0,    // clamp
    }, opts);

    this.active = false;
    this.touchId = -1;

    this.dx = 0; // -1..1
    this.dy = 0;

    // turret state
    this.relAngle = 0;     // radians, relative to joystick "up"
    this.armed = false;   // dragged to max ring
    this.firePulse = false; // one-frame pulse when user presses while armed

    // one-frame helper to detect "press again"
    this._pressedWhileArmed = false;

    this._build();
    this._bindEvents();
  }

  _build(){
    this.container.innerHTML = '';

    // Dynamic sizing: scale joystick to viewport, cap at desired size
    const shortSide = Math.min(window.innerWidth, window.innerHeight);
    const joySize = Math.min(this.opts.size, Math.max(64, shortSide * 0.3));
    this.container.style.width = joySize + 'px';
    this.container.style.height = joySize + 'px';

    // Outer ring
    this.outer = document.createElement('div');
    this.outer.className = 'joystick-outer';
    this.container.appendChild(this.outer);

    // Inner knob — size relative to container
    this.knob = document.createElement('div');
    this.knob.className = 'joystick-knob';
    const knobSize = Math.round(joySize * 0.38);
    this.knob.style.width = knobSize + 'px';
    this.knob.style.height = knobSize + 'px';
    this.outer.appendChild(this.knob);

    this._half = joySize / 2;
    this._maxDist = this._half - knobSize / 2 - 4;
  }

  _bindEvents(){
    const el = this.container;

    const getPos = (touches, id) => {
      for(let t of touches){
        if(t.identifier === id) return {x: t.clientX, y: t.clientY};
      }
      return null;
    };

    // document-level handler to prevent iOS WKWebView from
    // stealing the gesture in standalone/PWA mode
    const preventDocMove = (e) => { e.preventDefault(); };

    const onStart = (e) => {
      e.preventDefault();

      // One-frame pulse for turret:
      // When in armed state, touching again triggers firePulse.
      if(this.opts.turretFireMode === 'armedPress' && this.armed){
        this.firePulse = true;
      }

      for(let t of e.changedTouches){
        if(!this.active){
          this.active = true;
          this.touchId = t.identifier;
          this._centerX = t.clientX;
          this._centerY = t.clientY;
          this._updateKnob(0, 0);

          this.dx = 0;
          this.dy = 0;
          this.firePulse = false;

          // reset armed when touch begins; it will re-arm onMove
          this.armed = false;

          // Lock all touchmove to this document while joystick is
          // active — necessary for iOS standalone (home screen) mode
          document.addEventListener('touchmove', preventDocMove, {passive: false});
        }
      }
    };

    const onMove = (e) => {
      e.preventDefault();
      const pos = getPos(e.changedTouches, this.touchId);
      if(!pos) return;

      let dx = pos.x - this._centerX;
      let dy = pos.y - this._centerY;

      let dist = Math.hypot(dx, dy);

      // Clamp to max distance
      if(dist > this._maxDist){
        dx = dx / dist * this._maxDist;
        dy = dy / dist * this._maxDist;
        dist = this._maxDist;
      }

      this._updateKnob(dx, dy);

      // Normalize to -1..1
      let nx = dx / this._maxDist;
      let ny = dy / this._maxDist;

      // Dead zone
      if(Math.abs(nx) < this.opts.deadZone) nx = 0;
      if(Math.abs(ny) < this.opts.deadZone) ny = 0;

      this.dx = nx;
      this.dy = ny;

      // update turret relAngle + armed state
      if(this.opts.turretFireMode === 'armedPress'){
        // joystick "up" is negative dy (screen coords), so angle relative to up:
        // relAngle = atan2(x, -y)
        const ang = Math.atan2(this.dx, -this.dy);
        this.relAngle = ang;

        const mag = Math.min(1, Math.hypot(this.dx, this.dy));
        this.armed = mag >= this.opts.armedThreshold;
      }
    };

    const onEnd = (e) => {
      for(let t of e.changedTouches){
        if(t.identifier === this.touchId){
          this.active = false;
          this.touchId = -1;

          this.dx = 0;
          this.dy = 0;

          this.armed = false;
          this.firePulse = false;

          this._updateKnob(0, 0);

          document.removeEventListener('touchmove', preventDocMove, {passive: false});
        }
      }
    };

    el.addEventListener('touchstart', onStart, {passive: false});
    el.addEventListener('touchmove', onMove, {passive: false});
    el.addEventListener('touchend', onEnd, {passive: false});
    el.addEventListener('touchcancel', onEnd, {passive: false});
  }

  _updateKnob(dx, dy){
    if(this.knob){
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }

  getValue(){
    return {x: this.dx, y: this.dy, firing: this.firing, relAngle: this.relAngle, armed: this.armed};
  }
}

class Input {
  constructor(settings){
    this.settings = settings;
    this.keys = {};
    this.mouse = { x:0, y:0, ndcX:0, ndcY:0, down:false };
    this.binds = settings.binds;
    this.wheel = 0;

    // Touch state
    this.isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    this._touchInput = { throttle: 0, turn: 0, turretAngle: 0, fire: false };
    this._moveJoystick = null;
    this._turretJoystick = null;

    // Pinch-to-zoom state
    this._pinchTouchIds = [];
    this._pinchDist = 0;
    this._pinchAccum = 0;

    window.addEventListener('keydown', e=>{
      this.keys[e.code]=true;
      if(e.code==='Space') e.preventDefault();
    });
    window.addEventListener('keyup',   e=>{ this.keys[e.code]=false; });

    const canvas = ()=> document.querySelector('#game-root canvas');
    document.addEventListener('mousemove', e=>{
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      const c = canvas();
      if(c){
        const r = c.getBoundingClientRect();
        this.mouse.ndcX =  ((e.clientX-r.left)/r.width )*2-1;
        this.mouse.ndcY = -((e.clientY-r.top )/r.height)*2+1;
      }
    });
    document.addEventListener('mousedown', e=>{ if(e.button===0) this.mouse.down=true; });
    document.addEventListener('mouseup',   e=>{ if(e.button===0) this.mouse.down=false; });

    window.addEventListener('wheel', e=>{
      this.wheel += (e.deltaY < 0 ? 1 : -1);
    }, {passive:true});

    window.addEventListener('blur', ()=>{ this.keys={}; this.mouse.down=false; this._camRotateTouch=0; });

    // Prevent iOS in standalone mode (home screen) from intercepting
    // the first touch as a system gesture
    document.addEventListener('touchstart', (e) => {
      if(e.target.closest('.joystick-container, .cam-rotate-btns, #game-root')) e.preventDefault();
    }, {passive: false});

    // Pinch-to-zoom gesture
    const getTouchById = (touches, id) => {
      for(let t of touches){ if(t.identifier === id) return t; }
      return null;
    };
    document.addEventListener('touchstart', (e) => {
      if(e.touches.length === 2){
        this._pinchTouchIds = [e.touches[0].identifier, e.touches[1].identifier];
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this._pinchDist = Math.hypot(dx, dy);
      }
    }, {passive: true});
    document.addEventListener('touchmove', (e) => {
      if(this._pinchTouchIds.length === 2){
        const t1 = getTouchById(e.touches, this._pinchTouchIds[0]);
        const t2 = getTouchById(e.touches, this._pinchTouchIds[1]);
        if(t1 && t2){
          const dx = t1.clientX - t2.clientX;
          const dy = t1.clientY - t2.clientY;
          const dist = Math.hypot(dx, dy);
          this._pinchAccum += (dist - this._pinchDist) * 0.03;
          this._pinchDist = dist;
        }
      }
    }, {passive: true});
    document.addEventListener('touchend', (e) => {
      if(e.touches.length < 2){
        this._pinchTouchIds = [];
        this._pinchDist = 0;
      }
    }, {passive: true});

    // Initialize touch joysticks if on mobile
    if(this.isTouchDevice){
      // Create joystick containers if they don't exist
      let moveEl = document.getElementById('joystick-move');
      let turretEl = document.getElementById('joystick-turret');
      
      if(!moveEl){
        moveEl = document.createElement('div');
        moveEl.id = 'joystick-move';
        moveEl.className = 'joystick-container joystick-left';
        document.body.appendChild(moveEl);
      }
      if(!turretEl){
        turretEl = document.createElement('div');
        turretEl.id = 'joystick-turret';
        turretEl.className = 'joystick-container joystick-right';
        document.body.appendChild(turretEl);
      }

      this._moveJoystick = new TouchJoystick('joystick-move', {
        size: 133,
        fireOnMax: false,
      });

      this._turretJoystick = new TouchJoystick('joystick-turret', {
        size: 127,
        turretFireMode: 'armedPress',
        armedThreshold: 0.98,
      });
      
      // Camera rotation touch buttons (for phone)
      let camBtns = document.getElementById('cam-rotate-btns');
      if(!camBtns){
        camBtns = document.createElement('div');
        camBtns.id = 'cam-rotate-btns';
        camBtns.className = 'cam-rotate-btns joystick-hidden';
        camBtns.innerHTML = '<button class="cam-rot-btn" id="cam-rot-left" aria-label="Rotate camera left">◀</button><button class="cam-rot-btn" id="cam-rot-right" aria-label="Rotate camera right">▶</button>';
        document.body.appendChild(camBtns);
      }
      const leftBtn = document.getElementById('cam-rot-left');
      const rightBtn = document.getElementById('cam-rot-right');
      const setCamTouch = (dir) => {
        this._camRotateTouch = dir;
      };
      leftBtn.addEventListener('touchstart', (e) => { e.preventDefault(); setCamTouch(-1); }, {passive: false});
      leftBtn.addEventListener('touchend', (e) => { e.preventDefault(); if(this._camRotateTouch === -1) setCamTouch(0); }, {passive: false});
      leftBtn.addEventListener('touchcancel', (e) => { if(this._camRotateTouch === -1) setCamTouch(0); }, {passive: false});
      rightBtn.addEventListener('touchstart', (e) => { e.preventDefault(); setCamTouch(1); }, {passive: false});
      rightBtn.addEventListener('touchend', (e) => { e.preventDefault(); if(this._camRotateTouch === 1) setCamTouch(0); }, {passive: false});
      rightBtn.addEventListener('touchcancel', (e) => { if(this._camRotateTouch === 1) setCamTouch(0); }, {passive: false});
      // Also support mouse clicks for testing
      leftBtn.addEventListener('mousedown', () => setCamTouch(-1));
      leftBtn.addEventListener('mouseup', () => { if(this._camRotateTouch === -1) setCamTouch(0); });
      leftBtn.addEventListener('mouseleave', () => { if(this._camRotateTouch === -1) setCamTouch(0); });
      rightBtn.addEventListener('mousedown', () => setCamTouch(1));
      rightBtn.addEventListener('mouseup', () => { if(this._camRotateTouch === 1) setCamTouch(0); });
      rightBtn.addEventListener('mouseleave', () => { if(this._camRotateTouch === 1) setCamTouch(0); });

      // Hide joysticks initially (only show during gameplay)
      this.setJoysticksVisible(false);
    }
  }

  consumeCamRotate(){
    let val = 0;
    if(this.keys[this.binds.camLeft]) val -= 1;
    if(this.keys[this.binds.camRight]) val += 1;
    const touch = this._camRotateTouch || 0;
    return val || touch;
  }

  setJoysticksVisible(visible){
    const moveEl = document.getElementById('joystick-move');
    const turretEl = document.getElementById('joystick-turret');
    if(moveEl) moveEl.classList.toggle('joystick-hidden', !visible);
    if(turretEl) turretEl.classList.toggle('joystick-hidden', !visible);
    // Camera rotate buttons for mobile
    const camBtns = document.getElementById('cam-rotate-btns');
    if(camBtns) camBtns.classList.toggle('joystick-hidden', !visible);
  }

  consumeWheel(){
    const w = this.wheel; this.wheel = 0; return w;
  }

  static captureBind(){
    return new Promise(resolve=>{
      const kd = (e)=>{ cleanup(); resolve(e.code); };
      const md = (e)=>{ if(e.button!==0) return; cleanup(); resolve('LMB'); };
      const wh = (e)=>{ cleanup(); resolve(e.deltaY < 0 ? 'WheelUp' : 'WheelDown'); };
      function cleanup(){
        window.removeEventListener('keydown', kd);
        window.removeEventListener('mousedown', md);
        window.removeEventListener('wheel', wh);
      }
      window.addEventListener('keydown', kd);
      window.addEventListener('mousedown', md);
      window.addEventListener('wheel', wh, {passive:true});
    });
  }

  pressed(action){
    const k = this.binds[action];
    if(k==='LMB') return this.mouse.down;
    if(k==='WheelUp' || k==='WheelDown') return false;
    return !!this.keys[k];
  }

  consumeZoom(){
    let z = this.consumeWheel();
    if(this.keys[this.binds.zoomIn] ) z += 1;
    if(this.keys[this.binds.zoomOut]) z -= 1;
    if(this._pinchAccum){
      z += this._pinchAccum;
      this._pinchAccum = 0;
    }
    return z;
  }

  /* Get touch input for the current frame */
  getTouchInput(){
    if(!this._moveJoystick && !this._turretJoystick){
      return null;
    }

    const move = this._moveJoystick ? this._moveJoystick.getValue() : {x:0, y:0, firing:false};
    const turret = this._turretJoystick ? this._turretJoystick.getValue() : {x:0, y:0, firing:false};

    // Movement: joystick up (negative y) = backward, joystick down (positive y) = forward
    // joystick left (negative x) = turn left, joystick right (positive x) = turn right
    const throttle = move.y;
    const turn = move.x;

    // Turret:
    // - turret.relAngle follows drag direction relative to joystick up
    // - armed means joystick knob is near max ring
    // - fire while armed = tank shoots continuously when at max distance
    const turretRelAngle = turret.relAngle || 0;
    const armed = !!turret.armed;

    return {
      throttle,
      turn,
      turretRelAngle,
      armed,
      isTouch: this.isTouchDevice,
    };
  }
}