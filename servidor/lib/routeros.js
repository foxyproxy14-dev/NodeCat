'use strict';
// Cliente mínimo de la API de RouterOS (protocolo binario, puertos 8728 y 8729 con SSL).
// Funciona con RouterOS 6 y 7. Solo se usan comandos de lectura (print).
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

// ---- Codificación de longitudes y palabras ----
function longitud(n) {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x4000) return Buffer.from([(n >> 8) | 0x80, n & 0xFF]);
  if (n < 0x200000) return Buffer.from([(n >> 16) | 0xC0, (n >> 8) & 0xFF, n & 0xFF]);
  if (n < 0x10000000) return Buffer.from([(n >>> 24) | 0xE0, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF]);
  return Buffer.from([0xF0, (n >>> 24) & 0xFF, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF]);
}
function frase(palabras) {
  const partes = [];
  for (const p of palabras) { const b = Buffer.from(p, 'utf8'); partes.push(longitud(b.length), b); }
  partes.push(Buffer.from([0]));
  return Buffer.concat(partes);
}
// Lee una longitud en buf[i]; devuelve [longitud, bytes usados] o null si faltan datos
function leerLongitud(buf, i) {
  if (i >= buf.length) return null;
  const c = buf[i];
  const n = (c & 0x80) === 0 ? 1 : (c & 0xC0) === 0x80 ? 2 : (c & 0xE0) === 0xC0 ? 3 : (c & 0xF0) === 0xE0 ? 4 : 5;
  if (i + n > buf.length) return null;
  if (n === 1) return [c, 1];
  if (n === 2) return [((c & 0x3F) << 8) | buf[i + 1], 2];
  if (n === 3) return [((c & 0x1F) << 16) | (buf[i + 1] << 8) | buf[i + 2], 3];
  if (n === 4) return [(((c & 0x0F) << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]) >>> 0, 4];
  return [buf.readUInt32BE(i + 1), 5];
}

class ErrorRouter extends Error { constructor(m, tipo) { super(m); this.tipo = tipo; } }

class Conexion {
  constructor({ host, puerto, ssl, usuario, clave, tiempo = 10000 }) {
    this.o = { host, puerto: puerto || (ssl ? 8729 : 8728), ssl: !!ssl, usuario, clave, tiempo };
    this.sock = null; this.buf = Buffer.alloc(0); this.palabras = [];
    this.pendientes = new Map(); this.siguiente = 1; this.lista = false;
  }

  conectar() {
    return new Promise((ok, mal) => {
      const { host, puerto, ssl, tiempo } = this.o;
      let hecho = false;
      const fin = e => { if (hecho) return; hecho = true; clearTimeout(t); e ? mal(e) : ok(); };
      const t = setTimeout(() => { fin(new ErrorRouter(`El router ${host}:${puerto} no responde (tiempo agotado). Revisa la IP, el puerto y que el servicio ${ssl ? 'api-ssl' : 'api'} esté activo y permitido desde Atalaya.`, 'red')); this.cerrar(); }, tiempo);
      const alConectar = () => fin();
      this.sock = ssl
        // Los routers suelen tener certificados propios o ninguno (cifrado anónimo): no se puede verificar la identidad
        ? tls.connect({ host, port: puerto, rejectUnauthorized: false, ciphers: 'DEFAULT:ADH-AES256-GCM-SHA384:ADH-AES128-SHA256:ADH-AES256-SHA:@SECLEVEL=0', minVersion: 'TLSv1' }, alConectar)
        : net.connect({ host, port: puerto }, alConectar);
      this.sock.setKeepAlive(true, 30000);
      this.sock.on('data', d => this.recibir(d));
      this.sock.on('error', e => {
        const m = e.code === 'ECONNREFUSED' ? `El router ${host} rechaza la conexión en el puerto ${puerto}. Activa el servicio ${ssl ? 'api-ssl' : 'api'} en IP > Services.`
          : e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' ? `No hay ruta hasta ${host}. ¿Está la VPN levantada?`
          : e.code === 'ENOTFOUND' ? `No se encuentra el nombre ${host}.`
          : `Error de conexión con ${host}: ${e.message}`;
        const err = new ErrorRouter(m, 'red');
        fin(err); this.fallarTodo(err);
      });
      this.sock.on('close', () => { this.lista = false; this.fallarTodo(new ErrorRouter('Se cerró la conexión con el router.', 'red')); });
    }).then(() => this.iniciarSesion()).then(() => { this.lista = true; });
  }

