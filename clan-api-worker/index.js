/* Clan Registry API + Account Auth — always-on backend for Mini Tank Legends.
   Clans:
   GET  /clans          -> JSON array of all clans
   POST /clans          -> upsert one clan {name, code, isHidden, owner, members, chat, chatSeq}
   GET  /clans?code=X   -> find one clan by code
   DELETE /clans?code=X -> remove a clan (owner left / dissolved)
   Auth:
   POST /auth/register  -> {username, email, password}  -> {token, user}
   POST /auth/login     -> {login, password} (login = username OR email) -> {token, user}
   GET  /auth/me        -> ?token= | Authorization: Bearer -> {user}
   POST /auth/logout    -> {token} -> {ok}
   PUT  /auth/profile   -> {token, profile} -> {user} (merges progress: max/union)
*/
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (data, status) => new Response(JSON.stringify(data), {
  status: status || 200,
  headers: { 'Content-Type': 'application/json', ...CORS },
});

const SESSION_TTL = 31536000; // 1 year
const PBKDF2_ITER = 100000;

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(s) {
  const a = [];
  for (let i = 0; i < s.length; i += 2) a.push(parseInt(s.substr(i, 2), 16));
  return new Uint8Array(a);
}
async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex).buffer, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    key, 256);
  return toHex(bits);
}
async function makeToken() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return toHex(buf);
}
async function createSession(env, username) {
  const token = await makeToken();
  await env.CLAN_KV.put('session:' + token, username.toLowerCase(), { expirationTtl: SESSION_TTL });
  return token;
}
function getToken(request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('token');
  if (q) return q;
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}
function publicUser(u) {
  return {
    username: u.name,
    email: u.email,
    createdAt: u.createdAt,
    google: !!u.googleId,
    profile: u.profile || {},
  };
}
function mergeProfile(old, incoming) {
  const out = {};
  const num = (k) => {
    const o = typeof old[k] === 'number' ? old[k] : 0;
    const i = typeof incoming[k] === 'number' ? incoming[k] : 0;
    return Math.max(o, i);
  };
  out.coins = num('coins');
  out.gems = num('gems');
  out.clanWeeklyXP = num('clanWeeklyXP');
  out.clanWeekKey = num('clanWeekKey');
  out.allUnlocked = !!(old.allUnlocked || incoming.allUnlocked);
  out.clanWeeklyRewarded = !!(old.clanWeeklyRewarded || incoming.clanWeeklyRewarded);
  const tanks = new Set();
  (old.unlockedTanks || []).forEach(t => tanks.add(t));
  (incoming.unlockedTanks || []).forEach(t => tanks.add(t));
  out.unlockedTanks = Array.from(tanks);
  for (const k of ['playerName', 'playerClan', 'selectedTank']) {
    if (k in incoming) out[k] = incoming[k];
    else if (k in old) out[k] = old[k];
  }
  return out;
}

