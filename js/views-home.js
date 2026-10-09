// Écran d'accueil
import { h, icon, catIcon, empty } from './ui.js';
import { CATEGORIES } from './defaults.js';
import { listEntretiens, listFolders, listTemplates, statsFor, hasTranscript, hasReport } from './store.js';
import { entretienRow, go } from './common.js';
import { lastBackupAt } from './backup.js';

export async function homeView() {
  const [entretiens, folders, templates] = await Promise.all([listEntretiens(), listFolders(), listTemplates()]);
  const stats = statsFor(entretiens);
  const recent = entretiens.slice().sort((a, b) => Math.max(b.updatedAt, b.date) - Math.max(a.updatedAt, a.date)).slice(0, 5);
  const recentFolders = folders.filter((f) => f.lastOpened > 0).sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 4);
  const nTr = entretiens.filter(hasTranscript).length, nCr = entretiens.filter(hasReport).length;

  const el = h('div', { class: 'view' },
    h('div', { class: 'brand' },
      h('img', { src: 'img/emblem-tile.png', alt: '', width: 46, height: 46 }),
      h('div', {}, h('div', { class: 'name', text: 'Dictaphone IA' }), h('div', { class: 'sub', text: 'Ade-ci Family Office' }))),
    h('p', { class: 'lead', style: { margin: '18px 0 14px' }, text: 'Vos entretiens, transcriptions et comptes rendus, au même endroit.' }),
    h('button', { class: 'btn primary', onclick: () => go('#/nouveau') }, icon('plus'), h('span', { text: 'Nouvel entretien' })),

    h('div', { class: 'quick', style: { marginTop: '16px' } },
      h('a', { href: '#/bibliotheque?filter=transcriptions' }, h('b', { text: String(nTr) }), h('span', { text: 'Transcriptions' })),
      h('a', { href: '#/bibliotheque?filter=rapports' }, h('b', { text: String(nCr) }), h('span', { text: 'Comptes rendus' })),
      h('a', { href: '#/trames' }, h('b', { text: String(templates.length) }), h('span', { text: 'Trames' }))),

    h('div', { class: 'sec-head' }, h('h2', { text: 'Catégories' })),
    ...CATEGORIES.map((c) => {
      const st = stats[c.id] || { total: 0, toWrite: 0 };
      const sub = st.total ? `${st.total} entretien${st.total > 1 ? 's' : ''}` + (st.toWrite ? ` · ${st.toWrite} à rédiger` : '') : 'Aucun entretien pour le moment';
      return h('a', { class: 'cat-card', href: '#/bibliotheque?cat=' + c.id },
        h('div', { class: 'tile' }, catIcon(c.id)),
        h('div', {}, h('h3', { text: c.label }), h('p', { text: sub })),
        h('span', { class: 'chev' }, icon('chevron')));
    }),
    stats.none ? h('a', { class: 'cat-card', href: '#/bibliotheque?cat=none' },
      h('div', { class: 'tile' }, icon('archive')),
      h('div', {}, h('h3', { text: 'Non classés' }), h('p', { text: `${stats.none.total} élément${stats.none.total > 1 ? 's' : ''} des versions d'essai` })),
      h('span', { class: 'chev' }, icon('chevron'))) : null,

    h('div', { class: 'sec-head' }, h('h2', { text: 'Derniers entretiens' }), h('a', { href: '#/bibliotheque?mode=liste', text: 'Tout voir' })),
    recent.length
      ? h('div', { class: 'list' }, recent.map((e) => entretienRow(e)))
      : h('div', { class: 'card' }, empty('Aucun entretien', 'Créez votre premier entretien en collant une transcription.')),

    recentFolders.length ? h('div', {},
      h('div', { class: 'sec-head' }, h('h2', { text: 'Dossiers récents' })),
      h('div', { class: 'chips' }, recentFolders.map((f) => h('a', { class: 'chip', style: { textDecoration: 'none', padding: '8px 14px', fontSize: '14px' }, href: `#/bibliotheque?cat=${f.category}&f=${f.id}`, text: f.name })))) : null,
  );

  // Rappel de sauvegarde
  const last = lastBackupAt();
  const old = !last || Date.now() - last > 7 * 86400000;
  if (entretiens.length && old) {
    el.append(h('div', { class: 'banner warn' }, icon('info'), h('div', {},
      h('div', { text: last ? 'Dernière sauvegarde il y a plus d\'une semaine.' : 'Vos données n\'ont encore jamais été sauvegardées.' }),
      h('div', { class: 'hint', text: 'Elles sont stockées uniquement sur cet appareil.' }),
      h('button', { text: 'Sauvegarder maintenant', onclick: () => go('#/reglages?do=sauvegarde') }))));
  }
  return { el };
}
