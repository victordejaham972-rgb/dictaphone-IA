// Sauvegarde et restauration. Une sauvegarde contient des données CONFIDENTIELLES (transcriptions, comptes rendus).
// Protection proposée : chiffrement AES-256-GCM avec un mot de passe (Web Crypto, local). Sans mot de passe, le fichier est lisible par tous.
// La restauration n'écrase JAMAIS rien : un élément déjà présent est ignoré, ou ajouté sous forme de copie.
import * as DB from '../db.js';
import { CATEGORIES } from './defaults.js';
import { listEntretiens, listFolders, listTemplates, uid, getVocab, setVocab, hasAudio } from './store.js';

export const FORMAT = 'dictaphone-ia-sauvegarde';
export const FORMAT_ENC = 'dictaphone-ia-sauvegarde-chiffree';
const VERSION = 2;
const ITER = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const LAST_KEY = 'dia_last_backup';
export const lastBackupAt = () => { try { return +localStorage.getItem(LAST_KEY) || 0; } catch { return 0; } };

// ---------- Création ----------
export async function buildBackup(appVersion) {
  const [sessions, folders, templates] = await Promise.all([listEntretiens(), listFolders(), listTemplates()]);
  return {
    format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), appVersion,
    note: 'Les fichiers audio ne sont pas inclus : exportez-les depuis la fiche de chaque entretien.',
    folders, templates, vocab: getVocab(),
    sessions: sessions.map((s) => ({ ...s, hadAudio: hasAudio(s) || !!s.hadAudio })),
  };
}

async function deriveKey(pw, salt, iter) {
  const km = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptText(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITER);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return JSON.stringify({ format: FORMAT_ENC, version: 1, kdf: 'PBKDF2-SHA256', iterations: ITER, salt: b64(salt), iv: b64(iv), data: b64(ct) });
}
export async function decryptEnvelope(env, password) {
  try {
    const key = await deriveKey(password, unb64(env.salt), env.iterations);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data));
    return dec.decode(pt);
  } catch { throw new Error('Mot de passe incorrect ou fichier endommagé.'); }
}
export const markBackupDone = () => { try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch {} };

// ---------- Lecture et vérification ----------
export function parseFile(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('Ce fichier n\'est pas une sauvegarde Dictaphone IA (lecture impossible).'); }
  if (!obj || typeof obj !== 'object') throw new Error('Fichier non reconnu.');
  if (obj.format === FORMAT_ENC) return { encrypted: true, obj };
  if (obj.format === FORMAT) return { encrypted: false, obj };
  throw new Error('Ce fichier n\'est pas une sauvegarde Dictaphone IA.');
}

const str = (v, max = 200000) => (typeof v === 'string' ? v.slice(0, max) : '');
const idOk = (v) => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const catOk = (v) => (CATEGORIES.some((c) => c.id === v) ? v : null);

