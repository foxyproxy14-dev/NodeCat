'use strict';
// Base de datos de NodeCat: SQLite integrado en Node.js (sin dependencias externas).
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const config = require('./config');

fs.mkdirSync(config.DATA_DIR, { recursive: true });
const ARCHIVO = path.join(config.DATA_DIR, config.DEMO ? 'nodecat-demo.db' : 'nodecat.db');
const db = new DatabaseSync(ARCHIVO);
const pragma = p => { const r = db.prepare(`PRAGMA ${p}`).get(); return r ? Object.values(r)[0] : null; };
const log = t => console.log(`${new Date().toLocaleString('es', { timeZone: config.ZONA_HORARIA, hour12: false })}  ${t}`);

// Base nueva: con auto_vacuum incremental, para poder devolver al disco el espacio que se libera (ver compactar)
if (pragma('page_count') === 0) db.exec('PRAGMA auto_vacuum = INCREMENTAL');

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA journal_size_limit = 33554432;   -- el WAL vuelve a 32 MB como mucho tras cada punto de control
  PRAGMA temp_store = MEMORY;

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
  -- Métricas y tráfico: tablas agrupadas por su clave (WITHOUT ROWID). Las filas de un equipo quedan juntas y ordenadas
  -- por hora, y no hace falta un índice aparte que repita los datos (unos 40 % menos de disco que con tabla + índice).
  CREATE TABLE IF NOT EXISTS metricas (
    equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    t INTEGER NOT NULL, cpu INTEGER, ram INTEGER, disco INTEGER, resumen INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (equipo_id, t, resumen)
  ) WITHOUT ROWID;
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
  CREATE INDEX IF NOT EXISTS ix_eventos_t ON eventos (t);   -- sucesos recientes de todos los equipos (ORDER BY t DESC LIMIT)
  CREATE TABLE IF NOT EXISTS trafico (
    equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    t INTEGER NOT NULL, interfaz TEXT NOT NULL, rx INTEGER, tx INTEGER, rx_max INTEGER, tx_max INTEGER, resumen INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (equipo_id, interfaz, t, resumen)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT);
  CREATE TABLE IF NOT EXISTS alertas (clave TEXT PRIMARY KEY, desde INTEGER, aviso INTEGER, texto TEXT);
`);

// Cambios de esquema de versiones anteriores
const columnas = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
if (!columnas('equipos').includes('config')) db.exec('ALTER TABLE equipos ADD COLUMN config TEXT');
if (!columnas('clientes').includes('grupo_id')) db.exec('ALTER TABLE clientes ADD COLUMN grupo_id INTEGER REFERENCES grupos(id) ON DELETE SET NULL');
if (!columnas('usuarios').includes('grupos')) db.exec('ALTER TABLE usuarios ADD COLUMN grupos TEXT');
if (!columnas('usuarios').includes('totp')) db.exec('ALTER TABLE usuarios ADD COLUMN totp TEXT');
if (!columnas('usuarios').includes('recuperacion')) db.exec('ALTER TABLE usuarios ADD COLUMN recuperacion TEXT');
if (!columnas('equipos').includes('sede')) db.exec('ALTER TABLE equipos ADD COLUMN sede TEXT');
if (!columnas('equipos').includes('instalacion')) db.exec('ALTER TABLE equipos ADD COLUMN instalacion TEXT');
if (!columnas('equipos').includes('desinstalado')) db.exec('ALTER TABLE equipos ADD COLUMN desinstalado INTEGER');
// Agentes: servidores movidos a otro cliente (el agente aún usa la clave vieja) y servidores quitados del panel
db.exec(`
  CREATE TABLE IF NOT EXISTS traslados (cliente_origen INTEGER, nombre TEXT, equipo_id INTEGER, desde INTEGER, PRIMARY KEY (cliente_origen, nombre));
  CREATE TABLE IF NOT EXISTS bajas (cliente_id INTEGER, nombre TEXT, instalacion TEXT, desde INTEGER, PRIMARY KEY (cliente_id, nombre));
  CREATE TABLE IF NOT EXISTS apps_personal (equipo_id INTEGER, clave TEXT, nombre TEXT, url TEXT, categoria TEXT, oculta INTEGER DEFAULT 0, logo TEXT, creada INTEGER, PRIMARY KEY (equipo_id, clave));
