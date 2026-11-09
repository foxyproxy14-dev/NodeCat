'use strict';
/* ======================================================================
   NodeCat: interfaz web
   ====================================================================== */
const ALTO = 90, MEDIO = 75;
let CSRF = null, SESION = null, sondeo = null;
let estado = null, version = null, montada = null;
const guardar = (k, v) => { try { localStorage.setItem('nodecat.' + k, JSON.stringify(v)); } catch (e) { } };
const leer = (k, d) => { try { const v = localStorage.getItem('nodecat.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arr = x => Array.isArray(x) ? x : (x == null ? [] : [x]);
const nf = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const hora = t => new Date(t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
const nivel = v => v == null ? '' : v >= ALTO ? 'alerta' : v >= MEDIO ? 'aviso' : 'ok';
const ROLES = { admin: 'Administrador', lector: 'Solo lectura' };
const esAdmin = () => !!SESION && SESION.rol === 'admin';
const ESTADOS = { ok: 'En línea', sinMetricas: 'En línea, sin métricas', caido: 'Sin respuesta', pendiente: 'Esperando el primer informe' };

const ICO = {
  lupa: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m10.6 10.6 3.6 3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  flecha: '<svg class="flecha" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  miga: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

function duracion(desde) {
  if (!desde) return '—';
  return durTxt(Date.now() - desde);
}
function durTxt(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(min / 1440), h = Math.floor(min % 1440 / 60), m = min % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}
function inactivo(min, est) {
  if (min == null || (min < 1 && est === 'activa')) return '<span class="tenue">—</span>';
  return durTxt(min * 60000);
}
function cuando(t) {
  if (!t) return '—';
  const d = new Date(t), hoy = new Date(), ayer = new Date(Date.now() - 864e5);
  const hh = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hoy.toDateString()) return `hoy ${hh}`;
  if (d.toDateString() === ayer.toDateString()) return `ayer ${hh}`;
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' }) + ' ' + hh;
}

/* ======================================================================
   API y sesión
   ====================================================================== */
async function api(ruta, opc = {}) {
  const cab = { 'X-NodeCat': '1', 'Content-Type': 'application/json' };
  if (CSRF) cab['X-NodeCat-Token'] = CSRF;
  let r;
  try { r = await fetch(ruta, { ...opc, headers: cab, credentials: 'same-origin' }); }
  catch (e) { throw new Error('No hay conexión con NodeCat.'); }
  let d = null;
  try { d = await r.json(); } catch (e) { }
  if (r.status === 401 && d && d.login && ruta !== '/api/login') {
    mostrarAcceso(SESION ? 'Tu sesión terminó. Vuelve a entrar.' : '');
    const e = new Error(d.error); e.login = true; throw e;
  }
  if (!r.ok) throw new Error((d && d.error) || `NodeCat respondió con el error ${r.status}.`);
  return d;
}
const enviar = (ruta, metodo, datos) => api(ruta, { method: metodo, body: JSON.stringify(datos || {}) });

// Pantalla de carga: el gato corre al entrar; se queda al menos 1,6 s para que se vea y se va con un fundido
const inicioCarga = { desde: Date.now() };
function mostrarInicio(texto) {
  inicioCarga.desde = Date.now();
  const el = $('#inicioCarga'); el.classList.remove('saliendo');
  el.querySelector('.ic-texto').textContent = texto;
  document.body.classList.add('iniciando');
}
function ocultarInicio() {
  if (!document.body.classList.contains('iniciando')) return;
  const el = $('#inicioCarga');
  setTimeout(() => { el.classList.add('saliendo'); setTimeout(() => { document.body.classList.remove('iniciando'); el.classList.remove('saliendo'); }, 450); },
    Math.max(0, 1600 - (Date.now() - inicioCarga.desde)));
}

function entrar(info) {
  SESION = info; CSRF = info.csrf;
  document.body.classList.remove('sin-sesion');
  document.body.classList.toggle('lector', !esAdmin());
  $('#acceso').hidden = true;
  $('#cuentaNombre').textContent = info.usuario;
  montada = null; version = null;
  cargar(true).finally(ocultarInicio);
  if (!sondeo) {
    sondeo = setInterval(() => { if (SESION && !document.hidden) cargar(); }, 5000);
    setInterval(reloj, 1000);
  }
}

function mostrarAcceso(msg, configurar) {
  SESION = null; CSRF = null; estado = null; previos = null;
  ocultarInicio();
  document.body.classList.add('sin-sesion');
  cerrarMenu();
  const d = $('#dialogo'); if (d.open) d.close();
  $('#acceso').hidden = false;
  $('#formAcceso').hidden = !!configurar;
  $('#formConfigurar').hidden = !configurar;
  errorAcceso(msg);
  setTimeout(() => {
    if (configurar) $('#formConfigurar').codigo.focus();
    else { const f = $('#formAcceso'); (f.usuario.value ? f.clave : f.usuario).focus(); }
  }, 0);
}

$('#formAcceso').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = ev.currentTarget, b = f.querySelector('button');
  if (!f.usuario.value.trim() || !f.clave.value) { errorAcceso('Escribe tu usuario y tu contraseña.'); return; }
  b.disabled = true; b.textContent = 'Comprobando…';
  try {
    const info = await enviar('/api/login', 'POST', { usuario: f.usuario.value.trim(), clave: f.clave.value });
    f.clave.value = '';
    mostrarInicio(`Hola, ${info.usuario}. Revisando a tus clientes…`);
    entrar(info);
  } catch (err) { errorAcceso(err.message); f.clave.value = ''; f.clave.focus(); }
  finally { b.disabled = false; b.textContent = 'Entrar'; }
});

$('#formConfigurar').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = ev.currentTarget, b = f.querySelector('button'), e = f.querySelector('.msg');
  const mal = m => { e.className = ''; e.innerHTML = gatoError(esc(m)); e.hidden = false; };
  if (!/^\d{6}$/.test(f.codigo.value.trim())) return mal('El código tiene 6 cifras. Búscalo en el registro del servidor.');
  if (f.clave.value !== f.repite.value) return mal('Las contraseñas no coinciden.');
  b.disabled = true;
  try { entrar(await enviar('/api/configurar', 'POST', { codigo: f.codigo.value, usuario: f.usuario.value.trim(), clave: f.clave.value })); aviso('Cuenta creada. Empieza agregando tu primer cliente.'); }
  catch (err) { mal(err.message); }
  finally { b.disabled = false; }
});

function errorAcceso(m) { const e = $('#accesoError'); e.innerHTML = m ? gatoError(esc(m)) : ''; e.hidden = !m; }
async function salir() {
  try { await enviar('/api/logout', 'POST'); } catch (e) { }
  mostrarAcceso('');
}

async function iniciar() {
  try {
    const s = await api('/api/sesion');
    if (s.configurar) mostrarAcceso('', true); else entrar(s);
  } catch (err) { if (!err.login) mostrarAcceso(err.message); }
}

/* ======================================================================
   Datos
   ====================================================================== */
async function cargar(forzar) {
  if (!SESION) return;
  try {
    const e = await api('/api/estado');
    for (const c of e.clientes) c.equipos = arr(c.equipos).map(x => ({ ...x, clienteNombre: c.nombre, sesiones: arr(x.sesiones), discos: arr(x.discos), historial: arr(x.historial) }));
    const nuevo = !estado || e.actualizado !== estado.actualizado;
    vigilarCambios(e);
    estado = e;
    $('#aviso').hidden = true;
    const v = `${e.actualizado}|${e.clientes.map(c => c.id + c.nombre + c.equipos.map(x => x.id + x.estado + x.ultimo + x.alias + x.sesiones.length).join()).join('|')}`;
    if (forzar || v !== version) { version = v; render(); }
    luz(nuevo);
    reloj();
  } catch (err) {
    if (err.login) return;
    const a = $('#aviso');
    const t = err.message === 'No hay conexión con NodeCat.' ? 'Uy, perdí la conexión con NodeCat. Comprueba que el servidor sigue en marcha; lo sigo intentando.' : err.message;
    if (a.dataset.t !== t || a.hidden) { a.innerHTML = gatoError(esc(t)); a.dataset.t = t; }
    a.hidden = false;
  }
}

// Errores dentro de las ventanas: los dice el gato, y el de la barra pone cara de vergüenza
function gatoDice(el, texto) {
  if (!el) return;
  el.className = '';
  el.innerHTML = texto ? gatoError(esc(texto)) : '';
  el.hidden = !texto;
  if (texto) caraDeGato('avergonzado', 5000);
}
function caraDeGato(pose, ms) {
  const g = $('#barraGato'); if (!g) return;
  g.innerHTML = gatoSVG(pose); g.classList.remove('salta'); void g.offsetWidth; g.classList.add('salta');
  clearTimeout(caraGato);
  caraGato = setTimeout(() => { g.innerHTML = gatoSVG('reparando'); }, ms);
}

let caraGato = null;
/* ---------------- El gato avisa de los cambios ---------------- */
let previos = null;
function vigilarCambios(e) {
  const ahora = new Map();
  for (const c of e.clientes) for (const x of c.equipos) ahora.set(x.id, { estado: x.estado, wan: x.red && x.red.wan ? x.red.wan.activa : null, x, c });
  if (previos) {
    for (const [id, n] of ahora) {
      const p = previos.get(id), nom = n.x.alias || n.x.nombre, tipo = n.x.tipo === 'mikrotik' ? 'El router' : 'El servidor';
      if (!p) { avisoGato('reparando', n.x.tipo === 'mikrotik' ? '¡Router nuevo!' : '¡Servidor nuevo!', `${nom} se unió a ${n.c.nombre}. Ya lo estoy vigilando.`, id); continue; }
      if (p.estado === 'pendiente' && (n.estado === 'ok' || n.estado === 'sinMetricas')) avisoGato('reparando', '¡Conectado!', `${nom} (${n.c.nombre}) ya está enviando datos.`, id);
      else if (p.estado !== 'caido' && n.estado === 'caido') avisoGato('avergonzado', `${nom} no responde`, `${tipo} de ${n.c.nombre} dejó de responder${n.x.errorConexion ? ': ' + n.x.errorConexion : '.'}`, id, true);
      else if (p.estado === 'caido' && n.estado !== 'caido') avisoGato('programando', `${nom} volvió`, `${tipo} de ${n.c.nombre} está otra vez en línea.`, id);
      if (p.wan === true && n.wan === false && n.estado !== 'caido') avisoGato('molesto', `Se cayó el WAN de ${nom}`, `La interfaz ${n.x.red.wan.interfaz} de ${n.c.nombre} está sin enlace.`, id, true);
      if (p.wan === false && n.wan === true) avisoGato('programando', `Volvió el WAN de ${nom}`, `${n.c.nombre} tiene Internet otra vez por ${n.x.red.wan.interfaz}.`, id);
    }
  }
  previos = ahora;
}
// El gato de la barra lo cuenta en un bocadillo y pone la cara de la noticia
function avisoGato(pose, titulo, texto, idEquipo, malo) {
  const cont = $('#bocadillos'), g = $('#barraGato');
  const r = g.getBoundingClientRect();
  cont.style.left = Math.max(8, r.left - 6) + 'px';
  cont.style.top = (r.bottom + 10) + 'px';
  const d = document.createElement('button');
  d.type = 'button';
  d.className = 'bocadillo' + (malo ? ' malo' : '');
  d.setAttribute('role', malo ? 'alert' : 'status');
  d.innerHTML = `<b>${esc(titulo)}</b><span>${esc(texto)}</span><span class="cerrar-aviso" aria-hidden="true">×</span>`;
  d.onclick = ev => { if (!ev.target.closest('.cerrar-aviso') && idEquipo) ir('#/e/' + idEquipo); quitar(); };
  cont.prepend(d);
  while (cont.children.length > 4) cont.lastChild.remove();
  caraDeGato(pose, malo ? 12000 : 6000);
  const quitar = () => { d.classList.add('fuera'); setTimeout(() => d.remove(), 350); };
  setTimeout(quitar, malo ? 15000 : 8000);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification(titulo, { body: texto, icon: $('#favicon').href, tag: 'nodecat-' + idEquipo }); n.onclick = () => { window.focus(); if (idEquipo) ir('#/e/' + idEquipo); }; } catch (x) { }
  }
}

const cliente = id => estado && estado.clientes.find(c => c.id === Number(id));
const equipos = () => estado ? estado.clientes.flatMap(c => c.equipos) : [];
const equipo = id => equipos().find(e => e.id === Number(id));
const nombreEq = e => e.alias || e.nombre;
const todasLasSesiones = (lista = equipos()) => lista.flatMap(e => e.sesiones.map(x => ({ ...x, equipoId: e.id, servidor: nombreEq(e), cliente: e.clienteNombre })));

