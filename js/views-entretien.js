// Création d'un entretien et fiche détaillée (transcription, compte rendu, informations).
import { h, icon, catIcon, toast, confirmDialog, promptDialog, actionSheet, sheet, autosize, debouncedSaver, empty } from './ui.js';
import { CATEGORIES, catLabel } from './defaults.js';
import * as S from './store.js';
import { go, topbar, pickFolder } from './common.js';
import { fmtDate, fmtDateTime, reportText, copyText, downloadText, shareOrDownload, printReport, safeName, metaLine, reportPdfFile, validEmail, splitAddresses, mailtoHref, openMailto } from './exports.js';
import { AI_STATUS_TEXT } from './ai.js';
import { usableModel } from './ia-local.js';
import { buildWavBlob } from '../audio.js';

const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocalInput = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : Date.now(); };
const fmtDur = (s) => { s = Math.max(0, Math.floor(s)); const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (hh ? hh + ':' + pad(m) : m) + ':' + pad(x); };

// Nettoyage d'un texte collé ou importé : caractères de contrôle retirés, fins de ligne normalisées
export const cleanText = (t) => t.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\n{4,}/g, '\n\n\n');

async function readTextFile(file) {
  if (file.size > 8 * 1024 * 1024) throw new Error('Fichier trop volumineux (8 Mo maximum).');
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 5));
  if (String.fromCharCode(...head) === '{\\rtf') throw new Error('Format RTF non pris en charge : enregistrez la transcription au format texte (.txt) ou collez-la.');
  if (head[0] === 0x50 && head[1] === 0x4b) throw new Error('Les fichiers Word (.docx) ne sont pas pris en charge : copiez le texte puis collez-le.');
  let text = new TextDecoder('utf-8').decode(buf);
  if ((head[0] === 0xff && head[1] === 0xfe)) text = new TextDecoder('utf-16le').decode(buf);
  return cleanText(text);
}
const pickTextFile = () => new Promise((resolve) => {
  const inp = h('input', { type: 'file', accept: '.txt,.text,.md,text/plain', style: { display: 'none' } });
  inp.addEventListener('change', () => resolve(inp.files[0] || null));
  document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
});

