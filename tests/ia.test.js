'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { diagnosticarFailover } = require('../servidor/lib/diagnostico-ia');
const { consultar } = require('../servidor/lib/openrouter-ia');

test('failover: distingue ruta principal y respaldo', () => {
  const r = diagnosticarFailover({ routes: [
    { 'dst-address': '0.0.0.0/0', gateway: '10.0.0.1', distance: '1', active: true },
    { 'dst-address': '0.0.0.0/0', gateway: '10.0.1.1', distance: '2', active: true }
  ] });
  assert.equal(r.tablas[0].principal.gateway, '10.0.0.1');
  assert.equal(r.tablas[0].respaldo.gateway, '10.0.1.1');
  assert.equal(r.modo, 'solo-lectura');
});
test('failover: detecta ECMP', () => {
  const r = diagnosticarFailover({ routes: [
    { 'dst-address': '0.0.0.0/0', gateway: 'a', distance: 1 },
    { 'dst-address': '0.0.0.0/0', gateway: 'b', distance: 1 }
  ] });
  assert.match(r.tablas[0].alertas.join(' '), /ECMP/);
});
test('failover: exige snapshot valido', () => {
  assert.throws(() => diagnosticarFailover({}), /routes/);
});
test('OpenRouter: rechaza consulta sin credenciales', () => {
  const antes = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    assert.throws(() => consultar({ usuario: 'test', equipo: { tipo: 'mikrotik' }, pregunta: 'Diagnostica el failover', contexto: {} }), /OPENROUTER_API_KEY/);
  } finally {
    if (antes !== undefined) process.env.OPENROUTER_API_KEY = antes;
  }
});
