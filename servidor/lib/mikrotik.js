'use strict';
// Routers MikroTik: consulta periódica por la API (solo lectura), tráfico en vivo, historial y secciones bajo demanda.
const { q } = require('./db');
const flota = require('./flota');
const { Conexion, segundos } = require('./routeros');
const { cifrar, descifrar } = require('./secreto');
const { log } = require('./util');

const RAPIDO = 3000, LENTO = 15000, REINTENTO = 5000, CAIDO = 10000;      // cada 3 s mientras alguien mira el router; si no, cada 15 s
const VENTANA = 6 * 60 * 1000;           // serie en vivo: últimos 6 minutos
const routers = new Map();
let simulador = null;                    // modo demo: genera respuestas en lugar de conectar

// ---------------------------------------------------------------- configuración
function leerConfig(id) {
  const r = q("SELECT config FROM equipos WHERE id = ? AND tipo = 'mikrotik'").get(id);
  return r && r.config ? JSON.parse(r.config) : null;
}
function validar(c, previa) {
  const host = String(c.host || '').trim();
  if (!/^[A-Za-z0-9.\-:\[\]]{1,253}$/.test(host)) throw new Error('Escribe la IP o el nombre del router.');
  const ssl = !!c.ssl;
  const puerto = Number(c.puerto || (ssl ? 8729 : 8728));
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error('El puerto no es válido.');
  const usuario = String(c.usuario || '').trim();
  if (!usuario) throw new Error('Escribe el usuario de la API.');
  const clave = c.clave ? String(c.clave) : (previa ? descifrar(previa.clave) : '');
  const wan = String(c.wan || '').trim().slice(0, 64);
  const ping = String(c.ping || '').trim().slice(0, 253);
  if (ping && !/^[A-Za-z0-9.\-:]+$/.test(ping)) throw new Error('El destino del ping debe ser una IP o un nombre.');
  return { host, puerto, ssl, usuario, clave, wan, ping };
}
const guardable = c => ({ host: c.host, puerto: c.puerto, ssl: c.ssl, usuario: c.usuario, clave: cifrar(c.clave), wan: c.wan, ping: c.ping, demo: c.demo, perfil: c.perfil });
function publica(c) { return c ? { host: c.host, puerto: c.puerto, ssl: c.ssl, usuario: c.usuario, wan: c.wan || '', ping: c.ping || '', claveGuardada: !!c.clave, demo: !!c.demo } : null; }

async function probar(datos, id) {
  const c = validar(datos, id ? leerConfig(id) : null);
  const con = new Conexion(c);
  try {
    await con.conectar();
    const [res] = await con.imprimir('/system/resource/print');
    const [ide] = await con.imprimir('/system/identity/print');
    return { identidad: ide && ide.name, version: res && res.version, modelo: res && (res['board-name'] || '') };
  } finally { con.cerrar(); }
}

function crear(clienteId, nombre, datos) {
  const c = validar(datos);
  const id = flota.crearRouter(clienteId, nombre, guardable(c));
  iniciar(id);
  return id;
}
function editar(id, nombre, datos) {
  const previa = leerConfig(id); if (!previa) throw new Error('Ese router no existe.');
  if (nombre) flota.renombrarRouter(id, nombre);
  if (previa.demo) {
    q('UPDATE equipos SET config = ? WHERE id = ?').run(JSON.stringify({ ...previa, ping: String(datos.ping || '').trim().slice(0, 253) }), id);
  } else {
    const c = validar(datos, previa);
    q('UPDATE equipos SET config = ? WHERE id = ?').run(JSON.stringify(guardable(c)), id);
  }
  quitar(id); iniciar(id);
}
function quitar(id) {
  const r = routers.get(id); if (!r) return;
  clearTimeout(r.temporizador); if (r.con) r.con.cerrar();
  routers.delete(id);
}