function problemasDe(e) {
  const l = [], n = nombreEq(e);
  if (e.estado === 'caido') { l.push({ e, n: 'alerta', t: `${n} no responde` }); return l; }
  if (e.red && e.red.wan && !e.red.wan.activa) l.push({ e, n: 'alerta', t: `${n}: WAN caído (${e.red.wan.interfaz})` });
  if (e.cpu != null && e.cpu >= ALTO) l.push({ e, n: 'alerta', t: `${n}: CPU al ${e.cpu} %` });
  if (e.ramPct != null && e.ramPct >= ALTO) l.push({ e, n: 'alerta', t: `${n}: memoria al ${e.ramPct} %` });
  for (const d of e.discos) if (d.pct >= ALTO) l.push({ e, n: 'alerta', t: `${n}: disco ${d.unidad} al ${d.pct} %` });
  if (e.estado === 'sinMetricas') l.push({ e, n: 'aviso', t: `${n}: no se pueden leer CPU ni memoria` });
  if (e.estado === 'pendiente' && e.errorConexion) l.push({ e, n: 'aviso', t: `${n}: no se puede conectar` });
  if (e.errorSesiones) l.push({ e, n: 'aviso', t: `${n}: no se pueden leer las sesiones` });
  return l;
}
const ordenProblemas = l => l.sort((a, b) => (a.n === 'alerta' ? 0 : 1) - (b.n === 'alerta' ? 0 : 1));
const problemas = (lista = equipos()) => ordenProblemas(lista.flatMap(problemasDe));
const nivelDe = e => { const p = problemasDe(e); return p.some(x => x.n === 'alerta') ? (e.estado === 'caido' ? 'caido' : 'aviso') : p.length ? 'aviso' : e.estado === 'pendiente' ? 'pendiente' : 'ok'; };
const nivelCliente = c => { const p = problemas(c.equipos); return p.some(x => x.n === 'alerta') ? 'alerta' : p.length ? 'aviso' : 'ok'; };

function luz(latir) {
  const p = problemas();
  const clase = !estado || !equipos().length ? '' : p.some(x => x.n === 'alerta') ? 'estado-alerta' : p.length ? 'estado-aviso' : 'estado-ok';
  document.body.classList.remove('estado-ok', 'estado-aviso', 'estado-alerta');
  if (clase) document.body.classList.add(clase);
  const color = clase === 'estado-alerta' ? '%23d03b3b' : clase === 'estado-aviso' ? '%23fab219' : clase === 'estado-ok' ? '%230ca30c' : '%23888';
  // Icono: la torre (una "l") con la luz encima
  $('#favicon').href = gatoFavicon(decodeURIComponent(color));
  if (latir) { const l = $('#luz'); l.classList.remove('latido'); void l.offsetWidth; l.classList.add('latido'); }
}

function reloj() {
  if (!estado) return;
  const r = $('#reloj');
  if (!estado.actualizado) { r.textContent = estado.demo ? 'Modo demo' : 'Esperando informes'; return; }
  const s = Math.max(0, Math.round((Date.now() - estado.actualizado) / 1000));
  r.textContent = (estado.demo ? 'Demo. ' : '') + (s < 60 ? `Último informe hace ${s} s` : `Último informe a las ${hora(estado.actualizado)}`);
}

/* ======================================================================
   Navegación (por la dirección: #/, #/c/3, #/e/12, #/sesiones, #/historial)
   ====================================================================== */
function rutaActual() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'c' && b) return { vista: 'cliente', id: Number(b), clave: 'c' + b };
  if (a === 'e' && b) return { vista: 'equipo', id: Number(b), clave: 'e' + b };
  if (a === 'sesiones' || a === 'historial') return { vista: a, clave: a };
  return { vista: 'resumen', clave: 'resumen' };
}
const ir = h => { if (location.hash === h) render(); else location.hash = h; };
window.addEventListener('hashchange', () => { if (!estado) return; montada = null; render(); window.scrollTo({ top: 0 }); });

function render() {
  if (!estado) return;
  const r = rutaActual();
  if (r.vista === 'cliente' && !cliente(r.id)) { ir('#/'); return; }
  if (r.vista === 'equipo' && !equipo(r.id)) { ir('#/'); return; }
  const esRouter = r.vista === 'equipo' && equipo(r.id).tipo === 'mikrotik';
  document.body.classList.toggle('consola', esRouter);
  pintarNav(r);
  if (montada !== r.clave) { montar(r); montada = r.clave; }
  actualizar(r);
}

function pintarNav(r) {
  const n = todasLasSesiones().length;
  const activa = r.vista === 'cliente' || r.vista === 'equipo' ? 'resumen' : r.vista;
  $('#nav').innerHTML = [['resumen', '#/', 'Clientes'], ['sesiones', '#/sesiones', `Sesiones <span class="cuenta">${n}</span>`], ['historial', '#/historial', 'Historial']].map(([id, h, t]) =>
    `<div class="pest ${activa === id ? 'activa' : ''}"><button type="button" ${activa === id ? 'aria-current="page"' : ''} data-ir="${h}">${t}</button></div>`).join('');
}
$('#nav').addEventListener('click', e => { const t = e.target.closest('[data-ir]'); if (t) ir(t.dataset.ir); });

function montar(r) {
  const v = $('#vista');
  v.onclick = e => {
    const c = e.target.closest('[data-cli]'); if (c) { ir('#/c/' + c.dataset.cli); return; }
    const q = e.target.closest('[data-eq]'); if (q) { ir('#/e/' + q.dataset.eq); return; }
  };
  if (r.vista === 'resumen') {
    v.innerHTML = `
      <section class="titular" id="titular" aria-live="polite"></section>
      <ul class="problemas" id="problemas"></ul>
      <div class="dos-col">
        <div>
          <div class="cab-seccion">
            <h2 id="tituloTablero">Clientes</h2>
            ${esAdmin() ? '<button class="btn" type="button" id="btnClientes">Clientes y agentes</button>' : ''}
            <label class="buscar">${ICO.lupa}<span class="sr">Buscar cliente o servidor</span><input type="search" id="buscarCli" placeholder="Buscar cliente o servidor" value="${esc(filtroCli)}"></label>
          </div>
          <div id="tablero"></div>
        </div>
        <aside><div class="cab-seccion"><h2>Últimos sucesos</h2></div><section class="hoja" id="sucesos">${gatoCargando('Cargando…', 'chica')}</section></aside>
      </div>`;
    $('#buscarCli').addEventListener('input', e => { filtroCli = e.target.value; actualizar(r); });
    const bc = $('#btnClientes'); if (bc) bc.addEventListener('click', () => gestionClientes());
    cargarSucesos();
  } else if (r.vista === 'cliente') {
    const c = cliente(r.id);
    v.innerHTML = `
      <nav class="miga" aria-label="Ruta"><a href="#/">Clientes</a>${ICO.miga}<span>${esc(c.nombre)}</span></nav>
      <section class="titular cli-cab"><h1 id="cliTitulo"></h1><p id="cliSub"></p></section>
      <ul class="problemas" id="problemas"></ul>
      <div class="dos-col">
        <div>
          <div class="cab-seccion">
            <h2 id="tituloTablero">Servidores</h2>
            ${esAdmin() ? `<button class="btn" type="button" id="btnAgente">Agregar servidores</button><button class="btn" type="button" id="btnEditarCli">Editar cliente</button>` : ''}
          </div>
          <div id="tablero"></div>
          <div class="cab-seccion" style="margin-top:36px">
            <h2 id="tituloRed">Red</h2>
            ${esAdmin() ? '<button class="btn" type="button" id="btnRouter">Agregar router MikroTik</button>' : ''}
          </div>
          <div id="tableroRed"></div>
        </div>
        <aside><div class="cab-seccion"><h2>Últimos sucesos</h2></div><section class="hoja" id="sucesos">${gatoCargando('Cargando…', 'chica')}</section></aside>
      </div>`;
    if (esAdmin()) {
      $('#btnAgente').addEventListener('click', () => gestionClientes(c.id));
      $('#btnEditarCli').addEventListener('click', () => editarCliente(c.id));
      $('#btnRouter').addEventListener('click', () => dialogoRouter(c.id));
    }
    cargarSucesos();
  } else if (r.vista === 'sesiones') {
    v.innerHTML = `
      <section class="titular"><h1 id="tituloSes"></h1><p id="subSes"></p></section>
      <div class="cab-seccion">
        <h2>Todas las sesiones</h2>
        <div class="segmentos" role="group" aria-label="Filtrar por estado">
          <button type="button" data-filtro="todas">Todas</button>
          <button type="button" data-filtro="activa">Activas</button>
          <button type="button" data-filtro="desconectada">Desconectadas</button>
        </div>
        <label><span class="sr">Cliente</span><select class="selector" id="sesCli"></select></label>
        <label class="buscar">${ICO.lupa}<span class="sr">Buscar persona, servidor o equipo</span><input type="search" id="buscarSes" placeholder="Buscar persona, servidor o equipo" value="${esc(filtroSes)}"></label>
      </div>
      <section class="hoja desliza" id="tablaSes"></section>`;
    $('#buscarSes').addEventListener('input', e => { filtroSes = e.target.value; actualizar(r); });
    $('#sesCli').addEventListener('change', e => { filtroSesCli = e.target.value; actualizar(r); });
    v.querySelector('.segmentos').addEventListener('click', e => { const b = e.target.closest('[data-filtro]'); if (b) { filtroEstado = b.dataset.filtro; actualizar(r); } });
    enlazarTabla();
  } else if (r.vista === 'historial') {
    v.innerHTML = `
      <section class="titular"><h1 id="tituloHist">Historial</h1><p id="subHist">&nbsp;</p></section>
      <div class="cab-seccion">
        <h2>Sesiones</h2>
        <div class="segmentos" role="group" aria-label="Periodo" id="periodos">
          ${Object.entries(PERIODOS).map(([k, p]) => `<button type="button" data-periodo="${k}">${p.t}</button>`).join('')}
        </div>
        <label><span class="sr">Cliente</span><select class="selector" id="histCli"></select></label>
        <label class="buscar">${ICO.lupa}<span class="sr">Buscar persona, servidor o equipo</span><input type="search" id="histTexto" placeholder="Buscar persona o equipo" value="${esc(hist.texto)}"></label>
        <a class="btn" id="btnCsv" href="#">Exportar a Excel</a>
      </div>
      <section class="hoja desliza" id="tablaHist"></section>`;
    $('#periodos').addEventListener('click', e => { const b = e.target.closest('[data-periodo]'); if (b) { hist.periodo = b.dataset.periodo; guardar('histPeriodo', hist.periodo); cargarHistorial(); } });
    $('#histCli').addEventListener('change', e => { hist.cliente = e.target.value; cargarHistorial(); });
    let tTexto;
    $('#histTexto').addEventListener('input', e => { clearTimeout(tTexto); tTexto = setTimeout(() => { hist.texto = e.target.value; cargarHistorial(); }, 300); });
    hist.datos = null;
    cargarHistorial();
  } else if (equipo(r.id).tipo === 'mikrotik') {
    montarRouter(equipo(r.id), cliente(equipo(r.id).cliente));
  } else {
    const e = equipo(r.id), c = cliente(e.cliente);
    v.innerHTML = `
      <nav class="miga" aria-label="Ruta"><a href="#/">Clientes</a>${ICO.miga}<a href="#/c/${c.id}">${esc(c.nombre)}</a>${ICO.miga}<span>${esc(nombreEq(e))}</span></nav>
      <section class="srv-cab">
        <div><h1><span class="punto" id="srvPunto" aria-hidden="true"></span><span id="srvNombre"></span></h1><p id="srvMeta"></p></div>
        <div class="acciones">
          <a class="btn" href="/api/equipos/${e.id}/rdp" download="${esc(e.nombre)}.rdp">Conectar por Escritorio remoto</a>
          ${esAdmin() ? '<button class="btn" type="button" id="btnEditarEq">Editar</button>' : ''}
        </div>
      </section>
      <div id="srvAvisos"></div>
      <dl class="ficha" id="ficha"></dl>
      <div class="cab-seccion">
        <h2>Rendimiento</h2>
        <div class="segmentos" role="group" aria-label="Periodo de los gráficos" id="rangos">
          ${Object.entries(RANGOS).map(([k, x]) => `<button type="button" data-rango="${k}">${x.t}</button>`).join('')}
        </div>
      </div>
      <div class="rejilla-srv">
        <section class="panel"><div class="panel-cab"><h3>CPU</h3><span class="grande" id="cpuAhora"></span></div><p class="nota" id="cpuNota"></p><div class="grafico" id="grafCpu"></div></section>
        <section class="panel"><div class="panel-cab"><h3>Memoria</h3><span class="grande" id="ramAhora"></span></div><p class="nota" id="ramNota"></p><div class="grafico" id="grafRam"></div></section>
        <section class="panel discos"><div class="panel-cab"><h3>Discos</h3></div><div id="srvDiscos" style="margin-top:12px"></div></section>
      </div>
      <p class="disponibilidad" id="disponibilidad"></p>
      <div class="cab-seccion"><h2 id="srvSesTitulo">Sesiones</h2></div>
      <section class="hoja desliza" id="tablaSes"></section>`;
    $('#rangos').addEventListener('click', ev => { const b = ev.target.closest('[data-rango]'); if (!b) return; rango = b.dataset.rango; guardar('rango', rango); actualizar(r); });
    const be = $('#btnEditarEq'); if (be) be.addEventListener('click', () => editarEquipo(e.id));
    enlazarTabla();
  }
}

