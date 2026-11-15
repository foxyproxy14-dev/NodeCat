'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
