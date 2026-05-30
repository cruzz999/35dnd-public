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

/* -------------------- label/value heuristics -------------------- */
// Known labels that appear on the sheet; used to avoid mistaking labels for values.
const KNOWN_LABELS = new Set([
  'CHARACTER NAME','CHARACTER','NAME','PLAYER NAME','PLAYER','ALIGN','ALIGNMENT','XP','EXPERIENCE','NEXT LEVEL XP',
  'CLASS','CLASS LINE','CLASSES','RACE','CAMPAIGN','SIZE','AGE','GENDER','DEITY',
  'ABILITY','STR','DEX','CON','INT','WIS','CHA','POINT BUY ARRAY','ASI','ITEMS PENALTIES/BUFFS',
  'HP','HIT POINTS','AC','ARMOR','SHIELD','MAGE ARMOR','SHIELD SPELL','FEATS','FEATS & SPECIAL ABILITIES',
  'SPEED','INIT','FORTITUDE','REFLEX','WILL','MELEE','RANGED','GRAPPLE'
]);

function looksLikeLabel(s) {
  if (!s) return false;
  const nk = normalizeKey(s);
  if (KNOWN_LABELS.has(nk)) return true;
  // short tokens like "Player", "Race", "Campaign" are likely labels
  if (/^[A-Z ]{1,20}$/.test(nk) && nk.split(' ').length <= 3 && nk.length <= 20 && nk === nk.toUpperCase()) {
    // but allow single-word names that contain vowels and lowercase letters in original
    return true;
  }
  return false;
}
function isPlausibleValueForLabel(label, v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim();
  if (!s) return false;
  const nk = normalizeKey(s);
  // If the candidate itself looks like a label, reject
  if (looksLikeLabel(s)) return false;
  // If label expects numeric (e.g., STR), prefer numeric
  if (/^(STR|DEX|CON|INT|WIS|CHA|HP|LEVEL|LVL|SPEED|INIT|XP)$/i.test(label)) {
    return !isNaN(Number(s.replace(/[^\d\.\-]/g,'')));
  }
  // For names, allow multi-word strings and letters
  if (/^(CHARACTER|PLAYER|RACE|CLASS|DEITY|ALIGNMENT|CAMPAIGN)$/i.test(label)) {
    return /[A-Za-z]/.test(s);
  }
  // default: accept if not a label
  return true;
}

/* -------------------- sheet helpers -------------------- */
/*
  findCell(labelCandidates, rows)
  - scans all cells; returns {r,c,labelCell,right,below}
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
        return { r, c, label: cell, right, below };
      }
    }
  }
  return null;
}

/*
  findAnyValueNear(labelCandidates, rows)
  - tries: right cell, below cell, then scans same row to the right, then scans next rows in same column,
    skipping cells that look like labels. Returns the first plausible value or null.
*/
function findAnyValueNear(labelCandidates, rows) {
  const found = findCell(labelCandidates, rows);
  if (!found) return null;
  const labelNk = normalizeKey(found.label);
  // candidates in order
  const candidates = [];
  if (found.right) candidates.push(found.right);
  if (found.below) candidates.push(found.below);
  // same row to the right
  const row = rows[found.r] || [];
  for (let cc = found.c+1; cc < Math.min(row.length, found.c+8); cc++) candidates.push(String(row[cc]||'').trim());
  // next few rows in same column
  for (let rr = found.r+1; rr < Math.min(rows.length, found.r+8); rr++) candidates.push(String((rows[rr]||[])[found.c]||'').trim());
  // also check a small rectangle to the right/below
  for (let rr = found.r; rr < Math.min(rows.length, found.r+4); rr++) {
    for (let cc = found.c+1; cc < Math.min((rows[rr]||[]).length, found.c+6); cc++) {
      candidates.push(String((rows[rr]||[])[cc]||'').trim());
    }
  }

  for (const cand of candidates) {
    if (!cand) continue;
    if (!isPlausibleValueForLabel(labelNk, cand)) continue;
    return cand;
  }
  return null;
}

