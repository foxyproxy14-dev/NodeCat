'use strict';
/* ======================================================================
   NodeCat: routers MikroTik (página en modo consola, al estilo de MikroDash)
   Usa las utilidades de app.js ($, esc, api, cuando…).
   ====================================================================== */
const COL = { bajada: '#4cc3d9', subida: '#f2a65a' };
const bps = v => {
  if (v == null) return '—';
  const u = [['Gb/s', 1e9], ['Mb/s', 1e6], ['kb/s', 1e3]];
  for (const [n, d] of u) if (v >= d) return `${nf.format(v / d >= 100 ? Math.round(v / d) : Math.round(v / d * 10) / 10)} ${n}`;
  return `${Math.round(v)} b/s`;
};
const bytes = v => {
  if (v == null) return '—';
  const u = [['TB', 1e12], ['GB', 1e9], ['MB', 1e6], ['kB', 1e3]];
  for (const [n, d] of u) if (v >= d) return `${nf.format(Math.round(v / d * 10) / 10)} ${n}`;
  return `${v} B`;
};
const mem = gb => gb == null ? '—' : gb < 1 ? `${Math.round(gb * 1024)} MB` : `${nf.format(Math.round(gb * 10) / 10)} GB`;
const miles = v => v == null ? '—' : Number(v).toLocaleString('es');
const hace = s => s == null ? '—' : s < 60 ? `${s} s` : durTxt(s * 1000);

const rt = { id: null, red: null, pestana: 'resumen', vivo: null, sel: null, temporizador: null, seccion: {}, cargandoSec: false, filtro: '', rango: '24h', histT: {} };
// Menú lateral del router, por grupos (como MikroDash). Todo es de solo lectura.
const MENU_RT = [
  ['Panel', [['resumen', 'Resumen'], ['sucesos', 'Caídas y sucesos']]],
  ['Red', [['interfaces', 'Interfaces'], ['ip', 'Direcciones IP'], ['rutas', 'Rutas'], ['arp', 'ARP'], ['dns', 'DNS'], ['bridges', 'Bridges y VLAN'], ['vecinos', 'Vecinos']]],
  ['Inalámbrico', [['wifi', 'Clientes Wi‑Fi'], ['redeswifi', 'Redes Wi‑Fi'], ['capsman', 'CAPsMAN']]],
  ['Servicios IP', [['dhcp', 'Concesiones DHCP'], ['dhcpserv', 'Servidores DHCP'], ['dhcpcli', 'Cliente DHCP'], ['pools', 'Pools de IP']]],
  ['Túneles', [['vpn', 'Conexiones VPN'], ['wgif', 'WireGuard'], ['tuneles', 'Otros túneles']]],
  ['Tráfico', [['ancho', 'Ancho de banda'], ['colas', 'Colas'], ['conexiones', 'Conexiones']]],
  ['Seguridad', [['firewall', 'Filtro'], ['nat', 'NAT'], ['mangle', 'Mangle'], ['listas', 'Listas de direcciones']]],
  ['Sistema', [['registro', 'Registro'], ['paquetes', 'Paquetes y firmware'], ['servicios', 'Servicios'], ['scripts', 'Scripts'], ['tareas', 'Tareas programadas'], ['reloj', 'Reloj y NTP'], ['logging', 'Destinos del registro'], ['snmp', 'SNMP'], ['archivos', 'Archivos'], ['contenedores', 'Contenedores'], ['usuarios', 'Usuarios']]],
  ['Herramientas', [['herramientas', 'Ping y traceroute']]]
];
// FortiGate: su propio menú (todo de solo lectura)
const MENU_FG = [
  ['Panel', [['resumen', 'Resumen'], ['sucesos', 'Caídas y sucesos']]],
  ['Red', [['interfaces', 'Interfaces'], ['fg-rutas', 'Rutas'], ['fg-dhcp', 'DHCP']]],
  ['SD-WAN', [['fg-sdwan', 'Enlaces y SLA'], ['ancho', 'Ancho de banda']]],
  ['VPN', [['fg-ipsec', 'Túneles IPsec'], ['fg-sslvpn', 'SSL-VPN']]],
  ['Seguridad', [['fg-politicas', 'Políticas'], ['fg-usuarios', 'Usuarios autenticados']]],
  ['Sistema', [['fg-licencias', 'Licencias FortiGuard'], ['fg-ha', 'Alta disponibilidad'], ['fg-eventos', 'Registro de eventos']]]
];
let MENU_ACTUAL = MENU_RT;
const TITULO_RT = Object.fromEntries([...MENU_RT, ...MENU_FG].flatMap(([, l]) => l));
const LOCALES_RT = ['resumen', 'interfaces', 'ancho', 'herramientas', 'sucesos'];   // no piden sección al router
let gruposAbiertos = new Set(leer('gruposRt', ['Panel', 'Red']));

