/* input.ts — keyboard + mouse + wheel + TOUCH (dual joystick) */
export class TouchJoystick {
  container: HTMLElement | null;
  opts: any;
  active = false;
  touchId = -1;
  dx = 0;
  dy = 0;
  relAngle = 0;
  armed = false;
  firePulse = false;
  firing = false;
  _pressedWhileArmed = false;
  outer: HTMLElement | null = null;
  knob: HTMLElement | null = null;
  _centerX = 0;
  _centerY = 0;
  _half = 0;
  _maxDist = 0;

  constructor(containerId: string, opts: any = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    this.opts = Object.assign({
      size: 130, deadZone: 0.08,
      turretFireMode: 'none', armedThreshold: 0.98, maxFireDistance: 1.0,
    }, opts);
    this._build();
    this._bindEvents();
  }

  _build(): void {
    this.container!.innerHTML = '';
    const shortSide = Math.min(window.innerWidth, window.innerHeight);
    const joySize = Math.min(this.opts.size, Math.max(64, shortSide * 0.3));
    this.container!.style.width = joySize + 'px';
    this.container!.style.height = joySize + 'px';
    this.outer = document.createElement('div');
    this.outer.className = 'joystick-outer';
    this.container!.appendChild(this.outer);
    this.knob = document.createElement('div');
    this.knob.className = 'joystick-knob';
    const knobSize = Math.round(joySize * 0.38);
    this.knob.style.width = knobSize + 'px';
    this.knob.style.height = knobSize + 'px';
    this.outer!.appendChild(this.knob);
    this._half = joySize / 2;
    this._maxDist = this._half - knobSize / 2 - 4;
  }

  _bindEvents(): void {
    const el = this.container!;
    const getPos = (touches: TouchList, id: number) => {
      for (const t of touches) { if (t.identifier === id) return { x: t.clientX, y: t.clientY }; }
      return null;
    };
    const preventDocMove = (e: Event) => e.preventDefault();
    const onStart = (e: TouchEvent) => {
      e.preventDefault();
      if (this.opts.turretFireMode === 'armedPress' && this.armed) this.firePulse = true;
      for (const t of e.changedTouches) {
        if (!this.active) {
          this.active = true;
          this.touchId = t.identifier;
          this._centerX = t.clientX; this._centerY = t.clientY;
          this._updateKnob(0, 0);
          this.dx = 0; this.dy = 0; this.firePulse = false; this.armed = false;
          document.addEventListener('touchmove', preventDocMove, { passive: false });
        }
      }
    };
    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      const pos = getPos(e.changedTouches, this.touchId);
      if (!pos) return;
      let dx = pos.x - this._centerX, dy = pos.y - this._centerY;
      let dist = Math.hypot(dx, dy);
      if (dist > this._maxDist) { dx = dx / dist * this._maxDist; dy = dy / dist * this._maxDist; dist = this._maxDist; }
      this._updateKnob(dx, dy);
      let nx = dx / this._maxDist, ny = dy / this._maxDist;
      if (Math.abs(nx) < this.opts.deadZone) nx = 0;
      if (Math.abs(ny) < this.opts.deadZone) ny = 0;
      this.dx = nx; this.dy = ny;
      if (this.opts.turretFireMode === 'armedPress') {
        this.relAngle = Math.atan2(this.dx, -this.dy);
        const mag = Math.min(1, Math.hypot(this.dx, this.dy));
        this.armed = mag >= this.opts.armedThreshold;
      }
    };
    const onEnd = (e: TouchEvent) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touchId) {
          this.active = false; this.touchId = -1;
          this.dx = 0; this.dy = 0; this.armed = false; this.firePulse = false;
          this._updateKnob(0, 0);
          document.removeEventListener('touchmove', preventDocMove, { passive: false } as any);
        }
      }
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('touchcancel', onEnd, { passive: false });
  }

  _updateKnob(dx: number, dy: number): void {
    if (this.knob) this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  getValue(): any {
    return { x: this.dx, y: this.dy, firing: this.firing, relAngle: this.relAngle, armed: this.armed };
  }
}

