'use strict';
// Clientes, equipos, informes de los agentes, estado en vivo e historial.
const { q, transaccion } = require('./db');
const { aleatorio, log, duracion } = require('./util');
const config = require('./config');

const INTERVALO_AGENTE = 30;                       // segundos entre informes que se piden a los agentes
const limite = e => Math.max(90, (e.intervalo || INTERVALO_AGENTE) * 3) * 1000;   // sin noticias durante esto = sin respuesta
const HORA = 3600e3, DIA = 24 * HORA;

// ---------------------------------------------------------------- clientes
function validarNombre(n) {
  n = String(n || '').trim().replace(/\s+/g, ' ');
  if (!n) throw new Error('Escribe el nombre del cliente.');
  if (n.length > 60) throw new Error('El nombre es demasiado largo (máximo 60).');
  return n;
}
// ---------------------------------------------------------------- grupos (una empresa con varias sedes)
const grupos = () => q('SELECT id, nombre FROM grupos ORDER BY nombre').all();
function grupoId(g) {
  if (g == null || g === '') return null;
  if (typeof g === 'number' || /^\d+$/.test(String(g))) { if (!q('SELECT id FROM grupos WHERE id = ?').get(Number(g))) throw new Error('Ese grupo no existe.'); return Number(g); }
  // Un nombre nuevo crea el grupo
  const nombre = String(g).trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!nombre) return null;
  const ya = q('SELECT id FROM grupos WHERE nombre = ?').get(nombre);
  if (ya) return ya.id;
  return Number(q('INSERT INTO grupos (nombre, creado) VALUES (?, ?)').run(nombre, Date.now()).lastInsertRowid);
}
function renombrarGrupo(id, nombre) {
  nombre = String(nombre || '').trim().replace(/\s+/g, ' ');
  if (!nombre || nombre.length > 60) throw new Error('Escribe un nombre de hasta 60 caracteres.');
  const otro = q('SELECT id FROM grupos WHERE nombre = ?').get(nombre);
  if (otro && otro.id !== id) throw new Error(`Ya existe el grupo ${nombre}.`);
  q('UPDATE grupos SET nombre = ? WHERE id = ?').run(nombre, id);
}
function borrarGrupo(id) { q('DELETE FROM grupos WHERE id = ?').run(id); }   // sus clientes quedan sin grupo

function crearCliente(nombre, notas = '', grupo = null) {
  nombre = validarNombre(nombre);
  if (q('SELECT id FROM clientes WHERE nombre = ?').get(nombre)) throw new Error(`Ya existe el cliente ${nombre}.`);
  const r = q('INSERT INTO clientes (nombre, notas, clave, creado, grupo_id) VALUES (?, ?, ?, ?, ?)').run(nombre, String(notas || '').slice(0, 500), aleatorio(24), Date.now(), grupoId(grupo));
  log(`Cliente creado: ${nombre}.`);
  return Number(r.lastInsertRowid);
}
function editarCliente(id, nombre, notas, grupo) {
  nombre = validarNombre(nombre);
  const otro = q('SELECT id FROM clientes WHERE nombre = ?').get(nombre);
  if (otro && otro.id !== id) throw new Error(`Ya existe el cliente ${nombre}.`);
  q('UPDATE clientes SET nombre = ?, notas = ?, grupo_id = ? WHERE id = ?').run(nombre, String(notas || '').slice(0, 500), grupoId(grupo), id);
}
let alBorrarEquipo = () => { };
function borrarCliente(id) {
  const c = cliente(id); if (!c) return;
  for (const e of q('SELECT id FROM equipos WHERE cliente_id = ?').all(id)) alBorrarEquipo(e.id);
  q('DELETE FROM clientes WHERE id = ?').run(id);
  for (const k of [...vivo.keys()]) if (vivo.get(k).cliente_id === id) vivo.delete(k);
  log(`Cliente borrado: ${c.nombre}.`);
}
function nuevaClave(id) { q('UPDATE clientes SET clave = ? WHERE id = ?').run(aleatorio(24), id); }
const cliente = id => q('SELECT * FROM clientes WHERE id = ?').get(id);
const clientes = () => q('SELECT c.id, c.nombre, c.notas, c.creado, c.grupo_id, g.nombre AS grupo FROM clientes c LEFT JOIN grupos g ON g.id = c.grupo_id ORDER BY c.nombre').all();

