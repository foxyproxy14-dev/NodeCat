/* NodeCat: pestañas de Proxmox al estilo de ProxMenux (Apps editables, VM y LXC, Red, Almacenamiento).
   Todo es de solo lectura sobre el equipo: lo único que se guarda (nombres, enlaces y logos de las apps) vive en NodeCat. */
'use strict';

const slugApp = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const vmFiltro = new Map(), appsOcultas = new Map(), redIfz = new Map(), redTrafico = new Map();
const pct = (a, b) => b ? Math.max(0, Math.min(100, Math.round(a / b * 1000) / 10)) : 0;
const barra = (p, clase = '') => `<span class="pm-barra ${clase}"><span style="width:${Math.max(p > 0 ? 1.5 : 0, Math.min(100, p))}%"></span></span>`;
const bytesTxt = b => b == null ? '—' : b >= 1024 ** 4 ? `${nf.format(Math.round(b / 1024 ** 4 * 100) / 100)} TB` : b >= 1024 ** 3 ? `${nf.format(Math.round(b / 1024 ** 3 * 10) / 10)} GB` : b >= 1024 ** 2 ? `${nf.format(Math.round(b / 1024 ** 2))} MB` : `${nf.format(Math.round((b || 0) / 1024))} KB`;
const icoPm = {
  disco: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
  hdd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13h18l-2.5-7h-13z"/><rect x="3" y="13" width="18" height="6" rx="1.5"/><path d="M7 16h.01M11 16h.01"/></svg>',
  red: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M5 16v-2h14v2"/></svg>',
  lapiz: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>',
  mas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
};

