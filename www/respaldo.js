/* ===== Respaldo diario obligatorio tras el cierre de caja (solo dueño) =====
   Guarda un archivo con TODO (incluye fotos) en el dispositivo del dueño y conserva solo los últimos 4 días.
   · Windows (programa de escritorio): Documentos\Gestor de Tienda\Respaldos (automático)
   · Android (APK): Documentos/Gestor de Tienda/Respaldos (si Android no lo permite, carpeta propia de la app) + botón Compartir
   · Navegador: carpeta que el dueño elige una vez (si el navegador lo permite) o descarga normal */
(function () {
  const KEEP = 4, DIR = 'Gestor de Tienda/Respaldos', LS = 'gestor_rb_last';
  const slug = () => String(S.config.nombre || 'tienda').replace(/\W+/g, '-');
  const fname = d => `respaldo-${slug()}-${d}.json`;
  const RXF = /^respaldo-.+-(\d{4}-\d{2}-\d{2})\.json$/;
  const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { return null; } };
  const lsSet = v => { try { localStorage.setItem(LS, JSON.stringify(v)); } catch (e) { } };
  const payload = () => JSON.stringify({ app: 'gestor-de-tienda', exportado: new Date().toISOString(), ...S });
  const mb = n => (n / 1048576).toFixed(1) + ' MB';
  const old = names => names.map(n => (RXF.exec(n) || [])[1] && { n, d: RXF.exec(n)[1] }).filter(Boolean).sort((a, b) => b.d.localeCompare(a.d)).slice(KEEP).map(x => x.n);
  const cap = () => window.Capacitor, native = () => cap() && cap().isNativePlatform && cap().isNativePlatform();

  // ---- carpeta elegida en el navegador (File System Access) ----
  const idb = () => new Promise((ok, no) => { const r = indexedDB.open('gestor_rb', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const hGet = async () => { try { const d = await idb(); return await new Promise(ok => { const q = d.transaction('h').objectStore('h').get('dir'); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); }); } catch (e) { return null; } };
  const hSet = async h => { try { const d = await idb(); await new Promise(ok => { const t = d.transaction('h', 'readwrite'); t.objectStore('h').put(h, 'dir'); t.oncomplete = ok; t.onerror = ok; }); } catch (e) { } };

  async function viaElectron(name, text) {
    const r = await window.gestorFS.saveBackup(name, text); return { ok: true, donde: r.path, bytes: r.bytes };
  }
  async function viaNative(name, text) {
    const FS = cap().Plugins.Filesystem, tried = [];
    try { if (FS.requestPermissions) await FS.requestPermissions().catch(() => { }); } catch (e) { }
    for (const dir of ['DOCUMENTS', 'EXTERNAL']) {
      try {
        await FS.writeFile({ path: `${DIR}/${name}`, data: text, directory: dir, encoding: 'utf8', recursive: true });
        try { const l = await FS.readdir({ path: DIR, directory: dir }); for (const f of old((l.files || []).map(x => x.name || x))) await FS.deleteFile({ path: `${DIR}/${f}`, directory: dir }); } catch (e) { }
        return { ok: true, donde: dir === 'DOCUMENTS' ? 'Documentos/' + DIR : 'carpeta de la app (Android/data/com.bizcontrol.app/files/' + DIR + ')', bytes: text.length };
      } catch (e) { tried.push(dir + ': ' + (e && e.message || e)); }
    }
    throw new Error(tried.join(' | '));
  }
  async function viaBrowser(name, text, gesture) {
    if (!window.showDirectoryPicker) throw new Error('nodir');
    let h = await hGet();
    if (h) { let p = await h.queryPermission({ mode: 'readwrite' }); if (p !== 'granted' && gesture) p = await h.requestPermission({ mode: 'readwrite' }); if (p !== 'granted') h = null; }
    if (!h) { if (!gesture) throw new Error('needgesture'); h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'gestor-rb' }); await hSet(h); }
    const sub = await h.getDirectoryHandle('Gestor de Tienda - Respaldos', { create: true });
    const fh = await sub.getFileHandle(name, { create: true }), w = await fh.createWritable(); await w.write(text); await w.close();
    const names = []; for await (const [k, v] of sub.entries()) if (v.kind === 'file') names.push(k);
    for (const n of old(names)) { try { await sub.removeEntry(n); } catch (e) { } }
    return { ok: true, donde: h.name + '\\Gestor de Tienda - Respaldos', bytes: text.length };
  }

  async function hacer(gesture) {
    const dia = todayStr(), name = fname(dia), text = payload();
    let res, err = '';
    try {
      if (window.gestorFS && window.gestorFS.saveBackup) res = await viaElectron(name, text);
      else if (native() && cap().Plugins && cap().Plugins.Filesystem) res = await viaNative(name, text);
      else res = await viaBrowser(name, text, gesture);
    } catch (e) { err = String(e && e.message || e); }
    if (res && res.ok) { lsSet({ dia, t: Date.now(), donde: res.donde, bytes: res.bytes, ok: 1 }); return res; }
    return { ok: false, err };
  }

  // ---- ventana «Respaldo del día» ----
  let busy = false;
  function pintar(est, r) {
    const el = $('#rb-body'); if (!el) return;
    const foot = $('#rb-foot');
    if (est === 'run') { el.innerHTML = '<div class="hint">Guardando el respaldo con todas las fotos…</div>'; foot.innerHTML = ''; return; }
    if (est === 'ok') {
      el.innerHTML = `<div class="ok-box" style="background:var(--ok-soft,#dcfce7);border-radius:12px;padding:12px"><b>✔ Respaldo guardado</b><div class="small" style="margin-top:6px">${esc(r.donde)}<br>${mb(r.bytes)} · se conservan los últimos ${KEEP} días y los más viejos se borran solos.</div></div>`;
      foot.innerHTML = `<button class="btn soft" data-act="rbShare">Compartir copia</button><button class="btn ok" data-act="rbClose">${ic('check')} Listo</button>`; return;
    }
    const needPick = /needgesture|nodir/.test(r.err);
    el.innerHTML = `<div class="hint" style="background:#fee2e2;border-radius:12px;padding:12px"><b>No se pudo guardar el respaldo automáticamente.</b><div class="small" style="margin-top:6px">${needPick ? 'En el navegador hay que elegir una carpeta una vez (o usa «Compartir copia»).' : esc(r.err).slice(0, 220)}</div></div>`;
    foot.innerHTML = `<button class="btn soft" data-act="rbShare">Compartir / guardar copia</button><button class="btn ok" data-act="rbRetry">${needPick ? 'Elegir carpeta' : 'Reintentar'}</button><button class="btn ghost" data-act="rbSkip">Omitir hoy</button>`;
  }
  async function correr(gesture) {
    if (busy) return; busy = true; pintar('run');
    const r = await hacer(gesture); busy = false;
    pintar(r.ok ? 'ok' : 'err', r); if (r.ok) render();
  }
  function ventana() {
    modal(`<h2 class="mt">Respaldo del día</h2><p class="muted" style="margin-bottom:10px">Después de cerrar la caja se guarda una copia de emergencia de toda la tienda en este dispositivo.</p><div id="rb-body"></div><div class="dfoot" id="rb-foot"></div>`);
    correr(false);
  }

  ACT.rbNow = () => ventana();
  ACT.rbRetry = () => correr(true);
  ACT.rbClose = () => closeModal();
  ACT.rbSkip = () => { lsSet({ ...(lsGet() || {}), omitido: todayStr() }); closeModal(); render(); };
  ACT.rbShare = () => saveFile(fname(todayStr()), payload(), 'application/json');

  // Al cerrar la caja el dueño ve la ventana de respaldo
  const _toast = toast; toast = function (m, k) { _toast(m, k); if (m === 'Caja cerrada' && isOwner()) setTimeout(ventana, 700); };

  // Aviso en Inicio si hoy no hay respaldo (después de las 6 p. m. o si pasaron 24 h)
  function falta() {
    if (!isOwner()) return false; const l = lsGet(), now = new Date();
    if (l && l.dia === todayStr() && l.ok) return false;
    if (l && l.omitido === todayStr() && now.getHours() < 20) return false;
    return !l || (Date.now() - (l.t || 0) > 24 * 36e5) || now.getHours() >= 18;
  }
  const _vi = vInicio; vInicio = function () {
    return (falta() ? `<div class="recbar"><span>💾 <b>Falta el respaldo de hoy.</b> Guarda la copia de emergencia.</span><button class="btn sm" data-act="rbNow">Hacer respaldo</button></div>` : '') + _vi();
  }; ROUTES.inicio.v = vInicio;
})();