`);

// ---------------------------------------------------------------- 0.14: métricas y tráfico a tablas agrupadas
// Se copian una sola vez (juntando las filas repetidas que dejaba el resumen de 5 minutos) y se borra la tabla vieja.
// Si no hay espacio libre suficiente en el disco, se deja como estaba y se vuelve a intentar al siguiente arranque.
const esAgrupada = t => /WITHOUT\s+ROWID/i.test((db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t) || {}).sql || '');
const libre = () => { try { const s = fs.statfsSync(config.DATA_DIR); return s.bavail * s.bsize; } catch { return Infinity; } };
const tamano = () => { try { return fs.statSync(ARCHIVO).size; } catch { return 0; } };
const MIGRAR = {
  metricas: {
    crear: `CREATE TABLE metricas_nueva (equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
      t INTEGER NOT NULL, cpu INTEGER, ram INTEGER, disco INTEGER, resumen INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (equipo_id, t, resumen)) WITHOUT ROWID`,
    copiar: `INSERT INTO metricas_nueva (equipo_id, t, cpu, ram, disco, resumen)
      SELECT equipo_id, t, ROUND(AVG(cpu)), ROUND(AVG(ram)), MAX(disco), resumen FROM metricas
      WHERE equipo_id IN (SELECT id FROM equipos) GROUP BY equipo_id, t, resumen`,
    indice: 'ix_metricas'
  },
  trafico: {
    crear: `CREATE TABLE trafico_nueva (equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
      t INTEGER NOT NULL, interfaz TEXT NOT NULL, rx INTEGER, tx INTEGER, rx_max INTEGER, tx_max INTEGER, resumen INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (equipo_id, interfaz, t, resumen)) WITHOUT ROWID`,
    copiar: `INSERT INTO trafico_nueva (equipo_id, t, interfaz, rx, tx, rx_max, tx_max, resumen)
      SELECT equipo_id, t, interfaz, ROUND(AVG(rx)), ROUND(AVG(tx)), MAX(rx_max), MAX(tx_max), resumen FROM trafico
      WHERE equipo_id IN (SELECT id FROM equipos) GROUP BY equipo_id, interfaz, t, resumen`,
    indice: 'ix_trafico'
  }
};
let migradas = 0;
for (const [tabla, m] of Object.entries(MIGRAR)) {
  if (esAgrupada(tabla)) continue;
  const paginas = (db.prepare('SELECT COUNT(*) n FROM dbstat WHERE name IN (?, ?)').get(tabla, m.indice) || {}).n || 0;
  const necesita = paginas * pragma('page_size') * 1.2;
  if (libre() < necesita) { log(`Aviso: no hay espacio libre para reorganizar la tabla ${tabla} (hacen falta unos ${Math.ceil(necesita / 1048576)} MB). Sigue como estaba.`); continue; }
  const t0 = Date.now();
  log(`Reorganizando la tabla ${tabla} para que ocupe menos (una sola vez; puede tardar un poco)…`);
  db.exec('BEGIN');
  try {
    db.exec(`DROP TABLE IF EXISTS ${tabla}_nueva`);
    db.exec(m.crear);
    db.exec(m.copiar);
    db.exec(`DROP TABLE ${tabla}`);
    db.exec(`ALTER TABLE ${tabla}_nueva RENAME TO ${tabla}`);
    db.exec('COMMIT');
    migradas++;
    log(`Tabla ${tabla} reorganizada en ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
  } catch (e) { db.exec('ROLLBACK'); log(`No se pudo reorganizar la tabla ${tabla}: ${e.message}. Sigue como estaba.`); }
}
// Tras la reorganización (o en una base vieja sin auto_vacuum): un VACUUM una sola vez, que devuelve al disco lo liberado
// y deja activado el auto_vacuum incremental. Solo si hay sitio para la copia temporal.
if (migradas || (pragma('auto_vacuum') !== 2 && tamano() > 0)) {
  const bytes = tamano() + (fs.existsSync(ARCHIVO + '-wal') ? fs.statSync(ARCHIVO + '-wal').size : 0);
  if (libre() > bytes * 1.6) {
    const t0 = Date.now(), antes = tamano();
    try {
      db.exec('PRAGMA auto_vacuum = INCREMENTAL'); db.exec('VACUUM'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      log(`Base de datos compactada: de ${(antes / 1048576).toFixed(1)} MB a ${(tamano() / 1048576).toFixed(1)} MB en ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
    } catch (e) { log('No se pudo compactar la base de datos: ' + e.message); }
  } else if (migradas) log('Aviso: no hay espacio libre para compactar la base de datos ahora; el espacio liberado se reutiliza igualmente.');
}

/** Cada hora: devuelve al disco parte de las páginas libres (si hay muchas) y actualiza las estadísticas del planificador. */
function compactar() {
  try {
    const libres = pragma('freelist_count'), total = pragma('page_count');
    // Solo con muchas páginas libres (más de 16 MB y más del 10 %), y por tandas de 64 MB para no frenar al servidor
    if (pragma('auto_vacuum') === 2 && libres > 4096 && libres > total * 0.1) db.exec('PRAGMA incremental_vacuum(16384)');
    db.exec('PRAGMA optimize');
  } catch (e) { log('Compactar: ' + e.message); }
}
function cerrar() { try { db.exec('PRAGMA optimize'); db.close(); } catch { } }

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

module.exports = { db, q, ajustes, transaccion, compactar, cerrar };
