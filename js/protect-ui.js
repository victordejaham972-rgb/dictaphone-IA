// Onglet « Protéger » d'une fiche : pseudonymisation locale de la transcription, relecture obligatoire, copie pour une IA externe.
// Ce module (et le moteur js/protect/*) n'est chargé qu'à l'ouverture de l'onglet. Rien n'est envoyé par l'application.
import { h, icon, toast, sheet, promptDialog, confirmDialog } from './ui.js';
import * as S from './store.js';
import { kv } from './vault.js';
import { copyText } from './exports.js';
import { catLabel } from './defaults.js';

const LEVELS = {
  standard: { label: 'Standard', desc: 'Masque : noms et prénoms, coordonnées, identifiants (IBAN, cartes, sécurité sociale, contrats), dates de naissance et lieu de naissance, employeur et sociétés du client. Conserve : communes, écoles, fonctions, dates d\'événements.' },
  renforce: { label: 'Renforcé', desc: 'Standard, plus : communes, régions et départements, écoles et établissements de santé, fonctions de direction (remplacées par « une fonction de direction »), dates précises d\'événements de vie (ramenées au mois ou à l\'année), titre du même nom que l\'employeur du client (à décider).' },
};
const SHEET_FIELDS = [
  ['employers', 'Employeur(s) du client', 'Un par ligne. Ex. : Airbus'],
  ['companies', 'Sociétés du client (détenues ou dirigées)', 'Un par ligne. Ex. : Transports Exemple'],
  ['cities', 'Communes à masquer', 'Un par ligne (niveau Renforcé).'],
  ['addresses', 'Adresses', 'Un par ligne.'],
  ['others', 'Autres termes à toujours masquer', 'Un par ligne : nom d\'un projet, d\'un bien, surnom…'],
];
const ROLE_LABEL = { assureur: 'Assureur', banque: 'Banque', gestionnaire: 'Société de gestion', fonds_produit: 'Fonds ou produit', courtier_plateforme: 'Courtier ou plateforme', emetteur_cote: 'Entreprise cotée' };
const CAT_LABEL = { PERSONNE: 'Personne', EMPLOYEUR: 'Entreprise (employeur possible)', SOCIETE: 'Société', VILLE: 'Commune ou lieu', ETABLISSEMENT_LIEU: 'École ou établissement', ADRESSE: 'Adresse', TELEPHONE: 'Téléphone', EMAIL: 'E-mail', IBAN: 'IBAN', CARTE: 'Carte bancaire', NIR: 'Numéro de sécurité sociale', SIREN: 'SIREN / SIRET', PLAQUE: 'Plaque', CONTRAT: 'Numéro de contrat', NAISSANCE: 'Date de naissance', DATE_VIE: 'Date d\'un événement de vie', FONCTION: 'Fonction', ETABLISSEMENT: 'Établissement financier ou titre', PRODUIT: 'Produit', AUTRE: 'Terme masqué' };

const GLOBAL_KEY = 'dia_protect';       // réglages locaux : listes « toujours / jamais masquer » et ajouts au dictionnaire financier
const readGlobal = () => { try { return JSON.parse(kv.get(GLOBAL_KEY)) || {}; } catch { return {}; } };
const writeGlobal = (g) => { try { kv.set(GLOBAL_KEY, JSON.stringify(g)); } catch {} };

let loaded = null;
async function loadEngine() {
  if (!loaded) {
    loaded = (async () => {
      const [eng, lexMod, exp] = await Promise.all([import('./protect/engine.js'), import('./protect/lexicon.js'), import('./protect/export.js')]);
      const [dict, names, communes] = await Promise.all([
        fetch('js/protect/dictionnaire-financier.json').then((r) => r.json()),
        fetch('js/protect/prenoms-insee.txt').then((r) => (r.ok ? r.text() : '')).catch(() => ''),
        fetch('js/protect/communes-insee.txt').then((r) => (r.ok ? r.text() : '')).catch(() => ''),
      ]);
      return { eng, lexMod, exp, dict, names: names.split(/\s+/).filter(Boolean), communes: new Set(communes.split('\n').map((x) => x.trim()).filter(Boolean)) };
    })();
    loaded.catch(() => { loaded = null; });
  }
  return loaded;
}
export function defaultProtect() {
  return { v: 1, level: 'renforce', sheet: { persons: [], employers: [], companies: [], cities: [], addresses: [], others: [] }, overrides: { byText: {}, byPos: {}, labels: {} }, alwaysMask: [], neverMask: [], leakAcks: [] };
}
const lines = (s) => s.split(/\n+/).map((x) => x.trim()).filter(Boolean);

// Empreinte rapide d'un texte (détecte un changement ; pas une fonction de sécurité) : la revue humaine est liée au texte protégé relu.
export const hashText = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(16) + ':' + s.length; };

