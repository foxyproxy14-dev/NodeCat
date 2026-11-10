/* NodeCat: service worker mínimo para poder instalar el panel como app.
   No guarda nada en caché (los datos siempre tienen que ser los de ahora): solo muestra un aviso si no hay conexión. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NodeCat</title>' +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1011;color:#e9ebe7;font:16px system-ui,sans-serif;text-align:center;padding:24px">' +
    '<div><h1 style="font-size:22px">Sin conexión con NodeCat</h1><p style="color:#aab1ad">Revisa la red o la VPN y vuelve a intentarlo.</p>' +
    '<button onclick="location.reload()" style="font:inherit;padding:10px 18px;border-radius:10px;border:0;background:#2a9fb5;color:#fff">Reintentar</button></div>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});

// Notificaciones de NodeCat (Web Push): llegan aunque la página esté cerrada
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { t: 'NodeCat', b: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.t || 'NodeCat', {
    body: d.b || '', icon: '/iconos/icono-192.png', badge: '/iconos/icono-192.png', tag: d.g || undefined, renotify: !!d.g, data: { u: d.u || '/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.u) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => {
    for (const c of l) if (new URL(c.url).origin === self.location.origin) { c.focus(); return c.navigate ? c.navigate(destino) : null; }
    return self.clients.openWindow(destino);
  }));
});
