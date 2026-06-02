/* ==========================================================================
   DnD 3.5 Ink Sheet (Paper Mode) - app.js
   - Pan/zoom paper inside #viewport/#world (no page scroll)
   - Stylus-safe ink layer on #inkWorld (world coordinates)
   - Load data from:
        A) XLSX upload (SheetJS)
        B) Google Sheets via NAS proxy endpoint: /gs/csv?id=...&gid=...
   - Implemented views: General, Spells, Skills
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
   
 exportData: $("exportData"),
  importData: $("importData"),
  importFile: $("importFile"),

};

const BUILD_PLAN = [
  "sorc",
  "wiz", "wiz", "wiz", "wiz", "wiz",
  "um", "um", "um", "um", "um",
  "inc", "inc",
  "um", "um", "um", "um", "um",
  "inc", "inc"
];

function assertEl(name) {
  if (!el[name]) console.warn(`Missing element #${name}`);
}
["viewport", "world", "app", "ink", "status", "progressBar"].forEach(assertEl);

if (typeof GeneralDerived === "undefined") {
  console.warn("GeneralDerived not loaded. Did you include generalDerived.js before app.js?");
}
if (typeof SheetLoader === "undefined") {
  console.warn("SheetLoader not loaded. Did you include sheetLoader.js before app.js?");
}
if (typeof ArcaneMath === "undefined") {
  console.warn("ArcaneMath not loaded. Did you include arcaneMath.js before app.js?");
}
if (typeof SheetParsers === "undefined") {
  console.warn("SheetParsers not loaded. Did you include sheetParsers.js before app.js?");
}
if (typeof AppStorage === "undefined") {
  console.warn("AppStorage not loaded. Did you include storage.js before app.js?");
}
if (typeof SpellsViewHelpers === "undefined") {
  console.warn("SpellsViewHelpers not loaded. Did you include spellsViewHelpers.js before app.js?");
}
if (typeof SkillsMath === "undefined") {
  console.warn("SkillsMath not loaded. Did you include skillsMath.js before app.js?");
}

if (typeof TouchGestures === "undefined") {
  console.warn("TouchGestures not loaded. Did you include touchGestures.js before app.js?");
}
if (typeof SpellScaling === "undefined") {
 console.warn("Scaling not loaded. Did you include spellScaling.js before app.js?");
}


/* ---------------------------- Edit defaults ----------------------------- */
function defaultGeneralEdits() {
  return {
    abilities: {
      str: { asi: 0, items: 0, buffs: 0 },
      dex: { asi: 0, items: 0, buffs: 0 },
      con: { asi: 0, items: 0, buffs: 0 },
      int: { asi: 0, items: 0, buffs: 0 },
      wis: { asi: 0, items: 0, buffs: 0 },
      cha: { asi: 0, items: 0, buffs: 0 }
    },
    buffs: {
      mageArmor: 0,
      shieldSpell: 0
    },
    classes: {
      sorc: 0,
      wiz: 0,
      um: 0,
      inc: 0
    }
  };
}

function defaultSkillsEdits() {
  return {
    bySkillName: {},
    inventoryText: ""
  };
}

/* ------------------------------ App state ------------------------------ */
const state = {
  loaded: false,
  view: "General",

  // Paper transform
  pan: { x: 20, y: 20 },
  zoom: 1.0,

  // Pen state
  penOn: false,
  erasing: false,

  // Ink storage per view
  strokesByView: {},

  // Data loaded from sheet
  data: {
    general: null,
    spells: { sorc: [], wiz: [], meta: null },
    skills: { rows: [], inventoryLines: [] },
  },

  // Persisted editable overlays
  generalEdits: defaultGeneralEdits(),
  skillsEdits: defaultSkillsEdits(),

  lineWidth: 0.5,
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
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

function fmtSign(n) {
  n = Number(n) || 0;
  return (n >= 0 ? "+" : "") + n;
}
function parseClassesFromText(classLine) {
  const text = String(classLine || "");

  const out = { sorc: 0, wiz: 0, um: 0, inc: 0 };

  const patterns = [
    { re: /sorcerer\s+(\d+)/i, key: "sorc" },
    { re: /wizard\s+(\d+)/i, key: "wiz" },
    { re: /ultimate\s+magus\s+(\d+)/i, key: "um" },
    { re: /incantatrix\s+(\d+)/i, key: "inc" }
  ];

  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) out[p.key] = Number(m[1]) || 0;
  }

  return out;
}

function pickLevel(...values) {
  // Prefer any positive numeric value
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }

  // If there are no positive values, allow explicit zero
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n === 0) return 0;
  }

  return 0;
}
function formatClassLineFromClasses(classes) {
  const c = classes || {};
  const parts = [];

  if ((Number(c.sorc) || 0) > 0) parts.push(`Sorcerer ${Number(c.sorc) || 0}`);
  if ((Number(c.wiz) || 0) > 0) parts.push(`Wizard ${Number(c.wiz) || 0}`);
  if ((Number(c.um) || 0) > 0) parts.push(`Ultimate Magus ${Number(c.um) || 0}`);
  if ((Number(c.inc) || 0) > 0) parts.push(`Incantatrix ${Number(c.inc) || 0}`);

  return parts.join(" ");
}

/* -------------------- Editable state persistence ----------------------- */
const STORAGE_KEYS = {
  generalEdits: "general.edits.v1",
  skillsEdits: "skills.edits.v1"
};