function actualizar(r = rutaActual()) {
  if (!estado) return;
  if (r.vista === 'resumen') vistaResumen();
  else if (r.vista === 'cliente') vistaCliente(r.id);
  else if (r.vista === 'sesiones') vistaSesiones();
  else if (r.vista === 'historial') vistaHistorial();
  else if (equipo(r.id) && equipo(r.id).tipo === 'mikrotik') vistaRouter(r.id);
  else vistaEquipo(r.id);
}

/* ---------------- Resumen de clientes ---------------- */
let filtroCli = '', filtroSes = '', filtroSesCli = '', filtroEstado = 'todas';
let orden = { campo: 'usuario', asc: true };

function chipsProblemas(p, conCliente) {
  $('#problemas').innerHTML = p.slice(0, 12).map(x =>
    `<li><button type="button" data-eq="${x.e.id}"><span class="marcador ${x.n}" aria-hidden="true"></span><span class="sr">${x.n === 'alerta' ? 'Alerta:' : 'Aviso:'}</span>${esc(x.t)}${conCliente ? ` <span class="tenue">${esc(x.e.clienteNombre)}</span>` : ''}</button></li>`).join('') +
    (p.length > 12 ? `<li><span class="tenue" style="line-height:36px">y ${p.length - 12} más</span></li>` : '');
}

function vistaResumen() {
  const cs = estado.clientes, eq = equipos(), p = problemas();
  const enLinea = eq.filter(e => e.estado === 'ok' || e.estado === 'sinMetricas').length;
  const ses = todasLasSesiones(), act = ses.filter(s => s.estado === 'activa').length;
  const graves = cs.filter(c => nivelCliente(c) === 'alerta').length, leves = cs.filter(c => nivelCliente(c) === 'aviso').length;
  let titulo;
  if (!cs.length) titulo = esAdmin() ? 'Agrega tu primer cliente para empezar.' : 'Todavía no tienes clientes asignados.';
  else if (!eq.length) titulo = 'Instala el agente en los servidores de tus clientes.';
  else if (graves) titulo = graves === 1 ? 'Un cliente necesita atención.' : `${graves} clientes necesitan atención.`;
  else if (leves) titulo = leves === 1 ? 'Todo en marcha, con un aviso.' : `Todo en marcha, con avisos en ${leves} clientes.`;
  else titulo = 'Todo en orden.';
  const contento = eq.length && !graves && !leves;
  $('#titular').classList.toggle('titular-gato', !!contento);
  const gatoT = $('#titular').querySelector('.gato');
  if (contento && !gatoT) $('#titular').insertAdjacentHTML('beforeend', gatoSVG('arreglando', 'El gato arreglando un servidor'));
  if (!contento && gatoT) gatoT.remove();
  let tt = $('#titular .texto'); if (!tt) { $('#titular').insertAdjacentHTML('afterbegin', '<div class="texto"></div>'); tt = $('#titular .texto'); }
  tt.innerHTML = `<h1>${titulo}</h1>` + (eq.length ? `<p><b>${enLinea} de ${eq.length}</b> equipos en línea en ${plural(cs.length, 'cliente', 'clientes')}: ${plural(eq.filter(e => e.tipo === 'windows').length, 'servidor', 'servidores')} y ${plural(eq.filter(e => e.tipo === 'mikrotik').length, 'router', 'routers')}. <b>${plural(act, 'sesión activa', 'sesiones activas')}</b> de Escritorio remoto.</p>` : '');
  chipsProblemas(p, true);
  $('#tituloTablero').innerHTML = `Clientes <span>${cs.length}</span>`;

  const f = filtroCli.trim().toLowerCase();
  const lista = cs.filter(c => !f || c.nombre.toLowerCase().includes(f) || String(c.grupo || '').toLowerCase().includes(f) || c.equipos.some(e => (e.nombre + ' ' + e.alias).toLowerCase().includes(f)));
  // Primero los que tienen problemas
  const peso = c => ({ alerta: 0, aviso: 1, ok: 2 })[nivelCliente(c)] + (c.equipos.length ? 0 : 3);
  lista.sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre));
  const t = $('#tablero');
  if (!cs.length) {
    t.innerHTML = gatoVacio('Todavía no hay clientes', 'Crea un cliente, descarga su agente y agrega sus routers. Yo me encargo de vigilarlos.', `<br><br>${esAdmin() ? '<button class="btn prim" type="button" id="btnPrimerCli">Crear el primer cliente</button>' : 'Pide a un administrador que te dé acceso.'}`);
    const b = $('#btnPrimerCli'); if (b) b.onclick = () => gestionClientes(null, true);
    return;
  }
  if (!lista.length) { t.innerHTML = `<div class="hoja vacio"><strong>Nada coincide con “${esc(filtroCli)}”</strong>Busca por el nombre del cliente o de uno de sus servidores.</div>`; return; }
  // Con grupos: cada empresa con sus sedes juntas; los clientes sin grupo, al final
  const gs = arr(estado.grupos).filter(g => lista.some(c => c.grupo_id === g.id));
  let filasH;
  if (!gs.length) filasH = lista.map(filaCliente).join('');
  else {
    const orden = [...gs.map(g => ({ g, l: lista.filter(c => c.grupo_id === g.id) })), { g: null, l: lista.filter(c => !c.grupo_id) }]
      .filter(x => x.l.length).sort((a, b) => (a.g ? 0 : 1) - (b.g ? 0 : 1) || Math.min(...a.l.map(peso)) - Math.min(...b.l.map(peso)) || (a.g ? a.g.nombre : '').localeCompare(b.g ? b.g.nombre : ''));
    filasH = orden.map(({ g, l }) => {
      const nv = l.some(c => nivelCliente(c) === 'alerta') ? 'alerta' : l.some(c => nivelCliente(c) === 'aviso') ? 'aviso' : 'ok';
      return `<div class="fila-grupo"><span class="marcador-grupo ${nv}" aria-hidden="true"></span><b>${g ? esc(g.nombre) : 'Sin grupo'}</b><span>${g ? plural(l.length, 'sede', 'sedes') : plural(l.length, 'cliente', 'clientes')}</span></div>` + l.map(filaCliente).join('');
    }).join('');
  }
  t.innerHTML = `<div class="tablero">
    <div class="tablero-cab cli" aria-hidden="true"><span>Cliente</span><span>Equipos</span><span>CPU más alta</span><span>Memoria más alta</span><span class="c-disco">Disco más lleno</span><span>Sesiones</span><span></span></div>
    ${filasH}</div>`;
  if (Date.now() - sucesosT > 30000) cargarSucesos(); else pintarSucesos();
}

function filaCliente(c) {
  const eq = c.equipos, vivos = eq.filter(e => e.estado === 'ok' || e.estado === 'sinMetricas');
  const nv = nivelCliente(c), p = problemas(eq);
  const max = (l, f) => l.reduce((m, x) => { const v = f(x); return v != null && (!m || v > m.v) ? { v, x } : m; }, null);
  const cpu = max(vivos, e => e.cpu), ram = max(vivos, e => e.ramPct);
  const disco = max(vivos.flatMap(e => e.discos.map(d => ({ ...d, e }))), d => d.pct);
  const act = vivos.reduce((n, e) => n + e.sesiones.filter(s => s.estado === 'activa').length, 0);
  const nS = eq.filter(e => e.tipo === 'windows').length, nR = eq.length - nS;
  const sub = !eq.length ? 'Sin equipos todavía' : p.length ? p[0].t + (p.length > 1 ? ` y ${p.length - 1} más` : '') : c.notas ? c.notas.split('\n')[0] : [nS && plural(nS, 'servidor', 'servidores'), nR && plural(nR, 'router', 'routers')].filter(Boolean).join(' y ');
  const val = (m, etq, extra) => m ? `<span class="medidor" data-etq="${etq}"><span class="valor">${m.v}<i>%</i></span><span class="carril n-${nivel(m.v)}"><span style="width:${m.v}%"></span></span><small>${esc(extra(m))}</small></span>` : `<span class="medidor" data-etq="${etq}"><span class="valor vacio-valor">—</span></span>`;
  return `<button type="button" class="fila cli ${nv}" data-cli="${c.id}" aria-label="${esc(c.nombre)}. Abrir">
    <span class="f-nombre"><span class="punto ${nv === 'alerta' ? 'caido' : nv === 'aviso' ? 'sinMetricas' : eq.length ? 'ok' : ''}" aria-hidden="true"></span><span><strong>${esc(c.nombre)}</strong><small>${esc(sub)}</small></span></span>
    <span class="f-luces" data-etq="Equipos">${eq.length ? `<span class="luces" aria-hidden="true">${eq.map(e => `<i class="${nivelDe(e)}" title="${esc(nombreEq(e))}: ${esc(ESTADOS[e.estado])}"></i>`).join('')}</span><small>${vivos.length} de ${eq.length} en línea</small>` : '<span class="cli-vacio">—</span>'}</span>
    ${val(cpu, 'CPU más alta', m => nombreEq(m.x))}
    ${val(ram, 'Memoria más alta', m => nombreEq(m.x))}
    <span class="f-disco">${val(disco, 'Disco más lleno', m => `${nombreEq(m.x.e)} ${m.x.unidad}`)}</span>
    <span class="f-ses" data-etq="Sesiones"><span class="valor">${eq.length ? act : '—'}</span><small>${eq.length ? (act === 1 ? 'activa' : 'activas') : ''}</small></span>
    ${ICO.flecha}</button>`;
}

/* ---------------- Últimos sucesos ---------------- */
const SUCESOS = { caida: ['caido', 'Dejó de responder'], vuelta: ['ok', 'Volvió a responder'], reinicio: ['sinMetricas', 'Se reinició'], nuevo: ['activa', 'Agente instalado'], 'wan-caida': ['caido', 'Se cayó el enlace WAN'], 'wan-vuelta': ['ok', 'Volvió el enlace WAN'] };
let sucesos = null, sucesosT = 0;
async function cargarSucesos() {
  try { sucesos = arr((await api('/api/eventos')).eventos); sucesosT = Date.now(); } catch (e) { if (e.login) return; sucesos = sucesos || []; }
  pintarSucesos();
}
function pintarSucesos() {
  const el = $('#sucesos'); if (!el || !sucesos) return;
  const r = rutaActual();
  const l = (r.vista === 'cliente' ? sucesos.filter(s => s.cliente_id === r.id) : sucesos).slice(0, 10);
  el.innerHTML = l.length ? `<ul class="sucesos">${l.map(s => {
    const [clase, txt] = SUCESOS[s.tipo] || ['', s.tipo];
    const eq = equipo(s.equipo_id);
    return `<li><span class="punto ${clase}" aria-hidden="true"></span><span><button type="button" data-eq="${s.equipo_id}">${esc(eq ? nombreEq(eq) : s.equipo)}</button>: ${esc(s.tipo === 'vuelta' && s.detalle ? s.detalle.replace(/\.$/, '') : txt)}</span>
      <small>${cuando(s.t)}${r.vista === 'resumen' ? `, ${esc(s.cliente)}` : ''}</small></li>`;
  }).join('')}</ul>` : '<div class="vacio">Sin sucesos todavía.</div>';
}

