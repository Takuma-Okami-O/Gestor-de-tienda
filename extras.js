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
    <div class="card"><h3>${ic('history')} Cierres anteriores</h3><div class="row" style="gap:8px;margin:2px 0 10px"><button class="btn sm soft" style="flex:1" data-act="cajaXlsx">${ic('download')} Excel (30 días)</button><button class="btn sm soft" style="flex:1" data-act="cajaPdf">${ic('download')} PDF (30 días)</button></div>${(S.cierres || []).slice().sort((a, b) => b.dia.localeCompare(a.dia)).slice(0, 15).map(c => `<div class="row small" data-act="cajaVer" data-d="${c.dia}" style="justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line,#eee);cursor:pointer"><span>${fdate(c.dia + 'T12:00:00')}</span><span>${money(c.ventas)} · <b style="color:${Math.abs(c.diferencia) < .005 ? 'var(--ok)' : 'var(--bad)'}">${c.diferencia > 0 ? '+' : ''}${money(c.diferencia)}</b></span></div>`).join('') || '<div class="empty" style="padding:14px">Aún no hay cierres</div>'}</div>
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
    <div class="f" style="margin-top:6px"><label class="l">Montos en los mensajes y facturas para clientes</label><select class="in" data-input="cfg" data-k="msgBs">${[['no', 'Solo en $ (recomendado)'], ['bcv', '$ y Bs a tasa BCV'], ['usdt', '$ y Bs a tasa USDT'], ['manual', '$ y Bs a tasa manual']].map(([v, l]) => `<option value="${v}" ${(c.msgBs || 'no') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
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
  // las cuotas dividen lo que queda después del abono inicial
  const ini = r2(f.inicial != null ? f.inicial : ((f.abonos || []).find(a => /inicial/i.test(a.nota || '')) || {}).monto || 0), tot = Math.max(0, r2(f.total - ini));
  const first = f.vence || addDays(ymd(f.fecha), fr), base = r2(tot / n); let rest = Math.max(0, r2(pagado(f) - ini)); const hoy = todayStr();
  return [...Array(n)].map((_, k) => {
    const monto = k === n - 1 ? r2(tot - base * (n - 1)) : base, pag = Math.min(monto, Math.max(0, rest)); rest = r2(rest - pag);
    const fecha = addDays(first, k * fr), pend = r2(monto - pag), ok = pend <= 0.004;
    return { n: k + 1, de: n, fecha, monto, pend: ok ? 0 : pend, estado: ok ? 'Pagada' : fecha < hoy ? 'Vencida' : 'Pendiente', f };
  });
}
const _ut2 = updateTotals; updateTotals = function () {
  _ut2(); const t = $('#cart-totals'); if (!t || cart.tipo !== 'CREDITO') return; const n = Math.max(1, Math.min(24, Math.floor(num(cart.cuotas)) || 1));
  if (n > 1) { const c = cartCalc(); t.insertAdjacentHTML('beforeend', `<div class="tr" style="font-size:13px;color:var(--muted)"><span>${n} cuotas de</span><b>${money(r2(c.saldo / n))}</b></div>`); }
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

/* ---------- 11) Montos en Bs opcionales en mensajes y facturas del cliente + factura corporativa ---------- */
const msgMode = () => { let d = ''; try { d = localStorage.getItem('gestor_msgbs') || ''; } catch { } return ['no', 'bcv', 'usdt', 'manual'].includes(d) ? d : (S.config.msgBs || 'no'); };
const msgRate = () => { const m = msgMode(); return m === 'bcv' ? XT.r.bcv : m === 'usdt' ? XT.r.usdt : m === 'manual' ? num(S.config.tasaManual) : 0; };
const mB = n => { const r = msgRate(); return money(n) + (r ? ` (${XT.sym()} ${NF.format(n * r)})` : ''); };
const msgSel = () => `<div class="row small" style="gap:8px;align-items:center;margin-bottom:8px"><span class="muted">Montos en:</span><select class="in" data-input="msgBsDev" style="width:auto;padding:6px 10px">${[['no', 'Solo $'], ['bcv', '$ y Bs (BCV)'], ['usdt', '$ y Bs (USDT)'], ['manual', '$ y Bs (manual)']].map(([v, l]) => `<option value="${v}" ${msgMode() === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
INP.msgBsDev = e => { try { localStorage.setItem('gestor_msgbs', e.target.value); } catch { } if (e.target.value !== 'no' && !XT.r.bcv) XT.refresh(); const o = $$('.overlay').pop(); if (o) { closeModal(o); setTimeout(recModal, 220); } };
const _cfgI = INP.cfg; INP.cfg = e => { _cfgI(e); if (e.target.dataset.k === 'msgBs' && e.target.value !== 'no' && !XT.r.bcv) XT.refresh(); };
const _rm = recModal; recModal = function () { _rm(); const d = [...$$('.dialog')].pop(); if (d) d.querySelector('.dh').insertAdjacentHTML('afterend', msgSel()); }; ACT.recOpen = recModal;
msgBloque = function (c, d) {
  if (d && d.tipo === 'antes') return d.cuotas.map(x => { const dd = diasHasta(x.fecha); return `🗓️ Tu cuota *${x.n} de ${x.de}* en *${S.config.nombre}* ${dd <= 0 ? 'vence *hoy*' : dd === 1 ? 'vence *mañana*' : 'vence el *' + fdate(x.fecha + 'T12:00:00') + '*'}.\n💰 Monto a cancelar: *${mB(x.pend)}*`; }).join('\n\n');
  const pend = activas().filter(f => f.clienteId === c.id && saldo(f) > 0);
  return `Tienes un saldo pendiente en *${S.config.nombre}* de *${mB(deudaCliente(c.id))}*:\n` + pend.map(f => `• ${f.num} (${fdate(f.fecha)}): ${mB(saldo(f))}`).join('\n');
};
facText = function (f) {
  const c = S.config, p = plan(f), L2 = [`🏪 *${c.nombre}*`, c.slogan ? `_${c.slogan}_` : '', c.idFiscal ? `ID fiscal: ${c.idFiscal}` : '', '━━━━━━━━━━━━━━━', `🧾 *FACTURA ${f.num}*`, `📅 ${fdt(f.fecha)}`, `👤 Cliente: ${f.clienteNombre}`, '━━━━━━━━━━━━━━━', '🛍️ *Detalle*'].filter(x => x !== '');
  f.items.forEach(i => L2.push(`${i.qty} × ${i.nombre}${i.variante ? ' (' + i.variante + ')' : ''}${i.sku ? ' [Cód. ' + i.sku + ']' : ''} — ${money(i.precio * i.qty)}`));
  L2.push('━━━━━━━━━━━━━━━');
  if (f.descPct) L2.push(`🏷️ Descuento ${f.descPct}%: −${money(f.desc)}`);
  L2.push(`💰 *TOTAL: ${mB(f.total)}*`);
  if (f.tipo === 'CREDITO') {
    L2.push(`✅ Abonado: ${mB(pagado(f))}`, `⏳ *Saldo pendiente: ${mB(saldo(f))}*`);
    const pe = p.filter(x => x.pend > 0);
    if (pe.length) L2.push('', `📆 *Cuotas pendientes${p.length > 1 ? ' (' + pe.length + ' de ' + p.length + ')' : ''}*`, ...pe.map(x => `• Cuota ${x.n}/${x.de} — ${fdate(x.fecha + 'T12:00:00')}: ${mB(x.pend)}`));
    else if (saldo(f) <= 0) L2.push('', '🎉 *¡Crédito cancelado por completo!*');
    else if (f.vence) L2.push(`📆 Fecha de pago: ${fdate(f.vence + 'T12:00:00')}`);
  } else L2.push(`✅ Pagado (${f.metodo})`);
  if (c.pie) L2.push('', c.pie);
  return L2.join('\n');
};
facHTML = function (f) {
  const [, est] = facEstado(f), cli = cliente(f.clienteId), acc = accent(), c = S.config, p = plan(f), r = msgRate(), cred = f.tipo === 'CREDITO', sal = saldo(f);
  const ink = inkFor(acc), bs = n => r ? `<div class="bs">${esc(XT.sym())} ${NF.format(n * r)}</div>` : '';
  const stamp = f.estado === 'ANULADA' ? ['#6b7280', 'ANULADA'] : sal > 0 ? ['#b45309', 'PENDIENTE'] : ['#15803d', 'PAGADA'];
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Factura ${f.num}</title><style>
  *{box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;color:#1f2430;margin:0;font-size:12.5px;background:#fff}.pg{max-width:820px;margin:0 auto}
  .band{background:${acc};color:${ink};padding:26px 34px;display:flex;justify-content:space-between;align-items:center;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .band img{height:62px;border-radius:10px;background:#fff;padding:4px;margin-right:14px}.band .nm{font-size:23px;font-weight:800;letter-spacing:.3px}.band .sl{opacity:.85;font-size:12px;margin-top:2px}
  .band .fx{text-align:right}.band .fx small{letter-spacing:3px;font-size:11px;opacity:.85}.band .fx b{display:block;font-size:26px;margin-top:2px}
  .in{padding:22px 34px}.grid{display:flex;gap:16px;margin-bottom:18px}.box{flex:1;border:1px solid #e5e7eb;border-radius:12px;padding:13px 15px}.box h4{margin:0 0 6px;font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;color:${acc}}.box div{line-height:1.55}.mut{color:#6b7280}
  .stamp{display:inline-block;border:2.5px solid ${stamp[0]};color:${stamp[0]};font-weight:800;letter-spacing:2px;padding:3px 14px;border-radius:8px;transform:rotate(-4deg);font-size:15px;margin-top:6px}
  table{width:100%;border-collapse:collapse}th{background:${acc};color:${ink};text-align:left;padding:10px 12px;font-size:10.5px;letter-spacing:1px;text-transform:uppercase;-webkit-print-color-adjust:exact;print-color-adjust:exact}th{box-shadow:1px 0 0 ${acc}}th:first-child{border-radius:8px 0 0 8px}th:last-child{border-radius:0 8px 8px 0}
  td{padding:10px 12px;border-bottom:1px solid #eef0f3}tbody tr:nth-child(even) td{background:#f8f9fb;-webkit-print-color-adjust:exact;print-color-adjust:exact}.r{text-align:right}.bs{font-size:10.5px;color:#6b7280}
  .tw{display:flex;gap:18px;margin-top:16px;align-items:flex-start}.tw .l{flex:1}.tot{width:300px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}.tot div{display:flex;justify-content:space-between;padding:8px 14px}
  .tot .big{background:${acc};color:${ink};font-size:17px;font-weight:800;-webkit-print-color-adjust:exact;print-color-adjust:exact}.tot .sd{background:#fff7ed;color:#9a3412;font-weight:700}
  h5{margin:18px 0 6px;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${acc}}
  .ft{margin-top:26px;border-top:3px solid ${acc};padding:12px 34px;text-align:center;color:#4b5563}.ft b{color:#1f2430}.dev{font-size:9.5px;color:#9ca3af;margin-top:6px}.nf{font-size:9.5px;color:#9ca3af}
  @page{margin:10mm}</style></head><body><div class="pg">
  <div class="band"><div style="display:flex;align-items:center">${logoPrint() ? `<img src="${logoPrint()}">` : ''}<div>${!c.logo && themeOf().wide ? '' : `<div class="nm">${esc(c.nombre)}</div>`}<div class="sl">${esc(c.slogan || '')}</div></div></div>
    <div class="fx"><small>FACTURA</small><b>${f.num}</b><div style="font-size:11.5px;opacity:.9">${fdt(f.fecha)}</div></div></div>
  <div class="in"><div class="grid"><div class="box"><h4>Emisor</h4><div><b>${esc(c.nombre)}</b>${c.idFiscal ? `<br>ID fiscal: ${esc(c.idFiscal)}` : ''}${c.direccion ? `<br><span class="mut">${esc(c.direccion)}</span>` : ''}${c.whatsapp ? `<br><span class="mut">Tel. ${esc(c.whatsapp)}</span>` : ''}</div></div>
    <div class="box"><h4>Facturado a</h4><div><b>${esc(f.clienteNombre)}</b>${cli && cli.doc ? `<br>${esc(cli.doc)}` : ''}${cli && cli.tel ? `<br><span class="mut">${esc(cli.tel)}</span>` : ''}${cli && cli.dir ? `<br><span class="mut">${esc(cli.dir)}</span>` : ''}</div></div>
    <div class="box" style="max-width:170px;text-align:center"><h4>Estado</h4><div class="stamp">${stamp[1]}</div><div class="mut" style="margin-top:8px">${cred ? 'Venta a crédito' : 'Contado · ' + esc(f.metodo || '')}</div></div></div>
  <table><thead><tr><th>Descripción</th><th class="r">Cant.</th><th class="r">Precio</th><th class="r">Importe</th></tr></thead><tbody>
  ${f.items.map(i => `<tr><td><b>${esc(i.nombre)}</b>${i.variante || i.sku ? `<br><span class="mut">${i.sku ? 'Cód. ' + esc(i.sku) : ''}${i.sku && i.variante ? ' · ' : ''}${esc(i.variante || '')}</span>` : ''}</td><td class="r">${i.qty}</td><td class="r">${money(i.precio)}</td><td class="r"><b>${money(i.precio * i.qty)}</b>${bs(i.precio * i.qty)}</td></tr>`).join('')}</tbody></table>
  <div class="tw"><div class="l">${cred && p.length ? `<h5>Plan de cuotas</h5><table><thead><tr><th>Cuota</th><th>Fecha</th><th class="r">Monto</th><th class="r">Estado</th></tr></thead><tbody>${p.map(x => `<tr><td>${x.n} de ${x.de}</td><td>${fdate(x.fecha + 'T12:00:00')}</td><td class="r">${money(x.monto)}</td><td class="r">${x.estado === 'Pagada' ? '✔ Pagada' : 'Pendiente'}</td></tr>`).join('')}</tbody></table>` : ''}
    ${f.abonos.length && cred ? `<h5>Pagos registrados</h5><table><tbody>${f.abonos.map(a => `<tr><td>${fdt(a.fecha)}</td><td>${esc(a.metodo)}</td><td class="r">${money(a.monto)}</td></tr>`).join('')}</tbody></table>` : ''}</div>
    <div class="tot"><div><span>Subtotal</span><span>${money(f.subtotal)}</span></div>${f.descPct ? `<div><span>Descuento ${f.descPct}%</span><span>−${money(f.desc)}</span></div>` : ''}<div class="big"><span>TOTAL</span><span>${money(f.total)}</span></div>${r ? `<div class="bs"><span>Referencia en ${esc(XT.sym())}</span><span>${NF.format(f.total * r)}</span></div>` : ''}
      ${cred ? `<div><span>Abonado</span><span>${money(pagado(f))}</span></div><div class="sd"><span>Saldo pendiente</span><span>${money(sal)}</span></div>${r && sal > 0 ? `<div class="bs"><span>Saldo en ${esc(XT.sym())}</span><span>${NF.format(sal * r)}</span></div>` : ''}` : ''}</div></div></div>
  <div class="ft"><b>${esc(c.pie || '¡Gracias por su compra!')}</b><div class="nf">Comprobante de venta interno · no es un documento fiscal</div><div class="dev">Gestor de Tienda · Desarrollado por Analista de sistemas Eber Romero</div></div></div></body></html>`;
};

/* ---------- 12) Factura como imagen (PNG) para compartir por WhatsApp ---------- */
let h2cP = null;
const loadH2C = () => window.html2canvas ? Promise.resolve() : (h2cP = h2cP || new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'html2canvas.min.js'; s.onload = ok; s.onerror = () => { h2cP = null; no(new Error('No se pudo cargar el generador de imágenes')); }; document.head.appendChild(s); }));
async function htmlToPng(html, ancho = 820) {
  await loadH2C();
  const fr = document.createElement('iframe'); fr.style.cssText = `position:fixed;left:-99999px;top:0;width:${ancho}px;height:1200px;border:0;visibility:hidden`; document.body.appendChild(fr);
  try {
    await new Promise(res => { fr.onload = res; fr.srcdoc = html; });
    const d = fr.contentDocument; await (d.fonts && d.fonts.ready || Promise.resolve()); await Promise.all([...d.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
    const el = d.querySelector('.pg') || d.body, h = Math.ceil(el.scrollHeight); fr.style.height = h + 'px';
    const cv = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, width: ancho, windowWidth: ancho, height: h, windowHeight: h });
    return await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('No se pudo crear la imagen')), 'image/png'));
  } finally { fr.remove(); }
}
async function compartirImagen(blob, nombre, texto) {
  try { const file = new File([blob], nombre, { type: 'image/png' }); if (!isNative() && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: nombre, text: texto || '' }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  await saveFile(nombre, blob, 'image/png');
}
Object.assign(ACT, {
  facImg: async d => { const f = factura(d.id); if (!f) return; toast('Generando imagen…'); try { await compartirImagen(await htmlToPng(facHTML(f)), 'Factura-' + f.num + '.png', ''); } catch (e) { toast(e.message || 'No se pudo generar la imagen', 'err'); } },
  facImgWA: async d => { const f = factura(d.id), c = cliente(f.clienteId); toast('Generando imagen…'); try { const b = await htmlToPng(facHTML(f)); await compartirImagen(b, 'Factura-' + f.num + '.png', ''); if (!isNative()) openWA(c ? c.tel : '', ''); } catch (e) { toast(e.message || 'No se pudo generar la imagen', 'err'); } }
});
const _fm3 = facModal; facModal = function (id, nueva) {
  _fm3(id, nueva); const f = factura(id); if (!f) return; const dlg = [...$$('.dialog')].pop(), w = dlg && $('[data-act=facWA]', dlg);
  if (w) w.insertAdjacentHTML('beforebegin', `<button class="btn soft" data-act="facImg" data-id="${f.id}">${ic('image')} Imagen (PNG)</button>`);
  const pr = dlg && $('[data-act=facPrint]', dlg); if (pr && isNative()) pr.remove();
  if (!isNative() && window.ClipboardItem && navigator.clipboard && w) w.insertAdjacentHTML('beforebegin', `<button class="btn soft" data-act="facCopy" data-id="${f.id}">${ic('copy')} Copiar imagen</button>`);
};

ACT.facCopy = async d => { const f = factura(d.id); if (!f) return; toast('Generando imagen…'); try { const b = await htmlToPng(facHTML(f)); await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); toast('Imagen copiada: pégala (Ctrl+V) en WhatsApp Web o donde quieras', 'ok'); } catch (e) { toast('No se pudo copiar; usa «Imagen (PNG)» para guardarla', 'err'); } };

