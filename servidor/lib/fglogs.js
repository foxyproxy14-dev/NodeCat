'use strict';
// Logs de FortiGate guardados en NodeCat: se leen por la API (log/disk o log/memory, solo lectura, también vía sonda),
// se guardan sin duplicados y se borran solos al pasar los días de retención elegidos para cada equipo.
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { q } = require('./db');

q(`CREATE TABLE IF NOT EXISTS fglogs (equipo_id INTEGER NOT NULL, t INTEGER NOT NULL, cat TEXT, sub TEXT, nivel TEXT, accion TEXT,
  origen TEXT, destino TEXT, usuario TEXT, mensaje TEXT, crudo TEXT, clave TEXT NOT NULL, UNIQUE (equipo_id, clave))`).run();
try { q('ALTER TABLE fglogs ADD COLUMN marca TEXT').run(); } catch { }
q('CREATE INDEX IF NOT EXISTS fglogs_cat ON fglogs (equipo_id, cat, t)').run();
q('CREATE INDEX IF NOT EXISTS fglogs_marca ON fglogs (equipo_id, marca, t)').run();
q('CREATE INDEX IF NOT EXISTS fglogs_t ON fglogs (equipo_id, t)').run();

// Categorías como en Log & Report del FortiGate. "rutas" son los tipos de log de la API.
const CATEGORIAS = {
  sistema: { t: 'Sistema', rutas: ['event/system'] },
  vpn: { t: 'VPN', rutas: ['event/vpn'] },
  usuarios: { t: 'Usuarios', rutas: ['event/user'] },
  red: { t: 'Red, SD-WAN y HA', rutas: ['event/router', 'event/sdwan', 'event/ha', 'event/wireless'] },
  seguridad: { t: 'Seguridad', rutas: ['ips', 'virus', 'webfilter', 'app-ctrl', 'anomaly', 'dns'] },
  trafico: { t: 'Tráfico', rutas: ['traffic/forward', 'traffic/local'] }
};
const POR_DEFECTO = ['sistema', 'vpn', 'usuarios', 'red', 'seguridad'];
const DIAS = [1, 3, 7, 15, 30, 60, 90, 180, 365];
const MAX_POR_EQUIPO = 2_000_000;   // tope de seguridad aunque la retención sea larga
const CADA = 2 * 60 * 1000, FILAS = 500;

function validar(l) {
  const o = l && typeof l === 'object' ? l : {};
  const dias = DIAS.includes(Number(o.dias)) ? Number(o.dias) : 30;
  const cats = (Array.isArray(o.cats) ? o.cats : POR_DEFECTO).filter(c => CATEGORIAS[c]);
  return { activo: !!o.activo, dias, cats: cats.length ? [...new Set(cats)] : POR_DEFECTO };
}

