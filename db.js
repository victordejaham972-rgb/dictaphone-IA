// Stockage local (IndexedDB) : sessions + morceaux audio de 30 s.
// Tout reste dans le navigateur du téléphone, rien n'est envoyé ailleurs.
const NAME = 'dictaphone-proto';
let dbPromise = null;

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('sessions', { keyPath: 'id' });
      r.result.createObjectStore('chunks');
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
export const putChunk = (id, i, buffer) => tx('chunks', 'readwrite', (st) => st.put(buffer, key(id, i)));
export const getChunk = (id, i) => tx('chunks', 'readonly', (st) => st.get(key(id, i)));

export async function deleteSession(id) {
  await tx('chunks', 'readwrite', (st) => st.delete(IDBKeyRange.bound(`${id}:`, `${id}:￿`)));
  await tx('sessions', 'readwrite', (st) => st.delete(id));
}