/* ---------------- Apps ---------------- */
function appsUnidas(d) {
  const per = new Map((d.personal || []).map(p => [p.clave, p]));
  const l = (Array.isArray(d.apps) ? d.apps : []).map(a => {
    const p = per.get(String(a.id)) || {};
    return { ...a, clave: String(a.id), app: p.nombre || a.app, url: p.url || a.url, categoria: p.categoria || a.categoria, oculta: !!p.oculta, logo: p.logo || null, editada: per.has(String(a.id)) };
  });
  for (const p of d.personal || []) if (/^m/.test(p.clave)) l.push({ clave: p.clave, id: '', manual: true, app: p.nombre, nombre: p.nombre, url: p.url, categoria: p.categoria, oculta: !!p.oculta, logo: p.logo, estado: 'running', ips: [] });
  return l;
}
function logoDe(a, logos) {
  const set = new Set(logos || []);
  for (const k of [a.logo, slugApp(a.app), slugApp(a.nombre)]) {
    if (!k) continue;
    const f = ['svg', 'png', 'webp'].map(e => `${k}.${e}`).find(f => set.has(f));
    if (f) return `/logos/apps/${f}`;
  }
  return null;
}
function seccionApps(s, d) {
  if (d.apps && d.apps.error) return `<div class="msg atencion">No se pudo leer las apps: ${esc(d.apps.error)}</div>`;
  if (d.apps == null) return gatoCargando('Leyendo las apps…');
  const todas = appsUnidas(d), verOcultas = appsOcultas.get(s.id);
  const ocultas = todas.filter(a => a.oculta).length;
  const l = todas.filter(a => verOcultas || !a.oculta);
  const orden = [...l].sort((a, b) => (a.app ? 0 : 1) - (b.app ? 0 : 1) || (a.estado === 'running' ? 0 : 1) - (b.estado === 'running' ? 0 : 1) || String(a.app || a.nombre).localeCompare(String(b.app || b.nombre), 'es'));
  const cats = [...new Set(todas.map(a => a.categoria).filter(Boolean))].sort();
  const on = todas.filter(a => !a.oculta && a.estado === 'running').length;
  const ini = t => esc(String(t || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?');
  return `<div class="apps-barra"><label class="buscar">${ICO.lupa}<span class="sr">Buscar app o CT</span><input type="search" id="buscarApp" placeholder="Buscar app, CT o IP"></label>
      <select class="selector" id="catApp"><option value="">Todas las categorías</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select>
      ${ocultas ? `<button class="btn" type="button" data-pm="ocultas" aria-pressed="${!!verOcultas}">${verOcultas ? 'Esconder las ocultas' : `Ver ocultas (${ocultas})`}</button>` : ''}
      ${esAdmin() ? `<button class="btn prim" type="button" data-pm="app-nueva">${icoPm.mas}Agregar app</button>` : ''}</div>
    <p class="tenue apps-nota">${plural(on, 'app encendida', 'apps encendidas')} de ${todas.length - ocultas}. ${esAdmin() ? 'Con el lápiz cambias el nombre, el enlace, la categoría y el logo de cada una; los logos se guardan una vez y sirven para todos los servidores.' : ''}</p>
    <div class="apps-rejilla">${orden.map(a => {
      const logo = logoDe(a, d.logosApps), enc = a.estado === 'running';
      return `<article class="app-tarjeta ${enc ? '' : 'apagada'} ${a.oculta ? 'oculta' : ''}" data-buscar="${esc([a.app, a.nombre, a.id, ...(a.ips || []), ...(a.etiquetas || []), a.url].join(' ').toLowerCase())}" data-cat="${esc(a.categoria || '')}">
        <div class="app-cab">${logo ? `<img class="app-logo" src="${esc(logo)}" alt="" loading="lazy">` : `<span class="app-icono" aria-hidden="true">${ini(a.app || a.nombre)}</span>`}
          <div class="app-titulo"><strong>${esc(a.app || a.nombre)}</strong><small>${a.manual ? 'Agregada a mano' : `<span class="punto ${enc ? 'ok' : 'caido'}" aria-hidden="true"></span>${enc ? 'En ejecución' : 'Detenida'}${a.oculta ? ', oculta' : ''}`}</small></div>
          ${esAdmin() ? `<button class="pm-icobtn" type="button" data-pm="app-editar" data-clave="${esc(a.clave)}" title="Editar ${esc(a.app || a.nombre)}" aria-label="Editar ${esc(a.app || a.nombre)}">${icoPm.lapiz}</button>` : ''}</div>
        ${a.url ? `<a class="app-url" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.url.replace(/\/$/, ''))}</a>` : a.ips && a.ips.length ? `<span class="app-url sin">${esc(a.ips.join(', '))}</span>` : '<span class="app-url sin tenue">Sin dirección</span>'}
        <div class="app-pie"><span>${a.manual ? '' : `<b>${esc(a.id)}</b> ${esc(a.nombre)}`}</span>${a.categoria ? `<span class="chip-hv vm">${esc(a.categoria)}</span>` : a.manual ? '' : `<span class="pm-tipo ${a.tipo === 'lxc' ? 'lxc' : 'vm'}">${a.tipo === 'lxc' ? 'LXC' : 'VM'}</span>`}</div>
      </article>`; }).join('')}</div>`;
}
function editarApp(s, d, clave) {
  const a = clave ? appsUnidas(d).find(x => x.clave === clave) : { manual: true, clave: '' };
  if (!a) return;
  const logoActual = clave ? logoDe(a, d.logosApps) : null;
  const dlg = libre(`<h2>${clave ? `Editar ${esc(a.app || a.nombre)}` : 'Agregar una app'}</h2>
    ${a.manual ? '' : `<p class="tenue" style="margin-top:-6px">${a.tipo === 'lxc' ? 'Contenedor' : 'VM'} ${esc(a.id)} (${esc(a.nombre)}). Lo que cambies aquí se guarda solo en NodeCat; en Proxmox no se toca nada.</p>`}
    <form id="fApp">
      <label class="campo"><span>Nombre de la app</span><input name="nombre" maxlength="80" value="${esc(a.app || '')}" placeholder="${esc(a.nombre || 'Ej. Jellyfin')}" ${a.manual ? 'required' : ''}></label>
      <label class="campo"><span>Enlace</span><input name="url" maxlength="300" inputmode="url" value="${esc(a.url || '')}" placeholder="http://10.20.20.15:8096"></label>
      <label class="campo"><span>Categoría</span><input name="categoria" maxlength="40" value="${esc(a.categoria || '')}" placeholder="Ej. Multimedia" list="catsApp"><datalist id="catsApp">${[...new Set(appsUnidas(d).map(x => x.categoria).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <div class="campo"><span>Logo</span><div class="pm-logo-campo">${logoActual ? `<img src="${esc(logoActual)}" alt="Logo actual" class="app-logo">` : '<span class="app-icono" aria-hidden="true">?</span>'}
        <label class="btn">Subir imagen<input type="file" name="logo" accept="image/svg+xml,image/png,image/webp" hidden></label><small class="tenue" id="logoNombre">SVG, PNG o WebP, hasta 512 KB.</small></div></div>
      ${a.manual ? '' : `<label class="grupo"><input type="checkbox" name="oculta" ${a.oculta ? 'checked' : ''}> Ocultar esta app de la lista</label>`}
      <div class="pie">${clave && (a.manual || a.editada) ? `<button class="btn peligro" type="button" id="appQuitar">${a.manual ? 'Eliminar' : 'Volver a lo detectado'}</button>` : ''}<span style="flex:1"></span>
        <button class="btn" type="button" data-cerrar>Cancelar</button><button class="btn prim" type="submit">Guardar</button></div>
    </form>`);
  const f = dlg.querySelector('#fApp'), archivo = f.logo;
  archivo.onchange = () => { dlg.querySelector('#logoNombre').textContent = archivo.files[0] ? archivo.files[0].name : 'SVG, PNG o WebP, hasta 512 KB.'; };
  const recargar = () => { pveCache.delete(s.id); vistaEquipo(s.id); };
  const q = dlg.querySelector('#appQuitar');
  if (q) q.onclick = () => ocupado(q, 'Quitando…', async () => { await api(`/api/equipos/${s.id}/apps/${encodeURIComponent(clave)}`, { method: 'DELETE' }); dlg.close(); recargar(); });
  f.onsubmit = ev => { ev.preventDefault(); const b = f.querySelector('[type=submit]'); ocupado(b, 'Guardando…', async () => {
    try {
      const nombre = f.nombre.value.trim();
      let logo = a.logo || null;
      if (archivo.files[0]) {
        const fl = archivo.files[0]; if (fl.size > 512 * 1024) throw new Error('El logo debe pesar menos de 512 KB.');
        const datos = await new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = mal; r.readAsDataURL(fl); });
        const k = slugApp(nombre || a.app || a.nombre); if (!k) throw new Error('Escribe el nombre de la app para guardar su logo.');
        logo = (await enviar(`/api/logos-apps/${encodeURIComponent(k)}`, 'PUT', { datos })).logo.replace(/\.\w+$/, '');
      }
      const cuerpo = { nombre, url: f.url.value.trim(), categoria: f.categoria.value.trim(), oculta: f.oculta ? f.oculta.checked : false, logo };
      if (clave) await enviar(`/api/equipos/${s.id}/apps/${encodeURIComponent(clave)}`, 'PUT', cuerpo);
      else await enviar(`/api/equipos/${s.id}/apps`, 'POST', cuerpo);
      dlg.close(); aviso(clave ? 'App guardada.' : 'App agregada.'); recargar();
    } catch (e) { aviso(e.message, true); }
  }); };
}