// ---------------------------------------------------------------- equipos
const equipo = id => q('SELECT * FROM equipos WHERE id = ?').get(id);
function editarEquipo(id, { alias, cliente_id }) {
  const e = equipo(id); if (!e) throw new Error('Ese equipo ya no existe.');
  if (cliente_id != null && cliente_id !== e.cliente_id) {
    if (!cliente(cliente_id)) throw new Error('Ese cliente no existe.');
    if (q('SELECT id FROM equipos WHERE cliente_id = ? AND tipo = ? AND nombre = ?').get(cliente_id, e.tipo, e.nombre))
      throw new Error(`Ese cliente ya tiene un equipo llamado ${e.nombre}.`);
    q('UPDATE equipos SET cliente_id = ? WHERE id = ?').run(cliente_id, id);
    // El agente sigue usando la clave del cliente anterior: en su próximo informe recibe la del nuevo
    if (e.tipo === 'windows') {
      q('DELETE FROM traslados WHERE equipo_id = ?').run(id);
      q('INSERT OR REPLACE INTO traslados (cliente_origen, nombre, equipo_id, desde) VALUES (?, ?, ?, ?)').run(e.cliente_id, e.nombre, id, Date.now());
      q('DELETE FROM bajas WHERE cliente_id = ? AND nombre = ?').run(cliente_id, e.nombre);
    }
  }
  if (alias != null) q('UPDATE equipos SET alias = ? WHERE id = ?').run(String(alias).trim().slice(0, 60), id);
  cargarVivo(id);
}
function borrarEquipo(id) {
  const e = equipo(id);
  // Un servidor quitado del panel no vuelve a aparecer solo: su agente recibe la orden de desinstalarse.
  // Si se vuelve a instalar (instalación nueva), aparece otra vez.
  if (e && e.tipo === 'windows' && !e.desinstalado) q('INSERT OR REPLACE INTO bajas (cliente_id, nombre, instalacion, desde) VALUES (?, ?, ?, ?)').run(e.cliente_id, e.nombre, e.instalacion || '', Date.now());
  q('DELETE FROM traslados WHERE equipo_id = ?').run(id);
  q('DELETE FROM equipos WHERE id = ?').run(id); vivo.delete(id); require('./sonda').olvidar(id);
}

// ---------------------------------------------------------------- estado en memoria
// Por equipo: la fila de la base, el último informe y la última hora de CPU y memoria (para las miniaturas)
const vivo = new Map();
function cargarVivo(id) {
  const e = equipo(id);
  if (!e) { vivo.delete(id); return; }
  const previo = vivo.get(id);
  let sonda = null; if (e.tipo !== 'windows' && e.config) { try { sonda = JSON.parse(e.config).sonda || null; } catch { } }
  vivo.set(id, { ...e, config: undefined, sonda, datos: e.datos ? JSON.parse(e.datos) : null, hora: previo ? previo.hora : [], ultimaMuestra: previo ? previo.ultimaMuestra : 0, caido: previo ? previo.caido : null, errorConexion: previo ? previo.errorConexion : null });
}
function arrancar() {
  for (const { id } of q('SELECT id FROM equipos').all()) cargarVivo(id);
  const desde = Date.now() - HORA;
  for (const m of q('SELECT equipo_id, t, cpu, ram FROM metricas WHERE t >= ? AND resumen = 0 ORDER BY t').all(desde)) {
    const v = vivo.get(m.equipo_id); if (v) { v.hora.push({ t: m.t, cpu: m.cpu, ram: m.ram }); v.ultimaMuestra = m.t; }
  }
  // Estado inicial sin generar avisos: quien estaba sin respuesta lo sigue estando
  const ahora = Date.now();
  for (const v of vivo.values()) v.caido = v.ultimo_contacto ? ahora - v.ultimo_contacto > limite(v) : false;
}

function estadoDe(v, ahora = Date.now()) {
  if (v.desinstalado) return 'desinstalado';
  if (v.sinRespuesta && v.ultimo_contacto) return 'caido';
  if (!v.ultimo_contacto) return 'pendiente';
  if (ahora - v.ultimo_contacto > limite(v)) return 'caido';
  if (v.datos && v.datos.errorMetricas) return 'sinMetricas';
  return 'ok';
}

// ---------------------------------------------------------------- informes de los agentes
const num = (x, min = 0, max = 1e9) => (typeof x === 'number' && isFinite(x)) ? Math.min(max, Math.max(min, x)) : null;
const txt = (x, max = 200) => x == null ? '' : String(x).slice(0, max);

