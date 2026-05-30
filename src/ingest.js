// src/ingest.js
import { parseCsv, csvRowsToObjects } from './utils.js';

/*
  Ingest implementation tailored to the trimmed 2D layout described by the user.
  - General tab gid: 2004670713
  - Spells tab gid: 0
  - Trimmed rows mapping (0-based indices) per user's spec:
      0  -> [Character name, Player name, Alignment, '', Next level XP, ...]
      1  -> irrelevant
      2  -> [Class line, ..., ..., Race, ...]
      4  -> [Level sum, Size, Age, Gender, Height, Weight, Eyes, Hair]
      7..12 -> abilities rows: [Label, Score, Mod, TempScore, TempMod, '', ItemsMod, Buffs, PointBuy, ASI, ...]
      14 -> HP row: ["HP", MaxHP, CurrentHP, "", "", "", "", HitDice]
      feats start at trimmed index 33 -> first non-empty cell per row is a feat
*/

export function extractSpreadsheetId(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([A-Za-z0-9-_]+)/);
  return m ? m[1] : null;
}

const GENERAL_GID = 2004670713;
const SPELLS_GID  = 0;

// Utility: convert column index to A1 (for debug if needed)
function colToA(c) {
  let n = c + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function toNumber(v, fallback = null) {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  if (s === '') return fallback;
  const n = Number(s.replace(/[^\d\.\-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

// Fetch CSV and parse to rows (uses app's parseCsv if available)
async function fetchCsvRows(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Fetch failed ${r.status} ${url}`);
  const txt = await r.text();
  // prefer app parser
  try {
    return parseCsv(txt);
  } catch (e) {
    // fallback naive parse (handles simple CSV)
    return txt.split(/\r?\n/).map(line => {
      const parts = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === ',' && !inQ) { parts.push(cur); cur = ''; continue; }
        cur += ch;
      }
      parts.push(cur);
      return parts;
    });
  }
}

// Normalize 2D: remove fully empty rows and trim trailing empty cells
function normalize2d(rows) {
  const cleaned = (rows || []).map(r => (r || []).map(c => (c === undefined || c === null) ? '' : String(c).trim()))
    .filter(r => r.some(c => c !== ''))
    .map(r => {
      let last = r.length - 1;
      while (last >= 0 && r[last] === '') last--;
      return r.slice(0, last + 1);
    });
  return cleaned;
}

// Read first non-empty cell in a row
function firstNonEmptyInRow(row) {
  if (!row) return null;
  for (let i = 0; i < row.length; i++) {
    const v = String(row[i] || '').trim();
    if (v !== '') return v;
  }
  return null;
}

/* ---------------- General ingestion according to mapping ---------------- */
function ingestGeneralFromTrimmedRows(rows, state) {
  if (!state.data) state.data = {};
  if (!state.data.general) state.data.general = {};
  const g = state.data.general;

  // safe getters
  const row = (i) => (rows[i] || []);
  const cell = (r, c) => {
    const rr = rows[r] || [];
    return rr[c] !== undefined ? String(rr[c]).trim() : '';
  };

  // Row 0
  const r0 = row(0);
  g.characterName = r0[0] || g.characterName || '';
  g.playerName = r0[1] || g.playerName || '';
  g.alignment = r0[2] || g.alignment || '';
  g.nextLevelXP = r0[4] || g.nextLevelXP || '';

  // Row 2
  const r2 = row(2);
  g.classLine = r2[0] || g.classLine || '';
  g.race = r2[3] || g.race || '';

  // Row 4
  const r4 = row(4);
  g.levelSum = r4[0] || g.levelSum || '';
  g.size = r4[1] || g.size || '';
  g.age = r4[2] || g.age || '';
  g.gender = r4[3] || g.gender || '';
  g.height = r4[4] || g.height || '';
  g.weight = r4[5] || g.weight || '';
  g.eyes = r4[6] || g.eyes || '';
  g.hair = r4[7] || g.hair || '';

  // Abilities rows 7..12
  const abilityOrder = ['str','dex','con','int','wis','cha'];
  g.abilities = g.abilities || {};
  for (let i = 0; i < abilityOrder.length; i++) {
    const ridx = 7 + i;
    const r = row(ridx);
    const label = r[0] || abilityOrder[i];
    const scoreRaw = r[1] !== undefined ? r[1] : '';
    const mod = r[2] !== undefined ? r[2] : '';
    const tempScore = r[3] !== undefined ? r[3] : '';
    const tempMod = r[4] !== undefined ? r[4] : '';
    const itemsMod = r[6] !== undefined ? r[6] : '';
    const buffs = r[7] !== undefined ? r[7] : '';
    const pointBuy = r[8] !== undefined ? r[8] : '';
    const asi = r[9] !== undefined ? r[9] : '';

    const scoreNum = toNumber(scoreRaw, null);

    g.abilities[abilityOrder[i]] = {
      label,
      score: scoreNum !== null ? scoreNum : (scoreRaw === '' ? null : scoreRaw),
      mod: mod === '' ? null : mod,
      tempScore: tempScore === '' ? null : tempScore,
      tempMod: tempMod === '' ? null : tempMod,
      itemsMod: itemsMod === '' ? null : itemsMod,
      buffs: buffs === '' ? null : buffs,
      pointBuy: pointBuy === '' ? null : pointBuy,
      asi: asi === '' ? null : asi
    };
  }

  // HP row 14
  const rHp = row(14);
  g.hp = {
    label: rHp[0] || 'HP',
    max: rHp[1] !== undefined ? rHp[1] : '',
    current: rHp[2] !== undefined ? rHp[2] : '',
    hitDice: rHp[7] !== undefined ? rHp[7] : ''
  };

  // Feats from trimmed index 33 onward
  g.feats = g.feats || [];
  for (let i = 33; i < rows.length; i++) {
    const val = firstNonEmptyInRow(rows[i]);
    if (val) g.feats.push({ label: val });
  }

  // Try to parse classes from classLine if present (sorc/wiz/um)
  g.classes = g.classes || { sorc: 0, wiz: 0, um: 0 };
  if (g.classLine) {
    const parts = String(g.classLine).split(/[\/,;]/).map(s => s.trim());
    for (const p of parts) {
      const m = p.match(/([A-Za-z ]+)\s+(\d+)/);
      if (!m) continue;
      const name = m[1].toLowerCase();
      const lvl = toNumber(m[2], 0) || 0;
      if (/sorc|sorcerer/.test(name)) g.classes.sorc = lvl;
      else if (/wiz|wizard/.test(name)) g.classes.wiz = lvl;
      else if (/ultimate magus|um/.test(name)) g.classes.um = lvl;
    }
  }

  console.info('[ingest] GENERAL applied from trimmed rows:', g);
}

/* ---------------- Spells ingestion (header table, gid=0) ---------------- */
function ingestSpellsFromObjects(objs, state) {
  state.data = state.data || {};
  state.data.spells = { sorc: [], wiz: [], meta: {} };
  for (const row of objs) {
    if (!row) continue;
    const norm = {};
    Object.keys(row).forEach(k => norm[String(k).trim().toUpperCase()] = k);
    const read = (...names) => {
      for (const n of names) {
        const nk = String(n).trim().toUpperCase();
        if (norm[nk] !== undefined) return row[norm[nk]];
      }
      return undefined;
    };
    const name = read('Spell', 'Name');
    if (!name || String(name).trim() === '') continue;
    const level = toNumber(read('Level', 'Lvl'), 0);
    const list = read('List') || '';
    const spell = { name: String(name).trim(), level, list: String(list).trim() };
    if (/sorc/i.test(spell.list)) state.data.spells.sorc.push(spell);
    if (/wiz/i.test(spell.list)) state.data.spells.wiz.push(spell);
  }
  console.info('[ingest] SPELLS applied:', state.data.spells);
}

/* ---------------- Main loader ---------------- */
export async function loadFromGoogleSheets(url, state, render, setProgress) {
  setProgress?.(5, 'Loading Google Sheet...');
  const sheetId = extractSpreadsheetId(url);
  if (!sheetId) {
    setProgress?.(0, 'Invalid Google Sheets URL');
    return { ok: false, error: 'invalid-url' };
  }

  try {
    // General tab
    const generalUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${GENERAL_GID}`;
    const rawGeneralRows = await fetchCsvRows(generalUrl);
    const trimmed = normalize2d(rawGeneralRows);

    // Ingest general from trimmed rows
    ingestGeneralFromTrimmedRows(trimmed, state);

    // Spells tab
    const spellsUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${SPELLS_GID}`;
    const rawSpellsRows = await fetchCsvRows(spellsUrl);
    const spellsObjs = csvRowsToObjects(rawSpellsRows);
    ingestSpellsFromObjects(spellsObjs, state);

    state.loaded = true;
    render?.();
    setProgress?.(100, 'Sheet loaded');

    // Expose last ingest for debugging and copy to clipboard
    const result = { general: state.data.general, spells: state.data.spells, _trimmedRows: trimmed };
    try { await navigator.clipboard.writeText(JSON.stringify(result, null, 2)); } catch (e) { /* ignore */ }
    window._lastIngest = result;
    console.log('[ingest] finished — window._lastIngest available');
    return { ok: true, result };
  } catch (err) {
    console.error('[ingest] load error', err);
    setProgress?.(0, 'Sheet load failed');
    return { ok: false, error: String(err) };
  }
}
