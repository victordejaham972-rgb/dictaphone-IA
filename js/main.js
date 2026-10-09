// Point d'entrée : navigation entre les écrans, barre du bas, initialisation.
import { h, icon, toast } from './ui.js';
import * as S from './store.js';
import { homeView, backupAgo } from './views-home.js';
import { libraryView, lastQuery } from './views-library.js';
import { lastBackupAt } from './backup.js';
import { newView, ficheView } from './views-entretien.js';
import { templatesView, templateEditView } from './views-templates.js';
import { settingsView } from './views-settings.js';
import { startUpdateWatcher, forceUpdate } from './update.js';

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
    plus ? h('span', { class: 'bubble' }, icon(ic)) : icon(ic), plus ? [h('span', { class: 'l-m', text: 'Nouveau' }), h('span', { class: 'l-d', text: 'Nouvel entretien' })] : h('span', { text: label }));
  tabEls[id] = a; tabbar.append(a);
}
// Ordinateur : la barre du bas devient un menu à gauche, avec la marque et le rappel de sauvegarde
const tabWrap = tabbar.parentElement;
tabWrap.prepend(h('div', { class: 'side-brand' }, h('img', { src: 'img/emblem-tile.png', alt: '', width: 44, height: 44 }), h('div', {}, h('div', { class: 'name', text: 'Dictaphone IA' }), h('div', { class: 'sub', text: 'Ade-ci Family Office' }))));
const sideFoot = h('div', { class: 'side-foot' });
tabWrap.append(sideFoot);
const refreshFoot = () => { const last = lastBackupAt(); sideFoot.replaceChildren(icon('shield'), h('br'), last ? 'Dernière sauvegarde' : 'Aucune sauvegarde', last ? h('b', { text: backupAgo(last) }) : h('b', { text: 'à faire dans Réglages' })); };
refreshFoot();
// Clavier ouvert : sur iPhone, une barre fixée en bas de l'écran « flotte » au milieu de l'écran quand le clavier s'affiche.
// Tant qu'un champ de saisie est actif, la barre du bas est donc masquée ; elle revient dès que le clavier se ferme.
{
  const root = document.documentElement;
  const NOT_TEXT = ['button', 'checkbox', 'radio', 'file', 'submit', 'range', 'color', 'reset', 'image'];
  const isField = (el) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !NOT_TEXT.includes(el.type)));
  const setKbd = (on) => root.classList.toggle('kbd', on);
  let timer = 0;
  document.addEventListener('focusin', (ev) => { if (isField(ev.target)) { clearTimeout(timer); setKbd(true); } });
  document.addEventListener('focusout', () => { clearTimeout(timer); timer = setTimeout(() => { if (!isField(document.activeElement)) setKbd(false); }, 150); });
  const vv = window.visualViewport;
  if (vv) {
    const check = () => { if (window.innerHeight - vv.height > 120) setKbd(true); else if (!isField(document.activeElement)) setKbd(false); };
    vv.addEventListener('resize', check); vv.addEventListener('scroll', check);
  }
}
const setActive = (id) => { for (const [k, a] of Object.entries(tabEls)) { a.classList.toggle('on', k === id && k !== 'new'); a.toggleAttribute('aria-current', k === id); if (k !== id) a.removeAttribute('aria-current'); else a.setAttribute('aria-current', 'page'); } };