// ------------------------------------------------------------ lectura de un log del FortiGate
function tiempoDe(x) {
  const n = Number(x.eventtime || x.itime || 0);
  if (n > 1e17) return Math.round(n / 1e6);
  if (n > 1e14) return Math.round(n / 1e3);
  if (n > 1e11) return Math.round(n);
  if (n > 1e9) return n * 1000;
  if (x.date && x.time) {
    const tz = /^[+-]\d{4}$/.test(x.tz || '') ? `${x.tz.slice(0, 3)}:${x.tz.slice(3)}` : '';
    const t = Date.parse(`${x.date}T${x.time}${tz}`);
    if (!isNaN(t)) return t;
  }
  return Date.now();
}
// El log original (JSON) se guarda comprimido con un diccionario de los campos habituales de FortiOS: ocupa casi la mitad.
// Primer byte = versión del diccionario (1). Los registros de versiones anteriores siguen como texto y se leen igual.
// OJO: el diccionario de la versión 1 no se puede cambiar nunca; si hace falta otro, se agrega como versión 2.
const DICCIONARIO_1 = Buffer.from(['date', 'time', 'eventtime', 'tz', 'logid', 'type', 'subtype', 'level', 'vd', 'logdesc', 'user', 'ui', 'msg', 'srcip', 'srcport',
  'srcintf', 'srcintfrole', 'srccountry', 'dstip', 'dstport', 'dstintf', 'dstintfrole', 'dstcountry', 'action', 'status', 'policyid', 'policyname', 'policytype',
  'poluuid', 'service', 'proto', 'sessionid', 'duration', 'sentbyte', 'rcvdbyte', 'sentpkt', 'rcvdpkt', 'appcat', 'app', 'apprisk', 'utmaction', 'countweb',
  'devname', 'devid', 'method', 'reason', 'profile', 'cfgtid', 'cfgpath', 'cfgobj', 'cfgattr', 'tunneltype', 'tunnelid', 'remip', 'locip', 'vpntunnel',
  'xauthuser', 'group', 'hostname', 'url', 'catdesc', 'attack', 'severity', 'virus', 'filename', 'qname', 'trandisp', 'transip', 'transport', 'mastersrcmac',
  'srcmac', 'osname', 'unauthuser', 'authserver', 'itime'].map(k => `"${k}":`).join('') +
  '"information""notice""warning""event""system""traffic""forward""local""accept""deny""close""timeout""success""failed""root""-0400""https""HTTPS""TCP""UDP""DNS""wan1""internal""lan""admin""login""logout"');
const comprimir = texto => Buffer.concat([Buffer.from([1]), zlib.deflateRawSync(texto, { dictionary: DICCIONARIO_1, level: 9 })]);
function descomprimir(v) {
  if (v == null || typeof v === 'string') return v;
  const b = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  if (b[0] === 1) return zlib.inflateRawSync(b.subarray(1), { dictionary: DICCIONARIO_1 }).toString('utf8');
  return b.toString('utf8');
}
const corto = (v, n = 300) => v == null || v === '' ? null : String(v).slice(0, n);
function convertir(x, cat, ruta) {
  const sub = x.subtype || ruta.split('/').pop();
  const ip = (a, p) => a ? (p && cat === 'trafico' ? `${a}:${p}` : a) : null;
  let mensaje = x.msg || x.logdesc || null;
  if (cat === 'seguridad') mensaje = [x.attack || x.virus || x.app || x.qname || x.hostname || x.url, x.catdesc, x.msg].filter(Boolean).join(' · ') || mensaje;
  if (cat === 'trafico') mensaje = [x.app || x.service, x.policyname || (x.policyid != null ? `política ${x.policyid}` : ''), x.sentbyte != null ? `↑${x.sentbyte} B ↓${x.rcvdbyte || 0} B` : ''].filter(Boolean).join(' · ') || mensaje;
  const t = tiempoDe(x);
  const crudo = JSON.stringify(x);
  const clave = crypto.createHash('sha1').update(`${x.eventtime || ''}|${x.date || ''} ${x.time || ''}|${x.logid || ''}|${x.sessionid || ''}|${crudo.length}|${x.msg || ''}|${x.srcip || ''}|${x.dstip || ''}`).digest('hex').slice(0, 20);
  return {
    marca: marcar(x, cat, ruta),
    t, cat, sub: corto(sub, 40), nivel: corto(x.level, 20), accion: corto(x.action || x.status || x.utmaction, 40),
    origen: corto(ip(x.srcip || x.remip || (/\(([\d.:a-f]+)\)/i.exec(x.ui || '') || [])[1] || x.locip, x.srcport) || x.srcname, 120), destino: corto(ip(x.dstip, x.dstport) || x.hostname || x.dstname, 160),
    usuario: corto(x.user || x.unauthuser || x.xauthuser, 80), mensaje: corto(mensaje, 600),
    crudo: comprimir(crudo.length > 6000 ? crudo.slice(0, 6000) : crudo), clave
  };
}

