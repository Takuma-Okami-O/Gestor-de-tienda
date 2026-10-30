'use strict';
/* =====================================================================
   BizControl — Inventario, ventas, créditos, historial y catálogo
   Todo funciona sin internet. Datos en IndexedDB del dispositivo.
   ===================================================================== */

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = a => a.reduce((x, y) => x + y, 0);
const pad = n => String(n).padStart(2, '0');
const ymd = iso => { const d = new Date(iso); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const todayStr = () => ymd(new Date().toISOString());
const NF = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = n => (n < 0 ? '-' : '') + S.config.moneda + NF.format(Math.abs(n));
const fdate = iso => new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
const fdt = iso => new Date(iso).toLocaleString('es-VE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
const initials = s => String(s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const accentHue = () => { try { const n = parseInt(accent().slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; } catch { return 250; } };
const grad = s => { const h = (accentHue() + (hue(s) % 56) - 28 + 360) % 360; return `linear-gradient(135deg,hsl(${h} 42% 56%),hsl(${(h + 14) % 360} 46% 40%))`; };
const digits = s => String(s || '').replace(/\D/g, '');

/* ---------- iconos (SVG en línea, sin internet) ---------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L21 7H6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  catalog: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM20 14v1M14 20h1M18 18v3h3v-3z"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><rect x="7" y="14" width="10" height="7"/>',
  chat: '<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>', upload: '<path d="M12 16V5m0 0-4 4m4-4 4 4M5 20h14"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14.5" r="1"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>', tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="m21 16-5-5-8 9"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  store: '<path d="M4 9l1-5h14l1 5M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0M5 11v9h14v-9"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* ---------- estado y persistencia (IndexedDB) ---------- */
const DEFAULT = () => ({
  v: 1,
  config: { nombre: 'Mi Negocio', slogan: '', whatsapp: '', direccion: '', idFiscal: '', moneda: '$', tema: (window.BIZ && BIZ.tema) || 'indigo', pie: '¡Gracias por su compra!', logo: '', catalogUrl: '' },
  categorias: ['Damas', 'Caballeros', 'Calzado', 'Accesorios'],
  productos: [], clientes: [], facturas: [], movs: []
});
let S = DEFAULT();
const IDB = {
  db: null,
  open() { return new Promise((res, rej) => { const r = indexedDB.open('bizcontrol', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { this.db = r.result; res(); }; r.onerror = () => rej(r.error); }); },
  get(k) { return new Promise((res, rej) => { const q = this.db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  set(k, v) { return new Promise((res, rej) => { const t = this.db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
};
let saveT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(saveNow, 250); if (typeof onLocalChange === 'function') onLocalChange(); }
function saveNow() { clearTimeout(saveT); return IDB.db ? IDB.set('state', S).then(() => typeof saveSyncMeta === 'function' && saveSyncMeta()).catch(e => toast('No se pudo guardar: ' + e.message, 'err')) : Promise.resolve(); }
addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

/* ---------- interfaz base: toast, modales ---------- */
let toastT;
function toast(msg, kind = '') { const t = $('#toast'); t.textContent = msg; t.className = 'show ' + kind; clearTimeout(toastT); toastT = setTimeout(() => t.className = '', 2600); }
function modal(html, cls = '') {
  const el = document.createElement('div'); el.className = 'overlay';
  el.innerHTML = `<div class="dialog ${cls}" role="dialog">${html}</div>`;
  $('#modal-root').appendChild(el);
  el.addEventListener('mousedown', e => { if (e.target === el) closeModal(el); });
  requestAnimationFrame(() => el.classList.add('show'));
  return el;
}
function closeModal(el) { el = el || [...$$('.overlay')].pop(); if (!el) return; el.classList.remove('show'); setTimeout(() => el.remove(), 200); }
function confirmDlg(msg, okLabel, cb, danger = true) {
  const m = modal(`<div class="dh"><h2>¿Confirmar?</h2></div><p style="margin-bottom:6px">${msg}</p>
    <div class="dfoot"><button class="btn ghost" data-act="close">Cancelar</button><button class="btn ${danger ? 'danger' : ''}" id="cf-ok">${esc(okLabel)}</button></div>`);
  $('#cf-ok', m).onclick = () => { closeModal(m); cb(); };
}
const dh = (t, extra = '') => `<div class="dh"><h2>${t}</h2>${extra}<button class="iconbtn" data-act="close" aria-label="Cerrar">${ic('x')}</button></div>`;

/* ---------- archivos: guardar / compartir / imprimir ---------- */
function blobToB64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); }); }
async function saveFile(name, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const cap = window.Capacitor;
  if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.Filesystem && cap.Plugins.Share) {
    try {
      const r = await cap.Plugins.Filesystem.writeFile({ path: name, data: await blobToB64(blob), directory: 'CACHE' });
      await cap.Plugins.Share.share({ title: name, url: r.uri, dialogTitle: 'Guardar o compartir' });
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('No se pudo guardar: ' + (e.message || e), 'err'); }
    return;
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Archivo generado: ' + name, 'ok');
}
const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
function printHTML(html, nameIfNative) {
  if (isNative()) { saveFile(nameIfNative || 'documento.html', html, 'text/html'); return; }
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  f.srcdoc = html;
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('No se pudo imprimir', 'err'); } setTimeout(() => f.remove(), 60000); };
}
function openWA(phone, text) {
  const p = digits(phone);
  window.open(`https://wa.me/${p}?text=${encodeURIComponent(text)}`, '_blank');
}
async function fileToDataURL(file, max = 640, q = 0.74) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  } finally { URL.revokeObjectURL(url); }
}
function pickImage(cb, max) {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
  i.onchange = async () => { if (i.files[0]) { try { cb(await fileToDataURL(i.files[0], max)); } catch { toast('No se pudo leer la imagen', 'err'); } } };
  i.click();
}

/* ---------- tema ---------- */
function shade(hex, f) { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * f)))); return '#' + c.map(v => pad(v.toString(16))).join(''); }
function inkFor(hex) { const n = parseInt(hex.slice(1), 16); const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)); return l > 175 ? '#0f172a' : '#ffffff'; }
/* ---------- temas por tienda ---------- */
const BIZ_A = (window.BIZ && BIZ.assets) || {};
const THEMES = {
  tesanz: { n: 'Tesanz · Vino y crema', brand: true, serif: true, color: '#74204A', bg: '#F5F1EA', side: '#3B0F24', ink: '#2B1520', text: '#3A2A31', muted: '#85737A', line: '#E8DFD4', lockA: '#74204A', lockB: '#2E0A1B', full: BIZ_A.full, wide: BIZ_A.wide, mark: BIZ_A.mark },
  indigo: { n: 'Índigo', color: '#4F46E5', bg: '#F4F5F9', side: '#0F172A' },
  esmeralda: { n: 'Esmeralda', color: '#0F766E', bg: '#F1F6F5', side: '#0B2B28' },
  rosa: { n: 'Rosa', color: '#BE185D', bg: '#FBF3F6', side: '#3B0A21' },
  dorado: { n: 'Dorado', color: '#B45309', bg: '#FAF6EE', side: '#2B1A08' },
  azul: { n: 'Azul marino', color: '#1D4ED8', bg: '#F2F5FB', side: '#0B1B3F' }
};
const themeOf = () => THEMES[S.config.tema] || THEMES.indigo;
const accent = () => themeOf().color;
const logoPrint = () => S.config.logo || themeOf().wide || '';
const markHTML = () => { const src = S.config.logo || themeOf().mark; return src ? `<img src="${src}" alt="">` : esc(initials(S.config.nombre)); };
function applyTheme() {
  const th = themeOf(), c = th.color, st = document.documentElement.style, n = parseInt(c.slice(1), 16);
  const V = { '--accent': c, '--accent-dark': shade(c, .82), '--accent-ink': inkFor(c), '--accent-soft': `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},.11)`, '--bg': th.bg, '--side': th.side, '--ink': th.ink || '#0f172a', '--text': th.text || '#1e293b', '--muted': th.muted || '#64748b', '--line': th.line || '#e8eaf0', '--lock-a': th.lockA || c, '--lock-b': th.lockB || th.side };
  for (const k in V) st.setProperty(k, V[k]);
  document.documentElement.classList.toggle('serif-brand', !!th.serif);
  document.querySelector('meta[name=theme-color]').content = c;
  const custom = S.config.logo, sb = $('#side-brand');
  if (th.full && !custom) { sb.className = 'brand full'; sb.innerHTML = `<img src="${th.full}" alt="${esc(S.config.nombre)}"><div class="bs">Control de negocio</div>`; }
  else { sb.className = 'brand'; sb.innerHTML = `<div class="logo">${markHTML()}</div><div><div class="bn">${esc(S.config.nombre)}</div><div class="bs">Control de negocio</div></div>`; }
  const tl = $('#top-logo'); tl.className = 'logo' + (!custom && th.mark ? ' mark' : ''); tl.innerHTML = markHTML();
  $('#side-foot').innerHTML = esc(S.config.nombre) + '<br>Funciona sin internet<div class="dev">Desarrollado por<br>Analista de sistemas Eber Romero</div>';
  document.title = S.config.nombre + ' — Gestor de Tienda';
  if (window.L && L.tema !== S.config.tema) { L.tema = S.config.tema; L.nombre = S.config.nombre; if (typeof saveLocal === 'function') saveLocal(); }
}

/* ---------- datos: helpers de dominio ---------- */
const prod = id => S.productos.find(p => p.id === id);
const cliente = id => S.clientes.find(c => c.id === id);
const factura = id => S.facturas.find(f => f.id === id);
const activas = () => S.facturas.filter(f => f.estado !== 'ANULADA');
const pagado = f => r2(sum(f.abonos.map(a => a.monto)));
const saldo = f => f.estado === 'ANULADA' ? 0 : Math.max(0, r2(f.total - pagado(f)));
const vencida = f => f.estado !== 'ANULADA' && saldo(f) > 0 && f.vence && f.vence < todayStr();
const deudaCliente = id => r2(sum(activas().filter(f => f.clienteId === id).map(saldo)));
const stockBadge = p => p.stock <= 0 ? ['bad', 'Agotado'] : p.stock <= (p.minimo || 0) ? ['warn', p.stock + ' uds · bajo'] : ['ok', p.stock + ' uds'];
function nextNum() { let mx = 0; for (const f of S.facturas) { const k = parseInt(String(f.num).replace(/\D/g, '')) || 0; if (k > mx) mx = k; } return 'F-' + String(mx + 1).padStart(6, '0'); }
function logMov(p, delta, motivo) { S.movs.unshift({ id: uid(), fecha: new Date().toISOString(), pid: p.id, nombre: p.nombre, delta, motivo, stock: p.stock }); if (S.movs.length > 3000) S.movs.length = 3000; }
const thumb = (p, big) => p.imagenes && p.imagenes[0] ? `<img src="${p.imagenes[0]}" alt="" loading="lazy">` : `<div class="ph" style="background:${grad(p.nombre)}">${esc(initials(p.nombre))}</div>`;

