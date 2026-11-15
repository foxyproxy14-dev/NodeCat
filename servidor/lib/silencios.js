'use strict';
const { q } = require('./db');

// Una fila por cuenta, equipo y VM. vm='' silencia el equipo y sus invitados.
q(`CREATE TABLE IF NOT EXISTS push_silencios (
  usuario TEXT NOT NULL COLLATE NOCASE REFERENCES usuarios(usuario) ON DELETE CASCADE,
  equipo INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
  vm TEXT NOT NULL DEFAULT '', PRIMARY KEY (usuario, equipo, vm)
)`).run();

function lista(usuario) {
  return q('SELECT equipo, vm FROM push_silencios WHERE usuario = ?').all(usuario);
}
function silenciado(usuario, equipo, vm = '') {
  return !!q("SELECT 1 FROM push_silencios WHERE usuario = ? AND equipo = ? AND (vm = '' OR vm = ?) LIMIT 1")
    .get(usuario, equipo, String(vm));
}
function guardar(usuario, equipo, vm, si) {
  if (si) q('INSERT OR IGNORE INTO push_silencios (usuario, equipo, vm) VALUES (?, ?, ?)').run(usuario, equipo, vm);
  else q('DELETE FROM push_silencios WHERE usuario = ? AND equipo = ? AND vm = ?').run(usuario, equipo, vm);
}
module.exports = { lista, silenciado, guardar };
