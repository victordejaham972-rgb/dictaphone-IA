// Stockage local (IndexedDB) : sessions + morceaux audio de 30 s + fichiers d'origine importés.
// Tout reste dans le navigateur du téléphone, rien n'est envoyé ailleurs.
// Les morceaux audio sont stockés sous forme de Blob : le navigateur peut les garder sur disque
// et les réassembler pour la lecture sans tout charger en mémoire (à vérifier sur iPhone).
const NAME = 'dictaphone-proto';
let dbPromise = null;

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      if (!db.objectStoreNames.contains('originals')) db.createObjectStore('originals');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx(store, mode, fn) {
  const db = await (dbPromise ||= open());
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

export const putSession = (s) => tx('sessions', 'readwrite', (st) => st.put(s));
export const getSession = (id) => tx('sessions', 'readonly', (st) => st.get(id));
export const listSessions = () => tx('sessions', 'readonly', (st) => st.getAll());

// Un morceau = Blob (PCM 16 bits, 16 kHz, mono).
export const putChunk = (id, i, blob) => tx('chunks', 'readwrite', (st) => st.put(blob, key(id, i)));
export async function getChunkBlob(id, i) {
  const v = await tx('chunks', 'readonly', (st) => st.get(key(id, i)));
  return v instanceof Blob ? v : new Blob([v]); // tolère l'ancien format (ArrayBuffer)
}
export async function getChunk(id, i) { return (await getChunkBlob(id, i)).arrayBuffer(); }

// Fichier d'origine d'un import (facultatif) : { blob, name, type }.
export const putOriginal = (id, obj) => tx('originals', 'readwrite', (st) => st.put(obj, id));
export const getOriginal = (id) => tx('originals', 'readonly', (st) => st.get(id));

export async function deleteSession(id) {
  await tx('chunks', 'readwrite', (st) => st.delete(IDBKeyRange.bound(`${id}:`, `${id}:￿`)));
  await tx('originals', 'readwrite', (st) => st.delete(id));
  await tx('sessions', 'readwrite', (st) => st.delete(id));
}
