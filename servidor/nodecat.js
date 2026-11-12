'use strict';
// NodeCat: panel de monitoreo por clientes. Punto de entrada y servidor web.
process.removeAllListeners('warning');   // el aviso "SQLite is experimental" no aporta nada al registro
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./lib/config');
const { log, iguales } = require('./lib/util');
const { ajustes, q: dbq } = require('./lib/db');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const auth = require('./lib/auth');
const flota = require('./lib/flota');
const avisos = require('./lib/avisos');
const paquete = require('./lib/paquete');
const mikrotik = require('./lib/mikrotik');
const fortigate = require('./lib/fortigate');
const sonda = require('./lib/sonda');
const compartir = require('./lib/compartir');
const modRed = e => e.tipo === 'fortigate' ? fortigate : mikrotik;

const WEB = path.join(__dirname, 'web');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
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
// Compresión: las respuestas de más de 1 KB van con gzip si el navegador lo acepta (el estado pasa de ~80 KB a ~12 KB)
const aceptaGzip = req => /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
function json(res, status, datos, extra = {}) {
  let b = Buffer.from(JSON.stringify(datos));
  const cab = { ...SEGURIDAD, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra };
  if (b.length > 1024 && res.req && aceptaGzip(res.req)) { b = zlib.gzipSync(b, { level: 6 }); cab['Content-Encoding'] = 'gzip'; cab.Vary = 'Accept-Encoding'; }
  cab['Content-Length'] = b.length;
  res.writeHead(status, cab);
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
function servirEstatico(req, res, ruta, extra = {}) {
  if (ruta === '/') ruta = '/index.html';
  const archivo = path.normalize(path.join(WEB, ruta));
  if (!archivo.startsWith(WEB + path.sep)) return false;
  let e = estaticos.get(archivo);
  // En la demo se vuelve a leer el archivo si cambió (para probar cambios sin reiniciar)
  if (!e || (config.DEMO && (!fs.existsSync(archivo) || fs.statSync(archivo).mtimeMs !== e.mtime))) {
    if (!fs.existsSync(archivo) || !fs.statSync(archivo).isFile()) return false;
    const mtime = fs.statSync(archivo).mtimeMs;
    const datos = fs.readFileSync(archivo);
    const tipo = TIPOS[path.extname(archivo)] || 'application/octet-stream';
    // Texto (html, js, css, svg, manifiesto): se comprime una vez y queda en memoria
    const gz = /^(text\/|image\/svg|application\/manifest)/.test(tipo) && datos.length > 1024 ? zlib.gzipSync(datos, { level: 9 }) : null;
    e = { datos, gz, mtime, etag: '"' + crypto.createHash('sha1').update(datos).digest('base64').slice(0, 20) + '"', tipo };
    estaticos.set(archivo, e);
  }
  const comprimido = e.gz && aceptaGzip(req);
  // El ETag cambia con la codificación para que ninguna caché intermedia mezcle las dos versiones
  const etag = comprimido ? e.etag.slice(0, -1) + '-gz"' : e.etag;
  const cab = e.gz ? { Vary: 'Accept-Encoding' } : {};
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, ...cab }); res.end(); return true; }
  const cuerpo = comprimido ? e.gz : e.datos;
  res.writeHead(200, { ...SEGURIDAD, ...extra, ...cab, ...(comprimido ? { 'Content-Encoding': 'gzip' } : {}), 'Content-Type': e.tipo, ETag: etag, 'Cache-Control': ruta.startsWith('/fuentes/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'Content-Length': cuerpo.length });
  res.end(req.method === 'HEAD' ? undefined : cuerpo);
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
  return { usuario: sesion.usuario, rol: sesion.rol, csrf: sesion.csrf, clientes: sesion.clientes, grupos: sesion.grupos, equipos: sesion.equipos, version: config.VERSION, demo: config.DEMO };
});
ruta('POST', '/api/configurar', { publica: true }, ({ cuerpo, res, req }) => {
  auth.crearPrimera(cuerpo.codigo, String(cuerpo.usuario || '').trim(), cuerpo.clave);
  return iniciarSesion(req, res, String(cuerpo.usuario || '').trim(), cuerpo.clave);
});
ruta('POST', '/api/login', { publica: true }, ({ cuerpo, req, res }) => iniciarSesion(req, res, String(cuerpo.usuario || '').trim(), cuerpo.clave, cuerpo.codigo));
function iniciarSesion(req, res, usuario, clave, codigo) {
  let id;
  try { id = auth.iniciar(usuario, clave, ipDe(req), codigo); }
  catch (e) { if (e.dosPasos) { res.writeHead(401, { ...SEGURIDAD, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: e.message, dosPasos: true })); return; } throw e; }
  res.setHeader('Set-Cookie', `nodecat=${id}; Path=/; HttpOnly; SameSite=Strict${esHttps(req) ? '; Secure' : ''}`);
  const s = auth.sesion(id);
  log(`${s.usuario} inició sesión desde ${ipDe(req)}.`);
  return { usuario: s.usuario, rol: s.rol, csrf: s.csrf, clientes: s.clientes, version: config.VERSION, demo: config.DEMO };
}
ruta('POST', '/api/logout', {}, ({ sesion, res }) => { auth.cerrar(sesion.id); res.setHeader('Set-Cookie', 'nodecat=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict'); return { ok: true }; });
// Verificación en dos pasos
ruta('GET', '/api/dos-pasos', {}, ({ sesion }) => auth.dosPasosEstado(sesion.usuario));
ruta('POST', '/api/dos-pasos/preparar', {}, ({ sesion }) => auth.dosPasosPreparar(sesion.usuario));
ruta('POST', '/api/dos-pasos/activar', {}, ({ sesion, cuerpo }) => ({ codigos: auth.dosPasosActivar(sesion.usuario, cuerpo.codigo) }));
ruta('POST', '/api/dos-pasos/quitar', {}, ({ sesion, cuerpo }) => { auth.dosPasosQuitar(sesion.usuario, cuerpo); return { ok: true }; });
ruta('DELETE', '/api/cuentas/:usuario/dos-pasos', soloAdmin, ({ p, sesion }) => { const u = decodeURIComponent(p.usuario); if (u.toLowerCase() === sesion.usuario.toLowerCase()) throw error(400, 'Para tu propia cuenta, usa Verificación en dos pasos en tu menú.'); auth.dosPasosQuitar(u, {}, sesion.usuario); return { ok: true }; });
ruta('POST', '/api/clave', {}, ({ sesion, cuerpo }) => { auth.cambiarClave(sesion.usuario, cuerpo.actual, cuerpo.nueva); return { ok: true }; });

