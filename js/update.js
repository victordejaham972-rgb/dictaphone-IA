// Mises à jour de l'application : détection d'une version plus récente, vérification et mise à jour forcée.
// Ne touche JAMAIS aux données (entretiens, trames, réglages, sauvegardes) : seuls les fichiers du programme (cache `dictaphone-*`) sont renouvelés.
import { APP_VERSION } from './version.js';

// Version réellement publiée (lecture directe sur le serveur, sans passer par aucun cache)
export async function publishedVersion() {
  const r = await fetch('js/version.js?v=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('serveur injoignable (' + r.status + ')');
  const m = /APP_VERSION\s*=\s*'([^']+)'/.exec(await r.text());
  return m ? m[1] : null;
}
const registration = () => (('serviceWorker' in navigator) ? navigator.serviceWorker.getRegistration().catch(() => null) : Promise.resolve(null));

export async function swStatus() {
  if (!('serviceWorker' in navigator)) return { supported: false };
  const reg = await registration();
  let caches_ = '';
  try { caches_ = (await caches.keys()).filter((k) => k.startsWith('dictaphone-')).join(', '); } catch {}
  return { supported: true, registered: !!reg, active: !!(reg && reg.active), installing: !!(reg && reg.installing), waiting: !!(reg && reg.waiting), controlled: !!navigator.serviceWorker.controller, cache: caches_ };
}

export async function checkForUpdate() {
  const reg = await registration();
  if (reg) { try { await reg.update(); } catch {} }
  const published = await publishedVersion();
  return { running: APP_VERSION, published, outdated: !!published && published !== APP_VERSION };
}

// Recharge l'application après avoir laissé le temps d'enregistrer une modification en cours (le changement d'écran enregistre la fiche ouverte)
export async function reloadSafely() {
  if (location.hash !== '#/') location.hash = '#/';
  await new Promise((r) => setTimeout(r, 900));
  location.reload();
}

// Mise à jour forcée : les fichiers du programme sont relus depuis le serveur (sans cache), l'ancien cache du programme est supprimé, puis l'application redémarre.
export async function forceUpdate(onStep = () => {}) {
  onStep('Lecture de la liste des fichiers…');
  const swText = await (await fetch('sw.js?v=' + Date.now(), { cache: 'no-store' })).text();
  const block = /const SHELL = \[([\s\S]*?)\n\];/.exec(swText);
  const files = block ? [...block[1].replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  onStep(`Téléchargement de ${files.length} fichiers…`);
  let done = 0;
  for (const f of files) {
    try { await fetch(f === './' ? './' : f, { cache: 'reload' }); } catch { /* hors connexion : on continue */ }
    done++; if (done % 10 === 0) onStep(`Téléchargement ${done}/${files.length}…`);
  }
  onStep('Activation de la nouvelle version…');
  const reg = await registration();
  if (reg) { try { await reg.update(); } catch {} }
  try { for (const k of await caches.keys()) if (k.startsWith('dictaphone-')) await caches.delete(k); } catch {}
  await reloadSafely();
}

// Surveillance : à l'ouverture, au retour dans l'application et quand un nouveau service worker prend la main
export function startUpdateWatcher(onOutdated) {
  let shown = false;
  const check = async () => {
    try { const pub = await publishedVersion(); if (pub && pub !== APP_VERSION && !shown) { shown = true; onOutdated(pub); } } catch { /* hors connexion */ }
  };
  const recheck = async () => { const reg = await registration(); if (reg) { try { await reg.update(); } catch {} } check(); };
  setTimeout(recheck, 2500);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') recheck(); });
  window.addEventListener('pageshow', (ev) => { if (ev.persisted) recheck(); });
  setInterval(recheck, 30 * 60 * 1000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', () => setTimeout(check, 500));
}