// ------------------------------------------------------------ lo importante ("el soplón")
// Marca cada log según lo que significa. Las marcas alimentan el resumen y los avisos.
const MARCAS = {
  'acceso-fallido': 'Acceso fallido al FortiGate', acceso: 'Inicio de sesión de administrador', usuario: 'Cuentas y usuarios',
  config: 'Cambio de configuración', 'vpn-fallido': 'Acceso VPN fallido', 'vpn-caido': 'Túnel VPN caído', ataque: 'Ataque detectado',
  virus: 'Virus', ha: 'Alta disponibilidad', reinicio: 'Reinicio o actualización', memoria: 'Memoria (modo conserve)', critico: 'Evento crítico'
};
const CUENTAS = /^(system\.admin|system\.api-user|user\.(local|group|radius|ldap|tacacs\+|fsso|peer)|vpn\.ssl\.web\.(portal|user-group-bookmark))/i;
function marcar(x, cat, ruta) {
  const texto = `${x.logdesc || ''} ${x.msg || ''}`;
  const sub = String(x.subtype || ruta.split('/').pop()).toLowerCase();
  const accion = String(x.action || '').toLowerCase(), est = String(x.status || '').toLowerCase();
  if (cat === 'seguridad') return sub === 'virus' ? 'virus' : (sub === 'ips' || sub === 'anomaly') ? 'ataque' : null;
  if (cat === 'trafico') return null;
  if (x.logid === '0100032002' || (accion === 'login' && /fail/.test(est)) || /admin login fail/i.test(texto)) return 'acceso-fallido';
  if (x.logid === '0100032001' || (accion === 'login' && est === 'success' && sub === 'system')) return 'acceso';
  if (/ssl-login-fail/.test(accion) || /ssl ?vpn login fail|ssl vpn.*fail.*login/i.test(texto)) return 'vpn-fallido';
  if (accion === 'tunnel-down' || /tunnel (is )?down/i.test(texto)) return 'vpn-caido';
  if (x.cfgpath) return CUENTAS.test(x.cfgpath) ? 'usuario' : 'config';
  if (/conserve/i.test(texto)) return 'memoria';
  if (sub === 'ha' && /(failover|state.*chang|member.*(join|leave|lost|down)|heartbeat.*(lost|down)|primary|master)/i.test(texto)) return 'ha';
  if (sub === 'system' && /(restart|reboot|shut ?down|power ?off|upgrade|firmware|image (is )?(loaded|install))/i.test(texto)) return 'reinicio';
  if (/^(emergency|alert|critical)$/i.test(x.level || '')) return 'critico';
  return null;
}

