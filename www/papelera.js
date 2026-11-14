/* ===== Papelera (solo dueño): recupera facturas, productos, clientes, etc. borrados en los últimos 30 días ===== */
(function () {
  const NOM = { productos: 'Producto', clientes: 'Cliente', facturas: 'Factura', gastos: 'Gasto', cierres: 'Cierre de caja', proveedores: 'Proveedor', pedidos: 'Pedido' };
  const fmt = t => { const d = new Date(+t); return d.toLocaleDateString('es', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); };
  let lista = [], dirty = false;

  function pintar(msg) {
    const el = $('#pp-body'); if (!el) return;
    if (msg) { el.innerHTML = `<div class="hint">${esc(msg)}</div>`; return; }
    if (!lista.length) { el.innerHTML = `<div class="empty">${ic('check')}<b>Papelera vacía</b>No hay nada borrado en los últimos 30 días.</div>`; return; }
    el.innerHTML = lista.map(x => `<div class="row" style="justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line,#e5e7eb)">
      <div style="min-width:0"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis">${esc(NOM[x.c] || x.c)}: ${esc(x.nombre)}${x.cliente ? ' · ' + esc(x.cliente) : ''}${x.total ? ' · ' + esc(money(+x.total)) : ''}</div>
      <div class="small muted">Borrado ${fmt(x.at)}</div></div>
      <button class="btn sm ok" data-act="ppRestore" data-c="${esc(x.c)}" data-id="${esc(x.id)}">Restaurar</button></div>`).join('');
  }
  async function cargar() {
    if (typeof rpc !== 'function' || !L.token) return pintar('La papelera necesita conexión con la nube e iniciar sesión.');
    pintar('Cargando…');
    try { lista = await rpc('papelera_ver', { p_dias: 30 }); pintar(); }
    catch (e) { pintar(e.code === 'net' ? 'Sin conexión con el servidor.' : /papelera_ver/.test(e.message || '') ? 'Falta actualizar la base de datos (pegar schema.sql en Supabase).' : (e.message || 'No se pudo cargar')); }
  }
  ACT.papelera = () => { modal(`<h2 class="mt">Papelera</h2><p class="muted small" style="margin-bottom:8px">Lo que se borra se guarda 30 días. Al restaurarlo vuelve a aparecer en todos los dispositivos.</p><div id="pp-body" style="max-height:55vh;overflow:auto"></div><div class="dfoot"><button class="btn ghost" data-act="close">Cerrar</button></div>`); cargar(); };
  ACT.ppRestore = async d => {
    try {
      await rpc('papelera_restaurar', { p_col: d.c, p_id: d.id });
      lista = lista.filter(x => !(x.c === d.c && x.id === d.id)); pintar();
      toast('Restaurado ✔', 'ok');
      dirty = true; if (typeof syncNow === 'function') await syncNow();
    } catch (e) { toast(e.message || 'No se pudo restaurar', 'err'); }
  };
  const _close = ACT.close; ACT.close = function () { const r = _close.apply(this, arguments); if (dirty) { dirty = false; render(); } return r; };
  const card = `<div class="card" style="margin-top:14px"><h3 style="margin:0 0 6px">${ic('trash')} Papelera</h3><p class="muted small" style="margin:0 0 10px">Recupera facturas, productos o clientes borrados en los últimos 30 días.</p><button class="btn" data-act="papelera" style="width:100%">Abrir papelera</button></div>`;
  const _va = vAjustes;
  vAjustes = function () {
    const h = _va(); if (!isOwner()) return h;
    const k = '<div class="card" style="margin-top:14px"><button class="btn danger" data-act="logout"';
    return h.includes(k) ? h.replace(k, card + k) : h + card;
  };
  if (ROUTES.ajustes) ROUTES.ajustes.v = vAjustes;
})();
