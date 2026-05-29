/* ========================================================================== 
   DnD 3.5 Ink Sheet (Paper Mode) - app.js
   (This file is the original with a minimal, safe merge:
    - renderGeneral() replaced to produce a five-column .general-grid layout
    - mod wiring and persistence added inside renderGeneral()
    All other logic (ink, sheets, XLSX, persistence) is preserved.)
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
function assertEl(name) { if (!el[name]) console.warn(`Missing element #${name}`); }
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
  data: {
    general: null,
    spells: { sorc: [], wiz: [], meta: null },
  },
};
window.state = state;

/* ------------------------------ Progress ------------------------------- */
function setProgress(pct, text) {
  if (el.progressBar) el.progressBar.style.width = `${pct}%`;
  if (el.status) el.status.textContent = text;
}
function nextFrame() { return new Promise((resolve) => requestAnimationFrame(resolve)); }

/* ---------------------------- Utilities -------------------------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>\\'"]/g, (m) => ({ "&": "&", "<": "<", ">": ">", '"': "&quot;", "'": "&#039;" }[m]));
}
function fmtSign(n) { n = Number(n) || 0; return (n >= 0 ? "+" : "") + n; }
function abilityMod(score) { return Math.floor((Number(score) - 10) / 2); }
function babPoor(level) { level = Number(level) || 0; return Math.floor(level / 2); }
function saveGood(level) { level = Number(level) || 0; return 2 + Math.floor(level / 2); }
function savePoor(level) { level = Number(level) || 0; return Math.floor(level / 3); }
function totalLevel(classes) { return (Number(classes.sorc) || 0) + (Number(classes.wiz) || 0) + (Number(classes.um) || 0); }
function hpAverageD4(totalLvl) { totalLvl = Number(totalLvl) || 0; if (totalLvl <= 0) return 0; return 4 + (totalLvl - 1) * 3; }

/* -------------------- Viewport height sync (topbar wrap) --------------- */
function syncViewportHeight() {
  const topbar = document.querySelector(".topbar");
  const h = topbar ? topbar.getBoundingClientRect().height : 64;
  if (el.viewport) el.viewport.style.height = `calc(100vh - ${h}px)`;
}
window.addEventListener("resize", () => { syncViewportHeight(); applyWorldTransform(); if (ink && ink.redraw) ink.redraw(); });
syncViewportHeight();

/* -------------------- Paper transform (pan/zoom) ----------------------- */
function applyWorldTransform() {
  if (!el.world) return;
  el.world.style.transformOrigin = "0 0";
  el.world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  if (el.ink) {
    el.ink.style.transformOrigin = "0 0";
    const origin = (state && state.canvasOrigin) ? state.canvasOrigin : { x: 0, y: 0 };
    const ox = Number(origin.x) || 0;
    const oy = Number(origin.y) || 0;
    el.ink.style.transform = `translate(${state.pan.x + ox}px, ${state.pan.y + oy}px) scale(${state.zoom})`;
    el.ink.style.left = "0px";
    el.ink.style.top = "0px";
  }
}
function clampZoom(z) { return Math.max(0.5, Math.min(3.0, z)); }
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
  if (ink && ink.redraw) ink.redraw();
}
function resetView() { state.zoom = 1.0; state.pan.x = 20; state.pan.y = 20; applyWorldTransform(); if (ink && ink.redraw) ink.redraw(); }

