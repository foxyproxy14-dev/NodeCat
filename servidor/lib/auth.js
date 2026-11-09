'use strict';
// Cuentas, contraseñas (PBKDF2-SHA256), sesiones con cookie y protección contra fuerza bruta.
const crypto = require('node:crypto');
const { q } = require('./db');
const { aleatorio, iguales, log } = require('./util');

const ITERACIONES = 210000;
const INACTIVIDAD = 60 * 60 * 1000;        // la sesión caduca tras 1 h sin uso
const MAXIMO = 12 * 60 * 60 * 1000;        // y siempre a las 12 h
const INTENTOS = 5, BLOQUEO = 5 * 60 * 1000;
const ROLES = ['admin', 'lector'];

function hash(clave) {
  const sal = crypto.randomBytes(16);
  const h = crypto.pbkdf2Sync(clave, sal, ITERACIONES, 32, 'sha256');
  return `pbkdf2-sha256$${ITERACIONES}$${sal.toString('base64')}$${h.toString('base64')}`;
}
function comprobar(clave, guardado) {
  const p = String(guardado || '').split('$');
  if (p.length !== 4 || p[0] !== 'pbkdf2-sha256') return false;
  const h = crypto.pbkdf2Sync(clave, Buffer.from(p[2], 'base64'), parseInt(p[1], 10), 32, 'sha256');
  const g = Buffer.from(p[3], 'base64');
  return g.length === h.length && crypto.timingSafeEqual(g, h);
}

