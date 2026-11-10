'use strict';
// Clientes, equipos, informes de los agentes, estado en vivo e historial.
const { q, transaccion, ajustes, compactar } = require('./db');
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
// Sin la columna datos (el último informe en JSON, que puede pesar varios KB): para eso está el estado en memoria
const equipo = id => q('SELECT id, cliente_id, tipo, nombre, alias, creado, ultimo_contacto, version_agente, ip, intervalo, config, sede, instalacion, desinstalado FROM equipos WHERE id = ?').get(id);
function editarEquipo(id, { alias, cliente_id, sede }) {
  const e = equipo(id); if (!e) throw new Error('Ese equipo ya no existe.');
  if (cliente_id != null && cliente_id !== e.cliente_id) {
    if (!cliente(cliente_id)) throw new Error('Ese cliente no existe.');
    if (q('SELECT id FROM equipos WHERE cliente_id = ? AND tipo = ? AND nombre = ?').get(cliente_id, e.tipo, e.nombre))
      throw new Error(`Ese cliente ya tiene un equipo llamado ${e.nombre}.`);
    q('UPDATE equipos SET cliente_id = ? WHERE id = ?').run(cliente_id, id);
    // El agente sigue usando la clave del cliente anterior: en su próximo informe recibe la del nuevo
    if (esAgente(e.tipo)) {
      q('DELETE FROM traslados WHERE equipo_id = ?').run(id);
      q('INSERT OR REPLACE INTO traslados (cliente_origen, nombre, equipo_id, desde) VALUES (?, ?, ?, ?)').run(e.cliente_id, e.nombre, id, Date.now());
      q('DELETE FROM bajas WHERE cliente_id = ? AND nombre = ?').run(cliente_id, e.nombre);
    }
  }
  if (alias != null) q('UPDATE equipos SET alias = ? WHERE id = ?').run(String(alias).trim().slice(0, 60), id);
  // Sede dentro del mismo cliente (opcional): solo una etiqueta para agrupar sus equipos
  if (sede !== undefined) q('UPDATE equipos SET sede = ? WHERE id = ?').run(String(sede || '').trim().replace(/\s+/g, ' ').slice(0, 60) || null, id);
  cargarVivo(id);
}
function borrarEquipo(id) {
  const e = equipo(id);
  // Un servidor quitado del panel no vuelve a aparecer solo: su agente recibe la orden de desinstalarse.
  // Si se vuelve a instalar (instalación nueva), aparece otra vez.
  if (e && esAgente(e.tipo) && !e.desinstalado) q('INSERT OR REPLACE INTO bajas (cliente_id, nombre, instalacion, desde) VALUES (?, ?, ?, ?)').run(e.cliente_id, e.nombre, e.instalacion || '', Date.now());
  q('DELETE FROM traslados WHERE equipo_id = ?').run(id);
  q('DELETE FROM apps_personal WHERE equipo_id = ?').run(id);
  q('DELETE FROM equipos WHERE id = ?').run(id); vivo.delete(id); sucios.delete(id); require('./sonda').olvidar(id);
}

