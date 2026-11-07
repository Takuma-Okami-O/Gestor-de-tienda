'use strict';
// Base de datos SQLite (módulo integrado de Node 22+, sin dependencias externas)
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bizcontrol.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS stores (id TEXT PRIMARY KEY, nombre TEXT NOT NULL, created INTEGER NOT NULL, seq INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id), email TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, rol TEXT NOT NULL CHECK (rol IN ('owner','employee')), salt TEXT NOT NULL, hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created INTEGER NOT NULL, last INTEGER NOT NULL, device TEXT);
CREATE TABLE IF NOT EXISTS records (store_id TEXT NOT NULL, col TEXT NOT NULL, id TEXT NOT NULL, u INTEGER NOT NULL, del INTEGER NOT NULL DEFAULT 0, data TEXT, seq INTEGER NOT NULL, PRIMARY KEY (store_id, col, id));
CREATE INDEX IF NOT EXISTS idx_records_seq ON records (store_id, seq);
`);

const uid = () => crypto.randomBytes(9).toString('base64url');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const hashPass = (pass, salt) => crypto.scryptSync(pass, salt, 64).toString('hex');
function newPassHash(pass) { const salt = crypto.randomBytes(16).toString('hex'); return { salt, hash: hashPass(pass, salt) }; }
function checkPass(pass, salt, hash) {
  const a = Buffer.from(hashPass(pass, salt), 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const normEmail = e => String(e || '').trim().toLowerCase();
const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

function createStore({ nombre, email, ownerName, password, tema }) {
  email = normEmail(email);
  if (!nombre || !email || !password) throw new Error('Faltan datos');
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new Error('Ese correo ya está registrado');
  return tx(() => {
    const sid = uid(), uidd = uid(), now = Date.now(), { salt, hash } = newPassHash(password);
    db.prepare('INSERT INTO stores (id,nombre,created,seq) VALUES (?,?,?,1)').run(sid, nombre, now);
    db.prepare('INSERT INTO users (id,store_id,email,nombre,rol,salt,hash,created) VALUES (?,?,?,?,?,?,?,?)').run(uidd, sid, email, ownerName || nombre, 'owner', salt, hash, now);
    const cfg = { nombre, tema: tema || 'indigo' };
    db.prepare('INSERT INTO records (store_id,col,id,u,del,data,seq) VALUES (?,?,?,?,0,?,1)').run(sid, 'config', 'config', now, JSON.stringify(cfg));
    return { storeId: sid, userId: uidd };
  });
}

module.exports = { db, uid, sha256, newPassHash, checkPass, normEmail, tx, createStore, DB_PATH };
