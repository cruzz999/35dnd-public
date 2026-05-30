/* ==========================================================================
   DnD 3.5 Ink Sheet (Paper Mode) - app.js (drop-in replacement)
   This version expects the Google Sheets / XLSX ingest logic to live in a
   separate file that attaches functions to `window.gsIngest` (or is an ES
   module you import before this script runs). The functions used here are:
     - loadFromGoogleSheets(sheetUrl)
     - ingestGeneralFromXlsx(workbook)
     - ingestSpellsFromXlsx(workbook)
   If you prefer ES module imports, load `gs_ingest.js` as a module and set
   `window.gsIngest = { ... }` or adapt this file to use `import` instead.
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
  view: "General", // Paper transform
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

// Receive ingested data from gs_ingest and merge into app state
window.receiveIngestedData = function (general, spells) {
  // Defensive merge so UI keeps using its local `state`
  state.data = state.data || {};
  state.data.general = general || state.data.general;
  state.data.spells = spells || state.data.spells;
  state.loaded = true;

  // Re-render and restore ink for current view
  try {
    setProgress(95, "Rendering…");
    ink.loadForView(state.view);
    render();


    setProgress(100, "Done ✅");
  } catch (err) {
    console.error("receiveIngestedData render error:", err);
    setProgress(0, "Render failed after ingest");
  }
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
  return String(s).replace(/[&<>\"']/g, (m) =>
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
if (el.viewSpells) el.viewSpells.onclick = () => setView("Spells");
if (el.viewSlots) el.viewSlots.onclick = () => setView("Slots");
if (el.viewSkills) el.viewSkills.onclick = () => setView("Skills");

/* --------------------------- Zoom controls ----------------------------- */
if (el.zoomOut) el.zoomOut.onclick = () => setZoom(state.zoom / 1.15);
if (el.zoomIn) el.zoomIn.onclick = () => setZoom(state.zoom * 1.15);
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

// Prevent text selection while panning the paper
(function () {
  let suppressSelect = false;
  const onSelectStart = (e) => { if (suppressSelect) e.preventDefault(); };

  // toggle suppression when pan starts/ends
  const origBeginPan = beginPan;
  const origEndPan = endPan;
  beginPan = function (e) {
    suppressSelect = true;
    document.addEventListener("selectstart", onSelectStart);
    origBeginPan(e);
  };
  endPan = function (e) {
    suppressSelect = false;
    document.removeEventListener("selectstart", onSelectStart);
    origEndPan(e);
  };
})();

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
const ink = (() => {
  const canvas = el.ink;
  const ctx = canvas ? canvas.getContext("2d") : null;

  function getStrokesForView(view) {
    state.strokesByView[view] ||= [];
    return state.strokesByView[view];
  }
  function saveForView(view) {
    try { localStorage.setItem(`ink:${view}`, JSON.stringify(getStrokesForView(view))); } catch {}
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // critical on Android
    canvas.style.touchAction = "none";
  }

  function screenToWorld(clientX, clientY) {
    if (!el.viewport) return { x: 0, y: 0 };
    const vr = el.viewport.getBoundingClientRect();
    const vx = clientX - vr.left;
    const vy = clientY - vr.top;
    return { x: (vx - state.pan.x) / state.zoom, y: (vy - state.pan.y) / state.zoom };
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
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 2;
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
    if (!state.penOn) { drawing = false; currentStroke = null; activePointerId = null; }
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

/* ---------------------- Google Sheets / XLSX ingest bridge ----------------------
   This file no longer contains the ingest implementations. Instead it expects
   them to be provided by `window.gsIngest`. If `gs_ingest.js` is loaded as a
   plain script it should attach the functions to window.gsIngest. If you use
   ES modules, ensure the module sets window.gsIngest before this script runs.
   --------------------------------------------------------------------------- */
function ensureGs() {
  if (!window.gsIngest) throw new Error("gs_ingest.js not loaded. Include it before app.js or attach functions to window.gsIngest.");
  return window.gsIngest;
}

/* ------------------------------ Rendering ------------------------------ */
function computeSpellDC(sl, castingMod) {
  return 10 + (Number(sl)||0) + (Number(castingMod)||0);
}
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
      <input type="number" inputmode="numeric" data-ab="${key}" data-field="asi" value="${Number(g.abilities[key].asi ?? 0)}">
    </div>
    <div class="val">
      <input type="number" inputmode="numeric" data-ab="${key}" data-field="items" value="${Number(g.abilities[key].items ?? 0)}">
    </div>
    <div class="val">
      <input type="number" inputmode="numeric" data-ab="${key}" data-field="buffs" value="${Number(g.abilities[key].buffs ?? 0)}">
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
      <div class="hint">Point buy array / ASI / Items / Penalties-buffs → Total → Mod</div>
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
        <div class="hint">CSV export doesn’t preserve hyperlinks; feats are text-only in Google mode.</div>
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
      renderGeneral();
      ink.redraw();
    });
  });
}

function renderSpellTable(rows, meta, castingMod, showPrep) {
  if (!rows || !rows.length) return `<div class="hint">No spells loaded.</div>`;
  return `
    <table class="table">
      <thead>
        <tr>
          <th>Spell</th><th>SL</th><th>CL</th><th>DC</th>
          ${showPrep ? "<th>Prep</th>" : ""}
          <th>Type</th><th>F</th><th>E</th><th>Range</th><th>Area</th><th>Damage</th><th>Duration</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(s => {
          const cl = computeSpellCL(s, meta);
          const dc = computeSpellDC(s.sl, castingMod);
          const spellCell = s.url ? `<a href="${String(s.url).replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)}</a>` : escapeHtml(s.name);
          const anchorId = `${s.mode}:${s.name}:prep`.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9:_-]/g, "");
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
    ink.redraw();
    return;
  }
  if (state.view === "General") renderGeneral();
  else if (state.view === "Spells") renderSpells();
  else el.app.innerHTML = `<div class="panel"><h2>${escapeHtml(state.view)}</h2><div class="hint">Not implemented yet.</div></div>`;
  applyWorldTransform();
  ink.redraw();



}

/* --------------------------- XLSX loading ------------------------------ */
if (el.file) {
  el.file.addEventListener("change", () => {
    setProgress(0, "XLSX uploads are disabled. Use Google Sheets URL instead.");
    el.file.value = "";
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
        const gs = ensureGs();
        await gs.loadFromGoogleSheets(url);
      } catch (e) {
        console.error(e);
        setProgress(0, "Google Sheets load failed (see console).");
      }
    });
  } else {
    console.warn("Google Sheets UI not present (#gsUrl / #loadGs).");
  }












});

/* --------------------------- Initial setup ----------------------------- */
applyWorldTransform();
ink.loadForView(state.view);
render();