/* =====================================================================
   PROVEEDORES: a quién le compras cada artículo y qué toca reponer
   ===================================================================== */
const pvById = id => (S.proveedores || []).find(v => v.id === id);
const pvLow = p => (+p.stock || 0) <= (+p.minimo || 0);
const pvQty = p => Math.max(1, Math.ceil((+p.minimo || 0) * 2 - (+p.stock || 0)));
function pvGroups() { // productos por reponer, agrupados por proveedor
  const g = {};
  S.productos.filter(pvLow).forEach(p => { const k = pvById(p.provId) ? p.provId : ''; (g[k] = g[k] || []).push(p); });
  return Object.keys(g).sort((a, b) => (a === '') - (b === '') || (pvById(a)?.nombre || '').localeCompare(pvById(b)?.nombre || '')).map(k => ({ v: pvById(k) || null, list: g[k].sort((a, b) => a.stock - b.stock) }));
}
function pvMsg(v, list) {
  const L = [`Hola${v ? ' ' + v.nombre : ''}, soy de ${S.config.nombre}. Necesito reponer estos productos:`, ''];
  list.forEach(p => L.push(`• ${pvQty(p)} x ${p.nombre}${p.variante ? ' (' + p.variante + ')' : ''}${p.sku ? ' — Cód: ' + p.sku : ''}`));
  L.push('', '¿Me confirmas disponibilidad y precio? Gracias.');
  return L.join('\n');
}
function vProv() {
  const gs = pvGroups(), low = gs.reduce((n, g) => n + g.list.length, 0), ago = S.productos.filter(p => (+p.stock || 0) <= 0).length;
  const reponer = gs.map(g => `<div class="card" style="margin-bottom:12px"><div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">${ic('store')} ${g.v ? esc(g.v.nombre) : 'Sin proveedor asignado'}</h3><span class="badge warn">${g.list.length} por reponer</span></div>
    ${g.list.map(p => `<div class="row small" style="justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line,#eee);gap:10px"><span><b>${esc(p.nombre)}</b>${p.variante ? ' · ' + esc(p.variante) : ''}<br><span class="muted">Cód: ${esc(p.sku || '—')} · quedan ${p.stock} (mín. ${p.minimo || 0})</span></span><span class="badge ${p.stock <= 0 ? 'bad' : 'warn'}">pedir ${pvQty(p)}</span></div>`).join('')}
    ${g.v ? `<div class="row wrap" style="margin-top:10px"><button class="btn" style="flex:1" data-act="pvWA" data-id="${g.v.id}" ${digits(g.v.tel) ? '' : 'disabled'}>Pedir por WhatsApp</button><button class="btn soft" style="flex:1" data-act="pvCopy" data-id="${g.v.id}">${ic('copy')} Copiar pedido</button></div>${digits(g.v.tel) ? '' : '<div class="hint small" style="margin-top:6px">Agrega su teléfono para enviarle el pedido por WhatsApp.</div>'}`
      : `<div class="hint small" style="margin-top:8px">Asigna un proveedor a estos productos desde Inventario > editar producto.</div>`}</div>`).join('') || `<div class="card"><div class="empty">${ic('box')}<b>Todo en orden</b>Ningún producto está por debajo de su existencia mínima.</div></div>`;
  const lista = (S.proveedores || []).slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(v => {
    const ps = S.productos.filter(p => p.provId === v.id), lw = ps.filter(pvLow).length;
    return `<div class="card" style="margin-bottom:10px;cursor:pointer" data-act="pvEdit" data-id="${v.id}"><div class="row" style="justify-content:space-between;align-items:center"><div><b>${esc(v.nombre)}</b><div class="small muted">${v.contacto ? esc(v.contacto) + ' · ' : ''}${esc(v.tel || 'Sin teléfono')}</div></div><div style="text-align:right"><div class="small">${ps.length} producto${ps.length === 1 ? '' : 's'}</div>${lw ? `<span class="badge warn">${lw} por reponer</span>` : '<span class="badge ok">al día</span>'}</div></div>${v.notas ? `<div class="small muted" style="margin-top:6px">${esc(v.notas)}</div>` : ''}</div>`;
  }).join('') || `<div class="card"><div class="empty">${ic('store')}<b>Aún no tienes proveedores</b>Registra de dónde compras tu mercancía.</div></div>`;
  return `<div class="kpis" style="grid-template-columns:repeat(3,1fr)"><div class="kpi"><div class="kl">Proveedores</div><div class="kv">${(S.proveedores || []).length}</div></div><div class="kpi"><div class="kl">Por reponer</div><div class="kv">${low}</div></div><div class="kpi"><div class="kl">Agotados</div><div class="kv">${ago}</div></div></div>
  <div class="row" style="justify-content:space-between;align-items:center;margin:16px 2px 8px"><h3 style="margin:0">Qué pedir y a quién</h3></div>${reponer}
  <div class="row" style="justify-content:space-between;align-items:center;margin:20px 2px 8px"><h3 style="margin:0">Mis proveedores</h3><button class="btn sm" data-act="pvNew">${ic('plus')} Nuevo proveedor</button></div>${lista}`;
}
ROUTES.proveedores = { t: 'Proveedores', i: 'store', v: vProv };
OWNER_ONLY.push('proveedores');
GRUPOS[0][1].splice(GRUPOS[0][1].indexOf('inventario') + 1, 0, 'proveedores');
const _vMas0 = vMas; vMas = function () { return _vMas0().replace(/(<div class="tiles">)(<div class="tile" data-act="go" data-r="historial")/, (m, a, b) => isOwner() ? a + `<div class="tile" data-act="go" data-r="proveedores">${ic('store')}Proveedores</div>` + b : m); };
ROUTES.mas.v = vMas;
try { buildNav(); } catch { }
function pvModal(id) {
  const v = id ? pvById(id) : null, ps = v ? S.productos.filter(p => p.provId === v.id) : [];
  modal(`${dh(v ? 'Editar proveedor' : 'Nuevo proveedor')}
    <div class="f"><label class="l">Nombre del proveedor *</label><input class="in" id="pv-nombre" value="${esc(v?.nombre || '')}" placeholder="Ej. Importadora Rivas"></div>
    <div class="row"><div class="f"><label class="l">WhatsApp / teléfono</label><input class="in" id="pv-tel" inputmode="tel" value="${esc(v?.tel || '')}" placeholder="58414XXXXXXX"></div>
      <div class="f"><label class="l">Persona de contacto</label><input class="in" id="pv-con" value="${esc(v?.contacto || '')}"></div></div>
    <div class="f"><label class="l">Notas (qué vende, condiciones, dirección)</label><textarea class="in" id="pv-notas">${esc(v?.notas || '')}</textarea></div>
    ${v ? `<div class="f"><label class="l">Productos de este proveedor (${ps.length})</label><div class="small muted">${ps.map(p => esc(p.nombre) + (pvLow(p) ? ' ⚠' : '')).join(' · ') || 'Aún no has asignado productos. Hazlo al editar cada producto en Inventario.'}</div></div>` : ''}
    <div class="dfoot">${v ? `<button class="btn danger ghost" data-act="pvDel" data-id="${v.id}">Eliminar</button>` : ''}<button class="btn ghost" data-act="close">Cancelar</button><button class="btn" data-act="pvSave" data-id="${v?.id || ''}">Guardar</button></div>`);
}
Object.assign(ACT, {
  pvNew: () => pvModal(), pvEdit: d => pvModal(d.id),
  pvSave: d => {
    const nombre = $('#pv-nombre').value.trim(); if (!nombre) return toast('Escribe el nombre del proveedor', 'err');
    const o = { nombre, tel: $('#pv-tel').value.trim(), contacto: $('#pv-con').value.trim(), notas: $('#pv-notas').value.trim() };
    if (d.id) Object.assign(pvById(d.id), o); else (S.proveedores = S.proveedores || []).push({ id: uid(), fecha: new Date().toISOString(), ...o });
    save(); $$('.overlay').forEach(x => closeModal(x)); toast('Proveedor guardado', 'ok'); render();
  },
  pvDel: d => confirmDlg('Se eliminará el proveedor. Sus productos quedarán «sin proveedor».', 'Eliminar', () => {
    S.productos.forEach(p => { if (p.provId === d.id) p.provId = ''; }); S.proveedores = S.proveedores.filter(v => v.id !== d.id);
    save(); $$('.overlay').forEach(x => closeModal(x)); toast('Proveedor eliminado', 'ok'); render();
  }),
  pvWA: d => { const g = pvGroups().find(g => g.v && g.v.id === d.id); if (g) openWA(g.v.tel, pvMsg(g.v, g.list)); },
  pvCopy: d => { const g = pvGroups().find(g => g.v && g.v.id === d.id); if (!g) return; const t = pvMsg(g.v, g.list); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('Pedido copiado', 'ok')).catch(() => prompt('Copia el pedido:', t)); }
});

