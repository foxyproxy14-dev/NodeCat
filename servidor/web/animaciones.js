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
  mover(document.querySelector('#vista'), [{ opacity: .55 }, { opacity: 1 }], { duration: 240 });
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
function confirmarBoton(b, texto = 'Copiado') {
  if (!b || !b.isConnected) return;
  const anterior = b.nextElementSibling;
  if (anterior?.classList.contains('confirmacion-boton')) anterior.remove();
  const marca = document.createElement('span');
  marca.className = 'confirmacion-boton';
  marca.setAttribute('role', 'status');
  marca.textContent = `✓ ${texto}`;
  const r = b.getBoundingClientRect();
  const siguiente = b.nextElementSibling?.getBoundingClientRect();
  const alLado = r.right + 118 < window.innerWidth && (!siguiente || siguiente.left > r.right + 118 || siguiente.top >= r.bottom);
  marca.style.left = `${alLado ? r.right + 8 : Math.max(8, Math.min(r.left, window.innerWidth - 118))}px`;
  marca.style.top = `${alLado ? r.top + r.height / 2 - 12 : Math.max(4, r.top - 28)}px`;
  b.after(marca);
  mover(marca, [{ opacity: 0 }, { opacity: 1 }], { duration: 140 });
  setTimeout(() => marca.remove(), 1800);
}
let botonGuardando = null, horaGuardado = 0;
function recordarGuardar(b) {
  if (b && /guardar/i.test(b.textContent)) { botonGuardando = b; horaGuardado = Date.now(); }
}
document.addEventListener('click', e => recordarGuardar(e.target.closest('button')), true);
document.addEventListener('submit', e => recordarGuardar(e.submitter || e.target.querySelector('[type="submit"]')), true);
function confirmarGuardado(texto) {
  if (/guardad/i.test(texto) && Date.now() - horaGuardado < 30000) {
    confirmarBoton(botonGuardando, 'Guardado');
    botonGuardando = null;
  }
}
async function cerrarConConfirmacion(dlg) {
  const b = dlg.querySelector('[type="submit"]');
  if (b) { b.disabled = true; confirmarBoton(b, 'Guardado'); }
  if (!reducirMovimiento()) await new Promise(resolve => setTimeout(resolve, 650));
  dlg.close();
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