// ---------------------------------------------------------------- bucle de consulta
function iniciar(id) {
  const c = leerConfig(id); if (!c) return;
  const r = { id, c, con: null, observado: 0, lat: new Map(), latT: 0, prev: new Map(), serie: new Map(), acum: new Map(), minuto: 0, lento: {}, cache: new Map(), ocupado: false, ultimoError: null };
  if (c.clave) c.clave = descifrar(c.clave);
  routers.set(id, r);
  r.temporizador = setTimeout(() => ciclo(r), 500 + Math.random() * 2000);
}
function programar(r) {
  if (!routers.has(r.id)) return;
  // Tras un fallo se reintenta enseguida para confirmar la caída sin esperar al siguiente ciclo
  const espera = r.fallos === 1 ? REINTENTO : r.fallos > 1 ? CAIDO : Date.now() - r.observado < 20000 ? RAPIDO : LENTO;
  r.temporizador = setTimeout(() => ciclo(r), espera);
}
async function ciclo(r) {
  if (r.ocupado) return programar(r);
  r.ocupado = true;
  try { await sondear(r); r.fallos = 0; }
  catch (e) {
    if (r.con) { r.con.cerrar(); r.con = null; }
    r.fallos = (r.fallos || 0) + 1;
    const v = flota.vivo.get(r.id);
    if (v) v.errorConexion = e.message;
    if (r.fallos >= 2) flota.routerSinRespuesta(r.id, e.message);
    if (r.ultimoError !== e.message) { log(`Router ${v ? v.nombre : r.id}: ${e.message}`); r.ultimoError = e.message; }
  } finally { r.ocupado = false; programar(r); }
}
async function conexion(r) {
  if (r.c.demo) return simulador.conexion(r.id);
  if (r.con && r.con.lista) return r.con;
  if (r.con) r.con.cerrar();
  r.con = new Conexion({ ...r.c, tiempo: 6000 });
  await r.con.conectar();
  if (r.ultimoError) { log(`Router ${r.c.host}: conectado de nuevo.`); r.ultimoError = null; }
  return r.con;
}
const num = x => x == null || x === '' ? null : Number(x);
const si = x => x === 'true' || x === 'yes';
const opcional = async p => { try { return await p; } catch (e) { if (e.tipo === 'trap') return null; throw e; } };