/* ---------- navegación ---------- */
const ROUTES = {
  inicio: { t: 'Inicio', i: 'home', v: vInicio },
  inventario: { t: 'Inventario', i: 'box', v: vInventario, after: renderInvList },
  vender: { t: 'Vender', n: 'Vender', i: 'receipt', v: vVender, after: () => { renderPosGrid(); renderCart(); } },
  creditos: { t: 'Créditos y clientes', n: 'Créditos', i: 'wallet', v: vCreditos, after: renderClientes },
  historial: { t: 'Historial', i: 'history', v: vHistorial, after: renderHistorial },
  catalogo: { t: 'Catálogo digital', n: 'Catálogo', i: 'catalog', v: vCatalogo, after: renderQR },
  ajustes: { t: 'Ajustes', i: 'settings', v: vAjustes, after: () => { if (isOwner()) loadTeam(); } },
  mas: { t: 'Más opciones', n: 'Más', i: 'more', v: vMas }
};
const SIDE = ['inicio', 'inventario', 'vender', 'creditos', 'historial', 'catalogo', 'ajustes'];
const TABS = ['inicio', 'inventario', 'vender', 'creditos', 'mas'];
function buildNav() {
  $('#side-nav').innerHTML = SIDE.map(k => `<a data-act="go" data-r="${k}" data-nav="${k}">${ic(ROUTES[k].i)}<span>${ROUTES[k].n || ROUTES[k].t}</span></a>`).join('');
  $('#tabbar').innerHTML = TABS.map(k => k === 'vender'
    ? `<a class="fab" data-act="go" data-r="vender" data-nav="vender"><span class="fabi">${ic('receipt')}</span><span style="margin-top:-2px">Vender</span></a>`
    : `<a data-act="go" data-r="${k}" data-nav="${k}">${ic(ROUTES[k].i)}<span>${ROUTES[k].n || ROUTES[k].t}</span></a>`).join('');
  $('#top-sell').innerHTML = ic('plus') + ' Nueva venta';
}
const go = r => { if (location.hash === '#' + r) render(); else location.hash = r; };
addEventListener('hashchange', () => { if (!$('#lock').classList.contains('gone')) return; render(); });
function render() {
  const key = (location.hash || '#inicio').slice(1); const R = ROUTES[key] || ROUTES.inicio;
  $('#title').textContent = R.t; $('#view').innerHTML = R.v();
  const act = ['historial', 'catalogo', 'ajustes', 'mas'].includes(key) ? (key === 'mas' ? 'mas' : 'mas') : key;
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === key || (a.closest('#tabbar') && a.dataset.nav === act)));
  $('#top-date').textContent = new Date().toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' });
  if (R.after) R.after();
  scrollTo(0, 0);
}

/* =====================================================================
   INICIO
   ===================================================================== */
function vInicio() {
  const hoy = todayStr(), mes = hoy.slice(0, 7), fs = activas();
  const ventasHoy = sum(fs.filter(f => ymd(f.fecha) === hoy).map(f => f.total));
  const ventasMes = sum(fs.filter(f => ymd(f.fecha).startsWith(mes)).map(f => f.total));
  const gananciaMes = sum(fs.filter(f => ymd(f.fecha).startsWith(mes)).map(f => f.ganancia || 0));
  const cobradoHoy = sum(fs.flatMap(f => f.abonos).filter(a => ymd(a.fecha) === hoy).map(a => a.monto));
  const porCobrar = sum(fs.map(saldo)), venc = sum(fs.filter(vencida).map(saldo));
  const invCosto = sum(S.productos.map(p => p.stock * p.costo)), invVenta = sum(S.productos.map(p => p.stock * p.precio));
  const unidades = sum(S.productos.map(p => p.stock));
  const dias = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); const k = ymd(d.toISOString()); return { k, l: d.toLocaleDateString('es-VE', { weekday: 'short' }).replace('.', ''), t: sum(fs.filter(f => ymd(f.fecha) === k).map(f => f.total)), hoy: i === 6 }; });
  const mx = Math.max(...dias.map(d => d.t), 1);
  const corte = Date.now() - 30 * 864e5, tp = {};
  fs.filter(f => new Date(f.fecha) >= corte).forEach(f => f.items.forEach(i => { tp[i.nombre] = (tp[i.nombre] || 0) + i.qty; }));
  const top = Object.entries(tp).sort((a, b) => b[1] - a[1]).slice(0, 5), tmax = top[0] ? top[0][1] : 1;
  const bajos = S.productos.filter(p => p.stock <= (p.minimo || 0)).sort((a, b) => a.stock - b.stock).slice(0, 6);
  const h = new Date().getHours(), sal = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const vacio = !S.productos.length;
  return `
  <div style="margin-bottom:16px"><div class="muted small">${sal} 👋</div><div style="font-size:22px;font-weight:800;color:var(--ink);letter-spacing:-.3px">${esc(S.config.nombre)}</div></div>
  ${vacio ? `<div class="card" style="background:linear-gradient(135deg,var(--accent),var(--accent-dark));color:var(--accent-ink)">
    <h3 style="color:inherit">🚀 Empieza ahora</h3><p style="opacity:.9;margin-bottom:14px">Aún no tienes productos. Registra tu primer artículo o carga datos de ejemplo para conocer el sistema.</p>
    <div class="row wrap"><button class="btn" style="background:#fff;color:var(--ink)" data-act="prodNew">${ic('plus')} Agregar producto</button><button class="btn ghost" style="background:rgba(255,255,255,.18);color:#fff;border-color:transparent" data-act="demo">Cargar datos de ejemplo</button></div></div>` : ''}
  <div class="kpis">
    <div class="kpi hero"><span class="ico">${ic('trend')}</span><div class="kl">Ventas de hoy</div><div class="kv">${money(ventasHoy)}</div><div class="ks">Cobrado hoy: ${money(cobradoHoy)}</div></div>
    <div class="kpi"><span class="ico">${ic('calendar')}</span><div class="kl">Ventas del mes</div><div class="kv">${money(ventasMes)}</div><div class="ks">${isOwner() ? 'Ganancia: ' + money(gananciaMes) : '&nbsp;'}</div></div>
    <div class="kpi"><span class="ico" style="background:var(--warn-soft);color:var(--warn)">${ic('wallet')}</span><div class="kl">Por cobrar</div><div class="kv">${money(porCobrar)}</div><div class="ks">${venc > 0 ? `<span style="color:var(--bad);font-weight:700">${money(venc)} vencido</span>` : 'Sin vencidos'}</div></div>
    <div class="kpi"><span class="ico">${ic('box')}</span><div class="kl">Inventario</div><div class="kv">${money(invVenta)}</div><div class="ks">${NF.format(unidades).replace(/,00$/, '')} uds${isOwner() ? ' · costo ' + money(invCosto) : ''}</div></div>
  </div>
  <div class="cols c2">
    <div>
      <div class="card"><h3>${ic('trend')} Ventas de los últimos 7 días</h3>
        <div class="bars">${dias.map(d => `<div class="bar ${d.hoy ? 'today' : ''}"><em>${d.t ? S.config.moneda + Math.round(d.t) : ''}</em><i style="height:${Math.max(3, d.t / mx * 100)}%"></i><span>${d.l}</span></div>`).join('')}</div></div>
      <div class="card"><h3>${ic('receipt')} Últimas facturas <span class="sp"></span><button class="btn sm ghost" data-act="go" data-r="historial">Ver todo</button></h3>
        <div class="list">${S.facturas.slice(0, 6).map(facRow).join('') || '<div class="empty">' + ic('receipt') + '<b>Sin ventas todavía</b>Tus facturas aparecerán aquí.</div>'}</div></div>
    </div>
    <div>
      <div class="card"><h3>${ic('alert')} Stock bajo</h3>
        <div class="list">${bajos.map(p => { const [k, t] = stockBadge(p); return `<div class="li" data-act="prodEdit" data-id="${p.id}"><div class="av" style="background:${grad(p.nombre)};overflow:hidden;padding:0">${p.imagenes && p.imagenes[0] ? `<img src="${p.imagenes[0]}" style="width:100%;height:100%;object-fit:cover">` : esc(initials(p.nombre))}</div><div class="mid"><div class="t">${esc(p.nombre)}</div><div class="s">${esc(p.categoria)} · mínimo ${p.minimo || 0}</div></div><span class="badge ${k}">${t}</span></div>`; }).join('') || '<div class="empty" style="padding:18px">✅ Todo el inventario está en orden.</div>'}</div></div>
      <div class="card"><h3>${ic('tag')} Más vendidos (30 días)</h3>
        ${top.map(([n, q]) => `<div style="margin-bottom:11px"><div class="row" style="justify-content:space-between"><span class="b" style="font-size:13.5px">${esc(n)}</span><span class="muted small">${q} uds</span></div><div class="prog"><i style="width:${q / tmax * 100}%"></i></div></div>`).join('') || '<div class="empty" style="padding:18px">Aún no hay datos.</div>'}</div>
    </div>
  </div>`;
}
function facRow(f) {
  const s = saldo(f), est = f.estado === 'ANULADA' ? ['gray', 'Anulada'] : s > 0 ? [vencida(f) ? 'bad' : 'warn', vencida(f) ? 'Vencida' : 'Pendiente'] : ['ok', 'Pagada'];
  return `<div class="li" data-act="facView" data-id="${f.id}"><div class="av" style="background:${f.tipo === 'CREDITO' ? 'var(--info)' : 'var(--ok)'}">${ic(f.tipo === 'CREDITO' ? 'wallet' : 'receipt')}</div>
    <div class="mid"><div class="t">${esc(f.clienteNombre)}</div><div class="s">${f.num} · ${fdt(f.fecha)}</div></div>
    <div class="end"><div class="amt" ${f.estado === 'ANULADA' ? 'style="text-decoration:line-through;opacity:.5"' : ''}>${money(f.total)}</div><span class="badge ${est[0]}">${est[1]}</span></div></div>`;
}

/* =====================================================================
   INVENTARIO
   ===================================================================== */