// Avisos: se agrupan por tipo en cada recolección; ráfagas de accesos fallidos (5 o más en 10 min) avisan una vez cada 30 min
let alAlertar = () => { };
const UMBRAL = 5, VENTANA = 10 * 60000, ENFRIAR = 30 * 60000;
const lista3 = (l, n = 3) => { const u = [...new Set(l.filter(Boolean))]; return u.slice(0, n).join(', ') + (u.length > n ? ` y ${u.length - n} más` : ''); };
const ipDe = x => x.srcip || (/\(([\d.:a-f]+)\)/i.exec(x.ui || '') || [])[1] || x.remip || '';
function soplon(id, nuevos, st) {
  const ahora = Date.now();
  st.rafagas = st.rafagas || {}; st.ultimoAviso = st.ultimoAviso || {}; st.hora = st.hora || { t: ahora, n: 0 };
  if (ahora - st.hora.t > 3600e3) st.hora = { t: ahora, n: 0 };
  const avisos = [];
  const por = m => nuevos.filter(n => n.marca === m && n.t > ahora - 20 * 60000);
  // Ráfagas
  for (const [m, umbral, titulo] of [['acceso-fallido', UMBRAL, 'intentos fallidos de entrar al FortiGate'], ['vpn-fallido', UMBRAL, 'intentos fallidos de conectarse a la VPN']]) {
    const r = st.rafagas[m] = (st.rafagas[m] || []).concat(por(m)).filter(n => n.t > ahora - VENTANA);
    if (r.length >= umbral && ahora - (st.ultimoAviso[m] || 0) > ENFRIAR) {
      st.ultimoAviso[m] = ahora;
      avisos.push({ m, nivel: 'alerta', texto: `🚨 ${r.length} ${titulo} en 10 minutos`, det: `Usuarios: ${lista3(r.map(n => n.x.user || n.x.xauthuser)) || '—'}. Desde: ${lista3(r.map(n => ipDe(n.x))) || '—'}.` });
    }
  }
  // Inicio de sesión de administrador desde una IP que no se había visto
  for (const n of por('acceso')) {
    const ip = ipDe(n.x);
    const visto = ip && q("SELECT 1 FROM fglogs WHERE equipo_id = ? AND marca = 'acceso' AND origen = ? AND t < ? LIMIT 1").get(id, ip, n.t - 1000);
    if (ip && !visto) avisos.push({ m: 'acceso', nivel: 'aviso', texto: `🔑 ${n.x.user || 'Un administrador'} entró al FortiGate desde una IP nueva`, det: `IP ${ip}${n.x.method ? `, por ${n.x.method}` : n.x.ui ? `, por ${String(n.x.ui).replace(/\(.*\)/, '')}` : ''}.` });
  }
  // Cuentas creadas, cambiadas o borradas (cada una)
  for (const n of por('usuario')) {
    const a = String(n.x.action || '').toLowerCase();
    const verbo = a === 'add' ? 'creó' : a === 'delete' ? 'borró' : 'cambió';
    const que = /admin|api-user/i.test(n.x.cfgpath) ? 'el administrador' : /group/i.test(n.x.cfgpath) ? 'el grupo' : 'el usuario';
    avisos.push({ m: 'usuario', nivel: a === 'edit' ? 'aviso' : 'alerta', texto: `👤 ${n.x.user || 'Alguien'} ${verbo} ${que} ${n.x.cfgobj || ''}`.trim(), det: `${n.x.cfgpath}${n.x.cfgattr ? ` (${String(n.x.cfgattr).slice(0, 160)})` : ''}${ipDe(n.x) ? `, desde ${ipDe(n.x)}` : ''}.` });
  }
  // Agrupados
  const grupo = (m, nivel, f) => { const l = por(m); if (l.length) avisos.push({ m, nivel, ...f(l) }); };
  grupo('config', 'aviso', l => ({ texto: `⚙️ ${l.length === 1 ? 'Cambio' : l.length + ' cambios'} de configuración por ${lista3(l.map(n => n.x.user)) || 'un administrador'}`, det: `En: ${lista3(l.map(n => n.x.cfgpath), 4)}.` }));
  grupo('ataque', 'alerta', l => ({ texto: `🛡️ ${l.length === 1 ? 'Ataque detectado' : l.length + ' ataques detectados'}`, det: `${lista3(l.map(n => n.x.attack || n.x.msg))}. Desde ${lista3(l.map(n => n.x.srcip))} hacia ${lista3(l.map(n => n.x.dstip))}. Acción: ${lista3(l.map(n => n.x.action))}.` }));
  grupo('virus', 'alerta', l => ({ texto: `🦠 ${l.length === 1 ? 'Virus detectado' : l.length + ' virus detectados'}`, det: `${lista3(l.map(n => n.x.virus))} en ${lista3(l.map(n => n.x.hostname || n.x.url || n.x.filename))}. Equipos: ${lista3(l.map(n => n.x.srcip))}. Acción: ${lista3(l.map(n => n.x.action))}.` }));
  grupo('vpn-caido', 'aviso', l => ({ texto: `🔌 ${l.length === 1 ? 'Se cayó un túnel VPN' : l.length + ' caídas de túneles VPN'}`, det: `${lista3(l.map(n => n.x.vpntunnel || n.x.tunnelid || n.x.remip))}.` }));
  grupo('ha', 'alerta', l => ({ texto: '🔁 Cambio en la alta disponibilidad (HA)', det: lista3(l.map(n => n.x.msg || n.x.logdesc), 2) + '.' }));
  grupo('reinicio', 'alerta', l => ({ texto: '🔄 El FortiGate se reinició o se actualizó', det: lista3(l.map(n => n.x.msg || n.x.logdesc), 2) + '.' }));
  grupo('memoria', 'alerta', l => ({ texto: '🧠 El FortiGate entró en modo conserve (poca memoria)', det: lista3(l.map(n => n.x.msg || n.x.logdesc), 2) + '.' }));
  grupo('critico', 'alerta', l => ({ texto: `❗ ${l.length === 1 ? 'Evento crítico' : l.length + ' eventos críticos'}`, det: lista3(l.map(n => n.x.msg || n.x.logdesc), 2) + '.' }));
  for (const a of avisos) {
    if (st.hora.n >= 20) { if (st.hora.n++ === 20) alAlertar(id, { m: 'muchos', nivel: 'aviso', texto: '📣 Demasiados avisos en la última hora', det: 'Se pausan hasta la próxima hora. Revisa los registros en NodeCat.' }); continue; }
    st.hora.n++;
    try { alAlertar(id, a); } catch { }
  }
}

