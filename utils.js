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

export function totalLevel(classes) {
  if (!classes || !Array.isArray(classes)) return 0;
  return classes.reduce((sum, c) => sum + (Number(c.level) || 0), 0);
}

export function hpAverage(die, levels) {
  const d = Number(die) || 0;
  const l = Number(levels) || 0;
  if (d <= 0 || l <= 0) return 0;
  // average roll of a dN is (N+1)/2
  return Math.round(l * ((d + 1) / 2));
}

export function uuid() {
  // simple RFC4122 v4-like id for local use
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function nextFrame(cb) {
  return window.requestAnimationFrame(cb);
}
