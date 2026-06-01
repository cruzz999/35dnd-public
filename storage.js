// storage.js
// Ultra-conservative storage wrapper.
// Intentionally thin: localStorage-backed, no schema system, no migrations,
// no app-state knowledge, and no ink-specific behavior.
//
// Safe first use cases:
// - line width preference
// - slot usage persistence
//
// Leave ink storage alone for now if you want maximum caution.

(function (global) {
  const AppStorage = {};

  function hasStorage() {
    try {
      return typeof localStorage !== "undefined" && localStorage !== null;
    } catch {
      return false;
    }
  }

  function has(key) {
    if (!hasStorage()) return false;
    try {
      return localStorage.getItem(String(key)) !== null;
    } catch {
      return false;
    }
  }

  function remove(key) {
    if (!hasStorage()) return false;
    try {
      localStorage.removeItem(String(key));
      return true;
    } catch {
      return false;
    }
  }

  function readString(key, fallback = "") {
    if (!hasStorage()) return fallback;
    try {
      const raw = localStorage.getItem(String(key));
      return raw != null ? raw : fallback;
    } catch {
      return fallback;
    }
  }

  function writeString(key, value) {
    if (!hasStorage()) return false;
    try {
      localStorage.setItem(String(key), String(value));
      return true;
    } catch {
      return false;
    }
  }

  function readNumber(key, fallback = 0) {
    const raw = readString(key, "");
    if (raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  function writeNumber(key, value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    return writeString(key, String(n));
  }

  function readJson(key, fallback = null) {
    if (!hasStorage()) return fallback;
    try {
      const raw = localStorage.getItem(String(key));
      if (raw == null || raw === "") return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    if (!hasStorage()) return false;
    try {
      localStorage.setItem(String(key), JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  // Optional small helper for namespaced keys.
  // Keep this generic and boring on purpose.
  function key(...parts) {
    return parts
      .filter(part => part != null && part !== "")
      .map(part => String(part))
      .join(":");
  }

  AppStorage.hasStorage = hasStorage;
  AppStorage.has = has;
  AppStorage.remove = remove;

  AppStorage.readString = readString;
  AppStorage.writeString = writeString;

  AppStorage.readNumber = readNumber;
  AppStorage.writeNumber = writeNumber;

  AppStorage.readJson = readJson;
  AppStorage.writeJson = writeJson;

  AppStorage.key = key;

  global.AppStorage = AppStorage;
})(window);