function normalizeGeneralEdits(raw) {
  const base = defaultGeneralEdits();
  if (!raw || typeof raw !== "object") return base;

  const abilities = raw.abilities && typeof raw.abilities === "object"
    ? raw.abilities
    : {};


const buffs = raw.buffs && typeof raw.buffs === "object"
  ? raw.buffs
  : {};

const classes = raw.classes && typeof raw.classes === "object"
  ? raw.classes
  : {};


  for (const key of ["str", "dex", "con", "int", "wis", "cha"]) {
    const src = abilities[key] || {};
    base.abilities[key] = {
      asi: Number.isFinite(Number(src.asi)) ? Number(src.asi) : 0,
      items: Number.isFinite(Number(src.items)) ? Number(src.items) : 0,
      buffs: Number.isFinite(Number(src.buffs)) ? Number(src.buffs) : 0
    };
  }

  base.buffs = {
    mageArmor: Number.isFinite(Number(buffs.mageArmor)) ? Number(buffs.mageArmor) : 0,
    shieldSpell: Number.isFinite(Number(buffs.shieldSpell)) ? Number(buffs.shieldSpell) : 0
  };

base.classes = {
  sorc: Number.isFinite(Number(classes.sorc)) ? Number(classes.sorc) : 0,
  wiz: Number.isFinite(Number(classes.wiz)) ? Number(classes.wiz) : 0,
  um: Number.isFinite(Number(classes.um)) ? Number(classes.um) : 0,
  inc: Number.isFinite(Number(classes.inc)) ? Number(classes.inc) : 0
};

  return base;
}

function normalizeSkillsEdits(raw) {
  const base = defaultSkillsEdits();
  if (!raw || typeof raw !== "object") return base;

  const bySkillName =
    raw.bySkillName && typeof raw.bySkillName === "object"
      ? raw.bySkillName
      : {};

  const inventoryText =
    typeof raw.inventoryText === "string"
      ? raw.inventoryText
      : "";

  return {
    bySkillName,
    inventoryText
  };
}

function loadEditableState() {
  if (typeof AppStorage === "undefined") {
    state.generalEdits = defaultGeneralEdits();
    state.skillsEdits = defaultSkillsEdits();
    return;
  }

  state.generalEdits = normalizeGeneralEdits(
    AppStorage.readJson(STORAGE_KEYS.generalEdits, defaultGeneralEdits())
  );

  state.skillsEdits = normalizeSkillsEdits(
    AppStorage.readJson(STORAGE_KEYS.skillsEdits, defaultSkillsEdits())
  );
}

function saveGeneralEdits() {
  if (typeof AppStorage === "undefined") return;
  AppStorage.writeJson(STORAGE_KEYS.generalEdits, state.generalEdits);
}

function saveSkillsEdits() {
  if (typeof AppStorage === "undefined") return;
  AppStorage.writeJson(STORAGE_KEYS.skillsEdits, state.skillsEdits);
}
function readInkForExport() {
  const views = ["General", "Spells", "Skills", "Slots"];
  const out = {};

  for (const viewName of views) {
    // Prefer in-memory strokes if present
    if (Array.isArray(state.strokesByView?.[viewName])) {
      out[viewName] = state.strokesByView[viewName];
      continue;
    }

    // Fallback to localStorage
    try {
      const raw = localStorage.getItem(`ink:${viewName}`);
      out[viewName] = raw ? JSON.parse(raw) : [];
    } catch {
      out[viewName] = [];
    }
  }

  return out;
}
/* --------------------------- Export / Import --------------------------- */

const EXPORT_FORMAT = {
  app: "dnd35-ink-sheet",
  version: 1
};

function readSlotMarksForExport() {
  const views = ["General", "Spells", "Skills", "Slots"];
  const out = {};

  for (const viewName of views) {
    out[viewName] = loadUsedSlotMarks(viewName);
  }

  return out;
}

function buildExportPayload() {
  return {
    app: EXPORT_FORMAT.app,
    version: EXPORT_FORMAT.version,
    exportedAt: new Date().toISOString(),

    state: {
      loaded: !!state.loaded,
      view: state.view,

      data: {
        general: state.data.general,
        spells: state.data.spells,
        skills: state.data.skills
      },

      generalEdits: state.generalEdits,
      skillsEdits: state.skillsEdits,

      strokesByView: readInkForExport(),
      lineWidth: state.lineWidth
    },

    storage: {
      slotMarks: readSlotMarksForExport()
    }
  };
}

function downloadTextFile(filename, text, mimeType = "application/json") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportAppSnapshot() {
  try {
    const payload = buildExportPayload();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `dnd35-sheet-save-${stamp}.json`;

    downloadTextFile(filename, JSON.stringify(payload, null, 2));
    setProgress(100, "Exported save file ✅");
  } catch (e) {
    console.error(e);
    setProgress(0, "Export failed: " + (e?.message || e));
  }
}

function normalizeImportedPayload(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Import file is not a valid object.");
  }

  if (raw.app !== EXPORT_FORMAT.app) {
    throw new Error("This file does not appear to be a DnD 3.5 Ink Sheet save.");
  }

  if (raw.version !== 1) {
    throw new Error(`Unsupported save version: ${raw.version}`);
  }

  const importedState = raw.state || {};
  const importedData = importedState.data || {};
  const importedStorage = raw.storage || {};

  return {
    loaded: !!importedState.loaded,
    view: typeof importedState.view === "string" ? importedState.view : "General",

    data: {
      general: importedData.general ?? null,
      spells: importedData.spells ?? { sorc: [], wiz: [], meta: null },
      skills: importedData.skills ?? { rows: [], inventoryLines: [] }
    },

    generalEdits: normalizeGeneralEdits(importedState.generalEdits),
    skillsEdits: normalizeSkillsEdits(importedState.skillsEdits),

    strokesByView:
      importedState.strokesByView && typeof importedState.strokesByView === "object"
        ? importedState.strokesByView
        : {},

    lineWidth: Number.isFinite(Number(importedState.lineWidth))
      ? Math.max(0.5, Math.min(24, Number(importedState.lineWidth)))
      : state.lineWidth,

    slotMarks:
      importedStorage.slotMarks && typeof importedStorage.slotMarks === "object"
        ? importedStorage.slotMarks
        : {}
  };
}

