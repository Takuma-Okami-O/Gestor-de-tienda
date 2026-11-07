'use strict';
/* Gestor de Tienda — servidor: login, usuarios, multi-tienda y sincronización.
   Sin dependencias: solo Node.js 22+.  Uso:  node server/server.js            */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, uid, sha256, newPassHash, checkPass, normEmail, tx } = require('./db');

const PORT = +process.env.PORT || 3000;
const WWW = path.resolve(process.env.WWW_DIR || path.join(__dirname, '..', 'www'));
const MAX_BODY = 40 * 1024 * 1024;
const SESSION_DAYS = 60;
const COLS = new Set(['productos', 'clientes', 'facturas', 'movs', 'categorias', 'config']);
const OWNER_ONLY = new Set(['config', 'categorias']);
const PAGE = 400;

/* ---------- utilidades ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS', 'Access-Control-Max-Age': '86400' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN', 'Permissions-Policy': 'camera=(self), geolocation=(), microphone=()' };
function send(res, code, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...SEC, ...extra });
  res.end(body);
}
const fail = (res, code, msg) => send(res, code, { error: msg });
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { reject(Object.assign(new Error('Solicitud demasiado grande'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('JSON inválido'), { code: 400 })); } });
    req.on('error', reject);
  });
}
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

/* ---------- limitador de intentos de login ---------- */
const fails = new Map();
function throttled(key) { const f = fails.get(key); if (!f) return 0; if (Date.now() - f.t > 15 * 60e3) { fails.delete(key); return 0; } return f.n >= 6 ? Math.ceil((15 * 60e3 - (Date.now() - f.t)) / 60e3) : 0; }
function noteFail(key) { const f = fails.get(key); if (!f || Date.now() - f.t > 15 * 60e3) fails.set(key, { n: 1, t: Date.now() }); else f.n++; }
setInterval(() => { for (const [k, f] of fails) if (Date.now() - f.t > 15 * 60e3) fails.delete(k); }, 5 * 60e3).unref();

/* ---------- autenticación ---------- */
const qSession = db.prepare('SELECT s.token_hash, s.last, u.id uid, u.store_id sid, u.email, u.nombre, u.rol, u.active uact, st.nombre snombre, st.active sact FROM sessions s JOIN users u ON u.id=s.user_id JOIN stores st ON st.id=u.store_id WHERE s.token_hash=?');
function auth(req) {
  const h = req.headers.authorization || ''; if (!h.startsWith('Bearer ')) return null;
  const th = sha256(h.slice(7).trim()), r = qSession.get(th); if (!r || !r.uact || !r.sact) return null;
  const now = Date.now(); if (now - r.last > SESSION_DAYS * 864e5) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(th); return null; }
  if (now - r.last > 36e5) db.prepare('UPDATE sessions SET last=? WHERE token_hash=?').run(now, th);
  return { th, id: r.uid, storeId: r.sid, email: r.email, nombre: r.nombre, rol: r.rol, storeName: r.snombre };
}
const userView = a => ({ id: a.id, email: a.email, nombre: a.nombre, rol: a.rol });

