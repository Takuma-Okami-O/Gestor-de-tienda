'use strict';
/* =====================================================================
   BizControl — sesión, login, sincronización en la nube (offline-first),
   roles (dueño / empleado) y gestión del equipo.
   Se carga DESPUÉS de app.js. Estrategia: cada registro lleva una marca de
   tiempo; gana el cambio más reciente (last-write-wins) por registro.
   ===================================================================== */

/* ---------- estado local del dispositivo (no se sincroniza) ---------- */
let L = { pin: '', token: '', user: null, store: null, server: '', tema: '', nombre: '' };
// Y = bookkeeping de sincronización: cursor del servidor y metadatos por registro
let Y = { cursor: 0, meta: {}, storeId: '', last: 0, pulled: false, skew: 0 };
const COLS = ['productos', 'clientes', 'facturas', 'movs'];
const SINGLE = ['categorias', 'config'];
const isOwner = () => !!(L.user && L.user.rol === 'owner');
const saveLocal = () => IDB.db ? IDB.set('local', L).catch(() => { }) : Promise.resolve();
const saveSyncMeta = () => IDB.db ? IDB.set('sync', Y) : Promise.resolve();
const nowU = () => Date.now() + (Y.skew || 0);

/* ---------- servidor ---------- */
function normServer(s) { s = String(s || '').trim().replace(/\/+$/, ''); if (!s) return ''; return /^https?:\/\//i.test(s) ? s : 'https://' + s; }
const serverBase = () => normServer(L.server || (window.BIZ && BIZ.server) || (!isNative() && /^https?:$/.test(location.protocol) ? location.origin : ''));
async function api(path, body, method) {
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
      items.push({ c: col, id, u: m.u, d: m.d ? 1 : 0, data: m.d ? null : rec });
      snap.push({ c: col, id, u: m.u, h: m.h });
    }
  }
  return { items, snap };
}
function markPushed(batch, resp) {
  const rej = new Set((resp.rejected || []).map(x => x.c + '|' + x.id));
  for (const s of batch.snap) {
    if (rej.has(s.c + '|' + s.id)) continue;
    const m = (Y.meta[s.c] || {})[s.id]; if (m && m.u === s.u && m.h === s.h) m.s = 1;
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
    meta[r.id] = { u: r.u, h: hstr(hashRec(r.c, rec)), s: 1 }; changed = true;
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
  const needSrv = !serverBase();
  lockShow(`<form class="loginbox" id="lg-form" autocomplete="on">${brandBlock()}
    <div class="sub">Inicia sesión para continuar</div>
    <div class="f"><label class="l">Correo</label><input class="in" id="lg-email" type="email" autocomplete="username" inputmode="email" autocapitalize="none" value="${esc(L.user?.email || L.lastEmail || '')}" placeholder="tucorreo@ejemplo.com"></div>
    <div class="f"><label class="l">Contraseña</label><div class="pwrap"><input class="in" id="lg-pass" type="password" autocomplete="current-password" placeholder="••••••••"><button type="button" id="lg-eye" aria-label="Mostrar contraseña">${EYE}</button></div></div>
    <div class="f ${needSrv ? '' : 'hide'}" id="lg-srv-f"><label class="l">Servidor</label><input class="in" id="lg-srv" value="${esc(L.server || '')}" placeholder="https://mi-servidor.com" inputmode="url" autocapitalize="none"></div>
    <div class="err" id="lg-err" ${kind === 'info' ? 'style="color:var(--muted)"' : ''}>${esc(msg || '')}</div>
    <button class="btn block" id="lg-go" type="submit" style="padding:14px;font-size:16px">Entrar</button>
    <div class="dev">Desarrollado por Analista de sistemas Eber Romero</div></form>`);
  $('#lg-eye').onclick = () => { const p = $('#lg-pass'); p.type = p.type === 'password' ? 'text' : 'password'; };
  /* ajuste oculto para soporte: 7 toques seguidos sobre el logo muestran el campo Servidor */
  let taps = 0, tt; $('#lg-form').firstElementChild.onclick = () => { taps++; clearTimeout(tt); tt = setTimeout(() => taps = 0, 1500); if (taps >= 7) { $('#lg-srv-f').classList.remove('hide'); $('#lg-srv').focus(); } };
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
  L.token = ''; saveLocal(); clearInterval(loopT); setPill('off');
  showLogin('Tu sesión expiró o fue cerrada. Inicia sesión de nuevo (tus cambios sin enviar se conservan).', 'info');
}
let entered = false;
function enterApp() {
  lockHide(); applyTheme(); buildNav();
  const r = (location.hash || '#inicio').slice(1);
  if (!ROUTES[r] || (r === 'ajustes' && false)) location.hash = 'inicio'; else render();
  setPill(hasPending() ? 'pend' : (Y.last ? 'ok' : 'off')); if (!entered) { entered = true; startLoop(); }
  syncNow();
}

/* ---------- sesión: cerrar ---------- */
async function doLogout() {
  if (L.token && navigator.onLine) { await syncNow(); }
  if (hasPending() && !confirm(`Hay ${pendingCount()} cambio(s) sin enviar a la nube. Si cierras sesión se perderán. ¿Cerrar sesión de todos modos?`)) return;
  try { if (L.token) await api('/api/logout', {}); } catch { }
  clearInterval(loopT); clearTimeout(syncT);
  const keep = { tema: S.config.tema, nombre: S.config.nombre };
  S = DEFAULT(); S.config.tema = keep.tema; Y = { cursor: 0, meta: {}, storeId: '', last: 0, pulled: false, skew: 0 };
  const email = L.user?.email; L.token = ''; L.user = null; L.store = null; L.pin = ''; L.lastEmail = email || L.lastEmail;
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
    <div class="f"><label class="l">${u ? 'Nueva contraseña (déjala vacía para no cambiarla)' : 'Contraseña (mín. 8)'}</label><div class="row"><input class="in" id="us-pw" type="text" autocomplete="off" placeholder="${u ? '••••••••' : ''}"><button class="btn soft" type="button" style="flex:none" data-act="pwGen">Generar</button></div></div>
    ${u ? `<label class="row" style="cursor:pointer"><input type="checkbox" id="us-act" style="width:20px;height:20px;accent-color:var(--accent)" ${u.active ? 'checked' : ''}><span class="b">Cuenta activa</span></label>` : ''}
    <div class="hint small" style="margin-top:12px">Entrégale el correo y la contraseña a la persona. Al cambiar una contraseña se cierran sus sesiones abiertas.</div>
    <div class="dfoot"><button class="btn ghost" data-act="close">Cancelar</button><button class="btn" data-act="userSave" data-id="${u ? u.id : ''}">${ic('check')} Guardar</button></div>`);
}
Object.assign(ACT, {
  syncNow: () => syncNow(true),
  logout: () => { $$('.overlay').forEach(o => closeModal(o)); doLogout(); },
  pwSave: async () => {
    const o = $('#pw-old').value, n = $('#pw-new').value; if (!o || !n) return toast('Completa ambas contraseñas', 'err');
    try { await api('/api/password', { old: o, new: n }); $('#pw-old').value = $('#pw-new').value = ''; toast('Contraseña actualizada', 'ok'); } catch (e) { toast(e.message, 'err'); }
  },
  userNew: () => userModal(null),
  userEdit: d => userModal((window._team || []).find(u => u.id === d.id)),
  pwGen: () => { $('#us-pw').value = genPw(); },
  userSave: async d => {
    const nombre = $('#us-nom').value.trim(), rol = $('#us-rol').value, pw = $('#us-pw').value.trim();
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
  applyTheme(); registerSW();
  if (!L.token) showLogin(); else if (L.pin) showPin(); else enterApp();
})();