// ---------------------------------------------------------------- estado en memoria
// Por equipo: la fila de la base, el último informe y la última hora de CPU y memoria (para las miniaturas)
const vivo = new Map();
// El último informe y la hora del último contacto se guardan en la base como mucho cada minuto (y siempre al detener NodeCat):
// la memoria manda. Así un router que se lee cada 3-15 s no reescribe su JSON completo en cada lectura.
const GUARDAR_CADA = 60000;
const sucios = new Set();
function guardarPendientes() {
  if (!sucios.size) return;
  const ids = [...sucios]; sucios.clear();
  const upd = q('UPDATE equipos SET ultimo_contacto = ?, version_agente = ?, ip = ?, intervalo = ?, datos = ? WHERE id = ?');
  transaccion(() => { for (const id of ids) { const v = vivo.get(id); if (v) upd.run(v.ultimo_contacto, v.version_agente, v.ip, v.intervalo, v.datos ? JSON.stringify(v.datos) : null, id); } });
}
function guardarUno(id) {
  if (!sucios.delete(id)) return;
  const v = vivo.get(id);
  if (v) q('UPDATE equipos SET ultimo_contacto = ?, version_agente = ?, ip = ?, intervalo = ?, datos = ? WHERE id = ?').run(v.ultimo_contacto, v.version_agente, v.ip, v.intervalo, v.datos ? JSON.stringify(v.datos) : null, id);
}
function cargarVivo(id) {
  guardarUno(id);   // lo pendiente primero, para no volver a leer de la base algo más viejo que la memoria
  const e = q('SELECT * FROM equipos WHERE id = ?').get(id);
  if (!e) { vivo.delete(id); return; }
  const previo = vivo.get(id);
  let sonda = null; if (!esAgente(e.tipo) && e.config) { try { sonda = JSON.parse(e.config).sonda || null; } catch { } }
  vivo.set(id, { ...e, config: undefined, sonda, datos: e.datos ? JSON.parse(e.datos) : null, hora: previo ? previo.hora : [], ultimaMuestra: previo ? previo.ultimaMuestra : 0, caido: previo ? previo.caido : null, errorConexion: previo ? previo.errorConexion : null });
}
function arrancar() {
  for (const { id } of q('SELECT id FROM equipos').all()) cargarVivo(id);
  const desde = Date.now() - HORA;
  // Por equipo, para usar la clave (equipo_id, t) en lugar de recorrer toda la tabla
  const ultimaHora = q('SELECT t, cpu, ram FROM metricas WHERE equipo_id = ? AND t >= ? AND resumen = 0 ORDER BY t');
  for (const v of vivo.values()) for (const m of ultimaHora.all(v.id, desde)) { v.hora.push({ t: m.t, cpu: m.cpu, ram: m.ram }); v.ultimaMuestra = m.t; }
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
const BYTES = 1e17;   // tamaños en bytes (VM, discos, copias)
const num = (x, min = 0, max = 1e9) => (typeof x === 'number' && isFinite(x)) ? Math.min(max, Math.max(min, x)) : null;
const txt = (x, max = 200) => x == null ? '' : String(x).slice(0, max);

// Equipos con agente (servidores): Windows (con o sin Hyper-V), Linux y Proxmox
const AGENTES = ['windows', 'linux', 'proxmox'];
// Versión del agente de Linux que se ofrece (los agentes instalados se actualizan solos a ella)
const VERSION_LINUX = (() => { try { const m = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'agente', 'nodecat-agente.py'), 'utf8').match(/^VERSION = '([\w.-]+)'/m); return m ? m[1] : null; } catch { return null; } })();
const esAgente = tipo => AGENTES.includes(tipo);
const EN_AGENTES = "tipo IN ('windows', 'linux', 'proxmox')";

