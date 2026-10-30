'use strict';
// Prueba de la API: node tests/api.test.js
process.env.DB_PATH = require('path').join(require('os').tmpdir(), 'biz-test-' + Date.now() + '.db');
const assert = require('assert');
const { createStore } = require('../server/db');
const server = require('../server/server');
let n = 0; const ok = m => console.log('  ✔ ' + m, ++n && '');
(async () => {
  await new Promise(r => server.listen(0, r)); const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (p, o = {}, tok) => { const r = await fetch(base + p, { method: o.m || (o.b ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: o.b ? JSON.stringify(o.b) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  createStore({ nombre: 'Tesanz', email: 'Dueña@Tesanz.com', password: 'clave-segura-1', tema: 'tesanz' });
  createStore({ nombre: 'Otra', email: 'otra@x.com', password: 'otra-clave-12' });

  let r = await call('/api/login', { b: { email: 'dueña@tesanz.com', password: 'mala' } }); assert.equal(r.s, 401); ok('login con clave incorrecta → 401');
  r = await call('/api/sync', { b: {} }); assert.equal(r.s, 401); ok('sync sin sesión → 401');
  r = await call('/api/login', { b: { email: 'DUEÑA@tesanz.com', password: 'clave-segura-1' } }); assert.equal(r.s, 200); const T1 = r.j.token; assert.equal(r.j.user.rol, 'owner'); ok('login dueño correcto');
  r = await call('/api/login', { b: { email: 'dueña@tesanz.com', password: 'clave-segura-1' } }); const T2 = r.j.token;

  r = await call('/api/sync', { b: { since: 0, push: [] } }, T1); assert.equal(r.j.recs.length, 1); assert.equal(r.j.recs[0].c, 'config'); assert.equal(r.j.recs[0].data.tema, 'tesanz'); ok('config inicial con tema tesanz');
  const c0 = r.j.cursor;
  r = await call('/api/sync', { b: { since: c0, push: [{ c: 'productos', id: 'p1', u: 1000, data: { nombre: 'Blusa', stock: 5 } }] } }, T1); assert.deepEqual(r.j.rejected, []); ok('push producto');
  r = await call('/api/sync', { b: { since: c0 } }, T2); assert.equal(r.j.recs.length, 1); assert.equal(r.j.recs[0].data.nombre, 'Blusa'); ok('segundo dispositivo recibe el producto');
  r = await call('/api/sync', { b: { since: c0, push: [{ c: 'productos', id: 'p1', u: 500, data: { nombre: 'VIEJA', stock: 1 } }] } }, T2); assert.equal(r.j.rejected.length, 1); assert.equal(r.j.recs.find(x => x.id === 'p1').data.nombre, 'Blusa'); ok('edición más antigua rechazada y se devuelve la vigente (LWW)');
  r = await call('/api/sync', { b: { since: 0, push: [{ c: 'productos', id: 'p1', u: 2000, d: true }] } }, T2); assert.ok(r.j.recs.every(x => x.id !== 'p1')); ok('borrado se propaga (tombstone)');
  r = await call('/api/sync', { b: { since: c0 } }, T1); assert.ok(r.j.recs.find(x => x.id === 'p1').d); ok('dispositivo 1 recibe el borrado');

  // paginación
  const many = Array.from({ length: 950 }, (_, i) => ({ c: 'movs', id: 'm' + i, u: 3000 + i, data: { i } }));
  r = await call('/api/sync', { b: { since: 0, push: many } }, T1); let total = 0, since = 0, pages = 0, seen = new Set();
  do { r = await call('/api/sync', { b: { since } }, T2); r.j.recs.forEach(x => seen.add(x.c + x.id)); since = r.j.cursor; pages++; } while (r.j.more);
  assert.ok(pages >= 3); assert.ok(seen.size >= 951); ok(`paginación (${pages} páginas, ${seen.size} registros)`);

  // roles
  r = await call('/api/users', { b: { email: 'caja@tesanz.com', nombre: 'Caja', password: 'caja-clave-1' } }, T1); assert.equal(r.s, 200); const empId = r.j.id; ok('dueño crea empleado');
  r = await call('/api/users', { b: { email: 'caja@tesanz.com', nombre: 'X', password: 'caja-clave-1' } }, T1); assert.equal(r.s, 409); ok('correo duplicado → 409');
  r = await call('/api/login', { b: { email: 'caja@tesanz.com', password: 'caja-clave-1' } }); const TE = r.j.token; assert.equal(r.j.user.rol, 'employee');
  r = await call('/api/sync', { b: { since: 0, push: [{ c: 'config', id: 'config', u: 9e12, data: { nombre: 'HACK' } }, { c: 'facturas', id: 'f1', u: 5000, data: { total: 10 } }] } }, TE); assert.equal(r.j.denied.length, 1); assert.ok(r.j.recs.find(x => x.c === 'config').data.nombre === 'Tesanz'); ok('empleado NO puede modificar config; sí registrar facturas');
  r = await call('/api/users', {}, TE); assert.equal(r.s, 403); ok('empleado no administra usuarios → 403');

  // aislamiento entre tiendas
  r = await call('/api/login', { b: { email: 'otra@x.com', password: 'otra-clave-12' } }); const TO = r.j.token;
  r = await call('/api/sync', { b: { since: 0 } }, TO); assert.equal(r.j.recs.length, 1); assert.equal(r.j.recs[0].data.nombre, 'Otra'); ok('aislamiento: otra tienda no ve datos de Tesanz');

  // desactivar empleado revoca sesión
  r = await call('/api/users/' + empId, { m: 'PATCH', b: { active: false } }, T1); assert.equal(r.s, 200);
  r = await call('/api/me', {}, TE); assert.equal(r.s, 401); ok('empleado desactivado pierde su sesión');
  // logout
  r = await call('/api/logout', { b: {} }, T2); r = await call('/api/me', {}, T2); assert.equal(r.s, 401); ok('logout invalida el token');
  // cambio de clave
  r = await call('/api/password', { b: { old: 'mala', new: 'nueva-clave-99' } }, T1); assert.equal(r.s, 400);
  r = await call('/api/password', { b: { old: 'clave-segura-1', new: 'nueva-clave-99' } }, T1); assert.equal(r.s, 200);
  r = await call('/api/login', { b: { email: 'dueña@tesanz.com', password: 'nueva-clave-99' } }); assert.equal(r.s, 200); ok('cambio de contraseña');
  // fuerza bruta
  for (let i = 0; i < 6; i++) await call('/api/login', { b: { email: 'victima@x.com', password: 'x' + i } });
  r = await call('/api/login', { b: { email: 'victima@x.com', password: 'otra' } }); assert.equal(r.s, 429); ok('bloqueo tras 6 intentos fallidos → 429');
  // estáticos y traversal
  let f = await fetch(base + '/'); assert.equal(f.status, 200); assert.ok((await f.text()).includes('<title>'));
  f = await fetch(base + '/..%2f..%2fserver%2fdb.js'); assert.equal(f.status === 403 || f.status === 404, true); ok('sirve la app y bloquea path traversal');
  console.log('\nTODAS LAS PRUEBAS DEL SERVIDOR PASARON (' + n + ')'); server.close(); process.exit(0);
})().catch(e => { console.error('✖ FALLÓ:', e); process.exit(1); });