// Estado e historial
ruta('GET', '/api/estado', {}, ({ sesion }) => flota.estado(sesion));
function equipoVisible(sesion, id) {
  const e = flota.equipo(Number(id));
  if (!e || !flota.veEquipo(sesion, e.cliente_id, e.id)) throw error(404, 'Ese equipo no existe o no tienes acceso.');
  return e;
}
ruta('GET', '/api/equipos/:id/metricas', {}, ({ sesion, p, url }) => { const e = equipoVisible(sesion, p.id); return flota.metricas(e.id, url.searchParams.get('rango')); });
ruta('GET', '/api/equipos/:id/sucesos', {}, ({ sesion, p, url }) => { const e = equipoVisible(sesion, p.id); return flota.sucesosEquipo(e.id, Math.min(400, Number(url.searchParams.get('dias')) || 90)); });
ruta('POST', '/api/equipos/:id/actualizar-agente', soloAdmin, ({ sesion, p }) => { const e = equipoVisible(sesion, p.id); const r = flota.pedirActualizacion([e.id]); log(`${sesion.usuario} pidió actualizar el agente de ${e.nombre}.`); return r; });
ruta('POST', '/api/clientes/:id/actualizar-agentes', soloAdmin, ({ sesion, p }) => {
  const c = flota.cliente(Number(p.id)); if (!c || !flota.puedeVer(sesion, c.id)) throw error(404, 'Ese cliente no existe.');
  const ids = [...flota.vivo.values()].filter(v => v.cliente_id === c.id && flota.veEquipo(sesion, c.id, v.id)).map(v => v.id);
  const r = flota.pedirActualizacion(ids); log(`${sesion.usuario} pidió actualizar los agentes de ${c.nombre} (${r.pedidos}).`); return r;
});
ruta('GET', '/api/equipos/:id/salud', {}, ({ sesion, p }) => flota.saludDiscos(equipoVisible(sesion, p.id).id));
ruta('GET', '/api/equipos/:id/proxmox', {}, ({ sesion, p }) => { const e = equipoVisible(sesion, p.id); return { ...flota.detallesPve(e.id), personal: appsPersonal(e.id), logosApps: logosApps() }; });
ruta('GET', '/api/equipos/:id/trafico', {}, ({ sesion, p, url }) => { const e = equipoVisible(sesion, p.id); return flota.trafico(e.id, url.searchParams.get('rango'), url.searchParams.get('interfaz')); });

