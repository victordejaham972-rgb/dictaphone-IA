// Service worker : installation de l'application et ouverture rapide. Il ne met en cache QUE les fichiers de l'application
// (jamais les données de l'utilisateur, qui restent dans IndexedDB). Les modèles d'IA du laboratoire sont gérés par leurs bibliothèques.
const V = 'dictaphone-v20-0.8.5';
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/main.js', 'js/ui.js', 'js/store.js', 'js/defaults.js', 'js/common.js', 'js/exports.js', 'js/pdf.js', 'js/backup.js', 'js/version.js', 'js/import.js', 'js/pdfread.js', 'js/update.js', 'js/theme.js', 'js/vocab-ui.js', 'js/trash-ui.js', 'js/report-import.js', 'js/restore-names.js', 'js/diag.js', 'diagnostic.html', 'js/protect-ui.js', 'js/protect/engine.js', 'js/protect/lexicon.js', 'js/protect/patterns.js', 'js/protect/export.js', 'js/protect/dictionnaire-financier.json', 'js/protect/prenoms-insee.txt', 'js/protect/communes-insee.txt', 'js/vault.js', 'js/vault-ui.js', 'js/ttf.js', 'fonts/pdf/AbhayaLibre-Regular.ttf', 'fonts/pdf/OpenSans-Light.ttf', 'fonts/pdf/OpenSans-Regular.ttf', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
  'js/views-home.js', 'js/views-library.js', 'js/views-entretien.js', 'js/views-templates.js', 'js/views-settings.js',
  'db.js', 'audio.js',
  'fonts/abhaya-libre-latin-400-normal.woff2', 'fonts/abhaya-libre-latin-600-normal.woff2', 'fonts/open-sans-latin-wght-normal.woff2',
  'img/emblem-tile.png', 'img/emblem-ivory.png', 'icon-32.png', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  // IA locale et laboratoire : masqués, code conservé ; leurs fichiers ne sont plus préchargés (mis en cache seulement s'ils sont utilisés)
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