/* ---------------- Cliente ---------------- */
function vistaCliente(id) {
  const c = cliente(id), todos = c.equipos, eq = todos.filter(e => e.tipo !== 'mikrotik'), routers = todos.filter(e => e.tipo === 'mikrotik'), p = problemas(todos);
  $('#tituloRed').innerHTML = `Red <span>${routers.length}</span>`;
  $('#tableroRed').innerHTML = routers.length ? `<div class="tablero">
    <div class="tablero-cab rt" aria-hidden="true"><span>Router</span><span>CPU</span><span>Memoria</span><span>Internet ahora</span><span class="c-extra">Equipos con IP</span><span class="c-up">Encendido</span><span></span></div>
    ${routers.map(filaRouter).join('')}</div>` : gatoVacio('Sin routers', esAdmin() ? 'Agrega sus MikroTik para ver el tráfico, el enlace a Internet, DHCP, Wi‑Fi y VPN.' : 'Un administrador puede agregar sus routers MikroTik.');
  const vivos = todos.filter(e => e.estado === 'ok' || e.estado === 'sinMetricas').length;
  const ses = todasLasSesiones(eq), act = ses.filter(s => s.estado === 'activa').length, dsc = ses.filter(s => s.estado === 'desconectada').length;
  $('#cliTitulo').textContent = c.nombre;
  const graves = new Set(p.filter(x => x.n === 'alerta').map(x => x.e.id)).size;
  $('#cliSub').innerHTML = !todos.length ? 'Todavía no hay equipos. Descarga el agente de este cliente e instálalo en cada servidor, y agrega sus routers.' :
    `${graves ? `<b>${graves === 1 ? 'Un equipo necesita' : graves + ' equipos necesitan'} atención.</b> ` : ''}<b>${vivos} de ${todos.length}</b> equipos en línea, ${plural(act, 'sesión activa', 'sesiones activas')} y ${plural(dsc, 'desconectada', 'desconectadas')}.` +
    (c.notas ? `<br><span class="tenue">${esc(c.notas)}</span>` : '');
  chipsProblemas(p, false);
  $('#tituloTablero').innerHTML = `Servidores <span>${eq.length}</span>`;
  const t = $('#tablero');
  if (!eq.length) {
    t.innerHTML = gatoVacio('Sin servidores', esAdmin() ? 'Descarga el agente, cópialo a cada servidor y ejecuta “Instalar agente.bat”. Aparecerán aquí solos.<br><br><button class="btn prim" type="button" id="btnAg2">Descargar el agente</button>' : 'Un administrador tiene que instalar el agente en sus servidores.');
    const b = $('#btnAg2'); if (b) b.onclick = () => gestionClientes(c.id);
    if (Date.now() - sucesosT > 30000) cargarSucesos(); else pintarSucesos();
    return;
  }
  const lista = [...eq].sort((a, b) => ({ caido: 0, aviso: 1, pendiente: 2, ok: 3 })[nivelDe(a)] - ({ caido: 0, aviso: 1, pendiente: 2, ok: 3 })[nivelDe(b)] || a.nombre.localeCompare(b.nombre));
  t.innerHTML = `<div class="tablero">
    <div class="tablero-cab" aria-hidden="true"><span>Servidor</span><span>CPU, última hora</span><span>Memoria</span><span>Disco más lleno</span><span>Sesiones</span><span class="c-up">Encendido</span><span></span></div>
    ${lista.map(filaEquipo).join('')}</div>`;
  if (Date.now() - sucesosT > 30000) cargarSucesos(); else pintarSucesos();
}

function chispa(hist, clave, actual) {
  const pts = hist.filter(h => h[clave] != null);
  if (pts.length < 2) return '<svg class="chispa" aria-hidden="true"></svg>';
  const W = 120, H = 30, t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = t => (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * W, y = v => 2 + (1 - v / 100) * (H - 4);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[clave]).toFixed(1)}`).join('');
  const u = pts[pts.length - 1];
  return `<svg class="chispa" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path class="fondo" d="${d}L${W},${H}L0,${H}Z"/><path d="${d}" vector-effect="non-scaling-stroke"/>
    <circle class="n-${nivel(actual)}" cx="${x(u.t)}" cy="${y(u[clave])}" r="3.2" vector-effect="non-scaling-stroke"/></svg>`;
}
function medidor(v, sub, etq) {
  if (v == null) return `<span class="medidor" data-etq="${etq}"><span class="valor vacio-valor">—</span></span>`;
  return `<span class="medidor" data-etq="${etq}"><span class="valor">${v}<i>%</i></span>
    <span class="carril n-${nivel(v)}"><span style="width:${Math.min(100, Math.max(0, v))}%"></span></span>${sub ? `<small>${esc(sub)}</small>` : ''}</span>`;
}
function filaEquipo(s) {
  const act = s.sesiones.filter(x => x.estado === 'activa').length, dsc = s.sesiones.filter(x => x.estado === 'desconectada').length;
  const dm = s.discos.reduce((m, d) => !m || d.pct > m.pct ? d : m, null);
  const sinDatos = s.estado === 'caido' || s.estado === 'pendiente';
  let sub = s.alias ? `${s.nombre}, ${s.so || ''}`.replace(/, $/, '') : (s.so || ESTADOS[s.estado]);
  if (s.estado === 'caido') sub = `Sin respuesta desde ${cuando(s.ultimo)}`;
  if (s.estado === 'pendiente') sub = ESTADOS.pendiente;
  if (s.estado === 'sinMetricas') sub = 'En línea, sin datos de CPU ni memoria';
  const vacio = '<span></span>';
  return `<button type="button" class="fila ${esc(s.estado)}" data-eq="${s.id}" aria-label="${esc(nombreEq(s))}, ${esc(ESTADOS[s.estado])}. Abrir">
    <span class="f-nombre"><span class="punto ${esc(s.estado)}" aria-hidden="true"></span><span><strong>${esc(nombreEq(s))}</strong><small>${esc(sub)}</small></span></span>
    ${sinDatos || s.cpu == null ? `<span class="f-cpu" data-etq="CPU"><span class="valor vacio-valor">—</span></span>` :
      `<span class="f-cpu" data-etq="CPU"><span class="valor">${s.cpu}<i>%</i></span>${chispa(s.historial, 'cpu', s.cpu)}</span>`}
    ${sinDatos ? vacio + vacio : medidor(s.ramPct, s.ramTotal ? `${nf.format(s.ramUsada)} de ${nf.format(s.ramTotal)} GB` : '', 'Memoria') +
      medidor(dm ? dm.pct : null, dm ? `${dm.unidad} con ${nf.format(dm.libre)} GB libres` : '', 'Disco más lleno')}
    ${sinDatos ? vacio : `<span class="f-ses" data-etq="Sesiones"><span class="valor">${act}</span><small>${act === 1 ? 'activa' : 'activas'}${dsc ? `, ${dsc} desc.` : ''}</small></span>`}
    <span class="f-up">${sinDatos ? '' : esc(duracion(s.arranque))}</span>
    ${ICO.flecha}</button>`;
}

/* ---------------- Sesiones ---------------- */
function vistaSesiones() {
  document.querySelectorAll('[data-filtro]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filtro === filtroEstado)));
  const sel = $('#sesCli'), lista = estado.clientes.map(c => `${c.id}:${c.nombre}`).join('|');
  if (sel.dataset.lista !== lista) {
    sel.innerHTML = '<option value="">Todos los clientes</option>' + estado.clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    sel.dataset.lista = lista;
  }
  if (filtroSesCli && !cliente(filtroSesCli)) filtroSesCli = '';
  sel.value = filtroSesCli;
  const base = filtroSesCli ? cliente(filtroSesCli).equipos : equipos();
  const todas = todasLasSesiones(base.filter(e => e.estado !== 'caido'));
  const act = todas.filter(s => s.estado === 'activa').length, dsc = todas.filter(s => s.estado === 'desconectada').length;
  const personas = new Set(todas.map(s => s.usuario.toLowerCase())).size;
  $('#tituloSes').textContent = todas.length ? `${plural(personas, 'persona conectada', 'personas conectadas')}.` : 'Nadie conectado ahora.';
  $('#subSes').innerHTML = todas.length ? `<b>${plural(act, 'sesión activa', 'sesiones activas')}</b> y ${plural(dsc, 'desconectada', 'desconectadas')} en ${plural(new Set(todas.map(s => s.equipoId)).size, 'servidor', 'servidores')}${filtroSesCli ? '' : ` de ${plural(new Set(todas.map(s => s.cliente)).size, 'cliente', 'clientes')}`}.` : 'Cuando alguien entre por Escritorio remoto aparecerá aquí.';
  const f = filtroSes.trim().toLowerCase();
  const l = todas.filter(s => (filtroEstado === 'todas' || s.estado === filtroEstado) &&
    (!f || [s.usuario, s.servidor, s.equipo, s.dominio, s.cliente].some(v => String(v || '').toLowerCase().includes(f))));
  tabla(l, true, todas.length ? '<strong>Ninguna sesión coincide</strong>Cambia la búsqueda o el filtro.' : gatoSVG('programando') + '<strong>No hay sesiones</strong>Ahora mismo nadie está conectado.');
}

function tabla(lista, conServidor, vacio) {
  const val = (s, c) => c === 'inicio' || c === 'inactivo' || c === 'id' ? (s[c] == null ? -1 : s[c]) : String(s[c] == null ? '' : s[c]).toLowerCase();
  const filas = [...lista].sort((a, b) => { const va = val(a, orden.campo), vb = val(b, orden.campo); return (va < vb ? -1 : va > vb ? 1 : 0) * (orden.asc ? 1 : -1); });
  const t = $('#tablaSes');
  if (!filas.length) { t.innerHTML = `<div class="vacio gato-vacio">${vacio}</div>`; return; }
  const col = (c, txt) => `<th aria-sort="${orden.campo === c ? (orden.asc ? 'ascending' : 'descending') : 'none'}"><button type="button" data-orden="${c}">${txt}${orden.campo === c ? `<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="${orden.asc ? 'M5 2 9 8H1z' : 'M5 8 9 2H1z'}" fill="currentColor"/></svg>` : ''}</button></th>`;
  t.innerHTML = `<table><thead><tr>
    ${col('usuario', 'Persona')}${conServidor ? col('servidor', 'Servidor') + col('cliente', 'Cliente') : ''}${col('estado', 'Estado')}${col('equipo', 'Conectada desde')}${col('inactivo', 'Inactiva')}${col('inicio', 'Entró')}${col('id', 'ID')}
    </tr></thead><tbody>
    ${filas.map(s => `<tr>
        <td><span class="usr">${esc(s.usuario)}</span>${s.dominio ? `<span class="dom">${esc(s.dominio)}</span>` : ''}</td>
        ${conServidor ? `<td><button type="button" class="enlace" data-eq="${s.equipoId}">${esc(s.servidor)}</button></td><td class="tenue">${esc(s.cliente)}</td>` : ''}
        <td><span class="estado-ses"><span class="punto ${esc(s.estado)}" aria-hidden="true"></span>${esc(s.estadoTexto || s.estado)}</span></td>
        <td>${s.equipo ? esc(s.equipo) : '<span class="tenue">—</span>'}</td>
        <td>${inactivo(s.inactivo, s.estado)}</td>
        <td>${cuando(s.inicio)}</td>
        <td class="tenue">${esc(s.id)}</td>
      </tr>`).join('')}</tbody></table>`;
}
function enlazarTabla() {
  $('#tablaSes').addEventListener('click', e => {
    const o = e.target.closest('[data-orden]');
    if (o) { const c = o.dataset.orden; orden = { campo: c, asc: orden.campo === c ? !orden.asc : true }; actualizar(); }
  });
}

/* ---------------- Servidor ---------------- */
const RANGOS = {
  '1h': { t: '1 hora', ms: 3600e3, en: 'en la última hora' },
  '24h': { t: '24 horas', ms: 864e5, en: 'en las últimas 24 horas' },
  '7d': { t: '7 días', ms: 7 * 864e5, en: 'en los últimos 7 días' },
  '30d': { t: '30 días', ms: 30 * 864e5, en: 'en los últimos 30 días' }
};
let rango = RANGOS[leer('rango', '24h')] ? leer('rango', '24h') : '24h';
const histEq = {};
async function cargarHistEq(id, r) {
  const k = id + '|' + r;
  if (histEq[k] && histEq[k].pidiendo) return;
  histEq[k] = Object.assign(histEq[k] || {}, { pidiendo: true });
  try {
    const d = await api(`/api/equipos/${id}/metricas?rango=${r}`);
    histEq[k] = { ...d, puntos: arr(d.puntos), eventos: arr(d.eventos), cargado: Date.now() };
  } catch (e) { histEq[k] = { puntos: [], eventos: [], cargado: Date.now(), error: e.message }; }
  const ra = rutaActual();
  if (ra.vista === 'equipo' && ra.id === id && rango === r) actualizar(ra);
}

function vistaEquipo(id) {
  const s = equipo(id); if (!s) return;
  $('#srvPunto').className = 'punto ' + s.estado;
  $('#srvNombre').textContent = nombreEq(s);
  const meta = [ESTADOS[s.estado]];
  if (s.so) meta.push(s.so);
  if (s.arranque && s.estado !== 'caido') meta.push(`encendido hace ${duracion(s.arranque)}`);
  $('#srvMeta').textContent = meta.join(', ') + '.';

  let av = '';
  if (s.estado === 'caido') av += gatoError(`<b>No responde.</b> El agente no envía datos desde ${cuando(s.ultimo)}. Puede que el servidor esté apagado, sin conexión a Internet o que el servicio “NodeCat Agente” esté detenido. Los datos de abajo son los últimos que llegaron.`);
  if (s.estado === 'pendiente') av += `<div class="msg atencion">Este servidor está en la lista pero su agente todavía no ha enviado ningún informe.</div>`;
  if (s.estado === 'sinMetricas') av += `<div class="msg atencion"><b>El agente no puede leer la CPU, la memoria ni los discos.</b> ${esc(s.errorMetricas || '')}</div>`;
  if (s.errorSesiones) av += `<div class="msg atencion"><b>El agente no puede leer las sesiones.</b> ${esc(s.errorSesiones)}</div>`;
  const sa = $('#srvAvisos'); if (sa.dataset.v !== av) { sa.innerHTML = av; sa.dataset.v = av; }

  $('#ficha').innerHTML = [
    ['Cliente', esc(s.clienteNombre)], s.alias ? ['Nombre del equipo', esc(s.nombre)] : null,
    ['Último informe', s.ultimo ? cuando(s.ultimo) : '—'], ['Agente', s.version ? 'versión ' + esc(s.version) : '—'],
    ['Conecta desde', s.ip ? esc(s.ip) : '—']
  ].filter(Boolean).map(([k, v]) => `<div><dt><span>${k}</span></dt><dd style="margin:0">${v}</dd></div>`).join('');

  document.querySelectorAll('[data-rango]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rango === rango)));
  const r = RANGOS[rango], h0 = histEq[id + '|' + rango], h = h0 && h0.cargado ? h0 : null;
  if (!h0 || (h && Date.now() - h.cargado > 60000)) cargarHistEq(id, rango);
  const puntos = rango === '1h' && s.historial.length > 1 ? s.historial : (h ? h.puntos : null);
  const vivo = s.estado === 'ok' || s.estado === 'sinMetricas';
  for (const k of ['cpu', 'ram']) {
    const v = vivo ? (k === 'cpu' ? s.cpu : s.ramPct) : null;
    $(`#${k}Ahora`).innerHTML = v == null ? '<i>sin datos</i>' : `${v}<i>%</i>`;
    const vals = (puntos || []).map(p => p[k]).filter(x => x != null);
    const maxs = (puntos || []).map(p => p[k + 'Max'] != null ? p[k + 'Max'] : p[k]).filter(x => x != null);
    let nota = '';
    if (k === 'ram' && s.ramTotal && vivo) nota = `${nf.format(s.ramUsada)} de ${nf.format(s.ramTotal)} GB en uso. `;
    if (vals.length > 1) nota += `Media de ${Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)} %, máximo ${Math.max(...maxs)} % ${r.en}.`;
    $(`#${k}Nota`).textContent = nota || ' ';
  }
  $('#grafCpu').classList.toggle('cargando', !puntos);
  $('#grafRam').classList.toggle('cargando', !puntos);
  grafico($('#grafCpu'), puntos || [], 'cpu', 'CPU', r.ms);
  grafico($('#grafRam'), puntos || [], 'ram', 'Memoria', r.ms);

  const disp = $('#disponibilidad');
  if (!h) disp.innerHTML = '&nbsp;';
  else {
    const caidas = h.eventos.filter(e => e.tipo === 'caida');
    const pct = h.disponibilidad >= 99.995 ? '100' : nf.format(Math.floor(h.disponibilidad * 100) / 100);
    disp.innerHTML = `<span><b>${pct} %</b> del tiempo en línea ${r.en}.</span>` + (!caidas.length ? `<span class="tenue">Sin caídas.</span>` :
      `<span>${plural(caidas.length, 'caída', 'caídas')}:</span>` + caidas.slice(-6).reverse().map(c => {
        const v = h.eventos.find(e => e.tipo === 'vuelta' && e.t > c.t);
        return `<span class="caida"><span class="punto caido" aria-hidden="true"></span>${cuando(c.t)}, ${v ? durTxt(v.t - c.t) : 'sigue sin responder'}</span>`;
      }).join(''));
  }

  $('#srvDiscos').innerHTML = s.discos.length ? s.discos.map(d => `
    <div class="disco"><div class="disco-cab"><strong>${esc(d.unidad)}</strong><span class="tenue">${esc(d.etiqueta || '')}</span><span class="pct">${d.pct} %</span></div>
    <div class="carril n-${nivel(d.pct)}" role="img" aria-label="${esc(d.unidad)}: ${d.pct} % usado"><span style="width:${d.pct}%"></span></div>
    <small>${nf.format(d.libre)} GB libres de ${nf.format(d.total)} GB</small></div>`).join('') : '<p class="tenue">Sin datos de discos.</p>';

  const ses = vivo ? s.sesiones : [];
  const act = ses.filter(x => x.estado === 'activa').length, dsc = ses.filter(x => x.estado === 'desconectada').length;
  $('#srvSesTitulo').innerHTML = `Sesiones <span>${plural(act, 'activa', 'activas')}, ${plural(dsc, 'desconectada', 'desconectadas')}</span>`;
  tabla(ses.map(x => ({ ...x, servidor: nombreEq(s), equipoId: s.id })), false,
    !vivo ? '<strong>Sin datos</strong>El servidor no responde.' : '<strong>Nadie conectado a este servidor</strong>Las sesiones de Escritorio remoto aparecerán aquí.');
}

