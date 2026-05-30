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
  if (row['Mage Armor']) g.buffs
