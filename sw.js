// Service worker : installation de l'application et ouverture rapide. Il ne met en cache QUE les fichiers de l'application
// (jamais les donnÃ©es de l'utilisateur, qui restent dans IndexedDB). Les modÃ¨les d'IA du laboratoire sont gÃ©rÃ©s par leurs bibliothÃ¨ques.
const V = 'dictaphone-v12-0.6.0';
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/main.js', 'js/ui.js', 'js/store.js', 'js/defaults.js', 'js/common.js', 'js/exports.js', 'js/pdf.js', 'js/backup.js', 'js/ai.js', 'js/version.js', 'js/import.js', 'js/pdfread.js', 'js/update.js', 'js/theme.js', 'js/vocab-ui.js', 'js/ia-engine.js', 'js/ia-pipeline.js', 'js/ia-ui.js', 'js/ia-demo.js', 'js/assist.js', 'js/ttf.js', 'fonts/pdf/AbhayaLibre-Regular.ttf', 'fonts/pdf/OpenSans-Light.ttf', 'fonts/pdf/OpenSans-Regular.ttf', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
  'js/views-home.js', 'js/views-library.js', 'js/views-entretien.js', 'js/views-templates.js', 'js/views-settings.js',
  'db.js', 'audio.js',
  'fonts/abhaya-libre-latin-400-normal.woff2', 'fonts/abhaya-libre-latin-600-normal.woff2', 'fonts/open-sans-latin-wght-normal.woff2',
  'img/emblem-tile.png', 'img/emblem-ivory.png', 'icon-32.png', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  // IA locale (page de rÃ©daction, moteur hÃ©bergÃ©, sonde)
  'ia.html', 'ia-worker.js', 'ia-sonde.html', 'ia-sonde.js', // le moteur vendor/web-llm.js (6 Mo) est mis en cache Ã  la premiÃ¨re utilisation de l'IA, pas Ã  l'installation
  'js/ia-core.js', 'js/ia-verify.js', 'js/ia-score.js', 'js/ia-models.js', 'js/ia-local.js', 'js/ia-page.js',
  // laboratoire (expÃ©rimental)
  'labo.html', 'labo.js', 'style.css', 'stt-worker.js', 'llm-worker.js', 'recorder-worklet.js', 'sonde.html', 'sonde.js',
];

self.addEventListener('install', (e) => {
  // Â« reload Â» : les fichiers sont lus sur le serveur et non dans le cache du navigateur (qui garde les anciens fichiers jusqu'Ã  10 minutes)
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
    // Fichiers de l'application : rÃ©seau d'abord (mises Ã  jour), cache en secours hors connexion.
    // Â« no-cache Â» : le navigateur vÃ©rifie auprÃ¨s du serveur (rÃ©ponse trÃ¨s lÃ©gÃ¨re si rien n'a changÃ©) au lieu de rÃ©utiliser pendant 10 minutes une ancienne copie.
    e.respondWith(
      fetch(req, { cache: 'no-cache' }).then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(V).then((c) => c.put(req, copy)); }
        return r;
      }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
    );
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    // BibliothÃ¨ques du laboratoire uniquement (versions figÃ©es)
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((r) => {
        const copy = r.clone();
        caches.open(V).then((c) => c.put(req, copy));
        return r;
      }))
    );
  }
});
