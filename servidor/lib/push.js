'use strict';
// Notificaciones en el teléfono o la PC (Web Push), sin dependencias: cifrado aes128gcm (RFC 8291) y firma VAPID (RFC 8292).
// Cada cuenta recibe solo los avisos de los clientes que puede ver; además cada persona elige clientes y tipos.
const crypto = require('node:crypto');
const { q, ajustes } = require('./db');
const { cifrar, descifrar } = require('./secreto');
const { log } = require('./util');

q(`CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, usuario TEXT NOT NULL COLLATE NOCASE, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  agente TEXT, creada INTEGER, ok INTEGER, fallos INTEGER DEFAULT 0)`).run();
q('CREATE TABLE IF NOT EXISTS push_prefs (usuario TEXT PRIMARY KEY COLLATE NOCASE, clientes TEXT, tipos TEXT)').run();
try { q('ALTER TABLE usuarios ADD COLUMN push INTEGER DEFAULT 1').run(); } catch { }

const TIPOS = { caidas: 'Equipos que no responden', recursos: 'CPU, memoria y disco', red: 'Enlaces WAN', seguridad: 'Seguridad de FortiGate', versiones: 'Versiones nuevas de RouterOS y FortiOS', nuevos: 'Equipos nuevos o reinstalados' };
// Solo se aceptan suscripciones de los servicios de notificaciones de los navegadores (evita que NodeCat haga peticiones a cualquier sitio)
const SERVICIOS = /^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com)\//i;