// Detalles de Proxmox (apps, copias, nodo): solo los campos conocidos, con límites
function limpiarPve(p) {
  if (!p || typeof p !== 'object') return null;
  const arr = (x, n) => Array.isArray(x) ? x.slice(0, n) : [];
  const o = {};
  if (Array.isArray(p.apps)) o.apps = arr(p.apps, 500).map(a => ({
    id: txt(a.id, 20), nombre: txt(a.nombre, 120), tipo: txt(a.tipo, 8), estado: txt(a.estado, 20), ips: arr(a.ips, 4).map(x => txt(x, 45)),
    so: txt(a.so, 30), arranqueAuto: !!a.arranqueAuto, app: a.app ? txt(a.app, 60) : null, categoria: a.categoria ? txt(a.categoria, 40) : null,
    url: /^https?:\/\//i.test(a.url || '') ? txt(a.url, 300) : null, etiquetas: arr(a.etiquetas, 8).map(x => txt(x, 30)), notas: txt(a.notas, 300)
  }));
  else if (p.apps && p.apps.error) o.apps = { error: txt(p.apps.error, 300) };
  if (p.copias && typeof p.copias === 'object') {
    const c = p.copias;
    o.copias = c.error ? { error: txt(c.error, 300) } : {
      archivos: arr(c.archivos, 400).map(a => ({ vmid: txt(a.vmid, 20), fecha: num(a.fecha, 0, 9e15), tamano: num(a.tamano, 0, BYTES), almacen: txt(a.almacen, 60), formato: txt(a.formato, 20), notas: txt(a.notas, 120), protegida: !!a.protegida, verificada: a.verificada ? txt(a.verificada, 20) : null })),
      trabajos: arr(c.trabajos, 40).map(j => ({ id: txt(j.id, 60), horario: txt(j.horario, 60), almacen: txt(j.almacen, 60), activo: !!j.activo, que: txt(String(j.que ?? ''), 200), modo: txt(j.modo, 20), comentario: txt(j.comentario, 120), proxima: num(j.proxima, 0, 9e15) })),
      tareas: arr(c.tareas, 30).map(t => ({ vmid: txt(t.vmid, 20), inicio: num(t.inicio, 0, 9e15), fin: num(t.fin, 0, 9e15), estado: txt(t.estado, 200), usuario: txt(t.usuario, 60) })),
      almacenes: arr(c.almacenes, 30).map(x => txt(x, 60))
    };
  }
  if (p.nodo && typeof p.nodo === 'object') {
    const n = p.nodo;
    o.nodo = n.error ? { error: txt(n.error, 300) } : {
      cpuModelo: txt(n.cpuModelo, 120), sockets: num(n.sockets, 0, 64), hilos: num(n.hilos, 0, 4096), kernel: txt(n.kernel, 120), pve: txt(n.pve, 80),
      carga: arr(n.carga, 3).map(x => num(x, 0, 1e4)), swapTotal: num(n.swapTotal, 0, BYTES), swapUsado: num(n.swapUsado, 0, BYTES), ksm: num(n.ksm, 0, BYTES), arranque: txt(n.arranque, 20),
      actualizaciones: num(n.actualizaciones, 0, 1e5),
      cluster: n.cluster ? { nombre: txt(n.cluster.nombre, 60), quorum: !!n.cluster.quorum, nodos: arr(n.cluster.nodos, 64).map(x => ({ nombre: txt(x.nombre, 63), online: !!x.online })) } : null,
      discos: arr(n.discos, 64).map(d => ({ disco: txt(d.disco, 60), modelo: txt(d.modelo, 80), tamano: num(d.tamano, 0, BYTES), tipo: txt(d.tipo, 20), salud: txt(d.salud, 30), desgaste: d.desgaste === 'N/A' ? null : num(d.desgaste, 0, 100), uso: txt(d.uso, 40), serie: txt(d.serie, 60),
        temperatura: d.temperatura == null ? null : num(d.temperatura, -50, 200), ciclos: d.ciclos == null ? null : num(d.ciclos, 0, 1e9), horas: d.horas == null ? null : num(d.horas, 0, 1e7), crc: d.crc == null ? null : num(d.crc, 0, 1e12), smartOk: d.smartOk == null ? null : !!d.smartOk })),
      almacenes: arr(n.almacenes, 64).map(a => ({ nombre: txt(a.nombre, 60), tipo: txt(a.tipo, 30), contenido: txt(a.contenido, 120), activo: !!a.activo, compartido: !!a.compartido, usado: num(a.usado, 0, BYTES), total: num(a.total, 0, BYTES), disponible: a.disponible == null ? null : num(a.disponible, 0, BYTES) }))
    };
  }
  if (p.red && typeof p.red === 'object' && !p.red.error) {
    const r = p.red;
    o.red = {
      interfaces: arr(r.interfaces, 80).map(i => ({ nombre: txt(i.nombre, 30), tipo: txt(i.tipo, 12), estado: txt(i.estado, 12), velocidad: num(i.velocidad, 0, 1e7), duplex: i.duplex ? txt(i.duplex, 10) : null,
        mtu: num(i.mtu, 0, 70000), mac: txt(i.mac, 20), ips: arr(i.ips, 6).map(x => txt(x, 50)), puente: i.puente ? txt(i.puente, 30) : null, puertos: arr(i.puertos, 40).map(x => txt(x, 30)),
        vmid: i.vmid ? txt(i.vmid, 12) : null, rxTotal: num(i.rxTotal, 0, BYTES), txTotal: num(i.txTotal, 0, BYTES), descartados: num(i.descartados, 0, BYTES), errores: num(i.errores, 0, BYTES) })),
      puertaEnlace: r.puertaEnlace ? txt(r.puertaEnlace, 45) : null, dns: arr(r.dns, 3).map(x => txt(x, 45)), dominio: r.dominio ? txt(r.dominio, 80) : null, host: txt(r.host, 63),
      latencia: r.latencia ? { destino: txt(r.latencia.destino, 45), ms: num(r.latencia.ms, 0, 1e5), max: num(r.latencia.max, 0, 1e5), perdida: num(r.latencia.perdida, 0, 100) } : null
    };
  }
  return o;
}

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
    })).filter(s => s.usuario),
    // Hipervisor (Proxmox o Hyper-V): sus máquinas virtuales y contenedores, y los almacenamientos
    nucleos: num(c.nucleos, 0, 4096), carga: num(c.carga, 0, 1e4), temperatura: num(c.temperatura, -50, 150),
    ramCache: num(c.ramCache), cpuUsuario: num(c.cpuUsuario, 0, 100), cpuSistema: num(c.cpuSistema, 0, 100),
    red: (Array.isArray(c.red) ? c.red : []).slice(0, 30).map(x => ({ nombre: txt(x.nombre, 40), rx: num(x.rx, 0, 1e13), tx: num(x.tx, 0, 1e13), activa: x.activa !== false })),
    hipervisor: c.hipervisor ? txt(c.hipervisor, 40) : null,
    vms: (Array.isArray(c.vms) ? c.vms : []).slice(0, 1000).map(x => ({
      id: txt(x.id, 60), nombre: txt(x.nombre, 120), tipo: txt(x.tipo, 12), estado: txt(x.estado, 20), nodo: txt(x.nodo, 63),
      cpu: num(x.cpu, 0, 100), cpus: num(x.cpus, 0, 4096), ram: num(x.ram, 0, BYTES), ramMax: num(x.ramMax, 0, BYTES), disco: num(x.disco, 0, BYTES), discoMax: num(x.discoMax, 0, BYTES),
      uptime: num(x.uptime, 0, 1e10), netin: num(x.netin, 0, BYTES), netout: num(x.netout, 0, BYTES),
      diskread: num(x.diskread, 0, BYTES), diskwrite: num(x.diskwrite, 0, BYTES), etiquetas: (Array.isArray(x.etiquetas) ? x.etiquetas : []).slice(0, 8).map(t => txt(t, 30))
    })).filter(v => v.nombre || v.id),
    errorVms: c.errorVms ? txt(c.errorVms, 400) : null,
    pve: limpiarPve(c.pve)
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
  const plataforma = ['linux', 'proxmox'].includes(c.plataforma) ? c.plataforma : 'windows';
  const ahora = Date.now();
  // Informes atrasados (el agente los guardó mientras no había conexión): solo completan el historial
  if (d.hora && ahora - d.hora > 120000 && ahora - d.hora < 2 * DIA) {
    const f = q(`SELECT id FROM equipos WHERE cliente_id = ? AND ${EN_AGENTES} AND nombre = ?`).get(cli.id, nombre);
    if (f && (d.cpu != null || d.ramPct != null) && !q('SELECT 1 FROM metricas WHERE equipo_id = ? AND t BETWEEN ? AND ?').get(f.id, d.hora - 50000, d.hora + 50000)) {
      const disco = d.discos.length ? Math.max(...d.discos.map(x => x.pct || 0)) : null;
      q('INSERT OR IGNORE INTO metricas (equipo_id, t, cpu, ram, disco) VALUES (?, ?, ?, ?, ?)').run(f.id, Math.round(d.hora), d.cpu, d.ramPct, disco);
    }
    return { ok: true, intervalo: INTERVALO_AGENTE, servidor: nombre, cliente: cli.nombre, atrasado: true };
  }
  const intervalo = Math.round(num(c.intervalo, 5, 3600) || INTERVALO_AGENTE);
  const instalacion = txt(c.instalacion, 40).trim();

  let fila = q(`SELECT id, cliente_id FROM equipos WHERE cliente_id = ? AND ${EN_AGENTES} AND nombre = ?`).get(cli.id, nombre);
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
    const r = q('INSERT INTO equipos (cliente_id, tipo, nombre, creado) VALUES (?, ?, ?, ?)').run(cli.id, plataforma, nombre, ahora);
    fila = { id: Number(r.lastInsertRowid) }; nuevo = true;
    log(`Nuevo equipo de ${cli.nombre}: ${nombre} (${ip}).`);
  }
  const id = fila.id;
  const previo = vivo.get(id);
  const antes = previo && previo.datos;

  // Proxmox: el agente 1.2 solo manda las partes de "pve" que cambiaron; las demás se conservan del informe anterior
  if (d.pve && antes && antes.pve && c.pve && c.pve.parcial) d.pve = { ...antes.pve, ...d.pve };
  // Cambios de fondo (equipo nuevo, otra plataforma, reinstalación): se guardan al momento y se recarga la fila.
  // Lo de cada informe (datos, hora, IP) queda en memoria y se guarda con el resto cada minuto.
  const deFondo = !previo || nuevo || previo.tipo !== plataforma || previo.desinstalado || (instalacion && instalacion !== previo.instalacion);
  transaccion(() => {
    if (deFondo) {
      q('UPDATE equipos SET tipo = ? WHERE id = ? AND tipo != ?').run(plataforma, id, plataforma);   // p. ej. un Linux que pasó a ser Proxmox
      q('UPDATE equipos SET ultimo_contacto = ?, version_agente = ?, ip = ?, intervalo = ?, datos = ?, desinstalado = NULL, instalacion = COALESCE(NULLIF(?, \'\'), instalacion) WHERE id = ?')
        .run(ahora, txt(c.version, 20), txt(ip, 60), intervalo, JSON.stringify(d), instalacion, id);
    }
    if (previo && previo.desinstalado) evento(id, 'nuevo', 'El agente se volvió a instalar.', ahora);
    if (nuevo) evento(id, 'nuevo', `El agente empezó a informar desde ${ip}.`, ahora);
    if (antes && d.arranque && antes.arranque && Math.abs(d.arranque - antes.arranque) > 120000 && d.arranque > antes.arranque)
      evento(id, 'reinicio', 'El equipo se reinició.', d.arranque);
    if (!d.errorSesiones) seguirSesiones(id, d.sesiones, ahora);
  });
  if (deFondo) cargarVivo(id);
  else { Object.assign(previo, { ultimo_contacto: ahora, version_agente: txt(c.version, 20), ip: txt(ip, 60), intervalo, datos: d }); sucios.add(id); }
  const v = vivo.get(id);
  // Una muestra por minuto como mucho
  if (ahora - v.ultimaMuestra >= 55000 && (d.cpu != null || d.ramPct != null || d.discos.length)) {
    const disco = d.discos.length ? Math.max(...d.discos.map(x => x.pct || 0)) : null;
    q('INSERT OR IGNORE INTO metricas (equipo_id, t, cpu, ram, disco) VALUES (?, ?, ?, ?, ?)').run(id, ahora, d.cpu, d.ramPct, disco);
    v.hora.push({ t: ahora, cpu: d.cpu, ram: d.ramPct });
    v.ultimaMuestra = ahora;
    // Tráfico de red del servidor: una fila por minuto e interfaz (sirve para los gráficos y los totales de 24 h)
    if (d.red.length) {
      const ins = q('INSERT OR IGNORE INTO trafico (equipo_id, t, interfaz, rx, tx, rx_max, tx_max) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const i of d.red.slice(0, 12)) if (i.rx != null) ins.run(id, ahora, i.nombre, i.rx, i.tx, i.rx, i.tx);
    }
  }
  v.hora = v.hora.filter(m => m.t >= ahora - HORA);
  if (v.caido) volvio(v, ahora);
  return { ok: true, intervalo: INTERVALO_AGENTE, servidor: nombre, cliente: clienteNuevo || cli.nombre, sonda: require('./sonda').enUso(id), ...(claveNueva ? { clave: claveNueva } : {}), ...(plataforma !== 'windows' && VERSION_LINUX ? { agenteLinux: VERSION_LINUX } : {}) };
}