async function sondear(r) {
  const con = await conexion(r);
  const ahora = Date.now(), L = r.lento;
  const [res] = await con.imprimir('/system/resource/print', { proplist: ['cpu-load', 'free-memory', 'total-memory', 'uptime', 'version', 'board-name', 'architecture-name', 'free-hdd-space', 'total-hdd-space'] });
  const ifs = await con.imprimir('/interface/print', { proplist: ['name', 'type', 'running', 'disabled', 'rx-byte', 'tx-byte', 'comment', 'mac-address'] });
  // Lo que cambia poco, cada minuto
  if (!L.t || ahora - L.t > 60000) {
    const [ide] = await con.imprimir('/system/identity/print');
    const salud = await opcional(con.imprimir('/system/health/print'));
    const rutas = await opcional(con.imprimir('/ip/route/print', { proplist: ['dst-address', 'gateway', 'immediate-gw', 'gateway-status', 'active', 'distance'], filtros: { 'dst-address': '0.0.0.0/0' } }));
    const conex = await opcional(con.ejecutar(['/ip/firewall/connection/print', '=count-only=']));
    const leases = await opcional(con.imprimir('/ip/dhcp-server/lease/print', { proplist: ['status'] }));
    const wg = await opcional(con.imprimir('/interface/wireguard/peers/print', { proplist: ['last-handshake', 'disabled'] }));
    const ppp = await opcional(con.imprimir('/ppp/active/print', { proplist: ['name'] }));
    Object.assign(L, { t: ahora, identidad: ide && ide.name, salud: leerSalud(salud), wanAuto: wanDeRutas(rutas), gw: puertaDeEnlace(rutas), conexiones: conex ? num(conex.done.ret) : null,
      dhcp: leases ? leases.filter(x => x.status === 'bound').length : null, vpn: (wg ? wg.filter(p => !si(p.disabled) && segundos(p['last-handshake']) != null && segundos(p['last-handshake']) < 180).length : 0) + (ppp ? ppp.length : 0),
      vpnTotal: (wg ? wg.filter(p => !si(p.disabled)).length : 0) + (ppp ? ppp.length : 0) });
  }

  // Tráfico: diferencia de contadores desde la consulta anterior
  const interfaces = [];
  for (const i of ifs) {
    const nombre = i.name, rxB = num(i['rx-byte']), txB = num(i['tx-byte']);
    const p = r.prev.get(nombre);
    let rx = null, tx = null;
    if (p && rxB != null && ahora > p.t) {
      const dt = (ahora - p.t) / 1000;
      if (rxB >= p.rx && txB >= p.tx) { rx = Math.round((rxB - p.rx) * 8 / dt); tx = Math.round((txB - p.tx) * 8 / dt); }
    }
    r.prev.set(nombre, { t: ahora, rx: rxB, tx: txB });
    const activa = si(i.running), deshabilitada = si(i.disabled);
    interfaces.push({ nombre, tipo: i.type || '', activa, deshabilitada, rx, tx, comentario: i.comment || '', mac: i['mac-address'] || '' });
    if (rx == null || deshabilitada) continue;
    let s = r.serie.get(nombre); if (!s) r.serie.set(nombre, s = []);
    s.push([ahora, rx, tx]);
    while (s.length && s[0][0] < ahora - VENTANA) s.shift();
    let a = r.acum.get(nombre); if (!a) r.acum.set(nombre, a = { rx: 0, tx: 0, n: 0, rxMax: 0, txMax: 0 });
    a.rx += rx; a.tx += tx; a.n++; a.rxMax = Math.max(a.rxMax, rx); a.txMax = Math.max(a.txMax, tx);
  }
  for (const k of [...r.serie.keys()]) if (!ifs.some(i => i.name === k)) r.serie.delete(k);
  // Historial: una fila por interfaz y minuto (solo las que tienen tráfico o están arriba)
  const min = Math.floor(ahora / 60000);
  if (r.minuto && min !== r.minuto) {
    const ins = q('INSERT INTO trafico (equipo_id, t, interfaz, rx, tx, rx_max, tx_max) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let n = 0;
    for (const [nombre, a] of r.acum) {
      if (!a.n || n >= 48) continue;
      const it = interfaces.find(x => x.nombre === nombre);
      if (!it || (!it.activa && !a.rx && !a.tx)) continue;
      ins.run(r.id, r.minuto * 60000, nombre, Math.round(a.rx / a.n), Math.round(a.tx / a.n), a.rxMax, a.txMax); n++;
    }
    r.acum.clear();
  }
  r.minuto = min;

  if (ahora - r.latT > (ahora - r.observado < 20000 ? 10000 : 30000)) { r.latT = ahora; await medirLatencia(r, con, L.gw); }
  const latencia = [...r.lat.values()].map(x => ({ nombre: x.nombre, ip: x.ip, ms: x.ms, perdida: x.perdida, error: x.error || null }));

  const wanNombre = r.c.wan || L.wanAuto || '';
  const w = interfaces.find(x => x.nombre === wanNombre);
  const total = num(res['total-memory']), libre = num(res['free-memory']);
  const hddT = num(res['total-hdd-space']), hddL = num(res['free-hdd-space']);
  const up = segundos(res.uptime);
  const version = String(res.version || '').replace(/\s*\(.*\)$/, '');
  const d = {
    cpu: num(res['cpu-load']), ramPct: total ? Math.round((total - libre) / total * 100) : null,
    ramTotal: total ? Math.round(total / 1048576) / 1024 : null, ramUsada: total ? Math.round((total - libre) / 1048576) / 1024 : null,
    so: `RouterOS ${version}${res['board-name'] ? ', ' + res['board-name'] : ''}`, arranque: up != null ? Math.round((ahora - up * 1000) / 10000) * 10000 : null,
    discos: hddT ? [{ unidad: 'Flash', etiqueta: '', total: Math.round(hddT / 1048576) / 1024, libre: Math.round(hddL / 1048576) / 1024, pct: Math.round((hddT - hddL) / hddT * 100) }] : [],
    sesiones: [],
    red: {
      identidad: L.identidad || '', modelo: res['board-name'] || '', arquitectura: res['architecture-name'] || '', version,
      temperatura: L.salud ? L.salud.temperatura : null, voltaje: L.salud ? L.salud.voltaje : null,
      conexiones: L.conexiones, dhcp: L.dhcp, vpn: L.vpn, vpnTotal: L.vpnTotal, latencia,
      wan: w ? { interfaz: w.nombre, activa: w.activa && !w.deshabilitada, rx: w.rx, tx: w.tx } : null,
      interfaces
    }
  };
  flota.actualizarRouter(r.id, d, r.c.demo ? '' : r.c.host, version);
}

// Ping desde el propio router (permiso "test" de la API): 3 paquetes a cada destino, en paralelo
const DESTINOS = [['Cloudflare', '1.1.1.1'], ['Google', '8.8.8.8']];
function ms(t) {
  if (!t) return null;
  let v = 0, ok = false;
  for (const [, n, u] of String(t).matchAll(/(\d+(?:\.\d+)?)(ms|us|s)/g)) { ok = true; v += Number(n) * ({ s: 1000, ms: 1, us: .001 })[u]; }
  return ok ? Math.round(v * 10) / 10 : null;
}
async function medirLatencia(r, con, gw) {
  const lista = [...DESTINOS];
  if (gw) lista.push(['Puerta de enlace', gw]);
  if (r.c.ping) lista.push([r.c.ping, r.c.ping]);
  const ahora = Date.now();
  await Promise.all(lista.map(async ([nombre, ip]) => {
    let x = r.lat.get(ip);
    if (!x) r.lat.set(ip, x = { nombre, ip, serie: [] });
    x.nombre = nombre;
    try {
      const { filas } = await con.ejecutar(['/ping', `=address=${ip}`, '=count=3', '=interval=0.3']);
      const tiempos = filas.map(f => ms(f.time)).filter(v => v != null);
      const ultima = filas[filas.length - 1] || {};
      const enviados = Number(ultima.sent) || filas.filter(f => f.seq != null).length || 3;
      const recibidos = ultima.received != null ? Number(ultima.received) : tiempos.length;
      x.ms = ms(ultima['avg-rtt']) ?? (tiempos.length ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length * 10) / 10 : null);
      x.perdida = enviados ? Math.round((enviados - recibidos) / enviados * 100) : null;
      x.error = null;
    } catch (e) {
      if (e.tipo !== 'trap') throw e;
      x.ms = null; x.perdida = null;
      x.error = /permission|not enough/i.test(e.message) ? 'El usuario no tiene el permiso "test" para hacer ping.' : e.message;
    }
    x.serie.push([ahora, x.ms, x.perdida]);
    while (x.serie.length && x.serie[0][0] < ahora - 3600e3) x.serie.shift();
  }));
  for (const k of [...r.lat.keys()]) if (!lista.some(l => l[1] === k)) r.lat.delete(k);
}
function puertaDeEnlace(rutas) {
  if (!rutas) return null;
  for (const x of rutas.filter(y => si(y.active))) {
    const ig = x['immediate-gw'] || x['gateway-status'] || x.gateway || '';
    const m = ig.match(/^(\d+\.\d+\.\d+\.\d+)/);
    if (m) return m[1];
  }
  return null;
}