  async iniciarSesion() {
    const { usuario, clave } = this.o;
    let r;
    try { r = await this.ejecutar(['/login', `=name=${usuario}`, `=password=${clave}`]); }
    catch (e) { throw this.errorLogin(e); }
    // RouterOS anterior a 6.43: responde con un desafío
    const ret = r.done && r.done.ret;
    if (ret) {
      const md5 = crypto.createHash('md5').update(Buffer.concat([Buffer.from([0]), Buffer.from(clave, 'utf8'), Buffer.from(ret, 'hex')])).digest('hex');
      try { await this.ejecutar(['/login', `=name=${usuario}`, `=response=00${md5}`]); }
      catch (e) { throw this.errorLogin(e); }
    }
  }
  errorLogin(e) {
    if (e.tipo === 'trap') return new ErrorRouter('El router rechazó el usuario o la contraseña.', 'login');
    return e;
  }

  recibir(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    let i = 0;
    while (true) {
      const l = leerLongitud(this.buf, i); if (!l) break;
      const [n, usados] = l;
      if (i + usados + n > this.buf.length) break;
      const palabra = this.buf.toString('utf8', i + usados, i + usados + n);
      i += usados + n;
      if (n === 0) { this.procesar(this.palabras); this.palabras = []; }
      else this.palabras.push(palabra);
    }
    this.buf = this.buf.subarray(i);
  }

  procesar(p) {
    if (!p.length) return;
    const tipo = p[0], attr = {};
    let tag = null;
    for (const w of p.slice(1)) {
      if (w.startsWith('.tag=')) { tag = w.slice(5); continue; }
      if (w[0] === '=') { const k = w.indexOf('=', 1); attr[w.slice(1, k)] = w.slice(k + 1); }
    }
    if (tipo === '!fatal') { this.fallarTodo(new ErrorRouter('El router cerró la sesión: ' + (p[1] || ''), 'red')); this.cerrar(); return; }
    const pd = tag && this.pendientes.get(tag);
    if (!pd) return;
    if (tipo === '!re') pd.filas.push(attr);
    else if (tipo === '!trap') pd.error = new ErrorRouter(attr.message || 'El router devolvió un error.', 'trap');
    else if (tipo === '!done') {
      this.pendientes.delete(tag); clearTimeout(pd.t);
      pd.error ? pd.mal(pd.error) : pd.ok({ filas: pd.filas, done: attr });
    }
  }

  ejecutar(palabras, tiempo = this.o.tiempo) {
    return new Promise((ok, mal) => {
      if (!this.sock || this.sock.destroyed) return mal(new ErrorRouter('No hay conexión con el router.', 'red'));
      const tag = String(this.siguiente++);
      const t = setTimeout(() => { this.pendientes.delete(tag); mal(new ErrorRouter(`El router tardó demasiado en responder a ${palabras[0]}.`, 'red')); }, tiempo);
      this.pendientes.set(tag, { ok, mal, filas: [], t });
      this.sock.write(frase([...palabras, `.tag=${tag}`]));
    });
  }

  /** Lectura: imprimir(['/interface/print'], { proplist: [...], filtros: {...}, extra: [...] }) */
  async imprimir(ruta, { proplist, filtros, extra, tiempo } = {}) {
    const p = [ruta];
    if (proplist) p.push('=.proplist=' + proplist.join(','));
    if (extra) p.push(...extra);
    if (filtros) for (const [k, v] of Object.entries(filtros)) p.push(`?${k}=${v}`);
    return (await this.ejecutar(p, tiempo)).filas;
  }

  fallarTodo(e) {
    for (const [tag, pd] of this.pendientes) { clearTimeout(pd.t); pd.mal(e); }
    this.pendientes.clear();
  }
  cerrar() { this.lista = false; try { this.sock && this.sock.destroy(); } catch { } this.sock = null; }
}

// "1w2d3h4m5s" o "00:01:02" → segundos
function segundos(t) {
  if (!t) return null;
  if (/^\d+:\d+:\d+$/.test(t)) { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + s; }
  let s = 0, ok = false;
  for (const [, n, u] of String(t).matchAll(/(\d+(?:\.\d+)?)(w|d|h|ms|m|s)/g)) {
    ok = true; s += Number(n) * ({ w: 604800, d: 86400, h: 3600, m: 60, s: 1, ms: 0.001 })[u];
  }
  return ok ? Math.round(s) : null;
}

module.exports = { Conexion, ErrorRouter, segundos, frase, leerLongitud, longitud };
