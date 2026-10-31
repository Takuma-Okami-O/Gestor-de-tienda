'use strict';
/* Gestor de Tienda — extras: segunda moneda y tasa en vivo, caja diaria, gastos,
   respaldos (nube + exportar todo) y aviso de nuevas versiones. Se carga después de app.js y sync.js. */

/* ---------- 1) Segunda moneda y tasa del día ---------- */
const XT = {
  K: 'gestor_tasas', r: { bcv: 0, usdt: 0, t: 0 },
  load() { try { const o = JSON.parse(localStorage.getItem(this.K)); if (o) this.r = Object.assign(this.r, o); } catch { } },
  async get(url) { const c = new AbortController(), t = setTimeout(() => c.abort(), 9000); try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw 0; const j = await r.json(); const v = +(j.promedio || j.venta || j.price || 0); return v > 0 ? v : 0; } catch { return 0; } finally { clearTimeout(t); } },
  async refresh(manual) {
    if (!navigator.onLine) { if (manual) toast('Sin internet: se usa la última tasa guardada', 'err'); return; }
    this.r.c = Date.now();
    if (SB() && L.token) { // 1.º: la tasa centralizada del servidor (una sola consulta para todas las tiendas)
      try { const r = await rpc(manual ? 'tasas_refrescar' : 'tasas_get'); if (r && (r.bcv > 0 || r.usdt > 0) && Date.now() - r.t < 4 * 3600e3) { if (r.bcv > 0) this.r.bcv = +r.bcv; if (r.usdt > 0) this.r.usdt = +r.usdt; this.r.t = r.t; try { localStorage.setItem(this.K, JSON.stringify(this.r)); } catch { } if (manual) toast('Tasas actualizadas', 'ok'); this.paint(); return; } } catch { }
    }
    const [b, u] = await Promise.all([this.get('https://ve.dolarapi.com/v1/dolares/oficial'), this.get('https://ve.dolarapi.com/v1/dolares/paralelo')]);
    if (b) this.r.bcv = b; if (u) this.r.usdt = u;
    if (b || u) { this.r.t = Date.now(); try { localStorage.setItem(this.K, JSON.stringify(this.r)); } catch { } }
    if (manual) toast(b || u ? 'Tasas actualizadas' : 'No se pudo consultar las tasas ahora', b || u ? 'ok' : 'err');
    this.paint();
  },
  on() { return !!S.config.tasaOn; },
  rate() { const c = S.config; if (!c.tasaOn) return 0; return c.tasaFuente === 'manual' ? num(c.tasaManual) : (this.r[c.tasaFuente] || 0); },
  sym() { return S.config.moneda2 || 'Bs'; },
  bs(n, tasa) { const t = tasa || this.rate(); return t ? this.sym() + ' ' + NF.format(n * t) : ''; },
  age() { return this.r.t ? Math.max(0, Math.round((Date.now() - this.r.t) / 60000)) : -1; },
  bar() {
    if (!this.on()) return '';
    const c = S.config, t = this.rate(), a = this.age();
    return `<div class="ratebar"><span>💱 <b>${c.tasaFuente === 'manual' ? 'Tasa manual' : c.tasaFuente === 'usdt' ? 'USDT' : 'BCV'}</b>: ${t ? this.sym() + ' ' + NF.format(t) : 'sin datos'}</span>`
      + `<span class="muted small">${c.tasaFuente === 'manual' ? 'fijada por el dueño' : a < 0 ? 'sin consultar' : a < 2 ? 'actualizada ahora' : 'hace ' + (a < 60 ? a + ' min' : Math.round(a / 60) + ' h')}</span>`
      + (c.tasaFuente !== 'manual' ? `<button class="btn sm ghost" data-act="tasaRef">↻</button>` : '') + `</div>`;
  },
  paint() { $$('.ratebar').forEach(el => { el.outerHTML = this.bar() || '<span></span>'; }); if (typeof updateTotals === 'function') updateTotals(); }
};
XT.load();

