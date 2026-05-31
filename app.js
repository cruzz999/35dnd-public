/* ==========================================================================
DnD 3.5 Ink Sheet (Paper Mode) - app.js
- Pan/zoom paper inside #viewport/#world (no page scroll)
- Stylus-safe ink layer on #inkWorld (world coordinates)
- Load data from: A) XLSX upload (SheetJS) B) Google Sheets via NAS proxy endpoint: /gs/csv?id=...&gid=...
- Implemented views: General, Spells, Slots
========================================================================== */

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
  loaded: false, // becomes true after XLSX or Google load
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
  data: { general: null, spells: { sorc: [], wiz: [], meta: null } },
  lineWidth: 0.5, // default drawing width
  eraserWidth: 18 // default eraser width (keeps previous behavior)
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
  const h = topbar ? topbar.getBoundingClientRect().height : 64;
  if (el.viewport) el.viewport.style.height = `calc(100vh - ${h}px)`;
}

window.addEventListener("resize", () => {
  syncViewportHeight();
  applyWorldTransform();
  try { ink.redraw(); } catch {}
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
  try { ink.redraw(); } catch {}
}

function resetView() {
  state.zoom = 1.0;
  state.pan.x = 20;
  state.pan.y = 20;
  applyWorldTransform();
  try { ink.redraw(); } catch {}
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
  try { ink.redraw(); } catch {}
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
    let sorcererHeaderRow = -1;
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r].map(c => String(c || "").toLowerCase());
      if (row.some(c => c.includes("sorcerer") && c.includes("slot"))) { sorcererHeaderRow = r; break; }
      if (row.some(c => c === "sorcerer")) { sorcererHeaderRow = r; break; }
    }

    let wizardHeaderRow = -1;
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r].map(c => String(c || "").toLowerCase());
      if (row.some(c => c.includes("evoker") && c.includes("slot"))) { wizardHeaderRow = r; break; }
      if (row.some(c => c === "evoker") || row.some(c => c === "wizard")) { wizardHeaderRow = r; break; }
    }

    function parseTableFromHeaderRow(r) {
      if (r < 0 || r >= grid.length) return null;
      const header = grid[r];
      let levelCol = -1;
      for (let c = 0; c < header.length; c++) {
        const h = String(header[c] || "").trim().toLowerCase();
        if (h === "level" || h === "lvl" || h === "lv") { levelCol = c; break; }
      }
      if (levelCol === -1) {
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

      const spellCols = [];
      for (let c = levelCol + 1; c < Math.min(levelCol + 12, header.length); c++) {
        const h = String(header[c] || "").trim();
        if (h === "" && grid[r+1] && /^\d+$/.test(String(grid[r+1][c] || "").trim())) {
          spellCols.push(c);
        } else if (/^[0-9]$/.test(h)) {
          spellCols.push(c);
        } else {
          if (spellCols.length > 0) break;
        }
      }

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

    state.data.slots.sorcerer = sorTable;
    state.data.slots.wizard = wizTable;

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

    return true;
  } catch (e) {
    console.error("ingestSpellsFromGrid error:", e);
    return false;
  }
}

