// sheetParsers.js
// Parsing helpers extracted from app.js.
// Intentionally does NOT touch DOM, render(), ink, or global app state.
// It only parses grids and returns plain objects.

(function (global) {
  const SheetParsers = {};

  /* ----------------------------- Shared helpers ----------------------------- */

  function cell(grid, r, c) {
    return (grid[r] && grid[r][c] != null) ? String(grid[r][c]) : "";
  }

  function numLoose(v, fb = 0) {
    const s = String(v ?? "").trim().replace(",", ".");
    const m = s.match(/-?\d+(\.\d+)?/); // grab first number anywhere in the string
    if (!m) return fb;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : fb;
  }

  function numStrict(v, fb = 0) {
    const n = Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  }

  function normHeader(s) {
    return String(s ?? "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "");
  }

  function findRowContaining(grid, text) {
    return grid.findIndex(row => (row || []).some(v => String(v).trim() === text));
  }

  function headerMap(grid, rowIdx) {
    const row = grid[rowIdx] || [];
    const map = {};
    for (let c = 0; c < row.length; c++) {
      const key = String(row[c] ?? "").trim();
      if (key) map[key] = c;
    }
    return map;
  }

  /* --------------------------- General grid parser -------------------------- */

  function findGeneralHeaderRow(grid) {
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] || [];
      const nset = new Set(row.map(normHeader));
      if (
        nset.has("ability") &&
        (
          nset.has("score") ||
          nset.has("pointbuyarray") ||
          nset.has("asi") ||
          nset.has("items") ||
          nset.has("penaltiesbuffs") ||
          nset.has("penaltiesbuff")
        )
      ) {
        return r;
      }
    }
    return -1;
  }

  function findCol(grid, rowIdx, targetNorm) {
    const row = grid[rowIdx] || [];
    for (let c = 0; c < row.length; c++) {
      if (normHeader(row[c]) === targetNorm) return c;
    }
    return -1;
  }

  function findColIncludes(grid, rowIdx, targetNormFragment) {
    const row = grid[rowIdx] || [];
    for (let c = 0; c < row.length; c++) {
      const n = normHeader(row[c]);
      if (n.includes(targetNormFragment)) return c;
    }
    return -1;
  }

  function mapAbilityKey(label) {
    const x = String(label).trim().toLowerCase();
    if (x === "str") return "str";
    if (x === "dex") return "dex";
    if (x === "con") return "con";
    if (x === "int") return "int";
    if (x === "wis") return "wis";
    if (x === "cha") return "cha";
    return null;
  }

  function parseGeneralGrid(grid) {
    const general = {
      characterName: cell(grid, 0, 0),
      playerName: cell(grid, 0, 1),
      alignment: cell(grid, 0, 2),
      xp: numLoose(cell(grid, 0, 4), 0),

      classLine: cell(grid, 3, 0),
      race: cell(grid, 3, 3),

      size: cell(grid, 6, 1),
      age: numLoose(cell(grid, 6, 2), 0),
      gender: cell(grid, 6, 3),

      // NOTE:
      // These defaults preserve your CURRENT app behavior.
      // If you later want safer generic defaults, these can become 0/0/0.
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

    // ---- Ability table ----
    const hdr = findGeneralHeaderRow(grid);
    if (hdr !== -1) {
      const colAbility = findCol(grid, hdr, "ability");

      const colScore = findCol(grid, hdr, "score");
      const colPB = findColIncludes(grid, hdr, "pointbuy");
      const colASI = findCol(grid, hdr, "asi");
      const colItems = findCol(grid, hdr, "items");
      const colBuffs = findColIncludes(grid, hdr, "penalties") >= 0
        ? findColIncludes(grid, hdr, "penalties")
        : findColIncludes(grid, hdr, "buffs");

      for (let r = hdr + 1; r < Math.min(hdr + 30, grid.length); r++) {
        const label = cell(grid, r, colAbility >= 0 ? colAbility : 0).trim();
        const key = mapAbilityKey(label);
        if (!key) continue;

        const score = colScore >= 0 ? numLoose(cell(grid, r, colScore), 0) : 0;
        let pb = colPB >= 0 ? numLoose(cell(grid, r, colPB), 0) : 0;
        let asi = colASI >= 0 ? numLoose(cell(grid, r, colASI), 0) : 0;
        const items = colItems >= 0 ? numLoose(cell(grid, r, colItems), 0) : 0;
        const buffs = colBuffs >= 0 ? numLoose(cell(grid, r, colBuffs), 0) : 0;

        // Preserve current fallback behavior:
        // If PB is missing but Score and ASI exist, PB = Score - ASI
        if (pb === 0 && score !== 0 && asi !== 0) {
          pb = score - asi;
        }

        // If ASI is missing but Score and PB exist, ASI = Score - PB
        if (asi === 0 && score !== 0 && pb !== 0) {
          asi = score - pb;
        }

        // If both are missing but Score exists, treat Score as PB
        if (pb === 0 && asi === 0 && score !== 0) {
          pb = score;
        }

        general.abilities[key] = { pointBuy: pb, asi, items, buffs };
      }
    }

    // ---- Feats ----
    let featsRow = -1;
    for (let r = 0; r < grid.length; r++) {
      if ((grid[r] || []).some(v => String(v).trim() === "Feats & Special Abilities")) {
        featsRow = r;
        break;
      }
    }

    if (featsRow !== -1) {
      for (let r = featsRow + 1; r < Math.min(featsRow + 60, grid.length); r++) {
        const t = cell(grid, r, 0).trim();
        if (!t) break;
        general.feats.push({ label: t, url: "" });
      }
    }

    // ---- Languages ----
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
        const t = cell(grid, r, langPos.c).trim();
        if (!t) break;
        general.languages.push(t);
      }
    }

    return general;
  }

  /* ---------------------------- Spells grid parser --------------------------- */

  function findSpellColByScanning(grid, headerRow, preferredCol) {
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
        const t = cell(grid, r, c).trim();
        if (!t) continue;
        if (/^[0-9.]+$/.test(t)) continue;
        hits++;
      }

      if (hits >= 2) return c;
    }

    return preferredCol ?? 0;
  }