function applyImportedPayload(payload) {
  const imported = normalizeImportedPayload(payload);

  state.loaded = imported.loaded;
  state.view = imported.view;

  state.data.general = imported.data.general;
  state.data.spells = imported.data.spells;
  state.data.skills = imported.data.skills;

  state.generalEdits = imported.generalEdits;
  state.skillsEdits = imported.skillsEdits;

  state.strokesByView = imported.strokesByView;
   
  // Persist imported ink back into localStorage so ink.loadForView()
  // continues to work correctly.
  for (const [viewName, strokes] of Object.entries(imported.strokesByView || {})) {
    try {
      localStorage.setItem(`ink:${viewName}`, JSON.stringify(Array.isArray(strokes) ? strokes : []));
    } catch {}
  }

  state.lineWidth = imported.lineWidth;

  // Persist editable overlays immediately
  saveGeneralEdits();
  saveSkillsEdits();

  // Persist line width preference
  if (typeof AppStorage !== "undefined") {
    AppStorage.writeNumber("ink.lineWidth", state.lineWidth);
  }

  // Persist slot/Spellfire marks
  for (const [viewName, marks] of Object.entries(imported.slotMarks || {})) {
    saveUsedSlotMarks(viewName, marks || {});
  }

  // Update visible line width controls if present
  const range = document.getElementById("lineWidthRange");
  const num = document.getElementById("lineWidthNumber");
  if (range) range.value = state.lineWidth;
  if (num) num.value = state.lineWidth;

  render();
  ink.loadForView(state.view);

  setProgress(100, "Imported save file ✅");
}

async function importAppSnapshotFromFile(file) {
  if (!file) return;

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    applyImportedPayload(payload);
  } catch (e) {
    console.error(e);
    setProgress(0, "Import failed: " + (e?.message || e));
  }
}
let skillsNotesSaveTimer = null;

function scheduleSaveSkillsEdits(delayMs = 200) {
  if (skillsNotesSaveTimer) clearTimeout(skillsNotesSaveTimer);

  skillsNotesSaveTimer = setTimeout(() => {
    saveSkillsEdits();
    skillsNotesSaveTimer = null;
  }, delayMs);
}

function applyGeneralEditsToGeneral(general, edits = state.generalEdits) {
  if (!general) return general;

  general.abilities ||= {};
  for (const key of ["str", "dex", "con", "int", "wis", "cha"]) {
    general.abilities[key] ||= { pointBuy: 0, asi: 0, items: 0, buffs: 0 };

    const src = edits?.abilities?.[key];
    if (!src) continue;

    if (Number.isFinite(Number(src.asi))) general.abilities[key].asi = Number(src.asi);
    if (Number.isFinite(Number(src.items))) general.abilities[key].items = Number(src.items);
    if (Number.isFinite(Number(src.buffs))) general.abilities[key].buffs = Number(src.buffs);
  }

  general.buffs ||= { mageArmor: 0, shieldSpell: 0 };

  if (Number.isFinite(Number(edits?.buffs?.mageArmor))) {
    general.buffs.mageArmor = Number(edits.buffs.mageArmor);
  }
  if (Number.isFinite(Number(edits?.buffs?.shieldSpell))) {
    general.buffs.shieldSpell = Number(edits.buffs.shieldSpell);
  }
general.classes ||= { sorc: 0, wiz: 0, um: 0, inc: 0 };

if (Number.isFinite(Number(edits?.classes?.sorc))) {
  general.classes.sorc = Number(edits.classes.sorc);
}
if (Number.isFinite(Number(edits?.classes?.wiz))) {
  general.classes.wiz = Number(edits.classes.wiz);
}
if (Number.isFinite(Number(edits?.classes?.um))) {
  general.classes.um = Number(edits.classes.um);
}
if (Number.isFinite(Number(edits?.classes?.inc))) {
  general.classes.inc = Number(edits.classes.inc);
}
  return general;
}

function syncGeneralEditsFromGeneral(general) {
  if (!general) return;

  state.generalEdits ||= defaultGeneralEdits();

  for (const key of ["str", "dex", "con", "int", "wis", "cha"]) {
    const src = general.abilities?.[key] || {};
    state.generalEdits.abilities[key] = {
      asi: Number(src.asi) || 0,
      items: Number(src.items) || 0,
      buffs: Number(src.buffs) || 0
    };
  }

  state.generalEdits.buffs = {
    mageArmor: Number(general.buffs?.mageArmor) || 0,
    shieldSpell: Number(general.buffs?.shieldSpell) || 0
  };
   
state.generalEdits.classes = {
  sorc: Number(general.classes?.sorc) || 0,
  wiz: Number(general.classes?.wiz) || 0,
  um: Number(general.classes?.um) || 0,
  inc: Number(general.classes?.inc) || 0
};

  saveGeneralEdits();
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
if (el.viewSlots)   el.viewSlots.onclick   = () => setView("Spells");
if (el.viewSkills)  el.viewSkills.onclick  = () => setView("Skills");

/* --------------------------- Zoom controls ----------------------------- */
if (el.zoomOut)   el.zoomOut.onclick = () => setZoom(state.zoom / 1.15);
if (el.zoomIn)    el.zoomIn.onclick  = () => setZoom(state.zoom * 1.15);
if (el.zoomReset) el.zoomReset.onclick = () => resetView();

if (el.viewport) {
  el.viewport.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : (1 / 1.08);
    setZoom(state.zoom * factor, e.clientX, e.clientY);
  }, { passive: false });
}

