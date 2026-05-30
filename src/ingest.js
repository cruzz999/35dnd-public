// src/ingest.js
import { parseCsv, csvRowsToObjects } from './utils.js';

export function extractSpreadsheetId(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

async function tryFetchText(u, opts = {}) {
  try {
    const r = await fetch(u, Object.assign({ cache: 'no-store' }, opts));
    const text = await r.text().catch(()=>null);
    return { ok: r.ok, status: r.status, text };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Utility: normalize a header string to a canonical key
function normalizeKey(k) {
  if (!k && k !== 0) return '';
  return String(k).trim().replace(/\s+/g, ' ').replace(/[_\-]/g, ' ').toUpperCase();
}

// Utility: parse a numeric-ish value robustly
function toNumber(v, fallback = 0) {
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  const n = Number(String(v).replace(/[^\d\.\-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

// Find first non-empty row object (after csvRowsToObjects)
function findFirstNonEmptyObject(objs) {
  if (!Array.isArray(objs)) return null;
  for (const o of objs) {
    if (!o) continue;
    const values = Object.values(o).map(v => String(v||'').trim());
    const any = values.some(v => v !== '');
    if (any) return o;
  }
  return null;
}

/**
 * Robust mapping: accepts many header variants and maps into state.data.general
 */
export function applySheetRowToGeneralDetailed(row, state, render) {
  if (!state) return;
  if (!state.data) state.data = {};
  if (!state.data.general) state.data.general = {};
  const g = state.data.general;

  // Build normalized header -> original key map
  const norm = {};
  Object.keys(row || {}).forEach(k => {
    norm[normalizeKey(k)] = k;
  });

  // Helper to read by many possible header names
  const read = (...candidates) => {
    for (const c of candidates) {
      const nk = normalizeKey(c);
      if (nk && norm[nk] !== undefined && row[norm[nk]] !== undefined) return row[norm[nk]];
    }
    // also try direct normalized key if provided
    const nk = normalizeKey(candidates[0] || '');
    if (nk && norm[nk] !== undefined) return row[norm[nk]];
    return undefined;
  };

  // Basic fields
  g.characterName = String(read('Character','Name','CHARACTER','NAME') ?? g.characterName ?? '').trim();
  g.playerName = String(read('Player','Owner','PLAYER') ?? g.playerName ?? '').trim();
  g.xp = String(read('XP','Experience','EXP') ?? g.xp ?? '').trim();
  g.classLine = String(read('Class','Classes','CLASS','CLASSES') ?? g.classLine ?? '').trim();
  g.race = String(read('Race','RACE') ?? g.race ?? '').trim();

  // Ensure abilities object
  g.abilities = g.abilities || {};
  const abilityMap = { STR:'str', DEX:'dex', CON:'con', INT:'int', WIS:'wis', CHA:'cha' };
  Object.keys(abilityMap).forEach(h => {
    const key = abilityMap[h];
    g.abilities[key] = g.abilities[key] || { pointBuy:0, asi:0, items:0, buffs:0 };

    // Accept many header variants for each metric
    const pbVal = read(`${h}`, `${h} PB`, `${h}POINTBUY`, `${h} POINTBUY`, `${h}POINT`, `${h} PB`);
    const asiVal = read(`${h} ASI`, `${h}ASI`, `${h} +ASI`, `${h}PLUSASI`);
    const itemsVal = read(`${h} ITEMS`, `${h}ITEMS`, `${h} ITEMS`);
    const buffsVal = read(`${h} BUFFS`, `${h}BUFFS`, `${h} BUFF`);

    // Coerce to numbers if present
    if (pbVal !== undefined && String(pbVal).trim() !== '') g.abilities[key].pointBuy = toNumber(pbVal, g.abilities[key].pointBuy || 0);
    if (asiVal !== undefined && String(asiVal).trim() !== '') g.abilities[key].asi = toNumber(asiVal, g.abilities[key].asi || 0);
    if (itemsVal !== undefined && String(itemsVal).trim() !== '') g.abilities[key].items = toNumber(itemsVal, g.abilities[key].items || 0);
    if (buffsVal !== undefined && String(buffsVal).trim() !== '') g.abilities[key].buffs = toNumber(buffsVal, g.abilities[key].buffs || 0);
  });

  // Classes: accept numeric columns or a class line string
  const clsLine = read('Class','Classes','CLASS','CLASSES','ClassLine','Class Line');
  if (clsLine && String(clsLine).trim() !== '') {
    // try to parse "Sorc 3 / Wiz 2" style into classes object if present
    const classes = { sorc:0, wiz:0, um:0 };
    const parts = String(clsLine).split(/[\/,;]/).map(s=>s.trim());
    parts.forEach(p => {
      const m = p.match(/([A-Za-z]+)\s*(\d+)/);
      if (m) {
        const name = m[1].toLowerCase();
        const n = toNumber(m[2],0);
        if (/sorc|sorcerer|sor/.test(name)) classes.sorc = n;
        else if (/wiz|wizard/.test(name)) classes.wiz = n;
        else if (/um|umbral|other/.test(name)) classes.um = n;
      }
    });
    g.classes = classes;
  } else {
    // fallback: read explicit numeric class columns if present
    g.classes = g.classes || {};
    g.classes.sorc = toNumber(read('Sorc','Sorcerer','SORC'), g.classes.sorc || 0);
    g.classes.wiz = toNumber(read('Wiz','Wizard','WIZ'), g.classes.wiz || 0);
    g.classes.um = toNumber(read('UM','Other','UM'), g.classes.um || 0);
  }

  // Feats: accept comma-separated or multiple feat columns
  const featsRaw = read('Feats','FEATS','Feat','FEAT');
  if (featsRaw && String(featsRaw).trim() !== '') {
    const list = String(featsRaw).split(',').map(s => s.trim()).filter(Boolean);
    g.feats = list.map(l => ({ label: l }));
  } else {
    // scan for any header containing "FEAT"
    const feats = [];
    Object.keys(row || {}).forEach(k => {
      if (/FEAT/i.test(k) && row[k] && String(row[k]).trim() !== '') feats.push({ label: String(row[k]).trim() });
    });
    if (feats.length) g.feats = feats;
  }

  // AC and buffs
  g.ac = g.ac || {};
  const armorVal = read('Armor','ARMOR','AC Armor','AC_ARMOR');
  const shieldVal = read('Shield','SHIELD');
  const naturalVal = read('Natural','NATURAL');
  const deflectVal = read('Deflect','DEFLECT');
  const miscVal = read('Misc','MISC','AC Misc','AC_MISC');
  const miscTouchVal = read('AC Touch','AC_TOUCH','MISC TOUCH','MISC_TOUCH');

  if (armorVal !== undefined && String(armorVal).trim() !== '') g.ac.armor = toNumber(armorVal, g.ac.armor || 0);
  if (shieldVal !== undefined && String(shieldVal).trim() !== '') g.ac.shield = toNumber(shieldVal, g.ac.shield || 0);
  if (naturalVal !== undefined && String(naturalVal).trim() !== '') g.ac.natural = toNumber(naturalVal, g.ac.natural || 0);
  if (deflectVal !== undefined && String(deflectVal).trim() !== '') g.ac.deflect = toNumber(deflectVal, g.ac.deflect || 0);
  if (miscVal !== undefined && String(miscVal).trim() !== '') g.ac.misc = toNumber(miscVal, g.ac.misc || 0);
  if (miscTouchVal !== undefined && String(miscTouchVal).trim() !== '') g.ac.miscTouch = toNumber(miscTouchVal, g.ac.miscTouch || 0);

  g.buffs = g.buffs || {};
  const mageArmorVal = read('Mage Armor','MAGE ARMOR','MAGE_ARMOR','MAGEARMOR');
  const shieldSpellVal = read('Shield Spell','SHIELD SPELL','SHIELD_SPELL','SHIELD SPELL');

  if (mageArmorVal !== undefined && String(mageArmorVal).trim() !== '') {
    const v = String(mageArmorVal).trim().toLowerCase();
    g.buffs.mageArmor = (v === '1' || v === 'yes' || v === 'true') ? 1 : (toNumber(mageArmorVal, 0) ? 1 : 0);
  }
  if (shieldSpellVal !== undefined && String(shieldSpellVal).trim() !== '') {
    const v = String(shieldSpellVal).trim().toLowerCase();
    g.buffs.shieldSpell = (v === '1' || v === 'yes' || v === 'true') ? 1 : (toNumber(shieldSpellVal, 0) ? 1 : 0);
  }

  // Mark loaded and render
  state.loaded = true;

  // Debug logging: show what we applied
  try {
    console.info('[ingest] applied row to state.data.general:', {
      characterName: g.characterName,
      playerName: g.playerName,
      classLine: g.classLine,
      race: g.race,
      abilities: g.abilities,
      ac: g.ac,
      buffs: g.buffs,
      feats: g.feats
    });
  } catch (e) { /* ignore logging errors */ }

  // Call render callback if provided, otherwise call global ensureModulesAndRender if available
  if (typeof render === 'function') {
    try { render(); } catch (e) { console.warn('render callback threw', e); }
  } else if (typeof window.ensureModulesAndRender === 'function') {
    try { window.ensureModulesAndRender(); } catch (e) { console.warn('ensureModulesAndRender threw', e); }
  }
}

/**
 * Robust loader: tries direct CSV, proxy, Google export gids, published CSV.
 * Returns { ok:true } or { ok:false, tried: [...] }.
 */
export async function loadFromGoogleSheets(url, state, render, setProgress) {
  setProgress?.(2, 'Starting sheet load...');
  const sheetId = extractSpreadsheetId(url);
  const tried = [];

  function isCsvUrl(u) { return /\.csv($|\?)/i.test(String(u)); }

  // helper to attempt a fetch and parse and return first non-empty object
  async function tryAndParse(fetchUrl, methodName, extra = {}) {
    const r = await tryFetchText(fetchUrl);
    tried.push(Object.assign({ method: methodName, url: fetchUrl, result: r }, extra));
    if (r.ok && r.text) {
      const rows = parseCsv(r.text);
      const objs = csvRowsToObjects(rows);
      const first = findFirstNonEmptyObject(objs);
      if (first) return { ok:true, rows, objs, first };
    }
    return { ok:false };
  }

  // 1) direct CSV
  if (isCsvUrl(url)) {
    const res = await tryAndParse(url, 'direct-csv');
    if (res.ok) {
      applySheetRowToGeneralDetailed(res.first, state, render);
      setProgress?.(100, 'Sheet loaded (direct CSV)');
      return { ok:true, tried };
    }
  }

  // 2) proxy (if sheetId)
  if (sheetId) {
    try {
      const proxyUrl = `/gs/csv?id=${encodeURIComponent(sheetId)}&gid=0`;
      const res = await tryAndParse(proxyUrl, 'proxy');
      if (res.ok) {
        applySheetRowToGeneralDetailed(res.first, state, render);
        setProgress?.(100, 'Sheet loaded (proxy)');
        return { ok:true, tried };
      }
    } catch (e) { tried.push({ method:'proxy-ex', error:String(e) }); }
  }

  // 3) google export gids (try common gids and also try gid=0 last)
  if (sheetId) {// Always load the General tab (gid = 2004670713)
const correctGid = 2004670713;
const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${correctGid}`;
const r = await tryFetchText(exportUrl);
tried.push({ method: 'google-export-fixed', gid: correctGid, url: exportUrl, result: r });

if (r.ok && r.text) {
  const rows = parseCsv(r.text);
  const objs = csvRowsToObjects(rows);
  const first = objs.find(o => Object.values(o||{}).some(v => String(v||'').trim() !== ''));
  if (first) {
    applySheetRowToGeneralDetailed(first, state, render);
    setProgress?.(100, `Sheet loaded (General gid=${correctGid})`);
    return { ok:true, tried };
  }
}
    }

    // 4) published CSV
    try {
      const pubUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/pub?output=csv`;
      const res = await tryAndParse(pubUrl, 'published-csv');
      if (res.ok) {
        applySheetRowToGeneralDetailed(res.first, state, render);
        setProgress?.(100, 'Sheet loaded (published CSV)');
        return { ok:true, tried };
      }
    } catch (e) { tried.push({ method:'published-ex', error:String(e) }); }
  }

  console.error('[ingest] all attempts failed or returned no non-empty rows', tried);
  setProgress?.(0, 'Sheet load failed — see console for details.');
  return { ok:false, tried };
}
