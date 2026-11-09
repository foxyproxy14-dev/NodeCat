'use strict';
// Router MikroTik falso para probar el cliente de la API sin hardware: node pruebas/router-falso.js [puerto]
const net = require('node:net');
const { frase, leerLongitud } = require('../lib/routeros');

const PUERTO = Number(process.argv[2] || 18728);
const inicio = Date.now();
let rx = 1e9, tx = 2e8;

function respuestas(cmd, attrs) {
  const re = o => ['!re', ...Object.entries(o).map(([k, v]) => `=${k}=${v}`)];
  switch (cmd) {
    case '/system/resource/print':
      return [re({ 'cpu-load': 7 + Math.floor(Math.random() * 20), 'free-memory': 600e6, 'total-memory': 1024e6, uptime: '3d4h5m6s', version: '7.16.1 (stable)', 'board-name': 'RB5009UG+S+', 'architecture-name': 'arm64' })];
    case '/system/identity/print': return [re({ name: 'Router-Prueba' })];
    case '/system/health/print': return [re({ name: 'temperature', value: 44, type: 'C' }), re({ name: 'voltage', value: 24.1, type: 'V' })];
    case '/interface/print':
      rx += 3e6 + Math.random() * 2e6; tx += 4e5;
      return [re({ name: 'ether1', type: 'ether', running: 'true', disabled: 'false', 'rx-byte': Math.round(rx), 'tx-byte': Math.round(tx), comment: 'WAN' }),
        re({ name: 'bridge', type: 'bridge', running: 'true', disabled: 'false', 'rx-byte': Math.round(tx), 'tx-byte': Math.round(rx) })];
    case '/ip/route/print': return [re({ 'dst-address': '0.0.0.0/0', gateway: '200.1.1.1', 'immediate-gw': '200.1.1.1%ether1', active: 'true' })];
    case '/ip/firewall/connection/print': return [['!done', '=ret=321']];
    case '/interface/wifi/registration-table/print': return [['!trap', '=message=no such command prefix']];
    default: return [];
  }
}

net.createServer(sock => {
  let buf = Buffer.alloc(0), palabras = [], sesion = false;
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    let i = 0;
    while (true) {
      const l = leerLongitud(buf, i); if (!l) break;
      const [n, u] = l; if (i + u + n > buf.length) break;
      const w = buf.toString('utf8', i + u, i + u + n); i += u + n;
      if (n) { palabras.push(w); continue; }
      const p = palabras; palabras = [];
      const cmd = p[0], tag = (p.find(x => x.startsWith('.tag=')) || '').slice(5);
      const attrs = Object.fromEntries(p.filter(x => x[0] === '=').map(x => { const k = x.indexOf('=', 1); return [x.slice(1, k), x.slice(k + 1)]; }));
      const enviar = palabras2 => sock.write(frase([...palabras2, `.tag=${tag}`]));
      if (cmd === '/login') {
        if (attrs.name === 'lector' && attrs.password === 'clave') { sesion = true; enviar(['!done']); }
        else { enviar(['!trap', '=message=invalid user name or password (6)']); enviar(['!done']); }
        continue;
      }
      if (!sesion) { sock.write(frase(['!fatal', 'not logged in'])); sock.end(); return; }
      const r = respuestas(cmd, attrs);
      let done = false;
      for (const x of r) { enviar(x); if (x[0] === '!done') done = true; }
      if (!done) enviar(['!done']);
    }
    buf = buf.subarray(i);
  });
  sock.on('error', () => { });
}).listen(PUERTO, () => console.log(`Router falso en el puerto ${PUERTO} (usuario lector, clave "clave")`));
