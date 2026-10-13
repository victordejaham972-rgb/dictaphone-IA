// Couche de données : entretiens, dossiers, trames, vocabulaire. Tout reste dans ce navigateur (IndexedDB / localStorage).
// Compatibilité : un « entretien » est un enregistrement de l'espace « sessions » déjà utilisé par les anciennes versions.
// Les anciens enregistrements ne sont JAMAIS modifiés à la lecture ; les nouveaux champs n'apparaissent qu'à la première sauvegarde.
import * as DB from '../db.js';
import { kv } from './vault.js';
import { DEFAULT_TEMPLATES, DEFAULT_VOCAB, catInfo } from './defaults.js';

export const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------- Entretiens ----------
export function normalize(s) {
  const n = { ...s };
  n.title = s.title ?? s.name ?? 'Sans titre';
  n.category = s.category ?? null;
  n.folderId = s.folderId ?? null;
  n.date = s.date ?? s.createdAt ?? Date.now();
  n.templateId = s.templateId ?? null;
  n.who = typeof s.who === 'string' ? s.who : '';              // nom du client / organisateur / équipe
  n.subject = typeof s.subject === 'string' ? s.subject : '';  // sujet principal
  n.titleAuto = !!s.titleAuto;                                  // le titre suit automatiquement ces informations
  n.transcriptHistory = Array.isArray(s.transcriptHistory) ? s.transcriptHistory : [];
  n.reportHistory = Array.isArray(s.reportHistory) ? s.reportHistory : [];
  n.transcript = typeof s.transcript === 'string' ? s.transcript : null;
  n.reportSections = Array.isArray(s.reportSections) ? s.reportSections : null;
  n.summary = s.summary || '';
  n.segments = s.segments || [];
  n.nChunks = s.nChunks || 0;
  n.durationSec = s.durationSec || 0;
  n.createdAt = s.createdAt ?? n.date;
  n.updatedAt = s.updatedAt ?? n.createdAt;
  n.lastOpened = s.lastOpened ?? 0;
  n.protect = s.protect && typeof s.protect === 'object' ? s.protect : null;     // fiche d'identité et décisions de la pseudonymisation (local, jamais exporté sans mot de passe)
  // Transcription ORIGINALE : figée à l'import, jamais réécrite par une correction ou une protection (n.transcript = version corrigée).
  n.original = typeof s.original === 'string' ? s.original : null;
  n.originalPresumed = !!s.originalPresumed;                                       // ancienne fiche : original = texte présent à la première ouverture
  n.originalHistory = Array.isArray(s.originalHistory) ? s.originalHistory : [];   // anciens originaux remplacés par un nouvel import
  n.deletedAt = Number.isFinite(s.deletedAt) ? s.deletedAt : 0;                    // corbeille : fiche supprimée (restaurable)
  n.trashGroup = typeof s.trashGroup === 'string' ? s.trashGroup : '';
  n.trashed = s.trashed && typeof s.trashed === 'object' ? s.trashed : {};         // éléments retirés de la fiche : { document, audio, transcript }
  return n;
}
// ---------- Titre : « Nom — Sujet — jj/mm/aaaa » ----------
export const fmtDay = (ms) => { const d = new Date(ms); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); };
export function composeTitle(category, who, subject, dateMs) {
  const info = catInfo(category);
  const parts = [(who || '').trim() || (info ? info.fallback : 'Entretien'), (subject || '').trim(), fmtDay(dateMs || Date.now())].filter(Boolean);
  return parts.join(' — ');
}

// ---------- Historique des versions (aucune perte lors d'un remplacement) ----------
const HIST_MAX = 5;
export function pushHistory(list, entry) {
  if (!entry || !String(entry.text || '').trim()) return list || [];
  return [{ ...entry, date: Date.now() }, ...(list || [])].slice(0, HIST_MAX);
}

