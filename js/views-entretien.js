// Création d'un entretien et fiche détaillée (transcription, compte rendu, informations).
import { h, icon, catIcon, toast, confirmDialog, promptDialog, actionSheet, sheet, autosize, debouncedSaver, empty } from './ui.js';
import { CATEGORIES, catLabel, catInfo } from './defaults.js';
import * as S from './store.js';
import { kv } from './vault.js';
import { go, topbar, pickFolder } from './common.js';
import { fmtDate, fmtDateTime, reportText, transcriptText, copyText, downloadText, downloadBlob, shareOrDownload, printReport, safeName, metaLine, docPdfFile, validEmail, splitAddresses, mailtoHref, openMailto } from './exports.js';
import { buildWavBlob, attachWav, audioDigest } from '../audio.js';
import * as DB from '../db.js';
import { parseReport, buildSections } from "./report-import.js";
import { applyRestore, cleanPairs, mergeResults, isPerson } from "./restore-names.js";
import { cleanText, pickFile, readImport, previewImport, words as wordsOf } from './import.js';

const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocalInput = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : Date.now(); };
const fmtDur = (s) => { s = Math.max(0, Math.floor(s)); const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (hh ? hh + ':' + pad(m) : m) + ':' + pad(x); };

// Un seul point d'entrée pour ajouter du texte : coller ou importer un fichier PDF / TXT (l'aperçu et le choix Ajouter / Remplacer / Annuler restent obligatoires)
function addTextMenu(onPaste, onImport) {
  actionSheet({ title: 'Ajouter du texte', lead: 'Depuis le Dictaphone d’Apple ou un document existant.', actions: [
    { label: 'Coller le texte copié', sub: 'Depuis le presse-papiers (Dictaphone)', icon: 'clipboard', more: true, now: true, run: onPaste },
    { label: 'Importer un fichier', sub: 'PDF ou TXT, avec aperçu avant ajout', icon: 'upload', more: true, now: true, run: onImport },
  ] });
}

