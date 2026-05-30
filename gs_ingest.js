// gs_ingest.js
// ES module: Google Sheets / XLSX ingest extracted from app.js
// Exports: loadFromGoogleSheets, ingestGeneralFromGrid, ingestSpellsFromGrid, ingestGeneralFromXlsx, ingestSpellsFromXlsx, csvToGrid

export function extractSpreadsheetId(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

export async function fetchCsvViaProxy(sheetId, gid) {
  const url = `/gs/csv?id=${encodeURIComponent(sheetId)}&gid=${encodeURIComponent(gid)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`CSV proxy failed ${res.status}`);
  return await res.text();
}

export function csvToGrid(csvText) {
  // Uses SheetJS (XLSX) to parse CSV text into a grid (array of rows)
  // Caller must ensure XLSX is loaded in the page.
  const wb = XLSX.read(csvText, { type: "string" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
}

/* -------------------------
   Grid-based ingest (CSV)
   ------------------------- */

export async function loadFromGoogleSheets(sheetUrl) {
  try {
    const id = extractSpreadsheetId(sheetUrl);
    if (!id) throw new Error("Could not extract spreadsheet ID from URL.");
    const gids = { spells: 0, general: 2004670713, slot: 1231385124, skills: 2140364605 };

    setProgress(5, "Fetching Spells…");
    const spellsGrid = csvToGrid(await fetchCsvViaProxy(id, gids.spells));

    setProgress(30, "Fetching General…");
    const generalGrid = csvToGrid(await fetchCsvViaProxy(id, gids.general));

    // Parse first; don't mark loaded until parsing succeeds
    ingestSpellsFromGrid(spellsGrid);
    ingestGeneralFromGrid(generalGrid);

    state.loaded = true;
    setProgress(95, "Rendering…");
    // render() and other UI calls remain in app.js
    render();
    setProgress(100, "Done ✅");
  } catch (e) {
    console.error(e);
    setProgress(0, "Load failed: " + (e?.message || e));
    state.loaded = false;
    throw e;
  }
}

/* -------------------------
   ingestGeneralFromGrid
   (copied and lightly cleaned)
   ------------------------- */

export function ingestGeneralFromGrid(grid) {
  const cell = (r, c) => (grid[r] && grid[r][c] != null) ? String(grid[r][c]) : "";
  const num = (v, fb = 0) => {
    const s = String(v ?? "").trim().replace(",", ".");
    const m = s.match(/-?\d+(\.\d+)?/);
    if (!m) return fb;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : fb;
  };

  const norm = (s) => String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

  const findHeaderRow = () => {
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] || [];
      const nset = new Set(row.map(norm));
      if (nset.has("ability") && (nset.has("score") || nset.has("pointbuyarray") || nset.has("asi") || nset.has("items") || nset.has("penaltiesbuffs") || nset.has("buffs"))) {
        return r;
      }
    }
    return -1;
  };

  const findCol = (rowIdx, targetNorm) => {
    const row = grid[rowIdx] || [];
    for (let c = 0; c < row.length; c++) {
      if (norm(row[c]) === targetNorm) return c;
    }
    return -1;
  };

  const findColIncludes = (rowIdx, targetNormFragment) => {
    const row = grid[rowIdx] || [];
    for (let c = 0; c < row.length; c++) {
      const n = norm(row[c]);
      if (n.includes(targetNormFragment)) return c;
    }
    return -1;
  };

  const general = {
    characterName: cell(0, 0),
    playerName: cell(0, 1),
    alignment: cell(0, 2),
    xp: num(cell(0, 4), 0),
    classLine: cell(3, 0),
    race: cell(3, 3),
    size: cell(6, 1),
    age: num(cell(6, 2), 0),
    gender: cell(6, 3),
    classes: { sorc: 1, wiz: 5, um: 2 },
    abilities: {
      str: { pointBuy: 0, asi: 0, items: 0, buffs: 0 },
      dex: { pointBuy: 0, asi: 0, items: 0, buffs: 0 },
      con: { pointBuy: 0, asi: 0, items: 0, buffs: 0 },
      int: { pointBuy: 0, asi: 0, items: 0, buffs: 0 },
      wis: { pointBuy: 0, asi: 0, items: 0, buffs: 0 },
      cha: { pointBuy: 0, asi: 0, items: 0, buffs: 0 }
    },
    ac: { armor: 0, shield: 0, size: 0, natural: 0, deflect: 0, misc: 0, miscTouch: 0 },
    saves: { fortMisc: 0, refMisc: 0, willMisc: 0 },
    attacks: { meleeMisc: 0, rangedMisc: 0, grappleMisc: 0 },
    initMisc: 0,
    buffs: { mageArmor: 0, shieldSpell: 0 },
    feats: [],
    languages: []
  };

  const hdr = findHeaderRow();
  if (hdr !== -1) {
    const colAbility = findCol(hdr, "ability");
    const colScore = findCol(hdr, "score");
    const colPB = findColIncludes(hdr, "pointbuy");
    const colASI = findCol(hdr, "asi");
    const colItems = findCol(hdr, "items");
    const colBuffs = findColIncludes(hdr, "penalties") >= 0 ? findColIncludes(hdr, "penalties") : findColIncludes(hdr, "buffs");

    const mapKey = (label) => {
      const x = String(label).trim().toLowerCase();
      if (x === "str") return "str";
      if (x === "dex") return "dex";
      if (x === "con") return "con";
      if (x === "int") return "int";
      if (x === "wis") return "wis";
      if (x === "cha") return "cha";
      return null;
    };

    for (let r = hdr + 1; r < Math.min(hdr + 30, grid.length); r++) {
      const label = cell(r, colAbility >= 0 ? colAbility : 0).trim();
      const key = mapKey(label);
      if (!key) continue;
      const score = colScore >= 0 ? num(cell(r, colScore), 0) : 0;
      let pb = colPB >= 0 ? num(cell(r, colPB), 0) : 0;
      let asi = colASI >= 0 ? num(cell(r, colASI), 0) : 0;
      const items = colItems >= 0 ? num(cell(r, colItems), 0) : 0;
      const buffs = colBuffs >= 0 ? num(cell(r, colBuffs), 0) : 0;

      if (pb === 0 && score !== 0 && asi !== 0) pb = score - asi;
      if (asi === 0 && score !== 0 && pb !== 0) asi = score - pb;
      if (pb === 0 && asi === 0 && score !== 0) pb = score;

      general.abilities[key] = { pointBuy: pb, asi, items, buffs };
    }
  }

  // Feats
  let featsRow = -1;
  for (let r = 0; r < grid.length; r++) {
    if ((grid[r] || []).some(v => String(v).trim() === "Feats & Special Abilities")) {
      featsRow = r;
      break;
    }
  }
  if (featsRow !== -1) {
    for (let r = featsRow + 1; r < Math.min(featsRow + 60, grid.length); r++) {
      const t = cell(r, 0).trim();
      if (!t) break;
      general.feats.push({ label: t, url: "" });
    }
  }

  // Languages
  let langPos = null;
  for (let r = 0; r < grid.length && !langPos; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (String(row[c]).trim() === "Languages:") {
        langPos = { r, c };
        break;
      }
    }
  }
  if (langPos) {
    for (let r = langPos.r + 1; r < Math.min(langPos.r + 40, grid.length); r++) {
      const t = cell(r, langPos.c).trim();
      if (!t) break;
      general.languages.push(t);
    }
  }

  state.data.general = general;
}

/* -------------------------
   ingestSpellsFromGrid
   ------------------------- */

export function ingestSpellsFromGrid(grid) {
  const cell = (r, c) => (grid[r] && grid[r][c] != null) ? String(grid[r][c]) : "";
  const num = (s, fb = 0) => {
    const n = Number(String(s).replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };

  const findRowContaining = (text) => grid.findIndex(row => (row || []).some(v => String(v).trim() === text));
  const sorcHeader = findRowContaining("Spell slots (S)");
  const wizHeader = findRowContaining("Spell slots (W)");

  function headerMap(rowIdx) {
    const row = grid[rowIdx] || [];
    const map = {};
    for (let c = 0; c < row.length; c++) {
      const key = String(row[c] ?? "").trim();
      if (key) map[key] = c;
    }
    return map;
  }

  function findSpellColByScanning(headerRow, preferredCol) {
    const candidates = [];
    if (preferredCol != null) candidates.push(preferredCol, preferredCol - 1, preferredCol + 1);
    const header = grid[headerRow] || [];
    for (let c = 0; c < header.length; c++) candidates.push(c);
    const seen = new Set();
    for (const c of candidates) {
      if (c == null || c < 0) continue;
      if (seen.has(c)) continue;
      seen.add(c);
      let hits = 0;
      for (let r = headerRow + 1; r < Math.min(headerRow + 15, grid.length); r++) {
        const t = cell(r, c).trim();
        if (!t) continue;
        if (/^[0-9.]+$/.test(t)) continue;
        hits++;
      }
      if (hits >= 2) return c;
    }
    return preferredCol ?? 0;
  }

  function readBlock(headerRow, mode) {
    if (headerRow < 0) return [];
    const h = headerMap(headerRow);
    const colSL = h["SL"];
    const colType = h["Type"];
    const colEvo = h["Evo?"];
    const colFire = h["Fire?"];
    const colRange = h["Range"];
    const colArea = h["Area"];
    const colDamage = h["Damage"];
    const colDuration = h["Duration"];
    const colNotes = h["Notes"];
    const colPrep = h["Preparations"];
    const preferredSpellCol = h["Sorcerer"] ?? h["Wizard"] ?? h["Spell"] ?? null;
    const colSpell = findSpellColByScanning(headerRow, preferredSpellCol);
    const rows = [];
    for (let r = headerRow + 1; r < grid.length; r++) {
      const name = cell(r, colSpell).trim();
      if (!name) break;
      rows.push({
        mode,
        name,
        url: "",
        sl: num(cell(r, colSL), 0),
        type: cell(r, colType),
        evo: num(cell(r, colEvo), 0) === 1,
        fire: num(cell(r, colFire), 0) === 1,
        range: cell(r, colRange),
        area: cell(r, colArea),
        damage: cell(r, colDamage),
        duration: cell(r, colDuration),
        notes: cell(r, colNotes),
        prep: mode === "wiz" ? cell(r, colPrep) : ""
      });
    }
    return rows;
  }

  state.data.spells.sorc = readBlock(sorcHeader, "sorc");
  state.data.spells.wiz = readBlock(wizHeader, "wiz");
  state.data.spells.meta = { sorcLevels: 1, wizLevels: 5, umLevels: 2, arcaneSpellpower: 1 };
}

/* -------------------------
   XLSX ingest functions
   (kept for parity with original app.js)
   ------------------------- */

export function ingestGeneralFromXlsx(wb) {
  const ws = wb.Sheets["General info"];
  if (!ws) throw new Error("Sheet 'General info' not found");
  const v = (addr, fallback = "") => (ws[addr] && ws[addr].v !== undefined) ? ws[addr].v : fallback;
  state.data.general = {
    characterName: String(v("A1", "")),
    playerName: String(v("B1", "")),
    alignment: String(v("C1", "")),
    xp: Number(v("E1", 0)) || 0,
    classLine: String(v("A4", "")),
    race: String(v("D4", "")),
    size: String(v("B7", "")),
    age: Number(v("C7", 0)) || 0,
    gender: String(v("D7", "")),
    classes: { sorc: 1, wiz: 5, um: 2 },
    abilities: {
      str: { pointBuy: Number(v("J12", 0)) || 0, asi: Number(v("K12", 0)) || 0, items: Number(v("G12", 0)) || 0, buffs: Number(v("H12", 0)) || 0 },
      dex: { pointBuy: Number(v("J13", 0)) || 0, asi: Number(v("K13", 0)) || 0, items: Number(v("G13", 0)) || 0, buffs: Number(v("H13", 0)) || 0 },
      con: { pointBuy: Number(v("J14", 0)) || 0, asi: Number(v("K14", 0)) || 0, items: Number(v("G14", 0)) || 0, buffs: Number(v("H14", 0)) || 0 },
      int: { pointBuy: Number(v("J15", 0)) || 0, asi: Number(v("K15", 0)) || 0, items: Number(v("G15", 0)) || 0, buffs: Number(v("H15", 0)) || 0 },
      wis: { pointBuy: Number(v("J16", 0)) || 0, asi: Number(v("K16", 0)) || 0, items: Number(v("G16", 0)) || 0, buffs: Number(v("H16", 0)) || 0 },
      cha: { pointBuy: Number(v("J17", 0)) || 0, asi: Number(v("K17", 0)) || 0, items: Number(v("G17", 0)) || 0, buffs: Number(v("H17", 0)) || 0 }
    },
    ac: { armor: Number(v("D21", 0)) || 0, shield: Number(v("E21", 0)) || 0, size: Number(v("G21", 0)) || 0, natural: Number(v("H21", 0)) || 0, deflect: Number(v("J21", 0)) || 0, misc: Number(v("L21", 0)) || 0, miscTouch: 0 },
    saves: { fortMisc: 0, refMisc: 0, willMisc: 0 },
    attacks: { meleeMisc: 0, rangedMisc: 0, grappleMisc: 0 },
    initMisc: 0,
    buffs: { mageArmor: 0, shieldSpell: 0 },
    feats: [],
    languages: []
  };
}

export function ingestSpellsFromXlsx(wb) {
  const ws = wb.Sheets["Spells"];
  if (!ws) throw new Error("Sheet 'Spells' not found");
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const cellAt = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];

  function cellHasContent(cell) {
    if (!cell) return false;
    if (cell.v !== undefined && String(cell.v).trim() !== "") return true;
    if (cell.f) return true;
    if (cell.l && cell.l.Target) return true;
    return false;
  }

  function findRowWithText(text) {
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = cellAt(r, c);
        if (!cell || cell.v === undefined) continue;
        if (String(cell.v).trim() === text) return r;
      }
    }
    return -1;
  }

  const sorcHeader = findRowWithText("Spell slots (S)");
  const wizHeader = findRowWithText("Spell slots (W)");

  function readBlock(headerRow, mode) {
    if (headerRow < 0) return [];
    const header = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = cellAt(headerRow, c);
      const val = cell && cell.v !== undefined ? String(cell.v).trim() : "";
      if (val) header[val] = c;
    }
    const col = {
      prep: header["Preparations"],
      spell: header["Sorcerer"] ?? header["Wizard"],
      sl: header["SL"],
      type: header["Type"],
      evo: header["Evo?"],
      fire: header["Fire?"],
      range: header["Range"],
      area: header["Area"],
      damage: header["Damage"],
      duration: header["Duration"],
      notes: header["Notes"]
    };

    function resolveSpellCol(spellCol) {
      if (spellCol === undefined) return undefined;
      for (let r = headerRow + 1; r <= Math.min(headerRow + 20, range.e.r); r++) {
        const here = cellAt(r, spellCol);
        const left = cellAt(r, spellCol - 1);
        const right = cellAt(r, spellCol + 1);
        if (cellHasContent(here)) return spellCol;
        if (cellHasContent(left)) return spellCol - 1;
        if (cellHasContent(right)) return spellCol + 1;
      }
      return spellCol;
    }

    col.spell = resolveSpellCol(col.spell);
    const rows = [];
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const spellCell = col.spell !== undefined ? cellAt(r, col.spell) : null;
      if (!cellHasContent(spellCell)) break;
      const name = spellCell.v !== undefined ? String(spellCell.v) : "(spell)";
      const get = (c) => {
        if (c === undefined) return "";
        const cell = cellAt(r, c);
        if (!cell) return "";
        return (cell.w !== undefined ? cell.w : (cell.v ?? ""));
      };
      const num = (c) => Number(get(c)) || 0;
      rows.push({
        mode,
        name,
        url: "",
        sl: num(col.sl),
        type: String(get(col.type) || ""),
        evo: num(col.evo) === 1,
        fire: num(col.fire) === 1,
        range: String(get(col.range) || ""),
        area: String(get(col.area) || ""),
        damage: String(get(col.damage) || ""),
        duration: String(get(col.duration) || ""),
        notes: String(get(col.notes) || ""),
        prep: mode === "wiz" ? String(get(col.prep) || "") : ""
      });
    }
    return rows;
  }

  state.data.spells.sorc = readBlock(sorcHeader, "sorc");
  state.data.spells.wiz = readBlock(wizHeader, "wiz");
  state.data.spells.meta = { sorcLevels: 1, wizLevels: 5, umLevels: 2, arcaneSpellpower: 1 };
}
