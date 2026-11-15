'use strict';
/*
 * Chat X backend: REST API + Server-Sent Events (realtime), SQLite storage.
 * Zero npm dependencies. Needs Node.js >= 22.13 (built-in node:sqlite).
 */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = +process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const SECURE = process.env.COOKIE_SECURE === '1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const DAY = 864e5;

fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'chatx.db'));
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, login TEXT UNIQUE NOT NULL, name TEXT NOT NULL, about TEXT DEFAULT '', avatar TEXT, pw TEXT NOT NULL, admin INTEGER DEFAULT 0, banned INTEGER DEFAULT 0, settings TEXT DEFAULT '{}', seen INTEGER DEFAULT 0, created INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user INTEGER NOT NULL, created INTEGER);
CREATE TABLE IF NOT EXISTS chats(id INTEGER PRIMARY KEY, type TEXT NOT NULL, title TEXT, dm_key TEXT UNIQUE, created INTEGER);
CREATE TABLE IF NOT EXISTS members(chat INTEGER, user INTEGER, pin INTEGER DEFAULT 0, mute INTEGER DEFAULT 0, arch INTEGER DEFAULT 0, fav INTEGER DEFAULT 0, lock INTEGER DEFAULT 0, unread INTEGER DEFAULT 0, lists TEXT DEFAULT '[]', last_read INTEGER DEFAULT 0, clear_id INTEGER DEFAULT 0, PRIMARY KEY(chat,user));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, chat INTEGER, sender INTEGER, text TEXT, audio TEXT, at INTEGER, exp INTEGER);
CREATE INDEX IF NOT EXISTS m_chat ON messages(chat,id);
CREATE TABLE IF NOT EXISTS statuses(id INTEGER PRIMARY KEY, user INTEGER, text TEXT, at INTEGER);
CREATE TABLE IF NOT EXISTS calls(id INTEGER PRIMARY KEY, caller INTEGER, callee INTEGER, video INTEGER, status TEXT, dur INTEGER, at INTEGER);
CREATE TABLE IF NOT EXISTS blocks(user INTEGER, blocked INTEGER, PRIMARY KEY(user,blocked));
CREATE TABLE IF NOT EXISTS tickets(id INTEGER PRIMARY KEY, user INTEGER, cat TEXT, text TEXT, status TEXT DEFAULT 'open', replies TEXT DEFAULT '[]', at INTEGER);
CREATE TABLE IF NOT EXISTS config(k TEXT PRIMARY KEY, v TEXT);
`);
const q = {
  get: (s, ...p) => db.prepare(s).get(...p),
  all: (s, ...p) => db.prepare(s).all(...p),
  run: (s, ...p) => db.prepare(s).run(...p),
};
const E = (code, msg) => Object.assign(new Error(msg), { code });
const now = () => Date.now();
const J = s => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const arr = s => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

// The shared Team room is one special chat without member rows.
let TEAM_ID = (q.get("SELECT id FROM chats WHERE type='team'") || {}).id;
if (!TEAM_ID) TEAM_ID = Number(q.run("INSERT INTO chats(type,title,created) VALUES('team','Team',?)", now()).lastInsertRowid);

/* ---------- helpers ---------- */
const str = (v, max, min = 0) => {
  if (typeof v !== 'string') throw E(400, 'Invalid input');
  v = v.trim();
  if (v.length < min || v.length > max) throw E(400, 'Invalid input length');
  return v;
};
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 64, (e, k) => e ? no(e) : ok(k)));
async function hashPw(pw) { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + (await scrypt(pw, s)).toString('hex'); }
async function checkPw(pw, st) {
  const [s, h] = String(st).split(':');
  const x = await scrypt(pw, Buffer.from(s, 'hex'));
  const y = Buffer.from(h, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const th = t => crypto.createHash('sha256').update(t).digest('hex');
function normLogin(v) {
  v = str(v, 80, 5).toLowerCase().replace(/[\s-]/g, '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && !/^\+?[0-9]{7,15}$/.test(v)) throw E(400, 'Enter a valid email or phone number');
  return v;
}
const me = u => ({ id: u.id, login: u.login, name: u.name, about: u.about, avatar: u.avatar, admin: !!u.admin, settings: J(u.settings) });
const isDataImg = v => typeof v === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 260000;
const isDataAudio = v => typeof v === 'string' && /^data:audio\/[a-z0-9.+-]+(;[a-z0-9=.+-]+)*;base64,[A-Za-z0-9+/=]+$/i.test(v) && v.length < 600000;

const hits = new Map();
function limited(key, max, win) {
  const n = now(), h = hits.get(key);
  if (!h || h.r < n) { hits.set(key, { c: 1, r: n + win }); return false; }
  return ++h.c > max;
}
setInterval(() => { const n = now(); for (const [k, v] of hits) if (v.r < n) hits.delete(k); }, 60000).unref();

/* ---------- realtime (Server-Sent Events) ---------- */
const clients = new Map(); // userId -> Set(res)
const online = id => clients.has(id);
function push(ids, type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const id of new Set(ids)) for (const r of clients.get(id) || []) r.write(msg);
}
const allOnline = () => [...clients.keys()];
const admins = () => q.all('SELECT id FROM users WHERE admin=1').map(r => r.id);
setInterval(() => { for (const set of clients.values()) for (const r of set) r.write(':hb\n\n'); }, 20000).unref();

/* ---------- privacy ---------- */
const contactsOf = id => new Set(q.all(
  "SELECT m2.user id FROM members m1 JOIN members m2 ON m1.chat=m2.chat AND m2.user!=m1.user JOIN chats c ON c.id=m1.chat AND c.type='dm' WHERE m1.user=?", id).map(r => r.id));
function allowed(owner, key, viewer) {
  if (owner.id === viewer) return true;
  const v = J(owner.settings)[key];
  if (v === undefined || v === 'Everyone') return true;
  return v === 'My contacts' && contactsOf(owner.id).has(viewer);
}
function pub(u, viewer) {
  return { id: u.id, name: u.name, avatar: allowed(u, 'picv', viewer) ? u.avatar : null, about: allowed(u, 'aboutv', viewer) ? u.about : '' };
}
function presence(owner, viewer) {
  const mine = J((q.get('SELECT settings FROM users WHERE id=?', viewer) || {}).settings);
  if (mine.seen === 'Nobody') return {};
  const s = J(owner.settings);
  const seenOk = allowed(owner, 'seen', viewer);
  const onlineOk = seenOk || (s.online === undefined || s.online === 'Everyone');
  return { online: onlineOk ? online(owner.id) : undefined, seen: seenOk && !online(owner.id) ? owner.seen : undefined };
}

/* ---------- chat views ---------- */
const msgOut = m => ({ id: m.id, chat: m.chat, sender: m.sender, name: m.name || 'Deleted user', text: m.text, audio: m.audio, at: m.at, exp: m.exp });
const lastMsg = (chat, clear) => q.get('SELECT msg.*,u.name FROM messages msg LEFT JOIN users u ON u.id=msg.sender WHERE msg.chat=? AND msg.id>? AND (msg.exp IS NULL OR msg.exp>?) ORDER BY msg.id DESC LIMIT 1', chat, clear, now());
function chatView(row, uid) {
  const v = {
    id: row.id, type: row.type, title: row.title, pin: !!row.pin, mute: !!row.mute, arch: !!row.arch, fav: !!row.fav,
    lock: !!row.lock, unread: row.unread, lists: arr(row.lists),
  };
  const l = lastMsg(row.id, row.clear_id);
  v.last = l ? msgOut(l) : null;
  if (row.type === 'dm') {
    const o = q.get('SELECT u.* FROM members m JOIN users u ON u.id=m.user WHERE m.chat=? AND m.user!=?', row.id, uid);
    if (o) {
      v.peer = { ...pub(o, uid), ...presence(o, uid) };
      v.title = o.name;
      v.blocked = !!q.get('SELECT 1 x FROM blocks WHERE user=? AND blocked=?', uid, o.id);
      const pr = q.get('SELECT last_read FROM members WHERE chat=? AND user=?', row.id, o.id);
      v.peerRead = pr ? pr.last_read : 0;
    }
  } else {
    v.members = q.all('SELECT u.id,u.name FROM members m JOIN users u ON u.id=m.user WHERE m.chat=?', row.id);
  }
  return v;
}
const memRow = (chat, uid) => q.get('SELECT c.*,m.pin,m.mute,m.arch,m.fav,m.lock,m.unread,m.lists,m.last_read,m.clear_id FROM members m JOIN chats c ON c.id=m.chat WHERE m.chat=? AND m.user=?', chat, uid);
const mem = (chat, uid) => q.get('SELECT * FROM members WHERE chat=? AND user=?', chat, uid);
const membersOf = chat => q.all('SELECT user FROM members WHERE chat=?', chat).map(r => r.user);
const publicCfg = () => {
  const c = J((q.get("SELECT v FROM config WHERE k='app'") || {}).v);
  return { banner: c.banner || '', welcome: c.welcome || '', closed: !!c.closed, pins: Array.isArray(c.pins) ? c.pins : [] };
};

/* ---------- routing ---------- */
const routes = [];
const R = (m, p, fn, o = {}) => routes.push({ m, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, ...o });

R('GET', '/api/ping', () => ({ ok: true }), { open: true });

/* --- accounts --- */
R('POST', '/api/register', async ({ b, res, ip }) => {
  if (limited('reg:' + ip, 10, 3600e3)) throw E(429, 'Too many sign-ups from this network. Try later.');
  const login = normLogin(b.login), name = str(b.name, 40, 1), pw = str(String(b.password || ''), 200, 6);
  if (q.get('SELECT 1 x FROM users WHERE login=?', login)) throw E(409, 'An account with this email/phone already exists');
  const first = !q.get('SELECT 1 x FROM users LIMIT 1');
  const admin = (first && !ADMIN_EMAIL) || (ADMIN_EMAIL && login === ADMIN_EMAIL) ? 1 : 0;
  const id = Number(q.run('INSERT INTO users(login,name,pw,admin,created) VALUES(?,?,?,?,?)', login, name, await hashPw(pw), admin, now()).lastInsertRowid);
  startSession(res, id);
  return me(q.get('SELECT * FROM users WHERE id=?', id));
}, { open: true });

R('POST', '/api/login', async ({ b, res, ip }) => {
  const login = normLogin(b.login);
  if (limited('login:' + ip + login, 8, 600e3)) throw E(429, 'Too many attempts. Try again in a few minutes.');
  const u = q.get('SELECT * FROM users WHERE login=?', login);
  if (!u || !(await checkPw(String(b.password || ''), u.pw))) throw E(401, 'Wrong email/phone or password');
  startSession(res, u.id);
  return me(u);
}, { open: true });

R('POST', '/api/logout', ({ req, res }) => {
  const t = cookie(req).cx;
  if (t) q.run('DELETE FROM sessions WHERE token=?', th(t));
  res.setHeader('Set-Cookie', `cx=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE ? '; Secure' : ''}`);
  return { ok: true };
}, { open: true });

R('GET', '/api/me', ({ u }) => me(u));

R('PATCH', '/api/me', ({ u, b }) => {
  const f = [], v = [];
  if (b.name !== undefined) { f.push('name=?'); v.push(str(b.name, 40, 1)); }
  if (b.about !== undefined) { f.push('about=?'); v.push(str(b.about, 140)); }
  if (b.avatar !== undefined) {
    if (b.avatar !== null && !isDataImg(b.avatar)) throw E(400, 'Photo must be a small PNG/JPEG/WebP');
    f.push('avatar=?'); v.push(b.avatar);
  }
  if (b.settings !== undefined) {
    if (typeof b.settings !== 'object' || b.settings === null || Array.isArray(b.settings)) throw E(400, 'Invalid settings');
    const s = JSON.stringify(b.settings);
    if (s.length > 60000) throw E(400, 'Settings too large');
    f.push('settings=?'); v.push(s);
  }
  if (f.length) q.run(`UPDATE users SET ${f.join(',')} WHERE id=?`, ...v, u.id);
  return me(q.get('SELECT * FROM users WHERE id=?', u.id));
});

R('POST', '/api/me/password', async ({ u, b, req }) => {
  if (!(await checkPw(String(b.old || ''), u.pw))) throw E(403, 'Current password is wrong');
  const n = str(String(b.new || ''), 200, 6);
  q.run('UPDATE users SET pw=? WHERE id=?', await hashPw(n), u.id);
  q.run('DELETE FROM sessions WHERE user=? AND token!=?', u.id, th(cookie(req).cx || ''));
  return { ok: true };
});

R('POST', '/api/me/login', async ({ u, b }) => {
  if (!(await checkPw(String(b.password || ''), u.pw))) throw E(403, 'Wrong password');
  const login = normLogin(b.login);
  if (q.get('SELECT 1 x FROM users WHERE login=? AND id!=?', login, u.id)) throw E(409, 'Already used by another account');
  q.run('UPDATE users SET login=? WHERE id=?', login, u.id);
  return me(q.get('SELECT * FROM users WHERE id=?', u.id));
});

R('DELETE', '/api/me', async ({ u, b, res }) => {
  if (!(await checkPw(String(b.password || ''), u.pw))) throw E(403, 'Wrong password');
  for (const t of ['sessions', 'members', 'statuses', 'tickets']) q.run(`DELETE FROM ${t} WHERE user=?`, u.id);
  q.run('DELETE FROM blocks WHERE user=? OR blocked=?', u.id, u.id);
  q.run('UPDATE messages SET text=NULL,audio=NULL WHERE sender=? AND chat!=?', u.id, TEAM_ID);
  q.run('DELETE FROM users WHERE id=?', u.id);
  res.setHeader('Set-Cookie', `cx=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE ? '; Secure' : ''}`);
  return { ok: true };
});

R('GET', '/api/users', ({ u, url }) => {
  const s = str(url.searchParams.get('q') || '', 60).toLowerCase();
  if (s.length < 2) return [];
  const rows = q.all('SELECT * FROM users WHERE id!=? AND (lower(name) LIKE ? OR login=?) ORDER BY name LIMIT 20', u.id, s.replace(/[%_]/g, '') + '%', s.replace(/[\s-]/g, ''));
  return rows.map(r => ({ ...pub(r, u.id), ...presence(r, u.id) }));
});

/* --- chats --- */
R('GET', '/api/chats', ({ u }) => {
  const rows = q.all("SELECT c.*,m.pin,m.mute,m.arch,m.fav,m.lock,m.unread,m.lists,m.last_read,m.clear_id FROM members m JOIN chats c ON c.id=m.chat WHERE m.user=? AND c.type!='team'", u.id);
  return rows.map(r => chatView(r, u.id)).sort((a, b) => ((b.last && b.last.id) || 0) - ((a.last && a.last.id) || 0));
});

R('POST', '/api/chats', ({ u, b }) => {
  if (b.type === 'dm') {
    const o = q.get('SELECT * FROM users WHERE id=?', +b.user);
    if (!o || o.id === u.id) throw E(400, 'Invalid user');
    const key = [u.id, o.id].sort((x, y) => x - y).join('-');
    let c = q.get('SELECT id FROM chats WHERE dm_key=?', key);
    if (!c) {
      c = { id: Number(q.run("INSERT INTO chats(type,dm_key,created) VALUES('dm',?,?)", key, now()).lastInsertRowid) };
      q.run('INSERT INTO members(chat,user) VALUES(?,?),(?,?)', c.id, u.id, c.id, o.id);
    } else {
      const clear = (q.get('SELECT MAX(id) id FROM messages WHERE chat=?', c.id) || {}).id || 0;
      for (const id of [u.id, o.id]) if (!mem(c.id, id)) q.run('INSERT INTO members(chat,user,clear_id) VALUES(?,?,?)', c.id, id, clear);
    }
    push([o.id], 'chat', {});
    return chatView(memRow(c.id, u.id), u.id);
  }
  if (b.type === 'group') {
    const title = str(b.title, 60, 1), ids = [...new Set((Array.isArray(b.members) ? b.members : []).map(Number))].filter(x => x && x !== u.id).slice(0, 255);
    const skipped = [], ok = [];
    for (const id of ids) {
      const o = q.get('SELECT * FROM users WHERE id=?', id);
      if (!o) continue;
      const g = J(o.settings).groupsv;
      if (g === 'Nobody' || (g === 'My contacts' && !contactsOf(o.id).has(u.id))) { skipped.push(o.name); continue; }
      ok.push(o.id);
    }
    const id = Number(q.run("INSERT INTO chats(type,title,created) VALUES('group',?,?)", title, now()).lastInsertRowid);
    for (const m of [u.id, ...ok]) q.run('INSERT INTO members(chat,user) VALUES(?,?)', id, m);
    push(ok, 'chat', {});
    return { ...chatView(memRow(id, u.id), u.id), skipped };
  }
  throw E(400, 'Invalid chat type');
});

R('PATCH', '/api/chats/:id', ({ u, b, params }) => {
  const m = mem(+params.id, u.id); if (!m) throw E(404, 'Chat not found');
  for (const k of ['pin', 'mute', 'arch', 'fav', 'lock']) if (b[k] !== undefined) q.run(`UPDATE members SET ${k}=? WHERE chat=? AND user=?`, b[k] ? 1 : 0, m.chat, u.id);
  if (b.unread !== undefined) q.run('UPDATE members SET unread=? WHERE chat=? AND user=?', b.unread ? Math.max(m.unread, 1) : 0, m.chat, u.id);
  if (b.lists !== undefined) {
    const l = (Array.isArray(b.lists) ? b.lists : []).slice(0, 20).map(x => String(x).slice(0, 30));
    q.run('UPDATE members SET lists=? WHERE chat=? AND user=?', JSON.stringify(l), m.chat, u.id);
  }
  return { ok: true };
});

R('DELETE', '/api/chats/:id', ({ u, params }) => {
  const m = mem(+params.id, u.id); if (!m) throw E(404, 'Chat not found');
  q.run('DELETE FROM members WHERE chat=? AND user=?', m.chat, u.id);
  if (!q.get('SELECT 1 x FROM members WHERE chat=?', m.chat)) { q.run('DELETE FROM messages WHERE chat=?', m.chat); q.run('DELETE FROM chats WHERE id=?', m.chat); }
  return { ok: true };
});

R('GET', '/api/chats/:id/messages', ({ u, params, url }) => {
  const m = mem(+params.id, u.id); if (!m) throw E(404, 'Chat not found');
  const lim = Math.min(+url.searchParams.get('limit') || 100, 200), before = +url.searchParams.get('before') || 1e15;
  const rows = q.all('SELECT msg.*,u.name FROM messages msg LEFT JOIN users u ON u.id=msg.sender WHERE msg.chat=? AND msg.id>? AND msg.id<? AND (msg.exp IS NULL OR msg.exp>?) ORDER BY msg.id DESC LIMIT ?', m.chat, m.clear_id, before, now(), lim).reverse();
  const o = q.get('SELECT last_read FROM members WHERE chat=? AND user!=? LIMIT 1', m.chat, u.id);
  return { messages: rows.map(msgOut), peerRead: o ? o.last_read : 0 };
});

const TIMERS = { '1 minute (demo)': 6e4, '24 hours': DAY, '7 days': 7 * DAY, '90 days': 90 * DAY };
R('POST', '/api/chats/:id/messages', ({ u, b, params }) => {
  if (limited('msg:' + u.id, 120, 60000)) throw E(429, 'You are sending messages too fast');
  const m = mem(+params.id, u.id); if (!m) throw E(404, 'Chat not found');
  const chat = q.get('SELECT * FROM chats WHERE id=?', m.chat);
  const text = b.text === undefined ? null : str(b.text, 4000, 1);
  const audio = b.audio === undefined ? null : b.audio;
  if (audio !== null && !isDataAudio(audio)) throw E(400, 'Invalid voice message');
  if (text === null && audio === null) throw E(400, 'Empty message');
  const others = membersOf(m.chat).filter(x => x !== u.id);
  if (chat.type === 'dm') {
    const o = others[0];
    if (o && q.get('SELECT 1 x FROM blocks WHERE (user=? AND blocked=?) OR (user=? AND blocked=?)', u.id, o, o, u.id)) throw E(403, 'You can’t message this contact');
  }
  const d = TIMERS[J(u.settings).timer], at = now();
  const id = Number(q.run('INSERT INTO messages(chat,sender,text,audio,at,exp) VALUES(?,?,?,?,?,?)', m.chat, u.id, text, audio, at, d ? at + d : null).lastInsertRowid);
  for (const o of others) q.run('UPDATE members SET unread=unread+1 WHERE chat=? AND user=?', m.chat, o);
  const out = msgOut({ id, chat: m.chat, sender: u.id, name: u.name, text, audio, at, exp: d ? at + d : null });
  push([u.id, ...others], 'message', { chat: m.chat, msg: out });
  return out;
});

R('POST', '/api/chats/:id/read', ({ u, params }) => {
  const m = mem(+params.id, u.id); if (!m) throw E(404, 'Chat not found');
  if (J(u.settings).read === false) { q.run('UPDATE members SET unread=0 WHERE chat=? AND user=?', m.chat, u.id); return { ok: true }; }
  const last = (q.get('SELECT MAX(id) id FROM messages WHERE chat=?', m.chat) || {}).id || 0;
  q.run('UPDATE members SET unread=0,last_read=? WHERE chat=? AND user=?', last, m.chat, u.id);
  push(membersOf(m.chat).filter(x => x !== u.id), 'read', { chat: m.chat, user: u.id, upto: last });
  return { ok: true };
});

R('DELETE', '/api/chats/:id/messages', ({ u, params }) => {
  const m = mem(+params.id, u.id); if (!m) throw E(404, 'Chat not found');
  const last = (q.get('SELECT MAX(id) id FROM messages WHERE chat=?', m.chat) || {}).id || 0;
  q.run('UPDATE members SET clear_id=? WHERE chat=? AND user=?', last, m.chat, u.id);
  return { ok: true };
});

/* --- blocks --- */
R('GET', '/api/blocks', ({ u }) => q.all('SELECT u.id,u.name FROM blocks b JOIN users u ON u.id=b.blocked WHERE b.user=?', u.id));
R('POST', '/api/blocks', ({ u, b }) => {
  const id = +b.user;
  if (!id || id === u.id || !q.get('SELECT 1 x FROM users WHERE id=?', id)) throw E(400, 'Invalid user');
  q.run('INSERT OR IGNORE INTO blocks(user,blocked) VALUES(?,?)', u.id, id);
  return { ok: true };
});
R('DELETE', '/api/blocks/:id', ({ u, params }) => { q.run('DELETE FROM blocks WHERE user=? AND blocked=?', u.id, +params.id); return { ok: true }; });

/* --- status --- */
R('GET', '/api/status', ({ u }) => {
  const ids = [u.id, ...contactsOf(u.id)];
  const rows = q.all(`SELECT s.*,x.name,x.avatar FROM statuses s JOIN users x ON x.id=s.user WHERE s.user IN (${ids.map(() => '?').join(',')}) AND s.at>? ORDER BY s.at DESC`, ...ids, now() - DAY);
  return rows
    .filter(r => r.user === u.id || !q.get('SELECT 1 x FROM blocks WHERE (user=? AND blocked=?) OR (user=? AND blocked=?)', u.id, r.user, r.user, u.id))
    .map(r => ({
      id: r.id, user: r.user, name: r.name, text: r.text, at: r.at, mine: r.user === u.id,
      avatar: r.user === u.id || allowed(q.get('SELECT * FROM users WHERE id=?', r.user), 'picv', u.id) ? r.avatar : null,
    }));
});
R('POST', '/api/status', ({ u, b }) => {
  if (limited('st:' + u.id, 30, 3600e3)) throw E(429, 'Too many status updates');
  const text = str(b.text, 200, 1);
  const id = Number(q.run('INSERT INTO statuses(user,text,at) VALUES(?,?,?)', u.id, text, now()).lastInsertRowid);
  push([...contactsOf(u.id)], 'status', {});
  return { id };
});
R('DELETE', '/api/status/:id', ({ u, params }) => { q.run('DELETE FROM statuses WHERE id=? AND user=?', +params.id, u.id); push([...contactsOf(u.id)], 'status', {}); return { ok: true }; });

/* --- calls: history + WebRTC signaling relay --- */
R('GET', '/api/calls', ({ u }) => q.all('SELECT c.*,a.name an,b.name bn FROM calls c JOIN users a ON a.id=c.caller JOIN users b ON b.id=c.callee WHERE c.caller=? OR c.callee=? ORDER BY c.id DESC LIMIT 50', u.id, u.id)
  .map(c => {
    const out = c.caller === u.id;
    return { id: c.id, who: out ? c.bn : c.an, peer: out ? c.callee : c.caller, type: out ? 'out' : (c.status === 'answered' ? 'in' : 'missed'), video: !!c.video, dur: c.dur || 0, at: c.at };
  }));
R('POST', '/api/calls', ({ u, b }) => {
  const peer = +b.peer;
  if (!peer || !q.get('SELECT 1 x FROM users WHERE id=?', peer)) throw E(400, 'Invalid user');
  const st = ['answered', 'missed', 'declined'].includes(b.status) ? b.status : 'missed';
  q.run('INSERT INTO calls(caller,callee,video,status,dur,at) VALUES(?,?,?,?,?,?)', u.id, peer, b.video ? 1 : 0, st, Math.min(+b.dur || 0, 86400), now());
  push([peer], 'calls', {});
  return { ok: true };
});
R('POST', '/api/signal', ({ u, b }) => {
  if (limited('sig:' + u.id, 600, 60000)) throw E(429, 'Too many signals');
  const to = +b.to, kind = String(b.kind);
  if (!['offer', 'answer', 'ice', 'end', 'decline', 'busy'].includes(kind)) throw E(400, 'Invalid signal');
  const o = q.get('SELECT * FROM users WHERE id=?', to); if (!o) throw E(404, 'User not found');
  if (!contactsOf(u.id).has(to)) throw E(403, 'You can only call people you have chatted with');
  if (q.get('SELECT 1 x FROM blocks WHERE (user=? AND blocked=?) OR (user=? AND blocked=?)', u.id, to, to, u.id)) throw E(403, 'You can’t call this contact');
  if (kind === 'offer') {
    const cv = J(o.settings).callv;
    if (cv === 'Nobody' || (cv === 'My contacts' && !contactsOf(o.id).has(u.id))) throw E(403, 'This contact doesn’t accept calls');
    if (!online(to)) throw E(404, 'offline');
  }
  push([to], 'signal', { from: { id: u.id, name: u.name }, kind, video: !!b.video, data: b.data === undefined ? null : b.data });
  return { ok: true };
});

/* --- team room + public config --- */
const teamMsgs = () => q.all('SELECT msg.*,u.name FROM messages msg LEFT JOIN users u ON u.id=msg.sender WHERE msg.chat=? ORDER BY msg.id DESC LIMIT 200', TEAM_ID)
  .reverse().map(m => ({ id: String(m.id), uid: String(m.sender), name: m.name || 'Deleted user', text: m.text, at: m.at }));
const cfgFor = u => ({ ...publicCfg(), admins: admins().map(String), bans: u.banned ? [String(u.id)] : [] });
R('GET', '/api/team', ({ u }) => ({ messages: teamMsgs(), config: cfgFor(u) }));
R('POST', '/api/team/messages', ({ u, b }) => {
  if (u.banned) throw E(403, 'You are blocked from the team room');
  if (publicCfg().closed && !u.admin) throw E(403, 'The team room is closed by the admin');
  if (limited('team:' + u.id, 20, 60000)) throw E(429, 'Slow down a little');
  const text = str(b.text, 500, 1), at = now();
  const id = Number(q.run('INSERT INTO messages(chat,sender,text,at) VALUES(?,?,?,?)', TEAM_ID, u.id, text, at).lastInsertRowid);
  push(allOnline(), 'team', { msg: { id: String(id), uid: String(u.id), name: u.name, text, at } });
  return { id };
});

/* --- tickets (private problem reports) --- */
const ticketOut = t => ({ id: String(t.id), cat: t.cat, text: t.text, at: t.at, status: t.status, replies: arr(t.replies) });
R('POST', '/api/tickets', ({ u, b }) => {
  if (limited('tk:' + u.id, 20, 3600e3)) throw E(429, 'Too many reports. Please wait a while.');
  const cat = str(b.cat, 40, 1), text = str(b.text, 1000, 1);
  const id = Number(q.run('INSERT INTO tickets(user,cat,text,at) VALUES(?,?,?,?)', u.id, cat, text, now()).lastInsertRowid);
  push([u.id, ...admins()], 'ticket', {});
  return { id: String(id) };
});
R('GET', '/api/tickets', ({ u, url }) => {
  if (u.admin && url.searchParams.get('all') === '1')
    return q.all('SELECT t.*,x.name FROM tickets t JOIN users x ON x.id=t.user ORDER BY t.id DESC LIMIT 500').map(t => ({ ...ticketOut(t), uid: String(t.user), name: t.name }));
  return q.all('SELECT * FROM tickets WHERE user=? ORDER BY id DESC LIMIT 200', u.id).map(ticketOut);
});
R('PATCH', '/api/tickets/:id', ({ b, params }) => {
  const t = q.get('SELECT * FROM tickets WHERE id=?', +params.id); if (!t) throw E(404, 'Ticket not found');
  let status = t.status;
  const reps = arr(t.replies);
  if (b.status !== undefined) { if (!['open', 'progress', 'resolved'].includes(b.status)) throw E(400, 'Invalid status'); status = b.status; }
  if (b.reply !== undefined) { reps.push({ text: str(b.reply, 1000, 1), at: now() }); if (status === 'open') status = 'progress'; }
  q.run('UPDATE tickets SET status=?,replies=? WHERE id=?', status, JSON.stringify(reps), t.id);
  push([t.user, ...admins()], 'ticket', {});
  return { ok: true };
}, { admin: true });
R('DELETE', '/api/tickets/:id', ({ params }) => {
  const t = q.get('SELECT * FROM tickets WHERE id=?', +params.id);
  if (t) { q.run('DELETE FROM tickets WHERE id=?', t.id); push([t.user, ...admins()], 'ticket', {}); }
  return { ok: true };
}, { admin: true });

/* --- admin --- */
R('POST', '/api/admin/config', ({ b }) => {
  const c = J((q.get("SELECT v FROM config WHERE k='app'") || {}).v);
  if (b.banner !== undefined) c.banner = str(b.banner, 200);
  if (b.welcome !== undefined) c.welcome = str(b.welcome, 300);
  if (b.closed !== undefined) c.closed = !!b.closed;
  if (b.pins !== undefined) c.pins = (Array.isArray(b.pins) ? b.pins : []).slice(0, 10).map(p => ({ text: str(String(p.text || ''), 300, 1), at: +p.at || now() }));
  q.run("INSERT INTO config(k,v) VALUES('app',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", JSON.stringify(c));
  push(allOnline(), 'config', {});
  return { ok: true };
}, { admin: true });
R('GET', '/api/admin/stats', () => {
  const t = s => (q.get(s) || {}).n || 0;
  return {
    users: t('SELECT COUNT(*) n FROM users'), online: clients.size, banned: t('SELECT COUNT(*) n FROM users WHERE banned=1'),
    messagesToday: t(`SELECT COUNT(*) n FROM messages WHERE at>${now() - DAY}`), teamMessages: t(`SELECT COUNT(*) n FROM messages WHERE chat=${TEAM_ID}`),
    tickets: { open: t("SELECT COUNT(*) n FROM tickets WHERE status='open'"), progress: t("SELECT COUNT(*) n FROM tickets WHERE status='progress'"), resolved: t("SELECT COUNT(*) n FROM tickets WHERE status='resolved'") },
  };
}, { admin: true });
R('GET', '/api/admin/users', () => q.all('SELECT id,login,name,admin,banned,created,seen FROM users ORDER BY id DESC LIMIT 500').map(u => ({ ...u, online: online(u.id) })), { admin: true });
R('POST', '/api/admin/users/:id/ban', ({ b, params, u }) => {
  const id = +params.id;
  if (id === u.id) throw E(400, 'You can’t block yourself');
  q.run('UPDATE users SET banned=? WHERE id=?', b.banned ? 1 : 0, id);
  push([id, ...admins()], 'config', {});
  return { ok: true };
}, { admin: true });
R('POST', '/api/admin/users/:id/admin', ({ b, params, u }) => {
  const id = +params.id;
  if (id === u.id && !b.admin && admins().length < 2) throw E(400, 'There must be at least one admin');
  q.run('UPDATE users SET admin=? WHERE id=?', b.admin ? 1 : 0, id);
  return { ok: true };
}, { admin: true });
R('DELETE', '/api/admin/messages/:id', ({ params }) => {
  q.run('DELETE FROM messages WHERE id=? AND chat=?', +params.id, TEAM_ID);
  push(allOnline(), 'team', { deleted: params.id });
  return { ok: true };
}, { admin: true });
R('POST', '/api/admin/tickets/clear-resolved', () => {
  const r = q.run("DELETE FROM tickets WHERE status='resolved'");
  push(allOnline(), 'ticket', {});
  return { removed: Number(r.changes) };
}, { admin: true });
R('GET', '/api/admin/tickets.csv', ({ res }) => {
  const rows = q.all('SELECT t.*,x.name,x.login FROM tickets t JOIN users x ON x.id=t.user ORDER BY t.id DESC');
  // Cells starting with = + - @ are prefixed with ' so spreadsheets don't run them as formulas.
  const cell = v => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
  const csv = [['Reporter', 'Contact', 'Category', 'Status', 'Created', 'Problem']]
    .concat(rows.map(t => [t.name, t.login, t.cat, t.status, new Date(t.at).toISOString(), t.text]))
    .map(r => r.map(cell).join(',')).join('\n');
  res.setHeader('Content-Disposition', 'attachment; filename="chatx-problems.csv"');
  return { __raw: csv, type: 'text/csv; charset=utf-8' };
}, { admin: true });

/* --- realtime stream --- */
function events(req, res, u) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const first = !online(u.id);
  if (!clients.has(u.id)) clients.set(u.id, new Set());
  clients.get(u.id).add(res);
  res.write(`event: ready\ndata: ${JSON.stringify({ id: u.id })}\n\n`);
  if (first) push([...contactsOf(u.id)], 'presence', { user: u.id, online: true });
  req.on('close', () => {
    const set = clients.get(u.id);
    if (!set) return;
    set.delete(res);
    if (!set.size) {
      clients.delete(u.id);
      q.run('UPDATE users SET seen=? WHERE id=?', now(), u.id);
      push([...contactsOf(u.id)], 'presence', { user: u.id, online: false, seen: now() });
    }
  });
}

/* ---------- plumbing ---------- */
const cookie = req => Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(a => a[0]).map(a => [a[0], a.slice(1).join('=')]));
function startSession(res, uid) {
  const t = crypto.randomBytes(32).toString('hex');
  q.run('INSERT INTO sessions(token,user,created) VALUES(?,?,?)', th(t), uid, now());
  res.setHeader('Set-Cookie', `cx=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${SECURE ? '; Secure' : ''}`);
}
function authUser(req) {
  const t = cookie(req).cx; if (!t) return null;
  const s = q.get('SELECT * FROM sessions WHERE token=?', th(t));
  if (!s || s.created < now() - 30 * DAY) return null;
  return q.get('SELECT * FROM users WHERE id=?', s.user) || null;
}
const clientIp = req => (TRUST_PROXY && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || '?';
function secHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((ok, no) => {
    let n = 0; const a = [];
    req.on('data', c => { n += c.length; if (n > 900000) { no(E(413, 'Request too large')); req.destroy(); return; } a.push(c); });
    req.on('end', () => { try { ok(a.length ? JSON.parse(Buffer.concat(a).toString()) : {}); } catch { no(E(400, 'Bad JSON')); } });
    req.on('error', no);
  });
}

// Only these files are ever served from /public (no path traversal possible).
const PUBLIC = path.join(__dirname, 'public');
const FILES = { '/index.html': 'text/html; charset=utf-8', '/style.css': 'text/css; charset=utf-8', '/script.js': 'text/javascript; charset=utf-8' };
function serveStatic(req, res, p) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (p === '/' || !path.extname(p)) p = '/index.html';
  const type = FILES[p];
  if (!type) return send(res, 404, 'Not found', 'text/plain');
  try {
    const body = fs.readFileSync(path.join(PUBLIC, p));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  } catch { return send(res, 500, 'File missing', 'text/plain'); }
}

async function handle(req, res) {
  secHeaders(res);
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  if (!p.startsWith('/api/')) return serveStatic(req, res, p);
  const ip = clientIp(req);
  if (limited('g:' + ip, 1500, 60000)) return send(res, 429, { error: 'Too many requests' });
  try {
    if (p === '/api/events' && req.method === 'GET') {
      const u = authUser(req); if (!u) return send(res, 401, { error: 'Please log in' });
      return events(req, res, u);
    }
    const r = routes.find(r => r.m === req.method && r.re.test(p));
    if (!r) return send(res, 404, { error: 'Not found' });
    // CSRF defence: cookies alone are not enough, state-changing calls need this header (plus SameSite=Lax).
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'chatx') return send(res, 403, { error: 'Bad request origin' });
    let u = null;
    if (!r.open) {
      u = authUser(req);
      if (!u) return send(res, 401, { error: 'Please log in' });
      if (r.admin && !u.admin) return send(res, 403, { error: 'Admins only' });
    }
    const b = req.method === 'GET' ? {} : await readBody(req);
    const out = await r.fn({ req, res, u, b, url, ip, params: p.match(r.re).groups || {} });
    if (out && out.__raw !== undefined) return send(res, 200, out.__raw, out.type);
    return send(res, 200, out === undefined ? { ok: true } : out);
  } catch (e) {
    if (e.code && typeof e.code === 'number') return send(res, e.code, { error: e.message });
    console.error(e);
    return send(res, 500, { error: 'Server error' });
  }
}

// Housekeeping: expired disappearing messages, old statuses (24h + grace) and old sessions.
setInterval(() => {
  const n = now();
  q.run('DELETE FROM messages WHERE exp IS NOT NULL AND exp<?', n);
  q.run('DELETE FROM statuses WHERE at<?', n - 2 * DAY);
  q.run('DELETE FROM sessions WHERE created<?', n - 30 * DAY);
}, 60000).unref();

const server = http.createServer(handle);
if (require.main === module) {
  server.listen(PORT, () => console.log(`Chat X running on http://localhost:${PORT}`));
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { server.close(); db.close(); process.exit(0); });
}
module.exports = { server };