/* --------------------------- View routing ------------------------------ */
function setView(viewName) {
  state.view = viewName;
  setProgress(1, `View: ${viewName}`);
  try {
    render();
    if (ink && ink.loadForView) ink.loadForView(viewName);
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

/* ----------------------------- Pan mode -------------------------------- */
let panDrag = { active: false, startX: 0, startY: 0, basePanX: 0, basePanY: 0 };
function beginPan(e) { panDrag.active = true; panDrag.startX = e.clientX; panDrag.startY = e.clientY; panDrag.basePanX = state.pan.x; panDrag.basePanY = state.pan.y; }
function movePan(e) { if (!panDrag.active) return; const dx = e.clientX - panDrag.startX; const dy = e.clientY - panDrag.startY; state.pan.x = panDrag.basePanX + dx; state.pan.y = panDrag.basePanY + dy; applyWorldTransform(); if (ink && ink.redraw) ink.redraw(); }
function endPan() { panDrag.active = false; }
if (el.viewport) {
  el.viewport.addEventListener("pointerdown", (e) => { if (state.penOn) return; beginPan(e); el.viewport.setPointerCapture?.(e.pointerId); });
  el.viewport.addEventListener("pointermove", (e) => movePan(e));
  el.viewport.addEventListener("pointerup", endPan);
  el.viewport.addEventListener("pointercancel", endPan);
}

/* ------------------------------ Ink layer ------------------------------ */
/* (Original ink implementation preserved; safe cssRules wrapper applied earlier in your environment) */
const ink = (() => {
  // Preallocate a safe drawing origin so canvas and world math stay aligned
  const PREALLOC_MARGIN = 2000;
  let canvasOrigin = { x: PREALLOC_MARGIN, y: PREALLOC_MARGIN };
  state.canvasOrigin = canvasOrigin;
  const canvas = el.ink;
  const ctx = canvas ? canvas.getContext("2d") : null;

  if (canvas) {
    canvas.style.position = canvas.style.position || "absolute";
    canvas.style.left = canvas.style.left || "0px";
    canvas.style.top = canvas.style.top || "0px";
    const initialW = Math.max(el.app?.scrollWidth || 1200, 1200) + PREALLOC_MARGIN * 2;
    const initialH = Math.max(el.app?.scrollHeight || 800, 800) + PREALLOC_MARGIN * 2;
    canvas.style.width = canvas.style.width || `${initialW}px`;
    canvas.style.height = canvas.style.height || `${initialH}px`;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.width || Math.floor(initialW * dpr);
    canvas.height = canvas.height || Math.floor(initialH * dpr);
    ctx && ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas.style.pointerEvents = "none";
    canvas.style.touchAction = "none";
    canvas.style.zIndex = canvas.style.zIndex || "20";
    canvas.style.display = canvas.style.display || "block";
  }

  function getStrokesForView(view) { state.strokesByView[view] ||= []; return state.strokesByView[view]; }
  function saveForView(view) { try { localStorage.setItem(`ink:${view}`, JSON.stringify(getStrokesForView(view))); } catch {} }
  function loadForView(view) { try { const raw = localStorage.getItem(`ink:${view}`); state.strokesByView[view] = raw ? JSON.parse(raw) : []; } catch { state.strokesByView[view] = []; } scheduleFullRedraw(); }

  function worldToCanvasCss(worldX, worldY) {
    const vx = worldX * state.zoom;
    const vy = worldY * state.zoom;
    return { x: vx - canvasOrigin.x, y: vy - canvasOrigin.y };
  }
  function screenToWorld(clientX, clientY) {
    if (!el.viewport) return { x: 0, y: 0 };
    const vr = el.viewport.getBoundingClientRect();
    const vx = clientX - vr.left;
    const vy = clientY - vr.top;
    return { x: (vx - state.pan.x) / state.zoom, y: (vy - state.pan.y) / state.zoom };
  }

  function drawStrokeSegment(prev, next, stroke) {
    if (!ctx) return;
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
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    ctx.restore();
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
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function getCssSize() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = parseFloat(canvas.style.width) || (canvas.width / dpr) || 0;
    const cssH = parseFloat(canvas.style.height) || (canvas.height / dpr) || 0;
    return { cssW, cssH, dpr };
  }

  function expandCanvasToIncludePoint(cssX, cssY) {
    if (!canvas || !ctx) return;
    const { cssW, cssH, dpr } = getCssSize();
    const MARGIN = 80;
    let leftExpand = 0, rightExpand = 0, topExpand = 0, bottomExpand = 0;
    if (cssX < MARGIN) leftExpand = Math.ceil(MARGIN - cssX);
    else if (cssX > cssW - MARGIN) rightExpand = Math.ceil(cssX - (cssW - MARGIN));
    if (cssY < MARGIN) topExpand = Math.ceil(MARGIN - cssY);
    else if (cssY > cssH - MARGIN) bottomExpand = Math.ceil(cssY - (cssH - MARGIN));
    if (!leftExpand && !rightExpand && !topExpand && !bottomExpand) return;
    const newCssW = Math.min(10000, Math.max(cssW + leftExpand + rightExpand, Math.ceil(cssX + MARGIN)));
    const newCssH = Math.min(10000, Math.max(cssH + topExpand + bottomExpand, Math.ceil(cssY + MARGIN)));
    const oldW = canvas.width; const oldH = canvas.height;
    const oldCssW = cssW; const oldCssH = cssH;
    const off = document.createElement("canvas");
    off.width = oldW || 1; off.height = oldH || 1;
    const offCtx = off.getContext("2d");
    if (oldW && oldH) offCtx.drawImage(canvas, 0, 0);
    canvasOrigin.x += leftExpand; canvasOrigin.y += topExpand; state.canvasOrigin = canvasOrigin;
    canvas.style.width = `${newCssW}px`; canvas.style.height = `${newCssH}px`;
    canvas.width = Math.floor(newCssW * dpr); canvas.height = Math.floor(newCssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (oldW && oldH) {
      ctx.drawImage(off, 0, 0, oldW, oldH, Math.floor(canvasOrigin.x), Math.floor(canvasOrigin.y), Math.floor(oldCssW * dpr), Math.floor(oldCssH * dpr));
    }
  }

  function ensureCanvasSize() {
    if (!canvas || !ctx) return;
    const minW = Math.max(el.app?.scrollWidth || 0, 1200);
    const minH = Math.max(el.app?.scrollHeight || 0, 800);
    const { cssW, cssH, dpr } = getCssSize();
    const targetCssW = Math.max(cssW, minW + PREALLOC_MARGIN * 2);
    const targetCssH = Math.max(cssH, minH + PREALLOC_MARGIN * 2);
    if (Math.floor(canvas.width) === Math.floor(targetCssW * dpr) && Math.floor(canvas.height) === Math.floor(targetCssH * dpr)) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvas.style.touchAction = "none";
      return;
    }
    const oldW = canvas.width; const oldH = canvas.height;
    const oldCssW = cssW || (oldW / dpr); const oldCssH = cssH || (oldH / dpr);
    const off = document.createElement("canvas");
    off.width = oldW || 1; off.height = oldH || 1;
    const offCtx = off.getContext("2d");
    if (oldW && oldH) offCtx.drawImage(canvas, 0, 0);
    canvas.style.width = `${targetCssW}px`; canvas.style.height = `${targetCssH}px`;
    canvas.width = Math.floor(targetCssW * dpr); canvas.height = Math.floor(targetCssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (oldW && oldH) {
      ctx.drawImage(off, 0, 0, oldW, oldH, Math.floor(canvasOrigin.x), Math.floor(canvasOrigin.y), Math.floor(oldCssW * dpr), Math.floor(oldCssH * dpr));
    }
    canvas.style.touchAction = "none";
  }

  let needsFullRedraw = false; let rafId = null;
  function scheduleFullRedraw() {
    needsFullRedraw = true;
    if (rafId == null) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (needsFullRedraw) {
          if (!canvas || !ctx) return;
          ensureCanvasSize();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const strokes = getStrokesForView(state.view);
          for (const s of strokes) {
            const pts = (s.pts || []).map(p => {
              const css = worldToCanvasCss(p.x, p.y);
              return { x: css.x, y: css.y };
            });
            if (pts.length < 2) continue;
            drawStroke({ ...s, pts });
          }
          needsFullRedraw = false;
        }
      });
    }
  }

  function clear() { state.strokesByView[state.view] = []; if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); saveForView(state.view); }
  function undo() { const s = getStrokesForView(state.view); s.pop(); saveForView(state.view); scheduleFullRedraw(); }

  let drawing = false; let currentStroke = null; let activePointerId = null;
  const MAX_CANVAS_CSS = 10000;
  let pendingExpansion = null;

  function pointerDown(e) {
    if (!state.penOn || !canvas) return;
    if (e.pointerType === "touch") return;
    ensureCanvasSize();
    drawing = true;
    activePointerId = e.pointerId;
    const pWorld = screenToWorld(e.clientX, e.clientY);
    currentStroke = { erase: state.erasing, pts: [pWorld] };
    getStrokesForView(state.view).push(currentStroke);
    const cssStart = worldToCanvasCss(pWorld.x, pWorld.y);
    drawStrokeSegment(cssStart, cssStart, currentStroke);
    const { cssW, cssH } = getCssSize();
    if (cssStart.x < 0 || cssStart.y < 0 || cssStart.x > cssW || cssStart.y > cssH) {
      pendingExpansion = { minX: Math.min(0, cssStart.x), minY: Math.min(0, cssStart.y), maxX: Math.max(cssW, cssStart.x), maxY: Math.max(cssH, cssStart.y) };
    } else { pendingExpansion = null; }
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  }

  function pointerMove(e) {
    if (!state.penOn || !drawing || !currentStroke) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    if (e.pointerType === "touch") return;
    const pWorld = screenToWorld(e.clientX, e.clientY);
    const last = currentStroke.pts[currentStroke.pts.length - 1];
    const dx = pWorld.x - last.x; const dy = pWorld.y - last.y;
    if ((dx * dx + dy * dy) < 0.0004) return;
    const prevCss = worldToCanvasCss(last.x, last.y);
    const nextCss = worldToCanvasCss(pWorld.x, pWorld.y);
    const { cssW, cssH } = getCssSize();
    if (nextCss.x < 0 || nextCss.y < 0 || nextCss.x > cssW || nextCss.y > cssH) {
      if (!pendingExpansion) {
        pendingExpansion = { minX: Math.min(0, nextCss.x), minY: Math.min(0, nextCss.y), maxX: Math.max(cssW, nextCss.x), maxY: Math.max(cssH, nextCss.y) };
      } else {
        pendingExpansion.minX = Math.min(pendingExpansion.minX, nextCss.x);
        pendingExpansion.minY = Math.min(pendingExpansion.minY, nextCss.y);
        pendingExpansion.maxX = Math.max(pendingExpansion.maxX, nextCss.x);
        pendingExpansion.maxY = Math.max(pendingExpansion.maxY, nextCss.y);
      }
      const clippedPrev = { x: Math.max(0, Math.min(cssW, prevCss.x)), y: Math.max(0, Math.min(cssH, prevCss.y)) };
      const clippedNext = { x: Math.max(0, Math.min(cssW, nextCss.x)), y: Math.max(0, Math.min(cssH, nextCss.y)) };
      drawStrokeSegment(clippedPrev, clippedNext, currentStroke);
    } else {
      drawStrokeSegment(prevCss, nextCss, currentStroke);
    }
    currentStroke.pts.push(pWorld);
    e.preventDefault();
  }

  function endStroke(e) {
    if (!state.penOn) return;
    if (e && activePointerId !== null && e.pointerId !== activePointerId) return;
    drawing = false; currentStroke = null;
    if (canvas && e) { try { canvas.releasePointerCapture(e.pointerId); } catch {} }
    activePointerId = null;
    if (pendingExpansion) {
      try {
        const margin = 80;
        const { cssW: curCssW, cssH: curCssH, dpr } = getCssSize();
        let newCssW = Math.ceil(Math.min(MAX_CANVAS_CSS, Math.max(pendingExpansion.maxX + margin, curCssW)));
        let newCssH = Math.ceil(Math.min(MAX_CANVAS_CSS, Math.max(pendingExpansion.maxY + margin, curCssH)));
        pendingExpansion = null;
        if (newCssW > curCssW || newCssH > curCssH) {
          const oldW = canvas.width; const oldH = canvas.height;
          const oldCssW = curCssW; const oldCssH = curCssH;
          const off = document.createElement("canvas");
          off.width = oldW || 1; off.height = oldH || 1;
          const offCtx = off.getContext("2d");
          if (oldW && oldH) offCtx.drawImage(canvas, 0, 0);
          canvas.style.width = `${newCssW}px`; canvas.style.height = `${newCssH}px`;
          canvas.width = Math.floor(newCssW * dpr); canvas.height = Math.floor(newCssH * dpr);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (oldW && oldH) {
            ctx.drawImage(off, 0, 0, oldW, oldH, Math.floor(canvasOrigin.x), Math.floor(canvasOrigin.y), Math.floor(oldCssW * dpr), Math.floor(oldCssH * dpr));
          }
        }
      } catch (err) { console.warn("Canvas expansion failed, skipping:", err); pendingExpansion = null; }
    }
    saveForView(state.view); scheduleFullRedraw();
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
    if (canvas) { canvas.style.pointerEvents = state.penOn ? "auto" : "none"; canvas.style.zIndex = state.penOn ? "29999" : "20"; }
    if (!state.penOn) { drawing = false; currentStroke = null; activePointerId = null; }
  }
  function setEraser(on) { state.erasing = !!on; if (el.eraser) el.eraser.textContent = state.erasing ? "Eraser: ON" : "Eraser"; }
  if (el.penToggle) el.penToggle.onclick = () => setPenMode(!state.penOn);
  if (el.eraser) el.eraser.onclick = () => setEraser(!state.erasing);
  if (el.undo) el.undo.onclick = () => undo();
  if (el.clearInk) el.clearInk.onclick = () => clear();
  window.addEventListener("resize", () => { ensureCanvasSize(); scheduleFullRedraw(); });
  ensureCanvasSize(); scheduleFullRedraw();
  return { redraw: scheduleFullRedraw, loadForView, setPenMode, setEraser };
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
  const saves = { fort: fortBase + abilities.con.mod + (Number(g.saves.fortMisc)||0), ref: refBase + abilities.dex.mod + (Number(g.saves.refMisc)||0), will: willBase + abilities.wis.mod + (Number(g.saves.willMisc)||0) };
  const init = abilities.dex.mod + (Number(g.initMisc)||0);
  const melee = bab + abilities.str.mod + (Number(g.attacks.meleeMisc)||0);
  const ranged = bab + abilities.dex.mod + (Number(g.attacks.rangedMisc)||0);
  return { lvl, abilities, hpMax, acTotal, touch, flat, bab, saves, init, melee, ranged };
}

