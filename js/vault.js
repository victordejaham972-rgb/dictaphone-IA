// Coffre chiffré : protège réellement les fiches et dossiers (AES-256-GCM) avec une clé de données aléatoire « enveloppée » par
//  - votre mot de passe (dérivé par PBKDF2-SHA256, 600 000 itérations) ;
//  - une clé de récupération aléatoire à conserver hors de l'appareil.
// Il n'existe AUCUN moyen de récupérer les données sans le mot de passe ou la clé de récupération (ni sauvegarde déchiffrable par nous).
// Les fiches chiffrées gardent les champs { id, _enc } : le titre, le nom du client, la transcription, le compte rendu et la fiche
// d'identité de pseudonymisation sont à l'intérieur du chiffrement. Les trames et les enregistrements audio du laboratoire ne sont pas chiffrés.
import * as DB from '../db.js';

const META_KEY = 'dia_vault';
const META_IDB = '__vault_meta__';
const ITER = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let meta = null;          // métadonnées publiques (sel, enveloppes de clé) : jamais la clé elle-même
let dek = null;           // clé de données (CryptoKey AES-GCM), en mémoire seulement tant que le coffre est ouvert
let lastActivity = Date.now(), hiddenSince = 0, timer = null;
const listeners = new Set();
const emit = () => { for (const f of listeners) { try { f(state()); } catch {} } };
export const onState = (f) => { listeners.add(f); return () => listeners.delete(f); };

// ---------- Métadonnées ----------
function readLocal() { try { return JSON.parse(localStorage.getItem(META_KEY)); } catch { return null; } }
async function writeMeta(m) {
  meta = m;
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch {}
  try { await DB.rawPutOriginal(META_IDB, { meta: m }); } catch {}          // copie dans la base : protège d'un effacement isolé des réglages
}
export async function init() {
  meta = readLocal();
  if (!meta) { try { const r = await DB.rawGetOriginal(META_IDB); if (r && r.meta) { meta = r.meta; try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {} } } catch {} }
  if (meta && meta.enabled) DB.setCodec(codec);
  startTimer(); emit();
  return state();
}
export const state = () => (!meta || !meta.enabled ? 'absent' : dek ? 'unlocked' : 'locked');
export const isEnabled = () => !!(meta && meta.enabled);
export const autoLockMinutes = () => (meta && meta.autoLockMin) || 5;
export const createdAt = () => (meta && meta.createdAt) || 0;

// ---------- Cryptographie ----------
async function kekFrom(secretBytes, salt, iter) {
  const km = await crypto.subtle.importKey('raw', secretBytes, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const seal = async (key, bytes, aad) => { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, ...(aad ? { additionalData: enc.encode(aad) } : {}) }, key, bytes); return { iv: b64(iv), ct: b64(ct) }; };
const open = (key, w, aad) => crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv), ...(aad ? { additionalData: enc.encode(aad) } : {}) }, key, unb64(w.ct));
const importDek = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);

// Clé de récupération : 20 octets aléatoires affichés en base32 (32 caractères) par groupes de 4.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function toBase32(bytes) { let bits = 0, val = 0, out = ''; for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function fromBase32(s) { const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, ''); let bits = 0, val = 0; const out = []; for (const c of clean) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }
export const formatRecoveryKey = (raw) => toBase32(raw).match(/.{1,4}/g).join('-');

// Qualité du mot de passe : refus des mots de passe courts ou évidents (pas de promesse de « mot de passe parfait »).
export function passwordIssues(pw) {
  const p = pw || '', issues = [];
  if (p.length < 12) issues.push('Au moins 12 caractères.');
  const classes = [/[a-zà-ÿ]/.test(p), /[A-ZÀ-Ý]/.test(p), /\d/.test(p), /[^A-Za-zÀ-ÿ0-9]/.test(p)].filter(Boolean).length;
  if (p.length < 16 && classes < 3) issues.push('Mélangez au moins trois types de caractères (minuscules, majuscules, chiffres, symboles), ou allongez-le à 16 caractères ou plus.');
  if (/^(.)\1+$/.test(p) || /(?:0123|1234|2345|abcd|azerty|qwerty|motdepasse|password|dictaphone|adeci|ade-ci)/i.test(p)) issues.push('Évitez les suites évidentes et les mots du quotidien.');
  return issues;
}

