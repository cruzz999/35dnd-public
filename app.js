/**
 * app.js — bootstrap that wires modular subsystems
 *
 * Replace your existing app.js with this file. It preserves the original
 * behavior while delegating render and ingest to src/ modules.
 *
 * After replacing, create the files:
 *  - src/utils.js
 *  - src/ingest.js
 *  - src/render.js
 *
 * Then hard-reload the page and run the smoke checks in the console.
 */

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

function assertEl(name) { if (!el[name]) console.warn(`Missing element #${name}`); }
["viewport", "world", "app", "ink", "status", "progressBar"].forEach(assertEl);

/* ------------------------------ App state ------------------------------ */
const state = {
  loaded: false,
  view: "General",
  zoom: 1,
  pan: { x: 20, y: 20 },
  penOn: false,
  erasing: false,
  strokesByView: {},
  data: { general: null, spells: { sorc: [], wiz: [], meta: {} }, slots: [] },
  canvasOrigin: { x: 2000, y: 2000 }
};
window.state = state;

/* ------------------------------ Progress ------------------------------- */
function setProgress(pct, text) {
  if (el.progressBar) el.progressBar.style.width = `${pct}%`;
  if (el.status) el.status.textContent = text || '';
}

/* ------------------------------ Modules ------------------------------- */
let renderModule = null;
let ingestModule = null;

async function loadModules() {
  try {
    renderModule = await import('./src/render.js');
    // expose for debugging and for other code that checks window.renderModule
    window.renderModule = renderModule;
  } catch (e) {
    console.warn('Could not load src/render.js', e);
  }
  try {
    ingestModule = await import('./src/ingest.js');
    window.ingestModule = ingestModule;
  } catch (e) {
    console.warn('Could not load src/ingest.js', e);
  }
}


/* ------------------------------ Viewport & Ink ------------------------- */
function applyWorldTransform() {
  const world = el.world || document.body;
  if (!world) return;
  world.style.transformOrigin = '0 0';
  world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  if (el.ink) {
    el.ink.style.transformOrigin = '0 0';
    el.ink.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  }
}
function setZoom(z, anchorX=null, anchorY=null) {
  const old = state.zoom;
  z = Math.max(0.5, Math.min(3, z));
  if (z === old) return;
  if (anchorX != null && anchorY != null && el.viewport) {
    const vr = el.viewport.getBoundingClientRect();
    const vx = anchorX - vr.left;
    const vy = anchorY - vr.top;
    const wx = (vx - state.pan.x) / old;
    const wy = (vy - state.pan.y) / old;
    state.pan.x = vx - wx * z;
    state.pan.y = vy - wy * z;
  }
  state.zoom = z;
  applyWorldTransform();
  if (window.__ink && window.__ink.redraw) window.__ink.redraw();
}
function resetView() { state.zoom = 1; state.pan = { x:20, y:20 }; applyWorldTransform(); if (window.__ink && window.__ink.redraw) window.__ink.redraw(); }

if (el.viewport) {
  el.viewport.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 1/1.08;
    setZoom(state.zoom * factor, e.clientX, e.clientY);
  }, { passive: false });
}

