/* NodeCat: logs guardados de un FortiGate (sección Registros de la página del equipo). Solo lectura. */
'use strict';

const RANGOS_LOG = [['1h', '1 h', 3600e3], ['24h', '24 h', 864e5], ['7d', '7 días', 7 * 864e5], ['30d', '30 días', 30 * 864e5], ['todo', 'Todo', 0]];
const ICONO_MARCA = { 'acceso-fallido': '🚨', acceso: '🔑', usuario: '👤', config: '⚙️', 'vpn-fallido': '⛔', 'vpn-caido': '🔌', ataque: '🛡️', virus: '🦠', ha: '🔁', reinicio: '🔄', memoria: '🧠', critico: '❗' };
const NIVEL_MARCA = { 'acceso-fallido': 'alerta', usuario: 'alerta', ataque: 'alerta', virus: 'alerta', ha: 'alerta', reinicio: 'alerta', memoria: 'alerta', critico: 'alerta', 'vpn-fallido': 'aviso', 'vpn-caido': 'aviso', acceso: 'info', config: 'info' };
const LOSAS_MARCA = ['acceso-fallido', 'acceso', 'usuario', 'config', 'ataque', 'virus', 'vpn-fallido', 'vpn-caido'];
const nivelClase = n => /^(emergency|alert|critical|error)$/i.test(n || '') ? 'alerta' : /warning/i.test(n || '') ? 'aviso' : /notice/i.test(n || '') ? 'info' : '';
const NIVEL_TXT = { emergency: 'Emergencia', alert: 'Alerta', critical: 'Crítico', error: 'Error', warning: 'Advertencia', notice: 'Aviso', information: 'Info', debug: 'Depuración' };

function filtroLogs() { return rt.logs || (rt.logs = { rango: '24h', q: '', nivel: '', accion: '', marca: '' }); }

async function vistaLogs(silencioso, mas) {
  const cuerpo = $('#rtCuerpo'), id = rt.id, pest = rt.pestana;
  const cat = pest === 'logs-resumen' || pest === 'logs-todos' ? '' : pest.slice(5);
  const f = filtroLogs(), rango = RANGOS_LOG.find(r => r[0] === f.rango) || RANGOS_LOG[1];
  if (!silencioso && !mas) cuerpo.innerHTML = gatoCargando('Buscando en los logs…');
  const qs = new URLSearchParams({ cat, limite: '100' });
  if (rango[2]) qs.set('desde', String(Date.now() - rango[2]));
  if (f.q) qs.set('q', f.q); if (f.nivel) qs.set('nivel', f.nivel); if (f.accion && cat) qs.set('accion', f.accion);
  if (f.marca && pest === 'logs-todos') qs.set('marca', f.marca);
  if (mas) qs.set('antes', String(mas));
  let d;
  try { d = await api(`/api/routers/${id}/logs?${qs}`); } catch (x) { if (!x.login && !mas) cuerpo.innerHTML = gatoError(esc(x.message)); return; }
  if (rt.id !== id || rt.pestana !== pest) return;
  rt.logsT = Date.now();
  if (mas) { const tb = cuerpo.querySelector('#logsFilas'); if (tb) { tb.insertAdjacentHTML('beforeend', d.filas.map(filaLog).join('')); rt.logsUltimo = d.filas.length ? d.filas[d.filas.length - 1].t : rt.logsUltimo; cuerpo.querySelector('[data-logs-mas]').hidden = !d.mas; } return; }
  const e = equipo(id);
  if (!d.config.activo && !d.total) {
    cuerpo.innerHTML = `<div class="logs-apagados">${gatoError('<b>Este FortiGate todavía no guarda logs.</b> Actívalo en Editar → Logs: elige cuántos días guardarlos y qué categorías. NodeCat los irá juntando cada 2 minutos y te avisará de lo importante.')}
      ${esAdmin() ? '<button class="btn prim" type="button" data-logs-activar>Activar los logs</button>' : ''}</div>`;
    const b = cuerpo.querySelector('[data-logs-activar]'); if (b) b.onclick = () => dialogoForti(e.cliente, id);
    return;
  }
  const foco = document.activeElement && document.activeElement.id === 'logsBuscar';
  cuerpo.innerHTML = barraLogs(d, cat, f) + (pest === 'logs-resumen' ? resumenLogs(d) : tablaLogs(d, cat));
  rt.logsUltimo = d.filas.length ? d.filas[d.filas.length - 1].t : null;
  const q = cuerpo.querySelector('#logsBuscar');
  if (q) { if (foco) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } let reloj; q.oninput = () => { clearTimeout(reloj); reloj = setTimeout(() => { f.q = q.value.trim(); vistaLogs(true); }, 350); }; }
  cuerpo.onclick = ev => {
    const r = ev.target.closest('[data-rango-log]'); if (r) { f.rango = r.dataset.rangoLog; vistaLogs(); return; }
    if (ev.target.closest('[data-logs-act]')) { vistaLogs(true); return; }
    if (ev.target.closest('[data-logs-mas]')) { const b = ev.target.closest('[data-logs-mas]'); ocupado(b, 'Cargando…', () => vistaLogs(true, rt.logsUltimo)); return; }
    const m = ev.target.closest('[data-marca]'); if (m) { f.marca = m.dataset.marca; f.q = ''; irSeccionRt('logs-todos'); return; }
    const qm = ev.target.closest('[data-quitar-marca]'); if (qm) { f.marca = ''; vistaLogs(); return; }
    const fila = ev.target.closest('[data-log]'); if (fila) detalleLog(id, fila.dataset.log);
  };
  cuerpo.onchange = ev => {
    if (ev.target.name === 'logsNivel') { f.nivel = ev.target.value; vistaLogs(true); }
    if (ev.target.name === 'logsAccion') { f.accion = ev.target.value; vistaLogs(true); }
  };
  cuerpo.onkeydown = ev => { const fila = ev.target.closest('[data-log]'); if (fila && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); detalleLog(id, fila.dataset.log); } };
}

