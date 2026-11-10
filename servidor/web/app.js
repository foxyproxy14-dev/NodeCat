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
const horaCorta = t => new Date(t).toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit', hour12: true });   // ejes de los gráficos
const hora = t => new Date(t).toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
const nivel = v => v == null ? '' : v >= ALTO ? 'alerta' : v >= MEDIO ? 'aviso' : 'ok';
const ROLES = { admin: 'Administrador', lector: 'Solo lectura' };
const esAdmin = () => !!SESION && SESION.rol === 'admin';
const TIPOS_AGENTE = ['windows', 'linux', 'proxmox'];
const esServidor = e => TIPOS_AGENTE.includes(e.tipo);
const ESTADOS = { ok: 'En línea', sinMetricas: 'En línea, sin métricas', caido: 'Sin respuesta', pendiente: 'Esperando el primer informe', desinstalado: 'Agente desinstalado' };

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
  const hh = d.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
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
  if (!r.ok) throw Object.assign(new Error((d && d.error) || `NodeCat respondió con el error ${r.status}.`), { dosPasos: !!(d && d.dosPasos) });
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
    // Si la página de un router ya pidió el estado hace poco (lo hace cada 3 s), el sondeo general no lo repite
    sondeo = setInterval(() => { if (SESION && !document.hidden && Date.now() - ultimaCarga > 4000) cargar(); }, 5000);
    setInterval(reloj, 1000);
    // Al volver a la pestaña: datos al momento, sin esperar al siguiente sondeo
    document.addEventListener('visibilitychange', () => { if (!document.hidden && SESION && Date.now() - ultimaCarga > 2000) cargar(); });
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
  const cc = $('#campoCodigo');
  try {
    const info = await enviar('/api/login', 'POST', { usuario: f.usuario.value.trim(), clave: f.clave.value, codigo: cc.hidden ? undefined : f.codigo.value.trim() });
    f.clave.value = ''; f.codigo.value = ''; cc.hidden = true;
    mostrarInicio(`Hola, ${info.usuario}. Revisando a tus clientes…`);
    entrar(info);
  } catch (err) {
    // Verificación en dos pasos: la contraseña está bien, falta (o falló) el código
    if (err.dosPasos) { const primera = cc.hidden; cc.hidden = false; errorAcceso(primera ? '' : err.message); f.codigo.value = ''; f.codigo.focus(); if (primera) b.textContent = 'Entrar'; }
    else { errorAcceso(err.message); f.clave.value = ''; cc.hidden = true; f.codigo.value = ''; f.clave.focus(); }
  }
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
let ultimaCarga = 0;
// sinPintar: la página de un router se repinta ella misma justo después (así no se pinta dos veces cada 3 s)
async function cargar(forzar, sinPintar) {
  if (!SESION) return;
  ultimaCarga = Date.now();
  try {
    const e = await api('/api/estado');
    for (const c of e.clientes) c.equipos = arr(c.equipos).map(x => ({ ...x, clienteNombre: c.nombre, clienteId: c.id, sesiones: arr(x.sesiones), discos: arr(x.discos), historial: arr(x.historial) }));
    const nuevo = !estado || e.actualizado !== estado.actualizado;
    vigilarCambios(e);
    estado = e;
    $('#aviso').hidden = true;
    const v = `${e.actualizado}|${e.clientes.map(c => c.id + c.nombre + c.equipos.map(x => x.id + x.estado + x.ultimo + x.alias + x.sesiones.length).join()).join('|')}`;
    if (forzar || v !== version) {
      version = v;
      const r = rutaActual();
      if (sinPintar && r.vista === 'equipo' && equipo(r.id)) pintarNav(r); else render();
    }
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
  for (const c of e.clientes) for (const x of c.equipos) ahora.set(x.id, { estado: x.estado, wan: x.red && x.red.wan ? x.red.wan.activa : null, fw: x.red && x.red.actualizacion ? x.red.actualizacion.nueva : null, x, c });
  if (previos) {
    for (const [id, n] of ahora) {
      const p = previos.get(id), nom = n.x.alias || n.x.nombre, tipo = esServidor(n.x) ? 'El servidor' : n.x.tipo === 'fortigate' ? 'El FortiGate' : 'El router';
      if (!p) { avisoGato('reparando', esServidor(n.x) ? '¡Servidor nuevo!' : n.x.tipo === 'fortigate' ? '¡FortiGate nuevo!' : '¡Router nuevo!', `${nom} se unió a ${n.c.nombre}. Ya lo estoy vigilando.`, id); continue; }
      if (p.estado === 'pendiente' && (n.estado === 'ok' || n.estado === 'sinMetricas')) avisoGato('reparando', '¡Conectado!', `${nom} (${n.c.nombre}) ya está enviando datos.`, id);
      else if (p.estado !== 'caido' && n.estado === 'caido') avisoGato('avergonzado', `${nom} no responde`, `${tipo} de ${n.c.nombre} dejó de responder${n.x.errorConexion ? ': ' + n.x.errorConexion : '.'}`, id, true);
      else if (p.estado === 'caido' && n.estado !== 'caido') avisoGato('programando', `${nom} volvió`, `${tipo} de ${n.c.nombre} está otra vez en línea.`, id);
      if (p.wan === true && n.wan === false && n.estado !== 'caido') avisoGato('molesto', `Se cayó el WAN de ${nom}`, `La interfaz ${n.x.red.wan.interfaz} de ${n.c.nombre} está sin enlace.`, id, true);
      if (n.fw && p.fw !== n.fw) { const a = n.x.red.actualizacion; avisoGato('programando', `${a.producto} ${a.nueva} para ${nom}`, `Hay una versión nueva para ${nom} (${n.c.nombre}). Tiene ${a.actual}.`, id); }
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
  for (const w of e.red ? (e.red.wans && e.red.wans.length ? e.red.wans : e.red.wan ? [e.red.wan] : []) : []) if (!w.activa) l.push({ e, n: 'alerta', t: `${n}: WAN caído (${w.interfaz})` });
  if (e.cpu != null && e.cpu >= ALTO) l.push({ e, n: 'alerta', t: `${n}: CPU al ${e.cpu} %` });
  if (e.ramPct != null && e.ramPct >= ALTO) l.push({ e, n: 'alerta', t: `${n}: memoria al ${e.ramPct} %` });
  for (const d of e.discos) if (d.pct >= ALTO) l.push({ e, n: 'alerta', t: `${n}: disco ${d.unidad} al ${d.pct} %` });
  if (e.estado === 'sinMetricas') l.push({ e, n: 'aviso', t: `${n}: no se pueden leer CPU ni memoria` });
  if (e.estado === 'pendiente' && e.errorConexion) l.push({ e, n: 'aviso', t: `${n}: no se puede conectar` });
  if (e.errorSesiones) l.push({ e, n: 'aviso', t: `${n}: no se pueden leer las sesiones` });
  const fw = e.red && e.red.actualizacion;
  if (fw && fw.nueva) l.push({ e, n: 'info', t: `${n}: ${fw.producto} ${fw.nueva} disponible` });
  return l;
}
const ORDEN_N = { alerta: 0, aviso: 1, info: 2 };
const ordenProblemas = l => l.sort((a, b) => ORDEN_N[a.n] - ORDEN_N[b.n]);
// Las versiones nuevas son informativas: no ponen al equipo ni al cliente en amarillo
const reales = l => l.filter(x => x.n !== 'info');
const problemas = (lista = equipos()) => ordenProblemas(lista.flatMap(problemasDe));
const nivelDe = e => { const p = reales(problemasDe(e)); return p.some(x => x.n === 'alerta') ? (e.estado === 'caido' ? 'caido' : 'aviso') : p.length ? 'aviso' : e.estado === 'pendiente' ? 'pendiente' : 'ok'; };
const nivelCliente = c => { const p = reales(problemas(c.equipos)); return p.some(x => x.n === 'alerta') ? 'alerta' : p.length ? 'aviso' : 'ok'; };

function luz(latir) {
  const p = reales(problemas());
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
  const ahora = `<b class="hora-actual">${esc(hora(Date.now()))}</b>`;
  if (!estado.actualizado) { r.innerHTML = ahora + (estado.demo ? 'Modo demo' : 'Esperando informes'); return; }
  const s = Math.max(0, Math.round((Date.now() - estado.actualizado) / 1000));
  r.innerHTML = ahora + esc((estado.demo ? 'Demo. ' : '') + (s < 60 ? `Último informe hace ${s} s` : `Último informe a las ${hora(estado.actualizado)}`));
}

/* ======================================================================
   Navegación (por la dirección: #/, #/c/3, #/e/12, #/sesiones, #/historial)
   ====================================================================== */
function rutaActual() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'c' && b && h.split('/')[2] === 'sesiones') return { vista: 'sesiones', cli: Number(b), clave: 'sesiones-c' + b };
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
  if (r.vista === 'sesiones' && r.cli && !cliente(r.cli)) { ir('#/sesiones'); return; }
  const esRouter = r.vista === 'equipo' && ['mikrotik', 'fortigate'].includes(equipo(r.id).tipo);
  document.body.classList.toggle('consola', esRouter);
  pintarNav(r);
  if (montada !== r.clave) { montar(r); montada = r.clave; }
  actualizar(r);
}

// Cliente en el que uno está (en su página, en uno de sus equipos o en sus sesiones): "Sesiones" muestra solo las suyas
function clienteDeRuta(r) {
  if (r.vista === 'cliente') return r.id;
  if (r.vista === 'equipo') { const e = equipo(r.id); return e ? e.clienteId : null; }
  if (r.vista === 'sesiones' && r.cli) return r.cli;
  return null;
}
function pintarNav(r) {
  const cc = clienteDeRuta(r), c = cc ? cliente(cc) : null;
  const n = todasLasSesiones(c ? c.equipos : undefined).length;
  const activa = r.vista === 'cliente' || r.vista === 'equipo' ? 'resumen' : r.vista;
  $('#nav').innerHTML = [['resumen', '#/', 'Clientes'], ['sesiones', c ? `#/c/${c.id}/sesiones` : '#/sesiones', `Sesiones <span class="cuenta"${c ? ` title="Sesiones de ${esc(c.nombre)}"` : ''}>${n}</span>`], ['historial', '#/historial', 'Historial']].map(([id, h, t]) =>
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
      <div class="sedes-cli" id="sedesCli" role="group" aria-label="Filtrar por sede" hidden></div>
      <ul class="problemas" id="problemas"></ul>
      <div class="dos-col">
        <div>
          <div class="cab-seccion">
            <h2 id="tituloTablero">Servidores</h2>
            ${esAdmin() ? `<button class="btn prim" type="button" id="btnActAgentes" hidden></button><button class="btn" type="button" id="btnAgente" data-abre-menu aria-haspopup="menu">Descargar agente ▾</button><button class="btn" type="button" id="btnCompartir">Compartir</button><button class="btn" type="button" id="btnEditarCli">Editar cliente</button>` : ''}
          </div>
          <div id="tablero"></div>
          <div class="cab-seccion" style="margin-top:36px">
            <h2 id="tituloRed">Red</h2>
            ${esAdmin() ? '<button class="btn" type="button" id="btnRouter">Agregar MikroTik</button><button class="btn" type="button" id="btnForti">Agregar FortiGate</button>' : ''}
          </div>
          <div id="tableroRed"></div>
        </div>
        <aside><div class="cab-seccion"><h2>Últimos sucesos</h2></div><section class="hoja" id="sucesos">${gatoCargando('Cargando…', 'chica')}</section></aside>
      </div>`;
    if (esAdmin()) {
      $('#btnAgente').addEventListener('click', ev => menuAgentes(ev.currentTarget, c.id));
      $('#btnActAgentes').addEventListener('click', ev => actualizarAgentes(ev.currentTarget, `/api/clientes/${c.id}/actualizar-agentes`));
      $('#btnCompartir').addEventListener('click', () => compartirCliente(c.id));
      $('#btnEditarCli').addEventListener('click', () => editarCliente(c.id));
      $('#btnRouter').addEventListener('click', () => dialogoRouter(c.id));
      $('#btnForti').addEventListener('click', () => dialogoForti(c.id));
    }
    cargarSucesos();
  } else if (r.vista === 'sesiones') {
    const cs = r.cli ? cliente(r.cli) : null;
    v.innerHTML = `
      ${cs ? `<nav class="miga" aria-label="Ruta"><a href="#/">Clientes</a>${ICO.miga}<a href="#/c/${cs.id}">${esc(cs.nombre)}</a>${ICO.miga}<span>Sesiones</span></nav>` : ''}
      <section class="titular"><h1 id="tituloSes"></h1><p id="subSes"></p></section>
      <div class="cab-seccion">
        <h2>${cs ? `Sesiones de ${esc(cs.nombre)}` : 'Todas las sesiones'}</h2>
        <div class="segmentos" role="group" aria-label="Filtrar por estado">
          <button type="button" data-filtro="todas">Todas</button>
          <button type="button" data-filtro="activa">Activas</button>
          <button type="button" data-filtro="desconectada">Desconectadas</button>
        </div>
        ${cs ? '<a class="btn" href="#/sesiones">Ver las de todos los clientes</a>' : '<label><span class="sr">Cliente</span><select class="selector" id="sesCli"></select></label>'}
        <label class="buscar">${ICO.lupa}<span class="sr">Buscar persona, servidor o equipo</span><input type="search" id="buscarSes" placeholder="Buscar persona, servidor, equipo o programa" value="${esc(filtroSes)}"></label>
      </div>
      <section class="hoja desliza" id="tablaSes"></section>`;
    $('#buscarSes').addEventListener('input', e => { filtroSes = e.target.value; actualizar(r); });
    if ($('#sesCli')) $('#sesCli').addEventListener('change', e => { filtroSesCli = e.target.value; actualizar(r); });
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
  } else if (['mikrotik', 'fortigate'].includes(equipo(r.id).tipo)) {
    montarRouter(equipo(r.id), cliente(equipo(r.id).cliente));
  } else {
    const e = equipo(r.id), c = cliente(e.cliente);
    v.innerHTML = `
      <nav class="miga" aria-label="Ruta"><a href="#/">Clientes</a>${ICO.miga}<a href="#/c/${c.id}">${esc(c.nombre)}</a>${ICO.miga}<span>${esc(nombreEq(e))}</span></nav>
      <section class="srv-cab">
        <div><h1><span id="srvPunto"></span><span id="srvNombre"></span></h1><p id="srvMeta"></p></div>
        <div class="acciones">
          ${e.tipo === 'windows' ? `<a class="btn" href="/api/equipos/${e.id}/rdp" download="${esc(e.nombre)}.rdp">Conectar por Escritorio remoto</a>` : ''}
          ${esAdmin() ? '<button class="btn" type="button" id="btnEditarEq">Editar</button>' : ''}
        </div>
      </section>
      <div id="srvAvisos"></div>
      <dl class="ficha" id="ficha"></dl>
      <nav class="pestanas-hv" id="srvPestanas" aria-label="Secciones del hipervisor" hidden></nav>
      <div id="srvPve" hidden></div>
      <div id="srvGeneral">
      <div id="srvLosas"></div>
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
      <div id="srvVms"></div>
      <div class="cab-seccion"><h2 id="srvSesTitulo">Sesiones</h2>
        <label class="buscar">${ICO.lupa}<span class="sr">Buscar en las sesiones de este servidor</span><input type="search" id="buscarSesSrv" placeholder="Buscar persona, equipo o programa" value="${esc(filtroSesSrv)}"></label></div>
      <section class="hoja desliza" id="tablaSes"></section>
      </div>`;
    $('#buscarSesSrv').addEventListener('input', ev => { filtroSesSrv = ev.target.value; actualizar(r); });
    $('#rangos').addEventListener('click', ev => { const b = ev.target.closest('[data-rango]'); if (!b) return; rango = b.dataset.rango; guardar('rango', rango); actualizar(r); });
    const be = $('#btnEditarEq'); if (be) be.addEventListener('click', () => editarEquipo(e.id));
    enlazarTabla();
  }
}

function actualizar(r = rutaActual()) {
  if (!estado) return;
  if (r.vista === 'resumen') vistaResumen();
  else if (r.vista === 'cliente') vistaCliente(r.id);
  else if (r.vista === 'sesiones') vistaSesiones(r);
  else if (r.vista === 'historial') vistaHistorial();
  else if (equipo(r.id) && ['mikrotik', 'fortigate'].includes(equipo(r.id).tipo)) vistaRouter(r.id);
  else vistaEquipo(r.id);
}

/* ---------------- Resumen de clientes ---------------- */
let filtroCli = '', filtroSes = '', filtroSesCli = '', filtroEstado = 'todas', filtroSesSrv = '';
// Búsqueda en sesiones: persona, dominio, equipo de origen, servidor, cliente y programas que usa
const coincideSesion = (s, f) => [s.usuario, s.servidor, s.equipo, s.dominio, s.cliente, ...(s.top || []).map(t => t.nombre)].some(v => String(v || '').toLowerCase().includes(f));
let orden = { campo: 'usuario', asc: true };

function chipsProblemas(p, conCliente) {
  $('#problemas').innerHTML = p.slice(0, 12).map(x =>
    `<li><button type="button" data-eq="${x.e.id}"><span class="marcador ${x.n}" aria-hidden="true"></span><span class="sr">${x.n === 'alerta' ? 'Alerta:' : x.n === 'info' ? 'Información:' : 'Aviso:'}</span>${esc(x.t)}${conCliente ? ` <span class="tenue">${esc(x.e.clienteNombre)}</span>` : ''}</button></li>`).join('') +
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
  tt.innerHTML = `<h1>${titulo}</h1>` + (eq.length ? `<p><b>${enLinea} de ${eq.length}</b> equipos en línea en ${plural(cs.length, 'cliente', 'clientes')}: ${[[eq.filter(e => esServidor(e) && e.tipo !== 'proxmox').length, 'servidor', 'servidores'], [eq.filter(e => e.tipo === 'proxmox').length, 'Proxmox', 'Proxmox'], [eq.filter(e => e.tipo === 'mikrotik').length, 'MikroTik', 'MikroTik'], [eq.filter(e => e.tipo === 'fortigate').length, 'FortiGate', 'FortiGate']].filter(x => x[0]).map(x => plural(...x)).join(', ')}. <b>${plural(act, 'sesión activa', 'sesiones activas')}</b> de Escritorio remoto.</p>` : '');
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
  const nv = nivelCliente(c), p = reales(problemas(eq));
  const max = (l, f) => l.reduce((m, x) => { const v = f(x); return v != null && (!m || v > m.v) ? { v, x } : m; }, null);
  const cpu = max(vivos, e => e.cpu), ram = max(vivos, e => e.ramPct);
  const disco = max(vivos.flatMap(e => e.discos.map(d => ({ ...d, e }))), d => d.pct);
  const act = vivos.reduce((n, e) => n + e.sesiones.filter(s => s.estado === 'activa').length, 0);
  const nS = eq.filter(esServidor).length, nR = eq.length - nS;
  const sub = !eq.length ? 'Sin equipos todavía' : p.length ? p[0].t + (p.length > 1 ? ` y ${p.length - 1} más` : '') : c.notas ? c.notas.split('\n')[0] : [nS && plural(nS, 'servidor', 'servidores'), nR && plural(nR, 'equipo de red', 'equipos de red')].filter(Boolean).join(' y ');
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
const SUCESOS = { caida: ['caido', 'Dejó de responder'], vuelta: ['ok', 'Volvió a responder'], reinicio: ['sinMetricas', 'Se reinició'], nuevo: ['activa', 'Agente instalado'], 'wan-caida': ['caido', 'Se cayó el enlace WAN'], 'wan-vuelta': ['ok', 'Volvió el enlace WAN'], 'fg-alerta': ['aviso', 'Seguridad'] };
let sucesos = null, sucesosT = 0;
async function cargarSucesos() {
  try { sucesos = arr((await api('/api/eventos')).eventos); sucesosT = Date.now(); } catch (e) { if (e.login) return; sucesos = sucesos || []; }
  pintarSucesos();
}
function pintarSucesos() {
  const el = $('#sucesos'); if (!el || !sucesos) return;
  const r = rutaActual();
  const sd = r.vista === 'cliente' ? sedeFiltro.get(r.id) || '' : '';
  const enSede = s => { if (!sd) return true; const e = equipo(s.equipo_id); return !!e && (e.sede || SIN_SEDE) === sd; };
  const l = (r.vista === 'cliente' ? sucesos.filter(s => s.cliente_id === r.id && enSede(s)) : sucesos).slice(0, 10);
  el.innerHTML = l.length ? `<ul class="sucesos">${l.map(s => {
    const [clase, txt] = SUCESOS[s.tipo] || ['', s.tipo];
    const eq = equipo(s.equipo_id);
    return `<li><span class="punto ${clase}" aria-hidden="true"></span><span><button type="button" data-eq="${s.equipo_id}">${esc(eq ? nombreEq(eq) : s.equipo)}</button>: ${esc((s.tipo === 'vuelta' || s.tipo === 'fg-alerta') && s.detalle ? s.detalle.replace(/\.$/, '') : txt)}</span>
      <small>${cuando(s.t)}${r.vista === 'resumen' ? `, ${esc(s.cliente)}` : ''}</small></li>`;
  }).join('')}</ul>` : '<div class="vacio">Sin sucesos todavía.</div>';
}

/* ---------------- Cliente ---------------- */
// Sedes dentro de un cliente: etiqueta opcional de cada equipo. Sin sedes, la página se ve como siempre.
const sedeFiltro = new Map();   // cliente → sede elegida ('' = todas)
const SIN_SEDE = '\u0000';
const sedesDe = l => [...new Set(l.map(e => e.sede).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
function porSede(lista, fila, cab, cuenta, separar) {
  const sedes = sedesDe(lista);
  const cuerpo = l => separar ? separar(l, fila, !!sedes.length) : l.map(fila).join('');
  if (!sedes.length) return cuerpo(lista);
  const grupos = [...sedes, SIN_SEDE].map(sd => [sd, lista.filter(e => (e.sede || SIN_SEDE) === sd)]).filter(([, l]) => l.length);
  return grupos.map(([sd, l]) => `<div class="fila-grupo"><b>${sd === SIN_SEDE ? 'Sin sede' : esc(sd)}</b><span>${cuenta(l.length)}</span></div>${cuerpo(l)}`).join('');
}
// Hipervisores (Proxmox, Hyper-V) separados de los servidores y VM, igual que las sedes. Solo si hay de los dos.
const esHipervisor = e => e.tipo === 'proxmox' || !!e.hipervisor;
function porRol(l, fila, dentro) {
  const hv = l.filter(esHipervisor), resto = l.filter(e => !esHipervisor(e));
  if (!hv.length) return l.map(fila).join('');
  const cab = (t, n, tx) => `<div class="fila-grupo rol${dentro ? ' dentro' : ''}"><b>${t}</b><span>${tx(n)}</span></div>`;
  return cab('Hipervisores', hv.length, n => plural(n, 'hipervisor', 'hipervisores')) + hv.map(fila).join('')
    + (resto.length ? cab('Servidores y VM', resto.length, n => plural(n, 'servidor', 'servidores')) + resto.map(fila).join('') : '');
}
function vistaCliente(id) {
  const c = cliente(id), todosCli = c.equipos;
  const sedes = sedesDe(todosCli);
  let sel = sedeFiltro.get(id) || '';
  if (sel && sel !== SIN_SEDE && !sedes.includes(sel)) { sel = ''; sedeFiltro.delete(id); }
  const enSede = e => !sel || (e.sede || SIN_SEDE) === sel;
  const todos = todosCli.filter(enSede), eq = todos.filter(esServidor), routers = todos.filter(e => !esServidor(e)), p = problemas(todos);
  // Botones de sede (solo si el cliente tiene sedes)
  const bs = $('#sedesCli');
  if (sedes.length) {
    const hayGrave = l => problemas(l).some(x => x.n === 'alerta');
    const opciones = [['', 'Todas las sedes', todosCli], ...sedes.map(sd => [sd, sd, todosCli.filter(e => e.sede === sd)])];
    const sinSede = todosCli.filter(e => !e.sede); if (sinSede.length) opciones.push([SIN_SEDE, 'Sin sede', sinSede]);
    bs.innerHTML = opciones.map(([k, t, l]) => `<button type="button" class="chip-sede ${sel === k ? 'activa' : ''}" data-sede="${esc(k)}" aria-pressed="${sel === k}">${k ? `<span class="punto ${hayGrave(l) ? 'caido' : 'ok'}" aria-hidden="true"></span>` : ''}${esc(t)} <span class="n">${l.length}</span></button>`).join('');
    bs.hidden = false;
    bs.querySelectorAll('[data-sede]').forEach(b => b.onclick = () => { sedeFiltro.set(id, b.dataset.sede); vistaCliente(id); pintarSucesos(); });
  } else { bs.hidden = true; bs.innerHTML = ''; }
  $('#tituloRed').innerHTML = `Red <span>${routers.length}</span>`;
  $('#tableroRed').innerHTML = routers.length ? `<div class="tablero">
    <div class="tablero-cab rt" aria-hidden="true"><span>Equipo de red</span><span>CPU</span><span>Memoria</span><span>Internet ahora</span><span class="c-extra">Equipos con IP</span><span class="c-up">Encendido</span><span></span></div>
    ${porSede(routers, filaRouter, true, n => plural(n, 'equipo de red', 'equipos de red'))}</div>` : sel ? '<div class="vacio">Esta sede no tiene equipos de red.</div>' : gatoVacio('Sin equipos de red', esAdmin() ? 'Agrega sus MikroTik o FortiGate para ver el tráfico, los enlaces a Internet, la VPN y mucho más.' : 'Un administrador puede agregar sus MikroTik o FortiGate.');
  const vivos = todos.filter(e => e.estado === 'ok' || e.estado === 'sinMetricas').length;
  const ses = todasLasSesiones(eq), act = ses.filter(s => s.estado === 'activa').length, dsc = ses.filter(s => s.estado === 'desconectada').length;
  $('#cliTitulo').textContent = c.nombre;
  const graves = new Set(p.filter(x => x.n === 'alerta').map(x => x.e.id)).size;
  $('#cliSub').innerHTML = !todosCli.length ? 'Todavía no hay equipos. Descarga el agente de este cliente e instálalo en cada servidor, y agrega sus routers.' :
    `${graves ? `<b>${graves === 1 ? 'Un equipo necesita' : graves + ' equipos necesitan'} atención.</b> ` : ''}<b>${vivos} de ${todos.length}</b> equipos en línea${sedes.length && !sel ? ` en ${plural(sedes.length, 'sede', 'sedes')}` : sel ? ` en ${sel === SIN_SEDE ? 'los equipos sin sede' : esc(sel)}` : ''}, ${plural(act, 'sesión activa', 'sesiones activas')} y ${plural(dsc, 'desconectada', 'desconectadas')}.` +
    (c.notas ? `<br><span class="tenue">${esc(c.notas)}</span>` : '');
  chipsProblemas(p, false);
  $('#tituloTablero').innerHTML = `Servidores <span>${eq.length}</span>`;
  const ba = $('#btnActAgentes');
  if (ba) { const viejos = eq.filter(e => e.agenteNuevo && e.agenteNuevo.remota && !e.agenteNuevo.actualizando); ba.hidden = !viejos.length; if (viejos.length && !ba.disabled) ba.textContent = `Actualizar ${plural(viejos.length, 'agente', 'agentes')} a ${viejos[0].agenteNuevo.nueva}`; }
  const t = $('#tablero');
  if (!eq.length) {
    t.innerHTML = sel ? '<div class="vacio">Esta sede no tiene servidores.</div>' : gatoVacio('Sin servidores', esAdmin() ? 'Descarga el instalador, cópialo a cada servidor y ábrelo con doble clic. Aparecerán aquí solos.<br><br><button class="btn prim" type="button" id="btnAg2">Descargar el instalador</button>' : 'Un administrador tiene que instalar el agente en sus servidores.');
    const b = $('#btnAg2'); if (b) { b.dataset.abreMenu = ''; b.onclick = ev => menuAgentes(ev.currentTarget, c.id); }
    if (Date.now() - sucesosT > 30000) cargarSucesos(); else pintarSucesos();
    return;
  }
  const lista = [...eq].sort((a, b) => ({ caido: 0, aviso: 1, pendiente: 2, ok: 3 })[nivelDe(a)] - ({ caido: 0, aviso: 1, pendiente: 2, ok: 3 })[nivelDe(b)] || a.nombre.localeCompare(b.nombre));
  t.innerHTML = `<div class="tablero">
    <div class="tablero-cab" aria-hidden="true"><span>Servidor</span><span>CPU, última hora</span><span>Memoria</span><span>Disco más lleno</span><span>Sesiones</span><span class="c-up">Encendido</span><span></span></div>
    ${porSede(lista, filaEquipo, false, n => plural(n, 'servidor', 'servidores'), porRol)}</div>`;
  if (Date.now() - sucesosT > 30000) cargarSucesos(); else pintarSucesos();
}

/** Campo "Sede" con las sedes que ya tiene el cliente. */
function campoSede(clienteId, actual) {
  const c = cliente(clienteId), l = c ? sedesDe(c.equipos) : [];
  return `<label class="campo">Sede <span class="ayuda-campo">Opcional. Para separar los equipos de un mismo cliente por sede; escribe una nueva o elige una.</span>
    <input name="sede" maxlength="60" list="listaSedes" value="${esc(actual || '')}" placeholder="${l.length ? esc(l[0]) : 'Sede principal'}" autocomplete="off"><datalist id="listaSedes">${l.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>`;
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
// Pide al panel que actualice el agente de Windows (de un equipo o de todo un cliente)
async function actualizarAgentes(boton, url) {
  await ocupado(boton, 'Pidiendo…', async () => {
    try {
      const r = await enviar(url, 'POST', {});
      aviso(r.pedidos ? `${plural(r.pedidos, 'agente se actualizará', 'agentes se actualizarán')} a la ${r.version} en su próximo informe (menos de un minuto).${r.manuales ? ` ${plural(r.manuales, 'tiene', 'tienen')} una versión anterior a la 1.6.0: hay que reinstalarlos una vez con el comando de PowerShell.` : ''}`
        : r.manuales ? 'Esos agentes son anteriores a la 1.6.0 y no saben actualizarse desde aquí: reinstálalos una vez con el comando de PowerShell.' : 'No hay agentes que actualizar.', !r.pedidos);
      await cargar(true);
    } catch (x) { if (!x.login) aviso(x.message, true); }
  });
}
function filaEquipo(s) {
  const act = s.sesiones.filter(x => x.estado === 'activa').length, dsc = s.sesiones.filter(x => x.estado === 'desconectada').length;
  const dm = s.discos.reduce((m, d) => !m || d.pct > m.pct ? d : m, null);
  const sinDatos = s.estado === 'caido' || s.estado === 'pendiente' || s.estado === 'desinstalado';
  let sub = s.alias ? `${s.nombre}, ${s.so || ''}`.replace(/, $/, '') : (s.so || ESTADOS[s.estado]);
  // Hipervisor: primero lo importante (las VM), después el sistema
  if (s.vms && s.vms.length) sub = `${s.vms.filter(v => v.estado === 'running').length} de ${plural(s.vms.length, s.tipo === 'proxmox' ? 'VM/LXC' : 'VM', s.tipo === 'proxmox' ? 'VM/LXC' : 'VM')} encendidas${s.so ? ', ' + s.so : ''}`;
  if (s.estado === 'caido') sub = `Sin respuesta desde ${cuando(s.ultimo)}`;
  if (s.estado === 'pendiente') sub = ESTADOS.pendiente;
  if (s.estado === 'desinstalado') sub = 'Agente desinstalado. Quítalo de la lista o vuelve a instalarlo.';
  if (s.estado === 'sinMetricas') sub = 'En línea, sin datos de CPU ni memoria';
  const vacio = '<span></span>';
  return `<button type="button" class="fila ${esc(s.estado)}" data-eq="${s.id}" aria-label="${esc(nombreEq(s))}, ${esc(ESTADOS[s.estado])}. Abrir">
    <span class="f-nombre"${s.ipsLocales && s.ipsLocales.length ? ` title="IP local: ${esc(s.ipsLocales.join(', '))}"` : ''}>${insigniaSO(s)}<span><strong>${esc(nombreEq(s))}${s.agenteNuevo ? `<span class="fw-chip" title="Agente ${esc(s.version)}; hay ${esc(s.agenteNuevo.nueva)}">⬆ agente</span>` : ''}${esHipervisor(s) ? `<span class="etq-hv">${s.tipo === 'proxmox' ? 'Proxmox' : esc(s.hipervisor === 'hyperv' || /hyper/i.test(s.hipervisor || '') ? 'Hyper-V' : (s.hipervisor || 'Hipervisor'))}</span>` : ''}</strong><small>${esc(sub)}</small></span></span>
    ${sinDatos || s.cpu == null ? `<span class="f-cpu" data-etq="CPU"><span class="valor vacio-valor">—</span></span>` :
      `<span class="f-cpu" data-etq="CPU"><span class="valor">${s.cpu}<i>%</i></span>${chispa(s.historial, 'cpu', s.cpu)}</span>`}
    ${sinDatos ? vacio + vacio : medidor(s.ramPct, s.ramTotal ? `${nf.format(s.ramUsada)} de ${nf.format(s.ramTotal)} GB` : '', 'Memoria') +
      medidor(dm ? dm.pct : null, dm ? `${dm.unidad} con ${nf.format(dm.libre)} GB libres` : '', 'Disco más lleno')}
    ${sinDatos ? vacio : `<span class="f-ses" data-etq="Sesiones"><span class="valor">${act}</span><small>${act === 1 ? 'activa' : 'activas'}${dsc ? `, ${dsc} desc.` : ''}</small></span>`}
    <span class="f-up">${sinDatos ? '' : esc(duracion(s.arranque))}</span>
    ${ICO.flecha}</button>`;
}

/* ---------------- Sesiones ---------------- */
function vistaSesiones(r = rutaActual()) {
  document.querySelectorAll('[data-filtro]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filtro === filtroEstado)));
  const sel = $('#sesCli'), lista = estado.clientes.map(c => `${c.id}:${c.nombre}`).join('|');
  if (sel && sel.dataset.lista !== lista) {
    sel.innerHTML = '<option value="">Todos los clientes</option>' + estado.clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    sel.dataset.lista = lista;
  }
  if (filtroSesCli && !cliente(filtroSesCli)) filtroSesCli = '';
  if (sel) sel.value = filtroSesCli;
  const cliSel = r.cli ? String(r.cli) : filtroSesCli;
  const base = cliSel ? cliente(cliSel).equipos : equipos();
  const todas = todasLasSesiones(base.filter(e => e.estado !== 'caido'));
  const act = todas.filter(s => s.estado === 'activa').length, dsc = todas.filter(s => s.estado === 'desconectada').length;
  const personas = new Set(todas.map(s => s.usuario.toLowerCase())).size;
  $('#tituloSes').textContent = todas.length ? `${plural(personas, 'persona conectada', 'personas conectadas')}.` : 'Nadie conectado ahora.';
  $('#subSes').innerHTML = todas.length ? `<b>${plural(act, 'sesión activa', 'sesiones activas')}</b> y ${plural(dsc, 'desconectada', 'desconectadas')} en ${plural(new Set(todas.map(s => s.equipoId)).size, 'servidor', 'servidores')}${cliSel ? '' : ` de ${plural(new Set(todas.map(s => s.cliente)).size, 'cliente', 'clientes')}`}.` : 'Cuando alguien entre por Escritorio remoto aparecerá aquí.';
  const f = filtroSes.trim().toLowerCase();
  const l = todas.filter(s => (filtroEstado === 'todas' || s.estado === filtroEstado) &&
    (!f || coincideSesion(s, f)));
  tabla(cliSel ? l.map(x => ({ ...x, cliente: '' })) : l, true, todas.length ? '<strong>Ninguna sesión coincide</strong>Cambia la búsqueda o el filtro.' : gatoSVG('programando') + '<strong>No hay sesiones</strong>Ahora mismo nadie está conectado.');
}

function tabla(lista, conServidor, vacio) {
  const val = (s, c) => ['inicio', 'inactivo', 'id', 'cpu', 'ram'].includes(c) ? (s[c] == null ? -1 : s[c]) : String(s[c] == null ? '' : s[c]).toLowerCase();
  // CPU y memoria por sesión: solo si algún agente lo informa (Windows 1.5 o más nuevo)
  const conUso = lista.some(s => s.ram != null);
  const mb = b => b >= 1073741824 ? `${nf.format(Math.round(b / 1073741824 * 10) / 10)} GB` : `${nf.format(Math.round(b / 1048576))} MB`;
  const usoCpu = s => s.cpu == null ? (s.ram != null ? '<span class="tenue" title="Se calcula a partir del segundo informe">…</span>' : '<span class="tenue">—</span>') : `<span class="ses-uso"><b class="${s.cpu >= 50 ? 'alto' : ''}">${nf.format(s.cpu)} %</b><span class="ses-barra"><i style="width:${Math.min(100, s.cpu)}%"></i></span></span>`;
  const usoRam = s => s.ram == null ? '<span class="tenue">—</span>' : `<span class="ses-uso"><b>${mb(s.ram)}</b>${s.procesos ? `<small>${s.procesos} procesos</small>` : ''}</span>`;
  const usoTop = s => s.top && s.top.length ? `<span class="ses-top">${s.top.map(t => `<span title="${esc(t.nombre)}: ${t.cpu != null ? nf.format(t.cpu) + ' % de CPU, ' : ''}${mb(t.ram)}${t.cantidad > 1 ? `, ${t.cantidad} procesos` : ''}">${esc(t.nombre)}${t.cantidad > 1 ? `<small>×${t.cantidad}</small>` : ''}</span>`).join('')}</span>` : '<span class="tenue">—</span>';
  const filas = [...lista].sort((a, b) => { const va = val(a, orden.campo), vb = val(b, orden.campo); return (va < vb ? -1 : va > vb ? 1 : 0) * (orden.asc ? 1 : -1); });
  const t = $('#tablaSes');
  if (!filas.length) { t.innerHTML = `<div class="vacio gato-vacio">${vacio}</div>`; return; }
  const col = (c, txt) => `<th aria-sort="${orden.campo === c ? (orden.asc ? 'ascending' : 'descending') : 'none'}"><button type="button" data-orden="${c}">${txt}${orden.campo === c ? `<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="${orden.asc ? 'M5 2 9 8H1z' : 'M5 8 9 2H1z'}" fill="currentColor"/></svg>` : ''}</button></th>`;
  t.innerHTML = `<table class="${conUso ? 'con-uso' : ''}"><thead><tr>
    ${col('usuario', 'Persona')}${conServidor ? col('servidor', 'Servidor') : ''}${col('estado', 'Estado')}${conUso ? col('cpu', 'CPU') + col('ram', 'Memoria') + '<th>Lo que más usa</th>' : ''}${col('equipo', 'Conectada desde')}${col('inactivo', 'Inactiva')}${col('inicio', 'Entró')}${col('id', 'ID')}
    </tr></thead><tbody>
    ${filas.map(s => `<tr>
        <td><span class="usr">${esc(s.usuario)}</span>${s.dominio ? `<span class="dom">${esc(s.dominio)}</span>` : ''}</td>
        ${conServidor ? `<td><span class="ses-srv"><button type="button" class="enlace" data-eq="${s.equipoId}">${esc(s.servidor)}</button>${s.cliente ? `<small>${esc(s.cliente)}</small>` : ''}</span></td>` : ''}
        <td><span class="estado-ses"><span class="punto ${esc(s.estado)}" aria-hidden="true"></span>${esc(s.estadoTexto || s.estado)}</span></td>
        ${conUso ? `<td>${usoCpu(s)}</td><td>${usoRam(s)}</td><td>${usoTop(s)}</td>` : ''}
        <td>${s.equipo ? esc(s.equipo) : '<span class="tenue">—</span>'}</td>
        <td>${inactivo(s.inactivo, s.estado)}</td>
        <td>${cuando(s.inicio)}</td>
        <td class="tenue">${esc(s.id)}</td>
      </tr>`).join('')}</tbody></table>`;
}
function enlazarTabla() {
  $('#tablaSes').addEventListener('click', e => {
    const o = e.target.closest('[data-orden]');
    // Como en el Administrador de tareas: CPU, memoria e inactividad ordenan primero de mayor a menor
    if (o) { const c = o.dataset.orden; orden = { campo: c, asc: orden.campo === c ? !orden.asc : !['cpu', 'ram', 'inactivo'].includes(c) }; actualizar(); }
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
  $('#srvPunto').innerHTML = insigniaSO(s).replace('so-insignia', 'so-insignia grande');
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
    ['Último informe', s.ultimo ? cuando(s.ultimo) : '—'], ['Agente', s.version ? 'versión ' + esc(s.version) + (s.agenteNuevo ? (s.agenteNuevo.actualizando ? ` <span class="fw-chip">actualizando a ${esc(s.agenteNuevo.nueva)}…</span>`
      : s.agenteNuevo.remota ? (esAdmin() ? ` <button type="button" class="btn chico" data-act-agente="${s.id}">Actualizar a ${esc(s.agenteNuevo.nueva)}</button>` : ` <span class="fw-chip">hay ${esc(s.agenteNuevo.nueva)}</span>`)
      : ` <span class="fw-chip" title="Las versiones anteriores a la 1.6.0 no saben actualizarse desde el panel: reinstálalo una vez con el comando de PowerShell.">hay ${esc(s.agenteNuevo.nueva)}: reinstálalo una vez</span>`) : '') : '—'],
    s.ipsLocales && s.ipsLocales.length ? ['IP local', s.ipsLocales.map(esc).join(', ')] : null,
    ['Conecta desde', s.ip ? esc(s.ip) : '—'],
    (() => { const l = equipos().filter(x => x.sonda === s.id); return l.length ? ['Hace de sonda para', l.map(x => `<a href="#/e/${x.id}">${esc(x.alias || x.nombre)}</a>`).join(', ')] : null; })()
  ].filter(Boolean).map(([k, v]) => `<div><dt><span>${k}</span></dt><dd style="margin:0">${v}</dd></div>`).join('');

  const bact = document.querySelector('[data-act-agente]'); if (bact) bact.onclick = () => actualizarAgentes(bact, `/api/equipos/${bact.dataset.actAgente}/actualizar-agente`);
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

  // Hipervisor: resumen al estilo de ProxMenux, máquinas virtuales, contenedores y red (Proxmox, Hyper-V, Linux)
  $('#srvLosas').innerHTML = losasHost(s, vivo);
  const conPestanas = s.tipo === 'proxmox' || !!s.hipervisor;
  $('#srvVms').innerHTML = (conPestanas ? '' : tablaVms(s, vivo)) + panelRed(s, vivo);
  pestanasHv(s, vivo, conPestanas);
  const ses = vivo ? s.sesiones : [];
  const act = ses.filter(x => x.estado === 'activa').length, dsc = ses.filter(x => x.estado === 'desconectada').length;
  $('#srvSesTitulo').innerHTML = `${s.tipo === 'windows' ? 'Sesiones' : 'Sesiones SSH y de consola'} <span>${plural(act, 'activa', 'activas')}, ${plural(dsc, 'desconectada', 'desconectadas')}</span>`;
  const fq = filtroSesSrv.trim().toLowerCase();
  const visibles = fq ? ses.filter(x => coincideSesion(x, fq)) : ses;
  tabla(visibles.map(x => ({ ...x, servidor: nombreEq(s), equipoId: s.id })), false,
    fq && ses.length ? `<strong>Nadie coincide con “${esc(filtroSesSrv.trim())}”</strong>Busca por persona, dominio, equipo desde el que se conecta o programa.` : !vivo ? '<strong>Sin datos</strong>El servidor no responde.' : `<strong>Nadie conectado a este servidor</strong>${s.tipo === 'windows' ? 'Las sesiones de Escritorio remoto aparecerán aquí.' : 'Las sesiones SSH y de consola aparecerán aquí.'}`);
}

function anillo(pct) {
  const r = 26, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct || 0));
  return `<svg class="anillo n-${nivel(pct)}" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="${r}" class="pista"/><circle cx="32" cy="32" r="${r}" class="valor" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/><text x="32" y="37" text-anchor="middle">${pct == null ? '—' : Math.round(pct) + '%'}</text></svg>`;
}
const linea = (t, v, pct) => `<div class="hv-linea"><span>${t}</span><b>${v}</b>${pct != null ? `<span class="carril mini n-${nivel(pct)}"><span style="width:${Math.min(100, Math.max(0, pct))}%"></span></span>` : ''}</div>`;
function losasHost(s, vivo) {
  const hv = s.tipo === 'proxmox' || (s.vms && s.vms.length);
  if (!vivo || (s.tipo === 'windows' && !hv)) return '';
  const vms = s.vms || [], on = vms.filter(v => v.estado === 'running');
  const nVm = vms.filter(v => v.tipo !== 'lxc').length, nLxc = vms.filter(v => v.tipo === 'lxc').length;
  const temp = s.temperatura;
  const tNivel = temp == null ? '' : temp >= 85 ? 'alerta' : temp >= 70 ? 'aviso' : 'ok';
  const losas = [
    `<section class="hv-losa"><h3>Uso de CPU</h3><div class="hv-cuerpo">${anillo(s.cpu)}<div class="hv-lineas">
      ${s.cpuUsuario != null ? linea('Usuario', `${nf.format(s.cpuUsuario)} %`, s.cpuUsuario) : ''}${s.cpuSistema != null ? linea('Sistema', `${nf.format(s.cpuSistema)} %`, s.cpuSistema) : ''}
      ${s.nucleos ? linea('Núcleos', s.nucleos) : ''}${s.carga != null ? linea('Carga promedio', nf.format(s.carga)) : ''}</div></div></section>`,
    `<section class="hv-losa"><h3>Memoria</h3><div class="hv-cuerpo">${anillo(s.ramPct)}<div class="hv-lineas">
      ${s.ramUsada != null ? linea('Usada', `${nf.format(s.ramUsada)} GB`, s.ramPct) : ''}${s.ramCache != null ? linea('En caché', `${nf.format(s.ramCache)} GB`) : ''}
      ${s.ramTotal != null ? linea('Total', `${nf.format(s.ramTotal)} GB`) : ''}</div></div></section>`
  ];
  if (hv) losas.push(`<section class="hv-losa"><h3>${s.tipo === 'proxmox' ? 'VM y LXC activos' : 'VM activas'}</h3>
    <div class="hv-grande">${on.length}<i>/ ${vms.length}</i></div>
    <div class="hv-chips">${nVm ? `<span class="chip-hv vm">${plural(nVm, 'VM', 'VM')}</span>` : ''}${nLxc ? `<span class="chip-hv lxc">${nLxc} LXC</span>` : ''}<span class="chip-hv ${on.length === vms.length ? 'ok' : 'aviso'}">${plural(on.length, 'en ejecución', 'en ejecución')}</span></div></section>`);
  losas.push(`<section class="hv-losa"><h3>Temperatura</h3>${temp == null ? '<div class="hv-grande tenue">—</div><p class="tenue" style="margin:6px 0 0;font-size:13px">El equipo no informa la temperatura.</p>'
    : `<div class="hv-grande">${temp}<i>°C</i></div><span class="chip-hv ${tNivel}">${tNivel === 'alerta' ? 'Muy alta' : tNivel === 'aviso' ? 'Alta' : 'Normal'}</span>`}</section>`);
  return `<div class="hv-losas">${losas.join('')}</div>`;
}
function panelRed(s, vivo) {
  const l = (s.interfaces || []).filter(i => i.activa !== false);
  if (!vivo || !l.length) return '';
  return `<div class="cab-seccion"><h2>Red <span>${plural(l.length, 'interfaz', 'interfaces')}</span></h2></div>
    <section class="hoja" style="margin-bottom:36px"><ul class="hv-red">${l.map(i => `<li><b>${esc(i.nombre)}</b><span class="b">↓ ${bpsTxt(i.rx)}</span><span class="s">↑ ${bpsTxt(i.tx)}</span></li>`).join('')}</ul></section>`;
}
const bpsTxt = v => { if (v == null) return '—'; for (const [n, d] of [['Gb/s', 1e9], ['Mb/s', 1e6], ['kb/s', 1e3]]) if (v >= d) return `${nf.format(Math.round(v / d * 10) / 10)} ${n}`; return `${Math.round(v)} b/s`; };

/* ---------------- Proxmox y Hyper-V: secciones al estilo de ProxMenux (solo lectura) ---------------- */
const pestanaHv = new Map(), pveCache = new Map();
function pestanasHv(s, vivo, activo) {
  const nav = $('#srvPestanas'), cont = $('#srvPve'), gen = $('#srvGeneral');
  if (!activo) { nav.hidden = true; cont.hidden = true; gen.hidden = false; return; }
  const pve = s.tipo === 'proxmox';
  const lista = pve ? [['general', 'General'], ['apps', 'Apps'], ['vms', 'VM y LXC'], ['red', 'Red'], ['almacen', 'Almacenamiento'], ['copias', 'Backups'], ['nodo', 'Nodo']] : [['general', 'General'], ['vms', 'Máquinas virtuales'], ['red', 'Red']];
  let p = pestanaHv.get(s.id) || 'general'; if (!lista.some(([k]) => k === p)) p = 'general';
  nav.innerHTML = lista.map(([k, t]) => `<button type="button" data-pest="${k}" aria-pressed="${p === k}" class="${p === k ? 'activa' : ''}">${t}</button>`).join('');
  nav.hidden = false;
  nav.querySelectorAll('[data-pest]').forEach(b => b.onclick = () => { pestanaHv.set(s.id, b.dataset.pest); vistaEquipo(s.id); });
  gen.hidden = p !== 'general'; cont.hidden = p === 'general';
  if (p === 'general') return;
  // Los detalles de Proxmox se piden aparte (pueden ser grandes) y se refrescan cada 30 s
  let d = pveCache.get(s.id);
  if ((pve || p === 'red') && (!d || Date.now() - d.t > 30000) && !(d && d.pidiendo)) {
    pveCache.set(s.id, { ...(d || {}), pidiendo: true });
    api(`/api/equipos/${s.id}/proxmox`).then(r => { pveCache.set(s.id, { t: Date.now(), datos: r }); if (rutaActual().vista === 'equipo' && rutaActual().id === s.id) vistaEquipo(s.id); })
      .catch(() => pveCache.set(s.id, { t: Date.now(), datos: {} }));
  }
  const datos = (pveCache.get(s.id) || {}).datos;
  const html = p === 'vms' ? seccionVms(s, vivo, datos)
    : !datos ? gatoCargando(pve ? 'Preguntándole a Proxmox…' : 'Leyendo la red…')
    : p === 'apps' ? seccionApps(s, datos) : p === 'red' ? seccionRed(s, datos) : p === 'almacen' ? seccionAlmacen(s, datos) : p === 'copias' ? seccionCopias(s, datos) : seccionNodo(s, datos);
  if (cont.dataset.v !== html) {
    // Se conserva lo escrito en los buscadores y el filtro de categoría al repintar
    const q = cont.querySelector('input[type=search]'), qv = q ? q.value : '', qid = q && q.id, foco = document.activeElement === q;
    const cat = cont.querySelector('#catApp'), cv = cat ? cat.value : '';
    cont.innerHTML = html; cont.dataset.v = html;
    const q2 = qid && cont.querySelector('#' + qid); if (q2) { q2.value = qv; if (foco) q2.focus(); }
    const c2 = cont.querySelector('#catApp'); if (c2) { c2.value = cv; c2.onchange = filtrarApps; }
    if (cont.querySelector('#buscarApp')) { cont.querySelector('#buscarApp').oninput = filtrarApps; filtrarApps(); }
    alPintarPve(cont, s, p, datos || {});
  }
}
const pendiente = (x, que) => x == null ? gatoCargando(`Leyendo ${que}…`) : x.error ? `<div class="msg atencion">No se pudo leer ${que}: ${esc(x.error)}</div>` : null;

function filtrarApps() {
  const q = ($('#buscarApp') || {}).value || '', c = ($('#catApp') || {}).value || '';
  document.querySelectorAll('.app-tarjeta').forEach(t => { t.hidden = !(t.dataset.buscar.includes(q.trim().toLowerCase()) && (!c || t.dataset.cat === c)); });
}

function seccionCopias(s, d) {
  const c = d.copias; const p = pendiente(c, 'las copias de seguridad'); if (p) return p;
  const nombres = new Map((s.vms || []).map(v => [String(v.id), v.nombre]));
  const porVm = new Map(); for (const a of c.archivos || []) if (!porVm.has(a.vmid)) porVm.set(a.vmid, { ultima: a, n: 0, total: 0 });
  for (const a of c.archivos || []) { const x = porVm.get(a.vmid); x.n++; x.total += a.tamano || 0; }
  const sinCopia = (s.vms || []).filter(v => !porVm.has(String(v.id)));
  const viejo = t => Date.now() - t > 7 * 864e5;
  const tareasMal = (c.tareas || []).filter(t => t.estado && t.estado !== 'OK' && t.estado !== 'en curso');
  return `<div class="hv-losas">
      <section class="hv-losa"><h3>Copias guardadas</h3><div class="hv-grande">${(c.archivos || []).length}</div><span class="chip-hv">${gbs((c.archivos || []).reduce((n, a) => n + (a.tamano || 0), 0))} en ${plural((c.almacenes || []).length, 'almacén', 'almacenes')}</span></section>
      <section class="hv-losa"><h3>VM y LXC sin copia</h3><div class="hv-grande">${sinCopia.length}</div>${sinCopia.length ? `<span class="chip-hv aviso">${esc(sinCopia.slice(0, 4).map(v => v.nombre).join(', '))}${sinCopia.length > 4 ? '…' : ''}</span>` : '<span class="chip-hv ok">Todas tienen copia</span>'}</section>
      <section class="hv-losa"><h3>Últimas tareas</h3><div class="hv-grande">${(c.tareas || []).length - tareasMal.length}<i>/ ${(c.tareas || []).length} bien</i></div>${tareasMal.length ? `<span class="chip-hv alerta">${plural(tareasMal.length, 'con error', 'con error')}</span>` : '<span class="chip-hv ok">Sin errores</span>'}</section>
    </div>
    <div class="cab-seccion"><h2>Última copia de cada VM y LXC</h2></div>
    <section class="hoja desliza" style="margin-bottom:32px"><table class="tabla vms"><thead><tr><th>VM / LXC</th><th>Última copia</th><th>Tamaño</th><th>Almacén</th><th>Copias</th></tr></thead><tbody>
      ${[...(s.vms || [])].sort((a, b) => Number(a.id) - Number(b.id)).map(v => { const x = porVm.get(String(v.id)); return `<tr><td><b>${esc(v.id)}</b> ${esc(v.nombre)}</td>
        <td>${x ? `<span class="punto ${viejo(x.ultima.fecha) ? 'aviso' : 'ok'}"></span>${cuando(x.ultima.fecha)}${viejo(x.ultima.fecha) ? ' <span class="tenue">(más de 7 días)</span>' : ''}` : '<span class="punto caido"></span>Nunca'}</td>
        <td class="num">${x ? gbs(x.ultima.tamano) : '—'}</td><td>${x ? esc(x.ultima.almacen) : '—'}</td><td class="num">${x ? `${x.n} <span class="tenue">(${gbs(x.total)})</span>` : '0'}</td></tr>`; }).join('')}
    </tbody></table></section>
    <div class="cab-seccion"><h2>Trabajos programados <span>${(c.trabajos || []).length}</span></h2></div>
    ${(c.trabajos || []).length ? `<section class="hoja desliza" style="margin-bottom:32px"><table class="tabla vms"><thead><tr><th>Horario</th><th>Qué copia</th><th>Almacén</th><th>Modo</th><th>Próxima</th><th>Estado</th></tr></thead><tbody>
      ${c.trabajos.map(j => `<tr class="${j.activo ? '' : 'apagada'}"><td><b>${esc(j.horario || '—')}</b>${j.comentario ? `<br><small class="tenue">${esc(j.comentario)}</small>` : ''}</td><td>${esc(j.que || '—')}</td><td>${esc(j.almacen || '—')}</td><td>${esc(j.modo || '—')}</td><td>${j.proxima ? cuando(j.proxima) : '—'}</td><td>${j.activo ? 'Activo' : 'Desactivado'}</td></tr>`).join('')}
    </tbody></table></section>` : '<div class="vacio" style="margin-bottom:32px">No hay trabajos de copia programados.</div>'}
    <div class="cab-seccion"><h2>Últimas tareas de copia</h2></div>
    ${(c.tareas || []).length ? `<section class="hoja desliza"><table class="tabla vms"><thead><tr><th>Inicio</th><th>VM / LXC</th><th>Duración</th><th>Resultado</th></tr></thead><tbody>
      ${c.tareas.map(t => `<tr><td>${cuando(t.inicio)}</td><td>${t.vmid ? `<b>${esc(t.vmid)}</b> ${esc(nombres.get(t.vmid) || '')}` : 'Varias'}</td><td>${t.fin ? durTxt(t.fin - t.inicio) : '—'}</td>
        <td>${t.estado === 'OK' ? '<span class="punto ok"></span>Correcta' : t.estado === 'en curso' ? '<span class="punto aviso"></span>En curso' : `<span class="punto caido"></span>${esc(t.estado)}`}</td></tr>`).join('')}
    </tbody></table></section>` : '<div class="vacio">Sin tareas de copia recientes.</div>'}`;
}

function seccionNodo(s, d) {
  const n = d.nodo; const p = pendiente(n, 'el nodo'); if (p) return p;
  const fila = (k, v) => v == null || v === '' ? '' : `<div><dt><span>${k}</span></dt><dd style="margin:0">${v}</dd></div>`;
  return `<dl class="ficha">${[
      fila('Procesador', esc(n.cpuModelo)), fila('Sockets e hilos', n.hilos ? `${n.sockets || 1} socket${(n.sockets || 1) > 1 ? 's' : ''}, ${n.hilos} hilos` : null),
      fila('Proxmox VE', esc(n.pve)), fila('Kernel', esc(n.kernel)),
      fila('Carga promedio', n.carga && n.carga.length ? n.carga.map(x => nf.format(x)).join(' / ') + ' <span class="tenue">(1, 5 y 15 min)</span>' : null),
      fila('Swap', n.swapTotal ? `${gbs(n.swapUsado)} de ${gbs(n.swapTotal)}` : 'Sin swap'), fila('Memoria compartida (KSM)', n.ksm ? gbs(n.ksm) : null),
      fila('Arranque', n.arranque ? esc(n.arranque.toUpperCase()) : null),
      fila('Actualizaciones', n.actualizaciones == null ? null : n.actualizaciones ? `<span class="punto aviso"></span>${plural(n.actualizaciones, 'paquete pendiente', 'paquetes pendientes')}` : '<span class="punto ok"></span>Al día'),
      fila('Clúster', n.cluster ? `${esc(n.cluster.nombre)}, ${n.cluster.quorum ? '<span class="punto ok"></span>con quórum' : '<span class="punto caido"></span>sin quórum'}` : 'Nodo independiente')
    ].join('')}</dl>
    ${n.cluster && n.cluster.nodos.length ? `<div class="cab-seccion"><h2>Nodos del clúster <span>${n.cluster.nodos.filter(x => x.online).length} de ${n.cluster.nodos.length} en línea</span></h2></div>
      <div class="hv-chips" style="margin-bottom:28px">${n.cluster.nodos.map(x => `<span class="chip-hv ${x.online ? 'ok' : 'alerta'}">${esc(x.nombre)}</span>`).join('')}</div>` : ''}
    ${panelRed(s, s.estado === 'ok' || s.estado === 'sinMetricas')}`;
}

const ESTADO_VM = { running: ['ok', 'Encendida'], stopped: ['caido', 'Apagada'], paused: ['aviso', 'En pausa'], suspended: ['aviso', 'Suspendida'], saved: ['aviso', 'Guardada'], starting: ['aviso', 'Arrancando'], stopping: ['aviso', 'Apagándose'] };
const gbs = b => b == null ? '—' : b >= 1024 ** 4 ? `${nf.format(Math.round(b / 1024 ** 4 * 10) / 10)} TB` : b >= 1024 ** 3 ? `${nf.format(Math.round(b / 1024 ** 3 * 10) / 10)} GB` : `${Math.round(b / 1024 ** 2)} MB`;
function tablaVms(s, vivo, datos) {
  const ips = new Map(((datos && Array.isArray(datos.apps)) ? datos.apps : []).map(a => [String(a.id), a]));
  const vms = (s.vms || []).slice().sort((a, b) => (a.estado === 'running' ? 0 : 1) - (b.estado === 'running' ? 0 : 1) || String(a.nombre).localeCompare(String(b.nombre), 'es', { numeric: true }));
  if (!vms.length && !s.errorVms) return '';
  const on = vms.filter(v => v.estado === 'running').length;
  const titulo = s.hipervisor === 'hyperv' ? 'Máquinas virtuales de Hyper-V' : 'Máquinas virtuales y contenedores';
  const filas = vms.map(v => {
    const [k, t] = ESTADO_VM[v.estado] || ['', v.estado || '—'];
    const enc = v.estado === 'running';
    const ram = v.ramMax ? Math.round((v.ram || 0) / v.ramMax * 100) : null;
    const dsk = v.discoMax ? Math.round((v.disco || 0) / v.discoMax * 100) : null;
    const ap = ips.get(String(v.id));
    return `<tr class="${enc ? '' : 'apagada'}"><td><span class="punto ${k}" aria-hidden="true"></span><b>${esc(v.nombre)}</b>${v.id && s.tipo === 'proxmox' ? ` <span class="tenue">${esc(v.id)}</span>` : ''}${ap && ap.ips && ap.ips.length ? `<br><small class="tenue">${esc(ap.ips.join(', '))}</small>` : ''}</td>
      <td>${v.tipo === 'lxc' ? 'Contenedor LXC' : v.tipo === 'qemu' ? 'VM' : 'VM'}</td><td>${esc(t)}</td>
      <td class="num">${enc && v.cpu != null ? `${nf.format(Math.round(v.cpu))} %` : '—'}${v.cpus ? ` <span class="tenue">de ${v.cpus} ${v.cpus === 1 ? 'núcleo' : 'núcleos'}</span>` : ''}</td>
      <td class="num">${enc && v.ram != null ? `${gbs(v.ram)}${v.ramMax ? ` <span class="tenue">de ${gbs(v.ramMax)}</span>` : ''}` : v.ramMax ? `<span class="tenue">${gbs(v.ramMax)}</span>` : '—'}${ram != null && enc ? `<span class="carril mini n-${nivel(ram)}"><span style="width:${Math.min(100, ram)}%"></span></span>` : ''}</td>
      <td class="num">${v.discoMax ? `${v.disco ? gbs(v.disco) + ' <span class="tenue">de ' : '<span class="tenue">'}${gbs(v.discoMax)}</span>` : '—'}${dsk != null && v.disco ? `<span class="carril mini n-${nivel(dsk)}"><span style="width:${Math.min(100, dsk)}%"></span></span>` : ''}</td>
      <td>${enc && v.uptime ? esc(durTxt(v.uptime * 1000)) : '—'}</td></tr>`;
  }).join('');
  return `<div class="cab-seccion"><h2>${titulo} <span>${on} de ${vms.length} encendidas</span></h2></div>
    ${s.errorVms ? `<div class="msg atencion"><b>No se pudo leer la lista de máquinas virtuales.</b> ${esc(s.errorVms)}</div>` : ''}
    ${vms.length ? `<section class="hoja desliza" style="margin-bottom:36px"><table class="tabla vms"><thead><tr><th>Nombre</th><th>Tipo</th><th>Estado</th><th>CPU</th><th>Memoria</th><th>Disco</th><th>Encendida</th></tr></thead><tbody>${filas}</tbody></table></section>` : ''}`;
}

function grafico(el, historial, clave, nombre, span) {
  const pts = historial.filter(h => h[clave] != null);
  const largo = span > 36 * 3600e3;
  const etq = t => largo ? new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' }) : horaCorta(t);
  const etqLarga = t => largo ? new Date(t).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }) : hora(t);
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
  menu.innerHTML = (cab || '') + items.map((it, i) => it.sep ? '<hr>' : `<button type="button" role="menuitem" data-i="${i}" class="${it.peligro ? 'peligro' : ''}${it.d ? ' con-desc' : ''}">${it.d ? `<span><b>${esc(it.t)}</b><small>${esc(it.d)}</small></span>` : esc(it.t)}</button>`).join('');
  menu.hidden = false;
  const r = boton.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  menu.style.top = (r.bottom + h + 8 > innerHeight ? r.top - h - 6 : r.bottom + 6) + 'px';
  const p = menu.querySelector('button'); if (p) p.focus();
  menu.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; cerrarMenu(); items[+b.dataset.i].fn(); };
}
function cerrarMenu() { $('#menu').hidden = true; }
document.addEventListener('click', e => { if (!e.target.closest('#menu, #btnCuenta, [data-abre-menu]')) cerrarMenu(); });
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
// Desde la página de un cliente: solo el agente de ESE cliente (Windows, Hyper-V, Linux o Proxmox)
function menuAgentes(boton, id) {
  if (!$('#menu').hidden) { cerrarMenu(); return; }
  menuEn(boton, [
    { t: 'Windows', d: 'Servidores y PC con Windows (.exe)', fn: () => agregarServidores(id, 'windows') },
    { t: 'Hyper-V', d: 'El agente de Windows, con sus máquinas virtuales', fn: () => agregarServidores(id, 'hyperv') },
    { t: 'Linux', d: 'Debian, Ubuntu, Rocky… con un comando', fn: () => agregarServidores(id, 'linux') },
    { t: 'Proxmox VE', d: 'El host, con sus VM, LXC, apps y backups', fn: () => agregarServidores(id, 'proxmox') }
  ]);
}
async function agregarServidores(id, tipo = 'windows') {
  let datos;
  try { datos = await api('/api/clientes'); } catch (x) { if (!x.login) aviso(x.message, true); return; }
  const c = datos.clientes.find(x => x.id === id); if (!c) return;
  const t = encodeURIComponent(CSRF);
  const comando = `curl -fsSL ${datos.url}/instalar/${c.clave}.sh | bash`;
  const comandoPs = `irm ${datos.url}/instalar/${c.clave}.ps1 | iex`;
  const TIT = { windows: 'Windows', hyperv: 'Hyper-V', linux: 'Linux', proxmox: 'Proxmox VE' };
  const dlg = libre('<div></div>');
  const pintar = () => {
    const win = tipo === 'windows' || tipo === 'hyperv';
    dlg.querySelector('.dlg').innerHTML = `<div><h3>Agregar a ${esc(c.nombre)}</h3>
      <div class="pestanas-hv" role="group" aria-label="Sistema" style="margin-bottom:18px">${Object.entries(TIT).map(([k, v]) => `<button type="button" data-t="${k}" class="${tipo === k ? 'activa' : ''}" aria-pressed="${tipo === k}">${v}</button>`).join('')}</div>
      ${win ? `<p>${tipo === 'hyperv' ? 'En Hyper-V se usa el mismo agente de Windows: lo instalas en el host y él detecta el rol solo. Verás el host y sus <b>máquinas virtuales</b> (encendidas o apagadas, CPU, memoria, disco y tiempo encendidas).' : `El instalador ya va configurado para <b>${esc(c.nombre)}</b> y envía los datos a <b>${esc(datos.url)}</b>${/^https:/.test(datos.url) ? ' por HTTPS' : ''}: no hace falta VPN ni abrir puertos.`}</p>
        <h4 class="sub-titulo">Con PowerShell <span class="chip-hv ok">recomendado</span></h4>
        <ol class="pasos"><li>En el ${tipo === 'hyperv' ? 'host de Hyper-V' : 'servidor'}, abre <b>PowerShell como administrador</b> (clic derecho en Inicio, <b>Terminal (Administrador)</b>).</li>
          <li>Pega este comando. Verás cada paso, la barra de descarga y la instalación del servicio:</li></ol>
        <div class="en-linea" style="margin:0 0 8px"><input class="codigo" id="cmdLinux" readonly value="${esc(comandoPs)}" style="flex:1"><button class="btn prim" type="button" data-copiar>Copiar</button></div>
        <p class="tenue" style="margin-top:0">No pasa por el navegador, así que no salen los avisos de “archivo sospechoso”. Si lo abres sin permisos, el script pide ser administrador y sigue solo en otra ventana.</p>
        <h4 class="sub-titulo">O con el instalador .exe</h4>
        <p style="margin-top:0">Cópialo al ${tipo === 'hyperv' ? 'host' : 'servidor'} y ábrelo con doble clic. Chrome y Windows pueden avisar de que es poco común porque no está firmado: en Chrome, <b>Descargar archivo sospechoso</b>; en Windows, <b>Más información</b> y <b>Ejecutar de todas formas</b>.</p>
        <p><a class="btn" href="/api/clientes/${c.id}/instalador?t=${t}">Descargar instalador de ${esc(c.nombre)}</a></p>
        <p class="tenue">¿Muchos servidores por GPO o script? <a href="/api/clientes/${c.id}/agente?t=${t}">Paquete .zip de ${esc(c.nombre)}</a> (instalación silenciosa: <code>instalar /silencioso</code>). Para quitarlo: Panel de control, Programas, <b>NodeCat Agente</b>.</p>`
      : `<p>${tipo === 'proxmox' ? 'Instálalo en el <b>host de Proxmox</b> (no en las VM ni en los LXC). Verás el nodo y todo lo que tiene: <b>VM y contenedores, apps con su dirección, almacenamiento, discos, backups y actualizaciones</b>. Solo lectura: usa la API local de Proxmox, sin tokens.' : 'Funciona en Debian, Ubuntu, Rocky, AlmaLinux y otras distribuciones con systemd. Verás CPU, memoria, discos, red, temperatura y las sesiones SSH.'}</p>
        <ol class="pasos"><li>Entra por SSH ${tipo === 'proxmox' ? 'al host de Proxmox (o abre su consola Shell en la web)' : 'al servidor'} como root.</li>
          <li>Pega este comando:</li></ol>
        <div class="en-linea" style="margin:0 0 12px"><input class="codigo" id="cmdLinux" readonly value="${esc(comando)}" style="flex:1"><button class="btn prim" type="button" data-copiar>Copiar</button></div>
        <p class="tenue">Si no entras como root, usa <code>| sudo bash</code> al final. Necesita Python 3 (Proxmox ya lo trae) y salida a Internet hacia NodeCat. Para quitarlo: <code>sudo nodecat-agente desinstalar</code>.</p>`}
      <details class="clave"><summary>Clave del agente</summary>
        <p>Va incluida en el instalador y en el comando. Si generas una nueva, los agentes ya instalados de ${esc(c.nombre)} dejarán de enviar datos hasta que los reinstales.</p>
        <code class="codigo" data-clave-txt>${esc(c.clave)}</code>
        <button class="btn" type="button" data-nueva-clave>Generar una clave nueva</button>
      </details>
      <div class="msg error" role="alert" hidden></div>
      <div class="pie"><button class="btn" type="button" data-cerrar>Cerrar</button></div></div>`;
    dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
    dlg.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tipo = b.dataset.t; pintar(); });
    const bc = dlg.querySelector('[data-copiar]');
    if (bc) bc.onclick = async () => { const i = dlg.querySelector('#cmdLinux'); i.select(); try { await navigator.clipboard.writeText(i.value); } catch { document.execCommand('copy'); } aviso('Comando copiado.'); };
    const bn = dlg.querySelector('[data-nueva-clave]');
    let seguro = false;
    bn.onclick = async () => {
      if (!seguro) { seguro = true; bn.className = 'btn peligro'; bn.textContent = '¿Seguro? Generar una clave nueva'; return; }
      try {
        await enviar(`/api/clientes/${c.id}/clave`, 'POST');
        const d = await api('/api/clientes'); const n = d.clientes.find(x => x.id === id); if (n) c.clave = n.clave;
        pintar(); aviso('Clave nueva generada. Descarga el instalador o copia el comando otra vez.');
      } catch (x) { if (!x.login) gatoDice(dlg.querySelector('.msg'), x.message); }
    };
  };
  pintar();
}

// Enlace de solo lectura para el cliente: ve el estado de sus equipos sin cuenta y sin poder tocar nada
async function compartirCliente(id) {
  const c = cliente(id); if (!c) return;
  const grupo = c.grupo_id ? (arr(estado.grupos).find(g => g.id === c.grupo_id) || {}).nombre : null;
  let enlaces = [], nuevo = null, anulando = null;
  const cargarL = async () => { enlaces = arr((await api(`/api/clientes/${id}/enlaces`)).enlaces); };
  try { await cargarL(); } catch (x) { if (!x.login) aviso(x.message, true); return; }
  const dlg = libre('<div></div>', true);
  const pintar = () => {
    dlg.querySelector('.dlg').innerHTML = `<div><h3>Compartir ${esc(c.nombre)}</h3>
      <p>Crea un enlace para que el cliente vea el estado de sus equipos sin cuenta. Es <b>solo lectura</b>: no puede cambiar nada ni entrar a los servidores, routers o FortiGate.</p>
      <p class="tenue">Ve si cada equipo está en línea, CPU, memoria, disco, tráfico de Internet, latencia, disponibilidad y caídas. <b>No</b> ve sesiones ni usuarios, direcciones IP, configuración, DHCP, VPN, firewall ni registros.</p>
      ${nuevo ? `<div class="msg bien" style="display:block"><b>Enlace creado.</b> Cópialo ahora: por seguridad no se vuelve a mostrar.
        <div class="en-linea" style="margin-top:10px"><input class="codigo" id="urlNueva" readonly value="${esc(nuevo)}" style="flex:1"><button class="btn prim" type="button" data-copiar>Copiar</button></div></div>` : ''}
      <div class="en-linea" style="align-items:end;margin:14px 0 6px">
        <label class="campo" style="flex:1">Para quién <span class="ayuda-campo">opcional, para reconocerlo</span><input name="nota" maxlength="80" placeholder="Gerencia de ${esc(c.nombre)}"></label>
        <label class="campo">Dura<select class="selector" name="dias">${[[7, '7 días'], [30, '30 días'], [90, '90 días'], [1, '1 día'], [0, 'Sin vencimiento']].map(([v, t]) => `<option value="${v}" ${v === 30 ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>
      ${grupo ? `<label class="interruptor" style="margin-bottom:12px"><input type="checkbox" name="grupo"><span><b>Incluir todas las sedes de ${esc(grupo)}</b><small>Verá juntas todas las sedes del grupo, también las que agregues después.</small></span></label>` : ''}
      <p><button class="btn prim" type="button" data-crear>Crear enlace</button></p>
      ${enlaces.length ? `<h4 class="separado">Enlaces de ${esc(c.nombre)}</h4><ul class="avisos-lista enlaces">${enlaces.map(e => `<li><span><b>${esc(e.nota || 'Sin nombre')}</b>${e.grupo ? ` <span class="tenue">(todo ${esc(grupo || 'el grupo')})</span>` : ''}
          <small>${e.vencido ? '<span class="mal">Vencido</span>' : e.vence ? `Vence ${cuando(e.vence)}` : 'Sin vencimiento'}, ${e.vistas ? `abierto ${plural(e.vistas, 'vez', 'veces')}, la última ${cuando(e.visto)}` : 'todavía no se abrió'}. Creado por ${esc(e.creador)} ${cuando(e.creado)}</small></span>
          <button class="btn ${anulando === e.id ? 'peligro' : ''}" type="button" data-anular="${esc(e.id)}">${anulando === e.id ? '¿Seguro? Deja de funcionar' : 'Anular'}</button></li>`).join('')}</ul>` : ''}
      <div class="msg error" role="alert" hidden></div>
      <div class="pie"><button class="btn" type="button" data-cerrar>Cerrar</button></div></div>`;
    const m = dlg.querySelector('.msg.error');
    dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
    const bc = dlg.querySelector('[data-copiar]');
    if (bc) bc.onclick = async () => { const i = dlg.querySelector('#urlNueva'); i.select(); try { await navigator.clipboard.writeText(i.value); } catch { document.execCommand('copy'); } aviso('Enlace copiado.'); };
    dlg.querySelector('[data-crear]').onclick = ev => ocupado(ev.currentTarget, 'Creando…', async () => {
      try {
        const g = dlg.querySelector('[name=grupo]');
        const r = await enviar(`/api/clientes/${id}/enlaces`, 'POST', { nota: dlg.querySelector('[name=nota]').value, dias: +dlg.querySelector('[name=dias]').value, grupo: !!(g && g.checked) });
        nuevo = `${location.origin}/v/${r.token}`; anulando = null; await cargarL(); pintar();
      } catch (x) { if (!x.login) gatoDice(m, x.message); }
    });
    dlg.querySelectorAll('[data-anular]').forEach(b => b.onclick = async () => {
      if (anulando !== b.dataset.anular) { anulando = b.dataset.anular; pintar(); return; }
      try { await enviar(`/api/clientes/${id}/enlaces/${b.dataset.anular}`, 'DELETE'); anulando = null; nuevo = null; await cargarL(); pintar(); aviso('Enlace anulado. Ya no funciona.'); }
      catch (x) { if (!x.login) gatoDice(m, x.message); }
    });
  };
  pintar();
}

// Todos los enlaces de solo lectura, de todos los clientes, para revisarlos y anularlos
async function enlacesCompartidos() {
  let l = [], anulando = null, filtro = 'activos';
  const cargarL = async () => { l = arr((await api('/api/enlaces')).enlaces); };
  try { await cargarL(); } catch (x) { if (!x.login) aviso(x.message, true); return; }
  const dlg = libre('<div></div>', true);
  const pintar = () => {
    const vencidos = l.filter(e => e.vencido).length;
    const ver = l.filter(e => filtro === 'todos' || (filtro === 'vencidos' ? e.vencido : !e.vencido));
    const porCli = new Map(); for (const e of ver) { if (!porCli.has(e.clienteNombre)) porCli.set(e.clienteNombre, []); porCli.get(e.clienteNombre).push(e); }
    dlg.querySelector('.dlg').innerHTML = `<div><h3>Enlaces compartidos</h3>
      <p>Enlaces de solo lectura que diste a tus clientes. Si anulas uno, deja de funcionar al instante. Para crear uno nuevo, entra al cliente y pulsa <b>Compartir</b>.</p>
      <div class="en-linea" style="align-items:center;margin-bottom:12px">
        <div class="filtro-enlaces" role="group" aria-label="Filtrar enlaces">${[['activos', `Activos (${l.length - vencidos})`], ['vencidos', `Vencidos (${vencidos})`], ['todos', `Todos (${l.length})`]].map(([k, t]) => `<button type="button" class="btn ${filtro === k ? 'prim' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
        ${vencidos ? '<button class="btn" type="button" data-limpiar style="margin-left:auto">Borrar los vencidos</button>' : ''}
      </div>
      ${ver.length ? [...porCli].map(([cn, es]) => `<h4 class="separado">${esc(cn)}</h4><ul class="avisos-lista enlaces">${es.map(e => `<li><span><b>${esc(e.nota || 'Sin nombre')}</b>${e.grupo ? ' <span class="tenue">(todo su grupo)</span>' : ''}
          <small>${e.vencido ? '<span class="mal">Vencido</span>' : e.vence ? `Vence ${cuando(e.vence)}` : 'Sin vencimiento'}, ${e.vistas ? `abierto ${plural(e.vistas, 'vez', 'veces')}, la última ${cuando(e.visto)}` : 'todavía no se abrió'}. Creado por ${esc(e.creador)} ${cuando(e.creado)}</small></span>
          <button class="btn ${anulando === e.id ? 'peligro' : ''}" type="button" data-anular="${esc(e.id)}" data-cli="${e.cliente}">${anulando === e.id ? '¿Seguro? Deja de funcionar' : e.vencido ? 'Borrar' : 'Anular'}</button></li>`).join('')}</ul>`).join('')
        : `<div class="vacio">${l.length ? 'No hay enlaces en esta lista.' : 'Todavía no has compartido ningún enlace.'}</div>`}
      <div class="msg error" role="alert" hidden></div>
      <div class="pie"><button class="btn" type="button" data-cerrar>Cerrar</button></div></div>`;
    const m = dlg.querySelector('.msg.error');
    dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
    dlg.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filtro = b.dataset.f; anulando = null; pintar(); });
    const bl = dlg.querySelector('[data-limpiar]');
    if (bl) bl.onclick = ev => ocupado(ev.currentTarget, 'Borrando…', async () => {
      try { const r = await enviar('/api/enlaces/vencidos', 'POST'); await cargarL(); pintar(); aviso(`${plural(r.borrados, 'enlace vencido borrado', 'enlaces vencidos borrados')}.`); }
      catch (x) { if (!x.login) gatoDice(m, x.message); }
    });
    dlg.querySelectorAll('[data-anular]').forEach(b => b.onclick = async () => {
      if (anulando !== b.dataset.anular) { anulando = b.dataset.anular; pintar(); return; }
      try { await enviar(`/api/clientes/${b.dataset.cli}/enlaces/${b.dataset.anular}`, 'DELETE'); anulando = null; await cargarL(); pintar(); aviso('Enlace anulado. Ya no funciona.'); }
      catch (x) { if (!x.login) gatoDice(m, x.message); }
    });
  };
  pintar();
}

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
          <a class="btn prim" href="/api/clientes/${c.id}/instalador?t=${encodeURIComponent(CSRF)}">Descargar instalador</a>
          <button class="btn" type="button" data-ver="${c.id}" aria-expanded="${abierto === c.id}">${abierto === c.id ? 'Ocultar' : 'Más'}</button>
        </span>
        ${abierto === c.id ? `<div class="detalle">
          <ol class="pasos"><li>Descarga el instalador de <b>${esc(c.nombre)}</b>. Es un solo .exe y ya va configurado para enviar a <b>${esc(datos.url)}</b>.</li>
            <li>Cópialo a cada servidor del cliente y ábrelo con doble clic. Si Windows avisa de que es una aplicación desconocida, pulsa <b>Más información</b> y <b>Ejecutar de todas formas</b>.</li>
            <li>En unos segundos el servidor aparecerá dentro de ${esc(c.nombre)}. Para quitarlo: Panel de control, Programas, <b>NodeCat Agente</b>.</li></ol>
          <p class="tenue" style="margin:0 0 12px">¿Muchos servidores por GPO o script? <a href="/api/clientes/${c.id}/agente?t=${encodeURIComponent(CSRF)}">Paquete .zip</a> (instalación silenciosa: <code>instalar /silencioso</code>).</p>
          <details class="clave"><summary>Clave del agente</summary>
            <p>Va incluida en el instalador. Si generas una nueva, los agentes ya instalados de este cliente dejarán de enviar datos hasta que los reinstales con el instalador nuevo.</p>
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
    dlg.querySelectorAll('[data-quitar2]').forEach(b => b.onclick = async () => {
      const u = b.dataset.quitar2;
      if (borrando !== '2:' + u) { borrando = '2:' + u; pintar(); return; }
      try { await enviar('/api/cuentas/' + encodeURIComponent(u) + '/dos-pasos', 'DELETE'); await recargar(); borrando = null; pintar(`Verificación en dos pasos quitada a ${u}. Podrá entrar solo con su contraseña y volver a activarla.`, true); }
      catch (x) { if (!x.login) pintar(x.message); }
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
    ${campoSede(s.cliente, s.sede)}
    <label class="campo">Cliente<select name="cliente">${estado.clientes.map(c => `<option value="${c.id}" ${c.id === s.cliente ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>
      <span class="ayuda-campo">Si lo cambias de cliente, su agente se pasa solo al cliente nuevo en su próximo informe (agente 1.3 o superior). Los agentes más antiguos hay que reinstalarlos con el instalador del cliente nuevo.</span></label>
    <div class="msg error" role="alert" hidden></div>
    <div class="pie"><button class="btn" type="button" data-quitar style="margin-right:auto">Quitar de NodeCat</button><button class="btn" type="button" data-cerrar>Cancelar</button><button class="btn prim" type="submit">Guardar</button></div></form>`);
  const f = dlg.querySelector('form'), e = f.querySelector('.msg');
  f.onsubmit = async ev => {
    ev.preventDefault();
    try { await enviar(`/api/equipos/${id}`, 'PUT', { alias: f.alias.value, cliente: +f.cliente.value, sede: f.sede.value }); dlg.close(); aviso('Cambios guardados.'); montada = null; await cargar(true); }
    catch (x) { if (!x.login) gatoDice(e, x.message) }
  };
  const bq = f.querySelector('[data-quitar]');
  bq.onclick = async () => {
    if (!confirmar) { confirmar = true; bq.className = 'btn peligro'; bq.textContent = s.estado === 'desinstalado' ? '¿Seguro? Se borra su historial' : '¿Seguro? Se borra su historial y el agente se desinstala en el servidor'; return; }
    try { await enviar(`/api/equipos/${id}`, 'DELETE'); dlg.close(); aviso(s.estado === 'desinstalado' ? `${s.nombre} quitado.` : `${s.nombre} quitado. Su agente se desinstalará solo en el servidor en unos segundos y no volverá a aparecer.`); location.hash = '#/c/' + s.cliente; await cargar(true); }
    catch (x) { if (!x.login) gatoDice(e, x.message) }
  };
}

/* ---------------- Mi cuenta ---------------- */
$('#btnCuenta').addEventListener('click', e => {
  if (!SESION) return;
  if (!$('#menu').hidden) { cerrarMenu(); return; }
  const it = [{ t: 'Cambiar mi contraseña', fn: cambiarClave }, { t: 'Verificación en dos pasos', fn: dosPasos }];
  if (esAdmin()) it.push({ t: 'Clientes y agentes', fn: () => { if (location.hash && location.hash !== '#/') location.hash = '#/'; gestionClientes(); } }, { t: 'Cuentas de acceso', fn: cuentas }, { t: 'Enlaces compartidos', fn: enlacesCompartidos }, { t: 'Logos de los sistemas', fn: logosSistemas }, { t: 'Notificaciones por Telegram', fn: notificaciones });
  if ('Notification' in window && Notification.permission === 'default') it.push({ t: 'Avisos del gato en el escritorio', fn: () => Notification.requestPermission().then(p => aviso(p === 'granted' ? 'Listo: el gato te avisará aunque NodeCat esté en otra pestaña.' : 'Sin permiso del navegador; los avisos solo saldrán dentro de la página.', p !== 'granted')) });
  it.push({ t: 'Notificaciones en este dispositivo', fn: () => notificacionesDispositivo() });
  if (window.nodecatInstalar && matchMedia('(pointer: coarse)').matches && !matchMedia('(display-mode: standalone)').matches && navigator.standalone !== true) it.push({ t: 'Instalar en este teléfono', fn: () => window.nodecatInstalar() });
  it.push({ sep: true }, { t: 'Cerrar sesión', fn: salir });
  const alcance = SESION.clientes ? `, ${plural(SESION.clientes.length, 'cliente', 'clientes')}` : '';
  menuEn(e.currentTarget, it, `<div class="menu-cab"><b>${esc(SESION.usuario)}</b><span>${ROLES[SESION.rol] || esc(SESION.rol)}${alcance}${SESION.demo ? ', modo demo' : ''}</span></div>`);
});

/* ---------------- Logos de los sistemas ---------------- */
const SISTEMAS_LOGO = [
  ['proxmox', 'Proxmox VE', { tipo: 'proxmox' }, 'Hosts de Proxmox'], ['windows-server', 'Windows Server', { tipo: 'windows', so: 'Windows Server 2022' }, 'Servidores Windows Server'],
  ['windows', 'Windows', { tipo: 'windows', so: 'Windows 11' }, 'PC con Windows, y Windows Server o Hyper-V si no tienen el suyo'], ['hyperv', 'Hyper-V', { tipo: 'windows', hipervisor: 'hyperv' }, 'Hosts de Hyper-V'],
  ['ubuntu', 'Ubuntu', { tipo: 'linux', so: 'Ubuntu' }, ''], ['debian', 'Debian', { tipo: 'linux', so: 'Debian' }, ''], ['rocky', 'Rocky Linux', { tipo: 'linux', so: 'Rocky' }, ''],
  ['almalinux', 'AlmaLinux', { tipo: 'linux', so: 'AlmaLinux' }, ''], ['redhat', 'Red Hat', { tipo: 'linux', so: 'Red Hat' }, ''], ['centos', 'CentOS', { tipo: 'linux', so: 'CentOS' }, ''],
  ['fedora', 'Fedora', { tipo: 'linux', so: 'Fedora' }, ''], ['opensuse', 'openSUSE', { tipo: 'linux', so: 'openSUSE' }, ''], ['arch', 'Arch Linux', { tipo: 'linux', so: 'Arch' }, ''],
  ['alpine', 'Alpine', { tipo: 'linux', so: 'Alpine' }, ''], ['truenas', 'TrueNAS', { tipo: 'linux', so: 'TrueNAS' }, ''], ['linux', 'Linux (otros)', { tipo: 'linux', so: 'Linux' }, 'Distribuciones sin logo propio'],
  ['mikrotik', 'MikroTik', { tipo: 'mikrotik' }, 'Routers MikroTik'], ['fortigate', 'FortiGate', { tipo: 'fortigate' }, 'Firewalls FortiGate']
];
// El sistema por el nombre del archivo: "Ubuntu-logo-2022.svg" → ubuntu
function reconocerLogo(archivo) {
  const t = archivo.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[_\s.]+/g, '-');
  const reglas = [[/hyper-?v/, 'hyperv'], [/windows-?server|win-?srv|winserver/, 'windows-server'], [/windows|win1[01]|microsoft/, 'windows'], [/proxmox|pve/, 'proxmox'],
    [/ubuntu/, 'ubuntu'], [/debian/, 'debian'], [/rocky/, 'rocky'], [/alma/, 'almalinux'], [/red-?hat|rhel/, 'redhat'], [/centos/, 'centos'], [/fedora/, 'fedora'],
    [/suse/, 'opensuse'], [/arch/, 'arch'], [/alpine/, 'alpine'], [/truenas|freenas/, 'truenas'], [/mikrotik|routeros/, 'mikrotik'], [/forti/, 'fortigate'], [/linux|tux/, 'linux']];
  const r = reglas.find(([re]) => re.test(t));
  return r ? r[1] : null;
}
async function logosSistemas() {
  const dlg = libre('<div></div>', true);
  const usados = n => equipos().filter(e => { const k = sistemaDe(e)[0]; return ARCHIVO_LOGO[k] === n; }).length;
  let quitando = null;
  const pintar = () => {
    dlg.querySelector('.dlg').innerHTML = `<div><h3>Logos de los sistemas</h3>
      <p>Sube el logo de cada sistema y NodeCat lo usará en lugar de las iniciales, en todas las pantallas y en las páginas compartidas. Sirven SVG, PNG o WebP de hasta 512 KB; mejor si es cuadrado y con fondo transparente.</p>
      <p><label class="btn prim">Subir varios logos a la vez<input type="file" multiple accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp" data-varios hidden></label>
        <span class="tenue" style="margin-left:8px">NodeCat reconoce el sistema por el nombre del archivo (por ejemplo <code>Ubuntu-logo.png</code>) y lo asigna solo.</span></p>
      <div class="lista-logos">${SISTEMAS_LOGO.map(([n, t, ej, d]) => { const tiene = !!LOGOS_PROPIOS[n], u = usados(n); return `<div class="fila-logo">
        ${insigniaSO(ej, 'ok')}
        <span class="nombre"><b>${esc(t)}</b><small>${tiene ? 'Con logo propio' : 'Con iniciales'}${u ? `, en ${plural(u, 'equipo', 'equipos')}` : ''}${d ? `. ${esc(d)}` : ''}</small></span>
        <span class="acciones"><label class="btn">${tiene ? 'Cambiar' : 'Subir logo'}<input type="file" accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp" data-subir="${n}" hidden></label>
        ${tiene ? `<button type="button" class="btn ${quitando === n ? 'peligro' : ''}" data-quitar="${n}">${quitando === n ? '¿Seguro?' : 'Quitar'}</button>` : ''}</span></div>`; }).join('')}</div>
      <div class="msg error" role="alert" hidden></div>
      <div class="pie"><button class="btn" type="button" data-cerrar>Cerrar</button></div></div>`;
    const m = dlg.querySelector('.msg.error');
    dlg.querySelector('[data-cerrar]').onclick = () => dlg.close();
    const listo = (l, texto) => { ponerLogos(l); quitando = null; pintar(); actualizar(); aviso(texto); };
    const leerArchivo = f => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.readAsDataURL(f); });
    dlg.querySelector('[data-varios]').onchange = async ev => {
      const archivos = [...ev.target.files], hechos = [], fuera = [];
      let ultimo = null;
      for (const f of archivos) {
        const n = reconocerLogo(f.name);
        if (!n || f.size > 512 * 1024) { fuera.push(f.name + (n ? ' (pesa más de 512 KB)' : '')); continue; }
        try { ultimo = await enviar(`/api/logos/${n}`, 'PUT', { datos: await leerArchivo(f) }); hechos.push(SISTEMAS_LOGO.find(x => x[0] === n)[1]); }
        catch (x) { if (x.login) return; fuera.push(`${f.name} (${x.message})`); }
      }
      if (ultimo) { ponerLogos(ultimo.logos); quitando = null; pintar(); actualizar(); }
      if (hechos.length) aviso(`Logos asignados: ${hechos.join(', ')}.`);
      if (fuera.length) gatoDice(dlg.querySelector('.msg.error'), `No reconocí ${fuera.length === 1 ? 'este archivo' : 'estos archivos'}: ${fuera.join(', ')}. Súbelos desde la fila de su sistema.`);
    };
    dlg.querySelectorAll('[data-subir]').forEach(i => i.onchange = async () => {
      const f = i.files[0]; if (!f) return;
      if (f.size > 512 * 1024) { gatoDice(m, 'El archivo debe pesar menos de 512 KB.'); return; }
      const datos = await leerArchivo(f);
      try { const r = await enviar(`/api/logos/${i.dataset.subir}`, 'PUT', { datos }); listo(r.logos, 'Logo guardado.'); }
      catch (x) { if (!x.login) gatoDice(m, x.message); }
    });
    dlg.querySelectorAll('[data-quitar]').forEach(b => b.onclick = async () => {
      if (quitando !== b.dataset.quitar) { quitando = b.dataset.quitar; pintar(); return; }
      try { const r = await enviar(`/api/logos/${b.dataset.quitar}`, 'DELETE'); listo(r.logos, 'Logo quitado: vuelven las iniciales.'); }
      catch (x) { if (!x.login) gatoDice(m, x.message); }
    });
  };
  try { ponerLogos((await api('/api/logos')).logos); } catch { }
  pintar();
}

/* ---------------- Verificación en dos pasos ---------------- */
function cargarQr() {
  return window.qrcode ? Promise.resolve() : new Promise((ok, mal) => { const sc = document.createElement('script'); sc.src = 'qrcode.js'; sc.onload = ok; sc.onerror = () => mal(new Error('No se pudo cargar el generador de QR.')); document.head.appendChild(sc); });
}
async function dosPasos() {
  let est;
  try { est = await api('/api/dos-pasos'); } catch (x) { if (!x.login) aviso(x.message, true); return; }
  const dlg = libre('<div></div>');
  const caja = () => dlg.querySelector('.dlg');
  const msg = () => dlg.querySelector('.msg.error');
  const inicio = () => {
    caja().innerHTML = est.activo ? `<form><h3>Verificación en dos pasos</h3>
        <div class="msg bien" style="display:block"><b>Activada.</b> Al entrar, NodeCat te pide el código de tu aplicación de autenticación. Te quedan ${plural(est.recuperacion, 'código de recuperación', 'códigos de recuperación')}.</div>
        <p>Para desactivarla, confirma con tu contraseña y un código de la aplicación.</p>
        <label class="campo">Contraseña<input type="password" name="clave" autocomplete="current-password" required></label>
        <label class="campo">Código de la aplicación<input name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
        <div class="msg error" role="alert" hidden></div>
        <div class="pie"><button class="btn" type="button" data-cerrar>Cerrar</button><button class="btn peligro" type="submit">Desactivar</button></div></form>`
      : `<div><h3>Verificación en dos pasos</h3>
        <p>Además de tu contraseña, NodeCat te pedirá un código de 6 cifras que cambia cada 30 segundos en tu teléfono. Si alguien consigue tu contraseña, no podrá entrar sin el teléfono.</p>
        <p class="tenue">Sirve cualquier aplicación de autenticación: Google Authenticator, Microsoft Authenticator, Authy, 2FAS, Bitwarden…</p>
        <div class="msg error" role="alert" hidden></div>
        <div class="pie"><button class="btn" type="button" data-cerrar>Ahora no</button><button class="btn prim" type="button" data-empezar>Activar</button></div></div>`;
    dlg.querySelectorAll('[data-cerrar]').forEach(b => b.onclick = () => dlg.close());
    const be = dlg.querySelector('[data-empezar]'); if (be) be.onclick = ev => ocupado(ev.currentTarget, 'Preparando…', preparar);
    const f = dlg.querySelector('form');
    if (f) { f.clave.focus(); f.onsubmit = async ev => { ev.preventDefault(); try { await enviar('/api/dos-pasos/quitar', 'POST', { clave: f.clave.value, codigo: f.codigo.value }); dlg.close(); aviso('Verificación en dos pasos desactivada.'); } catch (x) { if (!x.login) gatoDice(msg(), x.message); } }; }
  };
  const preparar = async () => {
    let p;
    try { [p] = await Promise.all([enviar('/api/dos-pasos/preparar', 'POST'), cargarQr()]); } catch (x) { if (!x.login) gatoDice(msg(), x.message); return; }
    const qr = window.qrcode(0, 'M'); qr.addData(p.uri); qr.make();
    caja().innerHTML = `<form><h3>Escanea el código</h3>
      <ol class="pasos"><li>Abre tu aplicación de autenticación y elige <b>agregar cuenta</b> o <b>escanear código QR</b>.</li><li>Escanea este código. Aparecerá “NodeCat” con tu usuario.</li><li>Escribe el código de 6 cifras que muestra la aplicación.</li></ol>
      <div class="qr-2fa">${qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true })}</div>
      <details class="clave"><summary>¿No puedes escanear? Escribe esta clave</summary><code class="codigo">${esc(p.secreto.replace(/(.{4})/g, '$1 ').trim())}</code></details>
      <label class="campo">Código de la aplicación<input name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required placeholder="123456"></label>
      <div class="msg error" role="alert" hidden></div>
      <div class="pie"><button class="btn" type="button" data-cerrar>Cancelar</button><button class="btn prim" type="submit">Activar</button></div></form>`;
    dlg.querySelectorAll('[data-cerrar]').forEach(b => b.onclick = () => dlg.close());
    const f = dlg.querySelector('form'); f.codigo.focus();
    f.onsubmit = async ev => {
      ev.preventDefault();
      try { const r = await enviar('/api/dos-pasos/activar', 'POST', { codigo: f.codigo.value }); est = { activo: true, recuperacion: r.codigos.length }; codigos(r.codigos); }
      catch (x) { if (!x.login) gatoDice(msg(), x.message); }
    };
  };
  const codigos = l => {
    const texto = `Códigos de recuperación de NodeCat (${SESION.usuario})\nCada uno sirve una sola vez si pierdes el teléfono.\n\n${l.join('\n')}\n`;
    caja().innerHTML = `<div><h3>Verificación en dos pasos activada</h3>
      <p><b>Guarda estos códigos de recuperación</b> en un lugar seguro. Si pierdes el teléfono, cada uno te deja entrar una vez en lugar del código de la aplicación. No se vuelven a mostrar.</p>
      <div class="codigos-rec">${l.map(c => `<code>${esc(c)}</code>`).join('')}</div>
      <p style="margin-top:14px"><button class="btn" type="button" data-copiar>Copiar</button> <a class="btn" download="nodecat-codigos-recuperacion.txt" href="data:text/plain;charset=utf-8,${encodeURIComponent(texto)}">Descargar .txt</a></p>
      <div class="pie"><button class="btn prim" type="button" data-cerrar>Ya los guardé</button></div></div>`;
    dlg.querySelector('[data-cerrar]').onclick = () => { dlg.close(); aviso('Listo. La próxima vez que entres, NodeCat te pedirá el código.'); };
    dlg.querySelector('[data-copiar]').onclick = async () => { try { await navigator.clipboard.writeText(texto); aviso('Códigos copiados.'); } catch { aviso('No se pudo copiar; descárgalos.', true); } };
  };
  inicio();
}

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
      <div class="tabla-dlg desliza"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Clientes</th><th>Notificaciones</th><th>Último acceso</th><th><span class="sr">Acciones</span></th></tr></thead><tbody>
      ${lista.map(c => `<tr><td><span class="usr">${esc(c.usuario)}</span>${yo(c) ? ' <span class="tenue">(tú)</span>' : ''}${c.dosPasos ? ' <span class="chip-hv ok" title="Verificación en dos pasos activada" style="margin:0 0 0 6px">2 pasos</span>' : ''}</td>
        <td>${ROLES[c.rol] || esc(c.rol)}</td><td style="white-space:normal;max-width:220px">${esc(alcance(c))}</td><td>${c.push ? (c.dispositivos ? plural(c.dispositivos, 'dispositivo', 'dispositivos') : '<span class="tenue">Permitidas</span>') : '<span class="tenue">No</span>'}</td><td class="tenue">${c.ultimo_acceso ? cuando(c.ultimo_acceso) : 'Nunca'}</td>
        <td class="acc">${yo(c) ? '' : `<button type="button" class="enlace" data-editar="${esc(c.usuario)}">Editar</button>${c.dosPasos ? `<button type="button" class="enlace" data-quitar2="${esc(c.usuario)}">${borrando === '2:' + c.usuario ? '¿Seguro? Quitar 2 pasos' : 'Quitar 2 pasos'}</button>` : ''}<button type="button" class="enlace peligro" data-borrar="${esc(c.usuario)}">${borrando === c.usuario ? '¿Seguro? Borrar' : 'Borrar'}</button>`}</td></tr>`).join('')}
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
        <label class="interruptor" style="margin-top:10px"><input type="checkbox" name="push" ${!editando || editando.push ? 'checked' : ''}><span><b>Puede recibir notificaciones en sus dispositivos</b><small>En su teléfono o PC, aunque NodeCat esté cerrado. Solo de los clientes que puede ver; cada persona elige cuáles y de qué tipo en su menú.</small></span></label>
        ${msg ? (bien ? `<div class="msg bien" role="status" style="margin-top:12px">${esc(msg)}</div>` : `<div style="margin-top:12px">${gatoError(esc(msg))}</div>`) : ''}
        <div class="pie">${editando ? '<button class="btn" type="button" data-nuevo>Cancelar edición</button>' : ''}<button class="btn" type="button" data-cerrar>Cerrar</button><button class="btn prim" type="submit">${editando ? 'Guardar cambios' : 'Crear cuenta'}</button></div>
      </form>`, true);
    const f = dlg.querySelector('form');
    f.querySelectorAll('[name=cli], [name=grp]').forEach(x => x.onchange = () => { if (x.checked) f.alcance.value = 'algunos'; });
    dlg.querySelectorAll('[data-editar]').forEach(b => b.onclick = () => { editando = lista.find(c => c.usuario === b.dataset.editar); borrando = null; pintar(); });
    const nv = dlg.querySelector('[data-nuevo]'); if (nv) nv.onclick = () => { editando = null; pintar(); };
    dlg.querySelectorAll('[data-quitar2]').forEach(b => b.onclick = async () => {
      const u = b.dataset.quitar2;
      if (borrando !== '2:' + u) { borrando = '2:' + u; pintar(); return; }
      try { await enviar('/api/cuentas/' + encodeURIComponent(u) + '/dos-pasos', 'DELETE'); await recargar(); borrando = null; pintar(`Verificación en dos pasos quitada a ${u}. Podrá entrar solo con su contraseña y volver a activarla.`, true); }
      catch (x) { if (!x.login) pintar(x.message); }
    });
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
      const d = { usuario: f.usuario.value.trim(), clave: f.clave.value, rol: f.rol.value, clientes: clientes && clientes.length ? clientes : null, grupos: grupos && grupos.length ? grupos : null, nueva: !editando, push: f.push.checked };
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
    <h4>1. Bot general</h4>
    <p class="tenue">Recibe todos los avisos (por ejemplo, en tu grupo de soporte). Opcional si usas bots por cliente.</p>
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
    <h4 class="separado">Bots por cliente o grupo</h4>
    <p>Para que cada cliente reciba solo sus avisos en su propio grupo de Telegram: crea un bot con <b>@BotFather</b> para ese cliente (o para un grupo de sedes), agrégalo aquí y añádelo al grupo de Telegram del cliente. NodeCat detecta solo los grupos donde está el bot y saluda en el chat para confirmarlo.</p>
    <div id="bots"></div>
    <h4 class="separado">3. Qué avisar</h4>
    <div class="reglas">
      <div class="regla"><label>${marca('caidas', n.caidas)} Un servidor deja de responder durante</label> ${num('caidaMin', n.caidaMin, 0, 120, 'Minutos sin responder')} min más, y cuando vuelve</div>
      <div class="regla"><label>${marca('cpu', n.cpu)} CPU por encima del</label> ${num('cpuUmbral', n.cpuUmbral, 50, 100, 'Umbral de CPU')} % durante ${num('cpuMin', n.cpuMin, 0, 240, 'Minutos de CPU alta')} min</div>
      <div class="regla"><label>${marca('ram', n.ram)} Memoria por encima del</label> ${num('ramUmbral', n.ramUmbral, 50, 100, 'Umbral de memoria')} % durante ${num('ramMin', n.ramMin, 0, 240, 'Minutos de memoria alta')} min</div>
      <div class="regla"><label>${marca('disco', n.disco)} Disco por encima del</label> ${num('discoUmbral', n.discoUmbral, 50, 100, 'Umbral de disco')} %</div>
      <div class="regla"><label>${marca('firmware', n.firmware !== false)} Hay una versión nueva de RouterOS o FortiOS para un equipo de red</label></div>
      <div class="regla"><label>${marca('vms', n.vms !== false)} Una VM o contenedor de un hipervisor que estaba encendido se apaga durante</label> ${num('vmMin', n.vmMin == null ? 2 : n.vmMin, 0, 120, 'Minutos apagada')} min, y cuando vuelve</div>
      <div class="regla"><label>${marca('nuevos', n.nuevos !== false)} Se agrega un equipo nuevo a un cliente (se instala un agente o se agrega un equipo de red) o se reinstala un agente</label></div>
      <div class="regla"><label>${marca('fgSeguridad', n.fgSeguridad !== false)} Pasa algo importante en un FortiGate con logs activados: intentos de acceso fallidos, cuentas creadas o borradas, ataques, virus, reinicios, cambios de configuración</label></div>
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
  // ---- bots por cliente o grupo (se guardan al momento, sin pulsar Guardar)
  let bots = arr(n.bots), editandoBot = null, quitandoBot = null;
  const gruposTodos = arr(estado.grupos);
  const marcas = (sel, selG, pre) => `${gruposTodos.length ? `<div class="marcas-cli">${gruposTodos.map(g => `<label class="grupo"><input type="checkbox" name="${pre}grp" value="${g.id}" ${arr(selG).includes(g.id) ? 'checked' : ''}> ${esc(g.nombre)}</label>`).join('')}</div>` : ''}
    <div class="marcas-cli">${estado.clientes.map(c => `<label><input type="checkbox" name="${pre}cli" value="${c.id}" ${arr(sel).includes(c.id) ? 'checked' : ''}> ${esc(c.nombre)}</label>`).join('')}</div>`;
  const leer = (raiz, pre) => ({ clientes: [...raiz.querySelectorAll(`[name=${pre}cli]:checked`)].map(x => +x.value), grupos: [...raiz.querySelectorAll(`[name=${pre}grp]:checked`)].map(x => +x.value) });
  const pintarBots = () => {
    const h = dlg.querySelector('#bots');
    h.innerHTML = `${bots.length ? `<div class="lista-bots">${bots.map(b => `<div class="bot" data-bot="${esc(b.id)}">
        <div class="bot-cab"><span><strong>${esc(b.usuario)}</strong><small>${b.alcance.length ? 'Avisos de ' + esc(b.alcance.join(', ')) : 'Sin clientes asignados'}</small></span>
          <span class="acciones"><button class="btn" type="button" data-b-probar>Probar</button><button class="btn" type="button" data-b-editar>${editandoBot === b.id ? 'Cerrar' : 'Editar'}</button><button class="btn ${quitandoBot === b.id ? 'peligro' : ''}" type="button" data-b-quitar>${quitandoBot === b.id ? '¿Seguro?' : 'Quitar'}</button></span></div>
        <p class="bot-chats">${b.chats.length ? b.chats.map(c => `<span class="chip">${esc(c.nombre)} <small>${esc(c.tipo)}</small></span>`).join('') : `<span class="tenue">Todavía no está en ningún chat: añade ${esc(b.usuario)} al grupo de Telegram del cliente. Aparecerá aquí solo en un minuto, o pulsa Probar.</span>`}${b.error ? `<span class="mal">${esc(b.error)}</span>` : ''}</p>
        ${editandoBot === b.id ? `<div class="bot-editar">
          <p class="tenue" style="margin:0 0 8px">Clientes y grupos que avisa este bot. Si eliges un grupo, incluye también las sedes que agregues después.</p>
          ${marcas(b.clientes, b.grupos, 'e')}
          ${b.chats.length ? `<p class="tenue" style="margin:10px 0 6px">Chats donde envía (desmarca uno para dejar de usarlo):</p><div class="marcas-cli">${b.chats.map(c => `<label><input type="checkbox" name="echat" value="${esc(c.id)}" checked> ${esc(c.nombre)}</label>`).join('')}</div>` : ''}
          <p style="margin:10px 0 0"><button class="btn prim" type="button" data-b-guardar>Guardar bot</button></p></div>` : ''}
      </div>`).join('')}</div>` : ''}
      <details class="clave" ${bots.length ? '' : 'open'}><summary>Agregar un bot</summary>
        <label class="campo">Token del bot<input name="nuevoBot" type="password" autocomplete="off" spellcheck="false" placeholder="123456789:AAF…"></label>
        <p class="tenue" style="margin:0 0 8px">¿A quién avisa?</p>
        ${marcas([], [], 'n')}
        <p style="margin:10px 0 0"><button class="btn" type="button" data-b-agregar>Agregar bot</button></p>
      </details>`;
    h.querySelector('[data-b-agregar]').onclick = ev => ocupado(ev.currentTarget, 'Agregando…', async () => {
      error('');
      try { const r = await enviar('/api/notificaciones/bots', 'POST', { token: h.querySelector('[name=nuevoBot]').value, ...leer(h, 'n') }); bots.push(r); pintarBots(); aviso(r.chats.length ? `${r.usuario} agregado. Ya está en ${plural(r.chats.length, 'chat', 'chats')}.` : `${r.usuario} agregado. Ahora añádelo al grupo de Telegram del cliente.`); }
      catch (x) { if (!x.login) error(x.message); }
    });
    h.querySelectorAll('[data-bot]').forEach(el => {
      const id = el.dataset.bot, i = bots.findIndex(b => b.id === id);
      el.querySelector('[data-b-editar]').onclick = () => { editandoBot = editandoBot === id ? null : id; quitandoBot = null; pintarBots(); };
      el.querySelector('[data-b-probar]').onclick = ev => ocupado(ev.currentTarget, 'Enviando…', async () => {
        error('');
        try { bots[i] = await enviar(`/api/notificaciones/bots/${id}/probar`, 'POST'); pintarBots(); aviso(`Mensaje de prueba enviado por ${bots[i].usuario}. Revisa Telegram.`); }
        catch (x) { if (!x.login) error(x.message); }
      });
      el.querySelector('[data-b-quitar]').onclick = async () => {
        if (quitandoBot !== id) { quitandoBot = id; pintarBots(); return; }
        try { await enviar(`/api/notificaciones/bots/${id}`, 'DELETE'); bots.splice(i, 1); quitandoBot = null; pintarBots(); aviso('Bot quitado.'); }
        catch (x) { if (!x.login) error(x.message); }
      };
      const g = el.querySelector('[data-b-guardar]');
      if (g) g.onclick = ev => ocupado(ev.currentTarget, 'Guardando…', async () => {
        try { bots[i] = await enviar(`/api/notificaciones/bots/${id}`, 'PUT', { ...leer(el, 'e'), chats: [...el.querySelectorAll('[name=echat]:checked')].map(x => x.value) }); editandoBot = null; pintarBots(); aviso('Bot guardado.'); }
        catch (x) { if (!x.login) error(x.message); }
      });
    });
  };
  pintarBots();
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
    for (const k of ['activo', 'caidas', 'cpu', 'ram', 'disco', 'firmware', 'fgSeguridad', 'nuevos', 'vms', 'resumen']) d[k] = f[k].checked;
    for (const k of ['caidaMin', 'cpuUmbral', 'cpuMin', 'ramUmbral', 'ramMin', 'discoUmbral', 'vmMin']) d[k] = +f[k].value;
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