// Routers MikroTik
function routerVisible(sesion, id) { const e = equipoVisible(sesion, id); if (e.tipo !== 'mikrotik' && e.tipo !== 'fortigate') throw error(404, 'Ese equipo no es un equipo de red.'); return e; }
ruta('GET', '/api/routers/:id/vivo', {}, ({ sesion, p, url }) => { const e = routerVisible(sesion, p.id); const v = modRed(e).vivo(e.id, url.searchParams.get('desde')) || { serie: {} }; if (sesion.rol !== 'admin') delete v.config; return v; });
ruta('GET', '/api/routers/:id/logs', {}, ({ sesion, p, url }) => { const e = routerVisible(sesion, p.id); if (e.tipo !== 'fortigate') throw error(400, 'Solo los FortiGate guardan logs.'); return fortigate.logs(e.id, Object.fromEntries(url.searchParams)); });
ruta('GET', '/api/routers/:id/logs/:fila', {}, ({ sesion, p }) => { const e = routerVisible(sesion, p.id); const d = fortigate.detalleLog(e.id, p.fila); if (!d) throw error(404, 'Ese registro ya no existe.'); return { log: d }; });
ruta('GET', '/api/routers/:id/seccion/:nombre', {}, async ({ sesion, p }) => { const e = routerVisible(sesion, p.id); return { datos: await modRed(e).seccion(e.id, p.nombre) }; });
ruta('POST', '/api/routers/:id/herramienta', {}, async ({ sesion, p, cuerpo }) => { const e = routerVisible(sesion, p.id); if (e.tipo !== 'mikrotik') throw error(400, 'Herramienta solo disponible en MikroTik.'); return { resultado: await mikrotik.herramienta(e.id, cuerpo.tipo, cuerpo.destino) }; });
ruta('POST', '/api/routers/probar', soloAdmin, async ({ cuerpo }) => (cuerpo.tipo === 'fortigate' ? fortigate : mikrotik).probar(cuerpo, cuerpo.id ? Number(cuerpo.id) : null));
ruta('POST', '/api/clientes/:id/fortigates', soloAdmin, ({ p, cuerpo, sesion }) => {
  const id = fortigate.crear(Number(p.id), cuerpo.nombre, cuerpo); if (cuerpo.sede !== undefined) flota.editarEquipo(id, { sede: cuerpo.sede }); log(`${sesion.usuario} agregó el FortiGate ${cuerpo.nombre}.`); return { id };
});
ruta('POST', '/api/clientes/:id/routers', soloAdmin, ({ p, cuerpo, sesion }) => {
  const id = mikrotik.crear(Number(p.id), cuerpo.nombre, cuerpo); if (cuerpo.sede !== undefined) flota.editarEquipo(id, { sede: cuerpo.sede }); log(`${sesion.usuario} agregó el router ${cuerpo.nombre}.`); return { id };
});
ruta('PUT', '/api/routers/:id', soloAdmin, ({ p, cuerpo, sesion }) => { const e = routerVisible(sesion, p.id); modRed(e).editar(e.id, cuerpo.nombre, cuerpo); if (cuerpo.sede !== undefined) flota.editarEquipo(e.id, { sede: cuerpo.sede }); return { ok: true }; });

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
ruta('GET', '/api/clientes/:id/instalador', { ...soloAdmin, token: true }, ({ p, req, res }) => {
  const c = flota.cliente(Number(p.id)); if (!c) throw error(404, 'Ese cliente no existe.');
  const b = paquete.instalador(c, urlPublica(req));
  res.writeHead(200, { ...SEGURIDAD, 'Content-Type': 'application/vnd.microsoft.portable-executable', 'Content-Disposition': `attachment; filename="NodeCat-Agente-${paquete.nombreArchivo(c)}.exe"`, 'Content-Length': b.length, 'Cache-Control': 'no-store' });
  res.end(b);
});
// Linux y Proxmox: instalación con una línea (la clave del cliente va en la dirección, como en el instalador de Windows)
ruta('GET', '/instalar/:clave', { publica: true }, ({ p, req, res }) => {
  const ip = ipDe(req), f = malasClaves.get(ip);
  if (f && f.hasta > Date.now()) throw error(429, 'Demasiados intentos con una clave errónea. Espera unos minutos.');
  const tipo = /\.ps1$/.test(p.clave) ? 'ps1' : /\.exe$/.test(p.clave) ? 'exe' : 'sh';
  const clave = String(p.clave).replace(/\.(sh|ps1|exe)$/, '');
  const c = flota.clientes().map(x => flota.cliente(x.id)).find(x => x.clave === clave);
  if (!c) {
    claveFallida(ip); res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(tipo === 'ps1' ? "Write-Host 'Este comando de instalación ya no es válido. Cópialo de nuevo desde NodeCat.' -ForegroundColor Red\n" : 'echo "Este comando de instalación ya no es válido. Cópialo de nuevo desde NodeCat."; exit 1\n'); return;
  }
  // Windows: el script de PowerShell y el .exe que ese script descarga (ya configurado para el cliente)
  if (tipo === 'exe') {
    const b = paquete.instalador(c, urlPublica(req));
    res.writeHead(200, { ...SEGURIDAD, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': b.length }); res.end(b); return;
  }
  if (tipo === 'ps1') {
    const b = Buffer.from(paquete.scriptWindows(c, urlPublica(req)), 'utf8');
    res.writeHead(200, { ...SEGURIDAD, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': b.length }); res.end(b); return;
  }
  const b = Buffer.from(paquete.scriptLinux(c, urlPublica(req)));
  res.writeHead(200, { ...SEGURIDAD, 'Content-Type': 'text/x-shellscript; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': b.length });
  res.end(b);
});
ruta('GET', '/agente/nodecat-agente.py', { publica: true }, ({ res }) => {
  const b = paquete.agentePython();
  res.writeHead(200, { ...SEGURIDAD, 'Content-Type': 'text/x-python; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Length': b.length });
  res.end(b);
});
ruta('PUT', '/api/ajustes/url', soloAdmin, ({ cuerpo }) => {
  const u = String(cuerpo.url || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(u)) throw error(400, 'Escribe una dirección completa, por ejemplo https://nodecat.miempresa.com');
  ajustes.guardar('urlAgentes', u); return { ok: true };
});
ruta('PUT', '/api/equipos/:id', soloAdmin, ({ p, cuerpo, sesion }) => { equipoVisible(sesion, p.id); if (cuerpo.cliente != null && !flota.puedeVer(sesion, Number(cuerpo.cliente))) throw error(404, 'Ese cliente no existe.'); flota.editarEquipo(Number(p.id), { alias: cuerpo.alias, cliente_id: cuerpo.cliente != null ? Number(cuerpo.cliente) : null, sede: cuerpo.sede }); return { ok: true }; });
ruta('DELETE', '/api/equipos/:id', soloAdmin, ({ p, sesion }) => { const e = flota.equipo(Number(p.id)); if (e && flota.veEquipo(sesion, e.cliente_id, e.id)) { mikrotik.quitar(e.id); fortigate.quitar(e.id); flota.borrarEquipo(e.id); log(`${sesion.usuario} quitó el equipo ${e.nombre}.`); } return { ok: true }; });

// Cuentas
ruta('GET', '/api/cuentas', soloAdmin, () => ({ cuentas: auth.cuentas() }));
// Notificaciones en los dispositivos de cada cuenta (Web Push)
const push = require('./lib/push');
ruta('GET', '/api/push', {}, ({ sesion }) => push.estado(sesion));
ruta('POST', '/api/push/suscribir', {}, ({ sesion, cuerpo, req }) => { push.suscribir(sesion, cuerpo.suscripcion, req.headers['user-agent']); if (cuerpo.preferencias) push.guardarPreferencias(sesion, cuerpo.preferencias); return push.estado(sesion); });
ruta('POST', '/api/push/quitar', {}, ({ sesion, cuerpo }) => { push.quitar(sesion, cuerpo.endpoint); return push.estado(sesion); });
ruta('PUT', '/api/push/preferencias', {}, ({ sesion, cuerpo }) => { push.guardarPreferencias(sesion, cuerpo); return push.estado(sesion); });
ruta('POST', '/api/push/probar', {}, ({ sesion }) => push.probar(sesion));
ruta('POST', '/api/cuentas', soloAdmin, ({ cuerpo, sesion }) => {
  auth.guardarCuenta({ usuario: String(cuerpo.usuario || '').trim(), clave: cuerpo.clave, rol: cuerpo.rol, clientes: cuerpo.clientes, grupos: cuerpo.grupos, equipos: cuerpo.equipos }, !!cuerpo.nueva);
  if (cuerpo.push !== undefined) require('./lib/push').permitir(String(cuerpo.usuario || '').trim(), !!cuerpo.push);
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
ruta('POST', '/api/notificaciones/bots', soloAdmin, async ({ cuerpo, sesion }) => avisos.agregarBot(cuerpo, sesion.usuario));
ruta('PUT', '/api/notificaciones/bots/:id', soloAdmin, ({ p, cuerpo, sesion }) => avisos.editarBot(p.id, cuerpo, sesion.usuario));
ruta('DELETE', '/api/notificaciones/bots/:id', soloAdmin, ({ p, sesion }) => { avisos.quitarBot(p.id, sesion.usuario); return { ok: true }; });
ruta('POST', '/api/notificaciones/bots/:id/probar', soloAdmin, async ({ p }) => avisos.probarBot(p.id));
ruta('POST', '/api/notificaciones/bots/:id/buscar', soloAdmin, async () => { await avisos.vigilarBots(); return avisos.info(); });
ruta('POST', '/api/notificaciones/resumen', soloAdmin, () => { avisos.enviarResumen(); return { ok: true }; });

// Agentes
ruta('POST', '/api/agente/informe', { publica: true, agente: true }, async ({ req }) => {
  const ip = ipDe(req);
  const f = malasClaves.get(ip);
  if (f && f.hasta > Date.now()) throw error(429, 'Demasiados intentos con una clave errónea. Espera unos minutos.');
  const clave = req.headers['x-nodecat-agente'] || req.headers['x-vigia-agente'];
  const cuerpo = await leerCuerpo(req, 2 * 1024 * 1024);
  try {
    const r = flota.recibir(clave, cuerpo, ip); avisos.evaluar();
    // Actualización del agente de Windows pedida desde el panel: versión y huella del instalador que va a descargar
    if (r.actualizar) {
      const c = flota.clientes().map(x => flota.cliente(x.id)).find(x => x.clave === (r.clave || clave));
      if (c) { const b = paquete.instalador(c, urlPublica(req)); r.actualizar = { version: paquete.versionWindows(), sha256: crypto.createHash('sha256').update(b).digest('hex') }; }
      else delete r.actualizar;
    }
    return r;
  }
  catch (e) { if (e.status === 403) claveFallida(ip); throw e; }
});
ruta('POST', '/api/agente/sonda', { publica: true, agente: true }, async ({ req, res }) => {
  const ip = ipDe(req);
  const f = malasClaves.get(ip);
  if (f && f.hasta > Date.now()) throw error(429, 'Demasiados intentos con una clave errónea. Espera unos minutos.');
  const cuerpo = await leerCuerpo(req, 8 * 1024 * 1024);
  let id;
  try { id = flota.agenteDe(req.headers['x-nodecat-agente'], cuerpo.nombre); }
  catch (e) { if (e.status === 403) claveFallida(ip); throw e; }
  return sonda.atender(id, cuerpo.resultados, res);
});
// Enlaces de solo lectura para clientes (sin cuenta)
ruta('GET', '/api/clientes/:id/enlaces', soloAdmin, ({ p }) => ({ enlaces: compartir.lista(Number(p.id)) }));
ruta('POST', '/api/clientes/:id/enlaces', soloAdmin, ({ p, cuerpo, sesion }) => compartir.crear(Number(p.id), cuerpo, sesion.usuario));
ruta('DELETE', '/api/clientes/:id/enlaces/:enlace', soloAdmin, ({ p, sesion }) => { compartir.revocar(Number(p.id), p.enlace, sesion.usuario); return { ok: true }; });
ruta('GET', '/api/enlaces', soloAdmin, () => ({ enlaces: compartir.todos() }));
ruta('POST', '/api/enlaces/vencidos', soloAdmin, ({ sesion }) => ({ borrados: compartir.borrarVencidos(sesion.usuario) }));
ruta('GET', '/api/compartido/:token', { publica: true }, ({ p, req, res }) => {
  const d = compartir.vista(decodeURIComponent(p.token), ipDe(req));
  json(res, 200, d, { 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
});
// Logos propios de los sistemas: archivos que el usuario pone en DATA_DIR/logos (proxmox.svg, ubuntu.png…)
const LOGOS = path.join(config.DATA_DIR, 'logos');
const NOMBRES_LOGO = ['proxmox', 'ubuntu', 'debian', 'rocky', 'almalinux', 'redhat', 'centos', 'fedora', 'opensuse', 'arch', 'alpine', 'truenas', 'windows-server', 'windows', 'hyperv', 'linux', 'mikrotik', 'fortigate'];
let logosCache = { t: 0, l: [] };
function logosDisponibles() {
  if (Date.now() - logosCache.t < 60000) return logosCache.l;
  let l = [];
  try { l = fs.readdirSync(LOGOS).map(f => f.match(/^([a-z-]+)\.(svg|png|webp)$/)).filter(m => m && NOMBRES_LOGO.includes(m[1])).map(m => m[1] + '.' + m[2]); } catch { }
  logosCache = { t: Date.now(), l }; return l;
}
function imagenSubida(datos) {
  const b = Buffer.from(String(datos || ''), 'base64');
  if (!b.length || b.length > 512 * 1024) throw error(400, 'El archivo debe pesar menos de 512 KB.');
  const ini = b.subarray(0, 512).toString('utf8');
  const ext = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png'
    : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' ? 'webp'
    : /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(ini) ? 'svg' : null;
  if (!ext) throw error(400, 'Sube una imagen SVG, PNG o WebP.');
  return { b, ext };
}
const CABECERA_IMAGEN = f => ({ 'Content-Type': f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.png') ? 'image/png' : 'image/webp', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600' });

// Logos de apps (biblioteca común: se suben una vez y sirven para todos los servidores). Nombre = app en minúsculas sin espacios.
const LOGOS_APPS = path.join(LOGOS, 'apps');
const slugApp = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
let logosAppsCache = { t: 0, l: [] };
function logosApps() {
  if (Date.now() - logosAppsCache.t < 60000) return logosAppsCache.l;
  let l = [];
  try { l = fs.readdirSync(LOGOS_APPS).filter(f => /^[a-z0-9-]+\.(svg|png|webp)$/.test(f)); } catch { }
  logosAppsCache = { t: Date.now(), l }; return l;
}
ruta('GET', '/api/logos-apps', {}, () => ({ logos: logosApps() }));
ruta('PUT', '/api/logos-apps/:nombre', { ...soloAdmin, cuerpoMax: 800 * 1024 }, ({ p, cuerpo, sesion }) => {
  const nombre = slugApp(p.nombre); if (!nombre) throw error(400, 'Falta el nombre de la app.');
  const { b, ext } = imagenSubida(cuerpo.datos);
  fs.mkdirSync(LOGOS_APPS, { recursive: true });
  for (const e of ['svg', 'png', 'webp']) { try { fs.unlinkSync(path.join(LOGOS_APPS, `${nombre}.${e}`)); } catch { } }
  fs.writeFileSync(path.join(LOGOS_APPS, `${nombre}.${ext}`), b);
  logosAppsCache.t = 0; log(`${sesion.usuario} subió el logo de la app ${nombre}.`);
  return { logo: `${nombre}.${ext}`, logos: logosApps() };
});
ruta('DELETE', '/api/logos-apps/:nombre', soloAdmin, ({ p }) => {
  const nombre = slugApp(p.nombre);
  for (const e of ['svg', 'png', 'webp']) { try { fs.unlinkSync(path.join(LOGOS_APPS, `${nombre}.${e}`)); } catch { } }
  logosAppsCache.t = 0; return { logos: logosApps() };
});
ruta('GET', '/logos/apps/:archivo', {}, ({ p, res }) => {
  const f = String(p.archivo);
  if (!logosApps().includes(f)) throw error(404, 'No existe ese logo.');
  const b = fs.readFileSync(path.join(LOGOS_APPS, f));
  res.writeHead(200, { ...CABECERA_IMAGEN(f), 'Content-Length': b.length }); res.end(b);
});

// Apps de un servidor Proxmox editadas a mano (nombre, enlace, categoría, ocultar) o agregadas manualmente
const appsPersonal = id => dbq('SELECT clave, nombre, url, categoria, oculta, logo FROM apps_personal WHERE equipo_id = ?').all(id);
function servidorPve(sesion, id) { const e = equipoVisible(sesion, id); if (e.tipo !== 'proxmox') throw error(400, 'Ese equipo no es un Proxmox.'); return e; }
function limpiarApp(c) {
  const t = (x, n) => x == null ? null : String(x).trim().slice(0, n) || null;
  const url = t(c.url, 300);
  if (url && !/^https?:\/\/[^\s"'<>]+$/i.test(url)) throw error(400, 'El enlace debe empezar con http:// o https://');
  return { nombre: t(c.nombre, 80), url, categoria: t(c.categoria, 40), oculta: c.oculta ? 1 : 0, logo: c.logo ? slugApp(c.logo) || null : null };
}
ruta('PUT', '/api/equipos/:id/apps/:clave', soloAdmin, ({ sesion, p, cuerpo }) => {
  const e = servidorPve(sesion, p.id); const clave = String(p.clave).slice(0, 40);
  if (!/^[\w-]+$/.test(clave)) throw error(400, 'App no válida.');
  const a = limpiarApp(cuerpo);
  dbq(`INSERT INTO apps_personal (equipo_id, clave, nombre, url, categoria, oculta, logo, creada) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (equipo_id, clave) DO UPDATE SET nombre = excluded.nombre, url = excluded.url, categoria = excluded.categoria, oculta = excluded.oculta, logo = excluded.logo`)
    .run(e.id, clave, a.nombre, a.url, a.categoria, a.oculta, a.logo, Date.now());
  return { ok: true };
});
ruta('POST', '/api/equipos/:id/apps', soloAdmin, ({ sesion, p, cuerpo }) => {
  const e = servidorPve(sesion, p.id); const a = limpiarApp(cuerpo);
  if (!a.nombre) throw error(400, 'Escribe el nombre de la app.');
  const clave = 'm' + crypto.randomBytes(5).toString('hex');
  dbq('INSERT INTO apps_personal (equipo_id, clave, nombre, url, categoria, oculta, logo, creada) VALUES (?, ?, ?, ?, ?, 0, ?, ?)').run(e.id, clave, a.nombre, a.url, a.categoria, a.logo, Date.now());
  return { clave };
});
ruta('DELETE', '/api/equipos/:id/apps/:clave', soloAdmin, ({ sesion, p }) => {
  const e = servidorPve(sesion, p.id); dbq('DELETE FROM apps_personal WHERE equipo_id = ? AND clave = ?').run(e.id, String(p.clave)); return { ok: true };
});

ruta('GET', '/api/logos', { publica: true }, () => ({ logos: logosDisponibles(), nombres: NOMBRES_LOGO }));
// Subir o quitar un logo desde el panel (solo administradores)
ruta('PUT', '/api/logos/:nombre', { ...soloAdmin, cuerpoMax: 800 * 1024 }, ({ p, cuerpo, sesion }) => {
  const nombre = String(p.nombre);
  if (!NOMBRES_LOGO.includes(nombre)) throw error(400, 'Ese sistema no existe.');
  const { b, ext } = imagenSubida(cuerpo.datos);
  fs.mkdirSync(LOGOS, { recursive: true });
  for (const e of ['svg', 'png', 'webp']) { try { fs.unlinkSync(path.join(LOGOS, `${nombre}.${e}`)); } catch { } }
  fs.writeFileSync(path.join(LOGOS, `${nombre}.${ext}`), b);
  logosCache.t = 0;
  log(`${sesion.usuario} subió el logo de ${nombre}.`);
  return { logos: logosDisponibles() };
});
ruta('DELETE', '/api/logos/:nombre', soloAdmin, ({ p, sesion }) => {
  const nombre = String(p.nombre);
  if (!NOMBRES_LOGO.includes(nombre)) throw error(400, 'Ese sistema no existe.');
  for (const e of ['svg', 'png', 'webp']) { try { fs.unlinkSync(path.join(LOGOS, `${nombre}.${e}`)); } catch { } }
  logosCache.t = 0;
  log(`${sesion.usuario} quitó el logo de ${nombre}.`);
  return { logos: logosDisponibles() };
});
ruta('GET', '/logos/:archivo', { publica: true }, ({ p, res }) => {
  const f = String(p.archivo);
  if (!logosDisponibles().includes(f)) throw error(404, 'No existe ese logo.');
  const b = fs.readFileSync(path.join(LOGOS, f));
  // Un SVG puede llevar código: se sirve aislado (sin scripts) para que solo sirva como imagen
  res.writeHead(200, { ...CABECERA_IMAGEN(f), 'Content-Length': b.length });
  res.end(b);
});
ruta('GET', '/salud', { publica: true }, () => ({ ok: true, version: config.VERSION }));

// ---------------------------------------------------------------- servidor
async function atender(req, res) {
  const url = new URL(req.url, 'http://x');
  // Página pública de solo lectura: /v/<token>
  if ((req.method === 'GET' || req.method === 'HEAD') && /^\/v\/[A-Za-z0-9_-]{20,64}$/.test(url.pathname)) { servirEstatico(req, res, '/compartido.html', { 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' }); return; }
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
  const cuerpo = (req.method === 'POST' || req.method === 'PUT') && !r.agente ? await leerCuerpo(req, r.cuerpoMax) : {};
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
require('./lib/fglogs').alAlertar = (id, a) => { flota.evento(id, 'fg-alerta', `${a.texto.replace(/^[^\p{L}\d]+/u, '')}. ${a.det || ''}`.slice(0, 500)); require('./lib/avisos').fortigate(id, a); };
flota.alBorrarEquipo = id => { mikrotik.quitar(id); fortigate.quitar(id); fortigate.borrarLogs(id); };
flota.alNuevo = (id, o) => avisos.equipoNuevo(id, o);
flota.alCambiar(() => avisos.evaluar(true));   // caídas y vueltas: aviso por Telegram sin esperar al siguiente repaso
mikrotik.arrancar(demo ? require('./lib/mikrotik-demo') : null);
fortigate.arrancar(demo ? require('./lib/fortigate-demo') : null);
if (demo) demo.arrancar();
auth.prepararInicio();
setInterval(() => { flota.vigilar(); }, 10000).unref();
setInterval(() => { try { flota.guardarPendientes(); } catch (e) { log('Guardado: ' + e.message); } }, flota.GUARDAR_CADA).unref();
setInterval(() => { auth.limpiar(); }, 10 * 60000).unref();
setInterval(() => { try { flota.mantenimiento(); } catch (e) { log('Mantenimiento: ' + e.message); } }, 3600e3).unref();
setTimeout(() => { try { flota.mantenimiento(); } catch (e) { log('Mantenimiento: ' + e.message); } }, 60000).unref();

servidor.listen(config.PUERTO, () => {
  log(`NodeCat ${config.VERSION}${config.DEMO ? ' (modo demo)' : ''} escuchando en el puerto ${config.PUERTO}. Datos en ${config.DATA_DIR}.`);
  if (!paquete.disponible()) log('Aviso: falta agente/NodeCatAgente.exe; no se podrá descargar el agente.');
});
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => {
  log('Deteniendo NodeCat…'); servidor.close();
  try { flota.guardarPendientes(); require('./lib/db').cerrar(); } catch (e) { log('Al detener: ' + e.message); }
  process.exit(0);
});