export const transcriptOf = (e) => (e.transcript !== null ? e.transcript : e.segments.map((g) => g.text).filter(Boolean).join('\n'));
export const hasTranscript = (e) => transcriptOf(e).trim().length > 0;
export function reportOf(e) {
  if (e.reportSections) return e.reportSections;
  if (e.summary) return [{ id: 'legacy', title: 'Compte rendu', content: e.summary }];
  return [];
}
export const hasReport = (e) => reportOf(e).some((r) => (r.content || '').trim());
export const hasAudio = (e) => e.nChunks > 0;
export const wordCount = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

// Par défaut : fiches actives seulement (la corbeille est exclue de la bibliothèque, de l'accueil et des statistiques).
export async function listEntretiens({ deleted = false, all = false } = {}) {
  const l = (await DB.listSessions()).map(normalize);
  return all ? l : l.filter((e) => !!e.deletedAt === deleted);
}
export async function getEntretien(id) { const s = await DB.getSession(id); return s ? normalize(s) : null; }
export async function saveEntretien(e) {
  e.updatedAt = Date.now();
  e.name = e.title; // les anciennes pages lisent « name »
  await DB.putSession(e);
  return e;
}
export async function createEntretien({ title, category, folderId = null, date, templateId = null, transcript = '', who = '', subject = '', titleAuto = false }) {
  const now = Date.now();
  const e = normalize({
    id: uid('e'), name: title, title, category, folderId, date: date || now, templateId, transcript, who, subject, titleAuto,
    reportSections: null, source: 'texte', createdAt: now, updatedAt: now,
    nChunks: 0, durationSec: 0, doneChunks: 0, segments: [], summary: '', bookmarks: [], hasOriginal: false,
    original: String(transcript || '').trim() ? transcript : null,
  });
  await DB.putSession(e);
  return e;
}
// Suppression DÉFINITIVE : réservée à la corbeille (purge). Les écrans appellent trashEntretien.
export const removeEntretien = (id) => DB.deleteSession(id);

// ---------- Original immuable ----------
// Fige l'original d'une fiche qui n'en a pas encore. Une fois posé, il n'est plus jamais modifié (sauf par un NOUVEL import qui le remplace
// explicitement : l'ancien est alors conservé dans originalHistory).
export function ensureOriginal(e) {
  if (e.original === null && S_hasText(e)) { e.original = transcriptOf(e); e.originalPresumed = true; return true; }
  return false;
}
const S_hasText = (e) => transcriptOf(e).trim().length > 0;
export function setOriginalFromImport(e, text, { replace = false, reason = 'import' } = {}) {
  if (e.original === null || !String(e.original).trim()) { e.original = text; e.originalPresumed = false; return; }
  if (replace) { e.originalHistory = [{ text: e.original, date: Date.now(), reason }, ...(e.originalHistory || [])].slice(0, 10); e.original = text; e.originalPresumed = false; }
  else e.original = e.original.replace(/\s+$/, '') + '\n\n' + text;               // « ajouter à la suite » : le nouveau texte fait partie de la source
}
// Étape de la fiche dans le parcours (calculée, aucune migration) : importer, corriger, trame, chatgpt, compte-rendu, termine
export function stepOf(e) {
  if (!hasTranscript(e)) return 'importer';
  if (!(e.protect && (e.protect.visited || e.protect.copiedAt))) return 'corriger';        // l'étape 2 est « faite » dès qu'elle a été ouverte ; la revue se fait à l'étape 4
  if (!e.templateId) return 'trame';
  if (!hasReport(e)) return (e.protect && e.protect.copiedAt) ? 'compte-rendu' : 'chatgpt';
  return 'termine';
}