// ---------- Création, ouverture, fermeture ----------
export async function create(password) {
  const issues = passwordIssues(password);
  if (issues.length) throw new Error(issues.join(' '));
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const salt = crypto.getRandomValues(new Uint8Array(16)), rsalt = crypto.getRandomValues(new Uint8Array(16));
  const recRaw = crypto.getRandomValues(new Uint8Array(20));
  const kek = await kekFrom(enc.encode(password), salt, ITER);
  const rkek = await kekFrom(recRaw, rsalt, 100000);
  const key = await importDek(raw);
  const m = { v: 1, enabled: true, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), pw: await seal(kek, raw, 'dek'),
    rec: { salt: b64(rsalt), iter: 100000, ...(await seal(rkek, raw, 'dek')) }, chk: await seal(key, enc.encode('dictaphone-ia-coffre'), 'chk'), autoLockMin: 5, createdAt: Date.now(), changedAt: Date.now() };
  await writeMeta(m);
  dek = key; DB.setCodec(codec); touch(); startTimer(); emit();
  return { recoveryKey: formatRecoveryKey(recRaw) };
}
async function openWith(kek) {
  const raw = await open(kek, meta.pw, 'dek');
  return importDek(raw);
}
const delays = { fails: 0, until: 0 };
export function waitSeconds() { return Math.max(0, Math.ceil((delays.until - Date.now()) / 1000)); }
function fail() { delays.fails++; delays.until = Date.now() + Math.min(60000, 1000 * 2 ** Math.max(0, delays.fails - 2)); }   // délai croissant, jamais d'effacement
export async function unlock(password) {
  if (!meta || !meta.enabled) throw new Error('Aucun coffre.');
  if (waitSeconds() > 0) throw new Error(`Patientez ${waitSeconds()} s avant un nouvel essai.`);
  try {
    const kek = await kekFrom(enc.encode(password), unb64(meta.salt), meta.iter);
    dek = await openWith(kek);
  } catch { fail(); throw new Error('Mot de passe incorrect.'); }
  delays.fails = 0; delays.until = 0; await loadKv(); touch(); emit(); return true;
}
export async function unlockWithRecovery(recoveryKey) {
  if (!meta || !meta.enabled) throw new Error('Aucun coffre.');
  if (waitSeconds() > 0) throw new Error(`Patientez ${waitSeconds()} s avant un nouvel essai.`);
  try {
    const rkek = await kekFrom(fromBase32(recoveryKey), unb64(meta.rec.salt), meta.rec.iter);
    dek = await importDek(await open(rkek, meta.rec, 'dek'));
  } catch { fail(); throw new Error('Clé de récupération incorrecte.'); }
  delays.fails = 0; delays.until = 0; await loadKv(); touch(); emit(); return true;
}
export function lock() { dek = null; cache.clear(); emit(); }