/* ----------------------------- Pan mode -------------------------------- */
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

function endPan() {
  panDrag.active = false;
}

if (el.viewport) {
  el.viewport.addEventListener("pointerdown", (e) => {
    // Touch navigation is handled by the two-finger gesture layer below.
    if (e.pointerType === "touch") return;

    // Preserve existing behavior:
    // - pen OFF => mouse/stylus can pan
    // - pen ON  => stylus should not pan here
    if (state.penOn) return;

    beginPan(e);
    el.viewport.setPointerCapture?.(e.pointerId);
  });

  el.viewport.addEventListener("pointermove", movePan);
  el.viewport.addEventListener("pointerup", endPan);
  el.viewport.addEventListener("pointercancel", endPan);
}
/* ---------------------- Two-finger touch gestures ----------------------- */

const ENABLE_TOUCH_GESTURES = true;

let touchGestureController = null;

if (
  ENABLE_TOUCH_GESTURES &&
  el.viewport &&
  typeof TouchGestures !== "undefined"
) {
  touchGestureController = TouchGestures.install({
    viewport: el.viewport,
    enabled: true,

    getPan: () => state.pan,
    setPan: (pan) => {
      state.pan.x = pan.x;
      state.pan.y = pan.y;
    },

    getZoom: () => state.zoom,
    setZoom: (zoom) => {
      state.zoom = zoom;
    },

    clampZoom,

    onTransformChanged: () => {
      applyWorldTransform();
      ink.redraw();
    }
  });
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

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    if (!canvas || !ctx) return;
    ensureCanvasSize();
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

  let drawing = false;
  let currentStroke = null;
  let activePointerId = null;

  function pointerDown(e) {
    if (!state.penOn || !canvas) return;
    if (e.pointerType === "touch") return;

    drawing = true;
    activePointerId = e.pointerId;

    const p = screenToWorld(e.clientX, e.clientY);
    currentStroke = {
      erase: state.erasing,
      pts: [p],
      width: state.erasing ? state.eraserWidth : state.lineWidth
    };
    getStrokesForView(state.view).push(currentStroke);

    try { canvas.setPointerCapture(e.pointerId); } catch {}
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
  if (el.undo) el.undo.onclick = undo;
  if (el.clearInk) el.clearInk.onclick = clear;

  window.addEventListener("resize", () => {
    ensureCanvasSize();
    redraw();
  });

  ensureCanvasSize();

  return { redraw, loadForView, setPenMode, setEraser };
})();

/* ---------------------- Google Sheets ingest (CSV) ---------------------- */
async function loadFromGoogleSheets(sheetUrl) {
  try {
    const id = SheetLoader.extractSpreadsheetId(sheetUrl);
    if (!id) throw new Error("Could not extract spreadsheet ID from URL.");

    const gids = {
      spells: 0,
      general: 2004670713,
      slot: 1231385124,
      skills: 2140364605
    };

    setProgress(5, "Fetching Spells…");
    const spellsGrid = SheetLoader.csvToGrid(
      await SheetLoader.fetchCsvViaProxy(id, gids.spells)
    );

    setProgress(30, "Fetching General…");
    const generalGrid = SheetLoader.csvToGrid(
      await SheetLoader.fetchCsvViaProxy(id, gids.general)
    );

    setProgress(55, "Fetching Skills…");
    const skillsGrid = SheetLoader.csvToGrid(
      await SheetLoader.fetchCsvViaProxy(id, gids.skills)
    );


const parsedSpells = SheetParsers.parseSpellsGrid(spellsGrid);
const parsedGeneral = SheetParsers.parseGeneralGrid(generalGrid);
const parsedSkills = SheetParsers.parseSkillsGrid(skillsGrid);

// Emergency-safe fallback: parse class levels directly from the already-ingested classLine text.
const classLineLevels = parseClassesFromText(parsedGeneral.classLine);

// Normalize class levels once.
// Prefer any positive structured value from the Spells sheet,
// then any positive parsed value from General,
// then the direct classLine fallback.
const normalizedClasses = {
  sorc: pickLevel(parsedSpells.classLevels?.sorc, parsedGeneral.classes?.sorc, classLineLevels.sorc),
  wiz:  pickLevel(parsedSpells.classLevels?.wiz,  parsedGeneral.classes?.wiz,  classLineLevels.wiz),
  um:   pickLevel(parsedSpells.classLevels?.um,   parsedGeneral.classes?.um,   classLineLevels.um),
  inc:  pickLevel(parsedSpells.classLevels?.inc,  parsedGeneral.classes?.inc,  classLineLevels.inc)
};

console.log("Class level normalization", {
  spellsClassLevels: parsedSpells.classLevels,
  generalClasses: parsedGeneral.classes,
  classLine: parsedGeneral.classLine,
  classLineLevels,
  normalizedClasses
});

parsedGeneral.classes = normalizedClasses;

parsedSpells.meta = {
  ...(parsedSpells.meta || {}),
  sorcLevels: normalizedClasses.sorc,
  wizLevels: normalizedClasses.wiz,
  umLevels: normalizedClasses.um,
  incLevels: normalizedClasses.inc,
  arcaneSpellpower:
    normalizedClasses.um >= 10 ? 4 :
    normalizedClasses.um >= 7 ? 3 :
    normalizedClasses.um >= 4 ? 2 :
    normalizedClasses.um >= 1 ? 1 : 0
};


    applyGeneralEditsToGeneral(parsedGeneral, state.generalEdits);

    state.data.general = parsedGeneral;
    state.data.spells.sorc = parsedSpells.sorc;
    state.data.spells.wiz = parsedSpells.wiz;
    state.data.spells.meta = parsedSpells.meta;

    state.data.skills.rows = parsedSkills.rows;
    state.data.skills.inventoryLines = parsedSkills.inventoryLines;

    if (!state.skillsEdits.inventoryText) {
      state.skillsEdits.inventoryText = parsedSkills.inventoryLines.join("\n");
    }

    state.loaded = true;

    setProgress(95, "Rendering…");
    render();
    setProgress(100, "Done ✅");
  } catch (e) {
    console.error(e);
    setProgress(0, "Load failed: " + (e?.message || e));
    state.loaded = false;
  }
}