let invQ = '', invCat = 'Todas';
function vInventario() {
  const bajos = S.productos.filter(p => p.stock <= (p.minimo || 0)).length;
  return `
  <div class="kpis">
    <div class="kpi"><span class="ico">${ic('box')}</span><div class="kl">Productos</div><div class="kv">${S.productos.length}</div><div class="ks">${S.categorias.length} categorías</div></div>
    <div class="kpi"><span class="ico">${ic('tag')}</span><div class="kl">Unidades</div><div class="kv">${sum(S.productos.map(p => p.stock))}</div><div class="ks">en existencia</div></div>
    <div class="kpi"><span class="ico">${ic('wallet')}</span><div class="kl">Valor a precio venta</div><div class="kv">${money(sum(S.productos.map(p => p.stock * p.precio)))}</div><div class="ks">${isOwner() ? 'Costo: ' + money(sum(S.productos.map(p => p.stock * p.costo))) : '&nbsp;'}</div></div>
    <div class="kpi"><span class="ico" style="background:var(--warn-soft);color:var(--warn)">${ic('alert')}</span><div class="kl">Stock bajo</div><div class="kv">${bajos}</div><div class="ks">requieren reposición</div></div>
  </div>
  <div class="row wrap" style="margin-bottom:10px">
    <div class="searchbox" style="min-width:200px">${ic('search')}<input class="in" id="inv-q" data-input="invQ" placeholder="Buscar por nombre, código o categoría…" value="${esc(invQ)}"></div>
    <button class="btn" data-act="prodNew">${ic('plus')} Nuevo producto</button>
    <button class="btn ghost" data-act="catMgr">${ic('tag')} Categorías</button>
  </div>
  <div class="chips" id="inv-chips"></div>
  <div class="pgrid" id="inv-list"></div>`;
}
function renderInvList() {
  const cats = ['Todas', ...S.categorias];
  if ($('#inv-chips')) $('#inv-chips').innerHTML = cats.map(c => `<button class="chip ${invCat === c ? 'active' : ''}" data-act="invCat" data-c="${esc(c)}">${esc(c)}</button>`).join('');
  const q = invQ.trim().toLowerCase();
  const list = S.productos.filter(p => (invCat === 'Todas' || p.categoria === invCat) && (!q || (p.nombre + ' ' + p.sku + ' ' + p.categoria + ' ' + (p.variante || '')).toLowerCase().includes(q)));
  if (!$('#inv-list')) return;
  $('#inv-list').innerHTML = list.map(p => { const [k, t] = stockBadge(p); return `
    <div class="pcard" data-act="prodEdit" data-id="${p.id}"><div class="pimg">${thumb(p)}<span class="badge ${k}">${t}</span>${p.catalogo === false ? '<span class="hidecat">Oculto</span>' : ''}</div>
    <div class="pbody"><div class="pname">${esc(p.nombre)}</div><div class="pmeta">${esc(p.categoria)}${p.variante ? ' · ' + esc(p.variante) : ''}</div><div class="pprice">${money(p.precio)}<small>${isOwner() ? 'costo ' + money(p.costo) : ''}</small></div></div></div>`; }).join('')
    || `<div class="empty" style="grid-column:1/-1">${ic('box')}<b>${S.productos.length ? 'Sin resultados' : 'Tu inventario está vacío'}</b>${S.productos.length ? 'Prueba con otra búsqueda o categoría.' : 'Agrega tu primer producto con foto, precio y existencia.'}</div>`;
}
let tmpImgs = [];
function prodModal(id) {
  const p = id ? prod(id) : null;
  tmpImgs = p ? [...(p.imagenes || [])] : [];
  const m = modal(`${dh(p ? 'Editar producto' : 'Nuevo producto')}
    <div class="f"><label class="l">Fotos referenciales (hasta 3)</label><div class="imgs" id="pm-imgs"></div></div>
    <div class="f"><label class="l">Nombre del producto *</label><input class="in" id="pm-nombre" value="${esc(p?.nombre || '')}" placeholder="Ej. Camisa lino manga larga"></div>
    <div class="row"><div class="f"><label class="l">Categoría</label><select class="in" id="pm-cat">${S.categorias.map(c => `<option ${p?.categoria === c ? 'selected' : ''}>${esc(c)}</option>`).join('') || '<option>General</option>'}</select></div>
      <div class="f"><label class="l">Código / SKU</label><input class="in" id="pm-sku" value="${esc(p?.sku || '')}" placeholder="Automático"></div></div>
    <div class="f"><label class="l">Talla / color / variante</label><input class="in" id="pm-var" value="${esc(p?.variante || '')}" placeholder="Ej. M · Azul marino"></div>
    <div class="row"><div class="f ${isOwner() ? '' : 'hide'}"><label class="l">Costo (${esc(S.config.moneda)})</label><input class="in" type="number" step="0.01" min="0" inputmode="decimal" id="pm-costo" data-input="pmCalc" value="${p ? p.costo : ''}" placeholder="0.00"></div>
      <div class="f ${isOwner() ? '' : 'hide'}"><label class="l">% ganancia</label><input class="in" type="number" step="1" id="pm-margen" data-input="pmCalc" value="${p ? p.margen : 40}"></div>
      <div class="f"><label class="l">Precio venta</label><input class="in" type="number" step="0.01" min="0" inputmode="decimal" id="pm-precio" data-input="pmCalc" value="${p ? p.precio : ''}" placeholder="0.00"></div></div>
    <div class="row"><div class="f"><label class="l">Existencia (unidades)</label><input class="in" type="number" step="1" min="0" inputmode="numeric" id="pm-stock" value="${p ? p.stock : 1}"></div>
      <div class="f"><label class="l">Alerta de stock bajo</label><input class="in" type="number" step="1" min="0" inputmode="numeric" id="pm-min" value="${p ? p.minimo : 2}"></div></div>
    <div class="f"><label class="l">Descripción (se muestra en el catálogo)</label><textarea class="in" id="pm-desc" placeholder="Material, características, cuidados…">${esc(p?.desc || '')}</textarea></div>
    <label class="row" style="margin-bottom:6px;cursor:pointer"><input type="checkbox" id="pm-cat-on" style="width:20px;height:20px;accent-color:var(--accent)" ${p?.catalogo === false ? '' : 'checked'}><span class="b">Mostrar en el catálogo digital</span></label>
    <div class="dfoot">${p ? `<button class="btn danger" style="flex:0 0 auto" data-act="prodDel" data-id="${p.id}">${ic('trash')}</button>` : ''}<button class="btn ghost" data-act="close">Cancelar</button><button class="btn" data-act="prodSave" data-id="${p ? p.id : ''}">${ic('check')} Guardar</button></div>`, 'wide');
  drawImgs();
  return m;
}
function drawImgs() {
  const box = $('#pm-imgs'); if (!box) return;
  let h = tmpImgs.map((s, i) => `<div class="slot has"><img src="${s}" alt=""><span class="rm" data-act="imgRm" data-i="${i}">${ic('x')}</span></div>`).join('');
  if (tmpImgs.length < 3) h += `<div class="slot" data-act="imgAdd">${ic('camera')}<br>Agregar foto</div>`;
  box.innerHTML = h;
}
function pmCalc(e) {
  const costo = num($('#pm-costo').value), mg = $('#pm-margen'), pr = $('#pm-precio');
  if (e.target.id === 'pm-precio') { if (costo > 0) mg.value = Math.round((num(pr.value) / costo - 1) * 100); }
  else pr.value = costo > 0 ? r2(costo * (1 + num(mg.value) / 100)) : pr.value;
}
function prodSave(id) {
  const nombre = $('#pm-nombre').value.trim(); if (!nombre) return toast('Escribe el nombre del producto', 'err');
  const costo = num($('#pm-costo').value), precio = num($('#pm-precio').value);
  if (precio <= 0) return toast('Indica el precio de venta', 'err');
  const stock = Math.max(0, Math.floor(num($('#pm-stock').value)));
  const data = { nombre, categoria: $('#pm-cat').value, sku: $('#pm-sku').value.trim(), variante: $('#pm-var').value.trim(), costo, margen: num($('#pm-margen').value), precio, stock, minimo: Math.max(0, Math.floor(num($('#pm-min').value))), desc: $('#pm-desc').value.trim(), imagenes: [...tmpImgs], catalogo: $('#pm-cat-on').checked };
  if (id) {
    const p = prod(id), antes = p.stock; Object.assign(p, data);
    if (stock !== antes) logMov(p, stock - antes, stock > antes ? 'Ingreso de mercancía' : 'Ajuste de inventario');
  } else {
    const p = { id: uid(), fecha: new Date().toISOString(), ...data };
    if (!p.sku) p.sku = 'P' + String(S.productos.length + 1).padStart(4, '0');
    S.productos.unshift(p); if (stock > 0) logMov(p, stock, 'Ingreso inicial');
  }
  save(); closeModal(); toast('Producto guardado', 'ok'); render();
}
function catMgr() {
  const m = modal(`${dh('Categorías')}<div id="cm-list"></div>
    <div class="row" style="margin-top:12px"><input class="in" id="cm-new" placeholder="Nueva categoría (Ej. Niños)"><button class="btn" data-act="catAdd" style="flex:none">${ic('plus')}</button></div>
    <div class="dfoot"><button class="btn" data-act="close">Listo</button></div>`);
  drawCats();
}
function drawCats() {
  const b = $('#cm-list'); if (!b) return;
  b.innerHTML = S.categorias.map((c, i) => `<div class="row" style="margin-bottom:8px"><input class="in" value="${esc(c)}" data-input="catRename" data-i="${i}"><span class="muted small" style="flex:none;min-width:58px;text-align:center">${S.productos.filter(p => p.categoria === c).length} prod.</span><button class="iconbtn bad" data-act="catDel" data-i="${i}">${ic('trash')}</button></div>`).join('') || '<div class="empty" style="padding:14px">Sin categorías</div>';
}

/* =====================================================================
   VENDER / FACTURAR (punto de venta)
   ===================================================================== */