// ---------- Petites données sensibles (vocabulaire, listes de protection, brouillon) ----------
// Lecture synchrone depuis la mémoire tant que le coffre est ouvert ; stockage chiffré dans la base ; plus rien dans localStorage.
export const SENSITIVE_KV = ['dia_vocab', 'dia_protect', 'dia_draft'];
const KV_PREFIX = '__kv__:';
const isInternal = (k) => typeof k === 'string' && k.startsWith('__');
const cache = new Map();
let kvChain = Promise.resolve();
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch {} };
const kvSealed = () => !!(meta && meta.enabled && SENSITIVE_KV.length);
async function kvWrite(key, value, k) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('kv:' + key) }, k, enc.encode(value));
  await DB.rawPutOriginal(KV_PREFIX + key, { v: 1, _enc: { v: 1, iv, ct } });
}
async function kvRead(key, k) {
  const r = await DB.rawGetOriginal(KV_PREFIX + key);
  if (!r || !r._enc) return null;
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r._enc.iv, additionalData: enc.encode('kv:' + key) }, k, r._enc.ct));
}
async function loadKv() {
  cache.clear();
  for (const key of SENSITIVE_KV) { const v = await kvRead(key, dek); if (v !== null) cache.set(key, v); }
}
export const kv = {
  get(key) {
    if (!kvSealed() || !SENSITIVE_KV.includes(key)) return lsGet(key);
    if (cache.has(key)) return cache.get(key);
    return dek ? lsGet(key) : null;                       // verrouillé : rien ; ouvert mais pas encore migré : ancienne valeur en clair
  },
  set(key, value) {
    if (!kvSealed() || !SENSITIVE_KV.includes(key)) { lsSet(key, value); return true; }
    if (!dek) return false;                                // verrouillé : écriture refusée
    const k = dek; cache.set(key, value);
    kvChain = kvChain.then(async () => { await kvWrite(key, value, k); lsDel(key); }).catch(() => {});
    return true;
  },
  remove(key) {
    if (!kvSealed() || !SENSITIVE_KV.includes(key)) { lsDel(key); return; }
    cache.delete(key); lsDel(key);
    kvChain = kvChain.then(() => DB.rawDeleteOriginal(KV_PREFIX + key)).catch(() => {});
  },
  flush: () => kvChain,
};
async function migrateKv(out) {
  for (const key of SENSITIVE_KV) {
    const v = lsGet(key);
    if (v === null) continue;
    try {
      await kvWrite(key, v, dek);
      if ((await kvRead(key, dek)) !== v) throw new Error('vérification impossible');
      cache.set(key, v); lsDel(key); out.kv++;
    } catch (err) { out.failed.push({ id: key, error: err.message }); }
  }
}

// ---------- Changement de mot de passe, nouvelle clé de récupération, délai de verrouillage ----------
export async function changePassword(oldPassword, newPassword) {
  const issues = passwordIssues(newPassword); if (issues.length) throw new Error(issues.join(' '));
  const oldKek = await kekFrom(enc.encode(oldPassword), unb64(meta.salt), meta.iter);
  let raw; try { raw = await open(oldKek, meta.pw, 'dek'); } catch { throw new Error('Ancien mot de passe incorrect.'); }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await kekFrom(enc.encode(newPassword), salt, ITER);
  await writeMeta({ ...meta, iter: ITER, salt: b64(salt), pw: await seal(kek, raw, 'dek'), changedAt: Date.now() });
  dek = await importDek(raw);
}
export async function newRecoveryKey(password) {
  const kek = await kekFrom(enc.encode(password), unb64(meta.salt), meta.iter);
  let raw; try { raw = await open(kek, meta.pw, 'dek'); } catch { throw new Error('Mot de passe incorrect.'); }
  const rsalt = crypto.getRandomValues(new Uint8Array(16)), recRaw = crypto.getRandomValues(new Uint8Array(20));
  const rkek = await kekFrom(recRaw, rsalt, 100000);
  await writeMeta({ ...meta, rec: { salt: b64(rsalt), iter: 100000, ...(await seal(rkek, raw, 'dek')) }, changedAt: Date.now() });
  return formatRecoveryKey(recRaw);
}
export async function setAutoLock(min) { await writeMeta({ ...meta, autoLockMin: min }); startTimer(); }
export async function resetPasswordAfterRecovery(newPassword) {      // appelée juste après unlockWithRecovery
  const issues = passwordIssues(newPassword); if (issues.length) throw new Error(issues.join(' '));
  if (!dek) throw new Error('Coffre verrouillé.');
  const raw = await crypto.subtle.exportKey('raw', dek);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await kekFrom(enc.encode(newPassword), salt, ITER);
  await writeMeta({ ...meta, iter: ITER, salt: b64(salt), pw: await seal(kek, raw, 'dek'), changedAt: Date.now() });
}

