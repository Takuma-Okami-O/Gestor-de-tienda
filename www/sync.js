'use strict';
/* =====================================================================
   BizControl — sesión, login, sincronización en la nube (offline-first),
   roles (dueño / empleado) y gestión del equipo.
   Se carga DESPUÉS de app.js. Estrategia: cada registro lleva una marca de
   tiempo; gana el cambio más reciente (last-write-wins) por registro.
   ===================================================================== */

/* ---------- estado local del dispositivo (no se sincroniza) ---------- */
let L = { dev: '', pin: '', token: '', refresh: '', exp: 0, user: null, store: null, server: '', tema: '', nombre: '' };
// Y = bookkeeping de sincronización: cursor del servidor y metadatos por registro
let Y = { cursor: 0, meta: {}, storeId: '', last: 0, pulled: false, skew: 0 };
const COLS = ['productos', 'clientes', 'facturas', 'movs', 'gastos', 'cierres', 'proveedores'];
const SINGLE = ['categorias', 'config'];
const isOwner = () => !!(L.user && L.user.rol === 'owner');
const saveLocal = () => IDB.db ? IDB.set('local', L).catch(() => { }) : Promise.resolve();
const saveSyncMeta = () => IDB.db ? IDB.set('sync', Y) : Promise.resolve();
const nowU = () => Date.now() + (Y.skew || 0);

/* ---------- servidor ---------- */
function normServer(s) { s = String(s || '').trim().replace(/\/+$/, ''); if (!s) return ''; return /^https?:\/\//i.test(s) ? s : 'https://' + s; }
const SB = () => { const c = window.BIZ && BIZ.supabase; return c && c.url && c.key ? { url: String(c.url).replace(/\/+$/, ''), key: c.key } : null; };
const serverBase = () => SB() ? SB().url : normServer(L.server || (window.BIZ && BIZ.server) || (!isNative() && /^https?:$/.test(location.protocol) ? location.origin : ''));
async function api(path, body, method) {
  if (SB()) return sbApi(path, body, method);
  const base = serverBase();
  if (!base) throw Object.assign(new Error('Falta la dirección del servidor'), { code: 'noserver' });
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 90000);
  let r;
  try { r = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(L.token ? { Authorization: 'Bearer ' + L.token } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal }); }
  catch (e) { throw Object.assign(new Error('No se pudo conectar con el servidor'), { code: 'net' }); }
  finally { clearTimeout(to); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Error ' + r.status), { code: r.status });
  return j;
}

