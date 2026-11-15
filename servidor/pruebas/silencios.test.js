'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'nodecat-silencios-'));
process.env.DATA_DIR = carpeta;
const { q, cerrar } = require('../lib/db');
const silencios = require('../lib/silencios');
const push = require('../lib/push');

test('campanas personales: filtran envíos, conservan invitados y persisten', async () => {
  const fetchAnterior = global.fetch;
  try {
    for (const u of ['ana', 'bea']) q('INSERT INTO usuarios (usuario, rol, hash) VALUES (?, ?, ?)').run(u, 'lectura', 'prueba');
    q("INSERT INTO clientes (id, nombre, clave) VALUES (1, 'Cliente', 'clave')").run();
    for (const id of [1, 2]) q('INSERT INTO equipos (id, cliente_id, tipo, nombre) VALUES (?, 1, ?, ?)').run(id, 'proxmox', `host-${id}`);
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    for (const u of ['ana', 'bea']) push.suscribir({ usuario: u }, { endpoint: `https://fcm.googleapis.com/${u}`, keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url')
    } }, 'Prueba');
    let destinos = [];
    global.fetch = async url => { destinos.push(url); return { ok: true, status: 201 }; };
    async function enviar(equipo, vm) {
      destinos = [];
      push.notificar({ titulo: 'Prueba', cuerpo: 'Aviso', clienteId: 1, tipo: vm ? 'vms' : 'caidas', equipo, vm });
      await new Promise(resolve => setImmediate(resolve));
      return destinos.map(x => x.split('/').pop()).sort();
    }
    assert.deepEqual(await enviar(1), ['ana', 'bea']);
    silencios.guardar('ANA', 1, '100', true);
    assert.deepEqual(await enviar(1, '100'), ['bea']);
    assert.deepEqual(await enviar(1, '101'), ['ana', 'bea']);
    assert.deepEqual(await enviar(1), ['ana', 'bea']);
    silencios.guardar('ana', 1, '', true);
    assert.deepEqual(await enviar(1), ['bea']);
    assert.deepEqual(await enviar(1, '101'), ['bea']);
    assert.deepEqual(await enviar(2), ['ana', 'bea']);
    push.guardarPreferencias({ usuario: 'ana' }, { clientes: [1], tipos: Object.keys(push.TIPOS) });
    assert.equal(silencios.lista('ana').length, 2);
    silencios.guardar('ana', 1, '', false);
    assert.deepEqual(await enviar(1, '100'), ['bea']);
    assert.deepEqual(await enviar(1, '101'), ['ana', 'bea']);
    // Leer con otra conexión verifica que la preferencia quedó en disco.
    const { DatabaseSync } = require('node:sqlite');
    const otra = new DatabaseSync(path.join(carpeta, 'nodecat.db'));
    assert.equal(otra.prepare('SELECT COUNT(*) n FROM push_silencios').get().n, 1);
    otra.close();
    q('DELETE FROM equipos WHERE id = 1').run();
    assert.deepEqual(silencios.lista('ana'), []);
  } finally {
    global.fetch = fetchAnterior;
    cerrar();
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});