// ---------- Corbeille (suppression réversible) ----------
// Rien n'est supprimé au premier geste : un marqueur « deletedAt » masque l'élément partout. La suppression définitive (purge) est une
// action séparée ; elle laisse une « pierre tombale » pour qu'une ancienne sauvegarde ne ressuscite pas silencieusement l'élément.
const TOMB_KEY = 'dia_tombstones';
export function getTombstones() { try { const v = JSON.parse(localStorage.getItem(TOMB_KEY)); return Array.isArray(v) ? v : []; } catch { return []; } }
export function addTombstones(list) {
  try {
    const cur = getTombstones(); const have = new Set(cur.map((t) => t.id));
    for (const t of list) if (t && t.id && !have.has(t.id)) { cur.push({ id: t.id, kind: t.kind || 'fiche', at: t.at || Date.now() }); have.add(t.id); }
    localStorage.setItem(TOMB_KEY, JSON.stringify(cur.slice(-5000)));
  } catch {}
}
export async function trashEntretien(e, { group = '' } = {}) {
  if (e.deletedAt) return e;
  e.deletedAt = Date.now(); e.trashGroup = group || '';
  return saveEntretien(e);
}
export async function restoreEntretien(e) {
  const folders = await listFolders({ all: true });
  const f = e.folderId ? folders.find((x) => x.id === e.folderId) : null;
  if (e.folderId && (!f || f.deletedAt)) e.folderId = null;                        // son dossier a été supprimé : retour à la racine
  e.deletedAt = 0; e.trashGroup = '';
  return saveEntretien(e);
}
export async function purgeEntretien(e) {
  await DB.deleteSession(e.id);
  addTombstones([{ id: e.id, kind: 'fiche' }]);
}
// Éléments retirés d'une fiche (la fiche reste active)
export async function trashPart(e, part, payload = {}) {
  e.trashed = { ...(e.trashed || {}), [part]: { at: Date.now(), ...payload } };
  if (part === 'transcript') e.transcript = '';                                    // l'ORIGINAL (e.original) n'est jamais touché
  return saveEntretien(e);
}
export async function restorePart(e, part, { mode = 'replace' } = {}) {
  const t = (e.trashed || {})[part]; if (!t) return e;
  if (part === 'transcript') {
    const cur = transcriptOf(e);
    e.transcript = mode === 'append' && cur.trim() ? cur.replace(/\s+$/, '') + '\n\n' + t.text : t.text;
  }
  const next = { ...e.trashed }; delete next[part]; e.trashed = next;
  return saveEntretien(e);
}
export async function purgePart(e, part) {
  const t = (e.trashed || {})[part]; if (!t) return e;
  if (part === 'document') { try { await DB.rawDeleteOriginal(e.id); } catch {} e.hasOriginal = false; }
  if (part === 'audio') {
    for (let i = 0; i < (t.nChunks || e.nChunks || 0); i++) { try { await DB.deleteChunk(e.id, i); } catch {} }
    e.nChunks = 0; e.doneChunks = 0; e.durationSec = 0; e.hadAudio = false;
  }
  const next = { ...e.trashed }; delete next[part]; e.trashed = next;
  return saveEntretien(e);
}

