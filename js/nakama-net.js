/* ============================================================
   nakama-net.js â€” Nakama game backend integration.
   Handles auth, real-time multiplayer, cloud storage.
   ============================================================ */

const NakamaNet = {
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
  worldMatchId: 'fr-' + CONFIG.NAKAMA.SERVER_KEY, // persistent world match name

  /* ---------- Init ---------- */
  init(){
    const cfg = CONFIG.NAKAMA;
    this.client = new nakamajs.Client(cfg.SERVER_KEY, cfg.HOST, cfg.PORT);
    this.client.useSsl = cfg.USE_SSL;
  },

  /* ---------- Auth ---------- */
  async authenticateEmail(email, password){
    if(!this.client) this.init();
    this.session = await this.client.authenticateEmail({ email, password });
    return this.session;
  },

  async registerEmail(email, password){
    if(!this.client) this.init();
    this.session = await this.client.authenticateEmail({ email, password, create: true });
    return this.session;
  },

  async authenticateDevice(deviceId){
    if(!this.client) this.init();
    this.session = await this.client.authenticateDevice({ id: deviceId });
    return this.session;
  },

  get userId(){ return this.session ? this.session.user_id : null; },
  get username(){ return this.session ? this.session.username : null; },
  get isAuthenticated(){ return !!this.session; },

  /* ---------- Socket ---------- */
  async connectSocket(){
    if(!this.session) throw new Error('Not authenticated');
    this.socket = this.client.createSocket();
    await this.socket.connect(this.session);
  },

  disconnectSocket(){
    if(this.socket){
      try{ this.socket.disconnect(); }catch(e){}
      this.socket = null;
    }
  },

  /* ---------- Multiplayer (client-relayed) ---------- */
  get isConnected(){ return this.socket && this.socket.isConnected; },

  async createMatch(name){
    if(!this.socket) await this.connectSocket();
    const match = await this.socket.createMatch(name);
    this.currentMatch = match;
    this.matchId = match.id;
    this.isHost = true;
    this._wireMatch();
    return match;
  },

  async joinMatch(matchId){
    if(!this.socket) await this.connectSocket();
    const match = await this.socket.joinMatch(matchId);
    this.currentMatch = match;
    this.matchId = matchId;
    this.isHost = false;
    this._wireMatch();
    return match;
  },

  async joinOrCreateWorld(){
    if(!this.socket) await this.connectSocket();
    // Try to join existing persistent world match via cloud storage
    const worldId = await this.storageRead('world', 'match_id');
    if(worldId){
      try {
        const match = await this.socket.joinMatch(worldId);
        this.currentMatch = match;
        this.matchId = match.id;
        this.isHost = false;
        this._wireMatch();
        return match;
      } catch(e) {
        // Match stale or gone â€” will create new one below
      }
    }
    // Create new match as world host
    const match = await this.socket.createMatch();
    this.currentMatch = match;
    this.matchId = match.id;
    this.isHost = true;
    await this.storageWrite('world', 'match_id', match.id);
    this._wireMatch();
    return match;
  },

  async leaveMatch(){
    if(this.currentMatch && this.socket){
      try{ this.socket.leaveMatch(this.currentMatch.id); }catch(e){}
    }
    this.currentMatch = null;
    this.matchId = null;
    this.isHost = false;
  },

  _wireMatch(){
    if(!this.currentMatch) return;
    this.currentMatch.onmatchdata = (result) => {
      const data = result.data;
      if(!data) return;
      if(data.t === 'join' && this.onPlayerJoin){
        this.onPlayerJoin({ peerId: result.user.presence.user_id, name: data.name, tank: data.tank, color: data.color });
      }
      if(data.t === 'input' && this.onInput){
        this.onInput(result.user.presence.user_id, data.input);
      }
      if(data.t === 'state' && this.onState){
        this.onState(data.s);
      }
      if(data.t === 'spawn' && this.onWelcome){
        this.onWelcome(data);
      }
      if(data.t === 'new_host' && this.onHostChange){
        this.onHostChange(data.hostId);
      }
    };
    this.currentMatch.onmatchpresence = (result) => {
      (result.leaves || []).forEach(p => {
        if(this.onPlayerLeave) this.onPlayerLeave(p.user_id);
      });
    };
  },

  sendMatchData(data){
    if(!this.currentMatch || !this.socket) return;
    try{ this.socket.sendMatchData(this.currentMatch.id, data); }catch(e){}
  },

  /* ---------- Cloud storage ---------- */
  async storageWrite(collection, key, value){
    if(!this.session) throw new Error('Not authenticated');
    const objects = [{ collection, key, value }];
    await this.client.writeStorageObjects(this.session, objects);
  },

  async storageRead(collection, key){
    if(!this.session) return null;
    try {
      const objects = await this.client.readStorageObjects(this.session, { collection, key });
      return objects.length ? objects[0].value : null;
    } catch(e) { return null; }
  },

  /* ---------- Disconnect ---------- */
  async disconnect(){
    await this.leaveMatch();
    this.disconnectSocket();
    this.session = null;
  },
};
