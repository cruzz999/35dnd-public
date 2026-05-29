/* ==========================================================================
   DnD 3.5 Ink Sheet (Paper Mode) - app.js
   - Pan/zoom paper inside #viewport/#world (no page scroll)
   - Stylus-safe ink layer on #inkWorld (world coordinates)
   - Load data from:
        A) XLSX upload (SheetJS)
        B) Google Sheets via NAS proxy endpoint: /gs/csv?id=...&gid=...
   - Implemented views: General, Spells,more comment commit damnit,test 2,3
   ========================================================================== */
// app.js (top) — add these imports (requires index.html to load app.js as type="module")
import { evaluateExpression } from './expr/evaluator.js';
import { slotsModel, ingestSlotsCsv } from './data/slots.js';
import { openDb, idbPut, idbGetAll } from './persistence/idb.js';
import { initTiler } from './ink/tiler.js';

// Optional: expose evaluateExpression for debugging in console (safe wrapper)
window.__evaluateExpression = evaluateExpression;

/* ----------------------------- DOM helpers ------------------------------ */
const $ = (id) => document.getElementById(id);

const el = {
  file: $("file"),
  status: $("status"),
  progressBar: $("progressBar"),

  viewGeneral: $("viewGeneral"),
  viewSpells: $("viewSpells"),
  viewSlots: $("viewSlots"),
  viewSkills: $("viewSkills"),

  zoomOut: $("zoomOut"),
  zoomIn: $("zoomIn"),
  zoomReset: $("zoomReset"),

  penToggle: $("penToggle"),
  eraser: $("eraser"),
  undo: $("undo"),
  clearInk: $("clearInk"),

  viewport: $("viewport"),
  world: $("world"),
  app: $("app"),
  ink: $("inkWorld"),

  gsUrl: $("gsUrl"),
  loadGs: $("loadGs"),
};

function assertEl(name) {
  if (!el[name]) console.warn(`Missing element #${name}`);
}
["viewport", "world", "app", "ink", "status", "progressBar"].forEach(assertEl);

/* ------------------------------ App state ------------------------------ */
const state = {
  loaded: false,                 // becomes true after XLSX or Google load
  view: "General",

  // Paper transform
  pan: { x: 20, y: 20 },
  zoom: 1.0,

  // Pen state
  penOn: false,
  erasing: false,

  // Ink storage per view
  strokesByView: {},

  // Data
  data: {
    general: null,
    spells: { sorc: [], wiz: [], meta: null },
  },
};

/* ------------------------------ Progress ------------------------------- */
function setProgress(pct, text) {
  if (el.progressBar) el.progressBar.style.width = `${pct}%`;
  if (el.status) el.status.textContent = text;
}
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/* ---------------------------- Utilities -------------------------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&", "<": "<", ">": ">", "\"": "&quot;", "'": "&#039;"
  }[m]));
}
function fmtSign(n) {
  n = Number(n) || 0;
  return (n >= 0 ? "+" : "") + n;
}
function abilityMod(score) {
  return Math.floor((Number(score) - 10) / 2);
}
function babPoor(level) {
  level = Number(level) || 0;
  return Math.floor(level / 2);
}
function saveGood(level) {
  level = Number(level) || 0;
  return 2 + Math.floor(level / 2);
}
function savePoor(level) {
  level = Number(level) || 0;
  return Math.floor(level / 3);
}
function totalLevel(classes) {
  return (Number(classes.sorc) || 0) + (Number(classes.wiz) || 0) + (Number(classes.um) || 0);
}
function hpAverageD4(totalLvl) {
  totalLvl = Number(totalLvl) || 0;
  if (totalLvl <= 0) return 0;
  return 4 + (totalLvl - 1) * 3;
}

/* -------------------- Viewport height sync (topbar wrap) --------------- */
function syncViewportHeight() {
  const topbar = document.querySelector(".topbar");
  const h = topbar ? topbar.getBoundingClientRect().height : 64;
  if (el.viewport) el.viewport.style.height = `calc(100vh - ${h}px)`;
}
window.addEventListener("resize", () => {
  syncViewportHeight();
  applyWorldTransform();
  ink.redraw();
});
syncViewportHeight();

/* -------------------- Paper transform (pan/zoom) ----------------------- */
function applyWorldTransform() {
  if (!el.world) return;
  el.world.style.transformOrigin = "0 0";
  el.world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
}

function clampZoom(z) {
  return Math.max(0.5, Math.min(3.0, z));
}

function setZoom(newZoom, anchorClientX = null, anchorClientY = null) {
  const oldZoom = state.zoom;
  newZoom = clampZoom(newZoom);
  if (newZoom === oldZoom) return;

  // Zoom around a point in viewport coordinates
  if (anchorClientX != null && anchorClientY != null && el.viewport) {
    const vr = el.viewport.getBoundingClientRect();
    const vx = anchorClientX - vr.left;
    const vy = anchorClientY - vr.top;

    const wx = (vx - state.pan.x) / oldZoom;
    const wy = (vy - state.pan.y) / oldZoom;

    state.pan.x = vx - wx * newZoom;
    state.pan.y = vy - wy * newZoom;
  }

  state.zoom = newZoom;
  applyWorldTransform();
  ink.redraw();
}

