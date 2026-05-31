// dom.js
// Centralized DOM element map and helpers

let el = {};
let initialized = false;

export function initDom() {
  if (initialized) return el;
  // Build the element map used across the app
  el = {
    app: document.getElementById('app'),
    world: document.getElementById('world'),
    canvas: document.getElementById('ink-canvas'),
    fileInput: document.getElementById('file'),
    googleBtn: document.getElementById('google-load'),
    viewGeneralBtn: document.getElementById('view-general'),
    viewSpellsBtn: document.getElementById('view-spells'),
    // add other commonly used ids here
    // Example: stats container, spells container, toolbar buttons
    toolbar: document.getElementById('toolbar'),
    progress: document.getElementById('progress'),
    // fallback query helper
    query: selector => document.querySelector(selector),
  };

  initialized = true;
  return el;
}

export function assertEl(name) {
  if (!initialized) throw new Error('DOM not initialized. Call initDom() first.');
  if (!el[name]) throw new Error(`Missing element in el map: ${name}`);
  return el[name];
}

export function elById(id) {
  return document.getElementById(id);
}

export { el };
