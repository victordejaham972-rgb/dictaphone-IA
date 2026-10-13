// Suppressions réversibles et Corbeille. Rien n'est effacé au premier geste : tout part dans la corbeille (restaurable).
// La suppression définitive est une action séparée, toujours confirmée, et laisse une « pierre tombale » (voir store.js).
import { h, icon, toast, toastAction, sheet, confirmDialog, actionSheet } from './ui.js';
import * as S from './store.js';
import { topbar, go } from './common.js';
import { fmtDateTime } from './exports.js';

const plural = (n, s, p) => `${n} ${n > 1 ? p : s}`;

// ---------- Fiche(s) ----------
export async function trashFiches(list, { onDone } = {}) {
  const many = list.length > 1;
  const ok = await confirmDialog({ title: many ? `Mettre ${list.length} fiches dans la corbeille ?` : 'Mettre cette fiche dans la corbeille ?', confirmLabel: 'Mettre dans la corbeille',
    message: (many ? `Ces ${list.length} fiches seront retirées` : `« ${list[0].title} » sera retirée`) + ' de la bibliothèque, avec leur transcription, compte rendu, document et audio.\nRien n\'est effacé : vous pourrez les restaurer depuis la Corbeille (Réglages › Corbeille).' });
  if (!ok) return false;
  for (const e of list) await S.trashEntretien(e);
  toastAction(many ? `${list.length} fiches placées dans la corbeille.` : 'Fiche placée dans la corbeille.', 'Annuler', async () => {
    for (const e of list) await S.restoreEntretien(e);
    toast('Restaurée' + (many ? 's' : ''));
    if (onDone) onDone('restored');
  });
  if (onDone) onDone('trashed');
  return true;
}

// ---------- Dossier : jamais de suppression en cascade par accident ----------
export function trashFolder(f, folders, entretiens, { onDone } = {}) {
  const c = S.folderContents(f, folders, entretiens);
  const nF = c.fiches.length, nS = c.subs.length;
  const docs = c.fiches.filter((e) => e.hasOriginal).length, audios = c.fiches.filter((e) => e.nChunks > 0).length;
  const parentName = f.parentId ? (folders.find((x) => x.id === f.parentId) || {}).name || 'le dossier parent' : 'la racine de la catégorie';
  return new Promise((resolve) => {
    sheet({ title: `Supprimer le dossier « ${f.name} » ?`, build(body, close) {
      const done = (r) => { close(); resolve(r); if (onDone) onDone(r); };
      if (!nF && !nS) {
        body.append(h('p', { class: 'sheet-msg', text: 'Ce dossier est vide. Il sera placé dans la corbeille (restaurable).' }),
          h('div', { class: 'sheet-actions' },
            h('button', { class: 'btn primary', text: 'Mettre le dossier dans la corbeille', onclick: async () => { await S.trashFolderOnly(f, folders, entretiens); toast('Dossier placé dans la corbeille'); done('trashed'); } }),
            h('button', { class: 'btn', text: 'Annuler', onclick: () => done(null) })));
        return;
      }
      body.append(h('div', { class: 'banner warn', style: { marginTop: 0 } }, icon('info'), h('div', {},
        h('b', { text: `Ce dossier contient ${plural(nF, 'fiche', 'fiches')}${nS ? ' et ' + plural(nS, 'sous-dossier', 'sous-dossiers') : ''}.` }),
        h('div', { text: `${docs ? plural(docs, 'document joint', 'documents joints') + ', ' : ''}${audios ? plural(audios, 'audio', 'audios') + '. ' : ''}Aucune suppression automatique de ce contenu n'est faite.` }))),
        h('h4', { text: 'Choix 1 — supprimer le dossier seulement' }),
        h('p', { class: 'hint', text: `Les ${plural(nF, 'fiche', 'fiches')} et sous-dossiers sont CONSERVÉS et remontés dans « ${parentName} ».` }),
        h('button', { class: 'btn primary', text: 'Supprimer le dossier seulement', onclick: async () => { await S.trashFolderOnly(f, folders, entretiens); toast('Dossier placé dans la corbeille ; son contenu est conservé'); done('trashed'); } }),
        h('h4', { style: { marginTop: '22px' }, text: `Choix 2 — supprimer le dossier ET ses ${plural(nF, 'fiche', 'fiches')}` }),
        h('p', { class: 'hint', text: 'Tout part dans la corbeille en un seul groupe, restaurable d\'un geste. Pour confirmer, saisissez le nom exact du dossier.' }));
      const typed = h('input', { class: 'field', placeholder: f.name, autocapitalize: 'none', autocomplete: 'off', 'aria-label': 'Nom du dossier' });
      const go2 = h('button', { class: 'btn danger', text: 'Supprimer le dossier et son contenu', disabled: true, onclick: async () => {
        const r = await S.trashFolderTree(f, folders, entretiens);
        toastAction(`Dossier et ${plural(r.fiches, 'fiche', 'fiches')} placés dans la corbeille.`, 'Annuler', async () => { const g = (await S.listTrash()).find((x) => x.kind === 'groupe' && x.id === r.group); if (g) await S.restoreFolder(g.root); toast('Restauré'); if (onDone) onDone('restored'); });
        done('tree');
      } });
      typed.addEventListener('input', () => { go2.disabled = typed.value.trim() !== f.name.trim(); });
      body.append(typed, h('div', { style: { height: '10px' } }), go2, h('div', { style: { height: '10px' } }), h('button', { class: 'btn', text: 'Annuler', onclick: () => done(null) }));
    } });
  });
}

