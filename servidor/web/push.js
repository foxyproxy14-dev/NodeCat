/* NodeCat: notificaciones en este dispositivo (teléfono o PC), aunque la página esté cerrada. */
'use strict';

const pushB64 = s => { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instaladaApp = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function suscripcionActual() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

async function notificacionesDispositivo() {
  let d;
  try { d = await api('/api/push'); } catch (x) { if (!x.login) aviso(x.message, true); return; }
  const soporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let sub = null; try { sub = await suscripcionActual(); } catch { }
  const mia = sub && d.dispositivos.some(x => sub.endpoint.endsWith(x.endpoint));
  const misClientes = estado.clientes;   // ya vienen limitados a lo que la cuenta puede ver
  const p = d.preferencias, todos = !p.clientes;
  const motivo = !d.permitido ? 'Tu cuenta no tiene permiso para recibir notificaciones. Pídeselo a un administrador (Cuentas de acceso).'
    : location.protocol !== 'https:' ? 'Las notificaciones solo funcionan si entras a NodeCat por HTTPS.'
    : esIOS() && !instaladaApp() ? 'En iPhone y iPad, primero instala NodeCat en la pantalla de inicio (Compartir → Añadir a la pantalla de inicio), ábrelo desde ahí y vuelve a este menú. Hace falta iOS 16.4 o más nuevo.'
    : !soporta ? 'Este navegador no permite notificaciones de páginas web.'
    : Notification.permission === 'denied' ? 'Este navegador tiene bloqueadas las notificaciones de NodeCat. Permítelas en los ajustes del sitio (el candado junto a la dirección) y vuelve a intentarlo.' : '';
  const dlg = libre(`<h3>Notificaciones en este dispositivo</h3>
    <p style="margin-top:-4px">Te llegan aunque NodeCat esté cerrado, como las de YouTube. Solo de ${SESION.clientes ? 'los clientes que tu cuenta puede ver' : 'tus clientes'}, y puedes elegir cuáles y de qué tipo.</p>
    ${motivo ? `<div class="msg atencion">${esc(motivo)}</div>` : `<div class="push-estado ${mia ? 'si' : ''}"><span class="punto ${mia ? 'ok' : ''}" aria-hidden="true"></span><b>${mia ? 'Activadas en este dispositivo' : 'Desactivadas en este dispositivo'}</b>
      ${mia ? '<button class="btn" type="button" data-push-quitar>Desactivar</button><button class="btn" type="button" data-push-probar>Enviar una prueba</button>' : '<button class="btn prim" type="button" data-push-activar>Activar</button>'}</div>`}
    <form id="fPush">
      <h4>De qué clientes</h4>
      <div class="marcas-cli"><label><input type="radio" name="alc" value="todos" ${todos ? 'checked' : ''}> Todos${SESION.clientes ? ' los míos' : ''}</label><label><input type="radio" name="alc" value="algunos" ${todos ? '' : 'checked'}> Solo estos:</label></div>
      <div class="marcas-cli">${misClientes.map(c => `<label><input type="checkbox" name="pcli" value="${c.id}" ${!todos && p.clientes.includes(c.id) ? 'checked' : ''}> ${esc(c.nombre)}</label>`).join('')}</div>
      <h4>De qué tipo</h4>
      <div class="marcas-cli tipos-push">${Object.entries(d.tipos).map(([k, t]) => `<label><input type="checkbox" name="ptipo" value="${k}" ${p.tipos.includes(k) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>
      <p class="ayuda-campo">Los umbrales (cuánta CPU, cuántos minutos sin responder…) son los mismos de las notificaciones de Telegram, en Ajustes.${d.dispositivos.length ? ` Tienes ${plural(d.dispositivos.length, 'dispositivo activado', 'dispositivos activados')}.` : ''}</p>
      <div class="pie"><button class="btn" type="button" data-cerrar>Cerrar</button><button class="btn prim" type="submit">Guardar preferencias</button></div>
    </form>`, true);
  const f = dlg.querySelector('#fPush');
  f.querySelectorAll('[name=pcli]').forEach(x => x.onchange = () => { if (x.checked) f.alc.value = 'algunos'; });
  const prefs = () => {
    const algunos = f.alc.value === 'algunos';
    const clientes = algunos ? [...f.querySelectorAll('[name=pcli]:checked')].map(x => +x.value) : null;
    if (algunos && !clientes.length) throw new Error('Marca al menos un cliente, o elige “Todos”.');
    return { clientes, tipos: [...f.querySelectorAll('[name=ptipo]:checked')].map(x => x.value) };
  };
  f.onsubmit = ev => { ev.preventDefault(); const b = f.querySelector('[type=submit]'); ocupado(b, 'Guardando…', async () => { try { await enviar('/api/push/preferencias', 'PUT', prefs()); aviso('Preferencias guardadas.'); } catch (x) { if (!x.login) aviso(x.message, true); } }); };
  const ba = dlg.querySelector('[data-push-activar]');
  if (ba) ba.onclick = () => ocupado(ba, 'Activando…', async () => {
    try {
      const pr = prefs();
      if (await Notification.requestPermission() !== 'granted') throw new Error('No diste permiso para las notificaciones.');
      const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
      let s = await reg.pushManager.getSubscription();
      if (s && s.options && s.options.applicationServerKey) {
        const k = new Uint8Array(s.options.applicationServerKey), n = pushB64(d.publica);
        if (k.length !== n.length || k.some((v, i) => v !== n[i])) { await s.unsubscribe(); s = null; }
      }
      if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushB64(d.publica) });
      await enviar('/api/push/suscribir', 'POST', { suscripcion: s.toJSON(), preferencias: pr });
      aviso('Notificaciones activadas en este dispositivo.'); notificacionesDispositivo();
    } catch (x) { if (!x.login) aviso(x.message, true); }
  });
  const bq = dlg.querySelector('[data-push-quitar]');
  if (bq) bq.onclick = () => ocupado(bq, 'Desactivando…', async () => {
    try { const s = await suscripcionActual(); if (s) { await enviar('/api/push/quitar', 'POST', { endpoint: s.endpoint }); await s.unsubscribe(); } aviso('Notificaciones desactivadas en este dispositivo.'); notificacionesDispositivo(); }
    catch (x) { if (!x.login) aviso(x.message, true); }
  });
  const bp = dlg.querySelector('[data-push-probar]');
  if (bp) bp.onclick = () => ocupado(bp, 'Enviando…', async () => {
    try { const r = await enviar('/api/push/probar', 'POST', {}); aviso(r.enviadas ? `Prueba enviada a ${plural(r.enviadas, 'dispositivo', 'dispositivos')}.` : 'No se pudo enviar la prueba. Revisa que este servidor tenga salida a Internet.', !r.enviadas); }
    catch (x) { if (!x.login) aviso(x.message, true); }
  });
}
