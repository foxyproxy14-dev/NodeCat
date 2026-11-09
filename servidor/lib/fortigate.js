'use strict';
// FortiGate: consulta periódica por la API REST (solo lectura), tráfico en vivo, SD-WAN y secciones bajo demanda.
const { q } = require('./db');
const flota = require('./flota');
const { FortiOS } = require('./fortios');
const sonda = require('./sonda');
const { cifrar, descifrar } = require('./secreto');
const { log } = require('./util');

const RAPIDO = 3000, LENTO = 15000, REINTENTO = 5000, CAIDO = 10000;
const VENTANA = 6 * 60 * 1000;
const equipos = new Map();
let simulador = null;

// ---------------------------------------------------------------- configuración
function leerConfig(id) {
  const r = q("SELECT config FROM equipos WHERE id = ? AND tipo = 'fortigate'").get(id);
  return r && r.config ? JSON.parse(r.config) : null;
}
function validar(c, previa, clienteId) {
  const host = String(c.host || '').trim();
  if (!/^[A-Za-z0-9.\-:\[\]]{1,253}$/.test(host)) throw new Error('Escribe la IP o el nombre del FortiGate.');
  const puerto = Number(c.puerto || 443);
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new Error('El puerto no es válido.');
  const token = c.token ? String(c.token).trim() : (previa ? descifrar(previa.token) : '');
  if (!token) throw new Error('Pega el token del usuario de API.');
  const vdom = String(c.vdom || '').trim().slice(0, 32);
  const wan = String(c.wan || '').trim().slice(0, 64);
  return { host, puerto, token, verificar: !!c.verificar, vdom, wan, sonda: sonda.validar(c.sonda, clienteId) };
}
const guardable = c => ({ host: c.host, puerto: c.puerto, token: cifrar(c.token), verificar: c.verificar, vdom: c.vdom, wan: c.wan, sonda: c.sonda || null, demo: c.demo, perfil: c.perfil });
const clienteDe = id => { const e = flota.equipo(id); return e ? e.cliente_id : null; };
const nueva = (c, extra = {}) => c.sonda ? new sonda.FortiOSSonda({ ...c, ...extra }) : new FortiOS({ ...c, ...extra });
const publica = c => c ? { host: c.host, puerto: c.puerto, verificar: !!c.verificar, vdom: c.vdom || '', wan: c.wan || '', sonda: c.sonda || null, sondaNombre: c.sonda ? sonda.nombre(c.sonda) : null, tokenGuardado: !!c.token, demo: !!c.demo } : null;

async function probar(datos, id) {
  const c = validar(datos, id ? leerConfig(id) : null, id ? clienteDe(id) : datos.clienteId);
  const api = nueva(c);
  try {
    const s = await api.get('monitor/system/status');
    const r = s.results || {};
    return { identidad: r.hostname || '', version: s.version || '', modelo: [r.model_name, r.model_number].filter(Boolean).join(' ') || r.model || '' };
  } finally { api.cerrar(); }
}
function crear(clienteId, nombre, datos) {
  const c = validar(datos, null, clienteId);
  const id = flota.crearRouter(clienteId, nombre, guardable(c), 'fortigate');
  iniciar(id);
  return id;
}
function editar(id, nombre, datos) {
  const previa = leerConfig(id); if (!previa) throw new Error('Ese FortiGate no existe.');
  if (nombre) flota.renombrarRouter(id, nombre);
  if (!previa.demo) q('UPDATE equipos SET config = ? WHERE id = ?').run(JSON.stringify(guardable(validar(datos, previa, clienteDe(id)))), id);
  quitar(id); iniciar(id);
}
function quitar(id) {
  const r = equipos.get(id); if (!r) return;
  clearTimeout(r.temporizador); if (r.api) r.api.cerrar();
  equipos.delete(id); sonda.soltar(id);
}

