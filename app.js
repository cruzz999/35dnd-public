// app.js - simplified, robust single-file implementation
// Features:
// - world pan/zoom with applyWorldTransform()
// - ink canvas aligned to world with preallocated origin margin
// - incremental drawing for responsiveness
// - deferred canvas expansion applied once per stroke (on pointerup)
// - simple persistence hooks (localStorage)
// - small, clear public API and UI bindings

// ---- Element references ----
const el = {
  app: document.getElementById("app"),
  world: document.getElementById("world"),
  ink: document.getElementById("inkWorld"),
  penToggle: document.getElementById("penToggle"),
  eraser: document.getElementById("eraser"),
  undo: document.getElementById("undo"),
  clearInk: document.getElementById("clearInk")
};

// ---- Global state (exposed for debugging) ----
const state = {
  loaded: false,
  view: "General",
  pan: { x: 0, y: 0 },
  zoom: 1,
  penOn: false,
  erasing: false,
  strokesByView: {}
};
window.state = state; // expose for console debugging

// ---- Utility helpers ----
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function now() { return Date.now(); }

// ---- Paper transform (pan/zoom) ----
function applyWorldTransform() {
  if (!el.world) return;
  el.world.style.transformOrigin = "0 0";
  el.world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;

  if (el.ink) {
    el.ink.style.transformOrigin = "0 0";
    const origin = state.canvasOrigin || { x: 0, y: 0 };
    const ox = Number(origin.x) || 0;
    const oy = Number(origin.y) || 0;
    el.ink.style.transform = `translate(${state.pan.x + ox}px, ${state.pan.y + oy}px) scale(${state.zoom})`;
    el.ink.style.left = "0px";
    el.ink.style.top = "0px";
  }
}

