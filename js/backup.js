// Sauvegarde et restauratirn. Une sauvegarde crntient des données CONFIDENTIELLES (transcriptions, comptes rendus).
// Protection proposée : chiffrement AES-256-GCM avec un mot de passe (Web Crypto, local). Sans mot de passe, le fichier est lisible par tous.
// La restauration n'écrase JAMAIS rien : un élément déjà présent est ignoré, ou ajouté sous forme de copie.
import * as DB from '../db.js';
import { kv } from './vault.js';
import { CATEGORIES } from './defaults.js';
import { listEntretiens, listFolders, listTemplates, uid, getVocab, setVocab, hasAudio, getTombstones, addTombstones, hiddenTemplateIds, hasExplicitHidden, setSetting } from './store.js';

export const FORMAT = 'dictaphone-ia-sauvegarde';
export const FORMAT_ENC = 'dictaphone-ia-sauvegarde-chiffree';
// Format versionné : 1 et 2 (anciennes sauvegardes) restent lisibles ; 3 ajoute les documents importés (« originals ») ; 4 ajoute la corbeille,
// l'original immuable de la transcription et les pierres tombales (éléments supprimés définitivement).
const VERSION = 4;
const ITER = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const LAST_KEY = 'dia_last_backup';
export const lastBackupAt = () => { try { return +localStorage.getItem(LAST_KEY) || 0; } catch { return 0; } };

