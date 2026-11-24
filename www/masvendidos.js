/* ===== Artículos más vendidos: ranking por producto, tipo de prenda o categoría ===== */
(function () {
  const MV = { per: '30', by: 'prod', sort: 'uds', cat: '', q: '', menos: false };
  const PERS = [['7', '7 días'], ['30', '30 días'], ['90', '90 días'], ['mes', 'Este mes'], ['todo', 'Todo']];
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const tipoKey = n => { const w = norm(n).split(/\s+/)[0] || 'otros'; return w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w; };
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  function desde() {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (MV.per === 'todo') return 0;
    if (MV.per === 'mes') { d.setDate(1); return d.getTime(); }
    d.setDate(d.getDate() - (+MV.per - 1)); return d.getTime();
  }
  function calcular() {
    const t0 = desde(), g = new Map(), q = norm(MV.q);
    for (const f of S.facturas) {
      if (f.estado === 'ANULADA' || f.historica || new Date(f.fecha).getTime() < t0) continue;
      for (const it of (f.items || [])) {
        if (!it.pid) continue;
        const p = S.productos.find(x => x.id === it.pid);
        if (MV.cat && (!p || p.categoria !== MV.cat)) continue;
        if (q && !norm(it.nombre + ' ' + (p ? p.categoria : '')).includes(q)) continue;
        const key = MV.by === 'prod' ? it.pid : MV.by === 'cat' ? (p ? p.categoria || 'Sin categoría' : 'Sin categoría') : tipoKey(it.nombre);
        let r = g.get(key);
        if (!r) { r = { key, nombre: MV.by === 'prod' ? it.nombre : MV.by === 'cat' ? key : cap(tipoKey(it.nombre)), p: MV.by === 'prod' ? p : null, uds: 0, ventas: 0, gan: 0, n: new Set(), raw: {} }; g.set(key, r); }
        const q2 = +it.qty || 0; r.uds += q2; r.ventas += (+it.precio || 0) * q2; r.gan += ((+it.precio || 0) - (+it.costo || 0)) * q2; r.n.add(f.id);
        if (MV.by === 'tipo') { const w = it.nombre.trim().split(/\s+/)[0]; r.raw[w] = (r.raw[w] || 0) + q2; }
      }
    }
    let arr = [...g.values()];
    if (MV.by === 'tipo') arr.forEach(r => { const k = Object.entries(r.raw).sort((a, b) => b[1] - a[1])[0]; if (k) r.nombre = cap(k[0]); });
    const own = isOwner(), sk = MV.sort === 'gan' && own ? 'gan' : MV.sort === 'ventas' ? 'ventas' : 'uds';
    arr.sort((a, b) => b[sk] - a[sk] || b.uds - a.uds);
    // menos vendidos: incluye productos con stock que no se vendieron
    if (MV.menos) {
      if (MV.by === 'prod') for (const p of S.productos) { if (g.has(p.id) || p.stock <= 0) continue; if (MV.cat && p.categoria !== MV.cat) continue; if (q && !norm(p.nombre + ' ' + (p.categoria || '')).includes(q)) continue; arr.push({ key: p.id, nombre: p.nombre, p, uds: 0, ventas: 0, gan: 0, n: new Set() }); }
      arr.sort((a, b) => a[sk] - b[sk] || a.nombre.localeCompare(b.nombre));
    }
    return arr;
  }
  const chip = (k, v, l, on) => `<button class="chip ${on ? 'active' : ''}" data-act="mvSet" data-k="${k}" data-v="${esc(v)}">${esc(l)}</button>`;
  function lista() {
    const arr = calcular(), own = isOwner();
    const tot = arr.reduce((s, r) => s + r.uds, 0), vt = arr.reduce((s, r) => s + r.ventas, 0), gt = arr.reduce((s, r) => s + r.gan, 0);
    const sk = MV.sort === 'gan' && own ? 'gan' : MV.sort === 'ventas' ? 'ventas' : 'uds', mx = Math.max(1, ...arr.map(r => r[sk]));
    const kp = `<div class="mvk"><div><small>Unidades vendidas</small><b>${tot}</b></div><div><small>Ventas</small><b>${money(vt)}</b></div>${own ? `<div><small>Ganancia</small><b>${money(gt)}</b></div>` : ''}<div><small>${MV.by === 'prod' ? 'Productos' : MV.by === 'cat' ? 'Categorías' : 'Tipos'}</small><b>${arr.length}</b></div></div>`;
    if (!arr.length) return kp + `<div class="empty">${ic('tag')}<b>Sin ventas en este período</b>Prueba con otro período o quita el filtro.</div>`;
    const top3 = !MV.menos && arr.length >= 3 ? `<div class="mvp">${arr.slice(0, 3).map((r, i) => `<div class="mvpc r${i + 1}"><div class="mvm">${['🥇', '🥈', '🥉'][i]}</div><div class="mvi">${r.p ? thumb(r.p) : `<div class="ph" style="background:${grad(r.nombre)}">${esc(initials(r.nombre))}</div>`}</div><b>${esc(r.nombre)}</b><span>${r.uds} uds · ${money(r.ventas)}</span></div>`).join('')}</div>` : '';
    const rows = arr.slice(0, 60).map((r, i) => {
      const st = r.p ? stockBadge(r.p) : null, rep = r.p && !MV.menos && r.p.stock <= (r.p.minimo || 0) && r.uds > 0;
      return `<div class="mvr" ${r.p ? `data-act="prodEdit" data-id="${r.p.id}"` : ''}><div class="mvn">${i + 1}</div><div class="mvi s">${r.p ? thumb(r.p) : `<div class="ph" style="background:${grad(r.nombre)}">${esc(initials(r.nombre))}</div>`}</div>
        <div class="mvmid"><div class="row" style="justify-content:space-between;gap:8px"><b class="mvt">${esc(r.nombre)}${r.p && r.p.variante ? ` <span class="muted small">· ${esc(r.p.variante)}</span>` : ''}</b><span class="mvu">${r.uds} uds</span></div>
        <div class="prog"><i style="width:${Math.max(r.uds ? 3 : 0, r[sk] / mx * 100)}%"></i></div>
        <div class="muted small">${money(r.ventas)}${own && MV.by !== 'x' ? ' · gan. ' + money(r.gan) : ''}${r.n.size ? ' · ' + r.n.size + ' factura' + (r.n.size > 1 ? 's' : '') : ''}${st ? ` · <span class="badge ${st[0]}" style="font-size:10.5px">${st[1]}</span>` : ''}${rep ? ' · <b style="color:var(--warn,#d97706)">Conviene reponer</b>' : ''}</div></div></div>`;
    }).join('');
    return kp + top3 + `<div class="card" style="padding:6px 14px">${rows}</div>${arr.length > 60 ? `<p class="muted small" style="text-align:center;margin-top:8px">Mostrando los primeros 60 de ${arr.length}. Usa la búsqueda para afinar.</p>` : ''}`;
  }
  function vMV() {
    const cats = [...new Set(S.productos.map(p => p.categoria).filter(Boolean))].sort(), own = isOwner();
    return `<style>
.mvk{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:12px 0}.mvk div{background:var(--card,#fff);border:1px solid var(--line,#e6e8ef);border-radius:12px;padding:10px 12px}.mvk small{display:block;color:var(--muted,#6b7280);font-size:11.5px}.mvk b{font-size:19px}
.mvp{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px}.mvpc{background:var(--card,#fff);border:1px solid var(--line,#e6e8ef);border-radius:14px;padding:12px;text-align:center;position:relative}.mvpc.r1{border:2px solid #e0a82e;box-shadow:0 8px 20px rgba(224,168,46,.18)}.mvpc b{display:block;font-size:13.5px;margin-top:7px;line-height:1.25}.mvpc span{font-size:11.5px;color:var(--muted,#6b7280)}.mvm{position:absolute;left:8px;top:6px;font-size:20px}
.mvi{width:100%;aspect-ratio:1/1;max-height:110px;border-radius:10px;overflow:hidden;margin:0 auto}.mvi img,.mvi .ph{width:100%;height:100%;object-fit:cover;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff}.mvi.s{width:46px;height:46px;flex:none;aspect-ratio:auto;margin:0}
.mvr{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line,#eef0f5);cursor:pointer}.mvr:last-child{border:0}.mvn{width:22px;text-align:center;font-weight:800;color:var(--muted,#9aa1b0);flex:none}.mvmid{flex:1;min-width:0}.mvt{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mvu{font-weight:800;font-size:13.5px;white-space:nowrap}
.mvf{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;align-items:center}.mvf .chip{padding:5px 11px;font-size:12px}.mvf .l2{font-size:11.5px;color:var(--muted,#6b7280);font-weight:700;margin-right:2px}
@media(max-width:600px){.mvf:not(.mvs){flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.mvf:not(.mvs) .chip,.mvf .l2{flex:none}.mvk b{font-size:16px}.mvp{gap:6px}.mvpc{padding:8px 6px}.mvpc b{font-size:12px}}</style>
<div class="card"><div class="mvf"><span class="l2">Período</span>${PERS.map(([k, l]) => chip('per', k, l, MV.per === k)).join('')}</div>
<div class="mvf"><span class="l2">Ver por</span>${chip('by', 'prod', 'Producto', MV.by === 'prod')}${chip('by', 'tipo', 'Tipo de prenda', MV.by === 'tipo')}${chip('by', 'cat', 'Categoría', MV.by === 'cat')}</div>
<div class="mvf"><span class="l2">Ordenar</span>${chip('sort', 'uds', 'Unidades', MV.sort === 'uds')}${chip('sort', 'ventas', 'Ventas', MV.sort === 'ventas')}${own ? chip('sort', 'gan', 'Ganancia', MV.sort === 'gan') : ''}<button class="chip ${MV.menos ? 'active' : ''}" data-act="mvMenos">${MV.menos ? '↑ Más vendidos' : '↓ Menos vendidos'}</button></div>
${cats.length ? `<div class="mvf"><span class="l2">Categoría</span>${chip('cat', '', 'Todas', !MV.cat)}${cats.map(c => chip('cat', c, c, MV.cat === c)).join('')}</div>` : ''}
<div class="mvf mvs"><input class="in" id="mv-q" placeholder="Buscar: camisa, jeans, vestido…" value="${esc(MV.q)}" style="flex:1;min-width:180px"><button class="btn sm ghost" data-act="mvCsv">${ic('download')} Excel (CSV)</button></div></div>
<div id="mv-list">${lista()}</div>`;
  }
  ACT.mvSet = d => { MV[d.k] = d.v; render(); };
  ACT.mvMenos = () => { MV.menos = !MV.menos; render(); };
  ACT.mvCsv = () => {
    const own = isOwner(), arr = calcular(), rows = [['#', MV.by === 'prod' ? 'Producto' : MV.by === 'cat' ? 'Categoría' : 'Tipo', 'Variante', 'Unidades', 'Ventas', ...(own ? ['Ganancia'] : []), 'Facturas', 'Stock actual']];
    arr.forEach((r, i) => rows.push([i + 1, r.nombre, r.p ? r.p.variante || '' : '', r.uds, r.ventas.toFixed(2), ...(own ? [r.gan.toFixed(2)] : []), r.n.size, r.p ? r.p.stock : '']));
    saveFile('mas-vendidos-' + MV.per + '.csv', '﻿' + rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv');
  };
  ROUTES.masvendidos = { t: 'Más vendidos', n: 'Más vendidos', i: 'tag', v: vMV, after: () => { const el = $('#mv-q'); if (el) el.addEventListener('input', () => { MV.q = el.value; $('#mv-list').innerHTML = lista(); }); } };
  { const g = GRUPOS[0][1], i = g.indexOf('historial'); g.splice(i < 0 ? g.length : i + 1, 0, 'masvendidos'); }
  const _mas = vMas; vMas = function () { return _mas().replace('<div class="tiles">', `<div class="tiles"><div class="tile" data-act="go" data-r="masvendidos">${ic('tag')}Más vendidos</div>`); };
  ROUTES.mas.v = vMas;
  try { if (L && L.token) buildNav(); } catch { }
})();