// Analyse locale de la fiche (utilisée par l'étape « Corriger et protéger » ET par l'étape « ChatGPT » : un seul calcul, aucun envoi).
export async function runProtect(e) {
  if (!e.protect || typeof e.protect !== 'object') e.protect = defaultProtect();
  const P = e.protect;
  P.sheet = { ...defaultProtect().sheet, ...(P.sheet || {}) };
  P.overrides = { byText: {}, byPos: {}, labels: {}, ...(P.overrides || {}) };
  P.alwaysMask = P.alwaysMask || []; P.neverMask = P.neverMask || []; P.leakAcks = P.leakAcks || [];
  const ctx = await loadEngine();
  const g = readGlobal();
  const extraGroups = {};
  for (const d of g.dict || []) (extraGroups[d.role] = extraGroups[d.role] || []).push(d.name);
  const dict = { groupes: [...ctx.dict.groupes, ...Object.entries(extraGroups).map(([role, noms]) => ({ role, employeurFrequent: role === 'emetteur_cote' || role === 'banque' || role === 'assureur', noms }))] };
  const lexicon = ctx.lexMod.buildLexicon(dict);
  const res = ctx.eng.protect(S.transcriptOf(e), { level: P.level, sheet: P.sheet, lexicon, extraFirstNames: ctx.names, communes: ctx.communes, alwaysMask: [...(P.alwaysMask || []), ...(g.always || [])], neverMask: [...(P.neverMask || []), ...(g.never || [])], overrides: P.overrides });
  res.leaks = ctx.eng.leakCheck(res.protectedText, res.spans, P.sheet);
  // contrôle anti-fuite précis : positions exactes dans le texte d'origine, jamais sur les consignes ni la trame
  res.leakReport = ctx.eng.leakReport(S.transcriptOf(e), res.spans, P.sheet, { acks: P.leakAcks });
  const ti = (e.title || '').trim();
  res.titleLeak = ti.length >= 8 && res.protectedText.toLowerCase().includes(ti.toLowerCase());
  return { res, ctx };
}
// Table étiquette -> texte original (reste LOCALE : jamais copiée, jamais envoyée). Sert à la réintégration facultative des noms.
export function labelTable(res) {
  const m = new Map();
  for (const s of res.spans) if (s.decision === 'mask' && s.label && !m.has(s.label)) m.set(s.label, s.person ? s.person.name : s.text.replace(/^(?:M\.|Mme|Mlle|Monsieur|Madame|Mademoiselle|Maître)\s+/i, ''));
  return m;
}
// Instantané des correspondances au MOMENT de la copie : ce qui a réellement été envoyé (même texte protégé, mêmes étiquettes).
// Il reste dans la fiche (donc chiffré avec elle par le coffre) et n'est jamais transmis ; il évite qu'un changement ultérieur
// des corrections ou des listes décale les lettres (Personne A / B…) et fasse rétablir un mauvais nom.
// Paires [étiquette, original, genre] ; genre « pers » = personne (jamais rétablie par défaut), « info » = lieu, entreprise, produit…
export function restorePairsOf(res) {
  const kind = new Map();
  for (const s of res.spans) if (s.decision === 'mask' && s.label && !kind.has(s.label)) kind.set(s.label, s.ent && s.ent.fam === 'pers' ? 'pers' : 'info');
  const pairs = []; for (const [label, original] of labelTable(res)) if (label && original) pairs.push([label, original, kind.get(label) || 'info']);
  return pairs;
}
export function buildRestoreSnapshot(res, e) {
  return { v: 1, at: Date.now(), hash: hashText(res.protectedText), o: hashText((e && e.original) || ''), pairs: restorePairsOf(res) };
}
// Source des correspondances pour rétablir les noms dans un compte rendu de cette fiche, ou null si elle n'est pas fiable :
//  1. l'instantané enregistré à la copie ; 2. à défaut (ancienne fiche), un recalcul seulement s'il redonne EXACTEMENT le texte copié.
export async function restoreSource(e) {
  const P = e.protect;
  if (!P) return null;
  if (P.restore && Array.isArray(P.restore.pairs) && P.restore.pairs.length) {
    // l'instantané ne vaut que pour le document pour lequel il a été fait : transcription remplacée depuis, donc inutilisable
    if (typeof P.restore.o === 'string' && P.restore.o !== hashText(e.original || '')) return null;
    return { pairs: P.restore.pairs, at: P.restore.at || P.copiedAt || 0, how: 'copie' };
  }
  if (!P.reviewHash) return null;
  try {
    const { res } = await runProtect(e);
    if (hashText(res.protectedText) !== P.reviewHash) return null;
    const pairs = restorePairsOf(res);
    return pairs.length ? { pairs, at: P.copiedAt || 0, how: 'recalcul' } : null;
  } catch { return null; }
}
// ---------------------------------------------------------------------
// Surligne la première occurrence d'un terme dans une zone de texte (retour depuis le contrôle anti-fuite vers l'expression à corriger).
export function highlightTerm(root, term) {
  if (!root || !term) return false;
  const re = new RegExp('(?<![\\p{L}\\p{N}])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'iu');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const m = re.exec(n.nodeValue);
    if (!m) continue;
    const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
    const mark = document.createElement('mark'); mark.className = 'flash-mark';
    try { r.surroundContents(mark); } catch { return false; }
    mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }
  return false;
}
// Panneau « À traiter » : informations masquées encore présentes (avec expression, emplacement, raison) et éléments à décider,
// corrigeables directement depuis l'écran qui les signale. Utilisé à l'étape 2 et à l'étape 4.
export function issuesPanel({ e, res, edit, rerun, onJump }) {
  const P = e.protect;
  const box = h('div', { class: 'issues' });
  const leaks = res.leakReport ? res.leakReport.blocking : [];
  const todo = res.spans.filter((s) => !s.silent && s.certainty === 'maybe' && s.decision !== 'keep');
  if (!leaks.length && !todo.length && !res.titleLeak) {
    box.append(h('div', { class: 'card issue ok' }, icon('check'), h('span', { text: 'Rien à traiter : aucun élément à décider, aucune information masquée n\'est restée visible.' })));
    return box;
  }
  const around = (occ, term) => {
    const ctx = occ.context; const i = ctx.toLowerCase().indexOf(term.toLowerCase());
    if (i < 0) return h('span', { text: '… ' + ctx + ' …' });
    return h('span', {}, '… ' + ctx.slice(0, i), h('mark', { text: ctx.slice(i, i + term.length) }), ctx.slice(i + term.length) + ' …');
  };
  if (res.titleLeak) box.append(h('div', { class: 'card issue ko' }, h('div', { class: 'eyebrow', text: 'Information masquée encore présente' }),
    h('p', { class: 'hint', text: 'Le titre de la fiche apparaît tel quel dans la transcription. Modifiez le titre de la fiche (bouton « Fiche ») ou masquez ce passage.' })));
  for (const it of leaks) {
    const first = it.occurrences.find((o) => o.kind === 'oubli') || it.occurrences[0];
    const n = it.occurrences.filter((o) => o.kind === 'oubli').length;
    box.append(h('div', { class: 'card issue ko' },
      h('div', { class: 'eyebrow', text: 'Information masquée encore présente' }),
      h('div', { class: 'issue-term', text: `« ${it.term} »` }),
      h('p', { class: 'hint', style: { margin: '4px 0' }, text: `Raison : ${it.why}. ${n > 1 ? n + ' occurrences n\'ont' : 'Cette occurrence n\'a'} pas été masquée${n > 1 ? 's' : ''}.` }),
      h('p', { class: 'issue-ctx' }, around(first, it.term)),
      h('p', { class: 'hint', style: { margin: '4px 0 8px' }, text: `Emplacement : paragraphe ${first.paragraph}, caractère ${first.start + 1}.` }),
      h('div', { class: 'btn-row issue-acts' },
        h('button', { class: 'btn small primary', onclick: () => { P.alwaysMask.includes(it.term) || P.alwaysMask.push(it.term); edit(); toast(`« ${it.term} » sera masqué partout`); rerun(); } }, icon('shield'), h('span', { text: 'Masquer partout' })),
        h('button', { class: 'btn small', onclick: () => onJump && onJump(it.term) }, icon('search'), h('span', { text: 'Voir dans le texte' })),
        h('button', { class: 'btn small', onclick: async () => {
          if (!(await confirmDialog({ title: 'Cette expression n\'est pas confidentielle ?', confirmLabel: 'Oui, la laisser visible', message: `« ${it.term} » restera visible dans le texte copié, alors qu'elle est masquée ailleurs (${it.why}). Confirmez seulement si ce n'est pas une information identifiante ici.` }))) return;
          P.leakAcks.includes(it.term) || P.leakAcks.push(it.term); edit(); rerun();
        } }, icon('check'), h('span', { text: 'Pas confidentiel ici' })))));
  }
  for (const sp of todo) {
    const masked = sp.decision !== 'keep';
    box.append(h('div', { class: 'card issue warn' },
      h('div', { class: 'eyebrow', text: 'À décider' }),
      h('div', { class: 'issue-term', text: `« ${sp.text} »` }),
      h('p', { class: 'hint', style: { margin: '4px 0 8px' }, text: `${CAT_LABEL[sp.cat] || sp.cat} — ${sp.reason}. Actuellement : ${masked ? 'masqué (« ' + sp.label + ' »)' : 'conservé'}.` }),
      h('div', { class: 'btn-row issue-acts' },
        h('button', { class: 'btn small primary', onclick: () => { P.overrides.byText[sp.k] = 'mask'; edit(); rerun(); } }, h('span', { text: 'Masquer' })),
        h('button', { class: 'btn small', onclick: () => { P.overrides.byText[sp.k] = 'keep'; edit(); rerun(); } }, h('span', { text: 'Conserver tel quel' })),
        h('button', { class: 'btn small', onclick: () => onJump && onJump(sp.text) }, icon('search'), h('span', { text: 'Voir' })))));
  }
  if (todo.length > 1) box.append(h('button', { class: 'btn small', onclick: () => { for (const sp of todo) P.overrides.byText[sp.k] = 'mask'; edit(); rerun(); } }, icon('check'), h('span', { text: `Tout masquer par prudence (${todo.length})` })));
  return box;
}