/* -------------------- General parser (robust) -------------------- */
function parseGeneralFromLayout(rows, state) {
  if (!state.data) state.data = {};
  if (!state.data.general) state.data.general = {};
  const g = state.data.general;

  // Character name, player, XP, class, race
  const charVal = findAnyValueNear(['CHARACTER NAME','CHARACTER','NAME'], rows);
  if (charVal) g.characterName = String(charVal).trim();

  const playerVal = findAnyValueNear(['PLAYER NAME','PLAYER'], rows);
  if (playerVal) g.playerName = String(playerVal).trim();

  const xpVal = findAnyValueNear(['XP','EXPERIENCE','NEXT LEVEL XP'], rows);
  if (xpVal) g.xp = String(xpVal).trim();

  const classVal = findAnyValueNear(['CLASS','CLASS LINE','CLASSES'], rows);
  if (classVal) g.classLine = String(classVal).trim();

  const raceVal = findAnyValueNear(['RACE'], rows);
  if (raceVal) g.race = String(raceVal).trim();

  // If classLine or race accidentally equals a label, try alternate nearby search
  if (g.characterName && looksLikeLabel(g.characterName)) {
    // try to find a non-label nearby cell in the same row/column
    const alt = findAnyValueNear(['CHARACTER NAME','CHARACTER','NAME'], rows);
    if (alt && !looksLikeLabel(alt)) g.characterName = alt;
  }
  if (g.playerName && looksLikeLabel(g.playerName)) {
    const alt = findAnyValueNear(['PLAYER NAME','PLAYER'], rows);
    if (alt && !looksLikeLabel(alt)) g.playerName = alt;
  }
  if (g.classLine && looksLikeLabel(g.classLine)) {
    const alt = findAnyValueNear(['CLASS','CLASS LINE','CLASSES'], rows);
    if (alt && !looksLikeLabel(alt)) g.classLine = alt;
  }
  if (g.race && looksLikeLabel(g.race)) {
    const alt = findAnyValueNear(['RACE'], rows);
    if (alt && !looksLikeLabel(alt)) g.race = alt;
  }

  // Classes: parse classLine like "Sorcerer 1 / Wizard 5 / Ultimate Magus 2"
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
  }

  // Abilities: find rows that contain STR/DEX/CON/INT/WIS/CHA anywhere and read numeric nearby
  g.abilities = g.abilities || {};
  const abilityKeys = { STR:'str', DEX:'dex', CON:'con', INT:'int', WIS:'wis', CHA:'cha' };
  for (const label of Object.keys(abilityKeys)) {
    let found = null;
    for (let r=0;r<rows.length && !found;r++) {
      for (let c=0;c<(rows[r]||[]).length;c++) {
        const cell = String((rows[r]||[])[c]||'').trim();
        if (!cell) continue;
        const nk = normalizeKey(cell);
        if (nk === label || nk.startsWith(label+' ') || nk.includes(' '+label+' ')) {
          // look right, below, and a few nearby cells for numeric score
          const candidates = [];
          const right = (rows[r]||[])[c+1]; if (right !== undefined) candidates.push(right);
          const right2 = (rows[r]||[])[c+2]; if (right2 !== undefined) candidates.push(right2);
          const below = (rows[r+1]||[])[c]; if (below !== undefined) candidates.push(below);
          for (const cand of candidates) {
            const n = toNumber(cand, null);
            if (n !== null && String(cand).trim() !== '') { found = { r, c, value: n }; break; }
          }
          if (!found) {
            // scan same row to the right for first numeric
            for (let cc=c+1; cc<Math.min((rows[r]||[]).length, c+6); cc++) {
              const n = toNumber((rows[r]||[])[cc], null);
              if (n !== null && String((rows[r]||[])[cc]||'').trim() !== '') { found = { r, c, value: n }; break; }
            }
          }
          if (found) break;
        }
      }
    }
    const key = abilityKeys[label];
    g.abilities[key] = g.abilities[key] || { pointBuy:0, asi:0, items:0, buffs:0 };
    if (found && found.value !== undefined) {
      g.abilities[key].score = found.value;
    }
  }

  // AC and buffs: try to find AC, Mage Armor, Shield Spell
  g.ac = g.ac || { armor:0, shield:0, size:0, natural:0, deflect:0, misc:0, miscTouch:0 };
  const acVal = findAnyValueNear(['AC','ARMOR CLASS','ARMOR'], rows);
  if (acVal && !looksLikeLabel(acVal)) {
    const n = toNumber(acVal, null);
    if (n !== null) {
      // store as total AC if plausible; keep armor as best-effort (AC-10)
      g.ac.armor = Math.max(0, n - 10);
    }
  }
  const mageVal = findAnyValueNear(['MAGE ARMOR','MAGEARMOR'], rows);
  if (mageVal && !looksLikeLabel(mageVal)) g.buffs = g.buffs || {}, g.buffs.mageArmor = (/1|yes|true/i.test(String(mageVal)) ? 1 : 0);
  const shieldSpellVal = findAnyValueNear(['SHIELD SPELL','SHIELD SPELL?','SHIELD'], rows);
  if (shieldSpellVal && !looksLikeLabel(shieldSpellVal)) g.buffs = g.buffs || {}, g.buffs.shieldSpell = (/1|yes|true/i.test(String(shieldSpellVal)) ? 1 : 0);

  // Feats: scan a block labeled "Feats" or "Feats & special abilities"
  g.feats = g.feats || [];
  // find any cell whose normalized label contains FEAT
  let featsCell = null;
  for (let r=0;r<rows.length && !featsCell;r++) {
    for (let c=0;c<(rows[r]||[]).length;c++) {
      const cell = String((rows[r]||[])[c]||'').trim();
      if (!cell) continue;
      if (normalizeKey(cell).includes('FEAT')) { featsCell = { r, c }; break; }
    }
  }
  if (featsCell) {
    for (let rr = featsCell.r+1; rr < Math.min(rows.length, featsCell.r+40); rr++) {
      const v = String((rows[rr]||[])[featsCell.c] || (rows[rr]||[])[featsCell.c+1] || '').trim();
      if (!v) break;
      if (!looksLikeLabel(v)) g.feats.push({ label: v });
    }
  }

  console.info('[ingest] GENERAL parsed (robust):', g);
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
