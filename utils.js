// utils.js
// Pure helper functions extracted from app.js

export function escapeHtml(s) {
  return String(s).replace(/[&<>\"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[m])
  );
}

export function fmtSign(n) {
  n = Number(n) || 0;
  return (n >= 0 ? "+" : "") + n;
}

export function abilityMod(score) {
  return Math.floor((Number(score) - 10) / 2);
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
  return (Number(classes.sorc) || 0) + (Number(classes.wiz) || 0) + (Number(classes.um) || 0);
}

export function hpAverageD4(totalLvl) {
  totalLvl = Number(totalLvl) || 0;
  if (totalLvl <= 0) return 0;
  return 4 + (totalLvl - 1) * 3;
}

export function nextFrame() {
  return new