function montarRouter(e, c) {
  MENU_ACTUAL = e.tipo === 'fortigate' ? MENU_FG : MENU_RT;
  if (!MENU_ACTUAL.some(([, l]) => l.some(([k]) => k === rt.pestana))) rt.pestana = 'resumen';
  rt.id = e.id; rt.vivo = null; rt.seccion = {}; rt.filtro = ''; rt.red = null; rt.herr = null; rt.sucesos = null;
  if (!TITULO_RT[rt.pestana]) rt.pestana = 'resumen';
  $('#vista').innerHTML = `
    <nav class="miga" aria-label="Ruta"><a href="#/">Clientes</a>${ICO.miga}<a href="#/c/${c.id}">${esc(c.nombre)}</a>${ICO.miga}<span>${esc(e.nombre)}</span></nav>
    <section class="rt-cab">
      <div><h1><span class="punto" id="rtPunto" aria-hidden="true"></span><span id="rtNombre"></span></h1><p id="rtMeta"></p></div>
      <div class="acciones"><span class="en-vivo" id="rtVivo"><i aria-hidden="true"></i>En vivo</span>${esAdmin() ? '<button class="btn" type="button" id="btnEditarRt">Editar</button>' : ''}</div>
    </section>
    <div id="rtAvisos"></div>
    <div class="rt-marco">
      <nav class="rt-lateral" id="rtMenu" aria-label="Secciones del router"></nav>
      <label class="rt-menu-movil"><span class="sr">Sección</span><select class="selector" id="rtMenuMovil">${MENU_ACTUAL.map(([g, l]) => `<optgroup label="${g}">${l.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <div class="rt-contenido"><h2 class="rt-titulo" id="rtTitulo"></h2><div id="rtCuerpo"></div></div>
    </div>`;
  $('#rtMenu').onclick = ev => {
    const g = ev.target.closest('[data-grupo]');
    if (g) { const n = g.dataset.grupo; gruposAbiertos.has(n) ? gruposAbiertos.delete(n) : gruposAbiertos.add(n); guardar('gruposRt', [...gruposAbiertos]); pintarMenuRt(); return; }
    const b = ev.target.closest('[data-pest]'); if (b) irSeccionRt(b.dataset.pest);
  };
  $('#rtMenuMovil').onchange = ev => irSeccionRt(ev.target.value);
  const be = $('#btnEditarRt'); if (be) be.onclick = () => e.tipo === 'fortigate' ? dialogoForti(c.id, e.id) : dialogoRouter(c.id, e.id);
  pintarMenuRt();
  pintarCuerpoRt(true);
  pedirVivo();
}
function irSeccionRt(k) {
  rt.pestana = k; rt.filtro = ''; rt.red = null;
  pintarMenuRt(); pintarCuerpoRt(true);
  const c = document.querySelector('.rt-contenido'); if (c && c.getBoundingClientRect().top < 0) c.scrollIntoView({ behavior: 'smooth' });
}
function pintarMenuRt() {
  const e = equipo(rt.id), red = (e && e.red) || {};
  const cuentas = { interfaces: red.interfaces ? red.interfaces.filter(i => !i.deshabilitada).length : 0, dhcp: red.dhcp, vpn: red.vpnTotal, 'fg-dhcp': red.dhcp, 'fg-ipsec': red.vpnTotal, 'fg-sdwan': red.wans && red.wans.length > 1 ? red.wans.length : null };
  const grupoActual = MENU_ACTUAL.find(([, l]) => l.some(([k]) => k === rt.pestana))[0];
  $('#rtMenu').innerHTML = MENU_ACTUAL.map(([g, l]) => {
    const abierto = gruposAbiertos.has(g) || g === grupoActual;
    return `<div class="rt-grupo ${abierto ? 'abierto' : ''}"><button type="button" class="rt-grupo-cab" data-grupo="${g}" aria-expanded="${abierto}">${g}</button>
      ${abierto ? `<ul>${l.map(([k, t]) => `<li><button type="button" data-pest="${k}" ${rt.pestana === k ? 'aria-current="page"' : ''}>${t}${cuentas[k] ? `<span class="cuenta">${cuentas[k]}</span>` : ''}</button></li>`).join('')}</ul>` : ''}</div>`;
  }).join('');
  $('#rtMenuMovil').value = rt.pestana;
  $('#rtTitulo').textContent = TITULO_RT[rt.pestana];
}

// Sondeo propio de la página: datos en vivo cada 3 s y la sección abierta cada 5 s
async function pedirVivo() {
  clearTimeout(rt.temporizador);
  const id = rt.id, r = rutaActual();
  if (r.vista !== 'equipo' || r.id !== id || !SESION) return;
  if (!document.hidden) {
    try {
      rt.vivo = await api(`/api/routers/${id}/vivo`);
      await cargar();          // estado general: CPU, interfaces, WAN…
      if (rutaActual().id === id) { vistaRouter(id); if (!LOCALES_RT.includes(rt.pestana) && !ESTATICAS_RT.includes(rt.pestana)) cargarSeccion(); }
    } catch (e) { if (e.login) return; }
  }
  rt.temporizador = setTimeout(pedirVivo, 3000);
}
// Secciones que casi no cambian: se piden al abrirlas y cada minuto
const ESTATICAS_RT = ['fg-licencias', 'fg-ha', 'fg-rutas', 'ip', 'dns', 'bridges', 'redeswifi', 'dhcpserv', 'pools', 'wgif', 'tuneles', 'nat', 'mangle', 'paquetes', 'servicios', 'scripts', 'tareas', 'reloj', 'logging', 'snmp', 'archivos', 'contenedores', 'usuarios'];
async function cargarSeccion(forzar) {
  const nombre = rt.pestana, id = rt.id;
  const s = rt.seccion[nombre];
  if (rt.cargandoSec || (!forzar && s && Date.now() - s.t < 4500)) return;
  rt.cargandoSec = true;
  try { const d = await api(`/api/routers/${id}/seccion/${nombre}`); rt.seccion[nombre] = { t: Date.now(), datos: d.datos }; }
  catch (e) { if (!e.login) rt.seccion[nombre] = { t: Date.now(), error: e.message }; }
  rt.cargandoSec = false;
  if (rt.id === id && rt.pestana === nombre) pintarSeccion();
}

function vistaRouter(id) {
  const e = equipo(id); if (!e) return;
  const red = e.red || {}, vivo = e.estado === 'ok' || e.estado === 'sinMetricas';
  $('#rtPunto').className = 'punto ' + e.estado;
  $('#rtNombre').textContent = e.nombre;
  const meta = [e.estado === 'caido' ? 'Sin respuesta' : e.estado === 'pendiente' ? 'Conectando…' : 'En línea'];
  if (red.version) meta.push(`${e.tipo === 'fortigate' ? 'FortiOS' : 'RouterOS'} ${red.version}`);
  if (e.tipo === 'fortigate' && red.ha > 1) meta.push(`en alta disponibilidad (${red.ha} equipos)`);
  if (red.modelo) meta.push(red.modelo);
  if (red.identidad && red.identidad !== e.nombre) meta.push(`identidad “${red.identidad}”`);
  $('#rtMeta').textContent = meta.join(', ') + '.';
  $('#rtVivo').classList.toggle('pausa', !vivo);
  $('#rtVivo').lastChild.textContent = vivo ? 'En vivo' : 'Sin conexión';
  let av = '';
  if (e.errorConexion && (e.estado === 'caido' || e.estado === 'pendiente')) av = gatoError(`<b>${e.estado === 'pendiente' ? 'Todavía no pude conectar.' : 'No responde.'}</b> ${esc(e.errorConexion)}`);
  else if (e.estado === 'caido') av = gatoError(`<b>No responde.</b> La última respuesta fue ${cuando(e.ultimo)}. Los datos de abajo son los últimos que llegaron.`);
  else if (e.estado === 'pendiente') av = '<div class="msg atencion">Conectando con el router…</div>';
  if (vivo && red.wan && !red.wan.activa) av += `<div class="msg error"><b>El enlace WAN (${esc(red.wan.interfaz)}) está caído.</b> El router sigue respondiendo, quizá por una conexión de respaldo.</div>`;
  const ra = $('#rtAvisos'); if (ra.dataset.v !== av) { ra.innerHTML = av; ra.dataset.v = av; }
  const cm = `${red.interfaces ? red.interfaces.length : 0}|${red.dhcp}|${red.vpnTotal}`;
  if (rt.cuentasMenu !== cm) { rt.cuentasMenu = cm; pintarMenuRt(); }
  pintarCuerpoRt(false);
}

function pintarCuerpoRt(montar) {
  const cuerpo = $('#rtCuerpo'); if (!cuerpo) return;
  const e = equipo(rt.id); if (!e) return;
  if (rt.pestana === 'resumen') {
    if (montar || !$('#rtLosas')) {
      cuerpo.innerHTML = `<div class="losas" id="rtLosas"></div>
        <div class="latencias" id="rtLat"></div>
        <div class="rejilla-rt">
          <section class="tablero-vivo"><div class="tv-cab"><h3 id="tvTitulo"></h3><div class="tv-cifras" id="tvCifras"></div></div><div class="grafico-vivo" id="grafVivo"></div></section>
          <section class="tablero-vivo"><div class="tv-cab"><h3>Interfaces<small>Pulsa una para verla en el gráfico</small></h3></div><ul class="lista-if" id="rtIfs"></ul></section>
        </div>
        <div class="cab-seccion" style="margin-top:28px"><h2>Historial</h2>
          <div class="segmentos" role="group" aria-label="Periodo" id="rtRangos">${Object.entries(RANGOS).map(([k, x]) => `<button type="button" data-rango="${k}">${x.t}</button>`).join('')}</div></div>
        <div class="rejilla-srv">
          <section class="panel"><div class="panel-cab"><h3>Tráfico de <span id="histIf"></span></h3></div><p class="nota" id="traNota"></p><div class="grafico-vivo" id="grafTra" style="height:170px"></div></section>
          <section class="panel"><div class="panel-cab"><h3>CPU</h3><span class="grande" id="cpuAhora"></span></div><p class="nota" id="cpuNota"></p><div class="grafico" id="grafCpu"></div></section>
          <section class="panel"><div class="panel-cab"><h3>Memoria</h3><span class="grande" id="ramAhora"></span></div><p class="nota" id="ramNota"></p><div class="grafico" id="grafRam"></div></section>
        </div>
        <p class="disponibilidad" id="disponibilidad"></p>`;
      $('#rtIfs').onclick = ev => { const li = ev.target.closest('[data-if]'); if (li) { rt.sel = li.dataset.if; pintarCuerpoRt(false); } };
      $('#rtRangos').onclick = ev => { const b = ev.target.closest('[data-rango]'); if (b) { rt.rango = b.dataset.rango; pintarCuerpoRt(false); } };
      $('#disponibilidad').onclick = ev => { if (ev.target.closest('[data-ver-sucesos]')) irSeccionRt('sucesos'); };
    }
    resumenRouter(e);
  } else if (rt.pestana === 'interfaces') {
    if (montar || !$('#rtTablaIf')) cuerpo.innerHTML = '<section class="hoja desliza" id="rtTablaIf"></section>';
    tablaInterfaces(e);
  } else if (rt.pestana === 'ancho') {
    anchoDeBanda(e, montar);
  } else if (rt.pestana === 'herramientas') {
    if (montar) herramientasRt();
  } else if (rt.pestana === 'sucesos') {
    if (montar) cargarSucesosRt();
  } else if (montar) {
    cuerpo.innerHTML = `<div id="rtSeccion">${gatoCargando('Preguntándole al router…')}</div>`;
    cargarSeccion(true);
  } else if (ESTATICAS_RT.includes(rt.pestana) && rt.seccion[rt.pestana] && Date.now() - rt.seccion[rt.pestana].t > 60000) cargarSeccion(true);
}

function interfazSel(e) {
  const red = e.red || {}, l = red.interfaces || [];
  if (rt.sel && l.some(i => i.nombre === rt.sel)) return rt.sel;
  return (red.wan && red.wan.interfaz) || (l[0] && l[0].nombre) || null;
}

function resumenRouter(e) {
  const red = e.red || {}, vivo = e.estado === 'ok' || e.estado === 'sinMetricas';
  const losa = (t, v, sub, pct, mal) => `<div class="losa ${mal ? 'mal' : ''}"><h4>${t}</h4><div class="v">${v}</div>${sub ? `<small>${sub}</small>` : ''}${pct != null ? `<div class="carril n-${nivel(pct)}"><span style="width:${pct}%"></span></div>` : ''}</div>`;
  const pc = v => v == null ? '—' : `${v}<i>%</i>`;
  const wan = red.wan;
  $('#rtLosas').innerHTML = [
    losa('CPU', vivo ? pc(e.cpu) : '—', red.arquitectura ? esc(red.arquitectura) : '', vivo ? e.cpu : null, vivo && e.cpu >= ALTO),
    losa('Memoria', vivo ? pc(e.ramPct) : '—', e.ramTotal ? `${mem(e.ramUsada)} de ${mem(e.ramTotal)}` : '', vivo ? e.ramPct : null, vivo && e.ramPct >= ALTO),
    (red.wans && red.wans.length > 1)
      ? losa('Enlaces WAN', `${red.wans.filter(w => w.activa).length}<i>de ${red.wans.length} arriba</i>`, esc(red.wans.map(w => w.interfaz + (w.activa ? '' : ' (caído)')).join(', ')), null, red.wans.some(w => !w.activa))
      : losa('Internet', wan ? (wan.activa ? '<span style="color:#7ee07e">Arriba</span>' : 'Caído') : '—', wan ? esc(wan.interfaz) : 'Sin ruta por defecto', null, wan && !wan.activa),
    losa('Temperatura', red.temperatura != null ? `${red.temperatura}<i>°C</i>` : '—', red.voltaje != null ? `${nf.format(red.voltaje)} V` : ''),
    losa('Encendido', e.arranque ? esc(duracion(e.arranque)) : '—', e.arranque ? 'desde ' + esc(cuando(e.arranque)) : ''),
    losa(e.tipo === 'fortigate' ? 'Sesiones' : 'Conexiones', miles(red.conexiones), e.tipo === 'fortigate' ? 'activas ahora' : 'en el firewall'),
    losa('DHCP', red.dhcp == null ? '—' : miles(red.dhcp), 'equipos con IP'),
    losa('VPN', red.vpnTotal ? `${red.vpn}<i>de ${red.vpnTotal}</i>` : '0', red.vpnTotal ? 'túneles activos' : 'sin túneles')
  ].join('');

  // Latencia medida desde el router
  const lat = red.latencia || [];
  const nivelMs = (v, p) => v == null || p === 100 ? 'mal' : p > 0 || v >= 150 ? 'aviso' : v >= 60 ? 'medio' : 'ok';
  $('#rtLat').innerHTML = !vivo || !lat.length ? '' : lat.map(x => {
    const serie = rt.vivo && rt.vivo.latencia ? (rt.vivo.latencia[x.ip] || []) : [];
    const n = nivelMs(x.ms, x.perdida);
    return `<div class="losa lat ${n}"><h4>${esc(x.nombre)}${x.nombre !== x.ip && !String(x.ip).includes('|') ? ` <span class="tenue">${esc(x.ip)}</span>` : ''}</h4>
      <div class="v">${x.error ? '—' : x.ms == null ? 'Sin respuesta' : `${nf.format(x.ms < 10 ? x.ms : Math.round(x.ms))}<i>ms</i>`}</div>
      <small>${x.error ? esc(x.error) : x.perdida ? `${x.perdida} % de paquetes perdidos` : 'Sin pérdidas'}</small>${miniLat(serie)}</div>`;
  }).join('');

  // Gráfico en vivo
  const sel = interfazSel(e), it = (red.interfaces || []).find(i => i.nombre === sel);
  const serie = rt.vivo && rt.vivo.serie && sel ? (rt.vivo.serie[sel] || []) : [];
  $('#tvTitulo').innerHTML = sel ? `${esc(sel)}${it && it.comentario ? ` <span class="tenue" style="font-weight:400">${esc(it.comentario)}</span>` : ''}<small>${sel === (wan && wan.interfaz) ? 'Salida a Internet, ' : ''}últimos 6 minutos</small>` : 'Tráfico';
  $('#tvCifras').innerHTML = `<div class="bajada"><b>${bps(it && vivo ? it.rx : null)}</b><span>Bajada</span></div><div class="subida"><b>${bps(it && vivo ? it.tx : null)}</b><span>Subida</span></div>`;
  graficoTrafico($('#grafVivo'), serie.map(([t, rx, tx]) => ({ t, rx, tx })), true);

  // Lista de interfaces, primero las de más tráfico
  const l = (red.interfaces || []).filter(i => !i.deshabilitada).sort((a, b) => (b.activa - a.activa) || ((b.rx || 0) + (b.tx || 0)) - ((a.rx || 0) + (a.tx || 0))).slice(0, 8);
  $('#rtIfs').innerHTML = l.map(i => `<li data-if="${esc(i.nombre)}" class="${i.nombre === sel ? 'sel' : ''}">
      <span class="punto ${i.activa ? 'ok' : 'caido'}" aria-hidden="true"></span><strong>${esc(i.nombre)}</strong>
      <span class="tasas"><span class="b">↓ ${bps(i.rx)}</span><br><span class="s">↑ ${bps(i.tx)}</span></span>
      <small>${esc(i.comentario || TIPOS_IF[i.tipo] || i.tipo)}${i.activa ? '' : ', sin enlace'}</small></li>`).join('') || '<li class="tenue">Sin datos todavía.</li>';

  // Historial
  document.querySelectorAll('#rtRangos [data-rango]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rango === rt.rango)));
  const R = RANGOS[rt.rango];
  $('#histIf').textContent = sel || '—';
  const kt = `${e.id}|${sel}|${rt.rango}`, ht = rt.histT[kt];
  if (sel && (!ht || (ht.cargado && Date.now() - ht.cargado > 60000))) cargarTrafico(e.id, sel, rt.rango);
  const pts = ht && ht.puntos ? ht.puntos : null;
  graficoTrafico($('#grafTra'), pts || [], false, R.ms);
  if (pts && pts.length) {
    const mrx = Math.max(...pts.map(p => p.rxMax || p.rx || 0)), mtx = Math.max(...pts.map(p => p.txMax || p.tx || 0));
    const arx = pts.reduce((a, p) => a + (p.rx || 0), 0) / pts.length;
    $('#traNota').textContent = `Media de bajada ${bps(arx)}, pico ${bps(mrx)} ${R.en}. Pico de subida ${bps(mtx)}.`;
  } else $('#traNota').textContent = ht && ht.cargado ? 'Sin historial de esta interfaz en este periodo.' : 'Cargando…';
  const h0 = histEq[e.id + '|' + rt.rango], h = h0 && h0.cargado ? h0 : null;
  if (!h0 || (h && Date.now() - h.cargado > 60000)) cargarHistEq(e.id, rt.rango);
  for (const k of ['cpu', 'ram']) {
    const v = vivo ? (k === 'cpu' ? e.cpu : e.ramPct) : null;
    $(`#${k}Ahora`).innerHTML = v == null ? '<i>sin datos</i>' : `${v}<i>%</i>`;
    const ps = h ? h.puntos : [];
    const vals = ps.map(p => p[k]).filter(x => x != null);
    $(`#${k}Nota`).textContent = vals.length > 1 ? `Media de ${Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)} %, máximo ${Math.max(...vals)} % ${R.en}.` : ' ';
  }
  grafico($('#grafCpu'), h ? h.puntos : [], 'cpu', 'CPU', R.ms);
  grafico($('#grafRam'), h ? h.puntos : [], 'ram', 'Memoria', R.ms);
  const disp = $('#disponibilidad');
  if (h) {
    const cs = h.eventos.filter(x => x.tipo === 'caida'), ws = h.eventos.filter(x => x.tipo === 'wan-caida');
    const pct = h.disponibilidad >= 99.995 ? '100' : nf.format(Math.floor(h.disponibilidad * 100) / 100);
    disp.innerHTML = `<span><b>${pct} %</b> del tiempo respondiendo ${R.en}.</span>` +
      (cs.length ? `<button type="button" class="enlace" data-ver-sucesos>${plural(cs.length, 'caída', 'caídas')} del equipo: ver cuándo y cuánto duraron</button>` : '<span class="tenue">Sin caídas del equipo.</span>') +
      (ws.length ? `<button type="button" class="enlace" data-ver-sucesos>${plural(ws.length, 'caída', 'caídas')} de enlace WAN</button>` + ws.slice(-3).reverse().map(w => { const v = h.eventos.find(x => x.tipo === 'wan-vuelta' && x.t > w.t); return `<span class="caida"><span class="punto caido" aria-hidden="true"></span>WAN caído ${cuando(w.t)}, ${v ? durTxt(v.t - w.t) : 'sigue caído'}</span>`; }).join('') : '');
  }
}
const TIPOS_IF = { ether: 'Ethernet', bridge: 'Bridge', vlan: 'VLAN', wg: 'WireGuard', wlan: 'Wi‑Fi', wifi: 'Wi‑Fi', lte: 'LTE', 'pppoe-out': 'PPPoE', 'l2tp-out': 'L2TP', 'ovpn-out': 'OpenVPN', bond: 'Bonding', 'gre-tunnel': 'GRE', eoip: 'EoIP', veth: 'Contenedor' };

