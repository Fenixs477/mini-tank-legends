/* ============================================================
   net.js — Fully working Peer-to-Peer multiplayer using PeerJS.
   Host = authority. Clients connect to host; host relays snapshots.
   - Host advertises a public room OR a hidden 6-char code.
   - Public rooms discovered via a shared "lobby" peer-id pattern.
   - Hidden rooms: code IS the peer id suffix.
   ============================================================ */

const Net = {
  peer: null,
  role: null,          // 'host' | 'client'
  roomCode: null,
  isPublic: false,
  maxPlayers: 8,
  fakePlayers: 4,
  conns: {},           // peerId -> DataConnection
  hostConn: null,      // client's connection to host
  myPeerId: null,
  lobbyAnnounced: false,
  _statusEl: null,

  _status(msg, cls){
    if(!this._statusEl) this._statusEl = document.getElementById('net-status');
    const el = this._statusEl;
    if(!el) return;
    if(!msg){ el.classList.add('hidden'); return; }
    el.textContent = msg;
    el.classList.remove('hidden','on','off');
    if(cls) el.classList.add(cls);
  },

  // Callbacks (set by game.js)
  onPlayerJoin: null,  // cb(peerInfo)
  onPlayerLeave: null, // cb(peerId)
  onInput: null,       // cb(peerId, input)
  onState: null,       // cb(snapshot) for client
  onWelcome: null,     // cb(welcomeData) for client after joining

  /* ---------- Generate a 6-char code ---------- */
  staticCode(){ return Math.random().toString(36).slice(2,8).toUpperCase(); },

  roomId(code){ return CONFIG.PEER_PREFIX + 'room-' + code; },
  lobbyId(){    return CONFIG.PEER_PREFIX + 'lobby-registry'; },
  _peerOpts(extra){
    const opts = {
      debug: 0,
      config: { iceServers: CONFIG.PEER_ICE || [
        {urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}
      ]},
    };
    // Self-hosted signaling on localhost (when server.js runs)
    // For all other hosts (GitHub Pages, LAN IP), PeerJS public cloud broker is used
    if(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'){
      opts.host = window.location.hostname;
      opts.port = window.location.port || 80;
      opts.path = '/peerjs';
      opts.secure = false;
    }
    if(extra) Object.assign(opts, extra);
    return opts;
  },

  /* ---------- HOST ---------- */
  hostRoom({maxPlayers, isPublic, fakePlayers, code}){
    this.role='host';
    this.maxPlayers = Math.max(1,Math.min(20,maxPlayers));
    this.isPublic = isPublic;
    this.fakePlayers = fakePlayers;
    this.roomCode = code;
    this.peer = new Peer(this.roomId(code), this._peerOpts());

    return new Promise((resolve,reject)=>{
      let settled = false;
      const ok = (id)=>{ if(settled) return; settled=true; clearTimeout(to); resolve(id); };
      const fail = (err)=>{ if(settled) return; settled=true; clearTimeout(to);
        try{ this.peer && this.peer.destroy(); }catch(e){} this.peer=null; reject(err); };
      const to = setTimeout(()=> fail(new Error('Could not reach matchmaking server. Check your internet / try again.')), 15000);

      this.peer.on('open', id=>{
        this.myPeerId = id;
        this._status('Waiting for players…', 'on');
        if(isPublic) this._announcePublic(code).catch(()=>{});
        ok(id);
      });
      this.peer.on('error', err=>{
        if(err.type==='unavailable-id'){ fail(new Error('Room code already in use. Click Host again for a new code.')); }
        else if(err.type==='network' || err.type==='server-error' || err.type==='socket-error'){
          fail(new Error('Network error reaching matchmaking server.'));
        } else if(err.type==='browser-incompatible'){
          fail(new Error('Browser not supported for multiplayer.'));
        } else {
          console.warn('[peer]', err.type, err.message);
        }
      });
      this.peer.on('disconnected', ()=>{
        try{ if(this.peer && !this.peer.destroyed) this.peer.reconnect(); }catch(e){}
      });
      this.peer.on('connection', conn=> this._acceptClient(conn));
    });
  },

  _acceptClient(conn){
    conn.on('open', ()=>{
      const count = Object.keys(this.conns).length;
      if(count >= this.maxPlayers){
        conn.send({t:'reject', reason:'Room full'}); conn.close(); return;
      }
      this.conns[conn.peer] = conn;
      // We'll get the player name/tank info from their join message
      const info = {peerId:conn.peer};
      conn.metadata = info;
      this._wireClient(conn);
      // Send welcome with connection info
      conn.send({t:'welcome', peerId:conn.peer, roomCode:this.roomCode});
      this._status(Object.keys(this.conns).length + ' player(s) connected', 'on');
    });
  },

  _wireClient(conn){
    conn.on('data', msg=>{
      if(msg.t==='join'){
        // Client sends their name and selected tank
        conn.metadata = {peerId:conn.peer, name:msg.name, tank:msg.tank, color:msg.color};
        if(this.onPlayerJoin) this.onPlayerJoin(conn.metadata);
      }
      else if(msg.t==='input' && this.onInput) this.onInput(conn.peer, msg.input);
      else if(msg.t==='ping'){
        // Client RTT probe: echo straight back, record host-side latency
        conn._rtt = performance.now() - msg.ts;
        try{ conn.send({t:'pong', ts:msg.ts}); }catch(e){}
      }
      else if(msg.t==='leave'){ this._dropClient(conn.peer); }
    });
    conn.on('close', ()=>{ this._dropClient(conn.peer); });
    conn.on('error', ()=>{ this._dropClient(conn.peer); });
  },

  _dropClient(peerId){
    if(this.conns[peerId]){
      const meta = this.conns[peerId].metadata;
      try{this.conns[peerId].close();}catch(e){}
      delete this.conns[peerId];
      if(this.onPlayerLeave && meta) this.onPlayerLeave(peerId);
    }
  },

  /* Host sends initial spawn info to a specific client */
  sendSpawnToClient(peerId, spawnData){
    const conn = this.conns[peerId];
    if(conn && conn.open){
      try{ conn.send({t:'spawn', data:spawnData}); }catch(e){}
    }
  },

  /* Host sends full tank list to a newly joined client so they can see everyone */
  sendFullStateToClient(peerId, state){
    const conn = this.conns[peerId];
    if(conn && conn.open){
      try{ conn.send({t:'fullstate', state}); }catch(e){}
    }
  },

  /* host broadcasts authoritative world snapshot to all clients */
  broadcast(snapshot){
    const msg = {t:'state', s:snapshot};
    for(const id in this.conns){
      const c = this.conns[id];
      if(c.open) try{ c.send(msg); }catch(e){ this._dropClient(id); }
    }
  },

  /* ---------- CLIENT ---------- */
  joinRoom(code){
    this.role='client';
    this.roomCode = code;
    this.peer = new Peer(this._peerOpts());
    return new Promise((resolve,reject)=>{
      let settled=false;
      const fail=(err)=>{ if(settled) return; settled=true; clearTimeout(to);
        try{ this.peer && this.peer.destroy(); }catch(e){} this.peer=null; reject(err); };
      const ok=()=>{ if(settled) return; settled=true; clearTimeout(to); resolve(); };
      const to=setTimeout(()=> fail(new Error('Room not found / offline. Check the code.')), 15000);

      this.peer.on('open', id=>{
        this.myPeerId = id;
        const conn = this.peer.connect(this.roomId(code), {reliable:true});
        conn.on('open', ()=>{
          this.hostConn = conn;
          this._wireHost(conn);
          this._status('Connected to host', 'on');
          this._startPingLoop();
          ok();
        });
        conn.on('error', ()=> fail(new Error('Could not connect to that room.')));
      });
      this.peer.on('error', err=>{
        if(err.type==='peer-unavailable') fail(new Error('Room not found. Check the code.'));
        else fail(err);
      });
    });
  },

  /* Client sends join info after connection (name + tank) */
  sendJoinInfo(name, tankId, color){
    if(this.hostConn && this.hostConn.open){
      try{ this.hostConn.send({t:'join', name, tank:tankId, color}); }catch(e){}
    }
  },

  _wireHost(conn){
    conn.on('data', msg=>{
      if(msg.t==='welcome'){
        this.myAssignedPeerId = msg.peerId;
        if(this.onWelcome) this.onWelcome(msg);
      }
      else if(msg.t==='spawn'){
        // Host tells us our spawn position + initial tank ID
        if(this.onWelcome) this.onWelcome({t:'spawn', ...msg.data});
      }
      else if(msg.t==='fullstate'){
        // Host sends us the full tank list so we can see existing players
        if(this.onState) this.onState(msg.state);
      }
      else if(msg.t==='state'){
        if(this.onState) this.onState(msg.s);
      }
      else if(msg.t==='pong'){
        // Round-trip over the actual data channel (PeerJS socket ping ≠ game latency)
        this._lastPing = performance.now() - msg.ts;
      }
      else if(msg.t==='reject'){
        alert('Rejected: '+(msg.reason||'unknown'));
        this.disconnect();
      }
    });
    conn.on('close', ()=>{
      this._status('Disconnected from host', 'off');
      if(this.onPlayerLeave) this.onPlayerLeave('host');
    });
  },

  /* client sends its input each tick to host */
  sendInput(input){
    if(this.hostConn && this.hostConn.open){
      try{ this.hostConn.send({t:'input', input}); }catch(e){}
    }
  },

  /* Client-side ping loop: one tiny message per second over the data channel */
  _startPingLoop(){
    this._stopPingLoop();
    this._lastPing = null;
    this._pingTimer = setInterval(()=>{
      if(this.hostConn && this.hostConn.open){
        try{ this.hostConn.send({t:'ping', ts:performance.now()}); }catch(e){}
      }
    }, 1000);
  },
  _stopPingLoop(){
    if(this._pingTimer){ clearInterval(this._pingTimer); this._pingTimer = null; }
  },

  /* Host-side average RTT across all connected clients (0 when none) */
  hostAvgPing(){
    let total = 0, n = 0;
    for(const id in this.conns){
      const c = this.conns[id];
      if(c && c._rtt != null){ total += c._rtt; n++; }
    }
    return n ? Math.round(total / n) : 0;
  },

  /* PUBLIC ROOM DISCOVERY */
  async _announcePublic(code){
    const tryReg = new Peer(this.lobbyId(), this._peerOpts());
    await new Promise(res=>{
      let settled=false;
      const done=()=>{ if(!settled){settled=true; res();} };
      tryReg.on('open', ()=>{
        this._registry = tryReg;
        this._registryRooms = {};
        this._registryRooms[code] = {name:'Public', code, count:1, max:this.maxPlayers};
        this.lobbyAnnounced = true;
        tryReg.on('connection', conn=>{
          conn.on('open', ()=>{
            conn.send({t:'rooms', rooms:this._registryRooms||{}});
            conn.on('data', m=>{
              if(m.t==='register'){
                this._registryRooms = this._registryRooms||{};
                this._registryRooms[m.code]={name:m.name,code:m.code,count:m.count,max:m.max};
              }
            });
          });
          done();
        });
        tryReg.on('error', (err)=>{
          try{ tryReg.destroy(); }catch(e){}
          this._registerWithExisting(code).finally(done);
        });
      });
    });
  },

  async _registerWithExisting(code){
    const tmp = new Peer(this._peerOpts());
    await new Promise(res=>{
      let settled=false; const done=()=>{if(!settled){settled=true;res();}};
      setTimeout(done, 4000);
      tmp.on('open', ()=>{
        const conn = tmp.connect(this.lobbyId(), {reliable:true});
        conn.on('open', ()=>{ conn.send({t:'register', name:'Public', code, count:1, max:this.maxPlayers}); done(); });
        conn.on('error', done);
      });
      tmp.on('error', done);
    });
    try{ tmp.destroy(); }catch(e){}
  },

  async listPublicRooms(){
    return new Promise((resolve)=>{
      let resolved=false;
      const tmp = new Peer(this._peerOpts());
      tmp.on('open', ()=>{
        const conn = tmp.connect(this.lobbyId(), {reliable:true});
        const done = ()=>{ if(!resolved){resolved=true; resolve([]); try{tmp.destroy();}catch(e){} } };
        setTimeout(done, 4000);
        conn.on('open', ()=>{
          conn.on('data', m=>{
            if(m.t==='rooms'){ resolved=true; resolve(Object.values(m.rooms||{})); try{tmp.destroy();}catch(e){} }
          });
        });
        conn.on('error', done);
      });
      tmp.on('error', ()=>resolve([]));
    });
  },

  /* ---------- CLAN LOBBY (shared clan registry across devices) ----------
     Works like the public-room lobby: one online device hosts the clan
     lobby peer, every device with a clan registers it there, and any
     device can query the full list (search + join by code). */
  clanLobbyId(){ return CONFIG.PEER_PREFIX + 'clan-lobby'; },

  /* Try to become the clan lobby host; if the id is taken, register
     our clan with the existing lobby instead. */
  async announceClan(clan){
    if(!clan || !clan.code) return;
    const summary = {
      name: clan.name,
      code: clan.code,
      isHidden: !!clan.isHidden,
      owner: clan.owner || '',
      members: clan.members || [],
      chat: (clan.chat || []).slice(-20)
    };
    try{
      if(this._clanLobbyPeer && !this._clanLobbyPeer.destroyed){
        if(!this._clanLobbyData) this._clanLobbyData = {};
        this._clanLobbyData[clan.code] = summary;
        return;
      }
    }catch(e){}
    const tryLobby = new Peer(this.clanLobbyId(), this._peerOpts());
    await new Promise(res=>{
      let settled=false;
      const done=()=>{ if(!settled){settled=true; res();} };
      tryLobby.on('open', ()=>{
        this._clanLobbyPeer = tryLobby;
        this._clanLobbyData = {};
        this._clanLobbyData[clan.code] = summary;
        tryLobby.on('connection', conn=>{
          conn.on('open', ()=>{
            conn.send({t:'clans', clans:this._clanLobbyData||{}});
            conn.on('data', m=>{
              if(m.t==='upsert'){
                this._clanLobbyData = this._clanLobbyData||{};
                this._clanLobbyData[m.clan.code] = m.clan;
              } else if(m.t==='remove'){
                if(this._clanLobbyData) delete this._clanLobbyData[m.code];
              }
            });
          });
          done();
        });
      });
      tryLobby.on('error', err=>{
        if(err.type === 'unavailable-id'){
          // Someone else hosts the lobby: register our clan with them
          this._registerClanExisting(summary).finally(done);
        } else {
          try{ tryLobby.destroy(); }catch(e){}
          done();
        }
      });
    });
  },

  async _registerClanExisting(clan){
    const tmp = new Peer(this._peerOpts());
    await new Promise(res=>{
      let settled=false; const done=()=>{ if(!settled){settled=true;res();} };
      setTimeout(done, 4000);
      tmp.on('open', ()=>{
        const conn = tmp.connect(this.clanLobbyId(), {reliable:true});
        conn.on('open', ()=>{ conn.send({t:'upsert', clan}); done(); });
        conn.on('error', done);
      });
      tmp.on('error', done);
    });
    try{ tmp.destroy(); }catch(e){}
  },

  /* Query the shared clan lobby for all registered clans. */
  async fetchClans(){
    return new Promise(resolve=>{
      const tmp = new Peer(this._peerOpts());
      const done = ()=>{ try{ tmp.destroy(); }catch(e){} };
      const to = setTimeout(()=>{ resolve([]); done(); }, 4500);
      tmp.on('open', ()=>{
        const conn = tmp.connect(this.clanLobbyId(), {reliable:true});
        conn.on('open', ()=>{
          conn.on('data', m=>{
            if(m.t==='clans'){
              clearTimeout(to);
              resolve(Object.values(m.clans||{}));
              done();
            }
          });
        });
        conn.on('error', ()=>{ clearTimeout(to); resolve([]); done(); });
      });
      tmp.on('error', ()=>{ clearTimeout(to); resolve([]); done(); });
    });
  },

  /* Tell the lobby to remove a dissolved clan (owner left). */
  async removeClan(code){
    if(!code) return;
    try{
      if(this._clanLobbyPeer && !this._clanLobbyPeer.destroyed && this._clanLobbyData){
        delete this._clanLobbyData[code];
        return;
      }
    }catch(e){}
    const tmp = new Peer(this._peerOpts());
    await new Promise(res=>{
      let settled=false; const done=()=>{ if(!settled){settled=true;res();} };
      setTimeout(done, 3500);
      tmp.on('open', ()=>{
        const conn = tmp.connect(this.clanLobbyId(), {reliable:true});
        conn.on('open', ()=>{ conn.send({t:'remove', code}); done(); });
        conn.on('error', done);
      });
      tmp.on('error', done);
    });
    try{ tmp.destroy(); }catch(e){}
  },

  disconnect(){
    this._stopPingLoop();
    try{ for(const id in this.conns) this.conns[id].close(); }catch(e){}
    try{ if(this.hostConn) this.hostConn.close(); }catch(e){}
    try{ if(this.peer) this.peer.destroy(); }catch(e){}
    this.peer=null; this.role=null; this.conns={}; this.hostConn=null; this._lastPing=null;
    this._status();
  },
};