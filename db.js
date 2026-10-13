// Stockage local (IndexedDB) : sessions + morceaux audio de 30 s + fichiers d'origine importés.
// Tout reste dans le navigateur du téléphone, rien n'est envoyé ailleurs.
// Les morceaux audio sont stockés sous forme de Blob : le navigateur peut les garder sur disque
// et les réassembler pour la lecture sans tout charger en mémoire (à vérifier sur iPhone).
const NAME = 'dictaphone-proto';
let dbPromise = null;

function open() {
  return new Promise((resolve, reject) => {
    // Version 3 : AJOUT de deux espaces (dossiers, trames). Les espaces existants (sessions, chunks, originals)
    // ne sont ni modifiés, ni vidés, ni supprimés : la mise à jour est strictement additive.
    const r = indexedDB.open(NAME, 3);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      if (!db.objectStoreNames.contains('originals')) db.createObjectStore('originals');
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' });
    };
    // Garde-fou : si le navigateur n'ouvre jamais la base (extension, profil ou stockage bloqué), on le dit au lieu de laisser un écran vide.
    const guard = setTimeout(() => reject(new Error('Le navigateur n\'ouvre pas le stockage de l\'application (délai dépassé). Essayez une fenêtre de navigation privée, un autre navigateur, ou désactivez les extensions pour ce site. Vos données ne sont pas modifiées.')), OPEN_TIMEOUT);
    r.onsuccess = () => {
      clearTimeout(guard);
      // Si un autre onglet doit mettre la base à jour, on libère la connexion au lieu de le bloquer.
      r.result.onversionchange = () => { r.result.close(); dbPromise = null; };
      resolve(r.result);
    };
    r.onblocked = () => { clearTimeout(guard); reject(new Error('Base verrouillée par un autre onglet : fermez les autres fenêtres ADE-CI Notes puis rechargez.')); };
    r.onerror = () => { clearTimeout(guard); reject(r.error); };
  });
}
const OPEN_TIMEOUT = 12000;

async function tx(store, mode, fn) {
  // Une ouverture qui a échoué n'est pas conservée : le prochain appel réessaie.
  const db = await (dbPromise ||= open().catch((err) => { dbPromise = null; throw err; }));
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let out;
    const rq = fn(t.objectStore(store));
    if (rq) rq.onsuccess = () => (out = rq.result);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const key = (id, i) => `${id}:${String(i).padStart(5, '0')}`;

// Coffre chiffré (js/vault.js) : lorsqu'il est actif, les fiches, dossiers et fichiers d'origine sont chiffrés à l'écriture et déchiffrés
// à la lecture. Les enregistrements « en clair » restent lisibles (migration progressive et reprise possible). Les fonctions « raw* »
// lisent et écrivent les enregistrements tels qu'ils sont stockés (migration, métadonnées du coffre).
let codec = null;
export const setCodec = (c) => { codec = c; };
const enc = (kind, v, id) => (codec ? codec.encode(kind, v, id) : v);
const dec = async (kind, r, id) => (codec && r ? codec.decode(kind, r, id) : r);

export const rawPutSession = (s) => tx('sessions', 'readwrite', (st) => st.put(s));
export const rawListSessions = () => tx('sessions', 'readonly', (st) => st.getAll());
export const rawPutFolder = (f) => tx('folders', 'readwrite', (st) => st.put(f));
export const rawListFolders = () => tx('folders', 'readonly', (st) => st.getAll());
export const rawPutOriginal = (id, obj) => tx('originals', 'readwrite', (st) => st.put(obj, id));
export const rawGetOriginal = (id) => tx('originals', 'readonly', (st) => st.get(id));
export const rawListOriginalKeys = () => tx('originals', 'readonly', (st) => st.getAllKeys());

// Une fiche chiffrée illisible (donnée corrompue) ne doit pas bloquer la liste : elle est signalée par un marqueur, jamais réécrite.
const unreadable = (kind, r) => (kind === 'folder'
  ? { id: r.id, name: 'Dossier illisible', category: 'clients', parentId: null, createdAt: 0, lastOpened: 0, _unreadable: true }
  : { id: r.id, title: 'Fiche illisible (chiffrement)', name: 'Fiche illisible (chiffrement)', updatedAt: r.updatedAt || 0, date: r.updatedAt || 0, _unreadable: true });
const decList = (kind, l) => Promise.all(l.map(async (r) => { try { return await dec(kind, r); } catch (err) { if (codec && codec.isLocked && codec.isLocked()) throw err; return unreadable(kind, r); } }));
const refuse = (s) => { if (s && s._unreadable) throw new Error('Fiche illisible : écriture refusée pour ne pas la perdre.'); };

export const putSession = async (s) => { refuse(s); return rawPutSession(await enc('session', s)); };
export const getSession = async (id) => dec('session', await tx('sessions', 'readonly', (st) => st.get(id)));
export const listSessions = async () => { const l = await rawListSessions(); return codec ? decList('session', l) : l; };

// Un morceau = Blob (PCM 16 bits, 16 kHz, mono).
// Audio : chiffré à l'écriture lorsque le coffre est actif (lié à la clé « id:index » du morceau).
export const rawPutChunk = (k, v) => tx('chunks', 'readwrite', (st) => st.put(v, k));
export const rawGetChunk = (k) => tx('chunks', 'readonly', (st) => st.get(k));
export const rawListChunkKeys = () => tx('chunks', 'readonly', (st) => st.getAllKeys());
export const rawDeleteOriginal = (id) => tx('originals', 'readwrite', (st) => st.delete(id));
export const putChunk = async (id, i, blob) => { const k = key(id, i); return rawPutChunk(k, await enc('chunk', blob, k)); };
export async function getChunkBlob(id, i) {
  const k = key(id, i);
  const v = await rawGetChunk(k);
  if (v && v._enc && codec) return codec.decode('chunk', v, k);
  return v instanceof Blob ? v : new Blob([v]); // tolère l'ancien format (ArrayBuffer)
}
// Retire un morceau écrit par un import interrompu (jamais utilisé pour supprimer un enregistrement existant : l'import refuse d'écraser).
export const deleteChunk = (id, i) => tx('chunks', 'readwrite', (st) => st.delete(key(id, i)));
export async function getChunk(id, i) { return (await getChunkBlob(id, i)).arrayBuffer(); }

// Fichier d'origine d'un import (facultatif) : { blob, name, type }.
export const putOriginal = async (id, obj) => rawPutOriginal(id, await enc('original', obj, id));
export const getOriginal = async (id) => dec('original', await rawGetOriginal(id), id);

// Dossiers et trames (nouveaux espaces, version 3)
export const putFolder = async (f) => { refuse(f); return rawPutFolder(await enc('folder', f)); };
export const listFolders = async () => { const l = await rawListFolders(); return codec ? decList('folder', l) : l; };
export const deleteFolderRecord = (id) => tx('folders', 'readwrite', (st) => st.delete(id));
export const putTemplate = (t) => tx('templates', 'readwrite', (st) => st.put(t));
export const listTemplates = () => tx('templates', 'readonly', (st) => st.getAll());
export const deleteTemplateRecord = (id) => tx('templates', 'readwrite', (st) => st.delete(id));

export async function deleteSession(id) {
  await tx('chunks', 'readwrite', (st) => st.delete(IDBKeyRange.bound(`${id}:`, `${id}:￿`)));
  await tx('originals', 'readwrite', (st) => st.delete(id));
  await tx('sessions', 'readwrite', (st) => st.delete(id));
}