async function handleRegister(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const username = (b.username || '').trim();
  const email = (b.email || '').trim().toLowerCase();
  const password = b.password || '';
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(username)) {
    return json({ error: 'Username must be 3-20 characters (letters, numbers, _ or -)' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
    return json({ error: 'That email address does not look valid' }, 400);
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 100) {
    return json({ error: 'Password must be at least 6 characters' }, 400);
  }
  const uk = 'user:' + username.toLowerCase();
  const ek = 'email:' + email;
  if (await env.CLAN_KV.get(uk)) return json({ error: 'That username is already taken' }, 409);
  if (await env.CLAN_KV.get(ek)) return json({ error: 'That email is already registered' }, 409);
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPassword(password, salt);
  const user = { name: username, email, salt, hash, createdAt: Date.now(), profile: {} };
  await env.CLAN_KV.put(uk, JSON.stringify(user));
  await env.CLAN_KV.put(ek, username.toLowerCase());
  const token = await createSession(env, username);
  return json({ token, user: publicUser(user) });
}

async function handleLogin(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const login = (b.login || '').trim();
  const password = b.password || '';
  if (!login || !password) return json({ error: 'Enter your username/email and password' }, 400);
  let uname = login.toLowerCase();
  if (login.includes('@')) {
    const idx = await env.CLAN_KV.get('email:' + uname);
    if (!idx) return json({ error: 'No account found for that email' }, 404);
    uname = idx;
  }
  const user = await env.CLAN_KV.get('user:' + uname, 'json');
  if (!user) return json({ error: 'No account found for that username' }, 404);
  const hash = await hashPassword(password, user.salt);
  if (hash !== user.hash) return json({ error: 'Wrong password' }, 401);
  const token = await createSession(env, user.name);
  return json({ token, user: publicUser(user) });
}

async function handleMe(request, env) {
  const token = getToken(request);
  if (!token) return json({ error: 'missing token' }, 401);
  const uname = await env.CLAN_KV.get('session:' + token);
  if (!uname) return json({ error: 'invalid session' }, 401);
  const user = await env.CLAN_KV.get('user:' + uname, 'json');
  if (!user) return json({ error: 'user not found' }, 404);
  return json({ user: publicUser(user) });
}

async function handleLogout(request, env) {
  let token = getToken(request);
  if (!token) {
    try {
      const b = await request.json();
      if (b && b.token) token = b.token;
    } catch (e) {}
  }
  if (token) await env.CLAN_KV.delete('session:' + token);
  return json({ ok: true });
}

async function handleProfilePut(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const token = b.token || getToken(request);
  if (!token) return json({ error: 'missing token' }, 401);
  const uname = await env.CLAN_KV.get('session:' + token);
  if (!uname) return json({ error: 'invalid session' }, 401);
  const user = await env.CLAN_KV.get('user:' + uname, 'json');
  if (!user) return json({ error: 'user not found' }, 404);
  user.profile = mergeProfile(user.profile || {}, b.profile || {});
  await env.CLAN_KV.put('user:' + uname, JSON.stringify(user));
  return json({ user: publicUser(user) });
}

/* Clan weekly-XP ledger: every member posts their gains; the clan total decides
   the end-of-week box that EVERY member can claim once. */
async function handleClanXpPost(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const token = b.token || getToken(request);
  if (!token) return json({ error: 'missing token' }, 401);
  const uname = await env.CLAN_KV.get('session:' + token);
  if (!uname) return json({ error: 'invalid session' }, 401);
  const code = String(b.code || '').toUpperCase();
  const week = String(b.week || '');
  const add = Math.floor(Number(b.add) || 0);
  if (!/^[A-Z0-9-]{3,16}$/.test(code)) return json({ error: 'bad code' }, 400);
  if (!/^\d+$/.test(week)) return json({ error: 'bad week' }, 400);
  if (add < 0 || add > 100000) return json({ error: 'bad add' }, 400);
  const key = 'clanxp:' + code + ':' + week;
  const rec = (await env.CLAN_KV.get(key, 'json')) || { code, week, total: 0, members: {} };
  rec.total += add;
  rec.members[uname] = (rec.members[uname] || 0) + add;
  await env.CLAN_KV.put(key, JSON.stringify(rec), { expirationTtl: 15552000 });
  return json({ ok: true, total: rec.total });
}

async function handleClanXpGet(request, env) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').toUpperCase();
  const week = String(url.searchParams.get('week') || '');
  if (!/^[A-Z0-9-]{3,16}$/.test(code) || !/^\d+$/.test(week)) return json({ error: 'bad params' }, 400);
  const rec = await env.CLAN_KV.get('clanxp:' + code + ':' + week, 'json');
  if (!rec) return json({ ok: false, code, week, total: 0 });
  return json({ ok: true, code: rec.code, week: rec.week, total: rec.total });
}