/* =====================================================================
   EXPORTAR CIERRES DE CAJA (30 días) A EXCEL (.xlsx) Y PDF
   Se generan dentro de la app, sin internet y sirven también en el APK
   ===================================================================== */
const dmy = d => String(d || '').split('-').reverse().join('/');
function cierres30() {
  const hasta = todayStr(), desde = addDays(hasta, -29);
  return { desde, hasta, list: (S.cierres || []).filter(c => c.dia >= desde && c.dia <= hasta).sort((a, b) => a.dia.localeCompare(b.dia)) };
}
function cierresResumen(R) {
  const L = R.list, sum = k => r2(L.reduce((n, c) => n + (+c[k] || 0), 0));
  const cerrados = new Set(L.map(c => c.dia)), conVentas = new Set((S.facturas || []).filter(f => f.estado !== 'ANULADA' && ymd(f.fecha) >= R.desde && ymd(f.fecha) <= R.hasta).map(f => ymd(f.fecha)));
  return { n: L.length, ventas: sum('ventas'), cobrado: sum('cobrado'), gastos: sum('gastos'), apertura: sum('apertura'), esperado: sum('esperado'), contado: sum('contado'), dif: sum('diferencia'), sinCierre: [...conVentas].filter(d => !cerrados.has(d) && d !== R.hasta).length };
}
const acentoHex = () => { const v = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '').trim(); return /^#([0-9a-f]{6})$/i.test(v) ? v.slice(1).toUpperCase() : /^#([0-9a-f]{3})$/i.test(v) ? v.slice(1).split('').map(x => x + x).join('').toUpperCase() : 'A8476B'; };