// =====================================================================
// NOUVEL ENTRETIEN
// =====================================================================
const DRAFT = 'dia_draft';
export async function newView({ query }) {
  const [folders, templates] = await Promise.all([S.listFolders(), S.listTemplates()]);
  let d = {};
  try { d = JSON.parse(localStorage.getItem(DRAFT)) || {}; } catch {}
  const st = {
    title: d.title || '', category: CATEGORIES.some((c) => c.id === query.cat) ? query.cat : (d.category || S.getSettings().lastCategory || 'clients'),
    folderId: query.f || d.folderId || null, date: d.date || Date.now(), templateId: d.templateId || null, transcript: d.transcript || '',
  };
  if (query.cat && d.category && d.category !== query.cat) { st.templateId = null; if (!query.f) st.folderId = null; }
  const restored = !!(d.title || d.transcript);
  const valid = (id) => !id || folders.some((f) => f.id === id && f.category === st.category);
  if (!valid(st.folderId)) st.folderId = null;
  const tplFor = () => templates.filter((t) => t.category === st.category);
  if (!st.templateId || !templates.some((t) => t.id === st.templateId && t.category === st.category)) { const dt = S.defaultTemplateFor(templates, st.category); st.templateId = dt ? dt.id : null; }

  const saveDraft = () => { try { localStorage.setItem(DRAFT, JSON.stringify(st)); } catch {} };
  const clearDraft = () => { try { localStorage.removeItem(DRAFT); } catch {} };

  const title = h('input', { class: 'field', type: 'text', placeholder: 'Ex. Rendez-vous de suivi', value: st.title, maxlength: '120', autocapitalize: 'sentences' });
  title.addEventListener('input', () => { st.title = title.value; saveDraft(); });

  const catBox = h('div', { class: 'catpick' });
  const folderBtn = h('button', { class: 'pickrow', onclick: async () => {
    const r = await pickFolder({ categories: [st.category], folders, current: { category: st.category, folderId: st.folderId } });
    if (r) { st.folderId = r.folderId; saveDraft(); renderFolder(); }
  } }, h('span', {}), icon('chevron'));
  const tplSel = h('select', { class: 'field', 'aria-label': 'Trame de compte rendu' });
  const dateInp = h('input', { class: 'field', type: 'datetime-local', value: toLocalInput(st.date), 'aria-label': 'Date de l\'entretien' });
  dateInp.addEventListener('change', () => { st.date = fromLocalInput(dateInp.value); saveDraft(); });
  const ta = h('textarea', { class: 'textarea', placeholder: 'Collez ici la transcription (appui long, puis « Coller »).', rows: '8', spellcheck: 'false', autocorrect: 'off' });
  ta.value = st.transcript;
  const stats = h('div', { class: 'stats' });
  const updStats = () => { const w = S.wordCount(ta.value); stats.textContent = w ? `${w} mot${w > 1 ? 's' : ''}` : ''; };
  ta.addEventListener('input', () => { st.transcript = ta.value; updStats(); saveDraft(); });
  updStats();

  function renderCats() {
    catBox.textContent = '';
    for (const c of CATEGORIES) catBox.append(h('button', { class: st.category === c.id ? 'on' : '', 'aria-pressed': String(st.category === c.id), onclick: () => {
      if (st.category !== c.id) { st.category = c.id; st.folderId = null; const dt = S.defaultTemplateFor(templates, c.id); st.templateId = dt ? dt.id : null; saveDraft(); renderCats(); renderFolder(); renderTpl(); }
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
  renderCats(); renderFolder(); renderTpl();

  function setText(text, mode) {
    ta.value = mode === 'append' && ta.value.trim() ? ta.value.replace(/\s+$/, '') + '\n\n' + text : text;
    st.transcript = ta.value; saveDraft(); updStats();
  }
  const withMode = (text) => {
    if (!ta.value.trim()) return setText(text, 'replace');
    actionSheet({ title: 'Un texte est déjà présent', actions: [
      { label: 'Remplacer le texte actuel', icon: 'edit', run: () => setText(text, 'replace') },
      { label: 'Ajouter à la suite', icon: 'plus', run: () => setText(text, 'append') },
    ] });
  };
  async function paste() {
    try {
      const t = cleanText(await navigator.clipboard.readText());
      if (!t.trim()) { toast('Le presse-papiers est vide.'); ta.focus(); return; }
      withMode(t); toast('Transcription collée');
    } catch {
      toast('Appuyez longuement dans la zone de texte, puis « Coller ».', 4200); ta.focus();
    }
  }
  async function importFile() {
    const f = await pickTextFile();
    if (!f) return;
    try { withMode(await readTextFile(f)); toast('Fichier importé'); } catch (err) { toast(err.message, 5000); }
  }

  async function create() {
    const cat = st.category;
    const t = (st.title || '').trim() || `${CATEGORIES.find((c) => c.id === cat).short} du ${new Date(st.date).toLocaleDateString('fr-FR')}`;
    const e = await S.createEntretien({ title: t, category: cat, folderId: st.folderId, date: st.date, templateId: st.templateId, transcript: cleanText(ta.value) });
    S.setSetting('lastCategory', cat);
    clearDraft();
    toast('Entretien créé');
    go('#/entretien/' + e.id);
  }

  const el = h('div', { class: 'view' },
    topbar({ back: () => go('#/'), backLabel: 'Accueil' }),
    h('div', { class: 'eyebrow', text: 'Nouvel entretien' }),
    h('h1', { class: 'page-title', text: 'Collez votre transcription' }),
    h('div', { class: 'rule' }),
    restored ? h('div', { class: 'banner' }, icon('info'), h('div', {}, h('div', { text: 'Votre brouillon a été conservé.' }), h('button', { text: 'Effacer le brouillon', onclick: async () => { if (await confirmDialog({ title: 'Effacer le brouillon ?', message: 'Le titre et le texte saisis seront effacés.', confirmLabel: 'Effacer', danger: true })) { clearDraft(); location.reload(); } } }))) : null,
    h('label', { class: 'lbl', text: 'Titre' }), title,
    h('label', { class: 'lbl', text: 'Catégorie' }), catBox,
    h('label', { class: 'lbl', text: 'Dossier' }), folderBtn,
    h('label', { class: 'lbl', text: 'Date' }), dateInp,
    h('label', { class: 'lbl', text: 'Trame du compte rendu' }), tplSel,
    h('div', { class: 'sec-head' }, h('h2', { text: 'Transcription' })),
    h('p', { class: 'hint', style: { marginTop: '-4px' }, text: 'Copiez la transcription depuis le Dictaphone d\'Apple, puis collez-la ici.' }),
    h('button', { class: 'btn primary bigpaste', onclick: paste }, icon('clipboard'), h('span', { text: 'Coller une transcription' })),
    h('button', { class: 'btn', style: { marginTop: '10px' }, onclick: importFile }, icon('upload'), h('span', { text: 'Importer un fichier texte (.txt)' })),
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
  const saver = debouncedSaver(async () => { await S.saveEntretien(e); saveState.textContent = 'Enregistré à ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); });
  const edit = () => { saveState.textContent = 'Modification…'; saver.trigger(); };
  const cleanups = [];

  // ----- en-tête -----
  // Titre sur plusieurs lignes si nécessaire (un champ à une seule ligne couperait les titres longs)
  const titleInp = h('textarea', { class: 'title-input', rows: '1', 'aria-label': 'Titre de l\'entretien', maxlength: '120', enterkeyhint: 'done' });
  titleInp.value = e.title;
  const fitTitle = () => { titleInp.style.height = 'auto'; titleInp.style.height = titleInp.scrollHeight + 'px'; };
  titleInp.addEventListener('input', () => { e.title = titleInp.value.replace(/\n/g, ' ') || 'Sans titre'; fitTitle(); edit(); });
  titleInp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); titleInp.blur(); } });
  requestAnimationFrame(fitTitle);
  const meta = h('div', { class: 'hint', style: { marginTop: 0 }, text: metaLine(e, folders) });

  // Le PDF est préparé dès l'ouverture du menu : Safari n'accepte la feuille de partage que très peu de temps après un toucher.
  const preparePdf = () => { const p = reportPdfFile(e, folders, tplName()); p.catch(() => {}); return p; };
  async function sharePdf(prepared) {
    try {
      const res = await shareOrDownload([await (prepared || reportPdfFile(e, folders, tplName()))], e.title);
      if (res === 'telechargement') toast('PDF enregistré');
    } catch (err) { toast('PDF impossible : ' + err.message, 5000); }
  }
  async function exportReport() {
    const text = reportText(e, folders, tplName());
    const prepared = preparePdf();
    actionSheet({ title: 'Exporter le compte rendu', actions: [
      { label: 'Partager le PDF', icon: 'share', run: () => sharePdf(prepared) },
      { label: 'Copier le texte', icon: 'copy', run: async () => toast((await copyText(text)) ? 'Compte rendu copié' : 'Copie impossible') },
      { label: 'Fichier texte (.txt)', icon: 'doc', run: () => { downloadText(safeName(e.title) + '-compte-rendu.txt', text); toast('Fichier créé'); } },
      { label: 'Imprimer…', icon: 'doc', run: () => printReport(e, folders, tplName()) },
    ] });
  }
  // Envoi par mail : la messagerie de l'appareil s'ouvre, l'utilisateur relit puis envoie lui-même.
  function mailSheet() {
    if (!S.hasReport(e)) return toast('Rédigez d\'abord le compte rendu.');
    const prepared = preparePdf();
    sheet({ title: 'Envoyer par mail', build(body, close) {
      const to = h('input', { class: 'field', type: 'email', multiple: true, inputmode: 'email', placeholder: 'destinataire@entreprise.fr', autocapitalize: 'none', autocorrect: 'off', autocomplete: 'off', 'aria-label': 'Destinataire' });
      const subj = h('input', { class: 'field', type: 'text', value: 'Compte rendu – ' + e.title, 'aria-label': 'Objet', maxlength: '200' });
      const msg = h('textarea', { class: 'textarea', rows: '9', 'aria-label': 'Message', style: { minHeight: '180px' } });
      msg.value = reportText(e, folders, tplName());
      const longNote = h('p', { class: 'hint', hidden: true });
      const check = () => { const n = mailtoHref({ to: to.value, subject: subj.value, body: msg.value }).length; longNote.hidden = n < 1800; longNote.textContent = 'Message long : si votre messagerie le coupe, utilisez « Partager le PDF » ou « Copier le message ».'; };
      for (const x of [to, subj, msg]) x.addEventListener('input', check);
      const open = () => {
        const bad = splitAddresses(to.value).filter((a) => !validEmail(a));
        if (bad.length) { toast('Adresse invalide : ' + bad[0], 4000); to.focus(); return; }
        openMailto(mailtoHref({ to: to.value, subject: subj.value, body: msg.value }));
        toast('Votre messagerie s\'ouvre : relisez puis envoyez.', 4500);
      };
      body.append(
        h('div', { class: 'banner warn', style: { marginTop: '0' } }, icon('shield'), h('div', { text: 'Envoyez les documents confidentiels uniquement depuis une messagerie professionnelle autorisée par Ade-ci. Dictaphone IA n\'envoie rien lui-même : votre messagerie s\'ouvre avec le message prêt, et rien ne part sans votre validation.' })),
        h('label', { class: 'lbl', text: 'Destinataire (facultatif ici, modifiable dans la messagerie)' }), to,
        h('label', { class: 'lbl', text: 'Objet' }), subj,
        h('label', { class: 'lbl', text: 'Message (relisez et modifiez avant l\'ouverture)' }), msg, longNote,
        h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn primary', onclick: open }, icon('share'), h('span', { text: 'Ouvrir ma messagerie' })),
          h('button', { class: 'btn', onclick: () => { close(); sharePdf(prepared); } }, icon('doc'), h('span', { text: 'Partager le PDF' })),
          h('button', { class: 'btn', onclick: async () => toast((await copyText(msg.value)) ? 'Message copié' : 'Copie impossible') }, icon('copy'), h('span', { text: 'Copier le message' })),
          h('button', { class: 'btn', text: 'Annuler', onclick: close })));
      check();
    } });
  }
  function menu() {
    actionSheet({ title: e.title, actions: [
      S.hasReport(e) ? { label: 'Envoyer le compte rendu par mail', icon: 'share', run: mailSheet } : null,
      S.hasReport(e) ? { label: 'Exporter le compte rendu', icon: 'share', run: exportReport } : null,
      S.hasTranscript(e) ? { label: 'Exporter la transcription (.txt)', icon: 'doc', run: () => downloadText(safeName(e.title) + '-transcription.txt', S.transcriptOf(e)) } : null,
      { label: 'Supprimer l\'entretien', icon: 'trash', danger: true, run: deleteIt },
    ].filter(Boolean) });
  }
  async function deleteIt() {
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
  function transcriptTab() {
    if (e.transcript === null && !S.hasTranscript(e)) { /* aucune transcription : le champ est simplement vide */ }
    const ta = h('textarea', { class: 'textarea', style: { minHeight: '50dvh' }, spellcheck: 'false', autocorrect: 'off', 'aria-label': 'Transcription', placeholder: 'Aucune transcription. Appuyez sur « Coller » ou « Importer ».' });
    ta.value = S.transcriptOf(e);
    const stats = h('div', { class: 'stats' });
    let undo = null;
    const upd = () => { const w = S.wordCount(ta.value); stats.textContent = w ? `${w} mot${w > 1 ? 's' : ''} · ${ta.value.length} caractères` : ''; };
    const commit = (text, keepUndo = true) => { if (keepUndo) undo = ta.value; ta.value = text; e.transcript = text; upd(); edit(); };
    ta.addEventListener('input', () => { e.transcript = ta.value; upd(); edit(); });
    upd();
    const withMode = (text) => {
      if (!ta.value.trim()) return commit(text);
      actionSheet({ title: 'Un texte est déjà présent', actions: [
        { label: 'Remplacer le texte actuel', icon: 'edit', run: () => commit(text) },
        { label: 'Ajouter à la suite', icon: 'plus', run: () => commit(ta.value.replace(/\s+$/, '') + '\n\n' + text) },
      ] });
    };
    const paste = async () => {
      try { const t = cleanText(await navigator.clipboard.readText()); if (!t.trim()) return toast('Le presse-papiers est vide.'); withMode(t); toast('Transcription collée'); }
      catch { toast('Appuyez longuement dans la zone de texte, puis « Coller ».', 4200); ta.focus(); }
    };
    const imp = async () => { const f = await pickTextFile(); if (!f) return; try { withMode(await readTextFile(f)); toast('Fichier importé'); } catch (err) { toast(err.message, 5000); } };
    const fix = () => sheet({ title: 'Corriger la transcription', build(body, close) {
      const find = h('input', { class: 'field', placeholder: 'Mot ou expression erronée', autocapitalize: 'none', autocorrect: 'off' });
      const rep = h('input', { class: 'field', placeholder: 'Remplacer par', autocapitalize: 'none', autocorrect: 'off' });
      const doReplace = () => {
        const f = find.value; if (!f) return find.focus();
        const parts = ta.value.split(f); const n = parts.length - 1;
        if (!n) return toast('Aucune occurrence trouvée.');
        commit(parts.join(rep.value)); toast(`${n} remplacement${n > 1 ? 's' : ''}`); close();
      };
      const vocab = S.getVocab();
      body.append(
        h('label', { class: 'lbl', text: 'Rechercher' }), find, h('label', { class: 'lbl', text: 'Remplacer par' }), rep,
        h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn primary', text: 'Tout remplacer', onclick: doReplace }),
          h('button', { class: 'btn', onclick: () => { const r = S.applyVocab(ta.value, vocab); if (!r.count) return toast('Aucune correction à appliquer.'); commit(r.text); toast(`${r.count} correction${r.count > 1 ? 's' : ''} du vocabulaire appliquée${r.count > 1 ? 's' : ''}`); close(); } }, icon('sparkle'), h('span', { text: `Appliquer mon vocabulaire (${vocab.length})` })),
          undo !== null ? h('button', { class: 'btn', text: 'Annuler la dernière correction', onclick: () => { const cur = ta.value; ta.value = undo; e.transcript = undo; undo = cur; upd(); edit(); toast('Correction annulée'); close(); } }) : null,
          h('button', { class: 'btn', text: 'Fermer', onclick: close })));
    } });
    return h('div', {},
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small primary', onclick: paste }, icon('clipboard'), h('span', { text: 'Coller' })),
        h('button', { class: 'btn small', onclick: imp }, icon('upload'), h('span', { text: 'Importer' })),
        h('button', { class: 'btn small', onclick: fix }, icon('edit'), h('span', { text: 'Corriger' }))),
      h('div', { style: { height: '12px' } }), ta, stats);
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
        h('button', { class: 'btn', onclick: () => (S.hasReport(e) ? exportReport() : toast('Rédigez d\'abord le compte rendu.')) }, icon('share'), h('span', { text: 'Exporter' }))),
        h('button', { class: 'btn primary', style: { marginTop: '10px' }, onclick: mailSheet }, icon('share'), h('span', { text: 'Envoyer par mail' })));
    }
    renderBody();
    return h('div', {}, h('label', { class: 'lbl', style: { marginTop: 0 }, text: 'Trame' }), tplSel, h('div', { style: { height: '14px' } }), ia, h('div', { style: { height: '16px' } }), box);
  }

  // ----- onglet Infos -----
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
      for (const c of CATEGORIES) catBox.append(h('button', { class: e.category === c.id ? 'on' : '', onclick: () => { if (e.category !== c.id) { e.category = c.id; e.folderId = null; edit(); upd(); renderCats(); } } },
        h('div', { class: 'tile', style: { width: '40px', height: '40px' } }, catIcon(c.id)), h('span', { style: { fontWeight: 600, color: 'var(--ink)' }, text: c.label })));
    }
    renderCats(); upd();
    const dateInp = h('input', { class: 'field', type: 'datetime-local', value: toLocalInput(e.date), 'aria-label': 'Date' });
    dateInp.addEventListener('change', () => { e.date = fromLocalInput(dateInp.value); edit(); upd(); });
    const srcLabel = { texte: 'Texte collé ou importé', micro: 'Enregistrement (laboratoire)', import: 'Audio importé (laboratoire)' }[e.source] || 'Texte';
    const kv = (k, v) => h('div', { class: 'kv' }, h('span', { text: k }), h('span', { text: v }));
    return h('div', {},
      h('label', { class: 'lbl', style: { marginTop: 0 }, text: 'Catégorie' }), catBox,
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
