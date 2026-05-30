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

/**
 * Map a parsed sheet row into state.data.general.
 * Accepts state and a render callback to call after mapping.
 */
export function applySheetRowToGeneralDetailed(row, state, render) {
  if (!state.data.general) state.data.general = {};
  const g = state.data.general;
  g.characterName = row['Character'] ?? row['Name'] ?? g.characterName ?? '';
  g.playerName = row['Player'] ?? g.playerName ?? '';
  g.xp = row['XP'] ?? g.xp ?? '';
  g.classLine = row['Class'] ?? row['Classes'] ?? g.classLine ?? '';
  g.race = row['Race'] ?? g.race ?? '';

  const map = { STR:'str', DEX:'dex', CON:'con', INT:'int', WIS:'wis', CHA:'cha' };
  Object.keys(map).forEach(h => {
    const a = map[h];
    g.abilities = g.abilities || {};
    g.abilities[a] = g.abilities[a] || {};
    if (row[`${h}`] !== undefined && row[`${h}`] !== '') g.abilities[a].pointBuy = Number(row[`${h}`]) || g.abilities[a].pointBuy || 0;
    if (row[`${h} ASI`] !== undefined && row[`${h} ASI`] !== '') g.abilities[a].asi = Number(row[`${h} ASI`]) || g.abilities[a].asi || 0;
    if (row[`${h} PB`] !== undefined && row[`${h} PB`] !== '') g.abilities[a].pointBuy = Number(row[`${h} PB`]) || g.abilities[a].pointBuy || 0;
    if (row[`${h} ITEMS`] !== undefined && row[`${h} ITEMS`] !== '') g.abilities[a].items = Number(row[`${h} ITEMS`]) || g.abilities[a].items || 0;
    if (row[`${h} BUFFS`] !== undefined && row[`${h} BUFFS`] !== '') g.abilities[a].buffs = Number(row[`${h} BUFFS`]) || g.abilities[a].buffs || 0;
  });

  if (row['Feats']) {
    const list = String(row['Feats']).split(',').map(s => s.trim()).filter(Boolean);
    g.feats = list.map(l => ({ label: l }));
  } else {
    const feats = [];
    Object.keys(row).forEach(k => { if (/feat/i.test(k) && row[k]) feats.push({ label: String(row[k]) }); });
    if (feats.length) g.feats = feats;
  }

  if (row['Armor']) g.ac = g.ac || {}, g.ac.armor = Number(row['Armor']) || g.ac.armor || 0;
  if (row['Shield']) g.ac = g.ac || {}, g.ac.shield = Number(row['Shield']) || g.ac.shield || 0;
  if (row['Mage Armor']) g.buffs = g.buffs || {}, g.buffs.mageArmor = (String(row['Mage Armor']).trim().toLowerCase() === '1' || String(row['Mage Armor']).trim().toLowerCase() === 'yes') ? 1 : 0;
  if (row['Shield Spell']) g.buffs = g.buffs || {}, g.buffs.shieldSpell = (String(row['Shield Spell']).trim().toLowerCase() === '1' || String(row['Shield Spell']).trim().toLowerCase() === 'yes') ? 1 : 0;

  // After mapping, mark loaded and render
  state.loaded = true;
  if (typeof render === 'function') render();
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

  // 1) direct CSV
  if (isCsvUrl(url)) {
    const r = await tryFetchText(url);
    tried.push({ method: 'direct-csv', url, result: r });
    if (r.ok && r.text) {
      const rows = parseCsv(r.text);
      const objs = csvRowsToObjects(rows);
      if (objs.length) { applySheetRowToGeneralDetailed(objs[0], state, render); setProgress?.(100, 'Sheet loaded (direct CSV)'); return { ok:true }; }
    }
  }

  // 2) proxy
  if (sheetId) {
    try {
      const proxyUrl = `/gs/csv?id=${encodeURIComponent(sheetId)}&gid=0`;
      const r = await tryFetchText(proxyUrl);
      tried.push({ method: 'proxy', url: proxyUrl, result: r });
      if (r.ok && r.text) {
        const rows = parseCsv(r.text);
        const objs = csvRowsToObjects(rows);
        if (objs.length) { applySheetRowToGeneralDetailed(objs[0], state, render); setProgress?.(100, 'Sheet loaded (proxy)'); return { ok:true }; }
      }
    } catch (e) { tried.push({ method:'proxy-ex', error:String(e) }); }
  }

  // 3) google export gids
  if (sheetId) {
    const candidateGids = [2004670713, 0, 1231385124, 2140364605];
    for (const gid of candidateGids) {
      try {
        const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
        const r = await tryFetchText(exportUrl);
        tried.push({ method: 'google-export', gid, url: exportUrl, result: r });
        if (r.ok && r.text) {
          const rows = parseCsv(r.text);
          const objs = csvRowsToObjects(rows);
          if (objs.length) { applySheetRowToGeneralDetailed(objs[0], state, render); setProgress?.(100, `Sheet loaded (gid=${gid})`); return { ok:true }; }
        }
      } catch (e) { tried.push({ method:'google-export-ex', gid, error:String(e) }); }
    }

    // 4) published CSV
    try {
      const pubUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/pub?output=csv`;
      const r = await tryFetchText(pubUrl);
      tried.push({ method: 'published-csv', url: pubUrl, result: r });
      if (r.ok && r.text) {
        const rows = parseCsv(r.text);
        const objs = csvRowsToObjects(rows);
        if (objs.length) { applySheetRowToGeneralDetailed(objs[0], state, render); setProgress?.(100, 'Sheet loaded (published CSV)'); return { ok:true }; }
      }
    } catch (e) { tried.push({ method:'published-ex', error:String(e) }); }
  }

  console.error('[ingest] all attempts failed', tried);
  setProgress?.(0, 'Sheet load failed — see console for details.');
  return { ok:false, tried };
}