/* ---------------- VM y LXC ---------------- */
const ESTADO_PM = { running: ['ok', 'En ejecución'], stopped: ['caido', 'Detenido'], paused: ['aviso', 'En pausa'], suspended: ['aviso', 'Suspendido'], saved: ['aviso', 'Guardado'] };
function colorEtiqueta(t) { let h = 0; for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 55% 50%)`; }
function seccionVms(s, vivo, d) {
  const vms = (s.vms || []).slice();
  if (!vms.length) return s.errorVms ? `<div class="msg atencion"><b>No se pudo leer la lista de máquinas virtuales.</b> ${esc(s.errorVms)}</div>` : '<div class="vacio">No hay máquinas virtuales.</div>';
  const apps = new Map(((d && Array.isArray(d.apps)) ? d.apps : []).map(a => [String(a.id), a]));
  const pve = s.tipo === 'proxmox';
  const on = vms.filter(v => v.estado === 'running'), nVm = vms.filter(v => v.tipo !== 'lxc'), nLxc = vms.filter(v => v.tipo === 'lxc');
  const cpuAsig = vms.reduce((n, v) => n + (v.cpus || 0), 0), cpuOn = on.reduce((n, v) => n + (v.cpus || 0), 0), hilos = s.nucleos || null;
  const ramUsada = on.reduce((n, v) => n + (v.ram || 0), 0), ramAsig = vms.reduce((n, v) => n + (v.ramMax || 0), 0), ramHost = s.ramTotal ? s.ramTotal * 1024 ** 3 : null;
  const dUsado = vms.reduce((n, v) => n + (v.disco || 0), 0), dAsig = vms.reduce((n, v) => n + (v.discoMax || 0), 0);
  const f = vmFiltro.get(s.id) || 'todos';
  const lista = vms.sort((a, b) => (a.estado === 'running' ? 0 : 1) - (b.estado === 'running' ? 0 : 1) || (Number(a.id) || 0) - (Number(b.id) || 0) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
  const tarjeta = v => {
    const [k, t] = ESTADO_PM[v.estado] || ['', v.estado || '—'];
    const enc = v.estado === 'running', ap = apps.get(String(v.id));
    const rp = v.ramMax ? pct(v.ram || 0, v.ramMax) : 0, dp = v.discoMax && v.disco ? pct(v.disco, v.discoMax) : null;
    const tipo = v.tipo === 'lxc' ? 'LXC' : 'VM';
    return `<article class="pm-vm ${enc ? '' : 'detenida'}" data-buscar="${esc([v.nombre, v.id, ...(ap && ap.ips || []), ...(v.ips || []), ...(v.etiquetas || [])].join(' ').toLowerCase())}" data-est="${enc ? 'on' : 'off'}">
      <header><span class="pm-estado ${k}"><span class="punto ${k}" aria-hidden="true"></span>${t}</span><span class="pm-tipo ${v.tipo === 'lxc' ? 'lxc' : 'vm'}">${tipo}</span>
        <h3>${esc(v.nombre)}</h3>${pve && v.id ? `<span class="pm-id">ID: ${esc(v.id)}</span>` : ''}</header>
      ${(v.etiquetas || []).length ? `<div class="pm-etiquetas">${v.etiquetas.map(e => `<span><i style="background:${colorEtiqueta(e)}"></i>${esc(e)}</span>`).join('')}</div>` : ''}
      <dl class="pm-datos">
        <div><dt>Encendida</dt><dd>${enc && v.uptime ? esc(durTxt(v.uptime * 1000)) : '—'}</dd></div>
        <div><dt>IP</dt><dd class="mono">${ap && ap.ips && ap.ips.length ? esc(ap.ips[0]) : v.ips && v.ips.length ? esc(v.ips.join(', ')) : '—'}</dd></div>
        <div class="ancho"><dt>CPU</dt><dd>${enc && v.cpu != null ? `${nf.format(Math.round(v.cpu * 10) / 10)} %` : '0 %'} <small>de ${v.cpus || '?'} ${v.cpus === 1 ? 'núcleo' : 'núcleos'}</small></dd>${barra(enc ? v.cpu || 0 : 0, 'cpu')}</div>
        <div class="ancho"><dt>Memoria</dt>${v.ramFija ? `<dd>${bytesTxt(v.ramMax || v.ram)} <small>asignada (fija): Hyper-V no sabe cuánta usa por dentro</small></dd>` : `<dd>${enc ? bytesTxt(v.ram) : '0'} <small>/ ${bytesTxt(v.ramMax)}${v.tipo === 'hyperv' && enc ? ' (memoria dinámica: lo que pide la VM)' : ''}</small></dd>${barra(enc ? rp : 0, 'ram n-' + nivel(rp))}`}</div>
        <div class="ancho"><dt>Disco</dt><dd>${v.disco ? bytesTxt(v.disco) + ' <small>/ ' + bytesTxt(v.discoMax) + '</small>' : `<small>${bytesTxt(v.discoMax)} asignado</small>`}</dd>${dp != null ? barra(dp, 'dsk n-' + nivel(dp)) : ''}</div>
        ${v.diskread != null || v.netin != null ? `<div><dt>E/S de disco</dt><dd class="pm-io"><span class="b">↓ ${bytesTxt(v.diskread || 0)}</span><span class="s">↑ ${bytesTxt(v.diskwrite || 0)}</span></dd></div>
        <div><dt>E/S de red</dt><dd class="pm-io"><span class="b">↓ ${bytesTxt(v.netin || 0)}</span><span class="s">↑ ${bytesTxt(v.netout || 0)}</span></dd></div>` : ''}
      </dl></article>`;
  };
  return `<div class="pm-losas">
      <section class="pm-losa"><h3>Total de ${pve ? 'VM y LXC' : 'VM'}</h3><div class="pm-grande">${vms.length}</div>
        <div class="hv-chips"><span class="chip-hv ok">${on.length} en ejecución</span>${vms.length - on.length ? `<span class="chip-hv">${vms.length - on.length} detenidas</span>` : ''}</div>
        ${pve ? `<p class="pm-pie">${plural(nVm.length, 'VM', 'VM')}, ${nLxc.length} LXC</p>` : ''}</section>
      <section class="pm-losa"><h3>CPU asignada</h3><div class="pm-grande">${cpuOn}<i>núcleos en uso</i></div>${hilos ? barra(pct(cpuOn, hilos), 'cpu') : ''}
        <p class="pm-pie">${cpuAsig} asignados en total${hilos ? `, el host tiene ${hilos} hilos${cpuAsig > hilos ? ' (sobreasignado)' : ''}` : ''}</p></section>
      <section class="pm-losa"><h3>Memoria</h3><div class="pm-grande">${bytesTxt(ramUsada)}<i>en uso</i></div>${barra(pct(ramUsada, ramAsig), 'ram')}
        <div class="pm-filas"><span>Asignada</span><b>${bytesTxt(ramAsig)}</b>${ramHost ? `<span>Total del host</span><b>${bytesTxt(ramHost)}</b>` : ''}</div></section>
      <section class="pm-losa"><h3>Disco</h3><div class="pm-grande">${dUsado ? bytesTxt(dUsado) : bytesTxt(dAsig)}<i>${dUsado ? 'en uso' : 'asignado'}</i></div>${dUsado ? barra(pct(dUsado, dAsig), 'dsk') : ''}
        <div class="pm-filas"><span>Asignado</span><b>${bytesTxt(dAsig)}</b></div>${pve && dUsado ? '<p class="pm-pie">Proxmox solo informa el uso real de los LXC.</p>' : ''}</section>
    </div>
    <div class="apps-barra pm-vm-barra"><label class="buscar">${ICO.lupa}<span class="sr">Buscar VM o LXC</span><input type="search" id="buscarVm" placeholder="Buscar por nombre, ID, IP o etiqueta"></label>
      <div class="pm-filtro" role="group" aria-label="Filtrar por estado">${[['todos', 'Todos', vms.length], ['on', 'En ejecución', on.length], ['off', 'Detenido', vms.length - on.length]].map(([k, t, n]) => `<button type="button" data-pm="vm-filtro" data-f="${k}" aria-pressed="${f === k}" class="${f === k ? 'activa' : ''}">${t} <span>${n}</span></button>`).join('')}</div></div>
    ${s.errorVms ? `<div class="msg atencion"><b>No se pudo leer la lista completa.</b> ${esc(s.errorVms)}</div>` : ''}
    <div class="pm-vms">${lista.map(tarjeta).join('')}</div>`;
}
function filtrarVms(cont, s) {
  const q = ((cont.querySelector('#buscarVm') || {}).value || '').trim().toLowerCase(), f = vmFiltro.get(s.id) || 'todos';
  cont.querySelectorAll('.pm-vm').forEach(t => { t.hidden = !(t.dataset.buscar.includes(q) && (f === 'todos' || t.dataset.est === f)); });
}

/* ---------------- Red ---------------- */
function seccionRed(s, d) {
  const r = d.red, hv = s.tipo !== 'proxmox', PUENTE = hv ? 'Conmutador' : 'Puente', PUENTES = hv ? 'Conmutadores virtuales' : 'Puentes';
  if (!r) return `<div class="vacio">${hv ? 'Este agente todavía no informa la red de Hyper-V. Instala el agente de Windows 1.5.2 o más nuevo en el host; la red se lee cada 5 minutos.' : d.nodo ? 'Este agente todavía no informa la red del host. Se actualiza solo a la versión nueva en unos minutos.' : gatoCargando('Leyendo la red…')}</div>`;
  const ifz = r.interfaces || [];
  const fis = ifz.filter(i => i.tipo === 'fisica'), pts = ifz.filter(i => i.tipo === 'puente'), inv = ifz.filter(i => i.tipo === 'invitado');
  const up = i => i.estado === 'up' || i.estado === 'unknown';
  const fisUp = fis.filter(up).length, ptsUp = pts.filter(up).length;
  const errores = ifz.reduce((n, i) => n + (i.errores || 0), 0), desc = ifz.reduce((n, i) => n + (i.descartados || 0), 0);
  const lat = r.latencia;
  const nombres = new Map((s.vms || []).map(v => [String(v.id), v]));
  // Tráfico 24 h: de la interfaz elegida (por defecto el puente principal)
  const tr = redTrafico.get(s.id), opc = (tr && tr.interfaces) || [];
  const elegida = redIfz.get(s.id) || (opc.includes('vmbr0') ? 'vmbr0' : opc[0]) || null;
  if ((!tr || Date.now() - tr.t > 60000 || tr.interfaz !== elegida) && !(tr && tr.pidiendo)) {
    redTrafico.set(s.id, { ...(tr || {}), pidiendo: true });
    api(`/api/equipos/${s.id}/trafico?rango=24h${elegida ? '&interfaz=' + encodeURIComponent(elegida) : ''}`).then(x => {
      const nueva = !elegida && x.interfaces.length;
      redTrafico.set(s.id, { t: nueva ? 0 : Date.now(), ...x });
      if (rutaActual().vista === 'equipo' && rutaActual().id === s.id) vistaEquipo(s.id);
    }).catch(() => redTrafico.set(s.id, { t: Date.now(), interfaces: [], puntos: [] }));
  }
  const puntos = (tr && tr.interfaz === elegida && tr.puntos) || [];
  const paso = (tr && tr.paso) || 60000;
  const totRx = puntos.reduce((n, p) => n + (p.rx || 0) * paso / 1000 / 8, 0), totTx = puntos.reduce((n, p) => n + (p.tx || 0) * paso / 1000 / 8, 0);
  const tarjetaIfz = i => {
    const g = i.vmid ? nombres.get(String(i.vmid)) : null;
    return `<article class="pm-ifz ${up(i) ? '' : 'pm-caida'}">
      <header><span class="pm-ifz-ico ${i.tipo}">${icoPm.red}</span><div><h4>${esc(hv && i.tipo === 'invitado' ? (g ? g.nombre : i.nombre.split(' · ')[0]) : i.nombre)}</h4><small>${i.tipo === 'fisica' ? (i.descripcion ? esc(i.descripcion) : 'Física') : i.tipo === 'puente' ? (i.clase ? `${PUENTE} ${esc({ External: 'externo', Internal: 'interno', Private: 'privado' }[i.clase] || i.clase)}` : PUENTE) : g ? (hv ? esc(i.nombre.split(' · ')[1] || 'Adaptador de red') : `${g.tipo === 'lxc' ? 'LXC' : 'VM'} ${esc(i.vmid)} · ${esc(g.nombre)}`) : 'Virtual'}</small></div>
        <span class="pm-estado ${up(i) ? 'ok' : 'caido'}"><span class="punto ${up(i) ? 'ok' : 'caido'}" aria-hidden="true"></span>${up(i) ? 'Activa' : 'Caída'}</span></header>
      <dl>
        ${i.ips && i.ips.length ? `<div class="ancho"><dt>IP</dt><dd class="mono">${esc(i.ips.join(', '))}</dd></div>` : ''}
        <div><dt>Velocidad</dt><dd>${i.velocidad ? (i.velocidad >= 1000 ? `${nf.format(i.velocidad / 1000)} Gb/s` : `${i.velocidad} Mb/s`) : '—'}${i.duplex ? ` <small>${esc(i.duplex)}</small>` : ''}</dd></div>
        <div><dt>MTU</dt><dd>${i.mtu || '—'}</dd></div>
        ${i.tipo === 'puente' && i.puertos.length ? `<div class="ancho"><dt>Puertos</dt><dd>${esc(i.puertos.filter(p => !/^(veth|tap|fw)/.test(p)).join(', ') || '—')}${i.puertos.some(p => /^(veth|tap)/.test(p)) ? ` <small>y ${plural(i.puertos.filter(p => /^(veth|tap)/.test(p)).length, 'invitado', 'invitados')}</small>` : ''}</dd></div>` : ''}
        ${i.puente ? `<div><dt>${PUENTE}</dt><dd>${esc(i.puente)}</dd></div>` : ''}
        ${i.mac ? `<div class="ancho"><dt>MAC</dt><dd class="mono">${esc(i.mac)}</dd></div>` : ''}
        <div class="ancho"><dt>Recibido / enviado</dt><dd class="pm-io"><span class="b">↓ ${bytesTxt(i.rxTotal)}</span><span class="s">↑ ${bytesTxt(i.txTotal)}</span></dd></div>
        ${i.errores || i.descartados ? `<div class="ancho"><dt>Errores / descartados</dt><dd>${nf.format(i.errores)} / ${nf.format(i.descartados)}</dd></div>` : ''}
      </dl></article>`;
  };
  const grupo = (t, l) => l.length ? `<div class="pm-titulo"><h3>${t} <span>${l.length}</span></h3></div><div class="pm-ifzs">${l.map(tarjetaIfz).join('')}</div>` : '';
  const latN = !lat || lat.ms == null ? '' : lat.perdida >= 100 ? 'alerta' : lat.perdida > 0 || lat.ms >= 50 ? 'aviso' : 'ok';
  const estN = (lat && lat.perdida >= 100) || !fisUp ? 'alerta' : errores > 0 || (lat && lat.perdida > 0) ? 'aviso' : 'ok';
  return `<div class="pm-losas">
      <section class="pm-losa"><h3>Tráfico de red <small>24 h</small></h3>
        <div class="pm-trafico"><div><span class="b">↓ Recibido</span><b>${puntos.length ? bytesTxt(totRx) : '—'}</b></div><div><span class="s">↑ Enviado</span><b>${puntos.length ? bytesTxt(totTx) : '—'}</b></div></div>
        <p class="pm-pie">${elegida ? `En ${esc(elegida)}` : 'Midiendo…'}</p></section>
      <section class="pm-losa"><h3>Interfaces activas</h3><div class="pm-grande">${fisUp + ptsUp}</div>
        <div class="hv-chips"><span class="chip-hv">${fisUp} de ${fis.length} físicas</span><span class="chip-hv vm">${ptsUp} ${hv ? (ptsUp === 1 ? 'conmutador' : 'conmutadores') : (ptsUp === 1 ? 'puente' : 'puentes')}</span>${inv.length ? `<span class="chip-hv lxc">${inv.length} de invitados</span>` : ''}</div></section>
      <section class="pm-losa"><h3>Estado de la red</h3><span class="chip-hv ${estN}" style="margin:0 0 8px">${estN === 'ok' ? 'Sin problemas' : estN === 'aviso' ? 'Revisar' : 'Con fallas'}</span>
        <div class="pm-filas"><span>Pérdida</span><b>${lat ? nf.format(lat.perdida) + ' %' : '—'}</b><span>Host</span><b>${esc(r.host || '—')}</b>${r.dominio ? `<span>Dominio</span><b>${esc(r.dominio)}</b>` : ''}<span>DNS</span><b>${esc((r.dns || []).join(', ') || '—')}</b><span>Errores</span><b>${nf.format(errores)}${desc ? ` <small>(${nf.format(desc)} descartados)</small>` : ''}</b></div></section>
      <section class="pm-losa"><h3>Latencia</h3><div class="pm-grande ${latN}">${lat && lat.ms != null ? nf.format(lat.ms) : '—'}<i>ms</i></div>
        <p class="pm-pie">${lat ? `A la puerta de enlace ${esc(lat.destino || r.puertaEnlace || '')}${lat.max ? `, máximo ${nf.format(lat.max)} ms` : ''}` : r.puertaEnlace ? `Puerta de enlace ${esc(r.puertaEnlace)}` : 'Sin puerta de enlace'}</p></section>
    </div>
    <section class="pm-caja"><div class="pm-caja-cab"><h3>Tráfico de red</h3>${opc.length > 1 ? `<select class="selector" data-pm="red-ifz" aria-label="Interfaz">${opc.map(o => `<option ${o === elegida ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : ''}
      <span class="pm-leyenda"><i class="b"></i>Recibido <i class="s"></i>Enviado</span></div>
      <div class="pm-grafico" data-pm-grafico></div></section>
    <section class="pm-caja"><div class="pm-caja-cab"><h3>Topología de la red</h3><span class="tenue">Así se conectan las tarjetas, ${hv ? 'los conmutadores y las VM' : 'los puentes y las VM y LXC'}</span></div>
      ${topologia(s, r, fis, pts, inv, nombres, up)}</section>
    ${grupo('Interfaces físicas', fis)}${grupo(PUENTES, pts)}${grupo(hv ? 'Adaptadores de las VM' : 'Interfaces de VM y LXC', inv)}`;
}
// Gráfico de 24 h (recibido y enviado) con cruz y globo al pasar el mouse
function graficoRed(el, s) {
  const tr = redTrafico.get(s.id); const pts = (tr && tr.puntos) || [];
  if (pts.length < 2) { el.innerHTML = `<div class="sin-datos">${tr && !tr.pidiendo ? 'Todavía no hay historial. Se guarda un punto por minuto desde que el agente informa la red.' : 'Cargando…'}</div>`; return; }
  const W = Math.max(280, el.clientWidth), H = 200, m = { i: 62, d: 12, a: 10, b: 24 };
  const max = Math.max(1, ...pts.map(p => Math.max(p.rx || 0, p.tx || 0))) * 1.1;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = t => m.i + (t - t0) / Math.max(1, t1 - t0) * (W - m.i - m.d), y = v => m.a + (1 - v / max) * (H - m.a - m.b);
  const camino = k => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[k] || 0).toFixed(1)}`).join('');
  const area = k => `${camino(k)}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`;
  const rej = [0, .5, 1].map(f => `<line class="rejilla" x1="${m.i}" x2="${W - m.d}" y1="${y(max / 1.1 * f)}" y2="${y(max / 1.1 * f)}"/><text class="eje" x="${m.i - 8}" y="${y(max / 1.1 * f) + 4}" text-anchor="end">${bpsTxt(max / 1.1 * f)}</text>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tráfico de las últimas 24 horas en ${esc(tr.interfaz || '')}">${rej}
    <path class="pm-area b" d="${area('rx')}"/><path class="pm-area s" d="${area('tx')}"/><path class="pm-linea b" d="${camino('rx')}"/><path class="pm-linea s" d="${camino('tx')}"/>
    ${[0, .25, .5, .75, 1].map(f => { const t = t0 + (t1 - t0) * f; return `<text class="eje" x="${x(t)}" y="${H - 6}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${f === 1 ? 'Ahora' : horaCorta(t)}</text>`; }).join('')}
    <g class="hover" visibility="hidden"><line class="cruz" y1="${m.a}" y2="${y(0)}"/><circle class="pm-pt b" r="4"/><circle class="pm-pt s" r="4"/></g>
    <rect class="captura" x="${m.i}" y="0" width="${W - m.i - m.d}" height="${H}" fill="transparent"/></svg><div class="globo" hidden></div>`;
  const svg = el.querySelector('svg'), g = svg.querySelector('.hover'), globo = el.querySelector('.globo');
  svg.querySelector('.captura').addEventListener('mousemove', ev => {
    const rc = svg.getBoundingClientRect(), px = (ev.clientX - rc.left) * W / rc.width;
    const t = t0 + (px - m.i) / (W - m.i - m.d) * (t1 - t0);
    let p = pts[0]; for (const q of pts) if (Math.abs(q.t - t) < Math.abs(p.t - t)) p = q;
    g.setAttribute('visibility', 'visible'); g.querySelector('.cruz').setAttribute('x1', x(p.t)); g.querySelector('.cruz').setAttribute('x2', x(p.t));
    const [cb, cs] = g.querySelectorAll('circle'); cb.setAttribute('cx', x(p.t)); cb.setAttribute('cy', y(p.rx || 0)); cs.setAttribute('cx', x(p.t)); cs.setAttribute('cy', y(p.tx || 0));
    globo.hidden = false; globo.innerHTML = `<b>${hora(p.t)}</b><br><span class="b">↓ ${bpsTxt(p.rx)}</span> &nbsp; <span class="s">↑ ${bpsTxt(p.tx)}</span>`;
    const gx = x(p.t) / W * rc.width; globo.style.left = Math.min(rc.width - globo.offsetWidth - 4, Math.max(4, gx + 12)) + 'px'; globo.style.top = '8px';
  });
  svg.querySelector('.captura').addEventListener('mouseleave', () => { g.setAttribute('visibility', 'hidden'); globo.hidden = true; });
}
// Topología: tarjetas físicas → host → puentes → VM y LXC, con el tráfico corriendo por los enlaces activos
function topologia(s, r, fis, pts, inv, nombres, up) {
  const guests = inv.map(i => ({ i, g: nombres.get(String(i.vmid)) })).slice(0, 14);
  const filas = Math.max(fis.length, pts.length, guests.length, 1);
  const H = Math.max(220, filas * 54 + 40), W = 1000;
  const col = [70, 330, 580, 860], yDe = (k, n) => n <= 1 ? H / 2 : 40 + k * (H - 80) / (n - 1);
  const nodo = (cx, cy, w, t, sub, clase) => `<g class="pm-nodo ${clase}"><rect x="${cx - w / 2}" y="${cy - 19}" width="${w}" height="38" rx="9"/><text x="${cx}" y="${cy - 2}" text-anchor="middle">${esc(t)}</text>${sub ? `<text class="sub" x="${cx}" y="${cy + 12}" text-anchor="middle">${esc(sub)}</text>` : ''}</g>`;
  const enlace = (x1, y1, x2, y2, vivo, rev) => { const mx = (x1 + x2) / 2; return `<path class="pm-enlace ${vivo ? 'vivo' : 'muerto'} ${rev ? 'rev' : ''}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`; };
  const yHost = H / 2, posF = new Map(fis.map((f, k) => [f.nombre, yDe(k, fis.length)])), posP = new Map(pts.map((p, k) => [p.nombre, yDe(k, pts.length)]));
  let lineas = '';
  for (const f of fis) lineas += enlace(col[0] + 55, posF.get(f.nombre), col[1] - 70, yHost, up(f));
  for (const p of pts) lineas += enlace(col[1] + 70, yHost, col[2] - 55, posP.get(p.nombre), up(p), true);
  guests.forEach(({ i, g }, k) => { const yp = posP.get(i.puente); if (yp != null) lineas += enlace(col[2] + 55, yp, col[3] - 75, yDe(k, guests.length), up(i) && (!g || g.estado === 'running'), true); });
  return `<div class="pm-topo"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Topología: ${fis.length} interfaces físicas, ${pts.length} puentes y ${guests.length} interfaces de VM y LXC">
    ${lineas}
    ${fis.map(f => nodo(col[0], posF.get(f.nombre), 110, f.nombre, up(f) ? (f.velocidad ? (f.velocidad >= 1000 ? f.velocidad / 1000 + ' Gb/s' : f.velocidad + ' Mb/s') : 'activa') : 'caída', 'fisica ' + (up(f) ? '' : 'caido'))).join('')}
    <g class="pm-nodo host"><rect x="${col[1] - 70}" y="${yHost - 30}" width="140" height="60" rx="12"/><text x="${col[1]}" y="${yHost - 4}" text-anchor="middle">${s.tipo === 'proxmox' ? 'PROXMOX' : 'HYPER-V'}</text><text class="sub" x="${col[1]}" y="${yHost + 14}" text-anchor="middle">${esc(r.host || s.nombre)}</text></g>
    ${pts.map(p => nodo(col[2], posP.get(p.nombre), 130, p.nombre, (p.ips && p.ips[0]) || (s.tipo === 'proxmox' ? 'puente' : ({ External: 'externo', Internal: 'interno', Private: 'privado' }[p.clase] || 'conmutador')), 'puente ' + (up(p) ? '' : 'caido'))).join('')}
    ${guests.map(({ i, g }, k) => nodo(col[3], yDe(k, guests.length), 150, g ? g.nombre : i.nombre, s.tipo === 'proxmox' ? `${g ? (g.tipo === 'lxc' ? 'LXC ' : 'VM ') : ''}${i.vmid || ''}` : ((i.ips && i.ips[0]) || 'VM'), (g && g.tipo === 'lxc' ? 'lxc ' : 'vm ') + (up(i) && (!g || g.estado === 'running') ? '' : 'caido'))).join('')}
    ${inv.length > guests.length ? `<text class="pm-mas" x="${col[3]}" y="${H - 6}" text-anchor="middle">y ${inv.length - guests.length} más</text>` : ''}
  </svg></div>`;
}

