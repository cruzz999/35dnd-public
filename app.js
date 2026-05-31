/* ==========================================================================
DnD 3.5 Ink Sheet (Paper Mode) - app.js
- Pan/zoom paper inside #viewport/#world (no page scroll)
- Stylus-safe ink layer on #inkWorld (world coordinates)
- Google Sheets CSV ingest (NAS proxy)
========================================================================== */

/* ----------------------------- DOM helpers ------------------------------ */
const $ = (id) => document.getElementById(id);

const el = {
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
  loaded: false,
  view: "General",
  pan: { x: 20, y: 20 },
  zoom: 1.0,
  penOn: false,
  erasing: false,
  strokesByView: {},
  data: { general: null, spells: { sorc: [], wiz: [], meta: null } },
  lineWidth: 2,
  eraserWidth: 18
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
  return String(s).replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[m])
  );
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
  const topbarRect = topbar ? topbar.getBoundingClientRect() : { height: 64 };
  const topbarH = Math.ceil(topbarRect.height);

  const vp = el.viewport;
  if (vp) {
    vp.style.paddingTop = `${topbarH}px`;
    vp.style.height = `calc(100vh - ${topbarH}px)`;
    vp.style.overflow = 'auto';
  }
}

window.addEventListener("resize", () => {
  syncViewportHeight();
  // ensure canvas and transforms are recalculated on resize
  if (ink && typeof ink.ensureCanvasSize === "function") {
    try { ink.ensureCanvasSize(); } catch {}
  }
  applyWorldTransform();
  if (ink && typeof ink.redraw === "function") {
    try { ink.redraw(); } catch {}
  }
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
  if (anchorClientX != null && anchorClientY != null && el.viewport) {
    const vr = el.viewport.getBoundingClientRect();
    const vx = anchorClientX - vr.left + el.viewport.scrollLeft;
    const vy = anchorClientY - vr.top + el.viewport.scrollTop;
    const wx = (vx - state.pan.x) / oldZoom;
    const wy = (vy - state.pan.y) / oldZoom;
    state.pan.x = vx - wx * newZoom;
    state.pan.y = vy - wy * newZoom;
  }
  state.zoom = newZoom;
  applyWorldTransform();
  syncViewportHeight();
  if (ink && typeof ink.ensureCanvasSize === "function") {
    try { ink.ensureCanvasSize(); } catch {}
  }
  if (ink && typeof ink.redraw === "function") {
    try { ink.redraw(); } catch {}
  }
}

function resetView() {
  state.zoom = 1.0;
  state.pan.x = 20;
  state.pan.y = 20;
  applyWorldTransform();
  if (ink && typeof ink.ensureCanvasSize === "function") {
    try { ink.ensureCanvasSize(); } catch {}
  }
  if (ink && typeof ink.redraw === "function") {
    try { ink.redraw(); } catch {}
  }
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
if (el.viewSpells) el.viewSpells.onclick = () => setView("Spells");
if (el.viewSlots) el.viewSlots.onclick = () => setView("Slots");
if (el.viewSkills) el.viewSkills.onclick = () => setView("Skills");

/* --------------------------- Zoom controls ----------------------------- */
if (el.zoomOut) el.zoomOut.onclick = () => setZoom(state.zoom / 1.15);
if (el.zoomIn) el.zoomIn.onclick = () => setZoom(state.zoom * 1.15);
if (el.zoomReset) el.zoomReset.onclick = () => resetView();

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
  if (ink && typeof ink.redraw === "function") ink.redraw();
}

function endPan() {
  panDrag.active = false;
}

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
const ink = (() => {
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

  // Expose ensureCanvasSize for external calls
  function ensureCanvasSize() {
    if (!canvas || !ctx || !el.viewport) return;

    // Make canvas an absolute child of the viewport and fill it
    canvas.style.position = 'absolute';
    canvas.style.left = '0px';
    canvas.style.top = '0px';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = '5';
    canvas.style.touchAction = 'none';

    // Use layout size (clientWidth/clientHeight) to avoid transform artifacts
    const cssW = Math.max(1, el.viewport.clientWidth);
    const cssH = Math.max(1, el.viewport.clientHeight);

    const dpr = window.devicePixelRatio || 1;
    const backingW = Math.max(1, Math.floor(cssW * dpr));
    const backingH = Math.max(1, Math.floor(cssH * dpr));

    if (canvas.width !== backingW || canvas.height !== backingH) {
      canvas.width = backingW;
      canvas.height = backingH;
    }

    // Only intercept pointer events when pen mode is active
    canvas.style.pointerEvents = state.penOn ? 'auto' : 'none';
  }

  // Invert the transform used in redraw()
  function screenToWorld(clientX, clientY) {
    if (!canvas || !el.viewport) return { x: 0, y: 0 };

    // Canvas is positioned at top-left of viewport; use its client rect
    const crect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // client coords relative to canvas top-left (CSS pixels)
    const cx = clientX - crect.left;
    const cy = clientY - crect.top;

    // convert to CSS pixels (remove DPR)
    const xCss = cx / dpr;
    const yCss = cy / dpr;

    // invert world transform: world = (css - pan) / zoom
    return {
      x: (xCss - state.pan.x) / state.zoom,
      y: (yCss - state.pan.y) / state.zoom
    };
  }

  function drawStroke(stroke) {
    if (!ctx) return;
    const pts = stroke.pts || [];
    if (pts.length < 2) return;
    ctx.save();
    if (stroke.erase) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = state.eraserWidth || 18;
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = (stroke.width && Number(stroke.width)) ? Number(stroke.width) : (state.lineWidth || 2);
      ctx.strokeStyle = "#000";
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function redraw() {
    if (!canvas || !ctx || !el.viewport) return;
    ensureCanvasSize();

    // Clear device-pixel canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const dpr = window.devicePixelRatio || 1;

    // Apply transform: scale by dpr*zoom, translate by dpr*pan
    ctx.setTransform(dpr * state.zoom, 0, 0, dpr * state.zoom, dpr * state.pan.x, dpr * state.pan.y);

    // Draw strokes (assumes stroke points are stored in world coordinates)
    const strokes = (state.strokesByView[state.view] || []);
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
    if (e.pointerType === "touch") return;
    drawing = true;
    activePointerId = e.pointerId;
    const p = screenToWorld(e.clientX, e.clientY);
    currentStroke = { erase: state.erasing, pts: [p], width: state.erasing ? state.eraserWidth : state.lineWidth };
    getStrokesForView(state.view).push(currentStroke);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
    redraw();
  }

  function pointerMove(e) {
    if (!state.penOn || !drawing || !currentStroke) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    if (e.pointerType === "touch") return;
    currentStroke.pts.push(screenToWorld(e.clientX, e.clientY));
    e.preventDefault();
    redraw();
  }

  function endStroke(e) {
    if (!state.penOn) return;
    if (e && activePointerId !== null && e.pointerId !== activePointerId) return;
    drawing = false;
    currentStroke = null;
    if (canvas && e) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
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

  window.addEventListener("resize", () => { ensureCanvasSize(); redraw(); });
  ensureCanvasSize();

  // expose ensureCanvasSize/redraw for external callers
  return { redraw, loadForView, setPenMode, setEraser, ensureCanvasSize };
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
  const acTotal = 10 + armorUsed + shieldUsed + abilities.dex.mod + (Number(ac.size)||0) + (Number(ac.natural)||0) + (Number(ac.deflect)||0) + (Number(ac.misc)||0);
  const touch = 10 + abilities.dex.mod + (Number(ac.size)||0) + (Number(ac.deflect)||0) + (Number(ac.miscTouch)||0);
  const flat = 10 + armorUsed + shieldUsed + (Number(ac.size)||0) + (Number(ac.natural)||0) + (Number(ac.deflect)||0) + (Number(ac.misc)||0);
  const bab = babPoor(cls.sorc) + babPoor(cls.wiz) + babPoor(cls.um);
  const fortBase = savePoor(cls.sorc) + savePoor(cls.wiz) + savePoor(cls.um);
  const refBase = savePoor(cls.sorc) + savePoor(cls.wiz) + savePoor(cls.um);
  const willBase = saveGood(cls.sorc) + saveGood(cls.wiz) + saveGood(cls.um);
  const saves = {
    fort: fortBase + abilities.con.mod + (Number(g.saves.fortMisc)||0),
    ref: refBase + abilities.dex.mod + (Number(g.saves.refMisc)||0),
    will: willBase + abilities.wis.mod + (Number(g.saves.willMisc)||0)
  };
  const init = abilities.dex.mod + (Number(g.initMisc)||0);
  const melee = bab + abilities.str.mod + (Number(g.attacks.meleeMisc)||0);
  const ranged = bab + abilities.dex.mod + (Number(g.attacks.rangedMisc)||0);
  return { lvl, abilities, hpMax, acTotal, touch, flat, bab, saves, init, melee, ranged };
}

/* ---------------------- Google Sheets ingest (CSV) ---------------------- */
/* Uses your NAS proxy endpoint: /gs/csv?id=...&gid=... */

// extract spreadsheet id from a Google Sheets URL
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

// Lightweight CSV parser that returns an array-of-arrays (grid)
function csvToGrid(csvText) {
  const rows = [];
  let cur = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  while (i < csvText.length) {
    const ch = csvText[i];

    if (inQuotes) {
      if (ch === '"') {
        if (csvText[i+1] === '"') {
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        field += ch;
        i++;
        continue;
      }
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === ',') {
      cur.push(field);
      field = "";
      i++;
      continue;
    }

    if (ch === '\r') {
      i++;
      continue;
    }

    if (ch === '\n') {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  if (inQuotes) {
    cur.push(field);
    rows.push(cur);
  } else if (field !== "" || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }

  return rows;
}

/* -------------------- Grid ingest helpers (restored) ------------------ */
/*
  The following two functions parse the CSV grid into the app's internal
  data structures. They are written to be robust to minor layout changes
  in the spreadsheet but assume the Slot Info tab uses recognizable headers.
*/

function findRowByPrefix(grid, prefix) {
  if (!grid || !grid.length) return -1;
  prefix = String(prefix).trim().toLowerCase();
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || "").trim().toLowerCase();
      if (cell.indexOf(prefix) === 0) return r;
    }
  }
  return -1;
}

function findHeaderRow(grid, headerText) {
  if (!grid || !grid.length) return -1;
  headerText = String(headerText).trim().toLowerCase();
  for (let r = 0; r < Math.min(12, grid.length); r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (String(row[c] || "").trim().toLowerCase() === headerText) return r;
    }
  }
  return -1;
}

/*
  ingestSpellsFromGrid(grid)
  - expects the spells CSV (Slot Info tab exported)
  - extracts two slot tables: Sorcerer slots and Wizard/Evoker slots
  - stores them into state.data.slots = { sorcerer: {level: [..]}, wizard: {...} }
  - also extracts current class levels if present
*/
function ingestSpellsFromGrid(grid) {
  try {
    state.data.slots = state.data.slots || { sorcerer: {}, wizard: {} };

    // Heuristics: find "Sorcerer" header and "Evoker" or "Wizard" header
    // Many sheets label the table with "Sorcerer spell slots" or similar.
    // We'll scan for rows that look like "Level" followed by numeric columns.

    // Find row that contains "Sorcerer" or "Sorcerer spell slots"
    let sorcererHeaderRow = -1;
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r].map(c => String(c || "").toLowerCase());
      if (row.some(c => c.includes("sorcerer") && c.includes("slot"))) { sorcererHeaderRow = r; break; }
      if (row.some(c => c === "sorcerer")) { sorcererHeaderRow = r; break; }
    }

    // Find row that contains "Evoker" or "Wizard"
    let wizardHeaderRow = -1;
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r].map(c => String(c || "").toLowerCase());
      if (row.some(c => c.includes("evoker") && c.includes("slot"))) { wizardHeaderRow = r; break; }
      if (row.some(c => c === "evoker") || row.some(c => c === "wizard")) { wizardHeaderRow = r; break; }
    }

    // If we couldn't find explicit headers, try to find "Level" columns and assume tables nearby
    function parseTableFromHeaderRow(r) {
      if (r < 0 || r >= grid.length) return null;
      const header = grid[r];
      // find the index of the "Level" column
      let levelCol = -1;
      for (let c = 0; c < header.length; c++) {
        const h = String(header[c] || "").trim().toLowerCase();
        if (h === "level" || h === "lvl" || h === "lv") { levelCol = c; break; }
      }
      // If no explicit "Level" header, try to find a numeric column in the next rows
      if (levelCol === -1) {
        // scan next 2 rows for a column that contains 1,2,3...
        for (let c = 0; c < header.length; c++) {
          let found = false;
          for (let rr = r+1; rr < Math.min(grid.length, r+8); rr++) {
            const val = String(grid[rr][c] || "").trim();
            if (/^\d+$/.test(val)) { found = true; break; }
          }
          if (found) { levelCol = c; break; }
        }
      }
      if (levelCol === -1) return null;

      // Determine spell level columns: look for columns to the right that have small integers (0..9) in header or first data row
      const spellCols = [];
      for (let c = levelCol + 1; c < Math.min(levelCol + 12, header.length); c++) {
        // header may contain "0", "1", "2" etc.
        const h = String(header[c] || "").trim();
        if (h === "" && grid[r+1] && /^\d+$/.test(String(grid[r+1][c] || "").trim())) {
          // accept
          spellCols.push(c);
        } else if (/^[0-9]$/.test(h)) {
          spellCols.push(c);
        } else {
          // stop when we hit a non-numeric header and non-numeric next row
          // but allow a few gaps
          // continue scanning a few more columns
          // break only if we've already collected some
          if (spellCols.length > 0) break;
        }
      }

      // Now parse rows below header until we hit an empty row or non-numeric level
      const table = {};
      for (let rr = r + 1; rr < grid.length; rr++) {
        const row = grid[rr];
        if (!row || row.length <= levelCol) break;
        const levelCell = String(row[levelCol] || "").trim();
        if (!/^\d+$/.test(levelCell)) break;
        const lvl = Number(levelCell);
        const arr = [];
        for (let sc = 0; sc < spellCols.length; sc++) {
          const cidx = spellCols[sc];
          const raw = String(row[cidx] || "").trim();
          if (raw === "-" || raw === "") arr.push(0);
          else if (/^\d+$/.test(raw)) arr.push(Number(raw));
          else {
            // try to parse like "6 (1)" or "6+1"
            const m = raw.match(/(\d+)/);
            arr.push(m ? Number(m[1]) : 0);
          }
        }
        table[lvl] = arr;
      }
      return table;
    }

    const sorTable = parseTableFromHeaderRow(sorcererHeaderRow) || {};
    const wizTable = parseTableFromHeaderRow(wizardHeaderRow) || {};

    // store into state
    state.data.slots = state.data.slots || {};
    state.data.slots.sorcerer = sorTable;
    state.data.slots.wizard = wizTable;

    // Also try to find current levels in the sheet (look for "Current Sorcerer Level" etc.)
    const curSorcRow = findRowByPrefix(grid, "current sorcerer");
    if (curSorcRow >= 0) {
      for (let c = 0; c < grid[curSorcRow].length; c++) {
        const cell = String(grid[curSorcRow][c] || "").trim();
        if (/^\d+$/.test(cell)) {
          state.data.currentSorcererLevel = Number(cell);
          break;
        }
      }
    }
    const curWizRow = findRowByPrefix(grid, "current evoker");
    if (curWizRow >= 0) {
      for (let c = 0; c < grid[curWizRow].length; c++) {
        const cell = String(grid[curWizRow][c] || "").trim();
        if (/^\d+$/.test(cell)) {
          state.data.currentWizardLevel = Number(cell);
          break;
        }
      }
    }

    // fallback: try to find "Current Sorcerer Level" or "Current Wizard Level" anywhere
    if (!state.data.currentSorcererLevel) {
      const r = findRowByPrefix(grid, "current sorcerer level");
      if (r >= 0) {
        for (let c = 0; c < grid[r].length; c++) {
          const cell = String(grid[r][c] || "").trim();
          if (/^\d+$/.test(cell)) { state.data.currentSorcererLevel = Number(cell); break; }
        }
      }
    }
    if (!state.data.currentWizardLevel) {
      const r = findRowByPrefix(grid, "current evoker level") || findRowByPrefix(grid, "current wizard level");
      if (r >= 0) {
        for (let c = 0; c < grid[r].length; c++) {
          const cell = String(grid[r][c] || "").trim();
          if (/^\d+$/.test(cell)) { state.data.currentWizardLevel = Number(cell); break; }
        }
      }
    }

    // done
    return true;
  } catch (e) {
    console.error("ingestSpellsFromGrid error:", e);
    return false;
  }
}

