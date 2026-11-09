'use strict';
// NodeCat: panel de monitoreo por clientes. Punto de entrada y servidor web.
process.removeAllListeners('warning');   // el aviso "SQLite is experimental" no aporta nada al registro
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./lib/config');
const { log, iguales } = require('./lib/util');
const { ajustes } = require('./lib/db');
const auth = require('./lib/auth');
const flota = require('./lib/flota');
const avisos = require('./lib/avisos');
const paquete = require('./lib/paquete');
const mikrotik = require('./lib/mikrotik');

const WEB = path.join(__dirname, 'web');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const SEGURIDAD = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};

// ---------------------------------------------------------------- utilidades HTTP
function ipDe(req) {
  if (config.CONFIAR_PROXY) {
    // Se toma la última dirección de X-Forwarded-For: la añade el propio proxy (Nginx Proxy Manager, Cloudflare)
    // y no se puede falsear desde fuera, al contrario que la primera
    const xf = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
    if (xf.length) return xf[xf.length - 1].replace(/^::ffff:/, '');
    if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']).trim();
  }
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
const esHttps = req => !!req.socket.encrypted || (config.CONFIAR_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
function urlPublica(req) {
  const guardada = ajustes.leer('urlAgentes', '');
  if (guardada) return guardada;
  const host = (config.CONFIAR_PROXY && req.headers['x-forwarded-host']) || req.headers.host || `localhost:${config.PUERTO}`;
  return `${esHttps(req) ? 'https' : 'http'}://${String(host).split(',')[0].trim()}`;
}
function cookie(req, nombre) {
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('='); if (i < 0) continue;
    if (p.slice(0, i).trim() === nombre) return decodeURIComponent(p.slice(i + 1).trim());
  }
  return null;
}
function json(res, status, datos, extra = {}) {
  const b = Buffer.from(JSON.stringify(datos));
  res.writeHead(status, { ...SEGURIDAD, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': b.length, ...extra });
  res.end(b);
}
function leerCuerpo(req, max = 256 * 1024) {
  return new Promise((ok, mal) => {
    const partes = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > max) { mal(Object.assign(new Error('La petición es demasiado grande.'), { status: 413 })); req.destroy(); } else partes.push(c); });
    req.on('end', () => {
      if (!n) return ok({});
      try { ok(JSON.parse(Buffer.concat(partes).toString('utf8').replace(/^﻿/, ''))); }
      catch { mal(Object.assign(new Error('El contenido no es JSON válido.'), { status: 400 })); }
    });
    req.on('error', mal);
  });
}
const error = (status, msg) => Object.assign(new Error(msg), { status });

