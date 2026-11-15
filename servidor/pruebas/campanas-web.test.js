'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('las filas de equipos cierran su contenedor antes de la fila siguiente', () => {
  const fuente = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const inicio = fuente.indexOf('function filaEquipo(');
  const fin = fuente.indexOf('/* ---------------- Sesiones', inicio);
  const contexto = vm.createContext({
    esc: String, nombreEq: s => s.nombre, ESTADOS: { caido: 'Sin respuesta' },
    cuando: () => '', botonCampana: id => `<button data-campana="${id}"></button>`,
    conAvisoIco: () => '', insigniaSO: () => '', esHipervisor: () => true,
    etqRds: () => '', etqDisco: () => '', ICO: { flecha: '' }
  });
  vm.runInContext(fuente.slice(inicio, fin), contexto);
  const fila = contexto.filaEquipo({ id: 1, nombre: 'Hyper-V', estado: 'caido', sesiones: [], discos: [] });
  let profundidad = 0;
  for (const tag of fila.matchAll(/<\/?div\b[^>]*>/g)) {
    profundidad += tag[0].startsWith('</') ? -1 : 1;
    assert.ok(profundidad >= 0, 'Etiqueta de cierre sin contenedor');
  }
  assert.equal(profundidad, 0, 'El equipo siguiente quedaría anidado en esta fila');
  const cliente = fuente.slice(fuente.indexOf('function filaCliente('), fuente.indexOf('/* ---------------- Últimos sucesos'));
  assert.doesNotMatch(cliente, /\$\{ICO\.flecha\}<\/button><\/div>/, 'La fila de cliente no abre un contenedor de campana');
});

test('campanas web: estado accesible, herencia y escape de identificadores', () => {
  const fuente = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const contexto = vm.createContext({ estado: { silencios: [] }, esc: s => String(s).replace(/"/g, '&quot;') });
  vm.runInContext(fuente.slice(fuente.indexOf('function botonCampana(')), contexto);
  const boton = (id, invitado = '') => contexto.botonCampana(id, invitado);
  assert.match(boton(1), /aria-pressed="true"/);
  contexto.estado.silencios = [{ equipo: 1, vm: '100' }];
  assert.match(boton(1, '100'), /aria-pressed="false"/);
  assert.match(boton(1, '101'), /aria-pressed="true"/);
  assert.match(boton(1), /aria-pressed="true"/);
  contexto.estado.silencios.push({ equipo: 1, vm: '' });
  assert.match(boton(1, '101'), /disabled/);
  assert.doesNotMatch(boton(1), / disabled/);
  assert.match(boton(2, '" onclick="x'), /data-vm="&quot; onclick=&quot;x"/);
});
