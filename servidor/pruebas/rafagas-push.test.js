'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'nodecat-rafagas-'));
process.env.DATA_DIR = carpeta;
const { q, cerrar } = require('../lib/db');
const push = require('../lib/push');

test('ráfagas Web Push: agrupa múltiples avisos simultáneos en una sola notificación', async () => {
  const fetchAnterior = global.fetch;
  try {
    q('INSERT INTO usuarios (usuario, rol, hash) VALUES (?, ?, ?)').run('admin', 'admin', 'prueba');
    q("INSERT INTO clientes (id, nombre, clave) VALUES (1, 'Acme Corp', 'clave1')").run();
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    push.suscribir({ usuario: 'admin' }, {
      endpoint: 'https://fcm.googleapis.com/admin',
      keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') }
    }, 'Prueba');

    let envios = 0;
    global.fetch = async () => { envios++; return { ok: true, status: 201 }; };

    // Simulamos una tormenta de 15 avisos al volver el internet / servidor
    for (let i = 1; i <= 15; i++) {
      push.notificar({
        titulo: `🟢 SRV-${i} vuelve a responder`,
        cuerpo: 'Acme Corp\nEstuvo sin responder 5 min.',
        clienteId: 1,
        tipo: 'caidas',
        equipo: i
      });
    }
    push.vaciarCola();
    await new Promise(resolve => setImmediate(resolve));

    // En lugar de 15 notificaciones Web Push separadas, solo se envía 1 notificación agrupada
    assert.equal(envios, 1);

    // Verificamos el formato del resumen de ráfaga
    const resumen = push._resumirRafaga([
      { titulo: '🟢 PVE-01 vuelve a responder', cuerpo: '', clienteId: 1, tipo: 'caidas', equipo: 1 },
      { titulo: '🟢 PVE-01: la VM 100 volvió a encenderse', cuerpo: '', clienteId: 1, tipo: 'vms', equipo: 1, vm: '100' },
      { titulo: '🟢 PVE-01: el contenedor 101 volvió a encenderse', cuerpo: '', clienteId: 1, tipo: 'vms', equipo: 1, vm: '101' }
    ]);
    assert.match(resumen.t, /🟢 Acme Corp: 3 equipos\/servicios volvieron/);
    assert.match(resumen.b, /PVE-01 vuelve a responder/);
    assert.equal(resumen.u, '/#/e/1');
    assert.equal(resumen.g, 'nodecat-rafaga-c1');
  } finally {
    global.fetch = fetchAnterior;
    cerrar();
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});