// Archivos de la web: en memoria, con ETag
const estaticos = new Map();
function servirEstatico(req, res, ruta) {
  if (ruta === '/') ruta = '/index.html';
  const archivo = path.normalize(path.join(WEB, ruta));
  if (!archivo.startsWith(WEB + path.sep)) return false;
  let e = estaticos.get(archivo);
  if (!e || config.DEMO) {
    if (!fs.existsSync(archivo) || !fs.statSync(archivo).isFile()) return false;
    const datos = fs.readFileSync(archivo);
    e = { datos, etag: '"' + require('node:crypto').createHash('sha1').update(datos).digest('base64').slice(0, 20) + '"', tipo: TIPOS[path.extname(archivo)] || 'application/octet-stream' };
    estaticos.set(archivo, e);
  }
  if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, { ETag: e.etag }); res.end(); return true; }
  res.writeHead(200, { ...SEGURIDAD, 'Content-Type': e.tipo, ETag: e.etag, 'Cache-Control': ruta.startsWith('/fuentes/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'Content-Length': e.datos.length });
  res.end(req.method === 'HEAD' ? undefined : e.datos);
  return true;
}

// ---------------------------------------------------------------- agentes: intentos con clave errónea
const malasClaves = new Map();
function claveFallida(ip) {
  const f = malasClaves.get(ip) || { n: 0, hasta: 0 }; f.n++;
  if (f.n >= 20) { f.hasta = Date.now() + 10 * 60000; f.n = 0; log(`Demasiados informes con clave errónea desde ${ip}: bloqueado 10 minutos.`); }
  malasClaves.set(ip, f);
}

// ---------------------------------------------------------------- rutas
const rutas = [];
const ruta = (metodo, patron, opc, fn) => rutas.push({ metodo, patron: new RegExp('^' + patron.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), ...opc, fn });

const soloAdmin = { admin: true };

// Sesión
ruta('GET', '/api/sesion', { publica: true }, ({ sesion }) => {
  if (!auth.hayCuentas()) return { configurar: true };
  if (!sesion) throw Object.assign(error(401, 'Inicia sesión.'), { login: true });
  return { usuario: sesion.usuario, rol: sesion.rol, csrf: sesion.csrf, clientes: sesion.clientes, grupos: sesion.grupos, version: config.VERSION, demo: config.DEMO };
});
ruta('POST', '/api/configurar', { publica: true }, ({ cuerpo, res, req }) => {
  auth.crearPrimera(cuerpo.codigo, String(cuerpo.usuario || '').trim(), cuerpo.clave);
  return iniciarSesion(req, res, String(cuerpo.usuario || '').trim(), cuerpo.clave);
});
ruta('POST', '/api/login', { publica: true }, ({ cuerpo, req, res }) => iniciarSesion(req, res, String(cuerpo.usuario || '').trim(), cuerpo.clave));
function iniciarSesion(req, res, usuario, clave) {
  const id = auth.iniciar(usuario, clave, ipDe(req));
  res.setHeader('Set-Cookie', `nodecat=${id}; Path=/; HttpOnly; SameSite=Strict${esHttps(req) ? '; Secure' : ''}`);
  const s = auth.sesion(id);
  log(`${s.usuario} inició sesión desde ${ipDe(req)}.`);
  return { usuario: s.usuario, rol: s.rol, csrf: s.csrf, clientes: s.clientes, version: config.VERSION, demo: config.DEMO };
}
ruta('POST', '/api/logout', {}, ({ sesion, res }) => { auth.cerrar(sesion.id); res.setHeader('Set-Cookie', 'nodecat=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict'); return { ok: true }; });
ruta('POST', '/api/clave', {}, ({ sesion, cuerpo }) => { auth.cambiarClave(sesion.usuario, cuerpo.actual, cuerpo.nueva); return { ok: true }; });

// Estado e historial
ruta('GET', '/api/estado', {}, ({ sesion }) => flota.estado(sesion));
function equipoVisible(sesion, id) {
  const e = flota.equipo(Number(id));
  if (!e || !flota.puedeVer(sesion, e.cliente_id)) throw error(404, 'Ese equipo no existe o no tienes acceso.');
  return e;
}
ruta('GET', '/api/equipos/:id/metricas', {}, ({ sesion, p, url }) => { const e = equipoVisible(sesion, p.id); return flota.metricas(e.id, url.searchParams.get('rango')); });
ruta('GET', '/api/equipos/:id/sucesos', {}, ({ sesion, p, url }) => { const e = equipoVisible(sesion, p.id); return flota.sucesosEquipo(e.id, Math.min(400, Number(url.searchParams.get('dias')) || 90)); });
ruta('GET', '/api/equipos/:id/trafico', {}, ({ sesion, p, url }) => { const e = equipoVisible(sesion, p.id); return flota.trafico(e.id, url.searchParams.get('rango'), url.searchParams.get('interfaz')); });

// Routers MikroTik
function routerVisible(sesion, id) { const e = equipoVisible(sesion, id); if (e.tipo !== 'mikrotik') throw error(404, 'Ese equipo no es un router.'); return e; }
ruta('GET', '/api/routers/:id/vivo', {}, ({ sesion, p }) => { const e = routerVisible(sesion, p.id); const v = mikrotik.vivo(e.id) || { serie: {} }; if (sesion.rol !== 'admin') delete v.config; return v; });
ruta('GET', '/api/routers/:id/seccion/:nombre', {}, async ({ sesion, p }) => { const e = routerVisible(sesion, p.id); return { datos: await mikrotik.seccion(e.id, p.nombre) }; });
ruta('POST', '/api/routers/:id/herramienta', {}, async ({ sesion, p, cuerpo }) => { const e = routerVisible(sesion, p.id); return { resultado: await mikrotik.herramienta(e.id, cuerpo.tipo, cuerpo.destino) }; });
ruta('POST', '/api/routers/probar', soloAdmin, async ({ cuerpo }) => mikrotik.probar(cuerpo, cuerpo.id ? Number(cuerpo.id) : null));
ruta('POST', '/api/clientes/:id/routers', soloAdmin, ({ p, cuerpo, sesion }) => {
  const id = mikrotik.crear(Number(p.id), cuerpo.nombre, cuerpo); log(`${sesion.usuario} agregó el router ${cuerpo.nombre}.`); return { id };
});
ruta('PUT', '/api/routers/:id', soloAdmin, ({ p, cuerpo }) => { mikrotik.editar(Number(p.id), cuerpo.nombre, cuerpo); return { ok: true }; });

ruta('GET', '/api/historial/sesiones', {}, ({ sesion, url, res }) => {
  const f = Object.fromEntries(url.searchParams);
  if (f.cliente && !flota.puedeVer(sesion, Number(f.cliente))) throw error(404, 'Ese cliente no existe o no tienes acceso.');
  const filas = flota.historialSesiones(sesion, f);
  if (f.csv !== '1') return { sesiones: filas };
  const zona = { timeZone: config.ZONA_HORARIA };
  const fecha = t => t ? new Date(t).toLocaleString('es', { ...zona, hour12: false }) : '';
  const c = v => { const s = String(v == null ? '' : v); return /[";\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"' : s; };
  const lineas = ['Cliente;Equipo;Usuario;Dominio;Desde el equipo;Inicio;Fin;Duración (min);Desconexiones'];
  for (const s of filas) lineas.push([s.cliente, s.equipo, s.usuario, s.dominio, s.origen, fecha(s.inicio), s.fin ? fecha(s.fin) : 'Abierta', Math.round(((s.fin || Date.now()) - s.inicio) / 60000), s.desconexiones].map(c).join(';'));
  const b = Buffer.from('﻿' + lineas.join('\r\n'), 'utf8');
  res.writeHead(200, { ...SEGURIDAD, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="nodecat-sesiones.csv"`, 'Cache-Control': 'no-store' });
  res.end(b);
});
ruta('GET', '/api/eventos', {}, ({ sesion }) => ({ eventos: flota.eventosRecientes(sesion) }));
ruta('GET', '/api/equipos/:id/rdp', {}, ({ sesion, p, res }) => {
  const e = equipoVisible(sesion, p.id);
  const b = Buffer.from(`full address:s:${e.nombre}\r\nprompt for credentials:i:1\r\nadministrative session:i:0\r\nscreen mode id:i:2\r\n`, 'utf8');
  res.writeHead(200, { ...SEGURIDAD, 'Content-Type': 'application/x-rdp', 'Content-Disposition': `attachment; filename="${e.nombre}.rdp"`, 'Cache-Control': 'no-store' });
  res.end(b);
});

// Administración: clientes y equipos
ruta('GET', '/api/clientes', soloAdmin, ({ req }) => ({
  clientes: flota.clientes().map(c => ({ ...c, clave: flota.cliente(c.id).clave })), grupos: flota.grupos(), url: urlPublica(req), urlGuardada: ajustes.leer('urlAgentes', ''), agente: paquete.disponible()
}));
ruta('POST', '/api/clientes', soloAdmin, ({ cuerpo, sesion }) => { const id = flota.crearCliente(cuerpo.nombre, cuerpo.notas, cuerpo.grupo); log(`${sesion.usuario} creó el cliente ${cuerpo.nombre}.`); return { id }; });
ruta('PUT', '/api/clientes/:id', soloAdmin, ({ p, cuerpo }) => { flota.editarCliente(Number(p.id), cuerpo.nombre, cuerpo.notas, cuerpo.grupo); return { ok: true }; });
ruta('GET', '/api/grupos', soloAdmin, () => ({ grupos: flota.grupos() }));
ruta('PUT', '/api/grupos/:id', soloAdmin, ({ p, cuerpo }) => { flota.renombrarGrupo(Number(p.id), cuerpo.nombre); return { ok: true }; });
ruta('DELETE', '/api/grupos/:id', soloAdmin, ({ p }) => { flota.borrarGrupo(Number(p.id)); return { ok: true }; });
ruta('DELETE', '/api/clientes/:id', soloAdmin, ({ p }) => { flota.borrarCliente(Number(p.id)); return { ok: true }; });
ruta('POST', '/api/clientes/:id/clave', soloAdmin, ({ p, sesion }) => {
  const c = flota.cliente(Number(p.id)); if (!c) throw error(404, 'Ese cliente no existe.');
  flota.nuevaClave(c.id); log(`${sesion.usuario} generó una clave nueva para los agentes de ${c.nombre}.`); return { ok: true };
});
ruta('GET', '/api/clientes/:id/agente', { ...soloAdmin, token: true }, ({ p, req, res }) => {
  const c = flota.cliente(Number(p.id)); if (!c) throw error(404, 'Ese cliente no existe.');
  const b = paquete.crear(c, urlPublica(req));
  const nombre = 'NodeCat-Agente-' + c.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.zip';
  res.writeHead(200, { ...SEGURIDAD, 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${nombre}"`, 'Content-Length': b.length, 'Cache-Control': 'no-store' });
  res.end(b);
});
ruta('PUT', '/api/ajustes/url', soloAdmin, ({ cuerpo }) => {
  const u = String(cuerpo.url || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(u)) throw error(400, 'Escribe una dirección completa, por ejemplo https://nodecat.miempresa.com');
  ajustes.guardar('urlAgentes', u); return { ok: true };
});
ruta('PUT', '/api/equipos/:id', soloAdmin, ({ p, cuerpo }) => { flota.editarEquipo(Number(p.id), { alias: cuerpo.alias, cliente_id: cuerpo.cliente != null ? Number(cuerpo.cliente) : null }); return { ok: true }; });
ruta('DELETE', '/api/equipos/:id', soloAdmin, ({ p, sesion }) => { const e = flota.equipo(Number(p.id)); if (e) { mikrotik.quitar(e.id); flota.borrarEquipo(e.id); log(`${sesion.usuario} quitó el equipo ${e.nombre}.`); } return { ok: true }; });

// Cuentas
ruta('GET', '/api/cuentas', soloAdmin, () => ({ cuentas: auth.cuentas() }));
ruta('POST', '/api/cuentas', soloAdmin, ({ cuerpo, sesion }) => {
  auth.guardarCuenta({ usuario: String(cuerpo.usuario || '').trim(), clave: cuerpo.clave, rol: cuerpo.rol, clientes: cuerpo.clientes, grupos: cuerpo.grupos }, !!cuerpo.nueva);
  log(`${sesion.usuario} ${cuerpo.nueva ? 'creó' : 'modificó'} la cuenta ${cuerpo.usuario}.`); return { ok: true };
});
ruta('DELETE', '/api/cuentas/:usuario', soloAdmin, ({ p, sesion }) => {
  const u = decodeURIComponent(p.usuario);
  if (u.toLowerCase() === sesion.usuario.toLowerCase()) throw error(400, 'No puedes borrar tu propia cuenta.');
  auth.borrarCuenta(u); log(`${sesion.usuario} borró la cuenta ${u}.`); return { ok: true };
});

// Notificaciones
ruta('GET', '/api/notificaciones', soloAdmin, () => avisos.info());
ruta('PUT', '/api/notificaciones', soloAdmin, ({ cuerpo, sesion }) => { avisos.guardarDesdeWeb(cuerpo, sesion.usuario); return avisos.info(); });
ruta('POST', '/api/notificaciones/probar', soloAdmin, async ({ cuerpo }) => ({ bot: await avisos.probar(cuerpo.token, cuerpo.chats) }));
ruta('POST', '/api/notificaciones/chats', soloAdmin, async ({ cuerpo }) => avisos.buscarChats(cuerpo.token));
ruta('POST', '/api/notificaciones/resumen', soloAdmin, () => { avisos.enviarResumen(); return { ok: true }; });

// Agentes
ruta('POST', '/api/agente/informe', { publica: true, agente: true }, async ({ req }) => {
  const ip = ipDe(req);
  const f = malasClaves.get(ip);
  if (f && f.hasta > Date.now()) throw error(429, 'Demasiados intentos con una clave errónea. Espera unos minutos.');
  const clave = req.headers['x-nodecat-agente'] || req.headers['x-vigia-agente'];
  const cuerpo = await leerCuerpo(req, 2 * 1024 * 1024);
  try { const r = flota.recibir(clave, cuerpo, ip); avisos.evaluar(); return r; }
  catch (e) { if (e.status === 403) claveFallida(ip); throw e; }
});
ruta('GET', '/salud', { publica: true }, () => ({ ok: true, version: config.VERSION }));

// ---------------------------------------------------------------- servidor
async function atender(req, res) {
  const url = new URL(req.url, 'http://x');
  const r = rutas.find(x => x.metodo === req.method && x.patron.test(url.pathname));
  if (!r) {
    if ((req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api/') && servirEstatico(req, res, url.pathname)) return;
    return json(res, 404, { error: 'No existe esa dirección.' });
  }
  const p = url.pathname.match(r.patron).groups || {};
  const sesion = auth.sesion(cookie(req, 'nodecat'));
  if (!r.publica) {
    if (!sesion) throw Object.assign(error(401, 'Tu sesión terminó. Vuelve a entrar.'), { login: true });
    if (r.admin && sesion.rol !== 'admin') throw error(403, 'Solo un administrador puede hacer esto.');
    // Protección CSRF: las peticiones que cambian algo llevan el token de la sesión; las descargas, en ?t=
    const tk = req.headers['x-nodecat-token'] || (r.token ? url.searchParams.get('t') : null);
    if ((req.method !== 'GET' || r.token) && !iguales(tk, sesion.csrf)) throw error(403, 'Falta el token de seguridad. Recarga la página.');
  } else if (req.method === 'POST' && !r.agente && req.headers['x-nodecat'] !== '1') {
    throw error(403, 'Petición no permitida.');
  }
  const cuerpo = (req.method === 'POST' || req.method === 'PUT') && !r.agente ? await leerCuerpo(req) : {};
  const datos = await r.fn({ req, res, url, p, sesion, cuerpo });
  if (!res.headersSent && datos !== undefined) json(res, 200, datos);
}

const servidor = http.createServer((req, res) => {
  atender(req, res).catch(e => {
    const interno = e instanceof TypeError || e instanceof ReferenceError || e instanceof SyntaxError || e.code;
    const status = e.status || (interno ? 500 : 400);
    if (status >= 500) log(`Error en ${req.method} ${req.url}: ${e.stack || e.message}`);
    if (!res.headersSent) json(res, status, { error: status >= 500 ? 'Error interno de NodeCat. Revisa el registro del contenedor.' : e.message, login: e.login || undefined });
    else res.end();
  });
});
servidor.keepAliveTimeout = 65000;
servidor.requestTimeout = 30000;

const demo = config.DEMO ? require('./lib/demo') : null;
if (demo) demo.preparar();
flota.arrancar();
avisos.arrancar();
flota.alBorrarEquipo = id => mikrotik.quitar(id);
flota.alCambiar(() => avisos.evaluar(true));   // caídas y vueltas: aviso por Telegram sin esperar al siguiente repaso
mikrotik.arrancar(demo ? require('./lib/mikrotik-demo') : null);
if (demo) demo.arrancar();
auth.prepararInicio();
setInterval(() => { flota.vigilar(); }, 10000).unref();
setInterval(() => { auth.limpiar(); }, 10 * 60000).unref();
setInterval(() => { try { flota.mantenimiento(); } catch (e) { log('Mantenimiento: ' + e.message); } }, 3600e3).unref();
setTimeout(() => { try { flota.mantenimiento(); } catch (e) { log('Mantenimiento: ' + e.message); } }, 60000).unref();

servidor.listen(config.PUERTO, () => {
  log(`NodeCat ${config.VERSION}${config.DEMO ? ' (modo demo)' : ''} escuchando en el puerto ${config.PUERTO}. Datos en ${config.DATA_DIR}.`);
  if (!paquete.disponible()) log('Aviso: falta agente/NodeCatAgente.exe; no se podrá descargar el agente.');
});
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { log('Deteniendo NodeCat…'); servidor.close(); process.exit(0); });
