/* ===== Deudas anteriores (cuaderno): cargar deudas viejas con fecha, monto y abonos con su fecha ===== */
(function () {
  const dIso = d => new Date(d + 'T12:00:00').toISOString();
  let dAb = [];   // abonos en edición {fecha, monto, metodo}
  const dnum = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };

  function dResumen() {
    const m = r2(dnum(($('#dd-monto') || {}).value)), t = r2(sum(dAb.map(a => dnum(a.monto)))), el = $('#dd-res');
    if (!el) return;
    const s = r2(m - t);
    el.innerHTML = `<div class="tr"><span>Deuda inicial</span><b>${money(m)}</b></div><div class="tr"><span>Abonos (${dAb.length})</span><b style="color:var(--ok)">${money(t)}</b></div><div class="tr big"><span>Saldo pendiente</span><b style="color:${s < 0 ? 'var(--bad)' : 'var(--text)'}">${money(s)}</b></div>`;
  }
  function dRows() {
    const el = $('#dd-abs'); if (!el) return;
    el.innerHTML = dAb.map((a, i) => `<div class="row" style="align-items:flex-end;gap:6px;margin-bottom:6px">
      <div class="f" style="flex:1.7;margin:0;min-width:0"><label class="l">${i ? '' : 'Fecha'}</label><input class="in" type="date" max="${todayStr()}" data-input="ddAb" data-i="${i}" data-k="fecha" value="${a.fecha}"></div>
      <div class="f" style="flex:1;margin:0;min-width:0"><label class="l">${i ? '' : 'Monto'}</label><input class="in" type="number" min="0" step="0.01" inputmode="decimal" data-input="ddAb" data-i="${i}" data-k="monto" value="${a.monto}"></div>
      <div class="f" style="flex:1.2;margin:0;min-width:0"><label class="l">${i ? '' : 'Método'}</label><select class="in" data-input="ddAb" data-i="${i}" data-k="metodo">${METODOS.map(m => `<option ${m === a.metodo ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <button class="iconbtn" data-act="ddDel" data-i="${i}" aria-label="Quitar">${ic('x')}</button></div>`).join('') || '<div class="hint small">Sin abonos todavía. Agrega los que ya hizo en el cuaderno.</div>';
    dResumen();
  }
  function deudaModal(cid) {
    const c = cliente(cid); if (!c) return; dAb = [];
    $$('.overlay').forEach(o => closeModal(o));
    setTimeout(() => {
      modal(`${dh('Deuda anterior')}<p class="muted" style="margin-bottom:10px">Pasa al sistema una deuda del cuaderno de <b>${esc(c.nombre)}</b>. No mueve inventario.</p>
      <div class="row"><div class="f"><label class="l">Fecha de la deuda</label><input class="in" type="date" id="dd-fecha" max="${todayStr()}" value="${todayStr()}"></div>
      <div class="f"><label class="l">Monto inicial de la deuda</label><input class="in" type="number" min="0" step="0.01" inputmode="decimal" id="dd-monto" data-input="ddMonto" placeholder="0.00"></div></div>
      <div class="f"><label class="l">Concepto (opcional)</label><input class="in" id="dd-nota" placeholder="Ej. Mercancía del cuaderno, pág. 12"></div>
      <div class="row"><div class="f"><label class="l">Próxima cuota vence el (opcional)</label><input class="in" type="date" id="dd-vence"></div>
      <div class="f"><label class="l">N.º de cuotas</label><input class="in" type="number" min="1" max="24" id="dd-cuotas" value="1"></div></div>
      <div class="f"><label class="l">Una cuota cada</label><select class="in" id="dd-freq"><option value="7">7 días (semanal)</option><option value="15" selected>15 días (quincenal)</option><option value="30">30 días (mensual)</option></select></div>
      <div class="small muted b" style="margin:10px 0 4px">ABONOS YA HECHOS</div><div id="dd-abs"></div>
      <button class="btn soft" style="width:100%;margin:4px 0 10px" data-act="ddAdd">+ Agregar abono con fecha</button>
      <div class="totals" id="dd-res"></div>
      <div class="dfoot"><button class="btn ghost" data-act="close">Cancelar</button><button class="btn ok" data-act="ddSave" data-id="${cid}">${ic('check')} Guardar deuda</button></div>`, 'wide');
      dRows();
    }, 220);
  }
  function deudaSave(cid) {
    const c = cliente(cid); if (!c) return;
    const fecha = $('#dd-fecha').value, monto = r2(dnum($('#dd-monto').value));
    if (!fecha) return toast('Indica la fecha de la deuda', 'err');
    if (fecha > todayStr()) return toast('La fecha no puede ser futura', 'err');
    if (monto <= 0) return toast('Indica el monto de la deuda', 'err');
    const abs = dAb.filter(a => dnum(a.monto) > 0 || a.fecha);
    for (const a of abs) {
      if (!a.fecha) return toast('Cada abono necesita su fecha', 'err');
      if (dnum(a.monto) <= 0) return toast('Cada abono necesita su monto', 'err');
      if (a.fecha < fecha) return toast('Un abono tiene fecha anterior a la deuda', 'err');
      if (a.fecha > todayStr()) return toast('Un abono tiene fecha futura', 'err');
    }
    const tot = r2(sum(abs.map(a => dnum(a.monto))));
    if (tot > monto + 0.004) return toast('Los abonos (' + money(tot) + ') superan la deuda (' + money(monto) + ')', 'err');
    const cuotas = Math.max(1, Math.min(24, Math.floor(dnum($('#dd-cuotas').value)) || 1)), freq = +$('#dd-freq').value || 15, vence = $('#dd-vence').value || '';
    const nota = $('#dd-nota').value.trim() || 'Deuda anterior (cuaderno)';
    const f = {
      id: uid(), num: nextNum(), fecha: dIso(fecha), clienteId: c.id, clienteNombre: c.nombre,
      items: [{ pid: '', nombre: nota, sku: '', variante: '', desc: '', precio: monto, costo: 0, qty: 1 }],
      subtotal: monto, descPct: 0, desc: 0, total: monto, tipo: 'CREDITO', metodo: 'Efectivo', vence, inicial: 0, cuotas, freq,
      abonos: abs.slice().sort((a, b) => a.fecha.localeCompare(b.fecha)).map(a => ({ id: uid(), fecha: dIso(a.fecha), monto: r2(dnum(a.monto)), metodo: a.metodo || 'Efectivo', nota: 'Abono anterior (cuaderno)' })),
      estado: 'PENDIENTE', ganancia: 0, historica: true, nota, tasa: (typeof XT !== 'undefined' && XT.rate && XT.rate()) || 0
    };
    if (c.vendedor && c.userId) f.vendUid = c.userId;
    if (saldo(f) <= 0.004) f.estado = 'PAGADA';
    S.facturas.unshift(f); save(); $$('.overlay').forEach(o => closeModal(o));
    toast('Deuda cargada: ' + f.num, 'ok'); render(); setTimeout(() => cliView(cid), 260);
  }

  ACT.ddNew = d => deudaModal(d.id);
  ACT.ddAdd = () => { const last = dAb[dAb.length - 1]; dAb.push({ fecha: last ? last.fecha : todayStr(), monto: '', metodo: last ? last.metodo : 'Efectivo' }); dRows(); };
  ACT.ddDel = d => { dAb.splice(+d.i, 1); dRows(); };
  ACT.ddSave = d => deudaSave(d.id);
  INP.ddMonto = () => dResumen();
  INP.ddAb = e => { const a = dAb[+e.target.dataset.i]; if (!a) return; a[e.target.dataset.k] = e.target.value; if (e.target.dataset.k !== 'fecha') dResumen(); };
  // los selects solo disparan "change"; las fechas también
  document.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.input === 'ddAb' && e.target.tagName !== 'SELECT') INP.ddAb(e); });

  // botón en la ficha del cliente y del vendedor (solo dueño)
  function addBtn(cid) {
    if (!isOwner()) return;
    const dlg = [...$$('.dialog')].pop(); if (!dlg || dlg.querySelector('[data-act=ddNew]')) return;
    const foot = dlg.querySelector('.dfoot'); if (!foot) return;
    foot.insertAdjacentHTML('beforebegin', `<button class="btn soft" style="width:100%;margin:12px 0 0" data-act="ddNew" data-id="${cid}">📒 Cargar deuda anterior (cuaderno)</button>`);
  }
  const _cv = cliView; cliView = function (id) { _cv(id); const c = cliente(id); if (c && !c.vendedor) addBtn(id); };
  const _vv = vendView; vendView = function (id) { _vv(id); addBtn(id); };

  // abono con fecha propia (para ponerse al día con el cuaderno)
  const _am = abonoModal; abonoModal = function (cid, fid) {
    _am(cid, fid); const m = $('#ab-met'); if (!m || !isOwner()) return;
    m.closest('.f').insertAdjacentHTML('afterend', `<div class="f"><label class="l">Fecha del pago</label><input class="in" type="date" id="ab-fecha" max="${todayStr()}" value="${todayStr()}"></div>`);
  };
  const _as = abonoSave; abonoSave = function (cid, fid) {
    const fe = ($('#ab-fecha') || {}).value, before = new Set(S.facturas.flatMap(f => f.abonos.map(a => a.id)));
    const n0 = S.facturas.reduce((s, f) => s + f.abonos.length, 0);
    _as(cid, fid);
    if (!fe || fe === todayStr() || fe > todayStr()) return;
    let ch = 0; S.facturas.forEach(f => f.abonos.forEach(a => { if (!before.has(a.id)) { a.fecha = dIso(fe); ch++; } }));
    if (ch) { S.facturas.forEach(f => f.abonos.sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')))); save(); render(); }
  };
})();
