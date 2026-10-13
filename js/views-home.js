// Écran d'accueil
import { h, icon, catIcon, empty } from './ui.js';
import { CATEGORIES } from './defaults.js';
import { listEntretiens, listFolders, listTemplates, statsFor, stepOf } from './store.js';
import { entretienRow, go } from './common.js';
import { lastBackupAt } from './backup.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const backupAgo = (ms) => {
  if (!ms) return null;
  const d = Math.floor((Date.now() - ms) / 86400000);
  return d <= 0 ? 'aujourd\'hui' : d === 1 ? 'hier' : `il y a ${d} jours`;
};

export async function homeView() {
  const [entretiens, folders, templates] = await Promise.all([listEntretiens(), listFolders(), listTemplates()]);
  const stats = statsFor(entretiens);
  const recent = entretiens.slice().sort((a, b) => Math.max(b.updatedAt, b.date) - Math.max(a.updatedAt, a.date)).slice(0, 5);
  const recentFolders = folders.filter((f) => f.lastOpened > 0).sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 4);
  const todo = entretiens.filter((e) => stepOf(e) !== 'termine').sort((a, b) => Math.max(b.updatedAt, b.date) - Math.max(a.updatedAt, a.date));
  const nToWrite = todo.length;
  const now = new Date();
  // Coffre : invitation à l'activer, ou bouton « Verrouiller » (sur ordinateur, ce bouton est dans le menu de gauche)
  const vaultSlot = h('div', {});
  (async () => {
    try {
      const V = await import('./vault.js');
      const st = V.state();
      if (st === 'absent') { const m = await import('./vault-ui.js'); const c = m.inviteCard(); if (c) vaultSlot.append(c); }
      else if (st === 'unlocked') {
        const m = await import('./vault-ui.js'); const sp = m.spaceName();
        vaultSlot.append(h('div', { class: 'lock-home' }, h('span', { class: 'hint', text: (sp ? 'Espace : ' + sp + ' · ' : '') + 'Coffre actif' }),
          h('button', { class: 'btn small', onclick: () => V.lock() }, icon('shield'), h('span', { text: 'Verrouiller' }))));
      }
    } catch { /* l'invitation est facultative */ }
  })();

  const el = h('div', { class: 'view home' },
    h('div', { class: 'brand' },
      h('img', { src: 'img/emblem-tile.png', alt: '', width: 46, height: 46 }),
      h('div', {}, h('div', { class: 'name', text: 'ADE-CI Notes' }), h('div', { class: 'sub', text: 'Ade-ci Family Office' })),
      h('div', { class: 'date' }, h('div', { text: cap(now.toLocaleDateString('fr-FR', { weekday: 'long' })) }), h('div', { text: now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) }))),

    vaultSlot,

    h('section', { class: 'hero' },
      h('div', { class: 'eyebrow', text: 'Nouvelle transcription' }),
      h('h2', { text: 'Une transcription à traiter ?' }),
      h('p', { text: 'Importer → Corriger et protéger → Choisir la trame → Ouvrir dans ChatGPT → Enregistrer le compte rendu.' }),
      h('button', { class: 'btn', onclick: () => go('#/nouveau') }, icon('plus'), h('span', { text: 'Importer une transcription' }))),

    h('div', { class: 'quick' },
      h('a', { href: '#/bibliotheque?mode=liste' }, h('b', { text: String(entretiens.length) }), h('span', { text: 'Fiches' })),
      h('a', { href: '#/bibliotheque?filter=arediger' }, h('b', { text: String(nToWrite) }), h('span', {}, nToWrite ? h('i', { class: 'dot' }) : null, 'À traiter')),
      h('a', { href: '#/trames' }, h('b', { text: String(templates.length) }), h('span', { text: 'Trames' }))),

    todo.length ? h('div', {},
      h('div', { class: 'sec-head' }, h('h2', { text: 'À traiter' }), h('a', { href: '#/bibliotheque?filter=arediger', text: 'Tout voir' })),
      h('div', { class: 'list' }, todo.slice(0, 4).map((e) => entretienRow(e)))) : null,

    h('div', { class: 'sec-head' }, h('h2', { text: 'Catégories' })),
    h('div', { class: 'list' },
      CATEGORIES.map((c) => {
        const st = stats[c.id] || { total: 0, toWrite: 0 };
        const sub = st.total ? `${st.total} entretien${st.total > 1 ? 's' : ''}` + (st.toWrite ? ` · ${st.toWrite} à traiter` : '') : 'Aucun entretien pour le moment';
        return h('a', { class: 'row', href: '#/bibliotheque?cat=' + c.id },
          h('div', { class: 'tile' }, catIcon(c.id)),
          h('div', { class: 'grow' }, h('div', { class: 't', text: c.label }), h('div', { class: 'm', text: sub })),
          icon('chevron', 'chev'));
      }),
      stats.none ? h('a', { class: 'row', href: '#/bibliotheque?cat=none' },
        h('div', { class: 'tile' }, icon('archive')),
        h('div', { class: 'grow' }, h('div', { class: 't', text: 'Non classés' }), h('div', { class: 'm', text: `${stats.none.total} élément${stats.none.total > 1 ? 's' : ''} des versions d'essai` })),
        icon('chevron', 'chev')) : null),

    h('div', { class: 'sec-head' }, h('h2', { text: 'Récemment ouverts' }), h('a', { href: '#/bibliotheque?mode=liste', text: 'Tout voir' })),
    recent.length
      ? h('div', { class: 'list' }, recent.map((e) => entretienRow(e)))
      : h('div', { class: 'card' }, empty('Aucun entretien', 'Créez votre premier entretien en ajoutant une transcription.')),

    recentFolders.length ? h('div', {},
      h('div', { class: 'sec-head' }, h('h2', { text: 'Dossiers récents' })),
      h('div', { class: 'chips' }, recentFolders.map((f) => h('a', { class: 'chip', style: { textDecoration: 'none', padding: '9px 15px', fontSize: '14px' }, href: `#/bibliotheque?cat=${f.category}&f=${f.id}`, text: f.name })))) : null,
  );

  // Rappel de sauvegarde
  const last = lastBackupAt();
  if (entretiens.length) {
    const old = !last || Date.now() - last > 7 * 86400000;
    el.append(h('div', { class: 'note' + (old ? ' warn' : '') }, icon('shield'),
      h('span', { text: last ? `Dernière sauvegarde ${backupAgo(last)}` : 'Vos données n\'ont encore jamais été sauvegardées' }),
      h('a', { href: '#/reglages?do=sauvegarde', text: 'Sauvegarder' })));
  }
  return { el };
}
