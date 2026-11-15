'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function entorno() {
  const animaciones = [];
  let reducir = false, cambio;
  const fila = { dataset: { eq: '7' }, className: 'fila ok', classList: { contains: c => fila.className.split(' ').includes(c) }, animate: cuadros => animar(cuadros) };
  function animar(cuadros) { const a = { cuadros, finished: Promise.resolve(), cancel() { a.cancelada = true; } }; animaciones.push(a); return a; }
  const barra = { style: { width: '20%' }, closest: () => fila, animate: cuadros => animar(cuadros) };
  fila.querySelectorAll = () => [barra];
  const cont = { hidden: false, scrollHeight: 120, animate: cuadros => animar(cuadros) };
  const attrs = { 'aria-expanded': 'true', 'aria-controls': 'grupo-7' };
  const boton = { dataset: { grupoEquipos: '7' }, getAttribute: k => attrs[k], setAttribute: (k, v) => { attrs[k] = v; } };
  const contexto = vm.createContext({
    matchMedia: () => ({ get matches() { return reducir; }, addEventListener: (tipo, fn) => { cambio = fn; } }),
    location: { hash: '#/c/1' }, setTimeout,
    esc: s => String(s).replace(/[<"&]/g, c => ({ '<': '&lt;', '"': '&quot;', '&': '&amp;' }[c])),
    document: { hidden: false, addEventListener() {}, querySelectorAll: selector => selector.includes('carril') ? [barra] : selector.includes('motion-vm') ? [fila] : [], getElementById: () => cont }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'animaciones.js'), 'utf8'), contexto);
  return { contexto, barra, fila, animaciones, cont, boton, reducir: () => { reducir = true; cambio({ matches: true }); } };
}

test('solo anima métricas y estados que cambian; respeta reducir movimiento', () => {
  const e = entorno(), foto = e.contexto.fotoMovimiento();
  e.contexto.finalizarMovimiento(foto);
  assert.equal(e.animaciones.length, 0);
  e.barra.style.width = '70%'; e.fila.className = 'fila caido';
  e.contexto.finalizarMovimiento(foto);
  assert.equal(e.animaciones.length, 2);
  assert.equal(e.animaciones[0].cuadros[0].width, '20%');
  assert.equal(e.animaciones[0].cuadros[1].width, '70%');
  e.reducir();
  assert.ok(e.animaciones.every(a => a.cancelada));
  assert.equal(e.contexto.fotoMovimiento(), null);
  e.contexto.finalizarMovimiento(foto);
  assert.equal(e.animaciones.length, 2);
});

test('el plegado persiste al redibujar y se abre sin animación con movimiento reducido', async () => {
  const e = entorno();
  e.contexto.alternarGrupoEquipos(e.boton);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(e.cont.hidden, true);
  const html = e.contexto.grupoEquipos('7', '<Hipervisor>', '1 equipo', '<div>Equipo</div>');
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /&lt;Hipervisor>/);
  assert.match(html, /class="grupo-equipos" hidden/);
  e.reducir();
  e.contexto.alternarGrupoEquipos(e.boton);
  assert.equal(e.cont.hidden, false);
  assert.match(e.contexto.grupoEquipos('7', 'Hipervisor', '1', ''), /aria-expanded="true"/);
});

test('el indicador no cambia el botón ni tapa al vecino en móvil; navegar solo desvanece', () => {
  const e = entorno();
  let marca, temporizador;
  e.contexto.window = { innerWidth: 390 };
  e.contexto.setTimeout = fn => { temporizador = fn; };
  e.contexto.document.createElement = () => ({ style: {}, setAttribute() {}, remove() { this.quitada = true; } });
  const b = { isConnected: true, textContent: 'Guardar',
    getBoundingClientRect: () => ({ left: 20, right: 100, top: 200, bottom: 240, height: 40 }),
    nextElementSibling: { classList: { contains: () => false }, getBoundingClientRect: () => ({ left: 112, top: 200 }) },
    after: el => { marca = el; } };
  e.contexto.confirmarBoton(b, 'Guardado');
  assert.equal(b.textContent, 'Guardar');
  assert.equal(marca.textContent, '✓ Guardado');
  assert.equal(marca.style.top, '172px');
  temporizador(); assert.ok(marca.quitada);
  e.contexto.document.querySelector = () => ({ animate: cuadros => { e.animaciones.push({ cuadros }); return { finished: Promise.resolve() }; } });
  e.contexto.entradaVista();
  const cuadros = e.animaciones.at(-1).cuadros;
  assert.deepEqual(Object.keys(cuadros[0]), ['opacity']);
  assert.deepEqual(Object.keys(cuadros[1]), ['opacity']);
});

test('las cargas de secciones usan la pose pequeña asomando', () => {
  const fuente = fs.readFileSync(path.join(__dirname, '..', 'web', 'gato.js'), 'utf8');
  const contexto = vm.createContext({});
  vm.runInContext(fuente.slice(0, fuente.indexOf('setInterval(')), contexto);
  const html = contexto.gatoCargando('Consultando discos');
  assert.match(html, /g-asomando/);
  assert.match(html, /g-asomo-cabeza/);
  assert.match(html, /carga-local/);
  assert.doesNotMatch(html, /g-corriendo/);
});
