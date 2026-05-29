// persistence/idb.js
// Minimal promise-based IndexedDB helper for 35dnd app.
// Usage: const db = await openDb(); await idbPut(db, 'spells', obj);

export async function openDb(name = '35dnd', version = 1) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('spells')) db.createObjectStore('spells', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('general')) db.createObjectStore('general', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('slots')) db.createObjectStore('slots', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('inkTiles')) db.createObjectStore('inkTiles', { keyPath: 'tileKey' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function idbGet(db, store, key) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export function idbPut(db, store, value) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const r = tx.objectStore(store).put(value);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export function idbGetAll(db, store) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