// ---------- Éléments d'une fiche ----------
export async function trashPartFlow(e, part, { onDone } = {}) {
  const T = { document: ['le document joint', 'Document joint', 'Le fichier reste récupérable dans la corbeille.'],
    audio: ['l\'enregistrement audio', 'Enregistrement audio', 'L\'audio reste récupérable dans la corbeille.'],
    transcript: ['la transcription corrigée', 'Transcription corrigée', 'L\'ORIGINAL de la transcription est conservé dans la fiche et n\'est jamais supprimé par cette action.'] }[part];
  const ok = await confirmDialog({ title: `Retirer ${T[0]} ?`, confirmLabel: 'Retirer (corbeille)', message: `${T[1]} de « ${e.title} » sera retiré de la fiche.\n${T[2]}` });
  if (!ok) return false;
  const payload = part === 'document' ? { name: (await (await import('../db.js')).getOriginal(e.id) || {}).name || 'document' } : part === 'audio' ? { nChunks: e.nChunks } : { text: S.transcriptOf(e) };
  await S.trashPart(e, part, payload);
  toastAction(`${T[1]} retiré.`, 'Annuler', async () => { await S.restorePart(e, part); toast('Restauré'); if (onDone) onDone('restored'); });
  if (onDone) onDone('trashed');
  return true;
}

// ---------- Page Corbeille ----------
export async function trashView() {
  const box = h('div', {});
  const head = h('div', {});
  async function draw() {
    const items = await S.listTrash();
    head.replaceChildren(h('p', { class: 'hint', text: items.length ? `${plural(items.length, 'élément', 'éléments')} dans la corbeille. Rien n'est supprimé automatiquement : vous décidez.` : 'La corbeille est vide.' }));
    box.replaceChildren();
    if (items.length) box.append(h('button', { class: 'btn danger-ghost', onclick: async () => {
      const ok = await confirmDialog({ title: 'Vider la corbeille ?', danger: true, confirmLabel: 'Supprimer définitivement', message: `${plural(items.length, 'élément', 'éléments')} seront supprimés DÉFINITIVEMENT de cet appareil, avec leurs transcriptions, comptes rendus, documents et audios.\nCette action est irréversible. Une sauvegarde faite avant reste le seul moyen de les retrouver.` });
      if (!ok) return;
      for (const it of items) await purge(it);
      toast('Corbeille vidée'); draw();
    } }, icon('trash'), h('span', { text: 'Vider la corbeille…' })));
    for (const it of items) box.append(entry(it));
  }
  async function purge(it) {
    if (it.kind === 'fiche') await S.purgeEntretien(it.e);
    else if (it.kind === 'dossier') await S.purgeFolder(it.folder);
    else if (it.kind === 'groupe') await S.purgeFolder(it.root);
    else await S.purgePart(it.e, it.kind === 'transcription' ? 'transcript' : it.kind);
  }
  async function restore(it) {
    if (it.kind === 'fiche') await S.restoreEntretien(it.e);
    else if (it.kind === 'dossier') await S.restoreFolder(it.folder);
    else if (it.kind === 'groupe') await S.restoreFolder(it.root);
    else if (it.kind === 'transcription') {
      const cur = S.transcriptOf(it.e);
      let mode = 'replace';
      if (cur.trim()) {
        mode = await new Promise((res) => actionSheet({ title: 'La fiche contient déjà du texte', lead: 'Que faire de la transcription retirée ?', actions: [
          { label: 'Ajouter à la suite du texte actuel', icon: 'plus', run: () => res('append') },
          { label: 'Remplacer le texte actuel', sub: 'L\'original reste conservé', icon: 'back', run: () => res('replace') }] }));
      }
      await S.restorePart(it.e, 'transcript', { mode });
    } else await S.restorePart(it.e, it.kind);
  }
  const KIND = { fiche: 'Fiche', dossier: 'Dossier', groupe: 'Dossier et son contenu', document: 'Document joint', audio: 'Audio', transcription: 'Transcription corrigée' };
  function entry(it) {
    const detail = it.kind === 'groupe' ? `${plural(it.fiches.length, 'fiche', 'fiches')}${it.folders.length > 1 ? ' · ' + plural(it.folders.length - 1, 'sous-dossier', 'sous-dossiers') : ''}` : '';
    return h('div', { class: 'card trash-item' },
      h('div', { class: 'eyebrow', text: KIND[it.kind] }),
      h('div', { style: { fontWeight: 600, color: 'var(--ink)' }, text: it.title }),
      h('div', { class: 'hint', style: { margin: '2px 0 0' }, text: 'Supprimé le ' + fmtDateTime(it.at) + (detail ? ' · ' + detail : '') }),
      h('div', { class: 'acts' },
        h('button', { class: 'btn primary', onclick: async () => { await restore(it); toast('Restauré'); draw(); } }, icon('back'), h('span', { text: 'Restaurer' })),
        h('button', { class: 'btn danger-ghost', onclick: async () => {
          const ok = await confirmDialog({ title: 'Supprimer définitivement ?', danger: true, confirmLabel: 'Supprimer définitivement', message: `« ${it.title} » sera supprimé de cet appareil.\nCette action est irréversible.` });
          if (!ok) return; await purge(it); toast('Supprimé définitivement'); draw();
        } }, icon('trash'), h('span', { text: 'Supprimer définitivement' }))));
  }
  await draw();
  const el = h('div', { class: 'view' },
    topbar({ back: () => go('#/reglages'), backLabel: 'Réglages' }),
    h('div', { class: 'eyebrow', text: 'Corbeille' }), h('h1', { class: 'page-title', text: 'Éléments supprimés' }), h('div', { class: 'rule' }), head, box);
  return { el };
}
export const trashCount = async () => (await S.listTrash()).length;