let cart = { items: [], clienteId: '', desc: 0, tipo: 'CONTADO', metodo: 'Efectivo', abono: 0, vence: '' }, posQ = '', posCat = 'Todas';
const METODOS = ['Efectivo', 'Transferencia', 'Pago móvil', 'Tarjeta', 'Divisas', 'Otro'];
const resetCart = () => { cart = { items: [], clienteId: '', desc: 0, tipo: 'CONTADO', metodo: 'Efectivo', abono: 0, vence: '' }; };
function vVender() {
  return `<div class="pos"><div>
    <div class="row wrap" style="margin-bottom:8px"><div class="searchbox" style="min-width:180px">${ic('search')}<input class="in" data-input="posQ" placeholder="Buscar producto o código…" value="${esc(posQ)}"></div></div>
    <div class="chips" id="pos-chips"></div><div class="pgrid" id="pos-grid"></div></div>
    <aside class="pos-cart" id="pos-cart"></aside></div>
    <button class="cart-fab" id="cart-fab" data-act="cartToggle"><span><span class="n" id="fab-n">0</span>Ver cuenta</span><span id="fab-t">${money(0)}</span></button>`;
}
function renderPosGrid() {
  if (!$('#pos-grid')) return;
  $('#pos-chips').innerHTML = ['Todas', ...S.categorias].map(c => `<button class="chip ${posCat === c ? 'active' : ''}" data-act="posCat" data-c="${esc(c)}">${esc(c)}</button>`).join('');
  const q = posQ.trim().toLowerCase();
  const list = S.productos.filter(p => (posCat === 'Todas' || p.categoria === posCat) && (!q || (p.nombre + ' ' + p.sku + ' ' + (p.variante || '')).toLowerCase().includes(q)));
  $('#pos-grid').innerHTML = list.map(p => {
    const inCart = (cart.items.find(i => i.pid === p.id) || {}).qty || 0, [k, t] = stockBadge(p);
    return `<div class="pcard ${p.stock <= 0 ? 'sold' : ''} ${inCart ? 'incart' : ''}" data-act="cartAdd" data-id="${p.id}"><div class="pimg">${thumb(p)}${inCart ? `<span class="qtybadge">${inCart}</span>` : `<span class="badge ${k}">${t}</span>`}</div>
    <div class="pbody"><div class="pname">${esc(p.nombre)}</div><div class="pmeta">${esc(p.variante || p.categoria)}</div><div class="pprice">${money(p.precio)}</div></div></div>`;
  }).join('') || `<div class="empty" style="grid-column:1/-1">${ic('box')}<b>${S.productos.length ? 'Sin resultados' : 'No hay productos'}</b>${S.productos.length ? '' : 'Agrega productos en Inventario para poder vender.'}</div>`;
}
function cartCalc() {
  const lines = cart.items.map(i => { const p = prod(i.pid); return p ? { ...i, p, tot: r2(p.precio * i.qty) } : null; }).filter(Boolean);
  const subtotal = r2(sum(lines.map(l => l.tot))), pct = Math.min(100, Math.max(0, num(cart.desc))), desc = r2(subtotal * pct / 100), total = r2(subtotal - desc);
  const abono = cart.tipo === 'CREDITO' ? Math.min(total, Math.max(0, r2(num(cart.abono)))) : total;
  return { lines, subtotal, pct, desc, total, abono, saldo: r2(total - abono), n: sum(lines.map(l => l.qty)) };
}
function renderCart() {
  const el = $('#pos-cart'); if (!el) return;
  const c = cartCalc();
  el.innerHTML = `<div class="dh" style="margin-bottom:8px"><h2 style="font-size:17px">${ic('receipt')} Cuenta actual</h2>${c.n ? `<button class="btn sm danger" data-act="cartClear">Vaciar</button>` : ''}<button class="iconbtn cart-close" data-act="cartToggle" style="display:none">${ic('x')}</button></div>
  <div>${c.lines.map(l => `<div class="cl"><div class="th">${thumb(l.p)}</div><div class="nm">${esc(l.p.nombre)}<small>${money(l.p.precio)} c/u${l.p.variante ? ' · ' + esc(l.p.variante) : ''}</small></div>
    <div style="text-align:right"><div class="step"><button data-act="cartQty" data-id="${l.pid}" data-d="-1">−</button><b>${l.qty}</b><button data-act="cartQty" data-id="${l.pid}" data-d="1">+</button></div><div class="b small" style="margin-top:3px">${money(l.tot)}</div></div></div>`).join('')
    || `<div class="empty" style="padding:22px 6px">${ic('cart')}<b>Cuenta vacía</b>Toca los productos para agregarlos.</div>`}</div>
  <div class="f" style="margin-top:12px"><label class="l">Cliente</label><div class="row"><select class="in" id="cart-cli" data-input="cartCli"><option value="">Cliente de mostrador</option>${S.clientes.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(x => `<option value="${x.id}" ${cart.clienteId === x.id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select><button class="btn soft" style="flex:none;padding:11px 13px" data-act="cliNew" data-pos="1">${ic('plus')}</button></div></div>
  <div class="seg" style="margin-bottom:12px"><button class="${cart.tipo === 'CONTADO' ? 'active' : ''}" data-act="cartTipo" data-t="CONTADO">💵 Contado</button><button class="${cart.tipo === 'CREDITO' ? 'active' : ''}" data-act="cartTipo" data-t="CREDITO">🤝 A crédito</button></div>
  <div class="row"><div class="f"><label class="l">Descuento (%)</label><input class="in" type="number" min="0" max="100" inputmode="decimal" data-input="cartDesc" value="${cart.desc || ''}" placeholder="0"></div>
  ${cart.tipo === 'CONTADO' ? `<div class="f"><label class="l">Método de pago</label><select class="in" data-input="cartMetodo">${METODOS.map(m => `<option ${cart.metodo === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>` : `<div class="f"><label class="l">Vence el</label><input class="in" type="date" data-input="cartVence" value="${cart.vence}"></div>`}</div>
  ${cart.tipo === 'CREDITO' ? `<div class="row"><div class="f"><label class="l">Abono inicial (opcional)</label><input class="in" type="number" min="0" step="0.01" inputmode="decimal" data-input="cartAbono" value="${cart.abono || ''}" placeholder="0.00"></div><div class="f"><label class="l">Método del abono</label><select class="in" data-input="cartMetodo">${METODOS.map(m => `<option ${cart.metodo === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div></div>` : ''}
  <div class="totals" id="cart-totals"></div>
  <button class="btn block ${cart.tipo === 'CREDITO' ? '' : 'ok'}" id="cart-go" data-act="checkout" style="padding:15px;font-size:16px"></button>`;
  updateTotals();
}
function updateTotals() {
  const c = cartCalc(), t = $('#cart-totals'); if (!t) return;
  t.innerHTML = `<div class="tr"><span>Subtotal (${c.n} art.)</span><span>${money(c.subtotal)}</span></div>${c.pct ? `<div class="tr"><span>Descuento ${c.pct}%</span><span>−${money(c.desc)}</span></div>` : ''}
    ${cart.tipo === 'CREDITO' ? `<div class="tr"><span>Abono inicial</span><span>−${money(c.abono)}</span></div>` : ''}
    <div class="tr big"><span>${cart.tipo === 'CREDITO' ? 'Saldo a crédito' : 'Total a cobrar'}</span><span>${money(cart.tipo === 'CREDITO' ? c.saldo : c.total)}</span></div>`;
  const b = $('#cart-go'); if (b) { b.innerHTML = (cart.tipo === 'CREDITO' ? ic('wallet') + ' Registrar venta a crédito' : ic('check') + ' Cobrar ' + money(c.total)); b.disabled = !c.n; }
  const fn = $('#fab-n'); if (fn) { fn.textContent = c.n; $('#fab-t').textContent = money(c.total); }
}
function cartAdd(id) {
  const p = prod(id); if (!p) return; if (p.stock <= 0) return toast('Producto agotado', 'err');
  const it = cart.items.find(i => i.pid === id);
  if (it) { if (it.qty >= p.stock) return toast('Solo hay ' + p.stock + ' en existencia', 'err'); it.qty++; } else cart.items.push({ pid: id, qty: 1 });
  renderPosGrid(); renderCart();
}
function checkout() {
  const c = cartCalc(); if (!c.n) return;
  for (const l of c.lines) if (l.qty > l.p.stock) return toast(`Stock insuficiente de "${l.p.nombre}"`, 'err');
  const cli = cart.clienteId ? cliente(cart.clienteId) : null;
  if (cart.tipo === 'CREDITO' && !cli) return toast('Selecciona o crea un cliente para vender a crédito', 'err');
  const now = new Date().toISOString(), costoTot = sum(c.lines.map(l => l.p.costo * l.qty));
  const f = { id: uid(), num: nextNum(), fecha: now, clienteId: cli ? cli.id : '', clienteNombre: cli ? cli.nombre : 'Cliente de mostrador',
    items: c.lines.map(l => ({ pid: l.pid, nombre: l.p.nombre, variante: l.p.variante || '', precio: l.p.precio, costo: l.p.costo, qty: l.qty })),
    subtotal: c.subtotal, descPct: c.pct, desc: c.desc, total: c.total, tipo: cart.tipo, metodo: cart.metodo, vence: cart.tipo === 'CREDITO' ? cart.vence : '', abonos: [], estado: 'PAGADA', ganancia: r2(c.total - costoTot) };
  if (cart.tipo === 'CONTADO') f.abonos.push({ id: uid(), fecha: now, monto: c.total, metodo: cart.metodo, nota: 'Pago al contado' });
  else { if (c.abono > 0) f.abonos.push({ id: uid(), fecha: now, monto: c.abono, metodo: cart.metodo, nota: 'Abono inicial' }); f.estado = c.saldo > 0 ? 'PENDIENTE' : 'PAGADA'; }
  c.lines.forEach(l => { l.p.stock -= l.qty; logMov(l.p, -l.qty, 'Venta ' + f.num); });
  S.facturas.unshift(f); save(); resetCart(); $('#pos-cart')?.classList.remove('open');
  renderPosGrid(); renderCart(); facModal(f.id, true);
}

/* ---------- factura: vista, impresión, WhatsApp ---------- */
function facEstado(f) { const s = saldo(f); return f.estado === 'ANULADA' ? ['gray', 'ANULADA'] : s > 0 ? [vencida(f) ? 'bad' : 'warn', vencida(f) ? 'VENCIDA' : 'PENDIENTE'] : ['ok', 'PAGADA']; }
function facText(f) {
  const L = [`*${S.config.nombre}*`, S.config.idFiscal ? `ID fiscal: ${S.config.idFiscal}` : '', `Factura ${f.num}`, fdt(f.fecha), `Cliente: ${f.clienteNombre}`, '------------------------------'];
  f.items.forEach(i => L.push(`${i.qty} x ${i.nombre}${i.variante ? ' (' + i.variante + ')' : ''}  ${money(i.precio * i.qty)}`));
  L.push('------------------------------');
  if (f.descPct) L.push(`Descuento ${f.descPct}%: -${money(f.desc)}`);
  L.push(`*TOTAL: ${money(f.total)}*`);
  if (f.tipo === 'CREDITO') { L.push(`Abonado: ${money(pagado(f))}`, `*Saldo pendiente: ${money(saldo(f))}*`); if (f.vence) L.push(`Vence: ${fdate(f.vence + 'T12:00:00')}`); } else L.push(`Pagado (${f.metodo})`);
  if (S.config.pie) L.push('', S.config.pie);
  return L.filter((x, i) => x !== '' || i > 0).join('\n');
}
function facHTML(f) {
  const [, est] = facEstado(f), cli = cliente(f.clienteId), acc = accent();
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Factura ${f.num}</title><style>
  *{box-sizing:border-box}body{font-family:Segoe UI,Arial,sans-serif;color:#1e293b;margin:0;padding:34px;font-size:13px}
  .h{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${acc};padding-bottom:16px;margin-bottom:18px}
  .h img{height:58px;margin-bottom:6px;border-radius:8px}.h img.wide{height:92px;border-radius:0;margin:0 0 4px -4px}.h h1{margin:0;font-size:22px;color:#0f172a}.muted{color:#64748b}.r{text-align:right}
  .tag{display:inline-block;padding:3px 12px;border-radius:99px;background:${acc};color:#fff;font-weight:700;font-size:11px;letter-spacing:.6px}
  table{width:100%;border-collapse:collapse;margin:16px 0}th{background:#f1f5f9;text-align:left;padding:9px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:#475569}td{padding:9px 8px;border-bottom:1px solid #e8eaf0}
  .tot{margin-left:auto;width:290px}.tot div{display:flex;justify-content:space-between;padding:4px 0}.tot .big{font-size:18px;font-weight:800;border-top:2px solid #0f172a;margin-top:6px;padding-top:9px;color:${acc}}
  .ft{margin-top:34px;text-align:center;color:#64748b;border-top:1px dashed #cbd5e1;padding-top:14px}@page{margin:12mm}</style></head><body>
  <div class="h"><div>${logoPrint() ? `<img ${!S.config.logo ? 'class="wide" ' : ''}src="${logoPrint()}">` : ''}${!S.config.logo && themeOf().wide ? '' : `<h1>${esc(S.config.nombre)}</h1>`}<div class="muted">${esc(S.config.slogan)}</div><div class="muted">${esc(S.config.direccion)}${S.config.whatsapp ? ' · Tel. ' + esc(S.config.whatsapp) : ''}</div>${S.config.idFiscal ? `<div class="muted">ID fiscal: ${esc(S.config.idFiscal)}</div>` : ''}</div>
  <div class="r"><div class="tag">FACTURA</div><div style="font-size:20px;font-weight:800;margin:6px 0">${f.num}</div><div class="muted">${fdt(f.fecha)}</div><div style="margin-top:4px"><b>${est}</b> · ${f.tipo === 'CREDITO' ? 'Crédito' : 'Contado'}</div></div></div>
  <div><b>Cliente:</b> ${esc(f.clienteNombre)}${cli && cli.doc ? ' · ' + esc(cli.doc) : ''}${cli && cli.tel ? ' · ' + esc(cli.tel) : ''}${cli && cli.dir ? '<br><span class="muted">' + esc(cli.dir) + '</span>' : ''}</div>
  <table><thead><tr><th>Descripción</th><th class="r">Cant.</th><th class="r">Precio</th><th class="r">Importe</th></tr></thead><tbody>
  ${f.items.map(i => `<tr><td>${esc(i.nombre)}${i.variante ? `<br><span class="muted">${esc(i.variante)}</span>` : ''}</td><td class="r">${i.qty}</td><td class="r">${money(i.precio)}</td><td class="r">${money(i.precio * i.qty)}</td></tr>`).join('')}</tbody></table>
  <div class="tot"><div><span>Subtotal</span><span>${money(f.subtotal)}</span></div>${f.descPct ? `<div><span>Descuento ${f.descPct}%</span><span>−${money(f.desc)}</span></div>` : ''}<div class="big"><span>TOTAL</span><span>${money(f.total)}</span></div>
  ${f.tipo === 'CREDITO' ? `<div><span>Abonado</span><span>${money(pagado(f))}</span></div><div><b>Saldo pendiente</b><b>${money(saldo(f))}</b></div>${f.vence ? `<div><span>Vence</span><span>${fdate(f.vence + 'T12:00:00')}</span></div>` : ''}` : `<div><span>Pagado con</span><span>${esc(f.metodo)}</span></div>`}</div>
  ${f.abonos.length > 1 || (f.tipo === 'CREDITO' && f.abonos.length) ? `<div style="margin-top:14px"><b>Pagos registrados</b><table><tbody>${f.abonos.map(a => `<tr><td>${fdt(a.fecha)}</td><td>${esc(a.metodo)}</td><td class="r">${money(a.monto)}</td></tr>`).join('')}</tbody></table></div>` : ''}
  <div class="ft">${esc(S.config.pie)}<div class="dev" style="font-size:10px;color:#999">Desarrollado por Analista de sistemas Eber Romero</div></div></body></html>`;
}
function facModal(id, nueva) {
  const f = factura(id); if (!f) return; const [k, est] = facEstado(f), s = saldo(f), cli = cliente(f.clienteId);
  modal(`${dh((nueva ? '✅ ' : '') + 'Factura ' + f.num, `<span class="badge ${k}">${est}</span>`)}
    ${nueva ? `<div class="hint" style="margin-bottom:12px;background:var(--ok-soft);color:#065f46">${f.tipo === 'CREDITO' ? 'Venta a crédito registrada. El saldo quedó en la cuenta del cliente.' : 'Venta cobrada y registrada. El inventario fue descontado.'}</div>` : ''}
    <dl class="kv2" style="margin-bottom:12px"><dt>Fecha</dt><dd>${fdt(f.fecha)}</dd><dt>Cliente</dt><dd>${esc(f.clienteNombre)}</dd><dt>Tipo</dt><dd>${f.tipo === 'CREDITO' ? 'Crédito' : 'Contado · ' + esc(f.metodo)}</dd>${f.vence ? `<dt>Vence</dt><dd>${fdate(f.vence + 'T12:00:00')}</dd>` : ''}</dl>
    <table class="t"><thead><tr><th>Artículo</th><th class="r">Cant.</th><th class="r">Importe</th></tr></thead><tbody>${f.items.map(i => `<tr><td>${esc(i.nombre)}${i.variante ? `<br><span class="muted small">${esc(i.variante)}</span>` : ''}</td><td class="r">${i.qty}</td><td class="r">${money(i.precio * i.qty)}</td></tr>`).join('')}</tbody></table>
    <div class="totals">${f.descPct ? `<div class="tr"><span>Subtotal</span><span>${money(f.subtotal)}</span></div><div class="tr"><span>Descuento ${f.descPct}%</span><span>−${money(f.desc)}</span></div>` : ''}<div class="tr big"><span>Total</span><span>${money(f.total)}</span></div>
      ${f.tipo === 'CREDITO' ? `<div class="tr"><span>Abonado</span><span>${money(pagado(f))}</span></div><div class="tr b"><span>Saldo pendiente</span><span style="color:${s > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(s)}</span></div>` : ''}</div>
    ${f.abonos.length && f.tipo === 'CREDITO' ? `<div class="small muted b" style="margin-bottom:4px">PAGOS</div>${f.abonos.map(a => `<div class="row small" style="justify-content:space-between;padding:3px 0"><span>${fdt(a.fecha)} · ${esc(a.metodo)}</span><b>${money(a.monto)}</b></div>`).join('')}` : ''}
    <div class="dfoot">${s > 0 && f.clienteId ? `<button class="btn ok" data-act="abonoNew" data-id="${f.clienteId}" data-fid="${f.id}">${ic('wallet')} Abonar</button>` : ''}
      <button class="btn soft" data-act="facPrint" data-id="${f.id}">${ic('print')} ${isNative() ? 'Compartir factura' : 'Imprimir / PDF'}</button>
      <button class="btn soft" data-act="facWA" data-id="${f.id}">${ic('chat')} WhatsApp</button></div>
    <div class="dfoot" style="margin-top:8px">${f.estado !== 'ANULADA' ? `<button class="btn danger" data-act="facVoid" data-id="${f.id}">Anular factura</button>` : ''}<button class="btn ghost" data-act="close">Cerrar</button></div>`);
}
function facVoid(id) {
  const f = factura(id); if (!f || f.estado === 'ANULADA') return;
  confirmDlg(`Se anulará la factura <b>${f.num}</b>, se devolverán las unidades al inventario y se excluirá de los totales. Esta acción no se puede deshacer.`, 'Sí, anular', () => {
    f.items.forEach(i => { const p = prod(i.pid); if (p) { p.stock += i.qty; logMov(p, i.qty, 'Anulación ' + f.num); } });
    f.estado = 'ANULADA'; save(); $$('.overlay').forEach(o => closeModal(o)); toast('Factura anulada', 'ok'); render();
  });
}

/* =====================================================================
   CRÉDITOS Y CLIENTES
   ===================================================================== */
let cliQ = '';
function vCreditos() {
  const fs = activas(), por = sum(fs.map(saldo)), venc = sum(fs.filter(vencida).map(saldo)), n = S.clientes.filter(c => deudaCliente(c.id) > 0).length;
  return `<div class="kpis">
    <div class="kpi hero"><span class="ico">${ic('wallet')}</span><div class="kl">Total por cobrar</div><div class="kv">${money(por)}</div><div class="ks">${n} cliente${n === 1 ? '' : 's'} con saldo</div></div>
    <div class="kpi"><span class="ico" style="background:var(--bad-soft);color:var(--bad)">${ic('alert')}</span><div class="kl">Vencido</div><div class="kv" style="color:${venc ? 'var(--bad)' : 'inherit'}">${money(venc)}</div><div class="ks">${fs.filter(vencida).length} facturas</div></div>
    <div class="kpi"><span class="ico">${ic('users')}</span><div class="kl">Clientes</div><div class="kv">${S.clientes.length}</div><div class="ks">registrados</div></div>
    <div class="kpi"><span class="ico">${ic('receipt')}</span><div class="kl">Créditos abiertos</div><div class="kv">${fs.filter(f => saldo(f) > 0).length}</div><div class="ks">facturas pendientes</div></div></div>
  <div class="row wrap" style="margin-bottom:12px"><div class="searchbox" style="min-width:200px">${ic('search')}<input class="in" data-input="cliQ" placeholder="Buscar cliente…" value="${esc(cliQ)}"></div><button class="btn" data-act="cliNew">${ic('plus')} Nuevo cliente</button></div>
  <div class="card" style="padding:6px 14px"><div class="list" id="cli-list"></div></div>`;
}
function renderClientes() {
  const q = cliQ.trim().toLowerCase(), b = $('#cli-list'); if (!b) return;
  const list = S.clientes.filter(c => !q || (c.nombre + ' ' + (c.tel || '') + ' ' + (c.doc || '')).toLowerCase().includes(q)).map(c => ({ c, d: deudaCliente(c.id) })).sort((a, b) => b.d - a.d || a.c.nombre.localeCompare(b.c.nombre));
  b.innerHTML = list.map(({ c, d }) => { const v = activas().some(f => f.clienteId === c.id && vencida(f));
    return `<div class="li" data-act="cliView" data-id="${c.id}"><div class="av" style="background:${grad(c.nombre)}">${esc(initials(c.nombre))}</div><div class="mid"><div class="t">${esc(c.nombre)}</div><div class="s">${esc(c.tel || 'Sin teléfono')}${c.doc ? ' · ' + esc(c.doc) : ''}</div></div>
    <div class="end">${d > 0 ? `<div class="amt" style="color:${v ? 'var(--bad)' : 'var(--warn)'}">${money(d)}</div><span class="badge ${v ? 'bad' : 'warn'}">${v ? 'Vencido' : 'Debe'}</span>` : '<span class="badge ok">Al día</span>'}</div></div>`; }).join('')
    || `<div class="empty">${ic('users')}<b>${S.clientes.length ? 'Sin resultados' : 'Aún no hay clientes'}</b>${S.clientes.length ? '' : 'Registra a tus clientes para venderles a crédito y llevar su cuenta.'}</div>`;
}
function cliModal(id, fromPos) {
  const c = id ? cliente(id) : null;
  modal(`${dh(c ? 'Editar cliente' : 'Nuevo cliente')}
    <div class="f"><label class="l">Nombre completo *</label><input class="in" id="cm-nom" value="${esc(c?.nombre || '')}" placeholder="Ej. María Pérez"></div>
    <div class="row"><div class="f"><label class="l">Teléfono / WhatsApp</label><input class="in" id="cm-tel" inputmode="tel" value="${esc(c?.tel || '')}" placeholder="584141234567"></div><div class="f"><label class="l">Cédula / RIF</label><input class="in" id="cm-doc" value="${esc(c?.doc || '')}"></div></div>
    <div class="f"><label class="l">Dirección</label><input class="in" id="cm-dir" value="${esc(c?.dir || '')}"></div>
    <div class="hint small">Para enviar facturas y recordatorios por WhatsApp escribe el número con código de país y sin signos (ej. 584141234567).</div>
    <div class="dfoot">${c && !S.facturas.some(f => f.clienteId === c.id) ? `<button class="btn danger" style="flex:0 0 auto" data-act="cliDel" data-id="${c.id}">${ic('trash')}</button>` : ''}<button class="btn ghost" data-act="close">Cancelar</button><button class="btn" data-act="cliSave" data-id="${c ? c.id : ''}" data-pos="${fromPos ? 1 : ''}">${ic('check')} Guardar</button></div>`);
}
function cliSave(id, fromPos) {
  const nombre = $('#cm-nom').value.trim(); if (!nombre) return toast('Escribe el nombre', 'err');
  if (S.clientes.some(c => c.id !== id && c.nombre.toLowerCase() === nombre.toLowerCase())) return toast('Ya existe un cliente con ese nombre', 'err');
  const d = { nombre, tel: $('#cm-tel').value.trim(), doc: $('#cm-doc').value.trim(), dir: $('#cm-dir').value.trim() };
  let c; if (id) { c = cliente(id); Object.assign(c, d); (S.facturas.filter(f => f.clienteId === id)).forEach(f => f.clienteNombre = nombre); } else { c = { id: uid(), fecha: new Date().toISOString(), ...d }; S.clientes.push(c); }
  save(); closeModal(); if (fromPos) { cart.clienteId = c.id; renderCart(); } else render(); toast('Cliente guardado', 'ok');
}
function cliView(id) {
  const c = cliente(id); if (!c) return; const d = deudaCliente(id), pend = activas().filter(f => f.clienteId === id && saldo(f) > 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const todas = S.facturas.filter(f => f.clienteId === id).slice(0, 12);
  const pagos = activas().filter(f => f.clienteId === id).flatMap(f => f.abonos.map(a => ({ ...a, num: f.num }))).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 8);
  modal(`${dh(esc(c.nombre), `<button class="iconbtn" data-act="cliNew" data-id="${c.id}">${ic('edit')}</button>`)}
    <div class="totals" style="margin-top:0;display:flex;justify-content:space-between;align-items:center"><div><div class="muted small b">SALDO PENDIENTE</div><div style="font-size:26px;font-weight:800;color:${d > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(d)}</div></div><div class="small muted right">${esc(c.tel || 'Sin teléfono')}<br>${esc(c.doc || '')}</div></div>
    <div class="row wrap" style="margin-bottom:14px">${d > 0 ? `<button class="btn ok" style="flex:1" data-act="abonoNew" data-id="${c.id}">${ic('wallet')} Registrar abono</button><button class="btn soft" style="flex:1" data-act="cliRemind" data-id="${c.id}">${ic('chat')} Recordatorio</button>` : ''}<button class="btn ghost" style="flex:1" data-act="goSell" data-id="${c.id}">${ic('cart')} Nueva venta</button></div>
    ${pend.length ? `<div class="small muted b" style="margin-bottom:4px">FACTURAS PENDIENTES</div><div class="list" style="margin-bottom:12px">${pend.map(f => `<div class="li" data-act="facView" data-id="${f.id}" style="padding:10px 2px"><div class="mid"><div class="t">${f.num} · ${fdate(f.fecha)}</div><div class="s">${f.vence ? (vencida(f) ? '⚠️ Venció ' : 'Vence ') + fdate(f.vence + 'T12:00:00') : 'Sin fecha de vencimiento'} · Total ${money(f.total)}</div></div><div class="end amt" style="color:${vencida(f) ? 'var(--bad)' : 'var(--warn)'}">${money(saldo(f))}</div></div>`).join('')}</div>` : ''}
    ${pagos.length ? `<div class="small muted b" style="margin-bottom:4px">ÚLTIMOS PAGOS</div>${pagos.map(a => `<div class="row small" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)"><span>${fdt(a.fecha)} · ${esc(a.metodo)} · ${a.num}</span><b style="color:var(--ok)">+${money(a.monto)}</b></div>`).join('')}` : ''}
    ${todas.length ? `<div class="small muted b" style="margin:12px 0 4px">HISTORIAL DE COMPRAS</div><div class="list">${todas.map(facRow).join('')}</div>` : ''}
    <div class="dfoot"><button class="btn ghost" data-act="close">Cerrar</button></div>`, 'wide');
}
function abonoModal(cid, fid) {
  const c = cliente(cid), d = deudaCliente(cid), f = fid ? factura(fid) : null, max = f ? saldo(f) : d;
  modal(`${dh('Registrar abono')}<p class="muted" style="margin-bottom:12px"><b>${esc(c.nombre)}</b> · ${f ? 'Factura ' + f.num + ' · saldo ' : 'Deuda total '}<b>${money(max)}</b></p>
    <div class="f"><label class="l">Monto recibido</label><input class="in" id="ab-m" type="number" min="0" step="0.01" inputmode="decimal" value="${max}" style="font-size:22px;font-weight:800"></div>
    <div class="f"><label class="l">Método de pago</label><select class="in" id="ab-met">${METODOS.map(m => `<option>${m}</option>`).join('')}</select></div>
    <div class="f"><label class="l">Nota (opcional)</label><input class="in" id="ab-n" placeholder="Ej. Pago parcial semana 2"></div>
    ${!f ? '<div class="hint small">El abono se aplica primero a las facturas más antiguas.</div>' : ''}
    <div class="dfoot"><button class="btn ghost" data-act="close">Cancelar</button><button class="btn ok" data-act="abonoSave" data-id="${cid}" data-fid="${fid || ''}">${ic('check')} Confirmar pago</button></div>`);
}
function abonoSave(cid, fid) {
  let m = r2(num($('#ab-m').value)); const met = $('#ab-met').value, nota = $('#ab-n').value.trim();
  const fs = (fid ? [factura(fid)] : activas().filter(f => f.clienteId === cid && saldo(f) > 0).sort((a, b) => a.fecha.localeCompare(b.fecha)));
  const max = r2(sum(fs.map(saldo)));
  if (m <= 0) return toast('Indica el monto', 'err'); if (m > max + 0.004) return toast('El monto supera la deuda (' + money(max) + ')', 'err');
  const now = new Date().toISOString();
  for (const f of fs) { if (m <= 0.004) break; const a = Math.min(m, saldo(f)); f.abonos.push({ id: uid(), fecha: now, monto: r2(a), metodo: met, nota: nota || 'Abono' }); m = r2(m - a); if (saldo(f) <= 0.004) f.estado = 'PAGADA'; }
  save(); $$('.overlay').forEach(o => closeModal(o)); toast('Pago registrado', 'ok'); render(); setTimeout(() => cliView(cid), 230);
}
function remind(cid) {
  const c = cliente(cid), pend = activas().filter(f => f.clienteId === cid && saldo(f) > 0);
  const t = `Hola ${c.nombre} 👋, te escribimos de *${S.config.nombre}*.\nTienes un saldo pendiente de *${money(deudaCliente(cid))}*:\n` + pend.map(f => `• ${f.num} (${fdate(f.fecha)}): ${money(saldo(f))}${f.vence ? ' — vence ' + fdate(f.vence + 'T12:00:00') : ''}`).join('\n') + `\n\n¿Cuándo podemos coordinar tu pago? ¡Gracias!`;
  openWA(c.tel, t);
}

/* =====================================================================
   HISTORIAL
   ===================================================================== */
let hTab = 'facturas', hQ = '', hTipo = 'todas', hDesde = '', hHasta = '', hFiltrado = [];
function vHistorial() {
  return `<div class="seg" style="max-width:420px;margin-bottom:14px"><button class="${hTab === 'facturas' ? 'active' : ''}" data-act="hTab" data-t="facturas">Facturas</button><button class="${hTab === 'inv' ? 'active' : ''}" data-act="hTab" data-t="inv">Movimientos de inventario</button></div>
  <div class="row wrap" style="margin-bottom:12px"><div class="searchbox" style="min-width:200px">${ic('search')}<input class="in" data-input="hQ" placeholder="${hTab === 'facturas' ? 'Buscar N.º de factura o cliente…' : 'Buscar producto o motivo…'}" value="${esc(hQ)}"></div>
  ${hTab === 'facturas' ? `<select class="in" style="width:auto" data-input="hTipo"><option value="todas">Todas</option><option value="CONTADO" ${hTipo === 'CONTADO' ? 'selected' : ''}>Contado</option><option value="CREDITO" ${hTipo === 'CREDITO' ? 'selected' : ''}>Crédito</option><option value="PENDIENTE" ${hTipo === 'PENDIENTE' ? 'selected' : ''}>Con saldo</option><option value="ANULADA" ${hTipo === 'ANULADA' ? 'selected' : ''}>Anuladas</option></select>
  <input class="in" type="date" style="width:auto" data-input="hDesde" value="${hDesde}" title="Desde"><input class="in" type="date" style="width:auto" data-input="hHasta" value="${hHasta}" title="Hasta">
  <button class="btn ghost" data-act="exportCSV">${ic('download')} Exportar</button>` : ''}</div>
  <div class="card" style="padding:6px 14px"><div id="h-sum" class="small muted b" style="padding:10px 4px 4px"></div><div class="list" id="h-list"></div></div>`;
}
function renderHistorial() {
  const q = hQ.trim().toLowerCase(), b = $('#h-list'); if (!b) return;
  if (hTab === 'facturas') {
    hFiltrado = S.facturas.filter(f => (!q || (f.num + ' ' + f.clienteNombre).toLowerCase().includes(q)) &&
      (hTipo === 'todas' || (hTipo === 'ANULADA' ? f.estado === 'ANULADA' : hTipo === 'PENDIENTE' ? saldo(f) > 0 : f.tipo === hTipo && f.estado !== 'ANULADA')) &&
      (!hDesde || ymd(f.fecha) >= hDesde) && (!hHasta || ymd(f.fecha) <= hHasta));
    const act = hFiltrado.filter(f => f.estado !== 'ANULADA');
    $('#h-sum').textContent = `${hFiltrado.length} factura${hFiltrado.length === 1 ? '' : 's'} · Vendido ${money(sum(act.map(f => f.total)))} · Cobrado ${money(sum(act.map(pagado)))}`;
    b.innerHTML = hFiltrado.slice(0, 300).map(facRow).join('') || `<div class="empty">${ic('receipt')}<b>Sin facturas</b>No hay resultados con esos filtros.</div>`;
  } else {
    const l = S.movs.filter(m => !q || (m.nombre + ' ' + m.motivo).toLowerCase().includes(q)).slice(0, 300);
    $('#h-sum').textContent = `${l.length} movimiento${l.length === 1 ? '' : 's'} recientes`;
    b.innerHTML = l.map(m => `<div class="li" style="cursor:default"><div class="av" style="background:${m.delta > 0 ? 'var(--ok)' : 'var(--bad)'}">${m.delta > 0 ? '+' : '−'}</div><div class="mid"><div class="t">${esc(m.nombre)}</div><div class="s">${esc(m.motivo)} · ${fdt(m.fecha)}</div></div><div class="end"><div class="amt" style="color:${m.delta > 0 ? 'var(--ok)' : 'var(--bad)'}">${m.delta > 0 ? '+' : ''}${m.delta}</div><div class="small muted">stock ${m.stock}</div></div></div>`).join('') || `<div class="empty">${ic('box')}<b>Sin movimientos</b></div>`;
  }
}
function exportCSV() {
  const rows = [['Factura', 'Fecha', 'Cliente', 'Tipo', 'Estado', 'Total', 'Pagado', 'Saldo', 'Ganancia']];
  hFiltrado.forEach(f => rows.push([f.num, fdt(f.fecha), f.clienteNombre, f.tipo, f.estado, f.total, pagado(f), saldo(f), f.ganancia || 0]));
  saveFile('facturas.csv', '﻿' + rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv');
}

/* =====================================================================
   CATÁLOGO DIGITAL + QR
   ===================================================================== */
let qrMode = 'catalogo';
function catalogData() {
  return { nombre: S.config.nombre, slogan: S.config.slogan, whatsapp: digits(S.config.whatsapp), direccion: S.config.direccion, moneda: S.config.moneda, color: accent(), ink: inkFor(accent()), logo: S.config.logo || themeOf().mark || '', logoWide: S.config.logo ? '' : (themeOf().full || themeOf().wide || ''), hue: Math.round(accentHue()), bg: themeOf().bg, serif: !!themeOf().serif, pie: S.config.pie,
    categorias: S.categorias, productos: S.productos.filter(p => p.catalogo !== false).map(p => ({ id: p.id, nombre: p.nombre, categoria: p.categoria, variante: p.variante, precio: p.precio, stock: p.stock, minimo: p.minimo, desc: p.desc, imagenes: p.imagenes || [] })) };
}
function buildCatalog() {
  const json = JSON.stringify(catalogData()).replace(/</g, '\\u003c').split(String.fromCharCode(8232)).join('').split(String.fromCharCode(8233)).join('');
  return window.CATALOG_TPL.replace('__TITLE__', () => esc(S.config.nombre + ' — Catálogo')).replace(/__INK__/g, inkFor(accent())).replace(/__BG__/g, () => themeOf().bg).replace(/__COLOR__/g, () => accent()).replace('__DATA__', () => json);
}
function vCatalogo() {
  const n = S.productos.filter(p => p.catalogo !== false).length;
  return `<div class="cols c2e"><div>
    <div class="card"><h3>${ic('catalog')} Tu catálogo web</h3>
      <p class="muted" style="margin-bottom:14px">Una página elegante con tus productos, fotos y precios. Tus clientes arman su pedido y te lo envían directo por WhatsApp.</p>
      <div class="kpis" style="grid-template-columns:1fr 1fr;margin-bottom:14px"><div class="kpi"><div class="kl">Visibles</div><div class="kv">${n}</div></div><div class="kpi"><div class="kl">Ocultos</div><div class="kv">${S.productos.length - n}</div></div></div>
      <div class="row wrap"><button class="btn" style="flex:1" data-act="catPreview">${ic('eye')} Vista previa</button><button class="btn soft" style="flex:1" data-act="catDownload">${ic('download')} ${isNative() ? 'Compartir catálogo' : 'Descargar catálogo.html'}</button></div>
      ${!S.config.whatsapp ? `<div class="hint warn small" style="margin-top:12px">Agrega el WhatsApp del negocio en <a data-act="go" data-r="ajustes" style="text-decoration:underline;cursor:pointer;font-weight:700">Ajustes</a> para recibir los pedidos.</div>` : ''}</div>
    <div class="card"><h3>${ic('share')} ¿Cómo publicarlo?</h3>
      <ol style="padding-left:20px;line-height:1.8;color:#475569;font-size:14px"><li>Descarga el archivo <b>catalogo.html</b>.</li><li>Súbelo gratis a <b>Netlify Drop</b>, <b>GitHub Pages</b> o <b>Cloudflare Pages</b> (arrastrar y soltar).</li><li>Pega aquí el enlace que te den y genera tu <b>código QR</b>.</li><li>Imprime el cartel y colócalo en tu tienda, bolsas o redes.</li></ol>
      <p class="small muted" style="margin-top:10px">Cuando cambies precios o productos, descarga el catálogo de nuevo y vuelve a subirlo; el QR no cambia.</p></div></div>
  <div class="card"><h3>${ic('catalog')} Código QR</h3>
    <div class="seg" style="margin-bottom:14px"><button class="${qrMode === 'catalogo' ? 'active' : ''}" data-act="qrMode" data-m="catalogo">Enlace del catálogo</button><button class="${qrMode === 'wa' ? 'active' : ''}" data-act="qrMode" data-m="wa">Pedir por WhatsApp</button></div>
    ${qrMode === 'catalogo' ? `<div class="f"><label class="l">Enlace donde publicaste el catálogo</label><input class="in" id="qr-url" data-input="qrUrl" value="${esc(S.config.catalogUrl)}" placeholder="https://mi-tienda.netlify.app" inputmode="url"></div>` : `<div class="hint small" style="margin-bottom:12px">Este QR abre un chat de WhatsApp con tu negocio${S.config.whatsapp ? ` (${esc(S.config.whatsapp)})` : '. <b>Configura tu número en Ajustes.</b>'}</div>`}
    <div class="qrbox"><canvas id="qr-cv" width="460" height="460"></canvas><div id="qr-msg" class="small muted center"></div></div>
    <div class="dfoot"><button class="btn" data-act="qrSave">${ic('download')} Descargar QR</button><button class="btn soft" data-act="qrPoster">${ic('print')} Cartel para imprimir</button></div></div></div>`;
}
function qrText() {
  if (qrMode === 'wa') return S.config.whatsapp ? `https://wa.me/${digits(S.config.whatsapp)}?text=${encodeURIComponent('Hola, quiero información de sus productos')}` : '';
  return S.config.catalogUrl.trim();
}
function drawQR(cv, text, size) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), cell = Math.floor(size / (n + 2)), off = Math.floor((size - cell * n) / 2);
  cv.width = cv.height = size; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); g.fillStyle = '#0f172a';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect(off + c * cell, off + r * cell, cell, cell);
}
function renderQR() {
  const cv = $('#qr-cv'); if (!cv) return; const t = qrText(), msg = $('#qr-msg'), g = cv.getContext('2d');
  if (!t) { g.fillStyle = '#f8fafc'; g.fillRect(0, 0, 460, 460); g.fillStyle = '#94a3b8'; g.font = '600 24px sans-serif'; g.textAlign = 'center'; g.fillText(qrMode === 'wa' ? 'Falta tu número de WhatsApp' : 'Pega el enlace de tu catálogo', 230, 230); msg.textContent = ''; return; }
  try { drawQR(cv, t, 460); msg.textContent = t.length > 60 ? t.slice(0, 57) + '…' : t; } catch (e) { msg.textContent = 'El texto es demasiado largo para un QR'; }
}
function qrPoster() {
  const t = qrText(); if (!t) return toast('Primero configura el QR', 'err');
  const W = 900, H = 1250, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = accent(); g.fillRect(0, 0, W, 300);
  g.fillStyle = inkFor(accent()); g.textAlign = 'center'; g.font = '800 62px Segoe UI, Arial, sans-serif';
  const nm = S.config.nombre.toUpperCase(); g.fillText(nm.length > 22 ? nm.slice(0, 22) + '…' : nm, W / 2, 150);
  g.font = '500 30px Segoe UI, Arial, sans-serif'; g.globalAlpha = .85; g.fillText(S.config.slogan || 'Nuestro catálogo digital', W / 2, 205); g.globalAlpha = 1;
  const q = document.createElement('canvas'); drawQR(q, t, 640); g.fillStyle = '#fff'; g.fillRect(130, 380, 640, 640);
  g.strokeStyle = '#e2e8f0'; g.lineWidth = 3; g.strokeRect(105, 355, 690, 690); g.drawImage(q, 130, 380);
  g.fillStyle = '#0f172a'; g.font = '800 54px Segoe UI, Arial, sans-serif'; g.fillText(qrMode === 'wa' ? 'Escríbenos por WhatsApp' : 'Escanea y mira el catálogo', W / 2, 1120);
  g.fillStyle = '#64748b'; g.font = '500 30px Segoe UI, Arial, sans-serif'; g.fillText(qrMode === 'wa' ? 'Apunta tu cámara al código' : 'Elige tus productos y pídelos por WhatsApp', W / 2, 1175);
  c.toBlob(b => saveFile('cartel-qr.png', b, 'image/png'), 'image/png');
}

/* =====================================================================
   AJUSTES
   ===================================================================== */
function vMas() {
  return `<div class="tiles">${['historial', 'catalogo', 'ajustes'].map(k => `<div class="tile" data-act="go" data-r="${k}">${ic(ROUTES[k].i)}${ROUTES[k].t}</div>`).join('')}<div class="tile" data-act="go" data-r="inicio">${ic('home')}Resumen</div></div>`;
}
function vAjustes() {
  const c = S.config, owner = isOwner(), themes = Object.entries(THEMES).filter(([k, t]) => !t.brand || k === c.tema);
  return `<div class="cols c2e"><div>
  ${owner ? `<div class="card"><h3>${ic('store')} Datos del negocio</h3>
    <div class="f"><label class="l">Nombre comercial</label><input class="in" data-input="cfg" data-k="nombre" value="${esc(c.nombre)}"></div>
    <div class="f"><label class="l">Eslogan</label><input class="in" data-input="cfg" data-k="slogan" value="${esc(c.slogan)}" placeholder="Moda y estilo para toda la familia"></div>
    <div class="row"><div class="f"><label class="l">WhatsApp / Teléfono</label><input class="in" data-input="cfg" data-k="whatsapp" inputmode="tel" value="${esc(c.whatsapp)}" placeholder="584141234567"></div><div class="f"><label class="l">RIF / ID fiscal</label><input class="in" data-input="cfg" data-k="idFiscal" value="${esc(c.idFiscal)}"></div></div>
    <div class="f"><label class="l">Dirección</label><input class="in" data-input="cfg" data-k="direccion" value="${esc(c.direccion)}"></div>
    <div class="row"><div class="f" style="max-width:130px"><label class="l">Símbolo de moneda</label><input class="in" data-input="cfg" data-k="moneda" value="${esc(c.moneda)}" maxlength="4"></div><div class="f"><label class="l">Mensaje al pie de la factura</label><input class="in" data-input="cfg" data-k="pie" value="${esc(c.pie)}"></div></div></div>
  <div class="card"><h3>${ic('tag')} Apariencia</h3><label class="l">Tema de color</label>
    <div class="themes">${themes.map(([k, t]) => `<div class="theme ${c.tema === k ? 'on' : ''}" data-act="tema" data-t="${k}"><div class="sw3"><i style="background:${t.color}"></i><i style="background:${t.side}"></i><i style="background:${t.bg}"></i></div>${esc(t.n)}</div>`).join('')}</div>
    <div class="f" style="margin-top:16px"><label class="l">Logo propio (reemplaza al del tema)</label><div class="row"><div class="logo ${!c.logo && themeOf().mark ? 'mark' : ''}" style="width:56px;height:56px;border-radius:14px;font-size:20px">${markHTML()}</div><button class="btn soft sm" data-act="logoPick">${ic('image')} Subir logo</button>${c.logo ? '<button class="btn danger sm" data-act="logoDel">Quitar</button>' : ''}</div></div></div>` : ''}
  <div class="card"><h3>${ic('users')} Mi cuenta</h3>
    <dl class="kv2" style="margin-bottom:12px"><dt>Nombre</dt><dd>${esc(L.user?.nombre || '')}</dd><dt>Correo</dt><dd>${esc(L.user?.email || '')}</dd><dt>Rol</dt><dd>${owner ? 'Dueño' : 'Empleado'}</dd></dl>
    <div class="row"><div class="f"><label class="l">Contraseña actual</label><input class="in" type="password" id="pw-old" autocomplete="current-password"></div><div class="f"><label class="l">Nueva (mín. 8)</label><input class="in" type="password" id="pw-new" autocomplete="new-password"></div></div>
    <div class="row wrap"><button class="btn soft" data-act="pwSave" style="flex:1">${ic('lock')} Cambiar contraseña</button><button class="btn danger" data-act="logout" style="flex:1">Cerrar sesión</button></div></div></div>
  <div>
  <div class="card"><h3>${ic('share')} Sincronización en la nube</h3><div id="sync-info" class="small muted" style="margin-bottom:12px"></div><button class="btn block soft" data-act="syncNow">${ic('trend')} Sincronizar ahora</button></div>
  ${owner ? `<div class="card"><h3>${ic('users')} Equipo <span class="sp"></span><button class="btn sm" data-act="userNew">${ic('plus')} Agregar</button></h3><div id="team-list" class="small muted">Cargando…</div></div>` : ''}
  <div class="card"><h3>${ic('lock')} Bloqueo rápido en este equipo</h3><p class="muted small" style="margin-bottom:10px">PIN de 4 a 6 dígitos que se pide al abrir la app (sin cerrar tu sesión). Solo afecta a este dispositivo.</p>
    <div class="row"><input class="in" id="pin-in" inputmode="numeric" maxlength="6" placeholder="${L.pin ? 'PIN activo — escribe uno nuevo' : 'Nuevo PIN'}" style="letter-spacing:4px"><button class="btn" style="flex:none" data-act="pinSave">Guardar</button>${L.pin ? '<button class="btn danger" style="flex:none" data-act="pinDel">Quitar</button>' : ''}</div></div>
  ${owner ? `<div class="card"><h3>${ic('download')} Respaldo de datos</h3><p class="muted small" style="margin-bottom:12px">Además de la nube, puedes guardar una copia en un archivo. <b>Restaurar reemplaza los datos de toda la tienda.</b></p>
    <div class="row wrap"><button class="btn" style="flex:1" data-act="backup">${ic('download')} Exportar respaldo</button><button class="btn ghost" style="flex:1" data-act="restore">${ic('upload')} Restaurar</button></div></div>
  <div class="card"><h3>${ic('box')} Datos de ejemplo y reinicio</h3><div class="row wrap"><button class="btn soft" style="flex:1" data-act="demo">Cargar ejemplo</button><button class="btn danger" style="flex:1" data-act="wipe">Borrar todo</button></div></div>` : ''}<div class="dev" style="text-align:center;margin:18px 0 6px;color:var(--muted,#888)">Gestor de Tienda · Desarrollado por Analista de sistemas Eber Romero</div></div></div>`;
}
async function sha(s) { try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('bz|' + s)); return [...new Uint8Array(b)].map(x => pad(x.toString(16))).join(''); } catch { let h = 5381; for (const c of 'bz|' + s) h = (h * 33) ^ c.charCodeAt(0); return 'x' + (h >>> 0).toString(16); } }
function demo() {
  const mk = (nombre, categoria, variante, costo, stock, minimo, desc) => ({ id: uid(), fecha: new Date().toISOString(), nombre, categoria, sku: '', variante, costo, margen: 60, precio: r2(costo * 1.6), stock, minimo, desc, imagenes: [], catalogo: true });
  const L = [mk('Camisa lino manga larga', 'Caballeros', 'M · Blanco', 12, 14, 4, 'Camisa de lino fresca, ideal para clima cálido.'), mk('Vestido floral verano', 'Damas', 'S · Estampado', 15, 9, 3, 'Vestido ligero con estampado floral y cierre lateral.'), mk('Jeans slim fit', 'Caballeros', '32 · Azul', 18, 3, 4, 'Denim elástico con corte entallado.'), mk('Blusa satinada', 'Damas', 'M · Marfil', 9, 12, 3, 'Blusa de satín con caída suave.'), mk('Zapatillas urbanas', 'Calzado', '40 · Negro', 22, 6, 2, 'Suela de goma antideslizante, uso diario.'), mk('Sandalias de cuero', 'Calzado', '38 · Camel', 14, 0, 2, 'Cuero genuino, plantilla acolchada.'), mk('Bolso bandolera', 'Accesorios', 'Único · Café', 11, 8, 2, 'Bolso con correa ajustable y 3 compartimentos.'), mk('Cinturón clásico', 'Accesorios', 'L · Negro', 5, 20, 5, 'Cuero sintético con hebilla metálica.')];
  L.forEach((p, i) => { p.sku = 'P' + String(S.productos.length + i + 1).padStart(4, '0'); S.productos.push(p); logMov(p, p.stock, 'Ingreso inicial'); });
  ['Carmen Rodríguez', 'Luis Hernández', 'Ana Gómez'].forEach((n, i) => { if (!S.clientes.some(c => c.nombre === n)) S.clientes.push({ id: uid(), nombre: n, tel: '58412000000' + i, doc: 'V-1234567' + i, dir: '', fecha: new Date().toISOString() }); });
  save(); toast('Datos de ejemplo cargados', 'ok'); render();
}

