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

const { resumirTelemetria } = require('../servidor/lib/contexto-ia');
test('IA: resume métricas sin filtrar identificadores sensibles', () => {
  const x = resumirTelemetria({
    ultimo_contacto: 100000,
    datos: { cpu: 23, ramPct: 61, red: {
      identidad: 'CLIENTE-SECRETO', wan: { interfaz: 'pppoe-secret', activa: true, rx: 1000, tx: 2000 },
      interfaces: [{ nombre: 'wan-privada', mac: '00:11:22:33:44:55', tipo: 'ether', activa: true, rx: 500, tx: 300 }],
      latencia: [{ ip: '10.0.0.1', nombre: 'GW', ms: 11, perdida: 0 }]
    } }
  }, 110000);
  assert.equal(x.cpuPct, 23);
  assert.equal(x.ramPct, 61);
  assert.equal(x.wans[0].rxBps, 1000);
  assert.equal(x.obsoleta, false);
  const serial = JSON.stringify(x);
  for (const secreto of ['CLIENTE-SECRETO', 'pppoe-secret', 'wan-privada', '00:11:22:33:44:55', '10.0.0.1'])
    assert.equal(serial.includes(secreto), false);
});
test('IA: indica telemetria ausente u obsoleta', () => {
  assert.equal(resumirTelemetria(null).disponible, false);
  const x = resumirTelemetria({ ultimo_contacto: 1000, datos: {} }, 200000);
  assert.equal(x.obsoleta, true);
});

const { resumirRutasMikroTik } = require('../servidor/lib/contexto-ia');
test('IA: resumen de rutas conserva distancias y oculta gateways', () => {
  const x = resumirRutasMikroTik({ rutas: [
    { 'dst-address': '0.0.0.0/0', gateway: '192.0.2.1', 'routing-table': 'main', distance: '1', active: 'true', comment: 'ISP privado' },
    { 'dst-address': '0.0.0.0/0', gateway: '198.51.100.1', 'routing-table': 'main', distance: '2', active: 'false' },
    { 'dst-address': '10.0.0.0/8', gateway: '10.0.0.1', active: 'true' }
  ] });
  assert.equal(x.totalRutasDefault, 2);
  assert.equal(x.rutas[0].distancia, 1);
  assert.equal(x.rutas[1].activa, false);
  const serial = JSON.stringify(x);
  for (const secreto of ['192.0.2.1', '198.51.100.1', '10.0.0.1', 'ISP privado', 'main'])
    assert.equal(serial.includes(secreto), false);
});
test('IA: ruta ausente no se interpreta como ruta activa', () => {
  const x = resumirRutasMikroTik({ rutas: [{ 'dst-address': '0.0.0.0/0', gateway: '192.0.2.1', distance: 1 }] });
  assert.equal(x.rutas[0].activa, null);
});

test('IA: ruta de respaldo inactiva pero habilitada no es una falla', () => {
  const x = resumirRutasMikroTik({ rutas: [
    { 'dst-address': '0.0.0.0/0', gateway: '192.0.2.1', distance: 1, active: true, disabled: false, 'check-gateway': 'ping' },
    { 'dst-address': '0.0.0.0/0', gateway: '192.0.2.2', distance: 2, active: false, disabled: false }
  ] });
  assert.equal(x.rutas[1].activa, false);
  assert.equal(x.rutas[1].habilitada, true);
  assert.equal(x.tablasResumen[0].respaldosHabilitadosConfirmados, 1);
  assert.equal(x.tablasResumen[0].failoverVerificado, false);
  assert.equal(x.rutas[0].checkGateway, 'ping');
});
test('IA: ruta administrativamente deshabilitada no cuenta como respaldo', () => {
  const x = resumirRutasMikroTik({ rutas: [
    { 'dst-address': '0.0.0.0/0', distance: 1, active: true, disabled: false },
    { 'dst-address': '0.0.0.0/0', distance: 2, active: false, disabled: true }
  ] });
  assert.equal(x.tablasResumen[0].respaldosHabilitadosConfirmados, 0);
});
test('IA: estados ausentes no se inventan', () => {
  const x = resumirRutasMikroTik({ rutas: [{ 'dst-address': '0.0.0.0/0', gateway: '192.0.2.1' }] });
  assert.equal(x.rutas[0].activa, null);
  assert.equal(x.rutas[0].habilitada, null);
  assert.equal(x.rutas[0].distancia, null);
});

test('IA: distancia mayor con estado administrativo desconocido no confirma respaldo', () => {
  const x = resumirRutasMikroTik({ rutas: [
    { 'dst-address': '0.0.0.0/0', distance: 1, active: true, disabled: false },
    { 'dst-address': '0.0.0.0/0', distance: 2 }
  ] });
  assert.equal(x.tablasResumen[0].respaldosHabilitadosConfirmados, 0);
  assert.equal(x.tablasResumen[0].respaldosConEstadoDesconocido, 1);
  assert.equal(x.tablasResumen[0].estadosDesconocidos, true);
  assert.match(x.tablasResumen[0].conclusion, /no confirmado/);
});
test('IA: identifica ECMP potencial solo con rutas habilitadas', () => {
  const x = resumirRutasMikroTik({ rutas: [
    { 'dst-address': '0.0.0.0/0', distance: 1, disabled: false },
    { 'dst-address': '0.0.0.0/0', distance: 1, disabled: false }
  ] });
  assert.equal(x.tablasResumen[0].ecmpPotencial, true);
});