function barraLogs(d, cat, f) {
  const mb = d.tamano / 1048576;
  return `<div class="logs-barra">
      <div class="segmentos" role="group" aria-label="Periodo">${RANGOS_LOG.map(([k, t]) => `<button type="button" data-rango-log="${k}" aria-pressed="${f.rango === k}">${t}</button>`).join('')}</div>
      <label class="buscar">${ICO.lupa}<span class="sr">Buscar en los logs</span><input type="search" id="logsBuscar" value="${esc(f.q)}" placeholder="Buscar IP, usuario, mensaje…"></label>
      <select class="selector" name="logsNivel" aria-label="Nivel"><option value="">Todos los niveles</option><option value="problemas" ${f.nivel === 'problemas' ? 'selected' : ''}>Advertencias y errores</option></select>
      ${cat && d.acciones.length ? `<select class="selector" name="logsAccion" aria-label="Acción"><option value="">Todas las acciones</option>${d.acciones.map(a => `<option value="${esc(a.accion)}" ${f.accion === a.accion ? 'selected' : ''}>${esc(a.accion)} (${nf.format(a.n)})</option>`).join('')}</select>` : ''}
      <button class="btn" type="button" data-logs-act>Actualizar</button>
    </div>
    <p class="logs-estado">${d.config.activo ? `<span class="punto ${d.error ? 'aviso' : 'ok'}" aria-hidden="true"></span>${d.ultima ? `Última lectura ${cuando(d.ultima)}` : 'Esperando la primera lectura'}` : '<span class="punto" aria-hidden="true"></span>Recolección apagada'}.
      ${nf.format(d.total)} registros guardados${d.desdeGuardado ? ` desde ${hora(d.desdeGuardado)}` : ''} (~${mb < 1 ? '<1' : nf.format(Math.round(mb))} MB), se guardan ${d.config.dias === 1 ? '1 día' : d.config.dias + ' días'}.
      ${d.error ? `<span class="tenue">Último problema al leer: ${esc(d.error)}</span>` : ''}</p>`;
}

function resumenLogs(d) {
  const M = d.marcas || {}, N = d.nombresMarca || {};
  const losas = LOSAS_MARCA.map(k => `<button type="button" class="logs-losa ${M[k] && NIVEL_MARCA[k] !== 'info' ? NIVEL_MARCA[k] : ''}" data-marca="${k}">
      <span class="logs-losa-ico" aria-hidden="true">${ICONO_MARCA[k]}</span><span class="logs-losa-n">${nf.format(M[k] || 0)}</span><span class="logs-losa-t">${esc(N[k] || k)}</span></button>`).join('');
  const top = (t, l, vacio) => `<section class="logs-top"><h4>${t}</h4>${l && l.length ? `<ol>${l.map(x => `<li><span>${esc(x.v)}</span><b>${nf.format(x.n)}</b></li>`).join('')}</ol>` : `<p class="tenue">${vacio}</p>`}</section>`;
  const r = d.resumen || {};
  return `<div class="logs-losas">${losas}</div>
    <div class="logs-dos">
      <section class="pm-caja logs-linea"><div class="pm-caja-cab"><h3>Lo último que pasó</h3><button type="button" class="enlace" data-marca="todas">Ver todo lo marcado</button></div>
        ${d.importantes.length ? `<ol class="logs-tl">${agrupar(d.importantes).map(x => `<li class="${NIVEL_MARCA[x.marca] || ''}" data-log="${x.id}" tabindex="0" role="button" aria-label="Ver el detalle">
          <span class="logs-tl-ico" aria-hidden="true">${ICONO_MARCA[x.marca] || '•'}</span>
          <div><b>${esc(N[x.marca] || x.marca)}</b>${x.veces > 1 ? ` <span class="logs-veces">×${x.veces}</span>` : ''}${x.usuarios ? ` · ${esc(x.usuarios)}` : x.usuario ? ` · ${esc(x.usuario)}` : ''}${x.origen ? ` · desde ${esc(x.origen)}` : ''}<p>${esc(x.mensaje || '')}</p></div>
          <time>${hora(x.t)}</time></li>`).join('')}</ol>` : '<div class="vacio">Nada importante en este periodo. El soplón está tranquilo.</div>'}</section>
      <div class="logs-tops">
        ${top('IP con más accesos fallidos', r.fallidosIp, 'Ningún acceso fallido.')}
        ${top('Usuarios que intentaron entrar', r.fallidosUsuario, 'Ninguno.')}
        ${top('Ataques más frecuentes', r.ataques, 'Ningún ataque detectado.')}
        ${top('Usuarios con VPN fallida', r.vpnFallidos, 'Ninguno.')}
      </div>
    </div>`;
}

