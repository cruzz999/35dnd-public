// src/ingest.js
import { parseCsv, csvRowsToObjects } from './utils.js';

/* -------------------- utilities -------------------- */
export function extractSpreadsheetId(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}
function normalizeKey(k) {
  return String(k || '').trim().replace(/[_\-\s]+/g,' ').toUpperCase();
}
function toNumber(v, fallback=0) {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  if (!s) return fallback;
  const n = Number(s.replace(/[^\d\.\-]/g,''));
  return Number.isFinite(n) ? n : fallback;
}
async function fetchCsvRows(url) {
  const r = await fetch(url, { cache: 'no-store' });
  const txt = await r.text();
  return parseCsv(txt);
}

/* -------------------- sheet helpers -------------------- */
/*
  findCell(labelCandidates, rows)
  - scans all cells; returns {r,c,valueCell,rightCell,belowCell}
  - labelCandidates: array of strings to match (case-insensitive, trimmed)
*/
function findCell(labelCandidates, rows) {
  const labels = (labelCandidates||[]).map(l => normalizeKey(l));
  for (let r=0;r<rows.length;r++) {
    const row = rows[r] || [];
    for (let c=0;c<row.length;c++) {
      const cell = String(row[c]||'').trim();
      if (!cell) continue;
      const nk = normalizeKey(cell);
      if (labels.includes(nk)) {
        const right = (row[c+1] !== undefined) ? String(row[c+1]||'').trim() : '';
        const below = (rows[r+1] && rows[r+1][c] !== undefined) ? String(rows[r+1][c]||'').trim() : '';
        return { r, c, label: cell, right, below, raw: row[c+1] };
      }
    }
  }
  return null;
}

/*
  findAnyValueNear(labelCandidates, rows)
  - tries: right cell, below cell, then searches same row for first non-empty cell after label column,
    then searches next few rows in same column for first non-empty.
*/
function findAnyValueNear(labelCandidates, rows) {
  const found = findCell(labelCandidates, rows);
  if (!found) return null;
  if (found.right && String(found.right).trim() !== '') return found.right;
  if (found.below && String(found.below).trim() !== '') return found.below;
  // scan same row to the right
  const row = rows[found.r] || [];
  for (let cc = found.c+1; cc < Math.min(row.length, found.c+6); cc++) {
    const v = String(row[cc]||'').trim();
    if (v) return v;
  }
  // scan next few rows in same column
  for (let rr = found.r+1; rr < Math.min(rows.length, found.r+6); rr++) {
    const v = String((rows[rr]||[])[found.c]||'').trim();
    if (v) return v;
  }
  return null;
}