// ---------- Face ID / Touch ID (expérimental) ----------
// Principe : un identifiant WebAuthn de l'appareil (vérification utilisateur obligatoire) fournit, via l'extension « PRF », un secret
// stable qui enveloppe la clé de données. Le mot de passe reste TOUJOURS disponible. Sur iPhone, le fonctionnement dans une application
// installée n'est pas garanti : il doit être vérifié sur l'appareil (page de faisabilité) avant d'être proposé.
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
export const biometricEnabled = () => !!(meta && meta.bio);
export async function biometricSupported() {
  try { return !!(window.PublicKeyCredential && navigator.credentials && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}
async function bioKey(secret) {
  const km = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('dictaphone-ia-bio'), info: enc.encode('dek') }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function bioSecret(credId, salt) {
  const cred = await navigator.credentials.get({ publicKey: { challenge: rnd(32), allowCredentials: [{ id: credId, type: 'public-key' }], userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: salt } } } } });
  const r = cred && cred.getClientExtensionResults && cred.getClientExtensionResults().prf;
  if (!r || !r.results || !r.results.first) throw new Error('Cet appareil ne fournit pas le secret nécessaire (extension PRF absente).');
  return new Uint8Array(r.results.first);
}
export async function enableBiometric() {
  if (!dek) throw new Error('Déverrouillez d\'abord avec le mot de passe.');
  if (!(await biometricSupported())) throw new Error('Face ID / Touch ID n\'est pas disponible ici.');
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: 'ADE-CI Notes' }, user: { id: rnd(16), name: 'dictaphone-ia', displayName: 'ADE-CI Notes' }, challenge: rnd(32),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    timeout: 60000, extensions: { prf: {} } } });
  const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
  if (!ext.prf || ext.prf.enabled === false) throw new Error('Cet appareil ne prend pas en charge la dérivation de clé (PRF) : Face ID ne peut pas déverrouiller le coffre.');
  const credId = new Uint8Array(cred.rawId), salt = rnd(32);
  const s1 = await bioSecret(credId, salt), s2 = await bioSecret(credId, salt);     // le secret doit être strictement identique d'une fois sur l'autre
  if (s1.length !== s2.length || s1.some((v, i) => v !== s2[i])) throw new Error('Secret instable : Face ID non fiable sur cet appareil.');
  const raw = await crypto.subtle.exportKey('raw', dek);
  const wrapped = await seal(await bioKey(s1), raw, 'bio');
  await writeMeta({ ...meta, bio: { cred: b64(credId), salt: b64(salt), ...wrapped, at: Date.now() } });
  return true;
}
export async function unlockBiometric() {
  if (!meta || !meta.bio) throw new Error('Face ID n\'est pas activé.');
  if (waitSeconds() > 0) throw new Error(`Patientez ${waitSeconds()} s avant un nouvel essai.`);
  let raw;
  try { raw = await open(await bioKey(await bioSecret(unb64(meta.bio.cred), unb64(meta.bio.salt))), meta.bio, 'bio'); }
  catch (e) { throw new Error('Face ID n\'a pas abouti : saisissez le mot de passe.'); }
  dek = await importDek(raw);
  await loadKv(); touch(); emit(); return true;
}
export async function disableBiometric() { const m = { ...meta }; delete m.bio; await writeMeta(m); }

// ---------- Inactivité ----------
export function touch() { lastActivity = Date.now(); }
function startTimer() {
  clearInterval(timer); timer = null;
  if (!meta || !meta.enabled) return;
  timer = setInterval(() => { if (dek && Date.now() - lastActivity > autoLockMinutes() * 60000) lock(); }, 5000);
}
if (typeof document !== 'undefined') {
  const bump = () => touch();
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(ev, bump, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenSince = Date.now();
    else if (dek && hiddenSince && Date.now() - hiddenSince > autoLockMinutes() * 60000) lock();
    if (!document.hidden) { touch(); hiddenSince = 0; }
  });
}
export const _testSetLastActivity = (t) => { lastActivity = t; };      // pour les tests uniquement