function grafico(el, historial, clave, nombre, span) {
  const pts = historial.filter(h => h[clave] != null);
  const largo = span > 36 * 3600e3;
  const etq = t => largo ? new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' }) : hora(t);
  const etqLarga = t => largo ? new Date(t).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : hora(t);
  if (pts.length < 2) { el.innerHTML = `<div class="sin-datos">${historial === null ? 'Cargando…' : 'Todavía no hay datos de este periodo. Se van guardando desde que el agente empezó a informar.'}</div>`; return; }
  const W = Math.max(240, el.clientWidth), H = el.clientHeight || 170;
  const m = { i: 30, d: 44, a: 8, b: 22 };
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = t => m.i + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (W - m.i - m.d);
  const y = v => m.a + (1 - v / 100) * (H - m.a - m.b);
  // Se corta la línea donde faltan datos (más de 3 pasos seguidos)
  const paso = (t1 - t0) / Math.max(1, pts.length - 1);
  let d = '';
  pts.forEach((p, i) => { d += `${i && p.t - pts[i - 1].t < Math.max(paso * 4, 5 * 60000) ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[clave]).toFixed(1)}`; });
  const u = pts[pts.length - 1], vals = pts.map(p => p[clave]);
  const rej = [0, 50, 100].map(v => `<line class="rejilla" x1="${m.i}" x2="${W - m.d}" y1="${y(v)}" y2="${y(v)}"/><text class="eje" x="${m.i - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${nombre}: último valor ${u[clave]} %, máximo ${Math.max(...vals)} %, mínimo ${Math.min(...vals)} %, entre ${etqLarga(t0)} y ${etqLarga(t1)}">
    ${rej}<line class="umbral" x1="${m.i}" x2="${W - m.d}" y1="${y(ALTO)}" y2="${y(ALTO)}"/>
    <path class="linea" d="${d}"/>
    <circle class="ultimo" cx="${x(u.t)}" cy="${y(u[clave])}" r="4.5"/>
    <text class="fin" x="${x(u.t) + 9}" y="${y(u[clave]) + 4}">${u[clave]} %</text>
    <text class="eje" x="${m.i}" y="${H - 4}">${etq(t0)}</text><text class="eje" x="${W - m.d}" y="${H - 4}" text-anchor="end">${etq(t1)}</text>
    <g class="hover" visibility="hidden"><line class="cruz" y1="${m.a}" y2="${y(0)}"/><circle class="ultimo" r="4.5"/></g>
    <rect class="captura" x="${m.i}" y="0" width="${W - m.i - m.d}" height="${H}" fill="transparent"/></svg><div class="globo" hidden></div>`;
  const svg = el.querySelector('svg'), g = svg.querySelector('.hover'), globo = el.querySelector('.globo');
  svg.querySelector('.captura').addEventListener('mousemove', ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
    let mejor = pts[0], dist = Infinity;
    for (const p of pts) { const dd = Math.abs(x(p.t) - px); if (dd < dist) { dist = dd; mejor = p; } }
    const cx = x(mejor.t), cy = y(mejor[clave]);
    g.setAttribute('visibility', 'visible');
    g.querySelector('line').setAttribute('x1', cx); g.querySelector('line').setAttribute('x2', cx);
    g.querySelector('circle').setAttribute('cx', cx); g.querySelector('circle').setAttribute('cy', cy);
    globo.hidden = false;
    const mx = mejor[clave + 'Max'];
    globo.innerHTML = `${etqLarga(mejor.t)}&nbsp;&nbsp;<b>${mejor[clave]} %</b>${mx != null && mx !== mejor[clave] ? `&nbsp;<span style="opacity:.7">(máx. ${mx} %)</span>` : ''}`;
    globo.style.left = (cx * r.width / W) + 'px'; globo.style.top = (cy * r.height / H) + 'px';
    globo.classList.toggle('abajo', cy < 46);
  });
  svg.querySelector('.captura').addEventListener('mouseleave', () => { g.setAttribute('visibility', 'hidden'); globo.hidden = true; });
}
let tRedim;
window.addEventListener('resize', () => { clearTimeout(tRedim); tRedim = setTimeout(() => { if (estado && rutaActual().vista === 'equipo') actualizar(); }, 150); });

