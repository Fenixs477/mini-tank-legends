/* nakama-net.ts — Nakama game backend integration */
import { CONFIG } from './config';

export const NakamaNet: any = {
  client: null,
  session: null,
  socket: null,
  currentMatch: null,
  isHost: false,
  matchId: null,
  roomCode: null,
  onPlayerJoin: null,
  onPlayerLeave: null,
  onInput: null,
  onState: null,
  onWelcome: null,
  onHostChange: null,
  worldMatchId: 'fr-' + CONFIG.NAKAMA.SERVER_KEY,

  init() {
    const cfg = CONFIG.NAKAMA;
    this.client = new (window as any).nakamajs.Client(cfg.SERVER_KEY, cfg.HOST, cfg.PORT);
    this.client.useSsl = cfg.USE_SSL;
  },

  async authenticateEmail(email: string, password: string) {
    if (!this.client) this.init();
    this.session = await this.client.authenticateEmail({ email, password });
    return this.session;
  },

  async registerEmail(email: string, password: string) {
    if (!this.client) this.init();
    this.session = await this.client.authenticateEmail({ email, password, create: true });
    return this.session;
  },

  async authenticateDevice(deviceId: string) {
    if (!this.client) this.init();
    this.session = await this.client.authenticateDevice({ id: deviceId });
    return this.session;
  },

  get userId() { return this.session ? this.session.user_id : null; },
  get username() { return this.session ? this.session.username : null; },
  get isAuthenticated() { return !!this.session; },

  async connectSocket() {
    if (!this.session) throw new Error('Not authenticated');
    this.socket = this.client.createSocket();
    await this.socket.connect(this.session);
  },

  disconnectSocket() {
    if (this.socket) { try { this.socket.disconnect(); } catch (_e) { } }
    this.socket = null;
  },

  get isConnected() { return this.socket && this.socket.isConnected; },

  async createMatch(name: string) {
    if (!this.socket) await this.connectSocket();
    const match = await this.socket.createMatch(name);
    this.currentMatch = match;
    this.matchId = match.id;
    this.isHost = true;
    this._wireMatch();
    return match;
  },

  async joinMatch(matchId: string) {
    if (!this.socket) await this.connectSocket();
    const match = await this.socket.joinMatch(matchId);
    this.currentMatch = match;
    this.matchId = matchId;
    this.isHost = false;
    this._wireMatch();
    return match;
  },

  async joinOrCreateWorld() {
    if (!this.socket) await this.connectSocket();
    const worldId = await this.storageRead('world', 'match_id');
    if (worldId) {
      try {
        const match = await this.socket.joinMatch(worldId);
        this.currentMatch = match;
        this.matchId = match.id;
        this.isHost = false;
        this._wireMatch();
        return match;
      } catch (_e) { }
    }
    const match = await this.socket.createMatch();
    this.currentMatch = match;
    this.matchId = match.id;
    this.isHost = true;
    await this.storageWrite('world', 'match_id', match.id);
    this._wireMatch();
    return match;
  },

  async leaveMatch() {
    if (this.currentMatch && this.socket) { try { this.socket.leaveMatch(this.currentMatch.id); } catch (_e) { } }
    this.currentMatch = null;
    this.matchId = null;
    this.isHost = false;
  },

  _wireMatch() {
    if (!this.currentMatch) return;
    this.currentMatch.onmatchdata = (result: any) => {
      const data = result.data;
      if (!data) return;
      if (data.t === 'join' && this.onPlayerJoin) this.onPlayerJoin({ peerId: result.user.presence.user_id, name: data.name, tank: data.tank, color: data.color });
      if (data.t === 'input' && this.onInput) this.onInput(result.user.presence.user_id, data.input);
      if (data.t === 'state' && this.onState) this.onState(data.s);
      if (data.t === 'spawn' && this.onWelcome) this.onWelcome(data);
      if (data.t === 'new_host' && this.onHostChange) this.onHostChange(data.hostId);
    };
    this.currentMatch.onmatchpresence = (result: any) => {
      (result.leaves || []).forEach((p: any) => { if (this.onPlayerLeave) this.onPlayerLeave(p.user_id); });
    };
  },

  sendMatchData(data: any) {
    if (!this.currentMatch || !this.socket) return;
    try { this.socket.sendMatchData(this.currentMatch.id, data); } catch (_e) { }
  },

  async storageWrite(collection: string, key: string, value: string) {
    if (!this.session) throw new Error('Not authenticated');
    await this.client.writeStorageObjects(this.session, [{ collection, key, value }]);
  },

  async storageRead(collection: string, key: string) {
    if (!this.session) return null;
    try {
      const objects = await this.client.readStorageObjects(this.session, { collection, key });
      return objects.length ? objects[0].value : null;
    } catch (_e) { return null; }
  },

  async disconnect() {
    await this.leaveMatch();
    this.disconnectSocket();
    this.session = null;
  },
};