const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const desdeB64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ------------------------------------------------------------ claves VAPID (se crean una vez y se guardan cifradas)
let claves = null;
function vapid() {
  if (claves) return claves;
  let g = ajustes.leer('vapid', null);
  if (!g || !g.publica || !g.privada) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    g = { publica: b64u(Buffer.concat([Buffer.from([4]), desdeB64u(jwk.x), desdeB64u(jwk.y)])), privada: cifrar(privateKey.export({ format: 'pem', type: 'pkcs8' })) };
    ajustes.guardar('vapid', g);
  }
  claves = { publica: g.publica, privada: crypto.createPrivateKey(descifrar(g.privada)) };
  return claves;
}
function firma(endpoint) {
  const { publica, privada } = vapid();
  const aud = new URL(endpoint).origin;
  const cab = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const cuerpo = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://github.com/foxyproxy14-dev/NodeCat' }));
  const s = crypto.sign('sha256', Buffer.from(`${cab}.${cuerpo}`), { key: privada, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${cab}.${cuerpo}.${b64u(s)}, k=${publica}`;
}

// ------------------------------------------------------------ cifrado del mensaje (aes128gcm)
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
function cifrarMensaje(texto, p256dh, auth) {
  const ua = desdeB64u(p256dh), secreto = desdeB64u(auth);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const as = ecdh.getPublicKey(), compartido = ecdh.computeSecret(ua);
  const ikm = hmac(hmac(secreto, compartido), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as, Buffer.from([1])]));
  const sal = crypto.randomBytes(16);
  const prk = hmac(sal, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const cifrado = Buffer.concat([c.update(Buffer.concat([Buffer.from(texto), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const cab = Buffer.alloc(21); sal.copy(cab, 0); cab.writeUInt32BE(4096, 16); cab[20] = as.length;
  return Buffer.concat([cab, as, cifrado]);
}

async function enviarA(s, datos) {
  try {
    const r = await fetch(s.endpoint, {
      method: 'POST', body: cifrarMensaje(JSON.stringify(datos), s.p256dh, s.auth), signal: AbortSignal.timeout(15000),
      headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high', Authorization: firma(s.endpoint) }
    });
    if (r.status === 404 || r.status === 410) { q('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint); return false; }
    if (!r.ok) throw new Error(`el servicio respondió ${r.status}`);
    q('UPDATE push_subs SET ok = ?, fallos = 0 WHERE endpoint = ?').run(Date.now(), s.endpoint);
    return true;
  } catch (e) {
    q('UPDATE push_subs SET fallos = fallos + 1 WHERE endpoint = ?').run(s.endpoint);
    q('DELETE FROM push_subs WHERE endpoint = ? AND fallos > 30').run(s.endpoint);
    log(`Notificación a ${s.usuario} no enviada: ${e.message}`);
    return false;
  }
}

// ------------------------------------------------------------ a quién le llega
const auth = () => require('./auth');
function cuenta(usuario) {
  const u = q('SELECT usuario, rol, clientes, grupos, push FROM usuarios WHERE usuario = ?').get(usuario);
  if (!u) return null;
  return { usuario: u.usuario, permitido: u.push !== 0, alcance: auth().alcance(u.clientes, u.grupos) };
}
function preferencias(usuario) {
  const p = q('SELECT clientes, tipos FROM push_prefs WHERE usuario = ?').get(usuario);
  return { clientes: p && p.clientes ? JSON.parse(p.clientes) : null, tipos: p && p.tipos ? JSON.parse(p.tipos) : Object.keys(TIPOS) };
}
const hay = () => !!q('SELECT 1 FROM push_subs LIMIT 1').get();

/** Manda un aviso a los dispositivos de las cuentas que deben recibirlo. */
function notificar({ titulo, cuerpo, clienteId, tipo, equipo }) {
  if (!clienteId || !TIPOS[tipo]) return;
  const subs = q('SELECT * FROM push_subs').all();
  if (!subs.length) return;
  const porUsuario = new Map();
  for (const s of subs) { if (!porUsuario.has(s.usuario.toLowerCase())) porUsuario.set(s.usuario.toLowerCase(), []); porUsuario.get(s.usuario.toLowerCase()).push(s); }
  const datos = { t: titulo, b: cuerpo, u: equipo ? `/#/e/${equipo}` : `/#/c/${clienteId}`, g: `nodecat-${equipo || clienteId}-${tipo}` };
  for (const [u, lista] of porUsuario) {
    const c = cuenta(u);
    if (!c) { q('DELETE FROM push_subs WHERE usuario = ?').run(u); continue; }
    if (!c.permitido) continue;
    if (c.alcance && !c.alcance.includes(clienteId)) continue;          // solo sus clientes
    const p = preferencias(u);
    if (p.clientes && !p.clientes.includes(clienteId)) continue;        // los que eligió
    if (!p.tipos.includes(tipo)) continue;
    for (const s of lista) enviarA(s, datos);
  }
}
// Desde un texto de Telegram (HTML): la primera línea es el título, el resto el cuerpo
function desdeTexto(html) {
  const lineas = String(html).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').split('\n').map(s => s.trim()).filter(Boolean);
  return { titulo: (lineas[0] || 'NodeCat').slice(0, 120), cuerpo: lineas.slice(1).join('\n').slice(0, 400) };
}

// ------------------------------------------------------------ lo que usa el panel
function estado(sesion) {
  const c = cuenta(sesion.usuario) || {};
  return {
    publica: vapid().publica, permitido: !!c.permitido, tipos: TIPOS, preferencias: preferencias(sesion.usuario),
    dispositivos: q('SELECT endpoint, agente, creada, ok FROM push_subs WHERE usuario = ? ORDER BY creada').all(sesion.usuario).map(d => ({ ...d, endpoint: d.endpoint.slice(-24) }))
  };
}
function suscribir(sesion, s, agente) {
  const c = cuenta(sesion.usuario);
  if (!c || !c.permitido) throw new Error('Tu cuenta no tiene permiso para recibir notificaciones. Pídeselo a un administrador.');
  const endpoint = String(s && s.endpoint || '');
  if (!SERVICIOS.test(endpoint) || endpoint.length > 1000) throw new Error('Este navegador usa un servicio de notificaciones que NodeCat no reconoce.');
  const k = s.keys || {};
  if (desdeB64u(k.p256dh || '').length !== 65 || desdeB64u(k.auth || '').length !== 16) throw new Error('La suscripción del navegador no es válida.');
  q(`INSERT INTO push_subs (endpoint, usuario, p256dh, auth, agente, creada) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET usuario = excluded.usuario, p256dh = excluded.p256dh, auth = excluded.auth, agente = excluded.agente, fallos = 0`)
    .run(endpoint, sesion.usuario, k.p256dh, k.auth, String(agente || '').slice(0, 200), Date.now());
  log(`${sesion.usuario} activó las notificaciones en un dispositivo.`);
}
function quitar(sesion, endpoint) { q('DELETE FROM push_subs WHERE endpoint = ? AND usuario = ?').run(String(endpoint || ''), sesion.usuario); }
function guardarPreferencias(sesion, o) {
  const clientes = Array.isArray(o.clientes) ? [...new Set(o.clientes.map(Number).filter(Boolean))] : null;
  const tipos = Array.isArray(o.tipos) ? o.tipos.filter(t => TIPOS[t]) : Object.keys(TIPOS);
  q('INSERT INTO push_prefs (usuario, clientes, tipos) VALUES (?, ?, ?) ON CONFLICT (usuario) DO UPDATE SET clientes = excluded.clientes, tipos = excluded.tipos')
    .run(sesion.usuario, clientes ? JSON.stringify(clientes) : null, JSON.stringify(tipos));
}
async function probar(sesion) {
  const subs = q('SELECT * FROM push_subs WHERE usuario = ?').all(sesion.usuario);
  if (!subs.length) throw new Error('Activa primero las notificaciones en este dispositivo.');
  let ok = 0;
  for (const s of subs) if (await enviarA(s, { t: '🐱 Notificaciones de NodeCat', b: 'Funcionan. Aquí te avisaré cuando algo pase en tus clientes.', u: '/', g: 'nodecat-prueba' })) ok++;
  return { enviadas: ok, total: subs.length };
}
const permitir = (usuario, si) => q('UPDATE usuarios SET push = ? WHERE usuario = ?').run(si ? 1 : 0, usuario);

module.exports = { TIPOS, hay, notificar, desdeTexto, estado, suscribir, quitar, guardarPreferencias, probar, permitir, _cifrarMensaje: cifrarMensaje };