/* ---------------- Almacenamiento ---------------- */
function seccionAlmacen(s, d) {
  const n = d.nodo;
  if (n == null) return gatoCargando('Leyendo el almacenamiento…');
  if (n.error) return `<div class="msg atencion">No se pudo leer el almacenamiento: ${esc(n.error)}</div>`;
  const al = n.almacenes || [], ds = n.discos || [];
  const loc = al.filter(a => !a.compartido && a.total), rem = al.filter(a => a.compartido && a.total);
  const suma = (l, k) => l.reduce((x, a) => x + (a[k] || 0), 0);
  const lU = suma(loc, 'usado'), lT = suma(loc, 'total'), rU = suma(rem, 'usado'), rT = suma(rem, 'total');
  const lL = loc.reduce((x, a) => x + (a.disponible != null ? a.disponible : Math.max(0, a.total - a.usado)), 0), rL = rem.reduce((x, a) => x + (a.disponible != null ? a.disponible : Math.max(0, a.total - a.usado)), 0);
  const temps = ds.map(x => x.temperatura).filter(t => t != null), tMax = temps.length ? Math.max(...temps) : null;
  const tN = tMax == null ? '' : tMax >= 60 ? 'alerta' : tMax >= 50 ? 'aviso' : 'ok';
  const tipos = {}; for (const x of ds) { const t = (x.tipo || 'disco').toLowerCase() === 'nvme' ? 'NVMe' : (x.tipo || 'disco').toUpperCase(); tipos[t] = (tipos[t] || 0) + 1; }
  const malos = ds.filter(x => x.smartOk === false || (x.salud && !/pass|ok/i.test(x.salud))).length;
  const pctU = pct(lU + rU, lT + rT);
  const fila = (k, v, c) => `<span class="pm-ley-k"><i class="${c}"></i>${k}</span><b class="mono">${v}</b>`;
  const tarjetaAl = a => {
    const p = a.total ? pct(a.usado, a.total) : 0, disp = a.disponible != null ? a.disponible : Math.max(0, (a.total || 0) - (a.usado || 0));
    return `<article class="pm-al ${a.activo ? '' : 'inactivo'}"><header>${icoPm.disco}<h4>${esc(a.nombre)}</h4><span class="pm-chip-tipo">${esc(a.tipo || '')}</span>${a.compartido ? '<span class="pm-chip-tipo rem">compartido</span>' : ''}
      <span class="pm-chip ${a.activo ? 'ok' : 'caido'}">${a.activo ? 'activo' : 'inactivo'}</span><b class="pm-pct">${a.total ? nf.format(p) + '%' : '—'}</b></header>
      ${barra(p, 'al n-' + nivel(p))}
      <div class="pm-al-datos"><div><span>Total</span><b>${bytesTxt(a.total)}</b></div><div><span>Usado</span><b class="b">${bytesTxt(a.usado)}</b></div><div><span>Disponible</span><b class="ok">${bytesTxt(disp)}</b></div></div>
      ${a.contenido ? `<p class="pm-pie">Guarda: ${esc(a.contenido.replace(/,/g, ', '))}</p>` : ''}</article>`;
  };
  const tarjetaDisco = x => {
    const bien = x.smartOk !== false && (!x.salud || /pass|ok/i.test(x.salud));
    const tp = (x.tipo || '').toLowerCase() === 'nvme' ? 'NVMe' : (x.tipo || '').toUpperCase();
    const tc = x.temperatura == null ? '' : x.temperatura >= 60 ? 'alerta' : x.temperatura >= 50 ? 'aviso' : 'ok';
    const sistema = /lvm|zfs|bios|efi|partitions/i.test(x.uso || '');
    return `<article class="pm-disco"><header><h4 class="mono">${esc(x.disco)}</h4>${tp ? `<span class="pm-chip-tipo">${esc(tp)}</span>` : ''}${sistema ? '<span class="pm-chip-tipo sis">Sistema</span>' : ''}
        <span class="pm-smart ${bien ? 'ok' : 'alerta'}"><span class="punto ${bien ? 'ok' : 'caido'}" aria-hidden="true"></span>${bien ? 'CORRECTO' : 'FALLA'}</span></header>
      <div class="pm-disco-sub"><span>${bytesTxt(x.tamano)}</span>${x.temperatura != null ? `<b class="${tc}">${x.temperatura}°C</b>` : ''}</div>
      <dl>${[['Modelo', esc(x.modelo || '—'), 'mono'], ['Ciclos de energía', x.ciclos != null ? nf.format(x.ciclos) : null], ['Encendido', x.horas != null ? horasTxt(x.horas) : null],
        ['Desgaste', x.desgaste != null ? `${100 - x.desgaste} % usado` : null], ['Errores de CRC', x.crc != null ? `<span class="punto ${x.crc ? 'caido' : 'ok'}" aria-hidden="true"></span>${nf.format(x.crc)}` : null], ['Uso', x.uso ? esc(x.uso) : null]]
        .filter(([, v]) => v != null).map(([k, v, c]) => `<div><dt>${k}</dt><dd class="${c || ''}">${v}</dd></div>`).join('')}</dl>
      ${x.serie ? `<p class="pm-serie">S/N: <span class="mono">${esc(x.serie)}</span></p>` : ''}</article>`;
  };
  return `<div class="pm-losas">
      <section class="pm-losa"><h3>Almacenamiento utilizado ${icoPm.hdd}</h3><div class="pm-grande">${bytesTxt(lU + rU)}<span class="chip-hv pm-chip-der">${plural(ds.length, 'disco', 'discos')}</span></div>
        ${barra(pctU, 'al')}<div class="pm-ley">${fila('Local', bytesTxt(lU), 'b')}${fila('Remoto', bytesTxt(rU), 'c')}${fila('Libre', bytesTxt(lL + rL), 'g')}</div></section>
      <section class="pm-losa"><h3>Local usado ${icoPm.disco}</h3>${lT ? `<div class="pm-anillo">${anillo(pct(lU, lT))}<div class="pm-ley">
        <span class="pm-ley-k">Usado</span><b class="mono">${bytesTxt(lU)}</b><span class="pm-carril">${barra(pct(lU, lT), 'ok')}</span>
        <span class="pm-ley-k">Libre</span><b class="mono">${bytesTxt(lL)}</b><span class="pm-carril">${barra(pct(lL, lT), 'al')}</span>
        <span class="pm-ley-k">Total</span><b class="mono">${bytesTxt(lT)}</b></div></div>` : '<div class="pm-ninguno"><b>Ninguno</b><span>Sin almacenamiento local</span></div>'}</section>
      <section class="pm-losa"><h3>Remoto usado ${icoPm.disco}</h3>${rT ? `<div class="pm-anillo">${anillo(pct(rU, rT))}<div class="pm-ley">
        <span class="pm-ley-k">Usado</span><b class="mono">${bytesTxt(rU)}</b><span class="pm-carril">${barra(pct(rU, rT), 'ok')}</span>
        <span class="pm-ley-k">Libre</span><b class="mono">${bytesTxt(rL)}</b><span class="pm-carril">${barra(pct(rL, rT), 'al')}</span>
        <span class="pm-ley-k">Total</span><b class="mono">${bytesTxt(rT)}</b></div></div>` : '<div class="pm-ninguno"><b>Ninguno</b><span>Sin almacenamiento remoto</span></div>'}</section>
      <section class="pm-losa"><h3>Discos físicos ${icoPm.hdd}</h3><div class="pm-grande">${ds.length}<i>${ds.length === 1 ? 'disco' : 'discos'}</i></div>
        <span class="chip-hv ${malos ? 'alerta' : tN || 'ok'}" style="margin:2px 0 10px">${malos ? plural(malos, 'disco con falla', 'discos con falla') : tMax == null ? 'SMART correcto' : tN === 'ok' ? 'Temperaturas normales' : tN === 'aviso' ? 'Temperatura alta' : 'Temperatura muy alta'}</span>
        ${barra(ds.length ? 100 : 0, 'disc')}<div class="pm-ley-lista">${Object.entries(tipos).map(([t, k]) => `<span><i></i>${k} ${esc(t)}</span>`).join('')}</div></section>
    </div>
    <section class="pm-caja"><div class="pm-caja-cab"><h3>${icoPm.disco}Almacenamiento Proxmox</h3></div><div class="pm-als">${al.length ? al.map(tarjetaAl).join('') : '<div class="vacio">Sin almacenamientos.</div>'}</div></section>
    <section class="pm-caja"><div class="pm-caja-cab"><h3>${icoPm.hdd}Discos físicos y estado SMART</h3></div>
      ${ds.length ? `<div class="pm-discos">${ds.map(tarjetaDisco).join('')}</div>` : '<div class="vacio">Proxmox no informó discos físicos.</div>'}
      ${ds.length && ds.every(x => x.temperatura == null && x.ciclos == null) ? '<p class="pm-pie" style="margin-top:12px">Para ver temperatura, ciclos y horas encendido hace falta smartmontools en el host (viene con Proxmox).</p>' : ''}</section>`;
}
function horasTxt(h) { const d = Math.floor(h / 24); if (d >= 365) return `${Math.floor(d / 365)}a ${Math.floor((d % 365) / 30)}m`; if (d >= 30) return `${Math.floor(d / 30)}m ${d % 30}d`; return d ? `${d}d ${h % 24}h` : `${h}h`; }

