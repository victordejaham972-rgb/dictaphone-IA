// Couche de données : entretiens, dossiers, trames, vocabulaire. Tout reste dans ce navigateur (IndexedDB / localStorage).
// Compatibilité : un « entretien » est un enregistrement de l'espace « sessions » déjà utilisé par les anciennes versions.
// Les anciens enregistrements ne sont JAMAIS modifiés à la lecture ; les nouveaux champs n'apparaissent qu'à la première sauvegarde.
import * as DB from '../db.js';
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

export async function listEntretiens() { return (await DB.listSessions()).map(normalize); }
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
  });
  await DB.putSession(e);
  return e;
}
export const removeEntretien = (id) => DB.deleteSession(id);

// ---------- Dossiers ----------
export const listFolders = () => DB.listFolders();
export async function createFolder({ category, parentId = null, name }) {
  const f = { id: uid('d'), category, parentId, name: name.trim(), createdAt: Date.now(), lastOpened: 0 };
  await DB.putFolder(f);
  return f;
}
export async function renameFolder(f, name) { f.name = name.trim(); await DB.putFolder(f); }
export async function moveFolder(f, parentId) { f.parentId = parentId; await DB.putFolder(f); }
export async function touchFolder(f) { f.lastOpened = Date.now(); await DB.putFolder(f); }
// Suppression NON destructive : le contenu du dossier est remonté dans le dossier parent.
export async function deleteFolder(f, folders, entretiens) {
  for (const sub of folders.filter((x) => x.parentId === f.id)) { sub.parentId = f.parentId; await DB.putFolder(sub); }
  for (const e of entretiens.filter((x) => x.folderId === f.id)) { e.folderId = f.parentId; await saveEntretien(e); }
  await DB.deleteFolderRecord(f.id);
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
export async function ensureDefaults() {
  const have = new Set((await DB.listTemplates()).map((t) => t.id));
  for (const d of DEFAULT_TEMPLATES) if (!have.has(d.id)) await DB.putTemplate(withIds(clone(d)));
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
export const sectionsFromTemplate = (t) => t.sections.map((s) => ({ id: uid('r'), title: s.title, content: '' }));

// ---------- Vocabulaire de correction ----------
const VOCAB_KEY = 'dia_vocab';
export function getVocab() {
  try { const v = JSON.parse(localStorage.getItem(VOCAB_KEY)); if (Array.isArray(v)) return v; } catch {}
  return clone(DEFAULT_VOCAB);
}
export function setVocab(list) { try { localStorage.setItem(VOCAB_KEY, JSON.stringify(list)); } catch {} }
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
    if (hasTranscript(e) && !hasReport(e)) b.toWrite++;
  }
  return by;
}