export function protectTab({ e, templates, edit, saver, parcours = false }) {
  if (!e.protect || typeof e.protect !== 'object') e.protect = defaultProtect();
  const P = e.protect;
  P.sheet = { ...defaultProtect().sheet, ...(P.sheet || {}) };
  P.overrides = { byText: {}, byPos: {}, labels: {}, ...(P.overrides || {}) };
  P.alwaysMask = P.alwaysMask || []; P.neverMask = P.neverMask || [];

  const root = h('div', { class: 'ptab' });
  const resultBox = h('div', {});
  let ctx = null, res = null, viewMode = 'protege', checked = false, selTemplate = e.templateId || '';
  const text = () => S.transcriptOf(e);

  // ----- bandeau permanent -----
  const notice = h('div', { class: 'banner' }, icon('shield'), h('div', {},
    h('div', { style: { fontWeight: '700', color: 'var(--ink)', marginBottom: '2px' }, text: 'Pseudonymisation locale : ce n\'est pas une anonymisation' }),
    h('div', { text: 'L\'analyse se fait sur cet appareil. Une relecture humaine est obligatoire avant toute copie : des informations identifiantes peuvent échapper à la détection, et le texte protégé peut rester reconnaissable.' })));

  // ----- niveau -----
  const levelDesc = h('p', { class: 'hint', style: { marginTop: '10px' } });
  const seg = h('div', { class: 'seg' });
  function drawLevel() {
    seg.replaceChildren(...Object.entries(LEVELS).map(([id, l]) => h('button', { class: P.level === id ? 'on' : '', 'aria-pressed': String(P.level === id), text: l.label + (id === 'renforce' ? ' · recommandé' : ''), onclick: () => { P.level = id; edit(); drawLevel(); run(); } })));
    levelDesc.textContent = LEVELS[P.level].desc;
  }

  // ----- fiche d'identité -----
  const personsBox = h('div', {});
  function drawPersons() {
    personsBox.replaceChildren(...P.sheet.persons.map((p, i) => {
      const name = h('input', { class: 'field', value: p.name, placeholder: 'Nom et prénom', 'aria-label': 'Nom et prénom', autocapitalize: 'words' });
      const role = h('select', { class: 'field', 'aria-label': 'Rôle' }, [['client', 'Client(e)'], ['conjoint', 'Conjoint(e)'], ['proche', 'Proche'], ['tiers', 'Autre personne']].map(([v, l]) => h('option', { value: v, text: l, selected: p.role === v })));
      const gen = h('select', { class: 'field', 'aria-label': 'Genre (pour les étiquettes Client / Cliente)' }, [['', 'Genre non précisé'], ['F', 'Féminin'], ['M', 'Masculin']].map(([v, l]) => h('option', { value: v, text: l, selected: (p.gender || '') === v })));
      name.addEventListener('input', () => { p.name = name.value; edit(); }); name.addEventListener('change', run);
      role.addEventListener('change', () => { p.role = role.value; edit(); run(); }); gen.addEventListener('change', () => { p.gender = gen.value; edit(); run(); });
      return h('div', { class: 'sec-edit', style: { display: 'grid', gap: '8px' } }, name, h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } }, role, gen),
        h('button', { class: 'btn small danger-ghost', onclick: () => { P.sheet.persons.splice(i, 1); edit(); drawPersons(); run(); } }, icon('trash'), h('span', { text: 'Retirer' })));
    }));
  }
  const sheetBody = h('div', { hidden: true });
  const sheetHead = h('button', { class: 'acc-head', 'aria-expanded': 'false' },
    h('div', { class: 'tile' }, icon('user')), h('div', { class: 'grow' }, h('div', { class: 'acc-title', text: 'Fiche d\'identité du client' }), h('div', { class: 'acc-sub', text: 'Noms, employeur, sociétés : masqués à coup sûr' })), icon('chevron', 'acc-chev'));
  sheetHead.addEventListener('click', () => { sheetBody.hidden = !sheetBody.hidden; sheetHead.setAttribute('aria-expanded', String(!sheetBody.hidden)); sheetHead.parentElement.classList.toggle('open', !sheetBody.hidden); });
  sheetBody.className = 'acc-body';
  sheetBody.append(h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Plus cette fiche est complète, plus la détection est fiable. Elle reste sur cet appareil, avec la fiche.' }),
    h('div', { class: 'lbl', text: 'Personnes' }), personsBox,
    h('button', { class: 'btn small', style: { margin: '6px 0 14px' }, onclick: () => { P.sheet.persons.push({ name: '', role: P.sheet.persons.length ? 'proche' : 'client', gender: '' }); edit(); drawPersons(); } }, icon('plus'), h('span', { text: 'Ajouter une personne' })));
  for (const [key, label, ph] of SHEET_FIELDS) {
    const ta = h('textarea', { class: 'textarea', rows: '2', placeholder: ph, 'aria-label': label, spellcheck: 'false' });
    ta.value = (P.sheet[key] || []).join('\n');
    ta.addEventListener('input', () => { P.sheet[key] = lines(ta.value); edit(); }); ta.addEventListener('change', run);
    sheetBody.append(h('label', { class: 'lbl', text: label }), ta);
  }
  const never = h('textarea', { class: 'textarea', rows: '2', placeholder: 'Un par ligne. Ex. : Amundi', 'aria-label': 'Jamais masquer', spellcheck: 'false' });
  never.value = P.neverMask.join('\n'); never.addEventListener('input', () => { P.neverMask = lines(never.value); edit(); }); never.addEventListener('change', run);
  sheetBody.append(h('label', { class: 'lbl', text: 'Jamais masquer (cette fiche)' }), never);
  const sheetCard = h('div', { class: 'card acc', style: { marginTop: '14px' } }, sheetHead, sheetBody);

  // ----- dictionnaire financier -----
  function dictSheet() {
    loadEngine().then(({ dict }) => {
      sheet({ title: 'Dictionnaire financier', build(body, close) {
        const g = readGlobal(); g.dict = g.dict || []; g.never = g.never || [];
        const count = dict.groupes.reduce((a, x) => a + x.noms.length, 0);
        const list = h('div', {});
        const draw = () => list.replaceChildren(...(g.dict.length ? g.dict.map((d, i) => h('div', { class: 'kv', style: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' } },
          h('span', { text: `${d.name} · ${ROLE_LABEL[d.role] || d.role}` }), h('button', { class: 'iconbtn', 'aria-label': 'Supprimer', onclick: () => { g.dict.splice(i, 1); writeGlobal(g); draw(); run(); } }, icon('trash')))) : [h('p', { class: 'hint', text: 'Aucun ajout personnel.' })]));
        draw();
        const nm = h('input', { class: 'field', placeholder: 'Nom (ex. Linxea)', 'aria-label': 'Nom' });
        const rl = h('select', { class: 'field', 'aria-label': 'Rôle' }, Object.entries(ROLE_LABEL).map(([v, l]) => h('option', { value: v, text: l })));
        body.append(h('p', { class: 'hint', style: { marginTop: 0 }, text: `${count} noms de départ (liste à vérifier). Ils indiquent seulement ce qu'une entreprise PEUT être : le rôle réel est décidé par la phrase. Vos ajouts :` }), list,
          nm, h('div', { style: { height: '8px' } }), rl,
          h('div', { class: 'sheet-actions' },
            h('button', { class: 'btn primary', text: 'Ajouter', onclick: () => { const n = nm.value.trim(); if (n.length < 2) return; g.dict.push({ name: n, role: rl.value }); writeGlobal(g); nm.value = ''; draw(); run(); } }),
            h('button', { class: 'btn', text: 'Fermer', onclick: close })));
      } });
    });
  }

  // ----- analyse -----
  async function run() {
    const t = text();
    if (!t.trim()) { res = null; draw(); return; }
    try { const r = await runProtect(e); ctx = r.ctx; res = r.res; }
    catch (err) { res = { error: err.message || String(err) }; }
    draw();
  }
  // ----- décision sur un élément -----
  function decide(s) {
    const riskTitre = /même nom que l'employeur/.test(s.reason);
    sheet({ title: s.decision === 'keep' ? 'Élément conservé' : 'Élément masqué', build(body, close) {
      body.append(
        h('div', { class: 'kv' }, h('span', { text: 'Texte original' }), h('b', { text: s.text })),
        h('div', { class: 'kv' }, h('span', { text: 'Dans le texte protégé' }), h('b', { text: s.decision === 'keep' ? 'Conservé tel quel' : s.label })),
        h('div', { class: 'kv' }, h('span', { text: 'Nature' }), h('span', { text: CAT_LABEL[s.cat] || s.cat })),
        h('div', { class: 'kv' }, h('span', { text: 'Raison' }), h('span', { text: s.reason })));
      if (riskTitre) body.append(h('div', { class: 'banner warn' }, icon('info'), h('div', { text: 'Risque de réidentification : cette mention a le même nom que l\'employeur du client, masqué ailleurs. La conserver (« actions ' + s.text + ' ») peut permettre de deviner l\'employeur. Elle est utile au compte rendu : décidez explicitement de la conserver ou de la masquer.' })));
      else if (s.certainty === 'maybe') body.append(h('div', { class: 'banner' }, icon('info'), h('div', { text: 'Cas incertain : masqué par prudence. Conservez-le seulement si ce n\'est pas une information identifiante.' })));
      const all = h('input', { type: 'checkbox', checked: true, id: 'ptoall' });
      body.append(h('label', { class: 'check', style: { marginTop: '12px' } }, all, h('span', { text: 'Appliquer à toutes les occurrences de « ' + s.text + ' »' })));
      const apply = (action) => {
        if (all.checked) P.overrides.byText[s.k] = action; else P.overrides.byPos[`${s.start}:${s.end}`] = { action, text: s.text };
        edit(); close(); run();
      };
      const cur = s.decision === 'keep' ? 'keep' : 'mask';
      body.append(h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn ' + (cur === 'mask' ? 'primary' : ''), text: (cur === 'mask' ? '✓ ' : '') + 'Masquer', onclick: () => apply('mask') }),
        h('button', { class: 'btn ' + (cur === 'keep' ? 'primary' : ''), text: (cur === 'keep' ? '✓ ' : '') + 'Conserver tel quel', onclick: () => apply('keep') }),
        s.decision !== 'keep' ? h('button', { class: 'btn', text: 'Modifier l\'étiquette', onclick: async () => {
          const v = await promptDialog({ title: 'Étiquette de remplacement', label: 'Étiquette', value: s.label, confirmLabel: 'Enregistrer' });
          if (v && v.trim()) { P.overrides.labels[s.k] = v.trim(); edit(); close(); run(); }
        } }) : null,
        h('button', { class: 'btn', text: 'Annuler', onclick: close })));
    } });
  }

  // ----- affichage -----
  const chipFor = (s, original) => {
    const shown = original || s.decision === 'keep' ? s.text : s.label;
    const cls = ['pchip', s.decision === 'keep' ? 'keep' : 'mask', s.certainty === 'maybe' ? 'maybe' : '', s.certainty === 'decided' ? 'decided' : '', s.certainty === 'info' ? 'info' : '', original ? 'orig' : ''].filter(Boolean).join(' ');
    return h('button', { class: cls, type: 'button', 'data-sid': String(s.id), title: s.reason, onclick: () => decide(s), 'aria-label': (s.decision === 'keep' ? 'Conservé : ' : 'Masqué : ') + (original ? s.text : s.label) }, shown);
  };
  function textView(original) {
    const t = text(); const frag = document.createDocumentFragment(); let pos = 0;
    for (const s of res.spans) {
      if (s.silent && s.decision === 'keep') continue;
      if (s.start < pos) continue;
      frag.append(t.slice(pos, s.start)); frag.append(chipFor(s, original)); pos = s.end;
    }
    frag.append(t.slice(pos));
    return h('div', { class: 'pview doc' }, frag);
  }
  function review() { return res.spans.filter((s) => !s.silent && s.certainty === 'maybe' && s.decision !== 'keep'); }
  function stat(n, label, cls) { return h('div', { class: 'pstat ' + (cls || '') }, h('b', { text: String(n) }), h('span', { text: label })); }

  // ----- affichage du parcours guidé : éléments à traiter d'abord (téléphone) ou à côté du texte (ordinateur) -----
  function drawParcours(todo) {
    const s = res.stats;
    const wide = window.matchMedia && window.matchMedia('(min-width: 1000px)').matches;
    const rerunAndFocus = (term) => { viewMode = viewMode === 'original' ? 'protege' : viewMode; draw(); setTimeout(() => { const v = resultBox.querySelector('.pview'); if (!highlightTerm(v, term)) toast('Expression introuvable dans cette vue.'); }, 80); };
    const issues = issuesPanel({ e, res, edit, rerun: run, onJump: rerunAndFocus });
    const nIssues = todo.length + (res.leakReport ? res.leakReport.blocking.length : 0) + (res.titleLeak ? 1 : 0);
    const modes = [['protege', 'Protégé'], ['original', 'Original']];
    if (wide) modes.push(['cote', 'Côte à côte']);
    const seg = h('div', { class: 'seg', style: { margin: '0 0 10px' } }, modes.map(([id, l]) => h('button', { class: viewMode === id ? 'on' : '', text: l, onclick: () => { viewMode = id; draw(); } })));
    const textBlock = viewMode === 'cote'
      ? h('div', { class: 'pcols' }, h('div', {}, h('div', { class: 'lbl', text: 'Original' }), textView(true)), h('div', {}, h('div', { class: 'lbl', text: 'Protégé' }), textView(false)))
      : textView(viewMode === 'original');
    const inp = h('input', { class: 'field', placeholder: 'Mot ou expression à masquer partout', 'aria-label': 'Terme à masquer' });
    const addTerm = (v) => { v = (v || '').trim(); if (v.length < 2) return toast('Saisissez ou sélectionnez au moins 2 caractères.'); if (!P.alwaysMask.includes(v)) P.alwaysMask.push(v); edit(); inp.value = ''; run(); toast('Terme ajouté : masqué partout dans cette fiche.'); };
    const forget = h('details', { class: 'evid' }, h('summary', { text: 'Masquer un terme oublié' }),
      h('div', { style: { display: 'grid', gap: '8px', marginTop: '8px' } }, inp,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn small', onclick: () => addTerm(inp.value) }, icon('plus'), h('span', { text: 'Masquer ce terme' })),
          h('button', { class: 'btn small', onmousedown: (ev) => ev.preventDefault(), onclick: () => addTerm(String(window.getSelection() || '')) }, icon('edit'), h('span', { text: 'Masquer la sélection' }))),
        P.alwaysMask.length ? h('p', { class: 'hint', text: `Termes ajoutés pour cette fiche : ${P.alwaysMask.join(', ')}.` }) : null,
        P.alwaysMask.length ? h('button', { class: 'btn small danger-ghost', onclick: () => { P.alwaysMask = []; edit(); run(); } }, icon('trash'), h('span', { text: 'Vider cette liste' })) : null));
    resultBox.append(
      h('div', { class: 'pstats' }, stat(s.masked + s.generalized, 'remplacés'), stat(nIssues, 'à traiter', nIssues ? 'warn' : 'ok'), stat(s.decided, 'décidés'), stat(s.kept, 'conservés')),
      h('div', { class: 'pgrid' },
        h('div', { class: 'pside' }, h('div', { class: 'rt serif', style: { fontSize: '19px', color: 'var(--ink)', margin: '4px 0 8px' }, text: nIssues ? `À traiter (${nIssues})` : 'À traiter' }), issues, forget),
        h('div', { class: 'pmain' }, seg, textBlock,
          h('p', { class: 'hint', text: 'Touchez un élément coloré pour le conserver, le masquer ou changer son étiquette. Orange : à décider. Bleu : décidé. Pointillé : conservé. La relecture finale et la confirmation se font à l\'étape « ChatGPT ».' }))));
    if (typeof window.__focusTerm === 'string' && window.__focusTerm) { const t = window.__focusTerm; window.__focusTerm = ''; setTimeout(() => highlightTerm(resultBox.querySelector('.pview'), t), 120); }
  }

  function draw() {
    resultBox.replaceChildren();
    if (!text().trim()) { resultBox.append(h('p', { class: 'hint', text: 'Ajoutez d\'abord la transcription (onglet Transcription).' })); return; }
    if (!res) { resultBox.append(h('p', { class: 'hint', text: 'Analyse en cours…' })); return; }
    if (res.error) { resultBox.append(h('div', { class: 'banner warn' }, icon('info'), h('div', { text: 'Analyse impossible : ' + res.error + '. Votre transcription n\'est pas modifiée.' }))); return; }
    const todo = review();
    if (parcours) { drawParcours(todo); return; }
    const s = res.stats;
    resultBox.append(h('div', { class: 'pstats' }, stat(s.masked + s.generalized, 'remplacés'), stat(todo.length, 'à vérifier', todo.length ? 'warn' : 'ok'), stat(s.decided, 'décidés'), stat(s.kept, 'conservés')));

    const modes = [['protege', 'Texte protégé'], ['original', 'Original']];
    if (window.matchMedia && window.matchMedia('(min-width: 1000px)').matches) modes.push(['cote', 'Côte à côte']);
    resultBox.append(h('div', { style: { margin: '14px 0 10px' } }, h('div', { class: 'seg' }, modes.map(([id, l]) => h('button', { class: viewMode === id ? 'on' : '', text: l, onclick: () => { viewMode = id; draw(); } })))));
    if (viewMode === 'cote') resultBox.append(h('div', { class: 'pcols' }, h('div', {}, h('div', { class: 'lbl', text: 'Original' }), textView(true)), h('div', {}, h('div', { class: 'lbl', text: 'Protégé' }), textView(false))));
    else resultBox.append(textView(viewMode === 'original'));
    resultBox.append(h('p', { class: 'hint', text: 'Touchez un élément coloré pour le conserver, le masquer ou changer son étiquette. Orange : à vérifier. Bleu : décidé par vous. Pointillé : conservé.' }));

    // ----- à vérifier -----
    if (todo.length) {
      const box = h('div', { class: 'card', style: { marginTop: '16px' } }, h('div', { class: 'rt serif', style: { fontSize: '19px', color: 'var(--ink)' }, text: `À vérifier (${todo.length})` }));
      let cursor = 0;
      const jump = (k) => { cursor = (k + todo.length) % todo.length; const el = resultBox.querySelector(`.pview [data-sid="${todo[cursor].id}"]`); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); } };
      box.append(h('div', { class: 'btn-row', style: { margin: '10px 0' } },
        h('button', { class: 'btn small', onclick: () => jump(cursor - 1) }, icon('up'), h('span', { text: 'Précédent' })),
        h('button', { class: 'btn small', onclick: () => jump(cursor) }, h('span', { text: 'Aller à l\'élément' })),
        h('button', { class: 'btn small', onclick: () => jump(cursor + 1) }, icon('down'), h('span', { text: 'Suivant' }))));
      for (const sp of todo.slice(0, 40)) box.append(h('button', { class: 'pickrow', style: { marginBottom: '6px', textAlign: 'left' }, onclick: () => decide(sp) },
        h('span', { class: 'grow' }, h('b', { text: sp.decision === 'generalize' ? sp.label : sp.label }), h('div', { class: 'hint', style: { margin: '2px 0 0' }, text: (CAT_LABEL[sp.cat] || sp.cat) + ' — ' + sp.reason }))));
      if (todo.length > 40) box.append(h('p', { class: 'hint', text: `… et ${todo.length - 40} autres : parcourez le texte avec « Suivant ».` }));
      box.append(h('button', { class: 'btn', style: { marginTop: '8px' }, onclick: () => { for (const sp of todo) P.overrides.byText[sp.k] = 'mask'; edit(); run(); } }, icon('check'), h('span', { text: 'Confirmer le masquage de tous' })));
      resultBox.append(box);
    }

    // ----- sélection libre -----
    resultBox.append(h('div', { class: 'card', style: { marginTop: '16px' } },
      h('div', { class: 'rt serif', style: { fontSize: '19px', color: 'var(--ink)' }, text: 'Masquer un terme oublié' }),
      h('p', { class: 'hint', text: 'Sélectionnez un mot dans le texte (vue « Original »), puis touchez le bouton, ou saisissez-le ci-dessous.' }),
      (() => { const inp = h('input', { class: 'field', placeholder: 'Mot ou expression à masquer', 'aria-label': 'Terme à masquer' });
        const add = (v) => { v = (v || '').trim(); if (v.length < 2) return toast('Sélectionnez ou saisissez au moins 2 caractères.'); if (!P.alwaysMask.includes(v)) P.alwaysMask.push(v); edit(); inp.value = ''; run(); toast('Terme ajouté : il sera masqué partout dans cette fiche.'); };
        return h('div', { style: { display: 'grid', gap: '8px' } }, inp,
          h('div', { class: 'btn-row' }, h('button', { class: 'btn small', onclick: () => add(inp.value) }, icon('plus'), h('span', { text: 'Masquer ce terme' })),
            h('button', { class: 'btn small', onmousedown: (ev) => ev.preventDefault(), onclick: () => add(String(window.getSelection() || '')) }, icon('edit'), h('span', { text: 'Masquer la sélection' }))));
      })(),
      P.alwaysMask.length ? h('p', { class: 'hint', text: `Termes ajoutés pour cette fiche : ${P.alwaysMask.length}.` }) : null,
      P.alwaysMask.length ? h('button', { class: 'btn small danger-ghost', onclick: () => { P.alwaysMask = []; edit(); run(); } }, icon('trash'), h('span', { text: 'Vider cette liste' })) : null));

    // ----- revue persistée (parcours guidé) : la copie se fait à l'étape suivante -----
    const hashNow = hashText(res.protectedText);
    if (P.reviewedAt && P.reviewHash !== hashNow) {            // le texte protégé a changé depuis la revue (ou revue ancienne sans empreinte)
      const had = !!P.reviewedAt; delete P.reviewedAt; delete P.reviewHash; if (had) edit();
    }
    if (parcours) {
      const reviewed = !!P.reviewedAt;
      const chkR = h('input', { type: 'checkbox', checked: reviewed, disabled: todo.length > 0, id: 'preview' });
      chkR.addEventListener('change', () => {
        if (chkR.checked) { P.reviewedAt = Date.now(); P.reviewHash = hashNow; } else { delete P.reviewedAt; delete P.reviewHash; }
        edit(); if (root.onreview) root.onreview(chkR.checked); draw();
      });
      resultBox.append(h('div', { class: 'card', style: { marginTop: '16px' } },
        h('div', { class: 'rt serif', style: { fontSize: '19px', color: 'var(--ink)' }, text: 'Revue obligatoire' }),
        h('label', { class: 'check', style: { marginTop: '10px' } }, chkR, h('span', { text: 'J\'ai relu le texte protégé en entier et décidé tous les éléments signalés.' })),
        todo.length ? h('p', { class: 'hint', style: { color: 'var(--danger)' }, text: `Il reste ${todo.length} élément${todo.length > 1 ? 's' : ''} à vérifier : décidez-les pour pouvoir valider la revue.` }) : null,
        reviewed ? h('p', { class: 'hint', text: 'Revue enregistrée. Si vous modifiez le texte ou une décision, elle devra être refaite.' }) : null));
      return;
    }
    // ----- validation et copie -----
    const tplList = templates.filter((x) => !e.category || x.category === e.category || true);
    const sel = h('select', { class: 'field', 'aria-label': 'Trame du compte rendu' }, tplList.map((x) => h('option', { value: x.id, text: x.name, selected: x.id === selTemplate })));
    if (!selTemplate && tplList[0]) selTemplate = tplList[0].id;
    sel.value = selTemplate; sel.addEventListener('change', () => { selTemplate = sel.value; });
    const chk = h('input', { type: 'checkbox', checked: checked, disabled: todo.length > 0, id: 'pcheck' });
    chk.addEventListener('change', () => { checked = chk.checked; btn.disabled = !(checked && !todo.length); });
    const btn = h('button', { class: 'btn primary', disabled: !(checked && !todo.length), onclick: () => confirmCopy(sel) }, icon('copy'), h('span', { text: 'Copier pour une IA externe…' }));
    resultBox.append(h('div', { class: 'card', style: { marginTop: '16px' } },
      h('div', { class: 'rt serif', style: { fontSize: '19px', color: 'var(--ink)' }, text: 'Validation et copie' }),
      h('label', { class: 'lbl', text: 'Trame du compte rendu' }), sel,
      h('label', { class: 'check', style: { marginTop: '14px' } }, chk, h('span', { text: 'J\'ai relu le texte protégé en entier et vérifié les éléments signalés.' })),
      todo.length ? h('p', { class: 'hint', style: { color: 'var(--danger)' }, text: `Il reste ${todo.length} élément${todo.length > 1 ? 's' : ''} à vérifier : décidez-les pour débloquer la copie.` }) : null,
      h('div', { style: { height: '10px' } }), btn,
      P.copiedAt ? h('p', { class: 'hint', text: 'Dernière copie : ' + new Date(P.copiedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '. Rien n\'a été envoyé par l\'application.' }) : null));
  }

  // ----- copie : avertissement, contrôle de fuite, puis copie -----
  function confirmCopy(sel) {
    const template = templates.find((x) => x.id === sel.value) || templates[0];
    if (!template) return toast('Choisissez une trame.');
    const { exp } = ctx;
    const prompt = exp.buildPrompt({ template, categoryLabel: e.category ? catLabel(e.category) : '', protectedText: res.protectedText, dateMs: e.date });
    // contrôle : aucun original masqué, aucun nom de la fiche, pas le titre de la fiche
    const leaks = ctx.eng.leakCheck(prompt, res.spans, P.sheet).filter((l) => l.kind === 'oubli');
    const titleLeak = e.title && e.title.length > 4 && prompt.toLowerCase().includes(e.title.toLowerCase());
    sheet({ title: 'Avant de copier', build(body, close) {
      if (leaks.length || titleLeak) body.append(h('div', { class: 'banner warn' }, icon('info'), h('div', {},
        h('b', { text: 'Des informations masquées figurent encore dans le texte à copier.' }),
        h('div', { text: (leaks.map((l) => '« ' + l.text + ' »').join(', ') || '') + (titleLeak ? ' Le titre de la fiche apparaît.' : '') + ' Corrigez-les (Masquer un terme oublié) avant de copier.' }))));
      const items = exp.AVERTISSEMENT_COPIE.map((t) => h('li', { text: t }));
      body.append(h('ul', { class: 'plain', style: { margin: '12px 0' } }, items),
        h('p', { class: 'hint', text: `Texte à copier : instructions de rédaction, trame « ${template.name} » et transcription protégée (${res.protectedText.length.toLocaleString('fr-FR')} caractères). Aucune table de correspondance, aucune information masquée.` }));
      const ok = h('input', { type: 'checkbox', id: 'pcheck2' });
      const go = h('button', { class: 'btn primary', disabled: true, onclick: async () => {
        const done = await copyText(prompt);
        if (done) { P.copiedAt = Date.now(); P.reviewedAt = Date.now(); P.restore = buildRestoreSnapshot(res, e); edit(); toast('Texte copié. Rien n\'a été envoyé : collez-le vous-même dans l\'outil de votre choix.', 5200); close(); draw(); }
        else toast('Copie impossible : votre navigateur a refusé l\'accès au presse-papiers.', 5000);
      } }, icon('copy'), h('span', { text: 'Copier le texte protégé' }));
      ok.addEventListener('change', () => { go.disabled = !ok.checked || leaks.length > 0 || titleLeak; });
      body.append(h('label', { class: 'check' }, ok, h('span', { text: 'J\'ai compris : ce texte n\'est pas anonyme et je suis autorisé(e) à l\'utiliser avec cet outil.' })),
        h('div', { class: 'sheet-actions' }, go, h('button', { class: 'btn', text: 'Annuler', onclick: close })));
    } });
  }

  // ----- assemblage -----
  drawLevel(); drawPersons();
  const levelCard = h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 'rt serif', style: { fontSize: '19px', color: 'var(--ink)' }, text: 'Niveau de protection' }), h('div', { style: { marginTop: '10px' } }, seg), levelDesc);
  const dictBtn = h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn small', onclick: dictSheet }, icon('doc'), h('span', { text: 'Dictionnaire financier' })));
  if (parcours) {
    // parcours guidé : ce qui est à traiter et le texte d'abord ; les réglages de la protection viennent ensuite (repliés)
    root.append(resultBox, h('details', { class: 'evid', style: { marginTop: '18px' } }, h('summary', { text: 'Réglages de la protection (niveau, fiche d\'identité, dictionnaire)' }), notice, levelCard, sheetCard, dictBtn));
  } else {
    root.append(notice, levelCard, sheetCard, dictBtn, h('div', { style: { height: '16px' } }), resultBox);
  }
  // reprise de la fiche d'identité d'un autre entretien du même dossier, si celle-ci est vide
  if (!P.sheet.persons.length && e.folderId) S.listEntretiens().then((all) => {
    const other = all.find((x) => x.id !== e.id && x.folderId === e.folderId && x.protect && x.protect.sheet && x.protect.sheet.persons && x.protect.sheet.persons.length);
    if (!other) return;
    sheetBody.prepend(h('div', { class: 'banner', style: { marginTop: 0 } }, icon('info'), h('div', {}, h('div', { text: 'Une fiche d\'identité existe pour un autre entretien de ce dossier.' }),
      h('button', { text: 'La reprendre', onclick: () => { P.sheet = JSON.parse(JSON.stringify(other.protect.sheet)); P.neverMask = [...(other.protect.neverMask || [])]; edit(); sheetBody.hidden = true; root.replaceWith(protectTab({ e, templates, edit, saver }).el); } }))));
  }).catch(() => {});
  run();
  return { el: root };
}