/* -------------------- General parser (layout-aware) -------------------- */
function parseGeneralFromLayout(rows, state) {
  if (!state.data) state.data = {};
  if (!state.data.general) state.data.general = {};
  const g = state.data.general;

  // Candidate labels (cover common variants)
  const charVal = findAnyValueNear(['CHARACTER NAME','CHARACTER','NAME'], rows);
  if (charVal) g.characterName = String(charVal).trim();

  const playerVal = findAnyValueNear(['PLAYER NAME','PLAYER'], rows);
  if (playerVal) g.playerName = String(playerVal).trim();

  const xpVal = findAnyValueNear(['XP','EXPERIENCE'], rows);
  if (xpVal) g.xp = String(xpVal).trim();

  const classVal = findAnyValueNear(['CLASS','CLASS LINE','CLASSES'], rows);
  if (classVal) g.classLine = String(classVal).trim();

  const raceVal = findAnyValueNear(['RACE'], rows);
  if (raceVal) g.race = String(raceVal).trim();

  // If classLine present, try to parse numeric classes
  g.classes = g.classes || { sorc:0, wiz:0, um:0 };
  if (g.classLine) {
    const parts = String(g.classLine).split(/[\/,;]/).map(s=>s.trim());
    for (const p of parts) {
      const m = p.match(/([A-Za-z ]+)\s+(\d+)/);
      if (!m) continue;
      const name = m[1].toLowerCase();
      const lvl = toNumber(m[2],0);
      if (/sorc|sorcerer/.test(name)) g.classes.sorc = lvl;
      else if (/wiz|wizard/.test(name)) g.classes.wiz = lvl;
      else if (/ultimate magus|um/.test(name)) g.classes.um = lvl;
    }
  } else {
    // fallback: try to find explicit class rows
    const s = findAnyValueNear(['SORC','SORCERER','SORC LEVEL','SORC LEVELS'], rows);
    const w = findAnyValueNear(['WIZ','WIZARD','WIZ LEVEL','WIZ LEVELS'], rows);
    const u = findAnyValueNear(['UM','ULTIMATE MAGUS','UM LEVEL'], rows);
    if (s) g.classes.sorc = toNumber(s, g.classes.sorc);
    if (w) g.classes.wiz = toNumber(w, g.classes.wiz);
    if (u) g.classes.um = toNumber(u, g.classes.um);
  }

  // Abilities: find rows that contain STR/DEX/CON/INT/WIS/CHA anywhere
  g.abilities = g.abilities || {};
  const abilityKeys = { STR:'str', DEX:'dex', CON:'con', INT:'int', WIS:'wis', CHA:'cha' };
  for (const label of Object.keys(abilityKeys)) {
    // find any cell equal to label or containing label
    let found = null;
    for (let r=0;r<rows.length && !found;r++) {
      for (let c=0;c<(rows[r]||[]).length;c++) {
        const cell = String((rows[r]||[])[c]||'').trim();
        if (!cell) continue;
        const nk = normalizeKey(cell);
        if (nk === label || nk.startsWith(label+' ') || nk.includes(' '+label+' ')) {
          // value likely to the right or in next column
          const right = String((rows[r]||[])[c+1]||'').trim();
          const below = String(((rows[r+1]||[])[c])||'').trim();
          const candidate = right || below || (rows[r]||[]).slice(c+1,c+4).find(x=>String(x||'').trim());
          if (candidate) {
            found = { r, c, value: candidate };
            break;
          }
        }
      }
    }
    const key = abilityKeys[label];
    g.abilities[key] = g.abilities[key] || { pointBuy:0, asi:0, items:0, buffs:0 };
    if (found && found.value) {
      // value might be a score or a point-buy number; try to coerce
      const n = toNumber(found.value, null);
      if (n !== null && n !== 0) {
        // If the sheet shows the actual score (e.g., 8,12,15), we can't reliably map to pointBuy.
        // We'll store the score in 'score' and leave pointBuy as-is.
        g.abilities[key].score = n;
      } else {
        // fallback: if it's not numeric, ignore
      }
    }
  }

  // AC and buffs: try to find AC, Mage Armor, Shield Spell
  g.ac = g.ac || { armor:0, shield:0, size:0, natural:0, deflect:0, misc:0, miscTouch:0 };
  const armorVal = findAnyValueNear(['ARMOR','ARMOR CLASS','AC'], rows);
  if (armorVal) {
    // If armorVal is a number or contains numbers, try to extract numeric part
    const n = toNumber(armorVal, null);
    if (n !== null) g.ac.armor = n - 10; // if AC total given, store armor as AC-10 (best-effort)
  }
  const mageVal = findAnyValueNear(['MAGE ARMOR','MAGEARMOR'], rows);
  if (mageVal) g.buffs = g.buffs || {}, g.buffs.mageArmor = (/1|yes|true/i.test(String(mageVal)) ? 1 : 0);
  const shieldSpellVal = findAnyValueNear(['SHIELD SPELL','SHIELD SPELL?','SHIELD'], rows);
  if (shieldSpellVal) g.buffs = g.buffs || {}, g.buffs.shieldSpell = (/1|yes|true/i.test(String(shieldSpellVal)) ? 1 : 0);

  // Feats: scan a block labeled "Feats" or "Feats & special abilities"
  g.feats = g.feats || [];
  const featsCell = findCell(['FEATS','FEATS & SPECIAL ABILITIES','FEATS & SPECIAL'], rows);
  if (featsCell) {
    // collect subsequent non-empty rows in same column or adjacent column
    const startR = featsCell.r + 1;
    for (let rr = startR; rr < Math.min(rows.length, startR + 40); rr++) {
      const v = String((rows[rr]||[])[featsCell.c] || (rows[rr]||[])[featsCell.c+1] || '').trim();
      if (!v) break;
      g.feats.push({ label: v });
    }
  }

  console.info('[ingest] GENERAL parsed (layout-aware):', g);
}

/* -------------------- Spells parser (gid=0) -------------------- */
function applySpellsFromObjects(objs, state) {
  state.data = state.data || {};
  state.data.spells = { sorc: [], wiz: [], meta: {} };
  for (const row of objs) {
    if (!row) continue;
    const norm = {};
    Object.keys(row).forEach(k => norm[normalizeKey(k)] = k);
    const read = (...names) => {
      for (const n of names) {
        const nk = normalizeKey(n);
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
  console.info('[ingest] SPELLS parsed:', state.data.spells);
}

/* -------------------- main loader -------------------- */
export async function loadFromGoogleSheets(url, state, render, setProgress) {
  setProgress?.(5, 'Starting sheet load...');
  const sheetId = extractSpreadsheetId(url);
  if (!sheetId) {
    setProgress?.(0, 'Invalid Google Sheets URL');
    return { ok:false };
  }

  try {
    // General layout tab (your provided gid)
    const generalGid = 2004670713;
    const generalUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${generalGid}`;
    const generalRows = await fetchCsvRows(generalUrl);
    parseGeneralFromLayout(generalRows, state);

    // Spells table (gid 0)
    const spellsGid = 0;
    const spellsUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${spellsGid}`;
    const spellsRows = await fetchCsvRows(spellsUrl);
    const spellsObjs = csvRowsToObjects(spellsRows);
    applySpellsFromObjects(spellsObjs, state);

    state.loaded = true;
    render?.();
    setProgress?.(100, 'Sheet loaded');
    return { ok:true };
  } catch (err) {
    console.error('[ingest] load error', err);
    setProgress?.(0, 'Sheet load failed');
    return { ok:false, error: String(err) };
  }
}
