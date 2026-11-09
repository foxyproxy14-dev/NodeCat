'use strict';
// Enlaces para compartir: una página de solo lectura de un cliente (o de todo su grupo) sin cuenta.
// Solo se envía el estado y las métricas. Nunca: sesiones, usuarios, IP, configuración, versiones,
// errores de conexión (pueden traer direcciones internas) ni nada que permita llegar a los equipos.
const crypto = require('node:crypto');
const { q, db } = require('./db');
const flota = require('./flota');
const { log } = require('./util');

db.exec(`CREATE TABLE IF NOT EXISTS enlaces (
  token TEXT PRIMARY KEY, cliente_id INTEGER NOT NULL, grupo INTEGER NOT NULL DEFAULT 0,
  nota TEXT, creado INTEGER, vence INTEGER, creador TEXT, visto INTEGER, vistas INTEGER DEFAULT 0
)`);

const DIA = 864e5;
const huella = t => crypto.createHash('sha256').update(String(t)).digest('hex');   // en la base solo se guarda la huella

function crear(clienteId, { grupo, dias, nota }, quien) {
  const c = flota.cliente(clienteId); if (!c) throw new Error('Ese cliente no existe.');
  if (grupo && !c.grupo_id) throw new Error('Este cliente no pertenece a ningún grupo.');
  const d = Number(dias) || 0;
  if (![0, 1, 7, 30, 90].includes(d)) throw new Error('Elige cuánto dura el enlace.');
  const token = crypto.randomBytes(24).toString('base64url');
  const ahora = Date.now();
  q('INSERT INTO enlaces (token, cliente_id, grupo, nota, creado, vence, creador) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(huella(token), clienteId, grupo ? 1 : 0, String(nota || '').trim().slice(0, 80), ahora, d ? ahora + d * DIA : null, quien);
  log(`${quien} creó un enlace de solo lectura para ${c.nombre}${grupo ? ' (todo su grupo)' : ''}.`);
  return { token, id: huella(token).slice(0, 12) };
}

function lista(clienteId) {
  return q('SELECT token, grupo, nota, creado, vence, creador, visto, vistas FROM enlaces WHERE cliente_id = ? ORDER BY creado DESC').all(clienteId)
    .map(e => ({ id: e.token.slice(0, 12), grupo: !!e.grupo, nota: e.nota, creado: e.creado, vence: e.vence, vencido: !!(e.vence && e.vence < Date.now()), creador: e.creador, visto: e.visto, vistas: e.vistas }));
}

function todos() {
  const nombres = new Map(flota.clientes().map(c => [c.id, c.nombre]));
  return q('SELECT token, cliente_id, grupo, nota, creado, vence, creador, visto, vistas FROM enlaces ORDER BY creado DESC').all()
    .map(e => ({ id: e.token.slice(0, 12), cliente: e.cliente_id, clienteNombre: nombres.get(e.cliente_id) || '(cliente borrado)', grupo: !!e.grupo, nota: e.nota, creado: e.creado, vence: e.vence, vencido: !!(e.vence && e.vence < Date.now()), creador: e.creador, visto: e.visto, vistas: e.vistas }));
}
function borrarVencidos(quien) {
  const n = q('DELETE FROM enlaces WHERE vence IS NOT NULL AND vence < ?').run(Date.now()).changes;
  if (n) log(`${quien} borró ${n} enlaces vencidos.`);
  return n;
}

function revocar(clienteId, id, quien) {
  const e = q('SELECT token FROM enlaces WHERE cliente_id = ? AND substr(token, 1, 12) = ?').get(clienteId, String(id));
  if (!e) return;
  q('DELETE FROM enlaces WHERE token = ?').run(e.token);
  log(`${quien} anuló un enlace de solo lectura.`);
}

// ---------------------------------------------------------------- la vista pública
const cacheDisp = new Map();   // disponibilidad de 24 h por equipo, se recalcula cada minuto
function disponibilidad(id) {
  const c = cacheDisp.get(id);
  if (c && Date.now() - c.t < 60000) return c.v;
  let v = null; try { v = Math.round(flota.metricas(id, '24h').disponibilidad * 10) / 10; } catch { }
  cacheDisp.set(id, { t: Date.now(), v });
  return v;
}
const estadoSimple = e => e.estado === 'caido' ? 'caido' : e.estado === 'ok' || e.estado === 'sinMetricas' ? 'ok' : 'pendiente';

function servidor(e) {
  const vivo = e.estado === 'ok' || e.estado === 'sinMetricas';
  const dm = (e.discos || []).reduce((m, d) => !m || d.pct > m.pct ? d : m, null);
  return {
    nombre: e.alias || e.nombre, sede: e.sede || null, estado: estadoSimple(e), so: e.so || '', desde: e.estado === 'caido' ? e.ultimo : null,
    cpu: vivo ? e.cpu : null, ramPct: vivo ? e.ramPct : null, ramUsada: vivo ? e.ramUsada : null, ramTotal: vivo ? e.ramTotal : null,
    disco: vivo && dm ? { unidad: dm.unidad, pct: dm.pct, libre: dm.libre } : null,
    arranque: vivo ? e.arranque : null, disponibilidad: disponibilidad(e.id),
    historial: (e.historial || []).map(h => ({ t: h.t, cpu: h.cpu }))
  };
}
function equipoRed(e) {
  const vivo = e.estado === 'ok' || e.estado === 'sinMetricas', r = e.red || {};
  // El tráfico de cada enlace sale del propio enlace o de su interfaz
  const tasa = (w, k) => w[k] ?? (r.wan && r.wan.interfaz === w.interfaz ? r.wan[k] : null) ?? ((r.interfaces || []).find(i => i.nombre === w.interfaz) || {})[k] ?? null;
  const wans = (r.wans && r.wans.length ? r.wans : r.wan ? [r.wan] : []).map(w => ({ interfaz: w.interfaz, activa: !!w.activa, rx: tasa(w, 'rx'), tx: tasa(w, 'tx') }));
  return {
    nombre: e.alias || e.nombre, sede: e.sede || null, tipo: e.tipo, estado: estadoSimple(e), desde: e.estado === 'caido' ? e.ultimo : null,
    modelo: r.modelo || '', cpu: vivo ? e.cpu : null, ramPct: vivo ? e.ramPct : null, arranque: vivo ? e.arranque : null,
    wans: vivo ? wans : [],
    // Solo destinos públicos (Cloudflare, Google, pruebas de SLA): nunca la puerta de enlace ni IP internas
    latencia: vivo ? (r.latencia || []).filter(l => !/enlace|gateway/i.test(l.nombre || '') && !/^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(l.ip || '')).map(l => ({ nombre: String(l.nombre || '').replace(/,.*/, ''), ms: l.ms ?? null, perdida: l.perdida ?? null })) : [],
    disponibilidad: disponibilidad(e.id)
  };
}

const fallos = new Map();
function vista(token, ip) {
  const f = fallos.get(ip);
  if (f && f.hasta > Date.now()) throw Object.assign(new Error('Demasiados intentos. Espera unos minutos.'), { status: 429 });
  const e = token && q('SELECT * FROM enlaces WHERE token = ?').get(huella(token));
  if (!e || (e.vence && e.vence < Date.now())) {
    const n = f || { n: 0, hasta: 0 }; n.n++; if (n.n >= 30) { n.hasta = Date.now() + 10 * 60000; n.n = 0; } fallos.set(ip, n);
    throw Object.assign(new Error(e ? 'Este enlace venció. Pide uno nuevo a tu proveedor de soporte.' : 'Este enlace no existe o se anuló.'), { status: 404 });
  }
  const c = flota.cliente(e.cliente_id);
  if (!c) throw Object.assign(new Error('Este enlace ya no está disponible.'), { status: 404 });
  const ids = e.grupo && c.grupo_id ? flota.clientes().filter(x => x.grupo_id === c.grupo_id).map(x => x.id) : [c.id];
  const grupo = e.grupo && c.grupo_id ? (flota.grupos().find(g => g.id === c.grupo_id) || {}).nombre : null;
  q('UPDATE enlaces SET visto = ?, vistas = vistas + 1 WHERE token = ?').run(Date.now(), e.token);
  const est = flota.estado({ clientes: ids });
  const desde = Date.now() - 7 * DIA;
  return {
    titulo: grupo || c.nombre, vence: e.vence, ahora: Date.now(),
    clientes: est.clientes.map(x => {
      const eq = x.equipos.filter(y => y.estado !== 'desinstalado');
      const nombres = new Map(eq.map(y => [y.id, y.alias || y.nombre]));
      const sucesos = eq.length ? q(`SELECT equipo_id, t, tipo FROM eventos WHERE equipo_id IN (${eq.map(() => '?').join(',')}) AND t >= ? AND tipo IN ('caida', 'vuelta', 'reinicio', 'wan-caida', 'wan-vuelta') ORDER BY t DESC LIMIT 12`).all(...eq.map(y => y.id), desde)
        .map(s => ({ t: s.t, tipo: s.tipo, equipo: nombres.get(s.equipo_id) })) : [];
      return { nombre: x.nombre, servidores: eq.filter(y => y.tipo === 'windows').map(servidor), red: eq.filter(y => y.tipo !== 'windows').map(equipoRed), sucesos };
    })
  };
}

module.exports = { crear, lista, todos, borrarVencidos, revocar, vista };
