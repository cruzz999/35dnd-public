// src/ingest.js
import { parseCsv, csvRowsToObjects } from './utils.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function extractSpreadsheetId(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

function toNumber(v, fallback = 0) {
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  if (!s) return fallback;
  const n = Number(s.replace(/[^\d\.\-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function normalizeKey(k) {
  return String(k || "")
    .trim()
    .replace(/[_\-]/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

async function fetchCsvRows(url) {
  const r = await fetch(url, { cache: "no-store" });
  const text = await r.text();
  const rows = parseCsv(text); // rows: string[][]
  return rows;
}

/* -------------------------------------------------------------------------- */
/* GENERAL PARSER — tailored to your layout (gid = 2004670713)                */
/* -------------------------------------------------------------------------- */

function parseGeneralFromRows(rows, state) {
  if (!state.data) state.data = {};
  if (!state.data.general) state.data.general = {};
  const g = state.data.general;

  // Helper: find first row whose first cell matches label (case-insensitive)
  const findRow = (label) => {
    const target = String(label).trim().toUpperCase();
    return rows.find((r) => String(r[0] || "").trim().toUpperCase() === target) || null;
  };

  // Character name, player, XP, class, race
  const rChar = findRow("Character name");
  if (rChar) g.characterName = String(rChar[1] || g.characterName || "").trim();

  const rPlayer = findRow("Player name");
  if (rPlayer) g.playerName = String(rPlayer[1] || g.playerName || "").trim();

  const rXP = findRow("XP");
  if (rXP) g.xp = String(rXP[1] || g.xp || "").trim();

  const rClass = findRow("Class");
  if (rClass) g.classLine = String(rClass[1] || g.classLine || "").trim();

  const rRace = findRow("Race");
  if (rRace) g.race = String(rRace[1] || g.race || "").trim();

  // Classes: parse classLine like "Sorcerer 1 / Wizard 5 / Ultimate Magus 2"
  g.classes = g.classes || { sorc: 0, wiz: 0, um: 0 };
  if (g.classLine) {
    const parts = String(g.classLine).split(/[\/,;]/).map((s) => s.trim());
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

  // Abilities: use the "Ability / Score / Mod / Temp score / ... / Point buy array / ASI / Point buy cost" table
  g.abilities = g.abilities || {};
  const abilityHeaderIndex = rows.findIndex(
    (r) => String(r[0] || "").trim().toUpperCase() === "ABILITY"
  );
  if (abilityHeaderIndex >= 0) {
    const headerRow = rows[abilityHeaderIndex];
    const colIndex = {};
    headerRow.forEach((cell, idx) => {
      const nk = normalizeKey(cell);
      if (nk) colIndex[nk] = idx;
    });

    const idxAbility = colIndex["ABILITY"];
    const idxPointBuy = colIndex["POINT BUY ARRAY"];
    const idxASI = colIndex["ASI"];
    const idxItems = colIndex["ITEMS PENALTIES/BUFFS"];

    const map = { STR: "str", DEX: "dex", CON: "con", INT: "int", WIS: "wis", CHA: "cha" };

    for (let i = 1; i <= 6; i++) {
      const row = rows[abilityHeaderIndex + i];
      if (!row) continue;
      const label = String(row[idxAbility] || "").trim().toUpperCase();
      const key = map[label];
      if (!key) continue;

      g.abilities[key] = g.abilities[key] || { pointBuy: 0, asi: 0, items: 0, buffs: 0 };

      if (idxPointBuy !== undefined) {
        const v = row[idxPointBuy];
        if (v !== undefined && String(v).trim() !== "")
          g.abilities[key].pointBuy = toNumber(v, g.abilities[key].pointBuy);
      }
      if (idxASI !== undefined) {
        const v = row[idxASI];
        if (v !== undefined && String(v).trim() !== "")
          g.abilities[key].asi = toNumber(v, g.abilities[key].asi);
      }
      if (idxItems !== undefined) {
        const v = row[idxItems];
        if (v !== undefined && String(v).trim() !== "")
          g.abilities[key].items = toNumber(v, g.abilities[key].items);
      }
      // buffs remain 0; handled in app via toggles
    }
  }

  // AC: we leave armor/shield/natural/deflect/misc at defaults; app derives AC from buffs/armor
  g.ac = g.ac || { armor: 0, shield: 0, size: 0, natural: 0, deflect: 0, misc: 0, miscTouch: 0 };

  // Buffs: default off; toggled in UI
  g.buffs = g.buffs || { mageArmor: 0, shieldSpell: 0 };

  // Feats: parse "Feats & special abilities" section (first column)
  const featsHeaderIndex = rows.findIndex((r) =>
    String(r[0] || "").toLowerCase().includes("feats")
  );
  if (featsHeaderIndex >= 0) {
    const feats = [];
    for (let i = featsHeaderIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      const label = String(row[0] || "").trim();
      if (!label) break;
      feats.push({ label });
    }
    if (feats.length) g.feats = feats;
  }

  console.info("[ingest] GENERAL parsed from layout:", g);
}

/* -------------------------------------------------------------------------- */
/* SPELLS PARSER — gid = 0, header-based                                      */
/* -------------------------------------------------------------------------- */

function applySpellsFromObjects(objs, state) {
  if (!state.data) state.data = {};
  state.data.spells = { sorc: [], wiz: [], meta: {} };

  for (const row of objs) {
    if (!row) continue;
    const norm = {};
    Object.keys(row).forEach((k) => (norm[normalizeKey(k)] = k));

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
    const list = read("List") || ""; // e.g. "Sorc", "Wiz"

    const spell = { name: String(name).trim(), level, school };

    if (/sorc/i.test(list)) state.data.spells.sorc.push(spell);
    if (/wiz/i.test(list)) state.data.spells.wiz.push(spell);
  }

  console.info("[ingest] SPELLS parsed:", state.data.spells);
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

  /* ---------------- GENERAL (layout tab, gid = 2004670713) ---------------- */
  const generalGid = 2004670713;
  const generalUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${generalGid}`;
  const generalRows = await fetchCsvRows(generalUrl);
  parseGeneralFromRows(generalRows, state);

  /* ---------------- SPELLS (table tab, gid = 0) --------------------------- */
  const spellsGid = 0;
  const spellsUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${spellsGid}`;
  const spellsRows = await fetchCsvRows(spellsUrl);
  const spellsObjs = csvRowsToObjects(spellsRows);
  applySpellsFromObjects(spellsObjs, state);

  /* ---------------- DONE --------------------------------------------------- */
  state.loaded = true;
  render?.();
  setProgress?.(100, "Sheet loaded");

  return { ok: true };
}
