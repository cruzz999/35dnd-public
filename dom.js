// dom.js
// Centralized DOM element map and helpers extracted from app.js

// $ helper kept for compatibility with existing code
export const $ = (id) => document.getElementById(id);

// el map: mirrors the original el = { ... } map from app.js
export const el = {
  file: $("file"),
  status: $("status"),
  progressBar: $("progressBar"),
  viewGeneral: $("viewGeneral"),
  viewSpells: $("viewSpells"),
  viewSlots: $("viewSlots"),
  viewSkills: $("viewSkills"),
  zoomOut: $("zoomOut"),
  zoomIn: $("zoomIn"),
  zoomReset: $("zoomReset"),
  penToggle: $("penToggle"),
  eraser: $("eraser"),
  undo: $("undo"),
  clearInk: $("clearInk"),
  viewport: $("viewport"),
  world: $("world"),
  app: $("app"),
  ink: $("inkWorld"),
  gsUrl: $("gsUrl"),
  loadGs: $("loadGs"),
  // convenience helpers
  query: (sel) => document.querySelector(sel),
};

// initDom is a no-op here but provided for parity with the extraction plan.
// If you prefer to rebuild the el map after DOMContentLoaded, call initDom()
// and reassign el.* entries. For now we keep the same behavior as original:
// document.getElementById calls executed at module load time (may be null until DOM ready).
export function initDom() {
  // Re-populate el entries in case DOM was not ready at module import time.
  // This mirrors the original behavior where document.getElementById was called
  // at script execution time; calling initDom after DOMContentLoaded will ensure
  // the map is populated.
  const ids = [
    "file", "status", "progressBar", "viewGeneral", "viewSpells", "viewSlots",
    "viewSkills", "zoomOut", "zoomIn", "zoomReset", "penToggle", "eraser",
    "undo", "clearInk", "viewport", "world", "app", "inkWorld", "gsUrl", "loadGs"
  ];
  for (const id of ids) {
    const key = id === "inkWorld" ? "ink" : id;
    el[key] = document.getElementById(id) || el[key];
  }
  return el;
}

export function assertEl(name) {
  if (!el[name]) console.warn(`Missing element #${name}`);
}

export function elById(id) {
  return document.getElementById(id);
}