/* ---------------- Historial ---------------- */
const PERIODOS = {
  hoy: { t: 'Hoy', en: 'hoy', desde: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); } },
  '7d': { t: '7 días', en: 'en los últimos 7 días', desde: () => Date.now() - 7 * 864e5 },
  '30d': { t: '30 días', en: 'en los últimos 30 días', desde: () => Date.now() - 30 * 864e5 },
  '90d': { t: '90 días', en: 'en los últimos 90 días', desde: () => Date.now() - 90 * 864e5 }
};
const hist = { periodo: PERIODOS[leer('histPeriodo', '7d')] ? leer('histPeriodo', '7d') : '7d', cliente: '', texto: '', datos: null, cargado: 0 };
function paramsHist() {
  const q = new URLSearchParams({ desde: PERIODOS[hist.periodo].desde(), hasta: Date.now() });
  if (hist.cliente) q.set('cliente', hist.cliente);
  if (hist.texto.trim()) q.set('texto', hist.texto.trim());
  return q;
}
async function cargarHistorial() {
  if (rutaActual().vista !== 'historial') return;
  const t = $('#tablaHist'); if (t) t.classList.add('cargando');
  try { hist.datos = arr((await api('/api/historial/sesiones?' + paramsHist())).sesiones); hist.cargado = Date.now(); }
  catch (e) { if (!e.login) aviso(e.message, true); hist.datos = hist.datos || []; }
  if (t) t.classList.remove('cargando');
  vistaHistorial();
}
function vistaHistorial() {
  if (!$('#tablaHist')) return;
  if (hist.datos && Date.now() - hist.cargado > 60000) cargarHistorial();
  document.querySelectorAll('[data-periodo]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.periodo === hist.periodo)));
  const sel = $('#histCli'), lista = estado.clientes.map(c => `${c.id}:${c.nombre}`).join('|');
  if (sel.dataset.lista !== lista) {
    sel.innerHTML = '<option value="">Todos los clientes</option>' + estado.clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    sel.dataset.lista = lista;
  }
  sel.value = hist.cliente;
  const q = paramsHist(); q.set('csv', '1');
  $('#btnCsv').href = '/api/historial/sesiones?' + q;
  if (!hist.datos) { $('#tablaHist').innerHTML = gatoCargando('Buscando en el historial…'); return; }
  const l = hist.datos, P = PERIODOS[hist.periodo], ahora = Date.now();
  const personas = new Set(l.map(x => x.usuario.toLowerCase())).size;
  const dur = l.map(x => (x.fin || ahora) - x.inicio);
  $('#tituloHist').textContent = l.length ? `${plural(l.length, 'sesión', 'sesiones')} de ${plural(personas, 'persona', 'personas')} ${P.en}.` : `Sin sesiones ${P.en}.`;
  $('#subHist').innerHTML = l.length ? `Duración media de <b>${durTxt(dur.reduce((a, b) => a + b, 0) / dur.length)}</b>. ${plural(l.filter(x => !x.fin).length, 'sigue conectada', 'siguen conectadas')} ahora.${l.length >= 5000 ? ' Se muestran las 5.000 más recientes; exporta a Excel para verlas por partes.' : ''}` :
    'El historial empieza a guardarse cuando el agente de cada servidor empieza a informar.';
  if (!l.length) { $('#tablaHist').innerHTML = `<div class="vacio gato-vacio">${gatoSVG('programando')}<strong>No hay sesiones que mostrar</strong>${hist.texto || hist.cliente ? 'Cambia la búsqueda, el cliente o el periodo.' : 'Prueba con un periodo más largo.'}</div>`; return; }
  $('#tablaHist').innerHTML = `<table><thead><tr><th>Persona</th><th>Servidor</th><th>Cliente</th><th>Conectada desde</th><th>Entró</th><th>Salió</th><th>Duración</th><th>Desconexiones</th></tr></thead><tbody>
    ${l.slice(0, 1500).map(x => `<tr>
      <td><span class="usr">${esc(x.usuario)}</span>${x.dominio ? `<span class="dom">${esc(x.dominio)}</span>` : ''}</td>
      <td><button type="button" class="enlace" data-eq="${x.equipo_id}">${esc(x.alias || x.equipo)}</button></td>
      <td class="tenue">${esc(x.cliente)}</td>
      <td>${x.origen ? esc(x.origen) : '<span class="tenue">—</span>'}</td>
      <td>${cuando(x.inicio)}</td>
      <td>${x.fin ? cuando(x.fin) : '<span class="estado-ses"><span class="punto activa" aria-hidden="true"></span>Sigue conectada</span>'}</td>
      <td>${durTxt((x.fin || ahora) - x.inicio)}</td>
      <td>${x.desconexiones ? x.desconexiones : '<span class="tenue">—</span>'}</td></tr>`).join('')}</tbody></table>
    ${l.length > 1500 ? `<div class="vacio">Se muestran 1.500 de ${l.length.toLocaleString('es')}. Exporta a Excel para verlas todas.</div>` : ''}`;
}

/* ======================================================================
   Menús, avisos y diálogos
   ====================================================================== */
function menuEn(boton, items, cab) {
  const menu = $('#menu');
  menu.innerHTML = (cab || '') + items.map((it, i) => it.sep ? '<hr>' : `<button type="button" role="menuitem" data-i="${i}" class="${it.peligro ? 'peligro' : ''}">${esc(it.t)}</button>`).join('');
  menu.hidden = false;
  const r = boton.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  menu.style.top = (r.bottom + h + 8 > innerHeight ? r.top - h - 6 : r.bottom + 6) + 'px';
  const p = menu.querySelector('button'); if (p) p.focus();
  menu.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; cerrarMenu(); items[+b.dataset.i].fn(); };
}
function cerrarMenu() { $('#menu').hidden = true; }
document.addEventListener('click', e => { if (!e.target.closest('#menu, #btnCuenta')) cerrarMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarMenu(); });

function aviso(texto, error) {
  const d = document.createElement('div');
  d.className = 'toast' + (error ? ' error con-gato' : '');
  d.setAttribute('role', error ? 'alert' : 'status');
  if (error) { d.innerHTML = gatoSVG('avergonzado'); d.append(texto); caraDeGato('avergonzado', 5000); } else d.textContent = texto;
  $('#avisos').appendChild(d);
  setTimeout(() => d.remove(), error ? 9000 : 4500);
}

function libre(html, ancho) {
  const dlg = $('#dialogo');
  dlg.onclose = null;
  dlg.className = ancho ? 'ancho' : '';
  dlg.innerHTML = `<div class="dlg">${html}</div>`;
  if (!dlg.open) dlg.showModal();
  dlg.querySelectorAll('[data-cerrar]').forEach(b => b.onclick = () => dlg.close());
  return dlg;
}
const ocupado = async (b, texto, fn) => { const t = b.textContent; b.disabled = true; b.textContent = texto; try { await fn(); } finally { b.disabled = false; b.textContent = t; } };

/* ---------------- Clientes y agentes ---------------- */
async function gestionClientes(abrirId, crear) {
  let datos;
  const recargar = async () => { datos = await api('/api/clientes'); };
  try { await recargar(); } catch (x) { if (!x.login) aviso(x.message, true); return; }
  let abierto = abrirId || null, confirmar = null, msg = '';
  const pintar = () => {
    const l = datos.clientes;
    const eqDe = id => { const c = cliente(id); return c ? c.equipos.length : 0; };
    const dlg = libre(`<h3>Clientes y agentes</h3>
      <p>Cada cliente tiene su propio agente con su clave. Al instalarlo en un servidor, este aparece solo dentro de su cliente. El agente envía los datos por HTTPS, así que no hace falta VPN ni abrir puertos en el cliente.</p>
      ${!datos.agente ? '<div class="msg atencion">Esta instalación no incluye el ejecutable del agente (agente/NodeCatAgente.exe), así que la descarga no funcionará.</div>' : ''}
      ${msg ? `<div class="msg bien" role="status">${esc(msg)}</div>` : ''}
      <form id="fNuevo" class="en-linea" style="margin-bottom:14px">
        <label class="campo">Nuevo cliente o sede<input name="nombre" maxlength="60" placeholder="Nombre de la empresa o la sede" autocomplete="off"></label>
        <label class="campo">Grupo <span class="ayuda-campo">opcional</span><input name="grupo" list="listaGruposN" maxlength="60" placeholder="Sin grupo" autocomplete="off"><datalist id="listaGruposN">${arr(datos.grupos).map(g => `<option value="${esc(g.nombre)}">`).join('')}</datalist></label>
        <button class="btn prim" type="submit">Crear cliente</button>
      </form>
      ${l.length ? `<div class="lista-cli">${l.map(c => `<div>
        <span><strong>${esc(c.nombre)}</strong><small>${c.grupo ? `${esc(c.grupo)}, ` : ''}${plural(eqDe(c.id), 'equipo', 'equipos')}</small></span>
        <span class="acciones">
          <a class="btn prim" href="/api/clientes/${c.id}/agente?t=${encodeURIComponent(CSRF)}">Descargar agente</a>
          <button class="btn" type="button" data-ver="${c.id}" aria-expanded="${abierto === c.id}">${abierto === c.id ? 'Ocultar' : 'Más'}</button>
        </span>
        ${abierto === c.id ? `<div class="detalle">
          <ol class="pasos"><li>Descarga el agente de <b>${esc(c.nombre)}</b>. Ya va configurado para enviar a <b>${esc(datos.url)}</b>.</li>
            <li>Copia la carpeta a cada servidor del cliente y haz doble clic en <b>Instalar agente.bat</b>.</li>
            <li>En unos segundos el servidor aparecerá dentro de ${esc(c.nombre)}.</li></ol>
          <details class="clave"><summary>Clave del agente</summary>
            <p>Va incluida en la descarga. Si generas una nueva, los agentes ya instalados de este cliente dejarán de enviar datos hasta que actualices su agente.json.</p>
            <code class="codigo">${esc(c.clave)}</code>
            <button class="btn ${confirmar === 'clave' + c.id ? 'peligro' : ''}" type="button" data-clave="${c.id}">${confirmar === 'clave' + c.id ? '¿Seguro? Generar una clave nueva' : 'Generar una clave nueva'}</button>
          </details>
          <p style="margin:14px 0 0"><button class="btn" type="button" data-editar="${c.id}">Cambiar nombre o notas</button>
            <button class="btn ${confirmar === 'borrar' + c.id ? 'peligro' : ''}" type="button" data-borrar="${c.id}">${confirmar === 'borrar' + c.id ? `¿Seguro? Se borra con sus ${eqDe(c.id)} servidores y su historial` : 'Borrar cliente'}</button></p>
        </div>` : ''}
      </div>`).join('')}</div>` : '<p class="tenue">Todavía no hay clientes.</p>'}
      ${arr(datos.grupos).length ? `<details class="clave separado"><summary>Grupos (${datos.grupos.length})</summary>
        <p>Un grupo junta las sedes de una misma empresa. Al dar acceso a una cuenta sobre un grupo, ve todas sus sedes, también las que agregues después.</p>
        <div class="lista-cli">${datos.grupos.map(g => `<div><span><strong>${esc(g.nombre)}</strong><small>${plural(datos.clientes.filter(c => c.grupo_id === g.id).length, 'sede', 'sedes')}</small></span>
          <span class="acciones"><button class="btn" type="button" data-renombrar-grupo="${g.id}">Cambiar nombre</button><button class="btn ${confirmar === 'grupo' + g.id ? 'peligro' : ''}" type="button" data-borrar-grupo="${g.id}">${confirmar === 'grupo' + g.id ? '¿Seguro? Las sedes quedan sin grupo' : 'Borrar grupo'}</button></span></div>`).join('')}</div>
      </details>` : ''}
      <details class="clave separado" ${datos.urlGuardada ? '' : ''}><summary>Dirección de NodeCat para los agentes</summary>
        <p>Los agentes envían sus datos a esta dirección. Debe ser accesible desde los servidores de tus clientes, idealmente con HTTPS (por ejemplo, con Cloudflare Tunnel). Si la dejas vacía se usa la dirección con la que abriste esta página.</p>
        <form id="fUrl" class="en-linea"><label class="campo"><span class="sr">Dirección</span><input name="url" placeholder="${esc(datos.url)}" value="${esc(datos.urlGuardada)}" spellcheck="false"></label><button class="btn" type="submit" style="margin-top:0">Guardar</button></form>
      </details>
      <div class="pie"><button class="btn" type="button" data-cerrar>Cerrar</button></div>`, true);
    const err = m => aviso(m, true);
    if (confirmar && confirmar.startsWith('clave')) { const d = dlg.querySelector('.detalle details'); if (d) d.open = true; }
    const fn = dlg.querySelector('#fNuevo');
    if (crear) { fn.nombre.focus(); crear = false; }
    fn.onsubmit = async ev => {
      ev.preventDefault();
      try { const r = await enviar('/api/clientes', 'POST', { nombre: fn.nombre.value, grupo: fn.grupo.value.trim() || null }); await recargar(); abierto = r.id; msg = `Cliente ${fn.nombre.value.trim()} creado. Descarga su agente e instálalo en sus servidores.`; confirmar = null; pintar(); cargar(true); }
      catch (x) { if (!x.login) err(x.message); }
    };
    dlg.querySelector('#fUrl').onsubmit = async ev => {
      ev.preventDefault();
      try { await enviar('/api/ajustes/url', 'PUT', { url: ev.currentTarget.url.value }); await recargar(); msg = 'Dirección guardada. Las próximas descargas del agente ya la incluyen.'; pintar(); }
      catch (x) { if (!x.login) err(x.message); }
    };
    dlg.querySelectorAll('[data-renombrar-grupo]').forEach(b => b.onclick = async () => {
      const g = datos.grupos.find(x => x.id === +b.dataset.renombrarGrupo);
      const nombre = prompt('Nuevo nombre del grupo', g.nombre); if (!nombre || nombre.trim() === g.nombre) return;
      try { await enviar(`/api/grupos/${g.id}`, 'PUT', { nombre }); await recargar(); msg = 'Grupo renombrado.'; pintar(); cargar(true); } catch (x) { if (!x.login) err(x.message); }
    });
    dlg.querySelectorAll('[data-borrar-grupo]').forEach(b => b.onclick = async () => {
      const id = +b.dataset.borrarGrupo;
      if (confirmar !== 'grupo' + id) { confirmar = 'grupo' + id; pintar(); return; }
      try { await enviar(`/api/grupos/${id}`, 'DELETE'); await recargar(); confirmar = null; msg = 'Grupo borrado. Sus sedes siguen ahí, sin grupo.'; pintar(); cargar(true); } catch (x) { if (!x.login) err(x.message); }
    });
    dlg.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => { const id = +b.dataset.ver; abierto = abierto === id ? null : id; confirmar = null; msg = ''; pintar(); });
    dlg.querySelectorAll('[data-editar]').forEach(b => b.onclick = () => editarCliente(+b.dataset.editar, () => gestionClientes(+b.dataset.editar)));
    dlg.querySelectorAll('[data-clave]').forEach(b => b.onclick = async () => {
      const id = +b.dataset.clave;
      if (confirmar !== 'clave' + id) { confirmar = 'clave' + id; pintar(); return; }
      try { await enviar(`/api/clientes/${id}/clave`, 'POST'); await recargar(); confirmar = null; msg = 'Clave nueva generada. Descarga otra vez el agente para los servidores nuevos.'; pintar(); }
      catch (x) { if (!x.login) err(x.message); }
    });
    dlg.querySelectorAll('[data-borrar]').forEach(b => b.onclick = async () => {
      const id = +b.dataset.borrar;
      if (confirmar !== 'borrar' + id) { confirmar = 'borrar' + id; pintar(); return; }
      try { const n = datos.clientes.find(c => c.id === id).nombre; await enviar(`/api/clientes/${id}`, 'DELETE'); await recargar(); confirmar = null; abierto = null; msg = `Cliente ${n} borrado.`; pintar(); cargar(true); }
      catch (x) { if (!x.login) err(x.message); }
    });
  };
  pintar();
}

