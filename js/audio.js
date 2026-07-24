const Audio = {
  _ctx: null,
  _musicNodes: {},
  _currentMusic: null,
  _currentSrc: null,
  _volume: 0.3,
  _musicVolume: 0.25,
  _muted: false,
  _clickBuffers: {},

  init(){
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e){ return; }
    this._volume = parseFloat(localStorage.getItem('audio_volume') || '0.3');
    this._musicVolume = parseFloat(localStorage.getItem('audio_musicVolume') || '0.25');
    this._muted = localStorage.getItem('audio_muted') === '1';
    this._loadClick('default', 'assets/click.mp3');
  },

  _loadClick(name, url){
    if(!this._ctx) return;
    fetch(url).then(r => r.arrayBuffer()).then(buf => {
      this._ctx.decodeAudioData(buf, (ab) => {
        this._clickBuffers[name] = ab;
      }, ()=>{});
    }).catch(()=>{});
  },

  click(name){
    if(!this._ctx || this._muted || !this._clickBuffers[name]) return;
    if(this._ctx.state === 'suspended') this._ctx.resume();
    const src = this._ctx.createBufferSource();
    src.buffer = this._clickBuffers[name];
    const g = this._ctx.createGain();
    g.gain.value = this._volume;
    src.connect(g).connect(this._ctx.destination);
    src.start(0);
  },

  playMusic(src, loop=true){
    if(!this._ctx) return;
    if(this._currentSrc === src) return;
    if(this._currentMusic){
      try { this._currentMusic.stop(); } catch(e){}
      this._currentMusic = null;
      this._currentSrc = null;
    }
    if(this._muted) return;
    fetch(src).then(r => r.arrayBuffer()).then(buf => {
      this._ctx.decodeAudioData(buf, (ab) => {
        const srcNode = this._ctx.createBufferSource();
        srcNode.buffer = ab;
        srcNode.loop = loop;
        const g = this._ctx.createGain();
        g.gain.value = this._musicVolume;
        srcNode.connect(g).connect(this._ctx.destination);
        srcNode.start(0);
        this._currentMusic = srcNode;
        this._currentSrc = src;
      }, ()=>{});
    }).catch(()=>{});
  },

  stopMusic(){
    if(this._currentMusic){
      try { this._currentMusic.stop(); } catch(e){}
      this._currentMusic = null;
      this._currentSrc = null;
    }
  },

  setVolume(v){
    this._volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('audio_volume', this._volume);
  },

  setMusicVolume(v){
    this._musicVolume = Math.max(0, Math.min(1, v));
    localStorage.setItem('audio_musicVolume', this._musicVolume);
  },

  setMuted(m){
    this._muted = m;
    localStorage.setItem('audio_muted', m ? '1' : '0');
    if(m) this.stopMusic();
  },

  toggleMute(){
    this.setMuted(!this._muted);
    return this._muted;
  },

  isMuted(){ return this._muted; },
  getVolume(){ return this._volume; },
  getMusicVolume(){ return this._musicVolume; },
};
