/* NodeCat: ofrecer el acceso directo en el teléfono (como app), al estilo de ProxMenux.
   iPhone/iPad: pasos de Safari. Android/Chrome/Edge: botón Instalar del navegador. Se puede posponer o no volver a mostrar. */
'use strict';
(() => {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => { });
  const CLAVE = 'nodecat-instalar';
  const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const movil = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const pospuesto = () => { try { const v = localStorage.getItem(CLAVE); return v === 'nunca' || (v && Date.now() - Number(v) < 7 * 864e5); } catch { return false; } };
  const guardar = v => { try { localStorage.setItem(CLAVE, v); } catch { } };
  let aviso = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); aviso = e; if (!ios) setTimeout(mostrar, 1500); });
  window.addEventListener('appinstalled', () => { guardar('nunca'); cerrar(); });

  const icoCompartir = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
  const icoMas = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
  let hoja = null;
  function cerrar() { if (!hoja) return; hoja.classList.remove('visible'); const h = hoja; hoja = null; setTimeout(() => h.remove(), 300); }
  function mostrar(forzado) {
    if (hoja || instalada() || (!forzado && (!movil() || pospuesto() || (!ios && !aviso)))) return;
    hoja = document.createElement('div');
    hoja.className = 'instalar';
    hoja.setAttribute('role', 'dialog'); hoja.setAttribute('aria-labelledby', 'instTitulo');
    hoja.innerHTML = `<div class="instalar-hoja"><span class="instalar-asa" aria-hidden="true"></span>
      <button type="button" class="instalar-x" data-i="luego" aria-label="Cerrar">×</button>
      <div class="instalar-cab"><img src="/iconos/icono-192.png" alt=""><div><h2 id="instTitulo">Instalar NodeCat</h2><p>Agrégalo a tu pantalla de inicio y ábrelo como una app, a pantalla completa.</p></div></div>
      ${ios ? `<ol class="instalar-pasos">
        <li><span>1</span><p>Toca el botón <b>${icoCompartir}Compartir</b> del navegador</p></li>
        <li><span>2</span><p>Elige <b>${icoMas}Añadir a la pantalla de inicio</b></p></li>
        <li><span>3</span><p>Confirma tocando <b>Añadir</b> arriba a la derecha</p></li></ol>`
        : aviso ? '<button type="button" class="btn prim instalar-si" data-i="instalar">Instalar</button>'
        : `<ol class="instalar-pasos"><li><span>1</span><p>Abre el menú <b>⋮</b> del navegador</p></li><li><span>2</span><p>Elige <b>${icoMas}Instalar app</b> o <b>Añadir a pantalla de inicio</b></p></li><li><span>3</span><p>Confirma con <b>Instalar</b></p></li></ol>`}
      <div class="instalar-pie"><button type="button" data-i="luego">Ahora no</button><button type="button" class="fuerte" data-i="nunca">No volver a mostrar</button></div></div>`;
    document.body.appendChild(hoja);
    requestAnimationFrame(() => requestAnimationFrame(() => hoja && hoja.classList.add('visible')));
    hoja.addEventListener('click', async ev => {
      if (ev.target === hoja) { guardar(String(Date.now())); cerrar(); return; }
      const b = ev.target.closest('[data-i]'); if (!b) return;
      if (b.dataset.i === 'instalar' && aviso) { aviso.prompt(); const r = await aviso.userChoice.catch(() => null); aviso = null; if (r && r.outcome === 'accepted') guardar('nunca'); else guardar(String(Date.now())); cerrar(); return; }
      guardar(b.dataset.i === 'nunca' ? 'nunca' : String(Date.now())); cerrar();
    });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape' && hoja) { guardar(String(Date.now())); cerrar(); document.removeEventListener('keydown', esc); } });
  }
  // En iPhone se ofrece a los pocos segundos de abrir (Safari no avisa por su cuenta)
  if (ios) setTimeout(mostrar, 3500);
  window.nodecatInstalar = () => { try { localStorage.removeItem(CLAVE); } catch { } mostrar(true); };
})();