/* ---------------- después de pintar: botones y filtros ---------------- */
function alPintarPve(cont, s, pest, datos) {
  if (pest === 'red') { const g = cont.querySelector('[data-pm-grafico]'); if (g) graficoRed(g, s); }
  if (pest === 'vms') { const q = cont.querySelector('#buscarVm'); if (q) { q.oninput = () => filtrarVms(cont, s); filtrarVms(cont, s); } }
  cont.onclick = ev => {
    const b = ev.target.closest('[data-pm]'); if (!b) return;
    const k = b.dataset.pm;
    if (k === 'app-editar') editarApp(s, datos, b.dataset.clave);
    else if (k === 'app-nueva') editarApp(s, datos, null);
    else if (k === 'ocultas') { appsOcultas.set(s.id, !appsOcultas.get(s.id)); vistaEquipo(s.id); }
    else if (k === 'vm-filtro') { vmFiltro.set(s.id, b.dataset.f); cont.querySelectorAll('[data-pm="vm-filtro"]').forEach(x => { const a = x === b; x.classList.toggle('activa', a); x.setAttribute('aria-pressed', a); }); filtrarVms(cont, s); }
  };
  const sel = cont.querySelector('[data-pm="red-ifz"]');
  if (sel) sel.onchange = () => { redIfz.set(s.id, sel.value); vistaEquipo(s.id); };
}
