/* =====================================================================
   VENDEDORES / REVENDEDORAS
   - Rol «vendedor»: ve el stock del dueño y envía pedidos (no ve precios ni costos).
   - Dueño: sección «Vendedores» (datos, pedidos, factura a crédito con cuotas y abonos).
   ===================================================================== */
const isVend = () => !!(L.user && L.user.rol === 'vendedor');
const VR = ['pedir', 'mispedidos', 'misfacturas', 'cuenta'];
const vendList = () => S.clientes.filter(c => c.vendedor);
const vendDe = u => u ? S.clientes.find(c => c.vendedor && c.userId === u) : null;
const pdNombre = p => { const v = vendDe(p.userId); return v ? v.nombre : (p.nombre || 'Vendedor'); };
const pdAll = () => (S.pedidos || []).slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
const pdPend = () => pdAll().filter(p => p.estado === 'PENDIENTE');
const pdUnits = p => sum((p.items || []).map(i => i.qty));
const pdResumen = p => (p.items || []).slice(0, 4).map(i => `${i.qty} × ${i.nombre}${i.sku ? ' [' + i.sku + ']' : ''}`).join(', ') + ((p.items || []).length > 4 ? '…' : '');
const pdBadge = e => e === 'PENDIENTE' ? ['warn', 'Pendiente'] : e === 'APROBADO' ? ['ok', 'Aprobado'] : ['bad', 'Rechazado'];

/* ---------- navegación ---------- */
ROUTES.pedir = { t: 'Hacer un pedido', n: 'Pedir', i: 'box', v: () => vPedir(), after: () => vpRefresh() };
ROUTES.mispedidos = { t: 'Mis pedidos', n: 'Mis pedidos', i: 'receipt', v: () => vMisPedidos() };
ROUTES.misfacturas = { t: 'Mi factura y cuotas', n: 'Mi factura', i: 'wallet', v: () => vMisFacturas() };
ROUTES.cuenta = { t: 'Mi cuenta', n: 'Mi cuenta', i: 'settings', v: () => vCuentaV() };
ROUTES.vendedores = { t: 'Vendedores', n: 'Vendedores', i: 'users', v: () => vVendedores() };
OWNER_ONLY.push('vendedores');
{ const g = GRUPOS[0][1], i = g.indexOf('creditos'); g.splice(i < 0 ? g.length : i + 1, 0, 'vendedores'); }

