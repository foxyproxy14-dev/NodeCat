'use strict';
// Movimientos de una sola pasada; nunca cambian los datos del monitoreo.
const gruposEquiposCerrados = new Set();
const reducirMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const movimientosActivos = new Set();
function mover(el, cuadros, opciones = {}) {
  if (!el || !el.animate || reducirMovimiento() || document.hidden) return;
  const a = el.animate(cuadros, { duration: 320, easing: 'ease-out', ...opciones });
  movimientosActivos.add(a);
  a.finished.catch(() => {}).finally(() => movimientosActivos.delete(a));
  return a;
}
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', e => {
  if (e.matches) for (const a of movimientosActivos) a.cancel();
});
function entradaVista() {
  mover(document.querySelector('#vista'), [{ opacity: .45 }, { opacity: 1 }], { duration: 180 });
}
function claveFila(fila) {
  return fila.dataset.eq ? `equipo-${fila.dataset.eq}` : `vm-${fila.dataset.motionVm}`;
}
function barrasMovimiento() {
  const resultado = new Map();
  document.querySelectorAll('#vista .carril > span, #vista .pm-barra > span').forEach(el => {
    const fila = el.closest('[data-eq], [data-motion-vm]');
    const cont = fila || el.closest('[id]');
    if (!cont) return;
    const indice = [...cont.querySelectorAll('.carril > span, .pm-barra > span')].indexOf(el);
    const clave = `${fila ? claveFila(fila) : cont.id}-${indice}`;
    resultado.set(clave, { el, ancho: el.style.width });
  });
  return resultado;
}
function fotoMovimiento() {
  if (reducirMovimiento() || document.hidden) return null;
  const filas = new Map();
  document.querySelectorAll('#vista .fila[data-eq], #vista [data-motion-vm]').forEach(el => filas.set(claveFila(el), el.className));
  return { ruta: location.hash, barras: barrasMovimiento(), filas };
}
function finalizarMovimiento(foto) {
  if (!foto || foto.ruta !== location.hash || reducirMovimiento()) return;
  for (const [clave, actual] of barrasMovimiento()) {
    const antes = foto.barras.get(clave);
    if (antes && antes.ancho && actual.ancho && antes.ancho !== actual.ancho)
      mover(actual.el, [{ width: antes.ancho }, { width: actual.ancho }], { duration: 550 });
  }
  document.querySelectorAll('#vista .fila[data-eq], #vista [data-motion-vm]').forEach(el => {
    const antes = foto.filas.get(claveFila(el));
    if (antes == null || antes === el.className) return;
    const mal = el.classList.contains('caido') || el.classList.contains('detenida');
    mover(el, [{ boxShadow: `inset 4px 0 ${mal ? '#dc5555' : '#27ad78'}`, backgroundColor: mal ? '#dc555522' : '#27ad7822' }, { boxShadow: 'inset 0 0 transparent', backgroundColor: 'transparent' }], { duration: 900 });
  });
}
function animarCampana(id, vm, silenciado) {
  document.querySelectorAll('[data-campana]').forEach(b => {
    if (Number(b.dataset.campana) !== id || (b.dataset.vm || '') !== vm) return;
    // rotate mantiene el translateY que centra las campanas de las filas.
    mover(b, silenciado ? [{ opacity: .3 }, { opacity: .65 }] : [{ rotate: '0deg' }, { rotate: '-14deg' }, { rotate: '12deg' }, { rotate: '0deg' }]);
  });
}
function confirmarBoton(b) {
  if (!b) return;
  const texto = b.textContent;
  b.textContent = '✓ Copiado';
  mover(b, [{ opacity: .5 }, { opacity: 1 }]);
  setTimeout(() => { if (b.isConnected && b.textContent === '✓ Copiado') b.textContent = texto; }, 1600);
}
function grupoEquipos(clave, titulo, resumen, contenido, clase = '') {
  const abierta = !gruposEquiposCerrados.has(clave);
  const id = 'grupo-' + encodeURIComponent(clave);
  return `<button type="button" class="fila-grupo grupo-plegable ${clase}" data-grupo-equipos="${esc(clave)}" aria-expanded="${abierta}" aria-controls="${esc(id)}"><b>${esc(titulo)}</b><span>${esc(resumen)}</span><span class="grupo-flecha" aria-hidden="true">⌄</span></button><div id="${esc(id)}" class="grupo-equipos" ${abierta ? '' : 'hidden'}>${contenido}</div>`;
}
function alternarGrupoEquipos(b) {
  const clave = b.dataset.grupoEquipos, cont = document.getElementById(b.getAttribute('aria-controls'));
  if (!cont) return;
  const abrir = b.getAttribute('aria-expanded') !== 'true';
  if (abrir) gruposEquiposCerrados.delete(clave); else gruposEquiposCerrados.add(clave);
  b.setAttribute('aria-expanded', String(abrir));
  if (abrir) {
    cont.hidden = false;
    mover(cont, [{ height: '0px', opacity: .3 }, { height: `${cont.scrollHeight}px`, opacity: 1 }], { duration: 220 });
  } else {
    const a = mover(cont, [{ height: `${cont.scrollHeight}px`, opacity: 1 }, { height: '0px', opacity: .3 }], { duration: 180 });
    if (a) a.finished.catch(() => {}).finally(() => { if (gruposEquiposCerrados.has(clave)) cont.hidden = true; });
    else cont.hidden = true;
  }
}
