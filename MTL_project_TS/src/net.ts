/* net.ts — Peer-to-Peer multiplayer using PeerJS */
import { CONFIG } from './config';
import type { PeerInfo } from './types';

export const Net: any = {
  peer: null,
  role: null,
  roomCode: null,
  isPublic: false,
  maxPlayers: 8,
  fakePlayers: 4,
  conns: {},
  hostConn: null,
  myPeerId: null,
  lobbyAnnounced: false,
  _statusEl: null,
  onPlayerJoin: null,
  onPlayerLeave: null,
  onInput: null,
  onState: null,
  onWelcome: null,

  _status(msg?: string, cls?: string) {
    if (!this._statusEl) this._statusEl = document.getElementById('net-status');
    const el = this._statusEl;
    if (!el) return;
    if (!msg) { el.classList.add('hidden'); return; }
    el.textContent = msg;
    el.classList.remove('hidden', 'on', 'off');
    if (cls) el.classList.add(cls);
  },

  staticCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); },
  roomId(code: string) { return CONFIG.PEER_PREFIX + 'room-' + code; },
  lobbyId() { return CONFIG.PEER_PREFIX + 'lobby-registry'; },

  _peerOpts(extra?: any) {
    const opts: any = {
      debug: 0,
      config: { iceServers: CONFIG.PEER_ICE || [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] },
    };
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      opts.host = window.location.hostname;
      opts.port = window.location.port || 80;
      opts.path = '/peerjs';
      opts.secure = false;
    }
    if (extra) Object.assign(opts, extra);
    return opts;
  },

  hostRoom(opts: any) {
    this.role = 'host';
    this.maxPlayers = Math.max(1, Math.min(20, opts.maxPlayers));
    this.isPublic = opts.isPublic;
    this.fakePlayers = opts.fakePlayers;
    this.roomCode = opts.code;
    this.peer = new (window as any).Peer(this.roomId(opts.code), this._peerOpts());
    return new Promise((resolve, reject) => {
      let settled = false;
      const ok = (id: string) => { if (settled) return; settled = true; clearTimeout(to); resolve(id); };
      const fail = (err: Error) => { if (settled) return; settled = true; clearTimeout(to); try { this.peer && this.peer.destroy(); } catch (_e) { } this.peer = null; reject(err); };
      const to = setTimeout(() => fail(new Error('Could not reach matchmaking server. Check your internet / try again.')), 15000);
      this.peer.on('open', (id: string) => {
        this.myPeerId = id;
        this._status('Waiting for players…', 'on');
        if (opts.isPublic) this._announcePublic(opts.code).catch(() => { });
        ok(id);
      });
      this.peer.on('error', (err: any) => {
        if (err.type === 'unavailable-id') fail(new Error('Room code already in use. Click Host again for a new code.'));
        else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') fail(new Error('Network error reaching matchmaking server.'));
        else if (err.type === 'browser-incompatible') fail(new Error('Browser not supported for multiplayer.'));
        else console.warn('[peer]', err.type, err.message);
      });
      this.peer.on('disconnected', () => { try { if (this.peer && !this.peer.destroyed) this.peer.reconnect(); } catch (_e) { } });
      this.peer.on('connection', (conn: any) => this._acceptClient(conn));
    });
  },

  _acceptClient(conn: any) {
    conn.on('open', () => {
      const count = Object.keys(this.conns).length;
      if (count >= this.maxPlayers) { conn.send({ t: 'reject', reason: 'Room full' }); conn.close(); return; }
      this.conns[conn.peer] = conn;
      const info: PeerInfo = { peerId: conn.peer };
      conn.metadata = info;
      this._wireClient(conn);
      conn.send({ t: 'welcome', peerId: conn.peer, roomCode: this.roomCode });
      this._status(Object.keys(this.conns).length + ' player(s) connected', 'on');
    });
  },

  _wireClient(conn: any) {
    conn.on('data', (msg: any) => {
      if (msg.t === 'join') {
        conn.metadata = { peerId: conn.peer, name: msg.name, tank: msg.tank, color: msg.color };
        if (this.onPlayerJoin) this.onPlayerJoin(conn.metadata);
      } else if (msg.t === 'input' && this.onInput) this.onInput(conn.peer, msg.input);
      else if (msg.t === 'leave') this._dropClient(conn.peer);
    });
    conn.on('close', () => this._dropClient(conn.peer));
    conn.on('error', () => this._dropClient(conn.peer));
  },

  _dropClient(peerId: string) {
    if (this.conns[peerId]) {
      const meta = this.conns[peerId].metadata;
      try { this.conns[peerId].close(); } catch (_e) { }
      delete this.conns[peerId];
      if (this.onPlayerLeave && meta) this.onPlayerLeave(peerId);
    }
  },

  sendSpawnToClient(peerId: string, spawnData: any) {
    const conn = this.conns[peerId];
    if (conn && conn.open) { try { conn.send({ t: 'spawn', data: spawnData }); } catch (_e) { } }
  },

  sendFullStateToClient(peerId: string, state: any) {
    const conn = this.conns[peerId];
    if (conn && conn.open) { try { conn.send({ t: 'fullstate', state }); } catch (_e) { } }
  },

  broadcast(snapshot: any) {
    const msg = { t: 'state', s: snapshot };
    for (const id in this.conns) { const c = this.conns[id]; if (c.open) try { c.send(msg); } catch (_e) { this._dropClient(id); } }
  },

  joinRoom(code: string) {
    this.role = 'client';
    this.roomCode = code;
    this.peer = new (window as any).Peer(this._peerOpts());
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => { if (settled) return; settled = true; clearTimeout(to); try { this.peer && this.peer.destroy(); } catch (_e) { } this.peer = null; reject(err); };
      const ok = () => { if (settled) return; settled = true; clearTimeout(to); resolve(); };
      const to = setTimeout(() => fail(new Error('Room not found / offline. Check the code.')), 15000);
      this.peer.on('open', (id: string) => {
        this.myPeerId = id;
        const conn = this.peer.connect(this.roomId(code), { reliable: true });
        conn.on('open', () => { this.hostConn = conn; this._wireHost(conn); this._status('Connected to host', 'on'); ok(); });
        conn.on('error', () => fail(new Error('Could not connect to that room.')));
      });
      this.peer.on('error', (err: any) => {
        if (err.type === 'peer-unavailable') fail(new Error('Room not found. Check the code.'));
        else fail(err);
      });
    });
  },

  sendJoinInfo(name: string, tankId: string, color: number) {
    if (this.hostConn && this.hostConn.open) { try { this.hostConn.send({ t: 'join', name, tank: tankId, color }); } catch (_e) { } }
  },

  _wireHost(conn: any) {
    conn.on('data', (msg: any) => {
      if (msg.t === 'welcome') { this.myAssignedPeerId = msg.peerId; if (this.onWelcome) this.onWelcome(msg); }
      else if (msg.t === 'spawn') { if (this.onWelcome) this.onWelcome({ t: 'spawn', ...msg.data }); }
      else if (msg.t === 'fullstate') { if (this.onState) this.onState(msg.state); }
      else if (msg.t === 'state') { if (this.onState) this.onState(msg.s); }
      else if (msg.t === 'reject') { alert('Rejected: ' + (msg.reason || 'unknown')); this.disconnect(); }
    });
    conn.on('close', () => { this._status('Disconnected from host', 'off'); if (this.onPlayerLeave) this.onPlayerLeave('host'); });
  },

  sendInput(input: any) {
    if (this.hostConn && this.hostConn.open) { try { this.hostConn.send({ t: 'input', input }); } catch (_e) { } }
  },

  async _announcePublic(code: string) {
    const tryReg = new (window as any).Peer(this.lobbyId(), this._peerOpts());
    await new Promise(res => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; res(); } };
      tryReg.on('open', () => {
        this._registry = tryReg;
        this._registryRooms = {};
        this._registryRooms[code] = { name: 'Public', code, count: 1, max: this.maxPlayers };
        this.lobbyAnnounced = true;
        tryReg.on('connection', (conn: any) => {
          conn.on('open', () => {
            conn.send({ t: 'rooms', rooms: this._registryRooms || {} });
            conn.on('data', (m: any) => {
              if (m.t === 'register') { this._registryRooms = this._registryRooms || {}; this._registryRooms[m.code] = { name: m.name, code: m.code, count: m.count, max: m.max }; }
            });
          });
          done();
        });
        tryReg.on('error', () => { try { tryReg.destroy(); } catch (_e) { } this._registerWithExisting(code).finally(done as any); });
      });
    });
  },

  async _registerWithExisting(code: string) {
    const tmp = new (window as any).Peer(this._peerOpts());
    await new Promise(res => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; res(); } };
      setTimeout(done, 4000);
      tmp.on('open', () => {
        const conn = tmp.connect(this.lobbyId(), { reliable: true });
        conn.on('open', () => { conn.send({ t: 'register', name: 'Public', code, count: 1, max: this.maxPlayers }); done(); });
        conn.on('error', done);
      });
      tmp.on('error', done);
    });
    try { tmp.destroy(); } catch (_e) { }
  },

  async listPublicRooms() {
    return new Promise(resolve => {
      let resolved = false;
      const tmp = new (window as any).Peer(this._peerOpts());
      tmp.on('open', () => {
        const conn = tmp.connect(this.lobbyId(), { reliable: true });
        const done = () => { if (!resolved) { resolved = true; resolve([]); try { tmp.destroy(); } catch (_e) { } } };
        setTimeout(done, 4000);
        conn.on('open', () => {
          conn.on('data', (m: any) => { if (m.t === 'rooms') { resolved = true; resolve(Object.values(m.rooms || {})); try { tmp.destroy(); } catch (_e) { } } });
        });
        conn.on('error', done);
      });
      tmp.on('error', () => resolve([]));
    });
  },

  disconnect() {
    try { for (const id in this.conns) this.conns[id].close(); } catch (_e) { }
    try { if (this.hostConn) this.hostConn.close(); } catch (_e) { }
    try { if (this.peer) this.peer.destroy(); } catch (_e) { }
    this.peer = null; this.role = null; this.conns = {}; this.hostConn = null;
    this._status();
  },
};