// ------------------------------------------------------------ recolección
const estado = new Map();   // equipo → { fuentes: Map(ruta → { fuente, t }), ultima, error, guardados }
const insertar = q(`INSERT OR IGNORE INTO fglogs (equipo_id, t, cat, sub, nivel, accion, origen, destino, usuario, mensaje, crudo, clave, marca)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

async function leerRuta(api, fuente, ruta) {
  const r = await api.get(`log/${fuente}/${ruta}`, { rows: String(FILAS) }, 20000);
  let res = Array.isArray(r && r.results) ? r.results : [];
  // Algunas versiones devuelven primero los más viejos: si es así, se piden los últimos
  if (res.length >= 2 && tiempoDe(res[0]) < tiempoDe(res[res.length - 1]) && Number(r.total_lines) > FILAS) {
    const r2 = await api.get(`log/${fuente}/${ruta}`, { rows: String(FILAS), start: String(Number(r.total_lines) - FILAS) }, 20000);
    if (Array.isArray(r2 && r2.results)) res = r2.results;
  }
  return res;
}
// Disco si el equipo lo tiene y guarda ahí; si no, memoria. Se vuelve a averiguar cada 30 min.
async function elegirFuente(api, ruta) {
  let mejor = null;
  for (const f of ['disk', 'memory']) {
    try { const l = await leerRuta(api, f, ruta); if (!mejor || l.length > mejor.l.length) mejor = { f, l }; if (l.length) break; } catch { }
  }
  return mejor;
}

async function recolectar(id, api, conf) {
  const st = estado.get(id) || { fuentes: new Map(), hasta: new Map(), ultima: 0, error: null, guardados: 0 };
  estado.set(id, st);
  let nuevos = 0, fallos = 0, intentos = 0; const importantes = [];
  for (const cat of conf.cats) for (const ruta of CATEGORIAS[cat].rutas) {
    intentos++;
    try {
      const f = st.fuentes.get(ruta);
      let l;
      if (!f || (Date.now() - f.t > 30 * 60000 && f.vacia)) {
        const m = await elegirFuente(api, ruta);
        if (!m) { st.fuentes.set(ruta, { fuente: 'memory', t: Date.now(), vacia: true, falta: true }); continue; }
        st.fuentes.set(ruta, { fuente: m.f, t: Date.now(), vacia: !m.l.length }); l = m.l;
      } else {
        if (f.falta) continue;
        l = await leerRuta(api, f.fuente, ruta);
        if (l.length) f.vacia = false;
      }
      // Cada lectura trae los últimos 500 registros, casi todos ya guardados: los anteriores a lo último visto
      // (con 30 min de margen) se saltan sin procesarlos. El índice único sigue evitando duplicados en el margen.
      const visto = st.hasta.get(ruta) || 0;
      let max = visto;
      for (const x of l) {
        const t = tiempoDe(x);
        if (t > max) max = t;
        if (visto && t < visto - 30 * 60000) continue;
        const c = convertir(x, cat, ruta);
        const ok = Number(insertar.run(id, c.t, c.cat, c.sub, c.nivel, c.accion, c.origen, c.destino, c.usuario, c.mensaje, c.crudo, c.clave, c.marca).changes);
        nuevos += ok; if (ok && c.marca) importantes.push({ marca: c.marca, t: c.t, x });
      }
      // Solo horas razonables (un reloj desajustado en el futuro no debe hacer saltar los registros buenos)
      if (max && max < Date.now() + 10 * 60000) st.hasta.set(ruta, max);
    } catch (e) { fallos++; st.error = e.message; }
  }
  // La primera vez se guarda lo que ya había sin avisar (es historial, no algo que esté pasando)
  if (st.ultima && importantes.length) soplon(id, importantes, st);
  st.ultima = Date.now(); st.guardados += nuevos;
  if (!fallos || fallos < intentos) st.error = fallos ? st.error : null;
  return nuevos;
}

// Retención: se llama cada hora desde el mantenimiento
function limpiar(confDe) {
  let borrados = 0;
  for (const { equipo_id: id } of q('SELECT DISTINCT equipo_id FROM fglogs').all()) {
    const c = confDe(id);
    if (!c) { borrados += Number(q('DELETE FROM fglogs WHERE equipo_id = ?').run(id).changes); continue; }
    borrados += Number(q('DELETE FROM fglogs WHERE equipo_id = ? AND t < ?').run(id, Date.now() - c.dias * 864e5).changes);
    const n = q('SELECT COUNT(*) n FROM fglogs WHERE equipo_id = ?').get(id).n;
    if (n > MAX_POR_EQUIPO) {
      const corte = q('SELECT t FROM fglogs WHERE equipo_id = ? ORDER BY t DESC LIMIT 1 OFFSET ?').get(id, MAX_POR_EQUIPO);
      if (corte) borrados += Number(q('DELETE FROM fglogs WHERE equipo_id = ? AND t <= ?').run(id, corte.t).changes);
    }
  }
  return borrados;
}
const borrarEquipo = id => { q('DELETE FROM fglogs WHERE equipo_id = ?').run(id); estado.delete(id); };

// ------------------------------------------------------------ consulta desde el panel
function consultar(id, o, conf) {
  const cond = ['equipo_id = ?'], args = [id];
  if (o.cat && CATEGORIAS[o.cat]) { cond.push('cat = ?'); args.push(o.cat); }
  const desde = Number(o.desde) || 0; if (desde) { cond.push('t >= ?'); args.push(desde); }
  const antes = Number(o.antes) || 0; if (antes) { cond.push('t < ?'); args.push(antes); }
  if (o.nivel === 'problemas') cond.push("nivel IN ('emergency','alert','critical','error','warning')");
  if (o.marca && (MARCAS[o.marca] || o.marca === 'todas')) { if (o.marca === 'todas') cond.push('marca IS NOT NULL'); else { cond.push('marca = ?'); args.push(o.marca); } }
  const accion = String(o.accion || '').slice(0, 30); if (accion) { cond.push('accion = ?'); args.push(accion); }
  const txt = String(o.q || '').trim().slice(0, 100);
  if (txt) { cond.push("(mensaje LIKE ? ESCAPE '\\' OR origen LIKE ? ESCAPE '\\' OR destino LIKE ? ESCAPE '\\' OR usuario LIKE ? ESCAPE '\\' OR accion LIKE ? ESCAPE '\\' OR sub LIKE ? ESCAPE '\\')"); const l = `%${txt.replace(/[\\%_]/g, m => '\\' + m)}%`; args.push(l, l, l, l, l, l); }
  const limite = Math.min(200, Math.max(20, Number(o.limite) || 100));
  const filas = q(`SELECT rowid id, t, cat, sub, nivel, accion, origen, destino, usuario, mensaje, marca FROM fglogs WHERE ${cond.join(' AND ')} ORDER BY t DESC LIMIT ?`).all(...args, limite + 1);
  const conteos = {};
  for (const r of q('SELECT cat, COUNT(*) n FROM fglogs WHERE equipo_id = ? AND t >= ? GROUP BY cat').all(id, desde || 0)) conteos[r.cat] = r.n;
  const tot = q('SELECT COUNT(*) n, MIN(t) desde, SUM(LENGTH(crudo)) + COUNT(*) * 200 bytes FROM fglogs WHERE equipo_id = ?').get(id);
  const st = estado.get(id) || {};
  const marcas = {}; for (const r of q('SELECT marca, COUNT(*) n FROM fglogs WHERE equipo_id = ? AND marca IS NOT NULL AND t >= ? GROUP BY marca').all(id, desde || 0)) marcas[r.marca] = r.n;
  const importantes = o.cat ? [] : q(`SELECT rowid id, t, cat, sub, nivel, accion, origen, destino, usuario, mensaje, marca FROM fglogs WHERE equipo_id = ? AND marca IS NOT NULL AND marca != 'config' AND t >= ? ORDER BY t DESC LIMIT 25`).all(id, desde || 0);
  const tops = (marca, campo) => q(`SELECT ${campo} v, COUNT(*) n FROM fglogs WHERE equipo_id = ? AND marca = ? AND t >= ? AND ${campo} IS NOT NULL GROUP BY ${campo} ORDER BY n DESC LIMIT 5`).all(id, marca, desde || 0);
  const resumen = o.cat ? null : { fallidosIp: tops('acceso-fallido', 'origen'), fallidosUsuario: tops('acceso-fallido', 'usuario'), ataques: tops('ataque', 'mensaje'), vpnFallidos: tops('vpn-fallido', 'usuario') };
  const acciones = q(`SELECT accion, COUNT(*) n FROM fglogs WHERE equipo_id = ? ${o.cat && CATEGORIAS[o.cat] ? 'AND cat = ?' : ''} AND accion IS NOT NULL AND t >= ? GROUP BY accion ORDER BY n DESC LIMIT 12`).all(...(o.cat && CATEGORIAS[o.cat] ? [id, o.cat, desde || 0] : [id, desde || 0]));
  return {
    filas: filas.slice(0, limite), mas: filas.length > limite, conteos, acciones, marcas, importantes, resumen, nombresMarca: MARCAS,
    total: tot.n, desdeGuardado: tot.desde, tamano: tot.bytes || 0,
    config: conf, ultima: st.ultima || null, error: st.error || null,
    categorias: Object.fromEntries(Object.entries(CATEGORIAS).map(([k, v]) => [k, v.t]))
  };
}
function detalle(id, fila) {
  const r = q('SELECT crudo FROM fglogs WHERE equipo_id = ? AND rowid = ?').get(id, Number(fila));
  if (!r) return null;
  let texto;
  try { texto = descomprimir(r.crudo); } catch { return { texto: 'No se pudo leer este registro.' }; }
  try { return JSON.parse(texto); } catch { return { texto }; }
}

module.exports = { set alAlertar(f) { alAlertar = f; }, MARCAS, marcar, CATEGORIAS, POR_DEFECTO, DIAS, CADA, validar, recolectar, limpiar, borrarEquipo, consultar, detalle };
