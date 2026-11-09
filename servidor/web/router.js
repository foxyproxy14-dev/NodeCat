'use strict';
/* ======================================================================
   Atalaya: routers MikroTik (página en modo consola, al estilo de MikroDash)
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

const rt = { id: null, pestana: 'resumen', vivo: null, sel: null, temporizador: null, seccion: {}, cargandoSec: false, filtro: '', rango: '24h', histT: {} };
const PESTANAS_RT = [['resumen', 'Resumen'], ['interfaces', 'Interfaces'], ['dhcp', 'DHCP'], ['wifi', 'Wi‑Fi'], ['vpn', 'VPN'], ['firewall', 'Firewall'], ['registro', 'Registro']];

function montarRouter(e, c) {
  rt.id = e.id; rt.vivo = null; rt.seccion = {}; rt.filtro = '';
  if (!PESTANAS_RT.some(([k]) => k === rt.pestana)) rt.pestana = 'resumen';
  $('#vista').innerHTML = `
    <nav class="miga" aria-label="Ruta"><a href="#/">Clientes</a>${ICO.miga}<a href="#/c/${c.id}">${esc(c.nombre)}</a>${ICO.miga}<span>${esc(e.nombre)}</span></nav>
    <section class="rt-cab">
      <div><h1><span class="punto" id="rtPunto" aria-hidden="true"></span><span id="rtNombre"></span></h1><p id="rtMeta"></p></div>
      <div class="acciones"><span class="en-vivo" id="rtVivo"><i aria-hidden="true"></i>En vivo</span>${esAdmin() ? '<button class="btn" type="button" id="btnEditarRt">Editar</button>' : ''}</div>
    </section>
    <div id="rtAvisos"></div>
    <nav class="pestanas-rt" id="rtPestanas" role="tablist" aria-label="Secciones del router"></nav>
    <div id="rtCuerpo"></div>`;
  $('#rtPestanas').onclick = ev => { const b = ev.target.closest('[data-pest]'); if (b) { rt.pestana = b.dataset.pest; rt.filtro = ''; pintarCuerpoRt(true); } };
  const be = $('#btnEditarRt'); if (be) be.onclick = () => dialogoRouter(c.id, e.id);
  pintarCuerpoRt(true);
  pedirVivo();
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
      if (rutaActual().id === id) { vistaRouter(id); if (rt.pestana !== 'resumen' && rt.pestana !== 'interfaces') cargarSeccion(); }
    } catch (e) { if (e.login) return; }
  }
  rt.temporizador = setTimeout(pedirVivo, 3000);
}
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
  if (red.version) meta.push(`RouterOS ${red.version}`);
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
  const n = red.interfaces ? red.interfaces.filter(i => !i.deshabilitada).length : 0;
  $('#rtPestanas').innerHTML = PESTANAS_RT.map(([k, t]) => {
    const cnt = k === 'interfaces' ? n : k === 'dhcp' ? red.dhcp : k === 'vpn' ? red.vpnTotal : null;
    return `<button type="button" role="tab" data-pest="${k}" aria-selected="${rt.pestana === k}">${t}${cnt ? `<span class="cuenta">${cnt}</span>` : ''}</button>`;
  }).join('');
  pintarCuerpoRt(false);
}

function pintarCuerpoRt(montar) {
  const cuerpo = $('#rtCuerpo'); if (!cuerpo) return;
  document.querySelectorAll('#rtPestanas [data-pest]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pest === rt.pestana)));
  const e = equipo(rt.id); if (!e) return;
  if (rt.pestana === 'resumen') {
    if (montar || !$('#rtLosas')) {
      cuerpo.innerHTML = `<div class="losas" id="rtLosas"></div>
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
    }
    resumenRouter(e);
  } else if (rt.pestana === 'interfaces') {
    if (montar || !$('#rtTablaIf')) cuerpo.innerHTML = '<section class="hoja desliza" id="rtTablaIf"></section>';
    tablaInterfaces(e);
  } else {
    if (montar) {
      cuerpo.innerHTML = `<div id="rtSeccion">${gatoCargando('Preguntándole al router…')}</div>`;
      cargarSeccion(true);
    }
  }
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
    losa('Internet', wan ? (wan.activa ? '<span style="color:#7ee07e">Arriba</span>' : 'Caído') : '—', wan ? esc(wan.interfaz) : 'Sin ruta por defecto', null, wan && !wan.activa),
    losa('Temperatura', red.temperatura != null ? `${red.temperatura}<i>°C</i>` : '—', red.voltaje != null ? `${nf.format(red.voltaje)} V` : ''),
    losa('Encendido', e.arranque ? esc(duracion(e.arranque)) : '—', e.arranque ? 'desde ' + esc(cuando(e.arranque)) : ''),
    losa('Conexiones', miles(red.conexiones), 'en el firewall'),
    losa('DHCP', red.dhcp == null ? '—' : miles(red.dhcp), 'equipos con IP'),
    losa('VPN', red.vpnTotal ? `${red.vpn}<i>de ${red.vpnTotal}</i>` : '0', red.vpnTotal ? 'túneles activos' : 'sin túneles')
  ].join('');

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
      (cs.length ? `<span>${plural(cs.length, 'caída', 'caídas')} del router.</span>` : '<span class="tenue">Sin caídas del router.</span>') +
      (ws.length ? ws.slice(-4).reverse().map(w => { const v = h.eventos.find(x => x.tipo === 'wan-vuelta' && x.t > w.t); return `<span class="caida"><span class="punto caido" aria-hidden="true"></span>WAN caído ${cuando(w.t)}, ${v ? durTxt(v.t - w.t) : 'sigue caído'}</span>`; }).join('') : '');
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
  if (!s) { el.innerHTML = gatoCargando('Preguntándole al router…'); return; }
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
      const l = d.lista.filter(x => coincide(x.mac, x.interfaz, x.ssid));
      h = `<div class="sub-cab"><h3>Clientes Wi‑Fi <span>${d.lista.length} conectados</span></h3>${buscador('Buscar MAC o interfaz')}</div>
        <section class="hoja desliza"><table class="tabla-rt"><thead><tr><th>Equipo (MAC)</th><th>Interfaz</th><th>Señal</th><th>Conectado</th><th>Velocidad</th></tr></thead><tbody>
        ${l.sort((a, b) => (b.señal || -99) - (a.señal || -99)).map(x => { const q = x.señal == null ? null : Math.max(0, Math.min(100, Math.round((x.señal + 90) / 50 * 100)));
          return `<tr><td><span class="usr">${esc(x.mac)}</span></td><td>${esc(x.interfaz)}${x.ssid ? `<span class="dom">${esc(x.ssid)}</span>` : ''}</td>
          <td>${x.señal == null ? '—' : `<span class="senal">${x.señal} dBm<span class="carril ${q < 35 ? 'n-alerta' : q < 55 ? 'n-aviso' : ''}"><span style="width:${q}%"></span></span></span>`}</td>
          <td>${hace(x.tiempo)}</td><td class="tenue">${esc(String(x.tx).split('-')[0])}</td></tr>`; }).join('') || '<tr><td colspan="5" class="tenue">Nadie conectado.</td></tr>'}</tbody></table></section>`;
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
  el.innerHTML = h;
  const inp = $('#rtFiltro');
  if (inp) {
    inp.oninput = ev => { rt.filtro = ev.target.value; pintarSeccion(); };
    if (activo) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (e) { } }
  }
}

/* ---------------- Routers en la página del cliente ---------------- */
function filaRouter(e) {
  const red = e.red || {}, vivo = e.estado === 'ok' || e.estado === 'sinMetricas', w = red.wan;
  let sub = e.estado === 'caido' ? (e.errorConexion || `Sin respuesta desde ${cuando(e.ultimo)}`) : e.estado === 'pendiente' ? (e.errorConexion || 'Conectando…') : (red.modelo ? `${red.modelo}, RouterOS ${red.version}` : e.so);
  return `<button type="button" class="fila rt ${esc(e.estado)}" data-eq="${e.id}" aria-label="${esc(e.nombre)}. Abrir">
    <span class="f-nombre"><span class="punto ${esc(e.estado)}" aria-hidden="true"></span><span><strong>${esc(e.nombre)}</strong><small>${esc(sub)}</small></span></span>
    ${vivo ? medidor(e.cpu, '', 'CPU') + medidor(e.ramPct, '', 'Memoria') : '<span></span><span></span>'}
    <span class="f-wan ${vivo && w && !w.activa ? 'caida' : ''}" data-etq="Internet">${!vivo || !w ? '<span class="tenue">—</span>' : w.activa ? (w.rx == null ? `<span class="tenue">Midiendo…</span><small>${esc(w.interfaz)}</small>` : `<span><span class="b">↓ ${bps(w.rx)}</span>&nbsp;&nbsp;<span class="s">↑ ${bps(w.tx)}</span></span><small>${esc(w.interfaz)}</small>`) : `<b>WAN caído</b><small>${esc(w.interfaz)}</small>`}</span>
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
    ${!id ? `<p>Atalaya se conecta al router por su API y <b>solo lee</b>: no puede cambiar nada. Funciona con RouterOS 6 y 7.</p>
    <details class="clave" style="margin-bottom:16px"><summary>Prepara el router (una sola vez)</summary>
      <p>En la terminal del router, crea un usuario de solo lectura y activa la API. Cambia la contraseña y la IP de Atalaya:</p>
      <code class="codigo pasos-cmd">/user group add name=atalaya policy=read,api,test,!write,!policy,!sensitive,!reboot,!ftp,!ssh,!telnet,!winbox,!web,!sniff,!romon
/user add name=atalaya group=atalaya password=UNA-CLAVE-LARGA
/ip service set api disabled=no address=IP-DE-ATALAYA/32</code>
      <p><b>Si llegas al router por VPN o red interna</b>, usa la API normal (puerto 8728).<br><b>Si solo tiene IP pública</b>, usa API‑SSL (puerto 8729) y deja entrar solo a tu IP pública:</p>
      <code class="codigo pasos-cmd">/certificate add name=api common-name=api days-valid=3650
/certificate sign api
/ip service set api-ssl disabled=no certificate=api address=TU-IP-PUBLICA/32</code>
    </details>` : ''}
    ${demo ? '<div class="msg atencion">Router del modo demo: solo se puede cambiar el nombre.</div>' : ''}
    <label class="campo">Nombre<input name="nombre" maxlength="60" value="${esc(e ? e.nombre : '')}" placeholder="Router principal" required></label>
    ${demo ? '' : `<div class="tres">
      <label class="campo">IP o nombre<input name="host" spellcheck="false" value="${esc(cfg ? cfg.host : '')}" placeholder="10.20.0.1" required></label>
      <label class="campo">Usuario<input name="usuario" spellcheck="false" autocomplete="off" value="${esc(cfg ? cfg.usuario : 'atalaya')}" required></label>
      <label class="campo">Puerto<input name="puerto" type="number" min="1" max="65535" value="${cfg ? cfg.puerto : 8728}"></label>
    </div>
    <label class="campo">Contraseña<input name="clave" type="password" autocomplete="new-password" placeholder="${cfg && cfg.claveGuardada ? 'Guardada. Déjala vacía para conservarla.' : ''}"></label>
    <label class="interruptor" style="margin-bottom:14px"><input type="checkbox" name="ssl" ${cfg && cfg.ssl ? 'checked' : ''}><span><b>Usar API‑SSL (cifrado)</b><small>Obligatorio si te conectas por Internet. El puerto pasa a 8729.</small></span></label>
    <label class="campo">Interfaz WAN <span class="ayuda-campo">Opcional. Si la dejas vacía, Atalaya usa la de la ruta por defecto.</span><input name="wan" spellcheck="false" value="${esc(cfg ? cfg.wan : '')}" placeholder="ether1, pppoe-out1…"></label>`}
    <div class="msg" role="status" hidden></div>
    <div class="pie">${id ? '<button class="btn" type="button" data-quitar style="margin-right:auto">Quitar de Atalaya</button>' : ''}${demo ? '' : '<button class="btn" type="button" data-probar>Probar conexión</button>'}<button class="btn" type="button" data-cerrar>Cancelar</button><button class="btn prim" type="submit">${id ? 'Guardar' : 'Agregar router'}</button></div></form>`, true);
  const f = dlg.querySelector('form'), m = f.querySelector('.msg');
  const msg = (t, tipo) => {
    if (!t || tipo !== 'bien') return gatoDice(m, t);
    m.className = 'msg bien'; m.textContent = t; m.hidden = false; caraDeGato('reparando', 1);
  };
  const datos = () => demo ? { nombre: f.nombre.value } : { nombre: f.nombre.value, host: f.host.value, usuario: f.usuario.value, puerto: +f.puerto.value, clave: f.clave.value, ssl: f.ssl.checked, wan: f.wan.value, id };
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
    try { await enviar(`/api/equipos/${id}`, 'DELETE'); dlg.close(); aviso('Router quitado de Atalaya.'); location.hash = '#/c/' + clienteId; await cargar(true); }
    catch (x) { if (!x.login) msg(x.message); }
  };
}
