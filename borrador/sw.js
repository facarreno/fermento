// Fermento · service worker. Red primero y caché de respaldo: con conexión siempre llega el contenido
// nuevo; sin conexión la app abre con lo último que vio. Subir VERSION si cambia la lista de archivos.
// La URL principal y /borrador/ tienen cada una su SW: la caché lleva el scope para que no se pisen.
const VERSION = 'fermento-v1@' + self.registration.scope;
const ARCHIVOS = ['./', 'index.html', 'estilos.css', 'app.js', 'manifest.webmanifest', 'data/contenido.json',
  'iconos/icono.svg', 'iconos/icono-180.png', 'iconos/icono-192.png', 'iconos/icono-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION && (k.endsWith('@' + self.registration.scope) || !k.includes('@')))
      .map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })      // revalida con el servidor: sin esto la caché HTTP retrasa las actualizaciones
      .then(r => { if (r.ok) { const copia = r.clone(); caches.open(VERSION).then(c => c.put(req, copia)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