// ---------- Dossiers ----------
export async function listFolders({ deleted = false, all = false } = {}) {
  const l = await DB.listFolders();
  return all ? l : l.filter((f) => !!f.deletedAt === deleted);
}
export async function createFolder({ category, parentId = null, name }) {
  const f = { id: uid('d'), category, parentId, name: name.trim(), createdAt: Date.now(), lastOpened: 0 };
  await DB.putFolder(f);
  return f;
}
export async function renameFolder(f, name) { f.name = name.trim(); await DB.putFolder(f); }
export async function moveFolder(f, parentId) { f.parentId = parentId; await DB.putFolder(f); }
export async function touchFolder(f) { f.lastOpened = Date.now(); await DB.putFolder(f); }
// Suppression d'un dossier SEUL (corbeille) : le contenu est remonté dans le dossier parent, jamais supprimé. Les liens d'origine sont
// mémorisés (formerChildren) : restaurer le dossier remet son contenu dedans, si rien n'a bougé entre-temps.
export async function trashFolderOnly(f, folders, entretiens) {
  const subs = folders.filter((x) => x.parentId === f.id && !x.deletedAt), fiches = entretiens.filter((x) => x.folderId === f.id && !x.deletedAt);
  f.formerChildren = { folders: subs.map((x) => x.id), sessions: fiches.map((x) => x.id) };
  for (const sub of subs) { sub.parentId = f.parentId; await DB.putFolder(sub); }
  for (const e of fiches) { e.folderId = f.parentId; await saveEntretien(e); }
  f.deletedAt = Date.now(); f.trashGroup = '';
  await DB.putFolder(f);
}
// Suppression d'un dossier ET de tout son contenu (action explicite) : tout part dans la corbeille sous un même groupe, restaurable d'un geste.
export async function trashFolderTree(f, folders, entretiens) {
  const group = uid('g'); const ids = descendantIds(f.id, folders);
  let nF = 0, nS = 0;
  for (const x of folders) if (ids.has(x.id) && !x.deletedAt) { x.deletedAt = Date.now(); x.trashGroup = group; await DB.putFolder(x); nF++; }
  for (const e of entretiens) if (e.folderId && ids.has(e.folderId) && !e.deletedAt) { await trashEntretien(e, { group }); nS++; }
  return { group, folders: nF, fiches: nS };
}
export function folderContents(f, folders, entretiens) {
  const ids = descendantIds(f.id, folders);
  const subs = folders.filter((x) => ids.has(x.id) && x.id !== f.id);
  const fiches = entretiens.filter((e) => e.folderId && ids.has(e.folderId));
  return { subs, fiches, direct: entretiens.filter((e) => e.folderId === f.id), directSubs: folders.filter((x) => x.parentId === f.id) };
}
export async function restoreFolder(f) {
  const [folders, fiches] = [await listFolders({ all: true }), await listEntretiens({ all: true })];
  if (f.trashGroup) {                                                           // restauration d'un groupe : dossier(s) et fiches supprimés ensemble
    for (const x of folders) if (x.trashGroup === f.trashGroup) { x.deletedAt = 0; x.trashGroup = ''; await DB.putFolder(x); }
    for (const e of fiches) if (e.trashGroup === f.trashGroup) { e.deletedAt = 0; e.trashGroup = ''; await saveEntretien(e); }
    return;
  }
  const parent = f.parentId ? folders.find((x) => x.id === f.parentId) : null;
  if (f.parentId && (!parent || parent.deletedAt)) f.parentId = null;
  const fc = f.formerChildren || { folders: [], sessions: [] };
  for (const sub of folders) if (fc.folders.includes(sub.id) && !sub.deletedAt && sub.parentId === f.parentId) { sub.parentId = f.id; await DB.putFolder(sub); }
  for (const e of fiches) if (fc.sessions.includes(e.id) && !e.deletedAt && e.folderId === f.parentId) { e.folderId = f.id; await saveEntretien(e); }
  f.deletedAt = 0; delete f.formerChildren;
  await DB.putFolder(f);
}
export async function purgeFolder(f) {
  const [folders, fiches] = [await listFolders({ all: true }), await listEntretiens({ all: true })];
  const tomb = [];
  if (f.trashGroup) {
    for (const e of fiches) if (e.trashGroup === f.trashGroup) { await DB.deleteSession(e.id); tomb.push({ id: e.id, kind: 'fiche' }); }
    for (const x of folders) if (x.trashGroup === f.trashGroup) { await DB.deleteFolderRecord(x.id); tomb.push({ id: x.id, kind: 'dossier' }); }
  } else { await DB.deleteFolderRecord(f.id); tomb.push({ id: f.id, kind: 'dossier' }); }
  addTombstones(tomb);
}
// Contenu de la corbeille : fiches, dossiers (seuls ou en groupe), et éléments retirés de fiches actives.
export async function listTrash() {
  const [fiches, folders] = [await listEntretiens({ all: true }), await listFolders({ all: true })];
  const out = []; const groups = new Map();
  for (const f of folders.filter((x) => x.deletedAt)) {
    if (f.trashGroup) { const g = groups.get(f.trashGroup) || { kind: 'groupe', id: f.trashGroup, at: f.deletedAt, folders: [], fiches: [] }; g.folders.push(f); groups.set(f.trashGroup, g); }
    else out.push({ kind: 'dossier', id: f.id, at: f.deletedAt, folder: f, title: f.name });
  }
  for (const e of fiches.filter((x) => x.deletedAt)) {
    const g = e.trashGroup && groups.get(e.trashGroup);
    if (g) g.fiches.push(e); else out.push({ kind: 'fiche', id: e.id, at: e.deletedAt, e, title: e.title });
  }
  for (const g of groups.values()) {
    const ids = new Set(g.folders.map((x) => x.id));
    g.root = g.folders.find((x) => !ids.has(x.parentId)) || g.folders[0];
    g.title = g.root ? g.root.name : 'Dossier'; out.push(g);
  }
  for (const e of fiches.filter((x) => !x.deletedAt)) {
    const t = e.trashed || {};
    if (t.document) out.push({ kind: 'document', id: e.id + ':document', at: t.document.at, e, title: (t.document.name || 'Document') + ' — ' + e.title });
    if (t.audio) out.push({ kind: 'audio', id: e.id + ':audio', at: t.audio.at, e, title: 'Audio — ' + e.title });
    if (t.transcript) out.push({ kind: 'transcription', id: e.id + ':transcript', at: t.transcript.at, e, title: 'Transcription corrigée — ' + e.title });
  }
  return out.sort((a, b) => b.at - a.at);
}
export function folderPath(id, folders) {
  const path = [];
  let cur = folders.find((f) => f.id === id);
  while (cur && path.length < 30) { path.unshift(cur); cur = folders.find((f) => f.id === cur.parentId); }
  return path;
}
export function descendantIds(id, folders) {
  const out = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const f of folders) if (!out.has(f.id) && out.has(f.parentId)) { out.add(f.id); grew = true; } }
  return out;
}