async function editarCliente(id, despues) {
  let c, gs = [];
  try { const d = await api('/api/clientes'); c = d.clientes.find(x => x.id === id); gs = arr(d.grupos); } catch (x) { if (!x.login) aviso(x.message, true); return; }
  if (!c) return;
  const dlg = libre(`<form><h3>Editar cliente</h3>
    <label class="campo">Nombre<input name="nombre" maxlength="60" value="${esc(c.nombre)}" required></label>
    <label class="campo">Grupo o empresa <span class="ayuda-campo">Opcional. Para juntar las sedes de una misma empresa. Escribe uno nuevo o elige uno existente.</span>
      <input name="grupo" list="listaGrupos" maxlength="60" value="${esc(c.grupo || '')}" placeholder="Sin grupo" autocomplete="off"><datalist id="listaGrupos">${gs.map(g => `<option value="${esc(g.nombre)}">`).join('')}</datalist></label>
    <label class="campo">Notas<textarea name="notas" maxlength="500" placeholder="Contacto, horario, contrato…">${esc(c.notas)}</textarea><span class="ayuda-campo">Las ve todo el que tenga acceso a este cliente.</span></label>
    <div class="msg error" role="alert" hidden></div>
    <div class="pie"><button class="btn" type="button" data-borrar style="margin-right:auto">Borrar cliente</button><button class="btn" type="button" data-cerrar>Cancelar</button><button class="btn prim" type="submit">Guardar</button></div></form>`);
  const f = dlg.querySelector('form'), e = f.querySelector('.msg');
  f.nombre.focus();
  const n = (cliente(id) || { equipos: [] }).equipos.length;
  let confirmar = false;
  const bb = f.querySelector('[data-borrar]');
  bb.onclick = async () => {
    if (!confirmar) { confirmar = true; bb.className = 'btn peligro'; bb.textContent = n ? `¿Seguro? Se borra con sus ${n} equipos y su historial` : '¿Seguro? Borrar cliente'; return; }
    try { await enviar(`/api/clientes/${id}`, 'DELETE'); dlg.close(); aviso(`Cliente ${c.nombre} borrado.`); location.hash = '#/'; await cargar(true); }
    catch (x) { if (!x.login) gatoDice(e, x.message) }
  };
  f.onsubmit = async ev => {
    ev.preventDefault();
    try { await enviar(`/api/clientes/${id}`, 'PUT', { nombre: f.nombre.value, notas: f.notas.value, grupo: f.grupo.value.trim() || null }); dlg.close(); aviso('Cliente guardado.'); montada = null; await cargar(true); if (despues) despues(); }
    catch (x) { if (!x.login) gatoDice(e, x.message) }
  };
}