/* ---- escritor mínimo de .xlsx (zip sin compresión) ---- */
const _crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = _crcT[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) {
  const enc = new TextEncoder(), u16 = n => [n & 255, n >> 8 & 255], u32 = n => [n & 255, n >> 8 & 255, n >> 16 & 255, n >>> 24 & 255];
  const parts = [], cen = []; let off = 0;
  files.forEach(f => {
    const nm = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data), sz = data.length;
    const lh = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0), ...nm]);
    parts.push(lh, data);
    cen.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off), ...nm]));
    off += lh.length + sz;
  });
  const cdSize = cen.reduce((n, a) => n + a.length, 0);
  return new Blob([...parts, ...cen, new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(off), 0, 0])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const xe = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colL = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
/* celda: texto | número (dinero) | {v, s, t} ; estilos: 0 normal, 1 encabezado, 2 dinero, 3 dinero total, 4 texto total, 5 título, 6 subtítulo */
function xlsxBlob(nombreHoja, rows, widths, freezeRow) {
  const ac = acentoHex();
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0">${freezeRow ? `<pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/>` : ''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}"${r.h ? ` ht="${r.h}" customHeight="1"` : ''}>${(r.c || r).map((c, ci) => {
    if (c == null || c === '') return ''; const o = typeof c === 'object' ? c : (typeof c === 'number' ? { v: c, s: 2 } : { v: c, s: 0 }), ref = colL(ci) + (ri + 1);
    return typeof o.v === 'number' ? `<c r="${ref}" s="${o.s || 0}"><v>${o.v}</v></c>` : `<c r="${ref}" s="${o.s || 0}" t="inlineStr"><is><t xml:space="preserve">${xe(o.v)}</t></is></c>`;
  }).join('')}</row>`).join('')}</sheetData><pageSetup orientation="landscape" fitToHeight="0"/></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]\\-#,##0.00"/></numFmts><fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="FF${ac}"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF6F6169"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${ac}"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8EEF2"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFE6D9DF"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="164" fontId="2" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;
  return zipStore([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xe(nombreHoja).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: styles }, { name: 'xl/worksheets/sheet1.xml', data: sheet }]);
}
function cierresXlsx() {
  const R = cierres30(); if (!R.list.length) return null;
  const mets = [...new Set(R.list.flatMap(c => Object.keys(c.porMetodo || {})))], T = cierresResumen(R);
  const head = ['Día', 'Ventas', 'Cobrado', 'Gastos', 'Apertura', 'Efectivo esperado', 'Efectivo contado', 'Diferencia', ...mets.map(m => 'Cobrado ' + m), 'Cerrado por', 'Nota'];
  const rows = [{ c: [{ v: S.config.nombre + ' · Cierres de caja', s: 5 }], h: 24 }, [{ v: `Del ${dmy(R.desde)} al ${dmy(R.hasta)} · generado ${new Date().toLocaleString()} · ${T.n} cierre(s)`, s: 6 }], [], { c: head.map(h => ({ v: h, s: 1 })), h: 34 }];
  R.list.forEach(c => rows.push([dmy(c.dia), +c.ventas || 0, +c.cobrado || 0, +c.gastos || 0, +c.apertura || 0, +c.esperado || 0, +c.contado || 0, +c.diferencia || 0, ...mets.map(m => +((c.porMetodo || {})[m]) || 0), c.por || '', c.nota || '']));
  const tm = mets.map(m => r2(R.list.reduce((n, c) => n + (+((c.porMetodo || {})[m]) || 0), 0)));
  rows.push({ c: [{ v: 'TOTAL', s: 4 }, ...[T.ventas, T.cobrado, T.gastos, T.apertura, T.esperado, T.contado, T.dif, ...tm].map(v => ({ v, s: 3 })), { v: '', s: 4 }, { v: '', s: 4 }], h: 22 });
  return xlsxBlob('Cierres de caja', rows, [12, 13, 13, 12, 12, 17, 17, 13, ...mets.map(() => 15), 18, 32], 4);
}

/* ---- escritor mínimo de PDF (tabla A4 horizontal) ---- */
const HW = { ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333, a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500, '{': 334, '|': 260, '}': 334, '~': 584 };
const pw = (t, sz, b) => { let w = 0; for (const ch of String(t)) w += HW[ch] || 556; return w * sz / 1000 * (b ? 1.06 : 1); };
const pfit = (t, sz, maxw, b) => { t = String(t == null ? '' : t); if (pw(t, sz, b) <= maxw) return t; while (t.length > 1 && pw(t + '...', sz, b) > maxw) t = t.slice(0, -1); return t + '...'; };
const plat = s => String(s).replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/[^\x20-\xff]/g, '?').replace(/[\\()]/g, m => '\\' + m);
function cierresPdf() {
  const R = cierres30(); if (!R.list.length) return null; const T = cierresResumen(R), ac = acentoHex(), rgb = h => [0, 2, 4].map(i => (parseInt(h.substr(i, 2), 16) / 255).toFixed(3)).join(' ');
  const W = 842, H = 595, M = 34, pages = []; let cur = null, y = 0;
  const cols = [['Día', 62, 'l'], ['Ventas', 70, 'r'], ['Cobrado', 70, 'r'], ['Gastos', 62, 'r'], ['Apertura', 64, 'r'], ['Esperado', 70, 'r'], ['Contado', 70, 'r'], ['Diferencia', 66, 'r'], ['Cerrado por', 92, 'l'], ['Nota', 108, 'l']];
  const tw = cols.reduce((n, c) => n + c[1], 0), sx = (W - 2 * M) / tw; cols.forEach(c => c[1] = c[1] * sx);
  const txt = (x, yy, s, sz, bold, color) => `BT /F${bold ? 2 : 1} ${sz} Tf ${color || '0.16 0.12 0.15'} rg ${x.toFixed(1)} ${yy.toFixed(1)} Td (${plat(s)}) Tj ET\n`;
  const rect = (x, yy, w, h, col) => `${col} rg ${x.toFixed(1)} ${yy.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f\n`;
  const headerBand = () => rect(0, H - 58, W, 58, rgb(ac)) + txt(M, H - 28, S.config.nombre, 16, true, '1 1 1') + txt(M, H - 46, 'Cierres de caja - ultimos 30 dias (' + dmy(R.desde) + ' al ' + dmy(R.hasta) + ')', 10, false, '1 1 1');
  const tableHead = () => { let s = rect(M, y - 20, W - 2 * M, 22, rgb(ac)), x = M; cols.forEach(c => { s += txt(c[2] === 'r' ? x + c[1] - 5 - pw(c[0], 8.5, true) : x + 5, y - 13, c[0], 8.5, true, '1 1 1'); x += c[1]; }); y -= 22; return s; };
  const newPage = first => { cur = headerBand(); y = H - 76; if (first) { /* tarjetas de resumen */
      const box = [['Ventas', money(T.ventas)], ['Cobrado', money(T.cobrado)], ['Gastos', money(T.gastos)], ['Diferencia acumulada', (T.dif > 0 ? '+' : '') + money(T.dif)], ['Cierres / sin cierre', T.n + ' / ' + T.sinCierre]], bw = (W - 2 * M - 4 * 10) / 5;
      box.forEach((b, i) => { const x = M + i * (bw + 10); cur += rect(x, y - 44, bw, 44, '0.973 0.933 0.949') + txt(x + 10, y - 16, b[0], 8, false, '0.435 0.380 0.412') + txt(x + 10, y - 35, b[1], 13, true, rgb(ac)); }); y -= 62; }
    cur += tableHead(); pages.push(cur); };
  newPage(true); const flush = () => { pages[pages.length - 1] = cur; };
  const rowH = 17;
  R.list.forEach((c, i) => {
    if (y - rowH < 46) { flush(); newPage(false); }
    const vals = [dmy(c.dia), money(c.ventas), money(c.cobrado), money(c.gastos), money(c.apertura), money(c.esperado), money(c.contado), (c.diferencia > 0 ? '+' : '') + money(c.diferencia), c.por || '', c.nota || ''];
    if (i % 2) cur += rect(M, y - rowH + 3, W - 2 * M, rowH, '0.988 0.969 0.976'); let x = M;
    cols.forEach((cl, j) => { const t = pfit(vals[j], 8.5, cl[1] - 10, false), col = j === 7 ? (Math.abs(c.diferencia) < .005 ? '0.10 0.55 0.30' : '0.78 0.18 0.18') : '0.16 0.12 0.15'; cur += txt(cl[2] === 'r' ? x + cl[1] - 5 - pw(t, 8.5) : x + 5, y - rowH + 8, t, 8.5, j === 7, col); x += cl[1]; });
    y -= rowH;
  });
  if (y - 24 < 46) { flush(); newPage(false); }
  const tot = ['TOTAL', money(T.ventas), money(T.cobrado), money(T.gastos), money(T.apertura), money(T.esperado), money(T.contado), (T.dif > 0 ? '+' : '') + money(T.dif), '', ''];
  cur += rect(M, y - 20, W - 2 * M, 22, '0.973 0.933 0.949'); let x = M; cols.forEach((cl, j) => { cur += txt(cl[2] === 'r' ? x + cl[1] - 5 - pw(tot[j], 8.5, true) : x + 5, y - 13, tot[j], 8.5, true, rgb(ac)); x += cl[1]; }); flush();
  /* pie de página con numeración */
  const n = pages.length; pages.forEach((p, i) => { pages[i] = p + txt(M, 24, 'Generado ' + new Date().toLocaleString() + '  -  Desarrollado por Analista de sistemas Eber Romero', 7.5, false, '0.43 0.38 0.41') + txt(W - M - 60, 24, 'Pagina ' + (i + 1) + ' de ' + n, 7.5, false, '0.43 0.38 0.41'); });
  /* ensamblado */
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => (5 + i * 2) + ' 0 R').join(' ')}] /Count ${n} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  pages.forEach((p, i) => { objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`); objs.push({ stream: p }); });
  let out = '%PDF-1.4\n', offs = []; objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n` + (typeof o === 'string' ? o : `<< /Length ${o.stream.length} >>\nstream\n${plat0(o.stream)}endstream`) + '\nendobj\n'; });
  const xr = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`;
  const u = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) u[i] = out.charCodeAt(i) & 255; return new Blob([u], { type: 'application/pdf' });
}
const plat0 = s => s; // el contenido ya viene en Latin-1 (ver plat)
Object.assign(ACT, {
  cajaXlsx: async () => { const b = cierresXlsx(); if (!b) return toast('No hay cierres de caja en los últimos 30 días', 'err'); await saveFile(`cierres-de-caja-${todayStr()}.xlsx`, b, b.type); },
  cajaPdf: async () => { const b = cierresPdf(); if (!b) return toast('No hay cierres de caja en los últimos 30 días', 'err'); await saveFile(`cierres-de-caja-${todayStr()}.pdf`, b, 'application/pdf'); }
});