// ---------- Trames ----------
// Trames masquées de la liste par défaut : simple préférence d'affichage, réversible. Une trame masquée n'est ni supprimée ni modifiée,
// et les fiches qui l'utilisent la conservent (elle reste visible dans leur propre écran).
const HIDDEN_BY_DEFAULT = ['tpl-clients', 'tpl-clients-detail', 'tpl-premier-rdv', 'tpl-suivi-patrimonial'];
const OLD_CLIENT_TEMPLATE_NAME = 'Entretien client (ancienne trame, 9 rubriques)';
export function hiddenTemplateIds() { const s = getSettings(); return Array.isArray(s.hiddenTemplates) ? s.hiddenTemplates.slice() : HIDDEN_BY_DEFAULT.slice(); }
export const isTemplateHidden = (id) => hiddenTemplateIds().includes(id);
export function setTemplateHidden(id, hidden) { const cur = new Set(hiddenTemplateIds()); if (hidden) cur.add(id); else cur.delete(id); setSetting('hiddenTemplates', [...cur]); }
export const hasExplicitHidden = () => Array.isArray(getSettings().hiddenTemplates);
// trames affichées dans les listes de choix ; keepIds : trames à garder visibles quoi qu'il arrive (celle de la fiche en cours)
export const visibleTemplates = (list, keepIds = []) => list.filter((t) => !isTemplateHidden(t.id) || keepIds.includes(t.id));
export async function ensureDefaults() {
  const have = new Set((await DB.listTemplates()).map((t) => t.id));
  // Consignes de la trame 0.8.2 remplacées par des consignes plus synthétiques : seulement si elles n'ont pas été modifiées par l'utilisateur
  if (have.has('tpl-clients-v2')) {
    const PREV = {
      'Patrimoine': 'Vue d\'ensemble du patrimoine, par grandes familles. Le détail va dans les sous-rubriques ci-dessous.',
      'Financier': 'Placements financiers : enveloppes (PEA, assurance-vie, CTO, PER…), montants, valorisations, établissements, supports.',
      'Immobilier': 'Biens immobiliers : nature, valeur, crédit en cours (capital restant dû, taux, mensualité, échéance), loyers, SCPI.',
      'Professionnel / épargne salariale et retraite': 'Entreprise ou activité, détention de titres, épargne salariale (PEE, PERCOL), retraite (PER, régimes).',
    };
    const cur = (await DB.listTemplates()).find((t) => t.id === 'tpl-clients-v2');
    const dflt = DEFAULT_TEMPLATES.find((t) => t.id === 'tpl-clients-v2');
    if (cur && dflt) {
      let changed = false;
      for (const s of cur.sections || []) {
        const d = dflt.sections.find((x) => x.title === s.title);
        if (d && PREV[s.title] && s.instruction === PREV[s.title] && d.instruction !== s.instruction) { s.instruction = d.instruction; changed = true; }
      }
      if (changed) await DB.putTemplate(cur);
    }
  }
  const addedV2 = !have.has('tpl-clients-v2');
  for (const d of DEFAULT_TEMPLATES) if (!have.has(d.id)) await DB.putTemplate(withIds(clone(d)));
  // Migration unique : la nouvelle trame « Entretien client » (six rubriques) devient la trame par défaut ; l'ancienne trame à neuf rubriques
  // est renommée et masquée, jamais supprimée ni modifiée dans ses rubriques. Les fiches existantes gardent leur trame et leur contenu.
  if (addedV2 && have.has('tpl-clients')) {
    const all = await DB.listTemplates();
    const old = all.find((t) => t.id === 'tpl-clients'), v2 = all.find((t) => t.id === 'tpl-clients-v2');
    if (old) {
      if (old.name === 'Entretien client') old.name = OLD_CLIENT_TEMPLATE_NAME;
      const otherDefault = all.some((t) => t.category === 'clients' && t.isDefault && t.id !== 'tpl-clients' && t.id !== 'tpl-clients-v2');
      old.isDefault = false; await DB.putTemplate(old);
      if (v2 && otherDefault) { v2.isDefault = false; await DB.putTemplate(v2); }
      setTemplateHidden('tpl-clients', true);
    }
  }
}
const withIds = (t) => { t.sections = t.sections.map((s) => ({ id: s.id || uid('r'), ...s })); t.updatedAt = Date.now(); return t; };
export const newSection = (title = '', instruction = '') => ({ id: uid('r'), title, instruction });
export async function listTemplates() {
  return (await DB.listTemplates()).sort((a, b) => (b.builtin ? 1 : 0) - (a.builtin ? 1 : 0) || a.name.localeCompare(b.name, 'fr'));
}
export async function saveTemplate(t) { t.updatedAt = Date.now(); await DB.putTemplate(t); }
export async function duplicateTemplate(t) {
  const c = clone(t);
  c.id = uid('t'); c.builtin = false; c.isDefault = false; c.name = t.name + ' (copie)';
  c.sections = c.sections.map((s) => ({ ...s, id: uid('r') }));
  await saveTemplate(c);
  return c;
}
export const deleteTemplate = (id) => DB.deleteTemplateRecord(id);
export async function resetTemplate(id) {
  const d = DEFAULT_TEMPLATES.find((x) => x.id === id);
  if (!d) return null;
  const t = withIds(clone(d));
  await DB.putTemplate(t);
  return t;
}
export async function setDefaultTemplate(id) {
  const all = await listTemplates();
  const t = all.find((x) => x.id === id);
  if (!t) return;
  for (const o of all) if (o.category === t.category && o.isDefault !== (o.id === id)) { o.isDefault = o.id === id; await DB.putTemplate(o); }
}
export const defaultTemplateFor = (templates, category) =>
  templates.find((t) => t.category === category && t.isDefault) || templates.find((t) => t.category === category) || null;