// =====================================================================
// NOUVEL ENTRETIEN
// =====================================================================
const DRAFT = 'dia_draft';
const MAX_DOC = 40 * 1024 * 1024;     // taille maximale d'un document joint conservé avec la fiche
export async function newView({ query }) {
  const [folders, templates] = await Promise.all([S.listFolders(), S.listTemplates()]);
  let d = {};
  try { d = JSON.parse(kv.get(DRAFT)) || {}; } catch {}
  const st = {
    category: CATEGORIES.some((c) => c.id === query.cat) ? query.cat : (d.category || S.getSettings().lastCategory || 'clients'),
    who: d.who || '', subject: d.subject || '', title: d.title || '', titleManual: !!d.titleManual,
    folderId: query.f || d.folderId || null, date: d.date || Date.now(), templateId: d.templateId || null, transcript: d.transcript || '',
  };
  if (query.cat && d.category && d.category !== query.cat) { st.templateId = null; if (!query.f) st.folderId = null; }
  const restored = !!(d.who || d.subject || d.title || d.transcript);
  const valid = (id) => !id || folders.some((f) => f.id === id && f.category === st.category);
  if (!valid(st.folderId)) st.folderId = null;
  const tplFor = () => S.visibleTemplates(templates, st.templateId ? [st.templateId] : []).filter((t) => t.category === st.category);
  if (!st.templateId || !templates.some((t) => t.id === st.templateId && t.category === st.category)) { const dt = S.defaultTemplateFor(templates, st.category); st.templateId = dt ? dt.id : null; }

  const saveDraft = () => { try { kv.set(DRAFT, JSON.stringify(st)); } catch {} };
  const clearDraft = () => { try { kv.remove(DRAFT); } catch {} };
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
  let pendingFile = null; // fichier importé : conservé avec la fiche à sa création (un seul document par fiche)
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
    if (meta.fileObj && !pendingFile) pendingFile = meta.fileObj;
    toast(meta.file ? 'Fichier importé' + (pendingFile && pendingFile.size <= MAX_DOC ? ' : il sera conservé avec la fiche' : '') : 'Transcription collée');
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
    try { const r = await readImport(f); await receive(r.text, { name: r.name, kind: r.kind, info: r.info, file: true, fileObj: f }); }
    catch (err) { toast(err.message, 6500); }
  }

  async function create() {
    const cat = st.category;
    const t = (st.title || '').trim() || S.composeTitle(cat, st.who, st.subject, st.date);
    const e = await S.createEntretien({ title: t, category: cat, folderId: st.folderId, date: st.date, templateId: st.templateId, transcript: cleanText(ta.value), who: st.who.trim(), subject: st.subject.trim(), titleAuto: !st.titleManual });
    S.setSetting('lastCategory', cat);
    // le fichier importé est conservé avec la fiche (document joint) ; au-delà de la taille maximale, seul le texte est gardé
    if (pendingFile && pendingFile.size <= MAX_DOC) {
      try { await DB.putOriginal(e.id, { blob: pendingFile, name: pendingFile.name, type: pendingFile.type || 'application/octet-stream' }); e.hasOriginal = true; await S.saveEntretien(e); }
      catch (err) { toast('Fiche créée, mais le fichier n\'a pas pu être conservé : ' + err.message, 6000); }
    }
    clearDraft();
    toast('Fiche créée : étape suivante, corriger et protéger');
    go('#/entretien/' + e.id + '?tab=corriger');
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
    h('p', { class: 'hint', style: { marginTop: '-4px' }, text: 'Copiez la transcription depuis le Dictaphone d\'Apple, puis ajoutez-la ici : collage, ou fichier PDF ou TXT.' }),
    h('button', { class: 'btn primary bigpaste', onclick: () => addTextMenu(paste, importFile) }, icon('plus'), h('span', { text: 'Ajouter du texte' })),
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
  let tab = ['transcription', 'proteger', 'compte-rendu', 'infos'].includes(query.tab) ? query.tab : 'transcription';
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
  const audioOn = () => e.nChunks > 0 && !(e.trashed && e.trashed.audio);          // audio retiré = dans la corbeille de la fiche

  // ----- en-tête -----
  // Titre sur plusieurs lignes si nécessaire (un champ à une seule ligne couperait les titres longs)
  const titleInp = h('textarea', { class: 'title-input', rows: '1', 'aria-label': 'Titre de l\'entretien', maxlength: '160', enterkeyhint: 'done' });
  titleInp.value = e.title;
  const fitTitle = () => { titleInp.style.height = 'auto'; titleInp.style.height = titleInp.scrollHeight + 'px'; };
  titleInp.addEventListener('input', () => { e.title = titleInp.value.replace(/\n/g, ' ') || 'Sans titre'; e.titleAuto = false; fitTitle(); edit(); });
  titleInp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); titleInp.blur(); } });
  requestAnimationFrame(fitTitle);
  // Pastilles d'information sous le titre : nom, sujet, dossier (ou catégorie et date pour les anciennes fiches)
  const meta = h('div', { class: 'tags' });
  const tag = (ico, text) => h('span', { class: 'tag' }, ico || null, h('span', { text }));
  function renderMeta() {
    const tags = [];
    if (e.who) tags.push(tag(icon('user'), e.who));
    if (e.subject) tags.push(tag(null, e.subject));
    const folder = e.folderId ? S.folderPath(e.folderId, folders).slice(-1)[0] : null;
    if (folder) tags.push(tag(icon('folder'), folder.name));
    if (!e.who && !e.subject) { tags.push(tag(e.category ? catIcon(e.category) : null, e.category ? catLabel(e.category) : 'Non classé')); tags.push(tag(null, fmtDate(e.date))); }
    meta.replaceChildren(...tags);
  }
  renderMeta();

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
  // Un compte rendu généré par l'IA et non relu ne part pas sans confirmation explicite (PDF, mail, copie, fichier, impression)
  async function guardReview(fn) {
    if (e.namesRestored && S.hasReport(e)) {
      const okN = await confirmDialog({ title: 'Vérification avant export', message: 'Ce compte rendu contient maintenant des NOMS RÉELS remis localement (réintégration des identités). Relisez-le et vérifiez que le destinataire est autorisé à les recevoir.', confirmLabel: 'J\'ai vérifié, continuer' });
      if (!okN) return;
    }
    if (e.iaInfo && !e.iaInfo.reviewed && S.hasReport(e)) {
      const ok = await confirmDialog({ title: 'Compte rendu non relu', message: 'Ce compte rendu a été généré par l\'IA et n\'est pas encore marqué comme relu. Une relecture humaine (montants, noms, dates, décisions) est indispensable avant tout usage professionnel.\nContinuer quand même ?', confirmLabel: 'Continuer quand même' });
      if (!ok) return;
    }
    return fn();
  }  // Menu unique « Partager » : PDF (créés sur l'appareil), mail, copie et fichier texte
  function shareMenu() {
    const hasT = S.hasTranscript(e), hasR = S.hasReport(e);
    if (!hasT && !hasR) return toast('Rien à partager pour le moment : ajoutez d\'abord du texte.', 4200);
    const pT = hasT ? preparePdf('transcript') : null, pR = hasR ? preparePdf('report') : null;
    const textOf = (k) => (k === 'transcript' ? S.transcriptOf(e) : reportText(e, folders, tplName()));
    // si la fiche a une transcription ET un compte rendu, on demande lequel
    const which = (title, fn) => {
      if (hasT && hasR) actionSheet({ title, actions: [{ label: 'La transcription', icon: 'doc', run: () => fn('transcript') }, { label: 'Le compte rendu', icon: 'doc', run: () => fn('report') }] });
      else fn(hasT ? 'transcript' : 'report');
    };
    actionSheet({ title: 'Partager', lead: 'Les PDF sont créés sur l\'appareil, rien n\'est envoyé automatiquement.', actions: [
      { label: 'Transcription en PDF', icon: 'doc', sub: hasT ? 'Tout le texte transcrit' : 'Aucune transcription pour le moment', run: () => (pT ? sharePdf(pT) : toast('Aucune transcription à exporter.')) },
      { label: 'Compte rendu en PDF', icon: 'doc', sub: hasR ? 'Le compte rendu structuré' : 'À rédiger d\'abord', run: () => (pR ? guardReview(() => sharePdf(pR)) : toast('Rédigez d\'abord le compte rendu.')) },
      { label: 'Envoyer par mail', icon: 'mail', sub: 'Transcription ou compte rendu', more: true, run: mailChoice },
      { label: 'Copier le texte', icon: 'copy', run: () => which('Copier quel texte ?', (k) => (k === 'report' ? guardReview : (fn) => fn())(async () => toast((await copyText(textOf(k))) ? 'Texte copié' : 'Copie impossible'))) },
      { label: 'Fichier texte (.txt)', icon: 'txt', run: () => which('Quel fichier texte ?', (k) => { downloadText(safeName(e.title) + (k === 'transcript' ? '-transcription.txt' : '-compte-rendu.txt'), k === 'transcript' ? transcriptText(e, folders) : textOf(k)); toast('Fichier créé'); }) },
      hasR ? { label: 'Imprimer le compte rendu…', icon: 'doc', run: () => guardReview(() => printReport(e, folders, tplName())) } : null,
    ].filter(Boolean) });
  }  // Envoi par mail : la messagerie de l'appareil s'ouvre, l'utilisateur relit puis envoie lui-même.
  function mailChoice() {
    const hasT = S.hasTranscript(e), hasR = S.hasReport(e);
    if (!hasT && !hasR) return toast('Rien à envoyer pour le moment.');
    actionSheet({ title: 'Envoyer par mail', actions: [
      { label: 'La transcription', icon: 'doc', sub: hasT ? 'Le texte complet' : 'Aucune transcription pour le moment', run: () => (hasT ? mailSheet('transcript') : toast('Aucune transcription à envoyer.')) },
      { label: 'Le compte rendu', icon: 'doc', sub: hasR ? 'Le compte rendu structuré' : 'À rédiger d\'abord', run: () => (hasR ? guardReview(() => mailSheet('report')) : toast('Rédigez d\'abord le compte rendu.')) },
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
        h('div', { class: 'banner warn', style: { marginTop: '0' } }, icon('shield'), h('div', { text: 'Envoyez les documents confidentiels uniquement depuis une messagerie professionnelle autorisée par Ade-ci. ADE-CI Notes n\'envoie rien lui-même : votre messagerie s\'ouvre avec le message prêt, et rien ne part sans votre validation.' })),
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
  async function deleteIt() {
    await saver.flush();
    const { trashFiches } = await import('./trash-ui.js');
    await trashFiches([e], { onDone: (r) => { if (r === 'trashed') go('#/bibliotheque' + (e.category ? '?cat=' + e.category : '')); } });
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
  function transcriptEditor() {
    const ta = h('textarea', { class: 'textarea doc doc-scroll', spellcheck: 'false', autocorrect: 'off', 'aria-label': 'Transcription', placeholder: 'Aucune transcription. Touchez « Ajouter du texte ».' });
    ta.value = S.transcriptOf(e);
    const fit = autosize(ta);
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
      savedText = newText; ta.value = newText; fit(); upd(); histBtn.refresh();
      saveState.textContent = 'Enregistré à ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return true;
    }
    const histBtn = h('button', { class: 'round', 'aria-label': 'Versions précédentes', title: 'Versions précédentes' }, icon('clock'), h('b', {}));
    histBtn.refresh = () => { const n = e.transcriptHistory.length; histBtn.hidden = !n; histBtn.lastChild.textContent = String(n); histBtn.setAttribute('aria-label', `Versions précédentes (${n})`); };
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
    // Document joint : le fichier importé est conservé avec la fiche (un seul par fiche, jamais d'écrasement, 40 Mo maximum)
    async function attachDocument(file) {
      if (!file) return;
      if (file.size > MAX_DOC) { toast('Fichier trop volumineux pour être conservé (40 Mo maximum) : seul le texte est importé.', 5000); return; }
      if ((e.hasOriginal && !(e.trashed && e.trashed.document)) || (e.trashed && e.trashed.document)) { toast('Un document est déjà joint à cette fiche (ou dans sa corbeille) : seul le texte est importé.', 5000); return; }
      try { await DB.putOriginal(e.id, { blob: file, name: file.name, type: file.type || 'application/octet-stream' }); e.hasOriginal = true; edit(); }
      catch (err) { toast('Le fichier n\'a pas pu être conservé : ' + err.message, 5000); }
    }
    async function receive(incoming, meta) {
      const existing = ta.value;
      S.ensureOriginal(e);                                                           // ancienne fiche : le texte actuel devient l'original (présumé) avant tout changement
      if (!meta.file && !existing.trim()) { if (await applyChange(incoming, 'collage', meta.name)) { S.setOriginalFromImport(e, incoming); edit(); toast('Transcription collée'); } return; }
      const mode = await previewImport({ existing, incoming, name: meta.name, kind: meta.kind, info: meta.info });
      if (!mode) return;
      const newText = mode === 'append' ? existing.replace(/\s+$/, '') + '\n\n' + incoming : incoming;
      const ok = await applyChange(newText, mode === 'append' ? 'ajout' : mode === 'replace' ? 'remplacement' : 'import', meta.name);
      if (ok) {
        S.setOriginalFromImport(e, incoming, { replace: mode === 'replace', reason: meta.name || 'import' });
        if (meta.fileObj) await attachDocument(meta.fileObj);
        edit();
        toast(mode === 'append' ? 'Texte ajouté à la suite' : mode === 'replace' ? 'Texte remplacé : l\'ancien reste dans « Versions précédentes »' : 'Fichier importé', 5000);
      }
    }
    const paste = async () => {
      try { const t = cleanText(await navigator.clipboard.readText()); if (!t.trim()) return toast('Le presse-papiers est vide.'); await receive(t, { name: 'Texte collé', kind: 'txt' }); }
      catch { toast('Appuyez longuement dans la zone de texte, puis « Coller ».', 4200); ta.focus(); }
    };
    const imp = async () => {
      const f = await pickFile(); if (!f) return;
      toast('Lecture du fichier…', 2000);
      try { const r = await readImport(f); await receive(r.text, { name: r.name, kind: r.kind, info: r.info, file: true, fileObj: f }); }
      catch (err) { toast(err.message, 6500); }
    };
    const fix = () => sheet({ title: 'Corriger la transcription', build(body, close) {
      const find = h('input', { class: 'field', placeholder: 'Mot ou expression erronée', autocapitalize: 'none', autocorrect: 'off' });
      const rep = h('input', { class: 'field', placeholder: 'Remplacer par', autocapitalize: 'none', autocorrect: 'off' });
      const csChk = h('input', { type: 'checkbox' }), keepChk = h('input', { type: 'checkbox' });
      const found = h('p', { class: 'hint', style: { margin: '8px 0 0' } });
      const upFound = () => { const f = find.value.trim(); if (!f) { found.textContent = ''; return; } const n = S.replaceWords(ta.value, f, rep.value, { cs: csChk.checked }).count; found.textContent = n ? `${n} occurrence${n > 1 ? 's' : ''} trouvée${n > 1 ? 's' : ''} (mots entiers uniquement).` : 'Aucune occurrence trouvée.'; };
      for (const x of [find, rep, csChk]) x.addEventListener('input', upFound);
      const doReplace = async () => {
        const f = find.value.trim(); if (!f) return find.focus();
        const r = S.replaceWords(ta.value, f, rep.value, { cs: csChk.checked });
        if (!r.count) return toast('Aucune occurrence trouvée.');
        let kept = '';
        if (keepChk.checked) { const err = S.addVocabEntry(f, rep.value, csChk.checked); kept = err ? ' (non retenue : ' + err + ')' : ' · retenue dans le vocabulaire'; }
        close(); if (await applyChange(r.text, 'correction', `« ${f.slice(0, 30)} » → « ${rep.value.slice(0, 30)} »`)) toast(`${r.count} remplacement${r.count > 1 ? 's' : ''}${kept}`, 4500);
      };      const vocab = S.getVocab();
      const last = e.transcriptHistory[0];
      body.append(
        h('label', { class: 'lbl', text: 'Rechercher' }), find, h('label', { class: 'lbl', text: 'Remplacer par' }), rep, found,
        h('label', { class: 'check' }, csChk, h('span', { text: 'Respecter les majuscules' })),
        h('label', { class: 'check' }, keepChk, h('span', { text: 'Retenir cette correction dans mon vocabulaire' })),
        h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn primary', text: 'Tout remplacer', onclick: doReplace }),
          h('button', { class: 'btn', onclick: async () => { const r = S.applyVocab(ta.value, vocab); if (!r.count) return toast(r.skipped ? 'Aucune correction appliquée : ' + r.skipped + ' occurrence(s) ignorée(s) par prudence (noms propres possibles).' : 'Aucune correction à appliquer.', 5000); close(); if (await applyChange(r.text, 'correction', 'vocabulaire')) toast(`${r.count} correction${r.count > 1 ? 's' : ''} du vocabulaire appliquée${r.count > 1 ? 's' : ''}`); } }, icon('sparkle'), h('span', { text: `Appliquer mon vocabulaire (${vocab.length})` })),
          last && last.reason === 'correction' ? h('button', { class: 'btn', text: 'Annuler la dernière correction', onclick: async () => { close(); toast((await applyChange(last.text, 'rétablissement', 'avant correction')) ? 'Correction annulée' : 'Annulation impossible'); } }) : null,
          h('button', { class: 'btn', text: 'Fermer', onclick: close })));
    } });
    const view = h('div', {},
      h('div', { class: 'actions' },
        h('button', { class: 'btn small primary', onclick: () => addTextMenu(paste, imp) }, icon('plus'), h('span', { text: 'Ajouter du texte' })),
        h('button', { class: 'btn small', onclick: fix }, icon('edit'), h('span', { text: 'Corriger' })),
        histBtn),
      ta, stats);
    return { el: view, paste, imp, fix, apply: applyChange, menu: () => addTextMenu(paste, imp) };
  }
  const transcriptTab = () => transcriptEditor().el;
  // ----- onglet Compte rendu -----
  function mergeSections(existing, tpl) {
    const used = new Set();
    const out = tpl.sections.map((ts) => {
      const m = existing.find((x) => !used.has(x.id) && x.title.trim().toLowerCase() === ts.title.trim().toLowerCase());
      if (m) { used.add(m.id); return m; }
      return { id: S.uid('r'), title: ts.title, content: '', ...(ts.level === 2 ? { level: 2 } : {}) };
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
      for (const t of S.visibleTemplates(templates, e.templateId ? [e.templateId] : []).filter((x) => x.category === c.id)) grp.append(h('option', { value: t.id, text: t.name + (S.isTemplateHidden(t.id) ? ' (masquée)' : '') }));
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

    // ----- rédaction par l'IA (moteur local) : jamais simulée, toujours à relire -----
    // IA locale : masquée par défaut ; ses modules ne sont chargés que si les « fonctions avancées » sont activées (code conservé).
    const iaHolder = h('div', {});
    const hasT = S.hasTranscript(e);
    async function buildIa() {
    const [{ engineSettings, shortModel }, { usableModel }, { assistReport }] = await Promise.all([import('./ia-engine.js'), import('./ia-local.js'), import('./assist.js')]);
    const eng = engineSettings();
    const um = eng.kind === 'webgpu' ? usableModel() : null;
    const ready = eng.kind === 'server' || !!um;
    const ia = h('div', { class: 'card ia-card' },
      h('div', { class: 'rt serif', style: { fontSize: '20px', color: 'var(--ink)' } }, h('span', { text: 'Rédaction par l\'IA' }), h('span', { class: 'badge', text: ready ? 'Locale' : 'Non configurée' })),
      h('p', { class: 'hint', text: ready
        ? (eng.kind === 'server' ? `Moteur sur cet ordinateur${eng.model ? ' · ' + shortModel(eng.model) : ''}. La transcription ne quitte pas l'ordinateur ; le résultat est un brouillon relié à la transcription, à relire.` : `Moteur du navigateur · ${um.label}. La transcription reste sur l'appareil ; le résultat est un brouillon à relire.`)
        : 'Aucune IA n\'est configurée sur cet appareil. Sur PC : un moteur local gratuit (voir les Réglages). Sur iPhone : l\'assistant ci-dessous classe les passages de la transcription par rubrique, sans IA.' }),
      h('div', { style: { display: 'grid', gap: '8px' } },
        ready ? h('button', { class: 'btn primary', disabled: !hasT, onclick: async () => { await saver.flush(); location.href = 'ia.html?e=' + e.id; } }, icon('sparkle'), h('span', { text: 'Générer avec l\'IA' }))
          : h('a', { class: 'btn primary', href: '#/reglages?open=ia' }, icon('gear'), h('span', { text: 'Configurer l\'IA' })),
        h('button', { class: 'btn', disabled: !hasT, onclick: () => assistSheet() }, icon('edit'), h('span', { text: 'Assistant sans IA' }))),
      hasT ? null : h('p', { class: 'hint', text: 'Ajoutez d\'abord la transcription.' }));

    // Assistant sans IA : propose les phrases de la transcription classées par rubrique ; l'utilisateur coche ce qu'il garde.
    function assistSheet() {
      const tp = templates.find((x) => x.id === e.templateId);
      if (!tp) return toast('Choisissez d\'abord une trame.', 3500);
      const res = assistReport(tp, S.applyVocab(S.transcriptOf(e), S.getVocab()).text);
      const picks = [];
      sheet({ title: 'Assistant de structuration', wide: true, build(body, close) {
        body.append(h('p', { class: 'hint', style: { marginTop: 0 }, text: `Sans IA : ${res.stats.kept} phrase${res.stats.kept > 1 ? 's' : ''} de la transcription classée${res.stats.kept > 1 ? 's' : ''} par rubrique, recopiée${res.stats.kept > 1 ? 's' : ''} telles quelles. Décochez ce que vous ne voulez pas garder ; rien n'est inventé.` }));
        for (const sec of res.sections) {
          if (!sec.items.length) continue;
          body.append(h('div', { class: 'rt serif', style: { fontSize: '20px', color: 'var(--marine)', margin: '14px 0 4px' }, text: sec.title }));
          sec.items.forEach((it, i) => {
            const chk = h('input', { type: 'checkbox', checked: true });
            picks.push({ sec, it, chk, ev: sec.evidence[i] });
            body.append(h('label', { class: 'check' }, chk, h('span', { text: it.text })));
          });
        }
        body.append(h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn primary', onclick: () => {
            const chosen = picks.filter((p) => p.chk.checked);
            if (!chosen.length) return toast('Rien n\'est coché.');
            if (S.hasReport(e)) e.reportHistory = S.pushHistory(e.reportHistory, { text: JSON.stringify(e.reportSections || []), reason: 'avant assistant' });
            for (const p of chosen) {
              const s = (e.reportSections || []).find((x) => x.title.trim().toLowerCase() === p.sec.title.trim().toLowerCase());
              if (!s) continue;
              s.content = (s.content || '').trim() ? s.content.replace(/\s+$/, '') + '\n- ' + p.it.text : '- ' + p.it.text;
              s.evidence = [...(s.evidence || []), p.ev];
            }
            edit(); close(); renderBody(); toast(`${chosen.length} ligne${chosen.length > 1 ? 's' : ''} ajoutée${chosen.length > 1 ? 's' : ''} au compte rendu`, 4000);
          } }, icon('check'), h('span', { text: 'Ajouter la sélection' })),
          h('button', { class: 'btn', text: 'Annuler', onclick: close })));
      } });
    }
    iaHolder.replaceChildren(ia);
    if (query.assist) setTimeout(() => { query.assist = ''; assistSheet(); }, 500);
    }
    if (S.getSettings().advanced) buildIa().catch((err) => console.error('IA locale :', err && err.message));

    const KIND_LABEL = { 'à confirmer': 'À confirmer', 'à vérifier': 'À vérifier', contradiction: 'Contradiction', 'sans source': 'Sans source dans la transcription', corrigé: 'Corrigé' };
    const flagsBlock = (s) => (s.flags && s.flags.length ? h('div', { class: 'rflags' }, s.flags.slice(0, 8).map((f) => h('div', { class: 'rflag' }, icon('info'), h('span', {}, h('b', { text: (KIND_LABEL[f.kind] || f.kind) + ' : ' }), f.text)))) : null);
    const evidenceBlock = (s) => (s.evidence && s.evidence.length ? h('details', { class: 'evid' }, h('summary', { text: `Passages justificatifs (${s.evidence.length})` }),
      s.evidence.map((ev) => h('div', { class: 'ev' }, h('div', { class: 'ev-t', text: ev.t }), (ev.q || []).map((q) => h('blockquote', { text: '« ' + q + ' »' }))))) : null);

    function reviewBanner() {
      const info = e.iaInfo;
      if (!info) return null;
      if (info.reviewed) return h('div', { class: 'note' }, icon('check'), h('span', { text: `Généré avec l'IA, relu le ${fmtDateTime(info.reviewedAt || Date.now())}` }), h('button', { text: 'Annuler', onclick: () => { info.reviewed = false; delete info.reviewedAt; edit(); renderBody(); } }));
      return h('div', { class: 'banner warn', style: { marginTop: '0' } }, icon('info'), h('div', {},
        h('div', { style: { fontWeight: 600 }, text: 'Brouillon généré par l\'IA : relecture obligatoire' }),
        h('div', { class: 'hint', style: { margin: '4px 0 8px' }, text: `${info.label || 'IA locale'} · ${fmtDateTime(info.date)}. Vérifiez chaque rubrique, ses passages justificatifs et les points signalés avant tout usage professionnel.` }),
        (info.flags && info.flags.length) ? h('ul', { class: 'plain' }, info.flags.slice(0, 6).map((f) => h('li', { text: f.text }))) : null,
        h('button', { class: 'btn small primary', onclick: () => { info.reviewed = true; info.reviewedAt = Date.now(); edit(); renderBody(); toast('Compte rendu marqué comme relu'); } }, icon('check'), h('span', { text: 'J\'ai relu ce compte rendu' }))));
    }

    function renderBody() {
      box.textContent = '';
      const list = e.reportSections || [];
      const tp = templates.find((t) => t.id === e.templateId);
      if (!e.templateId && !list.length) box.append(empty('Choisissez une trame', 'La trame définit les rubriques de votre compte rendu.'));
      const rb = reviewBanner(); if (rb) box.append(rb, h('div', { style: { height: '12px' } }));
      for (const s of list) {
        const ta = h('textarea', { class: 'textarea', 'aria-label': s.title, rows: '3', placeholder: 'À rédiger…' });
        ta.value = s.content || '';
        const pill = s.ia ? h('span', { class: 'pill todo', text: 'IA · à relire' }) : null;
        ta.addEventListener('input', () => { s.content = ta.value; if (s.ia && pill) { s.edited = true; pill.textContent = 'IA · modifié'; } edit(); });
        const hint = tp && (tp.sections.find((x) => x.title.trim().toLowerCase() === s.title.trim().toLowerCase()) || {}).instruction;
        if (s.ia && s.edited && pill) pill.textContent = 'IA · modifié';
        box.append(h('div', { class: 'rsec' + (s.level === 2 ? ' sub' : ''), style: s.level === 2 ? { marginLeft: '14px', borderLeft: '3px solid var(--line, #d8dde2)', paddingLeft: '10px' } : {} },
          h('div', { class: 'rsec-head' }, h('div', { class: 'rt', style: s.level === 2 ? { fontSize: '0.95em' } : {}, text: s.title }), pill,
            h('button', { class: 'iconbtn', 'aria-label': 'Supprimer la rubrique', style: { color: 'var(--muted)', width: '36px', height: '36px' }, onclick: async () => {
              if ((s.content || '').trim() && !(await confirmDialog({ title: 'Supprimer cette rubrique ?', message: 'Le texte qu\'elle contient sera perdu.', danger: true, confirmLabel: 'Supprimer' }))) return;
              e.reportSections = list.filter((x) => x !== s); edit(); renderBody();
            } }, icon('trash'))),
          hint ? h('p', { class: 'consigne', text: hint }) : null, ta, flagsBlock(s), evidenceBlock(s)));
        autosize(ta);
      }
      if (e.templateId || list.length) box.append(h('button', { class: 'btn small', style: { marginBottom: '12px' }, onclick: async () => {
        const n = await promptDialog({ title: 'Nouvelle rubrique', label: 'Titre de la rubrique', confirmLabel: 'Ajouter' });
        if (n) { sections().push({ id: S.uid('r'), title: n, content: '' }); edit(); renderBody(); }
      } }, icon('plus'), h('span', { text: 'Ajouter une rubrique' })));
      /* Copier, exporter et envoyer par mail : menu « Partager » en haut de la fiche */
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
    // La rédaction par IA locale et l'assistant sans IA ne sont affichés que si les « fonctions avancées » sont activées (Réglages).
    return h('div', {}, h('label', { class: 'lbl', style: { marginTop: 0 }, text: 'Trame' }), tplSel, h('div', { style: { height: '14px' } }), iaHolder, restoreBtn,  h('div', { style: { height: '16px' } }), box);
  }

  // ----- onglet Infos -----
  // Le titre suit « Nom — Sujet — date » tant qu'il n'a pas été modifié à la main (anciennes fiches : jamais touchées)
  const syncTitle = () => { if (e.titleAuto) { e.title = S.composeTitle(e.category, e.who, e.subject, e.date); titleInp.value = e.title; fitTitle(); } };
  function infosTab() {
    const catBox = h('div', { class: 'catpick' });
    const folderBtn = h('button', { class: 'pickrow' }, h('span', {}), icon('chevron'));
    const path = () => (e.folderId ? S.folderPath(e.folderId, folders).map((f) => f.name).join(' › ') : e.category ? 'Racine de « ' + catLabel(e.category) + ' »' : 'Non classé');
    const upd = () => { folderBtn.firstChild.textContent = path(); renderMeta(); };
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
    whoInp.addEventListener('input', () => { e.who = whoInp.value; syncTitle(); renderMeta(); edit(); });
    subjInp.addEventListener('input', () => { e.subject = subjInp.value; syncTitle(); renderMeta(); edit(); });
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
        kv('Mots', String(S.wordCount(S.transcriptOf(e)))), audioOn() ? kv('Audio', fmtDur(e.durationSec)) : null)),
      audioOn() ? h('button', { class: 'btn', style: { marginTop: '12px' }, onclick: async () => {
        try { const blob = await buildWavBlob(e); await shareOrDownload([new File([blob], safeName(e.title) + '.wav', { type: 'audio/wav' })], e.title); } catch (err) { toast('Export impossible : ' + err.message); }
      } }, icon('share'), h('span', { text: 'Exporter l\'audio (WAV)' })) : null,
      audioOn() ? h('button', { class: 'btn', style: { marginTop: '8px' }, onclick: async (ev) => { ev.target.disabled = true; try { const d = await audioDigest(e); toast('Empreinte audio : ' + d.sha256.slice(0, 24) + '… (' + d.chunks + ' morceaux)', 8000); } catch (err) { toast('Calcul impossible : ' + err.message, 5000); } ev.target.disabled = false; } }, icon('shield'), h('span', { text: 'Calculer l\'empreinte de l\'audio' })) : null,
      !e.nChunks && !(e.trashed && e.trashed.audio) ? h('button', { class: 'btn', style: { marginTop: '12px' }, onclick: attachAudio }, icon('upload'), h('span', { text: 'Rattacher un audio (WAV exporté)' })) : null,
      h('details', { class: 'evid', style: { marginTop: '22px' } }, h('summary', { text: 'Options avancées' }),
        S.hasTranscript(e) ? h('button', { class: 'btn', style: { marginTop: '10px' }, onclick: async () => { await saver.flush(); const { trashPartFlow } = await import('./trash-ui.js'); if (await trashPartFlow(e, 'transcript', { onDone: () => { renderBody(); } })) { /* l'original est conservé dans la fiche */ } } }, icon('trash'), h('span', { text: 'Retirer la transcription corrigée' })) : null,
        e.hasOriginal && !(e.trashed && e.trashed.document) ? h('button', { class: 'btn', style: { marginTop: '10px' }, onclick: async () => { const { trashPartFlow } = await import('./trash-ui.js'); await trashPartFlow(e, 'document', { onDone: () => { renderBody(); } }); } }, icon('trash'), h('span', { text: 'Retirer le document joint' })) : null,
        e.nChunks > 0 && !(e.trashed && e.trashed.audio) ? h('button', { class: 'btn', style: { marginTop: '10px' }, onclick: async () => { const { trashPartFlow } = await import('./trash-ui.js'); await trashPartFlow(e, 'audio', { onDone: () => { renderBody(); } }); } }, icon('trash'), h('span', { text: 'Retirer l\'enregistrement audio' })) : null),
      h('button', { class: 'btn danger-ghost', style: { marginTop: '24px' }, onclick: deleteIt }, icon('trash'), h('span', { text: 'Mettre cette fiche dans la corbeille' })));
  }

  // Rattache un WAV exporté par l'application à une fiche sans audio : écriture relue morceau par morceau, jamais d'écrasement.
  function attachAudio() {
    const inp = h('input', { type: 'file', accept: '.wav,audio/wav,audio/x-wav', style: { display: 'none' } });
    inp.addEventListener('change', async () => {
      const file = inp.files[0]; inp.remove(); if (!file) return;
      try {
        toast('Import de l\'audio…', 3000);
        const r = await attachWav(e, file);
        e.nChunks = r.session.nChunks; e.doneChunks = r.session.doneChunks; e.hadAudio = true; e.durationSec = r.session.durationSec;
        edit(); await saver.flush(); renderBody();
        toast(`Audio rattaché et vérifié (${r.session.nChunks} morceaux). Empreinte : ${r.digest.sha256.slice(0, 16)}…` + (r.truncated ? ' ATTENTION : fichier tronqué.' : ''), 8000);
      } catch (err) { toast(err.message, 7000); }
    });
    document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 120000);
  }
  // ----- onglet « Protéger » : module chargé seulement à l'ouverture de l'onglet -----
  function protectHolder() {
    const holder = h('div', {}, h('p', { class: 'hint', text: 'Chargement de la protection…' }));
    import('./protect-ui.js').then((m) => { holder.replaceChildren(m.protectTab({ e, templates, edit, saver, parcours: true }).el); })
      .catch((err) => holder.replaceChildren(h('div', { class: 'banner warn' }, icon('info'), h('div', { text: 'La fonction Protéger n\'a pas pu se charger : ' + (err && err.message ? err.message : err) + '. Vos données ne sont pas modifiées.' }))));
    return holder;
  }

  // ----- parcours guidé : Importer → Corriger et protéger → Trame → ChatGPT → Compte rendu -----
  const CHATGPT_URL = 'https://chatgpt.com/';
  const STEPS = [['importer', 'Importer', 'Importer'], ['corriger', 'Corriger et protéger', 'Corriger'], ['trame', 'Choisir la trame', 'Trame'], ['chatgpt', 'Ouvrir dans ChatGPT', 'ChatGPT'], ['compte-rendu', 'Enregistrer le compte rendu', 'Compte rendu']];
  const LEGACY = { transcription: 'corriger', proteger: 'corriger' };
  const stepIds = STEPS.map((x) => x[0]);
  let step = query.tab && (stepIds.includes(query.tab) ? query.tab : (LEGACY[query.tab] || (query.tab === 'infos' ? 'infos' : null)));
  if (!step) { const st = S.stepOf(e); step = st === 'termine' ? 'compte-rendu' : st; }
  const isWide = () => !!(window.matchMedia && window.matchMedia('(min-width: 1000px)').matches);
  let corrView = isWide() ? 'compare' : 'corrige';           // ordinateur : comparaison en colonnes par défaut
  const body = h('div', {});
  const stepBar = h('div', { class: 'steps', role: 'tablist', 'aria-label': 'Étapes' });
  const stepNav = h('div', { class: 'stepnav' });
  const doneOf = (id) => ({ importer: S.hasTranscript(e), corriger: !!(e.protect && e.protect.visited), trame: !!e.templateId, chatgpt: !!(e.protect && e.protect.copiedAt), 'compte-rendu': S.hasReport(e) }[id]);
  const goStep = async (id) => { await saver.flush(); step = id; renderBody(); window.scrollTo(0, 0); };

  // --- documents joints (fichier importé conservé avec la fiche) ---
  function docCard() {
    const card = h('div', { class: 'card', style: { marginTop: '14px' } });
    const draw = async () => {
      card.replaceChildren(h('div', { class: 'eyebrow', text: 'Document joint' }));
      const on = e.hasOriginal && !(e.trashed && e.trashed.document);
      if (!on) { card.append(h('p', { class: 'hint', text: e.trashed && e.trashed.document ? 'Le document de cette fiche est dans la corbeille (Réglages › Corbeille).' : 'Aucun document joint. Un fichier PDF ou TXT importé est conservé ici.' })); return; }
      let o = null; try { o = await DB.getOriginal(e.id); } catch (err) { card.append(h('p', { class: 'hint', text: 'Document illisible : ' + err.message })); return; }
      if (!o || !o.blob) { card.append(h('p', { class: 'hint', text: 'Aucun document joint.' })); return; }
      const kb = Math.max(1, Math.round(o.blob.size / 1024));
      card.append(h('div', { style: { fontWeight: '600', color: 'var(--ink)' }, text: o.name || 'document' }), h('div', { class: 'hint', style: { margin: '2px 0 8px' }, text: (kb > 1024 ? (kb / 1024).toFixed(1) + ' Mo' : kb + ' Ko') + ' · conservé sur cet appareil' }),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn small', onclick: () => { const url = URL.createObjectURL(o.blob); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000); } }, icon('doc'), h('span', { text: 'Ouvrir' })),
          h('button', { class: 'btn small', onclick: async () => { await shareOrDownload([new File([o.blob], o.name || 'document', { type: o.type || 'application/octet-stream' })], o.name || 'document'); } }, icon('share'), h('span', { text: 'Exporter' })),
          h('button', { class: 'btn small danger-ghost', onclick: async () => { const { trashPartFlow } = await import('./trash-ui.js'); await trashPartFlow(e, 'document', { onDone: () => draw() }); } }, icon('trash'), h('span', { text: 'Retirer' }))));
    };
    draw();
    return card;
  }

  // --- 1. Importer ---
  function stepImporter() {
    const ed = transcriptEditor();
    const has = S.hasTranscript(e);
    const wrap = h('div', {});
    wrap.append(h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Copiez la transcription depuis le Dictaphone d\'Apple, puis collez-la ici, ou importez un fichier PDF ou TXT. La transcription originale est conservée telle quelle.' }));
    if (!has) {
      wrap.append(h('button', { class: 'btn primary bigpaste', onclick: () => ed.menu() }, icon('plus'), h('span', { text: 'Ajouter la transcription' })));
    } else {
      S.ensureOriginal(e);
      const w = S.wordCount(e.original || S.transcriptOf(e));
      wrap.append(h('div', { class: 'card' },
        h('div', { class: 'eyebrow', text: 'Transcription originale' }),
        h('div', { class: 'hint', style: { margin: '2px 0 6px' }, text: `${w} mot${w > 1 ? 's' : ''} · enregistrée dans la fiche, non modifiable par les corrections` + (e.originalPresumed ? ' · fiche ancienne : le texte présent à la première ouverture fait office d\'original' : '') }),
        h('div', { class: 'pview doc', style: { maxHeight: '160px', overflow: 'auto' }, text: (e.original || '').slice(0, 1200) + ((e.original || '').length > 1200 ? '…' : '') }),
        h('button', { class: 'btn small', style: { marginTop: '10px' }, onclick: () => ed.menu() }, icon('plus'), h('span', { text: 'Ajouter ou remplacer du texte' }))));
    }
    wrap.append(docCard());
    return wrap;
  }

  // --- 2. Corriger et protéger ---
  function stepCorriger() {
    const wrap = h('div', {});
    S.ensureOriginal(e);
    if (!(e.protect && e.protect.visited)) { e.protect = { v: 1, level: 'renforce', ...(e.protect || {}), visited: true }; edit(); }
    if (corrView === 'compare' && !isWide()) corrView = 'corrige';
    const segItems = [['corrige', 'Corrigé'], ['protege', 'Protégé'], ['original', 'Original']];
    if (isWide()) segItems.unshift(['compare', 'Comparer']);
    const seg = h('div', { class: 'seg', style: { marginBottom: '12px' } }, segItems.map(([id, l]) => h('button', { class: corrView === id ? 'on' : '', text: l, onclick: () => { corrView = id; renderBody(); } })));
    wrap.append(h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Corrigez les erreurs de transcription, puis vérifiez les éléments masqués. L\'original n\'est jamais remplacé par la version corrigée ou protégée.' }), seg);
    if (!S.hasTranscript(e)) { wrap.append(empty('Aucune transcription', 'Revenez à l\'étape 1 pour ajouter le texte.')); return wrap; }
    if (corrView === 'compare') {
      // ordinateur : Original (lecture seule) | Corrigé (modifiable) | Protégé (calculé), côte à côte
      const ed = transcriptEditor();
      const prot = h('pre', { class: 'pview doc cmp-text', style: { whiteSpace: 'pre-wrap' }, text: 'Calcul du texte protégé…' });
      import('./protect-ui.js').then((m) => m.runProtect(e)).then(({ res }) => { prot.textContent = res.protectedText; }).catch((err) => { prot.textContent = 'Analyse impossible : ' + (err.message || err); });
      wrap.append(h('div', { class: 'cmp3' },
        h('div', {}, h('div', { class: 'lbl', text: 'Original (lecture seule)' }), h('pre', { class: 'pview doc cmp-text', style: { whiteSpace: 'pre-wrap' }, text: e.original || S.transcriptOf(e) })),
        h('div', {}, h('div', { class: 'lbl', text: 'Corrigé (modifiable)' }), ed.el),
        h('div', {}, h('div', { class: 'lbl', text: 'Protégé (calculé)' }), prot)),
        h('p', { class: 'hint', text: 'Le texte protégé se recalcule à chaque ouverture ; pour décider des éléments signalés, ouvrez la vue « Protégé ».' }));
    } else if (corrView === 'corrige') {
      const ed = transcriptEditor();
      wrap.append(h('div', { class: 'banner', style: { marginTop: 0 } }, icon('info'), h('div', { text: 'Vous modifiez la version corrigée. Le bouton « Corriger » applique aussi votre vocabulaire (aperçu et prudence sur les noms propres). Les versions précédentes restent consultables.' })), ed.el);
    } else if (corrView === 'protege') {
      wrap.append(protectHolder());
    } else {
      wrap.append(h('div', { class: 'card' }, h('div', { class: 'eyebrow', text: 'Transcription originale (lecture seule)' }),
        h('div', { class: 'pview doc', style: { whiteSpace: 'pre-wrap', marginTop: '8px' }, text: e.original || S.transcriptOf(e) }),
        h('button', { class: 'btn small', style: { marginTop: '12px' }, onclick: async () => {
          if (!(await confirmDialog({ title: 'Repartir de l\'original ?', confirmLabel: 'Remplacer la version corrigée', message: 'La version corrigée actuelle sera remplacée par l\'original. Elle reste dans « Versions précédentes ».' }))) return;
          const ed = transcriptEditor(); const ok = await ed.apply(e.original || '', 'rétablissement', 'original');
          if (ok) { toast('Version corrigée remise à l\'original'); corrView = 'corrige'; renderBody(); }
        } }, icon('back'), h('span', { text: 'Repartir de l\'original' }))));
    }
    return wrap;
  }

  // --- 3. Trame ---
  function stepTrame() {
    const wrap = h('div', {});
    wrap.append(h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Choisissez le type de compte rendu. La trame fixe les rubriques et les consignes de rédaction envoyées avec le texte protégé.' }));
    const PRIORITY = ['suivi patrimonial', 'premier rendez-vous', 'reunion interne', 'webinaire'];
    const rank = (t) => { const n = t.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); const i = PRIORITY.findIndex((p) => n.includes(p)); return i < 0 ? 99 : i; };
    const keep = e.templateId ? [e.templateId] : [];
    const list = S.visibleTemplates(templates, keep).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr'));
    const hiddenOthers = templates.filter((t) => S.isTemplateHidden(t.id) && !keep.includes(t.id)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const cardOf = (t) => {
      const sel = e.templateId === t.id;
      return (h('div', { class: 'card tplcard' + (sel ? ' on' : ''), style: { marginTop: '10px' } },
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
          h('div', { class: 'grow' }, h('div', { style: { fontWeight: '700', color: 'var(--ink)' }, text: t.name }), h('div', { class: 'hint', style: { margin: '2px 0 0' }, text: `${t.sections.length} rubrique${t.sections.length > 1 ? 's' : ''} · ${t.builtin ? 'trame intégrée' : 'ma trame'}` })),
          h('button', { class: 'btn small ' + (sel ? 'primary' : ''), 'aria-pressed': String(sel), text: sel ? '✓ Choisie' : 'Choisir', onclick: () => { e.templateId = t.id; edit(); renderBody(); } })),
        h('details', { class: 'evid' }, h('summary', { text: 'Voir les rubriques' }), h('ol', { class: 'plain' }, t.sections.map((x) => h('li', { text: x.title })))),
        h('a', { class: 'hint', href: '#/trame/' + t.id, style: { display: 'inline-block', marginTop: '6px' }, onclick: async () => { await saver.flush(); }, text: 'Modifier cette trame' })));
    };
    for (const t of list) wrap.append(cardOf(t));
    if (hiddenOthers.length) wrap.append(h('details', { class: 'evid', style: { marginTop: '16px' } }, h('summary', { text: `Afficher les trames masquées (${hiddenOthers.length})` }), ...hiddenOthers.map(cardOf)));
    wrap.append(h('a', { class: 'btn small', style: { marginTop: '14px' }, href: '#/trames' }, icon('template'), h('span', { text: 'Gérer toutes mes trames' })));
    return wrap;
  }

  // --- 4. Ouvrir dans ChatGPT ---
  // Une seule étape pour relire, traiter les points signalés, confirmer et envoyer : la revue et la confirmation de confidentialité
  // sont réunies dans UNE confirmation, demandée avant chaque copie. Rien n'est envoyé automatiquement.
  function stepChatgpt() {
    const wrap = h('div', {}, h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Le texte protégé est copié dans le presse-papiers avec la trame et les consignes, puis ChatGPT s\'ouvre. Vous collez et envoyez vous-même : l\'application n\'envoie rien.' }));
    const out = h('div', {}, h('p', { class: 'hint', text: 'Préparation du texte protégé…' }));
    wrap.append(out);
    const render = async () => {
      let r, m;
      try { m = await import('./protect-ui.js'); r = await m.runProtect(e); }
      catch (err) { out.replaceChildren(h('div', { class: 'banner warn' }, icon('info'), h('div', { text: 'Analyse impossible : ' + (err.message || err) + '. Votre transcription n\'est pas modifiée.' }))); return; }
      const { res, ctx } = r;
      const tpl = templates.find((x) => x.id === e.templateId) || null;
      const todo = res.spans.filter((s) => !s.silent && s.certainty === 'maybe' && s.decision !== 'keep');
      const leaks = res.leakReport ? res.leakReport.blocking : [];
      const nIssues = todo.length + leaks.length + (res.titleLeak ? 1 : 0);
      const prompt = tpl ? ctx.exp.buildPrompt({ template: tpl, categoryLabel: e.category ? catLabel(e.category) : '', protectedText: res.protectedText, dateMs: e.date }) : '';
      const blockers = [];
      if (!S.hasTranscript(e)) blockers.push({ txt: 'Aucune transcription : ajoutez-la à l\'étape 1.', go: 'importer', label: 'Aller à l\'import' });
      if (!tpl) blockers.push({ txt: 'Aucune trame choisie.', go: 'trame', label: 'Choisir la trame' });
      if (nIssues) blockers.push({ txt: `${nIssues} point${nIssues > 1 ? 's' : ''} à traiter ci-dessous avant l'envoi.` });
      const blocked = blockers.length > 0;
      const copied = e.protect && e.protect.copiedAt;
      const jump = (term) => { window.__focusTerm = term; corrView = 'protege'; goStep('corriger'); };
      const doExport = (open) => {
        sheet({ title: open ? 'Ouvrir dans ChatGPT' : 'Copier le texte', build(b, close) {
          b.append(h('div', { class: 'banner warn', style: { marginTop: 0 } }, icon('shield'), h('div', {}, h('b', { text: 'Ce texte est pseudonymisé, pas anonyme.' }), h('div', { text: 'Il peut encore permettre de reconnaître une personne. Vérifiez que les règles de confidentialité d\'Ade-ci autorisent son utilisation avec ChatGPT et que le compte utilisé n\'entraîne pas ses modèles sur vos conversations.' }))),
            h('ul', { class: 'plain', style: { margin: '12px 0' } }, ctx.exp.AVERTISSEMENT_COPIE.map((t) => h('li', { text: t }))),
            h('p', { class: 'hint', text: `Contenu copié : consignes de rédaction, trame « ${tpl.name} » et transcription corrigée et pseudonymisée (${res.protectedText.length.toLocaleString('fr-FR')} caractères). Aucune table de correspondance, aucune information masquée.` }));
          const ok = h('input', { type: 'checkbox' });
          const go1 = h('button', { class: 'btn primary', disabled: true, onclick: () => {
            // copie ET ouverture dans le même geste (exigence des navigateurs) ; rien n'est envoyé par l'application
            const p = copyText(prompt);
            if (open) { try { window.open(CHATGPT_URL, '_blank', 'noopener,noreferrer'); } catch {} }
            close();
            p.then((done) => {
              if (!done) { toast('Copie impossible : le navigateur a refusé l\'accès au presse-papiers.', 6000); return; }
              e.protect.reviewedAt = Date.now(); e.protect.reviewHash = m.hashText(res.protectedText); e.protect.copiedAt = Date.now(); e.protect.restore = m.buildRestoreSnapshot(res, e); edit();
              toast('Texte copié. Collez-le dans ChatGPT pour générer votre compte rendu.', 8000);
              renderBody();
            });
          } }, icon(open ? 'share' : 'copy'), h('span', { text: open ? 'Copier et ouvrir ChatGPT' : 'Copier le texte' }));
          ok.addEventListener('change', () => { go1.disabled = !ok.checked; });
          b.append(h('label', { class: 'check' }, ok, h('span', { text: 'J\'ai relu le texte protégé et je suis autorisé(e) à l\'utiliser avec ChatGPT (règles de confidentialité d\'Ade-ci).' })),
            h('div', { class: 'sheet-actions' }, go1, h('button', { class: 'btn', text: 'Annuler', onclick: close })));
        } });
      };
      const mainBtn = h('button', { class: 'btn primary bigpaste', disabled: blocked, 'aria-describedby': 'why-blocked', onclick: () => doExport(true) }, icon('share'), h('span', { text: 'Ouvrir dans ChatGPT' }));
      const copyBtn = h('button', { class: 'btn', disabled: blocked, onclick: () => doExport(false) }, icon('copy'), h('span', { text: 'Copier uniquement' }));
      const kids = [
        h('div', { class: 'card' },
          h('div', { class: 'kv' }, h('span', { text: 'Trame' }), h('span', {}, tpl ? tpl.name + ' ' : 'à choisir ', h('a', { href: 'javascript:void(0)', text: 'changer', onclick: () => goStep('trame') }))),
          h('div', { class: 'kv' }, h('span', { text: 'Éléments masqués' }), h('span', { text: String(res.stats.masked + res.stats.generalized) })),
          h('div', { class: 'kv' }, h('span', { text: 'À traiter' }), h('span', { class: nIssues ? 'warn-t' : '', text: nIssues ? String(nIssues) : 'aucun' }))),
        nIssues ? h('div', { style: { marginTop: '14px' } }, m.issuesPanel({ e, res, edit, rerun: render, onJump: jump })) : null,
        blockers.length ? h('div', { class: 'banner warn', id: 'why-blocked', style: { marginTop: '14px' } }, icon('info'), h('div', {}, h('b', { text: 'Envoi bloqué' }),
          ...blockers.map((c) => h('div', {}, h('span', { text: c.txt + ' ' }), c.go ? h('a', { href: 'javascript:void(0)', text: c.label, onclick: () => goStep(c.go) }) : null)))) : null,
        h('div', { style: { height: '14px' } }), mainBtn, h('div', { style: { height: '8px' } }), copyBtn,
        copied ? h('div', { class: 'banner', style: { marginTop: '14px' } }, icon('check'), h('div', {}, h('div', { text: 'Texte copié le ' + fmtDateTime(e.protect.copiedAt) + '. Collez-le dans ChatGPT pour générer votre compte rendu.' }),
          h('a', { href: CHATGPT_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Si ChatGPT ne s\'est pas ouvert, touchez ici.' }))) : null,
        tpl ? h('details', { class: 'evid', style: { marginTop: '14px' }, open: !nIssues }, h('summary', { text: 'Relire le texte qui sera copié' }), h('pre', { class: 'pview doc', style: { whiteSpace: 'pre-wrap' }, text: prompt })) : null,
      ].filter((x) => x !== null && x !== undefined);
      out.replaceChildren(...kids);
    };
    render();
    return wrap;
  }
  // --- 5. Compte rendu ---
  // Import du compte rendu de ChatGPT : reconnaissance des rubriques de la trame (voir report-import.js), aperçu modifiable.
  // Le texte reçu est toujours conservé tel quel (e.reportRaw) en plus des rubriques.
  function pasteReportBlock(refresh) {
    const ta = h('textarea', { class: 'textarea', rows: '6', placeholder: 'Collez ici le compte rendu généré par ChatGPT…', 'aria-label': 'Compte rendu collé', spellcheck: 'false' });
    const pasteBtn = h('button', { class: 'btn small', onclick: async () => { try { const t = await navigator.clipboard.readText(); if (!t.trim()) return toast('Le presse-papiers est vide.'); ta.value = t; } catch { toast('Appuyez longuement dans la zone, puis « Coller ».', 4200); ta.focus(); } } }, icon('clipboard'), h('span', { text: 'Coller le presse-papiers' }));
    const importBtn = h('button', { class: 'btn primary', onclick: async () => {
      const text = ta.value.trim(); if (!text) return toast('Collez d\'abord le compte rendu.');
      const tpl = templates.find((x) => x.id === e.templateId) || null;
      const tsec = tpl ? tpl.sections : [];
      const sp = parseReport(text, tsec);
      const mapping = {};
      sp.blocks.forEach((b, i) => { mapping[i] = b.match ? 't:' + b.match.idx : 'new'; });
      // Correspondances LOCALES pour rétablir les noms : uniquement si elles sont fiables (instantané pris à la copie, ou recalcul identique à la copie).
      let src = null; try { src = await (await import('./protect-ui.js')).restoreSource(e); } catch { src = null; }
      const allPairs = src ? cleanPairs(src.pairs) : [];
      // Par défaut on ne rétablit PAS les personnes (le compte rendu va dans la fiche CRM du client) : lieux, entreprises, produits seulement.
      // Une personne n'est rétablie que si l'utilisateur la coche (correspondance fiable, validée).
      const persOn = new Set();
      const activePairs = () => allPairs.filter((p) => !isPerson(p) || persOn.has(p[0]));
      const known = allPairs.map((p) => p[0]);
      const parts = [sp.preamble, ...sp.blocks.map((x) => x.content), ...sp.blocks.map((x) => (x.match ? '' : x.title))];
      const compute = () => (allPairs.length ? mergeResults(parts.map((t) => applyRestore(t, activePairs(), { known }))) : null);
      let rr = compute();
      const everFound = !!allPairs.length && applyRestore(parts.join('\n'), allPairs).total > 0;
      const persFound = allPairs.filter((p) => isPerson(p) && applyRestore(parts.join('\n'), [p]).total > 0);
      const canRestore = everFound;
      const strangers = !allPairs.length ? applyRestore(text, []).unknown : [];
      let restored = false;
      const rest = (t) => (restored && allPairs.length ? applyRestore(t, activePairs(), { known }).text : t);
      sheet({ title: 'Importer le compte rendu', wide: true, build(b, close) {
        const nDet = sp.blocks.length, nOk = sp.found;
        b.append(h('p', { class: 'hint', style: { marginTop: 0 }, text: !nDet
          ? 'Aucun titre de rubrique détecté dans ce texte. Il sera conservé en entier dans « Introduction » : vous pourrez le déplacer ou le découper ensuite.'
          : `${nDet} partie${nDet > 1 ? 's' : ''} détectée${nDet > 1 ? 's' : ''}, dont ${nOk} reconnue${nOk > 1 ? 's' : ''} d'après la trame${tpl ? ' « ' + tpl.name + ' »' : ''}. Vérifiez la correspondance de chacune avant d'importer ; vous pourrez tout modifier ensuite.` }));
        if (sp.preamble) b.append(h('div', { class: 'banner', style: { marginTop: 0 } }, icon('info'), h('div', { text: 'Le texte placé avant la première rubrique est conservé dans une rubrique « Introduction ».' })));
        // Texte aplati ou rubriques manquantes : la répartition proposée n'est pas certaine, l'utilisateur doit la valider explicitement
        // (des rubriques simplement absentes sont normales : un compte rendu synthétique n'écrit que ce qui a été dit ; seule une partie non reconnue est ambiguë)
        // une partie non reconnue que l'utilisateur a rattachée lui-même à une rubrique de la trame n'est plus ambiguë
        const needCheck = () => nDet > 0 && (sp.reflowed > 0 || sp.noColon || sp.blocks.some((x, i) => !x.match && !String(mapping[i]).startsWith('t:')));
        const needNow = () => needCheck() || (restored && !!rr && (rr.ambiguous.length > 0 || rr.unknown.length > 0));
        if (sp.reflowed) b.append(h('div', { class: 'banner warn', style: { marginTop: '8px' } }, icon('info'), h('div', { text: `Le texte collé ne contenait plus (ou presque plus) de retours à la ligne : ${sp.reflowed} titre${sp.reflowed > 1 ? 's' : ''} retrouvé${sp.reflowed > 1 ? 's' : ''} dans le fil du texte, listes à puces reconstituées. Le texte original reste conservé tel quel.` })));
        if (nDet && tpl && sp.missing.length) b.append(h('p', { class: 'hint', text: 'Rubriques de la trame non retrouvées : ' + sp.missing.join(', ') + '. Elles resteront vides ; vous pouvez déplacer une partie vers l\'une d\'elles avec les listes ci-dessous.' }));
        const chk = h('input', { type: 'checkbox' });
        const chkLabel = h('label', { class: 'check' }, chk, h('span', { text: 'J\'ai vérifié la répartition proposée et les points signalés ci-dessus.' }));
        const okBtn = h('button', { class: 'btn primary', text: 'Importer dans la fiche' });
        const syncOk = () => { const n = needNow(); chkLabel.hidden = !n; okBtn.disabled = n && !chk.checked; };
        chk.addEventListener('change', syncOk);

        // ----- rétablir les noms (local, facultatif, jamais automatique) -----
        const restoreBox = h('div', { style: { marginTop: '10px' } });
        const cards = h('div', {});
        const renderRestore = () => {
          const kids = [];
          const nInfo = (n) => `${n} information${n > 1 ? 's' : ''}`;
          if (!restored && canRestore) {
            const nPreview = (rr ? rr.total : 0);
            kids.push(h('div', { class: 'btn-row', style: { alignItems: 'center' } },
              h('button', { class: 'btn small', onclick: () => { restored = true; rr = compute(); renderRestore(); renderCards(); syncOk(); } }, icon('user'), h('span', { text: 'Rétablir les informations' })),
              h('span', { class: 'hint', style: { margin: 0 }, text: nPreview ? `${nInfo(nPreview)} (lieux, entreprises…) rétablissable${nPreview > 1 ? 's' : ''} localement.` : 'Seules des personnes sont citées : à valider une par une.' })));
          } else if (restored && rr) {
            kids.push(h('div', { class: 'banner', style: { marginTop: 0 } }, icon('check'), h('div', {},
              h('div', { text: `${nInfo(rr.total)} rétablie${rr.total > 1 ? 's' : ''} localement (lieux, entreprises…). Rien n'est enregistré avant « Importer dans la fiche ».` }),
              h('div', { class: 'btn-row', style: { marginTop: '8px' } }, h('button', { class: 'btn small', onclick: () => { restored = false; renderRestore(); renderCards(); syncOk(); } }, icon('back'), h('span', { text: 'Revenir aux pseudonymes' }))))));
            // personnes : laissées en pseudonymes (inutiles dans une fiche CRM) sauf validation explicite
            if (persFound.length) {
              kids.push(h('div', { class: 'card', style: { marginTop: '8px' } },
                h('div', { class: 'hint', style: { margin: '0 0 6px' }, text: 'Personnes citées par un pseudonyme (non rétablies par défaut). Cochez seulement si l\'identité est indispensable pour distinguer plusieurs personnes :' }),
                ...persFound.map((p) => { const c = h('input', { type: 'checkbox', checked: persOn.has(p[0]) });
                  c.addEventListener('change', () => { if (c.checked) persOn.add(p[0]); else persOn.delete(p[0]); rr = compute(); renderRestore(); renderCards(); syncOk(); });
                  return h('label', { class: 'check' }, c, h('span', { text: `${p[0]} → ${p[1]}` })); })));
            }
            if (rr.ambiguous.length) kids.push(h('p', { class: 'hint', style: { color: 'var(--warn, #9a6700)' }, text: 'À vérifier, laissé tel quel (casse différente) : ' + rr.ambiguous.map((x) => '« ' + x + ' »').join(', ') + '.' }));
            if (rr.unknown.length) kids.push(h('p', { class: 'hint', style: { color: 'var(--warn, #9a6700)' }, text: 'Pseudonyme non reconnu (modifié par ChatGPT ou inconnu de cette fiche), laissé tel quel : ' + rr.unknown.map((x) => '« ' + x + ' »').join(', ') + '.' }));
            if (rr.restored.length) kids.push(h('details', { class: 'evid' }, h('summary', { text: 'Voir les remplacements effectués (affichage local)' }),
              rr.restored.map((x) => h('div', { class: 'kv' }, h('span', { text: x.label + (x.n > 1 ? ' ×' + x.n : '') }), h('b', { text: x.original })))));
            kids.push(h('div', { class: 'banner warn', style: { marginTop: '8px' } }, icon('shield'), h('div', { text: 'Le compte rendu enregistré contiendra de vraies informations : exportez-le seulement vers des destinataires autorisés. Le texte brut reçu de ChatGPT reste conservé tel quel, avec les pseudonymes.' })));
          } else if (!allPairs.length && strangers.length) {
            kids.push(h('p', { class: 'hint', text: 'Les informations masquées ne peuvent pas être rétablies pour cette fiche : correspondances indisponibles, ou texte modifié depuis la copie. Les pseudonymes sont conservés tels quels.' }));
          } else if (allPairs.length && !everFound && rr && (rr.unknown.length || rr.ambiguous.length)) {
            kids.push(h('p', { class: 'hint', text: 'Aucun pseudonyme de cette fiche n\'a été retrouvé avec certitude dans ce texte : rien n\'est rétabli.' }));
          }
          restoreBox.replaceChildren(...kids.filter(Boolean));
        };
        const used = () => { const c = {}; Object.values(mapping).forEach((m) => { c[m] = (c[m] || 0) + 1; }); return c; };
        const dupNote = h('p', { class: 'hint', style: { color: 'var(--warn, #9a6700)' } });
        const refreshDup = () => { const c = used(); const n = Object.entries(c).filter(([m, k]) => m.startsWith('t:') && k > 1).length; dupNote.textContent = n ? 'Plusieurs parties vont dans la même rubrique : leur texte sera mis à la suite.' : ''; };
        const renderCards = () => {
          cards.replaceChildren(...sp.blocks.map((blk, i) => {
            const sel = h('select', { class: 'field', 'aria-label': 'Rubrique de destination pour « ' + rest(blk.title) + ' »' });
            tsec.forEach((ts, n) => sel.append(h('option', { value: 't:' + n, text: (ts.level === 2 ? '↳ ' : '') + ts.title })));
            sel.append(h('option', { value: 'new', text: '➕ Nouvelle rubrique « ' + rest(blk.title) + ' »' }));
            if (i > 0) sel.append(h('option', { value: 'prev', text: '⤴ À la suite de la partie précédente' }));
            sel.value = mapping[i];
            sel.addEventListener('change', () => { mapping[i] = sel.value; refreshDup(); syncOk(); });
            const content = rest(blk.content);
            const firstLine = (content.split('\n').find((l) => l.trim()) || '').slice(0, 110);
            return h('div', { class: 'card', style: { marginTop: '8px' } },
              h('div', { style: { fontWeight: '600', color: 'var(--ink)' }, text: rest(blk.detected) + (blk.match ? (blk.match.how === 'exact' ? '  ✓' : '  ≈ reconnue') : '  ? non reconnue') + (blk.inline ? ' · retrouvée dans le fil du texte' : '') }),
              h('div', { class: 'hint', style: { margin: '2px 0 6px' }, text: `${content.length.toLocaleString('fr-FR')} caractères${firstLine ? ' · ' + firstLine : ''}` }), sel);
          }));
        };
        renderRestore(); renderCards();
        b.append(restoreBox, cards, dupNote);
        if (S.hasReport(e)) b.append(h('p', { class: 'hint', text: 'Le compte rendu actuel est conservé dans « Compte rendu précédent » (rétablissement possible).' }));
        b.append(h('details', { class: 'evid' }, h('summary', { text: 'Texte reçu de ChatGPT (conservé tel quel dans la fiche)' }), h('pre', { class: 'pview doc', style: { whiteSpace: 'pre-wrap' }, text: sp.raw })));
        okBtn.addEventListener('click', async () => {
          if (okBtn.disabled) return;
          if (S.hasReport(e)) e.reportHistory = S.pushHistory(e.reportHistory, { text: JSON.stringify(e.reportSections || []), reason: 'avant import ChatGPT' });
          const useSp = restored ? { ...sp, preamble: rest(sp.preamble), blocks: sp.blocks.map((x) => ({ ...x, title: x.match ? x.title : rest(x.title), content: rest(x.content) })) } : sp;
          const secs = nDet ? buildSections(useSp, tsec, mapping, S.uid) : [{ id: S.uid('r'), title: 'Introduction', content: rest(sp.preamble || sp.raw.trim()) }, ...tsec.map((ts) => ({ id: S.uid('r'), title: ts.title, content: '', ...(ts.level === 2 ? { level: 2 } : {}) }))];
          // le texte brut reçu reste TEL QUEL (avec les pseudonymes) : jamais remplacé par la version rétablie
          e.reportSections = secs; e.reportRaw = sp.raw; e.reportRawAt = Date.now(); e.namesRestored = !!(restored && rr && rr.total > 0); delete e.iaInfo;
          edit(); await saver.flush(); close(); toast(restored ? 'Compte rendu importé, noms rétablis. Vérifiez-le avant tout export.' : 'Compte rendu importé', restored ? 5000 : 3500); refresh();
        });
        syncOk();
        b.append(chkLabel);
        b.append(h('div', { class: 'sheet-actions' }, okBtn, h('button', { class: 'btn', text: 'Annuler', onclick: close })));
      } });
    } }, icon('check'), h('span', { text: 'Importer dans les rubriques' }));
    const restoreBtn = h('button', { class: 'btn small', onclick: () => restoreNamesFlow(refresh) }, icon('user'), h('span', { text: 'Rétablir les informations (facultatif)' }));
    return h('div', { class: 'card' }, h('div', { class: 'rt serif', style: { fontSize: '19px', color: 'var(--ink)' }, text: 'Coller le compte rendu de ChatGPT' }),
      h('p', { class: 'hint', text: 'Collez la réponse de ChatGPT. Elle est découpée en rubriques d\'après la trame choisie ; vous vérifiez la correspondance avant l\'import, puis vous pouvez la relire et la modifier.' }), ta,
      h('div', { class: 'btn-row', style: { marginTop: '10px' } }, pasteBtn, importBtn), h('div', { style: { height: '8px' } }), S.hasReport(e) ? restoreBtn : null);
  }
  // Rétablissement LOCAL et facultatif APRÈS import (compte rendu déjà enregistré). Mêmes règles que dans la fenêtre d'import :
