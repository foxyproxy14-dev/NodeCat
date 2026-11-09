'use strict';
/* NodeCat: página pública de solo lectura (enlace compartido con un cliente).
   No hay sesión ni botones que cambien nada: solo pide /api/compartido/<token> y lo pinta. */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const nivel = v => v == null ? '' : v >= 90 ? 'alerta' : v >= 75 ? 'aviso' : 'ok';
const TOKEN = location.pathname.split('/').pop();

function durTxt(ms) {
  const min = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(min / 1440), h = Math.floor(min % 1440 / 60), m = min % 60;
  return d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
}
const duracion = t => t ? durTxt(Date.now() - t) : '—';
function cuando(t) {
  if (!t) return '—';
  const d = new Date(t), hh = d.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  if (d.toDateString() === new Date().toDateString()) return `hoy ${hh}`;
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return `ayer ${hh}`;
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' }) + ' ' + hh;
}
const bps = v => {
  if (v == null) return '—';
  for (const [n, d] of [['Gb/s', 1e9], ['Mb/s', 1e6], ['kb/s', 1e3]]) if (v >= d) return `${nf.format(v / d >= 100 ? Math.round(v / d) : Math.round(v / d * 10) / 10)} ${n}`;
  return `${Math.round(v)} b/s`;
};

