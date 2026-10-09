// Service worker : installation de l'application et ouverture rapide. Il ne met en cache QUE les fichiers de l'application
// (jamais les données de l'utilisateur, qui restent dans IndexedDB). Les modèles d'IA du laboratoire sont gérés par leurs bibliothèques.
const V = 'dictaphone-v9-0.4.3';
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/main.js', 'js/ui.js', 'js/store.js', 'js/defaults.js', 'js/common.js', 'js/exports.js', 'js/pdf.js', 'js/backup.js', 'js/ai.js', 'js/version.js', 'js/import.js', 'js/pdfread.js', 'js/update.js', 'js/ttf.js', 'fonts/pdf/AbhayaLibre-Regular.ttf', 'fonts/pdf/OpenSans-Light.ttf', 'fonts/pdf/OpenSans-Regular.ttf', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
  'js/views-home.js', 'js/views-library.js', 'js/views-entretien.js', 'js/views-templates.js', 'js/views-settings.js',
  'db.js', 'audio.js',
  'fonts/abhaya-libre-latin-500-normal.woff2', 'fonts/abhaya-libre-latin-600-normal.woff2', 'fonts/abhaya-libre-latin-700-normal.woff2', 'fonts/dm-sans-latin-wght-normal.woff2',
  'img/emblem-tile.png', 'icon-32.png', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  // IA locale (page de rédaction, moteur hébergé, sonde)
  'ia.html', 'ia-worker.js', 'ia-sonde.html', 'ia-sonde.js', // le moteur vendor/web-llm.js (6 Mo) est mis en cache à la première utilisation de l'IA, pas à l'installation
  'js/ia-core.js', 'js/ia-verify.js', 'js/ia-score.js', 'js/ia-models.js', 'js/ia-local.js', 'js/ia-page.js',
  // laboratoire (expérimental)
  'labo.html', 'labo.js', 'style.css', 'stt-worker.js', 'llm-worker.js', 'recorder-worklet.js', 'sonde.html', 'sonde.js',
];

self.addEventListener('install', (e) => {
  // « reload » : les fichiers sont lus sur le serveur et non dans le cache du navigateur (qui garde les anciens fichiers jusqu'à 10 minutes)
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL.map((p) => new Request(p, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('dictaphone-') && k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // Fichiers de l'application : réseau d'abord (mises à jour), cache en secours hors connexion.
    // « no-cache » : le navigateur vérifie auprès du serveur (réponse très légère si rien n'a changé) au lieu de réutiliser pendant 10 minutes une ancienne copie.
    e.respondWith(
      fetch(req, { cache: 'no-cache' }).then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(V).then((c) => c.put(req, copy)); }
        return r;
      }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
    );
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    // Bibliothèques du laboratoire uniquement (versions figées)
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((r) => {
        const copy = r.clone();
        caches.open(V).then((c) => c.put(req, copy));
        return r;
      }))
    );
  }
});