// ---------- Codec branché sur la base (db.js) ----------
async function encodeRec(kind, id, bytes) {
  if (!dek) throw new Error('Coffre verrouillé.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(kind + ':' + id) }, dek, bytes);
  return { v: 1, iv, ct };
}
async function decodeRec(kind, id, e) {
  if (!dek) throw new Error('Coffre verrouillé.');
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: e.iv, additionalData: enc.encode(kind + ':' + id) }, dek, e.ct);
}
export const codec = {
  isLocked: () => !dek,
  async encode(kind, obj, id) {
    if (!meta || !meta.enabled) return obj;
    if (kind === 'chunk') return { _enc: await encodeRec('chunk', id, await obj.arrayBuffer()) };
    if (kind === 'original') {                                            // lié à l'identifiant de la fiche : un fichier ne peut pas être déplacé vers une autre
      const buf = await obj.blob.arrayBuffer();
      return { _enc: await encodeRec(kind, id, buf), _meta: await encodeRec('originalmeta', id, enc.encode(JSON.stringify({ name: obj.name, type: obj.type }))) };
    }
    return { id: obj.id, updatedAt: obj.updatedAt || Date.now(), _enc: await encodeRec(kind, obj.id, enc.encode(JSON.stringify(obj))) };
  },
  async decode(kind, rec, id) {
    if (!rec || !rec._enc) return rec;                                    // fiche non encore chiffrée (migration en cours ou ancienne donnée)
    if (kind === 'chunk') return new Blob([await decodeRec('chunk', id, rec._enc)]);
    if (kind === 'original') {
      const m = JSON.parse(dec.decode(await decodeRec('originalmeta', id, rec._meta)));
      return { blob: new Blob([await decodeRec(kind, id, rec._enc)], { type: m.type }), name: m.name, type: m.type };
    }
    return JSON.parse(dec.decode(await decodeRec(kind, rec.id, rec._enc)));
  },
};