/* ------------------------------ Rendering ------------------------------ */
function renderGeneral() {
  const g = state.data.general;

  if (!g) {
    el.app.innerHTML = `<div class="panel"><h2>General</h2><div class="hint">No general data loaded.</div></div>`;
    return;
  }

  g.feats = Array.isArray(g.feats) ? g.feats : [];
  g.languages = Array.isArray(g.languages) ? g.languages : [];

  g.abilities = g.abilities || {};
  for (const k of ["str", "dex", "con", "int", "wis", "cha"]) {
    g.abilities[k] = g.abilities[k] || { pointBuy: 0, asi: 0, items: 0, buffs: 0 };
  }

  g.ac = g.ac || { armor: 0, shield: 0, size: 0, natural: 0, deflect: 0, misc: 0, miscTouch: 0 };
  g.buffs = g.buffs || { mageArmor: 0, shieldSpell: 0 };
  g.classes = g.classes || { sorc: 0, wiz: 0, um: 0, inc: 0 };
  g.saves = g.saves || { fortMisc: 0, refMisc: 0, willMisc: 0 };
  g.attacks = g.attacks || { meleeMisc: 0, rangedMisc: 0, grappleMisc: 0 };
  g.initMisc = g.initMisc || 0;

  const d = GeneralDerived.compute(g);
  const A = d.abilities;

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

<div style="margin-top:8px;">
  <h4>Class levels</h4>
  <div class="class-level-grid">
    <label>
      Sorc
      <input type="number" inputmode="numeric" min="0" step="1" data-class-key="sorc" value="${Number(g.classes?.sorc) || 0}">
    </label>
    <label>
      Wiz
      <input type="number" inputmode="numeric" min="0" step="1" data-class-key="wiz" value="${Number(g.classes?.wiz) || 0}">
    </label>
    <label>
      UM
      <input type="number" inputmode="numeric" min="0" step="1" data-class-key="um" value="${Number(g.classes?.um) || 0}">
    </label>
    <label>
      Inc
      <input type="number" inputmode="numeric" min="0" step="1" data-class-key="inc" value="${Number(g.classes?.inc) || 0}">
    </label>
  </div>
</div>
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
            <label><input id="buff_mage" type="checkbox" ${g.buffs.mageArmor ? "checked" : ""}> Mage Armor (+4)</label><br>
            <label><input id="buff_shield" type="checkbox" ${g.buffs.shieldSpell ? "checked" : ""}> Shield (+4)</label>
          </div>
        </div>
      </div>

      <div class="panel">
        <h3>Abilities (breakdown)</h3>
        <div class="hint">Point buy array / ASI / Items / Penalties-buffs → Total → Mod</div>

        <div class="ability-breakdown-grid">
          <div></div>
          <div class="hdr">Point buy</div>
          <div class="hdr">ASI</div>
          <div class="hdr">Items</div>
          <div class="hdr">Buffs</div>
          <div class="hdr">Total</div>
          <div class="hdr">Mod</div>

          ${abilityRow("STR", "str")}
          ${abilityRow("DEX", "dex")}
          ${abilityRow("CON", "con")}
          ${abilityRow("INT", "int")}
          ${abilityRow("WIS", "wis")}
          ${abilityRow("CHA", "cha")}
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

  if (mage) mage.onchange = () => {
    g.buffs.mageArmor = mage.checked ? 4 : 0;
    syncGeneralEditsFromGeneral(g);
    renderGeneral();
    ink.redraw();
  };

  if (shield) shield.onchange = () => {
    g.buffs.shieldSpell = shield.checked ? 4 : 0;
    syncGeneralEditsFromGeneral(g);
    renderGeneral();
    ink.redraw();
  };

  document.querySelectorAll('.ability-breakdown-grid input[data-ab][data-field]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const ab = inp.getAttribute('data-ab');
      const field = inp.getAttribute('data-field');
      const val = Number(inp.value);

      g.abilities[ab][field] = Number.isFinite(val) ? val : 0;
      syncGeneralEditsFromGeneral(g);
      renderGeneral();
      ink.redraw();
    });
  });
   document.querySelectorAll('input[data-class-key]').forEach((inp) => {
  inp.addEventListener('input', () => {
    const key = inp.getAttribute('data-class-key');
    const val = Number(inp.value);

    g.classes ||= { sorc: 0, wiz: 0, um: 0, inc: 0 };
    g.classes[key] = Number.isFinite(val) ? Math.max(0, Math.floor(val)) : 0;

    // Keep the human-readable class line in sync
    g.classLine = formatClassLineFromClasses(g.classes);

    syncGeneralEditsFromGeneral(g);
    renderGeneral();
    ink.redraw();
  });
});
}

