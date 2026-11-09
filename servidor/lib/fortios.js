'use strict';
// Cliente mínimo de la API REST de FortiOS (FortiGate 6.4 y 7.x). Solo lectura (GET) con un token de usuario de API.
const https = require('node:https');

class ErrorForti extends Error { constructor(m, tipo, codigo) { super(m); this.tipo = tipo; this.codigo = codigo; } }

class FortiOS {
  constructor({ host, puerto, token, verificar, vdom, tiempo = 10000 }) {
    this.o = { host, puerto: puerto || 443, token, verificar: !!verificar, vdom: vdom || '', tiempo };
    // Los FortiGate suelen tener certificado propio: solo se verifica si se pide
    this.agente = new https.Agent({ keepAlive: true, maxSockets: 4, rejectUnauthorized: this.o.verificar });
  }

  get(ruta, params = {}, tiempo = this.o.tiempo) {
    const q = new URLSearchParams(params);
    if (this.o.vdom && !q.has('vdom')) q.set('vdom', this.o.vdom);
    const camino = '/api/v2/' + ruta.replace(/^\/+/, '') + (q.toString() ? '?' + q : '');
    const { host, puerto, token } = this.o;
    return new Promise((ok, mal) => {
      const req = https.request({ host, port: puerto, path: camino, method: 'GET', agent: this.agente, timeout: tiempo,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, res => {
        const partes = [];
        res.on('data', c => partes.push(c));
        res.on('end', () => {
          const texto = Buffer.concat(partes).toString('utf8');
          let o = null; try { o = JSON.parse(texto); } catch { }
          if (res.statusCode === 401) return mal(new ErrorForti('El FortiGate rechazó el token. Revisa que esté bien copiado y que la IP de NodeCat esté en los "Trusted hosts" del usuario de API.', 'login', 401));
          if (res.statusCode === 403) return mal(new ErrorForti(`El usuario de API no tiene permiso para leer ${ruta}. Dale lectura en su perfil de administrador.`, 'permiso', 403));
          if (res.statusCode === 404) return mal(new ErrorForti(`Esta versión de FortiOS no tiene ${ruta}.`, 'falta', 404));
          if (res.statusCode >= 400 || !o) return mal(new ErrorForti(`El FortiGate respondió ${res.statusCode}${o && o.error ? ': ' + o.error : ''}.`, 'otro', res.statusCode));
          ok(o);
        });
      });
      req.on('timeout', () => { req.destroy(new ErrorForti(`El FortiGate ${host}:${puerto} no responde (tiempo agotado). Revisa la IP, el puerto de administración HTTPS y que se permita el acceso desde NodeCat.`, 'red')); });
      req.on('error', e => {
        if (e instanceof ErrorForti) return mal(e);
        const m = e.code === 'ECONNREFUSED' ? `El FortiGate ${host} rechaza la conexión en el puerto ${puerto}. Revisa el puerto de administración HTTPS (admin-sport) y que HTTPS esté permitido en esa interfaz.`
          : e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' ? `No hay ruta hasta ${host}. ¿Está la VPN levantada?`
          : e.code === 'ENOTFOUND' ? `No se encuentra el nombre ${host}.`
          : /certificate|self.signed|CERT/i.test(e.message) ? 'El certificado del FortiGate no es válido para NodeCat. Desmarca "Verificar el certificado" o instala uno válido.'
          : `Error de conexión con ${host}: ${e.message}`;
        mal(new ErrorForti(m, 'red'));
      });
      req.end();
    });
  }
  cerrar() { this.agente.destroy(); }
}

module.exports = { FortiOS, ErrorForti };
