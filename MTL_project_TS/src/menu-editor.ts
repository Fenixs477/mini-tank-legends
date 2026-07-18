/* menu-editor.ts — Canvas-based custom menu layout editor */
import { Menu } from './menu';

interface MenuCommand { value: string; label: string; }

const MENU_COMMANDS: MenuCommand[] = [
  { value: 'none', label: 'None' },
  { value: 'singleplayer', label: 'Singleplayer' },
  { value: 'multiplayer', label: 'Multiplayer' },
  { value: 'collections', label: 'Collections' },
  { value: 'settings', label: 'Settings' },
  { value: 'codes', label: 'Codes' },
  { value: 'preview', label: 'Preview Tank' },
  { value: 'back', label: '← Back' },
];

interface MenuElementBase {
  type: string;
  x: number; y: number; w: number; h: number;
  name?: string;
}

interface MenuImageElement extends MenuElementBase {
  type: 'image';
  image?: HTMLImageElement;
  imageData?: string;
}

interface MenuButtonElement extends MenuElementBase {
  type: 'button';
  label?: string;
  bgColor?: string;
  command?: string;
  hitbox?: { x: number; y: number; w: number; h: number };
}

type MenuElement = MenuImageElement | MenuButtonElement;

export const MenuEditor = {
  _isOpen: false,
  _inited: false,
  elements: [],
  selected: null,
  _dragMode: null,
  _dragStart: null,
  _dragElm: null,
  _imageCounter: 0,
  _canvas: null,
  _ctx: null,

  open() {
    if (this._isOpen) return;
    this._isOpen = true;
    document.getElementById('me-overlay')!.classList.remove('hidden');
    document.querySelectorAll('.menu').forEach(m => m.classList.add('hidden'));
    document.getElementById('hud')!.classList.add('hidden');
    if (!this._inited) this._init();
    this._render();
  },

  close() {
    document.getElementById('me-overlay')!.classList.add('hidden');
    this._isOpen = false;
    Menu.show('menu-main');
  },

  _init() {
    this._canvas = document.createElement('canvas');
    this._canvas.width = 800;
    this._canvas.height = 600;
    this._canvas.style.width = '100%';
    this._canvas.style.height = '100%';
    this._ctx = this._canvas.getContext('2d')!;
    document.getElementById('me-canvas-host')!.appendChild(this._canvas);
    this._load();
    this._wire();
    this._inited = true;
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  },

  _loop() {
    if (!this._isOpen) return;
    this._render();
    requestAnimationFrame(this._loop);
  },

  _render() {
    const ctx = this._ctx!;
    const w = this._canvas!.width;
    const h = this._canvas!.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#20242a';
    ctx.fillRect(0, 0, w, h);
    const grid = 30;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    this.elements.forEach(el => this._drawElement(el));
  },

  _drawElement(el: MenuElement) {
    const ctx = this._ctx!;
    ctx.save();
    if (el.type === 'image' && (el as MenuImageElement).image) {
      ctx.drawImage((el as MenuImageElement).image!, el.x, el.y, el.w, el.h);
    } else if (el.type === 'button') {
      const btn = el as MenuButtonElement;
      ctx.fillStyle = btn.bgColor || '#383838';
      ctx.beginPath();
      const r = 12;
      ctx.moveTo(el.x + r, el.y);
      ctx.lineTo(el.x + el.w - r, el.y);
      ctx.quadraticCurveTo(el.x + el.w, el.y, el.x + el.w, el.y + r);
      ctx.lineTo(el.x + el.w, el.y + el.h - r);
      ctx.quadraticCurveTo(el.x + el.w, el.y + el.h, el.x + el.w - r, el.y + el.h);
      ctx.lineTo(el.x + r, el.y + el.h);
      ctx.quadraticCurveTo(el.x, el.y + el.h, el.x, el.y + el.h - r);
      ctx.lineTo(el.x, el.y + r);
      ctx.quadraticCurveTo(el.x, el.y, el.x + r, el.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#3a3a3a';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px Segoe UI';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(btn.label || 'Button', el.x + el.w / 2, el.y + el.h / 2);
      if (btn.command && btn.command !== 'none') {
        ctx.fillStyle = '#ffb12b';
        ctx.font = '10px Segoe UI';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('➤ ' + btn.command, el.x + el.w - 4, el.y + el.h - 4);
      }
    }
    if (el === this.selected) {
      ctx.strokeStyle = '#ffb12b';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(el.x - 2, el.y - 2, el.w + 4, el.h + 4);
      ctx.setLineDash([]);
      const hs = 8;
      ctx.fillStyle = '#ffb12b';
      const handles = [[el.x, el.y], [el.x + el.w, el.y], [el.x, el.y + el.h], [el.x + el.w, el.y + el.h],
      [el.x + el.w / 2, el.y], [el.x + el.w / 2, el.y + el.h], [el.x, el.y + el.h / 2], [el.x + el.w, el.y + el.h / 2]];
      handles.forEach(([hx, hy]) => { ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs); });
    }
    ctx.restore();
  },

  _wire() {
    const canvas = this._canvas!;
    const getPos = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const scaleX = canvas.width / r.width;
      const scaleY = canvas.height / r.height;
      return { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY };
    };

    canvas.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      const pos = getPos(e);
      const hit = this._hitTest(pos.x, pos.y);
      if (hit) {
        this.selected = hit;
        this._refreshInspector();
        this._dragMode = 'move';
        this._dragStart = { x: pos.x - hit.x, y: pos.y - hit.y };
        this._dragElm = hit;
        const handle = this._hitHandle(pos.x, pos.y);
        if (handle) this._dragMode = 'resize';
      } else {
        this.selected = null;
        this._refreshInspector();
        this._dragMode = null;
      }
    });

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this._dragMode || !this._dragElm) return;
      const pos = getPos(e);
      if (this._dragMode === 'move') {
        this._dragElm.x = Math.max(0, pos.x - this._dragStart!.x);
        this._dragElm.y = Math.max(0, pos.y - this._dragStart!.y);
      } else if (this._dragMode === 'resize') {
        this._dragElm.w = Math.max(20, pos.x - this._dragElm.x);
        this._dragElm.h = Math.max(20, pos.y - this._dragElm.y);
      }
    });

    window.addEventListener('mouseup', () => {
      this._dragMode = null;
      this._dragElm = null;
    });

    document.getElementById('me-upload-png')!.onclick = () => {
      document.getElementById('me-file-input')!.click();
    };
    document.getElementById('me-file-input')!.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files![0];
      if (!file) return;
      const img = new Image();
      img.onload = () => {
        this._imageCounter++;
        this.elements.push({
          type: 'image',
          image: img,
          x: 50, y: 50,
          w: Math.min(img.width, 400),
          h: Math.min(img.height, 400),
          name: 'Image ' + this._imageCounter,
        } as MenuImageElement);
        this._save();
        this.toast('Image added');
      };
      img.src = URL.createObjectURL(file);
      (e.target as HTMLInputElement).value = '';
    };

    document.getElementById('me-add-btn')!.onclick = () => {
      this.elements.push({
        type: 'button',
        x: 100, y: 100,
        w: 160, h: 50,
        label: 'New Button',
        bgColor: '#383838',
        command: 'none',
        hitbox: { x: 0, y: 0, w: 160, h: 50 },
      } as MenuButtonElement);
      this._save();
      this.toast('Button added');
    };

    document.getElementById('me-delete-selected')!.onclick = () => {
      if (!this.selected) return;
      this.elements = this.elements.filter(e => e !== this.selected);
      this.selected = null;
      this._refreshInspector();
      this._save();
    };

    document.getElementById('me-back')!.onclick = () => this.close();
    document.getElementById('me-save')!.onclick = () => { this._save(); this.toast('Menu layout saved!'); };
    document.getElementById('me-apply')!.onclick = () => { this._save(); this._applyToMainMenu(); };

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this._isOpen) return;
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (this.selected) {
          this.elements = this.elements.filter(el => el !== this.selected);
          this.selected = null;
          this._refreshInspector();
          this._save();
        }
      }
      if (e.code === 'Escape') { this.selected = null; this._refreshInspector(); }
    });
  },

  _hitTest(x: number, y: number): MenuElement | null {
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const el = this.elements[i];
      if (x >= el.x && x <= el.x + el.w && y >= el.y && y <= el.y + el.h) return el;
    }
    return null;
  },

  _hitHandle(x: number, y: number): boolean {
    if (!this.selected) return false;
    const el = this.selected;
    const hs = 10;
    const bx = el.x + el.w, by = el.y + el.h;
    return (x >= bx - hs && x <= bx + hs && y >= by - hs && y <= by + hs);
  },

  _refreshInspector() {
    const ins = document.getElementById('me-inspector')!;
    if (!this.selected) {
      ins.innerHTML = '<div class="me-title">Inspector</div><div class="me-muted">Click an element to select it<br>Drag to move<br>Bottom-right handle to resize</div>';
      return;
    }
    const el = this.selected;
    let html = `<div class="me-title">Inspector</div>`;
    html += `<div class="me-row"><span>Type</span> ${el.type}</div>`;
    html += `<div class="me-row"><span>X</span> <input type="number" class="me-num" value="${Math.round(el.x)}" data-prop="x"></div>`;
    html += `<div class="me-row"><span>Y</span> <input type="number" class="me-num" value="${Math.round(el.y)}" data-prop="y"></div>`;
    html += `<div class="me-row"><span>W</span> <input type="number" class="me-num" value="${Math.round(el.w)}" data-prop="w"></div>`;
    html += `<div class="me-row"><span>H</span> <input type="number" class="me-num" value="${Math.round(el.h)}" data-prop="h"></div>`;
    if (el.type === 'button') {
      const btn = el as MenuButtonElement;
      html += `<div class="me-row"><span>Label</span> <input type="text" class="me-text" value="${btn.label || ''}" data-prop="label"></div>`;
      html += `<div class="me-row"><span>Command</span> <select class="me-select" data-prop="command">`;
      MENU_COMMANDS.forEach(c => {
        html += `<option value="${c.value}"${(btn.command || 'none') === c.value ? ' selected' : ''}>${c.label}</option>`;
      });
      html += `</select></div>`;
      html += `<div class="me-title" style="margin-top:12px">Hitbox</div>`;
      html += `<div class="me-hint">Relative to element position</div>`;
      const hb = btn.hitbox || { x: 0, y: 0, w: el.w, h: el.h };
      html += `<div class="me-row"><span>HX</span> <input type="number" class="me-num" value="${hb.x}" data-prop="hitbox.x"></div>`;
      html += `<div class="me-row"><span>HY</span> <input type="number" class="me-num" value="${hb.y}" data-prop="hitbox.y"></div>`;
      html += `<div class="me-row"><span>HW</span> <input type="number" class="me-num" value="${hb.w}" data-prop="hitbox.w"></div>`;
      html += `<div class="me-row"><span>HH</span> <input type="number" class="me-num" value="${hb.h}" data-prop="hitbox.h"></div>`;
    }
    if (el.type === 'image') {
      html += `<div class="me-row"><span>Name</span> ${(el as MenuImageElement).name || 'Image'}</div>`;
    }
    ins.innerHTML = html;
    ins.querySelectorAll('.me-num, .me-text, .me-select').forEach(inp => {
      (inp as HTMLElement).onchange = () => {
        const path = ((inp as HTMLElement).dataset.prop || '').split('.');
        let target: any = el;
        for (let i = 0; i < path.length - 1; i++) target = target[path[i]] = target[path[i]] || {};
        target[path[path.length - 1]] = (inp as HTMLInputElement).type === 'number' ? +(inp as HTMLInputElement).value : (inp as HTMLInputElement).value;
        this._save();
      };
    });
  },

  _save() {
    const data = this.elements.map(el => ({
      type: el.type,
      x: el.x, y: el.y, w: el.w, h: el.h,
      label: (el as MenuButtonElement).label,
      bgColor: (el as MenuButtonElement).bgColor,
      command: (el as MenuButtonElement).command,
      hitbox: (el as MenuButtonElement).hitbox,
      name: (el as MenuImageElement).name,
      imageData: (el as MenuImageElement).image ? this._canvasToData((el as MenuImageElement).image!, Math.round(el.w), Math.round(el.h)) : null,
    }));
    localStorage.setItem('tankparty_menueditor', JSON.stringify(data));
  },

  _load() {
    try {
      const data = JSON.parse(localStorage.getItem('tankparty_menueditor') || 'null');
      if (!data) return;
      this.elements = [];
      data.forEach((d: any) => {
        const el: MenuElement = { ...d };
        if (el.type === 'image' && d.imageData) {
          const img = new Image();
          img.onload = () => { (el as MenuImageElement).image = img; };
          img.src = d.imageData;
        }
        this.elements.push(el);
      });
    } catch (e) { /* ignore */ }
  },

  _canvasToData(img: HTMLImageElement, w: number, h: number): string {
    const c = document.createElement('canvas');
    c.width = w || img.width;
    c.height = h || img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL();
  },

  _applyToMainMenu() {
    localStorage.setItem('tankparty_custommainmenu', '1');
    this.toast('Custom menu set as main!');
    this.close();
  },

  toast(msg: string) {
    if (Menu && Menu.toast) Menu.toast(msg);
  },
};
