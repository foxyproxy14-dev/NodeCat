'use strict';
// Base de datos de NodeCat: SQLite integrado en Node.js (sin dependencias externas).
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const config = require('./config');

fs.mkdirSync(config.DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(config.DATA_DIR, config.DEMO ? 'nodecat-demo.db' : 'nodecat.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS usuarios (
    usuario TEXT PRIMARY KEY COLLATE NOCASE,
    rol TEXT NOT NULL,
    hash TEXT NOT NULL,
    clientes TEXT,                  -- JSON con ids de clientes; NULL = todos
    creado INTEGER, ultimo_acceso INTEGER
  );
  CREATE TABLE IF NOT EXISTS sesiones_web (
    id TEXT PRIMARY KEY, usuario TEXT NOT NULL COLLATE NOCASE, csrf TEXT NOT NULL, creada INTEGER, ultimo INTEGER
  );
  CREATE TABLE IF NOT EXISTS grupos (
    id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE COLLATE NOCASE, creado INTEGER
  );
  CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
    notas TEXT NOT NULL DEFAULT '',
    clave TEXT NOT NULL UNIQUE,
    creado INTEGER
  );
  CREATE TABLE IF NOT EXISTS equipos (
    id INTEGER PRIMARY KEY,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,             -- windows, mikrotik (más adelante: fortigate)
    nombre TEXT NOT NULL COLLATE NOCASE,
    alias TEXT NOT NULL DEFAULT '',
    creado INTEGER, ultimo_contacto INTEGER, version_agente TEXT, ip TEXT, intervalo INTEGER,
    datos TEXT,                     -- último informe (JSON)
    UNIQUE (cliente_id, tipo, nombre)
  );
  CREATE TABLE IF NOT EXISTS metricas (
    equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    t INTEGER NOT NULL, cpu INTEGER, ram INTEGER, disco INTEGER, resumen INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS ix_metricas ON metricas (equipo_id, t);
  CREATE TABLE IF NOT EXISTS sesiones (
    id INTEGER PRIMARY KEY,
    equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    sid INTEGER, usuario TEXT, dominio TEXT, origen TEXT, estado TEXT,
    inicio INTEGER, fin INTEGER, visto INTEGER, desconexiones INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS ix_sesiones_abiertas ON sesiones (equipo_id, fin);
  CREATE INDEX IF NOT EXISTS ix_sesiones_inicio ON sesiones (inicio);
  CREATE TABLE IF NOT EXISTS eventos (
    id INTEGER PRIMARY KEY,
    equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    t INTEGER NOT NULL, tipo TEXT NOT NULL, detalle TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_eventos ON eventos (equipo_id, t);
  CREATE TABLE IF NOT EXISTS trafico (
    equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    t INTEGER NOT NULL, interfaz TEXT NOT NULL, rx INTEGER, tx INTEGER, rx_max INTEGER, tx_max INTEGER, resumen INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS ix_trafico ON trafico (equipo_id, interfaz, t);
  CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT);
  CREATE TABLE IF NOT EXISTS alertas (clave TEXT PRIMARY KEY, desde INTEGER, aviso INTEGER, texto TEXT);
`);

// Cambios de esquema de versiones anteriores
const columnas = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
if (!columnas('equipos').includes('config')) db.exec('ALTER TABLE equipos ADD COLUMN config TEXT');
if (!columnas('clientes').includes('grupo_id')) db.exec('ALTER TABLE clientes ADD COLUMN grupo_id INTEGER REFERENCES grupos(id) ON DELETE SET NULL');
if (!columnas('usuarios').includes('grupos')) db.exec('ALTER TABLE usuarios ADD COLUMN grupos TEXT');
if (!columnas('equipos').includes('sede')) db.exec('ALTER TABLE equipos ADD COLUMN sede TEXT');
if (!columnas('equipos').includes('instalacion')) db.exec('ALTER TABLE equipos ADD COLUMN instalacion TEXT');
if (!columnas('equipos').includes('desinstalado')) db.exec('ALTER TABLE equipos ADD COLUMN desinstalado INTEGER');
// Agentes: servidores movidos a otro cliente (el agente aún usa la clave vieja) y servidores quitados del panel
db.exec(`
  CREATE TABLE IF NOT EXISTS traslados (cliente_origen INTEGER, nombre TEXT, equipo_id INTEGER, desde INTEGER, PRIMARY KEY (cliente_origen, nombre));
  CREATE TABLE IF NOT EXISTS bajas (cliente_id INTEGER, nombre TEXT, instalacion TEXT, desde INTEGER, PRIMARY KEY (cliente_id, nombre));
`);

const cache = new Map();
function q(sql) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}

const ajustes = {
  leer(clave, defecto) {
    const r = q('SELECT valor FROM ajustes WHERE clave = ?').get(clave);
    if (!r) return defecto;
    try { return JSON.parse(r.valor); } catch { return defecto; }
  },
  guardar(clave, valor) {
    q('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(clave, JSON.stringify(valor));
  }
};

function transaccion(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, q, ajustes, transaccion };