function resetView() {
  state.zoom = 1.0;
  state.pan.x = 20;
  state.pan.y = 20;
  applyWorldTransform();
  ink.redraw();
}

/* --------------------------- View routing ------------------------------ */
function setView(viewName) {
  state.view = viewName;
  setProgress(1, `View: ${viewName}`);
  try {
    render();
    ink.loadForView(viewName);
  } catch (e) {
    console.error(e);
    setProgress(0, `Render error: ${e?.message || e}`);
  }
}

if (el.viewGeneral) el.viewGeneral.onclick = () => setView("General");
if (el.viewSpells)  el.viewSpells.onclick  = () => setView("Spells");
if (el.viewSlots)   el.viewSlots.onclick   = () => setView("Slots");
if (el.viewSkills)  el.viewSkills.onclick  = () => setView("Skills");

/* --------------------------- Zoom controls ----------------------------- */
if (el.zoomOut)   el.zoomOut.onclick = () => setZoom(state.zoom / 1.15);
if (el.zoomIn)    el.zoomIn.onclick  = () => setZoom(state.zoom * 1.15);
if (el.zoomReset) el.zoomReset.onclick = () => resetView();

// ctrl+wheel zoom inside viewport (desktop convenience)
if (el.viewport) {
  el.viewport.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : (1 / 1.08);
    setZoom(state.zoom * factor, e.clientX, e.clientY);
  }, { passive: false });
}

/* ----------------------------- Pan mode --------------------------------
   - When pen is OFF: drag to pan paper
   - When pen is ON: ink handles strokes
------------------------------------------------------------------------- */
let panDrag = { active: false, startX: 0, startY: 0, basePanX: 0, basePanY: 0 };

function beginPan(e) {
  panDrag.active = true;
  panDrag.startX = e.clientX;
  panDrag.startY = e.clientY;
  panDrag.basePanX = state.pan.x;
  panDrag.basePanY = state.pan.y;
}
function movePan(e) {
  if (!panDrag.active) return;
  const dx = e.clientX - panDrag.startX;
  const dy = e.clientY - panDrag.startY;
  state.pan.x = panDrag.basePanX + dx;
  state.pan.y = panDrag.basePanY + dy;
  applyWorldTransform();
  ink.redraw();
}
function endPan() { panDrag.active = false; }

if (el.viewport) {
  el.viewport.addEventListener("pointerdown", (e) => {
    if (state.penOn) return;
    beginPan(e);
    el.viewport.setPointerCapture?.(e.pointerId);
  });
  el.viewport.addEventListener("pointermove", (e) => movePan(e));
  el.viewport.addEventListener("pointerup", endPan);
  el.viewport.addEventListener("pointercancel", endPan);
}

/* ------------------------------ Ink layer ------------------------------ */
const ink =(() => {
  const canvas = el.ink;
  const ctx = canvas ? canvas.getContext("2d") : null;

  function getStrokesForView(view) {
    state.strokesByView[view] ||= [];
    return state.strokesByView[view];
  }

  function saveForView(view) {
    try {
      localStorage.setItem(`ink:${view}`, JSON.stringify(getStrokesForView(view)));
    } catch {}
  }

  function loadForView(view) {
    try {
      const raw = localStorage.getItem(`ink:${view}`);
      state.strokesByView[view] = raw ? JSON.parse(raw) : [];
    } catch {
      state.strokesByView[view] = [];
    }
    redraw();
  }

  function ensureCanvasSize() {
    if (!canvas || !ctx) return;

    const w = Math.max(el.app?.scrollWidth || 0, 1200);
    const h = Math.max(el.app?.scrollHeight || 0, 800);
    const dpr = window.devicePixelRatio || 1;

    canvas.style.position = "absolute";
    canvas.style.left = "0px";
    canvas.style.top = "0px";
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    // Use devicePixelRatio transform so strokes look crisp on high-DPI displays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // critical on Android and for pointer handling
    canvas.style.touchAction = "none";
  }

  function screenToWorld(clientX, clientY) {
    if (!el.viewport) return { x: 0, y: 0 };
    const vr = el.viewport.getBoundingClientRect();
    const vx = clientX - vr.left;
    const vy = clientY - vr.top;
    return {
      x: (vx - state.pan.x) / state.zoom,
      y: (vy - state.pan.y) / state.zoom,
    };
  }

  function drawStroke(stroke) {
    if (!ctx) return;
    const pts = stroke.pts || [];
    if (pts.length < 2) return;

    ctx.save();
    if (stroke.erase) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = 18;
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#000";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function redraw() {
    if (!canvas || !ctx) return;
    ensureCanvasSize();
    // clear using CSS size (canvas.width/height are device pixels)
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const strokes = getStrokesForView(state.view);
    for (const stroke of strokes) drawStroke(stroke);
  }

  function clear() {
    state.strokesByView[state.view] = [];
    redraw();
    saveForView(state.view);
  }

  function undo() {
    const s = getStrokesForView(state.view);
    s.pop();
    redraw();
    saveForView(state.view);
  }

  // Stylus-safe pointer handling
  let drawing = false;
  let currentStroke = null;
  let activePointerId = null;

  function pointerDown(e) {
    if (!state.penOn || !canvas) return;

    // ignore finger/palm touches in pen mode
    if (e.pointerType === "touch") return;

    drawing = true;
    activePointerId = e.pointerId;

    const p = screenToWorld(e.clientX, e.clientY);
    currentStroke = { erase: state.erasing, pts: [p] };
    getStrokesForView(state.view).push(currentStroke);

    try { canvas.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
    redraw();
  }

  function pointerMove(e) {
    if (!state.penOn || !drawing || !currentStroke) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    if (e.pointerType === "touch") return;

    // Throttle small moves to reduce point density (keeps memory reasonable)
    const last = currentStroke.pts[currentStroke.pts.length - 1];
    const next = screenToWorld(e.clientX, e.clientY);
    const dx = next.x - last.x;
    const dy = next.y - last.y;
    if ((dx * dx + dy * dy) < 0.25) return; // skip tiny moves

    currentStroke.pts.push(next);
    e.preventDefault();
    redraw();
  }

  function endStroke(e) {
    if (!state.penOn) return;
    if (e && activePointerId !== null && e.pointerId !== activePointerId) return;

    drawing = false;
    currentStroke = null;

    if (canvas && e) {
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }
    activePointerId = null;

    saveForView(state.view);
    redraw();
  }

  if (canvas) {
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);
    canvas.addEventListener("lostpointercapture", endStroke);
    canvas.addEventListener("pointerleave", endStroke);
    // default to not intercepting pointer events until pen mode is enabled
    canvas.style.pointerEvents = "none";
    canvas.style.touchAction = "none";
  }

  function setPenMode(on) {
    state.penOn = !!on;
    if (el.penToggle) el.penToggle.textContent = `Pen: ${state.penOn ? "ON" : "OFF"}`;
    if (canvas) canvas.style.pointerEvents = state.penOn ? "auto" : "none";

    if (!state.penOn) {
      drawing = false;
      currentStroke = null;
      activePointerId = null;
    }
  }

  function setEraser(on) {
    state.erasing = !!on;
    if (el.eraser) el.eraser.textContent = state.erasing ? "Eraser: ON" : "Eraser";
  }

  if (el.penToggle) el.penToggle.onclick = () => setPenMode(!state.penOn);
  if (el.eraser) el.eraser.onclick = () => setEraser(!state.erasing);
  if (el.undo) el.undo.onclick = () => undo();
  if (el.clearInk) el.clearInk.onclick = () => clear();

  window.addEventListener("resize", () => {
    ensureCanvasSize();
    redraw();
  });

  // Ensure initial sizing and a safe initial render
  ensureCanvasSize();
  // Do not call redraw here unconditionally; loadForView will call redraw when appropriate.
  return { redraw, loadForView, setPenMode, setEraser };
})();