function limpiarInforme(c) {
  const d = {
    cpu: num(c.cpu, 0, 100), ramPct: num(c.ramPct, 0, 100), ramTotal: num(c.ramTotal), ramUsada: num(c.ramUsada),
    so: txt(c.so), arranque: num(c.arranque, 0, 9e15), errorSesiones: c.errorSesiones ? txt(c.errorSesiones, 400) : null,
    errorMetricas: c.errorMetricas ? txt(c.errorMetricas, 400) : null, hora: num(c.hora, 0, 9e15),
    discos: (Array.isArray(c.discos) ? c.discos : []).slice(0, 40).map(x => ({
      unidad: txt(x.unidad, 20), etiqueta: txt(x.etiqueta, 60), total: num(x.total), libre: num(x.libre), pct: num(x.pct, 0, 100)
    })),
    sesiones: (Array.isArray(c.sesiones) ? c.sesiones : []).slice(0, 500).map(x => ({
      usuario: txt(x.usuario, 100), dominio: txt(x.dominio, 100), id: num(x.id, 0, 1e7), estado: txt(x.estado, 20),
      estadoTexto: txt(x.estadoTexto, 40), equipo: txt(x.equipo, 100), inicio: num(x.inicio, 0, 9e15), inactivo: num(x.inactivo, 0, 1e7)
    })).filter(s => s.usuario)
  };
  if (d.errorMetricas) { d.cpu = d.ramPct = null; }
  return d;
}