export class Input {
  settings: any;
  keys: Record<string, boolean> = {};
  mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0, down: false };
  binds: Record<string, string>;
  wheel = 0;
  isTouchDevice: boolean;
  _touchInput: any = {};
  _moveJoystick: TouchJoystick | null = null;
  _turretJoystick: TouchJoystick | null = null;
  _camRotateTouch = 0;

  // Pinch-to-zoom state
  _pinchTouchIds: number[] = [];
  _pinchDist = 0;
  _pinchAccum = 0;

  constructor(settings: any) {
    this.settings = settings;
    this.binds = settings.binds;
    this.isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    window.addEventListener('keydown', e => { this.keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    const canvas = () => document.querySelector('#game-root canvas') as HTMLCanvasElement;
    document.addEventListener('mousemove', e => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      const c = canvas();
      if (c) { const r = c.getBoundingClientRect(); this.mouse.ndcX = ((e.clientX - r.left) / r.width) * 2 - 1; this.mouse.ndcY = -((e.clientY - r.top) / r.height) * 2 + 1; }
    });
    document.addEventListener('mousedown', e => { if (e.button === 0) this.mouse.down = true; });
    document.addEventListener('mouseup', e => { if (e.button === 0) this.mouse.down = false; });
    window.addEventListener('wheel', e => { this.wheel += (e.deltaY < 0 ? 1 : -1); }, { passive: true });
    window.addEventListener('blur', () => { this.keys = {}; this.mouse.down = false; this._camRotateTouch = 0; });
    document.addEventListener('touchstart', (e) => { if ((e.target as HTMLElement).closest('.joystick-container, .cam-rotate-btns, #game-root')) e.preventDefault(); }, { passive: false });
    // Pinch-to-zoom gesture
    const getTouchById = (touches: TouchList, id: number) => {
      for (const t of touches) { if (t.identifier === id) return t; }
      return null;
    };
    document.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        this._pinchTouchIds = [e.touches[0].identifier, e.touches[1].identifier];
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this._pinchDist = Math.hypot(dx, dy);
      }
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (this._pinchTouchIds.length === 2) {
        const t1 = getTouchById(e.touches, this._pinchTouchIds[0]);
        const t2 = getTouchById(e.touches, this._pinchTouchIds[1]);
        if (t1 && t2) {
          const dx = t1.clientX - t2.clientX;
          const dy = t1.clientY - t2.clientY;
          const dist = Math.hypot(dx, dy);
          this._pinchAccum += (dist - this._pinchDist) * 0.03;
          this._pinchDist = dist;
        }
      }
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        this._pinchTouchIds = [];
        this._pinchDist = 0;
      }
    }, { passive: true });
    if (this.isTouchDevice) this._initTouch();
  }

  _initTouch(): void {
    let moveEl = document.getElementById('joystick-move');
    let turretEl = document.getElementById('joystick-turret');
    if (!moveEl) {
      moveEl = document.createElement('div');
      moveEl.id = 'joystick-move';
      moveEl.className = 'joystick-container joystick-left';
      document.body.appendChild(moveEl);
    }
    if (!turretEl) {
      turretEl = document.createElement('div');
      turretEl.id = 'joystick-turret';
      turretEl.className = 'joystick-container joystick-right';
      document.body.appendChild(turretEl);
    }
    this._moveJoystick = new TouchJoystick('joystick-move', { size: 133, fireOnMax: false });
    this._turretJoystick = new TouchJoystick('joystick-turret', { size: 127, turretFireMode: 'armedPress', armedThreshold: 0.98 });
    let camBtns = document.getElementById('cam-rotate-btns');
    if (!camBtns) {
      camBtns = document.createElement('div');
      camBtns.id = 'cam-rotate-btns';
      camBtns.className = 'cam-rotate-btns joystick-hidden';
      camBtns.innerHTML = '<button class="cam-rot-btn" id="cam-rot-left" aria-label="Rotate camera left">◀</button><button class="cam-rot-btn" id="cam-rot-right" aria-label="Rotate camera right">▶</button>';
      document.body.appendChild(camBtns);
    }
    const leftBtn = document.getElementById('cam-rot-left')!;
    const rightBtn = document.getElementById('cam-rot-right')!;
    const setCamTouch = (dir: number) => { this._camRotateTouch = dir; };
    leftBtn.addEventListener('touchstart', (e) => { e.preventDefault(); setCamTouch(-1); }, { passive: false });
    leftBtn.addEventListener('touchend', (e) => { e.preventDefault(); if (this._camRotateTouch === -1) setCamTouch(0); }, { passive: false });
    leftBtn.addEventListener('touchcancel', () => { if (this._camRotateTouch === -1) setCamTouch(0); });
    rightBtn.addEventListener('touchstart', (e) => { e.preventDefault(); setCamTouch(1); }, { passive: false });
    rightBtn.addEventListener('touchend', (e) => { e.preventDefault(); if (this._camRotateTouch === 1) setCamTouch(0); }, { passive: false });
    rightBtn.addEventListener('touchcancel', () => { if (this._camRotateTouch === 1) setCamTouch(0); });
    leftBtn.addEventListener('mousedown', () => setCamTouch(-1));
    leftBtn.addEventListener('mouseup', () => { if (this._camRotateTouch === -1) setCamTouch(0); });
    leftBtn.addEventListener('mouseleave', () => { if (this._camRotateTouch === -1) setCamTouch(0); });
    rightBtn.addEventListener('mousedown', () => setCamTouch(1));
    rightBtn.addEventListener('mouseup', () => { if (this._camRotateTouch === 1) setCamTouch(0); });
    rightBtn.addEventListener('mouseleave', () => { if (this._camRotateTouch === 1) setCamTouch(0); });
    this.setJoysticksVisible(false);
  }

  consumeCamRotate(): number {
    let val = 0;
    if (this.keys[this.binds.camLeft]) val -= 1;
    if (this.keys[this.binds.camRight]) val += 1;
    return val || this._camRotateTouch;
  }

  setJoysticksVisible(visible: boolean): void {
    const el = (id: string) => document.getElementById(id);
    const toggle = (id: string, v: boolean) => { const e = el(id); if (e) e.classList.toggle('joystick-hidden', !v); };
    toggle('joystick-move', visible); toggle('joystick-turret', visible); toggle('cam-rotate-btns', visible);
  }

  consumeWheel(): number { const w = this.wheel; this.wheel = 0; return w; }

  static captureBind(): Promise<string> {
    return new Promise(resolve => {
      const kd = (e: KeyboardEvent) => { cleanup(); resolve(e.code); };
      const md = (e: MouseEvent) => { if (e.button !== 0) return; cleanup(); resolve('LMB'); };
      const wh = (e: WheelEvent) => { cleanup(); resolve(e.deltaY < 0 ? 'WheelUp' : 'WheelDown'); };
      const cleanup = () => {
        window.removeEventListener('keydown', kd);
        window.removeEventListener('mousedown', md);
        window.removeEventListener('wheel', wh);
      };
      window.addEventListener('keydown', kd);
      window.addEventListener('mousedown', md);
      window.addEventListener('wheel', wh, { passive: true });
    });
  }

  pressed(action: string): boolean {
    const k = this.binds[action];
    if (k === 'LMB') return this.mouse.down;
    if (k === 'WheelUp' || k === 'WheelDown') return false;
    return !!this.keys[k];
  }

  consumeZoom(): number {
    let z = this.consumeWheel();
    if (this.keys[this.binds.zoomIn]) z += 1;
    if (this.keys[this.binds.zoomOut]) z -= 1;
    if (this._pinchAccum) {
      z += this._pinchAccum;
      this._pinchAccum = 0;
    }
    return z;
  }

  getTouchInput(): any {
    if (!this._moveJoystick && !this._turretJoystick) return null;
    const move = this._moveJoystick ? this._moveJoystick.getValue() : { x: 0, y: 0 };
    const turret = this._turretJoystick ? this._turretJoystick.getValue() : { x: 0, y: 0 };
    return {
      throttle: move.y,
      turn: move.x,
      turretRelAngle: turret.relAngle || 0,
      armed: !!turret.armed,
      isTouch: this.isTouchDevice,
    };
  }
}