/*
  ingestGeneralFromGrid(grid)
  - parses the general tab CSV into state.data.general
  - extracts abilities, classes, saves, AC, etc. Minimal but sufficient for slot calc.
*/
function ingestGeneralFromGrid(grid) {
  try {
    const g = {
      classes: { sorc: 0, wiz: 0, um: 0, inc: 0 },
      abilities: {
        str: { total: 10, pointBuy: 0, asi: 0, items: 0, buffs: 0 },
        dex: { total: 10, pointBuy: 0, asi: 0, items: 0, buffs: 0 },
        con: { total: 10, pointBuy: 0, asi: 0, items: 0, buffs: 0 },
        int: { total: 10, pointBuy: 0, asi: 0, items: 0, buffs: 0 },
        wis: { total: 10, pointBuy: 0, asi: 0, items: 0, buffs: 0 },
        cha: { total: 10, pointBuy: 0, asi: 0, items: 0, buffs: 0 }
      },
      ac: {},
      saves: {},
      attacks: {},
      buffs: {}
    };

    // Heuristic parse: look for rows like "Str", "Dex", etc.
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      if (!row || row.length < 2) continue;
      const key = String(row[0] || "").trim().toLowerCase();
      if (key === "str" || key === "strength") {
        g.abilities.str.total = Number(row[1]) || g.abilities.str.total;
      } else if (key === "dex" || key === "dexterity") {
        g.abilities.dex.total = Number(row[1]) || g.abilities.dex.total;
      } else if (key === "con" || key === "constitution") {
        g.abilities.con.total = Number(row[1]) || g.abilities.con.total;
      } else if (key === "int" || key === "intelligence") {
        g.abilities.int.total = Number(row[1]) || g.abilities.int.total;
      } else if (key === "wis" || key === "wisdom") {
        g.abilities.wis.total = Number(row[1]) || g.abilities.wis.total;
      } else if (key === "cha" || key === "charisma") {
        g.abilities.cha.total = Number(row[1]) || g.abilities.cha.total;
      } else if (key.includes("sorcerer") && key.includes("level")) {
        g.classes.sorc = Number(row[1]) || g.classes.sorc;
      } else if ((key.includes("wizard") || key.includes("evoker")) && key.includes("level")) {
        g.classes.wiz = Number(row[1]) || g.classes.wiz;
      } else if (key.includes("ultimate magus") || key.includes("um level") || key.includes("um")) {
        g.classes.um = Number(row[1]) || g.classes.um;
      }
    }

    // store
    state.data.general = g;
    return true;
  } catch (e) {
    console.error("ingestGeneralFromGrid error:", e);
    return false;
  }
}

