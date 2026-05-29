// persistence/idb.js
// Minimal IndexedDB helper used by data/slots.js and app.js

const DB_NAME = "dnd35d";
const DB_VERSION = 1;
const STORE_NAMES = ["slots", "meta"];

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      for (const s of STORE_NAMES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function idbPut(db, storeName, value) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const r = store.put(value);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    } catch (err) {
      reject(err);
    }
  });
}

export function idbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const r = store.get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    } catch (err) {
      reject(err);
    }
  });
}

export function idbGetAll(db, storeName) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    } catch (err) {
      reject(err);
    }
  });
}