// correspondances fiables seulement ; lieux, entreprises et autres informations par défaut ; personnes seulement si cochées.
  async function restoreNamesFlow(refresh) {
    try {
      const src = await (await import('./protect-ui.js')).restoreSource(e);
      if (!src) { toast('Rétablissement impossible pour cette fiche : correspondances indisponibles ou texte modifié depuis la copie. Les pseudonymes sont conservés.', 7000); return; }
      const all = (e.reportSections || []).map((x) => x.content || '').join('\n');
      const pairs = cleanPairs(src.pairs).filter((p) => applyRestore(all, [p]).total > 0);
      const on = new Set(pairs.filter((p) => !isPerson(p)).map((p) => p[0]));
      sheet({ title: 'Rétablir les informations', build(b, close) {
        if (!pairs.length) { b.append(h('p', { class: 'hint', text: 'Aucun pseudonyme de cette fiche n\'a été retrouvé avec certitude dans ce compte rendu. Rien à rétablir.' }), h('button', { class: 'btn', text: 'Fermer', onclick: close })); return; }
        b.append(h('p', { class: 'hint', style: { marginTop: 0 }, text: 'Les pseudonymes cochés seront remplacés localement par les informations d\'origine. Les personnes ne sont pas cochées par défaut : le compte rendu n\'a généralement pas besoin du nom du client.' }),
          ...pairs.map((p) => { const c = h('input', { type: 'checkbox', checked: on.has(p[0]) }); c.addEventListener('change', () => { if (c.checked) on.add(p[0]); else on.delete(p[0]); });
            return h('label', { class: 'check' }, c, h('span', { text: `${p[0]} → ${p[1]}` })); }),
          h('div', { class: 'banner warn' }, icon('shield'), h('div', { text: 'Après remplacement, le compte rendu contient de vraies informations : n\'exportez-le qu\'à des destinataires autorisés. Une vérification vous sera demandée avant tout export.' })),
          h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary', text: 'Rétablir', onclick: async () => {
            const chosen = pairs.filter((p) => on.has(p[0]));
            if (!chosen.length) return toast('Aucun pseudonyme coché.');
            e.reportHistory = S.pushHistory(e.reportHistory, { text: JSON.stringify(e.reportSections || []), reason: 'avant rétablissement des informations' });
            for (const sec of e.reportSections || []) sec.content = applyRestore(sec.content || '', chosen).text;
            e.namesRestored = true; edit(); await saver.flush(); close(); toast('Informations rétablies. Vérifiez le compte rendu avant export.', 5000); refresh();
          } }), h('button', { class: 'btn', text: 'Annuler', onclick: close })));
      } });
    } catch (err) { toast('Impossible de rétablir les informations.', 5000); }
  }
  function stepCompteRendu() {
    const wrap = h('div', {});
    const holder = h('div', {});
    const refresh = () => { holder.replaceChildren(reportTab()); };
    wrap.append(pasteReportBlock(() => { renderBody(); }), h('div', { style: { height: '14px' } }), holder);
    refresh();
    return wrap;
  }

  // --- assemblage ---
  function renderBody() {
    stepBar.replaceChildren(...STEPS.map(([id, label, short], i) => h('button', { class: (step === id ? 'on ' : '') + (doneOf(id) ? 'done' : ''), role: 'tab', 'aria-selected': String(step === id), 'aria-label': `Étape ${i + 1} : ${label}${doneOf(id) ? ' (terminée)' : ''}`, onclick: () => goStep(id) },
      h('b', { text: doneOf(id) && step !== id ? '✓' : String(i + 1) }), h('span', { class: 'lbl-s', text: short }), h('span', { class: 'lbl-l', text: label }))));
    const idx = stepIds.indexOf(step);
    const rootView = body.closest ? body.closest('.view') : null;
    if (rootView) rootView.classList.toggle('fiche-wide', (step === 'corriger' && corrView !== 'original' && corrView !== 'corrige') || step === 'chatgpt');
    body.replaceChildren(step === 'infos' ? h('div', {}, h('button', { class: 'btn small', style: { marginBottom: '12px' }, onclick: () => goStep(S.stepOf(e) === 'termine' ? 'compte-rendu' : (stepIds.includes(S.stepOf(e)) ? S.stepOf(e) : 'importer')) }, icon('back'), h('span', { text: 'Retour au parcours' })), infosTab())
      : step === 'importer' ? stepImporter() : step === 'corriger' ? stepCorriger() : step === 'trame' ? stepTrame() : step === 'chatgpt' ? stepChatgpt() : stepCompteRendu());
    stepNav.replaceChildren();
    if (idx >= 0) {
      if (idx > 0) stepNav.append(h('button', { class: 'btn', 'aria-label': 'Étape précédente : ' + STEPS[idx - 1][1], onclick: () => goStep(stepIds[idx - 1]) }, icon('back'), h('span', { text: 'Retour' })));
      if (idx < stepIds.length - 1) stepNav.append(h('button', { class: 'btn primary', 'aria-label': 'Étape suivante : ' + STEPS[idx + 1][1], onclick: () => goStep(stepIds[idx + 1]) }, h('span', { text: 'Continuer' }), icon('chevron')));
    }
  }
  renderBody();

  const el = h('div', { class: 'view' },
    topbar({ back: async () => { await saver.flush(); go('#/bibliotheque' + (e.category ? '?cat=' + e.category + (e.folderId ? '&f=' + e.folderId : '') : '')); }, backLabel: 'Bibliothèque',
      right: h('div', { style: { display: 'flex', gap: '8px' } },
        h('button', { class: 'iconbtn', 'aria-label': 'Informations et options de la fiche', title: 'Informations et options', onclick: () => goStep('infos') }, icon('gear')),
        h('button', { class: 'btn small', onclick: shareMenu }, icon('share'), h('span', { text: 'Partager' }))) }),
    titleInp, meta, saveState,
    audioOn() ? audioCard() : null,
    stepBar, body, stepNav);
  el.classList.toggle('fiche-wide', (step === 'corriger' && corrView !== 'original' && corrView !== 'corrige') || step === 'chatgpt');
  return { el, dispose: async () => { await saver.dispose(); cleanups.forEach((f) => f()); } };
}