/* ------------------------------ Rendering ------------------------------ */
/* The rendering functions build the page content. They are restored to
   include the original behavior and are intentionally conservative. */

function renderGeneral() {
  const container = el.app;
  if (!container) return;
  container.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'panel';

  const title = document.createElement('h2');
  title.textContent = 'General';
  panel.appendChild(title);

  if (state.data.general) {
    const g = state.data.general;
    const p = document.createElement('div');
    p.innerHTML = `
      <div><strong>Classes</strong>: Sorcerer ${g.classes.sorc}, Wizard ${g.classes.wiz}, UM ${g.classes.um}</div>
      <div><strong>Abilities</strong>:
        Str ${g.abilities.str.total} (mod ${abilityMod(g.abilities.str.total)}),
        Dex ${g.abilities.dex.total} (mod ${abilityMod(g.abilities.dex.total)}),
        Con ${g.abilities.con.total} (mod ${abilityMod(g.abilities.con.total)}),
        Int ${g.abilities.int.total} (mod ${abilityMod(g.abilities.int.total)}),
        Wis ${g.abilities.wis.total} (mod ${abilityMod(g.abilities.wis.total)}),
        Cha ${g.abilities.cha.total} (mod ${abilityMod(g.abilities.cha.total)})
      </div>
    `;
    panel.appendChild(p);
  } else {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'No general data loaded.';
    panel.appendChild(hint);
  }

  container.appendChild(panel);
}

