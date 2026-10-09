// Éléments d'interface partagés entre les écrans.
import { h, icon, catIcon, sheet, promptDialog } from './ui.js';
import { CATEGORIES, catLabel, catShort } from './defaults.js';
import { hasTranscript, hasReport, hasAudio, createFolder } from './store.js';
import { fmtDate } from './exports.js';

export const go = (hash) => { location.hash = hash; };

export function topbar({ back, backLabel = 'Retour', right }) {
  return h('div', { class: 'topbar' },
    back ? h('button', { class: 'back', 'aria-label': backLabel, onclick: back }, icon('back'), h('span', { text: backLabel })) : null,
    h('div', { class: 'spacer' }), right || null);
}

export function statusChips(e) {
  const chips = [];
  if (hasTranscript(e)) chips.push(h('span', { class: 'chip', text: 'Transcription' }));
  if (hasReport(e)) chips.push(h('span', { class: 'chip ok', text: 'Compte rendu' }));
  else if (hasTranscript(e)) chips.push(h('span', { class: 'chip warn', text: 'À rédiger' }));
  if (hasAudio(e)) chips.push(h('span', { class: 'chip', text: 'Audio' }));
  return h('div', { class: 'chips' }, chips);
}

export function entretienRow(e, { onMore, showCat = true } = {}) {
  const meta = [fmtDate(e.date), showCat ? catShort(e.category) : null].filter(Boolean).join(' · ');
  return h('div', { class: 'row', role: 'link', tabindex: '0', onclick: () => go('#/entretien/' + e.id), onkeydown: (ev) => { if (ev.key === 'Enter') go('#/entretien/' + e.id); } },
    h('div', { class: 'tile' }, e.category ? catIcon(e.category) : icon('doc')),
    h('div', { class: 'grow' }, h('div', { class: 't', text: e.title }), h('div', { class: 'm', text: meta }), statusChips(e)),
    onMore ? h('button', { class: 'more', 'aria-label': 'Actions', onclick: (ev) => { ev.stopPropagation(); onMore(e); } }, icon('more')) : h('span', { class: 'chev' }, icon('chevron')));
}

// Sélecteur de dossier. Retourne { category, folderId } (folderId null = racine de la catégorie) ou null si annulé.
export function pickFolder({ categories = CATEGORIES.map((c) => c.id), folders, excludeIds = new Set(), current = null, title = 'Choisir un dossier' }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v, close) => { if (!settled) { settled = true; resolve(v); } close && close(); };
    const s = sheet({ title, build(body, close) {
      const render = () => {
        body.textContent = '';
        for (const cid of categories) {
          body.append(h('div', { class: 'eyebrow', style: { margin: '14px 0 4px' }, text: catLabel(cid) }));
          const list = h('div', { class: 'list' });
          const rootSel = current && current.category === cid && current.folderId === null;
          list.append(h('button', { class: 'picker-row', onclick: () => done({ category: cid, folderId: null }, close) },
            icon('folder'), h('span', { style: { flex: 1 }, text: 'Racine de « ' + catShort(cid) + ' »' }), rootSel ? icon('check') : null));
          const walk = (parentId, depth) => {
            for (const f of folders.filter((x) => x.category === cid && x.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, 'fr'))) {
              if (excludeIds.has(f.id)) continue;
              const sel = current && current.folderId === f.id;
              list.append(h('button', { class: 'picker-row', style: { paddingLeft: 10 + depth * 22 + 'px' }, onclick: () => done({ category: cid, folderId: f.id }, close) },
                icon('folder'), h('span', { style: { flex: 1 }, text: f.name }), sel ? icon('check') : null));
              walk(f.id, depth + 1);
            }
          };
          walk(null, 1);
          body.append(list,
            h('button', { class: 'btn small', style: { marginTop: '8px' }, onclick: async () => {
              const name = await promptDialog({ title: 'Nouveau dossier', label: 'Nom du dossier', confirmLabel: 'Créer' });
              if (!name) return;
              const f = await createFolder({ category: cid, parentId: null, name });
              folders.push(f);
              done({ category: cid, folderId: f.id }, close);
            } }, icon('folder-plus'), h('span', { text: 'Nouveau dossier' })));
        }
        body.append(h('button', { class: 'btn', style: { marginTop: '18px' }, text: 'Annuler', onclick: () => done(null, close) }));
      };
      render();
    } });
    s.body.parentElement.parentElement.addEventListener('click', (e) => { if (e.target.classList.contains('overlay')) done(null); });
  });
}
