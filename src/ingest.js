// src/ingest.js
import { parseCsv, csvRowsToObjects } from './utils.js';

export function extractSpreadsheetId(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

async function fetchCsv(url) {
  const r = await fetch(url, { cache: "no-store" });
  const text = await r.text();
  const rows = parseCsv(text);
  const objs = csvRowsToObjects(rows);
  return { rows, objs };
}

function normalizeKey(k) {
  return String(k || "")
    .trim()
    .replace(/[_\-]/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function toNumber(v, fallback = 0) {
  if (v === undefined || v === null || String(v).trim() === "") return fallback;
  const n = Number(String(v).replace(/[^\d\.\-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function firstNonEmpty(objs) {
  return objs.find((o) =>
    Object.values(o || {}).some((v) => String(v || "").trim() !== "")
  );
}

/* -------------------------------------------------------------------------- */
/* GENERAL INGEST (gid = 2004670713)                                          */
/* -------------------------------------------------------------------------- */

export function applyGeneralRow(row, state) {
  if (!state.data.general) state.data.general = {};
  const g = state.data.general;

  const norm = {};
  for (const k of Object.keys(row)) norm[normalizeKey(k)] = k;

  const read = (...names) => {
    for (const n of names) {
      const nk = normalizeKey(n);
      if (norm[nk] !== undefined) return row[norm[nk]];
    }
    return undefined;
  };

  g.characterName = String(read("Character", "Name") || g.characterName || "").trim();
  g.playerName = String(read("Player") || g.playerName || "").trim();
  g.xp = String(read("XP") || g.xp || "").trim();
  g.classLine = String(read("Class", "Classes") || g.classLine || "").trim();
  g.race = String(read("Race") || g.race || "").trim();

  g.abilities = g.abilities || {};
  const map = { STR: "str", DEX: "dex", CON: "con", INT: "int", WIS: "wis", CHA: "cha" };

  for (const H of Object.keys(map)) {
    const key = map[H];
    g.abilities[key] = g.abilities[key] || { pointBuy: 0, asi: 0, items: 0, buffs: 0 };

    const pb = read(H, `${H} PB`);
    const asi = read(`${H} ASI`);
    const items = read(`${H} ITEMS`);
    const buffs = read(`${H} BUFFS`);

    if (pb !== undefined) g.abilities[key].pointBuy = toNumber(pb, g.abilities[key].pointBuy);
    if (asi !== undefined) g.abilities[key].asi = toNumber(asi, g.abilities[key].asi);
    if (items !== undefined) g.abilities[key].items = toNumber(items, g.abilities[key].items);
    if (buffs !== undefined) g.abilities[key].buffs = toNumber(buffs, g.abilities[key].buffs);
  }

  g.ac = g.ac || {};
  const armor = read("Armor");
  const shield = read("Shield");
  const natural = read("Natural");
  const deflect = read("Deflect");
  const misc = read("Misc");
  const miscTouch = read("Misc Touch");

  if (armor !== undefined) g.ac.armor = toNumber(armor, g.ac.armor || 0);
  if (shield !== undefined) g.ac.shield = toNumber(shield, g.ac.shield || 0);
  if (natural !== undefined) g.ac.natural = toNumber(natural, g.ac.natural || 0);
  if (deflect !== undefined) g.ac.deflect = toNumber(deflect, g.ac.deflect || 0);
  if (misc !== undefined) g.ac.misc = toNumber(misc, g.ac.misc || 0);
  if (miscTouch !== undefined) g.ac.miscTouch = toNumber(miscTouch, g.ac.miscTouch || 0);

  g.buffs = g.buffs || {};
  const mage = read("Mage Armor");
  const shieldSpell = read("Shield Spell");

  if (mage !== undefined) g.buffs.mageArmor = toNumber(mage) ? 1 : 0;
  if (shieldSpell !== undefined) g.buffs.shieldSpell = toNumber(shieldSpell) ? 1 : 0;

  const featsRaw = read("Feats");
  if (featsRaw) {
    g.feats = String(featsRaw)
      .split(",")
      .map((s) => ({ label: s.trim() }))
      .filter((f) => f.label);
  }

  console.info("[ingest] GENERAL applied:", g);
}

/* -------------------------------------------------------------------------- */
/* SPELLS INGEST (gid = 0)                                                    */
/* -------------------------------------------------------------------------- */

export function applySpells(objs, state) {
  state.data.spells = { sorc: [], wiz: [], meta: {} };

  for (const row of objs) {
    const norm = {};
    for (const k of Object.keys(row)) norm[normalizeKey(k)] = k;

    const read = (...names) => {
      for (const n of names) {
        const nk = normalizeKey(n);
        if (norm[nk] !== undefined) return row[norm[nk]];
      }
      return undefined;
    };

    const name = read("Spell", "Name");
    if (!name || String(name).trim() === "") continue;

    const level = toNumber(read("Level", "Lvl"), 0);
    const school = read("School") || "";
    const list = read("List") || ""; // "Sorc", "Wiz", etc.

    const spell = { name: String(name).trim(), level, school };

    if (/sorc/i.test(list)) state.data.spells.sorc.push(spell);
    if (/wiz/i.test(list)) state.data.spells.wiz.push(spell);
  }

  console.info("[ingest] SPELLS applied:", state.data.spells);
}

/* -------------------------------------------------------------------------- */
/* MAIN LOADER                                                                */
/* -------------------------------------------------------------------------- */

export async function loadFromGoogleSheets(url, state, render, setProgress) {
  setProgress?.(5, "Loading Google Sheet…");

  const sheetId = extractSpreadsheetId(url);
  if (!sheetId) {
    setProgress?.(0, "Invalid Google Sheets URL");
    return { ok: false };
  }

  /* ---------------- GENERAL (gid = 2004670713) ---------------- */
  const generalGid = 2004670713;
  const generalUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${generalGid}`;

  const gen = await fetchCsv(generalUrl);
  const genRow = firstNonEmpty(gen.objs);

  if (!genRow) {
    console.warn("[ingest] General tab empty");
  } else {
    applyGeneralRow(genRow, state);
  }

  /* ---------------- SPELLS (gid = 0) ---------------- */
  const spellsGid = 0;
  const spellsUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${spellsGid}`;

  const sp = await fetchCsv(spellsUrl);
  applySpells(sp.objs, state);

  /* ---------------- DONE ---------------- */
  state.loaded = true;
  render?.();
  setProgress?.(100, "Sheet loaded");

  return { ok: true };
}