function renderSpellTable(tableData, titleText) {
  const panel = document.createElement('div');
  panel.className = 'panel';

  const title = document.createElement('h3');
  title.textContent = titleText;
  panel.appendChild(title);

  const table = document.createElement('table');
  table.className = 'table';
  const thead = document.createElement('thead');
  const thr = document.createElement('tr');
  thr.innerHTML = '<th>Level</th>' + Array.from({length:10}, (_,i) => `<th>${i}</th>`).join('');
  thead.appendChild(thr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const levels = Object.keys(tableData).map(k => Number(k)).sort((a,b)=>a-b);
  for (const lvl of levels) {
    const row = document.createElement('tr');
    const arr = tableData[lvl] || [];
    const cells = [`<td>${lvl}</td>`].concat(arr.map(n => `<td>${n}</td>`));
    row.innerHTML = cells.join('');
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  panel.appendChild(table);
  return panel;
}

function renderSpells() {
  // Original renderSpells behavior restored here.
  const container = el.app;
  if (!container) return;
  container.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = 'Spells';
  header.appendChild(h);
  container.appendChild(header);

  // If we have slot tables from the sheet, render them
  const slots = state.data.slots || {};
  if (slots.sorcerer && Object.keys(slots.sorcerer).length) {
    const sorPanel = renderSpellTable(slots.sorcerer, 'Sorcerer slots (raw)');
    container.appendChild(sorPanel);
  } else {
    const p = document.createElement('div');
    p.className = 'panel hint';
    p.textContent = 'No Sorcerer slot table loaded.';
    container.appendChild(p);
  }

  if (slots.wizard && Object.keys(slots.wizard).length) {
    const wizPanel = renderSpellTable(slots.wizard, 'Wizard/Evoker slots (raw)');
    container.appendChild(wizPanel);
  } else {
    const p = document.createElement('div');
    p.className = 'panel hint';
    p.textContent = 'No Wizard slot table loaded.';
    container.appendChild(p);
  }

  // Known spells / preparations area (basic)
  const prepPanel = document.createElement('div');
  prepPanel.className = 'panel';
  const prepTitle = document.createElement('h3');
  prepTitle.textContent = 'Prepared / Known';
  prepPanel.appendChild(prepTitle);

  // If we have general data, show current effective levels and ability scores
  const g = state.data.general || {};
  const curSorc = state.data.currentSorcererLevel || (g.classes ? g.classes.sorc : null) || 0;
  const curWiz = state.data.currentWizardLevel || (g.classes ? g.classes.wiz : null) || 0;
  const cha = (g.abilities && g.abilities.cha && g.abilities.cha.total) ? g.abilities.cha.total : (state.cha || 0);
  const intl = (g.abilities && g.abilities.int && g.abilities.int.total) ? g.abilities.int.total : (state.int || 0);

  const info = document.createElement('div');
  info.innerHTML = `<div>Effective Sorcerer level: <strong>${curSorc}</strong> (Cha ${cha})</div>
                    <div>Effective Wizard level: <strong>${curWiz}</strong> (Int ${intl})</div>`;
  prepPanel.appendChild(info);

  container.appendChild(prepPanel);
}

/* ---------------------- Hook Google Sheets button ---------------------- */
window.addEventListener("DOMContentLoaded", () => {
  if (el.loadGs && el.gsUrl) {
    el.loadGs.addEventListener("click", async () => {
      try {
        const url = el.gsUrl.value.trim();
        if (!url) { setProgress(0, "Paste a Google Sheets URL first."); return; }
        await loadFromGoogleSheets(url);
      } catch (e) {
        console.error(e);
        setProgress(0, "Google Sheets load failed (see console).");
      }
    });
  } else {
    console.warn("Google Sheets UI not present (#gsUrl / #loadGs).");
  }

  // Line width controls wiring
  (function wireLineWidthControls() {
    let range = document.getElementById('lineWidthRange');
    let num = document.getElementById('lineWidthNumber');
    const topbar = document.querySelector('.topbar') || document.body;
    if (!range || !num) {
      const wrapper = document.createElement('div');
      wrapper.className = 'line-width';
      wrapper.innerHTML = `
        <label for="lineWidthRange">Line</label>
        <input id="lineWidthRange" type="range" min="0.5" max="24" step="0.5" value="${state.lineWidth}" />
        <input id="lineWidthNumber" type="number" min="0.5" max="24" step="0.5" value="${state.lineWidth}" />
      `;
      topbar.appendChild(wrapper);
      range = document.getElementById('lineWidthRange');
      num = document.getElementById('lineWidthNumber');
    }

    try {
      const saved = Number(localStorage.getItem('ink.lineWidth'));
      if (saved && !Number.isNaN(saved)) {
        state.lineWidth = saved;
        if (range) range.value = saved;
        if (num) num.value = saved;
      }
    } catch (e) {}

    function applyWidth(v) {
      const val = Math.max(0.5, Math.min(24, Number(v) || 2));
      state.lineWidth = val;
      if (range) range.value = val;
      if (num) num.value = val;
      try { localStorage.setItem('ink.lineWidth', String(val)); } catch (e) {}
    }

    if (range) {
      range.addEventListener('input', (e) => applyWidth(e.target.value));
      range.addEventListener('change', (e) => applyWidth(e.target.value));
    }
    if (num) {
      num.addEventListener('input', (e) => applyWidth(e.target.value));
      num.addEventListener('change', (e) => applyWidth(e.target.value));
    }
  })();
});

// Initial setup
applyWorldTransform();
ink.loadForView(state.view);
render();

/* ------------------ Non‑invasive slot UI wrapper (append only) ------------------ */
/*
  This wrapper preserves the existing renderSpells() behavior and then
  appends the SlotCalculator UI. It does not replace or remove the original
  renderSpells content; it only appends the slot UI after the original render.
  To revert, remove this entire IIFE block.
*/

(function(){
  // If renderSpells exists, capture it; otherwise create a no-op base.
  const originalRenderSpells = (typeof renderSpells === 'function') ? renderSpells : function(){};

  // Helper: append the slot UI (uses SlotCalculator if available)
  function appendSlotUI() {
    if (typeof SlotCalculator === 'undefined') {
      // SlotCalculator not loaded; do nothing (original UI remains intact)
      return;
    }

    // Compute slots from current state (use specialist prepared bonus by default)
    const calc = SlotCalculator.computeAllSlots(state, { applySpecialistPreparedBonus: true });

    // Build container
    const container = document.createElement('div');
    container.className = 'panel spells-panel slots-extension';
    container.id = 'spellsSlotsExtension';

    const title = document.createElement('h3');
    title.textContent = 'Spell Slots & Prepared Counts';
    title.style.marginTop = '0';
    container.appendChild(title);

    // localStorage helpers
    const storageKey = (view) => `ink_slots_used:${view || state.view || 'General'}`;
    function loadUsed(view) {
      try { const raw = localStorage.getItem(storageKey(view)); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
    }
    function saveUsed(view, obj) { try { localStorage.setItem(storageKey(view), JSON.stringify(obj)); } catch {} }

    // small helper to render a row
    function renderSlotRow(labelText, arrBase, arrFinal, viewKey) {
      const row = document.createElement('div');
      row.className = 'slot-row';

      const label = document.createElement('div');
      label.className = 'slot-label';
      label.textContent = labelText;
      row.appendChild(label);

      const usedState = loadUsed(state.view);

      for (let lvl = 0; lvl <= 9; lvl++) {
        const boxWrap = document.createElement('div');
        boxWrap.style.display = 'flex';
        boxWrap.style.alignItems = 'center';
        boxWrap.style.gap = '6px';

        const levelTag = document.createElement('div');
        levelTag.className = 'spell-level';
        levelTag.textContent = lvl;
        boxWrap.appendChild(levelTag);

        const count = arrFinal[lvl] || 0;
        const base = arrBase[lvl] || 0;

        const box = document.createElement('div');
        box.className = 'slot-box';
        if (count === 0) box.classList.add('zero');
        box.textContent = String(count);
        box.dataset.spellLevel = String(lvl);
        box.dataset.classKey = viewKey;

        const usedKey = `${viewKey}:${lvl}`;
        if (usedState[usedKey]) box.classList.add('used');

        box.addEventListener('click', (e) => {
          if (count === 0) return;
          const cur = loadUsed(state.view);
          const k = usedKey;
          if (cur[k]) { delete cur[k]; box.classList.remove('used'); }
          else { cur[k] = true; box.classList.add('used'); }
          saveUsed(state.view, cur);
        });

        boxWrap.appendChild(box);

        if (base !== count) {
          const hint = document.createElement('div');
          hint.className = 'hint';
          hint.textContent = `(${base}+${count-base})`;
          boxWrap.appendChild(hint);
        }

        row.appendChild(boxWrap);
      }

      return row;
    }

    // Sorcerer row
    const sorBase = calc.sorcerer.base;
    const sorFinal = calc.sorcerer.final;
    const sorRow = renderSlotRow('Sorcerer slots (per day)', sorBase, sorFinal, 'sorcerer');
    container.appendChild(sorRow);

    // Wizard row
    const wizBase = calc.wizard.base;
    const wizFinal = calc.wizard.final;
    const wizRow = renderSlotRow('Wizard slots (per day)', wizBase, wizFinal, 'wizard');
    container.appendChild(wizRow);

    // Wizard prepared (specialist)
    const prepRow = document.createElement('div');
    prepRow.className = 'slot-row';
    const prepLabel = document.createElement('div');
    prepLabel.className = 'slot-label';
    prepLabel.textContent = 'Wizard prepared (Evoker specialty)';
    prepRow.appendChild(prepLabel);

    const prepared = calc.wizardPrepared || wizFinal;
    for (let lvl = 0; lvl <= 9; lvl++) {
      const pWrap = document.createElement('div');
      pWrap.style.display = 'flex';
      pWrap.style.alignItems = 'center';
      pWrap.style.gap = '6px';

      const levelTag = document.createElement('div');
      levelTag.className = 'spell-level';
      levelTag.textContent = lvl;
      pWrap.appendChild(levelTag);

      const pBox = document.createElement('div');
      pBox.className = 'slot-box';
      pBox.textContent = String(prepared[lvl] || 0);
      if ((prepared[lvl] || 0) === 0) pBox.classList.add('zero');

      pWrap.appendChild(pBox);
      prepRow.appendChild(pWrap);
    }
    container.appendChild(prepRow);

    const note = document.createElement('div');
    note.className = 'prep-note';
    note.textContent = 'Tap a slot to mark used, or cross out with the pen. Used marks persist per view.';
    container.appendChild(note);

    // Insert the container into the spells area without removing existing content.
    // Prefer a dedicated spells container if present; otherwise append to el.app.
    const target = document.getElementById('spellsContainer') || el.app;
    if (!target) return;
    // Remove any previous extension to avoid duplicates
    const prev = document.getElementById('spellsSlotsExtension');
    if (prev) prev.remove();
    target.appendChild(container);
  }

  // Redefine renderSpells to call original then append the slot UI
  window.renderSpells = function() {
    try {
      // call original behavior first
      originalRenderSpells();
    } catch (err) {
      console.error('Error in original renderSpells():', err);
    }
    try {
      // then append the slot UI
      appendSlotUI();
    } catch (err) {
      console.error('Error appending slot UI:', err);
    }
  };
})();