// Plan d'un compte rendu à partir d'une trame (rubriques vides, à rédiger)
export const sectionsFromTemplate = (t) => t.sections.map((s) => ({ id: uid('r'), title: s.title, content: '', ...(s.level === 2 ? { level: 2 } : {}) }));

// ---------- Vocabulaire de correction ----------
const VOCAB_KEY = 'dia_vocab';
export function getVocab() {
  try { const v = JSON.parse(kv.get(VOCAB_KEY)); if (Array.isArray(v)) return v; } catch {}
  return clone(DEFAULT_VOCAB);
}
export function setVocab(list) { try { kv.set(VOCAB_KEY, JSON.stringify(list)); } catch {} }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MAX_VOCAB = 2000;
// Une correction est refusée si elle risque de toucher un montant, une date ou un nom : pas de chiffre dans l'erreur à corriger,
// au moins 2 caractères, aucune différence autre que l'écriture, et pas de doublon.
export function checkVocabEntry(from, to, list = []) {
  const f = (from || '').trim(), t = (to || '').trim();
  if (f.length < 2) return 'L\'erreur à corriger doit faire au moins 2 caractères.';
  if (!t) return 'Indiquez l\'écriture correcte.';
  if (f.length > 100 || t.length > 100) return 'Texte trop long (100 caractères au maximum).';
  if (/\d/.test(f)) return 'Une correction ne peut pas contenir de chiffre : elle risquerait de modifier un montant ou une date.';
  if (f === t) return 'L\'erreur et l\'écriture correcte sont identiques.';
  if (list.length >= MAX_VOCAB) return 'Nombre maximal de corrections atteint.';
  return '';
}
// Remplacement manuel de mots entiers (utilisé par « Corriger ») : la casse est ignorée sauf demande contraire.
export function replaceWords(text, from, to, { cs = false } = {}) {
  const f = (from || '').trim();
  if (!f) return { text, count: 0 };
  let count = 0;
  const re = new RegExp('(^|[^\\p{L}\\p{N}])(' + esc(f).replace(/\s+/g, '\\s+') + ')(?![\\p{L}\\p{N}])', cs ? 'gu' : 'giu');
  const out = text.replace(re, (m, pre) => { count++; return pre + to; });
  return { text: out, count };
}
// Ajoute ou met à jour une correction du vocabulaire. Renvoie un message d'erreur, ou '' si c'est enregistré.
export function addVocabEntry(from, to, cs = false) {
  const list = getVocab();
  const dup = list.find((v) => v.from.trim().toLowerCase() === (from || '').trim().toLowerCase());
  const err = checkVocabEntry(from, to, list);
  if (err) return err;
  if (dup) { dup.to = to.trim(); if (cs) dup.cs = true; else delete dup.cs; }
  else { const e = { from: from.trim(), to: to.trim() }; if (cs) e.cs = true; list.unshift(e); }
  setVocab(list);
  return '';
}
// Remplace des mots ENTIERS (jamais une partie de mot, jamais collés à un chiffre). Sécurités :
// - une correction « casse exacte » (cs) ne s'applique que si la casse est identique ;
// - sinon, un mot qui commence par une majuscule au milieu d'une phrase est considéré comme un nom propre et laissé tel quel.
// Renvoie le texte corrigé, le nombre de remplacements et le nombre d'occurrences ignorées par prudence.
export function applyVocab(text, vocab) {
  let count = 0, skipped = 0;
  let out = text;
  const SENT = /(^|[.!?…:;\n"«(\u2014\u2013-])\s*$/;
  for (const { from, to, cs } of vocab) {
    if (!from || !from.trim() || !to || /\d/.test(from)) continue;
    const re = new RegExp('(^|[^\\p{L}\\p{N}])(' + esc(from.trim()).replace(/\s+/g, '\\s+') + ')(?![\\p{L}\\p{N}])', cs ? 'gu' : 'giu');
    const fromHasUpper = /\p{Lu}/u.test(from);
    out = out.replace(re, (m, pre, word, offset, whole) => {
      const start = offset + pre.length;
      if (!cs && !fromHasUpper && /^\p{Lu}/u.test(word) && start > 0 && !SENT.test(whole.slice(Math.max(0, start - 3), start))) { skipped++; return m; }
      count++; return pre + to;
    });
  }
  return { text: out, count, skipped };
}
// ---------- Réglages simples ----------
const SET_KEY = 'dia_settings';
export function getSettings() { try { return JSON.parse(localStorage.getItem(SET_KEY)) || {}; } catch { return {}; } }
export function setSetting(k, v) { const s = getSettings(); s[k] = v; try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch {} }

// ---------- Statistiques (accueil) ----------
export function statsFor(entretiens) {
  const by = {};
  for (const e of entretiens) {
    const k = e.category || 'none';
    const b = (by[k] ||= { total: 0, toWrite: 0 });
    b.total++;
    if (stepOf(e) !== 'termine') b.toWrite++;
  }
  return by;
}
