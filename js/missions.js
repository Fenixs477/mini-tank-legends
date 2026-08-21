/* ============================================================
   missions.js — Missions menu (Daily / Clan / Challenges / Event)

   Four tabs (with icons before each tab name):
     📋 Daily      — 5 quests: 1 easy, 2 medium, 2 hard.
                    Harder = bigger reward (cash; hard ones also
                    give a few coins). Refresh every day at 00:00
                    local time.
     👥 Clan      — 3 quests: 1 solo (medium) + 2 that need you
                    in a platoon gladiator room with at least one
                    clan member.
     🏆 Challenges — placeholders: a daily / weekly / monthly quest
                    card with a timer, nothing else yet.
     🎉 Event     — automatically filled from any active events
                    (window.MISSION_EVENTS or fetched config).

   Progress is tracked from real matches (wins, kills, damage,
   platoon-with-clan gladiator battles) via Missions.recordX().
   State persists in localStorage (tankparty_missions).
   ============================================================ */

window.Missions = (function(){

  var LS_KEY = 'tankparty_missions';
  var DAY_MS = 24 * 60 * 60 * 1000;

  var STATE_DEFAULTS = {
    dailyDate: '',           // YYYY-MM-DD the daily set was last generated for
    daily: {},               // questId -> {progress, claimed, claimedAt}
    clanDate: '',
    clan: {},
    challengeDate: '',
    challenges: {},
  };

  function loadState(){
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if(s) return Object.assign({}, STATE_DEFAULTS, s);
    } catch(e){}
    return JSON.parse(JSON.stringify(STATE_DEFAULTS));
  }
  function saveState(){
    try { localStorage.setItem(LS_KEY, JSON.stringify(window.MISSIONS_STATE)); } catch(e){}
  }
  window.MISSIONS_STATE = loadState();

  function todayStr(d){
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function nextMidnight(){
    var d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }
  function timeLeftMs(targetMs){
    return Math.max(0, targetMs - Date.now());
  }
  function fmtTime(ms){
    ms = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(ms / 3600), m = Math.floor((ms % 3600) / 60), s = ms % 60;
    return (h > 0 ? h + 'h ' : '') + m + 'm ' + s + 's';
  }

  /* ------------------------------------------------------------
     Quest definitions
     ------------------------------------------------------------ */
  var DAILY_QUESTS = [
    { id:'d_easy_1', diff:'easy',   title:'Win a battle',            target:1,  cash:250,  coins:0 },
    { id:'d_med_1',  diff:'medium', title:'Deal 2,500 damage',       target:2500, cash:400, coins:0 },
    { id:'d_med_2',  diff:'medium', title:'Destroy 4 enemies',       target:4,  cash:400,  coins:0 },
    { id:'d_hard_1', diff:'hard',   title:'Win 3 battles',           target:3,  cash:650,  coins:8 },
    { id:'d_hard_2', diff:'hard',   title:'Deal 7,500 damage',       target:7500, cash:700, coins:12 }
  ];

  var CLAN_QUESTS = [
    { id:'c_solo_1',  mode:'solo',  title:'Win 2 solo gladiator battles', target:2, cash:450, coins:0, desc:'No other human players needed' },
    { id:'c_clan_1',  mode:'clan',  title:'Win 1 platoon battle with a clan member', target:1, cash:550, coins:6, desc:'Play gladiator in a platoon room with ≥1 clan member' },
    { id:'c_clan_2',  mode:'clan',  title:'Destroy 5 enemies with your clan (platoon gladiator)', target:5, cash:650, coins:10, desc:'Kills count while in a clan platoon battle' }
  ];

  var CHALLENGE_PLACEHOLDERS = [
    { id:'ch_daily',   period:'daily',   title:'Daily Challenge',   desc:'A daily challenge quest. Coming soon.' },
    { id:'ch_weekly',  period:'weekly',  title:'Weekly Challenge',  desc:'A weekly challenge quest. Coming soon.' },
    { id:'ch_monthly', period:'monthly', title:'Monthly Challenge', desc:'A monthly challenge quest. Coming soon.' }
  ];

  /* Events fill the Event tab. Set window.MISSION_EVENTS = [{id,title,target,
     reward,endsAt}] before opening the menu, or call Missions.setEvents().
     Empty = "No active events right now". */
  var EVENT_QUESTS = [];
  function setEvents(list){ EVENT_QUESTS = Array.isArray(list) ? list : []; }
  window.MISSION_EVENTS = window.MISSION_EVENTS || [];
  setEvents(window.MISSION_EVENTS);
  window.Missions_setEvents = setEvents;

  function diffLabel(d){
    return d === 'easy' ? 'EASY' : d === 'medium' ? 'MEDIUM' : 'HARD';
  }
  function diffColor(d){
    return d === 'easy' ? '#7bd36e' : d === 'medium' ? '#ffb12b' : '#ff5b5b';
  }

  /* ------------------------------------------------------------
     Helpers for new UI
     ------------------------------------------------------------ */
  function countUnclaimed(tab){
    var st = window.MISSIONS_STATE;
    var count = 0;
    if(tab === 'daily'){
      DAILY_QUESTS.forEach(function(q){
        var s = st.daily[q.id] || { progress: 0, claimed: false };
        if(s.progress >= q.target && !s.claimed) count++;
      });
    } else if(tab === 'clan'){
      CLAN_QUESTS.forEach(function(q){
        var s = st.clan[q.id] || { progress: 0, claimed: false };
        if(s.progress >= q.target && !s.claimed) count++;
      });
    }
    return count;
  }
  function updateMissionStats(){
    var st = window.MISSIONS_STATE;
    var completed = 0, rewards = 0;
    // Daily
    DAILY_QUESTS.forEach(function(q){
      var s = st.daily[q.id] || { progress: 0, claimed: false };
      if(s.claimed){ completed++; rewards += (q.cash || 0); }
    });
    // Clan
    CLAN_QUESTS.forEach(function(q){
      var s = st.clan[q.id] || { progress: 0, claimed: false };
      if(s.claimed){ completed++; rewards += (q.cash || 0); }
    });
    var ce = document.getElementById('ms-total-completed');
    var re = document.getElementById('ms-total-rewards');
    if(ce) animateValue(ce, completed);
    if(re) animateValue(re, rewards);
  }
  function animateValue(el, target){
    var start = parseInt(el.textContent || '0', 10);
    if(start === target) return;
    var duration = 400;
    var startTime = performance.now();
    function tick(now){
      var p = Math.min(1, (now - startTime) / duration);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(start + (target - start) * eased);
      if(p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------
     Daily refresh (midnight local)
     ------------------------------------------------------------ */
  function refreshDailyIfNeeded(){
    var st = window.MISSIONS_STATE;
    var today = todayStr();
    if(st.dailyDate === today) return;
    st.dailyDate = today;
    st.daily = {};
    DAILY_QUESTS.forEach(q => { st.daily[q.id] = { progress: 0, claimed: false, claimedAt: 0 }; });
    saveState();
  }

  function refreshClanIfNeeded(){
    var st = window.MISSIONS_STATE;
    var today = todayStr();
    if(st.clanDate === today) return;
    st.clanDate = today;
    st.clan = {};
    CLAN_QUESTS.forEach(q => { st.clan[q.id] = { progress: 0, claimed: false, claimedAt: 0 }; });
    saveState();
  }

  function refreshChallengesIfNeeded(){
    var st = window.MISSIONS_STATE;
    var today = todayStr();
    if(st.challengeDate === today) return;
    st.challengeDate = today;
    st.challenges = {};
    CHALLENGE_PLACEHOLDERS.forEach(q => { st.challenges[q.id] = { claimed: false, claimedAt: 0 }; });
    saveState();
  }

  function ensureState(){
    refreshDailyIfNeeded();
    refreshClanIfNeeded();
    refreshChallengesIfNeeded();
  }

  /* ------------------------------------------------------------
     Progress tracking (called from game.js / tank.js)
     ------------------------------------------------------------ */

  /* Context of the current battle (set at battle start via recordBattle).
     recordWin / recordKill use it to decide which clan quests count. */
  var activeBattle = { mode: '', gamemode: '', withClanMember: false };

  function recordWin(opts){
    ensureState();
    opts = opts || {};
    var ab = opts.mode !== undefined ? opts : activeBattle;
    var st = window.MISSIONS_STATE;
    // daily: win battles (easy) / win 3 battles (hard)
    var d = st.daily;
    if(d['d_easy_1']) d['d_easy_1'].progress = Math.min(DAILY_QUESTS[0].target, d['d_easy_1'].progress + 1);
    if(d['d_hard_1']) d['d_hard_1'].progress = Math.min(DAILY_QUESTS[3].target, d['d_hard_1'].progress + 1);
    // clan: solo gladiator win (singleplayer gladiator)
    var c = st.clan;
    if(ab.mode === 'sp' && ab.gamemode === 'gladiator' && c['c_solo_1']){
      c['c_solo_1'].progress = Math.min(CLAN_QUESTS[0].target, c['c_solo_1'].progress + 1);
    }
    // clan: win a platoon gladiator battle with a clan member
    var isClanPlat = (ab.mode === 'host' || ab.mode === 'client') && ab.gamemode === 'gladiator' && ab.withClanMember;
    if(isClanPlat && c['c_clan_1']){
      c['c_clan_1'].progress = Math.min(CLAN_QUESTS[1].target, c['c_clan_1'].progress + 1);
    }
    saveState();
  }

  function recordDamage(n){
    ensureState();
    var st = window.MISSIONS_STATE;
    var d = st.daily;
    if(d['d_med_1']) d['d_med_1'].progress = Math.min(DAILY_QUESTS[1].target, d['d_med_1'].progress + Math.round(n));
    if(d['d_hard_2']) d['d_hard_2'].progress = Math.min(DAILY_QUESTS[4].target, d['d_hard_2'].progress + Math.round(n));
    saveState();
  }

  function recordKill(){
    ensureState();
    var st = window.MISSIONS_STATE;
    var d = st.daily;
    if(d['d_med_2']) d['d_med_2'].progress = Math.min(DAILY_QUESTS[2].target, d['d_med_2'].progress + 1);
    // clan: kills while in a clan platoon battle
    var isClanPlat = (activeBattle.mode === 'host' || activeBattle.mode === 'client') && activeBattle.gamemode === 'gladiator' && activeBattle.withClanMember;
    var c = st.clan;
    if(isClanPlat && c['c_clan_2']){
      c['c_clan_2'].progress = Math.min(CLAN_QUESTS[2].target, c['c_clan_2'].progress + 1);
    }
    saveState();
  }

  /* Called when a battle starts (and when the client learns the mode).
     opts = { mode, gamemode, withClanMember }
     mode: 'sp' | 'host' | 'client'
     gamemode: 'gladiator' | 'deathmatch' | ...
     withClanMember: true if the room contained at least one clan member */
  function recordBattle(opts){
    ensureState();
    opts = opts || {};
    activeBattle = {
      mode: opts.mode || '',
      gamemode: opts.gamemode || '',
      withClanMember: !!opts.withClanMember
    };
  }

  /* ------------------------------------------------------------
     Claiming rewards
     ------------------------------------------------------------ */
  function claimDaily(id){
    ensureState();
    var st = window.MISSIONS_STATE;
    var q = DAILY_QUESTS.find(function(x){ return x.id === id; });
    if(!q) return false;
    var s = st.daily[id];
    if(!s || s.claimed || s.progress < q.target) return false;
    s.claimed = true;
    s.claimedAt = Date.now();
    grantReward(q.cash, q.coins);
    saveState();
    return true;
  }

  function claimClan(id){
    ensureState();
    var st = window.MISSIONS_STATE;
    var q = CLAN_QUESTS.find(function(x){ return x.id === id; });
    if(!q) return false;
    var s = st.clan[id];
    if(!s || s.claimed || s.progress < q.target) return false;
    s.claimed = true;
    s.claimedAt = Date.now();
    grantReward(q.cash, q.coins);
    saveState();
    return true;
  }

  function grantReward(cash, coins){
    try {
      var s = window.Menu && Menu.settings;
      if(!s) return;
      if(cash) s.cash = (s.cash || 0) + cash;
      if(coins) s.coins = (s.coins || 0) + coins;
      if(window.saveSettings) saveSettings(s);
      if(window.Menu && Menu._updateCurrencies) Menu._updateCurrencies();
      var msg = '+' + cash + ' Cash' + (coins ? ' +' + coins + ' Coins' : '');
      if(window.Menu && Menu.toast) Menu.toast('Reward claimed: ' + msg);
    } catch(e){}
  }

  /* ------------------------------------------------------------
     Rendering
     ------------------------------------------------------------ */
  function render(tab){
    ensureState();
    var wrap = document.getElementById('menu-missions');
    if(!wrap) return;
    var card = wrap.querySelector('.menu-card');
    if(!card) card = wrap;
    var cur = tab || 'daily';

    var tabHtml = [
      { k:'daily',      icon:'assets/icons/missions-daily.png',      label:'Daily',      type:'supply' },
      { k:'clan',       icon:'assets/icons/missions-clan.png',       label:'Clan',       type:'platoon' },
      { k:'challenges', icon:'assets/icons/missions-challenge.png',  label:'Challenges', type:'special' },
      { k:'event',      icon:'assets/icons/missions-event.png',      label:'Event',      type:'event' }
    ].map(function(t){
      return '<div class="ms-tab" data-ms-tab="' + t.k + '" data-type="' + t.type + '" tabindex="0" role="button" aria-label="' + t.label + ' missions">' +
        '<img class="ms-tab-icon" src="' + t.icon + '" alt="">' +
        '<span class="ms-tab-label">' + t.label + '</span>' +
        '<span class="ms-tab-badge" data-count="' + (countUnclaimed(t.k) || 0) + '"></span>' +
        '<span class="ms-tab-ripple"></span>' +
      '</div>';
    }).join('');

    card.innerHTML =
      '<div class="ms-briefing">' +
        '<div class="ms-header-bar">' +
          '<div class="ms-title-block">' +
            '<div class="ms-classification">CLASSIFIED // TACTICAL INTEL</div>' +
            '<h2 class="ms-main-title"><span class="ms-title-icon">📋</span>MISSION BOARD</h2>' +
            '<div class="ms-subtitle">Select operation category from the left panel</div>' +
          '</div>' +
          '<div class="ms-stats-panel">' +
            '<div class="ms-stat"><span class="ms-stat-val" id="ms-total-completed">0</span><span class="ms-stat-label">COMPLETED</span></div>' +
            '<div class="ms-stat-divider"></div>' +
            '<div class="ms-stat"><span class="ms-stat-val" id="ms-total-rewards">0</span><span class="ms-stat-label">REWARDS</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="ms-content-grid">' +
          '<aside class="ms-sidebar">' + tabHtml + '</aside>' +
          '<main class="ms-main" tabindex="0">' + renderTabBody(cur) + '</main>' +
        '</div>' +
        '<div class="ms-footer-bar">' +
          '<div class="ms-back-btn" data-back="menu-main" tabindex="0" role="button" aria-label="Return to HQ">' +
            '<span class="ms-back-icon">←</span> RETURN TO HQ' +
          '</div>' +
        '</div>' +
      '</div>';

    // Mount WebGL background
    if(window.MissionsBG) window.MissionsBG.mount(card.querySelector('.ms-briefing'));

    // Staggered entrance animation
    requestAnimationFrame(function(){
      var briefing = card.querySelector('.ms-briefing');
      if(briefing) briefing.classList.add('ms-visible');
      card.querySelectorAll('.ms-tab').forEach(function(el, i){
        el.style.transitionDelay = (i * 60) + 'ms';
        el.classList.add('ms-tab-in');
      });
      // Animate mission cards
      card.querySelectorAll('.ms-mission-card').forEach(function(el, i){
        el.style.transitionDelay = (i * 80) + 'ms';
        el.classList.add('ms-card-in');
      });
    });

    // Tab click/keyboard handlers
    card.querySelectorAll('[data-ms-tab]').forEach(function(el){
      var handler = function(){ 
        if(el.classList.contains('active')) return;
        playUISound('tab');
        render(el.dataset.msTab); 
      };
      el.onclick = handler;
      el.onkeydown = function(e){
        if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
      };
    });
    var back = card.querySelector('[data-back]');
    if(back && window.Menu && Menu.show) {
      back.onclick = function(){ playUISound('back'); Menu.show('menu-main'); };
      back.onkeydown = function(e){
        if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playUISound('back'); Menu.show('menu-main'); }
      };
    }
    
    updateMissionStats();
    
    // Focus first tab for keyboard nav
    var firstTab = card.querySelector('[data-ms-tab]');
    if(firstTab) firstTab.focus();
  }

  function playUISound(type){
    if(!window.Audio || !Audio.click) return;
    var sounds = {
      tab: 'ui',
      back: 'ui',
      claim: 'cash',
      hover: 'ui'
    };
    var s = sounds[type] || 'ui';
    if(Audio.click) Audio.click(s, 0.3);
  }

  function renderTabBody(tab){
    if(tab === 'daily') return renderDaily();
    if(tab === 'clan') return renderClan();
    if(tab === 'challenges') return renderChallenges();
    if(tab === 'event') return renderEvent();
    return '';
  }

  function rewardBadge(cash, coins){
    var b = '';
    if(cash) b += '<span class="ms-reward ms-reward-cash"><img class="ms-reward-icon" src="assets/currency/cash.png" alt="">' + cash.toLocaleString() + '</span>';
    if(coins) b += '<span class="ms-reward ms-reward-coins"><img class="ms-reward-icon" src="assets/currency/coin.png" alt="">' + coins + '</span>';
    return b || '<span class="ms-reward ms-reward-none">—</span>';
  }

  function progressBar(p, target){
    var pct = target ? Math.min(100, Math.round(p / target * 100)) : 0;
    return '<div class="ms-progress-wrap" data-pct="' + pct + '">' +
           '<div class="ms-progress-bar">' +
             '<div class="ms-progress-fill" style="width:' + pct + '%"></div>' +
             '<div class="ms-progress-glint"></div>' +
           '</div>' +
           '<div class="ms-progress-text">' + p.toLocaleString() + ' / ' + target.toLocaleString() + '</div>' +
           '</div>';
  }

  function renderDaily(){
    var st = window.MISSIONS_STATE;
    var html = '<div class="ms-section-header">' +
      '<div class="ms-section-title"><span class="ms-section-icon">📋</span>DAILY OPERATIONS</div>' +
      '<div class="ms-section-timer" id="ms-daily-timer">Resets in ' + fmtTime(timeLeftMs(nextMidnight())) + '</div>' +
      '</div>' +
      '<div class="ms-intel-summary">' +
        '<span class="ms-intel-chip easy"><span class="ms-chip-dot"></span>1 EASY</span>' +
        '<span class="ms-intel-chip medium"><span class="ms-chip-dot"></span>2 MEDIUM</span>' +
        '<span class="ms-intel-chip hard"><span class="ms-chip-dot"></span>2 HARD</span>' +
      '</div>';
    DAILY_QUESTS.forEach(function(q, i){
      var s = st.daily[q.id] || { progress: 0, claimed: false };
      var done = s.progress >= q.target;
      var claimed = s.claimed;
      var pct = q.target ? Math.min(100, Math.round(s.progress / q.target * 100)) : 0;
      html += '<div class="ms-mission-card' + (claimed ? ' completed' : '') + (done && !claimed ? ' ready' : '') + '" data-ms-claim="' + q.id + '" style="--delay:' + (i * 80) + 'ms">' +
        '<div class="ms-mission-header">' +
          '<span class="ms-mission-type" style="background:' + diffColor(q.diff) + '">' + diffLabel(q.diff) + '</span>' +
          '<span class="ms-mission-id">OP-' + (i+1).toString().padStart(2,'0') + '</span>' +
        '</div>' +
        '<div class="ms-mission-body">' +
          '<h3 class="ms-mission-title">' + q.title + '</h3>' +
          '<div class="ms-mission-progress">' + progressBar(s.progress, q.target) + '</div>' +
          '<div class="ms-mission-rewards">' + rewardBadge(q.cash, q.coins) + '</div>' +
        '</div>' +
        '<div class="ms-mission-action">' +
          '<button class="ms-btn' + (done && !claimed ? ' primary' : '') + (claimed ? ' claimed' : '') + '"' + 
            (done && !claimed ? '' : ' disabled') + '>' +
            (claimed ? '<span class="ms-btn-check">✓</span> MISSION COMPLETE' : (done ? 'CLAIM REWARDS' : 'IN PROGRESS')) +
          '</button>' +
        '</div>' +
      '</div>';
    });
    html += '<div class="ms-intel-note">Intel refreshes at 00:00 hours. Higher threat levels yield greater rewards.</div>';
    wireClaims(html, 'daily');
    startTimer('ms-daily-timer', nextMidnight(), function(){ render('daily'); });
    return html;
  }

  function renderClan(){
    var st = window.MISSIONS_STATE;
    var html = '<div class="ms-section-header">' +
      '<div class="ms-section-title"><span class="ms-section-icon">👥</span>CLAN OPERATIONS</div>' +
      '<div class="ms-section-timer" id="ms-clan-timer">Resets in ' + fmtTime(timeLeftMs(nextMidnight())) + '</div>' +
      '</div>' +
      '<div class="ms-intel-summary">' +
        '<span class="ms-intel-chip solo"><span class="ms-chip-dot"></span>1 SOLO</span>' +
        '<span class="ms-intel-chip clan"><span class="ms-chip-dot"></span>2 PLATOON</span>' +
      '</div>';
    CLAN_QUESTS.forEach(function(q, i){
      var s = st.clan[q.id] || { progress: 0, claimed: false };
      var done = s.progress >= q.target;
      var claimed = s.claimed;
      var typeClass = q.mode === 'solo' ? 'solo' : 'clan';
      var typeLabel = q.mode === 'solo' ? 'SOLO' : 'PLATOON';
      var typeColor = q.mode === 'solo' ? '#7bd36e' : '#ffb12b';
      html += '<div class="ms-mission-card' + (claimed ? ' completed' : '') + (done && !claimed ? ' ready' : '') + '" data-ms-claim="' + q.id + '" style="--delay:' + (i * 80) + 'ms">' +
        '<div class="ms-mission-header">' +
          '<span class="ms-mission-type" style="background:' + typeColor + '">' + typeLabel + '</span>' +
          '<span class="ms-mission-id">CL-' + (i+1).toString().padStart(2,'0') + '</span>' +
        '</div>' +
        '<div class="ms-mission-body">' +
          '<h3 class="ms-mission-title">' + q.title + '</h3>' +
          '<p class="ms-mission-brief">' + (q.desc || '') + '</p>' +
          '<div class="ms-mission-progress">' + progressBar(s.progress, q.target) + '</div>' +
          '<div class="ms-mission-rewards">' + rewardBadge(q.cash, q.coins) + '</div>' +
        '</div>' +
        '<div class="ms-mission-action">' +
          '<button class="ms-btn' + (done && !claimed ? ' primary' : '') + (claimed ? ' claimed' : '') + '"' + 
            (done && !claimed ? '' : ' disabled') + '>' +
            (claimed ? '<span class="ms-btn-check">✓</span> MISSION COMPLETE' : (done ? 'CLAIM REWARDS' : 'IN PROGRESS')) +
          '</button>' +
        '</div>' +
      '</div>';
    });
    html += '<div class="ms-intel-note">Solo ops count in any engagement. Platoon ops require Gladiator mode with ≥1 clan member in your fireteam.</div>';
    wireClaims(html, 'clan');
    startTimer('ms-clan-timer', nextMidnight(), function(){ render('clan'); });
    return html;
  }

  function renderChallenges(){
    var html = '<div class="ms-section-header">' +
      '<div class="ms-section-title"><span class="ms-section-icon">🏆</span>SPECIAL CHALLENGES</div>' +
      '<div class="ms-section-timer">CLASSIFIED</div>' +
      '</div>' +
      '<div class="ms-intel-note">High-value targets under analysis. Awaiting deployment authorization.</div>';
    var periods = { daily: { ms: DAY_MS, label:'resets daily' }, weekly: { ms: 7 * DAY_MS, label:'resets weekly' }, monthly: { ms: 30 * DAY_MS, label:'resets monthly' } };
    CHALLENGE_PLACEHOLDERS.forEach(function(q, i){
      var p = periods[q.period] || { ms: DAY_MS, label:'resets daily' };
      html += '<div class="ms-mission-card locked" style="--delay:' + (i * 80) + 'ms">' +
        '<div class="ms-mission-header">' +
          '<span class="ms-mission-type classified">' + q.period.toUpperCase() + '</span>' +
          '<span class="ms-mission-id">CH-' + (i+1).toString().padStart(2,'0') + '</span>' +
        '</div>' +
        '<div class="ms-mission-body">' +
          '<h3 class="ms-mission-title">' + q.title + '</h3>' +
          '<p class="ms-mission-brief">' + q.desc + '</p>' +
          '<div class="ms-mission-progress"><div class="ms-progress-wrap locked"><div class="ms-progress-bar"><div class="ms-progress-fill" style="width:0%"></div></div><div class="ms-progress-text">AWAITING INTEL</div></div></div>' +
          '<div class="ms-mission-rewards"><span class="ms-reward ms-reward-classified">[REDACTED]</span></div>' +
        '</div>' +
        '<div class="ms-mission-action">' +
          '<button class="ms-btn locked" disabled>ACCESS DENIED</button>' +
        '</div>' +
      '</div>';
    });
    html += '<div class="ms-intel-note">Challenge protocols are being finalized by High Command. Check back soon.</div>';
    return html;
  }

  function renderEvent(){
    var html = '<div class="ms-section-header">' +
      '<div class="ms-section-title"><span class="ms-section-icon">🎉</span>ACTIVE EVENTS</div>' +
      '<div class="ms-section-timer">LIMITED TIME</div>' +
      '</div>';
    if(!EVENT_QUESTS.length){
      html += '<div class="ms-event-empty">' +
        '<div class="ms-event-icon">📡</div>' +
        '<h3>NO ACTIVE EVENTS</h3>' +
        '<p class="ms-intel-note">Event operations will appear here automatically when High Command deploys them.</p>' +
      '</div>';
      return html;
    }
    EVENT_QUESTS.forEach(function(q, i){
      var endsIn = q.endsAt ? fmtTime(timeLeftMs(q.endsAt)) : 'event end';
      html += '<div class="ms-mission-card event" style="--delay:' + (i * 80) + 'ms">' +
        '<div class="ms-mission-header">' +
          '<span class="ms-mission-type event">EVENT</span>' +
          '<span class="ms-mission-id">EV-' + (i+1).toString().padStart(2,'0') + '</span>' +
        '</div>' +
        '<div class="ms-mission-body">' +
          '<h3 class="ms-mission-title">' + q.title + '</h3>' +
          '<div class="ms-mission-progress">' + progressBar(q.progress || 0, q.target || 1) + '</div>' +
          '<div class="ms-mission-rewards">' + rewardBadge(q.cash || 0, q.coins || 0) + '</div>' +
          '<p class="ms-mission-brief">Time remaining: ' + endsIn + '</p>' +
        '</div>' +
        '<div class="ms-mission-action">' +
          '<button class="ms-btn event" disabled>LIVE OPERATION</button>' +
        '</div>' +
      '</div>';
    });
    return html;
  }

  /* Wire claim buttons. html is the just-built body string; we re-parse by
     replacing placeholders with data attributes and binding clicks. */
  function wireClaims(bodyHtml, tab){
    var card = document.querySelector('#menu-missions .menu-card');
    if(!card) return;
    card.querySelectorAll('[data-ms-claim]').forEach(function(missionCard){
      var btn = missionCard.querySelector('.ms-btn.primary');
      if(!btn) return;
      btn.onclick = function(e){
        e.stopPropagation();
        var id = missionCard.dataset.msClaim;
        var ok = tab === 'clan' ? claimClan(id) : claimDaily(id);
        if(ok){
          playUISound('claim');
          animateClaim(missionCard, id, tab);
        } else if(window.Menu && Menu.toast){
          Menu.toast('Not ready yet — complete the quest first');
          playUISound('hover');
        }
      };
      // Keyboard support
      btn.onkeydown = function(e){
        if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
      };
    });
  }

  function animateClaim(card, questId, tab){
    // Add claiming animation class
    card.classList.add('claiming');
    card.style.pointerEvents = 'none';
    
    // Find the button and progress bar
    var btn = card.querySelector('.ms-btn');
    var progressFill = card.querySelector('.ms-progress-fill');
    
    // Button morph to checkmark
    if(btn){
      btn.innerHTML = '<span class="ms-btn-check">✓</span> MISSION COMPLETE';
      btn.classList.add('claimed');
      btn.classList.remove('primary');
      btn.disabled = true;
    }
    
    // Progress bar celebration
    if(progressFill){
      progressFill.style.animation = 'ms-progress-celebrate 0.6s ease-out';
      progressFill.style.background = 'linear-gradient(90deg, #7bd36e, #a8e67a, #7bd36e)';
      progressFill.style.backgroundSize = '200% 100%';
    }
    
    // Reward flyout animation
    var rewards = card.querySelector('.ms-mission-rewards');
    if(rewards){
      var flyout = document.createElement('div');
      flyout.className = 'ms-reward-flyout';
      flyout.innerHTML = rewards.innerHTML;
      card.appendChild(flyout);
      
      requestAnimationFrame(function(){
        flyout.classList.add('flyout-visible');
      });
      
      setTimeout(function(){
        flyout.classList.remove('flyout-visible');
        setTimeout(function(){ flyout.remove(); }, 400);
      }, 1200);
    }
    
    // Trigger WebGL burst if available
    if(window.MissionsBG && window.MissionsBG.triggerClaimBurst){
      var rect = card.getBoundingClientRect();
      var container = document.querySelector('.ms-briefing');
      var cRect = container.getBoundingClientRect();
      var x = (rect.left + rect.width/2 - cRect.left) / cRect.width;
      var y = (rect.top + rect.height/2 - cRect.top) / cRect.height;
      window.MissionsBG.triggerClaimBurst(x, y, [1.0, 0.69, 0.17]);
    }
    
    // Update stats after animation
    setTimeout(function(){
      card.classList.remove('claiming');
      card.classList.add('completed');
      updateMissionStats();
      
      // Re-render after a moment to show completed state
      setTimeout(function(){ render(tab); }, 800);
    }, 600);
  }

  var _timers = [];
  function startTimer(id, targetMs, onDone){
    var el = document.getElementById(id);
    if(!el) return;
    clearInterval(el._t);
    var tick = function(){
      var left = timeLeftMs(targetMs);
      if(left <= 0){ el.textContent = 'Resets now'; clearInterval(el._t); if(onDone) onDone(); return; }
      el.textContent = 'Resets in ' + fmtTime(left);
    };
    tick();
    el._t = setInterval(tick, 1000);
  }

  function clearTimers(){
    document.querySelectorAll('.ms-timer').forEach(function(el){ clearInterval(el._t); el._t = null; });
  }

  return {
    render: render,
    setEvents: setEvents,
    recordWin: recordWin,
    recordDamage: recordDamage,
    recordKill: recordKill,
    recordBattle: recordBattle,
    getState: function(){ ensureState(); return window.MISSIONS_STATE; },
    resetAll: function(){
      window.MISSIONS_STATE = JSON.parse(JSON.stringify(STATE_DEFAULTS));
      saveState();
      ensureState();
    }
  };
})();