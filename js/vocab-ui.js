// Réglages : vocabulaire de correction, sous forme de section dépliable (fermée par défaut).
// Les corrections servent à réécrire les mots que la transcription Apple orthographie mal (PEA, assurance-vie, SCPI…).
import { h, icon, toast, confirmDialog } from './ui.js';
import * as S from './store.js';

export function vocabAccordion() {
  let list = S.getVocab();
  let open = false, query = '';
  const save = () => { S.setVocab(list); count(); };
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const title = h('div', { class: 'acc-title', text: 'Vocabulaire de correction' });
  const sub = h('div', { class: 'acc-sub' });
  const chev = icon('chevron', 'acc-chev');
  const head = h('button', { class: 'acc-head', 'aria-expanded': 'false', onclick: () => { open = !open; sync(); } }, h('div', { class: 'tile' }, icon('edit')), h('div', { class: 'grow' }, title, sub), chev);
  const body = h('div', { class: 'acc-body', hidden: true });
  const card = h('div', { class: 'card acc' }, head, body);
  const count = () => { const n = list.length; sub.textContent = n ? `${n} correction${n > 1 ? 's' : ''} enregistrée${n > 1 ? 's' : ''}` : 'Aucune correction enregistrée'; };

  // ----- ajout rapide -----
  const fromInp = h('input', { class: 'field', placeholder: 'Mot mal transcrit (ex. assurance vie)', autocapitalize: 'none', autocorrect: 'off', maxlength: '100', 'aria-label': 'Mot mal transcrit' });
  const toInp = h('input', { class: 'field', placeholder: 'Bonne écriture (ex. assurance-vie)', autocapitalize: 'none', autocorrect: 'off', maxlength: '100', 'aria-label': 'Bonne écriture' });
  const csChk = h('input', { type: 'checkbox', id: 'vocab-cs' });
  const addErr = h('p', { class: 'hint', style: { color: 'var(--danger)', margin: '6px 0 0' }, hidden: true });
  function add() {
    const f = fromInp.value.trim(), t = toInp.value.trim();
    const dup = list.find((v) => v.from.trim().toLowerCase() === f.toLowerCase());
    const err = S.checkVocabEntry(f, t, list.concat(dup ? [] : []));
    if (err) { addErr.textContent = err; addErr.hidden = false; return; }
    addErr.hidden = true;
    if (dup) { dup.to = t; if (csChk.checked) dup.cs = true; else delete dup.cs; toast('Correction mise à jour'); }
    else { const e = { from: f, to: t }; if (csChk.checked) e.cs = true; list.unshift(e); toast('Correction ajoutée'); }
    save(); fromInp.value = ''; toInp.value = ''; csChk.checked = false; query = ''; search.value = ''; draw(); fromInp.focus();
  }
  const addBtn = h('button', { class: 'btn primary', style: { marginTop: '12px' }, onclick: add }, icon('plus'), h('span', { text: 'Ajouter cette correction' }));
  toInp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') add(); });
  const adder = h('div', { class: 'acc-add' },
    h('div', { class: 'lbl', style: { marginTop: 0 }, text: 'Nouvelle correction' }), fromInp, h('div', { style: { height: '8px' } }), toInp,
    h('label', { class: 'check', for: 'vocab-cs' }, csChk, h('span', { text: 'Respecter exactement les majuscules (pour un terme ambigu)' })), addErr, addBtn);

  // ----- liste -----
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Rechercher dans mes corrections', 'aria-label': 'Rechercher dans mes corrections', autocomplete: 'off' });
  search.addEventListener('input', () => { query = norm(search.value.trim()); draw(); });
  const listBox = h('div', { class: 'acc-list' });
  function draw() {
    listBox.textContent = '';
    const shown = list.map((v, i) => ({ v, i })).filter(({ v }) => !query || norm(v.from + ' ' + v.to).includes(query));
    if (!shown.length) listBox.append(h('p', { class: 'hint', text: list.length ? 'Aucune correction ne correspond.' : 'Aucune correction pour le moment. Ajoutez-en une ci-dessus.' }));
    for (const { v, i } of shown) {
      const a = h('input', { class: 'field', value: v.from, autocapitalize: 'none', autocorrect: 'off', maxlength: '100', 'aria-label': 'Mot mal transcrit' });
      const b = h('input', { class: 'field', value: v.to, autocapitalize: 'none', autocorrect: 'off', maxlength: '100', 'aria-label': 'Bonne écriture' });
      const warn = h('p', { class: 'hint', style: { color: 'var(--danger)', margin: '4px 0 0' }, hidden: true });
      const commit = () => {
        const f = a.value.trim(), t = b.value.trim();
        const err = S.checkVocabEntry(f, t, []);
        if (err) { warn.textContent = err + ' Modification non enregistrée.'; warn.hidden = false; return; }
        warn.hidden = true; v.from = f; v.to = t; save();
      };
      a.addEventListener('change', commit); b.addEventListener('change', commit);
      const cs = h('input', { type: 'checkbox', checked: !!v.cs, 'aria-label': 'Respecter exactement les majuscules' });
      cs.addEventListener('change', () => { if (cs.checked) v.cs = true; else delete v.cs; save(); });
      listBox.append(h('div', { class: 'vocab-item' },
        h('label', { class: 'lbl', style: { marginTop: 0 }, text: 'La transcription écrit' }), a,
        h('label', { class: 'lbl', style: { marginTop: '8px' }, text: 'Remplacer par' }), b, warn,
        h('div', { class: 'vocab-foot' },
          h('label', { class: 'check' }, cs, h('span', { text: 'Casse exacte' })),
          h('button', { class: 'btn small danger-ghost', 'aria-label': 'Supprimer cette correction', onclick: async () => {
            if (!(await confirmDialog({ title: 'Supprimer cette correction ?', message: `« ${v.from} » → « ${v.to} »`, confirmLabel: 'Supprimer', danger: true }))) return;
            list.splice(list.indexOf(v), 1); save(); draw(); toast('Correction supprimée');
          } }, icon('trash'), h('span', { text: 'Supprimer' })))));
    }
  }
  body.append(h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Mots que la transcription écrit souvent mal. Dans une fiche, « Corriger » puis « Appliquer mon vocabulaire » les remplace d\'un coup. Seuls les mots entiers sont remplacés ; les chiffres, les montants et les noms propres ne sont jamais touchés.' }), adder, h('div', { class: 'lbl' }, 'Corrections enregistrées'), search, listBox);

  function sync() { body.hidden = !open; head.setAttribute('aria-expanded', String(open)); card.classList.toggle('open', open); if (open) draw(); }
  count();
  return card;
}
