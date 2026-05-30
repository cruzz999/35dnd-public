// src/ingest.js
import { parseCsv, csvRowsToObjects } from './utils.js';

/*
  Simple cell-address based ingest.

  Edit CELL_MAP to point fields to exact cells in your sheet.
  Example: 'B1' means column B row 1 (1-indexed).
*/

const CELL_MAP = {
  // Basic identity fields (edit these to match your sheet)
  characterName: 'A1',   // user suggested A1
  playerName:    'B1',
  xp:            'E1',
  classLine:     'A4',
  race:          'D4',

  // Abilities: point these at the cell that contains the numeric score
  // Defaults are placeholders — change to the real cells in your sheet
  str: 'D12',
  dex: 'D13',
  con: 'D14',
  int: 'D15',
  wis: 'D16',
  cha: 'D17',

  // AC / buffs
  acTotal: 'B21',        // if sheet shows total AC
  mageArmor: 'D5',      // cell that contains "1" or "yes" if mage armor active
  shieldSpell: 'D6',

  // Feats block: starting cell (column,row) and number of rows to read
  featsStart: 'A46',
  featsCount: 20
};

// GIDs for tabs (already provided)
const GENERAL_GID = 2004670713;
const SPELLS_GID  = 0;

/* ---------------- utilities ---------------- */

export function extractSpreadsheetId(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

function colLetterToIndex(letters) {
  // A -> 0, B -> 1, Z -> 25, AA -> 26, etc.
  let s = String(letters).toUpperCase().replace(/[^A-Z]/g,'');
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n - 1;
}

function parseCellAddr(addr) {
  // "B12" -> {r:11, c:1}
  if (!addr || typeof addr !== 'string') return null;
  const m = addr.match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return null;
  const c = colLetterToIndex(m[1]);
  const r = parseInt(m[2], 10) - 1;
  return { r, c };
}

function getCell(rows, addr) {
  const p = parseCellAddr(addr);
  if (!p) return null;
  const row = rows[p.r] || [];
  const val = row[p.c];
  return val === undefined ? null : String(val).trim();
}

function toNumber(v, fallback = 0) {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  if (!s) return fallback;
  const n = Number(s.replace(/[^\d\.\-]/g,''));
  return Number.isFinite(n) ? n : fallback;
}

/* ---------------- parsing functions ---------------- */

async function fetchCsvRows(url) {
  const r = await fetch(url, { cache: 'no-store' });
  const txt = await r.text();
  return parseCsv(txt); // returns array of rows (arrays)
}

function applyCellMapToGeneral(rows, state) {
  if (!state.data) state.data = {};
  if (!state.data.general) state.data.general = {};
  const g = state.data.general;

  // Basic fields
  g.characterName = getCell(rows, CELL_MAP.characterName) || g.characterName || 'Unnamed';
  g.playerName    = getCell(rows, CELL_MAP.playerName) || g.playerName || '';
  g.xp            = getCell(rows, CELL_MAP.xp) || g.xp || '';
  g.classLine     = getCell(rows, CELL_MAP.classLine) || g.classLine || '';
  g.race          = getCell(rows, CELL_MAP.race) || g.race || '';

  // Abilities: store numeric score under .score and leave pointBuy/asi untouched
  g.abilities = g.abilities || {};
  const abilityKeys = ['str','dex','con','int','wis','cha'];
  abilityKeys.forEach(k => {
    const addr = CELL_MAP[k];
    const val = addr ? getCell(rows, addr) : null;
    g.abilities[k] = g.abilities[k] || { pointBuy:0, asi:0, items:0, buffs:0 };
    if (val !== null && val !== '') {
      const n = toNumber(val, null);
      if (n !== null) g.abilities[k].score = n;
      else g.abilities[k].scoreRaw = val;
    }
  });

  // AC and buffs
  const acTotal = getCell(rows, CELL_MAP.acTotal);
  if (acTotal) {
    const n = toNumber(acTotal, null);
    if (n !== null) {
      g.ac = g.ac || {};
      // best-effort: store armor as AC-10 if total AC provided
      g.ac.armor = Math.max(0, n - 10);
    }
  }
  const mage = getCell(rows, CELL_MAP.mageArmor);
  if (mage) g.buffs = g.buffs || {}, g.buffs.mageArmor = (/1|yes|true/i.test(mage) ? 1 : 0);
  const shield = getCell(rows, CELL_MAP.shieldSpell);
  if (shield) g.buffs = g.buffs || {}, g.buffs.shieldSpell = (/1|yes|true/i.test(shield) ? 1 : 0);

  // Feats: read a vertical block starting at featsStart for featsCount rows
  g.feats = [];
  if (CELL_MAP.featsStart) {
    const start = parseCellAddr(CELL_MAP.featsStart);
    const count = Number.isFinite(Number(CELL_MAP.featsCount)) ? Number(CELL_MAP.featsCount) : 12;
    if (start) {
      for (let i = 0; i < count; i++) {
        const r = start.r + i;
        const c = start.c;
        const v = (rows[r] && rows[r][c]) ? String(rows[r][c]).trim() : '';
        if (!v) break;
        g.feats.push({ label: v });
      }
    }
  }

  // Try to parse classes from classLine if present
  g.classes = g.classes || { sorc:0, wiz:0, um:0 };
  if (g.classLine) {
    const parts = String(g.classLine).split(/[\/,;]/).map(s=>s.trim());
    for (const p of parts) {
      const m = p.match(/([A-Za-z ]+)\s+(\d+)/);
      if (!m) continue;
      const name = m[1].toLowerCase();
      const lvl = toNumber(m[2], 0);
      if (/sorc|sorcerer/.test(name)) g.classes.sorc = lvl;
      else if (/wiz|wizard/.test(name)) g.classes.wiz = lvl;
      else if (/ultimate magus|um/.test(name)) g.classes.um = lvl;
    }
  }

  console.info('[ingest] applied CELL_MAP to general:', g);
}

/* ---------------- spells (header table) ---------------- */

function applySpellsFromObjects(objs, state) {
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
    const name = read('Spell','Name');
    if (!name || String(name).trim() === '') continue;
    const level = toNumber(read('Level','Lvl'), 0);
    const list = read('List') || '';
    const spell = { name: String(name).trim(), level, list: String(list).trim() };
    if (/sorc/i.test(spell.list)) state.data.spells.sorc.push(spell);
    if (/wiz/i.test(spell.list)) state.data.spells.wiz.push(spell);
  }
  console.info('[ingest] spells applied:', state.data.spells);
}

/* ---------------- main loader ---------------- */

export async function loadFromGoogleSheets(url, state, render, setProgress) {
  setProgress?.(5, 'Loading sheet (cell map)...');
  const sheetId = extractSpreadsheetId(url);
  if (!sheetId) {
    setProgress?.(0, 'Invalid Google Sheets URL');
    return { ok:false };
  }

  try {
    // General tab (fixed gid)
    const generalUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${GENERAL_GID}`;
    const generalRows = await fetchCsvRows(generalUrl);
    applyCellMapToGeneral(generalRows, state);

    // Spells tab (gid 0)
    const spellsUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${SPELLS_GID}`;
    const spellsRows = await fetchCsvRows(spellsUrl);
    const spellsObjs = csvRowsToObjects(spellsRows);
    applySpellsFromObjects(spellsObjs, state);

    state.loaded = true;
    render?.();
    setProgress?.(100, 'Sheet loaded (cell map)');
    return { ok:true };
  } catch (err) {
    console.error('[ingest] error', err);
    setProgress?.(0, 'Sheet load failed');
    return { ok:false, error: String(err) };
  }
}