// ---------- Création ----------
// Réglages locaux de la protection (dictionnaire personnel, listes « toujours / jamais masquer ») : contiennent des noms → réservés aux sauvegardes chiffrées.
const PROTECT_GLOBAL_KEY = 'dia_protect';
const readProtectGlobal = () => { try { return JSON.parse(kv.get(PROTECT_GLOBAL_KEY)) || null; } catch { return null; } };
// withProtect : inclure les fiches d'identité, décisions manuelles et listes de la pseudonymisation. À n'activer que pour une sauvegarde CHIFFRÉE.
// Documents importés (PDF, textes) : taille estimée avant de décider de les inclure.
export const MAX_ORIGINAL_BYTES = 40 * 1024 * 1024;      // par document
export const MAX_ORIGINALS_TOTAL = 150 * 1024 * 1024;    // pour l'ensemble de la sauvegarde
export async function estimateOriginals() {
  const sessions = await listEntretiens({ all: true });
  let count = 0, bytes = 0, skipped = 0;
  for (const s of sessions) {
    if (s._unreadable) continue;
    const r = await DB.rawGetOriginal(s.id);
    if (!r) continue;
    const n = r._enc ? Math.max(0, r._enc.ct.byteLength - 16) : (r.blob ? r.blob.size : 0);
    if (n > MAX_ORIGINAL_BYTES) { skipped++; continue; }
    count++; bytes += n;
  }
  return { count, bytes, skipped, tooBig: bytes > MAX_ORIGINALS_TOTAL };
}
// Inventaire complet de ce que contient l'appareil, et de ce qu'une sauvegarde transfère ou non (avant toute migration).
export async function inventory() {
  const [sessions, folders, templates] = await Promise.all([listEntretiens({ all: true }), listFolders({ all: true }), listTemplates()]);
  const readable = sessions.filter((s) => !s._unreadable);
  const out = { trashedFiches: sessions.filter((s) => s.deletedAt).length, trashedFolders: folders.filter((f) => f.deletedAt).length, trashedParts: sessions.filter((s) => !s.deletedAt && s.trashed && Object.keys(s.trashed).length).length,
    sessions: sessions.length, unreadable: sessions.length - readable.length, folders: folders.length, templates: templates.length, customTemplates: templates.filter((t) => !t.builtin).length,
    withTranscript: 0, withReport: 0, words: 0, protectSheets: 0, protectDecisions: 0, documents: 0, documentBytes: 0, audio: [], audioBytes: 0, audioSeconds: 0, orphanChunks: 0 };
  for (const s of readable) {
    const t = typeof s.transcript === 'string' ? s.transcript : (s.segments || []).map((g) => g.text).join('\n');
    if (t.trim()) { out.withTranscript++; out.words += t.trim().split(/\s+/).length; }
    if ((s.reportSections || []).some((r) => (r.content || '').trim())) out.withReport++;
    if (s.protect && s.protect.sheet && (s.protect.sheet.persons || []).length) out.protectSheets++;
    if (s.protect && s.protect.overrides) out.protectDecisions += Object.keys(s.protect.overrides.byText || {}).length + Object.keys(s.protect.overrides.byPos || {}).length;
    const o = await DB.rawGetOriginal(s.id);
    if (o) { out.documents++; out.documentBytes += o._enc ? Math.max(0, o._enc.ct.byteLength - 16) : (o.blob ? o.blob.size : 0); }
  }
  const known = new Set(sessions.map((s) => s.id));
  const sizes = new Map();
  for (const k of await DB.rawListChunkKeys()) {
    const id = String(k).split(':')[0];
    const r = await DB.rawGetChunk(k);
    const n = r && r._enc ? Math.max(0, r._enc.ct.byteLength - 16) : (r && (r.size || r.byteLength)) || 0;
    if (!known.has(id)) { out.orphanChunks++; continue; }
    sizes.set(id, (sizes.get(id) || 0) + n);
  }
  for (const s of readable) if (s.nChunks > 0) { const b = sizes.get(s.id) || 0; out.audio.push({ id: s.id, title: s.title, chunks: s.nChunks, bytes: b, seconds: s.durationSec || 0, complete: (s.doneChunks || 0) >= s.nChunks }); out.audioBytes += b; out.audioSeconds += s.durationSec || 0; }
  const g = readProtectGlobal() || {};
  out.vocab = getVocab().length; out.protectDict = (g.dict || []).length; out.protectLists = (g.always || []).length + (g.never || []).length;
  try { const est = await navigator.storage.estimate(); out.usage = est.usage; out.quota = est.quota; } catch {}
  return out;
}
// withOriginals : inclure les documents importés (PDF, textes), encodés en base64 (+ 33 % de taille).
export async function buildBackup(appVersion, { withProtect = false, withOriginals = false, withTrash = true } = {}) {
  const [allS, allF, templates] = await Promise.all([listEntretiens({ all: true }), listFolders({ all: true }), listTemplates()]);
  // sauvegarde COMPLÈTE par défaut : la corbeille est incluse (fiches, dossiers et éléments retirés), pour une restauration fidèle
  const sessions = withTrash ? allS : allS.filter((e) => !e.deletedAt).map((e) => ({ ...e, trashed: {} }));
  const folders = withTrash ? allF : allF.filter((f) => !f.deletedAt);
  const bad = sessions.filter((s) => s._unreadable).length + folders.filter((f) => f._unreadable).length;
  if (bad) throw new Error(`${bad} élément(s) chiffrés sont illisibles : la sauvegarde est refusée pour ne pas en produire une incomplète.`);
  const out = {
    format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), appVersion,
    note: 'Les fichiers audio ne sont pas inclus : exportez-les depuis la fiche de chaque entretien.',
    folders, templates, vocab: getVocab(), tombstones: getTombstones(), trashIncluded: !!withTrash,
    sessions: sessions.map((s) => { const x = { ...s, hadAudio: hasAudio(s) || !!s.hadAudio }; if (!withProtect) delete x.protect; return x; }),
  };
  if (withProtect) { const g = readProtectGlobal(); if (g) out.protectGlobal = g; }
  if (hasExplicitHidden()) out.hiddenTemplates = hiddenTemplateIds();           // préférence d'affichage des trames (aucune trame n'est supprimée)
  if (withOriginals) {
    const originals = []; let total = 0;
    for (const s of sessions) {
      const o = await DB.getOriginal(s.id);
      if (!o || !o.blob) continue;
      if (o.blob.size > MAX_ORIGINAL_BYTES) throw new Error(`Le document « ${o.name} » dépasse ${Math.round(MAX_ORIGINAL_BYTES / 1048576)} Mo : sauvegarde sans documents importés, ou retirez-le.`);
      total += o.blob.size;
      if (total > MAX_ORIGINALS_TOTAL) throw new Error('Les documents importés dépassent la taille maximale d\'une sauvegarde : sauvegardez sans les documents importés.');
      originals.push({ id: s.id, name: o.name || 'document', type: o.type || o.blob.type || 'application/octet-stream', size: o.blob.size, data: b64(await o.blob.arrayBuffer()) });
    }
    out.originals = originals;
  }
  return out;
}
// Vrai si la sauvegarde contient des éléments de pseudonymisation (donc des noms de personnes) : elle ne doit jamais être écrite en clair.
export const hasProtectData = (b) => !!(b.protectGlobal || (b.sessions || []).some((s) => s.protect));