async function cargarTrafico(id, interfaz, rango) {
  const k = `${id}|${interfaz}|${rango}`;
  if (rt.histT[k] && rt.histT[k].pidiendo) return;
  rt.histT[k] = Object.assign(rt.histT[k] || {}, { pidiendo: true });
  try { const d = await api(`/api/equipos/${id}/trafico?rango=${rango}&interfaz=${encodeURIComponent(interfaz)}`); rt.histT[k] = { puntos: arr(d.puntos), cargado: Date.now() }; }
  catch (e) { rt.histT[k] = { puntos: [], cargado: Date.now() }; }
  if (rt.id === id && rt.pestana === 'resumen') { const e = equipo(id); if (e) resumenRouter(e); }
}

// Gráfico de tráfico: bajada como área, subida como línea; escala automática
function graficoTrafico(el, pts, enVivo, span) {
  pts = pts.filter(p => p.rx != null || p.tx != null);
  if (pts.length < 2) { el.innerHTML = `<div class="sin-datos">${enVivo ? 'Reuniendo datos en vivo… el gráfico aparece en unos segundos.' : 'Sin datos de este periodo.'}</div>`; return; }
  const W = Math.max(260, el.clientWidth), H = el.clientHeight || 220;
  const m = { i: 62, d: 10, a: 10, b: 22 };
  const t0 = pts[0].t, t1 = enVivo ? Math.max(pts[pts.length - 1].t, t0 + 1) : pts[pts.length - 1].t;
  const tIni = enVivo ? Math.max(t1 - 6 * 60000, t0) : t0;
  const maxV = Math.max(1000, ...pts.map(p => Math.max(p.rx || 0, p.tx || 0)));
  // Escala "redonda"
  const pasos = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]; let top = maxV;
  const mag = Math.pow(10, Math.floor(Math.log10(maxV)));
  for (const s of pasos) if (s * mag >= maxV) { top = s * mag; break; }
  const x = t => m.i + (t - tIni) / (t1 - tIni) * (W - m.i - m.d);
  const y = v => m.a + (1 - v / top) * (H - m.a - m.b);
  const salto = enVivo ? 45000 : Math.max(10 * 60000, (t1 - t0) / pts.length * 4);
  const camino = k => { let d = ''; pts.forEach((p, i) => { if (p[k] == null || p.t < tIni) return; d += `${d && p.t - pts[i - 1].t < salto ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`; }); return d; };
  const dRx = camino('rx'), dTx = camino('tx');
  const area = dRx.split('M').filter(Boolean).map(seg => { const ps = seg.split('L'); const xi = ps[0].split(',')[0], xf = ps[ps.length - 1].split(',')[0]; return `M${xi},${y(0)}L${seg}L${xf},${y(0)}Z`; }).join('');
  const rej = [0, .5, 1].map(f => `<line class="rejilla" x1="${m.i}" x2="${W - m.d}" y1="${y(top * f)}" y2="${y(top * f)}"/><text class="eje" x="${m.i - 8}" y="${y(top * f) + 4}" text-anchor="end">${f ? bps(top * f) : '0'}</text>`).join('');
  const etq = t => enVivo ? new Date(t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : (span > 36 * 3600e3 ? new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' }) : hora(t));
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tráfico: bajada actual ${bps(pts[pts.length - 1].rx)}, subida ${bps(pts[pts.length - 1].tx)}">
    ${rej}<path class="a-bajada" d="${area}"/><path class="l-bajada" d="${dRx}"/><path class="l-subida" d="${dTx}"/>
    <text class="eje" x="${m.i}" y="${H - 4}">${etq(tIni)}</text><text class="eje" x="${W - m.d}" y="${H - 4}" text-anchor="end">${enVivo ? 'ahora' : etq(t1)}</text>
    <g class="hover" visibility="hidden"><line class="cruz" y1="${m.a}" y2="${y(0)}"/><circle class="p-bajada" r="4"/><circle class="p-subida" r="4"/></g>
    <rect class="captura" x="${m.i}" y="0" width="${W - m.i - m.d}" height="${H}" fill="transparent"/></svg><div class="globo" hidden></div>`;
  const svg = el.querySelector('svg'), g = svg.querySelector('.hover'), globo = el.querySelector('.globo');
  const mover = ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
    let mejor = pts[0], dist = Infinity;
    for (const p of pts) { const dd = Math.abs(x(p.t) - px); if (dd < dist) { dist = dd; mejor = p; } }
    const cx = x(mejor.t);
    g.setAttribute('visibility', 'visible');
    g.querySelector('line').setAttribute('x1', cx); g.querySelector('line').setAttribute('x2', cx);
    const [cb, cs] = g.querySelectorAll('circle');
    cb.setAttribute('cx', cx); cb.setAttribute('cy', y(mejor.rx || 0)); cs.setAttribute('cx', cx); cs.setAttribute('cy', y(mejor.tx || 0));
    globo.hidden = false;
    globo.innerHTML = `${enVivo ? new Date(mejor.t).toLocaleTimeString('es') : new Date(mejor.t).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}&nbsp;&nbsp;↓ <b class="bajada">${bps(mejor.rx)}</b>&nbsp; ↑ <b class="subida">${bps(mejor.tx)}</b>`;
    globo.style.left = (cx * r.width / W) + 'px'; globo.style.top = (y(Math.max(mejor.rx || 0, mejor.tx || 0)) * r.height / H) + 'px';
    globo.classList.toggle('abajo', y(Math.max(mejor.rx || 0, mejor.tx || 0)) < 46);
  };
  const cap = svg.querySelector('.captura');
  cap.addEventListener('mousemove', mover);
  cap.addEventListener('mouseleave', () => { g.setAttribute('visibility', 'hidden'); globo.hidden = true; });
}

function mini(serie) {
  if (!serie || serie.length < 2) return '<svg class="mini" aria-hidden="true"></svg>';
  const W = 110, H = 26, t0 = serie[0][0], t1 = serie[serie.length - 1][0], top = Math.max(1000, ...serie.map(s => Math.max(s[1], s[2])));
  const x = t => (t - t0) / Math.max(1, t1 - t0) * W, y = v => 2 + (1 - v / top) * (H - 4);
  const d = k => serie.map((s, i) => `${i ? 'L' : 'M'}${x(s[0]).toFixed(1)},${y(s[k]).toFixed(1)}`).join('');
  return `<svg class="mini" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="a-bajada" d="${d(1)}L${W},${H}L0,${H}Z"/><path class="l-bajada" d="${d(1)}" vector-effect="non-scaling-stroke"/><path class="l-subida" d="${d(2)}" vector-effect="non-scaling-stroke"/></svg>`;
}

// Minigráfico de latencia de la última hora (los huecos son pings sin respuesta)
function miniLat(serie) {
  const pts = serie.filter(p => p[1] != null);
  if (pts.length < 2) return '<svg class="mini-lat" aria-hidden="true"></svg>';
  const W = 160, H = 30, t0 = serie[0][0], t1 = serie[serie.length - 1][0];
  const top = Math.max(20, ...pts.map(p => p[1])) * 1.15;
  const x = t => (t - t0) / Math.max(1, t1 - t0) * W, y = v => H - 2 - v / top * (H - 4);
  let d = '';
  serie.forEach((p, i) => { if (p[1] == null) return; d += `${d && serie[i - 1] && serie[i - 1][1] != null ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`; });
  const caidas = serie.filter(p => p[1] == null || p[2] > 0).map(p => `<line x1="${x(p[0]).toFixed(1)}" x2="${x(p[0]).toFixed(1)}" y1="0" y2="${H}" class="perdida"/>`).join('');
  return `<svg class="mini-lat" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${caidas}<path d="${d}" vector-effect="non-scaling-stroke"/></svg>`;
}

function tablaInterfaces(e) {
  const red = e.red || {}, l = red.interfaces || [], wan = red.wan && red.wan.interfaz;
  const t = $('#rtTablaIf');
  if (!l.length) { t.innerHTML = '<div class="vacio">Sin datos de interfaces todavía.</div>'; return; }
  const ord = [...l].sort((a, b) => (a.deshabilitada - b.deshabilitada) || (b.activa - a.activa) || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
  t.innerHTML = `<table class="tabla-rt"><thead><tr><th>Interfaz</th><th>Tipo</th><th>Estado</th><th class="num">Bajada</th><th class="num">Subida</th><th>Últimos 6 min</th></tr></thead><tbody>
    ${ord.map(i => `<tr class="clic" data-if="${esc(i.nombre)}">
      <td><span class="usr">${esc(i.nombre)}</span>${i.nombre === wan ? ' <span class="etq">WAN</span>' : ''}${i.comentario ? `<span class="dom">${esc(i.comentario)}</span>` : ''}</td>
      <td class="tenue">${esc(TIPOS_IF[i.tipo] || i.tipo)}</td>
      <td>${i.deshabilitada ? '<span class="etq">Deshabilitada</span>' : i.activa ? '<span class="etq ok">Con enlace</span>' : '<span class="etq mal">Sin enlace</span>'}</td>
      <td class="num tasas"><span class="b">${bps(i.rx)}</span></td><td class="num tasas"><span class="s">${bps(i.tx)}</span></td>
      <td>${mini(rt.vivo && rt.vivo.serie[i.nombre])}</td></tr>`).join('')}</tbody></table>`;
  t.onclick = ev => { const tr = ev.target.closest('[data-if]'); if (tr) { rt.sel = tr.dataset.if; rt.pestana = 'resumen'; pintarCuerpoRt(true); window.scrollTo({ top: 0, behavior: 'smooth' }); } };
}

/* ---------------- Secciones bajo demanda ---------------- */
function pintarSeccion() {
  const el = $('#rtSeccion'); if (!el) return;
  const s = rt.seccion[rt.pestana];
  if (!s) { el.innerHTML = gatoCargando(equipo(rt.id) && equipo(rt.id).tipo === 'fortigate' ? 'Preguntándole al FortiGate…' : 'Preguntándole al router…'); return; }
  if (s.error) { el.innerHTML = gatoError(esc(s.error)); return; }
  const activo = document.activeElement && document.activeElement.id === 'rtFiltro';
  const pos = activo ? document.activeElement.selectionStart : null;
  const f = rt.filtro.trim().toLowerCase(), coincide = (...v) => !f || v.some(x => String(x || '').toLowerCase().includes(f));
  const buscador = ph => `<label class="buscar">${ICO.lupa}<span class="sr">${ph}</span><input type="search" id="rtFiltro" placeholder="${ph}" value="${esc(rt.filtro)}"></label>`;
  const d = s.datos;
  let h = '';
  if (rt.pestana === 'dhcp') {
    const l = d.filter(x => coincide(x.nombre, x.ip, x.mac, x.comentario));
    const act = d.filter(x => x.estado === 'bound').length;
    h = `<div class="sub-cab"><h3>Concesiones DHCP <span>${act} con IP ahora, ${d.length} en total</span></h3>${buscador('Buscar nombre, IP o MAC')}</div>
      <section class="hoja desliza"><table class="tabla-rt"><thead><tr><th>Equipo</th><th>IP</th><th>MAC</th><th>Estado</th><th>Servidor</th><th>Visto hace</th></tr></thead><tbody>
      ${l.sort((a, b) => (a.estado === 'bound' ? 0 : 1) - (b.estado === 'bound' ? 0 : 1) || a.ip.localeCompare(b.ip, 'es', { numeric: true })).map(x => `<tr>
        <td><span class="usr">${x.nombre ? esc(x.nombre) : '<span class="tenue">Sin nombre</span>'}</span>${x.comentario ? `<span class="dom">${esc(x.comentario)}</span>` : ''}</td>
        <td>${esc(x.ip)}</td><td class="tenue">${esc(x.mac)}</td>
        <td>${x.estado === 'bound' ? '<span class="etq ok">Conectado</span>' : `<span class="etq">${esc(x.estado || '—')}</span>`}${x.dinamica ? '' : ' <span class="etq">Fija</span>'}</td>
        <td class="tenue">${esc(x.servidor)}</td><td>${hace(x.visto)}</td></tr>`).join('') || '<tr><td colspan="6" class="tenue">Nada coincide.</td></tr>'}</tbody></table></section>`;
  } else if (rt.pestana === 'wifi') {
    if (d.noDisponible) h = '<div class="hoja vacio gato-vacio">' + gatoSVG('programando') + '<strong>Este router no tiene Wi‑Fi</strong>O no se puede leer su tabla de clientes inalámbricos.</div>';
    else {
      const l = d.lista.filter(x => coincide(x.mac, x.interfaz, x.ssid, x.nombre, x.ip));
      const redes = [...new Set(d.lista.map(x => x.ssid || ''))].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b));
      const fila = x => { const q = x.señal == null ? null : Math.max(0, Math.min(100, Math.round((x.señal + 90) / 50 * 100)));
        return `<tr><td><span class="usr">${x.nombre ? esc(x.nombre) : '<span class="tenue">Sin nombre</span>'}</span><span class="dom">${esc(x.mac)}</span></td>
          <td>${x.ip ? esc(x.ip) : '<span class="tenue">—</span>'}</td><td>${esc(x.interfaz)}</td>
          <td>${x.señal == null ? '—' : `<span class="senal">${x.señal} dBm<span class="carril ${q < 35 ? 'n-alerta' : q < 55 ? 'n-aviso' : ''}"><span style="width:${q}%"></span></span></span>`}</td>
          <td>${hace(x.tiempo)}</td><td class="tenue">${x.tx ? bps(x.tx) : '—'}</td></tr>`; };
      h = `<div class="sub-cab"><h3>Clientes Wi‑Fi <span>${d.lista.length} conectados en ${plural(redes.length, 'red', 'redes')}</span></h3>${buscador('Buscar equipo, IP o MAC')}</div>
        <div class="segmentos" role="group" aria-label="Red Wi-Fi" id="rtRedes" style="margin-bottom:14px">
          <button type="button" data-red="" aria-pressed="${!rt.red}">Todas</button>${redes.map(r => `<button type="button" data-red="${esc(r || '-')}" aria-pressed="${rt.red === (r || '-')}">${r ? esc(r) : 'Sin nombre'} <span class="cuenta">${d.lista.filter(x => (x.ssid || '') === r).length}</span></button>`).join('')}
        </div>
        ${redes.filter(r => !rt.red || rt.red === (r || '-')).map(r => {
          const g = l.filter(x => (x.ssid || '') === r).sort((a, b) => (b.señal || -99) - (a.señal || -99));
          if (!g.length) return '';
          return `<div class="sub-cab"><h3>${r ? esc(r) : 'Red sin nombre'} <span>${plural(g.length, 'equipo', 'equipos')}</span></h3></div>
            <section class="hoja desliza" style="margin-bottom:8px"><table class="tabla-rt"><thead><tr><th>Equipo</th><th>IP</th><th>Interfaz</th><th>Señal</th><th>Conectado</th><th>Velocidad</th></tr></thead><tbody>${g.map(fila).join('')}</tbody></table></section>`;
        }).join('') || '<div class="hoja vacio">Nada coincide.</div>'}`;
    }
  } else if (rt.pestana === 'vpn') {
    const wg = d.wireguard || [], ppp = d.ppp || [], ips = d.ipsec || [];
    if (!wg.length && !ppp.length && !ips.length) h = '<div class="hoja vacio gato-vacio">' + gatoSVG('programando') + '<strong>Sin túneles VPN</strong>Este router no tiene WireGuard, PPP ni IPsec configurados, o no hay ninguno conectado.</div>';
    if (wg.length) h += `<div class="sub-cab"><h3>WireGuard <span>${wg.filter(x => !x.deshabilitado && x.saludo != null && x.saludo < 180).length} de ${wg.length} conectados</span></h3></div>
      <section class="hoja desliza"><table class="tabla-rt"><thead><tr><th>Par</th><th>Estado</th><th>Último saludo</th><th>Desde</th><th>Redes</th><th class="num">Recibido</th><th class="num">Enviado</th></tr></thead><tbody>
      ${wg.map(x => { const ok = !x.deshabilitado && x.saludo != null && x.saludo < 180;
        return `<tr><td><span class="usr">${esc(x.nombre)}</span><span class="dom">${esc(x.interfaz)}</span></td><td>${x.deshabilitado ? '<span class="etq">Deshabilitado</span>' : ok ? '<span class="etq ok">Conectado</span>' : '<span class="etq mal">Sin saludo</span>'}</td>
        <td>${x.saludo == null ? 'Nunca' : 'hace ' + hace(x.saludo)}</td><td class="tenue">${esc(x.extremo || '—')}</td><td class="tenue">${esc(x.permitidas)}</td><td class="num">${bytes(x.rx)}</td><td class="num">${bytes(x.tx)}</td></tr>`; }).join('')}</tbody></table></section>`;
    if (ppp.length) h += `<div class="sub-cab"><h3>Usuarios VPN conectados (PPP) <span>${ppp.length}</span></h3></div>
      <section class="hoja desliza"><table class="tabla-rt"><thead><tr><th>Usuario</th><th>Tipo</th><th>Desde</th><th>IP asignada</th><th>Conectado</th></tr></thead><tbody>
      ${ppp.map(x => `<tr><td><span class="usr">${esc(x.nombre)}</span></td><td>${esc(x.servicio.toUpperCase())}</td><td class="tenue">${esc(x.origen)}</td><td>${esc(x.ip)}</td><td>${hace(x.tiempo)}</td></tr>`).join('')}</tbody></table></section>`;
    if (ips.length) h += `<div class="sub-cab"><h3>IPsec <span>${ips.length}</span></h3></div>
      <section class="hoja desliza"><table class="tabla-rt"><thead><tr><th>Extremo</th><th>Estado</th><th>Conectado</th></tr></thead><tbody>
      ${ips.map(x => `<tr><td>${esc(x.remoto)}</td><td>${x.estado === 'established' ? '<span class="etq ok">Establecido</span>' : `<span class="etq">${esc(x.estado)}</span>`}</td><td>${hace(x.tiempo)}</td></tr>`).join('')}</tbody></table></section>`;
  } else if (rt.pestana === 'firewall') {
    const l = d.filter(x => coincide(x.cadena, x.accion, x.comentario, x.detalle));
    const ACC = { accept: ['ok', 'Aceptar'], drop: ['mal', 'Descartar'], reject: ['mal', 'Rechazar'], 'fasttrack-connection': ['', 'Fasttrack'], jump: ['', 'Saltar'], log: ['aviso', 'Registrar'], return: ['', 'Volver'], passthrough: ['', 'Continuar'] };
    h = `<div class="sub-cab"><h3>Reglas del firewall (filter) <span>${d.length}</span></h3>${buscador('Buscar en las reglas')}</div>
      <section class="hoja desliza"><table class="tabla-rt"><thead><tr><th>#</th><th>Cadena</th><th>Acción</th><th>Regla</th><th class="num">Paquetes</th><th class="num">Tráfico</th></tr></thead><tbody>
      ${l.map(x => { const [c, t] = ACC[x.accion] || ['', x.accion]; return `<tr style="${x.deshabilitada ? 'opacity:.5' : ''}"><td class="tenue">${d.indexOf(x)}</td><td>${esc(x.cadena)}</td><td><span class="etq ${c}">${esc(t)}</span></td>
        <td style="white-space:normal;min-width:260px">${x.comentario ? `<span class="usr" style="font-weight:600">${esc(x.comentario)}</span><br>` : ''}<span class="tenue">${esc(x.detalle || 'Todo')}</span>${x.deshabilitada ? ' <span class="etq">Deshabilitada</span>' : ''}</td>
        <td class="num">${miles(x.paquetes)}</td><td class="num">${bytes(x.bytes)}</td></tr>`; }).join('') || '<tr><td colspan="6" class="tenue">Nada coincide.</td></tr>'}</tbody></table></section>`;
  } else if (rt.pestana === 'registro') {
    const l = d.filter(x => coincide(x.temas, x.mensaje));
    h = `<div class="sub-cab"><h3>Registro del router <span>últimos ${d.length}</span></h3>${buscador('Buscar en el registro')}</div>
      <section class="hoja desliza"><table class="tabla-rt registro-rt"><tbody>
      ${l.map(x => { const err = /error|critical|warning/.test(x.temas); return `<tr class="${err ? 'error' : ''}"><td>${esc(x.hora)}</td><td style="width:170px">${String(x.temas).split(',').map(t => `<span class="etq ${/error|critical/.test(t) ? 'mal' : /warning/.test(t) ? 'aviso' : ''}">${esc(t)}</span>`).join(' ')}</td><td>${esc(x.mensaje)}</td></tr>`; }).join('') || '<tr><td class="tenue">Nada coincide.</td></tr>'}</tbody></table></section>`;
  }
  if (!h && rt.pestana === 'conexiones') h = seccionConexiones(d, coincide);
  else if (!h && TABLAS_RT[rt.pestana]) h = `<div class="sub-cab" style="justify-content:flex-end">${buscador('Buscar')}</div>` + seccionGenerica(rt.pestana, d, coincide);
  el.innerHTML = h;
  const rr = $('#rtRedes'); if (rr) rr.onclick = ev => { const b = ev.target.closest('[data-red]'); if (b) { rt.red = b.dataset.red || null; pintarSeccion(); } };
  const inp = $('#rtFiltro');
  if (inp) {
    inp.oninput = ev => { rt.filtro = ev.target.value; pintarSeccion(); };
    if (activo) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (e) { } }
  }
}

/* ---------------- Routers en la página del cliente ---------------- */
const latCf = red => { const c = (red.latencia || [])[0]; return c && c.ms != null ? `, ${Math.round(c.ms)} ms a ${esc(c.nombre)}` : c && c.ip && !c.error ? ', sin respuesta a Internet' : ''; };
function filaRouter(e) {
  const red = e.red || {}, vivo = e.estado === 'ok' || e.estado === 'sinMetricas', w = red.wan;
  let sub = e.estado === 'caido' ? (e.errorConexion || `Sin respuesta desde ${cuando(e.ultimo)}`) : e.estado === 'pendiente' ? (e.errorConexion || 'Conectando…') : (red.modelo ? `${red.modelo}, ${e.tipo === 'fortigate' ? 'FortiOS' : 'RouterOS'} ${red.version}` : e.so);
  return `<button type="button" class="fila rt ${esc(e.estado)}" data-eq="${e.id}" aria-label="${esc(e.nombre)}. Abrir">
    <span class="f-nombre"><span class="punto ${esc(e.estado)}" aria-hidden="true"></span><span><strong>${esc(e.nombre)}</strong><small>${esc(sub)}</small></span></span>
    ${vivo ? medidor(e.cpu, '', 'CPU') + medidor(e.ramPct, '', 'Memoria') : '<span></span><span></span>'}
    <span class="f-wan ${vivo && w && !w.activa ? 'caida' : ''}" data-etq="Internet">${!vivo || !w ? '<span class="tenue">—</span>' : (red.wans && red.wans.length > 1 && red.wans.some(x => !x.activa)) ? `<b>${esc(red.wans.filter(x => !x.activa).map(x => x.interfaz).join(', '))} caído</b><small>${red.wans.filter(x => x.activa).length} de ${red.wans.length} enlaces arriba</small>` : w.activa ? (w.rx == null ? `<span class="tenue">Midiendo…</span><small>${esc(w.interfaz)}</small>` : `<span><span class="b">↓ ${bps(w.rx)}</span>&nbsp;&nbsp;<span class="s">↑ ${bps(w.tx)}</span></span><small>${esc(w.interfaz)}${latCf(red)}</small>`) : `<b>WAN caído</b><small>${esc(w.interfaz)}</small>`}</span>
    <span class="f-extra f-ses" data-etq="Equipos y VPN">${vivo ? `<span class="valor">${red.dhcp == null ? '—' : red.dhcp}</span><small>con IP${red.vpnTotal ? `, VPN ${red.vpn}/${red.vpnTotal}` : ''}</small>` : ''}</span>
    <span class="f-up">${vivo ? esc(duracion(e.arranque)) : ''}</span>
    ${ICO.flecha}</button>`;
}

/* ---------------- Alta y edición de routers ---------------- */
async function dialogoRouter(clienteId, id) {
  let cfg = null, e = id ? equipo(id) : null;
  if (id) { try { cfg = (await api(`/api/routers/${id}/vivo`)).config; } catch (x) { if (!x.login) aviso(x.message, true); return; } }
  const demo = cfg && cfg.demo;
  let confirmar = false;
  const dlg = libre(`<form novalidate><h3>${id ? 'Editar router' : 'Agregar un router MikroTik'}</h3>
    ${!id ? `<p>NodeCat se conecta al router por su API y <b>solo lee</b>: no puede cambiar nada. Funciona con RouterOS 6 y 7.</p>
    <details class="clave" style="margin-bottom:16px"><summary>Prepara el router (una sola vez)</summary>
      <p>En la terminal del router, crea un usuario de solo lectura y activa la API. Cambia la contraseña y la IP de NodeCat:</p>
      <code class="codigo pasos-cmd">/user group add name=nodecat policy=read,api,test,!write,!policy,!sensitive,!reboot,!ftp,!ssh,!telnet,!winbox,!web,!sniff,!romon
/user add name=nodecat group=nodecat password=UNA-CLAVE-LARGA
/ip service set api disabled=no address=IP-DE-NODECAT/32</code>
      <p><b>Si llegas al router por VPN o red interna</b>, usa la API normal (puerto 8728).<br><b>Si solo tiene IP pública</b>, usa API‑SSL (puerto 8729) y deja entrar solo a tu IP pública:</p>
      <code class="codigo pasos-cmd">/certificate add name=api common-name=api days-valid=3650
/certificate sign api
/ip service set api-ssl disabled=no certificate=api address=TU-IP-PUBLICA/32</code>
    </details>` : ''}
    ${demo ? '<div class="msg atencion">Router del modo demo: solo se puede cambiar el nombre.</div>' : ''}
    <label class="campo">Nombre<input name="nombre" maxlength="60" value="${esc(e ? e.nombre : '')}" placeholder="Router principal" required></label>
    ${demo ? '' : `<div class="tres">
      <label class="campo">IP o nombre<input name="host" spellcheck="false" value="${esc(cfg ? cfg.host : '')}" placeholder="10.20.0.1" required></label>
      <label class="campo">Usuario<input name="usuario" spellcheck="false" autocomplete="off" value="${esc(cfg ? cfg.usuario : 'nodecat')}" required></label>
      <label class="campo">Puerto<input name="puerto" type="number" min="1" max="65535" value="${cfg ? cfg.puerto : 8728}"></label>
    </div>
    <label class="campo">Contraseña<input name="clave" type="password" autocomplete="new-password" placeholder="${cfg && cfg.claveGuardada ? 'Guardada. Déjala vacía para conservarla.' : ''}"></label>
    <label class="interruptor" style="margin-bottom:14px"><input type="checkbox" name="ssl" ${cfg && cfg.ssl ? 'checked' : ''}><span><b>Usar API‑SSL (cifrado)</b><small>Obligatorio si te conectas por Internet. El puerto pasa a 8729.</small></span></label>
    <div class="dos">
      <label class="campo">Interfaz WAN <span class="ayuda-campo">Opcional. Vacía: la de la ruta por defecto.</span><input name="wan" spellcheck="false" value="${esc(cfg ? cfg.wan : '')}" placeholder="ether1, pppoe-out1…"></label>
      <label class="campo">Ping adicional <span class="ayuda-campo">Opcional. Además de Cloudflare, Google y la puerta de enlace.</span><input name="ping" spellcheck="false" value="${esc(cfg ? cfg.ping : '')}" placeholder="10.0.0.1, oficina.ejemplo.com"></label>
    </div>`}
    <div class="msg" role="status" hidden></div>
    <div class="pie">${id ? '<button class="btn" type="button" data-quitar style="margin-right:auto">Quitar de NodeCat</button>' : ''}${demo ? '' : '<button class="btn" type="button" data-probar>Probar conexión</button>'}<button class="btn" type="button" data-cerrar>Cancelar</button><button class="btn prim" type="submit">${id ? 'Guardar' : 'Agregar router'}</button></div></form>`, true);
  const f = dlg.querySelector('form'), m = f.querySelector('.msg');
  const msg = (t, tipo) => {
    if (!t || tipo !== 'bien') return gatoDice(m, t);
    m.className = 'msg bien'; m.textContent = t; m.hidden = false; caraDeGato('reparando', 1);
  };
  const datos = () => demo ? { nombre: f.nombre.value } : { nombre: f.nombre.value, host: f.host.value, usuario: f.usuario.value, puerto: +f.puerto.value, clave: f.clave.value, ssl: f.ssl.checked, wan: f.wan.value, ping: f.ping.value, id };
  if (!demo) f.ssl.onchange = () => { if (f.ssl.checked && +f.puerto.value === 8728) f.puerto.value = 8729; if (!f.ssl.checked && +f.puerto.value === 8729) f.puerto.value = 8728; };
  f.nombre.focus();
  const bp = f.querySelector('[data-probar]');
  if (bp) bp.onclick = ev => ocupado(ev.currentTarget, 'Probando…', async () => {
    msg('');
    try { const r = await enviar('/api/routers/probar', 'POST', datos()); msg(`Conectado con “${r.identidad}”: ${r.modelo}, RouterOS ${r.version}.`, 'bien'); if (!f.nombre.value.trim()) f.nombre.value = r.identidad || ''; }
    catch (x) { if (!x.login) msg(x.message); }
  });
  f.onsubmit = async ev => {
    ev.preventDefault();
    const b = f.querySelector('[type=submit]');
    await ocupado(b, id ? 'Guardando…' : 'Agregando…', async () => {
      try {
        if (id) { await enviar(`/api/routers/${id}`, 'PUT', datos()); dlg.close(); aviso('Router guardado.'); montada = null; await cargar(true); }
        else { const r = await enviar(`/api/clientes/${clienteId}/routers`, 'POST', datos()); dlg.close(); aviso('Router agregado. Conectando…'); await cargar(true); location.hash = '#/e/' + r.id; }
      } catch (x) { if (!x.login) msg(x.message); }
    });
  };
  const bq = f.querySelector('[data-quitar]');
  if (bq) bq.onclick = async () => {
    if (!confirmar) { confirmar = true; bq.className = 'btn peligro'; bq.textContent = '¿Seguro? Se borra su historial'; return; }
    try { await enviar(`/api/equipos/${id}`, 'DELETE'); dlg.close(); aviso('Router quitado de NodeCat.'); location.hash = '#/c/' + clienteId; await cargar(true); }
    catch (x) { if (!x.login) msg(x.message); }
  };
}

/* ======================================================================
   Secciones genéricas: tablas tal como las da RouterOS, con formato y búsqueda
   ====================================================================== */
const SI = v => v === 'true' || v === 'yes';
const FMT = {
  t: v => v == null || v === '' ? '<span class="tenue">—</span>' : esc(v),
  mono: v => v == null || v === '' ? '<span class="tenue">—</span>' : `<span class="mono">${esc(v)}</span>`,
  si: v => SI(v) ? 'Sí' : '<span class="tenue">No</span>',
  num: v => v == null || v === '' ? '—' : miles(v),
  bytes: v => v == null || v === '' ? '—' : bytes(Number(v)),
  bps: v => v == null || v === '' ? '—' : bps(Number(v)),
  par: (v, f) => { if (v == null || v === '') return '—'; const [a, b] = String(v).split('/'); return `<span class="tasas"><span class="b">↑ ${f(Number(a))}</span> <span class="s">↓ ${f(Number(b))}</span></span>`; },
  dur: v => v == null || v === '' ? '—' : esc(hace(segundos2(v))),
  estado: (v, f, fila) => SI(fila.disabled) ? '<span class="etq">Deshabilitado</span>' : SI(fila.invalid) ? '<span class="etq mal">Inválido</span>'
    : fila.running != null ? (SI(fila.running) ? '<span class="etq ok">Activo</span>' : '<span class="etq mal">Sin enlace</span>')
    : fila.active != null ? (SI(fila.active) ? '<span class="etq ok">Activa</span>' : '<span class="etq">Inactiva</span>') : '<span class="etq ok">Activo</span>'
};
const segundos2 = t => { if (/^\d+$/.test(String(t))) return Number(t); let s = 0; for (const [, n, u] of String(t).matchAll(/(\d+)(w|d|h|m|s)/g)) s += Number(n) * ({ w: 604800, d: 86400, h: 3600, m: 60, s: 1 })[u]; return s; };
const C = (campo, etiqueta, fmt = 't', extra = {}) => ({ campo, etiqueta, fmt, ...extra });
const ESTADO = C('disabled', 'Estado', 'estado');
const TABLAS_RT = {
  ip: [{ clave: 'direcciones', cols: [C('address', 'Dirección', 'mono'), C('network', 'Red', 'mono'), C('interface', 'Interfaz'), C('dynamic', 'Dinámica', 'si'), ESTADO, C('comment', 'Comentario')] }],
  rutas: [{ clave: 'rutas', cols: [C('dst-address', 'Destino', 'mono'), C('gateway', 'Puerta de enlace', 'mono'), C('immediate-gw', 'Salida', 'mono', { alt: 'gateway-status' }), C('distance', 'Distancia', 'num'), C('routing-table', 'Tabla', 't', { alt: 'routing-mark' }), C('dynamic', 'Dinámica', 'si'), C('active', 'Estado', 'estado'), C('comment', 'Comentario')] }],
  arp: [{ clave: 'arp', cols: [C('address', 'IP', 'mono'), C('mac-address', 'MAC', 'mono'), C('interface', 'Interfaz'), C('status', 'Estado'), C('dynamic', 'Dinámica', 'si'), C('comment', 'Comentario')] }],
  dns: [{ clave: 'dns', titulo: 'Configuración', kv: { servers: 'Servidores', 'dynamic-servers': 'Servidores dinámicos', 'allow-remote-requests': ['Responde a la red', 'si'], 'cache-size': 'Caché', 'cache-used': 'Caché usada', 'cache-max-ttl': 'TTL máximo', 'use-doh-server': 'DNS sobre HTTPS' } },
    { clave: 'estaticos', titulo: 'Entradas estáticas', cols: [C('name', 'Nombre', 'mono'), C('type', 'Tipo'), C('address', 'Dirección', 'mono', { alt: 'cname' }), C('ttl', 'TTL'), ESTADO, C('comment', 'Comentario')] }],
  bridges: [{ clave: 'bridges', titulo: 'Bridges', cols: [C('name', 'Bridge'), C('protocol-mode', 'Protocolo'), C('vlan-filtering', 'Filtrado VLAN', 'si'), ESTADO, C('comment', 'Comentario')] },
    { clave: 'puertos', titulo: 'Puertos', cols: [C('interface', 'Interfaz'), C('bridge', 'Bridge'), C('pvid', 'PVID'), C('hw', 'Por hardware', 'si'), C('status', 'Estado'), C('comment', 'Comentario')] },
    { clave: 'vlans', titulo: 'VLAN', cols: [C('name', 'Nombre'), C('vlan-id', 'ID'), C('interface', 'Sobre'), ESTADO, C('comment', 'Comentario')] }],
  vecinos: [{ clave: 'vecinos', cols: [C('identity', 'Equipo'), C('address', 'IP', 'mono'), C('mac-address', 'MAC', 'mono'), C('interface', 'Visto por'), C('platform', 'Plataforma'), C('board', 'Modelo'), C('version', 'Versión'), C('uptime', 'Encendido', 'dur')] }],
  redeswifi: [{ clave: 'wifi', cols: [C('name', 'Interfaz'), C('configuration.ssid', 'Red (SSID)'), C('configuration.mode', 'Modo'), C('channel.band', 'Banda'), C('channel.frequency', 'Frecuencia'), C('security.authentication-types', 'Seguridad'), C('master-interface', 'Principal'), ESTADO] },
    { clave: 'wireless', cols: [C('name', 'Interfaz'), C('ssid', 'Red (SSID)'), C('mode', 'Modo'), C('band', 'Banda'), C('frequency', 'Frecuencia'), C('security-profile', 'Seguridad'), C('master-interface', 'Principal'), ESTADO] }],
  capsman: [{ clave: 'caps7', cols: [C('identity', 'Punto de acceso'), C('address', 'Dirección', 'mono'), C('board', 'Modelo'), C('version', 'Versión'), C('state', 'Estado')] },
    { clave: 'caps6', cols: [C('identity', 'Punto de acceso'), C('address', 'Dirección', 'mono'), C('board', 'Modelo'), C('version', 'Versión'), C('state', 'Estado')] }],
  dhcpserv: [{ clave: 'servidores', titulo: 'Servidores', cols: [C('name', 'Nombre'), C('interface', 'Interfaz'), C('address-pool', 'Pool'), C('lease-time', 'Concesión', 'dur'), ESTADO] },
    { clave: 'redes', titulo: 'Redes', cols: [C('address', 'Red', 'mono'), C('gateway', 'Puerta de enlace', 'mono'), C('dns-server', 'DNS', 'mono'), C('domain', 'Dominio'), C('comment', 'Comentario')] }],
  dhcpcli: [{ clave: 'clientes', cols: [C('interface', 'Interfaz'), C('status', 'Estado'), C('address', 'IP obtenida', 'mono'), C('gateway', 'Puerta de enlace', 'mono'), C('primary-dns', 'DNS', 'mono'), C('expires-after', 'Caduca en', 'dur'), C('comment', 'Comentario')] }],
  pools: [{ clave: 'pools', titulo: 'Pools', cols: [C('name', 'Nombre'), C('ranges', 'Rangos', 'mono'), C('next-pool', 'Siguiente'), C('comment', 'Comentario')] },
    { clave: 'usados', titulo: 'Direcciones en uso', cols: [C('pool', 'Pool'), C('address', 'IP', 'mono'), C('owner', 'Quién'), C('info', 'Detalle', 'mono')] }],
  wgif: [{ clave: 'interfaces', cols: [C('name', 'Interfaz'), C('listen-port', 'Puerto'), C('mtu', 'MTU'), ESTADO, C('comment', 'Comentario')] }],
  tuneles: ['eoip', 'gre', 'ipip', 'l2tp', 'sstp', 'ovpn'].map(k => ({ clave: k, titulo: { eoip: 'EoIP', gre: 'GRE', ipip: 'IPIP', l2tp: 'Clientes L2TP', sstp: 'Clientes SSTP', ovpn: 'Clientes OpenVPN' }[k],
    cols: [C('name', 'Nombre'), C('local-address', 'Local', 'mono'), C('remote-address', 'Remoto', 'mono', { alt: 'connect-to' }), C('user', 'Usuario'), ESTADO, C('comment', 'Comentario')] })),
  colas: [{ clave: 'simples', titulo: 'Colas simples', cols: [C('name', 'Nombre'), C('target', 'Para', 'mono'), C('max-limit', 'Límite', 'par', { f: bps }), C('rate', 'Ahora', 'par', { f: bps }), C('bytes', 'Total', 'par', { f: bytes }), ESTADO, C('comment', 'Comentario')] },
    { clave: 'arbol', titulo: 'Árbol de colas', cols: [C('name', 'Nombre'), C('parent', 'Padre'), C('packet-mark', 'Marca'), C('max-limit', 'Límite', 'bps'), C('rate', 'Ahora', 'bps'), C('bytes', 'Total', 'bytes'), ESTADO] }],
  nat: [{ clave: 'nat', cols: [C('chain', 'Cadena'), C('action', 'Acción'), C('detalle', 'Regla', 'regla'), C('to-addresses', 'Hacia', 'mono'), C('to-ports', 'Puerto'), C('packets', 'Paquetes', 'num'), C('bytes', 'Tráfico', 'bytes')] }],
  mangle: [{ clave: 'mangle', cols: [C('chain', 'Cadena'), C('action', 'Acción'), C('detalle', 'Regla', 'regla'), C('new-routing-mark', 'Marca de ruta', 't', { alt: 'new-connection-mark' }), C('packets', 'Paquetes', 'num'), C('bytes', 'Tráfico', 'bytes')] }],
  listas: [{ clave: 'listas', agrupar: 'list', cols: [C('list', 'Lista'), C('address', 'Dirección', 'mono'), C('timeout', 'Caduca en', 'dur'), C('dynamic', 'Dinámica', 'si'), C('creation-time', 'Creada'), C('comment', 'Comentario')] }],
  paquetes: [{ clave: 'actualizacion', titulo: 'Actualizaciones', kv: { channel: 'Canal', 'installed-version': 'Instalada', 'latest-version': 'Última disponible', status: 'Estado' } },
    { clave: 'placa', titulo: 'Placa y firmware', kv: { model: 'Modelo', 'serial-number': 'Número de serie', 'firmware-type': 'Tipo', 'current-firmware': 'Firmware actual', 'upgrade-firmware': 'Firmware disponible' } },
    { clave: 'paquetes', titulo: 'Paquetes instalados', cols: [C('name', 'Paquete'), C('version', 'Versión'), C('build-time', 'Compilado'), ESTADO] }],
  servicios: [{ clave: 'servicios', nota: 'Servicios de administración del router. Los activos sin restricción de dirección se pueden alcanzar desde cualquier red a la que llegue el router.',
    cols: [C('name', 'Servicio'), C('port', 'Puerto'), C('address', 'Permitido desde', 'abierto'), C('certificate', 'Certificado'), ESTADO] }],
  scripts: [{ clave: 'scripts', cols: [C('name', 'Script'), C('owner', 'Dueño'), C('last-started', 'Última vez'), C('run-count', 'Veces', 'num'), C('source', 'Código', 'codigo'), C('comment', 'Comentario')] }],
  tareas: [{ clave: 'tareas', cols: [C('name', 'Tarea'), C('on-event', 'Ejecuta', 'mono'), C('interval', 'Cada', 'dur'), C('start-date', 'Desde'), C('next-run', 'Próxima'), C('run-count', 'Veces', 'num'), ESTADO] }],
  reloj: [{ clave: 'reloj', titulo: 'Reloj', kv: { date: 'Fecha', time: 'Hora', 'time-zone-name': 'Zona horaria', 'gmt-offset': 'Desfase', 'time-zone-autodetect': ['Zona automática', 'si'] } },
    { clave: 'ntp', titulo: 'Cliente NTP', kv: { enabled: ['Activado', 'si'], mode: 'Modo', servers: 'Servidores', 'primary-ntp': 'Servidor principal', status: 'Estado', 'synced-server': 'Sincronizado con', 'system-offset': 'Desfase' } },
    { clave: 'servidoresntp', titulo: 'Servidores NTP', cols: [C('address', 'Servidor'), C('reachable', 'Alcanzable', 'si'), C('stratum', 'Estrato'), C('offset', 'Desfase'), ESTADO] }],
  logging: [{ clave: 'reglas', titulo: 'Qué se registra', cols: [C('topics', 'Temas'), C('action', 'Dónde'), C('prefix', 'Prefijo'), ESTADO] },
    { clave: 'destinos', titulo: 'Destinos', cols: [C('name', 'Nombre'), C('target', 'Tipo'), C('remote', 'Servidor remoto', 'mono'), C('remote-port', 'Puerto'), C('disk-file-name', 'Archivo')] }],
  snmp: [{ clave: 'snmp', titulo: 'SNMP', kv: { enabled: ['Activado', 'si'], contact: 'Contacto', location: 'Ubicación', 'trap-version': 'Versión de traps', 'trap-target': 'Destino de traps' } },
    { clave: 'comunidades', titulo: 'Comunidades', cols: [C('name', 'Comunidad'), C('addresses', 'Desde', 'mono'), C('security', 'Seguridad'), C('read-access', 'Lectura', 'si'), C('write-access', 'Escritura', 'si'), ESTADO] }],
  archivos: [{ clave: 'archivos', cols: [C('name', 'Archivo', 'mono'), C('type', 'Tipo'), C('size', 'Tamaño', 'bytes'), C('creation-time', 'Creado', 't', { alt: 'last-modified' })] }],
  contenedores: [{ clave: 'contenedores', cols: [C('name', 'Contenedor', 't', { alt: 'tag' }), C('tag', 'Imagen', 'mono'), C('status', 'Estado'), C('interface', 'Interfaz'), C('arch', 'Arquitectura'), C('start-on-boot', 'Al arrancar', 'si'), C('comment', 'Comentario')] }],
  usuarios: [{ clave: 'activos', titulo: 'Conectados ahora', cols: [C('name', 'Usuario'), C('address', 'Desde', 'mono'), C('via', 'Por'), C('when', 'Desde las'), C('group', 'Grupo')] },
    { clave: 'usuarios', titulo: 'Usuarios', cols: [C('name', 'Usuario'), C('group', 'Grupo'), C('address', 'Permitido desde', 'mono'), C('last-logged-in', 'Último acceso'), ESTADO, C('comment', 'Comentario')] }]
};
FMT.regla = (v, f, x) => esc([x.protocol, x['src-address'] && `desde ${x['src-address']}`, x['dst-address'] && `hacia ${x['dst-address']}`, x['dst-port'] && `puerto ${x['dst-port']}`,
  (x['in-interface'] || x['in-interface-list']) && `entra por ${x['in-interface'] || x['in-interface-list']}`, (x['out-interface'] || x['out-interface-list']) && `sale por ${x['out-interface'] || x['out-interface-list']}`].filter(Boolean).join(', ') || 'Todo')
  + (x.comment ? `<br><span class="tenue">${esc(x.comment)}</span>` : '');
FMT.abierto = (v, f, x) => SI(x.disabled) ? '<span class="tenue">—</span>' : v ? `<span class="mono">${esc(v)}</span>` : '<span class="etq aviso">Cualquier dirección</span>';
FMT.codigo = v => v ? `<details class="codigo-det"><summary>Ver</summary><code class="codigo">${esc(v)}</code></details>` : '—';

function tablaGenerica(def, filas, coincide) {
  if (def.kv) {
    const r = filas[0] || {};
    const pares = Object.entries(def.kv).filter(([k]) => r[k] != null && r[k] !== '');
    if (!pares.length) return '';
    return `<div class="sub-cab"><h3>${esc(def.titulo || '')}</h3></div><dl class="kv-rt hoja">${pares.map(([k, d]) => { const [et, fmt] = Array.isArray(d) ? d : [d, 't']; return `<div><dt>${esc(et)}</dt><dd>${FMT[fmt](r[k], null, r)}</dd></div>`; }).join('')}</dl>`;
  }
  const l = filas.filter(x => coincide(...Object.values(x).map(v => v == null ? '' : String(v))));
  const celda = (c, x) => { const v = x[c.campo] != null && x[c.campo] !== '' ? x[c.campo] : (c.alt ? x[c.alt] : x[c.campo]); return FMT[c.fmt](v, c.f, x); };
  const cols = def.cols.filter(c => c.fmt === 'estado' || c.fmt === 'regla' || filas.some(x => (x[c.campo] != null && x[c.campo] !== '') || (c.alt && x[c.alt])));
  for (const c of cols) if (!FMT[c.fmt]) c.fmt = 't';
  const tabla = filas2 => `<section class="hoja desliza" style="margin-bottom:8px"><table class="tabla-rt"><thead><tr>${cols.map(c => `<th class="${['num', 'bytes', 'bps'].includes(c.fmt) ? 'num' : ''}">${c.etiqueta}</th>`).join('')}</tr></thead><tbody>
    ${filas2.map(x => `<tr style="${SI(x.disabled) ? 'opacity:.55' : ''}">${cols.map(c => `<td class="${['num', 'bytes', 'bps'].includes(c.fmt) ? 'num' : ''}">${celda(c, x)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="tenue">Nada coincide.</td></tr>`}</tbody></table></section>`;
  let h = def.titulo ? `<div class="sub-cab"><h3>${esc(def.titulo)} <span>${filas.length}</span></h3></div>` : '';
  if (def.nota) h += `<p class="tenue" style="margin:-4px 0 12px;font-size:14px">${esc(def.nota)}</p>`;
  if (def.agrupar) {
    const grupos = [...new Set(l.map(x => x[def.agrupar]))].sort();
    return h + grupos.map(g => `<div class="sub-cab"><h3>${esc(g)} <span>${l.filter(x => x[def.agrupar] === g).length}</span></h3></div>${tabla(l.filter(x => x[def.agrupar] === g))}`).join('') || h + tabla([]);
  }
  return h + tabla(l);
}

FMT.est = v => { const ok = ['up', 'licensed', 'leased', 'enable', 'accept', 'valid', 'primario'], mal = ['down', 'expired', 'disable', 'deny', 'invalid', 'dead']; const t = { up: 'Arriba', down: 'Caído', licensed: 'Vigente', expired: 'Vencida', leased: 'Asignada', enable: 'Activa', disable: 'Desactivada', accept: 'Permitir', deny: 'Denegar' }[v] || v; return v ? `<span class="etq ${ok.includes(v) ? 'ok' : mal.includes(v) ? 'mal' : ''}">${esc(t)}</span>` : '<span class="tenue">—</span>'; };
FMT.fecha = v => { if (!v) return '<span class="tenue">—</span>'; const d = new Date(v); if (isNaN(d)) return esc(v); const dias = Math.round((d - Date.now()) / 864e5); return `${d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}${dias >= 0 && dias <= 45 ? ` <span class="etq aviso">en ${dias} d</span>` : ''}`; };
FMT.accion = (v, f, x) => x.estado === 'disable' ? '<span class="etq">Desactivada</span>' : FMT.est(v);
FMT.lic = v => esc({ forticare: 'FortiCare (soporte)', antivirus: 'Antivirus', ips: 'IPS', web_filtering: 'Filtro web', antispam: 'Antispam', appctrl: 'Control de aplicaciones', industrial_db: 'Base industrial', botnet_ip: 'Botnet IP', botnet_domain: 'Botnet dominios', mobile_malware: 'Malware móvil', outbreak_prevention: 'Prevención de brotes', blacklisted_certificates: 'Certificados bloqueados', forticloud: 'FortiCloud', fortiguard: 'FortiGuard', sdwan_network_monitor: 'Monitor SD-WAN', security_rating: 'Calificación de seguridad', iot_detection: 'Detección IoT', fortisandbox_cloud: 'FortiSandbox Cloud' }[v] || String(v || '—').replace(/_/g, ' '));
FMT.nivel = v => { const m = { emergency: ['mal', 'Emergencia'], alert: ['mal', 'Alerta'], critical: ['mal', 'Crítico'], error: ['mal', 'Error'], warning: ['aviso', 'Aviso'], notice: ['', 'Nota'], information: ['', 'Info'], debug: ['', 'Depuración'] }[v] || ['', v || '—']; return `<span class="etq ${m[0]}">${esc(m[1])}</span>`; };
FMT.ifz = v => { if (!v) return '<span class="tenue">—</span>'; const t = String(v), i = t.indexOf(': '); return i < 0 ? esc(t) : `<span class="ifz">${esc(t.slice(i + 2))}<small>${esc(t.slice(0, i))}</small></span>`; };
FMT.uso = v => { if (!v) return '<span class="tenue">Nunca</span>'; const d = new Date(v); if (isNaN(d)) return esc(v); const s = Math.max(0, Math.round((Date.now() - d) / 1000)); return `hace ${esc(hace(s))}`; };
FMT.ms = v => v == null || v === '' ? '—' : `${nf.format(Math.round(Number(v) * 10) / 10)} ms`;
FMT.pct = v => v == null || v === '' ? '—' : `${nf.format(Number(v))} %`;
FMT.seg = v => v == null || v === '' ? '—' : esc(hace(Number(v)));
Object.assign(TABLAS_RT, {
  'fg-sdwan': [{ clave: 'miembros', titulo: 'Enlaces', cols: [C('interfaz', 'Enlace'), C('estado', 'Estado', 'est'), C('puertaEnlace', 'Puerta de enlace', 'mono'), C('sesiones', 'Sesiones', 'num'), C('bajada', 'Bajada', 'bps'), C('subida', 'Subida', 'bps'), C('zona', 'Zona')] },
    { clave: 'sla', titulo: 'SLA (pruebas de calidad)', cols: [C('sla', 'Prueba'), C('interfaz', 'Enlace'), C('estado', 'Estado', 'est'), C('latencia', 'Latencia', 'ms'), C('jitter', 'Jitter', 'ms'), C('perdida', 'Pérdida', 'pct')] }],
  'fg-ipsec': [{ clave: 'lista', cols: [C('tunel', 'Túnel'), C('remoto', 'Extremo remoto', 'mono'), C('fase2', 'Fase 2'), C('estado', 'Estado', 'est'), C('redes', 'Redes', 'mono'), C('entrada', 'Recibido', 'bytes'), C('salida', 'Enviado', 'bytes')] }],
  'fg-sslvpn': [{ clave: 'lista', cols: [C('usuario', 'Usuario'), C('origen', 'Desde', 'mono'), C('ip', 'IP asignada', 'mono'), C('desde', 'Conectado desde'), C('duracion', 'Tiempo', 'seg')] }],
  'fg-politicas': [{ clave: 'lista', cols: [C('id', '#', 'num'), C('nombre', 'Política'), C('origen', 'Origen', 'ifz'), C('destino', 'Destino', 'ifz'), C('servicio', 'Servicio'), C('accion', 'Acción', 'accion'), C('usos', 'Usos', 'num'), C('bytes', 'Tráfico', 'bytes'), C('ultimo', 'Último uso', 'uso')] }],
  'fg-rutas': [{ clave: 'lista', cols: [C('destino', 'Destino', 'mono'), C('puertaEnlace', 'Puerta de enlace', 'mono'), C('interfaz', 'Interfaz'), C('tipo', 'Tipo'), C('distancia', 'Distancia', 'num'), C('metrica', 'Métrica', 'num')] }],
  'fg-dhcp': [{ clave: 'lista', cols: [C('nombre', 'Equipo'), C('ip', 'IP', 'mono'), C('mac', 'MAC', 'mono'), C('interfaz', 'Interfaz'), C('estado', 'Estado', 'est'), C('vence', 'Vence', 'fecha')] }],
  'fg-licencias': [{ clave: 'lista', nota: 'Las que vencen en menos de 45 días se marcan en amarillo.', cols: [C('servicio', 'Servicio', 'lic'), C('estado', 'Estado', 'est'), C('vence', 'Vence', 'fecha'), C('version', 'Versión de firmas')] }],
  'fg-ha': [{ clave: 'lista', cols: [C('equipo', 'Equipo'), C('serie', 'Número de serie', 'mono'), C('rol', 'Rol', 'est'), C('prioridad', 'Prioridad', 'num'), C('cpu', 'CPU', 'pct'), C('memoria', 'Memoria', 'pct'), C('sesiones', 'Sesiones', 'num')] }],
  'fg-usuarios': [{ clave: 'lista', cols: [C('usuario', 'Usuario'), C('ip', 'IP', 'mono'), C('grupo', 'Grupo'), C('metodo', 'Método'), C('duracion', 'Tiempo', 'seg'), C('trafico', 'Tráfico', 'bytes')] }],
  'fg-eventos': [{ clave: 'lista', cols: [C('hora', 'Hora'), C('nivel', 'Nivel', 'nivel'), C('mensaje', 'Mensaje'), C('usuario', 'Usuario')] }]
});
function seccionGenerica(nombre, d, coincide) {
  if (Array.isArray(d)) d = { lista: d };
  const defs = TABLAS_RT[nombre] || [];
  const partes = defs.filter(def => d[def.clave] && d[def.clave].length).map(def => tablaGenerica(def, d[def.clave], coincide)).filter(Boolean);
  if (!partes.length) return `<div class="hoja vacio gato-vacio">${gatoSVG('programando')}<strong>Nada que mostrar</strong>${nombre.startsWith('fg-') ? `Este FortiGate no tiene ${esc(TITULO_RT[nombre].toLowerCase())} configurado, o el token no tiene permiso para verlo.` : `Este router no tiene ${esc(TITULO_RT[nombre].toLowerCase())} configurado, o su versión de RouterOS no lo incluye.`}</div>`;
  return partes.join('');
}

/* ---------------- Conexiones: top destinos y orígenes ---------------- */
function seccionConexiones(d, coincide) {
  const fila = (x, max) => `<tr><td><span class="mono">${esc(x.ip)}</span></td><td class="num">${miles(x.conexiones)}</td><td style="width:34%"><div class="carril"><span style="width:${Math.round(x.conexiones / max * 100)}%;background:var(--senal)"></span></div></td><td class="num">${bytes(x.bytes)}</td></tr>`;
  const tabla = (t, l) => { const f = l.filter(x => coincide(x.ip)), m = Math.max(1, ...l.map(x => x.conexiones));
    return `<div><div class="sub-cab"><h3>${t}</h3></div><section class="hoja desliza" style="margin-bottom:8px"><table class="tabla-rt"><thead><tr><th>Dirección</th><th class="num">Conexiones</th><th></th><th class="num">Tráfico</th></tr></thead><tbody>${f.map(x => fila(x, m)).join('') || '<tr><td colspan="4" class="tenue">Nada coincide.</td></tr>'}</tbody></table></section></div>`; };
  const prot = Object.entries(d.protocolos || {}).sort((a, b) => b[1] - a[1]).map(([p, n]) => `<span class="etq">${esc(p)} ${miles(n)}</span>`).join(' ');
  return `<div class="sub-cab"><h3>${miles(d.total)} conexiones abiertas <span>${prot}</span></h3><label class="buscar">${ICO.lupa}<span class="sr">Buscar IP</span><input type="search" id="rtFiltro" placeholder="Buscar IP" value="${esc(rt.filtro)}"></label></div>
    <div class="dos-tablas">${tabla('Destinos más usados', d.destinos)}${tabla('Equipos con más conexiones', d.origenes)}</div>`;
}

/* ---------------- Ancho de banda: todas las interfaces en vivo ---------------- */
function anchoDeBanda(e, montar) {
  const red = e.red || {}, l = (red.interfaces || []).filter(i => i.activa && !i.deshabilitada).sort((a, b) => ((b.rx || 0) + (b.tx || 0)) - ((a.rx || 0) + (a.tx || 0)));
  const cuerpo = $('#rtCuerpo');
  const clave = l.map(i => i.nombre).join('|');
  if (montar || cuerpo.dataset.ifs !== clave) {
    cuerpo.dataset.ifs = clave;
    cuerpo.innerHTML = l.length ? `<div class="ancho-rejilla">${l.map(i => `<section class="tablero-vivo"><div class="tv-cab"><h3>${esc(i.nombre)}<small>${esc(i.comentario || TIPOS_IF[i.tipo] || i.tipo)}</small></h3><div class="tv-cifras" data-cif="${esc(i.nombre)}"></div></div><div class="grafico-vivo chico" data-graf="${esc(i.nombre)}"></div></section>`).join('')}</div>`
      : `<div class="hoja vacio">Sin interfaces activas.</div>`;
  }
  for (const i of l) {
    const c = cuerpo.querySelector(`[data-cif="${CSS.escape(i.nombre)}"]`), g = cuerpo.querySelector(`[data-graf="${CSS.escape(i.nombre)}"]`);
    if (c) c.innerHTML = `<div class="bajada"><b>${bps(i.rx)}</b><span>Bajada</span></div><div class="subida"><b>${bps(i.tx)}</b><span>Subida</span></div>`;
    if (g) graficoTrafico(g, ((rt.vivo && rt.vivo.serie[i.nombre]) || []).map(([t, rx, tx]) => ({ t, rx, tx })), true);
  }
}

/* ---------------- Herramientas: ping y traceroute desde el router ---------------- */
function herramientasRt() {
  $('#rtCuerpo').innerHTML = `<form class="herr-rt hoja" id="rtHerr" novalidate>
      <label class="campo">Destino<input name="destino" spellcheck="false" placeholder="8.8.8.8, google.com, 192.168.88.10" value="${esc(rt.herrDestino || '')}" required></label>
      <button class="btn prim" type="submit" value="ping">Ping</button><button class="btn" type="submit" value="traceroute">Traceroute</button>
    </form>
    <p class="tenue" style="font-size:13.5px;margin:8px 0 18px">Lo hace el propio router: así ves la red desde el cliente. No cambia nada en el router.</p>
    <div id="rtHerrRes">${rt.herr || ''}</div>`;
  const f = $('#rtHerr');
  f.onsubmit = async ev => {
    ev.preventDefault();
    const tipo = (ev.submitter && ev.submitter.value) || 'ping', destino = f.destino.value.trim();
    rt.herrDestino = destino;
    const res = $('#rtHerrRes');
    res.innerHTML = gatoCargando(tipo === 'ping' ? `Haciendo ping a ${esc(destino)}…` : `Siguiendo el camino hasta ${esc(destino)}…`);
    f.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const { resultado: r } = await enviar(`/api/routers/${rt.id}/herramienta`, 'POST', { tipo, destino });
      if (tipo === 'ping') {
        const fin = r[r.length - 1] || {}, ok = r.filter(x => x.tiempo != null);
        rt.herr = `<div class="sub-cab"><h3>Ping a ${esc(destino)} <span>${ok.length} de ${r.length} respuestas${fin.media != null ? `, media ${nf.format(fin.media)} ms` : ''}</span></h3></div>
          <section class="hoja desliza"><table class="tabla-rt"><thead><tr><th>#</th><th>Desde</th><th class="num">Tiempo</th><th class="num">TTL</th><th>Estado</th></tr></thead><tbody>
          ${r.map(x => `<tr><td class="tenue">${esc(x.seq)}</td><td class="mono">${esc(x.host || destino)}</td><td class="num">${x.tiempo != null ? nf.format(x.tiempo) + ' ms' : '—'}</td><td class="num">${esc(x.ttl || '—')}</td><td>${x.tiempo != null ? '<span class="etq ok">Respondió</span>' : `<span class="etq mal">${esc(x.estado || 'Sin respuesta')}</span>`}</td></tr>`).join('')}</tbody></table></section>`;
      } else {
        rt.herr = `<div class="sub-cab"><h3>Camino hasta ${esc(destino)} <span>${plural(r.length, 'salto', 'saltos')}</span></h3></div>
          <section class="hoja desliza"><table class="tabla-rt"><thead><tr><th>Salto</th><th>Dirección</th><th class="num">Último</th><th class="num">Media</th><th class="num">Peor</th><th>Pérdida</th></tr></thead><tbody>
          ${r.map(x => `<tr><td class="tenue">${esc(x.salto)}</td><td class="mono">${x.direccion ? esc(x.direccion) : '<span class="tenue">* sin respuesta</span>'}</td><td class="num">${x.ultimo != null ? nf.format(x.ultimo) + ' ms' : '—'}</td><td class="num">${x.media != null ? nf.format(x.media) + ' ms' : '—'}</td><td class="num">${x.peor != null ? nf.format(x.peor) + ' ms' : '—'}</td><td>${x.perdida && x.perdida !== '0%' ? `<span class="etq aviso">${esc(x.perdida)}</span>` : '<span class="tenue">0 %</span>'}</td></tr>`).join('')}</tbody></table></section>`;
      }
      res.innerHTML = rt.herr;
    } catch (x) { if (!x.login) res.innerHTML = gatoError(esc(x.message)); }
    finally { f.querySelectorAll('button').forEach(b => b.disabled = false); }
  };
  if (!rt.herrDestino) f.destino.focus();
}

/* ---------------- Caídas y sucesos de este router ---------------- */
const NOMBRE_SUCESO = { caida: ['caido', 'Dejó de responder'], vuelta: ['ok', 'Volvió a responder'], reinicio: ['sinMetricas', 'Se reinició'], nuevo: ['activa', 'Se agregó a NodeCat'], 'wan-caida': ['caido', 'Se cayó el enlace WAN'], 'wan-vuelta': ['ok', 'Volvió el enlace WAN'] };
async function cargarSucesosRt(dias = rt.diasSucesos || 30) {
  rt.diasSucesos = dias;
  const cuerpo = $('#rtCuerpo'), id = rt.id;
  cuerpo.innerHTML = gatoCargando('Buscando en el historial…');
  let d;
  try { d = await api(`/api/equipos/${id}/sucesos?dias=${dias}`); } catch (x) { if (!x.login) cuerpo.innerHTML = gatoError(esc(x.message)); return; }
  if (rt.id !== id || rt.pestana !== 'sucesos') return;
  cuerpo.innerHTML = vistaSucesos(d, dias);
  cuerpo.querySelector('[data-dias-grupo]').onclick = ev => { const b = ev.target.closest('[data-dias]'); if (b) cargarSucesosRt(+b.dataset.dias); };
}
function vistaSucesos(d, dias) {
  const r = d.resumen, l = d.sucesos.filter(x => x.tipo !== 'vuelta' && x.tipo !== 'wan-vuelta');
  return `<div class="sub-cab"><h3>Últimos ${dias} días</h3>
      <div class="segmentos" role="group" aria-label="Periodo" data-dias-grupo>${[7, 30, 90, 365].map(n => `<button type="button" data-dias="${n}" aria-pressed="${n === dias}">${n === 365 ? '1 año' : n + ' días'}</button>`).join('')}</div></div>
    <div class="losas" style="margin-bottom:16px">
      <div class="losa ${r.caidas ? 'mal' : ''}"><h4>Caídas</h4><div class="v">${r.caidas}</div><small>${r.caidas ? `${durTxt(r.sinRespuesta)} sin responder en total` : 'Ninguna'}</small></div>
      <div class="losa ${r.wan ? 'mal' : ''}"><h4>Caídas del WAN</h4><div class="v">${r.wan}</div><small>con el router respondiendo</small></div>
      <div class="losa"><h4>Reinicios</h4><div class="v">${r.reinicios}</div><small>detectados por el tiempo encendido</small></div>
    </div>
    ${l.length ? `<section class="hoja desliza"><table class="tabla-rt"><thead><tr><th>Qué pasó</th><th>Empezó</th><th>Terminó</th><th class="num">Duración</th><th>Detalle</th></tr></thead><tbody>
      ${l.map(x => { const [cl, t] = NOMBRE_SUCESO[x.tipo] || ['', x.tipo]; const f = ms => new Date(ms).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        return `<tr><td><span class="estado-ses"><span class="punto ${cl}" aria-hidden="true"></span>${t}</span></td><td>${f(x.t)}</td>
          <td>${x.hasta ? f(x.hasta) : x.sigue ? '<span class="etq mal">Sigue así</span>' : '<span class="tenue">—</span>'}</td>
          <td class="num">${x.duracion != null ? durTxt(x.duracion) : x.sigue ? durTxt(Date.now() - x.t) : '—'}</td>
          <td class="tenue" style="white-space:normal">${esc(x.detalle || '')}</td></tr>`; }).join('')}</tbody></table></section>`
      : `<div class="hoja vacio gato-vacio">${gatoSVG('reparando')}<strong>Sin sucesos en este periodo</strong>Ni caídas ni reinicios. Todo tranquilo.</div>`}`;
}

/* ---------------- Alta y edición de FortiGate ---------------- */
async function dialogoForti(clienteId, id) {
  let cfg = null; const e = id ? equipo(id) : null;
  if (id) { try { cfg = (await api(`/api/routers/${id}/vivo`)).config; } catch (x) { if (!x.login) aviso(x.message, true); return; } }
  const demo = cfg && cfg.demo;
  let confirmar = false;
  const dlg = libre(`<form novalidate><h3>${id ? 'Editar FortiGate' : 'Agregar un FortiGate'}</h3>
    ${!id ? `<p>NodeCat se conecta a la API REST del FortiGate con un token y <b>solo lee</b>: no puede cambiar nada. Funciona con FortiOS 6.4 y 7.x.</p>
    <details class="clave" style="margin-bottom:16px"><summary>Prepara el FortiGate (una sola vez)</summary>
      <p>En la CLI del FortiGate, crea un perfil de solo lectura y un usuario de API que solo acepte la IP de NodeCat. Copia el token que muestra el último comando:</p>
      <code class="codigo pasos-cmd">config system accprofile
    edit "nodecat-lectura"
        set secfabgrp read
        set ftviewgrp read
        set authgrp read
        set sysgrp read
        set netgrp read
        set loggrp read
        set fwgrp read
        set vpngrp read
        set utmgrp read
        set wifi read
    next
end
config system api-user
    edit "nodecat"
        set accprofile "nodecat-lectura"
        set vdom "root"
        config trusthost
            edit 1
                set ipv4-trusthost IP-DE-NODECAT 255.255.255.255
            next
        end
    next
end
execute api-user generate-key nodecat</code>
      <p>Si llegas por Internet, usa la IP pública de NodeCat en el trusthost y permite HTTPS de administración en la interfaz WAN solo desde esa IP.</p>
    </details>` : ''}
    ${demo ? '<div class="msg atencion">FortiGate del modo demo: solo se puede cambiar el nombre.</div>' : ''}
    <label class="campo">Nombre<input name="nombre" maxlength="60" value="${esc(e ? e.nombre : '')}" placeholder="Firewall principal" required></label>
    ${demo ? '' : `<div class="tres">
      <label class="campo">IP o nombre<input name="host" spellcheck="false" value="${esc(cfg ? cfg.host : '')}" placeholder="10.20.0.1" required></label>
      <label class="campo">VDOM <span class="ayuda-campo">opcional</span><input name="vdom" spellcheck="false" value="${esc(cfg ? cfg.vdom : '')}" placeholder="root"></label>
      <label class="campo">Puerto HTTPS<input name="puerto" type="number" min="1" max="65535" value="${cfg ? cfg.puerto : 443}"></label>
    </div>
    <label class="campo">Token de la API<input name="token" type="password" autocomplete="off" spellcheck="false" placeholder="${cfg && cfg.tokenGuardado ? 'Guardado. Déjalo vacío para conservarlo.' : 'Pega aquí el token'}"></label>
    <label class="interruptor" style="margin-bottom:14px"><input type="checkbox" name="verificar" ${cfg && cfg.verificar ? 'checked' : ''}><span><b>Verificar el certificado</b><small>Actívalo solo si el FortiGate tiene un certificado válido (no el de fábrica).</small></span></label>
    <label class="campo">Interfaz WAN <span class="ayuda-campo">Opcional. Vacía: los enlaces de SD-WAN, o wan1.</span><input name="wan" spellcheck="false" value="${esc(cfg ? cfg.wan : '')}" placeholder="wan1"></label>`}
    <div class="msg" role="status" hidden></div>
    <div class="pie">${id ? '<button class="btn" type="button" data-quitar style="margin-right:auto">Quitar de NodeCat</button>' : ''}${demo ? '' : '<button class="btn" type="button" data-probar>Probar conexión</button>'}<button class="btn" type="button" data-cerrar>Cancelar</button><button class="btn prim" type="submit">${id ? 'Guardar' : 'Agregar FortiGate'}</button></div></form>`, true);
  const f = dlg.querySelector('form'), m = f.querySelector('.msg');
  const msg = (t, tipo) => { if (!t || tipo !== 'bien') return gatoDice(m, t); m.className = 'msg bien'; m.textContent = t; m.hidden = false; };
  const datos = () => demo ? { nombre: f.nombre.value } : { tipo: 'fortigate', nombre: f.nombre.value, host: f.host.value, vdom: f.vdom.value, puerto: +f.puerto.value, token: f.token.value, verificar: f.verificar.checked, wan: f.wan.value, id };
  f.nombre.focus();
  const bp = f.querySelector('[data-probar]');
  if (bp) bp.onclick = ev => ocupado(ev.currentTarget, 'Probando…', async () => {
    msg('');
    try { const r = await enviar('/api/routers/probar', 'POST', datos()); msg(`Conectado con “${r.identidad}”: ${r.modelo}, FortiOS ${r.version.replace(/^v/, '')}.`, 'bien'); if (!f.nombre.value.trim()) f.nombre.value = r.identidad || ''; }
    catch (x) { if (!x.login) msg(x.message); }
  });
  f.onsubmit = async ev => {
    ev.preventDefault();
    await ocupado(f.querySelector('[type=submit]'), id ? 'Guardando…' : 'Agregando…', async () => {
      try {
        if (id) { await enviar(`/api/routers/${id}`, 'PUT', datos()); dlg.close(); aviso('FortiGate guardado.'); montada = null; await cargar(true); }
        else { const r = await enviar(`/api/clientes/${clienteId}/fortigates`, 'POST', datos()); dlg.close(); aviso('FortiGate agregado. Conectando…'); await cargar(true); location.hash = '#/e/' + r.id; }
      } catch (x) { if (!x.login) msg(x.message); }
    });
  };
  const bq = f.querySelector('[data-quitar]');
  if (bq) bq.onclick = async () => {
    if (!confirmar) { confirmar = true; bq.className = 'btn peligro'; bq.textContent = '¿Seguro? Se borra su historial'; return; }
    try { await enviar(`/api/equipos/${id}`, 'DELETE'); dlg.close(); aviso('FortiGate quitado de NodeCat.'); location.hash = '#/c/' + clienteId; await cargar(true); }
    catch (x) { if (!x.login) msg(x.message); }
  };
}