function editarEquipo(id) {
  const s = equipo(id); if (!s) return;
  let confirmar = false;
  const dlg = libre(`<form><h3>Editar ${esc(s.nombre)}</h3>
    <label class="campo">Nombre visible<input name="alias" maxlength="60" value="${esc(s.alias)}" placeholder="${esc(s.nombre)}"><span class="ayuda-campo">Opcional. Por ejemplo “Servidor de facturación”. Vacío para usar el nombre del equipo.</span></label>
    <label class="campo">Cliente<select name="cliente">${estado.clientes.map(c => `<option value="${c.id}" ${c.id === s.cliente ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>
      <span class="ayuda-campo">Si lo cambias de cliente, recuerda que su agente sigue usando la clave del cliente original y volvería a aparecer allí. Lo correcto es reinstalarlo con el agente del cliente nuevo.</span></label>
    <div class="msg error" role="alert" hidden></div>
    <div class="pie"><button class="btn" type="button" data-quitar style="margin-right:auto">Quitar de NodeCat</button><button class="btn" type="button" data-cerrar>Cancelar</button><button class="btn prim" type="submit">Guardar</button></div></form>`);
  const f = dlg.querySelector('form'), e = f.querySelector('.msg');
  f.onsubmit = async ev => {
    ev.preventDefault();
    try { await enviar(`/api/equipos/${id}`, 'PUT', { alias: f.alias.value, cliente: +f.cliente.value }); dlg.close(); aviso('Cambios guardados.'); montada = null; await cargar(true); }
    catch (x) { if (!x.login) gatoDice(e, x.message) }
  };
  const bq = f.querySelector('[data-quitar]');
  bq.onclick = async () => {
    if (!confirmar) { confirmar = true; bq.className = 'btn peligro'; bq.textContent = '¿Seguro? Se borra su historial'; return; }
    try { await enviar(`/api/equipos/${id}`, 'DELETE'); dlg.close(); aviso(`${s.nombre} quitado. Si su agente sigue instalado, volverá a aparecer; desinstálalo en el servidor.`); location.hash = '#/c/' + s.cliente; await cargar(true); }
    catch (x) { if (!x.login) gatoDice(e, x.message) }
  };
}

/* ---------------- Mi cuenta ---------------- */
$('#btnCuenta').addEventListener('click', e => {
  if (!SESION) return;
  if (!$('#menu').hidden) { cerrarMenu(); return; }
  const it = [{ t: 'Cambiar mi contraseña', fn: cambiarClave }];
  if (esAdmin()) it.push({ t: 'Clientes y agentes', fn: () => gestionClientes() }, { t: 'Cuentas de acceso', fn: cuentas }, { t: 'Notificaciones por Telegram', fn: notificaciones });
  if ('Notification' in window && Notification.permission === 'default') it.push({ t: 'Avisos del gato en el escritorio', fn: () => Notification.requestPermission().then(p => aviso(p === 'granted' ? 'Listo: el gato te avisará aunque NodeCat esté en otra pestaña.' : 'Sin permiso del navegador; los avisos solo saldrán dentro de la página.', p !== 'granted')) });
  it.push({ sep: true }, { t: 'Cerrar sesión', fn: salir });
  const alcance = SESION.clientes ? `, ${plural(SESION.clientes.length, 'cliente', 'clientes')}` : '';
  menuEn(e.currentTarget, it, `<div class="menu-cab"><b>${esc(SESION.usuario)}</b><span>${ROLES[SESION.rol] || esc(SESION.rol)}${alcance}${SESION.demo ? ', modo demo' : ''}</span></div>`);
});

function cambiarClave() {
  const dlg = libre(`<form><h3>Cambiar mi contraseña</h3><p>Al cambiarla se cierra tu sesión en los demás navegadores.</p>
    <input type="text" name="usuario" autocomplete="username" value="${esc(SESION.usuario)}" hidden>
    <label class="campo">Contraseña actual<input type="password" name="actual" autocomplete="current-password" required></label>
    <label class="campo">Contraseña nueva<input type="password" name="nueva" autocomplete="new-password" minlength="10" required><span class="ayuda-campo">Mínimo 10 caracteres.</span></label>
    <label class="campo">Repite la contraseña nueva<input type="password" name="repite" autocomplete="new-password" required></label>
    <div class="msg error" role="alert" hidden></div>
    <div class="pie"><button class="btn" type="button" data-cerrar>Cancelar</button><button class="btn prim" type="submit">Cambiar contraseña</button></div></form>`);
  const f = dlg.querySelector('form'), e = f.querySelector('.msg');
  f.actual.focus();
  f.onsubmit = async ev => {
    ev.preventDefault();
    if (f.nueva.value !== f.repite.value) { gatoDice(e, 'Las contraseñas nuevas no coinciden.'); return; }
    try { await enviar('/api/clave', 'POST', { actual: f.actual.value, nueva: f.nueva.value }); dlg.close(); aviso('Contraseña cambiada.'); }
    catch (x) { if (!x.login) gatoDice(e, x.message) }
  };
}

async function cuentas() {
  let lista = [];
  const recargar = async () => { lista = arr((await api('/api/cuentas')).cuentas); };
  try { await recargar(); } catch (x) { if (!x.login) aviso(x.message, true); return; }
  let editando = null, borrando = null;
  const gruposTodos = arr((await api('/api/clientes').catch(() => ({}))).grupos);
  const alcance = c => !c.clientes && !c.grupos ? 'Todos' : [...arr(c.grupos).map(id => ((gruposTodos.find(g => g.id === id) || { nombre: '?' }).nombre) + ' (grupo)'), ...arr(c.clientes).map(id => (cliente(id) || { nombre: '?' }).nombre)].join(', ') || 'Ninguno';
  const pintar = (msg, bien) => {
    const yo = c => c.usuario.toLowerCase() === SESION.usuario.toLowerCase();
    const sel = editando && editando.clientes ? editando.clientes : [], selG = editando && editando.grupos ? editando.grupos : [];
    const dlg = libre(`<h3>Cuentas de acceso</h3>
      <p>Los administradores gestionan clientes, cuentas y notificaciones. Las cuentas de solo lectura únicamente miran. Puedes limitar cualquier cuenta a algunos clientes, por ejemplo para que un cliente vea solo lo suyo.</p>
      <div class="tabla-dlg desliza"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Clientes</th><th>Último acceso</th><th><span class="sr">Acciones</span></th></tr></thead><tbody>
      ${lista.map(c => `<tr><td><span class="usr">${esc(c.usuario)}</span>${yo(c) ? ' <span class="tenue">(tú)</span>' : ''}</td>
        <td>${ROLES[c.rol] || esc(c.rol)}</td><td style="white-space:normal;max-width:220px">${esc(alcance(c))}</td><td class="tenue">${c.ultimo_acceso ? cuando(c.ultimo_acceso) : 'Nunca'}</td>
        <td class="acc">${yo(c) ? '' : `<button type="button" class="enlace" data-editar="${esc(c.usuario)}">Editar</button><button type="button" class="enlace peligro" data-borrar="${esc(c.usuario)}">${borrando === c.usuario ? '¿Seguro? Borrar' : 'Borrar'}</button>`}</td></tr>`).join('')}
      </tbody></table></div>
      <form class="separado"><h4>${editando ? `Editar la cuenta de ${esc(editando.usuario)}` : 'Nueva cuenta'}</h4>
        <div class="tres">
          <label class="campo">Usuario<input name="usuario" maxlength="40" autocomplete="off" autocapitalize="off" spellcheck="false" required ${editando ? `value="${esc(editando.usuario)}" readonly` : ''}></label>
          <label class="campo">Contraseña<input name="clave" type="password" autocomplete="new-password" placeholder="${editando ? 'Vacía para no cambiarla' : 'Mínimo 10 caracteres'}" ${editando ? '' : 'required'}></label>
          <label class="campo">Rol<select name="rol"><option value="lector" ${!editando || editando.rol === 'lector' ? 'selected' : ''}>Solo lectura</option><option value="admin" ${editando && editando.rol === 'admin' ? 'selected' : ''}>Administrador</option></select></label>
        </div>
        <div class="campo" style="margin-top:6px">Clientes que puede ver
          <div class="marcas-cli"><label><input type="radio" name="alcance" value="todos" ${!sel.length && !selG.length ? 'checked' : ''}> Todos</label><label><input type="radio" name="alcance" value="algunos" ${sel.length || selG.length ? 'checked' : ''}> Solo estos:</label></div>
          ${gruposTodos.length ? `<span class="ayuda-campo" style="margin-top:6px">Grupos: ve todas sus sedes, también las que agregues después.</span>
          <div class="marcas-cli">${gruposTodos.map(g => `<label class="grupo"><input type="checkbox" name="grp" value="${g.id}" ${selG.includes(g.id) ? 'checked' : ''}> ${esc(g.nombre)}</label>`).join('')}</div>
          <span class="ayuda-campo" style="margin-top:6px">Clientes sueltos:</span>` : ''}
          <div class="marcas-cli">${estado.clientes.map(c => `<label><input type="checkbox" name="cli" value="${c.id}" ${sel.includes(c.id) ? 'checked' : ''}> ${esc(c.nombre)}</label>`).join('')}</div>
        </div>
        ${msg ? (bien ? `<div class="msg bien" role="status" style="margin-top:12px">${esc(msg)}</div>` : `<div style="margin-top:12px">${gatoError(esc(msg))}</div>`) : ''}
        <div class="pie">${editando ? '<button class="btn" type="button" data-nuevo>Cancelar edición</button>' : ''}<button class="btn" type="button" data-cerrar>Cerrar</button><button class="btn prim" type="submit">${editando ? 'Guardar cambios' : 'Crear cuenta'}</button></div>
      </form>`, true);
    const f = dlg.querySelector('form');
    f.querySelectorAll('[name=cli], [name=grp]').forEach(x => x.onchange = () => { if (x.checked) f.alcance.value = 'algunos'; });
    dlg.querySelectorAll('[data-editar]').forEach(b => b.onclick = () => { editando = lista.find(c => c.usuario === b.dataset.editar); borrando = null; pintar(); });
    const nv = dlg.querySelector('[data-nuevo]'); if (nv) nv.onclick = () => { editando = null; pintar(); };
    dlg.querySelectorAll('[data-borrar]').forEach(b => b.onclick = async () => {
      const u = b.dataset.borrar;
      if (borrando !== u) { borrando = u; pintar(); return; }
      try { await enviar('/api/cuentas/' + encodeURIComponent(u), 'DELETE'); await recargar(); borrando = null; if (editando && editando.usuario === u) editando = null; pintar(`Cuenta de ${u} borrada.`, true); }
      catch (x) { if (!x.login) pintar(x.message); }
    });
    f.onsubmit = async ev => {
      ev.preventDefault();
      const algunos = f.alcance.value === 'algunos';
      const clientes = algunos ? [...f.querySelectorAll('[name=cli]:checked')].map(x => +x.value) : null;
      const grupos = algunos ? [...f.querySelectorAll('[name=grp]:checked')].map(x => +x.value) : null;
      if (algunos && !clientes.length && !grupos.length) { pintar('Marca al menos un grupo o un cliente, o elige “Todos”.'); return; }
      const d = { usuario: f.usuario.value.trim(), clave: f.clave.value, rol: f.rol.value, clientes: clientes && clientes.length ? clientes : null, grupos: grupos && grupos.length ? grupos : null, nueva: !editando };
      try {
        await enviar('/api/cuentas', 'POST', d); await recargar();
        const m = editando ? `Cuenta de ${d.usuario} actualizada.` : `Cuenta de ${d.usuario} creada.`;
        editando = null; borrando = null; pintar(m, true);
      } catch (x) { if (!x.login) pintar(x.message); }
    };
  };
  pintar();
}

/* ---------------- Notificaciones ---------------- */
async function notificaciones() {
  let n;
  try { n = await api('/api/notificaciones'); } catch (x) { if (!x.login) aviso(x.message, true); return; }
  const num = (name, v, min, max, etq) => `<input type="number" name="${name}" value="${v}" min="${min}" max="${max}" aria-label="${etq}">`;
  const marca = (name, v) => `<input type="checkbox" name="${name}" ${v ? 'checked' : ''}>`;
  const pc = n.porCliente || {};
  const dlg = libre(`<form novalidate>
    <h3>Notificaciones por Telegram</h3>
    <p>NodeCat te avisa en Telegram cuando algo va mal y también cuando se resuelve.</p>
    <label class="interruptor">${marca('activo', n.activo)}<span><b>Enviar avisos por Telegram</b><small>Puedes dejarlo configurado y desactivarlo cuando quieras.</small></span></label>
    <h4>1. Crea el bot</h4>
    <ol class="pasos"><li>En Telegram abre <b>@BotFather</b>, escribe <b>/newbot</b> y elige un nombre, por ejemplo “NodeCat Soporte”.</li>
      <li>Te dará un token. Cópialo y pégalo aquí.</li></ol>
    <label class="campo">Token del bot<input name="token" type="password" autocomplete="off" spellcheck="false" placeholder="${n.tokenGuardado ? 'Guardado, termina en …' + esc(n.tokenFin) + '. Déjalo vacío para conservarlo.' : '123456789:AAF…'}"></label>
    <h4>2. Elige dónde llegan los avisos</h4>
    <ol class="pasos"><li>Escribe cualquier mensaje a tu bot, o añádelo a un grupo de tu equipo y escribe algo allí.</li><li>Pulsa <b>Buscar chats</b> y elige el tuyo o el del grupo.</li></ol>
    <div class="en-linea">
      <label class="campo">Chats para todos los avisos<input name="chats" spellcheck="false" placeholder="Pulsa Buscar chats" value="${esc(arr(n.chats).join(', '))}"></label>
      <button class="btn" type="button" data-buscar>Buscar chats</button>
    </div>
    <div class="chats-hallados" id="hallados"></div>
    <details class="clave" ${Object.keys(pc).length ? 'open' : ''} style="margin-bottom:14px"><summary>Chats adicionales por cliente</summary>
      <p>Los avisos de un cliente llegan también a estos chats; por ejemplo, el grupo del técnico que lo atiende. Escribe el número de chat; usa Buscar chats para conocerlo.</p>
      ${estado.clientes.map(c => `<label class="campo" style="font-weight:400">${esc(c.nombre)}<input name="pc-${c.id}" spellcheck="false" value="${esc(arr(pc[c.id]).join(', '))}" placeholder="Ninguno"></label>`).join('') || '<p class="tenue">Todavía no hay clientes.</p>'}
    </details>
    <p><button class="btn" type="button" data-probar>Enviar mensaje de prueba</button></p>
    <h4 class="separado">3. Qué avisar</h4>
    <div class="reglas">
      <div class="regla"><label>${marca('caidas', n.caidas)} Un servidor deja de responder durante</label> ${num('caidaMin', n.caidaMin, 0, 120, 'Minutos sin responder')} min más, y cuando vuelve</div>
      <div class="regla"><label>${marca('cpu', n.cpu)} CPU por encima del</label> ${num('cpuUmbral', n.cpuUmbral, 50, 100, 'Umbral de CPU')} % durante ${num('cpuMin', n.cpuMin, 0, 240, 'Minutos de CPU alta')} min</div>
      <div class="regla"><label>${marca('ram', n.ram)} Memoria por encima del</label> ${num('ramUmbral', n.ramUmbral, 50, 100, 'Umbral de memoria')} % durante ${num('ramMin', n.ramMin, 0, 240, 'Minutos de memoria alta')} min</div>
      <div class="regla"><label>${marca('disco', n.disco)} Disco por encima del</label> ${num('discoUmbral', n.discoUmbral, 50, 100, 'Umbral de disco')} %</div>
      <div class="regla"><label>${marca('resumen', n.resumen)} Resumen diario por cliente a las</label> <input type="time" name="resumenHora" value="${esc(n.resumenHora)}" aria-label="Hora del resumen"><button class="btn" type="button" data-resumen>Enviar ahora</button></div>
      <div class="regla">Recordar los avisos que sigan sin resolverse
        <select class="selector" name="recordarHoras" style="height:32px">${[[0, 'No recordar'], [1, 'Cada hora'], [4, 'Cada 4 horas'], [12, 'Cada 12 horas'], [24, 'Cada día']].map(([v, t]) => `<option value="${v}" ${n.recordarHoras === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    </div>
    ${arr(n.activas).length ? `<h4 class="separado">Avisos activos ahora</h4><ul class="avisos-lista">${arr(n.activas).map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    ${arr(n.recientes).length ? `<h4 class="separado">Últimos avisos enviados</h4><ul class="avisos-lista">${arr(n.recientes).map(r => `<li><time>${cuando(r.hora)}</time><span class="${r.error ? 'mal' : ''}">${esc(r.texto.split('\n')[0])}${r.error ? ' (no se pudo enviar: ' + esc(r.error) + ')' : ''}</span></li>`).join('')}</ul>` : ''}
    <div class="msg error" role="alert" hidden style="margin-top:16px"></div>
    <div class="pie"><button class="btn" type="button" data-cerrar>Cancelar</button><button class="btn prim" type="submit">Guardar</button></div></form>`, true);
  const f = dlg.querySelector('form'), e = f.querySelector('.msg.error');
  const error = m => { gatoDice(e, m); if (m) e.scrollIntoView({ block: 'nearest' }); };
  f.querySelector('[data-buscar]').onclick = ev => ocupado(ev.currentTarget, 'Buscando…', async () => {
    error('');
    try {
      const r = await enviar('/api/notificaciones/chats', 'POST', { token: f.token.value });
      const h = $('#hallados'), l = arr(r.chats);
      h.innerHTML = l.length ? l.map(c => `<button type="button" data-chat="${esc(c.id)}">${esc(c.nombre || c.id)}<small>${esc(c.tipo)} · ${esc(c.id)}</small></button>`).join('')
        : `<span class="tenue">El bot ${esc(r.bot)} todavía no ha recibido mensajes. Escríbele algo en Telegram y vuelve a pulsar Buscar chats.</span>`;
      h.querySelectorAll('[data-chat]').forEach(b => b.onclick = () => {
        const actuales = f.chats.value.split(/[,\s;]+/).filter(Boolean);
        if (!actuales.includes(b.dataset.chat)) actuales.push(b.dataset.chat);
        f.chats.value = actuales.join(', ');
        b.disabled = true;
      });
    } catch (x) { if (!x.login) error(x.message); }
  });
  f.querySelector('[data-probar]').onclick = ev => ocupado(ev.currentTarget, 'Enviando…', async () => {
    error('');
    try { const r = await enviar('/api/notificaciones/probar', 'POST', { token: f.token.value, chats: f.chats.value }); aviso(`Mensaje de prueba enviado por ${r.bot}. Revisa Telegram.`); }
    catch (x) { if (!x.login) error(x.message); }
  });
  f.querySelector('[data-resumen]').onclick = ev => ocupado(ev.currentTarget, 'Enviando…', async () => {
    error('');
    try { await enviar('/api/notificaciones/resumen', 'POST'); aviso('Resumen enviado a Telegram.'); }
    catch (x) { if (!x.login) error(x.message); }
  });
  f.onsubmit = async ev => {
    ev.preventDefault();
    const d = { token: f.token.value, chats: f.chats.value, resumenHora: f.resumenHora.value, recordarHoras: +f.recordarHoras.value, porCliente: {} };
    for (const k of ['activo', 'caidas', 'cpu', 'ram', 'disco', 'resumen']) d[k] = f[k].checked;
    for (const k of ['caidaMin', 'cpuUmbral', 'cpuMin', 'ramUmbral', 'ramMin', 'discoUmbral']) d[k] = +f[k].value;
    for (const c of estado.clientes) { const x = f['pc-' + c.id]; if (x && x.value.trim()) d.porCliente[c.id] = x.value; }
    try { await enviar('/api/notificaciones', 'PUT', d); dlg.close(); aviso(d.activo ? 'Notificaciones guardadas y activadas.' : 'Notificaciones guardadas. Están desactivadas.'); }
    catch (x) { if (!x.login) error(x.message); }
  };
}

/* ---------------- Cabecera ---------------- */
$('#btnTema').addEventListener('click', () => {
  const oscuro = document.documentElement.dataset.tema ? document.documentElement.dataset.tema === 'oscuro' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.tema = oscuro ? 'claro' : 'oscuro';
  guardar('tema', document.documentElement.dataset.tema);
  if (rutaActual().vista === 'equipo') actualizar();
});

$('#accesoGato').innerHTML = gatoSVG('reparando', 'El gato de NodeCat reparando un servidor').replace('class="gato', 'class="acceso-gato gato');
$('#barraGato').innerHTML = gatoSVG('reparando');
$('#inicioCarga').innerHTML = `<div class="ic-caja"><div class="ic-pista">${gatoSVG('corriendo')}</div>
  <span class="marca">no<span class="l">d<span class="luz"></span></span>ecat</span><p class="ic-texto">Abriendo NodeCat…</p></div>`;
iniciar();