async function deriveKey(pw, salt, iter) {
  const km = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// Enveloppe version 2 : le contenu est chiffré par blocs de 4 Mo (un seul appel de chiffrement ne gère pas bien les très gros fichiers).
// Chaque bloc a son propre vecteur d'initialisation et lie son rang et le nombre total de blocs : suppression, ajout ou permutation détectés.
// Les enveloppes version 1 (un seul bloc) restent lisibles.
const BLOCK = 4 * 1024 * 1024;
const blockIv = (base, i) => { const iv = new Uint8Array(12); iv.set(base, 0); new DataView(iv.buffer).setUint32(8, i); return iv; };
const blockAad = (i, n) => enc.encode(`${FORMAT_ENC}:2:${i}:${n}`);
export async function encryptText(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), base = crypto.getRandomValues(new Uint8Array(8));
  const key = await deriveKey(password, salt, ITER);
  const bytes = enc.encode(text);
  const n = Math.max(1, Math.ceil(bytes.length / BLOCK));
  const chunks = [];
  for (let i = 0; i < n; i++) {
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: blockIv(base, i), additionalData: blockAad(i, n) }, key, bytes.subarray(i * BLOCK, (i + 1) * BLOCK));
    chunks.push(b64(ct));
  }
  return JSON.stringify({ format: FORMAT_ENC, version: 2, kdf: 'PBKDF2-SHA256', iterations: ITER, salt: b64(salt), iv: b64(base), count: n, chunks });
}
export async function decryptEnvelope(env, password) {
  try {
    const key = await deriveKey(password, unb64(env.salt), env.iterations);
    if (env.version === 2) {
      const n = env.count, base = unb64(env.iv);
      if (!Array.isArray(env.chunks) || env.chunks.length !== n || n < 1) throw new Error('structure');
      const parts = [];
      for (let i = 0; i < n; i++) parts.push(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blockIv(base, i), additionalData: blockAad(i, n) }, key, unb64(env.chunks[i]))));
      const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; }
      return dec.decode(all);
    }
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data));
    return dec.decode(pt);
  } catch { throw new Error('Mot de passe incorrect ou fichier endommagé.'); }
}
export const markBackupDone = () => { try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch {} };

// ---------- Lecture et vérification ----------
export function parseFile(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('Ce fichier n\'est pas une sauvegarde ADE-CI Notes (lecture impossible).'); }
  if (!obj || typeof obj !== 'object') throw new Error('Fichier non reconnu.');
  if (obj.format === FORMAT_ENC) return { encrypted: true, obj };
  if (obj.format === FORMAT) return { encrypted: false, obj };
  throw new Error('Ce fichier n\'est pas une sauvegarde ADE-CI Notes.');
}

const str = (v, max = 200000) => (typeof v === 'string' ? v.slice(0, max) : '');
const idOk = (v) => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const catOk = (v) => (CATEGORIES.some((c) => c.id === v) ? v : null);