function leerSalud(filas) {
  if (!filas || !filas.length) return null;
  const o = { temperatura: null, voltaje: null };
  for (const f of filas) {
    if (f.name) {   // RouterOS 7: una fila por sensor
      if (o.temperatura == null && /temperature/.test(f.name)) o.temperatura = num(f.value);
      if (o.voltaje == null && /voltage/.test(f.name)) o.voltaje = num(f.value);
    } else {        // RouterOS 6: una sola fila
      if (f.temperature != null) o.temperatura = num(f.temperature);
      else if (f['cpu-temperature'] != null) o.temperatura = num(f['cpu-temperature']);
      if (f.voltage != null) o.voltaje = num(f.voltage);
    }
  }
  return o;
}
// Interfaz de salida a Internet: la de la ruta por defecto activa
function wanDeRutas(rutas) {
  if (!rutas) return null;
  const act = rutas.filter(x => si(x.active)).sort((a, b) => (num(a.distance) || 1) - (num(b.distance) || 1));
  for (const x of act) {
    const ig = x['immediate-gw'] || '';
    if (ig.includes('%')) return ig.split('%')[1];                    // v7: 200.1.1.1%ether1
    const gs = x['gateway-status'] || '';
    const m = gs.match(/via\s+(\S+)/) || gs.match(/reachable\s+(\S+)/);  // v6: 200.1.1.1 reachable via  ether1
    if (m) return m[1];
    if (x.gateway && !/^\d+\.\d+\.\d+\.\d+$/.test(x.gateway)) return x.gateway;   // pppoe-out1
  }
  return null;
}