/* ---------- 2) Caja diaria ---------- */
const metodosPag = () => [...new Set([...METODOS, ...activas().flatMap(f => f.abonos.map(a => a.metodo)).filter(Boolean)])];
function cajaDia(d) {
  const fs = activas().filter(f => ymd(f.fecha) === d);
  const ab = activas().flatMap(f => f.abonos.map(a => ({ ...a, f }))).filter(a => ymd(a.fecha) === d);
  const por = {}; ab.forEach(a => { const m = a.metodo || 'Otro'; por[m] = r2((por[m] || 0) + a.monto); });
  const gs = (S.gastos || []).filter(g => ymd(g.fecha) === d), gpor = {}; gs.forEach(g => { const m = g.metodo || 'Efectivo'; gpor[m] = r2((gpor[m] || 0) + g.monto); });
  const ventas = r2(sum(fs.map(f => f.total))), cobrado = r2(sum(ab.map(a => a.monto))), gastos = r2(sum(gs.map(g => g.monto)));
  return { d, fs, ab, por, gs, gpor, ventas, cobrado, gastos, credito: r2(sum(fs.map(saldo))), ganancia: r2(sum(fs.map(f => f.ganancia || 0))), anuladas: S.facturas.filter(f => f.estado === 'ANULADA' && ymd(f.fecha) === d).length };
}
let cajaD = todayStr();
const cierreDe = d => (S.cierres || []).find(c => c.dia === d);
function ultimoEfectivo(d) { const prev = (S.cierres || []).filter(c => c.dia < d).sort((a, b) => b.dia.localeCompare(a.dia))[0]; return prev ? prev.contado : 0; }
function vCaja() {
  const d = cajaD, k = cajaDia(d), cie = cierreDe(d), owner = isOwner(), efCob = k.por['Efectivo'] || 0, efGas = k.gpor['Efectivo'] || 0;
  const apert = cie ? cie.apertura : ultimoEfectivo(d), esperado = r2(apert + efCob - efGas);
  const tasa = cie && cie.tasa ? cie.tasa : XT.rate();
  const dual = n => tasa ? `<div class="muted small">${XT.bs(n, tasa)}</div>` : '';
  return `${XT.bar()}
  <div class="row wrap" style="margin-bottom:12px"><input class="in" type="date" style="width:auto" data-input="cajaD" value="${d}" max="${todayStr()}"><span class="badge ${cie ? 'ok' : 'warn'}">${cie ? 'Caja cerrada' : 'Caja abierta'}</span><div class="sp"></div>
    <button class="btn sm soft" data-act="gastoNew">${ic('plus')} Registrar gasto</button></div>
  <div class="kpis"><div class="kpi hero"><div class="kl">Ventas del día</div><div class="kv">${money(k.ventas)}</div><div class="ks">${k.fs.length} factura(s)${k.anuladas ? ' · ' + k.anuladas + ' anulada(s)' : ''}</div></div>
    <div class="kpi"><div class="kl">Cobrado</div><div class="kv">${money(k.cobrado)}</div><div class="ks">${tasa ? XT.bs(k.cobrado, tasa) : 'incluye abonos'}</div></div>
    <div class="kpi"><div class="kl">Gastos</div><div class="kv">${money(k.gastos)}</div><div class="ks">${k.gs.length} registro(s)</div></div>
    <div class="kpi"><div class="kl">Quedó a crédito</div><div class="kv">${money(k.credito)}</div><div class="ks">ventas del día</div></div></div>
  <div class="cols c2e"><div>
    <div class="card"><h3>${ic('wallet')} Cobros por método</h3>${Object.keys(k.por).length ? `<table class="t"><tbody>${Object.entries(k.por).map(([m, v]) => `<tr><td>${esc(m)}</td><td class="r b">${money(v)}${dual(v)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty" style="padding:14px">Sin cobros este día</div>'}</div>
    <div class="card"><h3>${ic('tag')} Gastos del día</h3>${k.gs.map(g => `<div class="row small" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line,#eee)"><span>${esc(g.concepto)} <span class="muted">· ${esc(g.metodo)}${g.por ? ' · ' + esc(g.por) : ''}</span></span><span><b>−${money(g.monto)}</b>${owner && !cie ? ` <button class="iconbtn bad" data-act="gastoDel" data-id="${g.id}">${ic('trash')}</button>` : ''}</span></div>`).join('') || '<div class="empty" style="padding:14px">Sin gastos</div>'}</div></div>
  <div>
    <div class="card"><h3>${ic('check')} Arqueo y cierre</h3>
    ${cie ? `<dl class="kv2"><dt>Fondo de apertura</dt><dd>${money(cie.apertura)}</dd><dt>Efectivo esperado</dt><dd>${money(cie.esperado)}</dd><dt>Efectivo contado</dt><dd>${money(cie.contado)}</dd><dt>Diferencia</dt><dd style="color:${Math.abs(cie.diferencia) < .005 ? 'var(--ok)' : 'var(--bad)'}"><b>${cie.diferencia > 0 ? '+' : ''}${money(cie.diferencia)}</b> ${Math.abs(cie.diferencia) < .005 ? '(cuadra)' : cie.diferencia > 0 ? '(sobra)' : '(falta)'}</dd><dt>Cerrado por</dt><dd>${esc(cie.por || '')} · ${fdt(cie.cerrado)}</dd>${cie.nota ? `<dt>Nota</dt><dd>${esc(cie.nota)}</dd>` : ''}</dl>
      <div class="row wrap" style="margin-top:12px"><button class="btn soft" style="flex:1" data-act="cajaPrint">${ic('print')} Imprimir / PDF</button><button class="btn soft" style="flex:1" data-act="cajaWA">${ic('chat')} WhatsApp</button>${owner ? `<button class="btn danger" style="flex:1" data-act="cajaReabrir">Reabrir</button>` : ''}</div>`
      : `<p class="muted small" style="margin-bottom:10px">Cuenta el efectivo que hay en la caja y compáralo con lo que debería haber.</p>
      <div class="f"><label class="l">Fondo de apertura (efectivo con el que empezó)</label><input class="in" id="cj-ap" type="number" step="0.01" inputmode="decimal" data-input="cajaCalc" value="${apert}"></div>
      <dl class="kv2" style="margin:8px 0"><dt>+ Cobros en efectivo</dt><dd>${money(efCob)}</dd><dt>− Gastos en efectivo</dt><dd>${money(efGas)}</dd><dt>= Efectivo esperado</dt><dd><b id="cj-esp">${money(esperado)}</b></dd></dl>
      <div class="f"><label class="l">Efectivo contado</label><input class="in" id="cj-co" type="number" step="0.01" inputmode="decimal" data-input="cajaCalc" placeholder="0.00"></div>
      <div id="cj-dif" class="b" style="margin-bottom:8px"></div>
      <div class="f"><label class="l">Nota (opcional)</label><input class="in" id="cj-nota" placeholder="Ej.: faltaron 2 de cambio"></div>
      <button class="btn block ok" data-act="cajaCerrar" style="padding:14px">${ic('check')} Cerrar caja del día</button>`}</div>
    <div class="card"><h3>${ic('history')} Cierres anteriores</h3>${(S.cierres || []).slice().sort((a, b) => b.dia.localeCompare(a.dia)).slice(0, 15).map(c => `<div class="row small" data-act="cajaVer" data-d="${c.dia}" style="justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line,#eee);cursor:pointer"><span>${fdate(c.dia + 'T12:00:00')}</span><span>${money(c.ventas)} · <b style="color:${Math.abs(c.diferencia) < .005 ? 'var(--ok)' : 'var(--bad)'}">${c.diferencia > 0 ? '+' : ''}${money(c.diferencia)}</b></span></div>`).join('') || '<div class="empty" style="padding:14px">Aún no hay cierres</div>'}</div>
  </div></div>`;
}
function cajaTexto(c) {
  const k = cajaDia(c.dia), L2 = [`*${S.config.nombre}*`, `Cierre de caja — ${fdate(c.dia + 'T12:00:00')}`, '------------------------------', `Ventas: ${money(c.ventas)} (${k.fs.length} facturas)`, `Cobrado: ${money(c.cobrado)}`];
  Object.entries(c.porMetodo || {}).forEach(([m, v]) => L2.push(`  · ${m}: ${money(v)}`));
  L2.push(`Gastos: ${money(c.gastos)}`, '------------------------------', `Fondo de apertura: ${money(c.apertura)}`, `Efectivo esperado: ${money(c.esperado)}`, `Efectivo contado: ${money(c.contado)}`, `*Diferencia: ${c.diferencia > 0 ? '+' : ''}${money(c.diferencia)}*`);
  if (c.tasa) L2.push(`Tasa ${c.tasa}: ${XT.bs(c.cobrado, c.tasa)} cobrados`);
  if (c.nota) L2.push('Nota: ' + c.nota);
  L2.push(`Cerrado por ${c.por}`); return L2.join('\n');
}
function cajaHTML(c) {
  const k = cajaDia(c.dia), acc = accent();
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Cierre ${c.dia}</title><style>body{font-family:Segoe UI,Arial,sans-serif;padding:30px;color:#1e293b;font-size:13px}h1{margin:0;color:${acc}}table{width:100%;border-collapse:collapse;margin:10px 0}td,th{padding:7px 6px;border-bottom:1px solid #e5e7eb;text-align:left}.r{text-align:right}.big{font-size:17px;font-weight:800}.ft{margin-top:30px;text-align:center;color:#999;font-size:10px}</style></head><body>
  <h1>${esc(S.config.nombre)}</h1><div>Cierre de caja — <b>${fdate(c.dia + 'T12:00:00')}</b> · Cerrado por ${esc(c.por)} (${fdt(c.cerrado)})</div>
  <h3>Ventas y cobros</h3><table><tr><td>Ventas del día (${k.fs.length} facturas)</td><td class="r">${money(c.ventas)}</td></tr><tr><td>Cobrado total</td><td class="r">${money(c.cobrado)}</td></tr>${Object.entries(c.porMetodo || {}).map(([m, v]) => `<tr><td>&nbsp;&nbsp;· ${esc(m)}</td><td class="r">${money(v)}</td></tr>`).join('')}<tr><td>Gastos</td><td class="r">−${money(c.gastos)}</td></tr></table>
  ${k.gs.length ? `<h3>Gastos</h3><table>${k.gs.map(g => `<tr><td>${esc(g.concepto)} (${esc(g.metodo)})</td><td class="r">${money(g.monto)}</td></tr>`).join('')}</table>` : ''}
  <h3>Arqueo de efectivo</h3><table><tr><td>Fondo de apertura</td><td class="r">${money(c.apertura)}</td></tr><tr><td>Efectivo esperado</td><td class="r">${money(c.esperado)}</td></tr><tr><td>Efectivo contado</td><td class="r">${money(c.contado)}</td></tr><tr class="big"><td>Diferencia</td><td class="r">${c.diferencia > 0 ? '+' : ''}${money(c.diferencia)}</td></tr></table>
  ${c.nota ? `<p><b>Nota:</b> ${esc(c.nota)}</p>` : ''}${c.tasa ? `<p class="muted">Tasa del día: ${c.tasa} · ${XT.bs(c.cobrado, c.tasa)} cobrados</p>` : ''}<div class="ft">Gestor de Tienda · Desarrollado por Analista de sistemas Eber Romero</div></body></html>`;
}
Object.assign(INP, {
  cajaD: e => { cajaD = e.target.value || todayStr(); render(); },
  cajaCalc: () => {
    const k = cajaDia(cajaD), ap = num($('#cj-ap').value), esp = r2(ap + (k.por['Efectivo'] || 0) - (k.gpor['Efectivo'] || 0)), co = $('#cj-co').value;
    $('#cj-esp').textContent = money(esp);
    const el = $('#cj-dif'); if (co === '') { el.textContent = ''; return; }
    const df = r2(num(co) - esp); el.innerHTML = Math.abs(df) < .005 ? '<span style="color:var(--ok)">✔ La caja cuadra</span>' : `<span style="color:var(--bad)">Diferencia: ${df > 0 ? '+' : ''}${money(df)} (${df > 0 ? 'sobra' : 'falta'})</span>`;
  },
  tasaOn: e => { cfgEdit('tasaOn', e.target.checked); if (e.target.checked) XT.refresh(); },
  tasaFuente: e => cfgEdit('tasaFuente', e.target.value),
  tasaManual: e => cfgEdit('tasaManual', num(e.target.value), true),
  moneda2: e => cfgEdit('moneda2', e.target.value.slice(0, 4), true)
});
Object.assign(ACT, {
  tasaRef: () => XT.refresh(true),
  gastoNew: () => {
    const m = modal(`${dh('Registrar gasto')}<div class="f"><label class="l">Concepto</label><input class="in" id="gs-c" placeholder="Ej.: bolsas, transporte, almuerzo"></div>
      <div class="row"><div class="f"><label class="l">Monto (${esc(S.config.moneda)})</label><input class="in" id="gs-m" type="number" step="0.01" min="0" inputmode="decimal"></div><div class="f"><label class="l">Pagado con</label><select class="in" id="gs-t">${METODOS.map(x => `<option>${x}</option>`).join('')}</select></div></div>
      <div class="dfoot"><button class="btn ghost" data-act="close">Cancelar</button><button class="btn" id="gs-ok">Guardar</button></div>`);
    $('#gs-ok', m).onclick = () => { const c = $('#gs-c', m).value.trim(), v = r2(num($('#gs-m', m).value)); if (!c || v <= 0) return toast('Escribe el concepto y un monto mayor a 0', 'err');
      (S.gastos = S.gastos || []).unshift({ id: uid(), fecha: new Date().toISOString(), concepto: c, monto: v, metodo: $('#gs-t', m).value, por: (L.user && L.user.nombre) || '' }); save(); closeModal(m); toast('Gasto registrado', 'ok'); render(); };
  },
  gastoDel: d => confirmDlg('¿Eliminar este gasto?', 'Eliminar', () => { S.gastos = (S.gastos || []).filter(g => g.id !== d.id); save(); render(); }),
  cajaCerrar: () => {
    const k = cajaDia(cajaD), co = $('#cj-co').value; if (co === '') return toast('Escribe el efectivo contado', 'err');
    const ap = r2(num($('#cj-ap').value)), esp = r2(ap + (k.por['Efectivo'] || 0) - (k.gpor['Efectivo'] || 0)), cont = r2(num(co));
    confirmDlg(`Se cerrará la caja del ${fdate(cajaD + 'T12:00:00')}. Efectivo esperado ${money(esp)}, contado ${money(cont)}.`, 'Cerrar caja', () => {
      if (cierreDe(cajaD)) return;
      (S.cierres = S.cierres || []).push({ id: uid(), dia: cajaD, cerrado: new Date().toISOString(), por: (L.user && L.user.nombre) || '', apertura: ap, esperado: esp, contado: cont, diferencia: r2(cont - esp), ventas: k.ventas, cobrado: k.cobrado, gastos: k.gastos, porMetodo: k.por, tasa: XT.rate() || 0, nota: $('#cj-nota') ? $('#cj-nota').value.trim() : '' });
      save(); toast('Caja cerrada', 'ok'); render();
    }, false);
  },
  cajaReabrir: () => confirmDlg('Se eliminará el cierre de este día para poder corregirlo.', 'Reabrir', () => { S.cierres = (S.cierres || []).filter(c => c.dia !== cajaD); save(); render(); }),
  cajaVer: d => { cajaD = d.d; render(); },
  cajaPrint: () => { const c = cierreDe(cajaD); if (c) printHTML(cajaHTML(c), 'cierre-' + c.dia + '.html'); },
  cajaWA: () => { const c = cierreDe(cajaD); if (c) openWA(S.config.whatsapp || '', cajaTexto(c)); }
});
ROUTES.caja = { t: 'Caja diaria', n: 'Caja', i: 'wallet', v: vCaja };
SIDE.splice(SIDE.indexOf('historial'), 0, 'caja');
const _vMas = vMas; vMas = function () { return _vMas().replace('<div class="tile" data-act="go" data-r="inicio">', `<div class="tile" data-act="go" data-r="caja">${ic('wallet')}Caja diaria</div><div class="tile" data-act="go" data-r="inicio">`); };

/* ---------- 3) Mostrar la segunda moneda en venta, inicio y factura ---------- */
const _ut = updateTotals; updateTotals = function () {
  _ut(); const t = $('#cart-totals'); if (!t || !XT.rate()) return; const c = cartCalc(), v = cart.tipo === 'CREDITO' ? c.saldo : c.total;
  t.insertAdjacentHTML('beforeend', `<div class="tr" style="font-size:13px;color:var(--muted)"><span>≈ ${esc(XT.sym())} (tasa ${NF.format(XT.rate())})</span><b>${XT.bs(v)}</b></div>`);
};
const _vInicio = vInicio; vInicio = function () { return XT.bar() + _vInicio(); };
const _vVender = vVender; vVender = function () { return XT.bar() + _vVender(); };
const _facText = facText; facText = function (f) { const t = _facText(f); return f.tasa ? t.replace(/(\*TOTAL: [^\n]*\*)/, `$1\n≈ ${XT.bs(f.total, f.tasa)} (tasa ${NF.format(f.tasa)})`) : t; };
const _facHTML = facHTML; facHTML = function (f) { const h = _facHTML(f); return f.tasa ? h.replace(/(<div class="big"><span>TOTAL<\/span><span>[^<]*<\/span><\/div>)/, `$1<div style="color:#64748b"><span>≈ ${esc(XT.sym())} (tasa ${NF.format(f.tasa)})</span><span>${XT.bs(f.total, f.tasa)}</span></div>`) : h; };
const _facModal = facModal; facModal = function (id, nueva) { _facModal(id, nueva); const f = factura(id); if (f && isOwner() && f.estado !== 'ANULADA' && f.tipo === 'CREDITO') { const v = $('[data-act=facVoid]', [...$$('.dialog')].pop()); if (v) v.insertAdjacentHTML('beforebegin', `<button class="btn soft" data-act="facEdit" data-id="${f.id}">Editar montos</button>`); } if (!f || !f.tasa) return; const t = [...$$('.dialog .totals')].pop(); if (t) t.insertAdjacentHTML('afterbegin', `<div class="tr" style="font-size:12px;color:var(--muted)"><span>Tasa ${NF.format(f.tasa)}</span><span>≈ ${XT.bs(f.total, f.tasa)}</span></div>`); };

ROUTES.inicio.v = vInicio; ROUTES.vender.v = vVender; ROUTES.mas.v = vMas;

/* ---------- 4) Ajustes: tasa, respaldos, versión ---------- */
const lastExp = () => +(localStorage.getItem('gestor_lastexport') || 0);
function csvOf(rows) { return '﻿' + rows.map(r => r.map(v => { v = String(v ?? ''); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n'); }
const CSVS = {
  productos: () => [['Código', 'Nombre', 'Categoría', 'Variante', 'Costo', 'Precio', 'Stock', 'Mínimo'], ...S.productos.map(p => [p.sku, p.nombre, p.categoria, p.variante, p.costo, p.precio, p.stock, p.minimo])],
  clientes: () => [['Nombre', 'Teléfono', 'Documento', 'Dirección', 'Deuda'], ...S.clientes.map(c => [c.nombre, c.tel, c.doc, c.dir, deudaCliente(c.id)])],
  facturas: () => [['N.º', 'Fecha', 'Cliente', 'Tipo', 'Estado', 'Total', 'Pagado', 'Saldo', 'Tasa'], ...S.facturas.map(f => [f.num, f.fecha, f.clienteNombre, f.tipo, f.estado, f.total, pagado(f), saldo(f), f.tasa || ''])],
  gastos: () => [['Fecha', 'Concepto', 'Monto', 'Método', 'Registrado por'], ...(S.gastos || []).map(g => [g.fecha, g.concepto, g.monto, g.metodo, g.por])],
  cierres: () => [['Día', 'Ventas', 'Cobrado', 'Gastos', 'Apertura', 'Esperado', 'Contado', 'Diferencia', 'Cerrado por'], ...(S.cierres || []).map(c => [c.dia, c.ventas, c.cobrado, c.gastos, c.apertura, c.esperado, c.contado, c.diferencia, c.por])]
};
function ajustesExtra() {
  const c = cfgD(), owner = isOwner(), a = XT.age();
  const tasa = `<div class="card"><h3>💱 Segunda moneda y tasa del día</h3>
    ${owner ? `<label class="row" style="gap:10px;margin-bottom:10px"><input type="checkbox" data-input="tasaOn" ${c.tasaOn ? 'checked' : ''}> <span>Mostrar precios también en bolívares</span></label>
    <div class="row"><div class="f"><label class="l">Fuente de la tasa</label><select class="in" data-input="tasaFuente"><option value="bcv" ${c.tasaFuente === 'bcv' ? 'selected' : ''}>BCV (oficial)</option><option value="usdt" ${c.tasaFuente === 'usdt' ? 'selected' : ''}>USDT / paralelo (referencia)</option><option value="manual" ${c.tasaFuente === 'manual' ? 'selected' : ''}>Manual</option></select></div>
    <div class="f" style="max-width:110px"><label class="l">Símbolo</label><input class="in" data-input="moneda2" value="${esc(c.moneda2 || 'Bs')}" maxlength="4"></div></div>
    ${c.tasaFuente === 'manual' ? `<div class="f"><label class="l">Tasa manual (${esc(c.moneda2 || 'Bs')} por ${esc(c.moneda)})</label><input class="in" type="number" step="0.01" inputmode="decimal" data-input="tasaManual" value="${c.tasaManual || ''}"></div>` : ''}` : `<p class="muted small">${c.tasaOn ? 'El dueño activó la segunda moneda.' : 'Segunda moneda desactivada por el dueño.'}</p>`}
    <dl class="kv2" style="margin:6px 0 10px"><dt>BCV</dt><dd>${XT.r.bcv ? NF.format(XT.r.bcv) : '—'}</dd><dt>USDT / paralelo</dt><dd>${XT.r.usdt ? NF.format(XT.r.usdt) : '—'}</dd><dt>Consultado</dt><dd>${a < 0 ? 'nunca' : a < 2 ? 'ahora' : 'hace ' + (a < 60 ? a + ' min' : Math.round(a / 60) + ' h')}</dd></dl>
    <button class="btn soft block" data-act="tasaRef">↻ Actualizar tasas ahora</button>
    <div class="hint small" style="margin-top:8px">Se actualiza sola cada hora con internet (el servidor la consulta cada 30 min para todas las tiendas). Sin conexión se usa la última tasa guardada. Cada factura guarda la tasa del momento de la venta.</div></div>`;
  const resp = owner ? `<div class="card"><h3>${ic('download')} Respaldos</h3>
    <p class="muted small" style="margin-bottom:10px">La nube guarda una copia automática cada día (sin fotos, se conservan las últimas 30). Además puedes exportar todo tu negocio en un archivo.${Date.now() - lastExp() > 7 * 864e5 ? '<br><b style="color:var(--bad)">Hace más de 7 días que no exportas una copia.</b>' : ''}</p>
    <button class="btn block" data-act="exportAll">${ic('download')} Exportar todo (archivo completo)</button>
    <div class="row wrap" style="margin-top:8px">${Object.keys(CSVS).map(k => `<button class="btn sm soft" data-act="exportCsv" data-k="${k}">${k[0].toUpperCase() + k.slice(1)} .csv</button>`).join('')}</div>
    ${SB() ? `<div class="row wrap" style="margin-top:12px"><button class="btn soft" style="flex:1" data-act="bkNow">☁ Crear copia en la nube ahora</button><button class="btn ghost" style="flex:1" data-act="bkList">Ver / restaurar copias</button></div>` : ''}</div>` : '';
  const ver = `<div class="card"><h3>🔄 Versión</h3><div class="small muted" id="ver-info">Versión instalada: <b>${esc(UPD.cur || '—')}</b></div><button class="btn soft block" style="margin-top:8px" data-act="updCheck">Buscar actualización</button></div>`;
  const perm = owner ? `<div class="card"><h3>${ic('users')} Permisos del equipo</h3>
    <label class="row" style="gap:10px;cursor:pointer"><input type="checkbox" data-input="cfgChk" data-k="empInv" ${c.empInv ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)"> <span>Permitir que los empleados <b>editen el inventario</b> (crear, modificar y borrar productos)</span></label>
    <div class="hint small" style="margin-top:8px">Apagado: los empleados solo ven productos y existencias, y pueden vender. Se aplica también en el servidor.</div></div>
  <div class="card"><h3>🔔 Recordatorios de cobro</h3>
    <label class="row" style="gap:10px;margin-bottom:10px;cursor:pointer"><input type="checkbox" data-input="cfgChk" data-k="recOn" ${c.recOn ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)"> <span>Avisarme qué deudores cobrar hoy</span></label>
    <div class="row"><div class="f" style="max-width:150px"><label class="l">Cada (días)</label><input class="in" type="number" min="0" inputmode="numeric" data-input="cfg" data-k="recDias" value="${esc(c.recDias)}"></div>
    <div class="f"><label class="l">Fechas específicas</label><input class="in" data-input="cfg" data-k="recFechas" value="${esc(c.recFechas)}" placeholder="2026-11-05, 2026-11-20"></div></div>
    <div class="f"><label class="l">Avisar antes de cada cuota (días antes)</label><input class="in" type="number" min="0" max="30" inputmode="numeric" data-input="cfg" data-k="recAntes" value="${esc(c.recAntes)}"></div>
    <div class="row"><div class="f"><label class="l">Saludo (opcional)</label><input class="in" maxlength="140" data-input="cfg" data-k="recSaludo" value="${esc(c.recSaludo)}" placeholder="Hola {nombre} 👋"></div><div class="f"><label class="l">Cierre (opcional)</label><input class="in" maxlength="140" data-input="cfg" data-k="recCierre" value="${esc(c.recCierre)}" placeholder="¡Gracias por tu puntualidad!"></div></div>
    <div class="small muted b" style="margin:6px 0 4px">VISTA PREVIA</div><div id="rec-prev" style="white-space:pre-wrap;background:#e7f7e1;border-radius:12px;padding:10px 12px;font-size:13px">${esc(recPrev())}</div>
    <div class="hint small" style="margin-top:8px">Puedes personalizar solo el saludo y el cierre (con {nombre} y {tienda}). Las cuotas, fechas y montos las arma la app y no se pueden borrar ni dañar. Los deudores nunca ven la palabra «vencida».</div></div>` : '';
  return tasa + perm + resp + ver;
}
const _vAj = vAjustes; vAjustes = function () { const h = _vAj(), i = h.indexOf(' Sincronización en la nube'); if (i < 0) return h; const j = h.lastIndexOf('<div class="card">', i); return h.slice(0, j) + ajustesExtra() + h.slice(j); };
ROUTES.ajustes.v = vAjustes;
Object.assign(ACT, {
  exportAll: () => { saveFile(`gestor-completo-${S.config.nombre.replace(/\W+/g, '-')}-${todayStr()}.json`, JSON.stringify({ app: 'gestor-de-tienda', exportado: new Date().toISOString(), ...S }), 'application/json'); try { localStorage.setItem('gestor_lastexport', Date.now()); } catch { } },
  exportCsv: d => saveFile(`${d.k}-${todayStr()}.csv`, csvOf(CSVS[d.k]()), 'text/csv'),
  bkNow: async () => { try { await syncNow(); await rpc('respaldo_crear'); toast('Copia creada en la nube', 'ok'); } catch (e) { toast(e.message, 'err'); } },
  bkList: async () => {
    try {
      const l = await rpc('respaldos_lista');
      modal(`${dh('Copias en la nube')}<p class="muted small" style="margin-bottom:8px">Restaurar reemplaza los datos de toda la tienda por los de esa fecha (se guarda antes una copia de lo actual). Las fotos actuales se conservan.</p>
        ${l.map(b => `<div class="row small" style="justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line,#eee)"><span>${fdt(b.fecha)} · ${b.tipo === 'auto' ? 'automática' : b.tipo === 'manual' ? 'manual' : 'previa a restaurar'} · ${b.n} reg.</span><button class="btn sm soft" data-act="bkRestore" data-id="${b.id}">Restaurar</button></div>`).join('') || '<div class="empty">Aún no hay copias. La primera se crea sola esta noche, o crea una ahora.</div>'}<div class="dfoot"><button class="btn ghost" data-act="close">Cerrar</button></div>`);
    } catch (e) { toast(e.message, 'err'); }
  },
  bkRestore: d => confirmDlg('Se reemplazarán los datos de TODA la tienda por esta copia. Los equipos se actualizarán al sincronizar.', 'Restaurar', async () => {
    try { await syncNow(); const r = await rpc('respaldo_restaurar', { p_id: +d.id }); $$('.overlay').forEach(o => closeModal(o)); Y.cursor = 0; await saveSyncMeta(); await syncNow(); toast('Copia restaurada (' + r.restaurados + ' registros)', 'ok'); render(); } catch (e) { toast(e.message, 'err'); }
  }),
  updCheck: () => UPD.check(true)
});

/* ---------- 5) Aviso de nueva versión ---------- */
const UPD = {
  cur: '', async fetchV() { const r = await fetch('version.json?_=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw 0; return (await r.json()).v || ''; },
  async check(manual) {
    try {
      const v = await this.fetchV();
      if (!this.cur) { this.cur = v; return; }
      if (v && v !== this.cur) { this.banner(); if (manual) toast('Hay una versión nueva', 'ok'); } else if (manual) toast('Ya tienes la última versión', 'ok');
    } catch { if (manual) toast('No se pudo consultar (¿sin internet?)', 'err'); }
  },
  banner() {
    if ($('#upd-bar')) return; const b = document.createElement('div'); b.id = 'upd-bar';
    b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);width:calc(100% - 24px);max-width:560px;bottom:78px;z-index:99;background:var(--ink,#222);color:#fff;border-radius:14px;padding:12px 14px;display:flex;gap:10px;align-items:center;box-shadow:0 8px 30px rgba(0,0,0,.3)';
    b.innerHTML = '<span style="flex:1">✨ Hay una versión nueva de Gestor de Tienda</span><button class="btn sm" id="upd-go">Actualizar</button>'; document.body.appendChild(b);
    $('#upd-go').onclick = async () => { await saveNow(); try { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); const rg = await navigator.serviceWorker.getRegistration(); if (rg) await rg.unregister(); } catch { } location.reload(); };
  }
};
UPD.fetchV().then(v => { UPD.cur = v; }).catch(() => { });
setInterval(() => UPD.check(false), 30 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { UPD.check(false); if (XT.on() && Date.now() - (XT.r.c || 0) > 60 * 60 * 1000) XT.refresh(); } });
setInterval(() => { if (XT.on() && !document.hidden) XT.refresh(); }, 60 * 60 * 1000);
if (XT.on()) XT.refresh();
else { const w = setInterval(() => { if (typeof Y !== 'undefined' && Y.pulled) { clearInterval(w); if (XT.on()) XT.refresh(); } }, 2000); setTimeout(() => clearInterval(w), 60000); }

/* ---------- 6) Permiso de inventario para empleados ---------- */
const canInv = () => isOwner() || !!S.config.empInv;
const _vInv = vInventario; vInventario = function () { let h = _vInv(); if (!canInv()) h = h.replace(/<button class="btn" data-act="prodNew">[\s\S]*?<\/button>/, '').replace(/<button class="btn ghost" data-act="catMgr">[\s\S]*?<\/button>/, ''); return h; };
ROUTES.inventario.v = vInventario;
for (const k of ['prodNew', 'prodSave', 'prodDel', 'imgAdd', 'imgRm', 'catMgr', 'catAdd', 'catDel']) { const f = ACT[k]; if (f) ACT[k] = (...a) => canInv() ? f(...a) : toast('Solo el dueño puede modificar el inventario', 'err'); }
const _pe = ACT.prodEdit; ACT.prodEdit = (d, ...a) => {
  if (canInv()) return _pe(d, ...a); const p = prod(d.id); if (!p) return; const [k, t] = stockBadge(p);
  modal(`${dh(esc(p.nombre), `<span class="badge ${k}">${t}</span>`)}${(p.imagenes || []).length ? `<div class="row" style="gap:6px;overflow-x:auto;margin-bottom:10px">${p.imagenes.map(s => `<img src="${s}" style="height:120px;border-radius:10px">`).join('')}</div>` : ''}
    <dl class="kv2"><dt>Categoría</dt><dd>${esc(p.categoria)}</dd>${p.variante ? `<dt>Variante</dt><dd>${esc(p.variante)}</dd>` : ''}<dt>Código</dt><dd>${esc(p.sku)}</dd><dt>Precio</dt><dd>${money(p.precio)}${XT.rate() ? ' · ' + XT.bs(p.precio) : ''}</dd><dt>Existencia</dt><dd><b>${p.stock}</b> unidades</dd></dl>
    ${p.desc ? `<p class="muted small" style="margin-top:8px">${esc(p.desc)}</p>` : ''}<div class="dfoot"><button class="btn" data-act="close">Cerrar</button></div>`);
};

/* ---------- 7) Cuotas y recordatorios de cobro ---------- */
const recBar = () => { const n = recDue().length; return n ? `<div class="recbar"><span>🔔 <b>${n}</b> cobro${n === 1 ? '' : 's'} por recordar hoy</span><button class="btn sm" data-act="recOpen">Ver y enviar</button></div>` : ''; };
const _vCre = vCreditos; vCreditos = function () { return recBar() + _vCre(); }; ROUTES.creditos.v = vCreditos;
const _vIni2 = vInicio; vInicio = function () { return recBar() + _vIni2(); }; ROUTES.inicio.v = vInicio;
function recModal() {
  const l = recDue();
  modal(`${dh('Cobros por recordar')}${l.map(x => `<div class="row small" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line,#eee);gap:8px"><span><b>${esc(x.cl.nombre)}</b><br><span class="muted">${money(deudaCliente(x.cl.id))} · ${esc(x.motivo)}</span></span><button class="btn sm ok" data-act="recSend" data-id="${x.cl.id}">${ic('chat')} WhatsApp</button></div>`).join('') || '<div class="empty">Nada pendiente por hoy 🎉</div>'}<div class="dfoot"><button class="btn" data-act="close">Cerrar</button></div>`);
}
Object.assign(ACT, { recOpen: recModal, recSend: d => { const c = cliente(d.id); openWA(c.tel, remindText(d.id)); marcaRec(d.id); closeModal(); setTimeout(recModal, 300); } });
function recAviso() { try { if (!L.token || !recDue().length) return; const k = 'gestor_rec_' + todayStr(); if (localStorage.getItem(k)) return; localStorage.setItem(k, 1); const n = recDue().length; toast('🔔 ' + n + ' cobro(s) por recordar hoy: toca «Ver y enviar»'); if (location.hash === '#inicio' || !location.hash) render(); if ('Notification' in window && Notification.permission === 'granted') new Notification('Gestor de Tienda', { body: n + ' cobro(s) por recordar hoy' }); } catch { } }
setTimeout(recAviso, 8000); setInterval(recAviso, 30 * 60 * 1000);

// al terminar de escribir un precio/recargo de crédito, se redibuja el carrito (así no se pierde el cursor mientras escribes)
document.addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.input; if (k === 'cartPrecio' || k === 'cartRec') renderCart(); });

/* ---------- 8) Ajustes ordenado en secciones (menú «Más» y barra lateral) ---------- */
const ajFull = vAjustes;
function ajCards() {
  const t = document.createElement('template'); t.innerHTML = ajFull(); const o = {};
  t.content.querySelectorAll('.card').forEach(c => {
    const h = (c.querySelector('h3') || {}).textContent || '', x = h.trim();
    const k = /Datos del negocio/.test(x) ? 'datos' : /Apariencia/.test(x) ? 'apar' : /Mi cuenta/.test(x) ? 'cuenta' : /Sincronizaci/.test(x) ? 'sync' : /^Equipo/.test(x) ? 'equipo' : /Permisos del equipo/.test(x) ? 'perm' : /Bloqueo/.test(x) ? 'pin'
      : /Respaldo de datos/.test(x) ? 'resp1' : /Respaldos/.test(x) ? 'resp2' : /ejemplo y reinicio/.test(x) ? 'demo' : /Segunda moneda/.test(x) ? 'tasa' : /Recordatorios/.test(x) ? 'cobros' : /Versi/.test(x) ? 'ver' : 'otro';
    o[k] = c.outerHTML;
  });
  return o;
}
const sig = '<div class="dev" style="text-align:center;margin:18px 0 6px;color:var(--muted,#888)">Gestor de Tienda · Desarrollado por Analista de sistemas Eber Romero</div>';
const cols = (a, b) => `<div class="cols c2e"><div>${a.join('')}</div><div>${b.join('')}</div></div>${sig}`;
const soloDueno = () => `<div class="card"><div class="empty">${ic('lock')}<b>Solo el dueño</b>Esta sección la administra el dueño de la tienda.</div></div>`;
const PAGES = {
  ajustes: c => cols([c.datos, c.cuenta, c.pin], [c.equipo, c.perm, c.demo]),
  apariencia: c => c.apar ? cols([c.apar], []) : soloDueno(),
  tasa: c => cols([c.tasa], []),
  cobros: c => c.cobros ? cols([c.cobros], []) : soloDueno(),
  respaldos: c => c.resp2 ? cols([c.resp2], [c.resp1]) : soloDueno(),
  sistema: c => cols([c.sync], [c.ver])
};
vAjustes = function () { return PAGES.ajustes(ajCards()); };
const NEWR = { apariencia: ['Apariencia', 'tag'], tasa: ['Tasa del día', 'trend'], cobros: ['Recordatorios de cobro', 'alert', 'Cobros'], respaldos: ['Respaldos', 'download'], sistema: ['Versión y sincronización', 'share', 'Sincronización'] };
ROUTES.ajustes.v = vAjustes; ROUTES.ajustes.t = 'Ajustes del negocio';
for (const k in NEWR) ROUTES[k] = { t: NEWR[k][0], i: NEWR[k][1], n: NEWR[k][2], v: () => PAGES[k](ajCards()), after: k === 'sistema' ? () => refreshSyncInfo() : undefined };
const OWNER_ONLY = ['apariencia', 'cobros', 'respaldos'];
const GRUPOS = [['', ['inicio', 'vender', 'inventario', 'creditos', 'caja', 'historial', 'catalogo']], ['Configuración', ['ajustes', 'apariencia', 'tasa', 'cobros', 'respaldos', 'sistema']]];
const _bn = buildNav; buildNav = function () {
  _bn();
  $('#side-nav').innerHTML = GRUPOS.map(([t, ks]) => (t ? `<div class="navh">${t}</div>` : '') + ks.filter(k => ROUTES[k] && (isOwner() || !OWNER_ONLY.includes(k))).map(k => `<a data-act="go" data-r="${k}" data-nav="${k}">${ic(ROUTES[k].i)}<span>${ROUTES[k].n || ROUTES[k].t}</span></a>`).join('')).join('');
};
vMas = function () {
  const tile = (k, l, i) => `<div class="tile" data-act="go" data-r="${k}">${ic(i || ROUTES[k].i)}${l || ROUTES[k].n || ROUTES[k].t}</div>`, own = isOwner();
  return `<div class="navh" style="padding:0 2px 8px">Gestión</div><div class="tiles">${tile('historial')}${tile('catalogo')}${tile('caja')}${tile('inicio', 'Resumen', 'home')}</div>
  <div class="navh" style="padding:18px 2px 8px">Configuración</div><div class="tiles">${tile('ajustes')}${own ? tile('apariencia') : ''}${tile('tasa')}${own ? tile('cobros', 'Recordatorios de cobro') : ''}${own ? tile('respaldos') : ''}${tile('sistema', 'Versión y sincronización')}</div>`;
};
ROUTES.mas.v = vMas;
if (L && L.token) { try { buildNav(); } catch { } }

/* ---------- 9) Editar montos de una factura a crédito (solo dueño) ---------- */
function feCalc() {
  const f = factura($('#fe-id').value), its = [...$$('.fe-p')].map(x => r2(num(x.value))), pct = Math.min(100, Math.max(0, num($('#fe-d').value)));
  const sub = r2(sum(f.items.map((i, k) => its[k] * i.qty))), desc = r2(sub * pct / 100), total = r2(sub - desc), pag = pagado(f), sal = r2(total - pag);
  $('#fe-res').innerHTML = `Subtotal ${money(sub)}${pct ? ` · Descuento −${money(desc)}` : ''}<br><b>Nuevo total ${money(total)}</b> · Abonado ${money(pag)} · <b style="color:${sal < 0 ? 'var(--bad)' : 'inherit'}">Saldo ${money(Math.max(0, sal))}</b>${sal < 0 ? '<br><span style="color:var(--bad)">El total no puede ser menor a lo ya abonado.</span>' : ''}`;
  return { its, pct, sub, desc, total, sal };
}
INP.feCalc = feCalc;
ACT.facEdit = d => {
  const f = factura(d.id); if (!f || !isOwner()) return; $$('.overlay').forEach(o => closeModal(o));
  modal(`${dh('Editar montos · ' + f.num)}<input type="hidden" id="fe-id" value="${f.id}">
    <p class="muted small" style="margin-bottom:8px">Cambia el precio de cada artículo. Los abonos ya registrados no se tocan y el saldo se recalcula solo. No cambia las existencias.</p>
    ${f.items.map(i => `<div class="row" style="align-items:center;gap:8px;margin-bottom:8px"><div style="flex:1" class="small"><b>${esc(i.nombre)}</b><br><span class="muted">${i.qty} × (antes ${money(i.precio)})</span></div><input class="in fe-p" type="number" step="0.01" min="0" inputmode="decimal" data-input="feCalc" style="width:110px" value="${i.precio}"></div>`).join('')}
    <div class="f"><label class="l">Descuento (%)</label><input class="in" id="fe-d" type="number" min="0" max="100" inputmode="decimal" data-input="feCalc" value="${f.descPct || ''}" placeholder="0"></div>
    <div class="hint small" id="fe-res" style="margin-bottom:6px"></div>
    <div class="dfoot"><button class="btn ghost" data-act="close">Cancelar</button><button class="btn" data-act="facEditSave">${ic('check')} Guardar montos</button></div>`);
  feCalc();
};
ACT.facEditSave = () => {
  const f = factura($('#fe-id').value), k = feCalc(); if (k.sal < 0) return toast('El total no puede ser menor a lo ya abonado', 'err');
  if (k.its.some(v => v <= 0)) return toast('Todos los precios deben ser mayores a 0', 'err');
  f.items.forEach((i, n) => { i.precio = k.its[n]; });
  f.subtotal = k.sub; f.descPct = k.pct; f.desc = k.desc; f.total = k.total; f.ganancia = r2(k.total - sum(f.items.map(i => (i.costo || 0) * i.qty)));
  f.estado = k.sal > 0.004 ? 'PENDIENTE' : 'PAGADA'; f.editada = new Date().toISOString();
  save(); $$('.overlay').forEach(o => closeModal(o)); toast('Montos actualizados', 'ok'); render(); setTimeout(() => facModal(f.id), 250);
};

/* ---------- 10) Plan de cuotas y recordatorios (mensaje con partes fijas protegidas) ---------- */
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d.toISOString()); };
const diasHasta = iso => Math.round((new Date(iso + 'T12:00:00') - new Date(todayStr() + 'T12:00:00')) / 864e5);
function plan(f) {
  if (!f || f.tipo !== 'CREDITO' || f.estado === 'ANULADA') return [];
  const n = Math.max(1, Math.floor(f.cuotas || 1)), fr = f.freq || 15;
  if (!f.vence && n === 1) return [];
  const first = f.vence || addDays(ymd(f.fecha), fr), base = r2(f.total / n); let rest = pagado(f); const hoy = todayStr();
  return [...Array(n)].map((_, k) => {
    const monto = k === n - 1 ? r2(f.total - base * (n - 1)) : base, pag = Math.min(monto, Math.max(0, rest)); rest = r2(rest - pag);
    const fecha = addDays(first, k * fr), pend = r2(monto - pag), ok = pend <= 0.004;
    return { n: k + 1, de: n, fecha, monto, pend: ok ? 0 : pend, estado: ok ? 'Pagada' : fecha < hoy ? 'Vencida' : 'Pendiente', f };
  });
}
const _ut2 = updateTotals; updateTotals = function () {
  _ut2(); const t = $('#cart-totals'); if (!t || cart.tipo !== 'CREDITO') return; const n = Math.max(1, Math.min(24, Math.floor(num(cart.cuotas)) || 1));
  if (n > 1) { const c = cartCalc(); t.insertAdjacentHTML('beforeend', `<div class="tr" style="font-size:13px;color:var(--muted)"><span>${n} cuotas de</span><b>${money(r2(c.total / n))}</b></div>`); }
};
const _rc = renderCart; renderCart = function () {
  _rc(); if (cart.tipo !== 'CREDITO') return; const v = $('[data-input=cartVence]'); if (!v) return;
  v.closest('.f').querySelector('label').textContent = 'Primera cuota vence el';
  v.closest('.row').insertAdjacentHTML('afterend', `<div class="row"><div class="f"><label class="l">N.º de cuotas</label><input class="in" type="number" min="1" max="24" inputmode="numeric" data-input="cartCuotas" value="${cart.cuotas || 1}"></div>
    <div class="f"><label class="l">Una cuota cada</label><select class="in" data-input="cartFreq">${[[7, '7 días (semanal)'], [15, '15 días (quincenal)'], [30, '30 días (mensual)']].map(([d, l]) => `<option value="${d}" ${(cart.freq || 15) === d ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>`);
  updateTotals();
};
function planHTML(p, vend) {
  return `<div class="small muted b" style="margin:10px 0 4px">PLAN DE CUOTAS</div><table class="t"><tbody>${p.map(c => `<tr><td>Cuota ${c.n}/${c.de}</td><td>${fdate(c.fecha + 'T12:00:00')}</td><td class="r b">${money(c.monto)}</td><td class="r"><span class="badge ${c.estado === 'Pagada' ? 'ok' : c.estado === 'Vencida' && vend ? 'bad' : 'warn'}">${c.estado === 'Vencida' && !vend ? 'Pendiente' : c.estado}</span></td></tr>`).join('')}</tbody></table>`;
}
const _fm2 = facModal; facModal = function (id, nueva) {
  _fm2(id, nueva); const f = factura(id), p = plan(f); if (!p.length) return; const t = [...$$('.dialog .totals')].pop(); if (t) t.insertAdjacentHTML('afterend', planHTML(p, true));
};
const _ft2 = facText; facText = function (f) {
  let t = _ft2(f), p = plan(f); if (p.length > 1) t = t.replace(/\nVence: [^\n]*/, '') + '\n\n*Plan de cuotas*\n' + p.map(c => `Cuota ${c.n}/${c.de} — ${fdate(c.fecha + 'T12:00:00')}: ${money(c.monto)}`).join('\n'); return t;
};

/* mensaje: saludo y cierre editables (solo {nombre} y {tienda}); el bloque de montos y fechas lo arma la app y no se puede borrar */
const safeTxt = (t, c) => String(t || '').slice(0, 140).replace(/\{nombre\}/gi, c.nombre).replace(/\{tienda\}/gi, S.config.nombre).replace(/\{[^}]*\}/g, '').replace(/[*_~`]/g, '').trim();
function msgBloque(c, d) {
  if (d && d.tipo === 'antes') return d.cuotas.map(x => { const dd = diasHasta(x.fecha); return `Tu cuota *${x.n} de ${x.de}* en *${S.config.nombre}* ${dd <= 0 ? 'vence hoy' : dd === 1 ? 'vence mañana' : 'vence el *' + fdate(x.fecha + 'T12:00:00') + '*'}.\nMonto a cancelar: *${money(x.pend)}*`; }).join('\n\n');
  const pend = activas().filter(f => f.clienteId === c.id && saldo(f) > 0);
  return `Tienes un saldo pendiente en *${S.config.nombre}* de *${money(deudaCliente(c.id))}*:\n` + pend.map(f => `• ${f.num} (${fdate(f.fecha)}): ${money(saldo(f))}`).join('\n');
}
remindText = function (cid, d) {
  const c = cliente(cid), cf = S.config;
  return `${safeTxt(cf.recSaludo, c) || 'Hola ' + c.nombre + ' 👋'}\n\n${msgBloque(c, d)}\n\n${safeTxt(cf.recCierre, c) || (d && d.tipo === 'antes' ? '¡Gracias por tu puntualidad!' : '¿Cuándo podemos coordinar tu pago? ¡Gracias!')}`;
};
function recDue() {
  const c = S.config; if (!c.recOn) return [];
  const hoy = todayStr(), fechas = String(c.recFechas || '').split(/[\s,;]+/).filter(Boolean), dias = Math.max(0, Math.floor(num(c.recDias))), antes = Math.max(0, Math.floor(num(c.recAntes)));
  return S.clientes.filter(cl => cl.tel && deudaCliente(cl.id) > 0).map(cl => {
    const cu = activas().filter(f => f.clienteId === cl.id).flatMap(plan).filter(x => x.pend > 0 && diasHasta(x.fecha) >= 0 && diasHasta(x.fecha) <= antes && !(cl.recs || {})[x.f.id + '|' + x.n]);
    if (cu.length) return { cl, tipo: 'antes', cuotas: cu, motivo: 'Cuota próxima a vencer' + (cu[0] ? ' (' + (diasHasta(cu[0].fecha) <= 0 ? 'hoy' : 'en ' + diasHasta(cu[0].fecha) + ' d') + ')' : '') };
    const first = activas().filter(f => f.clienteId === cl.id && saldo(f) > 0).map(f => ymd(f.fecha)).sort()[0], last = cl.ultRec || first, since = Math.floor((new Date(hoy + 'T12:00:00') - new Date(last + 'T12:00:00')) / 864e5);
    const porFecha = fechas.includes(hoy) && cl.ultRec !== hoy, porInt = dias > 0 && since >= dias && cl.ultRec !== hoy;
    return porFecha || porInt ? { cl, tipo: 'general', motivo: porFecha ? 'Fecha programada' : 'Hace ' + since + ' días sin recordatorio' } : null;
  }).filter(Boolean);
}
function marcaRec(cid, d) {
  const cl = cliente(cid); if (!cl) return; cl.ultRec = todayStr();
  if (d && d.tipo === 'antes') { cl.recs = cl.recs || {}; d.cuotas.forEach(x => { cl.recs[x.f.id + '|' + x.n] = todayStr(); }); }
  save();
}
Object.assign(ACT, { recSend: d => { const x = recDue().find(y => y.cl.id === d.id), c = cliente(d.id); openWA(c.tel, remindText(d.id, x)); marcaRec(d.id, x); closeModal(); setTimeout(recModal, 300); } });
// el botón «Recordar» de la ficha del cliente sigue enviando el recordatorio general
remind = function (cid) { const c = cliente(cid); openWA(c.tel, remindText(cid)); marcaRec(cid); };
function recPrev() { const c = cliente(S.clientes[0] && S.clientes[0].id) || { nombre: 'María', id: '' }, d = { tipo: 'antes', cuotas: [{ n: 2, de: 4, fecha: addDays(todayStr(), 3), pend: 25 }] }; const cf = cfgD(), real = S.config; S.config = cf; try { return (() => { const saved = remindText; return `${safeTxt(cf.recSaludo, c) || 'Hola ' + c.nombre + ' 👋'}\n\n${msgBloque({ id: '', nombre: c.nombre }, d)}\n\n${safeTxt(cf.recCierre, c) || '¡Gracias por tu puntualidad!'}`; })(); } finally { S.config = real; } }
document.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.k; if ((k === 'recSaludo' || k === 'recCierre') && $('#rec-prev')) $('#rec-prev').textContent = recPrev(); });
