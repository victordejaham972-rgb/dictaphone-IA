// Trames de comptes rendus : liste et éditeur visuel.
import { h, icon, catIcon, toast, confirmDialog, actionSheet, promptDialog, empty } from './ui.js';
import { CATEGORIES, catLabel } from './defaults.js';
import * as S from './store.js';
import { go, topbar } from './common.js';

export async function templatesView() {
  const el = h('div', { class: 'view' });
  const box = h('div', {});
  async function render() {
    const [templates, entretiens] = await Promise.all([S.listTemplates(), S.listEntretiens()]);
    box.textContent = '';
    for (const c of CATEGORIES) {
      const list = templates.filter((t) => t.category === c.id);
      box.append(h('div', { class: 'sec-head' }, h('h2', { text: c.label })));
      if (!list.length) { box.append(h('p', { class: 'hint', text: 'Aucune trame.' })); continue; }
      box.append(h('div', { class: 'list' }, list.map((t) => h('div', { class: 'row', role: 'link', tabindex: '0', onclick: () => go('#/trame/' + t.id), onkeydown: (ev) => { if (ev.key === 'Enter') go('#/trame/' + t.id); } },
        h('div', { class: 'tile' }, icon('template')),
        h('div', { class: 'grow' }, h('div', { class: 't', text: t.name }),
          h('div', { class: 'm', text: `${t.sections.length} rubrique${t.sections.length > 1 ? 's' : ''}` }),
          h('div', { class: 'chips' }, t.isDefault ? h('span', { class: 'chip ok', text: 'Par défaut' }) : null, t.builtin ? h('span', { class: 'chip', text: 'Trame d\'origine' }) : null)),
        h('button', { class: 'more', 'aria-label': 'Actions', onclick: (ev) => { ev.stopPropagation(); menu(t, entretiens); } }, icon('more'))))));
    }
  }
  function menu(t, entretiens) {
    actionSheet({ title: t.name, actions: [
      { label: 'Modifier', icon: 'edit', run: () => go('#/trame/' + t.id) },
      { label: 'Dupliquer', icon: 'copy', run: async () => { const c = await S.duplicateTemplate(t); toast('Trame dupliquée'); go('#/trame/' + c.id); } },
      t.isDefault ? null : { label: 'Définir comme trame par défaut', icon: 'check', run: async () => { await S.setDefaultTemplate(t.id); toast('Trame par défaut mise à jour'); render(); } },
      t.builtin ? { label: 'Rétablir la trame d\'origine', icon: 'archive', run: async () => {
        if (await confirmDialog({ title: 'Rétablir la trame d\'origine ?', message: 'Vos modifications de cette trame seront remplacées par la version d\'origine. Les comptes rendus déjà rédigés ne sont pas modifiés.', confirmLabel: 'Rétablir' })) { const o = await S.resetTemplate(t.id); o.isDefault = t.isDefault; await S.saveTemplate(o); toast('Trame rétablie'); render(); }
      } } : null,
      t.builtin ? null : { label: 'Supprimer', icon: 'trash', danger: true, run: async () => {
        const used = entretiens.filter((e) => e.templateId === t.id).length;
        if (await confirmDialog({ title: 'Supprimer cette trame ?', danger: true, confirmLabel: 'Supprimer', message: `« ${t.name} » sera supprimée.` + (used ? `\n${used} entretien(s) l'utilisent : leurs comptes rendus ne sont pas modifiés.` : '') })) { await S.deleteTemplate(t.id); toast('Trame supprimée'); render(); }
      } },
    ].filter(Boolean) });
  }
  el.append(
    h('div', { class: 'eyebrow', text: 'Trames' }), h('h1', { class: 'page-title', text: 'Trames de comptes rendus' }), h('div', { class: 'rule' }),
    h('p', { class: 'lead', text: 'Chaque trame définit les rubriques d\'un compte rendu. Créez et modifiez les vôtres, sans toucher au code.' }),
    h('button', { class: 'btn primary', onclick: () => go('#/trame/new') }, icon('plus'), h('span', { text: 'Nouvelle trame' })), box);
  await render();
  return { el };
}

