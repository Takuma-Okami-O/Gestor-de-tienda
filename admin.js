#!/usr/bin/env node
'use strict';
// Administración desde la terminal del servidor.
const crypto = require('crypto');
const { db, createStore, newPassHash, normEmail, DB_PATH } = require('./db');
const [cmd, ...args] = process.argv.slice(2);
const flag = n => { const i = args.indexOf('--' + n); return i > -1 ? args[i + 1] : undefined; };
const genPass = () => crypto.randomBytes(9).toString('base64url');
const usage = `
Gestor de Tienda — administración
  node server/admin.js crear-tienda "Nombre" dueno@correo.com [--nombre "Nombre del dueño"] [--password XXXXXXXX] [--tema tesanz]
  node server/admin.js listar
  node server/admin.js clave dueno@correo.com [--password XXXXXXXX]      (restablecer contraseña)
  node server/admin.js desactivar-tienda dueno@correo.com | activar-tienda dueno@correo.com
Temas disponibles: indigo, tesanz, esmeralda, rosa, dorado, noche`;
try {
  if (cmd === 'crear-tienda') {
    const [nombre, email] = args; if (!nombre || !email) throw new Error('Faltan datos.\n' + usage);
    const password = flag('password') || genPass();
    createStore({ nombre, email, ownerName: flag('nombre'), password, tema: flag('tema') });
    console.log(`\n✔ Tienda creada: ${nombre}\n  Usuario (dueño): ${normEmail(email)}\n  Contraseña:      ${password}\n  Base de datos:   ${DB_PATH}\n  (Pídele que la cambie en Ajustes → Seguridad)\n`);
  } else if (cmd === 'listar') {
    for (const s of db.prepare('SELECT * FROM stores ORDER BY created').all()) {
      console.log(`\n■ ${s.nombre}  [${s.active ? 'activa' : 'SUSPENDIDA'}]  registros: ${db.prepare('SELECT COUNT(*) c FROM records WHERE store_id=?').get(s.id).c}`);
      for (const u of db.prepare('SELECT email,nombre,rol,active FROM users WHERE store_id=?').all(s.id)) console.log(`   - ${u.email}  (${u.nombre}, ${u.rol}${u.active ? '' : ', desactivado'})`);
    }
  } else if (cmd === 'clave') {
    const email = normEmail(args[0]), u = db.prepare('SELECT id FROM users WHERE email=?').get(email); if (!u) throw new Error('No existe ese usuario');
    const password = flag('password') || genPass(); if (password.length < 8) throw new Error('Mínimo 8 caracteres');
    const { salt, hash } = newPassHash(password); db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt, hash, u.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    console.log(`✔ Nueva contraseña para ${email}: ${password}`);
  } else if (cmd === 'desactivar-tienda' || cmd === 'activar-tienda') {
    const u = db.prepare('SELECT store_id FROM users WHERE email=?').get(normEmail(args[0])); if (!u) throw new Error('No existe ese usuario');
    db.prepare('UPDATE stores SET active=? WHERE id=?').run(cmd === 'activar-tienda' ? 1 : 0, u.store_id); console.log('✔ Listo');
  } else console.log(usage);
} catch (e) { console.error('✖ ' + e.message); process.exit(1); }