// Seguidos del mismo tipo y origen (p. ej. una ráfaga de accesos fallidos) se muestran en una sola línea
function agrupar(l) {
  const out = [];
  for (const x of l) {
    const p = out[out.length - 1];
    if (p && p.marca === x.marca && p.origen === x.origen && p.t - x.t < 30 * 60000) { p.veces++; p.us.add(x.usuario); p.usuarios = [...p.us].filter(Boolean).slice(0, 4).join(', '); }
    else out.push({ ...x, veces: 1, us: new Set([x.usuario]) });
  }
  return out;
}
function filaLog(x) {
  const nc = nivelClase(x.nivel);
  return `<tr data-log="${x.id}" tabindex="0" class="${x.marca ? 'marcada ' + (NIVEL_MARCA[x.marca] || '') : ''}">
    <td class="logs-hora">${x.marca ? `<span class="logs-marca" title="${esc(x.marca)}" aria-hidden="true">${ICONO_MARCA[x.marca] || ''}</span>` : ''}${hora(x.t)}</td>
    <td><span class="logs-nivel ${nc}">${esc(NIVEL_TXT[(x.nivel || '').toLowerCase()] || x.nivel || '—')}</span></td>
    <td>${esc(x.sub || '')}</td><td>${esc(x.accion || '')}</td>
    <td class="mono">${esc(x.origen || '')}</td><td class="mono">${esc(x.destino || '')}</td><td>${esc(x.usuario || '')}</td>
    <td class="logs-msg">${esc(x.mensaje || '')}</td></tr>`;
}
function tablaLogs(d, cat) {
  const f = filtroLogs();
  const chip = f.marca && rt.pestana === 'logs-todos' ? `<div class="logs-chip">Mostrando: <b>${esc(f.marca === 'todas' ? 'todo lo marcado como importante' : (d.nombresMarca[f.marca] || f.marca))}</b> <button type="button" data-quitar-marca aria-label="Quitar el filtro">×</button></div>` : '';
  if (cat && !d.config.cats.includes(cat)) return chip + `<div class="vacio">Esta categoría no se está guardando. Actívala en Editar → Logs.</div>`;
  if (!d.filas.length) return chip + `<div class="vacio">${d.ultima ? 'No hay registros con estos filtros.' : 'Todavía no llegó la primera lectura. Dale un par de minutos.'}</div>`;
  return chip + `<section class="hoja desliza"><table class="tabla-rt logs-tabla"><thead><tr><th>Fecha y hora</th><th>Nivel</th><th>Tipo</th><th>Acción</th><th>Origen</th><th>Destino</th><th>Usuario</th><th>Mensaje</th></tr></thead>
    <tbody id="logsFilas">${d.filas.map(filaLog).join('')}</tbody></table></section>
    <div class="logs-pie"><button class="btn" type="button" data-logs-mas ${d.mas ? '' : 'hidden'}>Cargar más antiguos</button></div>`;
}

async function detalleLog(id, fila) {
  let d; try { d = (await api(`/api/routers/${id}/logs/${fila}`)).log; } catch (x) { if (!x.login) aviso(x.message, true); return; }
  const prim = ['date', 'time', 'level', 'type', 'subtype', 'action', 'status', 'logdesc', 'msg', 'user', 'srcip', 'srcport', 'srcintf', 'dstip', 'dstport', 'dstintf', 'hostname', 'url', 'attack', 'virus', 'app', 'policyid', 'cfgpath', 'cfgobj', 'cfgattr', 'ui'];
  const claves = [...prim.filter(k => d[k] != null && d[k] !== ''), ...Object.keys(d).filter(k => !prim.includes(k) && d[k] != null && d[k] !== '').sort()];
  libre(`<h3>${esc(d.logdesc || d.msg || 'Registro')}</h3><p class="tenue" style="margin-top:-6px">${esc(`${d.date || ''} ${d.time || ''}`)}${d.logid ? ` · logid ${esc(d.logid)}` : ''}</p>
    <div class="logs-detalle"><table class="tabla-dlg"><tbody>${claves.map(k => `<tr><th>${esc(k)}</th><td class="mono">${esc(typeof d[k] === 'object' ? JSON.stringify(d[k]) : String(d[k]))}</td></tr>`).join('')}</tbody></table></div>
    <div class="pie"><button class="btn prim" type="button" data-cerrar>Cerrar</button></div>`, true);
}
