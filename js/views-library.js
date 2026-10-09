// Bibliothèque : catégories, dossiers et sous-dossiers, recherche, tri.
import { h, icon, catIcon, empty, promptDialog, confirmDialog, actionSheet, toast } from './ui.js';
import { CATEGORIES, catLabel, catShort } from './defaults.js';
import * as S from './store.js';
import { entretienRow, pickFolder, go } from './common.js';

const state = { q: '', sort: 'recent', mode: 'dossiers' };
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const hashFor = (q) => '#/bibliotheque' + (Object.keys(q).length ? '?' + new URLSearchParams(q).toString() : '');

function sorter(kind) {
  if (kind === 'ancien') return (a, b) => a.date - b.date;
  if (kind === 'nom') return (a, b) => a.title.localeCompare(b.title, 'fr');
  return (a, b) => b.date - a.date;
}

// Dernière vue de la bibliothèque (sur ordinateur, la liste reste affichée à côté de la fiche ouverte)
export let lastQuery = null;

export async function libraryView({ query, selectedId = null, remember = true }) {
  if (remember) lastQuery = { ...query };
  let [entretiens, folders] = await Promise.all([S.listEntretiens(), S.listFolders()]);
  const cat = query.cat || '';              // '' = toutes, 'none' = non classés, sinon id de catégorie
  const folderId = query.f || null;
  const filter = query.filter || '';        // transcriptions | rapports
  state.mode = query.mode === 'liste' ? 'liste' : 'dossiers'; // le mode dépend de l'adresse : jamais « collé » d'une visite à l'autre
  const folder = folderId ? folders.find((f) => f.id === folderId) : null;
  if (folder) S.touchFolder(folder);

  const reload = async () => { [entretiens, folders] = await Promise.all([S.listEntretiens(), S.listFolders()]); renderList(); };
  const nav = (patch) => { const q = { ...query, ...patch }; for (const k of Object.keys(q)) if (!q[k]) delete q[k]; go(hashFor(q)); };

  // ----- actions -----
  async function newFolder() {
    let c = cat && cat !== 'none' ? cat : null;
    if (!c) {
      c = await new Promise((resolve) => actionSheet({ title: 'Dans quelle catégorie ?', actions: CATEGORIES.map((x) => ({ label: x.label, icon: 'folder', run: () => resolve(x.id) })) }));
    }
    const name = await promptDialog({ title: 'Nouveau dossier', label: 'Nom du dossier', placeholder: 'Ex. Famille Exemple', confirmLabel: 'Créer' });
    if (!name) return;
    await S.createFolder({ category: c, parentId: folder && folder.category === c ? folder.id : null, name });
    toast('Dossier créé');
    if (!cat) nav({ cat: c }); else reload();
  }
  function folderMenu(f) {
    actionSheet({ title: f.name, actions: [
      { label: 'Renommer', icon: 'edit', run: async () => { const n = await promptDialog({ title: 'Renommer le dossier', value: f.name }); if (n) { await S.renameFolder(f, n); reload(); toast('Dossier renommé'); } } },
      { label: 'Déplacer', icon: 'move', run: async () => {
        const r = await pickFolder({ categories: [f.category], folders, excludeIds: S.descendantIds(f.id, folders), current: { category: f.category, folderId: f.parentId }, title: 'Déplacer le dossier vers…' });
        if (r) { await S.moveFolder(f, r.folderId); reload(); toast('Dossier déplacé'); }
      } },
      { label: 'Supprimer', icon: 'trash', danger: true, run: async () => {
        const inside = entretiens.filter((e) => e.folderId === f.id).length, subs = folders.filter((x) => x.parentId === f.id).length;
        const ok = await confirmDialog({ title: 'Supprimer ce dossier ?', danger: true, confirmLabel: 'Supprimer le dossier',
          message: `« ${f.name} » sera supprimé.` + (inside || subs ? `\nSon contenu (${inside} entretien(s), ${subs} sous-dossier(s)) ne sera PAS supprimé : il sera remonté dans le dossier parent.` : '') });
        if (ok) { await S.deleteFolder(f, folders, entretiens); toast('Dossier supprimé'); if (folderId === f.id) nav({ f: f.parentId || '' }); else reload(); }
      } },
    ] });
  }
  function entretienMenu(e) {
    actionSheet({ title: e.title, actions: [
      { label: 'Ouvrir', icon: 'doc', run: () => go('#/entretien/' + e.id) },
      { label: 'Renommer', icon: 'edit', run: async () => { const n = await promptDialog({ title: 'Renommer l\'entretien', value: e.title }); if (n) { e.title = n; e.titleAuto = false; await S.saveEntretien(e); reload(); toast('Entretien renommé'); } } },
      { label: 'Déplacer', icon: 'move', run: async () => {
        const r = await pickFolder({ folders, current: { category: e.category, folderId: e.folderId }, title: 'Déplacer l\'entretien vers…' });
        if (r) { e.category = r.category; e.folderId = r.folderId; await S.saveEntretien(e); reload(); toast('Entretien déplacé'); }
      } },
      { label: 'Supprimer', icon: 'trash', danger: true, run: async () => {
        const ok = await confirmDialog({ title: 'Supprimer cet entretien ?', danger: true, confirmLabel: 'Supprimer définitivement',
          message: `« ${e.title} » sera supprimé de cet appareil avec sa transcription, son compte rendu et son audio.\nCette action est irréversible. Pensez à faire une sauvegarde.` });
        if (ok) { await S.removeEntretien(e.id); reload(); toast('Entretien supprimé'); }
      } },
    ] });
  }

  // ----- rendu -----
  const listBox = h('div', {});
  const head = (label, action) => h('div', { class: 'sec-head' }, h('h2', { text: label }), action || null);
  function renderList() {
    listBox.textContent = '';
    const q = norm(state.q.trim());
    const sort = sorter(state.sort);
    const inCat = (e) => !cat || (cat === 'none' ? !e.category : e.category === cat);
    const flat = (items) => h('div', { class: 'list' }, items.sort(sort).map((e) => entretienRow(e, { onMore: entretienMenu, showCat: !cat, selected: e.id === selectedId })));
    const catRow = (c, n, nf) => h('a', { class: 'row', href: '#/bibliotheque?cat=' + c.id },
      h('div', { class: 'tile' }, catIcon(c.id)),
      h('div', { class: 'grow' }, h('div', { class: 't', text: c.label }), h('div', { class: 'm', text: `${n} entretien${n > 1 ? 's' : ''} · ${nf} dossier${nf > 1 ? 's' : ''}` })),
      icon('chevron', 'chev'));

    if (q) {
      const hits = entretiens.filter(inCat).filter((e) => norm(e.title + ' ' + (e.who || '') + ' ' + (e.subject || '') + ' ' + S.transcriptOf(e) + ' ' + S.reportOf(e).map((r) => r.title + ' ' + r.content).join(' ')).includes(q));
      listBox.append(h('p', { class: 'hint', style: { marginTop: '18px' }, text: hits.length + ' résultat' + (hits.length > 1 ? 's' : '') }), hits.length ? flat(hits) : empty('Aucun résultat', 'Essayez un autre mot.'));
      return;
    }
    if (filter || state.mode === 'liste') {
      let items = entretiens.filter(inCat);
      if (filter === 'transcriptions') items = items.filter(S.hasTranscript);
      if (filter === 'rapports') items = items.filter(S.hasReport);
      if (filter === 'arediger') items = items.filter((e) => S.hasTranscript(e) && !S.hasReport(e));
      listBox.append(head('Entretiens'), items.length ? flat(items) : empty('Rien à afficher', 'Aucun entretien ne correspond à ce filtre.'));
      return;
    }
    if (cat === 'none') {
      const items = entretiens.filter((e) => !e.category);
      listBox.append(h('p', { class: 'hint', style: { marginTop: '18px' }, text: 'Enregistrements des versions d\'essai : déplacez-les dans une catégorie et un dossier.' }), items.length ? flat(items) : empty('Aucun élément non classé'));
      return;
    }
    if (!cat) { // toutes les catégories : dossiers (de toutes les catégories) puis tous les entretiens
      const roots = folders.filter((f) => !f.parentId).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      listBox.append(head('Dossiers', h('button', { text: '＋ Nouveau', onclick: newFolder })));
      if (roots.length) {
        listBox.append(h('div', { class: 'folders' }, roots.map((f) => {
          const ne = entretiens.filter((e) => e.folderId === f.id).length, nf = folders.filter((x) => x.parentId === f.id).length;
          const go1 = () => nav({ cat: f.category, f: f.id });
          return h('div', { class: 'folder', role: 'link', tabindex: '0', onclick: go1, onkeydown: (ev) => { if (ev.key === 'Enter') go1(); } },
            h('div', { class: 'tile' }, icon('folder')),
            h('div', {}, h('b', { text: f.name }), h('small', { text: `${ne} fiche${ne > 1 ? 's' : ''}${nf ? ' · ' + nf + ' sous-dossier' + (nf > 1 ? 's' : '') : ''}` })),
            h('button', { class: 'more', 'aria-label': 'Actions du dossier', onclick: (ev) => { ev.stopPropagation(); folderMenu(f); } }, icon('more')));
        })));
      } else listBox.append(h('p', { class: 'hint', text: 'Aucun dossier pour le moment. Les catégories se choisissent avec les filtres ci-dessus.' }));
      listBox.append(head('Entretiens', h('button', { text: '＋ Nouveau', onclick: () => go('#/nouveau') })));
      listBox.append(entretiens.length ? flat(entretiens.slice()) : empty('Aucun entretien', 'Créez votre premier entretien.'));
      return;
    }    // une catégorie : dossier courant
    const subs = folders.filter((f) => f.category === cat && f.parentId === (folder ? folder.id : null)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const items = entretiens.filter((e) => e.category === cat && e.folderId === (folder ? folder.id : null));
    listBox.append(head('Dossiers', h('button', { text: '＋ Nouveau', onclick: newFolder })));
    if (subs.length) {
      listBox.append(h('div', { class: 'folders' }, subs.map((f) => {
        const ne = entretiens.filter((e) => e.folderId === f.id).length, nf = folders.filter((x) => x.parentId === f.id).length;
        return h('div', { class: 'folder', role: 'link', tabindex: '0', onclick: () => nav({ f: f.id }), onkeydown: (ev) => { if (ev.key === 'Enter') nav({ f: f.id }); } },
          h('div', { class: 'tile' }, icon('folder')),
          h('div', {}, h('b', { text: f.name }), h('small', { text: `${ne} fiche${ne > 1 ? 's' : ''}${nf ? ' · ' + nf + ' sous-dossier' + (nf > 1 ? 's' : '') : ''}` })),
          h('button', { class: 'more', 'aria-label': 'Actions du dossier', onclick: (ev) => { ev.stopPropagation(); folderMenu(f); } }, icon('more')));
      })));
    } else listBox.append(h('p', { class: 'hint', text: folder ? 'Aucun sous-dossier.' : 'Aucun dossier pour le moment.' }));
    listBox.append(head('Entretiens', h('button', { text: '＋ Nouveau', onclick: () => go('#/nouveau?cat=' + cat + (folder ? '&f=' + folder.id : '')) })));
    if (items.length) listBox.append(flat(items));
    else listBox.append(empty(folder ? 'Dossier vide' : 'Aucun entretien ici', 'Créez un entretien ou déplacez-en un dans ce dossier.'));
  }

  // ----- structure de la page -----
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Rechercher un client, un sujet…', value: state.q, 'aria-label': 'Rechercher', autocomplete: 'off', enterkeyhint: 'search' });
  search.addEventListener('input', () => { state.q = search.value; renderList(); });
  const catChips = h('div', { class: 'fchips', role: 'tablist' },
    [{ id: '', short: 'Tous' }, ...CATEGORIES].map((c) => h('button', { class: cat === c.id ? 'on' : '', role: 'tab', text: c.short, onclick: () => nav({ cat: c.id, f: '', filter: '' }) })));
  const sortSel = h('select', { class: 'sortsel', 'aria-label': 'Trier' },
    h('option', { value: 'recent', text: 'Plus récents' }), h('option', { value: 'ancien', text: 'Plus anciens' }), h('option', { value: 'nom', text: 'Nom (A–Z)' }));
  sortSel.value = state.sort;
  sortSel.addEventListener('change', () => { state.sort = sortSel.value; renderList(); });
  const modeSeg = h('div', { class: 'seg' },
    h('button', { class: state.mode === 'dossiers' && !filter ? 'on' : '', text: 'Dossiers', onclick: () => { state.mode = 'dossiers'; nav({ mode: 'dossiers', filter: '' }); } }),
    h('button', { class: state.mode === 'liste' || filter ? 'on' : '', text: 'Liste', onclick: () => { state.mode = 'liste'; nav({ mode: 'liste' }); } }));

  const path = folder ? S.folderPath(folder.id, folders) : [];
  const crumbs = cat && cat !== 'none' && !filter && state.mode === 'dossiers' ? h('div', { class: 'crumbs' },
    h('button', { text: catShort(cat), onclick: () => nav({ f: '' }) }),
    path.map((f, i) => [h('span', { text: '›' }), i === path.length - 1 ? h('b', { style: { color: 'var(--ink)' }, text: f.name }) : h('button', { text: f.name, onclick: () => nav({ f: f.id }) })])) : null;

  const el = h('div', { class: 'view' },
    h('div', { class: 'eyebrow', text: filter === 'transcriptions' ? 'Transcriptions' : filter === 'rapports' ? 'Comptes rendus' : filter === 'arediger' ? 'À rédiger' : 'Bibliothèque' }),
    h('h1', { class: 'page-title', text: cat && cat !== 'none' ? catLabel(cat) : cat === 'none' ? 'Non classés' : 'Vos entretiens' }),
    h('div', { class: 'searchbox' }, icon('search'), search),
    catChips,
    h('div', { class: 'tools' }, modeSeg, sortSel),
    crumbs,
    listBox);
  renderList();
  return { el };
}