/* ------------------------------ Ink layer ------------------------------ */
const ink = (() => {
  const canvas = el.ink;
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let canvasOrigin = state.canvasOrigin || { x:2000, y:2000 };
  state.canvasOrigin = canvasOrigin;

  function ensureSize() {
    const minW = Math.max(el.app?.scrollWidth || 1200, 1200) + canvasOrigin.x*2;
    const minH = Math.max(el.app?.scrollHeight || 800, 800) + canvasOrigin.y*2;
    canvas.style.width = `${minW}px`;
    canvas.style.height = `${minH}px`;
    canvas.width = Math.floor(minW * dpr);
    canvas.height = Math.floor(minH * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  ensureSize();

  function worldToCss(x,y) {
    return { x: x*state.zoom + state.pan.x - canvasOrigin.x, y: y*state.zoom + state.pan.y - canvasOrigin.y };
  }
  function screenToWorld(cx,cy) {
    const vr = el.viewport ? el.viewport.getBoundingClientRect() : { left:0, top:0 };
    const vx = cx - vr.left;
    return { x: (vx - state.pan.x) / state.zoom, y: (cy - vr.top - state.pan.y) / state.zoom };
  }

  function drawStrokePts(pts, erase=false) {
    if (!ctx || pts.length < 2) return;
    ctx.save();
    if (erase) { ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = 18; }
    else { ctx.globalCompositeOperation = 'source-over'; ctx.lineWidth = 2; }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function redraw() {
    ensureSize();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const strokes = state.strokesByView[state.view] || [];
    for (const s of strokes) {
      const cssPts = (s.pts || []).map(p => worldToCss(p.x,p.y));
      drawStrokePts(cssPts, !!s.erase);
    }
  }

  function saveForView(view) {
    try { localStorage.setItem(`ink:${view}`, JSON.stringify(state.strokesByView[view] || [])); } catch {}
  }
  function loadForView(view) {
    try {
      const raw = localStorage.getItem(`ink:${view}`);
      state.strokesByView[view] = raw ? JSON.parse(raw) : [];
    } catch { state.strokesByView[view] = []; }
    redraw();
  }

  let drawing = false, current = null, activeId = null;
  function pointerDown(e) {
    if (!state.penOn) return;
    if (e.pointerType === 'touch') return;
    ensureSize();
    drawing = true;
    activeId = e.pointerId;
    const w = screenToWorld(e.clientX, e.clientY);
    current = { erase: !!state.erasing, pts: [w] };
    state.strokesByView[state.view] ||= [];
    state.strokesByView[state.view].push(current);
    redraw();
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  }
  function pointerMove(e) {
    if (!drawing || activeId !== e.pointerId) return;
    const w = screenToWorld(e.clientX, e.clientY);
    const last = current.pts[current.pts.length-1];
    const dx = w.x - last.x, dy = w.y - last.y;
    if (dx*dx + dy*dy < 0.0001) return;
    current.pts.push(w);
    redraw();
    e.preventDefault();
  }
  function pointerUp(e) {
    if (!drawing) return;
    if (activeId !== null && e && e.pointerId !== activeId) return;
    drawing = false; current = null; activeId = null;
    saveForView(state.view);
    try { if (e) canvas.releasePointerCapture(e.pointerId); } catch {}
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('lostpointercapture', pointerUp);
  canvas.addEventListener('pointerleave', pointerUp);

  function clear() { state.strokesByView[state.view] = []; saveForView(state.view); redraw(); }
  function undo() { const s = state.strokesByView[state.view] || []; s.pop(); saveForView(state.view); redraw(); }

  function setPenMode(on) {
    state.penOn = !!on;
    canvas.style.pointerEvents = state.penOn ? 'auto' : 'none';
    if (el.penToggle) el.penToggle.textContent = `Pen: ${state.penOn ? 'ON' : 'OFF'}`;
  }
  function setEraser(on) { state.erasing = !!on; if (el.eraser) el.eraser.textContent = state.erasing ? 'Eraser: ON' : 'Eraser'; }

  return { redraw, loadForView, clear, undo, setPenMode, setEraser, saveForView };
})();
window.__ink = ink;

/* ------------------------------ Pan handling --------------------------- */
let panDrag = { active:false, sx:0, sy:0, baseX:0, baseY:0 };
function beginPan(e) { panDrag.active = true; panDrag.sx = e.clientX; panDrag.sy = e.clientY; panDrag.baseX = state.pan.x; panDrag.baseY = state.pan.y; document.body.classList.add('no-select-during-pan'); }
function movePan(e) { if (!panDrag.active) return; const dx = e.clientX - panDrag.sx; const dy = e.clientY - panDrag.sy; state.pan.x = panDrag.baseX + dx; state.pan.y = panDrag.baseY + dy; applyWorldTransform(); if (ink && ink.redraw) ink.redraw(); }
function endPan() { panDrag.active = false; document.body.classList.remove('no-select-during-pan'); }
if (el.viewport) {
  el.viewport.addEventListener('pointerdown', e => { if (state.penOn) return; beginPan(e); el.viewport.setPointerCapture?.(e.pointerId); }, { passive: true });
  el.viewport.addEventListener('pointermove', movePan, { passive: true });
  el.viewport.addEventListener('pointerup', endPan, { passive: true });
  el.viewport.addEventListener('pointercancel', endPan, { passive: true });
}

/* ------------------------------ Derived compute ------------------------ */
function computeGeneralDerivedLocal(g) {
  // local fallback compute (kept for safety if render module missing)
  const cls = g.classes || { sorc:0, wiz:0, um:0 };
  const abilities = {};
  for (const k of ['str','dex','con','int','wis','cha']) {
    const a = g.abilities[k] || {};
    const pb = Number(a.pointBuy || 0);
    const asi = Number(a.asi || 0);
    const items = Number(a.items || 0);
    const buffs = Number(a.buffs || 0);
    const total = pb + asi + items + buffs;
    abilities[k] = { total, mod: Math.floor((Number(total||0)-10)/2) };
  }
  const lvl = (Number(cls.sorc)||0) + (Number(cls.wiz)||0) + (Number(cls.um)||0);
  const conMod = abilities.con.mod;
  const hpBase = lvl > 0 ? (4 + (lvl-1)*3) : 0;
  const hpMax = hpBase + conMod * lvl;
  const ac = g.ac || {};
  const armorItem = Number(ac.armor || 0);
  const shieldItem = Number(ac.shield || 0);
  const size = Number(ac.size || 0);
  const natural = Number(ac.natural || 0);
  const deflect = Number(ac.deflect || 0);
  const misc = Number(ac.misc || 0);
  const mageArmor = Number(g.buffs?.mageArmor || 0);
  const shieldSpell = Number(g.buffs?.shieldSpell || 0);
  const armorUsed = Math.max(armorItem, mageArmor);
  const shieldUsed = Math.max(shieldItem, shieldSpell);
  const acTotal = 10 + armorUsed + shieldUsed + abilities.dex.mod + size + natural + deflect + misc;
  const touch = 10 + abilities.dex.mod + size + deflect + (Number(ac.miscTouch||0) || 0);
  const flat = 10 + armorUsed + shieldUsed + size + natural + deflect + misc;
  const bab = Math.floor((Number(cls.sorc)||0)/2) + Math.floor((Number(cls.wiz)||0)/2) + Math.floor((Number(cls.um)||0)/2);
  const fort = Math.floor((Number(cls.sorc)||0)/3) + Math.floor((Number(cls.wiz)||0)/3) + Math.floor((Number(cls.um)||0)/3) + abilities.con.mod + (Number(g.saves?.fortMisc)||0);
  const ref = Math.floor((Number(cls.sorc)||0)/3) + Math.floor((Number(cls.wiz)||0)/3) + Math.floor((Number(cls.um)||0)/3) + abilities.dex.mod + (Number(g.saves?.refMisc)||0);
  const will = 2 + Math.floor((Number(cls.sorc)||0)/2) + Math.floor((Number(cls.wiz)||0)/2) + Math.floor((Number(cls.um)||0)/2) + abilities.wis.mod + (Number(g.saves?.willMisc)||0);
  const saves = { fort, ref, will };
  const init = abilities.dex.mod + (Number(g.initMisc)||0);
  return { lvl, abilities, hpMax, acTotal, touch, flat, bab, saves, init };
}

/* ------------------------------ Render router ------------------------- */
async function ensureModulesAndRender() {
  if (!renderModule || !ingestModule) await loadModules();
  if (renderModule && typeof renderModule.renderGeneral === 'function') {
    renderModule.renderGeneral(state, window.__ink);
  } else {
    // fallback: simple local render if module missing
    const g = state.data.general;
    if (!g) {
      if (el.app) el.app.innerHTML = `<div class="panel"><h2>General</h2><div class="hint">No general data loaded.</div></div>`;
      return;
    }
    // minimal fallback: show character name and abilities
    const d = computeGeneralDerivedLocal(g);
    const abilities = ['str','dex','con','int','wis','cha'];
    const rows = abilities.map(a => `<div>${a.toUpperCase()}: ${g.abilities?.[a]?.pointBuy||0} / total ${d.abilities[a].total}</div>`).join('');
    if (el.app) el.app.innerHTML = `<div class="panel"><h2>${g.characterName||'Unnamed'}</h2>${rows}</div>`;
  }
}

/* ------------------------------ Wiring ------------------------------- */
if (el.viewGeneral) el.viewGeneral.addEventListener('click', () => { state.view = 'General'; ensureModulesAndRender(); }, { passive: true });
if (el.viewSpells) el.viewSpells.addEventListener('click', () => { state.view = 'Spells'; ensureModulesAndRender(); }, { passive: true });
if (el.viewSlots) el.viewSlots.addEventListener('click', () => { state.view = 'Slots'; ensureModulesAndRender(); }, { passive: true });
if (el.viewSkills) el.viewSkills.addEventListener('click', () => { state.view = 'Skills'; ensureModulesAndRender(); }, { passive: true });

if (el.zoomOut) el.zoomOut.addEventListener('click', () => setZoom(state.zoom / 1.15), { passive: true });
if (el.zoomIn) el.zoomIn.addEventListener('click', () => setZoom(state.zoom * 1.15), { passive: true });
if (el.zoomReset) el.zoomReset.addEventListener('click', () => resetView(), { passive: true });

if (el.penToggle) {
  el.penToggle.addEventListener('click', () => {
    state.penOn = !state.penOn;
    if (window.__ink && typeof window.__ink.setPenMode === 'function') window.__ink.setPenMode(state.penOn);
    else if (el.ink) el.ink.style.pointerEvents = state.penOn ? 'auto' : 'none';
  }, { passive: true });
}
if (el.eraser) el.eraser.addEventListener('click', () => { state.erasing = !state.erasing; if (window.__ink && window.__ink.setEraser) window.__ink.setEraser(state.erasing); }, { passive: true });
if (el.undo) el.undo.addEventListener('click', () => { if (window.__ink && window.__ink.undo) window.__ink.undo(); }, { passive: true });
if (el.clearInk) el.clearInk.addEventListener('click', () => { if (window.__ink && window.__ink.clear) window.__ink.clear(); }, { passive: true });

/* ------------------------------ Google Sheets loader wiring ---------- */
if (el.loadGs && el.gsUrl) {
  el.loadGs.addEventListener('click', async () => {
    const url = el.gsUrl.value && el.gsUrl.value.trim();
    if (!url) { setProgress(0, 'Paste a Google Sheets URL first.'); return; }
    if (!ingestModule) await loadModules();
    if (ingestModule && typeof ingestModule.loadFromGoogleSheets === 'function') {
      const res = await ingestModule.loadFromGoogleSheets(url, state, ensureModulesAndRender, setProgress);
      if (!res.ok) console.warn('Ingest failed', res);
    } else {
      setProgress(0, 'Ingest module not available.');
    }
  }, { passive: true });
}

/* ------------------------------ File upload (XLSX) -------------------- */
if (el.file) {
  el.file.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      setProgress(5, 'Reading file...');
      const buf = await f.arrayBuffer();
      setProgress(20, 'Parsing workbook...');
      if (typeof XLSX === 'undefined') throw new Error('XLSX library not loaded');
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets['General'] || wb.Sheets['General info'] || wb.Sheets['GeneralInfo'];
      if (ws) {
        const csv = XLSX.utils.sheet_to_csv(ws);
        // parse and apply
        const rows = (await import('./src/utils.js')).parseCsv(csv);
        const objs = (await import('./src/utils.js')).csvRowsToObjects(rows);
        if (objs.length) {
          // apply using ingest module if available
          if (!ingestModule) await loadModules();
          if (ingestModule && typeof ingestModule.applySheetRowToGeneralDetailed === 'function') {
            ingestModule.applySheetRowToGeneralDetailed(objs[0], state, ensureModulesAndRender);
          } else {
            // fallback mapping
            state.data.general = state.data.general || {};
            state.data.general.characterName = objs[0]['Character'] || objs[0]['Name'] || state.data.general.characterName || '';
            ensureModulesAndRender();
          }
        }
      }
      state.loaded = true;
      setProgress(100, 'File loaded');
      ensureModulesAndRender();
    } catch (err) {
      console.error(err);
      setProgress(0, 'XLSX load failed: ' + (err && err.message));
    }
  }, { passive: true });
}

/* ------------------------------ Init & autosave ----------------------- */
(function init() {
  try {
    const raw = localStorage.getItem('sheet:general');
    if (raw) state.data.general = JSON.parse(raw);
  } catch {}

  if (!state.data.general) {
    state.data.general = {
      characterName: 'Unnamed',
      playerName: '',
      xp: '',
      classLine: '',
      race: '',
      classes: { sorc:1, wiz:5, um:2 },
      abilities: {
        str:{pointBuy:10,asi:0,items:0,buffs:0},
        dex:{pointBuy:10,asi:0,items:0,buffs:0},
        con:{pointBuy:10,asi:0,items:0,buffs:0},
        int:{pointBuy:10,asi:0,items:0,buffs:0},
        wis:{pointBuy:10,asi:0,items:0,buffs:0},
        cha:{pointBuy:10,asi:0,items:0,buffs:0}
      },
      ac: { armor:0, shield:0, size:0, natural:0, deflect:0, misc:0, miscTouch:0 },
      buffs: { mageArmor:0, shieldSpell:0 },
      feats: []
    };
  }

  applyWorldTransform();
  if (ink && ink.loadForView) ink.loadForView(state.view);
  ensureModulesAndRender();

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem('sheet:general', JSON.stringify(state.data.general)); } catch {}
    }, 500);
  }
  document.addEventListener('input', scheduleSave, { passive: true });

  // Autofill gsUrl if empty
  try {
    const defaultSheet = 'https://docs.google.com/spreadsheets/d/1P_Vslp-rxiTcntUZVLR2BjJrdeQqdWfPLeigs2Gnx_U/edit?usp=sharing';
    if (el.gsUrl && (!el.gsUrl.value || el.gsUrl.value.trim() === '')) el.gsUrl.value = defaultSheet;
  } catch (e) {}
})();