/*
  ingestGeneralFromGrid(grid)
  - parses the general tab CSV into state.data.general
*/
function ingestGeneralFromGrid(grid) {
  try {
    const cell = (r, c) => (grid[r] && grid[r][c] != null) ? String(grid[r][c]) : "";
    const num = (v, fb = 0) => {
      const s = String(v ?? "").trim();
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
        if (nset.has("ability") && (nset.has("score") || nset.has("pointbuyarray") || nset.has("asi") || nset.has("items") || nset.has("penaltiesbuffs"))) {
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
      if ((grid[r] || []).some(v => String(v).trim() === "Feats & Special Abilities")) { featsRow = r; break; }
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
    return true;
  } catch (e) {
    console.error("ingestGeneralFromGrid error:", e);
    return false;
  }
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
    ac: { armor: Number(v("D21",0))||0, shield: Number(v("E21",0))||0, size: Number(v("G21",0))||0, natural: Number(v("H21",0))||0, deflect: Number(v("J21",0))||0, misc: Number(v("L21",0))||0, miscTouch: 0 },
    saves: { fortMisc: 0, refMisc: 0, willMisc: 0 },
    attacks: { meleeMisc: 0, rangedMisc: 0, grappleMisc: 0 },
    initMisc: 0,
    buffs: { mageArmor: 0, shieldSpell: 0 },
    feats: [],
    languages: []
  };
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
  const wizHeader = findRowWithText("Spell slots (W)");

  function readBlock(headerRow, mode) {
    if (headerRow < 0) return [];
    const header = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = cellAt(headerRow,c);
      const val = cell && cell.v !== undefined ? String(cell.v).trim() : "";
      if (val) header[val] = c;
    }
    const col = { prep: header["Preparations"], spell: header["Sorcerer"] ?? header["Wizard"], sl: header["SL"], type: header["Type"], evo: header["Evo?"], fire: header["Fire?"], range: header["Range"], area: header["Area"], damage: header["Damage"], duration: header["Duration"], notes: header["Notes"] };

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
      const get = (c) => { if (c === undefined) return ""; const cell = cellAt(r,c); if (!cell) return ""; return (cell.w !== undefined ? cell.w : (cell.v ?? "")); };
      const num = (c) => Number(get(c)) || 0;
      rows.push({
        mode,
        name,
        url: "",
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
  state.data.spells.wiz = readBlock(wizHeader, "wiz");
  state.data.spells.meta = { sorcLevels: 1, wizLevels: 5, umLevels: 2, arcaneSpellpower: 1 };
}

/* ------------------------------ Rendering ------------------------------ */
function computeSpellDC(sl, castingMod) { return 10 + (Number(sl)||0) + (Number(castingMod)||0); }

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

  const abilityRow = (label, key) => `
    <div><strong>${label}</strong></div>
    <div class="val">${g.abilities[key].pointBuy ?? 0}</div>
    <div class="val"><input type="number" inputmode="numeric" data-ab="${key}" data-field="asi" value="${Number(g.abilities[key].asi ?? 0)}"></div>
    <div class="val"><input type="number" inputmode="numeric" data-ab="${key}" data-field="items" value="${Number(g.abilities[key].items ?? 0)}"></div>
    <div class="val"><input type="number" inputmode="numeric" data-ab="${key}" data-field="buffs" value="${Number(g.abilities[key].buffs ?? 0)}"></div>
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
      <div class="hint">Point buy array / ASI / Items / Penalties-buffs → Total → Mod</div>
      <div class="ability-breakdown-grid">
        <div></div><div class="hdr">Point buy</div><div class="hdr">ASI</div><div class="hdr">Items</div><div class="hdr">Buffs</div><div class="hdr">Total</div><div class="hdr">Mod</div>
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
        <div class="hint">CSV export doesn’t preserve hyperlinks; feats are text-only in Google mode.</div>
      </div>

      <div class="panel">
        <h3>Languages</h3>
        <ul>${g.languages.length ? g.languages.map(x => `<li>${escapeHtml(x)}</li>`).join("") : "<li>(none found)</li>"}</ul>
      </div>
    </div>
  </div>
  `;

  const mage = $("buff_mage");
  const shield = $("buff_shield");
  if (mage) mage.onchange = () => { g.buffs.mageArmor = mage.checked ? 4 : 0; renderGeneral(); try { ink.redraw(); } catch {} };
  if (shield) shield.onchange = () => { g.buffs.shieldSpell = shield.checked ? 4 : 0; renderGeneral(); try { ink.redraw(); } catch {} };

  document.querySelectorAll('.ability-breakdown-grid input[data-ab][data-field]').forEach(inp => {
    inp.addEventListener('input', () => {
      const ab = inp.getAttribute('data-ab');
      const field = inp.getAttribute('data-field');
      const val = Number(inp.value);
      g.abilities[ab][field] = Number.isFinite(val) ? val : 0;
      renderGeneral();
      try { ink.redraw(); } catch {}
    });
  });
}

function renderSpellTable(rows, meta, castingMod, showPrep) {
  if (!rows || !rows.length) return `<div class="hint">No spells loaded.</div>`;
  return `
    <table class="table">
      <thead>
        <tr>
          <th>Spell</th><th>SL</th><th>CL</th><th>DC</th>${showPrep ? "<th>Prep</th>" : ""}<th>Type</th><th>F</th><th>E</th><th>Range</th><th>Area</th><th>Damage</th><th>Duration</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(s => {
          const cl = computeSpellCL(s, meta);
          const dc = computeSpellDC(s.sl, castingMod);
          const spellCell = s.url ? `<a href="${String(s.url).replace(/"/g,'&quot;')}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)}</a>` : escapeHtml(s.name);
          const anchorId = `${s.mode}:${s.name}:prep`.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9:_-]/g,'');
          const prepCell = showPrep ? `<td><span class="prep-box" data-ink-anchor="${anchorId}"></span></td>` : "";
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

/* ---------------------- Slots UI integration (new) ---------------------- */
/*
  This section implements a non-invasive Slots UI that:
  - uses SlotCalculator (slotCalculator.js must be included before app.js)
  - renders into the Slots tab (renderSlots)
  - Sorcerer slots: 10 rows (0..9), each row shows one box per available slot (clickable to mark used)
  - Wizard prepared: shows prepared counts (specialist +1 applied)
  - Persists used marks per view in localStorage
*/

function renderSlots() {
  // Preserve existing content if any: build on top of it
  const container = el.app;
  if (!container) return;
  container.innerHTML = '';

  // Title
  const header = document.createElement('div');
  header.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = 'Slots';
  header.appendChild(h);
  container.appendChild(header);

  // Ensure SlotCalculator exists
  if (typeof SlotCalculator === 'undefined') {
    const p = document.createElement('div');
    p.className = 'panel hint';
    p.textContent = 'SlotCalculator not loaded. Include slotCalculator.js before app.js.';
    container.appendChild(p);
    return;
  }

  // Compute slots from state (allow overrides from sheet data if present)
  const g = state.data.general || {};
  const meta = state.data.spells.meta || {};
  // Determine effective caster levels: prefer explicit current fields, else fall back to general.classes and meta
  const effSorc = Number(state.data.currentSorcererLevel ?? meta.sorcLevels ?? (g.classes ? g.classes.sorc : 0)) || 0;
  const effWiz = Number(state.data.currentWizardLevel ?? meta.wizLevels ?? (g.classes ? g.classes.wiz : 0)) || 0;
  // Determine ability totals
  const d = g ? computeGeneralDerived(g) : null;
  const chaTotal = d ? d.abilities.cha.total : (state.cha || 0);
  const intTotal = d ? d.abilities.int.total : (state.int || 0);

  const calc = SlotCalculator.computeAllSlots(state, { overrides: { sorcererLevel: effSorc, wizardLevel: effWiz, sorCha: chaTotal, wizInt: intTotal }, applySpecialistPreparedBonus: true });

  // localStorage helpers
  const storageKey = (view) => `ink_slots_used:${view || state.view || 'General'}`;
  function loadUsed(view) {
    try { const raw = localStorage.getItem(storageKey(view)); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  }
  function saveUsed(view, obj) { try { localStorage.setItem(storageKey(view), JSON.stringify(obj)); } catch {} }

  // Styles for the slots UI (scoped, minimal)
  const styleId = 'slots-ui-inline-styles';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      .slots-panel { display:block; gap:12px; }
      .slots-grid { display:flex; gap:18px; flex-wrap:wrap; align-items:flex-start; }
      .slots-column { display:flex; flex-direction:column; gap:8px; min-width:220px; }
      .slots-column h3 { margin:0 0 6px 0; }
      .sorcerer-table { border-collapse:collapse; width:100%; }
      .sorcerer-table td { padding:4px; vertical-align:middle; }
      .slot-box-inline { display:inline-block; width:18px; height:18px; margin:2px; border-radius:4px; border:1px solid #dfe6ef; background:#fff; box-shadow:0 1px 0 rgba(0,0,0,0.03); cursor:pointer; }
      .slot-box-inline.used { background:linear-gradient(180deg,#f3f4f6,#fff); opacity:0.6; text-decoration:line-through; }
      .slot-box-inline.zero { opacity:0.35; cursor:default; border-style:dashed; }
      .slot-row-label { width:28px; text-align:center; color:#6b7280; font-size:12px; }
      .wizard-prep-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .wizard-prep-box { width:34px; height:28px; border-radius:6px; border:1px solid #e6e9ef; background:#fff; display:inline-flex; align-items:center; justify-content:center; font-weight:600; }
      .hint.small { font-size:12px; color:#6b7280; margin-top:8px; }
    `;
    document.head.appendChild(s);
  }

  const panel = document.createElement('div');
  panel.className = 'panel slots-panel';

  // Sorcerer column: 10 rows (0..9), each row shows one box per available slot
  const sorCol = document.createElement('div');
  sorCol.className = 'slots-column';
  const sorTitle = document.createElement('h3');
  sorTitle.textContent = `Sorcerer slots (effective level ${calc.meta.sorcererLevel})`;
  sorCol.appendChild(sorTitle);

  const sorTable = document.createElement('table');
  sorTable.className = 'sorcerer-table';
  const usedState = loadUsed(state.view);

  for (let lvl = 0; lvl <= 9; lvl++) {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.className = 'slot-row-label';
    tdLabel.textContent = String(lvl);
    tr.appendChild(tdLabel);

    const tdBoxes = document.createElement('td');
    const count = (calc.sorcerer.final && calc.sorcerer.final[lvl]) ? calc.sorcerer.final[lvl] : 0;
    // create 'count' boxes
    if (count <= 0) {
      const empty = document.createElement('div');
      empty.className = 'slot-box-inline zero';
      empty.title = 'No slots';
      tdBoxes.appendChild(empty);
    } else {
      for (let i = 0; i < count; i++) {
        const box = document.createElement('div');
        box.className = 'slot-box-inline';
        const key = `sorcerer:${lvl}:${i}`; // unique per slot
        if (usedState[key]) box.classList.add('used');
        box.dataset.key = key;
        box.dataset.classKey = 'sorcerer';
        box.dataset.level = String(lvl);
        box.addEventListener('click', () => {
          const cur = loadUsed(state.view);
          if (cur[key]) { delete cur[key]; box.classList.remove('used'); }
          else { cur[key] = true; box.classList.add('used'); }
          saveUsed(state.view, cur);
        });
        tdBoxes.appendChild(box);
      }
    }
    tr.appendChild(tdBoxes);
    sorTable.appendChild(tr);
  }
  sorCol.appendChild(sorTable);
  panel.appendChild(sorCol);

  // Wizard column: show per-day slots and prepared counts (specialist applied)
  const wizCol = document.createElement('div');
  wizCol.className = 'slots-column';
  const wizTitle = document.createElement('h3');
  wizTitle.textContent = `Wizard slots (effective level ${calc.meta.wizardLevel})`;
  wizCol.appendChild(wizTitle);

  // Wizard per-day slots (0..9) as small boxes with count displayed
  const wizSlotsWrap = document.createElement('div');
  wizSlotsWrap.className = 'wizard-slots-wrap';
  for (let lvl = 0; lvl <= 9; lvl++) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    const lvlTag = document.createElement('div');
    lvlTag.className = 'slot-row-label';
    lvlTag.textContent = String(lvl);
    row.appendChild(lvlTag);

    const count = (calc.wizard.final && calc.wizard.final[lvl]) ? calc.wizard.final[lvl] : 0;
    const box = document.createElement('div');
    box.className = 'wizard-prep-box';
    box.textContent = String(count);
    if (count === 0) box.style.opacity = '0.45';
    row.appendChild(box);

    // small hint for base+bonus if different
    const base = (calc.wizard.base && calc.wizard.base[lvl]) ? calc.wizard.base[lvl] : 0;
    if (base !== count) {
      const hint = document.createElement('div');
      hint.className = 'hint small';
      hint.textContent = `(${base}+${count-base})`;
      row.appendChild(hint);
    }

    wizSlotsWrap.appendChild(row);
  }
  wizCol.appendChild(wizSlotsWrap);

  // Wizard prepared counts (specialist applied)
  const prepTitle = document.createElement('h3');
  prepTitle.textContent = 'Wizard prepared (Evoker specialty applied)';
  wizCol.appendChild(prepTitle);

  const prepWrap = document.createElement('div');
  prepWrap.className = 'wizard-prep-row';
  for (let lvl = 0; lvl <= 9; lvl++) {
    const pBox = document.createElement('div');
    pBox.className = 'wizard-prep-box';
    pBox.textContent = String((calc.wizardPrepared && calc.wizardPrepared[lvl]) ? calc.wizardPrepared[lvl] : (calc.wizard.final ? calc.wizard.final[lvl] : 0));
    if ((calc.wizardPrepared && calc.wizardPrepared[lvl]) === 0) pBox.style.opacity = '0.45';
    prepWrap.appendChild(pBox);
  }
  wizCol.appendChild(prepWrap);

  panel.appendChild(wizCol);

  // Append panel to container
  container.appendChild(panel);

  // Small note
  const note = document.createElement('div');
  note.className = 'hint small';
  note.textContent = 'Click sorcerer boxes to mark used; marks persist per view. You can also cross out with the pen.';
  container.appendChild(note);
}

/* ------------------------------ Rendering ------------------------------ */
function renderSpells() {
  const g = state.data.general;
  const meta = state.data.spells.meta || { sorcLevels:1, wizLevels:5, umLevels:2, arcaneSpellpower:1 };
  const d = g ? computeGeneralDerived(g) : null;
  const intMod = d ? d.abilities.int.mod : 0;
  const chaMod = d ? d.abilities.cha.mod : 0;
  const sorcRows = state.data.spells.sorc || [];
  const wizRows = state.data.spells.wiz || [];

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
        <div class="hint"> Load via Google Sheets (recommended on Boox) or upload XLSX. </div>
      </div>
    `;
    applyWorldTransform();
    try { ink.redraw(); } catch {}
    return;
  }
  if (state.view === "General") renderGeneral();
  else if (state.view === "Spells") renderSpells();
  else if (state.view === "Slots") renderSlots();
  else el.app.innerHTML = `<div class="panel"><h2>${escapeHtml(state.view)}</h2><div class="hint">Not implemented yet.</div></div>`;
  applyWorldTransform();
  try { ink.redraw(); } catch {}
}

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