const flg = (l) => (Array.isArray(l) ? l.slice(0, 40).filter((f) => f && typeof f.text === 'string').map((f) => ({ kind: str(f.kind, 30), text: str(f.text, 600) })) : []);
const evid = (l) => l.slice(0, 80).filter((ev) => ev && typeof ev.t === 'string').map((ev) => ({ t: str(ev.t, 600), st: str(ev.st, 20), q: (Array.isArray(ev.q) ? ev.q : []).slice(0, 3).map((x) => str(x, 320)), n: (Array.isArray(ev.n) ? ev.n : []).slice(0, 3).filter((x) => Number.isFinite(x)) }));
const hist = (l) => (Array.isArray(l) ? l.slice(0, 5).filter((v) => v && typeof v.text === 'string' && v.text.trim()).map((v) => ({ text: v.text.slice(0, 3000000), reason: str(v.reason, 60), source: str(v.source, 200), date: num(v.date, Date.now()) })) : []);
// Ne garde que les champs connus et de type valide (le contenu du fichier n'est jamais exécuté ni inséré tel quel).
export function sanitize(obj) {
  if (obj.version > VERSION) throw new Error('Cette sauvegarde vient d\'une version plus récente de l\'application. Mettez l\'application à jour.');
  const folders = (Array.isArray(obj.folders) ? obj.folders : []).filter((f) => f && idOk(f.id)).map((f) => ({
    id: f.id, category: catOk(f.category) || 'clients', parentId: idOk(f.parentId) ? f.parentId : null,
    name: str(f.name, 200) || 'Dossier', createdAt: num(f.createdAt, Date.now()), lastOpened: 0,
    ...(Number.isFinite(f.deletedAt) && f.deletedAt > 0 ? { deletedAt: f.deletedAt } : {}), ...(typeof f.trashGroup === 'string' && /^[\w-]{1,64}$/.test(f.trashGroup) ? { trashGroup: f.trashGroup } : {}),
    ...(f.formerChildren && typeof f.formerChildren === 'object' ? { formerChildren: { folders: (Array.isArray(f.formerChildren.folders) ? f.formerChildren.folders : []).filter(idOk).slice(0, 2000), sessions: (Array.isArray(f.formerChildren.sessions) ? f.formerChildren.sessions : []).filter(idOk).slice(0, 5000) } } : {}),
  }));
  const templates = (Array.isArray(obj.templates) ? obj.templates : []).filter((t) => t && idOk(t.id) && Array.isArray(t.sections)).map((t) => ({
    id: t.id, category: catOk(t.category) || 'clients', name: str(t.name, 200) || 'Trame', builtin: !!t.builtin, isDefault: !!t.isDefault,
    updatedAt: num(t.updatedAt, Date.now()),
    sections: t.sections.slice(0, 60).map((s) => ({ id: idOk(s && s.id) ? s.id : uid('r'), title: str(s && s.title, 200), instruction: str(s && s.instruction, 2000), ...(s && s.level === 2 ? { level: 2 } : {}) })),
  }));
  const sessions = (Array.isArray(obj.sessions) ? obj.sessions : []).filter((s) => s && idOk(s.id)).map((s) => ({
    id: s.id, title: str(s.title ?? s.name, 300) || 'Sans titre', name: str(s.title ?? s.name, 300) || 'Sans titre',
    category: catOk(s.category), folderId: idOk(s.folderId) ? s.folderId : null, date: num(s.date, num(s.createdAt, Date.now())),
    templateId: idOk(s.templateId) ? s.templateId : null,
    transcript: typeof s.transcript === 'string' ? s.transcript.slice(0, 3000000) : null,
    reportSections: Array.isArray(s.reportSections) ? s.reportSections.slice(0, 80).map((r) => ({ id: idOk(r && r.id) ? r.id : uid('r'), title: str(r && r.title, 200), content: str(r && r.content), ...(r && r.level === 2 ? { level: 2 } : {}), ...(r && r.ia ? { ia: true } : {}), ...(r && r.edited ? { edited: true } : {}), ...(r && Array.isArray(r.evidence) ? { evidence: evid(r.evidence) } : {}), ...(r && Array.isArray(r.flags) ? { flags: flg(r.flags) } : {}) })) : null,
    ...(s.iaInfo && typeof s.iaInfo === 'object' ? { iaInfo: { engine: str(s.iaInfo.engine, 20), model: str(s.iaInfo.model, 120), label: str(s.iaInfo.label, 200), date: num(s.iaInfo.date, 0), seconds: num(s.iaInfo.seconds, 0), calls: num(s.iaInfo.calls, 0), rejected: num(s.iaInfo.rejected, 0), flags: flg(s.iaInfo.flags), reviewed: !!s.iaInfo.reviewed, ...(s.iaInfo.reviewedAt ? { reviewedAt: num(s.iaInfo.reviewedAt, 0) } : {}) } } : {}),
    who: str(s.who, 120), subject: str(s.subject, 160), titleAuto: !!s.titleAuto,
    transcriptHistory: hist(s.transcriptHistory), reportHistory: hist(s.reportHistory),
    ...(typeof s.reportRaw === 'string' && s.reportRaw ? { reportRaw: s.reportRaw.slice(0, 500000), reportRawAt: num(s.reportRawAt, 0) } : {}),
    summary: str(s.summary), source: str(s.source, 20) || 'texte',
    segments: Array.isArray(s.segments) ? s.segments.slice(0, 20000).map((g) => ({ t: num(g && g.t), text: str(g && g.text, 5000) })) : [],
    bookmarks: [], createdAt: num(s.createdAt, Date.now()), updatedAt: num(s.updatedAt, Date.now()),
    durationSec: num(s.durationSec), hadAudio: !!s.hadAudio, nChunks: 0, doneChunks: 0, hasOriginal: false,
    ...(cleanProtect(s.protect) ? { protect: cleanProtect(s.protect) } : {}),
    original: typeof s.original === 'string' ? s.original.slice(0, 3000000) : null, originalPresumed: !!s.originalPresumed, originalHistory: hist(s.originalHistory),
    deletedAt: Number.isFinite(s.deletedAt) && s.deletedAt > 0 ? s.deletedAt : 0, trashGroup: typeof s.trashGroup === 'string' && /^[\w-]{1,64}$/.test(s.trashGroup) ? s.trashGroup : '', trashed: cleanTrashed(s.trashed),
  }));
  const vocab = (Array.isArray(obj.vocab) ? obj.vocab : []).filter((v) => v && typeof v.from === 'string' && typeof v.to === 'string').slice(0, 2000).map((v) => ({ from: v.from.slice(0, 100), to: v.to.slice(0, 100), ...(v.cs ? { cs: true } : {}) }));
  const protectGlobal = cleanProtectGlobal(obj.protectGlobal);
  // Documents importés : id d'une fiche présente, taille plafonnée, contenu base64 valide (vérifié à la restauration).
  const sIds = new Set(sessions.map((s) => s.id));
  const originals = []; let total = 0;
  for (const o of (Array.isArray(obj.originals) ? obj.originals : [])) {
    if (!o || !sIds.has(o.id) || typeof o.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(o.data)) continue;
    const size = Math.floor(o.data.length * 3 / 4);
    if (size > MAX_ORIGINAL_BYTES * 1.01 || (total += size) > MAX_ORIGINALS_TOTAL * 1.01) continue;
    originals.push({ id: o.id, name: str(o.name, 200) || 'document', type: str(o.type, 100) || 'application/octet-stream', data: o.data });
  }
  const withOrig = new Set(originals.map((o) => o.id));
  for (const s of sessions) if (withOrig.has(s.id)) s.hasOriginal = true;
  const tombstones = (Array.isArray(obj.tombstones) ? obj.tombstones : []).filter((t) => t && idOk(t.id)).slice(0, 5000).map((t) => ({ id: t.id, kind: ['fiche', 'dossier'].includes(t.kind) ? t.kind : 'fiche', at: num(t.at, Date.now()) }));
  const hiddenTemplates = Array.isArray(obj.hiddenTemplates) ? obj.hiddenTemplates.filter(idOk).slice(0, 200) : null;
  return { folders, templates, sessions, vocab, protectGlobal, originals, tombstones, hiddenTemplates };
}