function recibir(clave, c, ip) {
  const cli = clave && q('SELECT id, nombre FROM clientes WHERE clave = ?').get(String(clave));
  if (!cli) { const e = new Error('La clave del agente no es válida. Descarga de nuevo el agente desde NodeCat.'); e.status = 403; throw e; }
  const nombre = txt(c && c.nombre, 63).trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(nombre)) { const e = new Error('El informe no trae un nombre de equipo válido.'); e.status = 400; throw e; }
  const d = limpiarInforme(c);
  const ahora = Date.now();
  // Informes atrasados (el agente los guardó mientras no había conexión): solo completan el historial
  if (d.hora && ahora - d.hora > 120000 && ahora - d.hora < 2 * DIA) {
    const f = q("SELECT id FROM equipos WHERE cliente_id = ? AND tipo = 'windows' AND nombre = ?").get(cli.id, nombre);
    if (f && (d.cpu != null || d.ramPct != null) && !q('SELECT 1 FROM metricas WHERE equipo_id = ? AND t BETWEEN ? AND ?').get(f.id, d.hora - 50000, d.hora + 50000)) {
      const disco = d.discos.length ? Math.max(...d.discos.map(x => x.pct || 0)) : null;
      q('INSERT INTO metricas (equipo_id, t, cpu, ram, disco) VALUES (?, ?, ?, ?, ?)').run(f.id, Math.round(d.hora), d.cpu, d.ramPct, disco);
    }
    return { ok: true, intervalo: INTERVALO_AGENTE, servidor: nombre, cliente: cli.nombre, atrasado: true };
  }
  const intervalo = Math.round(num(c.intervalo, 5, 3600) || INTERVALO_AGENTE);
  const instalacion = txt(c.instalacion, 40).trim();

  let fila = q("SELECT id, cliente_id FROM equipos WHERE cliente_id = ? AND tipo = 'windows' AND nombre = ?").get(cli.id, nombre);
  let claveNueva = null, clienteNuevo = null;
  // El traslado se conserva: un agente antiguo (sin cambio automático de clave) sigue informando con la clave vieja
  if (!fila) {
    // ¿Se movió a otro cliente? Se le da la clave del cliente nuevo
    const t = q('SELECT t.equipo_id, c.clave, c.nombre FROM traslados t JOIN equipos e ON e.id = t.equipo_id JOIN clientes c ON c.id = e.cliente_id WHERE t.cliente_origen = ? AND t.nombre = ?').get(cli.id, nombre);
    if (t) { fila = { id: t.equipo_id }; claveNueva = t.clave; clienteNuevo = t.nombre; }
  }
  if (!fila) {
    // ¿Se quitó del panel? Solo vuelve si es una instalación nueva
    const b = q('SELECT instalacion FROM bajas WHERE cliente_id = ? AND nombre = ?').get(cli.id, nombre);
    if (b && (!instalacion || instalacion === b.instalacion)) { const e = new Error('Este servidor se quitó de NodeCat. El agente se desinstala.'); e.status = 410; throw e; }
    if (b) q('DELETE FROM bajas WHERE cliente_id = ? AND nombre = ?').run(cli.id, nombre);
  }
  // Desinstalado desde el propio servidor: se anota y deja de vigilarse (sin avisos de caída)
  if (c.evento === 'desinstalado') {
    if (fila) {
      q('UPDATE equipos SET desinstalado = ? WHERE id = ?').run(ahora, fila.id);
      evento(fila.id, 'desinstalado', 'Se desinstaló el agente en el servidor.', ahora);
      cargarVivo(fila.id);
      log(`${nombre} (${cli.nombre}): se desinstaló el agente.`);
    }
    return { ok: true };
  }
  let nuevo = false;
  if (!fila) {
    const r = q("INSERT INTO equipos (cliente_id, tipo, nombre, creado) VALUES (?, 'windows', ?, ?)").run(cli.id, nombre, ahora);
    fila = { id: Number(r.lastInsertRowid) }; nuevo = true;
    log(`Nuevo equipo de ${cli.nombre}: ${nombre} (${ip}).`);
  }
  const id = fila.id;
  const previo = vivo.get(id);
  const antes = previo && previo.datos;

  transaccion(() => {
    q('UPDATE equipos SET ultimo_contacto = ?, version_agente = ?, ip = ?, intervalo = ?, datos = ?, desinstalado = NULL, instalacion = COALESCE(NULLIF(?, \'\'), instalacion) WHERE id = ?')
      .run(ahora, txt(c.version, 20), txt(ip, 60), intervalo, JSON.stringify(d), instalacion, id);
    if (previo && previo.desinstalado) evento(id, 'nuevo', 'El agente se volvió a instalar.', ahora);
    if (nuevo) evento(id, 'nuevo', `El agente empezó a informar desde ${ip}.`, ahora);
    if (antes && d.arranque && antes.arranque && Math.abs(d.arranque - antes.arranque) > 120000 && d.arranque > antes.arranque)
      evento(id, 'reinicio', 'El equipo se reinició.', d.arranque);
    if (!d.errorSesiones) seguirSesiones(id, d.sesiones, ahora);
  });
  cargarVivo(id);
  const v = vivo.get(id);
  // Una muestra por minuto como mucho
  if (ahora - v.ultimaMuestra >= 55000 && (d.cpu != null || d.ramPct != null || d.discos.length)) {
    const disco = d.discos.length ? Math.max(...d.discos.map(x => x.pct || 0)) : null;
    q('INSERT INTO metricas (equipo_id, t, cpu, ram, disco) VALUES (?, ?, ?, ?, ?)').run(id, ahora, d.cpu, d.ramPct, disco);
    v.hora.push({ t: ahora, cpu: d.cpu, ram: d.ramPct });
    v.ultimaMuestra = ahora;
  }
  v.hora = v.hora.filter(m => m.t >= ahora - HORA);
  if (v.caido) volvio(v, ahora);
  return { ok: true, intervalo: INTERVALO_AGENTE, servidor: nombre, cliente: clienteNuevo || cli.nombre, sonda: require('./sonda').enUso(id), ...(claveNueva ? { clave: claveNueva } : {}) };
}

/** La sonda: identifica al agente por su clave y su nombre de equipo. */
function agenteDe(clave, nombre) {
  const cli = clave && q('SELECT id FROM clientes WHERE clave = ?').get(String(clave));
  if (!cli) { const e = new Error('La clave del agente no es válida.'); e.status = 403; throw e; }
  const n = txt(nombre, 63).trim().toUpperCase();
  const f = q("SELECT id FROM equipos WHERE cliente_id = ? AND tipo = 'windows' AND nombre = ?").get(cli.id, n)
    || q('SELECT equipo_id AS id FROM traslados WHERE cliente_origen = ? AND nombre = ?').get(cli.id, n);
  if (!f) { const e = new Error('Este equipo todavía no ha enviado su primer informe.'); e.status = 404; throw e; }
  return f.id;
}