/* ---------- sincronización ---------- */
function doSync(a, body) {
  const since = Math.max(0, +body.since || 0), push = Array.isArray(body.push) ? body.push : [];
  return tx(() => {
    const st = db.prepare('SELECT seq FROM stores WHERE id=?').get(a.storeId); let seq = st.seq;
    const get = db.prepare('SELECT u,seq FROM records WHERE store_id=? AND col=? AND id=?');
    const put = db.prepare('INSERT INTO records (store_id,col,id,u,del,data,seq) VALUES (?,?,?,?,?,?,?) ON CONFLICT(store_id,col,id) DO UPDATE SET u=excluded.u,del=excluded.del,data=excluded.data,seq=excluded.seq');
    const mine = new Set(), rejected = [], denied = [];
    for (const r of push) {
      if (!r || !COLS.has(r.c) || typeof r.id !== 'string' || r.id.length > 80 || !Number.isFinite(+r.u)) continue;
      if (OWNER_ONLY.has(r.c) && a.rol !== 'owner') { denied.push({ c: r.c, id: r.id }); continue; }
      const ex = get.get(a.storeId, r.c, r.id);
      if (ex && ex.u > +r.u) { rejected.push({ c: r.c, id: r.id }); continue; }
      let data = null; if (!r.d) { data = JSON.stringify(r.data ?? null); if (data.length > 6e6) continue; }
      seq++; put.run(a.storeId, r.c, r.id, +r.u, r.d ? 1 : 0, data, seq); mine.add(r.c + '|' + r.id);
    }
    if (seq !== st.seq) db.prepare('UPDATE stores SET seq=? WHERE id=?').run(seq, a.storeId);
    const rows = db.prepare('SELECT col,id,u,del,data,seq FROM records WHERE store_id=? AND seq>? ORDER BY seq LIMIT ?').all(a.storeId, since, PAGE + 1);
    const more = rows.length > PAGE; if (more) rows.pop();
    const recs = rows.filter(r => !mine.has(r.col + '|' + r.id)).map(r => ({ c: r.col, id: r.id, u: r.u, d: !!r.del, data: r.del ? null : JSON.parse(r.data) }));
    const have = new Set(recs.map(r => r.c + '|' + r.id));
    for (const j of rejected) { if (have.has(j.c + '|' + j.id)) continue; const r = db.prepare('SELECT col,id,u,del,data FROM records WHERE store_id=? AND col=? AND id=?').get(a.storeId, j.c, j.id); if (r) recs.push({ c: r.col, id: r.id, u: r.u, d: !!r.del, data: r.del ? null : JSON.parse(r.data) }); }
    // cursor: si hay más páginas, avanzar solo hasta el último seq devuelto
    const cursor = more ? rows[rows.length - 1].seq : seq;
    return { cursor, more, recs, rejected, denied, serverTime: Date.now() };
  });
}