// Éléments retirés d'une fiche (document, audio, transcription corrigée) : structure validée.
function cleanTrashed(t) {
  const out = {}; if (!t || typeof t !== 'object') return out;
  if (t.document && typeof t.document === 'object') out.document = { at: num(t.document.at, Date.now()), name: str(t.document.name, 200) };
  if (t.audio && typeof t.audio === 'object') out.audio = { at: num(t.audio.at, Date.now()), nChunks: Math.max(0, Math.min(100000, num(t.audio.nChunks, 0))) };
  if (t.transcript && typeof t.transcript === 'object' && typeof t.transcript.text === 'string') out.transcript = { at: num(t.transcript.at, Date.now()), text: t.transcript.text.slice(0, 3000000) };
  return out;
}
// Fiche d'identité et décisions de pseudonymisation : structure validée, rien n'est exécuté ni inséré tel quel.
const strList = (l, max = 200, len = 200) => (Array.isArray(l) ? l.slice(0, max).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.slice(0, len)) : []);
// Instantané des correspondances étiquette → original (rétablissement des noms) : paires de chaînes bornées, rien d'autre.
function cleanRestore(r) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.pairs)) return null;
  const pairs = r.pairs.slice(0, 2000).filter((x) => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string' && x[0].trim() && x[1].trim()).map((x) => [x[0].slice(0, 80), x[1].slice(0, 200), x[2] === 'pers' ? 'pers' : 'info']);
  if (!pairs.length) return null;
  return { v: 1, at: num(r.at, 0), hash: typeof r.hash === 'string' ? r.hash.slice(0, 40) : '', ...(typeof r.o === 'string' ? { o: r.o.slice(0, 40) } : {}), pairs };
}
function cleanProtect(p) {
  if (!p || typeof p !== 'object') return null;
  const sh = p.sheet && typeof p.sheet === 'object' ? p.sheet : {};
  const ov = p.overrides && typeof p.overrides === 'object' ? p.overrides : {};
  const byText = {}, byPos = {}, labels = {};
  for (const [k, v] of Object.entries(ov.byText || {}).slice(0, 5000)) if (v === 'mask' || v === 'keep') byText[str(k, 200)] = v;
  for (const [k, v] of Object.entries(ov.byPos || {}).slice(0, 5000)) if (v && (v.action === 'mask' || v.action === 'keep') && typeof v.text === 'string') byPos[str(k, 40)] = { action: v.action, text: v.text.slice(0, 200) };
  for (const [k, v] of Object.entries(ov.labels || {}).slice(0, 5000)) if (typeof v === 'string') labels[str(k, 200)] = v.slice(0, 80);
  return {
    v: 1, level: p.level === 'standard' ? 'standard' : 'renforce',
    sheet: {
      persons: (Array.isArray(sh.persons) ? sh.persons : []).slice(0, 50).filter((x) => x && typeof x.name === 'string').map((x) => ({ name: x.name.slice(0, 120), role: ['client', 'conjoint', 'proche', 'tiers'].includes(x.role) ? x.role : 'proche', gender: x.gender === 'F' || x.gender === 'M' ? x.gender : '' })),
      employers: strList(sh.employers), companies: strList(sh.companies), cities: strList(sh.cities), addresses: strList(sh.addresses), others: strList(sh.others),
    },
    overrides: { byText, byPos, labels }, alwaysMask: strList(p.alwaysMask, 500), neverMask: strList(p.neverMask, 500),
    ...(Number.isFinite(p.copiedAt) ? { copiedAt: p.copiedAt } : {}), ...(Number.isFinite(p.reviewedAt) ? { reviewedAt: p.reviewedAt } : {}),
    ...(typeof p.reviewHash === 'string' ? { reviewHash: p.reviewHash.slice(0, 40) } : {}), ...(p.visited ? { visited: true } : {}), leakAcks: strList(p.leakAcks, 500),
    ...(cleanRestore(p.restore) ? { restore: cleanRestore(p.restore) } : {}),
  };
}
function cleanProtectGlobal(g) {
  if (!g || typeof g !== 'object') return null;
  return {
    dict: (Array.isArray(g.dict) ? g.dict : []).slice(0, 2000).filter((d) => d && typeof d.name === 'string' && typeof d.role === 'string').map((d) => ({ name: d.name.slice(0, 120), role: d.role.slice(0, 40) })),
    always: strList(g.always, 2000), never: strList(g.never, 2000),
  };
}