// ---------------------------------------------------------------- consultas de la web
function vivo(id) {
  const r = routers.get(id); if (!r) return null;
  const antes = r.observado;
  r.observado = Date.now();
  // Si nadie miraba, se adelanta la próxima consulta para pasar a modo rápido
  if (Date.now() - antes > 20000 && !r.ocupado) { clearTimeout(r.temporizador); r.temporizador = setTimeout(() => ciclo(r), 200); }
  const serie = {};
  for (const [k, s] of r.serie) serie[k] = s;
  const latencia = {};
  for (const [k, x] of r.lat) latencia[k] = x.serie;
  return { serie, latencia, rapido: RAPIDO, config: publica(leerConfig(id)) };
}

const SECCIONES = {
  async dhcp(con) {
    const l = await con.imprimir('/ip/dhcp-server/lease/print', { proplist: ['address', 'active-address', 'mac-address', 'active-mac-address', 'host-name', 'status', 'server', 'comment', 'last-seen', 'dynamic', 'disabled'] });
    return l.map(x => ({ ip: x['active-address'] || x.address, mac: x['active-mac-address'] || x['mac-address'], nombre: x['host-name'] || '', estado: x.status || '', servidor: x.server || '', comentario: x.comment || '', visto: segundos(x['last-seen']), dinamica: si(x.dynamic), deshabilitada: si(x.disabled) }));
  },
  async wifi(con) {
    let l = await opcional(con.imprimir('/interface/wifi/registration-table/print')), tipo = 'wifi';
    if (!l) { l = await opcional(con.imprimir('/interface/wireless/registration-table/print')); tipo = 'wireless'; }
    if (!l) { l = await opcional(con.imprimir('/caps-man/registration-table/print')); tipo = 'capsman'; }
    if (!l) return { noDisponible: true, lista: [] };
    // SSID de cada interfaz, por si la tabla no lo trae (RouterOS 6 y algunas versiones de 7)
    const ssid = new Map();
    if (l.some(x => !x.ssid)) {
      const ifs = tipo === 'wifi' ? await opcional(con.imprimir('/interface/wifi/print', { proplist: ['name', 'configuration.ssid', 'ssid'] }))
        : tipo === 'wireless' ? await opcional(con.imprimir('/interface/wireless/print', { proplist: ['name', 'ssid'] })) : null;
      for (const i of ifs || []) ssid.set(i.name, i['configuration.ssid'] || i.ssid || '');
    }
    // Nombre e IP de cada equipo, según el DHCP
    const leases = await opcional(con.imprimir('/ip/dhcp-server/lease/print', { proplist: ['active-mac-address', 'mac-address', 'host-name', 'comment', 'active-address', 'address'] }));
    const porMac = new Map((leases || []).map(x => [String(x['active-mac-address'] || x['mac-address'] || '').toUpperCase(), x]));
    const velocidad = v => { if (!v) return null; const m = String(v).match(/^([\d.]+)\s*(G|M|k)?bps/i); if (m) return Number(m[1]) * ({ G: 1e9, M: 1e6, k: 1e3 }[m[2]] || 1); const n = Number(v); return isFinite(n) ? n : null; };
    return { lista: l.map(x => {
      const mac = String(x['mac-address'] || '').toUpperCase(), d = porMac.get(mac) || {};
      return { interfaz: x.interface || '', mac, nombre: d.comment || d['host-name'] || '', ip: d['active-address'] || d.address || '',
        ssid: x.ssid || ssid.get(x.interface) || '', señal: num(String(x.signal || x['signal-strength'] || '').split('@')[0]),
        tiempo: segundos(x.uptime), tx: velocidad(x['tx-rate']), rx: velocidad(x['rx-rate']) };
    }) };
  },
  async vpn(con) {
    const wg = await opcional(con.imprimir('/interface/wireguard/peers/print'));
    const ppp = await opcional(con.imprimir('/ppp/active/print'));
    const ipsec = await opcional(con.imprimir('/ip/ipsec/active-peers/print'));
    return {
      wireguard: (wg || []).map(x => ({ nombre: x.name || x.comment || (x['public-key'] || '').slice(0, 10) + '…', interfaz: x.interface || '', extremo: x['current-endpoint-address'] ? `${x['current-endpoint-address']}:${x['current-endpoint-port'] || ''}` : (x['endpoint-address'] || ''), saludo: segundos(x['last-handshake']), rx: num(x.rx), tx: num(x.tx), permitidas: x['allowed-address'] || '', deshabilitado: si(x.disabled) })),
      ppp: (ppp || []).map(x => ({ nombre: x.name || '', servicio: x.service || '', origen: x['caller-id'] || '', ip: x.address || '', tiempo: segundos(x.uptime) })),
      ipsec: (ipsec || []).map(x => ({ remoto: x['remote-address'] || '', estado: x.state || '', tiempo: segundos(x.uptime) }))
    };
  },
  async firewall(con) {
    const l = await con.imprimir('/ip/firewall/filter/print', { extra: ['=stats='], proplist: ['chain', 'action', 'comment', 'bytes', 'packets', 'disabled', 'src-address', 'dst-address', 'protocol', 'dst-port', 'in-interface', 'in-interface-list', 'connection-state'] });
    return l.slice(0, 300).map(x => ({ cadena: x.chain, accion: x.action, comentario: x.comment || '', bytes: num(x.bytes), paquetes: num(x.packets), deshabilitada: si(x.disabled),
      detalle: [x['connection-state'] && `estado ${x['connection-state']}`, x.protocol, x['src-address'] && `desde ${x['src-address']}`, x['dst-address'] && `hacia ${x['dst-address']}`, x['dst-port'] && `puerto ${x['dst-port']}`, (x['in-interface'] || x['in-interface-list']) && `entra por ${x['in-interface'] || x['in-interface-list']}`].filter(Boolean).join(', ') }));
  },
  async registro(con) {
    const l = await con.imprimir('/log/print', { proplist: ['time', 'topics', 'message'] });
    return l.slice(-150).reverse().map(x => ({ hora: x.time || '', temas: x.topics || '', mensaje: x.message || '' }));
  }
};
async function seccion(id, nombre) {
  const r = routers.get(id);
  if (!r) throw new Error('Ese router no existe.');
  if (!SECCIONES[nombre]) throw new Error('Sección desconocida.');
  r.observado = Date.now();
  const c = r.cache.get(nombre);
  if (c && Date.now() - c.t < 4000) return c.datos;
  const con = await conexion(r);
  const datos = await SECCIONES[nombre](con);
  r.cache.set(nombre, { t: Date.now(), datos });
  return datos;
}

function arrancar(sim) {
  simulador = sim || null;
  for (const { id } of q("SELECT id FROM equipos WHERE tipo = 'mikrotik'").all()) iniciar(id);
}

module.exports = { arrancar, probar, crear, editar, quitar, vivo, seccion, leerConfig, publica, wanDeRutas, leerSalud };