/* =====================================================================
   EVENTOS (delegación)
   ===================================================================== */
const ACT = {
  go: d => { $$('.overlay').forEach(o => closeModal(o)); go(d.r); },
  close: () => closeModal(),
  prodNew: () => prodModal(), prodEdit: d => prodModal(d.id), prodSave: d => prodSave(d.id),
  prodDel: d => { const p = prod(d.id); confirmDlg(`¿Eliminar <b>${esc(p.nombre)}</b> del inventario? Las facturas anteriores se conservan.`, 'Eliminar', () => { S.productos = S.productos.filter(x => x.id !== d.id); save(); $$('.overlay').forEach(o => closeModal(o)); toast('Producto eliminado', 'ok'); render(); }); },
  imgAdd: () => pickImage(s => { tmpImgs.push(s); drawImgs(); }), imgRm: d => { tmpImgs.splice(+d.i, 1); drawImgs(); },
  invCat: d => { invCat = d.c; renderInvList(); },
  catMgr, catAdd: () => { const v = $('#cm-new').value.trim(); if (!v) return; if (S.categorias.includes(v)) return toast('Esa categoría ya existe', 'err'); S.categorias.push(v); $('#cm-new').value = ''; save(); drawCats(); },
  catDel: d => { const c = S.categorias[+d.i]; if (S.productos.some(p => p.categoria === c)) return toast('Hay productos en esta categoría. Muévelos primero.', 'err'); S.categorias.splice(+d.i, 1); save(); drawCats(); },
  posCat: d => { posCat = d.c; renderPosGrid(); },
  cartAdd: d => cartAdd(d.id),
  cartQty: d => { const it = cart.items.find(i => i.pid === d.id), p = prod(d.id); it.qty += +d.d; if (it.qty > p.stock) { it.qty = p.stock; toast('Solo hay ' + p.stock + ' en existencia', 'err'); } if (it.qty <= 0) cart.items = cart.items.filter(i => i !== it); renderPosGrid(); renderCart(); },
  cartClear: () => { resetCart(); renderPosGrid(); renderCart(); },
  cartTipo: d => { cart.tipo = d.t; renderCart(); },
  cartToggle: () => { $('#pos-cart').classList.toggle('open'); $$('.cart-close').forEach(b => b.style.display = $('#pos-cart').classList.contains('open') ? '' : 'none'); },
  checkout,
  facView: d => facModal(d.id), facPrint: d => printHTML(facHTML(factura(d.id)), 'factura-' + factura(d.id).num + '.html'),
  facWA: d => { const f = factura(d.id), c = cliente(f.clienteId); openWA(c ? c.tel : '', facText(f)); }, facVoid: d => facVoid(d.id),
  cliNew: d => cliModal(d.id, d.pos), cliSave: d => cliSave(d.id, d.pos), cliView: d => cliView(d.id),
  cliDel: d => { S.clientes = S.clientes.filter(c => c.id !== d.id); save(); $$('.overlay').forEach(o => closeModal(o)); render(); },
  cliRemind: d => remind(d.id), abonoNew: d => { $$('.overlay').forEach(o => closeModal(o)); setTimeout(() => abonoModal(d.id, d.fid), 200); }, abonoSave: d => abonoSave(d.id, d.fid),
  goSell: d => { $$('.overlay').forEach(o => closeModal(o)); cart.clienteId = d.id; go('vender'); },
  hTab: d => { hTab = d.t; hQ = ''; render(); }, exportCSV,
  catPreview: () => modal(`${dh('Vista previa')}<iframe id="cat-frame" style="width:100%;height:68vh;border:1px solid var(--line);border-radius:14px"></iframe>`, 'wide') && ($('#cat-frame').srcdoc = buildCatalog()),
  catDownload: () => saveFile('catalogo.html', buildCatalog(), 'text/html'),
  qrMode: d => { qrMode = d.m; render(); },
  qrSave: () => { if (!qrText()) return toast('Primero configura el QR', 'err'); const c = document.createElement('canvas'); drawQR(c, qrText(), 800); c.toBlob(b => saveFile('qr.png', b, 'image/png'), 'image/png'); },
  qrPoster,
  logoPick: () => pickImage(s => { S.config.logo = s; save(); applyTheme(); render(); }, 300), logoDel: () => { S.config.logo = ''; save(); applyTheme(); render(); },
  tema: d => { S.config.tema = d.t; save(); applyTheme(); render(); },
  pinSave: async () => { const v = $('#pin-in').value.trim(); if (!/^\d{4,6}$/.test(v)) return toast('El PIN debe tener 4 a 6 números', 'err'); L.pin = await sha(v); saveLocal(); toast('PIN guardado', 'ok'); render(); },
  pinDel: () => { L.pin = ''; saveLocal(); toast('PIN eliminado', 'ok'); render(); },
  backup: () => saveFile(`respaldo-${S.config.nombre.replace(/\W+/g, '-')}-${todayStr()}.json`, JSON.stringify(S), 'application/json'),
  restore: () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.onchange = async () => { try { const o = JSON.parse(await i.files[0].text()); if (!o.config || !Array.isArray(o.productos)) throw 0; confirmDlg('Se reemplazarán TODOS los datos actuales por los del respaldo.', 'Restaurar', () => { S = Object.assign(DEFAULT(), o); S.config = Object.assign(DEFAULT().config, o.config); save(); applyTheme(); toast('Respaldo restaurado', 'ok'); render(); }); } catch { toast('Archivo de respaldo no válido', 'err'); } }; i.click(); },
  demo, wipe: () => confirmDlg('Se borrarán <b>todos</b> los productos, clientes y facturas de la tienda, <b>también en la nube y en los demás dispositivos</b>. Haz un respaldo antes si lo necesitas.', 'Borrar todo', () => { { const k = { nombre: S.config.nombre, tema: S.config.tema }; S = DEFAULT(); Object.assign(S.config, k); } save(); applyTheme(); toast('Datos borrados', 'ok'); go('inicio'); render(); })
};
document.addEventListener('click', e => { const a = e.target.closest('[data-act]'); if (!a || !ACT[a.dataset.act]) return; if (a.dataset.act === 'imgRm') e.stopPropagation(); ACT[a.dataset.act](a.dataset, a, e); });
const INP = {
  invQ: e => { invQ = e.target.value; renderInvList(); }, posQ: e => { posQ = e.target.value; renderPosGrid(); }, cliQ: e => { cliQ = e.target.value; renderClientes(); },
  hQ: e => { hQ = e.target.value; renderHistorial(); }, hTipo: e => { hTipo = e.target.value; renderHistorial(); }, hDesde: e => { hDesde = e.target.value; renderHistorial(); }, hHasta: e => { hHasta = e.target.value; renderHistorial(); },
  pmCalc, catRename: e => { const i = +e.target.dataset.i, old = S.categorias[i], v = e.target.value.trim(); if (!v || v === old) return; S.productos.forEach(p => { if (p.categoria === old) p.categoria = v; }); S.categorias[i] = v; save(); },
  cartCli: e => { cart.clienteId = e.target.value; }, cartDesc: e => { cart.desc = e.target.value; updateTotals(); }, cartAbono: e => { cart.abono = e.target.value; updateTotals(); },
  cartMetodo: e => { cart.metodo = e.target.value; }, cartVence: e => { cart.vence = e.target.value; },
  qrUrl: e => { S.config.catalogUrl = e.target.value; save(); renderQR(); },
  cfg: e => { S.config[e.target.dataset.k] = e.target.value; save(); if (e.target.dataset.k === 'nombre') { applyTheme(); const l = $('#set-logo'); if (l && !S.config.logo) l.textContent = initials(S.config.nombre); } }
};
document.addEventListener('input', e => { const f = e.target.dataset && e.target.dataset.input; if (f && INP[f]) INP[f](e); });
document.addEventListener('change', e => { const f = e.target.dataset && e.target.dataset.input; if (f && INP[f] && e.target.tagName === 'SELECT') INP[f](e); });