// ---------------------------------------------------------------- routers (los consulta lib/mikrotik.js)
function crearRouter(clienteId, nombre, config, tipo = 'mikrotik') {
  nombre = String(nombre || '').trim().replace(/\s+/g, ' ');
  if (!nombre) throw new Error('Escribe un nombre para el router.');
  if (nombre.length > 60) throw new Error('El nombre es demasiado largo (máximo 60).');
  if (!cliente(clienteId)) throw new Error('Ese cliente no existe.');
  if (q("SELECT id FROM equipos WHERE cliente_id = ? AND tipo = ? AND nombre = ?").get(clienteId, tipo, nombre)) throw new Error(`Ese cliente ya tiene un equipo de red llamado ${nombre}.`);
  const r = q("INSERT INTO equipos (cliente_id, tipo, nombre, creado, intervalo, config) VALUES (?, ?, ?, ?, 30, ?)").run(clienteId, tipo, nombre, Date.now(), JSON.stringify(config));
  const id = Number(r.lastInsertRowid);
  cargarVivo(id);
  return id;
}
function renombrarRouter(id, nombre) {
  nombre = String(nombre || '').trim().replace(/\s+/g, ' ');
  if (!nombre || nombre.length > 60) throw new Error('Escribe un nombre de hasta 60 caracteres.');
  const e = equipo(id);
  const otro = q("SELECT id FROM equipos WHERE cliente_id = ? AND tipo = ? AND nombre = ?").get(e.cliente_id, e.tipo, nombre);
  if (otro && otro.id !== id) throw new Error(`Ese cliente ya tiene un router llamado ${nombre}.`);
  q('UPDATE equipos SET nombre = ? WHERE id = ?').run(nombre, id);
  cargarVivo(id);
}
function actualizarRouter(id, d, ip, version) {
  const ahora = Date.now();
  const previo = vivo.get(id); if (!previo) return;
  const antes = previo.datos;
  transaccion(() => {
    q('UPDATE equipos SET ultimo_contacto = ?, version_agente = ?, ip = ?, intervalo = 30, datos = ? WHERE id = ?').run(ahora, version || '', ip || '', JSON.stringify(d), id);
    if (antes && d.arranque && antes.arranque && d.arranque - antes.arranque > 120000) evento(id, 'reinicio', 'El router se reinició.', d.arranque);
    // Cada enlace WAN por separado (un FortiGate con SD-WAN puede tener varios)
    for (const wn of wansDe(d)) {
      const wa = wansDe(antes).find(x => x.interfaz === wn.interfaz);
      if (wa && wa.activa !== wn.activa)
        evento(id, wn.activa ? 'wan-vuelta' : 'wan-caida', wn.activa ? `El enlace WAN (${wn.interfaz}) volvió.` : `El enlace WAN (${wn.interfaz}) se cayó.`, ahora);
    }
  });
  cargarVivo(id);
  const v = vivo.get(id);
  v.errorConexion = null;
  if (ahora - v.ultimaMuestra >= 55000 && d.cpu != null) {
    q('INSERT INTO metricas (equipo_id, t, cpu, ram, disco) VALUES (?, ?, ?, ?, NULL)').run(id, ahora, d.cpu, d.ramPct);
    v.hora.push({ t: ahora, cpu: d.cpu, ram: d.ramPct }); v.ultimaMuestra = ahora;
  }
  v.hora = v.hora.filter(m => m.t >= ahora - HORA);
  if (v.caido) volvio(v, ahora);
}

// El recolector de MikroTik confirma que el router no responde (dos intentos seguidos): se marca al momento
const wansDe = d => !d || !d.red ? [] : d.red.wans && d.red.wans.length ? d.red.wans : d.red.wan ? [d.red.wan] : [];
function routerSinRespuesta(id, mensaje) {
  const v = vivo.get(id); if (!v) return;
  v.errorConexion = mensaje;
  if (!v.ultimo_contacto) return;          // nunca conectó: queda como pendiente, con el error a la vista
  v.sinRespuesta = true;
  if (v.caido) return;
  v.caido = true;
  evento(id, 'caida', mensaje ? `Dejó de responder: ${mensaje}` : 'Dejó de responder.');
  log(`${v.nombre} dejó de responder.`);
  avisar('caida', v);
}

function evento(equipoId, tipo, detalle, t = Date.now()) {
  q('INSERT INTO eventos (equipo_id, t, tipo, detalle) VALUES (?, ?, ?, ?)').run(equipoId, t, tipo, detalle || null);
}