function readSpellBlock(grid, headerRow, mode) {
  if (headerRow < 0) return [];

  const h = headerMap(grid, headerRow);

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

  // Spell column label differs between blocks.
  const preferredSpellCol =
    h["Sorcerer"] ?? h["Wizard"] ?? h["  Wizard"] ?? h["Spell"] ?? null;

  const colSpell = findSpellColByScanning(grid, headerRow, preferredSpellCol);

  // URL handling:
  // 1) If a URL/Link column exists, use it.
  // 2) Otherwise, if column 0 of the first data row looks like a URL,
  //    treat column 0 as the URL column.
  let colUrl = h["URL"] ?? h["Link"] ?? h["Href"] ?? null;

  if (colUrl == null) {
    const firstUrlCandidate = cell(grid, headerRow + 1, 0).trim();
    if (/^https?:\/\//i.test(firstUrlCandidate)) {
      colUrl = 0;
    }
  }

  const rows = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const name = cell(grid, r, colSpell).trim();
    if (!name) break;

    
const rawUrl = colUrl != null ? cell(grid, r, colUrl).trim() : "";
const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : "";


    rows.push({
      mode,
      name,
      url,
      sl: numStrict(cell(grid, r, colSL), 0),
      type: cell(grid, r, colType),
      evo: numStrict(cell(grid, r, colEvo), 0) === 1,
      fire: numStrict(cell(grid, r, colFire), 0) === 1,
      range: cell(grid, r, colRange),
      area: cell(grid, r, colArea),
      damage: cell(grid, r, colDamage),
      duration: cell(grid, r, colDuration),
      notes: cell(grid, r, colNotes),
      prep: mode === "wiz" ? cell(grid, r, colPrep) : ""
    });
  }

  return rows;
}


  function parseSpellsGrid(grid) {
    const sorcHeader = findRowContaining(grid, "Spell slots (S)");
    const wizHeader = findRowContaining(grid, "Spell slots (W)");

    const sorc = readSpellBlock(grid, sorcHeader, "sorc");
    const wiz = readSpellBlock(grid, wizHeader, "wiz");

    // NOTE:
    // This preserves your CURRENT app behavior.
    // If later you want these derived from parsed sheet data instead,
    // we can change this in a separate, deliberate step.
    const meta = {
      sorcLevels: 1,
      wizLevels: 5,
      umLevels: 2,
      arcaneSpellpower: 1
    };

    return { sorc, wiz, meta };
  }

  /* ---------------------------- Skills grid parser --------------------------- */

  function findSkillsHeaderRow(grid) {
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] || [];
      const first = String(row[0] ?? "").trim().toLowerCase();
      const second = String(row[1] ?? "").trim().toLowerCase();

      if (first === "skills" && second === "ability") {
        return r;
      }
    }
    return -1;
  }

  function parseSkillsGrid(grid) {
    const headerRow = findSkillsHeaderRow(grid);

    const result = {
      rows: [],
      inventoryLines: []
    };

    if (headerRow === -1) {
      return result;
    }

    // Expected columns from your sheet:
    // A Skills, B Ability, C Skill mod, D Ab mod, E Rank, F Misc, G ACP, H Race bonus
    for (let r = headerRow + 1; r < grid.length; r++) {
      const name = cell(grid, r, 0).trim();

      // Stop at first blank skill row after parsing has started
      if (!name) break;

      result.rows.push({
        name,
        ability: cell(grid, r, 1).trim(),
        sheetTotal: numStrict(cell(grid, r, 2), 0),
        sheetAbilityMod: numStrict(cell(grid, r, 3), 0),
        rank: numStrict(cell(grid, r, 4), 0),
        misc: numStrict(cell(grid, r, 5), 0),
        sheetAcp: numStrict(cell(grid, r, 6), 0),
        sheetRaceBonus: numStrict(cell(grid, r, 7), 0)
      });
    }

    // Inventory / notes area:
    // collect non-empty row text from columns J-M (indexes 9..12)
    for (let r = 0; r < grid.length; r++) {
      const parts = [];
      for (let c = 9; c <= 12; c++) {
        const text = cell(grid, r, c).trim();
        if (text) parts.push(text);
      }
      if (parts.length) {
        result.inventoryLines.push(parts.join(" "));
      }
    }

    return result;
  }


  /* ------------------------------- Public API ------------------------------- */
  SheetParsers.parseSkillsGrid = parseSkillsGrid;
  SheetParsers.parseGeneralGrid = parseGeneralGrid;
  SheetParsers.parseSpellsGrid = parseSpellsGrid;

  global.SheetParsers = SheetParsers;
})(window);
