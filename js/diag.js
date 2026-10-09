// Diagnostic du navigateur : stockage, cache, service worker, moteur d'IA local. Ne lit aucun contenu, ne modifie aucune donnée de l'utilisateur.
import { APP_VERSION } from './version.js';

const out = document.getElementById('out');
const withLimit = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' : pas de réponse après ' + Math.round(ms / 1000) + ' s')), ms))]);
const lines = [];
const say = (ok, label, detail = '') => { lines.push((ok === null ? '  ·  ' : ok ? '  OK ' : 'ÉCHEC') + ' ' + label + (detail ? ' — ' + detail : '')); out.textContent = lines.join('\n'); };

// Base de test (créée puis supprimée) : vérifie que le navigateur sait écrire dans IndexedDB.
async function testIdb() {
  const t0 = performance.now();
  const NAME = 'dia-diagnostic-' + Date.now();
  const db = await withLimit(new Promise((res, rej) => { const r = indexedDB.open(NAME, 1); r.onupgradeneeded = () => r.result.createObjectStore('t'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('bloquée')); }), 10000, 'ouverture IndexedDB');
  await withLimit(new Promise((res, rej) => { const t = db.transaction('t', 'readwrite'); t.objectStore('t').put('x', 'k'); t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }), 10000, 'écriture IndexedDB');
  const v = await withLimit(new Promise((res, rej) => { const q = db.transaction('t').objectStore('t').get('k'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }), 10000, 'lecture IndexedDB');
  db.close(); indexedDB.deleteDatabase(NAME);
  return { ms: Math.round(performance.now() - t0), ok: v === 'x' };
}

// Base de l'application : ouverture sans changement de version, comptage seulement.
async function testAppDb() {
  if (!indexedDB.databases) return { skip: 'liste des bases non disponible dans ce navigateur' };
  const list = await withLimit(indexedDB.databases(), 8000, 'liste des bases');
  const info = list.find((d) => d.name === 'dictaphone-proto');
  if (!info) return { none: true, all: list.map((d) => d.name + ' v' + d.version) };
  const t0 = performance.now();
  const db = await withLimit(new Promise((res, rej) => { const r = indexedDB.open('dictaphone-proto'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('bloquée par un autre onglet')); }), 12000, 'ouverture de la base de l\'application');
  const counts = {};
  for (const s of [...db.objectStoreNames]) {
    if (s === 'chunks' || s === 'originals') { counts[s] = '(non compté)'; continue; }
    counts[s] = await withLimit(new Promise((res, rej) => { const q = db.transaction(s).objectStore(s).count(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }), 8000, 'lecture ' + s);
  }
  db.close();
  return { version: info.version, ms: Math.round(performance.now() - t0), counts };
}

async function run() {
  lines.length = 0; out.textContent = 'Diagnostic en cours…';
  say(null, 'Application', 'version ' + APP_VERSION + ' · ' + location.origin + location.pathname.replace(/diagnostic\.html$/, ''));
  say(null, 'Navigateur', navigator.userAgent.replace(/^Mozilla\/5\.0 /, ''));
  say(null, 'Fenêtre', innerWidth + ' × ' + innerHeight + ' · thème ' + (document.documentElement.getAttribute('data-theme') || '?'));
  try { localStorage.setItem('dia_diag', '1'); localStorage.removeItem('dia_diag'); say(true, 'Réglages (localStorage)'); } catch (e) { say(false, 'Réglages (localStorage)', e.message); }
  try { const r = await testIdb(); say(r.ok, 'Écriture dans le stockage du navigateur (IndexedDB)', r.ms + ' ms'); } catch (e) { say(false, 'Stockage du navigateur (IndexedDB)', e.message + '  → cause probable de l\'écran vide : essayez une fenêtre de navigation privée ou désactivez les extensions pour ce site'); }
  try {
    const r = await testAppDb();
    if (r.skip) say(null, 'Base de l\'application', r.skip);
    else if (r.none) say(null, 'Base de l\'application', 'aucune base créée dans ce navigateur (' + (r.all.join(', ') || 'aucune base') + ')');
    else say(true, 'Base de l\'application', 'version ' + r.version + ', ouverte en ' + r.ms + ' ms · ' + Object.entries(r.counts).map(([k, v]) => k + ' ' + v).join(', '));
  } catch (e) { say(false, 'Base de l\'application', e.message); }
  try {
    if (!('serviceWorker' in navigator)) say(null, 'Service worker', 'non pris en charge');
    else {
      const reg = await withLimit(navigator.serviceWorker.getRegistration(), 5000, 'service worker');
      const keys = await withLimit(caches.keys(), 5000, 'caches');
      say(!!reg, 'Service worker', reg ? ((reg.active ? 'actif' : 'inactif') + (reg.waiting ? ', mise à jour en attente' : '') + (navigator.serviceWorker.controller ? ', contrôle la page' : ', ne contrôle pas encore la page')) : 'non enregistré');
      say(null, 'Caches du programme', keys.join(', ') || 'aucun');
    }
  } catch (e) { say(false, 'Service worker / caches', e.message); }
  try { if (navigator.storage && navigator.storage.estimate) { const s = await navigator.storage.estimate(); const p = navigator.storage.persisted ? await navigator.storage.persisted() : null; say(null, 'Espace de stockage', Math.round((s.usage || 0) / 1048576) + ' Mo utilisés sur ' + Math.round((s.quota || 0) / 1048576) + ' Mo · conservation garantie : ' + (p === null ? '?' : p ? 'oui' : 'non')); } } catch (e) { say(null, 'Espace de stockage', e.message); }
  try {
    const t0 = performance.now();
    const r = await withLimit(fetch('js/version.js?d=' + Date.now(), { cache: 'no-store' }), 10000, 'lecture des fichiers de l\'application');
    say(r.ok, 'Fichiers de l\'application sur le serveur', 'code ' + r.status + ', ' + Math.round(performance.now() - t0) + ' ms');
  } catch (e) { say(false, 'Fichiers de l\'application sur le serveur', e.message); }
  // Moteur d'IA local : le navigateur peut afficher une demande d'autorisation (réseau local) ; on attend jusqu'à 30 s.
  say(null, 'Moteur d\'IA local', 'test en cours (si le navigateur demande l\'accès au réseau local, choisissez « Autoriser »)…');
  const idx = lines.length - 1;
  try {
    const t0 = performance.now();
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 30000);
    const r = await fetch('http://127.0.0.1:8090/health', { signal: ctl.signal, cache: 'no-store', credentials: 'omit', targetAddressSpace: 'loopback' }); clearTimeout(timer);
    lines[idx] = (r.ok ? '  OK ' : 'ÉCHEC') + ' Moteur d\'IA local (127.0.0.1:8090) — code ' + r.status + ', ' + Math.round(performance.now() - t0) + ' ms';
  } catch (e) { lines[idx] = '  ·   Moteur d\'IA local (127.0.0.1:8090) — pas de réponse (' + (e.name === 'AbortError' ? 'délai dépassé : autorisation « réseau local » non accordée ?' : e.message) + '). Normal si le moteur n\'est pas lancé.'; }
  out.textContent = lines.join('\n');
}

document.getElementById('run').addEventListener('click', run);
document.getElementById('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(out.textContent); document.getElementById('copy').textContent = 'Rapport copié'; } catch { const r = document.createRange(); r.selectNodeContents(out); getSelection().removeAllRanges(); getSelection().addRange(r); } });
document.getElementById('repair').addEventListener('click', async () => {
  const msg = document.getElementById('repairMsg');
  if (!confirm('Supprimer les fichiers du programme gardés en mémoire (cache et service worker) puis recharger ? Vos données ne sont pas touchées.')) return;
  try {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
    for (const k of await caches.keys()) if (k.startsWith('dictaphone-')) await caches.delete(k);
    msg.textContent = 'Fait. Rechargement…'; setTimeout(() => { location.href = './'; }, 800);
  } catch (e) { msg.textContent = 'Impossible : ' + e.message; }
});
run();