// Inicios y cierres de sesión: compara lo que informa el agente con las sesiones abiertas
function seguirSesiones(id, sesiones, ahora) {
  const abiertas = q('SELECT id, sid, usuario, estado FROM sesiones WHERE equipo_id = ? AND fin IS NULL').all(id);
  const clave = (u, s) => `${String(u).toLowerCase()}|${s}`;
  const vistas = new Map(sesiones.map(s => [clave(s.usuario, s.id), s]));
  for (const a of abiertas) {
    const s = vistas.get(clave(a.usuario, a.sid));
    if (!s) { q('UPDATE sesiones SET fin = ? WHERE id = ?').run(ahora, a.id); continue; }
    vistas.delete(clave(a.usuario, a.sid));
    const desconecta = a.estado === 'activa' && s.estado === 'desconectada' ? 1 : 0;
    q('UPDATE sesiones SET visto = ?, estado = ?, origen = COALESCE(NULLIF(?, \'\'), origen), desconexiones = desconexiones + ? WHERE id = ?')
      .run(ahora, s.estado, s.equipo, desconecta, a.id);
  }
  for (const s of vistas.values())
    q('INSERT INTO sesiones (equipo_id, sid, usuario, dominio, origen, estado, inicio, visto) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, s.id, s.usuario, s.dominio, s.equipo, s.estado, s.inicio || ahora, ahora);
}

// ---------------------------------------------------------------- vigilancia periódica
const oyentes = [];
const alCambiar = fn => oyentes.push(fn);
function avisar(tipo, v, extra) { for (const fn of oyentes) { try { fn(tipo, v, extra); } catch (e) { log('Error en un aviso: ' + e.message); } } }

function volvio(v, ahora) {
  v.caido = false;
  const ultima = q("SELECT t FROM eventos WHERE equipo_id = ? AND tipo = 'caida' ORDER BY t DESC LIMIT 1").get(v.id);
  const dur = ultima ? ahora - ultima.t : null;
  evento(v.id, 'vuelta', dur != null ? `Volvió a responder tras ${duracion(dur)}.` : 'Volvió a responder.', ahora);
  log(`${v.nombre} volvió a responder.`);
  avisar('vuelta', v, { duracion: dur });
}
function vigilar() {
  const ahora = Date.now();
  for (const v of vivo.values()) {
    if (!v.ultimo_contacto || v.caido) continue;
    if (ahora - v.ultimo_contacto > limite(v)) {
      v.caido = true;
      evento(v.id, 'caida', 'Dejó de responder.', v.ultimo_contacto + limite(v));
      q('UPDATE sesiones SET fin = visto WHERE equipo_id = ? AND fin IS NULL').run(v.id);
      log(`${v.nombre} dejó de responder.`);
      avisar('caida', v);
    }
  }
}

// ---------------------------------------------------------------- consultas para la web
function visibles(sesion) {
  const todos = clientes();
  return sesion.clientes ? todos.filter(c => sesion.clientes.includes(c.id)) : todos;
}
function puedeVer(sesion, clienteId) { return !sesion.clientes || sesion.clientes.includes(clienteId); }

function vistaEquipo(v, ahora) {
  const d = v.datos || {};
  return {
    id: v.id, cliente: v.cliente_id, tipo: v.tipo, nombre: v.nombre, alias: v.alias, estado: estadoDe(v, ahora),
    ultimo: v.ultimo_contacto, version: v.version_agente, ip: v.ip, intervalo: v.intervalo,
    cpu: d.cpu ?? null, ramPct: d.ramPct ?? null, ramTotal: d.ramTotal ?? null, ramUsada: d.ramUsada ?? null,
    so: d.so || '', arranque: d.arranque || null, discos: d.discos || [], sesiones: d.sesiones || [],
    errorSesiones: d.errorSesiones || null, errorMetricas: d.errorMetricas || null,
    red: d.red || null, errorConexion: v.errorConexion || null, sonda: v.sonda || null,
    historial: v.hora
  };
}
function estado(sesion) {
  const ahora = Date.now();
  const cs = visibles(sesion);
  const porCliente = new Map(cs.map(c => [c.id, { ...c, equipos: [] }]));
  let actualizado = 0;
  for (const v of vivo.values()) {
    const c = porCliente.get(v.cliente_id); if (!c) continue;
    c.equipos.push(vistaEquipo(v, ahora));
    if (v.ultimo_contacto > actualizado) actualizado = v.ultimo_contacto;
  }
  for (const c of porCliente.values()) c.equipos.sort((a, b) => a.nombre.localeCompare(b.nombre));
  const usados = new Set(cs.map(c => c.grupo_id).filter(Boolean));
  return { ahora, actualizado, version: config.VERSION, demo: config.DEMO, grupos: grupos().filter(g => !sesion.clientes || usados.has(g.id)), clientes: [...porCliente.values()] };
}

const RANGOS = { '1h': HORA, '24h': DIA, '7d': 7 * DIA, '30d': 30 * DIA };
function metricas(equipoId, rango) {
  const dur = RANGOS[rango] || DIA, hasta = Date.now(), desde = hasta - dur;
  const paso = Math.max(60000, Math.ceil(dur / 360 / 60000) * 60000);
  // El paso va en el texto (es un entero calculado aquí): como parámetro, SQLite lo trataría como decimal y no agruparía
  const puntos = q(`SELECT (t / ${paso}) * ${paso} AS t, ROUND(AVG(cpu)) AS cpu, ROUND(AVG(ram)) AS ram, MAX(disco) AS disco, MAX(cpu) AS cpuMax
                    FROM metricas WHERE equipo_id = ? AND t >= ? GROUP BY t / ${paso} ORDER BY 1`).all(equipoId, desde);
  const ev = q('SELECT t, tipo, detalle FROM eventos WHERE equipo_id = ? AND t >= ? ORDER BY t').all(equipoId, desde - 30 * DIA);
  // Tiempo sin respuesta dentro del periodo
  let sin = 0, abierta = null;
  for (const e of ev) {
    if (e.tipo === 'caida') abierta = e.t;
    else if (e.tipo === 'vuelta' && abierta != null) { sin += Math.max(0, e.t - Math.max(abierta, desde)) * (e.t > desde ? 1 : 0); abierta = null; }
  }
  if (abierta != null) sin += hasta - Math.max(abierta, desde);
  const eventos = ev.filter(e => e.t >= desde);
  return { desde, hasta, paso, puntos, eventos, disponibilidad: Math.max(0, Math.min(100, 100 - sin / dur * 100)), caidas: eventos.filter(e => e.tipo === 'caida').length };
}

function trafico(equipoId, rango, interfaz) {
  const dur = RANGOS[rango] || DIA, desde = Date.now() - dur;
  const paso = Math.max(60000, Math.ceil(dur / 360 / 60000) * 60000);
  const interfaces = q('SELECT DISTINCT interfaz FROM trafico WHERE equipo_id = ? AND t >= ?').all(equipoId, desde).map(r => r.interfaz);
  const puntos = interfaz ? q(`SELECT (t / ${paso}) * ${paso} AS t, ROUND(AVG(rx)) AS rx, ROUND(AVG(tx)) AS tx, MAX(rx_max) AS rxMax, MAX(tx_max) AS txMax
    FROM trafico WHERE equipo_id = ? AND interfaz = ? AND t >= ? GROUP BY t / ${paso} ORDER BY 1`).all(equipoId, interfaz, desde) : [];
  return { desde, paso, interfaz, interfaces, puntos };
}

// Sucesos de un equipo con la duración de cada caída (la emparejo con la vuelta siguiente)
function sucesosEquipo(equipoId, dias = 90) {
  const desde = Date.now() - dias * DIA;
  const ev = q('SELECT t, tipo, detalle FROM eventos WHERE equipo_id = ? AND t >= ? ORDER BY t').all(equipoId, desde);
  const salida = [];
  for (let i = 0; i < ev.length; i++) {
    const e = { ...ev[i] };
    const par = { caida: 'vuelta', 'wan-caida': 'wan-vuelta' }[e.tipo];
    if (par) {
      const v = ev.slice(i + 1).find(x => x.tipo === par || x.tipo === e.tipo);
      if (v && v.tipo === par) { e.hasta = v.t; e.duracion = v.t - e.t; } else e.sigue = !v;
    }
    salida.push(e);
  }
  const caidas = salida.filter(e => e.tipo === 'caida');
  return { desde, sucesos: salida.reverse(), resumen: { caidas: caidas.length, sinRespuesta: caidas.reduce((a, e) => a + (e.duracion || (e.sigue ? Date.now() - e.t : 0)), 0),
    wan: salida.filter(e => e.tipo === 'wan-caida').length, reinicios: salida.filter(e => e.tipo === 'reinicio').length } };
}

function historialSesiones(sesion, { cliente: cid, equipo: eid, desde, hasta, texto }) {
  desde = Number(desde) || Date.now() - 7 * DIA; hasta = Number(hasta) || Date.now();
  const params = [hasta, desde];
  let sql = `SELECT s.id, s.usuario, s.dominio, s.origen, s.estado, s.inicio, s.fin, s.visto, s.desconexiones,
                    e.id AS equipo_id, e.nombre AS equipo, e.alias, c.id AS cliente_id, c.nombre AS cliente
             FROM sesiones s JOIN equipos e ON e.id = s.equipo_id JOIN clientes c ON c.id = e.cliente_id
             WHERE s.inicio <= ? AND COALESCE(s.fin, 9e15) >= ?`;
  if (sesion.clientes) { sql += ` AND c.id IN (${sesion.clientes.map(() => '?').join(',') || 'NULL'})`; params.push(...sesion.clientes); }
  if (cid) { sql += ' AND c.id = ?'; params.push(Number(cid)); }
  if (eid) { sql += ' AND e.id = ?'; params.push(Number(eid)); }
  if (texto) { sql += ' AND (s.usuario LIKE ? OR s.origen LIKE ? OR e.nombre LIKE ?)'; const t = `%${String(texto).slice(0, 60)}%`; params.push(t, t, t); }
  sql += ' ORDER BY s.inicio DESC LIMIT 5000';
  return q(sql).all(...params);
}

function eventosRecientes(sesion, limiteN = 60) {
  const params = [];
  let sql = `SELECT ev.t, ev.tipo, ev.detalle, e.id AS equipo_id, e.nombre AS equipo, c.id AS cliente_id, c.nombre AS cliente
             FROM eventos ev JOIN equipos e ON e.id = ev.equipo_id JOIN clientes c ON c.id = e.cliente_id`;
  if (sesion.clientes) { sql += ` WHERE c.id IN (${sesion.clientes.map(() => '?').join(',') || 'NULL'})`; params.push(...sesion.clientes); }
  sql += ' ORDER BY ev.t DESC LIMIT ?'; params.push(limiteN);
  return q(sql).all(...params);
}

// ---------------------------------------------------------------- mantenimiento
// Detalle por minuto durante 7 días; después, promedios de 5 minutos durante 400 días.
function mantenimiento() {
  const corte = Date.now() - 7 * DIA, paso = 300000;
  transaccion(() => {
    q(`INSERT INTO metricas (equipo_id, t, cpu, ram, disco, resumen)
       SELECT equipo_id, (t / ${paso}) * ${paso}, ROUND(AVG(cpu)), ROUND(AVG(ram)), MAX(disco), 1 FROM metricas
       WHERE resumen = 0 AND t < ? GROUP BY equipo_id, t / ${paso}`).run(corte);
    q('DELETE FROM metricas WHERE resumen = 0 AND t < ?').run(corte);
    q(`INSERT INTO trafico (equipo_id, t, interfaz, rx, tx, rx_max, tx_max, resumen)
       SELECT equipo_id, (t / ${paso}) * ${paso}, interfaz, ROUND(AVG(rx)), ROUND(AVG(tx)), MAX(rx_max), MAX(tx_max), 1 FROM trafico
       WHERE resumen = 0 AND t < ? GROUP BY equipo_id, interfaz, t / ${paso}`).run(corte);
    q('DELETE FROM trafico WHERE resumen = 0 AND t < ?').run(corte);
    const viejo = Date.now() - 400 * DIA;
    q('DELETE FROM metricas WHERE t < ?').run(viejo);
    q('DELETE FROM trafico WHERE t < ?').run(viejo);
    q('DELETE FROM eventos WHERE t < ?').run(viejo);
    q('DELETE FROM sesiones WHERE inicio < ? AND fin IS NOT NULL').run(viejo);
  });
}

module.exports = {
  set alBorrarEquipo(fn) { alBorrarEquipo = fn; },
  INTERVALO_AGENTE, grupos, renombrarGrupo, borrarGrupo, crearCliente, editarCliente, borrarCliente, nuevaClave, cliente, clientes,
  equipo, editarEquipo, borrarEquipo, arrancar, recibir, vigilar, alCambiar, estado, estadoDe, vivo, vistaEquipo,
  visibles, puedeVer, metricas, trafico, sucesosEquipo, historialSesiones, agenteDe, crearRouter, renombrarRouter, actualizarRouter, routerSinRespuesta, wansDe, eventosRecientes, mantenimiento, evento
};
