/* ============================================================
   auth.js â€” accounts for Mini Tank Legends.
   Register / login (username+email+password), persistent session,
   progress sync across devices, fancy animated UI overlay.
   Google login comes later (button is present, disabled).
   ============================================================ */

const AUTH_API = 'https://clan-registry-api.nojus-t.workers.dev';

const Auth = {
  token: (() => { try { return localStorage.getItem('mtl_token'); } catch(e){ return null; } })(),
  user: null,
  _saveTimer: null,

  /* ---------- API ---------- */

  async _api(path, opts){
    let res;
    try{
      res = await fetch(AUTH_API + path, opts);
    }catch(e){
      throw new Error('Cannot reach the account server. Check your internet connection.');
    }
    let data = {};
    try{ data = await res.json(); }catch(e){}
    if(!res.ok){
      throw new Error(data.error || 'Something went wrong (' + res.status + ')');
    }
    return data;
  },

  async init(){
    if(!this.token) return false;
    if(this.user) return true;
    // Offline-friendly: use the cached account until the server confirms
    try{
      const cached = localStorage.getItem('mtl_user');
      if(cached){
        this.user = JSON.parse(cached);
        this._updateUI();
      }
    }catch(e){}
    try{
      const data = await this._api('/auth/me?token=' + encodeURIComponent(this.token));
      this.user = data.user;
      try{ localStorage.setItem('mtl_user', JSON.stringify(data.user)); }catch(_){}
      this._applyRemoteProfile(data.user.profile);
      this._updateUI();
      return true;
    }catch(e){
      if(e.message && e.message.indexOf('Cannot reach') === 0 && this.user){
        return true; // offline but valid cached session
      }
      this.token = null;
      this.user = null;
      try{ localStorage.removeItem('mtl_token'); localStorage.removeItem('mtl_user'); }catch(_){}
      this._updateUI();
      return false;
    }
  },

  async login(login, password){
    const data = await this._api('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password }),
    });
    this._setSession(data.token, data.user);
    this._applyRemoteProfile(data.user.profile);
    this._updateUI();
  },

  async register(username, email, password){
    const data = await this._api('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    this._setSession(data.token, data.user);
    this._applyRemoteProfile(data.user.profile);
    this._updateUI();
  },

  async logout(){
    try{
      await this._api('/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token }),
      });
    }catch(e){}
    this.token = null;
    this.user = null;
    try{ localStorage.removeItem('mtl_token'); }catch(_){}
    this._updateUI();
  },

  _setSession(token, user){
    this.token = token;
    this.user = user;
    try{ localStorage.setItem('mtl_token', token); }catch(_){}
  },

  loggedIn(){
    return !!(this.token && this.user);
  },

  /* ---------- progress sync ---------- */

  _applyRemoteProfile(profile){
    if(!profile || !window.loadSettings) return;
    try{
      const s = window.loadSettings();
      let changed = false;
      const pCoins = typeof profile.coins === 'number' ? profile.coins : null;
      const pCash = typeof profile.cash === 'number' ? profile.cash : null;
      // New clients upload {cash, coins}; older ones only sent 'coins' (the
      // legacy cash amount). Treat a lone 'coins' as cash to keep them aligned.
      if(pCash !== null && pCash > (s.cash || 0)){
        s.cash = pCash; changed = true;
      } else if(pCash === null && pCoins !== null && pCoins > (s.cash || 0)){
        s.cash = pCoins; changed = true;
      }
      if(pCash !== null && pCoins !== null && pCoins > (s.coins || 0)){
        s.coins = pCoins; changed = true;
      }
      if(typeof profile.gems === 'number' && profile.gems > (s.gems || 0)){
        s.gems = profile.gems; changed = true;
      }
      if(typeof profile.clanWeeklyXP === 'number' && profile.clanWeeklyXP > (s.clanWeeklyXP || 0)){
        s.clanWeeklyXP = profile.clanWeeklyXP; changed = true;
      }
      if(profile.allUnlocked){ s.allUnlocked = true; changed = true; }
      if(Array.isArray(profile.unlockedTanks) && profile.unlockedTanks.length){
        const cur = new Set(s.unlockedTanks || ['coolbuddy']);
        let any = false;
        profile.unlockedTanks.forEach(t => { if(t && !cur.has(t)){ cur.add(t); any = true; } });
        if(any){ s.unlockedTanks = Array.from(cur); changed = true; }
      }
      if(profile.playerName){ s.playerName = profile.playerName; changed = true; }
      if(profile.playerClan){ s.playerClan = profile.playerClan; changed = true; }
      if(profile.selectedTank){ s.selectedTank = profile.selectedTank; changed = true; }
      if(profile.clanWeeklyRewarded){ s.clanWeeklyRewarded = true; changed = true; }
      if(changed && window.saveSettings) window.saveSettings(s);
    }catch(e){}
  },

  onSettingsSaved(s){
    if(!this.token || !this.user) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._uploadProfile(s), 2500);
  },

  async _uploadProfile(s){
    if(!this.token) return;
    const profile = {
      cash: typeof s.cash === 'number' ? s.cash : 0,
      coins: typeof s.coins === 'number' ? s.coins : 0,
      gems: typeof s.gems === 'number' ? s.gems : 0,
      unlockedTanks: s.unlockedTanks || ['coolbuddy'],
      allUnlocked: !!s.allUnlocked,
      playerName: s.playerName || '',
      playerClan: s.playerClan || '',
      selectedTank: s.selectedTank || 'coolbuddy',
      clanWeeklyXP: typeof s.clanWeeklyXP === 'number' ? s.clanWeeklyXP : 0,
      clanWeekKey: typeof s.clanWeekKey === 'number' ? s.clanWeekKey : 0,
      clanWeeklyRewarded: !!s.clanWeeklyRewarded,
    };
    try{
      await this._api('/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.token, profile }),
      });
    }catch(e){ /* offline â€” retry on next save */ }
  },

  /* ---------- UI ---------- */

  _el(id){ return document.getElementById(id); },

  open(){
    const ov = this._el('auth-overlay');
    if(!ov) return;
    ov.classList.remove('hidden');
    ov.classList.add('visible');
    document.body.classList.add('auth-open');
    const tab = this._el('auth-tab-login');
    if(tab) this._switchTab(tab.dataset.authtab || 'login');
    setTimeout(() => { const f = this._el('auth-login-login'); if(f && f.focus) f.focus(); }, 250);
  },

  close(){
    const ov = this._el('auth-overlay');
    if(!ov) return;
    ov.classList.remove('visible');
    setTimeout(() => {
      if(!ov.classList.contains('visible')) ov.classList.add('hidden');
    }, 350);
    document.body.classList.remove('auth-open');
  },

  toggle(){
    const ov = this._el('auth-overlay');
    if(ov && !ov.classList.contains('hidden')) this.close();
    else this.open();
  },

  _switchTab(name){
    const tabs = document.querySelectorAll('.auth-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.authtab === name));
    document.querySelectorAll('.auth-panel').forEach(p => {
      p.classList.toggle('active', p.id === 'auth-panel-' + name);
    });
  },

  _setBusy(btn, busy, label){
    if(!btn) return;
    if(busy){
      btn.dataset.label = btn.textContent;
      btn.classList.add('busy');
      btn.innerHTML = '<span class="auth-spin"></span>';
    }else{
      btn.classList.remove('busy');
      btn.textContent = btn.dataset.label || label;
    }
  },

  _showError(panel, msg){
    const err = this._el('auth-error-' + panel);
    if(!err) return;
    err.textContent = msg;
    err.classList.remove('hidden');
    err.classList.remove('shake');
    void err.offsetWidth;
    err.classList.add('shake');
  },

  _clearError(panel){
    const err = this._el('auth-error-' + panel);
    if(err){
      err.classList.add('hidden');
      err.textContent = '';
    }
  },

  _success(btn){
    if(btn){
      btn.classList.remove('busy');
      btn.classList.add('success');
      btn.innerHTML = '&#10003;';
    }
  },

  async _submit(panel){
    const btn = this._el(panel === 'login' ? 'auth-login-btn' : 'auth-reg-btn');
    if(btn && btn.classList.contains('busy')) return;
    this._clearError(panel);
    if(panel === 'login'){
      const login = (this._el('auth-login-login') || {}).value || '';
      const pass = (this._el('auth-login-pass') || {}).value || '';
      if(!login || !pass){ this._showError(panel, 'Enter your username/email and password'); return; }
      this._setBusy(btn, true);
      try{
        await this.login(login.trim(), pass);
        this._success(btn);
        setTimeout(() => this.close(), 450);
        this._afterLogin();
      }catch(e){
        this._setBusy(btn, false, 'Log In');
        this._showError(panel, e.message);
      }
    }else{
      const uname = (this._el('auth-reg-username') || {}).value || '';
      const email = (this._el('auth-reg-email') || {}).value || '';
      const pass = (this._el('auth-reg-pass') || {}).value || '';
      const pass2 = (this._el('auth-reg-pass2') || {}).value || '';
      if(!uname || !email || !pass || !pass2){ this._showError(panel, 'Please fill in all fields'); return; }
      if(pass !== pass2){ this._showError(panel, 'The passwords do not match'); return; }
      this._setBusy(btn, true);
      try{
        await this.register(uname.trim(), email.trim(), pass);
        this._success(btn);
        setTimeout(() => this.close(), 450);
        this._afterLogin();
      }catch(e){
        this._setBusy(btn, false, 'Create Account');
        this._showError(panel, e.message);
      }
    }
  },

  _afterLogin(){
    try{
      if(window.saveSettings) window.saveSettings(window.loadSettings());
      if(window.Menu && typeof window.Menu.refreshProfile === 'function') window.Menu.refreshProfile();
      if(window.Menu && window.Menu.toast) window.Menu.toast('Welcome, ' + (this.user ? this.user.username : '') + '!');
    }catch(e){}
  },

  _updateUI(){
    const mini = this._el('auth-mini');
    const acc = this._el('profile-account');
    const logged = this.loggedIn();
    if(mini){
      mini.textContent = logged ? 'Log Out' : 'Log In';
      mini.classList.toggle('logged-in', logged);
    }
    if(acc){
      acc.textContent = logged ? 'Account: ' + this.user.username : '';
      acc.classList.toggle('hidden', !logged);
    }
  },

  bind(){
    const ov = this._el('auth-overlay');
    if(!ov) return;
    ov.addEventListener('click', (e) => {
      if(e.target === ov) this.close();
    });
    const mini = this._el('auth-mini');
    if(mini){
      mini.addEventListener('click', async () => {
        if(this.loggedIn()){
          await this.logout();
          try{ if(window.Menu && window.Menu.toast) window.Menu.toast('Logged out'); }catch(_){}
        }else{
          this.open();
        }
      });
    }
    document.querySelectorAll('.auth-tab').forEach(t => {
      t.addEventListener('click', () => this._switchTab(t.dataset.authtab));
    });
    const lbtn = this._el('auth-login-btn');
    if(lbtn) lbtn.addEventListener('click', () => this._submit('login'));
    const rbtn = this._el('auth-reg-btn');
    if(rbtn) rbtn.addEventListener('click', () => this._submit('register'));
    const enter = (fn) => (e) => { if(e.key === 'Enter') fn(); };
    const li = this._el('auth-login-login'); if(li) li.addEventListener('keydown', enter(() => this._submit('login')));
    const lp = this._el('auth-login-pass'); if(lp) lp.addEventListener('keydown', enter(() => this._submit('login')));
    const ru = this._el('auth-reg-username'); if(ru) ru.addEventListener('keydown', enter(() => this._submit('register')));
    const re = this._el('auth-reg-email'); if(re) re.addEventListener('keydown', enter(() => this._submit('register')));
    const rp = this._el('auth-reg-pass'); if(rp) rp.addEventListener('keydown', enter(() => this._submit('register')));
    const rp2 = this._el('auth-reg-pass2'); if(rp2) rp2.addEventListener('keydown', enter(() => this._submit('register')));
    const gm = this._el('auth-google-login');
    if(gm) gm.addEventListener('click', () => { if(window.Menu && window.Menu.toast) window.Menu.toast('Google login is coming soon!'); });
    const gr = this._el('auth-google-register');
    if(gr) gr.addEventListener('click', () => { if(window.Menu && window.Menu.toast) window.Menu.toast('Google login is coming soon!'); });
    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape'){
        const ov2 = this._el('auth-overlay');
        if(ov2 && !ov2.classList.contains('hidden')) this.close();
      }
    });
    this._updateUI();
  },
};

(function boot(){
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', () => {
      Auth.bind();
      Auth.init();
    });
  }else{
    Auth.bind();
    Auth.init();
  }
})();
