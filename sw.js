// Service worker : permet l'installation et l'ouverture hors connexion.
// Les modèles d'IA sont mis en cache par leurs bibliothèques, pas ici.
const V = 'dictaphone-proto-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'audio.js', 'db.js', 'stt-worker.js', 'llm-worker.js', 'recorder-worklet.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('dictaphone-proto-') && k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // Nos fichiers : réseau d'abord (pour recevoir les mises à jour), cache en secours.
    e.respondWith(
      fetch(req).then((r) => {
        const copy = r.clone();
        caches.open(V).then((c) => c.put(req, copy));
        return r;
      }).catch(() => caches.match(req))
    );
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    // Bibliothèques (versions figées) : cache d'abord.
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((r) => {
        const copy = r.clone();
        caches.open(V).then((c) => c.put(req, copy));
        return r;
      }))
    );
  }
});