const _bnV = buildNav; buildNav = function () {
  _bnV();
  if (!isVend()) { const t = $('#top-sell'); if (t) t.style.display = ''; return; }
  const it = [['pedir', 'Pedir', 'box'], ['mispedidos', 'Pedidos', 'receipt'], ['misfacturas', 'Mi factura', 'wallet'], ['cuenta', 'Mi cuenta', 'settings']];
  const h = it.map(([k, l, i]) => `<a data-act="go" data-r="${k}" data-nav="${k}">${ic(i)}<span>${l}</span></a>`).join('');
  $('#side-nav').innerHTML = h; $('#tabbar').innerHTML = h;
  const t = $('#top-sell'); if (t) t.style.display = 'none';
};
const _rndV = render; render = function () {
  const key = (location.hash || '#inicio').slice(1);
  if (isVend() && !VR.includes(key)) { if (location.hash !== '#pedir') location.hash = 'pedir'; else _rndV(); return; }
  if (!isVend() && VR.includes(key)) { location.hash = 'inicio'; return; }
  _rndV();
};
{ const _vm = vMas; vMas = function () { const h = _vm(); return isOwner() ? h.replace(/(<div class="tiles">)(<div class="tile" data-act="go" data-r=")/, (m, a, b) => a + `<div class="tile" data-act="go" data-r="vendedores">${ic('users')}Vendedores${pdPend().length ? ' (' + pdPend().length + ')' : ''}</div>` + b) : h; }; ROUTES.mas.v = vMas; }
{ const _vi = vInicio; vInicio = function () { const n = isOwner() ? pdPend().length : 0; return (n ? `<div class="recbar"><span>🛍️ <b>${n}</b> pedido${n === 1 ? '' : 's'} de vendedores por revisar</span><button class="btn sm" data-act="go" data-r="vendedores">Ver pedidos</button></div>` : '') + _vi(); }; ROUTES.inicio.v = vInicio; }

/* =====================================================================
   VISTAS DEL VENDEDOR
   ===================================================================== */
let vq = '', vcat = 'Todas', vcart = {}, vnota = '';
const vcN = () => sum(Object.values(vcart));
function vPedir() {
  return vfBanner() + `<div class="hint" style="margin-bottom:12px">Elige los artículos y la cantidad que quieres; al terminar toca <b>Enviar pedido</b>. El dueño lo revisará y te enviará tu factura.</div>
  <div class="searchbox" style="margin-bottom:10px">${ic('search')}<input class="in" data-input="vq" placeholder="Buscar por nombre o código…" value="${esc(vq)}"></div>
  <div class="chips" id="vp-chips"></div>
  <div class="card" style="padding:6px 14px"><div class="list" id="vp-list"></div></div><div id="vp-bar"></div>`;
}
function vpRefresh() {
  if (!$('#vp-list')) return;
  $('#vp-chips').innerHTML = ['Todas', ...S.categorias].map(c => `<button class="chip ${vcat === c ? 'active' : ''}" data-act="vpCat" data-c="${esc(c)}">${esc(c)}</button>`).join('');
  const q = vq.trim().toLowerCase();
  const l = S.productos.filter(p => (vcat === 'Todas' || p.categoria === vcat) && (!q || (p.nombre + ' ' + (p.sku || '') + ' ' + (p.variante || '')).toLowerCase().includes(q))).sort((a, b) => (b.stock > 0) - (a.stock > 0) || a.nombre.localeCompare(b.nombre));
  $('#vp-list').innerHTML = l.map(p => { const n = vcart[p.id] || 0;
    return `<div class="li" style="cursor:default"><div class="av vthumb" data-act="vpZoom" data-id="${p.id}" style="width:60px;height:60px;border-radius:12px;overflow:hidden;background:#eef0f5;cursor:zoom-in">${thumb(p)}</div><div class="mid"><div class="t">${esc(p.nombre)}</div><div class="s">${p.sku ? 'Cód. ' + esc(p.sku) + ' · ' : ''}${p.variante ? esc(p.variante) + ' · ' : ''}${p.stock > 0 ? `<b>${p.stock}</b> disponibles` : '<span style="color:var(--bad)">Agotado</span>'}</div></div>
    ${p.stock > 0 ? `<div class="step"><button data-act="vpQty" data-id="${p.id}" data-d="-1">−</button><b style="min-width:26px;text-align:center">${n}</b><button data-act="vpQty" data-id="${p.id}" data-d="1">+</button></div>` : ''}</div>`; }).join('')
    || `<div class="empty">${ic('box')}<b>Sin resultados</b>Prueba con otra búsqueda.</div>`;
  const n = vcN();
  $('#vp-bar').innerHTML = n ? `<div class="vpbar"><span><b>${n}</b> artículo${n === 1 ? '' : 's'} · ${Object.keys(vcart).length} producto${Object.keys(vcart).length === 1 ? '' : 's'}</span><button class="btn" data-act="vpSend">${ic('check')} Enviar pedido</button></div>` : '';
}
function vpSendModal() {
  const ids = Object.keys(vcart).filter(id => prod(id)); if (!ids.length) return;
  modal(`${dh('Confirmar pedido')}
    <div class="list" style="margin-bottom:10px">${ids.map(id => { const p = prod(id); return `<div class="li" style="cursor:default;padding:8px 2px"><div class="mid"><div class="t">${esc(p.nombre)}</div><div class="s">${p.sku ? 'Cód. ' + esc(p.sku) : ''}${p.variante ? ' · ' + esc(p.variante) : ''}</div></div><b>× ${vcart[id]}</b></div>`; }).join('')}</div>
    <div class="f"><label class="l">Nota para el dueño (opcional)</label><input class="in" id="vp-nota" maxlength="200" placeholder="Ej. Lo necesito para el viernes" value="${esc(vnota)}"></div>
    <div class="dfoot"><button class="btn ghost" data-act="close">Seguir editando</button><button class="btn ok" data-act="vpConfirm">${ic('check')} Enviar pedido</button></div>`);
}
function vpConfirm() {
  const items = Object.keys(vcart).map(id => { const p = prod(id); return p && vcart[id] > 0 ? { pid: id, nombre: p.nombre, sku: p.sku || '', variante: p.variante || '', qty: Math.min(vcart[id], 9999) } : null; }).filter(Boolean);
  if (!items.length) return;
  const ped = { id: uid(), fecha: new Date().toISOString(), userId: L.user.id, nombre: L.user.nombre || '', estado: 'PENDIENTE', facturaId: '', nota: ($('#vp-nota')?.value || '').trim().slice(0, 200), items };
  S.pedidos.unshift(ped); vcart = {}; vnota = ''; save(); closeModal(); toast('Pedido enviado ✓', 'ok'); go('mispedidos'); try { syncNow(); } catch { }
}
function vMisPedidos() {
  const l = pdAll();
  return `<div class="row" style="margin-bottom:12px"><button class="btn" data-act="go" data-r="pedir">${ic('plus')} Nuevo pedido</button></div>
  ${l.length ? l.map(p => { const [k, t] = pdBadge(p.estado); return `<div class="card" style="margin-bottom:10px"><div class="dh" style="margin-bottom:6px"><b>${fdt(p.fecha)}</b><span class="badge ${k}">${t}</span></div>
    <div class="small">${(p.items || []).map(i => `${i.qty} × ${esc(i.nombre)}${i.sku ? ' <span class="muted">[' + esc(i.sku) + ']</span>' : ''}`).join('<br>')}</div>
    ${p.nota ? `<div class="small muted" style="margin-top:6px">Tu nota: ${esc(p.nota)}</div>` : ''}${p.respuesta ? `<div class="hint small" style="margin-top:8px">Respuesta del dueño: ${esc(p.respuesta)}</div>` : ''}
    ${p.estado === 'PENDIENTE' ? '<div class="small muted" style="margin-top:6px">Esperando que el dueño lo revise…</div>' : ''}</div>`; }).join('') : `<div class="empty">${ic('receipt')}<b>Aún no has enviado pedidos</b>Toca «Nuevo pedido» para empezar.</div>`}`;
}
function vCuentaV() {
  return `<div class="card"><div class="dh"><h2 style="font-size:17px">${esc(L.user.nombre || 'Vendedor')}</h2><span class="badge info">Vendedor</span></div><div class="muted small">${esc(L.user.email || '')}</div>
  <div class="f" style="margin-top:14px"><label class="l">Contraseña actual</label><input class="in" id="pw-old" type="password" autocomplete="current-password"></div>
  <div class="f"><label class="l">Nueva contraseña</label><input class="in" id="pw-new" type="password" autocomplete="new-password"></div>
  <div class="row"><button class="btn soft" data-act="pwSave">Cambiar contraseña</button><button class="btn ghost" data-act="logout">Cerrar sesión</button></div></div>
  <div class="hint small" style="margin-top:12px">Desarrollado por Analista de sistemas Eber Romero</div>`;
}

/* =====================================================================
   SECCIÓN «VENDEDORES» DEL DUEÑO
   ===================================================================== */
function vVendedores() {
  if (!isOwner()) return soloDueno();
  const vs = vendList(), pend = pdPend(), fs = activas().filter(f => vs.some(v => v.id === f.clienteId)), por = sum(fs.map(saldo));
  const rest = pdAll().filter(p => p.estado !== 'PENDIENTE').slice(0, 8);
  return `<div class="kpis">
    <div class="kpi hero"><span class="ico">${ic('wallet')}</span><div class="kl">Por cobrar a vendedores</div><div class="kv">${money(por)}</div><div class="ks">${vs.filter(v => deudaCliente(v.id) > 0).length} con saldo</div></div>
    <div class="kpi"><span class="ico">${ic('receipt')}</span><div class="kl">Pedidos por revisar</div><div class="kv">${pend.length}</div><div class="ks">pendientes</div></div>
    <div class="kpi"><span class="ico">${ic('users')}</span><div class="kl">Vendedores</div><div class="kv">${vs.length}</div><div class="ks">registrados</div></div>
    <div class="kpi"><span class="ico" style="background:var(--bad-soft);color:var(--bad)">${ic('alert')}</span><div class="kl">Cuotas vencidas</div><div class="kv">${money(sum(fs.filter(vencida).map(saldo)))}</div><div class="ks">de vendedores</div></div></div>
  <div class="row wrap" style="margin-bottom:12px"><button class="btn" data-act="vendNew">${ic('plus')} Nuevo vendedor</button></div>
  <div class="small muted b" style="margin:6px 0 4px">PEDIDOS POR REVISAR</div>
  <div class="card" style="padding:6px 14px;margin-bottom:16px"><div class="list">${pend.map(p => `<div class="li" data-act="pdRev" data-id="${p.id}"><div class="av" style="background:${grad(pdNombre(p))}">${esc(initials(pdNombre(p)))}</div><div class="mid"><div class="t">${esc(pdNombre(p))}</div><div class="s">${fdt(p.fecha)} · ${pdUnits(p)} art. — ${esc(pdResumen(p))}</div></div><span class="badge warn">Revisar</span></div>`).join('') || `<div class="empty" style="padding:18px">${ic('receipt')}<b>Sin pedidos pendientes</b>Cuando un vendedor envíe uno, aparecerá aquí.</div>`}</div></div>
  <div class="small muted b" style="margin:6px 0 4px">VENDEDORES</div>
  <div class="card" style="padding:6px 14px;margin-bottom:16px"><div class="list">${vs.map(v => { const d = deudaCliente(v.id); return `<div class="li" data-act="vendView" data-id="${v.id}"><div class="av" style="background:${grad(v.nombre)}">${esc(initials(v.nombre))}</div><div class="mid"><div class="t">${esc(v.nombre)}</div><div class="s">${v.userId ? 'Con acceso a la app' : 'Sin cuenta de acceso'}${v.tel ? ' · ' + esc(v.tel) : ''}</div></div><div class="end"><div class="amt" style="color:${d > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(d)}</div><div class="s">${d > 0 ? 'debe' : 'al día'}</div></div></div>`; }).join('') || `<div class="empty" style="padding:18px">${ic('users')}<b>Aún no tienes vendedores</b>Toca «Nuevo vendedor» para registrar el primero.</div>`}</div></div>
  ${rest.length ? `<div class="small muted b" style="margin:6px 0 4px">PEDIDOS RECIENTES</div><div class="card" style="padding:6px 14px"><div class="list">${rest.map(pdRow).join('')}</div></div>` : ''}`;
}
function pdRow(p) { const [k, t] = pdBadge(p.estado); return `<div class="li" data-act="pdOpen" data-id="${p.id}"><div class="mid"><div class="t">${esc(pdNombre(p))} · ${fdt(p.fecha)}</div><div class="s">${esc(pdResumen(p))}</div></div><span class="badge ${k}">${t}</span></div>`; }

function vendModal(id) {
  const c = id ? cliente(id) : null;
  modal(`${dh(c ? 'Editar vendedor' : 'Nuevo vendedor')}
    <div class="f"><label class="l">Nombre (así saldrá en sus facturas y notificaciones)</label><input class="in" id="vd-nom" value="${esc(c?.nombre || '')}" placeholder="Ej. María Pérez"></div>
    <div class="row"><div class="f"><label class="l">Teléfono / WhatsApp</label><input class="in" id="vd-tel" inputmode="tel" value="${esc(c?.tel || '')}"></div><div class="f"><label class="l">Cédula / documento</label><input class="in" id="vd-doc" value="${esc(c?.doc || '')}"></div></div>
    <div class="f"><label class="l">Dirección</label><input class="in" id="vd-dir" value="${esc(c?.dir || '')}"></div>
    ${c && c.userId ? `<div class="hint small">Esta persona ya tiene acceso a la app como vendedor.</div>` : `<label class="row" style="cursor:pointer;margin:6px 0"><input type="checkbox" id="vd-acc" style="width:20px;height:20px;accent-color:var(--accent)" ${c ? '' : 'checked'}><span class="b">Crear cuenta para que haga pedidos desde su teléfono</span></label>
    <div id="vd-accf"><div class="f"><label class="l">Correo (será su usuario)</label><input class="in" id="vd-email" type="email" inputmode="email" autocapitalize="none"></div>
    <div class="f"><label class="l">Contraseña (mín. 8)</label><div class="row"><input class="in" id="vd-pw" type="text" autocomplete="off" value="${genPw()}"><button class="btn soft" style="flex:none" data-act="vdPw">Generar</button></div></div>
    <div class="hint small">Requiere internet. Al guardar verás los datos de acceso para enviárselos.</div></div>`}
    <div class="dfoot">${c ? `<button class="btn danger" style="flex:0 0 auto" data-act="vendDel" data-id="${c.id}">${ic('trash')}</button>` : ''}<button class="btn ghost" data-act="close">Cancelar</button><button class="btn" data-act="vendSave" data-id="${c ? c.id : ''}">${ic('check')} Guardar</button></div>`);
  const ck = $('#vd-acc'); if (ck) { const f = () => { $('#vd-accf').style.display = ck.checked ? '' : 'none'; }; ck.onchange = f; f(); }
}
async function vendSave(id) {
  const nombre = $('#vd-nom').value.trim(); if (!nombre) return toast('Escribe el nombre', 'err');
  if (S.clientes.some(c => c.id !== id && c.nombre.toLowerCase() === nombre.toLowerCase())) return toast('Ya existe alguien con ese nombre', 'err');
  const d = { nombre, tel: $('#vd-tel').value.trim(), doc: $('#vd-doc').value.trim(), dir: $('#vd-dir').value.trim() };
  const acc = $('#vd-acc') && $('#vd-acc').checked, email = ($('#vd-email')?.value || '').trim(), pw = ($('#vd-pw')?.value || '').trim();
  let uidV = '';
  if (acc) {
    if (!email) return toast('Escribe el correo del vendedor', 'err'); if (pw.length < 8) return toast('La contraseña debe tener al menos 8 caracteres', 'err');
    const b = $('[data-act=vendSave]'); if (b) b.disabled = true;
    try { const r = await api('/api/users', { nombre, rol: 'vendedor', email, password: pw }); uidV = r.id || (r.user && r.user.id) || ''; if (!uidV) throw new Error('No se pudo crear la cuenta'); }
    catch (e) { if (b) b.disabled = false; return toast(e.code === 'net' ? 'Necesitas internet para crear la cuenta' : e.message, 'err'); }
  }
  let c;
  if (id) { c = cliente(id); Object.assign(c, d); S.facturas.filter(f => f.clienteId === id).forEach(f => f.clienteNombre = nombre); }
  else { c = { id: uid(), fecha: new Date().toISOString(), ...d, vendedor: true }; S.clientes.push(c); }
  if (uidV) c.userId = uidV;
  save(); closeModal(); render(); toast('Vendedor guardado', 'ok');
  if (uidV) setTimeout(() => vendCred(c, email, pw), 260);
}
function vendCred(c, email, pw) {
  const txt = `Hola ${c.nombre} 👋, ya puedes hacer tus pedidos en *${S.config.nombre}*.\nUsuario: ${email}\nContraseña: ${pw}\nAbre la app, entra con esos datos y elige los productos que necesitas.`;
  window._vcred = txt;
  modal(`${dh('Cuenta creada ✅')}<p class="muted" style="margin-bottom:10px">Entrégale estos datos a <b>${esc(c.nombre)}</b>. Guárdalos: la contraseña no se vuelve a mostrar.</p>
    <div class="totals" style="margin:0"><div class="tr"><span>Usuario</span><b>${esc(email)}</b></div><div class="tr"><span>Contraseña</span><b>${esc(pw)}</b></div></div>
    <div class="dfoot"><button class="btn soft" data-act="vdCopy">Copiar</button><button class="btn ok" data-act="vdWA" data-id="${c.id}">${ic('chat')} Enviar por WhatsApp</button><button class="btn ghost" data-act="close">Listo</button></div>`);
}

function vendView(id) {
  const c = cliente(id); if (!c) return; const d = deudaCliente(id);
  const fs = S.facturas.filter(f => f.clienteId === id), pend = fs.filter(f => f.estado !== 'ANULADA' && saldo(f) > 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const pagos = activas().filter(f => f.clienteId === id).flatMap(f => f.abonos.map(a => ({ ...a, num: f.num }))).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 8);
  const peds = pdAll().filter(p => p.userId && p.userId === c.userId).slice(0, 8);
  const prox = pend.flatMap(f => plan(f)).filter(x => x.pend > 0).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
  modal(`${dh(esc(c.nombre), `<button class="iconbtn" data-act="vendNew" data-id="${c.id}">${ic('edit')}</button>`)}
    <div class="totals" style="margin-top:0"><div class="muted small b">SALDO PENDIENTE</div><div style="font-size:26px;font-weight:800;color:${d > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(d)}</div>${prox ? `<div class="small muted">Próxima cuota: ${fdate(prox.fecha + 'T12:00:00')} · ${money(prox.pend)}</div>` : ''}</div>
    <div class="row wrap" style="margin:12px 0">${d > 0 ? `<button class="btn ok" style="flex:1" data-act="abonoNew" data-id="${c.id}">${ic('wallet')} Registrar abono</button><button class="btn soft" style="flex:1" data-act="cliRemind" data-id="${c.id}">${ic('chat')} Recordar pago</button>` : ''}</div>
    ${pend.length ? `<div class="small muted b" style="margin-bottom:4px">FACTURAS PENDIENTES</div><div class="list" style="margin-bottom:12px">${pend.map(f => `<div class="li" data-act="facView" data-id="${f.id}" style="padding:10px 2px"><div class="mid"><div class="t">${f.num}</div><div class="s">${fdate(f.fecha)}${f.cuotas > 1 ? ' · ' + f.cuotas + ' cuotas' : ''}</div></div><div class="end"><div class="amt">${money(saldo(f))}</div></div></div>`).join('')}</div>` : ''}
    ${peds.length ? `<div class="small muted b" style="margin-bottom:4px">PEDIDOS</div><div class="list" style="margin-bottom:12px">${peds.map(pdRow).join('')}</div>` : ''}
    ${pagos.length ? `<div class="small muted b" style="margin-bottom:4px">ÚLTIMOS ABONOS</div>${pagos.map(a => `<div class="row small" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)"><span>${fdt(a.fecha)} · ${esc(a.metodo)} · ${a.num}</span><b>${money(a.monto)}</b></div>`).join('')}` : ''}
    <div class="dfoot"><button class="btn ghost" data-act="close">Cerrar</button></div>`, 'wide');
}
{ const _cv = cliView; cliView = function (id) { const c = cliente(id); if (c && c.vendedor) return vendView(id); return _cv(id); }; }

/* ---------- revisar pedido y generar factura a crédito ---------- */
let PR = null;
function pdRev(id) {
  const p = (S.pedidos || []).find(x => x.id === id); if (!p) return;
  if (p.estado !== 'PENDIENTE') return p.facturaId && factura(p.facturaId) ? facModal(p.facturaId) : toast('Pedido ' + pdBadge(p.estado)[1].toLowerCase());
  const fr = 15;
  PR = { id, items: p.items.map(i => { const pr = prod(i.pid); return { pid: i.pid, nombre: pr ? pr.nombre : i.nombre, sku: pr ? (pr.sku || '') : (i.sku || ''), desc: pr ? String(pr.desc || '').slice(0, 300) : '', variante: pr ? (pr.variante || '') : (i.variante || ''), qty: i.qty, base: pr ? pr.precio : 0, precio: pr ? pr.precio : 0, costo: pr ? (pr.costo || 0) : 0, stock: pr ? pr.stock : 0, ok: !!pr }; }), rec: 0, desc: 0, cuotas: 1, freq: fr, vence: addDays(todayStr(), fr), ini: 0, met: 'Efectivo' };
  modal(`${dh('Pedido de ' + esc(pdNombre(p)), `<span class="badge warn">${fdt(p.fecha)}</span>`)}
    ${p.nota ? `<div class="hint small" style="margin-bottom:10px">Nota: ${esc(p.nota)}</div>` : ''}
    <div id="pr-items">${PR.items.map((it, i) => `<div class="cl" style="align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)"><div class="nm" style="flex:1;min-width:0"><b>${esc(it.nombre)}</b><small style="display:block">${it.sku ? 'Cód. ' + esc(it.sku) : ''}${it.variante ? ' · ' + esc(it.variante) : ''} · stock ${it.stock}${it.ok ? '' : ' · <span style="color:var(--bad)">ya no existe</span>'}</small></div>
      <div style="width:64px"><label class="l" style="font-size:10px">Cant.</label><input class="in" type="number" min="0" inputmode="numeric" data-input="prQty" data-i="${i}" value="${it.qty}" style="padding:6px"></div>
      <div style="width:92px"><label class="l" style="font-size:10px">Precio</label><input class="in" type="number" min="0" step="0.01" inputmode="decimal" data-input="prPrecio" data-i="${i}" value="${it.precio}" style="padding:6px"></div>
      <div style="width:78px;text-align:right"><b id="pr-s${i}"></b></div></div>`).join('')}</div>
    <div class="row" style="margin-top:12px"><div class="f"><label class="l">Recargo por crédito (%)</label><input class="in" type="number" step="0.1" min="0" inputmode="decimal" data-input="prRec" placeholder="0"></div><div class="f"><label class="l">Descuento (%)</label><input class="in" type="number" min="0" max="100" inputmode="decimal" data-input="prDesc" placeholder="0"></div></div>
    <div class="row"><div class="f"><label class="l">N.º de cuotas</label><input class="in" type="number" min="1" max="24" inputmode="numeric" data-input="prCuotas" value="1"></div><div class="f"><label class="l">Una cuota cada</label><select class="in" data-input="prFreq">${[[7, '7 días (semanal)'], [15, '15 días (quincenal)'], [30, '30 días (mensual)']].map(([d, l]) => `<option value="${d}" ${d === fr ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="row"><div class="f"><label class="l">Primera cuota vence el</label><input class="in" type="date" data-input="prVence" value="${PR.vence}"></div><div class="f"><label class="l">Abono inicial (opcional)</label><input class="in" type="number" min="0" step="0.01" inputmode="decimal" data-input="prIni" placeholder="0.00"></div></div>
    <div class="f"><label class="l">Método del abono inicial</label><select class="in" data-input="prMet">${METODOS.map(m => `<option>${m}</option>`).join('')}</select></div>
    <div class="totals" id="pr-tot"></div>
    <div class="f" style="margin-top:10px"><label class="l">Nota de respuesta (se muestra al vendedor, opcional)</label><input class="in" id="pr-resp" maxlength="200"></div>
    <div class="dfoot"><button class="btn danger" style="flex:0 0 auto" data-act="pdReject" data-id="${id}">Rechazar</button><button class="btn ghost" data-act="close">Cerrar</button><button class="btn ok" data-act="pdApprove" data-id="${id}">${ic('check')} Aprobar y facturar</button></div>`, 'wide');
  prTot();
}
function prCalc() {
  const R = PR, sub = r2(sum(R.items.map(i => i.precio * i.qty))), pct = Math.max(0, Math.min(100, num(R.desc))), desc = r2(sub * pct / 100), total = r2(sub - desc);
  const ini = Math.max(0, Math.min(total, r2(num(R.ini)))), saldo_ = r2(total - ini), n = Math.max(1, Math.min(24, Math.floor(num(R.cuotas)) || 1));
  return { sub, pct, desc, total, ini, saldo: saldo_, n, units: sum(R.items.map(i => i.qty)) };
}
function prTot() {
  if (!PR || !$('#pr-tot')) return; const c = prCalc();
  PR.items.forEach((it, i) => { const e = $('#pr-s' + i); if (e) e.textContent = money(r2(it.precio * it.qty)); });
  $('#pr-tot').innerHTML = `<div class="tr"><span>Subtotal (${c.units} art.)</span><span>${money(c.sub)}</span></div>${c.pct ? `<div class="tr"><span>Descuento ${c.pct}%</span><span>−${money(c.desc)}</span></div>` : ''}${c.ini ? `<div class="tr"><span>Abono inicial</span><span>−${money(c.ini)}</span></div>` : ''}
    <div class="tr big"><span>Saldo a crédito</span><span>${money(c.saldo)}</span></div>${c.n > 1 ? `<div class="tr" style="font-size:13px;color:var(--muted)"><span>${c.n} cuotas de</span><b>${money(r2(c.saldo / c.n))}</b></div>` : ''}`;
}
function pdApprove(id) {
  const p = (S.pedidos || []).find(x => x.id === id); if (!p || !PR || PR.id !== id) return; const c = prCalc();
  const its = PR.items.filter(i => i.qty > 0); if (!its.length) return toast('El pedido no tiene artículos', 'err');
  for (const i of its) { const pr = prod(i.pid); if (!pr) return toast(`"${i.nombre}" ya no existe en el inventario`, 'err'); if (i.qty > pr.stock) return toast(`Stock insuficiente de "${i.nombre}" (hay ${pr.stock})`, 'err'); if (!(i.precio > 0)) return toast(`Indica el precio de "${i.nombre}"`, 'err'); }
  if (c.total <= 0) return toast('El total debe ser mayor que cero', 'err'); if (!PR.vence) return toast('Indica cuándo vence la primera cuota', 'err');
  let v = vendDe(p.userId);
  if (!v) { v = { id: uid(), fecha: new Date().toISOString(), nombre: p.nombre || 'Vendedor', tel: '', doc: '', dir: '', vendedor: true, userId: p.userId }; let k = 2; while (S.clientes.some(x => x.nombre.toLowerCase() === v.nombre.toLowerCase())) v.nombre = (p.nombre || 'Vendedor') + ' ' + k++; S.clientes.push(v); }
  const now = new Date().toISOString(), costo = sum(its.map(i => i.costo * i.qty));
  const f = { id: uid(), num: nextNum(), fecha: now, clienteId: v.id, clienteNombre: v.nombre, items: its.map(i => ({ pid: i.pid, nombre: i.nombre, sku: i.sku, desc: i.desc, variante: i.variante, precio: i.precio, costo: i.costo, qty: i.qty })),
    subtotal: c.sub, descPct: c.pct, desc: c.desc, total: c.total, tipo: 'CREDITO', metodo: PR.met, vence: PR.vence, inicial: c.ini, cuotas: c.n, freq: PR.freq, abonos: [], estado: c.saldo > 0 ? 'PENDIENTE' : 'PAGADA', ganancia: r2(c.total - costo), tasa: (typeof XT !== 'undefined' && XT.rate()) || 0, pedidoId: p.id, vendUid: p.userId };
  if (c.ini > 0) f.abonos.push({ id: uid(), fecha: now, monto: c.ini, metodo: PR.met, nota: 'Abono inicial' });
  its.forEach(i => { const pr = prod(i.pid); pr.stock -= i.qty; logMov(pr, -i.qty, 'Pedido vendedor ' + f.num); });
  S.facturas.unshift(f); p.estado = 'APROBADO'; p.facturaId = f.id; p.respuesta = ($('#pr-resp')?.value || '').trim().slice(0, 200); p.resuelto = now;
  save(); PR = null; $$('.overlay').forEach(o => closeModal(o)); render(); setTimeout(() => facModal(f.id, true), 250);
}
function pdReject(id) {
  const p = (S.pedidos || []).find(x => x.id === id); if (!p) return; const resp = ($('#pr-resp')?.value || '').trim().slice(0, 200);
  confirmDlg(`¿Rechazar el pedido de <b>${esc(pdNombre(p))}</b>? El vendedor verá que fue rechazado.`, 'Sí, rechazar', () => { p.estado = 'RECHAZADO'; p.respuesta = resp; p.resuelto = new Date().toISOString(); save(); PR = null; $$('.overlay').forEach(o => closeModal(o)); toast('Pedido rechazado', 'ok'); render(); });
}

/* ---------- avisos al dueño cuando llega un pedido ---------- */
function pdSeen() { try { return JSON.parse(localStorage.getItem('gestor_pd_seen') || '[]'); } catch { return []; } }
const pdHash = t => { let h = 0; for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0; return Math.abs(h); };
const _alrt = {};
function pdAlert(title, body, ruta) {
  const k = title + '|' + body, now = Date.now(); if (_alrt[k] && now - _alrt[k] < 120000) return; _alrt[k] = now; // misma alerta: una sola vez
  const LN = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.LocalNotifications;
  if (LN && isNative()) { try { LN.schedule({ notifications: [{ id: 8000 + (pdHash(k) % 900), title, body, schedule: { at: new Date(now + 800) } }] }); } catch { } return; } // en el APK solo la notificación nativa
  try { if ('Notification' in window && Notification.permission === 'granted') { const n = new Notification(title, { body, tag: 'gestor-' + pdHash(k) }); n.onclick = () => { window.focus(); go(ruta || 'vendedores'); }; } } catch { }
}
function pdNotify() {
  if (!isOwner() || !L.token) return; const seen = pdSeen(), nu = pdPend().filter(p => !seen.includes(p.id)); if (!nu.length) return;
  try { localStorage.setItem('gestor_pd_seen', JSON.stringify([...seen, ...nu.map(p => p.id)].slice(-300))); } catch { }
  nu.slice(0, 5).forEach(p => pdAlert(pdNombre(p) + ' envió un pedido', pdUnits(p) + ' artículos: ' + pdResumen(p)));
  toast(nu.length === 1 ? `🛍️ ${pdNombre(nu[0])} envió un pedido` : `🛍️ ${nu.length} pedidos nuevos de vendedores`, 'ok');
}

/* ---------- el vendedor: su factura, cuotas, saldo y avisos ---------- */
const vfList = () => S.facturas.filter(f => f.estado !== 'ANULADA' && f.tipo === 'CREDITO').sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
const vfProx = () => vfList().flatMap(f => plan(f)).filter(x => x.pend > 0.004).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
const vfDeuda = () => r2(sum(vfList().map(saldo)));
function vfBanner() {
  if (!isVend()) return ''; const d = vfDeuda(), px = vfProx(); if (!(d > 0) || !px) return '';
  const dd = diasHasta(px.fecha), cu = dd < 0 ? `<b style="color:var(--bad)">vencida desde el ${fdate(px.fecha + 'T12:00:00')}</b>` : dd === 0 ? '<b>vence hoy</b>' : dd === 1 ? '<b>vence mañana</b>' : `el <b>${fdate(px.fecha + 'T12:00:00')}</b>`;
  return `<div class="recbar"><span>💳 Tu próxima cuota (${money(px.pend)}) ${cu}. Te quedan <b>${money(d)}</b> por pagar.</span><button class="btn sm" data-act="go" data-r="misfacturas">Ver mi factura</button></div>`;
}
function vMisFacturas() {
  const fs = vfList(), d = vfDeuda(), px = vfProx(), pagado_ = r2(sum(fs.map(pagado)));
  return `<div class="kpis">
    <div class="kpi hero"><span class="ico">${ic('wallet')}</span><div class="kl">Te quedan por pagar</div><div class="kv">${money(d)}</div><div class="ks">${d > 0 ? 'saldo total' : '¡Estás al día!'}</div></div>
    <div class="kpi"><span class="ico">${ic('alert')}</span><div class="kl">Próxima cuota</div><div class="kv" style="font-size:18px">${px ? fdate(px.fecha + 'T12:00:00') : '—'}</div><div class="ks">${px ? money(px.pend) + (px.estado === 'Vencida' ? ' · vencida' : '') : 'sin cuotas pendientes'}</div></div>
    <div class="kpi"><span class="ico">${ic('check')}</span><div class="kl">Has pagado</div><div class="kv">${money(pagado_)}</div><div class="ks">${fs.length} factura${fs.length === 1 ? '' : 's'}</div></div></div>
  ${fs.length ? fs.map(f => { const [k, t] = facEstado(f); return `<div class="card" style="margin-bottom:10px;cursor:pointer" data-act="vfView" data-id="${f.id}"><div class="dh" style="margin-bottom:4px"><b>Factura ${f.num}</b><span class="badge ${k}">${t}</span></div><div class="small muted">${fdate(f.fecha)} · ${f.items.reduce((n, i) => n + i.qty, 0)} artículos · total ${money(f.total)}</div><div class="row small" style="justify-content:space-between;margin-top:6px"><span>Saldo pendiente</span><b style="color:${saldo(f) > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(saldo(f))}</b></div></div>`; }).join('') : `<div class="empty">${ic('receipt')}<b>Aún no tienes facturas</b>Cuando el dueño apruebe un pedido, tu factura aparecerá aquí con sus cuotas.</div>`}`;
}
function vfView(id) {
  const f = factura(id); if (!f) return; const [k, t] = facEstado(f), pl = plan(f);
  modal(`${dh('Factura ' + f.num, `<span class="badge ${k}">${t}</span>`)}
    <div class="small muted" style="margin-bottom:8px">${fdt(f.fecha)}</div>
    <div class="list" style="margin-bottom:10px">${f.items.map(i => `<div class="li" style="cursor:default;align-items:flex-start;padding:9px 2px"><div class="mid" style="white-space:normal"><div class="t" style="white-space:normal">${esc(i.nombre)}</div><div class="s" style="white-space:normal">${i.sku ? 'Cód. ' + esc(i.sku) : ''}${i.variante ? ' · ' + esc(i.variante) : ''}</div>${i.desc ? `<div class="s" style="white-space:normal">${esc(i.desc)}</div>` : ''}<div class="s">${i.qty} × ${money(i.precio)}</div></div><b>${money(i.precio * i.qty)}</b></div>`).join('')}</div>
    <div class="totals">${f.descPct ? `<div class="tr"><span>Subtotal</span><span>${money(f.subtotal)}</span></div><div class="tr"><span>Descuento ${f.descPct}%</span><span>−${money(f.desc)}</span></div>` : ''}<div class="tr big"><span>Total</span><span>${money(f.total)}</span></div><div class="tr"><span>Pagado</span><span>${money(pagado(f))}</span></div><div class="tr b"><span>Te quedan por pagar</span><span style="color:${saldo(f) > 0 ? 'var(--bad)' : 'var(--ok)'}">${money(saldo(f))}</span></div></div>
    ${pl.length ? planHTML(pl, true) : ''}
    ${f.abonos.length ? `<div class="small muted b" style="margin:10px 0 4px">PAGOS REGISTRADOS</div>${f.abonos.map(a => `<div class="row small" style="justify-content:space-between;padding:3px 0"><span>${fdt(a.fecha)} · ${esc(a.metodo)}</span><b>${money(a.monto)}</b></div>`).join('')}` : ''}
    <div class="dfoot"><button class="btn soft" data-act="facImg" data-id="${f.id}">${ic('image')} Guardar / compartir imagen</button><button class="btn ghost" data-act="close">Cerrar</button></div>`, 'wide');
}
function vfSeen() { try { return JSON.parse(localStorage.getItem('gestor_vf_seen') || '{}'); } catch { return {}; } }
function vfNotify() {
  if (!isVend() || !L.token) return; const seen = vfSeen(); let ch = false;
  const marca = {};
  for (const f of vfList()) {
    const prev = seen[f.id], n = (f.abonos || []).length, px = plan(f).filter(x => x.pend > 0.004)[0]; if (prev === undefined || n > prev) { seen[f.id] = n; marca[f.id] = 1; try { localStorage.setItem('gestor_vf_seen', JSON.stringify(seen)); } catch { } }
    if (!marca[f.id]) continue;
    if (prev === undefined) { ch = true; const msg = `Total ${money(f.total)}.` + (px ? ` Primera cuota: ${fdate(px.fecha + 'T12:00:00')} (${money(px.pend)}).` : '') + ` Te quedan ${money(saldo(f))} por pagar.`; pdAlert('🧾 Tu factura ' + f.num + ' fue aprobada', msg, 'misfacturas'); toast('🧾 Factura ' + f.num + ' aprobada', 'ok'); }
    else if (n > prev) { ch = true; const msg = saldo(f) > 0.004 ? `Te quedan ${money(saldo(f))} por pagar.` + (px ? ` Próxima cuota: ${fdate(px.fecha + 'T12:00:00')}.` : '') : '¡Factura pagada por completo!'; pdAlert('✅ Pago registrado · ' + f.num, msg, 'misfacturas'); toast('✅ Pago registrado. ' + msg, 'ok'); }
    if (prev === undefined || n > prev) seen[f.id] = n;
  }
  if (ch) try { localStorage.setItem('gestor_vf_seen', JSON.stringify(seen)); } catch { }
  vfSchedule();
}
async function vfSchedule() {
  const LN = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.LocalNotifications; if (!LN || !isNative()) return;
  try {
    try { await LN.requestPermissions(); } catch { }
    const out = [], hoy = Date.now(); let k = 0;
    for (const x of vfList().flatMap(f => plan(f)).filter(x => x.pend > 0.004)) {
      for (const [off, tx] of [[-1, 'vence mañana'], [0, 'vence hoy']]) {
        const at = new Date(addDays(x.fecha, off) + 'T09:00:00'); if (at.getTime() <= hoy || k >= 190) continue;
        out.push({ id: 7000 + k++, title: '💳 Cuota ' + x.n + '/' + x.de + ' ' + tx, body: 'Debes pagar ' + money(x.pend) + ' en ' + S.config.nombre + '.', schedule: { at } });
      }
    }
    const ids = [...Array(200)].map((_, i) => ({ id: 7000 + i }));
    const sig = JSON.stringify(out.map(x => [x.id, +x.schedule.at])); if (sig === window._vfSig) return; window._vfSig = sig; try { await LN.cancel({ notifications: ids }); } catch { }
    if (out.length) await LN.schedule({ notifications: out });
  } catch { }
}
{ const _ar = applyRecs; applyRecs = function (recs) { const r = _ar(recs); try { pdNotify(); vfNotify(); } catch { } return r; }; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && isVend()) { try { vfSchedule(); } catch { } } });

/* ---------- acciones ---------- */
Object.assign(ACT, {
  vpCat: d => { vcat = d.c; vpRefresh(); },
  vpQty: d => { const p = prod(d.id); if (!p) return; const n = (vcart[d.id] || 0) + (+d.d); if (n > p.stock) return toast('Solo hay ' + p.stock + ' disponibles', 'err'); if (n <= 0) delete vcart[d.id]; else vcart[d.id] = n; vpRefresh(); },
  vpSend: vpSendModal, vpConfirm,
  vendNew: d => { closeModal(); vendModal(d.id); }, vendSave: d => vendSave(d.id), vendView: d => vendView(d.id), vdPw: () => { $('#vd-pw').value = genPw(); },
  vendDel: d => { const c = cliente(d.id); if (!c) return; if (S.facturas.some(f => f.clienteId === c.id)) return toast('Tiene facturas registradas: no se puede eliminar', 'err');
    confirmDlg(`¿Eliminar a <b>${esc(c.nombre)}</b>?${c.userId ? ' Su cuenta de acceso se mantiene; elimínala en Ajustes → Equipo si ya no la necesitas.' : ''}`, 'Eliminar', () => { S.clientes = S.clientes.filter(x => x.id !== c.id); save(); $$('.overlay').forEach(o => closeModal(o)); render(); toast('Vendedor eliminado', 'ok'); }); },
  vdCopy: () => { try { navigator.clipboard.writeText(window._vcred || ''); toast('Copiado', 'ok'); } catch { toast('No se pudo copiar', 'err'); } },
  vdWA: d => { const c = cliente(d.id); openWA(c ? c.tel : '', window._vcred || ''); },
  vfView: d => vfView(d.id),
  vpZoom: d => { const p = prod(d.id); if (!p || !(p.imagenes && p.imagenes.length)) return; modal(`${dh(esc(p.nombre))}<img src="${p.imagenes[0]}" alt="" style="width:100%;max-height:60vh;object-fit:contain;border-radius:12px;background:#f1f5f9">${p.desc ? `<p style="margin-top:10px">${esc(p.desc)}</p>` : ''}<div class="dfoot"><button class="btn ghost" data-act="close">Cerrar</button></div>`); },
  pdRev: d => pdRev(d.id), pdOpen: d => { closeModal(); pdRev(d.id); }, pdApprove: d => pdApprove(d.id), pdReject: d => pdReject(d.id)
});
{ const _cr = ACT.cliRemind; /* el recordatorio de pago funciona igual para vendedores */ void _cr; }
Object.assign(INP, {
  vq: e => { vq = e.target.value; vpRefresh(); },
  prQty: e => { const it = PR && PR.items[+e.target.dataset.i]; if (it) { it.qty = Math.max(0, Math.floor(num(e.target.value))); prTot(); } },
  prPrecio: e => { const it = PR && PR.items[+e.target.dataset.i]; if (it) { it.precio = Math.max(0, r2(num(e.target.value))); prTot(); } },
  prRec: e => { if (!PR) return; PR.rec = Math.max(0, num(e.target.value)); PR.items.forEach((it, i) => { it.precio = r2(it.base * (1 + PR.rec / 100)); const inp = $('[data-input=prPrecio][data-i="' + i + '"]'); if (inp) inp.value = it.precio; }); prTot(); },
  prDesc: e => { if (PR) { PR.desc = e.target.value; prTot(); } }, prCuotas: e => { if (PR) { PR.cuotas = e.target.value; prTot(); } },
  prFreq: e => { if (!PR) return; PR.freq = +e.target.value; PR.vence = addDays(todayStr(), PR.freq); const v = $('[data-input=prVence]'); if (v) v.value = PR.vence; prTot(); },
  prVence: e => { if (PR) PR.vence = e.target.value; }, prIni: e => { if (PR) { PR.ini = e.target.value; prTot(); } }, prMet: e => { if (PR) PR.met = e.target.value; }
});

/* ---------- ajustes menores ---------- */
{ const _um = userModal; userModal = function (u) { _um(u); const s = $('#us-rol'); if (s && !s.querySelector('[value=vendedor]')) { s.insertAdjacentHTML('beforeend', '<option value="vendedor">Vendedor — solo ve el stock y envía pedidos</option>'); if (u && u.rol === 'vendedor') s.value = 'vendedor'; } }; }
