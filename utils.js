// utils.js
// Pure helper functions used across the app

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtSign(n) {
  if (n == null || n === '') return '';
  const v = Number(n);
  if (Number.isNaN(v)) return String(n);
  return (v >= 0 ? '+' : '') + v;
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function abilityMod(score) {
  const s = Number(score) || 0;
  return Math.floor((s - 10) / 2);
}

export function babPoor(level) {
  level = Number(level) || 0;
  return Math.floor(level / 2);
}

export function saveGood(level) {
  level = Number(level) || 0;
  return 2 + Math.floor(level / 2);
}

export function savePoor(level) {
  level = Number(level) || 0;
  return Math.floor(level / 3);
}

export function totalLevel(classes) {
  if (!classes || typeof classes !== 'object') return 0;
  // sum numeric properties (fallback for your sheet's class object)
  return Object.values(classes).reduce((sum, v) => sum + (Number(v) || 0), 0);
}

export function hpAverageD4(totalLvl) {
  const l = Number(totalLvl) || 0;
  if (l <= 0) return 0;
  // average of d4 is 2.5 -> approximate as 3 for first + 3 per level-1 as original logic
  return Math.round(4 + (l - 1) * 3);
}

export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function nextFrame(cb) {
  return window.requestAnimationFrame(cb);
}