/** La sonda: identifica al agente por su clave y su nombre de equipo. */
function agenteDe(clave, nombre) {
  const cli = clave && q('SELECT id FROM clientes WHERE clave = ?').get(String(clave));
  if (!cli) { const e = new Error('La clave del agente no es válida.'); e.status = 403; throw e; }
  const n = txt(nombre, 63).trim().toUpperCase();
  const f = q(`SELECT id FROM equipos WHERE cliente_id = ? AND ${EN_AGENTES} AND nombre = ?`).get(cli.id, n)
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
    if (antes && d.arranque && antes.arranque && d.arranque - antes.arranque > 120000) evento(id, 'reinicio', 'El router se reinició.', d.arranque);
    // Cada enlace WAN por separado (un FortiGate con SD-WAN puede tener varios)
    for (const wn of wansDe(d)) {
      const wa = wansDe(antes).find(x => x.interfaz === wn.interfaz);
      if (wa && wa.activa !== wn.activa)
        evento(id, wn.activa ? 'wan-vuelta' : 'wan-caida', wn.activa ? `El enlace WAN (${wn.interfaz}) volvió.` : `El enlace WAN (${wn.interfaz}) se cayó.`, ahora);
    }
  });
  // En memoria; a la base, con el guardado de cada minuto
  const v = previo;
  Object.assign(v, { ultimo_contacto: ahora, version_agente: version || '', ip: ip || '', intervalo: 30, datos: d, sinRespuesta: false });
  sucios.add(id);
  v.errorConexion = null;
  if (ahora - v.ultimaMuestra >= 55000 && d.cpu != null) {
    q('INSERT OR IGNORE INTO metricas (equipo_id, t, cpu, ram, disco) VALUES (?, ?, ?, ?, NULL)').run(id, ahora, d.cpu, d.ramPct);
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
  const abiertas = q('SELECT id, sid, usuario, estado, origen FROM sesiones WHERE equipo_id = ? AND fin IS NULL').all(id);
  const clave = (u, s) => `${String(u).toLowerCase()}|${s}`;
  const vistas = new Map(sesiones.map(s => [clave(s.usuario, s.id), s]));
  for (const a of abiertas) {
    const s = vistas.get(clave(a.usuario, a.sid));
    if (!s) { q('UPDATE sesiones SET fin = ? WHERE id = ?').run(ahora, a.id); continue; }
    vistas.delete(clave(a.usuario, a.sid));
    const desconecta = a.estado === 'activa' && s.estado === 'desconectada' ? 1 : 0;
    // Solo si algo cambió: la hora del último informe ya está en el equipo (al caer, las sesiones se cierran con ella)
    if (s.estado === a.estado && (!s.equipo || s.equipo === a.origen)) continue;
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
      q('UPDATE sesiones SET fin = MAX(COALESCE(visto, inicio), ?) WHERE equipo_id = ? AND fin IS NULL').run(v.ultimo_contacto, v.id);
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
    red: esAgente(v.tipo) ? null : d.red || null, errorConexion: v.errorConexion || null, sonda: v.sonda || null, sede: v.sede || null,
    interfaces: esAgente(v.tipo) ? d.red || [] : undefined, nucleos: d.nucleos ?? null, carga: d.carga ?? null, temperatura: d.temperatura ?? null,
    ramCache: d.ramCache ?? null, cpuUsuario: d.cpuUsuario ?? null, cpuSistema: d.cpuSistema ?? null,
    hipervisor: d.hipervisor || null, vms: d.vms || [], errorVms: d.errorVms || null, conPve: !!d.pve,
    historial: v.hora
  };
}
/** Detalles de Proxmox de un equipo (aparte de /api/estado porque pueden ser grandes). */
function detallesPve(id) { const v = vivo.get(id); return (v && v.datos && v.datos.pve) || {}; }
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
  const interfaces = interfacesDe(equipoId, desde);
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