/* ----------------- Derived computations (General view) ----------------- */
function computeGeneralDerived(g) {
  const cls = g.classes;

  const abilities = {};
  for (const k of ["str","dex","con","int","wis","cha"]) {
    const a = g.abilities[k];
    const base = (Number(a.pointBuy)||0) + (Number(a.asi)||0);
    const total = base + (Number(a.items)||0) + (Number(a.buffs)||0);
    abilities[k] = { total, mod: abilityMod(total) };
  }

  const lvl = totalLevel(cls);
  const hpBase = hpAverageD4(lvl);
  const hpMax = hpBase + abilities.con.mod * lvl;

  const ac = g.ac;
  const armorItem = Number(ac.armor)||0;
  const shieldItem = Number(ac.shield)||0;
  const mageArmorBonus = Number(g.buffs?.mageArmor)||0;
  const shieldSpellBonus = Number(g.buffs?.shieldSpell)||0;
  const armorUsed = Math.max(armorItem, mageArmorBonus);
  const shieldUsed = Math.max(shieldItem, shieldSpellBonus);

  const acTotal =
    10 + armorUsed + shieldUsed + abilities.dex.mod +
    (Number(ac.size)||0) + (Number(ac.natural)||0) +
    (Number(ac.deflect)||0) + (Number(ac.misc)||0);

  const touch = 10 + abilities.dex.mod + (Number(ac.size)||0) + (Number(ac.deflect)||0) + (Number(ac.miscTouch)||0);
  const flat  = 10 + armorUsed + shieldUsed + (Number(ac.size)||0) + (Number(ac.natural)||0) + (Number(ac.deflect)||0) + (Number(ac.misc)||0);

  const bab = babPoor(cls.sorc) + babPoor(cls.wiz) + babPoor(cls.um);

  const fortBase = savePoor(cls.sorc) + savePoor(cls.wiz) + savePoor(cls.um);
  const refBase  = savePoor(cls.sorc) + savePoor(cls.wiz) + savePoor(cls.um);
  const willBase = saveGood(cls.sorc) + saveGood(cls.wiz) + saveGood(cls.um);

  const saves = {
    fort: fortBase + abilities.con.mod + (Number(g.saves.fortMisc)||0),
    ref:  refBase  + abilities.dex.mod + (Number(g.saves.refMisc)||0),
    will: willBase + abilities.wis.mod + (Number(g.saves.willMisc)||0)
  };

  const init = abilities.dex.mod + (Number(g.initMisc)||0);
  const melee = bab + abilities.str.mod + (Number(g.attacks.meleeMisc)||0);
  const ranged = bab + abilities.dex.mod + (Number(g.attacks.rangedMisc)||0);

  return { lvl, abilities, hpMax, acTotal, touch, flat, bab, saves, init, melee, ranged };
}