function ensureSlotsInlineStyles() {
  // Styles moved to styles.css
}

function loadUsedSlotMarks(viewName = state.view) {
  const key = `ink_slots_used:${viewName || 'Spells'}`;

  if (typeof AppStorage !== "undefined") {
    return AppStorage.readJson(key, {});
  }

  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveUsedSlotMarks(viewName = state.view, obj = {}) {
  const key = `ink_slots_used:${viewName || 'Spells'}`;

  if (typeof AppStorage !== "undefined") {
    AppStorage.writeJson(key, obj);
    return;
  }

  try {
    localStorage.setItem(key, JSON.stringify(obj));
  } catch {}
}

function getSpellfireCapacity() {
  const g = state.data.general;
  if (!g) return 0;

  const d = GeneralDerived.compute(g);
  const conScore = Number(d?.abilities?.con?.total) || 0;
  return Math.max(0, conScore);
}

function getSpellcastingData() {
  const g = state.data.general || {};
  const meta = state.data.spells.meta || {};

  const d = state.data.general ? GeneralDerived.compute(g) : null;
  const chaMod = d ? d.abilities.cha.mod : 0;
  const intMod = d ? d.abilities.int.mod : 0;
  const chaTotal = d ? d.abilities.cha.total : (state.cha || 0);
  const intTotal = d ? d.abilities.int.total : (state.int || 0);

  const sorcRows = state.data.spells.sorc || [];
  const wizRows = state.data.spells.wiz || [];

  const baseSorc = Number(
    state.data.currentSorcererLevel ??
    (g.classes ? g.classes.sorc : undefined) ??
    meta.sorcLevels ??
    0
  ) || 0;

  const baseWiz = Number(
    state.data.currentWizardLevel ??
    (g.classes ? g.classes.wiz : undefined) ??
    meta.wizLevels ??
    0
  ) || 0;

  const umLevels = Number(
    state.data.currentUmLevel ??
    (g.classes ? g.classes.um : undefined) ??
    meta.umLevels ??
    0
  ) || 0;

  const incLevels = Number(
    state.data.currentIncantatrixLevel ??
    (g.classes ? g.classes.inc : undefined) ??
    meta.incLevels ??
    0
  ) || 0;

  const progression = ArcaneMath.computeProgressionFromBuildPlan(
    BUILD_PLAN,
    {
      sorc: baseSorc,
      wiz: baseWiz,
      um: umLevels,
      inc: incLevels
    },
    {
      tieBreaker: "wiz"
    }
  );

  const calc = (typeof SlotCalculator !== "undefined")
    ? SlotCalculator.computeAllSlots(state, {
        overrides: {
          sorcererLevel: progression.sorc,
          wizardLevel: progression.wiz,
          sorCha: chaTotal,
          wizInt: intTotal
        },
        applySpecialistPreparedBonus: true
      })
    : null;

  return {
    g,
    meta,
    d,
    chaMod,
    intMod,
    sorcRows,
    wizRows,
    calc,
    progression,
    effSorc: progression.sorc,
    effWiz: progression.wiz
  };
}

function renderSorcererSlotsHtml(calc, usedState) {
  if (!calc || !calc.sorcerer || !calc.sorcerer.final) {
    return `<div class="hint">SlotCalculator not loaded.</div>`;
  }

  const rows = [];

  for (let lvl = 0; lvl <= 9; lvl++) {
    const count = Number(calc.sorcerer.final[lvl]) || 0;
    if (count <= 0) continue;

    let boxes = "";
    for (let i = 0; i < count; i++) {
      const key = `sorcerer:${lvl}:${i}`;
      const used = usedState[key] ? " used" : "";
      boxes += `<div class="slot-box-inline${used}" data-key="${key}" data-class-key="sorcerer" data-level="${lvl}"></div>`;
    }

    rows.push(`
      <div class="slot-row-inline">
        <div class="slot-row-label">${lvl}</div>
        <div>${boxes}</div>
      </div>
    `);
  }

  if (!rows.length) {
    return `<div class="hint">No sorcerer slots available.</div>`;
  }

  return `<div class="slot-stack-bottom">${rows.join("")}</div>`;
}

function renderSpellfireHtml(usedState) {
  const capacity = getSpellfireCapacity();

  if (capacity <= 0) {
    return `<div class="hint">No Spellfire capacity available.</div>`;
  }

  let boxes = "";
  for (let i = 0; i < capacity; i++) {
    const key = `spellfire:${i}`;
    const used = usedState[key] ? " used" : "";
    boxes += `<div class="slot-box-inline${used}" data-key="${key}" data-kind="spellfire"></div>`;
  }

  return `
    <div class="spellfire-section">
      <div class="slot-row-inline">
        <div class="slot-row-label">SF</div>
        <div>${boxes}</div>
      </div>
      <div class="hint small spellfire-note">
        Absorb targeted spells to gain charges; spend charges for 1d6 damage each as a ranged touch attack (400 ft, Reflex half DC 20), or heal 2 HP per charge by touch.
      </div>
    </div>
  `;
}

function renderWizardSlotsHtml(calc) {
  if (!calc || !calc.wizardPrepared) {
    return `<div class="hint">SlotCalculator not loaded.</div>`;
  }

  const items = [];

  for (let lvl = 0; lvl <= 9; lvl++) {
    const prepared = Number(calc.wizardPrepared[lvl]) || 0;
    if (prepared <= 0) continue;

    items.push(`
      <div class="wizard-prepared-item">
        <div class="wizard-prepared-label">${lvl}</div>
        <div class="wizard-prep-box">${prepared}</div>
      </div>
    `);
  }

  if (!items.length) {
    return `<div class="hint">No wizard slots available.</div>`;
  }

  return `<div class="wizard-prepared-strip">${items.join("")}</div>`;
}

function wireCombinedSpellcastingSlotClicks() {
  document.querySelectorAll('.slot-box-inline[data-key]').forEach((box) => {
    box.addEventListener('click', () => {
      const key = box.dataset.key;
      const cur = loadUsedSlotMarks("Spells");

      if (cur[key]) {
        delete cur[key];
        box.classList.remove('used');
      } else {
        cur[key] = true;
        box.classList.add('used');
      }

      saveUsedSlotMarks("Spells", cur);
    });
  });
}

/* ---------------------- Slots UI fallback (legacy) --------------------- */
function renderSlots() {
  const container = el.app;
  if (!container) return;
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = 'Slots';
  header.appendChild(h);
  container.appendChild(header);

  if (typeof SlotCalculator === 'undefined') {
    const p = document.createElement('div');
    p.className = 'panel hint';
    p.textContent = 'SlotCalculator not loaded. Include slotCalculator.js before app.js.';
    container.appendChild(p);
    return;
  }

  const g = state.data.general || {};
  const meta = state.data.spells.meta || {};

  const baseSorc = Number(state.data.currentSorcererLevel ?? meta.sorcLevels ?? (g.classes ? g.classes.sorc : 0)) || 0;
  const baseWiz = Number(state.data.currentWizardLevel ?? meta.wizLevels ?? (g.classes ? g.classes.wiz : 0)) || 0;
  const umLevels = Number(state.data.currentUmLevel ?? meta.umLevels ?? (g.classes ? g.classes.um : 0)) || 0;

  const d = g ? GeneralDerived.compute(g) : null;
  const chaTotal = d ? d.abilities.cha.total : (state.cha || 0);
  const intTotal = d ? d.abilities.int.total : (state.int || 0);

  const progression = ArcaneMath.computeProgressionLevels({
    sorcBase: baseSorc,
    wizBase: baseWiz,
    umLevels,
    tieBreaker: 'wiz'
  });

  const effSorc = progression.sorc;
  const effWiz = progression.wiz;

  const calc = SlotCalculator.computeAllSlots(state, {
    overrides: {
      sorcererLevel: effSorc,
      wizardLevel: effWiz,
      sorCha: chaTotal,
      wizInt: intTotal
    },
    applySpecialistPreparedBonus: true
  });

  const storageKey = (view) => `ink_slots_used:${view || state.view || 'General'}`;
  function loadUsed(view) {
    try {
      const raw = localStorage.getItem(storageKey(view));
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  function saveUsed(view, obj) {
    try {
      localStorage.setItem(storageKey(view), JSON.stringify(obj));
    } catch {}
  }

  ensureSlotsInlineStyles();

  const panel = document.createElement('div');
  panel.className = 'panel slots-panel';

  const sorCol = document.createElement('div');
  sorCol.className = 'slots-column';
  const sorTitle = document.createElement('h3');
  sorTitle.textContent = `Sorcerer slots (effective level ${effSorc})`;
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
    if (count <= 0) {
      const empty = document.createElement('div');
      empty.className = 'slot-box-inline zero';
      empty.title = 'No slots';
      tdBoxes.appendChild(empty);
    } else {
      for (let i = 0; i < count; i++) {
        const box = document.createElement('div');
        box.className = 'slot-box-inline';
        const key = `sorcerer:${lvl}:${i}`;
        if (usedState[key]) box.classList.add('used');
        box.dataset.key = key;
        box.dataset.classKey = 'sorcerer';
        box.dataset.level = String(lvl);
        box.addEventListener('click', () => {
          const cur = loadUsed(state.view);
          if (cur[key]) {
            delete cur[key];
            box.classList.remove('used');
          } else {
            cur[key] = true;
            box.classList.add('used');
          }
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

  const wizCol = document.createElement('div');
  wizCol.className = 'slots-column';
  const wizTitle = document.createElement('h3');
  wizTitle.textContent = `Wizard prepared (effective level ${effWiz})`;
  wizCol.appendChild(wizTitle);

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

  container.appendChild(panel);

  const note = document.createElement('div');
  note.className = 'hint small';
  note.textContent = 'Click sorcerer boxes to mark used; marks persist per view. You can also cross out with the pen.';
  container.appendChild(note);
}

function renderSpells() {
  ensureSlotsInlineStyles();

  const {
    meta,
    chaMod,
    intMod,
    sorcRows,
    wizRows,
    calc,
    progression,
    effSorc,
    effWiz
  } = getSpellcastingData();

  const usedState = loadUsedSlotMarks("Spells");

  el.app.innerHTML = `
    <div class="panel">
      <h2>Spellcasting</h2>
      <div class="hint">Pan/zoom the paper; use Pen to write in prep boxes. Click sorcerer slot boxes to mark them used.</div>

      <div class="grid">
        <div class="panel slot-panel">
          <h3>Sorcerer slots (effective level ${effSorc})</h3>
          <div class="sorc-resources-row">
            <div class="sorc-slots-block">
              ${renderSorcererSlotsHtml(calc, usedState)}
            </div>
            <div class="spellfire-side">
              ${renderSpellfireHtml(usedState)}
            </div>
          </div>
        </div>

        <div class="panel slot-panel">
          <h3>Wizard prepared (effective level ${effWiz})</h3>
          ${renderWizardSlotsHtml(calc)}
        </div>

        <div class="panel">
          <h3>Sorcerer / UM</h3>
          ${SpellsViewHelpers.renderSpellTable({
            rows: sorcRows,
            meta,
            progression,
            arcaneSpellPower: meta.arcaneSpellpower,
            castingMod: chaMod,
            showPrep: false
          })}
        </div>

        <div class="panel">
          <h3>Wizard</h3>
          ${SpellsViewHelpers.renderSpellTable({
            rows: wizRows,
            meta,
            progression,
            arcaneSpellPower: meta.arcaneSpellpower,
            castingMod: intMod,
            showPrep: true
          })}
        </div>
      </div>

      <div class="hint small">
        Top-left: sorcerer slots and Spellfire. Top-right: wizard prepared counts. Bottom row: sorcerer and wizard spell lists.
      </div>
    </div>
  `;

  wireCombinedSpellcastingSlotClicks();
}
function renderSkills() {
  const g = state.data.general;
  const skillsData = state.data.skills || { rows: [], inventoryLines: [] };

  if (!g || !skillsData.rows || !skillsData.rows.length) {
    el.app.innerHTML = `
      <div class="panel">
        <h2>Skills</h2>
        <div class="hint">No skills data loaded.</div>
      </div>
    `;
    return;
  }

  const computedRows = SkillsMath.computeSkillRows(
    skillsData.rows,
    g,
    state.skillsEdits.bySkillName,
    { baseAcp: 0 }
  );

  el.app.innerHTML = `
    <div class="panel">
      <h2>Skills</h2>
      <div class="hint">Rank and Misc are editable. Ability modifier, ACP, and racial bonus are computed automatically.</div>

      <div class="skills-layout">
        <div class="panel skills-table-panel">
          <table class="table skills-table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Ab</th>
                <th>Total</th>
                <th>Ab mod</th>
                <th>Rank</th>
                <th>Misc</th>
                <th>ACP</th>
                <th>Race</th>
              </tr>
            </thead>
            <tbody>
              ${computedRows.map((row) => `
                <tr>
                  <td>${escapeHtml(row.name)}</td>
                  <td>${escapeHtml(row.ability)}</td>
                  <td><strong>${fmtSign(row.total)}</strong></td>
                  <td>${fmtSign(row.abilityMod)}</td>
                  <td>
                    <input
                      class="skill-edit"
                      type="number"
                      inputmode="numeric"
                      data-skill="${escapeHtml(row.name)}"
                      data-field="rank"
                      value="${Number(row.rank) || 0}"
                    >
                  </td>
                  <td>
                    <input
                      class="skill-edit"
                      type="number"
                      inputmode="numeric"
                      data-skill="${escapeHtml(row.name)}"
                      data-field="misc"
                      value="${Number(row.misc) || 0}"
                    >
                  </td>
                  <td>${fmtSign(row.acp)}</td>
                  <td>${fmtSign(row.raceBonus)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

        <div class="panel skills-notes-panel">
          <h3>Inventory / Notes</h3>
          <textarea id="skillsInventoryText" class="skills-notes">${escapeHtml(state.skillsEdits.inventoryText || "")}</textarea>
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll('.skill-edit[data-skill][data-field]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const skillName = inp.getAttribute('data-skill');
      const field = inp.getAttribute('data-field');
      const val = Number(inp.value);

      state.skillsEdits.bySkillName[skillName] ||= {};
      state.skillsEdits.bySkillName[skillName][field] = Number.isFinite(val) ? val : 0;

      saveSkillsEdits();
      renderSkills();
      ink.redraw();
    });
  });

  const notes = document.getElementById('skillsInventoryText');
  if (notes) {
    notes.addEventListener('input', () => {
      state.skillsEdits.inventoryText = notes.value;
      scheduleSaveSkillsEdits(250);
    });

    notes.addEventListener('blur', () => {
      saveSkillsEdits();
    });
  }
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
  else if (state.view === "Spells" || state.view === "Slots") renderSpells();
  else if (state.view === "Skills") renderSkills();
  else el.app.innerHTML = `<div class="panel"><h2>${escapeHtml(state.view)}</h2><div class="hint">Not implemented yet.</div></div>`;

  applyWorldTransform();
  ink.redraw();
}

/* ---------------------- Hook Google Sheets button ---------------------- */
window.addEventListener("DOMContentLoaded", () => {
  loadEditableState();
  if (el.exportData) {
    el.exportData.addEventListener("click", () => {
      exportAppSnapshot();
    });
  } else {
    console.warn("Export button not present (#exportData).");
  }

  if (el.importData && el.importFile) {
    el.importData.addEventListener("click", () => {
      el.importFile.click();
    });

    el.importFile.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      await importAppSnapshotFromFile(file);

      // allow re-importing the same file later
      e.target.value = "";
    });
  } else {
    console.warn("Import UI not present (#importData / #importFile).");
  }
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

    const saved = (typeof AppStorage !== "undefined")
      ? AppStorage.readNumber("ink.lineWidth", state.lineWidth)
      : state.lineWidth;

    if (Number.isFinite(saved) && saved >= 0.5 && saved <= 24) {
      state.lineWidth = saved;
      if (range) range.value = saved;
      if (num) num.value = saved;
    }

    function applyWidth(v) {
      const val = Math.max(0.5, Math.min(24, Number(v) || 2));
      state.lineWidth = val;
      if (range) range.value = val;
      if (num) num.value = val;

      if (typeof AppStorage !== "undefined") {
        AppStorage.writeNumber("ink.lineWidth", val);
      }
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