// ---------- Plan de restauration (aucune écriture) ----------
// reviveDeleted : restaurer aussi les éléments supprimés DÉFINITIVEMENT depuis (pierres tombales). Par défaut, ils ne reviennent pas.
export async function planRestore(clean, { reviveDeleted = false } = {}) {
  const [exS, exF, exT] = await Promise.all([listEntretiens({ all: true }), listFolders({ all: true }), listTemplates()]);
  const tomb = new Set(getTombstones().map((t) => t.id));
  const sById = new Map(exS.map((s) => [s.id, s])), fIds = new Set(exF.map((f) => f.id)), tById = new Map(exT.map((t) => [t.id, t]));
  const plan = { addFolders: [], addTemplates: [], addSessions: [], copySessions: [], copyTemplates: [], skipped: 0, vocabAdd: [], audioMissing: 0, enrichProtect: [], protectGlobal: clean.protectGlobal || null, originalsAdd: [], enrichOriginal: [], ignoredInTrash: 0, ignoredPurged: 0, tombstones: reviveDeleted ? [] : (clean.tombstones || []), trashedInBackup: 0, hiddenTemplates: clean.hiddenTemplates || null };
  const origBy = new Map((clean.originals || []).map((o) => [o.id, o]));
  for (const f of clean.folders) {
    if (fIds.has(f.id)) plan.skipped++;
    else if (tomb.has(f.id) && !reviveDeleted) plan.ignoredPurged++;                 // supprimé définitivement ici : pas de résurrection silencieuse
    else { plan.addFolders.push(f); if (f.deletedAt) plan.trashedInBackup++; }
  }
  for (const t of clean.templates) {
    const ex = tById.get(t.id);
    if (!ex) plan.addTemplates.push(t);
    else if (ex.builtin || ex.updatedAt === t.updatedAt) plan.skipped++;
    else plan.copyTemplates.push({ ...t, id: uid('t'), builtin: false, isDefault: false, name: t.name + ' (restaurée)' });
  }
  for (const s of clean.sessions) {
    const ex = sById.get(s.id);
    const orig = origBy.get(s.id);
    if (!ex && tomb.has(s.id) && !reviveDeleted) { plan.ignoredPurged++; continue; }                // supprimée définitivement ici : elle ne revient pas
    if (ex && ex.deletedAt && !s.deletedAt) { plan.ignoredInTrash++; continue; }                  // dans la corbeille de cet appareil : jamais ressuscitée ni dupliquée
    if (!ex) { plan.addSessions.push(s); if (s.deletedAt) plan.trashedInBackup++; if (orig) plan.originalsAdd.push({ ...orig }); }
    else if (ex.original === null && typeof s.original === 'string' && s.original.trim() && !ex.deletedAt) { plan.enrichOriginal.push({ id: s.id, original: s.original, presumed: !!s.originalPresumed }); plan.skipped++; }
    else if (s.protect && !ex.protect) { plan.enrichProtect.push({ id: s.id, protect: s.protect }); plan.skipped++; }   // la fiche existe : on lui ajoute seulement la protection manquante
    else if (ex.updatedAt === s.updatedAt) plan.skipped++;
    else if (ex.deletedAt || s.deletedAt) plan.skipped++;                                         // pas de copie pour un élément en corbeille
    else { const nid = uid('e'); plan.copySessions.push({ ...s, id: nid, title: s.title + ' (copie restaurée)', name: s.title + ' (copie restaurée)' }); if (orig) plan.originalsAdd.push({ ...orig, id: nid }); }
    // fiche déjà présente sans document d'origine : le document de la sauvegarde lui est rattaché
    if (ex && orig && !ex.hasOriginal && !(await DB.rawGetOriginal(s.id))) plan.originalsAdd.push({ ...orig, attach: true });
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
  // documents importés : écrits après les fiches ; la fiche existante est marquée « avec document » seulement si l'écriture a réussi
  for (const o of plan.originalsAdd || []) {
    const bytes = unb64(o.data);
    await DB.putOriginal(o.id, { blob: new Blob([bytes], { type: o.type }), name: o.name, type: o.type });
    if (o.attach) { const cur = await DB.getSession(o.id); if (cur && !cur._unreadable) { cur.hasOriginal = true; await DB.putSession(cur); } }
  }
  if (plan.vocabAdd.length) setVocab([...getVocab(), ...plan.vocabAdd]);
  // préférence d'affichage des trames : reprise seulement si cet appareil n'a pas déjà fait son propre choix
  if (plan.hiddenTemplates && !hasExplicitHidden()) setSetting('hiddenTemplates', plan.hiddenTemplates);
  // pierres tombales de la sauvegarde : fusionnées (un élément supprimé définitivement le reste)
  if (plan.tombstones && plan.tombstones.length) addTombstones(plan.tombstones);
  // original immuable : ajouté aux fiches existantes qui n'en ont pas, jamais écrasé
  for (const en of plan.enrichOriginal || []) { const cur = await DB.getSession(en.id); if (cur && !cur._unreadable && (cur.original === null || cur.original === undefined)) { cur.original = en.original; cur.originalPresumed = en.presumed; await DB.putSession(cur); } }
  // fiche d'identité et décisions de pseudonymisation : ajoutées aux fiches existantes qui n'en ont pas, jamais écrasées
  for (const en of plan.enrichProtect || []) { const cur = await DB.getSession(en.id); if (cur && !cur.protect) { cur.protect = en.protect; await DB.putSession(cur); } }
  if (plan.protectGlobal) {
    try {
      const cur = JSON.parse(kv.get(PROTECT_GLOBAL_KEY)) || {};
      const uniq = (a, b) => [...new Set([...(a || []), ...(b || [])])];
      const dictKey = (d) => d.role + '|' + d.name.toLowerCase();
      const seen = new Set((cur.dict || []).map(dictKey));
      kv.set(PROTECT_GLOBAL_KEY, JSON.stringify({ ...cur, dict: [...(cur.dict || []), ...plan.protectGlobal.dict.filter((d) => !seen.has(dictKey(d)))], always: uniq(cur.always, plan.protectGlobal.always), never: uniq(cur.never, plan.protectGlobal.never) }));
    } catch {}
  }
}