/* ---------------------- Google Sheets ingest (CSV) ---------------------- */
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
    const gids = { spells: 0, general: 2004670713, slot: 1231385124, skills: 2140364605 };
    setProgress(5, "Fetching Spells…");
    const spellsGrid = csvToGrid(await fetchCsvViaProxy(id, gids.spells));
    setProgress(30, "Fetching General…");
    const generalGrid = csvToGrid(await fetchCsvViaProxy(id, gids.general));
    ingestSpellsFromGrid(spellsGrid);
    ingestGeneralFromGrid(generalGrid);
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

/* ------------------------------ Grid ingest helpers ------------------------------ */
function ingestGeneralFromGrid(grid) {
  const cell = (r, c) => (grid[r] && grid[r][c] != null) ? String(grid[r][c]) : "";
  const num = (v, fb = 0) => {
    const s = String(v ?? "").trim().replace(",", ".");
    const m = s.match(/-?\d+(\.\d+)?/);
    if (!m) return fb;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : fb;
  };
  const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, "").replace(/[^\p{L}\p{N}]/gu, "");
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
    for (let c = 0; c < row.length; c++) if (norm(row[c]) === targetNorm) return c;
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

/* ------------------------------ Spells ingest --------------------------- */
function ingestSpellsFromGrid(grid) {
  const cell = (r, c) => (grid[r] && grid[r][c] != null) ? String(grid[r][c]) : "";
  const num = (s, fb = 0) => { const n = Number(String(s).replace(",", ".")); return Number.isFinite(n) ? n : fb; };
  const findRowContaining = (text) => grid.findIndex(row => (row || []).some(v => String(v).trim() === text));
  const sorcHeader = findRowContaining("Spell slots (S)");
  const wizHeader = findRowContaining("Spell slots (W)");
  function headerMap(rowIdx) {
    const row = grid[rowIdx] || []; const map = {};
    for (let c = 0; c < row.length; c++) { const key = String(row[c] ?? "").trim(); if (key) map[key] = c; }
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
    const colSL = h["SL"]; const colType = h["Type"]; const colEvo = h["Evo?"]; const colFire = h["Fire?"];
    const colRange = h["Range"]; const colArea = h["Area"]; const colDamage = h["Damage"]; const colDuration = h["Duration"];
    const colNotes = h["Notes"]; const colPrep = h["Preparations"];
    const preferredSpellCol = h["Sorcerer"] ?? h["Wizard"] ?? h[" Wizard"] ?? h["Spell"] ?? null;
    const colSpell = findSpellColByScanning(headerRow, preferredSpellCol);
    const rows = [];
    for (let r = headerRow + 1; r < grid.length; r++) {
      const name = cell(r, colSpell).trim();
      if (!name) break;
      rows.push({
        mode, name, url: "",
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

/* ------------------------------ Spells from XLSX ----------------------- */
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
    const col = {
      prep: header["Preparations"],
      spell: header["Sorcerer"] ?? header["Wizard"],
      sl: header["SL"], type: header["Type"], evo: header["Evo?"], fire: header["Fire?"],
      range: header["Range"], area: header["Area"], damage: header["Damage"], duration: header["Duration"], notes: header["Notes"]
    };
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
        mode, name, url: "", sl: num(col.sl), type: String(get(col.type)||""), evo: num(col.evo) === 1, fire: num(col.fire) === 1,
        range: String(get(col.range)||""), area: String(get(col.area)||""), damage: String(get(col.damage)||""), duration: String(get(col.duration)||""), notes: String(get(col.notes)||""), prep: mode === "wiz" ? String(get(col.prep)||"") : ""
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

/* ------------------------------
   REPLACED: renderGeneral()
   This implementation renders a five-column .general-grid and wires inputs.
   It preserves the rest of your app's state/data model and calls ink.redraw()
   where appropriate. This is the minimal merge requested.
   ------------------------------ */
function renderGeneral() {
  const g = state.data.general;
  if (!g) {
    if (el.app) el.app.innerHTML = `<div class="panel"><h2>General</h2><div class="hint">No general data loaded.</div></div>`;
    return;
  }

  // Defensive defaults
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

  // Build five-column grid HTML
  const abilities = ['str','dex','con','int','wis','cha'];
  const rowsHtml = abilities.map(a => {
    const totalVal = g.abilities[a].pointBuy + (g.abilities[a].asi || 0) + (g.abilities[a].items || 0) + (g.abilities[a].buffs || 0);
    // Keep inputs bound to IDs expected elsewhere
    return `
      <div class="ability-name">${a.toUpperCase()}</div>

      <div class="ability-cell total">
        <input id="${a}_total" name="${a}_total" type="number" inputmode="numeric" value="${Number(totalVal)}" />
      </div>

      <div class="ability-cell mod">
        <input id="${a}_mod" name="${a}_mod" type="text" readonly value="${(A[a] && A[a].mod != null) ? (A[a].mod >= 0 ? '+' + A[a].mod : String(A[a].mod)) : ''}" />
      </div>

      <div class="ability-cell buffs">
        <input id="${a}_buffs" name="${a}_buffs" type="text" value="${String(g.abilities[a].buffs || '')}" />
      </div>

      <div class="ability-cell asi">
        <input id="${a}_asi" name="${a}_asi" type="number" value="${Number(g.abilities[a].asi || 0)}" />
      </div>
    `;
  }).join('');

  const html = `
    <section id="generalView" class="sheet">
      <h1>General</h1>

      <div class="general-grid" id="abilitiesGrid">
        <div class="header">Ability</div>
        <div class="header">Total</div>
        <div class="header">Mod</div>
        <div class="header">Buffs</div>
        <div class="header">ASI</div>

        ${rowsHtml}
      </div>

      <div class="hr-subtle" style="margin-top:12px;"></div>

      <div class="row" style="margin-top:12px;">
        <div class="col field-group">
          <label for="hp_current">HP</label>
          <div class="kv"><div>Current</div><div><input id="hp_current" type="number" value="${Number(g.hp_current || 0)}" /></div></div>
          <div class="kv"><div>Hit Dice</div><div><input id="hit_dice" type="text" value="${g.hit_dice || '0d4'}" /></div></div>
        </div>

        <div class="col field-group">
          <label for="ac_total">AC</label>
          <div class="kv"><div>Total</div><div><input id="ac_total" type="number" value="${Number(g.ac?.total || d.acTotal || 10)}" /></div></div>
          <div class="kv"><div>Touch</div><div><input id="ac_touch" type="number" value="${Number(g.ac?.touch || d.touch || 10)}" /></div></div>
        </div>
      </div>
    </section>
  `;

  if (el.app) el.app.innerHTML = html;

  // Ensure grid class exists
  const grid = $('abilitiesGrid');
  if (grid && !grid.classList.contains('general-grid')) grid.classList.add('general-grid');

  // Wire mod calculation and persistence
  function computeAbilityMod(score) { const n = Number(score) || 0; return Math.floor((n - 10) / 2); }
  function updateModsForAll() {
    abilities.forEach(a => {
      const totalEl = $(`${a}_total`);
      const modEl = $(`${a}_mod`);
      if (!totalEl || !modEl) return;
      const m = computeAbilityMod(totalEl.value);
      modEl.value = (m >= 0 ? '+' : '') + m;
    });
  }
  function persistAbility(a) {
    if (!state.data.general) state.data.general = g;
    const totalEl = $(`${a}_total`);
    const asiEl = $(`${a}_asi`);
    const buffsEl = $(`${a}_buffs`);
    if (totalEl) {
      // We store breakdown into g.abilities: try to infer pointBuy/items if possible.
      // For safety, store total into a convenience field as well.
      g.abilities[a].total = Number(totalEl.value) || 0;
    }
    if (asiEl) g.abilities[a].asi = Number(asiEl.value) || 0;
    if (buffsEl) g.abilities[a].buffs = Number(buffsEl.value) || 0;
  }

  // Add listeners
  abilities.forEach(a => {
    const totalEl = $(`${a}_total`);
    const asiEl = $(`${a}_asi`);
    const buffsEl = $(`${a}_buffs`);
    [totalEl, asiEl, buffsEl].forEach(elm => {
      if (!elm) return;
      elm.addEventListener('input', () => {
        // If you want total to auto-sum pointBuy + ASI + items + buffs, implement here.
        updateModsForAll();
        persistAbility(a);
      }, { passive: true });
    });
  });

  // Derived fields persistence
  const hpEl = $('hp_current'), hdEl = $('hit_dice'), acEl = $('ac_total'), actEl = $('ac_touch');
  if (hpEl) hpEl.addEventListener('input', () => { g.hp_current = Number(hpEl.value) || 0; }, { passive: true });
  if (hdEl) hdEl.addEventListener('input', () => { g.hit_dice = hdEl.value || '0d4'; }, { passive: true });
  if (acEl) acEl.addEventListener('input', () => { g.ac.total = Number(acEl.value) || d.acTotal; }, { passive: true });
  if (actEl) actEl.addEventListener('input', () => { g.ac.touch = Number(actEl.value) || d.touch; }, { passive: true });

  // Initial compute
  updateModsForAll();

  // Ensure ink redraw to keep canvas in sync
  if (ink && ink.redraw) ink.redraw();
}

/* ------------------------------ Spell rendering ------------------------------ */
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
  if (el.app) el.app.innerHTML = `
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

/* ------------------------------ Main render ------------------------------ */
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
    if (ink && ink.redraw) ink.redraw();
    return;
  }
  if (state.view === "General") renderGeneral();
  else if (state.view === "Spells") renderSpells();
  else el.app.innerHTML = `<div class="panel"><h2>${escapeHtml(state.view)}</h2><div class="hint">Not implemented yet.</div></div>`;
  applyWorldTransform();
  if (ink && ink.redraw) ink.redraw();
}

/* --------------------------- Persistence & slots ------------------------- */
(async function initPersistenceAndSlots() {
  try {
    const db = await openDb();
    const persisted = await idbGetAll(db, 'slots');
    if (Array.isArray(persisted)) {
      for (const s of persisted) slotsModel.byId[s.id] = s;
    }
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
  } catch (err) { console.warn("Could not initialize persistence:", err); }
})();

/* --------------------------- XLSX loading ------------------------------ */
if (el.file) {
  el.file.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setProgress(5, "Reading file…"); await nextFrame();
      const buf = await file.arrayBuffer();
      setProgress(20, "Parsing workbook…"); await nextFrame();
      if (typeof XLSX === "undefined") throw new Error("XLSX library not loaded (xlsx.full.min.js)");
      const wb = XLSX.read(buf, { type: "array" });
      setProgress(45, "Ingesting General…");
      ingestGeneralFromXlsx(wb);
      setProgress(65, "Ingesting Spells…");
      ingestSpellsFromXlsx(wb);
      state.loaded = true;
      setProgress(90, "Rendering…");
      if (ink && ink.loadForView) ink.loadForView(state.view);
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
      } catch (e) { console.error(e); setProgress(0, "Google Sheets load failed (see console)."); }
    });
  } else {
    console.warn("Google Sheets UI not present (#gsUrl / #loadGs).");
  }
});

/* --------------------------- Initial setup ----------------------------- */
applyWorldTransform();
if (ink && ink.loadForView) ink.loadForView(state.view);
render();

/* ========================================================================
   Notes:
   - This file preserves your original app logic and replaces only renderGeneral()
     with a five-column grid implementation that wires inputs and updates state.
   - If you want the total input to be auto-calculated from pointBuy + ASI + items + buffs,
     we can add that logic into the input listeners (I left it conservative: total is editable).
   - If you prefer total to be read-only and computed, tell me and I will change the inputs
     so only pointBuy/asi/items/buffs are editable and total is computed.
   ======================================================================== */