/* =====================================================================
   ALARMAS Y NOTIFICACIONES (cierre de caja y créditos por vencerse)
   Configuración por equipo (localStorage). APK: notificaciones locales
   programadas del sistema (suenan aunque la app esté cerrada).
   Escritorio/web: aviso mientras la app está abierta.
   ===================================================================== */
const ALM = {
  K: 'gestor_alarma', def: { cajaOn: false, cajaHora: '20:00', credOn: false, credHora: '09:00', credDias: 2 },
  get() { try { return { ...ALM.def, ...JSON.parse(localStorage.getItem(ALM.K) || '{}') }; } catch { return { ...ALM.def }; } },
  set(o) { try { localStorage.setItem(ALM.K, JSON.stringify({ ...ALM.get(), ...o })); } catch { } },
  native() { const c = window.Capacitor; return !!(c && c.isNativePlatform && c.isNativePlatform()); },
  msg() { return ALM.native() ? (ALM.LN() ? 'Android bloqueó las notificaciones de esta app. Ve a Ajustes del teléfono > Aplicaciones > Gestor de Tienda > Notificaciones y actívalas.' : 'Esta versión instalada del APK todavía no incluye las notificaciones. Descarga e instala el APK nuevo (build más reciente) y vuelve a intentarlo.') : 'Las notificaciones están bloqueadas en este navegador. Permítelas en la configuración del sitio.'; },
  LN() { const c = window.Capacitor; return (c && c.isNativePlatform && c.isNativePlatform() && c.Plugins && c.Plugins.LocalNotifications) || null; },
  last: 0, t: null
};
function almCuotas() { return activas().flatMap(plan).filter(x => x.pend > 0); }
function almCredMsg(dia, dias) {
  const cu = almCuotas(), lim = addDays(dia, dias), prox = cu.filter(x => x.fecha >= dia && x.fecha <= lim), venc = cu.filter(x => x.fecha < dia);
  if (!prox.length && !venc.length) return null;
  const por = {}; [...prox].sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach(x => { por[x.f.clienteId] = r2((por[x.f.clienteId] || 0) + x.pend); }); const quien = Object.entries(por), top = quien.slice(0, 3).map(([id, m]) => ((cliente(id) || {}).nombre || 'Cliente').split(' ')[0] + ' ' + money(m)).join(', ');
  const p = [];
  if (prox.length) p.push(`${prox.length} cuota${prox.length === 1 ? '' : 's'} por vencer ${dias > 0 ? 'en ' + dias + ' día' + (dias === 1 ? '' : 's') + ' o menos' : 'hoy'}: ${top}${quien.length > 3 ? ' y ' + (quien.length - 3) + ' más' : ''}`);
  if (venc.length) p.push(`${venc.length} vencida${venc.length === 1 ? '' : 's'}`);
  return p.join(' · ');
}
function almCajaMsg(dia) {
  if (dia === todayStr()) { const k = cajaDia(dia); return `Aún no has cerrado la caja de hoy. Ventas ${money(k.ventas)} · cobrado ${money(k.cobrado)}.`; }
  return 'Es hora de cerrar la caja del día: cuenta el efectivo y registra el cierre.';
}
async function almPerm(pedir) {
  const ln = ALM.LN();
  if (ALM.native() && !ln) return false;
  try {
    if (ln) { let p = await ln.checkPermissions(); if (p.display !== 'granted' && pedir) p = await ln.requestPermissions(); return p.display === 'granted'; }
    if ('Notification' in window) { if (Notification.permission !== 'granted' && pedir) await Notification.requestPermission(); return Notification.permission === 'granted'; }
  } catch { }
  return false;
}
async function almSchedule() {
  const ln = ALM.LN(); if (!ln || !L.token) return; const a = ALM.get(); ALM.last = Date.now();
  try {
    try { await ln.createChannel({ id: 'gestor', name: 'Recordatorios', description: 'Cierre de caja y créditos por vencer', importance: 4, visibility: 1, vibration: true }); } catch { }
    const pend = await ln.getPending(), ids = (pend.notifications || []).filter(n => n.id >= 1000 && n.id < 3000).map(n => ({ id: n.id }));
    if (ids.length) await ln.cancel({ notifications: ids });
    if (!a.cajaOn && !a.credOn) return;
    if (!(await almPerm(false))) return;
    const list = [], now = Date.now(), dias = Math.max(0, Math.floor(num(a.credDias)));
    for (let d = 0; d < 14; d++) {
      const dia = addDays(todayStr(), d);
      if (a.cajaOn) { const at = new Date(dia + 'T' + a.cajaHora + ':00'); if (at.getTime() > now && !(d === 0 && cierreDe(dia))) list.push({ id: 1000 + d, title: '🧾 Cierre de caja', body: almCajaMsg(dia), schedule: { at, allowWhileIdle: true }, channelId: 'gestor', extra: { r: 'caja' } }); }
      if (a.credOn) { const at = new Date(dia + 'T' + a.credHora + ':00'), body = almCredMsg(dia, dias); if (at.getTime() > now && body) list.push({ id: 2000 + d, title: '⏰ Créditos por vencerse', body, schedule: { at, allowWhileIdle: true }, channelId: 'gestor', extra: { r: 'creditos' } }); }
    }
    if (list.length) await ln.schedule({ notifications: list });
    ALM.n = list.length;
  } catch (e) { ALM.err = String(e && e.message || e); }
}
const almSoon = () => { clearTimeout(ALM.t); ALM.t = setTimeout(almSchedule, 4000); };
function almShow(title, body, r) {
  try { if ('Notification' in window && Notification.permission === 'granted') { const n = new Notification(title, { body, tag: 'gestor-' + r }); n.onclick = () => { window.focus(); ACT.almGo({ r }); }; } } catch { }
  modal(`${dh(title)}<p style="margin:6px 0 14px">${esc(body)}</p><div class="dfoot"><button class="btn ghost" data-act="close">Más tarde</button><button class="btn" data-act="almGo" data-r="${r}">${r === 'caja' ? 'Ir a Caja' : 'Ver créditos'}</button></div>`);
}
function almTick() {
  if (!L.token || ALM.LN()) { if (ALM.LN() && Date.now() - ALM.last > 6 * 3600e3) almSchedule(); return; }
  if (document.querySelector('.overlay')) return;
  const a = ALM.get(), hm = new Date().toTimeString().slice(0, 5), hoy = todayStr(), mark = k => { try { if (localStorage.getItem(k)) return false; localStorage.setItem(k, 1); return true; } catch { return true; } };
  if (a.cajaOn && hm >= a.cajaHora && !cierreDe(hoy) && mark('gestor_alm_caja_' + hoy)) return almShow('🧾 Cierre de caja', almCajaMsg(hoy), 'caja');
  if (a.credOn && hm >= a.credHora) { const k = 'gestor_alm_cred_' + hoy; if (!localStorage.getItem(k)) { const m = almCredMsg(hoy, Math.max(0, Math.floor(num(a.credDias)))); try { localStorage.setItem(k, 1); } catch { } if (m) almShow('⏰ Créditos por vencerse', m, 'creditos'); } }
}
setInterval(almTick, 30000); setTimeout(almTick, 6000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { almTick(); almSoon(); } });
{ const _sv = save; save = function () { _sv.apply(this, arguments); almSoon(); }; }
try { const ln = ALM.LN(); if (ln && ln.addListener) ln.addListener('localNotificationActionPerformed', ev => { const r = ev && ev.notification && ev.notification.extra && ev.notification.extra.r; if (r && L.token) go(r); }); } catch { }
function almCard() {
  const a = ALM.get(), chk = (k, t) => `<label class="row" style="gap:10px;margin:8px 0 6px;cursor:pointer"><input type="checkbox" data-alm="${k}" ${a[k] ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)"> <span>${t}</span></label>`;
  return `<div class="card"><h3>${ic('alert')} Alarmas y notificaciones</h3>
    <div class="hint small" style="margin-bottom:6px">Solo para este equipo. En el celular llegan como notificación aunque la app esté cerrada; en la computadora aparecen mientras la app esté abierta.</div>
    ${chk('cajaOn', 'Recordarme cerrar la caja todos los días')}
    <div class="f"><label class="l">Hora del recordatorio de caja</label><input class="in" type="time" data-alm="cajaHora" value="${esc(a.cajaHora)}"></div>
    ${chk('credOn', 'Avisarme de los créditos a punto de vencerse')}
    <div class="row"><div class="f"><label class="l">Hora del aviso</label><input class="in" type="time" data-alm="credHora" value="${esc(a.credHora)}"></div>
    <div class="f"><label class="l">Avisar cuando falten (días)</label><input class="in" type="number" min="0" max="15" inputmode="numeric" data-alm="credDias" value="${a.credDias}"></div></div>
    <button class="btn block soft" data-act="almTest">${ic('alert')} Enviar notificación de prueba</button></div>`;
}
document.addEventListener('change', async e => {
  const k = e.target.dataset && e.target.dataset.alm; if (!k) return; const el = e.target;
  if (el.type === 'checkbox') {
    if (el.checked && !(await almPerm(true))) { el.checked = false; return toast(ALM.msg(), 'err'); }
    ALM.set({ [k]: el.checked });
  } else if (k === 'credDias') ALM.set({ credDias: Math.max(0, Math.min(15, Math.floor(num(el.value)))) });
  else ALM.set({ [k]: el.value || ALM.def[k] });
  almSchedule(); toast('Alarma guardada', 'ok');
});
Object.assign(ACT, {
  almGo: d => { $$('.overlay').forEach(o => closeModal(o)); go(d.r); },
  almTest: async () => {
    if (!(await almPerm(true))) return toast(ALM.msg(), 'err');
    const ln = ALM.LN(), a = ALM.get();
    if (ln) { try { await ln.createChannel({ id: 'gestor', name: 'Recordatorios', importance: 4, vibration: true }); } catch { } await ln.schedule({ notifications: [{ id: 9000, title: '🧾 Prueba de notificación', body: 'Así te avisaremos del cierre de caja y de los créditos por vencer.', schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true }, channelId: 'gestor' }] }); toast('Te llegará en 3 segundos. Si no llega, revisa los permisos de notificaciones del teléfono.', 'ok'); }
    else { try { new Notification('🧾 Prueba de notificación', { body: 'Así te avisaremos del cierre de caja y de los créditos por vencer.' }); } catch { } toast('Notificación enviada', 'ok'); }
    almSchedule();
  }
});
PAGES.ajustes = c => cols([c.datos, c.cuenta, c.pin, almCard()], [c.equipo, c.perm, c.demo]);