// ---- Ink layer implementation ----
const ink = (() => {
  const canvas = el.ink;
  const ctx = canvas ? canvas.getContext("2d") : null;

  // Preallocate margin so world origin is centered inside a large canvas
  const PREALLOC_MARGIN = 2000; // CSS pixels
  let canvasOrigin = { x: PREALLOC_MARGIN, y: PREALLOC_MARGIN };
  state.canvasOrigin = canvasOrigin;

  // Max canvas CSS size to avoid runaway memory
  const MAX_CANVAS_CSS = 12000;

  // Ensure canvas element exists and has sane defaults
  if (canvas) {
    canvas.style.position = canvas.style.position || "absolute";
    canvas.style.left = canvas.style.left || "0px";
    canvas.style.top = canvas.style.top || "0px";
    canvas.style.pointerEvents = "none"; // toggled by setPenMode
    canvas.style.touchAction = "none";
    canvas.style.zIndex = canvas.style.zIndex || "20";
    canvas.style.display = canvas.style.display || "block";
  }

  // Backing store sizing helpers
  function getCssSize() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = parseFloat(canvas.style.width) || (canvas.width / dpr) || 0;
    const cssH = parseFloat(canvas.style.height) || (canvas.height / dpr) || 0;
    return { cssW, cssH, dpr };
  }

  // Ensure canvas is at least app area + margins; never shrink
  function ensureCanvasSize() {
    if (!canvas || !ctx) return;
    const minW = Math.max(el.app?.scrollWidth || 0, 1200);
    const minH = Math.max(el.app?.scrollHeight || 0, 800);
    const { cssW, cssH, dpr } = getCssSize();

    const targetCssW = Math.max(cssW, minW + PREALLOC_MARGIN * 2);
    const targetCssH = Math.max(cssH, minH + PREALLOC_MARGIN * 2);

    if (Math.floor(canvas.width) === Math.floor(targetCssW * dpr) &&
        Math.floor(canvas.height) === Math.floor(targetCssH * dpr)) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvas.style.touchAction = "none";
      return;
    }

    const oldW = canvas.width || 1;
    const oldH = canvas.height || 1;
    const oldCssW = cssW || (oldW / dpr);
    const oldCssH = cssH || (oldH / dpr);

    const off = document.createElement("canvas");
    off.width = oldW;
    off.height = oldH;
    const offCtx = off.getContext("2d");
    if (oldW && oldH) offCtx.drawImage(canvas, 0, 0);

    canvas.style.width = `${Math.min(MAX_CANVAS_CSS, targetCssW)}px`;
    canvas.style.height = `${Math.min(MAX_CANVAS_CSS, targetCssH)}px`;
    canvas.width = Math.floor(Math.min(MAX_CANVAS_CSS, targetCssW) * dpr);
    canvas.height = Math.floor(Math.min(MAX_CANVAS_CSS, targetCssH) * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (oldW && oldH) {
      ctx.drawImage(off, 0, 0, oldW, oldH, Math.floor(canvasOrigin.x * dpr), Math.floor(canvasOrigin.y * dpr), Math.floor(oldCssW * dpr), Math.floor(oldCssH * dpr));
    }
    canvas.style.touchAction = "none";
  }

  // Convert world coords -> CSS canvas coords (canvas DOM is translated by pan+origin)
  function worldToCanvasCss(worldX, worldY) {
    const vx = worldX * state.zoom;
    const vy = worldY * state.zoom;
    return { x: vx - canvasOrigin.x, y: vy - canvasOrigin.y };
  }

  // Convert client coords -> world coords
  function screenToWorld(clientX, clientY) {
    if (!el.viewport && !el.world) {
      // fallback: assume world at 0,0
      return { x: clientX / state.zoom, y: clientY / state.zoom };
    }
    const vr = el.world.getBoundingClientRect();
    const vx = clientX - vr.left;
    const vy = clientY - vr.top;
    return { x: (vx - state.pan.x) / state.zoom, y: (vy - state.pan.y) / state.zoom };
  }

  // Stroke storage helpers
  function getStrokesForView(view) {
    state.strokesByView[view] ||= [];
    return state.strokesByView[view];
  }

  function saveForView(view) {
    try {
      localStorage.setItem(`ink:${view}`, JSON.stringify(getStrokesForView(view)));
    } catch (e) {
      console.warn("saveForView failed", e);
    }
  }

  function loadForView(view) {
    try {
      const raw = localStorage.getItem(`ink:${view}`);
      state.strokesByView[view] = raw ? JSON.parse(raw) : [];
    } catch {
      state.strokesByView[view] = [];
    }
    fullRedrawNow();
  }

  // Drawing primitives
  function drawStrokeSegment(prevCss, nextCss, stroke) {
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
    ctx.moveTo(prevCss.x, prevCss.y);
    ctx.lineTo(nextCss.x, nextCss.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawStrokeFullConverted(s) {
    if (!ctx) return;
    const pts = (s.pts || []).map(p => worldToCanvasCss(p.x, p.y));
    if (pts.length < 2) return;
    ctx.save();
    if (s.erase) {
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

  // Full redraw (synchronous)
  function fullRedrawNow() {
    if (!canvas || !ctx) return;
    ensureCanvasSize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const strokes = getStrokesForView(state.view);
    for (const s of strokes) drawStrokeFullConverted(s);
  }

  // Incremental drawing state
  let drawing = false;
  let currentStroke = null;
  let activePointerId = null;
  let pendingExpansion = null; // { minX, minY, maxX, maxY } in CSS coords

  // Pointer handlers
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
    // draw initial dot
    drawStrokeSegment(cssStart, cssStart, currentStroke);

    // record pending expansion if outside
    const { cssW, cssH } = getCssSize();
    if (cssStart.x < 0 || cssStart.y < 0 || cssStart.x > cssW || cssStart.y > cssH) {
      pendingExpansion = {
        minX: Math.min(0, cssStart.x),
        minY: Math.min(0, cssStart.y),
        maxX: Math.max(cssW, cssStart.x),
        maxY: Math.max(cssH, cssStart.y)
      };
    } else {
      pendingExpansion = null;
    }

    try { canvas.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  }

  function pointerMove(e) {
    if (!state.penOn || !drawing || !currentStroke) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    if (e.pointerType === "touch") return;

    const pWorld = screenToWorld(e.clientX, e.clientY);
    const last = currentStroke.pts[currentStroke.pts.length - 1];
    const dx = pWorld.x - last.x;
    const dy = pWorld.y - last.y;
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
      const clippedPrev = { x: clamp(prevCss.x, 0, cssW), y: clamp(prevCss.y, 0, cssH) };
      const clippedNext = { x: clamp(nextCss.x, 0, cssW), y: clamp(nextCss.y, 0, cssH) };
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

    drawing = false;
    currentStroke = null;

    if (canvas && e) {
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }
    activePointerId = null;

    // Apply pending expansion once
    if (pendingExpansion) {
      try {
        const margin = 80;
        const { cssW, cssH, dpr } = getCssSize();
        let newCssW = Math.ceil(Math.min(MAX_CANVAS_CSS, Math.max(pendingExpansion.maxX + margin, cssW)));
        let newCssH = Math.ceil(Math.min(MAX_CANVAS_CSS, Math.max(pendingExpansion.maxY + margin, cssH)));

        // Only grow
        if (newCssW > cssW || newCssH > cssH) {
          const oldW = canvas.width;
          const oldH = canvas.height;
          const oldCssW = cssW;
          const oldCssH = cssH;
          const off = document.createElement("canvas");
          off.width = oldW || 1;
          off.height = oldH || 1;
          const offCtx = off.getContext("2d");
          if (oldW && oldH) offCtx.drawImage(canvas, 0, 0);

          canvas.style.width = `${newCssW}px`;
          canvas.style.height = `${newCssH}px`;
          canvas.width = Math.floor(newCssW * dpr);
          canvas.height = Math.floor(newCssH * dpr);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (oldW && oldH) {
            ctx.drawImage(off, 0, 0, oldW, oldH, Math.floor(canvasOrigin.x * dpr), Math.floor(canvasOrigin.y * dpr), Math.floor(oldCssW * dpr), Math.floor(oldCssH * dpr));
          }
        }
      } catch (err) {
        console.warn("Canvas expansion failed:", err);
      }
      pendingExpansion = null;
    }

    saveForView(state.view);
    fullRedrawNow();
  }

  // Attach listeners
  if (canvas) {
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);
    canvas.addEventListener("lostpointercapture", endStroke);
    canvas.addEventListener("pointerleave", endStroke);
  }

  // Public API
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

  function undo() {
    const s = getStrokesForView(state.view);
    s.pop();
    saveForView(state.view);
    fullRedrawNow();
  }

  function clear() {
    state.strokesByView[state.view] = [];
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    saveForView(state.view);
  }

  // Init sizing and load
  ensureCanvasSize();
  loadForView(state.view);

  return { redraw: fullRedrawNow, loadForView, setPenMode, setEraser, undo, clear };
})();

// ---- UI bindings ----
if (el.penToggle) el.penToggle.onclick = () => ink.setPenMode(!state.penOn);
if (el.eraser) el.eraser.onclick = () => ink.setEraser(!state.erasing);
if (el.undo) el.undo.onclick = () => ink.undo();
if (el.clearInk) el.clearInk.onclick = () => ink.clear();

// ---- Simple pan/zoom controls (example handlers) ----
// These are minimal; your app may have its own controls. They ensure applyWorldTransform is used.
function setPan(x, y) { state.pan.x = x; state.pan.y = y; applyWorldTransform(); }
function setZoom(z) { state.zoom = z; applyWorldTransform(); }

// Example: wheel to zoom centered on cursor (basic)
if (el.world) {
  el.world.addEventListener("wheel", (ev) => {
    if (ev.ctrlKey) {
      ev.preventDefault();
      const delta = -ev.deltaY * 0.001;
      const newZoom = clamp(state.zoom * (1 + delta), 0.2, 4);
      state.zoom = newZoom;
      applyWorldTransform();
    }
  }, { passive: false });
}

// Expose small API for debugging
window.appAPI = {
  setPan, setZoom, inkRedraw: ink.redraw, inkLoad: ink.loadForView
};

// Initial transform
applyWorldTransform();
