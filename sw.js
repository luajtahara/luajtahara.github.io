// Funciona sin conexión: guarda la app en caché y la actualiza cuando hay red.
const CACHE = 'tahara-v18';
const FILES = ['./', 'index.html', 'logic.js', 'agregar.html', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });

// Recordatorios: el archivo de calendario se entrega como una dirección real (text/calendar),
// que es lo que el iPhone abre en el Calendario. Se arma acá mismo; no viaja a ningún servidor.
function b64dec(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // el servidor de avisos y otros sitios van directo
  if (url.origin === location.origin && url.pathname.endsWith('/recordatorios.ics')) {
    let ics = '';
    try { ics = b64dec(url.searchParams.get('d') || ''); } catch (err) {}
    if (!/BEGIN:VCALENDAR/.test(ics)) { e.respondWith(new Response('', { status: 400 })); return; }
    e.respondWith(new Response(ics, { headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="recordatorios.ics"',
      'Cache-Control': 'no-store'
    } }));
    return;
  }
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: url.pathname.endsWith('/') || url.pathname.endsWith('index.html') })
      .then(r => r || caches.match('index.html'))));
});

// Notificaciones: el servidor de avisos manda sólo el texto elegido
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: e.data ? e.data.text() : '' }; }
  const title = String(d.title || 'Recordatorio');
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'r-' + Date.now(), data: { url: './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
