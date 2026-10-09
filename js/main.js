// Point d'entrée : navigation entre les écrans, barre du bas, initialisation.
import { h, icon, toast } from './ui.js';
import * as S from './store.js';
import { homeView } from './views-home.js';
import { libraryView } from './views-library.js';
import { newView, ficheView } from './views-entretien.js';
import { templatesView, templateEditView } from './views-templates.js';
import { settingsView } from './views-settings.js';

const routes = [
  [/^\/?$/, homeView, 'home'],
  [/^\/bibliotheque$/, libraryView, 'library'],
  [/^\/nouveau$/, newView, 'new'],
  [/^\/entretien\/([\w-]+)$/, ficheView, 'library'],
  [/^\/trames$/, templatesView, 'templates'],
  [/^\/trame\/([\w-]+)$/, templateEditView, 'templates'],
  [/^\/reglages$/, settingsView, 'settings'],
];

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
const TABS = [
  ['home', '#/', 'home', 'Accueil'], ['library', '#/bibliotheque', 'folder', 'Bibliothèque'], ['new', '#/nouveau', 'plus', 'Nouvel entretien'],
  ['templates', '#/trames', 'template', 'Trames'], ['settings', '#/reglages', 'gear', 'Réglages'],
];
const tabEls = {};
for (const [id, href, ic, label] of TABS) {
  const plus = id === 'new';
  const a = h('a', { class: 'tab' + (plus ? ' tab-plus' : ''), href, 'aria-label': label },
    plus ? h('span', { class: 'bubble' }, icon(ic)) : icon(ic), h('span', { text: plus ? 'Nouveau' : label }));
  tabEls[id] = a; tabbar.append(a);
}
const setActive = (id) => { for (const [k, a] of Object.entries(tabEls)) { a.classList.toggle('on', k === id && k !== 'new'); a.toggleAttribute('aria-current', k === id); if (k !== id) a.removeAttribute('aria-current'); else a.setAttribute('aria-current', 'page'); } };

let current = null, seq = 0;
function errorView(err) {
  console.error('Erreur d\'affichage :', err && err.message);
  return { el: h('div', { class: 'view' }, h('div', { class: 'card' },
    h('h2', { class: 'serif', style: { fontSize: '24px' }, text: 'Un problème est survenu' }),
    h('p', { text: 'L\'écran n\'a pas pu s\'afficher. Vos données ne sont pas modifiées.' }),
    h('p', { class: 'hint', text: String((err && err.message) || err).slice(0, 200) }),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', text: 'Recharger', onclick: () => location.reload() }), h('a', { class: 'btn', href: '#/', text: 'Accueil' })))) };
}

async function render() {
  const my = ++seq;
  if (current && current.dispose) { try { await current.dispose(); } catch {} }
  current = null;
  const raw = location.hash.replace(/^#/, '');
  const [path, qs = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  let out, tab = 'home';
  try {
    const route = routes.find(([re]) => re.test(path));
    if (!route) { location.replace('#/'); return; }
    tab = route[2];
    const params = path.match(route[0]).slice(1);
    out = await route[1]({ params, query });
  } catch (err) { out = errorView(err); }
  if (my !== seq) return;
  app.replaceChildren(out.el);
  current = out;
  setActive(tab);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);
window.addEventListener('unhandledrejection', (e) => { console.error('Erreur :', e.reason && e.reason.message); toast('Une erreur est survenue.'); });

(async function start() {
  try {
    await S.ensureDefaults();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (err) { app.replaceChildren(errorView(err).el); return; }
  await render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