// ---------- Migration (reprise possible) et retour en clair ----------
// Chaque fiche est chiffrée, relue et comparée AVANT d'être remplacée, une par une : une coupure en cours de route laisse un mélange
// de fiches chiffrées et en clair, toutes lisibles ; relancer la migration continue là où elle s'est arrêtée.
export async function migrateAll({ onProgress = () => {}, stopAfter = Infinity } = {}) {
  if (!dek) throw new Error('Coffre verrouillé.');
  const out = { sessions: 0, folders: 0, originals: 0, chunks: 0, kv: 0, already: 0, failed: [] };
  let done = 0;
  await migrateKv(out);                                              // vocabulaire, listes de protection, brouillon
  const lists = [['session', await DB.rawListSessions(), DB.rawPutSession, 'sessions'], ['folder', await DB.rawListFolders(), DB.rawPutFolder, 'folders']];
  const okeys = (await DB.rawListOriginalKeys()).filter((k) => !isInternal(k));
  const ckeys = await DB.rawListChunkKeys();
  const total = lists.reduce((a, l) => a + l[1].length, 0) + okeys.length + ckeys.length;
  // audio : morceau par morceau, relu et comparé avant remplacement
  const migrateChunks = async () => {
    for (const k of ckeys) {
      const r = await DB.rawGetChunk(k);
      if (!r || r._enc) { out.already++; continue; }
      if (done >= stopAfter) return true;
      try {
        const blob = r instanceof Blob ? r : new Blob([r]);
        const e = await codec.encode('chunk', blob, k);
        const a = new Uint8Array(await blob.arrayBuffer()), b = new Uint8Array(await (await codec.decode('chunk', e, k)).arrayBuffer());
        let same = a.length === b.length;
        for (let i = 0; same && i < a.length; i++) if (a[i] !== b[i]) same = false;
        if (!same) throw new Error('vérification impossible');
        await DB.rawPutChunk(k, e); out.chunks++; done++;
      } catch (err) { out.failed.push({ id: k, error: err.message }); }
      onProgress({ done, total });
    }
    return false;
  };
  // fichiers d'origine importés (PDF, textes) : chiffrés comme les fiches, liés à leur identifiant
  const migrateOriginals = async () => {
    for (const k of okeys) {
      const r = await DB.rawGetOriginal(k);
      if (!r || r._enc) { out.already++; continue; }
      if (done >= stopAfter) return true;
      try {
        const e = await codec.encode('original', r, k);
        const back = await codec.decode('original', e, k);
        const a = new Uint8Array(await r.blob.arrayBuffer()), b = new Uint8Array(await back.blob.arrayBuffer());
        let same = a.length === b.length && back.name === r.name && back.type === r.type;
        for (let i = 0; same && i < a.length; i++) if (a[i] !== b[i]) same = false;
        if (!same) throw new Error('vérification impossible');
        await DB.rawPutOriginal(k, e); out.originals++; done++;
      } catch (err) { out.failed.push({ id: k, error: err.message }); }
      onProgress({ done, total });
    }
    return false;
  };
  for (const [kind, recs, put, key] of lists) {
    for (const r of recs) {
      if (r._enc) { out.already++; continue; }
      if (done >= stopAfter) return { ...out, interrupted: true };
      try {
        const e = await codec.encode(kind, r);
        const back = await codec.decode(kind, e);
        if (JSON.stringify(back) !== JSON.stringify(r)) throw new Error('vérification impossible');
        await put(e); out[key]++; done++;
      } catch (err) { out.failed.push({ id: r.id, error: err.message }); }
      onProgress({ done, total });
    }
  }
  if (await migrateOriginals()) return { ...out, interrupted: true };
  if (await migrateChunks()) return { ...out, interrupted: true };
  await kv.flush();
  return out;
}
export async function decryptAll({ onProgress = () => {} } = {}) {
  if (!dek) throw new Error('Coffre verrouillé.');
  const out = { sessions: 0, folders: 0, originals: 0, chunks: 0, kv: 0, failed: [] };
  await kv.flush();
  for (const [kind, recs, put, key] of [['session', await DB.rawListSessions(), DB.rawPutSession, 'sessions'], ['folder', await DB.rawListFolders(), DB.rawPutFolder, 'folders']]) {
    for (const r of recs) { if (!r._enc) continue; try { await put(await codec.decode(kind, r)); out[key]++; } catch (err) { out.failed.push({ id: r.id, error: err.message }); } onProgress(out); }
  }
  for (const k of (await DB.rawListOriginalKeys()).filter((x) => !isInternal(x))) {
    const r = await DB.rawGetOriginal(k);
    if (!r || !r._enc) continue;
    try { await DB.rawPutOriginal(k, await codec.decode('original', r, k)); out.originals++; } catch (err) { out.failed.push({ id: k, error: err.message }); }
  }
  for (const k of await DB.rawListChunkKeys()) {
    const r = await DB.rawGetChunk(k);
    if (!r || !r._enc) continue;
    try { await DB.rawPutChunk(k, await codec.decode('chunk', r, k)); out.chunks++; } catch (err) { out.failed.push({ id: k, error: err.message }); }
  }
  // petites données : remises dans le stockage local, puis enregistrement chiffré supprimé seulement si la copie est vérifiée
  for (const key of SENSITIVE_KV) {
    try {
      const v = await kvRead(key, dek);
      if (v === null) continue;
      lsSet(key, v);
      if (lsGet(key) !== v) throw new Error('écriture impossible');
      await DB.rawDeleteOriginal(KV_PREFIX + key); out.kv++;
    } catch (err) { out.failed.push({ id: key, error: err.message }); }
  }
  return out;
}
export async function disable(password) {
  const kek = await kekFrom(enc.encode(password), unb64(meta.salt), meta.iter);
  try { await open(kek, meta.pw, 'dek'); } catch { throw new Error('Mot de passe incorrect.'); }
  if (!dek) await unlock(password);
  const r = await decryptAll();
  if (r.failed.length) throw new Error(`${r.failed.length} fiche(s) n'ont pas pu être déchiffrées : le coffre reste actif.`);
  DB.setCodec(null);
  await writeMeta({ ...meta, enabled: false });
  try { localStorage.removeItem(META_KEY); } catch {}
  dek = null; startTimer(); emit();
  return r;
}
// Combien de fiches restent en clair ? (affichage dans les Réglages)
export async function counts() {
  const s = await DB.rawListSessions(), f = await DB.rawListFolders();
  const keys = (await DB.rawListOriginalKeys()).filter((k) => !isInternal(k));
  let oEnc = 0; for (const k of keys) { const r = await DB.rawGetOriginal(k); if (r && r._enc) oEnc++; }
  const ck = await DB.rawListChunkKeys();
  let cEnc = 0; for (const k of ck) { const r = await DB.rawGetChunk(k); if (r && r._enc) cEnc++; }
  let kvPlain = 0, kvEnc = 0;
  for (const key of SENSITIVE_KV) { if (lsGet(key) !== null) kvPlain++; const r = await DB.rawGetOriginal(KV_PREFIX + key); if (r && r._enc) kvEnc++; }
  return { sessions: s.length, sessionsEncrypted: s.filter((x) => x._enc).length, folders: f.length, foldersEncrypted: f.filter((x) => x._enc).length, originals: keys.length, originalsEncrypted: oEnc,
    chunks: ck.length, chunksEncrypted: cEnc, kvPlain, kvEncrypted: kvEnc };
}