// Ne garde que les champs connus et de type valide (le contenu du fichier n'est jamais exécuté ni inséré tel quel).
export function sanitize(obj) {
  if (obj.version > VERSION) throw new Error('Cette sauvegarde vient d\'une version plus récente de l\'application. Mettez l\'application à jour.');
  const folders = (Array.isArray(obj.folders) ? obj.folders : []).filter((f) => f && idOk(f.id)).map((f) => ({
    id: f.id, category: catOk(f.category) || 'clients', parentId: idOk(f.parentId) ? f.parentId : null,
    name: str(f.name, 200) || 'Dossier', createdAt: num(f.createdAt, Date.now()), lastOpened: 0,
  }));
  const templates = (Array.isArray(obj.templates) ? obj.templates : []).filter((t) => t && idOk(t.id) && Array.isArray(t.sections)).map((t) => ({
    id: t.id, category: catOk(t.category) || 'clients', name: str(t.name, 200) || 'Trame', builtin: !!t.builtin, isDefault: !!t.isDefault,
    updatedAt: num(t.updatedAt, Date.now()),
    sections: t.sections.slice(0, 60).map((s) => ({ id: idOk(s && s.id) ? s.id : uid('r'), title: str(s && s.title, 200), instruction: str(s && s.instruction, 2000) })),
  }));
  const sessions = (Array.isArray(obj.sessions) ? obj.sessions : []).filter((s) => s && idOk(s.id)).map((s) => ({
    id: s.id, title: str(s.title ?? s.name, 300) || 'Sans titre', name: str(s.title ?? s.name, 300) || 'Sans titre',
    category: catOk(s.category), folderId: idOk(s.folderId) ? s.folderId : null, date: num(s.date, num(s.createdAt, Date.now())),
    templateId: idOk(s.templateId) ? s.templateId : null,
    transcript: typeof s.transcript === 'string' ? s.transcript.slice(0, 3000000) : null,
    reportSections: Array.isArray(s.reportSections) ? s.reportSections.slice(0, 80).map((r) => ({ id: idOk(r && r.id) ? r.id : uid('r'), title: str(r && r.title, 200), content: str(r && r.content) })) : null,
    summary: str(s.summary), source: str(s.source, 20) || 'texte',
    segments: Array.isArray(s.segments) ? s.segments.slice(0, 20000).map((g) => ({ t: num(g && g.t), text: str(g && g.text, 5000) })) : [],
    bookmarks: [], createdAt: num(s.createdAt, Date.now()), updatedAt: num(s.updatedAt, Date.now()),
    durationSec: num(s.durationSec), hadAudio: !!s.hadAudio, nChunks: 0, doneChunks: 0, hasOriginal: false,
  }));
  const vocab = (Array.isArray(obj.vocab) ? obj.vocab : []).filter((v) => v && typeof v.from === 'string' && typeof v.to === 'string').slice(0, 500).map((v) => ({ from: v.from.slice(0, 100), to: v.to.slice(0, 100) }));
  return { folders, templates, sessions, vocab };
}

// ---------- Plan de restauration (aucune écriture) ----------
export async function planRestore(clean) {
  const [exS, exF, exT] = await Promise.all([listEntretiens(), listFolders(), listTemplates()]);
  const sById = new Map(exS.map((s) => [s.id, s])), fIds = new Set(exF.map((f) => f.id)), tById = new Map(exT.map((t) => [t.id, t]));
  const plan = { addFolders: [], addTemplates: [], addSessions: [], copySessions: [], copyTemplates: [], skipped: 0, vocabAdd: [], audioMissing: 0 };
  for (const f of clean.folders) { if (fIds.has(f.id)) plan.skipped++; else plan.addFolders.push(f); }
  for (const t of clean.templates) {
    const ex = tById.get(t.id);
    if (!ex) plan.addTemplates.push(t);
    else if (ex.builtin || ex.updatedAt === t.updatedAt) plan.skipped++;
    else plan.copyTemplates.push({ ...t, id: uid('t'), builtin: false, isDefault: false, name: t.name + ' (restaurée)' });
  }
  for (const s of clean.sessions) {
    const ex = sById.get(s.id);
    if (!ex) plan.addSessions.push(s);
    else if (ex.updatedAt === s.updatedAt) plan.skipped++;
    else plan.copySessions.push({ ...s, id: uid('e'), title: s.title + ' (copie restaurée)', name: s.title + ' (copie restaurée)' });
    if (s.hadAudio) plan.audioMissing++;
  }
  const have = new Set(getVocab().map((v) => v.from.toLowerCase() + '→' + v.to));
  plan.vocabAdd = clean.vocab.filter((v) => !have.has(v.from.toLowerCase() + '→' + v.to));
  plan.folderIds = new Set([...fIds, ...plan.addFolders.map((f) => f.id)]);
  return plan;
}

export async function applyRestore(plan) {
  for (const f of plan.addFolders) await DB.putFolder(f);
  for (const t of [...plan.addTemplates, ...plan.copyTemplates]) await DB.putTemplate(t);
  for (const s of [...plan.addSessions, ...plan.copySessions]) {
    if (s.folderId && !plan.folderIds.has(s.folderId)) s.folderId = null;
    await DB.putSession(s);
  }
  if (plan.vocabAdd.length) setVocab([...getVocab(), ...plan.vocabAdd]);
}