function chispa(hist, actual) {
  const pts = (hist || []).filter(h => h.cpu != null);
  if (pts.length < 2) return '<svg class="chispa" aria-hidden="true"></svg>';
  const W = 120, H = 30, t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = t => (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * W, y = v => 2 + (1 - v / 100) * (H - 4);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.cpu).toFixed(1)}`).join('');
  const u = pts[pts.length - 1];
  return `<svg class="chispa" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="fondo" d="${d}L${W},${H}L0,${H}Z"/><path d="${d}" vector-effect="non-scaling-stroke"/><circle class="n-${nivel(actual)}" cx="${x(u.t)}" cy="${y(u.cpu)}" r="3.2" vector-effect="non-scaling-stroke"/></svg>`;
}
function medidor(v, sub, etq) {
  if (v == null) return `<span class="medidor" data-etq="${etq}"><span class="valor vacio-valor">—</span></span>`;
  return `<span class="medidor" data-etq="${etq}"><span class="valor">${v}<i>%</i></span><span class="carril n-${nivel(v)}"><span style="width:${Math.min(100, Math.max(0, v))}%"></span></span>${sub ? `<small>${esc(sub)}</small>` : ''}</span>`;
}
const disp = v => v == null ? '<span class="tenue">—</span>' : `<span class="valor">${nf.format(v)}<i>%</i></span><small>últimas 24 h</small>`;
const subEstado = (e, normal) => e.estado === 'caido' ? `Sin respuesta desde ${cuando(e.desde)}` : e.estado === 'pendiente' ? 'Esperando datos' : normal;

function filaServidor(s) {
  const vivo = s.estado === 'ok', v = '<span></span>';
  return `<div class="fila ${s.estado}">
    <span class="f-nombre"><span class="punto ${s.estado}" aria-hidden="true"></span><span><strong>${esc(s.nombre)}</strong><small>${esc(subEstado(s, s.so))}</small></span></span>
    ${vivo && s.cpu != null ? `<span class="f-cpu" data-etq="CPU"><span class="valor">${s.cpu}<i>%</i></span>${chispa(s.historial, s.cpu)}</span>` : '<span class="f-cpu" data-etq="CPU"><span class="valor vacio-valor">—</span></span>'}
    ${vivo ? medidor(s.ramPct, s.ramTotal ? `${nf.format(s.ramUsada)} de ${nf.format(s.ramTotal)} GB` : '', 'Memoria') + medidor(s.disco ? s.disco.pct : null, s.disco ? `${s.disco.unidad} con ${nf.format(s.disco.libre)} GB libres` : '', 'Disco más lleno') : v + v}
    <span class="f-ses" data-etq="Disponibilidad">${disp(s.disponibilidad)}</span>
    <span class="f-up">${vivo ? esc(duracion(s.arranque)) : ''}</span>${v}</div>`;
}
function filaRed(e) {
  const vivo = e.estado === 'ok', v = '<span></span>', caidos = e.wans.filter(w => !w.activa), w = e.wans[0];
  const lat = e.latencia.find(l => l.ms != null);
  const internet = !vivo || !w ? '<span class="tenue">—</span>'
    : caidos.length ? `<b>${esc(caidos.map(x => x.interfaz).join(', '))} caído</b><small>${e.wans.length - caidos.length} de ${e.wans.length} enlaces arriba</small>`
    : w.rx == null ? `<span class="tenue">Midiendo…</span><small>Enlace arriba</small>`
    : `<span><span class="b">↓ ${bps(e.wans.reduce((n, x) => n + (x.rx || 0), 0))}</span>&nbsp;&nbsp;<span class="s">↑ ${bps(e.wans.reduce((n, x) => n + (x.tx || 0), 0))}</span></span><small>${e.wans.length > 1 ? `${e.wans.length} enlaces arriba` : 'Enlace arriba'}${lat ? `, ${Math.round(lat.ms)} ms a ${esc(lat.nombre)}` : ''}</small>`;
  return `<div class="fila rt ${e.estado}">
    <span class="f-nombre"><span class="punto ${e.estado}" aria-hidden="true"></span><span><strong>${esc(e.nombre)}</strong><small>${esc(subEstado(e, e.modelo || (e.tipo === 'fortigate' ? 'FortiGate' : 'MikroTik')))}</small></span></span>
    ${vivo ? medidor(e.cpu, '', 'CPU') + medidor(e.ramPct, '', 'Memoria') : v + v}
    <span class="f-wan ${vivo && caidos.length ? 'caida' : ''}" data-etq="Internet">${internet}</span>
    <span class="f-extra f-ses" data-etq="Disponibilidad">${disp(e.disponibilidad)}</span>
    <span class="f-up">${vivo ? esc(duracion(e.arranque)) : ''}</span>${v}</div>`;
}
const SUCESO = { caida: ['caido', 'Dejó de responder'], vuelta: ['ok', 'Volvió a responder'], reinicio: ['aviso', 'Se reinició'], 'wan-caida': ['caido', 'Se cayó un enlace a Internet'], 'wan-vuelta': ['ok', 'Volvió el enlace a Internet'] };

let datos = null, recibido = 0, falla = null;
function pintar() {
  const el = $('#vista');
  if (falla && !datos) { el.innerHTML = `<div class="titular"><h1>No se puede mostrar</h1></div>${gatoError(esc(falla))}`; return; }
  if (!datos) { el.innerHTML = gatoCargando('Cargando…'); return; }
  const todos = datos.clientes.flatMap(c => [...c.servidores, ...c.red]);
  const caidos = todos.filter(e => e.estado === 'caido').length, enLinea = todos.filter(e => e.estado === 'ok').length;
  const varios = datos.clientes.length > 1;
  const titulo = !todos.length ? 'Todavía no hay equipos.' : caidos ? (caidos === 1 ? 'Un equipo no responde.' : `${caidos} equipos no responden.`) : 'Todo en orden.';
  document.title = `${datos.titulo}, NodeCat`;
  el.innerHTML = `<div class="titular"><h1>${esc(datos.titulo)}</h1>
      <p><b>${esc(titulo)}</b> ${todos.length ? `${enLinea} de ${todos.length} equipos en línea.` : ''}</p>
      <p class="tenue nota-lectura">Vista de solo lectura${datos.vence ? `, disponible hasta el ${new Date(datos.vence).toLocaleDateString('es', { day: 'numeric', month: 'long' })}` : ''}. Se actualiza sola cada 15 segundos.</p></div>
    ${datos.clientes.map(c => `<section class="bloque-cli">
      ${varios ? `<h2 class="cli-titulo">${esc(c.nombre)}</h2>` : ''}
      <div class="dos-col"><div>
        ${c.servidores.length ? `<div class="cab-seccion"><h2>Servidores <span>${c.servidores.length}</span></h2></div>
          <div class="tablero"><div class="tablero-cab" aria-hidden="true"><span>Servidor</span><span>CPU, última hora</span><span>Memoria</span><span>Disco más lleno</span><span>Disponibilidad</span><span class="c-up">Encendido</span><span></span></div>
          ${c.servidores.map(filaServidor).join('')}</div>` : ''}
        ${c.red.length ? `<div class="cab-seccion" style="margin-top:${c.servidores.length ? 36 : 0}px"><h2>Red <span>${c.red.length}</span></h2></div>
          <div class="tablero"><div class="tablero-cab rt" aria-hidden="true"><span>Equipo de red</span><span>CPU</span><span>Memoria</span><span>Internet ahora</span><span class="c-extra">Disponibilidad</span><span class="c-up">Encendido</span><span></span></div>
          ${c.red.map(filaRed).join('')}</div>` : ''}
        ${!c.servidores.length && !c.red.length ? gatoVacio('Sin equipos', 'Todavía no hay equipos vigilados.') : ''}
      </div>
      <aside><div class="cab-seccion"><h2>Últimos sucesos</h2></div><section class="hoja">${c.sucesos.length ? `<ul class="sucesos">${c.sucesos.map(s => { const [k, t] = SUCESO[s.tipo] || ['', s.tipo]; return `<li><span class="punto ${k}" aria-hidden="true"></span><span><b>${esc(s.equipo)}</b>: ${t}</span><small>${cuando(s.t)}</small></li>`; }).join('')}</ul>` : '<div class="vacio">Sin caídas en los últimos 7 días.</div>'}</section></aside>
      </div></section>`).join('')}`;
  document.body.classList.remove('estado-ok', 'estado-alerta'); document.body.classList.add(caidos ? 'estado-alerta' : 'estado-ok');
  if (typeof gatoFavicon === 'function') { const f = $('#favicon'); if (f) f.href = gatoFavicon(caidos ? '#d64545' : '#2f9e5b'); }
}

async function cargar() {
  try {
    const r = await fetch('/api/compartido/' + encodeURIComponent(TOKEN), { cache: 'no-store', credentials: 'omit' });
    const o = await r.json().catch(() => ({}));
    if (!r.ok) { falla = o.error || 'No se pudo cargar.'; if (r.status === 404) datos = null; }
    else { datos = o; falla = null; recibido = Date.now(); }
  } catch { falla = 'Sin conexión con NodeCat. Se reintentará.'; }
  pintar();
  reloj();
}
const hora12 = t => new Date(t).toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
function reloj() {
  const rel = $('#reloj'); if (!rel) return;
  rel.innerHTML = `<b class="hora-actual">${esc(hora12(Date.now()))}</b>` + esc(falla && datos ? falla : recibido ? 'Actualizado a las ' + hora12(recibido) : '');
}
setInterval(reloj, 1000);

const g = $('#barraGato'); if (g && typeof gatoSVG === 'function') g.innerHTML = gatoSVG('reparando');
$('#btnTema').addEventListener('click', () => {
  const oscuro = document.documentElement.dataset.tema ? document.documentElement.dataset.tema === 'oscuro' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.tema = oscuro ? 'claro' : 'oscuro';
  try { localStorage.setItem('tema', document.documentElement.dataset.tema); } catch { }
});
pintar(); cargar();
setInterval(cargar, 15000);