/* ---------- rutas de la API ---------- */
async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  if (m === 'OPTIONS') { res.writeHead(204, { ...CORS, ...SEC }); return res.end(); }
  if (p === '/api/health') return send(res, 200, { ok: true, t: Date.now() });

  if (p === '/api/login' && m === 'POST') {
    const b = await readBody(req), email = normEmail(b.email), ip = ipOf(req), k1 = 'e:' + email, k2 = 'i:' + ip;
    const wait = Math.max(throttled(k1), throttled(k2));
    if (wait) return fail(res, 429, `Demasiados intentos. Espera ${wait} min e inténtalo de nuevo.`);
    const u = db.prepare('SELECT u.*, s.nombre snombre, s.active sact FROM users u JOIN stores s ON s.id=u.store_id WHERE u.email=?').get(email);
    const ok = u ? checkPass(String(b.password || ''), u.salt, u.hash) : (checkPass('x', '00'.repeat(16), '00'.repeat(64)), false);
    if (!ok || !u.active || !u.sact) { noteFail(k1); noteFail(k2); return fail(res, 401, 'Correo o contraseña incorrectos'); }
    fails.delete(k1);
    const token = crypto.randomBytes(32).toString('base64url'), now = Date.now();
    db.prepare('INSERT INTO sessions (token_hash,user_id,created,last,device) VALUES (?,?,?,?,?)').run(sha256(token), u.id, now, now, String(b.device || '').slice(0, 80));
    return send(res, 200, { token, user: { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol }, store: { id: u.store_id, nombre: u.snombre } });
  }

  const a = auth(req); if (!a) return fail(res, 401, 'Sesión no válida');
  if (p === '/api/me' && m === 'GET') return send(res, 200, { user: userView(a), store: { id: a.storeId, nombre: a.storeName } });
  if (p === '/api/logout' && m === 'POST') { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(a.th); return send(res, 200, { ok: true }); }
  if (p === '/api/sync' && m === 'POST') return send(res, 200, doSync(a, await readBody(req)));

  if (p === '/api/password' && m === 'POST') {
    const b = await readBody(req), u = db.prepare('SELECT * FROM users WHERE id=?').get(a.id);
    if (!checkPass(String(b.old || ''), u.salt, u.hash)) return fail(res, 400, 'La contraseña actual no es correcta');
    if (String(b.new || '').length < 8) return fail(res, 400, 'La nueva contraseña debe tener al menos 8 caracteres');
    const { salt, hash } = newPassHash(String(b.new));
    db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt, hash, a.id);
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(a.id, a.th);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/users') {
    if (a.rol !== 'owner') return fail(res, 403, 'Solo el dueño puede administrar usuarios');
    if (m === 'GET') return send(res, 200, { users: db.prepare('SELECT id,email,nombre,rol,active,created FROM users WHERE store_id=? ORDER BY created').all(a.storeId) });
    if (m === 'POST') {
      const b = await readBody(req), email = normEmail(b.email), nombre = String(b.nombre || '').trim(), pass = String(b.password || '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(res, 400, 'Correo no válido');
      if (!nombre) return fail(res, 400, 'Escribe el nombre'); if (pass.length < 8) return fail(res, 400, 'La contraseña debe tener al menos 8 caracteres');
      if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return fail(res, 409, 'Ese correo ya está registrado');
      const { salt, hash } = newPassHash(pass), id = uid();
      db.prepare('INSERT INTO users (id,store_id,email,nombre,rol,salt,hash,created) VALUES (?,?,?,?,?,?,?,?)').run(id, a.storeId, email, nombre, b.rol === 'owner' ? 'owner' : 'employee', salt, hash, Date.now());
      return send(res, 200, { ok: true, id });
    }
  }
  const um = p.match(/^\/api\/users\/([\w-]+)$/);
  if (um && m === 'PATCH') {
    if (a.rol !== 'owner') return fail(res, 403, 'Solo el dueño puede administrar usuarios');
    const t = db.prepare('SELECT * FROM users WHERE id=? AND store_id=?').get(um[1], a.storeId); if (!t) return fail(res, 404, 'Usuario no encontrado');
    const b = await readBody(req);
    if (b.active === false && t.id === a.id) return fail(res, 400, 'No puedes desactivar tu propia cuenta');
    if (b.rol && b.rol !== t.rol && t.id === a.id) return fail(res, 400, 'No puedes cambiar tu propio rol');
    if (b.nombre) db.prepare('UPDATE users SET nombre=? WHERE id=?').run(String(b.nombre).trim(), t.id);
    if (b.rol === 'owner' || b.rol === 'employee') db.prepare('UPDATE users SET rol=? WHERE id=?').run(b.rol, t.id);
    if (typeof b.active === 'boolean') { db.prepare('UPDATE users SET active=? WHERE id=?').run(b.active ? 1 : 0, t.id); if (!b.active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.id); }
    if (b.password) { if (String(b.password).length < 8) return fail(res, 400, 'La contraseña debe tener al menos 8 caracteres'); const { salt, hash } = newPassHash(String(b.password)); db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt, hash, t.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.id); }
    return send(res, 200, { ok: true });
  }
  return fail(res, 404, 'No encontrado');
}

/* ---------- archivos estáticos (la propia app web) ---------- */
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname); if (rel === '/') rel = '/index.html';
  const file = path.resolve(WWW, '.' + rel);
  if (!file.startsWith(WWW + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404, SEC); return res.end('No encontrado'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.png' || ext === '.svg' ? 'public, max-age=86400' : 'no-cache', ...SEC });
    if (req.method === 'HEAD') return res.end(); fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) fail(res, e.code === 413 || e.code === 400 ? e.code : 500, e.code === 413 || e.code === 400 ? e.message : 'Error interno');
    if (!e.code) console.error(e);
  }
});
server.requestTimeout = 120000;
if (require.main === module) server.listen(PORT, () => console.log(`Gestor de Tienda escuchando en http://localhost:${PORT}  (app: ${WWW})`));
module.exports = server;