export async function templateEditView({ params, query }) {
  const templates = await S.listTemplates();
  const isNew = params[0] === 'new';
  const orig = isNew ? null : templates.find((t) => t.id === params[0]);
  if (!isNew && !orig) return { el: h('div', { class: 'view' }, topbar({ back: () => go('#/trames') }), empty('Trame introuvable')) };
  const t = isNew
    ? { id: S.uid('t'), category: CATEGORIES.some((c) => c.id === query.cat) ? query.cat : 'clients', name: '', builtin: false, isDefault: false, sections: [S.newSection('', '')] }
    : JSON.parse(JSON.stringify(orig));
  let dirty = false;
  const mark = () => { dirty = true; saveBtn.disabled = false; };

  const name = h('input', { class: 'field', value: t.name, placeholder: 'Ex. Entretien de bilan', maxlength: '80', 'aria-label': 'Nom de la trame' });
  name.addEventListener('input', () => { t.name = name.value; mark(); });
  const catSel = h('select', { class: 'field', 'aria-label': 'Catégorie' }, CATEGORIES.map((c) => h('option', { value: c.id, text: c.label })));
  catSel.value = t.category;
  catSel.addEventListener('change', () => { t.category = catSel.value; mark(); });
  const box = h('div', {});
  function renderSections() {
    box.textContent = '';
    t.sections.forEach((s, i) => {
      const title = h('input', { class: 'field', value: s.title, placeholder: 'Titre de la rubrique', maxlength: '80', 'aria-label': 'Titre de la rubrique ' + (i + 1) });
      title.addEventListener('input', () => { s.title = title.value; mark(); });
      const instr = h('textarea', { class: 'textarea', rows: '2', placeholder: 'Consigne de rédaction (ce qu\'il faut mettre dans cette rubrique)', 'aria-label': 'Consigne de la rubrique ' + (i + 1), style: { marginTop: '8px', minHeight: '64px' } });
      instr.value = s.instruction || '';
      instr.addEventListener('input', () => { s.instruction = instr.value; mark(); });
      const mv = (d) => { const j = i + d; if (j < 0 || j >= t.sections.length) return; [t.sections[i], t.sections[j]] = [t.sections[j], t.sections[i]]; mark(); renderSections(); };
      box.append(h('div', { class: 'sec-edit' },
        h('div', { class: 'top' }, title,
          h('button', { class: 'mini', 'aria-label': 'Monter', disabled: i === 0, onclick: () => mv(-1) }, icon('up')),
          h('button', { class: 'mini', 'aria-label': 'Descendre', disabled: i === t.sections.length - 1, onclick: () => mv(1) }, icon('down')),
          h('button', { class: 'mini del', 'aria-label': 'Supprimer la rubrique', onclick: async () => {
            if ((s.title || s.instruction) && !(await confirmDialog({ title: 'Supprimer cette rubrique ?', message: `« ${s.title || 'Sans titre'} » sera retirée de la trame.`, danger: true, confirmLabel: 'Supprimer' }))) return;
            t.sections.splice(i, 1); mark(); renderSections();
          } }, icon('trash'))),
        instr));
    });
    box.append(h('button', { class: 'btn small', onclick: () => { t.sections.push(S.newSection()); mark(); renderSections(); setTimeout(() => { const f = box.querySelectorAll('.sec-edit .field'); f[f.length - 1] && f[f.length - 1].focus(); }, 60); } }, icon('plus'), h('span', { text: 'Ajouter une rubrique' })));
  }
  renderSections();

  async function save() {
    t.name = t.name.trim();
    if (!t.name) { toast('Donnez un nom à la trame.'); name.focus(); return; }
    t.sections = t.sections.filter((s) => s.title.trim() || s.instruction.trim());
    if (!t.sections.length) { toast('Ajoutez au moins une rubrique.'); t.sections.push(S.newSection()); renderSections(); return; }
    t.sections.forEach((s) => { s.title = s.title.trim() || 'Rubrique'; });
    if (isNew && !templates.some((x) => x.category === t.category && x.isDefault)) t.isDefault = true;
    await S.saveTemplate(t);
    dirty = false;
    toast('Trame enregistrée');
    go('#/trames');
  }
  const saveBtn = h('button', { class: 'btn primary', disabled: !isNew, onclick: save }, icon('check'), h('span', { text: 'Enregistrer la trame' }));
  const leave = async () => {
    if (!dirty || await confirmDialog({ title: 'Quitter sans enregistrer ?', message: 'Les modifications de cette trame seront perdues.', confirmLabel: 'Quitter', danger: true })) go('#/trames');
  };
  return { el: h('div', { class: 'view' },
    topbar({ back: leave, backLabel: 'Trames' }),
    h('div', { class: 'eyebrow', text: isNew ? 'Nouvelle trame' : 'Modifier la trame' }),
    h('h1', { class: 'page-title', text: isNew ? 'Créer une trame' : t.name || 'Trame' }), h('div', { class: 'rule' }),
    t.builtin ? h('p', { class: 'hint', text: 'Trame d\'origine : vous pouvez la modifier, et la rétablir ensuite depuis la liste des trames.' }) : null,
    h('label', { class: 'lbl', text: 'Nom' }), name,
    h('label', { class: 'lbl', text: 'Catégorie' }), catSel,
    h('div', { class: 'sec-head' }, h('h2', { text: 'Rubriques' })),
    h('p', { class: 'hint', style: { marginTop: '-6px' }, text: 'Chaque rubrique devient une partie du compte rendu. La consigne indique ce qu\'il faut y mettre.' }),
    box, h('div', { class: 'stickybar' }, saveBtn)) };
}