async function handleClanXpClaim(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const token = b.token || getToken(request);
  if (!token) return json({ error: 'missing token' }, 401);
  const uname = await env.CLAN_KV.get('session:' + token);
  if (!uname) return json({ error: 'invalid session' }, 401);
  const code = String(b.code || '').toUpperCase();
  const week = String(b.week || '');
  if (!/^[A-Z0-9-]{3,16}$/.test(code) || !/^\d+$/.test(week)) return json({ error: 'bad params' }, 400);
  const key = 'clanxpclaim:' + code + ':' + week + ':' + uname;
  if (await env.CLAN_KV.get(key)) return json({ claimed: false });
  await env.CLAN_KV.put(key, '1', { expirationTtl: 15552000 });
  return json({ claimed: true });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);

    if (url.pathname.startsWith('/auth/')) {
      const p = url.pathname.replace('/auth', '') || '/';
      if (p === '/register' && request.method === 'POST') return handleRegister(request, env);
      if (p === '/login' && request.method === 'POST') return handleLogin(request, env);
      if (p === '/me' && request.method === 'GET') return handleMe(request, env);
      if (p === '/logout' && request.method === 'POST') return handleLogout(request, env);
      if (p === '/profile' && request.method === 'PUT') return handleProfilePut(request, env);
      return json({ error: 'method not allowed' }, 405);
    }

    if (url.pathname === '/clanxp' && request.method === 'POST') return handleClanXpPost(request, env);
    if (url.pathname === '/clanxp' && request.method === 'GET') return handleClanXpGet(request, env);
    if (url.pathname === '/clanxp/claim' && request.method === 'POST') return handleClanXpClaim(request, env);

    if (request.method === 'GET') {
      const code = url.searchParams.get('code');
      if (code) {
        const clan = await env.CLAN_KV.get('clan:' + code.toUpperCase(), 'json');
        if (!clan) return json({ error: 'not found' }, 404);
        return json(clan);
      }
      const list = await env.CLAN_KV.list({ prefix: 'clan:' });
      const clans = [];
      for (const key of list.keys) {
        const clan = await env.CLAN_KV.get(key.name, 'json');
        if (clan) clans.push(clan);
      }
      return json(clans);
    }

    if (request.method === 'POST') {
      let clan;
      try {
        clan = await request.json();
      } catch (e) {
        return json({ error: 'bad json' }, 400);
      }
      if (!clan || !clan.code) return json({ error: 'missing code' }, 400);
      const code = clan.code.toUpperCase();
      clan.code = code;
      clan.members = clan.members || [];
      clan.chat = clan.chat || [];
      clan.chatSeq = typeof clan.chatSeq === 'number' ? clan.chatSeq : 0;
      const stored = await env.CLAN_KV.get('clan:' + code, 'json');
      const merged = stored
        ? {
            ...stored,
            ...clan,
            members: mergeMembers(stored.members || [], clan.members),
            chat: mergeChat(stored.chat || [], clan.chat),
            chatSeq: Math.max(stored.chatSeq || 0, clan.chatSeq || 0),
          }
        : clan;
      await env.CLAN_KV.put('clan:' + code, JSON.stringify(merged), { expirationTtl: 15552000 });
      return json(merged);
    }

    if (request.method === 'DELETE') {
      const code = url.searchParams.get('code');
      if (code) await env.CLAN_KV.delete('clan:' + code.toUpperCase());
      return json({ ok: true });
    }

    return json({ error: 'method not allowed' }, 405);
  },
};

function mergeMembers(local, remote) {
  const map = new Map();
  local.forEach(m => { if (m && m.name) map.set(m.name, m); });
  remote.forEach(m => {
    if (!m || !m.name) return;
    const cur = map.get(m.name);
    if (!cur || (cur.rank === 'member' && m.rank === 'owner')) map.set(m.name, m);
  });
  return Array.from(map.values());
}

function mergeChat(local, remote) {
  const localIds = new Set(local.map(m => m.id).filter(x => x != null));
  const out = local.slice();
  remote.forEach(m => {
    if (m && m.id != null && !localIds.has(m.id)) out.push(m);
  });
  return out.slice(-50);
}