// ---------------------------------------------------------------- bucle de consulta
function iniciar(id) {
  const c = leerConfig(id); if (!c) return;
  if (c.token) c.token = descifrar(c.token);
  const r = { id, c, api: null, observado: 0, prev: new Map(), serie: new Map(), acum: new Map(), minuto: 0, lento: {}, cache: new Map(), lat: new Map(), ocupado: false, fallos: 0, ultimoError: null };
  equipos.set(id, r);
  if (c.sonda && !c.demo) sonda.registrar(c.sonda, id);
  r.temporizador = setTimeout(() => ciclo(r), 500 + Math.random() * 2000);
}
function programar(r) {
  if (!equipos.has(r.id)) return;
  const espera = r.fallos === 1 ? REINTENTO : r.fallos > 1 ? CAIDO : Date.now() - r.observado < 20000 ? RAPIDO : LENTO;
  r.temporizador = setTimeout(() => ciclo(r), espera);
}
async function ciclo(r) {
  if (r.ocupado) return programar(r);
  r.ocupado = true;
  try { await sondear(r); r.fallos = 0; if (r.ultimoError) { log(`FortiGate ${r.c.host}: conectado de nuevo.`); r.ultimoError = null; } }
  catch (e) {
    r.fallos++;
    const v = flota.vivo.get(r.id);
    if (v) v.errorConexion = e.message;
    if (r.fallos >= 2) flota.routerSinRespuesta(r.id, e.message);
    if (r.ultimoError !== e.message) { log(`FortiGate ${v ? v.nombre : r.id}: ${e.message}`); r.ultimoError = e.message; }
  } finally { r.ocupado = false; programar(r); }
}
const api = r => r.c.demo ? simulador.api(r.id) : (r.api || (r.api = nueva(r.c, { tiempo: r.c.sonda ? 10000 : 8000 })));
const opcional = async p => { try { return await p; } catch (e) { if (e.tipo === 'falta' || e.tipo === 'permiso') return null; throw e; } };
const lista = x => Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : [];
const num = x => x == null || x === '' || isNaN(Number(x)) ? null : Number(x);
const actual = x => { const v = lista(x)[0]; return v ? num(v.current) : null; };