// Interfaces con tráfico guardado de un equipo desde una hora: se salta de una interfaz a la siguiente por la clave
// (equipo_id, interfaz, t) en lugar de recorrer todas las filas del equipo
function interfacesDe(equipoId, desde = 0) {
  const sig = q('SELECT interfaz FROM trafico WHERE equipo_id = ? AND interfaz > ? ORDER BY interfaz LIMIT 1');
  const hay = q('SELECT 1 FROM trafico WHERE equipo_id = ? AND interfaz = ? AND t >= ? LIMIT 1');
  const l = []; let r = sig.get(equipoId, '');
  for (let n = 0; r && n < 2000; n++) { if (!desde || hay.get(equipoId, r.interfaz, desde)) l.push(r.interfaz); r = sig.get(equipoId, r.interfaz); }
  return l;
}

// ---------------------------------------------------------------- mantenimiento
// Detalle por minuto durante 7 días; después, promedios de 5 minutos durante 400 días.
// Va equipo por equipo (e interfaz por interfaz) por la clave de cada tabla, y solo mira la franja desde el corte anterior:
// así no recorre las tablas enteras cada hora. El corte cae en una frontera de 5 minutos para no partir un bloque en dos.
function mantenimiento() {
  const paso = 300000, corte = Math.floor((Date.now() - 7 * DIA) / paso) * paso, viejo = Date.now() - 400 * DIA;
  const previo = Number(ajustes.leer('mantenimientoCorte', 0)) || 0;
  const desde = previo ? previo - DIA : 0;     // un día de margen; la primera vez, desde el principio
  const ids = q('SELECT id FROM equipos').all().map(r => r.id);
  const resM = q(`INSERT OR IGNORE INTO metricas (equipo_id, t, cpu, ram, disco, resumen)
    SELECT equipo_id, (t / ${paso}) * ${paso}, ROUND(AVG(cpu)), ROUND(AVG(ram)), MAX(disco), 1 FROM metricas
    WHERE equipo_id = ? AND t >= ? AND t < ? AND resumen = 0 GROUP BY t / ${paso}`);
  const borM = q('DELETE FROM metricas WHERE equipo_id = ? AND t >= ? AND t < ? AND resumen = 0');
  const resT = q(`INSERT OR IGNORE INTO trafico (equipo_id, t, interfaz, rx, tx, rx_max, tx_max, resumen)
    SELECT equipo_id, (t / ${paso}) * ${paso}, interfaz, ROUND(AVG(rx)), ROUND(AVG(tx)), MAX(rx_max), MAX(tx_max), 1 FROM trafico
    WHERE equipo_id = ? AND interfaz = ? AND t >= ? AND t < ? AND resumen = 0 GROUP BY t / ${paso}`);
  const borT = q('DELETE FROM trafico WHERE equipo_id = ? AND interfaz = ? AND t >= ? AND t < ? AND resumen = 0');
  const viejoM = q('DELETE FROM metricas WHERE equipo_id = ? AND t < ?');
  const viejoT = q('DELETE FROM trafico WHERE equipo_id = ? AND interfaz = ? AND t < ?');
  for (const id of ids) {
    transaccion(() => {
      resM.run(id, desde, corte); borM.run(id, desde, corte); viejoM.run(id, viejo);
      for (const i of interfacesDe(id)) { resT.run(id, i, desde, corte); borT.run(id, i, desde, corte); viejoT.run(id, i, viejo); }
    });
  }
  transaccion(() => {
    q('DELETE FROM eventos WHERE t < ?').run(viejo);
    q('DELETE FROM sesiones WHERE inicio < ? AND fin IS NOT NULL').run(viejo);
  });
  ajustes.guardar('mantenimientoCorte', corte);
  compactar();
}

module.exports = {
  AGENTES, esAgente, detallesPve,
  set alBorrarEquipo(fn) { alBorrarEquipo = fn; },
  INTERVALO_AGENTE, GUARDAR_CADA, guardarPendientes, grupos, renombrarGrupo, borrarGrupo, crearCliente, editarCliente, borrarCliente, nuevaClave, cliente, clientes,
  equipo, editarEquipo, borrarEquipo, arrancar, recibir, vigilar, alCambiar, estado, estadoDe, vivo, vistaEquipo,
  visibles, puedeVer, metricas, trafico, sucesosEquipo, historialSesiones, agenteDe, crearRouter, renombrarRouter, actualizarRouter, routerSinRespuesta, wansDe, eventosRecientes, mantenimiento, evento
};
