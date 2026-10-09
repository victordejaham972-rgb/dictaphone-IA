// Création d'un entretien et fiche détaillée (transcription, compte rendu, informations).
import { h, icon, catIcon, toast, confirmDialog, promptDialog, actionSheet, sheet, autosize, debouncedSaver, empty } from './ui.js';
import { CATEGORIES, catLabel, catInfo } from './defaults.js';
import * as S from './store.js';
import { go, topbar, pickFolder } from './common.js';
import { fmtDate, fmtDateTime, reportText, transcriptText, copyText, downloadText, downloadBlob, shareOrDownload, printReport, safeName, metaLine, docPdfFile, validEmail, splitAddresses, mailtoHref, openMailto } from './exports.js';
import { AI_STATUS_TEXT } from './ai.js';
import { usableModel } from './ia-local.js';
import { buildWavBlob } from '../audio.js';
import { cleanText, pickFile, readImport, previewImport, words as wordsOf } from './import.js';

const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocalInput = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : Date.now(); };
const fmtDur = (s) => { s = Math.max(0, Math.floor(s)); const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (hh ? hh + ':' + pad(m) : m) + ':' + pad(x); };

// =====================================================================
// NOUVEL ENTRETIEN
// =====================================================================
const DRAFT = 'dia_draft';
export async function newView({ query }) {
  const [folders, templates] = await Promise.all([S.listFolders(), S.listTemplates()]);
  let d = {};
  try { d = JSON.parse(localStorage.getItem(DRAFT)) || {}; } catch {}
  const st = {
    category: CATEGORIES.some((c) => c.id === query.cat) ? query.cat : (d.category || S.getSettings().lastCategory || 'clients'),
    who: d.who || '', subject: d.subject || '', title: d.title || '', titleManual: !!d.titleManual,
    folderId: query.f || d.folderId || null, date: d.date || Date.now(), templateId: d.templateId || null, transcript: d.transcript || '',
  };
  if (query.cat && d.category && d.category !== query.cat) { st.templateId = null; if (!query.f) st.folderId = null; }
  const restored = !!(d.who || d.subject || d.title || d.transcript);
  const valid = (id) => !id || folders.some((f) => f.id === id && f.category === st.category);
  if (!valid(st.folderId)) st.folderId = null;
  const tplFor = () => templates.filter((t) => t.category === st.category);
  if (!st.templateId || !templates.some((t) => t.id === st.templateId && t.category === st.category)) { const dt = S.defaultTemplateFor(templates, st.category); st.templateId = dt ? dt.id : null; }

  const saveDraft = () => { try { localStorage.setItem(DRAFT, JSON.stringify(st)); } catch {} };
  const clearDraft = () => { try { localStorage.removeItem(DRAFT); } catch {} };
  const info = () => catInfo(st.category);

  // ----- titre composé automatiquement : « Nom — Sujet — jj/mm/aaaa » (modifiable) -----
  const whoLbl = h('label', { class: 'lbl' }), subjLbl = h('label', { class: 'lbl' });
  const whoInp = h('input', { class: 'field', type: 'text', maxlength: '80', autocapitalize: 'words', value: st.who });
  const subjInp = h('input', { class: 'field', type: 'text', maxlength: '100', autocapitalize: 'sentences', value: st.subject });
  const titleInp = h('input', { class: 'field', type: 'text', maxlength: '160', 'aria-label': 'Titre de la fiche', value: st.title });
  const titleHint = h('p', { class: 'hint', style: { margin: '6px 0 0' } });
  const resetTitle = h('button', { class: 'btn small', style: { marginTop: '8px' }, hidden: true, text: 'Recomposer le titre automatiquement' });
  const refreshTitle = () => {
    if (!st.titleManual) { st.title = S.composeTitle(st.category, st.who, st.subject, st.date); titleInp.value = st.title; }
    titleHint.textContent = st.titleManual ? 'Titre modifié à la main : il ne suit plus les champs ci-dessus.' : 'Titre composé automatiquement : vous pouvez le modifier.';
    resetTitle.hidden = !st.titleManual;
  };
  whoInp.addEventListener('input', () => { st.who = whoInp.value; refreshTitle(); saveDraft(); });
  subjInp.addEventListener('input', () => { st.subject = subjInp.value; refreshTitle(); saveDraft(); });
  titleInp.addEventListener('input', () => { st.title = titleInp.value; st.titleManual = true; refreshTitle(); saveDraft(); });
  resetTitle.addEventListener('click', () => { st.titleManual = false; refreshTitle(); saveDraft(); });

  const catBox = h('div', { class: 'catpick' });
  const folderBtn = h('button', { class: 'pickrow', onclick: async () => {
    const r = await pickFolder({ categories: [st.category], folders, current: { category: st.category, folderId: st.folderId } });
    if (r) { st.folderId = r.folderId; saveDraft(); renderFolder(); }
  } }, h('span', {}), icon('chevron'));
  const tplSel = h('select', { class: 'field', 'aria-label': 'Trame de compte rendu' });
  const dateInp = h('input', { class: 'field', type: 'datetime-local', value: toLocalInput(st.date), 'aria-label': 'Date de la réunion' });
  dateInp.addEventListener('change', () => { st.date = fromLocalInput(dateInp.value); refreshTitle(); saveDraft(); });
  const ta = h('textarea', { class: 'textarea', placeholder: 'Collez ici la transcription (appui long, puis « Coller »).', rows: '8', spellcheck: 'false', autocorrect: 'off' });
  ta.value = st.transcript;
  const stats = h('div', { class: 'stats' });
  const updStats = () => { const w = S.wordCount(ta.value); stats.textContent = w ? `${w} mot${w > 1 ? 's' : ''}` : ''; };
  ta.addEventListener('input', () => { st.transcript = ta.value; updStats(); saveDraft(); });
  updStats();

  function renderLabels() {
    const c = info();
    whoLbl.textContent = c.whoLabel; whoInp.placeholder = c.whoHint;
    subjLbl.textContent = c.subjectLabel; subjInp.placeholder = c.subjectHint;
  }
  function renderCats() {
    catBox.textContent = '';
    for (const c of CATEGORIES) catBox.append(h('button', { class: st.category === c.id ? 'on' : '', 'aria-pressed': String(st.category === c.id), onclick: () => {
      if (st.category !== c.id) { st.category = c.id; st.folderId = null; const dt = S.defaultTemplateFor(templates, c.id); st.templateId = dt ? dt.id : null; saveDraft(); renderCats(); renderFolder(); renderTpl(); renderLabels(); refreshTitle(); }
    } }, h('div', { class: 'tile', style: { width: '40px', height: '40px' } }, catIcon(c.id)), h('div', {}, h('div', { style: { fontWeight: 600, color: 'var(--ink)' }, text: c.label }), h('div', { class: 'hint', style: { margin: 0 }, text: c.hint }))));
  }
  function renderFolder() {
    const path = st.folderId ? S.folderPath(st.folderId, folders).map((f) => f.name).join(' › ') : 'Racine de « ' + catLabel(st.category) + ' »';
    folderBtn.firstChild.textContent = path;
  }
  function renderTpl() {
    tplSel.textContent = '';
    const list = tplFor();
    if (!list.length) tplSel.append(h('option', { value: '', text: 'Aucune trame pour cette catégorie' }));
    for (const t of list) tplSel.append(h('option', { value: t.id, text: t.name }));
    tplSel.value = st.templateId || '';
  }
  tplSel.addEventListener('change', () => { st.templateId = tplSel.value || null; saveDraft(); });
  renderCats(); renderFolder(); renderTpl(); renderLabels(); refreshTitle();

  // ----- importation : aperçu obligatoire, ancien texte conservé -----
  let previous = null;   // texte avant le dernier changement (annulation)
  const undoBtn = h('button', { class: 'btn small', style: { marginTop: '10px' }, hidden: true }, icon('back'), h('span', { text: 'Rétablir le texte précédent' }));
  undoBtn.addEventListener('click', () => {
    if (previous === null) return;
    const cur = ta.value; ta.value = previous; previous = cur; st.transcript = ta.value; updStats(); saveDraft(); toast('Texte précédent rétabli');
  });
  async function receive(incoming, meta) {
    const existing = ta.value;
    if (!meta.file && !existing.trim()) { ta.value = incoming; }       // collage dans une zone vide : pas de risque
    else {
      const mode = await previewImport({ existing, incoming, name: meta.name, kind: meta.kind, info: meta.info });
      if (!mode) return;
      ta.value = mode === 'append' ? existing.replace(/\s+$/, '') + '\n\n' + incoming : incoming;
      if (existing.trim()) { previous = existing; undoBtn.hidden = false; }
    }
    st.transcript = ta.value; updStats(); saveDraft();
    toast(meta.file ? 'Fichier importé' : 'Transcription collée');
  }
  async function paste() {
    try {
      const t = cleanText(await navigator.clipboard.readText());
      if (!t.trim()) { toast('Le presse-papiers est vide.'); ta.focus(); return; }
      await receive(t, { name: 'Texte collé', kind: 'txt' });
    } catch {
      toast('Appuyez longuement dans la zone de texte, puis « Coller ».', 4200); ta.focus();
    }
  }
  async function importFile() {
    const f = await pickFile();
    if (!f) return;
    toast('Lecture du fichier…', 2000);
    try { const r = await readImport(f); await receive(r.text, { name: r.name, kind: r.kind, info: r.info, file: true }); }
    catch (err) { toast(err.message, 6500); }
  }

  async function create() {
    const cat = st.category;
    const t = (st.title || '').trim() || S.composeTitle(cat, st.who, st.subject, st.date);
    const e = await S.createEntretien({ title: t, category: cat, folderId: st.folderId, date: st.date, templateId: st.templateId, transcript: cleanText(ta.value), who: st.who.trim(), subject: st.subject.trim(), titleAuto: !st.titleManual });
    S.setSetting('lastCategory', cat);
    clearDraft();
    toast('Entretien créé');
    go('#/entretien/' + e.id);
  }

  const el = h('div', { class: 'view' },
    topbar({ back: () => go('#/'), backLabel: 'Accueil' }),
    h('div', { class: 'eyebrow', text: 'Nouvel entretien' }),
    h('h1', { class: 'page-title', text: 'Nouvelle fiche' }),
    h('div', { class: 'rule' }),
    restored ? h('div', { class: 'banner' }, icon('info'), h('div', {}, h('div', { text: 'Votre brouillon a été conservé.' }), h('button', { text: 'Effacer le brouillon', onclick: async () => { if (await confirmDialog({ title: 'Effacer le brouillon ?', message: 'Les informations et le texte saisis seront effacés.', confirmLabel: 'Effacer', danger: true })) { clearDraft(); location.reload(); } } }))) : null,
    h('label', { class: 'lbl', style: { marginTop: 0 }, text: 'Catégorie' }), catBox,
    whoLbl, whoInp, subjLbl, subjInp,
    h('label', { class: 'lbl', text: 'Date' }), dateInp,
    h('label', { class: 'lbl', text: 'Titre de la fiche' }), titleInp, titleHint, resetTitle,
    h('label', { class: 'lbl', text: 'Dossier' }), folderBtn,
    h('label', { class: 'lbl', text: 'Trame du compte rendu' }), tplSel,
    h('div', { class: 'sec-head' }, h('h2', { text: 'Transcription' })),
    h('p', { class: 'hint', style: { marginTop: '-4px' }, text: 'Copiez la transcription depuis le Dictaphone d\'Apple, puis collez-la ici, ou importez un fichier texte ou PDF.' }),
    h('button', { class: 'btn primary bigpaste', onclick: paste }, icon('clipboard'), h('span', { text: 'Coller une transcription' })),
    h('button', { class: 'btn', style: { marginTop: '10px' }, onclick: importFile }, icon('upload'), h('span', { text: 'Importer un fichier (.txt ou PDF)' })),
    undoBtn,
    h('div', { style: { height: '12px' } }), ta, stats,
    h('div', { class: 'stickybar' }, h('button', { class: 'btn primary', onclick: create }, icon('check'), h('span', { text: 'Créer l\'entretien' }))));
  return { el };
}
// =====================================================================
// FICHE D'UN ENTRETIEN
// =====================================================================
export async function ficheView({ params, query }) {
  const [e, folders, templates] = await Promise.all([S.getEntretien(params[0]), S.listFolders(), S.listTemplates()]);
  if (!e) return { el: h('div', { class: 'view' }, topbar({ back: () => go('#/bibliotheque') }), empty('Entretien introuvable', 'Il a peut-être été supprimé.')) };
  let tab = ['transcription', 'compte-rendu', 'infos'].includes(query.tab) ? query.tab : 'transcription';
  const tplName = () => (templates.find((t) => t.id === e.templateId) || {}).name || '';
  const saveState = h('div', { class: 'savestate', 'aria-live': 'polite' });
  let savedText = S.transcriptOf(e);   // dernier texte enregistré (sert à détecter une suppression massive)
  const saver = debouncedSaver(async () => {
    const cur = S.transcriptOf(e);
    if (savedText.trim() && cur.trim().length < savedText.trim().length * 0.3) e.transcriptHistory = S.pushHistory(e.transcriptHistory, { text: savedText, reason: 'avant suppression importante' });
    savedText = cur;
    await S.saveEntretien(e); saveState.textContent = 'Enregistré à ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); });
  const edit = () => { saveState.textContent = 'Modification…'; saver.trigger(); };
  const cleanups = [];

  // ----- en-tête -----
  // Titre sur plusieurs lignes si nécessaire (un champ à une seule ligne couperait les titres longs)
  const titleInp = h('textarea', { class: 'title-input', rows: '1', 'aria-label': 'Titre de l\'entretien', maxlength: '160', enterkeyhint: 'done' });
  titleInp.value = e.title;
  const fitTitle = () => { titleInp.style.height = 'auto'; titleInp.style.height = titleInp.scrollHeight + 'px'; };
  titleInp.addEventListener('input', () => { e.title = titleInp.value.replace(/\n/g, ' ') || 'Sans titre'; e.titleAuto = false; fitTitle(); edit(); });
  titleInp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); titleInp.blur(); } });
  requestAnimationFrame(fitTitle);
  const meta = h('div', { class: 'hint', style: { marginTop: 0 }, text: metaLine(e, folders) });

  // ----- exports -----
  // Les PDF sont créés par l'application dès l'ouverture du menu : Safari n'accepte la feuille de partage que très peu de temps après un toucher.
  const preparePdf = (kind) => { const p = docPdfFile(e, folders, tplName(), kind); p.catch(() => {}); return p; };
  function readySheet(file) {
    sheet({ title: 'PDF prêt', build(body, close) {
      body.append(h('p', { class: 'hint', text: 'Le fichier est créé. Touchez le bouton pour ouvrir le menu de partage, puis choisissez « Enregistrer dans Fichiers ».' }),
        h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn primary', onclick: async () => { const r = await shareOrDownload([file], e.title); if (r === 'refuse') { downloadBlob(file.name, file); toast('PDF enregistré'); } if (r !== 'annule') close(); } }, icon('share'), h('span', { text: 'Ouvrir le menu de partage' })),
          h('button', { class: 'btn', text: 'Fermer', onclick: close })));
    } });
  }
  async function sharePdf(prepared) {
    try {
      const file = await prepared;
      const res = await shareOrDownload([file], e.title);
      if (res === 'telechargement') toast('PDF enregistré');
      else if (res === 'refuse') readySheet(file);
    } catch (err) { toast('PDF impossible : ' + err.message, 5000); }
  }
  function exportMenu() {
    const hasT = S.hasTranscript(e), hasR = S.hasReport(e);
    if (!hasT && !hasR) return toast('Rien à exporter pour le moment.');
    const pT = hasT ? preparePdf('transcript') : null, pR = hasR ? preparePdf('report') : null;
    actionSheet({ title: 'Exporter', actions: [
      { label: 'Transcription en PDF', icon: 'doc', sub: hasT ? 'Tout le texte transcrit' : 'Aucune transcription pour le moment', run: () => (pT ? sharePdf(pT) : toast('Aucune transcription à exporter.')) },
      { label: 'Compte rendu en PDF', icon: 'doc', sub: hasR ? 'Le compte rendu structuré' : 'À rédiger d\'abord', run: () => (pR ? sharePdf(pR) : toast('Rédigez d\'abord le compte rendu.')) },
      { label: 'Envoyer par mail', icon: 'share', sub: 'Transcription ou compte rendu', run: mailChoice },
      { label: 'Autres formats…', icon: 'copy', sub: 'Copier le texte, fichier .txt, imprimer', run: otherFormats },
    ] });
  }
  function otherFormats() {
    const rText = () => reportText(e, folders, tplName()), tText = () => transcriptText(e, folders);
    actionSheet({ title: 'Autres formats', actions: [
      S.hasTranscript(e) ? { label: 'Copier la transcription', icon: 'copy', run: async () => toast((await copyText(S.transcriptOf(e))) ? 'Transcription copiée' : 'Copie impossible') } : null,
      S.hasTranscript(e) ? { label: 'Transcription en fichier texte (.txt)', icon: 'doc', run: () => { downloadText(safeName(e.title) + '-transcription.txt', tText()); toast('Fichier créé'); } } : null,
      S.hasReport(e) ? { label: 'Copier le compte rendu', icon: 'copy', run: async () => toast((await copyText(rText())) ? 'Compte rendu copié' : 'Copie impossible') } : null,
      S.hasReport(e) ? { label: 'Compte rendu en fichier texte (.txt)', icon: 'doc', run: () => { downloadText(safeName(e.title) + '-compte-rendu.txt', rText()); toast('Fichier créé'); } } : null,
      S.hasReport(e) ? { label: 'Imprimer le compte rendu…', icon: 'doc', run: () => printReport(e, folders, tplName()) } : null,
    ].filter(Boolean) });
  }
  // Envoi par mail : la messagerie de l'appareil s'ouvre, l'utilisateur relit puis envoie lui-même.
  function mailChoice() {
    const hasT = S.hasTranscript(e), hasR = S.hasReport(e);
    if (!hasT && !hasR) return toast('Rien à envoyer pour le moment.');
    actionSheet({ title: 'Envoyer par mail', actions: [
      { label: 'La transcription', icon: 'doc', sub: hasT ? 'Le texte complet' : 'Aucune transcription pour le moment', run: () => (hasT ? mailSheet('transcript') : toast('Aucune transcription à envoyer.')) },
      { label: 'Le compte rendu', icon: 'doc', sub: hasR ? 'Le compte rendu structuré' : 'À rédiger d\'abord', run: () => (hasR ? mailSheet('report') : toast('Rédigez d\'abord le compte rendu.')) },
    ] });
  }
  function mailSheet(kind = 'report') {
    const isT = kind === 'transcript';
    if (isT ? !S.hasTranscript(e) : !S.hasReport(e)) return toast(isT ? 'Aucune transcription à envoyer.' : 'Rédigez d\'abord le compte rendu.');
    const prepared = preparePdf(kind);
    const full = isT ? transcriptText(e, folders) : reportText(e, folders, tplName());
    const TOO_LONG = 1800;
    sheet({ title: isT ? 'Envoyer la transcription' : 'Envoyer le compte rendu', build(body, close) {
      const to = h('input', { class: 'field', type: 'email', multiple: true, inputmode: 'email', placeholder: 'destinataire@entreprise.fr', autocapitalize: 'none', autocorrect: 'off', autocomplete: 'off', 'aria-label': 'Destinataire' });
      const subj = h('input', { class: 'field', type: 'text', value: (isT ? 'Transcription – ' : 'Compte rendu – ') + e.title, 'aria-label': 'Objet', maxlength: '240' });
      const msg = h('textarea', { class: 'textarea', rows: '9', 'aria-label': 'Message', style: { minHeight: '180px' } });
      // Une transcription longue ne tient pas dans le corps d'un message : on propose le PDF en pièce jointe
      const tooLongForBody = isT && full.length > TOO_LONG;
      msg.value = tooLongForBody ? 'Bonjour,\n\nVeuillez trouver ci-joint la transcription : ' + e.title + '.\n\nCordialement' : full;
      const longNote = h('p', { class: 'hint', hidden: true });
      const check = () => {
        const n = mailtoHref({ to: to.value, subject: subj.value, body: msg.value }).length;
        longNote.hidden = !(n >= TOO_LONG || tooLongForBody);
        longNote.textContent = tooLongForBody ? 'La transcription est longue : elle n\'est pas collée dans le message. Utilisez d\'abord « Joindre le PDF » (menu de partage → Mail) pour l\'envoyer en pièce jointe.' : 'Message long : si votre messagerie le coupe, utilisez « Joindre le PDF » ou « Copier le message ».';
      };
      for (const x of [to, subj, msg]) x.addEventListener('input', check);
      const open = () => {
        const bad = splitAddresses(to.value).filter((a) => !validEmail(a));
        if (bad.length) { toast('Adresse invalide : ' + bad[0], 4000); to.focus(); return; }
        openMailto(mailtoHref({ to: to.value, subject: subj.value, body: msg.value }));
        toast('Votre messagerie s\'ouvre : relisez puis envoyez.', 4500);
      };
      const pdfBtn = h('button', { class: tooLongForBody ? 'btn primary' : 'btn', onclick: () => { close(); sharePdf(prepared); } }, icon('doc'), h('span', { text: 'Joindre le PDF (menu de partage)' }));
      body.append(
        h('div', { class: 'banner warn', style: { marginTop: '0' } }, icon('shield'), h('div', { text: 'Envoyez les documents confidentiels uniquement depuis une messagerie professionnelle autorisée par Ade-ci. Dictaphone IA n\'envoie rien lui-même : votre messagerie s\'ouvre avec le message prêt, et rien ne part sans votre validation.' })),
        h('label', { class: 'lbl', text: 'Destinataire (facultatif ici, modifiable dans la messagerie)' }), to,
        h('label', { class: 'lbl', text: 'Objet' }), subj,
        h('label', { class: 'lbl', text: 'Message (relisez et modifiez avant l\'ouverture)' }), msg, longNote,
        h('div', { class: 'sheet-actions' },
          tooLongForBody ? pdfBtn : null,
          h('button', { class: tooLongForBody ? 'btn' : 'btn primary', onclick: open }, icon('share'), h('span', { text: 'Ouvrir ma messagerie' })),
          tooLongForBody ? null : pdfBtn,
          h('button', { class: 'btn', onclick: async () => toast((await copyText(msg.value)) ? 'Message copié' : 'Copie impossible') }, icon('copy'), h('span', { text: 'Copier le message' })),
          h('button', { class: 'btn', text: 'Annuler', onclick: close })));
      check();
    } });
  }
  function menu() {
    actionSheet({ title: e.title, actions: [
      { label: 'Exporter…', icon: 'share', run: exportMenu },
      { label: 'Envoyer par mail', icon: 'share', run: mailChoice },
      { label: 'Supprimer l\'entretien', icon: 'trash', danger: true, run: deleteIt },
    ] });
  }  async function deleteIt() {
    const ok = await confirmDialog({ title: 'Supprimer cet entretien ?', danger: true, confirmLabel: 'Supprimer définitivement',
      message: `« ${e.title} » sera supprimé de cet appareil avec sa transcription, son compte rendu et son audio.\nCette action est irréversible. Pensez à faire une sauvegarde.` });
    if (!ok) return;
    await saver.dispose();
    await S.removeEntretien(e.id);
    toast('Entretien supprimé');
    go('#/bibliotheque' + (e.category ? '?cat=' + e.category : ''));
  }

  // ----- audio (simple : lecture/pause, progression, durée) -----
  function audioCard() {
    const card = h('div', { class: 'card', style: { marginTop: '12px' } });
    const open = h('button', { class: 'btn small', onclick: async () => {
      open.disabled = true; open.textContent = 'Préparation…';
      try {
        const blob = await buildWavBlob(e);
        const url = URL.createObjectURL(blob);
        const au = new Audio(); au.preload = 'metadata'; au.src = url;
        cleanups.push(() => { au.pause(); au.removeAttribute('src'); URL.revokeObjectURL(url); });
        const play = h('button', { class: 'play', 'aria-label': 'Lecture' }, icon('play'));
        const range = h('input', { type: 'range', min: '0', max: String(Math.floor(e.durationSec)), value: '0', step: '1', 'aria-label': 'Progression' });
        const cur = h('span', { text: '0:00' }), tot = h('span', { text: fmtDur(e.durationSec) });
        play.addEventListener('click', () => (au.paused ? au.play().catch(() => toast('Lecture impossible')) : au.pause()));
        au.addEventListener('play', () => play.replaceChildren(icon('pause')));
        au.addEventListener('pause', () => play.replaceChildren(icon('play')));
        au.addEventListener('loadedmetadata', () => { if (isFinite(au.duration)) { range.max = String(Math.floor(au.duration)); tot.textContent = fmtDur(au.duration); } });
        au.addEventListener('timeupdate', () => { cur.textContent = fmtDur(au.currentTime); if (!range.matches(':active')) range.value = String(Math.floor(au.currentTime)); });
        range.addEventListener('input', () => { au.currentTime = +range.value; cur.textContent = fmtDur(+range.value); });
        card.replaceChildren(h('div', { class: 'eyebrow', text: 'Enregistrement audio' }), h('div', { class: 'player' }, play, h('div', { class: 'bar' }, range, h('div', { class: 'times' }, cur, tot))));
      } catch (err) { open.textContent = 'Lecture indisponible'; toast('Audio indisponible : ' + err.message); }
    } }, icon('play'), h('span', { text: 'Écouter' }));
    card.append(h('div', { class: 'row', style: { padding: 0, border: 0, cursor: 'default' } }, h('div', { class: 'grow' }, h('div', { class: 't', text: 'Enregistrement audio' }), h('div', { class: 'm', text: 'Durée ' + fmtDur(e.durationSec) })), open));
    return card;
  }

  // ----- onglet Transcription -----
  const REASONS = { remplacement: 'Remplacement', ajout: 'Ajout', collage: 'Collage', import: 'Import', correction: 'Correction', 'rétablissement': 'Rétablissement', 'avant suppression importante': 'Avant une suppression importante' };
  function transcriptTab() {
    const ta = h('textarea', { class: 'textarea', style: { minHeight: '50dvh' }, spellcheck: 'false', autocorrect: 'off', 'aria-label': 'Transcription', placeholder: 'Aucune transcription. Appuyez sur « Coller » ou « Importer ».' });
    ta.value = S.transcriptOf(e);
    const stats = h('div', { class: 'stats' });
    const upd = () => { const w = S.wordCount(ta.value); stats.textContent = w ? `${w} mot${w > 1 ? 's' : ''} · ${ta.value.length} caractères` : ''; };
    ta.addEventListener('input', () => { e.transcript = ta.value; upd(); edit(); });
    upd();

    // Changement de la transcription avec sécurité : l'ancien texte est mis dans l'historique, le nouveau est enregistré
    // PUIS relu depuis la base. En cas d'échec, tout est remis dans l'état précédent.
    async function applyChange(newText, reason, source) {
      await saver.flush();
      const prevText = ta.value, prevTranscript = e.transcript, prevHistory = e.transcriptHistory.slice();
      if (!newText.trim() && prevText.trim()) { toast('Contenu vide : le texte actuel est conservé.', 5000); return false; }
      e.transcriptHistory = S.pushHistory(e.transcriptHistory, { text: prevText, reason, source: source || '' });
      e.transcript = newText;
      try {
        await S.saveEntretien(e);
        const back = await S.getEntretien(e.id);
        if (!back || S.transcriptOf(back) !== newText) throw new Error('relecture différente');
        if (prevText.trim() && !(back.transcriptHistory[0] && back.transcriptHistory[0].text === prevText)) throw new Error('historique non enregistré');
      } catch (err) {
        e.transcript = prevTranscript; e.transcriptHistory = prevHistory; ta.value = prevText;
        try { await S.saveEntretien(e); } catch {}
        toast('L\'enregistrement a échoué : le texte précédent est conservé (' + err.message + ').', 7000);
        return false;
      }
      savedText = newText; ta.value = newText; upd(); histBtn.refresh();
      saveState.textContent = 'Enregistré à ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return true;
    }
    const histBtn = h('button', { class: 'btn small', style: { marginTop: '10px' } }, icon('back'), h('span', {}));
    histBtn.refresh = () => { const n = e.transcriptHistory.length; histBtn.hidden = !n; histBtn.lastChild.textContent = `Versions précédentes (${n})`; };
    histBtn.addEventListener('click', () => sheet({ title: 'Versions précédentes', build(body, close) {
      body.append(h('p', { class: 'hint', text: 'Avant chaque remplacement ou correction, le texte précédent est conservé ici (5 versions). Rétablir une version garde aussi le texte actuel.' }));
      e.transcriptHistory.forEach((v, i) => body.append(h('div', { class: 'card', style: { marginTop: '10px' } },
        h('div', { class: 'kv' }, h('span', { text: REASONS[v.reason] || v.reason || 'Version' }), h('span', { text: fmtDateTime(v.date) })),
        h('p', { class: 'hint', style: { margin: '6px 0' }, text: `${S.wordCount(v.text)} mots${v.source ? ' · ' + v.source : ''}` }),
        h('p', { style: { margin: '0 0 10px', fontSize: '14px', whiteSpace: 'pre-wrap' }, text: v.text.slice(0, 160) + (v.text.length > 160 ? '…' : '') }),
        h('button', { class: 'btn small', onclick: async () => { close(); const ok = await applyChange(v.text, 'rétablissement', 'version du ' + fmtDateTime(v.date)); toast(ok ? 'Version rétablie' : 'Rétablissement impossible'); } }, icon('back'), h('span', { text: 'Rétablir cette version' })))));
      body.append(h('button', { class: 'btn', style: { marginTop: '14px' }, text: 'Fermer', onclick: close }));
    } }));
    histBtn.refresh();

    // Réception d'un contenu (collage ou fichier) : aperçu obligatoire dès qu'un texte existe ou qu'il s'agit d'un fichier
    async function receive(incoming, meta) {
      const existing = ta.value;
      if (!meta.file && !existing.trim()) { if (await applyChange(incoming, 'collage', meta.name)) toast('Transcription collée'); return; }
      const mode = await previewImport({ existing, incoming, name: meta.name, kind: meta.kind, info: meta.info });
      if (!mode) return;
      const newText = mode === 'append' ? existing.replace(/\s+$/, '') + '\n\n' + incoming : incoming;
      const ok = await applyChange(newText, mode === 'append' ? 'ajout' : mode === 'replace' ? 'remplacement' : 'import', meta.name);
      if (ok) toast(mode === 'append' ? 'Texte ajouté à la suite' : mode === 'replace' ? 'Texte remplacé : l\'ancien reste dans « Versions précédentes »' : 'Fichier importé', 5000);
    }
    const paste = async () => {
      try { const t = cleanText(await navigator.clipboard.readText()); if (!t.trim()) return toast('Le presse-papiers est vide.'); await receive(t, { name: 'Texte collé', kind: 'txt' }); }
      catch { toast('Appuyez longuement dans la zone de texte, puis « Coller ».', 4200); ta.focus(); }
    };
    const imp = async () => {
      const f = await pickFile(); if (!f) return;
      toast('Lecture du fichier…', 2000);
      try { const r = await readImport(f); await receive(r.text, { name: r.name, kind: r.kind, info: r.info, file: true }); }
      catch (err) { toast(err.message, 6500); }
    };
    const fix = () => sheet({ title: 'Corriger la transcription', build(body, close) {
      const find = h('input', { class: 'field', placeholder: 'Mot ou expression erronée', autocapitalize: 'none', autocorrect: 'off' });
      const rep = h('input', { class: 'field', placeholder: 'Remplacer par', autocapitalize: 'none', autocorrect: 'off' });
      const doReplace = async () => {
        const f = find.value; if (!f) return find.focus();
        const parts = ta.value.split(f); const n = parts.length - 1;
        if (!n) return toast('Aucune occurrence trouvée.');
        close(); if (await applyChange(parts.join(rep.value), 'correction', `« ${f.slice(0, 30)} » → « ${rep.value.slice(0, 30)} »`)) toast(`${n} remplacement${n > 1 ? 's' : ''}`);
      };
      const vocab = S.getVocab();
      const last = e.transcriptHistory[0];
      body.append(
        h('label', { class: 'lbl', text: 'Rechercher' }), find, h('label', { class: 'lbl', text: 'Remplacer par' }), rep,
        h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn primary', text: 'Tout remplacer', onclick: doReplace }),
          h('button', { class: 'btn', onclick: async () => { const r = S.applyVocab(ta.value, vocab); if (!r.count) return toast('Aucune correction à appliquer.'); close(); if (await applyChange(r.text, 'correction', 'vocabulaire')) toast(`${r.count} correction${r.count > 1 ? 's' : ''} du vocabulaire appliquée${r.count > 1 ? 's' : ''}`); } }, icon('sparkle'), h('span', { text: `Appliquer mon vocabulaire (${vocab.length})` })),
          last && last.reason === 'correction' ? h('button', { class: 'btn', text: 'Annuler la dernière correction', onclick: async () => { close(); toast((await applyChange(last.text, 'rétablissement', 'avant correction')) ? 'Correction annulée' : 'Annulation impossible'); } }) : null,
          h('button', { class: 'btn', text: 'Fermer', onclick: close })));
    } });
    return h('div', {},
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small primary', onclick: paste }, icon('clipboard'), h('span', { text: 'Coller' })),
        h('button', { class: 'btn small', onclick: imp }, icon('upload'), h('span', { text: 'Importer' })),
        h('button', { class: 'btn small', onclick: fix }, icon('edit'), h('span', { text: 'Corriger' })),
        h('button', { class: 'btn small', onclick: exportMenu }, icon('share'), h('span', { text: 'Exporter' }))),
      histBtn, h('div', { style: { height: '12px' } }), ta, stats);
  }
  // ----- onglet Compte rendu -----
  function mergeSections(existing, tpl) {
    const used = new Set();
    const out = tpl.sections.map((ts) => {
      const m = existing.find((x) => !used.has(x.id) && x.title.trim().toLowerCase() === ts.title.trim().toLowerCase());
      if (m) { used.add(m.id); return m; }
      return { id: S.uid('r'), title: ts.title, content: '' };
    });
    for (const x of existing) if (!used.has(x.id) && (x.content || '').trim()) out.push(x); // rien de rédigé n'est perdu
    return out;
  }
  function reportTab() {
    const box = h('div', {});
    const sections = () => (e.reportSections || (e.reportSections = S.reportOf(e).map((s) => ({ ...s, id: s.id === 'legacy' ? S.uid('r') : s.id }))));
    const tpl = templates.find((t) => t.id === e.templateId);
    // Ancien compte rendu (versions d'essai) : affiché comme rubrique modifiable. Rien n'est écrit tant que l'utilisateur ne modifie rien.
    if (!e.reportSections && S.hasReport(e)) e.reportSections = S.reportOf(e).map((s) => ({ ...s, id: S.uid('r') }));
    else if (tpl && !e.reportSections) e.reportSections = S.sectionsFromTemplate(tpl); // plan vide, pas encore enregistré

    const tplSel = h('select', { class: 'field', 'aria-label': 'Trame' });
    for (const c of CATEGORIES) {
      const grp = h('optgroup', { label: c.label });
      for (const t of templates.filter((x) => x.category === c.id)) grp.append(h('option', { value: t.id, text: t.name }));
      if (grp.children.length) tplSel.append(grp);
    }
    tplSel.value = e.templateId || '';
    if (!e.templateId) tplSel.prepend(h('option', { value: '', text: 'Choisir une trame…', selected: true }));
    tplSel.addEventListener('change', async () => {
      const t = templates.find((x) => x.id === tplSel.value); if (!t) return;
      const has = S.hasReport(e);
      if (has && !(await confirmDialog({ title: 'Changer de trame ?', message: 'Les rubriques de la nouvelle trame seront ajoutées. Ce que vous avez déjà rédigé est conservé.', confirmLabel: 'Changer de trame' }))) { tplSel.value = e.templateId || ''; return; }
      e.templateId = t.id; e.reportSections = mergeSections(sections(), t); edit(); renderBody();
    });

    // L'IA n'est PAS simulée : elle n'est proposée que si un modèle a réussi le test de qualité sur cet appareil et a été activé.
    const um = usableModel();
    const ia = um
      ? h('div', { class: 'card ia-card' },
        h('div', { class: 'rt serif', style: { fontSize: '19px', color: 'var(--ink)' } }, h('span', { text: 'Rédaction par IA locale' }), h('span', { class: 'badge', text: 'Expérimental' })),
        h('p', { class: 'hint', text: `Modèle ${um.label}, validé sur cet appareil. La transcription reste sur l'appareil. Le résultat est un brouillon à relire.` }),
        h('button', { class: 'btn small primary', disabled: !S.hasTranscript(e), onclick: async () => { await saver.flush(); location.href = 'ia.html?e=' + e.id; } }, icon('sparkle'), h('span', { text: 'Rédiger avec l\'IA locale' })),
        S.hasTranscript(e) ? null : h('p', { class: 'hint', text: 'Ajoutez d\'abord la transcription.' }))
      : h('div', { class: 'card ia-card' },
        h('div', { class: 'rt serif', style: { fontSize: '19px', color: 'var(--ink)' } }, h('span', { text: 'Rédaction automatique' }), h('span', { class: 'badge', text: 'Non disponible' })),
        h('p', { class: 'hint', text: AI_STATUS_TEXT + ' Rédigez le compte rendu ci-dessous : la trame vous guide rubrique par rubrique.' }),
        h('a', { class: 'btn small', href: '#/reglages' }, icon('gear'), h('span', { text: 'Réglages de l\'IA' })));

    function renderBody() {
      box.textContent = '';
      const list = e.reportSections || [];
      const tp = templates.find((t) => t.id === e.templateId);
      if (!e.templateId && !list.length) box.append(empty('Choisissez une trame', 'La trame définit les rubriques de votre compte rendu.'));
      for (const s of list) {
        const ta = h('textarea', { class: 'textarea', 'aria-label': s.title, rows: '3', placeholder: 'À rédiger…' });
        ta.value = s.content || '';
        ta.addEventListener('input', () => { s.content = ta.value; edit(); });
        const hint = tp && (tp.sections.find((x) => x.title.trim().toLowerCase() === s.title.trim().toLowerCase()) || {}).instruction;
        box.append(h('div', { class: 'rsec' },
          h('div', { class: 'rsec-head' }, h('div', { class: 'rt', text: s.title }),
            h('button', { class: 'iconbtn', 'aria-label': 'Supprimer la rubrique', style: { color: 'var(--muted)', width: '36px', height: '36px' }, onclick: async () => {
              if ((s.content || '').trim() && !(await confirmDialog({ title: 'Supprimer cette rubrique ?', message: 'Le texte qu\'elle contient sera perdu.', danger: true, confirmLabel: 'Supprimer' }))) return;
              e.reportSections = list.filter((x) => x !== s); edit(); renderBody();
            } }, icon('trash'))),
          hint ? h('p', { class: 'consigne', text: hint }) : null, ta));
        autosize(ta);
      }
      if (e.templateId || list.length) box.append(h('button', { class: 'btn small', style: { marginBottom: '12px' }, onclick: async () => {
        const n = await promptDialog({ title: 'Nouvelle rubrique', label: 'Titre de la rubrique', confirmLabel: 'Ajouter' });
        if (n) { sections().push({ id: S.uid('r'), title: n, content: '' }); edit(); renderBody(); }
      } }, icon('plus'), h('span', { text: 'Ajouter une rubrique' })));
      box.append(h('div', { class: 'btn-row', style: { marginTop: '6px' } },
        h('button', { class: 'btn', onclick: async () => { const ok = S.hasReport(e) && (await copyText(reportText(e, folders, tplName()))); toast(ok ? 'Compte rendu copié' : 'Rien à copier pour le moment'); } }, icon('copy'), h('span', { text: 'Copier' })),
        h('button', { class: 'btn', onclick: exportMenu }, icon('share'), h('span', { text: 'Exporter' }))),
        h('button', { class: 'btn primary', style: { marginTop: '10px' }, onclick: mailChoice }, icon('share'), h('span', { text: 'Envoyer par mail' })));
    }
    renderBody();
    const prevRep = e.reportHistory[0];
    const restoreBtn = prevRep ? h('button', { class: 'btn small', style: { marginBottom: '12px' }, onclick: async () => {
      if (!(await confirmDialog({ title: 'Rétablir le compte rendu précédent ?', message: 'Le compte rendu actuel sera remplacé par celui d\'avant la dernière rédaction par IA (du ' + fmtDateTime(prevRep.date) + ').', confirmLabel: 'Rétablir' }))) return;
      try {
        const restored = JSON.parse(prevRep.text);
        e.reportHistory = S.pushHistory(e.reportHistory.slice(1), { text: JSON.stringify(e.reportSections || []), reason: 'avant rétablissement' });
        e.reportSections = restored; await S.saveEntretien(e); toast('Compte rendu précédent rétabli'); renderBody();
      } catch { toast('Rétablissement impossible.'); }
    } }, icon('back'), h('span', { text: 'Rétablir le compte rendu d\'avant la dernière rédaction IA' })) : null;
    return h('div', {}, h('label', { class: 'lbl', style: { marginTop: 0 }, text: 'Trame' }), tplSel, h('div', { style: { height: '14px' } }), ia, restoreBtn,  h('div', { style: { height: '16px' } }), box);
  }

  // ----- onglet Infos -----
  // Le titre suit « Nom — Sujet — date » tant qu'il n'a pas été modifié à la main (anciennes fiches : jamais touchées)
  const syncTitle = () => { if (e.titleAuto) { e.title = S.composeTitle(e.category, e.who, e.subject, e.date); titleInp.value = e.title; fitTitle(); } };
  function infosTab() {
    const catBox = h('div', { class: 'catpick' });
    const folderBtn = h('button', { class: 'pickrow' }, h('span', {}), icon('chevron'));
    const path = () => (e.folderId ? S.folderPath(e.folderId, folders).map((f) => f.name).join(' › ') : e.category ? 'Racine de « ' + catLabel(e.category) + ' »' : 'Non classé');
    const upd = () => { folderBtn.firstChild.textContent = path(); meta.textContent = metaLine(e, folders); };
    folderBtn.addEventListener('click', async () => {
      const r = await pickFolder({ folders, current: { category: e.category, folderId: e.folderId }, title: 'Déplacer l\'entretien vers…' });
      if (r) { e.category = r.category; e.folderId = r.folderId; edit(); upd(); renderCats(); }
    });
    function renderCats() {
      catBox.textContent = '';
      for (const c of CATEGORIES) catBox.append(h('button', { class: e.category === c.id ? 'on' : '', onclick: () => { if (e.category !== c.id) { e.category = c.id; e.folderId = null; syncTitle(); edit(); upd(); renderCats(); renderBody(); } } },
        h('div', { class: 'tile', style: { width: '40px', height: '40px' } }, catIcon(c.id)), h('span', { style: { fontWeight: 600, color: 'var(--ink)' }, text: c.label })));
    }
    renderCats(); upd();
    const dateInp = h('input', { class: 'field', type: 'datetime-local', value: toLocalInput(e.date), 'aria-label': 'Date' });
    dateInp.addEventListener('change', () => { e.date = fromLocalInput(dateInp.value); syncTitle(); edit(); upd(); });
    const ci = catInfo(e.category) || {};
    const whoInp = h('input', { class: 'field', type: 'text', maxlength: '80', value: e.who, placeholder: ci.whoHint || '', 'aria-label': ci.whoLabel || 'Nom' });
    const subjInp = h('input', { class: 'field', type: 'text', maxlength: '100', value: e.subject, placeholder: ci.subjectHint || '', 'aria-label': ci.subjectLabel || 'Sujet' });
    whoInp.addEventListener('input', () => { e.who = whoInp.value; syncTitle(); edit(); });
    subjInp.addEventListener('input', () => { e.subject = subjInp.value; syncTitle(); edit(); });
    const autoBtn = h('button', { class: 'btn small', style: { marginTop: '8px' }, onclick: () => { e.titleAuto = true; syncTitle(); edit(); toast('Titre recomposé automatiquement'); renderBody(); } }, icon('sparkle'), h('span', { text: e.titleAuto ? 'Le titre suit ces informations' : 'Recomposer le titre avec ces informations' }));
    const srcLabel = { texte: 'Texte collé ou importé', micro: 'Enregistrement (laboratoire)', import: 'Audio importé (laboratoire)' }[e.source] || 'Texte';
    const kv = (k, v) => h('div', { class: 'kv' }, h('span', { text: k }), h('span', { text: v }));
    return h('div', {},
      h('label', { class: 'lbl', style: { marginTop: 0 }, text: 'Catégorie' }), catBox,
      h('label', { class: 'lbl', text: ci.whoLabel || 'Nom' }), whoInp, h('label', { class: 'lbl', text: ci.subjectLabel || 'Sujet' }), subjInp, autoBtn,
      h('label', { class: 'lbl', text: 'Dossier' }), folderBtn,
      h('label', { class: 'lbl', text: 'Date de l\'entretien' }), dateInp,
      h('div', { class: 'card', style: { marginTop: '18px' } }, h('div', { class: 'info-grid' },
        kv('Source', srcLabel), kv('Trame', tplName() || '—'), kv('Créé le', fmtDateTime(e.createdAt)), kv('Modifié le', fmtDateTime(e.updatedAt)),
        kv('Mots', String(S.wordCount(S.transcriptOf(e)))), e.nChunks ? kv('Audio', fmtDur(e.durationSec)) : null)),
      e.nChunks ? h('button', { class: 'btn', style: { marginTop: '12px' }, onclick: async () => {
        try { const blob = await buildWavBlob(e); await shareOrDownload([new File([blob], safeName(e.title) + '.wav', { type: 'audio/wav' })], e.title); } catch (err) { toast('Export impossible : ' + err.message); }
      } }, icon('share'), h('span', { text: 'Exporter l\'audio (WAV)' })) : null,
      h('button', { class: 'btn danger-ghost', style: { marginTop: '24px' }, onclick: deleteIt }, icon('trash'), h('span', { text: 'Supprimer l\'entretien' })));
  }

  // ----- assemblage -----
  const body = h('div', {});
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const TABS = [['transcription', 'Transcription'], ['compte-rendu', 'Compte rendu'], ['infos', 'Informations']];
  function renderBody() {
    tabs.textContent = '';
    for (const [id, label] of TABS) tabs.append(h('button', { class: tab === id ? 'on' : '', role: 'tab', 'aria-selected': String(tab === id), text: label, onclick: () => { tab = id; renderBody(); } }));
    body.replaceChildren(tab === 'transcription' ? transcriptTab() : tab === 'compte-rendu' ? reportTab() : infosTab());
  }
  renderBody();

  const el = h('div', { class: 'view' },
    topbar({ back: async () => { await saver.flush(); go('#/bibliotheque' + (e.category ? '?cat=' + e.category + (e.folderId ? '&f=' + e.folderId : '') : '')); }, backLabel: 'Bibliothèque',
      right: h('button', { class: 'iconbtn', 'aria-label': 'Plus d\'actions', onclick: menu }, icon('more')) }),
    titleInp, meta, saveState,
    S.hasAudio(e) ? audioCard() : null,
    tabs, body);
  return { el, dispose: async () => { await saver.dispose(); cleanups.forEach((f) => f()); } };
}