async function sondear(r) {
  const a = api(r), ahora = Date.now(), L = r.lento;
  const uso = await a.get('monitor/system/resource/usage', { resource: 'cpu,mem,disk,session', interval: '1-min' });
  const ifs = await a.get('monitor/system/interface', { include_vlan: 'true', include_aggregate: 'true' });
  const sdwan = await opcional(a.get('monitor/virtual-wan/members'));
  const salud = await opcional(a.get('monitor/virtual-wan/health-check'));
  if (!L.t || ahora - L.t > 60000) {
    const st = await a.get('monitor/system/status');
    const sensores = await opcional(a.get('monitor/system/sensor-info'));
    const ipsec = await opcional(a.get('monitor/vpn/ipsec'));
    const dhcp = await opcional(a.get('monitor/system/dhcp'));
    const estadoWeb = await opcional(a.get('monitor/web-ui/state'));
    const ha = await opcional(a.get('monitor/system/ha-peer'));
    const res = st.results || {};
    const temps = lista(sensores && sensores.results).filter(s => /temp/i.test(s.type || s.name || '')).map(s => num(s.value)).filter(v => v != null);
    const tuneles = lista(ipsec && ipsec.results);
    const fases2 = tuneles.flatMap(t => lista(t.proxyid));
    Object.assign(L, { t: ahora, identidad: res.hostname || '', modelo: [res.model_name, res.model_number].filter(Boolean).join(' ') || res.model || '', version: st.version || '', serie: st.serial || res.serial || '',
      temperatura: temps.length ? Math.max(...temps) : null,
      vpn: tuneles.filter(t => lista(t.proxyid).some(p => p.status === 'up')).length, vpnTotal: tuneles.length, fases2: fases2.length,
      dhcp: dhcp ? lista(dhcp.results).filter(x => !x.expire_time || x.expire_time * 1000 > ahora || x.status !== 'expired').length : null,
      arranque: estadoWeb && estadoWeb.results && estadoWeb.results.utc_last_reboot ? Number(estadoWeb.results.utc_last_reboot) : null,
      ha: ha ? lista(ha.results).length : 0 });
  }
  const R = uso.results || {};

  // Tráfico por interfaz: diferencia de contadores
  const interfaces = [];
  for (const i of lista(ifs.results)) {
    const nombre = i.name, rxB = num(i.rx_bytes), txB = num(i.tx_bytes);
    const p = r.prev.get(nombre);
    let rx = null, tx = null;
    if (p && rxB != null && ahora > p.t && rxB >= p.rx && txB >= p.tx) { const dt = (ahora - p.t) / 1000; rx = Math.round((rxB - p.rx) * 8 / dt); tx = Math.round((txB - p.tx) * 8 / dt); }
    r.prev.set(nombre, { t: ahora, rx: rxB, tx: txB });
    const activa = i.link === true || i.link === 'up' || i.status === 'up';
    interfaces.push({ nombre, tipo: i.type || (i.vlanid ? 'vlan' : 'ether'), activa, deshabilitada: false, rx, tx, comentario: i.alias || i.description || '', ip: i.ip || '', velocidad: num(i.speed) });
    if (rx == null) continue;
    let s = r.serie.get(nombre); if (!s) r.serie.set(nombre, s = []);
    s.push([ahora, rx, tx]); while (s.length && s[0][0] < ahora - VENTANA) s.shift();
    let ac = r.acum.get(nombre); if (!ac) r.acum.set(nombre, ac = { rx: 0, tx: 0, n: 0, rxMax: 0, txMax: 0 });
    ac.rx += rx; ac.tx += tx; ac.n++; ac.rxMax = Math.max(ac.rxMax, rx); ac.txMax = Math.max(ac.txMax, tx);
  }
  const min = Math.floor(ahora / 60000);
  if (r.minuto && min !== r.minuto) {
    const ins = q('INSERT INTO trafico (equipo_id, t, interfaz, rx, tx, rx_max, tx_max) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let n = 0;
    for (const [nombre, ac] of r.acum) {
      const it = interfaces.find(x => x.nombre === nombre);
      if (!ac.n || n >= 48 || !it || (!it.activa && !ac.rx && !ac.tx)) continue;
      ins.run(r.id, r.minuto * 60000, nombre, Math.round(ac.rx / ac.n), Math.round(ac.tx / ac.n), ac.rxMax, ac.txMax); n++;
    }
    r.acum.clear();
  }
  r.minuto = min;

  // Enlaces WAN: los miembros de SD-WAN; sin SD-WAN, la interfaz indicada o wan1/wan
  const miembros = lista(sdwan && sdwan.results).filter(m => m && m.interface);
  let wans = miembros.map(m => { const it = interfaces.find(x => x.nombre === m.interface) || {}; return { interfaz: m.interface, activa: m.link === 'up' || m.status === 'up' || (m.link == null && it.activa), rx: it.rx ?? null, tx: it.tx ?? null, sesiones: num(m.session) }; });
  if (r.c.wan) wans = wans.filter(w => w.interfaz === r.c.wan).concat(wans.some(w => w.interfaz === r.c.wan) ? [] : interfaces.filter(i => i.nombre === r.c.wan).map(i => ({ interfaz: i.nombre, activa: i.activa, rx: i.rx, tx: i.tx })));
  if (!wans.length) { const w = interfaces.find(i => /^wan1?$/i.test(i.nombre)); if (w) wans = [{ interfaz: w.nombre, activa: w.activa, rx: w.rx, tx: w.tx }]; }
  const wan = wans.find(w => !w.activa) || wans[0] || null;

  // Latencia: los SLA de SD-WAN, por enlace
  const latencia = [];
  for (const [sla, porIf] of Object.entries((salud && salud.results) || {})) {
    for (const [iface, d] of Object.entries(porIf || {})) {
      if (!d || typeof d !== 'object') continue;
      const clave = `${sla}|${iface}`, abajo = d.status && d.status !== 'up';
      const ms = abajo ? null : num(d.latency) != null ? Math.round(num(d.latency) * 10) / 10 : null;
      const perdida = num(d.packet_loss) != null ? Math.round(num(d.packet_loss)) : (abajo ? 100 : null);
      let x = r.lat.get(clave); if (!x) r.lat.set(clave, x = { serie: [] });
      Object.assign(x, { nombre: `${sla}, ${iface}`, ip: clave, ms, perdida, jitter: num(d.jitter) });
      x.serie.push([ahora, ms, perdida]); while (x.serie.length && x.serie[0][0] < ahora - 3600e3) x.serie.shift();
      latencia.push({ nombre: x.nombre, ip: clave, ms, perdida, jitter: x.jitter, error: null });
    }
  }

  const disco = actual(R.disk);
  const d = {
    cpu: actual(R.cpu), ramPct: actual(R.mem), ramTotal: null, ramUsada: null,
    so: `FortiOS ${String(L.version || '').replace(/^v/, '')}${L.modelo ? ', ' + L.modelo : ''}`, arranque: L.arranque,
    discos: disco != null ? [{ unidad: 'Disco', etiqueta: '', total: null, libre: null, pct: disco }] : [], sesiones: [],
    red: { identidad: L.identidad, modelo: L.modelo, version: String(L.version || '').replace(/^v/, ''), serie: L.serie, arquitectura: '', temperatura: L.temperatura, voltaje: null,
      conexiones: actual(R.session), dhcp: L.dhcp, vpn: L.vpn, vpnTotal: L.vpnTotal, ha: L.ha, latencia, wan, wans, interfaces }
  };
  flota.actualizarRouter(r.id, d, r.c.demo ? '' : r.c.host, String(L.version || '').replace(/^v/, ''));
}

// ---------------------------------------------------------------- consultas de la web
function vivo(id) {
  const r = equipos.get(id); if (!r) return null;
  const antes = r.observado; r.observado = Date.now();
  if (Date.now() - antes > 20000 && !r.ocupado) { clearTimeout(r.temporizador); r.temporizador = setTimeout(() => ciclo(r), 200); }
  const serie = {}; for (const [k, s] of r.serie) serie[k] = s;
  const latencia = {}; for (const [k, x] of r.lat) latencia[k] = x.serie;
  return { serie, latencia, rapido: RAPIDO, config: publica(leerConfig(id)) };
}

const fecha = s => s ? new Date(Number(s) * 1000).toISOString() : '';
const SECCIONES = {
  async 'fg-sdwan'(a) {
    const m = await opcional(a.get('monitor/virtual-wan/members'));
    const h = await opcional(a.get('monitor/virtual-wan/health-check'));
    const sla = [];
    for (const [nombre, porIf] of Object.entries((h && h.results) || {}))
      for (const [iface, d] of Object.entries(porIf || {})) if (d && typeof d === 'object')
        sla.push({ sla: nombre, interfaz: iface, estado: d.status || '', latencia: num(d.latency), jitter: num(d.jitter), perdida: num(d.packet_loss), cumple: d.sla_targets_met ? String(lista(d.sla_targets_met).length > 0) : '' });
    return { miembros: lista(m && m.results).map(x => ({ interfaz: x.interface || '', zona: x.zone || '', estado: x.link || x.status || '', sesiones: num(x.session), subida: num(x.tx_bandwidth), bajada: num(x.rx_bandwidth), puertaEnlace: x.gateway || '' })), sla };
  },
  async 'fg-ipsec'(a) {
    const t = await opcional(a.get('monitor/vpn/ipsec'));
    return lista(t && t.results).flatMap(x => { const ps = lista(x.proxyid); return (ps.length ? ps : [{}]).map(p => ({ tunel: x.name || '', remoto: x.rgwy || '', fase2: p.p2name || '', estado: p.status || 'down', entrada: num(p.incoming_bytes), salida: num(p.outgoing_bytes), redes: [lista(p.proxy_src).map(s => s.subnet).join(' '), lista(p.proxy_dst).map(s => s.subnet).join(' ')].filter(Boolean).join(' ↔ '), activo: num(p.expire) })); });
  },
  async 'fg-sslvpn'(a) {
    const s = await opcional(a.get('monitor/vpn/ssl'));
    return lista(s && s.results).map(x => ({ usuario: x.user_name || x.username || '', origen: x.remote_host || '', ip: lista(x.subsessions).map(y => y.aip).filter(Boolean).join(', '), desde: x.last_login_time || '', duracion: num(x.duration) }));
  },
  async 'fg-politicas'(a) {
    const conf = await opcional(a.get('cmdb/firewall/policy', { format: 'policyid|name|srcintf|dstintf|srcaddr|dstaddr|service|action|status|nat|comments' }));
    const stats = await opcional(a.get('monitor/firewall/policy'));
    const porId = new Map(lista(stats && stats.results).map(x => [x.policyid, x]));
    const nombres = l => lista(l).map(x => x.name).join(', ');
    return lista(conf && conf.results).map(x => { const s = porId.get(x.policyid) || {}; return { id: x.policyid, nombre: x.name || '', origen: `${nombres(x.srcintf)}: ${nombres(x.srcaddr)}`, destino: `${nombres(x.dstintf)}: ${nombres(x.dstaddr)}`, servicio: nombres(x.service), accion: x.action || '', estado: x.status || '', nat: x.nat || '', comentario: x.comments || '', usos: num(s.hit_count), bytes: num(s.bytes), ultimo: s.last_used ? fecha(s.last_used) : '' }; });
  },
  async 'fg-rutas'(a) {
    const r = await opcional(a.get('monitor/router/ipv4'));
    return lista(r && r.results).map(x => ({ destino: x.ip_mask || `${x.ip}/${x.mask}`, puertaEnlace: x.gateway || '', interfaz: x.interface || '', tipo: x.type || '', distancia: num(x.distance), metrica: num(x.metric) }));
  },
  async 'fg-dhcp'(a) {
    const r = await opcional(a.get('monitor/system/dhcp'));
    return lista(r && r.results).map(x => ({ ip: x.ip || '', mac: x.mac || '', nombre: x.hostname || '', interfaz: x.interface || '', estado: x.status || '', vence: x.expire_time ? fecha(x.expire_time) : '' }));
  },
  async 'fg-licencias'(a) {
    const r = await opcional(a.get('monitor/license/status'));
    return Object.entries((r && r.results) || {}).filter(([, v]) => v && typeof v === 'object' && (v.status || v.expires)).map(([k, v]) => ({ servicio: k, estado: v.status || '', vence: v.expires ? fecha(v.expires) : '', version: v.version || '' }));
  },
  async 'fg-ha'(a) {
    const p = await opcional(a.get('monitor/system/ha-peer'));
    const s = await opcional(a.get('monitor/system/ha-statistics'));
    const est = new Map(lista(s && s.results).map(x => [x.serial_no || x.hostname, x]));
    return lista(p && p.results).map(x => { const e = est.get(x.serial_no) || {}; return { equipo: x.hostname || '', serie: x.serial_no || '', prioridad: num(x.priority), rol: x.manage_master || x.role || (x.primary ? 'primario' : ''), cpu: num(e.cpu_usage), memoria: num(e.mem_usage), sesiones: num(e.sessions) }; });
  },
  async 'fg-usuarios'(a) {
    const r = await opcional(a.get('monitor/user/firewall'));
    return lista(r && r.results).map(x => ({ usuario: x.username || '', ip: x.ipaddr || '', metodo: x.method || '', grupo: lista(x.usergroup).map(g => g.name || g).join(', '), duracion: num(x.duration), trafico: num(x.traffic_vol_bytes) }));
  },
  async 'fg-eventos'(a) {
    const r = await opcional(a.get('log/memory/event/system', { rows: '150' }, 15000));
    return lista(r && r.results).map(x => ({ hora: `${x.date || ''} ${x.time || ''}`.trim(), nivel: x.level || '', mensaje: x.msg || x.logdesc || '', usuario: x.user || '' }));
  }
};
async function seccion(id, nombre) {
  const r = equipos.get(id);
  if (!r) throw new Error('Ese FortiGate no existe.');
  if (!SECCIONES[nombre]) throw new Error('Sección desconocida.');
  r.observado = Date.now();
  const c = r.cache.get(nombre);
  if (c && Date.now() - c.t < 4000) return c.datos;
  const datos = await SECCIONES[nombre](api(r));
  r.cache.set(nombre, { t: Date.now(), datos });
  return datos;
}

function arrancar(sim) {
  simulador = sim || null;
  for (const { id } of q("SELECT id FROM equipos WHERE tipo = 'fortigate'").all()) iniciar(id);
}

module.exports = { arrancar, probar, crear, editar, quitar, vivo, seccion, leerConfig, publica };