let current = null, seq = 0;
const routeTab = (p) => (routes.find(([re]) => re.test(p)) || [0, 0, 'home'])[2];
function errorView(err) {
  console.error('Erreur d\'affichage :', err && err.message);
  return { el: h('div', { class: 'view' }, h('div', { class: 'card' },
    h('h2', { class: 'serif', style: { fontSize: '24px' }, text: 'Un problème est survenu' }),
    h('p', { text: 'L\'écran n\'a pas pu s\'afficher. Vos données ne sont pas modifiées.' }),
    h('p', { class: 'hint', text: String((err && err.message) || err).slice(0, 360) }),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', text: 'Recharger', onclick: () => location.reload() }), h('a', { class: 'btn', href: '#/', text: 'Accueil' }), h('a', { class: 'btn', href: 'diagnostic.html', text: 'Diagnostic' })))) };
}
// Jamais d'écran vide : si l'affichage tarde (stockage du navigateur lent ou bloqué), on l'indique et on propose le diagnostic.
function slowNotice() {
  return h('div', { class: 'view', 'data-slow': '1' }, h('div', { class: 'card' },
    h('h2', { class: 'serif', style: { fontSize: '22px' }, text: 'Chargement en cours…' }),
    h('p', { class: 'hint', text: 'Le navigateur met du temps à ouvrir le stockage de l\'application. Vos données ne sont pas modifiées. Si rien ne s\'affiche dans quelques secondes, lancez le diagnostic.' }),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', text: 'Recharger', onclick: () => location.reload() }), h('a', { class: 'btn', href: 'diagnostic.html', text: 'Diagnostic' }))));
}

// Ordinateur large : la liste des entretiens reste affichée à gauche de la fiche (trois colonnes avec le menu)
const DESK = window.matchMedia('(min-width: 1000px)');
async function render() {
  const my = ++seq;
  if (current && current.dispose) { try { await current.dispose(); } catch {} }
  current = null;
  const raw = location.hash.replace(/^#/, '');
  const [path, qs = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  const prevList = app.querySelector('.pane-list'), listScroll = prevList ? prevList.scrollTop : 0;
  let out, listOut = null, tab = 'home';
  const slow = setTimeout(() => { if (my === seq) { app.replaceChildren(slowNotice()); setActive(routeTab(path)); } }, 3500);
  try {
    const route = routes.find(([re]) => re.test(path));
    if (!route) { clearTimeout(slow); location.replace('#/'); return; }
    tab = route[2];
    const params = path.match(route[0]).slice(1);
    const isFiche = route[1] === ficheView, isLib = route[1] === libraryView;
    if (DESK.matches && (isFiche || isLib)) {
      if (isFiche) { listOut = await libraryView({ query: lastQuery || { mode: 'liste' }, selectedId: params[0], remember: false }); out = await ficheView({ params, query }); }
      else { listOut = await libraryView({ params, query, selectedId: null }); out = { el: h('div', { class: 'pane-empty' }, h('div', {}, h('img', { src: 'img/emblem-ivory.png', alt: '', style: { filter: 'invert(.25) sepia(1) hue-rotate(150deg)' } }), h('h2', { text: 'Sélectionnez un entretien' }), h('p', { text: 'Ouvrez une fiche dans la liste, ou créez un nouvel entretien.' }))) }; }
    } else out = await route[1]({ params, query });
  } catch (err) { out = errorView(err); listOut = null; }
  clearTimeout(slow);
  if (my !== seq) return;
  if (listOut) {
    app.replaceChildren(h('div', { class: 'split' }, h('aside', { class: 'pane-list' }, listOut.el), h('section', { class: 'pane-main' }, out.el)));
    const pl = app.querySelector('.pane-list'); if (pl) pl.scrollTop = listScroll;
  } else app.replaceChildren(out.el);
  current = out;
  setActive(tab);
  refreshFoot();
  window.scrollTo(0, 0);
}
DESK.addEventListener('change', () => render());window.addEventListener('hashchange', render);
window.addEventListener('unhandledrejection', (e) => { console.error('Erreur :', e.reason && e.reason.message); toast('Une erreur est survenue.'); });

(async function start() {
  try {
    const defaults = S.ensureDefaults();
    defaults.catch(() => {});
    await Promise.race([defaults, new Promise((r) => setTimeout(r, 3000))]);   // ne jamais laisser l'écran vide si le stockage tarde
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (err) { console.error('Initialisation :', err && err.message); }   // l'écran affichera lui-même l'erreur, et l'application reste utilisable (Réglages, diagnostic)
  await render();
  // Service worker : `updateViaCache: 'none'` = le fichier sw.js est toujours vérifié auprès du serveur (jamais lu dans le cache du navigateur)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});

// Nouvelle version publiée : bandeau « Mettre à jour » (la mise à jour ne supprime aucune donnée)
startUpdateWatcher((pub) => {
  const bar = h('div', { class: 'update-banner', role: 'status' },
    h('span', { text: `Une nouvelle version (${pub}) est disponible.` }),
    h('button', { class: 'btn small primary', text: 'Mettre à jour', onclick: async (ev) => { ev.target.disabled = true; ev.target.textContent = 'Mise à jour…'; try { await forceUpdate(); } catch { ev.target.disabled = false; ev.target.textContent = 'Mettre à jour'; toast('Mise à jour impossible : vérifiez la connexion.', 4500); } } }),
    h('button', { class: 'iconbtn', 'aria-label': 'Plus tard', text: '×', onclick: () => bar.remove() }));
  document.body.append(bar);
});
})();