function validarClave(clave) {
  if (typeof clave !== 'string' || clave.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (clave.length > 200) return 'La contraseña es demasiado larga.';
  return null;
}
function validarUsuario(u) {
  if (!/^[a-zA-Z0-9._@-]{2,40}$/.test(u || '')) return 'El usuario solo puede tener letras sin tilde, números, punto, guion o arroba (de 2 a 40).';
  return null;
}

const hayCuentas = () => q('SELECT COUNT(*) n FROM usuarios').get().n > 0;

// Código de un solo uso para crear la primera cuenta (se imprime en el registro del contenedor)
let codigoInicial = null;
function prepararInicio() {
  if (hayCuentas()) return;
  codigoInicial = String(crypto.randomInt(100000, 999999));
  log('──────────────────────────────────────────────────────────────');
  log(`Primera vez: abre Atalaya en el navegador y usa este código para crear la cuenta de administrador: ${codigoInicial}`);
  log('──────────────────────────────────────────────────────────────');
}
function crearPrimera(codigo, usuario, clave) {
  if (hayCuentas() || !codigoInicial) throw new Error('Atalaya ya está configurado. Inicia sesión.');
  if (!iguales(String(codigo || '').trim(), codigoInicial)) throw new Error('El código no coincide. Búscalo en el registro del contenedor (docker compose logs atalaya).');
  guardarCuenta({ usuario, clave, rol: 'admin', clientes: null }, true);
  codigoInicial = null;
}

function guardarCuenta({ usuario, clave, rol, clientes, grupos }, nueva) {
  const e = validarUsuario(usuario); if (e) throw new Error(e);
  if (!ROLES.includes(rol)) throw new Error('Rol no válido.');
  let lista = Array.isArray(clientes) && clientes.length ? JSON.stringify(clientes.map(Number)) : null;
  const listaG = Array.isArray(grupos) && grupos.length ? JSON.stringify(grupos.map(Number)) : null;
  // Con grupos y sin clientes sueltos, la lista de clientes queda vacía pero no "todos"
  if (listaG && !lista) lista = '[]';
  const existe = q('SELECT usuario FROM usuarios WHERE usuario = ?').get(usuario);
  if (nueva && existe) throw new Error(`Ya existe la cuenta ${usuario}.`);
  if (!existe) {
    const ec = validarClave(clave); if (ec) throw new Error(ec);
    q('INSERT INTO usuarios (usuario, rol, hash, clientes, grupos, creado) VALUES (?, ?, ?, ?, ?, ?)').run(usuario, rol, hash(clave), lista, listaG, Date.now());
    log(`Cuenta creada: ${usuario} (${rol}).`);
  } else {
    if (rol !== 'admin' && esUltimoAdmin(usuario)) throw new Error('Debe quedar al menos una cuenta de administrador.');
    q('UPDATE usuarios SET rol = ?, clientes = ?, grupos = ? WHERE usuario = ?').run(rol, lista, listaG, usuario);
    if (clave) {
      const ec = validarClave(clave); if (ec) throw new Error(ec);
      q('UPDATE usuarios SET hash = ? WHERE usuario = ?').run(hash(clave), usuario);
      q('DELETE FROM sesiones_web WHERE usuario = ?').run(usuario);
    }
  }
}
function esUltimoAdmin(usuario) {
  const r = q("SELECT rol FROM usuarios WHERE usuario = ?").get(usuario);
  return r && r.rol === 'admin' && q("SELECT COUNT(*) n FROM usuarios WHERE rol = 'admin'").get().n <= 1;
}
function borrarCuenta(usuario) {
  if (esUltimoAdmin(usuario)) throw new Error('No se puede borrar la última cuenta de administrador.');
  q('DELETE FROM sesiones_web WHERE usuario = ?').run(usuario);
  q('DELETE FROM usuarios WHERE usuario = ?').run(usuario);
}
function cuentas() {
  return q('SELECT usuario, rol, clientes, grupos, creado, ultimo_acceso FROM usuarios ORDER BY usuario').all()
    .map(c => ({ ...c, clientes: c.clientes ? JSON.parse(c.clientes) : null, grupos: c.grupos ? JSON.parse(c.grupos) : null }));
}
function cambiarClave(usuario, actual, nueva) {
  const r = q('SELECT hash FROM usuarios WHERE usuario = ?').get(usuario);
  if (!r || !comprobar(actual || '', r.hash)) throw new Error('La contraseña actual no es correcta.');
  const e = validarClave(nueva); if (e) throw new Error(e);
  q('UPDATE usuarios SET hash = ? WHERE usuario = ?').run(hash(nueva), usuario);
}

// ---- Fuerza bruta: por IP ----
const fallos = new Map();
function bloqueado(ip) {
  const f = fallos.get(ip);
  return f && f.hasta > Date.now() ? Math.ceil((f.hasta - Date.now()) / 60000) : 0;
}
function fallo(ip) {
  const f = fallos.get(ip) || { n: 0, hasta: 0 };
  f.n++;
  if (f.n >= INTENTOS) { f.hasta = Date.now() + BLOQUEO; f.n = 0; log(`Demasiados intentos fallidos desde ${ip}: bloqueado 5 minutos.`); }
  fallos.set(ip, f);
}

function iniciar(usuario, clave, ip) {
  const min = bloqueado(ip);
  if (min) throw new Error(`Demasiados intentos. Espera ${min} min y vuelve a probar.`);
  const r = q('SELECT usuario, hash FROM usuarios WHERE usuario = ?').get(String(usuario || ''));
  // Se calcula el hash aunque la cuenta no exista, para no revelar qué usuarios hay
  const ok = r ? comprobar(String(clave || ''), r.hash) : (comprobar('x', hash('y')), false);
  if (!ok) { fallo(ip); throw new Error('Usuario o contraseña incorrectos.'); }
  fallos.delete(ip);
  const id = aleatorio(32), csrf = aleatorio(24), ahora = Date.now();
  q('INSERT INTO sesiones_web (id, usuario, csrf, creada, ultimo) VALUES (?, ?, ?, ?, ?)').run(id, r.usuario, csrf, ahora, ahora);
  q('UPDATE usuarios SET ultimo_acceso = ? WHERE usuario = ?').run(ahora, r.usuario);
  return id;
}

function sesion(id) {
  if (!id) return null;
  const s = q(`SELECT s.id, s.usuario, s.csrf, s.creada, s.ultimo, u.rol, u.clientes, u.grupos FROM sesiones_web s
               JOIN usuarios u ON u.usuario = s.usuario WHERE s.id = ?`).get(id);
  if (!s) return null;
  const ahora = Date.now();
  if (ahora - s.ultimo > INACTIVIDAD || ahora - s.creada > MAXIMO) { cerrar(id); return null; }
  if (ahora - s.ultimo > 30000) q('UPDATE sesiones_web SET ultimo = ? WHERE id = ?').run(ahora, id);
  return { id: s.id, usuario: s.usuario, csrf: s.csrf, rol: s.rol, clientes: alcance(s.clientes, s.grupos), grupos: s.grupos ? JSON.parse(s.grupos) : null };
}
// Clientes que puede ver una cuenta: los elegidos uno a uno más todos los de sus grupos (también los que se agreguen después)
function alcance(clientes, grupos) {
  if (!clientes && !grupos) return null;
  const ids = new Set(clientes ? JSON.parse(clientes) : []);
  const g = grupos ? JSON.parse(grupos) : [];
  if (g.length) for (const r of q(`SELECT id FROM clientes WHERE grupo_id IN (${g.map(() => '?').join(',')})`).all(...g)) ids.add(r.id);
  return [...ids];
}
const cerrar = id => q('DELETE FROM sesiones_web WHERE id = ?').run(id);
function limpiar() {
  const ahora = Date.now();
  q('DELETE FROM sesiones_web WHERE ultimo < ? OR creada < ?').run(ahora - INACTIVIDAD, ahora - MAXIMO);
  for (const [ip, f] of fallos) if (f.hasta < ahora && f.n === 0) fallos.delete(ip);
}

module.exports = { ROLES, hayCuentas, prepararInicio, crearPrimera, guardarCuenta, borrarCuenta, cuentas, cambiarClave, iniciar, sesion, cerrar, limpiar, hash };
