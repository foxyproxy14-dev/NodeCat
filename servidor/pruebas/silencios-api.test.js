'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('API: acceso de lector, aislamiento por cuenta y validación de equipo y VM', { timeout: 30000 }, async () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'nodecat-api-'));
  const net = require('node:net');
  const reserva = net.createServer();
  reserva.listen(0, '127.0.0.1'); await once(reserva, 'listening');
  const puerto = reserva.address().port;
  await new Promise(resolve => reserva.close(resolve));
  const proceso = spawn(process.execPath, [path.join(__dirname, '..', 'nodecat.js')], {
    env: { ...process.env, DATA_DIR: carpeta, NODECAT_DEMO: '1', PUERTO: String(puerto) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let salida = ''; proceso.stdout.on('data', x => { salida += x; }); proceso.stderr.on('data', x => { salida += x; });
  const base = `http://127.0.0.1:${puerto}`;
  try {
    for (let i = 0; i < 100; i++) {
      if (proceso.exitCode != null) throw new Error(salida);
      try { if ((await fetch(base + '/salud')).ok) break; } catch { }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    async function login(usuario) {
      const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-nodecat': '1' }, body: JSON.stringify({ usuario, clave: 'nodecat-demo' }) });
      assert.equal(r.status, 200, salida);
      const d = await r.json();
      return { Cookie: r.headers.get('set-cookie').split(';')[0], 'x-nodecat-token': d.csrf, 'Content-Type': 'application/json' };
    }
    const limitado = await login('andes'), admin = await login('demo');
    const creada = await fetch(base + '/api/cuentas', { method: 'POST', headers: admin, body: JSON.stringify({ usuario: 'lector-prueba', clave: 'nodecat-demo', rol: 'lector', nueva: true, clientes: null }) });
    assert.equal(creada.status, 200);
    const lector = await login('lector-prueba');
    const estado = async headers => (await fetch(base + '/api/estado', { headers })).json();
    const cambiar = (headers, id, cuerpo) => fetch(base + `/api/equipos/${id}/silencio`, { method: 'PUT', headers, body: JSON.stringify(cuerpo) });
    const mio = await estado(lector), todos = await estado(admin), restringido = await estado(limitado);
    const visibles = mio.clientes.flatMap(c => c.equipos), otros = todos.clientes.flatMap(c => c.equipos).filter(e => !restringido.clientes.flatMap(c => c.equipos).some(v => v.id === e.id));
    const host = visibles.find(e => e.vms?.length); assert.ok(host);
    assert.equal((await cambiar(lector, host.id, { silenciado: true })).status, 200);
    assert.ok((await estado(lector)).silencios.some(x => x.equipo === host.id));
    assert.deepEqual((await estado(admin)).silencios, []);
    const vm = String(host.vms[0].id || host.vms[0].nombre);
    assert.equal((await cambiar(lector, host.id, { silenciado: true, vm })).status, 200);
    assert.equal((await cambiar(lector, host.id, { silenciado: false })).status, 200);
    assert.deepEqual((await estado(lector)).silencios, [{ equipo: host.id, vm }]);
    assert.equal((await cambiar(lector, host.id, { silenciado: true, vm: 'no-existe' })).status, 404);
    assert.equal((await cambiar(lector, host.id, { silenciado: 'si' })).status, 400);
    assert.ok(otros.length);
    assert.equal((await cambiar(limitado, otros[0].id, { silenciado: true })).status, 404);
    assert.equal((await cambiar({ ...lector, 'x-nodecat-token': 'incorrecto' }, host.id, { silenciado: true })).status, 403);
  } finally {
    proceso.kill(); await once(proceso, 'exit');
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});