/* ---------- Supabase (auth + funciones RPC; ver supabase/schema.sql) ---------- */
async function sbFetch(url, opt, token) {
  const c = SB(), ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 90000); let r;
  try { r = await fetch(url, { ...opt, headers: { 'Content-Type': 'application/json', apikey: c.key, ...((token || /^eyJ/.test(c.key)) ? { Authorization: 'Bearer ' + (token || c.key) } : {}) }, signal: ctl.signal }); }
  catch (e) { throw Object.assign(new Error('No se pudo conectar con el servidor'), { code: 'net' }); }
  finally { clearTimeout(to); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const raw = String(j.message || j.msg || j.error_description || j.error || ''), low = raw.toLowerCase();
    let msg = raw || 'Error ' + r.status, code = r.status;
    if (low.includes('cuenta_desactivada')) { msg = 'Tu cuenta fue desactivada. Contacta al dueño.'; code = 401; }
    else if (low.includes('invalid login') || low.includes('invalid_grant') || low.includes('invalid credentials')) { msg = 'Correo o contraseña incorrectos'; code = 400; }
    else if (low.includes('already registered') || low.includes('already been registered')) { msg = 'Ese correo ya está registrado'; code = 409; }
    else if (low.includes('rate limit') || r.status === 429) { msg = 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.'; code = 429; }
    else if (low.includes('password should be') || low.includes('weak')) { msg = 'La contraseña es muy débil (mínimo 8 caracteres)'; code = 400; }
    else if (low.includes('jwt') || r.status === 401) { msg = 'Sesión no válida'; code = 401; }
    throw Object.assign(new Error(msg), { code, raw });
  }
  return j;
}
let refreshing = null;
function sbSetSession(j) { L.token = j.access_token; L.refresh = j.refresh_token || L.refresh; L.exp = Date.now() + (j.expires_in || 3600) * 1000; }
async function sbRefresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try { const j = await sbFetch(SB().url + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: L.refresh }) }); sbSetSession(j); await saveLocal(); }
    catch (e) { if (e.code === 'net') throw e; throw Object.assign(new Error('Sesión expirada'), { code: 401 }); }
    finally { refreshing = null; }
  })();
  return refreshing;
}
async function sbToken() { if (L.refresh && (!L.exp || L.exp - Date.now() < 60000)) await sbRefresh(); return L.token; }
async function rpc(fn, args) {
  const call = async () => sbFetch(SB().url + '/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(args || {}) }, await sbToken());
  try { return await call(); }
  catch (e) { if (e.code === 401 && L.refresh && e.raw && /jwt/i.test(e.raw)) { await sbRefresh(); return call(); } throw e; }
}
async function sbApi(path, body, method) {
  const url = SB().url;
  if (path === '/api/login') {
    const j = await sbFetch(url + '/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: String(body.email).trim().toLowerCase(), password: body.password }) });
    sbSetSession(j);
    try { const m = await rpc('me'); return { token: L.token, user: m.user, store: m.store }; }
    catch (e) { L.token = L.refresh = ''; if (e.code === 'net') throw e; throw Object.assign(new Error(/desactivada/.test(e.message) ? e.message : 'Esta cuenta no tiene una tienda asignada. Contacta a soporte.'), { code: 400 }); }
  }
  if (path === '/api/recover') {
    const to = (window.BIZ && BIZ.recoverUrl) || catBase().replace(/[^/]*$/, '') + 'recuperar.html';
    await sbFetch(url + '/auth/v1/recover' + (to ? '?redirect_to=' + encodeURIComponent(to) : ''), { method: 'POST', body: JSON.stringify({ email: body.email }) });
    return { ok: true };
  }
  if (path === '/api/sync') return rpc('sync', { since: body.since || 0, push: body.push || [] });
  if (path === '/api/logout') { try { await sbFetch(url + '/auth/v1/logout', { method: 'POST' }, await sbToken()); } catch { } return { ok: true }; }
  if (path === '/api/password') {
    if (String(body.new || '').length < 8) throw Object.assign(new Error('La nueva contraseña debe tener al menos 8 caracteres'), { code: 400 });
    try { await sbFetch(url + '/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: L.user.email, password: body.old }) }); }
    catch (e) { if (e.code === 400) throw Object.assign(new Error('La contraseña actual no es correcta'), { code: 400 }); throw e; }
    await sbFetch(url + '/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password: body.new }) }, await sbToken()); return { ok: true };
  }
  if (path === '/api/users' && !body) return rpc('team_list');
  if (path === '/api/users') {
    const email = String(body.email || '').trim().toLowerCase(), nombre = String(body.nombre || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('Correo no válido'), { code: 400 });
    if (!nombre) throw Object.assign(new Error('Escribe el nombre'), { code: 400 });
    if (String(body.password || '').length < 8) throw Object.assign(new Error('La contraseña debe tener al menos 8 caracteres'), { code: 400 });
    // se crea la cuenta con una petición aparte (no cambia la sesión del dueño) y luego se enlaza a su tienda
    const j = await sbFetch(url + '/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password: body.password }) });
    const uid = (j.user && j.user.id) || j.id; if (!uid) throw new Error('No se pudo crear la cuenta');
    return rpc('team_add', { uid, nombre, rol: body.rol === 'owner' ? 'owner' : 'employee' });
  }
  const um = path.match(/^\/api\/users\/([\w-]+)$/);
  if (um && method === 'DELETE') return rpc('team_delete', { uid: um[1] });
  if (um) { const r = await rpc('team_update', { uid: um[1], nombre: body.nombre, rol: body.rol, active: body.active }); if (body.password) await rpc('team_set_password', { uid: um[1], nueva: body.password }); return r; }
  throw new Error('Operación no soportada');
}

/* ---------- seguimiento de cambios ---------- */
function hstr(s) { let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36); }
function hashRec(col, r) { if (col === 'productos' && r.imagenes && r.imagenes.length) return JSON.stringify({ ...r, imagenes: r.imagenes.map(s => s.length + ':' + s.slice(-40)) }); return JSON.stringify(r); }
const singleData = c => c === 'config' ? S.config : S.categorias;
function track() {
  const now = nowU(); let ch = false;
  for (const col of COLS) {
    const arr = S[col], meta = Y.meta[col] || (Y.meta[col] = {}), seen = new Set();
    for (const r of arr) {
      if (!r || !r.id) continue; seen.add(r.id);
      const h = hstr(hashRec(col, r)), m = meta[r.id];
      if (!m) { meta[r.id] = { u: now, h, s: 0 }; ch = true; }
      else if (m.h !== h || m.d) { m.u = now; m.h = h; m.s = 0; m.d = 0; ch = true; }
    }
    for (const id in meta) {
      const m = meta[id]; if (seen.has(id) || m.d) continue;
      if (col === 'movs') { delete meta[id]; continue; } // el historial de movimientos solo se recorta localmente
      meta[id] = { u: now, h: '', s: 0, d: 1 }; ch = true;
    }
  }
  for (const col of SINGLE) {
    const meta = Y.meta[col] || (Y.meta[col] = {}), h = hstr(JSON.stringify(singleData(col))), m = meta[col];
    if (!m) { meta[col] = { u: now, h, s: 0 }; ch = true; } else if (m.h !== h) { m.u = now; m.h = h; m.s = 0; ch = true; }
  }
  return ch;
}
function pendingCount() { let n = 0; for (const c in Y.meta) for (const id in Y.meta[c]) if (!Y.meta[c][id].s) n++; return n; }
const hasPending = () => pendingCount() > 0;

function collectPush(maxRecs = 150, maxBytes = 3e6) {
  const items = [], snap = []; let bytes = 0;
  for (const col of [...COLS, ...SINGLE]) {
    const meta = Y.meta[col] || {};
    for (const id in meta) {
      const m = meta[id]; if (m.s) continue;
      if (items.length >= maxRecs || bytes > maxBytes) return { items, snap };
      let rec = null;
      if (!m.d) { rec = SINGLE.includes(col) ? singleData(col) : S[col].find(x => x.id === id); if (!rec) continue; bytes += JSON.stringify(rec).length; }
      const it = { c: col, id, u: m.u, d: m.d ? 1 : 0, data: m.d ? null : rec };
      // stock como diferencia respecto al último valor sincronizado: ventas simultáneas en varios equipos se suman, no se pisan
      if (col === 'productos' && !m.d && m.sb !== undefined) { it.ds = (+rec.stock || 0) - m.sb; it.op = (L.dev || '') + ':' + m.u + ':' + m.sb; }
      items.push(it);
      snap.push({ c: col, id, u: m.u, h: m.h, st: col === 'productos' && rec ? (+rec.stock || 0) : undefined });
    }
  }
  return { items, snap };
}
function markPushed(batch, resp) {
  const rej = new Set((resp.rejected || []).map(x => x.c + '|' + x.id));
  for (const s of batch.snap) {
    if (rej.has(s.c + '|' + s.id)) continue;
    const m = (Y.meta[s.c] || {})[s.id]; if (!m) continue;
    if (s.st !== undefined) m.sb = s.st; // base para el próximo envío de diferencia
    if (m.u === s.u && m.h === s.h) m.s = 1;
  }
}
function applyRecs(recs) {
  let changed = false;
  for (const r of recs) {
    if (!r || !r.c) continue;
    const meta = Y.meta[r.c] || (Y.meta[r.c] = {});
    if (SINGLE.includes(r.c)) {
      const m = meta[r.c]; if (m && !m.s && m.u > r.u) continue;
      if (r.d || r.data == null) continue;
      if (r.c === 'config') S.config = Object.assign(DEFAULT().config, r.data); else if (Array.isArray(r.data)) S.categorias = r.data;
      meta[r.c] = { u: r.u, h: hstr(JSON.stringify(singleData(r.c))), s: 1 }; changed = true; continue;
    }
    const arr = S[r.c]; if (!arr) continue;
    const m = meta[r.id]; if (m && !m.s && m.u > r.u) continue; // cambio local más reciente pendiente
    const idx = arr.findIndex(x => x.id === r.id);
    if (r.d) { if (idx > -1) arr.splice(idx, 1); meta[r.id] = { u: r.u, h: '', s: 1, d: 1 }; changed = true; continue; }
    const rec = r.data; if (!rec || typeof rec !== 'object') continue; rec.id = r.id;
    if (idx > -1) arr[idx] = rec; else arr.push(rec);
    meta[r.id] = { u: r.u, h: hstr(hashRec(r.c, rec)), s: 1 }; if (r.c === 'productos') meta[r.id].sb = +rec.stock || 0; changed = true;
  }
  if (changed) {
    const byDate = (a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''));
    S.facturas.sort(byDate); S.movs.sort(byDate); S.productos.sort(byDate); S.clientes.sort((a, b) => a.nombre.localeCompare(b.nombre));
  }
  return changed;
}

/* ---------- ciclo de sincronización ---------- */
let syncing = false, again = false, lastErr = '', syncT = null, loopT = null;
function setPill(state) {
  const p = $('#sync-pill'); if (!p) return;
  const T = { ok: 'Sincronizado', sync: 'Sincronizando…', pend: 'Pendiente', off: 'Sin conexión', err: 'Error de sync' };
  p.className = 'pill ' + state; p.lastElementChild.textContent = T[state];
  p.title = state === 'ok' ? 'Todo está guardado en la nube' : state === 'pend' ? pendingCount() + ' cambio(s) por enviar' : (lastErr || T[state]);
  refreshSyncInfo();
}
function refreshSyncInfo() {
  const el = $('#sync-info'); if (!el) return;
  el.innerHTML = `Servidor: <b>${esc(serverBase().replace(/^https?:\/\//, '') || '—')}</b><br>Última sincronización: <b>${Y.last ? fdt(Y.last) : 'nunca'}</b><br>Cambios por enviar: <b>${pendingCount()}</b>${lastErr ? `<br><span style="color:var(--bad)">${esc(lastErr)}</span>` : ''}`;
}
function scheduleSync(ms) { clearTimeout(syncT); syncT = setTimeout(() => syncNow(), ms); }
let trackT = null;
function onLocalChange() {
  if (!L.token || !Y.pulled) return;
  clearTimeout(trackT); trackT = setTimeout(() => { track(); saveSyncMeta(); if (!syncing) setPill(navigator.onLine ? (hasPending() ? 'pend' : 'ok') : 'off'); }, 300); // fecha el cambio cuando ocurre, aunque no haya internet
  scheduleSync(2500);
}
function softRefresh() {
  applyTheme();
  const busy = document.querySelector('.overlay') || (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
  if (!busy) render();
}
async function syncNow(manual) {
  if (!L.token) return;
  if (syncing) { again = true; return; }
  if (!navigator.onLine) { setPill('off'); if (manual) toast('Sin conexión: se sincronizará al volver internet', 'err'); return; }
  syncing = true; setPill('sync'); let changedUI = false; const hadUser = !!L.user;
  try {
    if (!Y.pulled) { // primera descarga completa de la tienda, antes de enviar nada
      let more = true;
      while (more) { const r = await api('/api/sync', { since: Y.cursor, push: [] }); Y.skew = r.serverTime - Date.now(); if (applyRecs(r.recs)) changedUI = true; Y.cursor = r.cursor; more = r.more; }
      Y.pulled = true; await saveNow();
    }
    for (let round = 0; round < 60; round++) {
      track(); const batch = collectPush();
      const r = await api('/api/sync', { since: Y.cursor, push: batch.items }); Y.skew = r.serverTime - Date.now();
      markPushed(batch, r); (r.denied || []).forEach(d => { const m = (Y.meta[d.c] || {})[d.id]; if (m) m.s = 1; });
      if (applyRecs(r.recs)) changedUI = true; Y.cursor = r.cursor;
      if (!r.more && !hasPending()) break;
    }
    Y.last = Date.now(); lastErr = ''; await saveNow(); setPill(hasPending() ? 'pend' : 'ok');
    if (manual) toast('Sincronizado ✔', 'ok');
  } catch (e) {
    if (e.code === 401) { sessionExpired(); }
    else { lastErr = e.message; setPill(e.code === 'net' ? 'off' : 'err'); if (manual) toast(e.code === 'net' ? 'Sin conexión con el servidor' : e.message, 'err'); }
  } finally {
    syncing = false;
    if (changedUI) softRefresh();
    if (again) { again = false; scheduleSync(800); }
  }
}
function startLoop() {
  clearInterval(loopT); loopT = setInterval(() => syncNow(), 30000);
  addEventListener('online', () => syncNow()); addEventListener('offline', () => setPill('off'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
}

/* ---------- pantallas de acceso ---------- */
const lockEl = () => $('#lock');
function lockShow(html) { const L_ = lockEl(); L_.className = ''; L_.style.display = 'flex'; L_.innerHTML = html; }
function lockHide() { const e = lockEl(); e.classList.add('gone'); setTimeout(() => { if (e.classList.contains('gone')) e.style.display = 'none'; }, 400); }
function brandBlock() {
  const th = themeOf();
  if (!S.config.logo && th.wide) return `<img class="wlogo" src="${th.wide}" alt="${esc(S.config.nombre)}">`;
  return `<div class="logo ${!S.config.logo && th.mark ? 'mark' : ''}">${markHTML()}</div><h1>${esc(S.config.nombre === 'Mi Negocio' && window.BIZ && BIZ.nombre ? BIZ.nombre : S.config.nombre)}</h1>`;
}
const EYE = '<svg class="ic" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
function showLogin(msg, kind) {
  applyTheme();
  const needSrv = !SB() && !serverBase();
  lockShow(`<form class="loginbox" id="lg-form" autocomplete="on">${brandBlock()}
    <div class="sub">Inicia sesión para continuar</div>
    <div class="f"><label class="l">Correo</label><input class="in" id="lg-email" type="email" autocomplete="username" inputmode="email" autocapitalize="none" value="${esc(L.user?.email || L.lastEmail || '')}" placeholder="tucorreo@ejemplo.com"></div>
    <div class="f"><label class="l">Contraseña</label><div class="pwrap"><input class="in" id="lg-pass" type="password" autocomplete="current-password" placeholder="••••••••"><button type="button" id="lg-eye" aria-label="Mostrar contraseña">${EYE}</button></div></div>
    <div class="f ${needSrv ? '' : 'hide'}" id="lg-srv-f"><label class="l">Servidor</label><input class="in" id="lg-srv" value="${esc(L.server || '')}" placeholder="https://mi-servidor.com" inputmode="url" autocapitalize="none"></div>
    <div class="err" id="lg-err" ${kind === 'info' ? 'style="color:var(--muted)"' : ''}>${esc(msg || '')}</div>
    <button class="btn block" id="lg-go" type="submit" style="padding:14px;font-size:16px">Entrar</button>
    ${SB() ? '<a class="link" id="lg-forgot">¿Olvidaste tu contraseña?</a>' : ''}
    <div class="dev">Desarrollado por Analista de sistemas Eber Romero</div></form>`);
  $('#lg-eye').onclick = () => { const p = $('#lg-pass'); p.type = p.type === 'password' ? 'text' : 'password'; };
  /* ajuste oculto para soporte: 7 toques seguidos sobre el logo muestran el campo Servidor */
  let taps = 0, tt; $('#lg-form').firstElementChild.onclick = () => { taps++; clearTimeout(tt); tt = setTimeout(() => taps = 0, 1500); if (taps >= 7 && !SB()) { $('#lg-srv-f').classList.remove('hide'); $('#lg-srv').focus(); } };
  const fg = $('#lg-forgot'); if (fg) fg.onclick = async () => {
    const email = $('#lg-email').value.trim(), err = $('#lg-err'); if (!/^\S+@\S+\.\S+$/.test(email)) { err.style.color = ''; err.textContent = 'Escribe tu correo arriba y vuelve a tocar “¿Olvidaste tu contraseña?”'; return; }
    err.style.color = 'var(--muted)'; err.textContent = 'Enviando…';
    try { await api('/api/recover', { email }); err.textContent = 'Si el correo está registrado, te enviamos un enlace para crear una nueva contraseña. Revisa también la carpeta de spam.'; }
    catch (e) { err.style.color = ''; err.textContent = e.code === 'net' ? 'Sin conexión. Inténtalo con internet.' : (/rate|segundos|seconds/i.test(e.message) ? 'Espera un minuto antes de pedir otro correo.' : e.message); }
  };
  $('#lg-form').onsubmit = e => { e.preventDefault(); doLogin(); };
  ($('#lg-email').value ? $('#lg-pass') : $('#lg-email')).focus();
}
async function doLogin() {
  const email = $('#lg-email').value.trim(), password = $('#lg-pass').value, err = $('#lg-err'), btn = $('#lg-go'), srvEl = $('#lg-srv');
  if (!email || !password) { err.textContent = 'Escribe tu correo y contraseña'; return; }
  const prevServer = L.server; if (srvEl && srvEl.value.trim()) L.server = normServer(srvEl.value);
  err.textContent = ''; btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    const r = await api('/api/login', { email, password, device: (navigator.userAgent || '').slice(0, 80) });
    if (Y.storeId && Y.storeId !== r.store.id) { // otra tienda: no mezclar datos
      if (hasPending() && !confirm('Este dispositivo tiene cambios sin enviar de otra tienda. Si continúas se perderán. ¿Continuar?')) { L.server = prevServer; btn.disabled = false; btn.textContent = 'Entrar'; return; }
      S = DEFAULT(); Y = { cursor: 0, meta: {}, storeId: '', last: 0, pulled: false, skew: 0 }; await IDB.set('state', S);
    }
    L.token = r.token; L.user = r.user; L.store = r.store; L.lastEmail = email; Y.storeId = r.store.id; await saveLocal(); await saveSyncMeta();
    lockShow(`<div class="loginbox">${brandBlock()}<div class="bigspin"></div><div class="sub" style="margin:0">Cargando tu tienda…</div></div>`);
    await syncNow();
    if (!L.token) return; // sesión invalidada durante la carga
    if (!Y.pulled) { // no se pudo descargar: volver a intentar sin entrar con datos vacíos
      L.token = ''; await saveLocal(); showLogin('No se pudo cargar la tienda: ' + (lastErr || 'sin conexión') + '. Inténtalo de nuevo.'); return;
    }
    enterApp();
  } catch (e) {
    L.server = prevServer; btn.disabled = false; btn.textContent = 'Entrar';
    err.textContent = e.code === 'net' ? 'No se pudo conectar. Revisa tu internet y la dirección del servidor.' : e.message;
    $('#lg-pass').value = ''; $('#lg-pass').focus();
  }
}
function showPin() {
  applyTheme();
  lockShow(`<form class="loginbox pinbox" id="pin-form">${brandBlock()}<div class="sub">Hola, ${esc((L.user?.nombre || '').split(' ')[0])} · ingresa tu PIN</div>
    <input class="in" id="lk-pin" type="password" inputmode="numeric" maxlength="6" placeholder="••••" autocomplete="off"><div class="err" id="lk-err"></div>
    <button class="btn block" type="submit" style="padding:14px;font-size:16px">Desbloquear</button><a class="link" id="lk-out">Usar otra cuenta</a><div class="dev">Desarrollado por Analista de sistemas Eber Romero</div></form>`);
  $('#pin-form').onsubmit = async e => { e.preventDefault(); if (await sha($('#lk-pin').value) === L.pin) enterApp(); else { $('#lk-err').textContent = 'PIN incorrecto'; $('#lk-pin').value = ''; } };
  $('#lk-out').onclick = () => ACT.logout();
  $('#lk-pin').focus();
}
function sessionExpired() {
  L.token = ''; L.refresh = ''; saveLocal(); clearInterval(loopT); setPill('off');
  showLogin('Tu sesión expiró o fue cerrada. Inicia sesión de nuevo (tus cambios sin enviar se conservan).', 'info');
}
let entered = false;
function enterApp() {
  lockHide(); applyTheme(); buildNav();
  const r = (location.hash || '#inicio').slice(1);
  if (!ROUTES[r] || (r === 'ajustes' && false)) location.hash = 'inicio'; else render();
  setPill(hasPending() ? 'pend' : (Y.last ? 'ok' : 'off')); if (!entered) { entered = true; startLoop(); }
  if (SB() && L.token && !(L.store && L.store.slug)) rpc('me').then(m => { L.store = m.store; saveLocal(); if ((location.hash || '').slice(1) === 'catalogo') render(); }).catch(() => { });
  syncNow();
}

/* ---------- sesión: cerrar ---------- */
async function doLogout() {
  if (L.token && navigator.onLine) { await syncNow(); }
  if (hasPending() && !confirm(`Hay ${pendingCount()} cambio(s) sin enviar a la nube. Si cierras sesión se perderán. ¿Cerrar sesión de todos modos?`)) return;
  try { if (L.token) await api('/api/logout', {}); } catch { }
  clearInterval(loopT); clearTimeout(syncT);
  const keep = { tema: S.config.tema, color: S.config.color, nombre: S.config.nombre, logo: S.config.logo };
  S = DEFAULT(); S.config.tema = keep.tema; S.config.color = keep.color; S.config.logo = keep.logo || ''; if (keep.nombre) S.config.nombre = keep.nombre; Y = { cursor: 0, meta: {}, storeId: '', last: 0, pulled: false, skew: 0 };
  const email = L.user?.email; L.token = ''; L.refresh = ''; L.exp = 0; L.user = null; L.store = null; L.pin = ''; L.lastEmail = email || L.lastEmail;
  await IDB.set('state', S); await IDB.set('sync', Y); await saveLocal();
  entered = false; location.hash = ''; showLogin();
}

/* ---------- equipo (solo dueño) ---------- */
async function loadTeam() {
  const box = $('#team-list'); if (!box) return;
  try {
    const { users } = await api('/api/users'); window._team = users;
    box.innerHTML = users.map(u => `<div class="urow"><div class="li" style="padding:0;gap:11px;flex:1;cursor:default"><div class="av" style="background:${grad(u.nombre)}">${esc(initials(u.nombre))}</div><div class="mid"><div class="t">${esc(u.nombre)} ${u.id === L.user.id ? '<span class="badge gray">Tú</span>' : ''}</div><div class="s">${esc(u.email)}</div></div></div><span class="badge ${u.rol === 'owner' ? 'info' : 'gray'}">${u.rol === 'owner' ? 'Dueño' : 'Empleado'}</span>${u.active ? '' : '<span class="badge bad">Inactivo</span>'}${u.id === L.user.id ? '' : `<button class="iconbtn" data-act="userEdit" data-id="${u.id}">${ic('edit')}</button>`}</div>`).join('');
  } catch (e) { box.textContent = e.code === 'net' ? 'Conéctate a internet para administrar el equipo.' : e.message; }
}
const genPw = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; const r = crypto.getRandomValues(new Uint32Array(10)); for (const x of r) s += a[x % a.length]; return s; };
function userModal(u) {
  modal(`${dh(u ? 'Editar usuario' : 'Nuevo usuario')}
    <div class="f"><label class="l">Nombre</label><input class="in" id="us-nom" value="${esc(u?.nombre || '')}" placeholder="Ej. María (caja)"></div>
    <div class="f"><label class="l">Correo (será su usuario)</label><input class="in" id="us-email" type="email" ${u ? 'disabled' : ''} value="${esc(u?.email || '')}" inputmode="email" autocapitalize="none"></div>
    <div class="f"><label class="l">Rol</label><select class="in" id="us-rol"><option value="employee" ${u?.rol !== 'owner' ? 'selected' : ''}>Empleado — vende, factura y cobra; no ve costos ni ajustes</option><option value="owner" ${u?.rol === 'owner' ? 'selected' : ''}>Dueño — acceso total</option></select></div>
    ${`<div class="f"><label class="l">${u ? 'Nueva contraseña (déjala vacía para no cambiarla)' : 'Contraseña (mín. 8)'}</label><div class="row"><input class="in" id="us-pw" type="text" autocomplete="off" placeholder="${u ? '••••••••' : ''}"><button class="btn soft" type="button" style="flex:none" data-act="pwGen">Generar</button></div></div>`}
    ${u ? `<label class="row" style="cursor:pointer"><input type="checkbox" id="us-act" style="width:20px;height:20px;accent-color:var(--accent)" ${u.active ? 'checked' : ''}><span class="b">Cuenta activa</span></label>` : ''}
    <div class="hint small" style="margin-top:12px">Entrégale el correo y la contraseña a la persona. Al cambiar una contraseña se cierran sus sesiones abiertas.</div>
    <div class="dfoot">${u && u.id !== L.user.id && u.rol !== 'owner' ? `<button class="btn danger" style="flex:0 0 auto" data-act="userDel" data-id="${u.id}">${ic('trash')}</button>` : ''}<button class="btn ghost" data-act="close">Cancelar</button><button class="btn" data-act="userSave" data-id="${u ? u.id : ''}">${ic('check')} Guardar</button></div>`);
}
Object.assign(ACT, {
  syncNow: () => syncNow(true),
  logout: () => { $$('.overlay').forEach(o => closeModal(o)); doLogout(); },
  pwSave: async () => {
    const o = $('#pw-old').value, n = $('#pw-new').value; if (!o || !n) return toast('Completa ambas contraseñas', 'err');
    try { await api('/api/password', { old: o, new: n }); $('#pw-old').value = $('#pw-new').value = ''; toast('Contraseña actualizada', 'ok'); } catch (e) { toast(e.message, 'err'); }
  },
  userDel: d => { const u = (window._team || []).find(x => x.id === d.id); confirmDlg(`¿Eliminar la cuenta de <b>${esc(u ? u.nombre : '')}</b>? Perderá el acceso para siempre. Sus ventas ya registradas se conservan.`, 'Eliminar cuenta', async () => { try { await api('/api/users/' + d.id, null, 'DELETE'); $$('.overlay').forEach(o => closeModal(o)); toast('Cuenta eliminada', 'ok'); loadTeam(); } catch (e) { toast(e.message, 'err'); } }); },
  userNew: () => userModal(null),
  userEdit: d => userModal((window._team || []).find(u => u.id === d.id)),
  pwGen: () => { $('#us-pw').value = genPw(); },
  userSave: async d => {
    const nombre = $('#us-nom').value.trim(), rol = $('#us-rol').value, pw = ($('#us-pw')?.value || '').trim();
    if (!nombre) return toast('Escribe el nombre', 'err');
    try {
      if (d.id) { await api('/api/users/' + d.id, { nombre, rol, active: $('#us-act').checked, ...(pw ? { password: pw } : {}) }, 'PATCH'); }
      else { await api('/api/users', { nombre, rol, email: $('#us-email').value, password: pw }); }
      closeModal(); toast(d.id ? 'Usuario actualizado' : 'Usuario creado', 'ok'); loadTeam();
      if (pw) setTimeout(() => modal(`${dh('Credenciales')}<p style="margin-bottom:10px">Compártelas con la persona (esta es la única vez que verás la contraseña):</p><div class="ticket-box" style="font-family:monospace;background:#fafafa;border:1.5px dashed var(--line);border-radius:12px;padding:14px;white-space:pre-wrap;user-select:all">Correo: ${esc($('#us-email')?.value || (window._team || []).find(u => u.id === d.id)?.email || '')}\nContraseña: ${esc(pw)}</div><div class="dfoot"><button class="btn" data-act="close">Listo</button></div>`), 250);
    } catch (e) { toast(e.message, 'err'); }
  }
});
// aplicar cambios del nombre/tema que vienen del servidor sin romper formularios abiertos
const _cfgInput = INP.cfg; INP.cfg = e => { _cfgInput(e); };

/* ---------- registro del service worker y arranque ---------- */
function registerSW() { if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) navigator.serviceWorker.register('sw.js').catch(() => { }); }
(async function boot() {
  try {
    await IDB.open();
    const s = await IDB.get('state'); if (s) { S = Object.assign(DEFAULT(), s); S.config = Object.assign(DEFAULT().config, s.config); }
    const l = await IDB.get('local'); if (l) L = Object.assign(L, l);
    const y = await IDB.get('sync'); if (y) Y = Object.assign(Y, y);
  } catch (e) { console.warn('IDB', e); }
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { }
  if (!L.dev) { L.dev = Math.random().toString(36).slice(2, 10); saveLocal(); }
  applyTheme(); registerSW();
  if (!L.token) showLogin(); else if (L.pin) showPin(); else enterApp();
})();