/* ---------------------- Google Sheets ingest (CSV) ---------------------- */
/* Uses your NAS proxy endpoint: /gs/csv?id=...&gid=... */

function extractSpreadsheetId(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

async function fetchCsvViaProxy(sheetId, gid) {
  const url = `/gs/csv?id=${encodeURIComponent(sheetId)}&gid=${encodeURIComponent(gid)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`CSV proxy failed ${res.status}`);
  return await res.text();
}

function csvToGrid(csvText) {
  const wb = XLSX.read(csvText, { type: "string" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
}

async function loadFromGoogleSheets(sheetUrl) {
  try {
    const id = extractSpreadsheetId(sheetUrl);
    if (!id) throw new Error("Could not extract spreadsheet ID from URL.");

    const gids = {
      spells: 0,
      general: 2004670713,
      slot: 1231385124,
      skills: 2140364605
    };

    setProgress(5, "Fetching Spells…");
    const spellsGrid = csvToGrid(await fetchCsvViaProxy(id, gids.spells));

    setProgress(30, "Fetching General…");
    const generalGrid = csvToGrid(await fetchCsvViaProxy(id, gids.general));

    // Parse first; don't mark loaded until parsing succeeds
    ingestSpellsFromGrid(spellsGrid);
    ingestGeneralFromGrid(generalGrid);

    // Only now mark loaded
    state.loaded = true;

    setProgress(95, "Rendering…");
    render();
    setProgress(100, "Done ✅");
  } catch (e) {
    console.error(e);
    setProgress(0, "Load failed: " + (e?.message || e));
    // Keep the app alive even after failure
    state.loaded = false;
  }
}

function ingestGeneralFromGrid(grid) {
  const cell = (r, c) => (grid[r] && grid[r][c] != null) ? String(grid[r][c]) : "";
const num = (v, fb = 0) => {
  const s = String(v ?? "").trim().replace(",", ".");
  const m = s.match(/-?\d+(\.\d+)?/);   // grab first number anywhere in the string
  if (!m) return fb;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : fb;
};
  // Normalize header strings: lowercase, remove spaces and punctuation
  const norm = (s) =>
    String(s ?? "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^\p{L}\p{N}]/gu, ""); // keep letters/numbers only (unicode-safe)

  const findHeaderRow = () => {
    // Find a row containing "Ability" and at least one of the known headers
    // This is more robust than relying on exact positions.
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] || [];
      const nset = new Set(row.map(norm));
      if (nset.has("ability") && (
          nset.has("score") ||
          nset.has("pointbuyarray") ||
          nset.has("asi") ||
          nset.has("items") ||
          nset.has("penaltiesbuffs") ||
          nset.has("penaltiesbuff") ||
          nset.has("penaltiesbuffs") ||
          nset.has("penaltiesbuffs") // harmless redundancy
      )) {
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

  // ---- Base general object (identity tends to survive CSV well) ----
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

  // ---- Ability table: locate header row and columns ----
  const hdr = findHeaderRow();
  if (hdr !== -1) {
    const colAbility = findCol(hdr, "ability");

    // These are the column titles you gave (and match your sheet intent) [1](https://help.boox.com/hc/en-us)
    const colScore = findCol(hdr, "score");
    const colPB    = findColIncludes(hdr, "pointbuy");      // matches "Point buy array"
    const colASI   = findCol(hdr, "asi");
    const colItems = findCol(hdr, "items");
    const colBuffs = findColIncludes(hdr, "penalties") >= 0
      ? findColIncludes(hdr, "penalties")                   // matches "Penalties/buffs"
      : findColIncludes(hdr, "buffs");

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

// Read raw values
const score = colScore >= 0 ? num(cell(r, colScore), 0) : 0;
let pb  = colPB    >= 0 ? num(cell(r, colPB), 0)    : 0;
let asi = colASI   >= 0 ? num(cell(r, colASI), 0)   : 0;
const items = colItems >= 0 ? num(cell(r, colItems), 0) : 0;
const buffs = colBuffs >= 0 ? num(cell(r, colBuffs), 0) : 0;

// If PB is missing but Score and ASI exist, PB = Score - ASI
if (pb === 0 && score !== 0 && asi !== 0) {
  pb = score - asi;
}

// If ASI is missing but Score and PB exist, ASI = Score - PB
if (asi === 0 && score !== 0 && pb !== 0) {
  asi = score - pb;
}

// If both are missing but Score exists, treat Score as PB (fallback)
if (pb === 0 && asi === 0 && score !== 0) {
  pb = score;
}

general.abilities[key] = { pointBuy: pb, asi, items, buffs };

    }
  }

  // ---- Feats (CSV gives text; links are not preserved) ---- [1](https://help.boox.com/hc/en-us)
  // Find the row containing exact label and read downward in the same column (usually col 0)
  let featsRow = -1;
  for (let r = 0; r < grid.length; r++) {
    if ((grid[r] || []).some(v => String(v).trim() === "Feats & Special Abilities")) { featsRow = r; break; }
  }
  if (featsRow !== -1) {
    for (let r = featsRow + 1; r < Math.min(featsRow + 60, grid.length); r++) {
      const t = cell(r, 0).trim();
      if (!t) break;
      general.feats.push({ label: t, url: "" });
    }
  }

  // ---- Languages ---- [1](https://help.boox.com/hc/en-us)
  // Find "Languages:" anywhere and read downward in the same column
  let langPos = null;
  for (let r = 0; r < grid.length && !langPos; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (String(row[c]).trim() === "Languages:") { langPos = { r, c }; break; }
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

function ingestSpellsFromGrid(grid) {
  const cell = (r, c) => (grid[r] && grid[r][c] != null) ? String(grid[r][c]) : "";
  const num = (s, fb = 0) => {
    const n = Number(String(s).replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };

  const findRowContaining = (text) =>
    grid.findIndex(row => (row || []).some(v => String(v).trim() === text));

  const sorcHeader = findRowContaining("Spell slots (S)");
  const wizHeader  = findRowContaining("Spell slots (W)");

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
    // If preferredCol exists, verify it actually contains spell names in next rows.
    // Otherwise scan the row for first column with non-empty values for several rows.
    const candidates = [];
    if (preferredCol != null) candidates.push(preferredCol, preferredCol - 1, preferredCol + 1);

    // Add all columns as fallback candidates (left->right)
    const header = grid[headerRow] || [];
    for (let c = 0; c < header.length; c++) candidates.push(c);

    const seen = new Set();
    for (const c of candidates) {
      if (c == null || c < 0) continue;
      if (seen.has(c)) continue;
      seen.add(c);

      // Look at next few rows; if 2+ are non-empty and not numeric-only, accept
      let hits = 0;
      for (let r = headerRow + 1; r < Math.min(headerRow + 15, grid.length); r++) {
        const t = cell(r, c).trim();
        if (!t) continue;
        // Ignore obvious numeric columns
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

    // Spell column label differs between blocks. Grab whichever exists, but validate by scanning.
    const preferredSpellCol =
      h["Sorcerer"] ?? h["Wizard"] ?? h["  Wizard"] ?? h["Spell"] ?? null;

    const colSpell = findSpellColByScanning(headerRow, preferredSpellCol);

    const rows = [];
    for (let r = headerRow + 1; r < grid.length; r++) {
      const name = cell(r, colSpell).trim();
      if (!name) break;

      rows.push({
        mode,
        name,
        url: "", // CSV won't preserve hyperlink targets reliably
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
  state.data.spells.wiz  = readBlock(wizHeader, "wiz");

  // Meta: keep your current baseline; we can pull levels from sheet later if desired
  state.data.spells.meta = { sorcLevels: 1, wizLevels: 5, umLevels: 2, arcaneSpellpower: 1 };
}
/* ------------------------------ XLSX ingest ---------------------------- */
function ingestGeneralFromXlsx(wb) {
  const ws = wb.Sheets["General info"];
  if (!ws) throw new Error("Sheet 'General info' not found");

  const v = (addr, fallback="") => (ws[addr] && ws[addr].v !== undefined) ? ws[addr].v : fallback;

  state.data.general = {
    characterName: String(v("A1","")),
    playerName: String(v("B1","")),
    alignment: String(v("C1","")),
    xp: Number(v("E1",0)) || 0,
    classLine: String(v("A4","")),
    race: String(v("D4","")),
    size: String(v("B7","")),
    age: Number(v("C7",0)) || 0,
    gender: String(v("D7","")),
    classes: { sorc: 1, wiz: 5, um: 2 },
    abilities: {
      str: { pointBuy: Number(v("J12",0))||0, asi: Number(v("K12",0))||0, items: Number(v("G12",0))||0, buffs: Number(v("H12",0))||0 },
      dex: { pointBuy: Number(v("J13",0))||0, asi: Number(v("K13",0))||0, items: Number(v("G13",0))||0, buffs: Number(v("H13",0))||0 },
      con: { pointBuy: Number(v("J14",0))||0, asi: Number(v("K14",0))||0, items: Number(v("G14",0))||0, buffs: Number(v("H14",0))||0 },
      int: { pointBuy: Number(v("J15",0))||0, asi: Number(v("K15",0))||0, items: Number(v("G15",0))||0, buffs: Number(v("H15",0))||0 },
      wis: { pointBuy: Number(v("J16",0))||0, asi: Number(v("K16",0))||0, items: Number(v("G16",0))||0, buffs: Number(v("H16",0))||0 },
      cha: { pointBuy: Number(v("J17",0))||0, asi: Number(v("K17",0))||0, items: Number(v("G17",0))||0, buffs: Number(v("H17",0))||0 }
    },
    ac: {
      armor: Number(v("D21",0))||0,
      shield: Number(v("E21",0))||0,
      size: Number(v("G21",0))||0,
      natural: Number(v("H21",0))||0,
      deflect: Number(v("J21",0))||0,
      misc: Number(v("L21",0))||0,
      miscTouch: 0
    },
    saves: { fortMisc: 0, refMisc: 0, willMisc: 0 },
    attacks: { meleeMisc: 0, rangedMisc: 0, grappleMisc: 0 },
    initMisc: 0,
    buffs: { mageArmor: 0, shieldSpell: 0 },
    feats: [],
    languages: []
  };
}
// Example: if the sheet contains a "Slots" CSV block, ingest it and persist
// (This is optional and depends on your sheet layout)
if (typeof ingestSlotsCsv === "function") {
  // Suppose you have a CSV string or grid; call ingestSlotsCsv(csvText, {source: 'gs', id: sheetId});
  // ingestSlotsCsv(csvText, {source: 'google-sheets'});
}
function ingestSpellsFromXlsx(wb) {
  const ws = wb.Sheets["Spells"];
  if (!ws) throw new Error("Sheet 'Spells' not found");

  const range = XLSX.utils.decode_range(ws["!ref"]);
  const cellAt = (r,c) => ws[XLSX.utils.encode_cell({r,c})];

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
        const cell = cellAt(r,c);
        if (!cell || cell.v === undefined) continue;
        if (String(cell.v).trim() === text) return r;
      }
    }
    return -1;
  }

  const sorcHeader = findRowWithText("Spell slots (S)");
  const wizHeader  = findRowWithText("Spell slots (W)");

  function readBlock(headerRow, mode) {
    if (headerRow < 0) return [];
    const header = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = cellAt(headerRow,c);
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

    // resolve spell column shift by checking neighbors
    function resolveSpellCol(spellCol) {
      if (spellCol === undefined) return undefined;
      for (let r = headerRow+1; r <= Math.min(headerRow+20, range.e.r); r++) {
        const here = cellAt(r, spellCol);
        const left = cellAt(r, spellCol-1);
        const right = cellAt(r, spellCol+1);
        if (cellHasContent(here)) return spellCol;
        if (cellHasContent(left)) return spellCol-1;
        if (cellHasContent(right)) return spellCol+1;
      }
      return spellCol;
    }
    col.spell = resolveSpellCol(col.spell);

    const rows = [];
    for (let r = headerRow+1; r <= range.e.r; r++) {
      const spellCell = col.spell !== undefined ? cellAt(r, col.spell) : null;
      if (!cellHasContent(spellCell)) break;

      const name = spellCell.v !== undefined ? String(spellCell.v) : "(spell)";

      const get = (c) => {
        if (c === undefined) return "";
        const cell = cellAt(r,c);
        if (!cell) return "";
        return (cell.w !== undefined ? cell.w : (cell.v ?? ""));
      };
      const num = (c) => Number(get(c)) || 0;

      rows.push({
        mode, name, url: "",
        sl: num(col.sl),
        type: String(get(col.type)||""),
        evo: num(col.evo) === 1,
        fire: num(col.fire) === 1,
        range: String(get(col.range)||""),
        area: String(get(col.area)||""),
        damage: String(get(col.damage)||""),
        duration: String(get(col.duration)||""),
        notes: String(get(col.notes)||""),
        prep: mode === "wiz" ? String(get(col.prep)||"") : ""
      });
    }
    return rows;
  }

  state.data.spells.sorc = readBlock(sorcHeader, "sorc");
  state.data.spells.wiz  = readBlock(wizHeader, "wiz");

  // XLSX meta might exist; we keep a simple default
  state.data.spells.meta = { sorcLevels: 1, wizLevels: 5, umLevels: 2, arcaneSpellpower: 1 };
}

/* ------------------------------ Rendering ------------------------------ */
function computeSpellDC(sl, castingMod) {
  return 10 + (Number(sl)||0) + (Number(castingMod)||0);
}

// Preserve your sheet-style CL approximation for now
function computeSpellCL(spell, meta) {
  const bonusFireEvo = (spell.evo && spell.fire) ? 2 : 0;
  if (spell.mode === "wiz") return (meta.wizLevels||0) + (meta.umLevels||0) + bonusFireEvo;
  return (meta.sorcLevels||0) + (meta.umLevels||0) + (meta.arcaneSpellpower||0) + bonusFireEvo;
}

function renderGeneral() {
  const g = state.data.general;

  if (!g) {
    el.app.innerHTML = `<div class="panel"><h2>General</h2><div class="hint">No general data loaded.</div></div>`;
    return;
  }

  // Defensive defaults so missing fields never crash rendering
  g.feats = Array.isArray(g.feats) ? g.feats : [];
  g.languages = Array.isArray(g.languages) ? g.languages : [];

  g.abilities = g.abilities || {};
  for (const k of ["str","dex","con","int","wis","cha"]) {
    g.abilities[k] = g.abilities[k] || { pointBuy: 0, asi: 0, items: 0, buffs: 0 };
  }

  g.ac = g.ac || { armor: 0, shield: 0, size: 0, natural: 0, deflect: 0, misc: 0, miscTouch: 0 };
  g.buffs = g.buffs || { mageArmor: 0, shieldSpell: 0 };
  g.classes = g.classes || { sorc: 1, wiz: 5, um: 2 };
  g.saves = g.saves || { fortMisc: 0, refMisc: 0, willMisc: 0 };
  g.attacks = g.attacks || { meleeMisc: 0, rangedMisc: 0, grappleMisc: 0 };
  g.initMisc = g.initMisc || 0;

  const d = computeGeneralDerived(g);
  const A = d.abilities;

  // Helper to render one ability row with breakdown
const abilityRow = (label, key) => `
  <div><strong>${label}</strong></div>
  <div class="val">${g.abilities[key].pointBuy ?? 0}</div>

<div class="val">
  <input type="number" inputmode="numeric"
    data-ab="${key}" data-field="asi"
    value="${Number(g.abilities[key].asi ?? 0)}">
</div>

  <div class="val">
    <input type="number" inputmode="numeric"
      data-ab="${key}" data-field="items"
      value="${Number(g.abilities[key].items ?? 0)}">
  </div>

  <div class="val">
    <input type="number" inputmode="numeric"
      data-ab="${key}" data-field="buffs"
      value="${Number(g.abilities[key].buffs ?? 0)}">
  </div>

  <div class="val"><strong>${A[key].total}</strong></div>
  <div class="val"><strong>${fmtSign(A[key].mod)}</strong></div>
`;

  el.app.innerHTML = `
    <div class="panel">
      <h2>General</h2>

      <div class="grid">
        <div class="panel">
          <h3>Identity</h3>
          <div><strong>${escapeHtml(g.characterName || "")}</strong> (${escapeHtml(g.alignment || "")})</div>
          <div>Player: ${escapeHtml(g.playerName || "")}</div>
          <div>Race: ${escapeHtml(g.race || "")}</div>
          <div>Class: ${escapeHtml(g.classLine || "")}</div>
          <div>Level: <strong>${d.lvl}</strong></div>
        </div>

        <div class="panel">
          <h3>Combat</h3>
          <div>HP (max): <strong>${d.hpMax}</strong></div>
          <div>AC: <strong>${d.acTotal}</strong> (Touch ${d.touch}, Flat ${d.flat})</div>
          <div>Init: <strong>${fmtSign(d.init)}</strong></div>
          <div>BAB: <strong>${fmtSign(d.bab)}</strong></div>
          <div>Melee: <strong>${fmtSign(d.melee)}</strong> | Ranged: <strong>${fmtSign(d.ranged)}</strong></div>

          <div style="margin-top:8px;">
            <h4>Active Buffs (AC)</h4>
            <label><input id="buff_mage" type="checkbox" ${g.buffs.mageArmor ? "checked":""}> Mage Armor (+4)</label><br>
            <label><input id="buff_shield" type="checkbox" ${g.buffs.shieldSpell ? "checked":""}> Shield (+4)</label>
          </div>
        </div>
      </div>

      <div class="panel">
        <h3>Abilities (breakdown)</h3>
        <div class="hint">Point buy array / ASI / Items / Penalties-buffs → Total → Mod [1](https://help.boox.com/hc/en-us)</div>

        <div class="ability-breakdown-grid">
          <div></div>
          <div class="hdr">Point buy</div>
          <div class="hdr">ASI</div>
          <div class="hdr">Items</div>
          <div class="hdr">Buffs</div>
          <div class="hdr">Total</div>
          <div class="hdr">Mod</div>

          ${abilityRow("STR","str")}
          ${abilityRow("DEX","dex")}
          ${abilityRow("CON","con")}
          ${abilityRow("INT","int")}
          ${abilityRow("WIS","wis")}
          ${abilityRow("CHA","cha")}
        </div>
      </div>

      <div class="grid">
        <div class="panel">
          <h3>Feats</h3>
          <ul>${g.feats.length ? g.feats.map(f => `<li>${escapeHtml(f.label ?? f)}</li>`).join("") : "<li>(none found)</li>"}</ul>
          <div class="hint">CSV export doesn’t preserve hyperlinks; feats are text-only in Google mode. [1](https://help.boox.com/hc/en-us)</div>
        </div>

        <div class="panel">
          <h3>Languages</h3>
          <ul>${g.languages.length ? g.languages.map(x => `<li>${escapeHtml(x)}</li>`).join("") : "<li>(none found)</li>"}</ul>
        </div>
      </div>
    </div>
  `;

  // Buff wiring
  const mage = $("buff_mage");
  const shield = $("buff_shield");
  if (mage) mage.onchange = () => { g.buffs.mageArmor = mage.checked ? 4 : 0; renderGeneral(); ink.redraw(); };
  if (shield) shield.onchange = () => { g.buffs.shieldSpell = shield.checked ? 4 : 0; renderGeneral(); ink.redraw(); };
// Hook ability inputs (Items + Buffs)
document.querySelectorAll('.ability-breakdown-grid input[data-ab][data-field]').forEach(inp => {
  inp.addEventListener('input', () => {
    const ab = inp.getAttribute('data-ab');
    const field = inp.getAttribute('data-field');
    const val = Number(inp.value);
    g.abilities[ab][field] = Number.isFinite(val) ? val : 0;
    // Re-render so totals/mods update
    renderGeneral();
    ink.redraw();
  });
});
``

}
function renderSpellTable(rows, meta, castingMod, showPrep) {
  if (!rows || !rows.length) return `<div class="hint">No spells loaded.</div>`;

  return `
    <table class="table">
      <thead>
        <tr>
          <th>Spell</th><th>SL</th><th>CL</th><th>DC</th>
          ${showPrep ? "<th>Prep</th>" : ""}
          <th>Type</th><th>F</th><th>E</th>
          <th>Range</th><th>Area</th><th>Damage</th><th>Duration</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(s => {
          const cl = computeSpellCL(s, meta);
          const dc = computeSpellDC(s.sl, castingMod);

          // Spell name (CSV mode has no URL; XLSX mode may have s.url)
          const spellCell = s.url
            ? `<a href="${String(s.url).replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)}</a>`
            : escapeHtml(s.name);

          // Prep box is intentionally empty for pen scribbles
          const anchorId = `${s.mode}:${s.name}:prep`
            .toLowerCase()
            .replace(/\s+/g, "_")
            .replace(/[^a-z0-9:_-]/g, "");

          const prepCell = showPrep
            ? `<td><span class="prep-box" data-ink-anchor="${anchorId}"></span></td>`
            : "";

          return `
            <tr>
              <td>${spellCell}</td>
              <td>${Number(s.sl) || 0}</td>
              <td>${cl}</td>
              <td>${dc}</td>
              ${prepCell}
              <td>${escapeHtml(s.type || "")}</td>
              <td>${s.fire ? "✓" : ""}</td>
              <td>${s.evo ? "✓" : ""}</td>
              <td>${escapeHtml(s.range || "")}</td>
              <td>${escapeHtml(s.area || "")}</td>
              <td>${escapeHtml(s.damage || "")}</td>
              <td>${escapeHtml(s.duration || "")}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderSpells() {
  const g = state.data.general;
  const meta = state.data.spells.meta || { sorcLevels:1, wizLevels:5, umLevels:2, arcaneSpellpower:1 };
  const d = g ? computeGeneralDerived(g) : null;
  const intMod = d ? d.abilities.int.mod : 0;
  const chaMod = d ? d.abilities.cha.mod : 0;

  const sorcRows = state.data.spells.sorc || [];
  const wizRows  = state.data.spells.wiz || [];

  el.app.innerHTML = `
    <div class="panel">
      <h2>Spells</h2>
      <div class="hint">Pan/zoom the paper; use Pen to write in prep boxes.</div>

      <div class="grid">
        <div class="panel">
          <h3>Sorcerer / UM</h3>
          ${renderSpellTable(sorcRows, meta, chaMod, false)}
        </div>

        <div class="panel">
          <h3>Wizard</h3>
          ${renderSpellTable(wizRows, meta, intMod, true)}
        </div>
      </div>
    </div>
  `;
}

function render() {
  if (!el.app) return;

  if (!state.loaded) {
    el.app.innerHTML = `
      <div class="panel">
        <h2>Load</h2>
        <div class="hint">
          Load via Google Sheets (recommended on Boox) or upload XLSX.
        </div>
      </div>
    `;
    applyWorldTransform();
    ink.redraw();
    return;
  }

  if (state.view === "General") renderGeneral();
  else if (state.view === "Spells") renderSpells();
  else el.app.innerHTML = `<div class="panel"><h2>${escapeHtml(state.view)}</h2><div class="hint">Not implemented yet.</div></div>`;

  applyWorldTransform();
  ink.redraw();
}
// Initialize DB and load persisted slots (so data/slots.js actually persists to idb)
(async function initPersistenceAndSlots() {
  try {
    const db = await openDb();
    // Load all persisted slots into slotsModel (if any)
    const persisted = await idbGetAll(db, 'slots');
    if (Array.isArray(persisted)) {
      for (const s of persisted) slotsModel.byId[s.id] = s;
    }
    // Add a small UI hook: if there's a #viewSlots element, clicking it will render a simple slots panel
    if (el.viewSlots) {
      el.viewSlots.onclick = () => {
        const list = Object.values(slotsModel.byId);
        el.app.innerHTML = `
          <div class="panel">
            <h2>Slots</h2>
            <div class="hint">Loaded slots from IndexedDB</div>
            <ul>${list.length ? list.map(x => `<li>${escapeHtml(x.class)} L${x.level}: ${escapeHtml(String(x.slots))}</li>`).join("") : "<li>(none)</li>"}</ul>
          </div>
        `;
      };
    }
  } catch (err) {
    console.warn("Could not initialize persistence:", err);
  }
})();
/* --------------------------- XLSX loading ------------------------------ */
if (el.file) {
  el.file.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setProgress(5, "Reading file…");
      await nextFrame();
      const buf = await file.arrayBuffer();

      setProgress(20, "Parsing workbook…");
      await nextFrame();

      if (typeof XLSX === "undefined") throw new Error("XLSX library not loaded (xlsx.full.min.js)");

      const wb = XLSX.read(buf, { type: "array" });

      setProgress(45, "Ingesting General…");
      ingestGeneralFromXlsx(wb);

      setProgress(65, "Ingesting Spells…");
      ingestSpellsFromXlsx(wb);

      state.loaded = true;

      setProgress(90, "Rendering…");
      ink.loadForView(state.view);
      render();

      setProgress(100, "Done ✅");
    } catch (err) {
      console.error(err);
      setProgress(0, "XLSX load error (see console)");
    }
  });
}

/* ---------------------- Hook Google Sheets button ---------------------- */
window.addEventListener("DOMContentLoaded", () => {
  if (el.loadGs && el.gsUrl) {
    el.loadGs.addEventListener("click", async () => {
      try {
        const url = el.gsUrl.value.trim();
        if (!url) {
          setProgress(0, "Paste a Google Sheets URL first.");
          return;
        }
        await loadFromGoogleSheets(url);
      } catch (e) {
        console.error(e);
        setProgress(0, "Google Sheets load failed (see console).");
      }
    });
  } else {
    console.warn("Google Sheets UI not present (#gsUrl / #loadGs).");
  }
});

// Initial setup
applyWorldTransform();
ink.loadForView(state.view);
render();
