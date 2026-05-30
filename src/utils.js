// src/utils.js
export function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
export function fmtSign(n) { n = Number(n)||0; return (n>=0?'+':'')+n; }
export function abilityMod(score) { return Math.floor((Number(score||0)-10)/2); }

// Simple CSV parser (handles quoted fields)
export function parseCsv(text) {
  const rows = [];
  let cur = [];
  let curField = '';
  let inQuotes = false;
  for (let i=0;i<text.length;i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i+1] === '"') { curField += '"'; i++; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i+1] === '\n') { /* skip */ }
      cur.push(curField); curField = ''; rows.push(cur); cur = []; continue;
    }
    if (!inQuotes && ch === ',') { cur.push(curField); curField = ''; continue; }
    curField += ch;
  }
  if (curField !== '' || cur.length) { cur.push(curField); rows.push(cur); }
  return rows;
}

export function csvRowsToObjects(rows) {
  if (!rows || rows.length === 0) return [];
  const headers = rows[0].map(h => String(h||'').trim());
  const out = [];
  for (let r=1;r<rows.length;r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const obj = {};
    for (let c=0;c<headers.length;c++) obj[headers[c]] = row[c] !== undefined ? row[c] : '';
    out.push(obj);
  }
  return out;
}
