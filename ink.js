// ink.js
// Drop-in ink layer. Attaches API to window.ink and mirrors the previous inline ink behavior.
(function () {
  if (window.ink) return;

  function getState() {
    if (!window.state) {
      window.state = {
        view: "General",
        pan: { x: 20, y: 20 },
        zoom: 1.0,
        penOn: false,
        erasing: false,
        strokesByView: {}
      };
    }
    window.state.strokesByView = window.state.strokesByView || {};
    return window.state;
  }

  const el = {
    canvas: document.getElementById("inkWorld"),
    app: document.getElementById("app"),
    viewport: document.getElementById("viewport")
  };

  let ctx = el.canvas ? el.canvas.getContext("2d") : null;

  function getStrokesForView(view) {
    const s = getState();
    s.strokesByView[view] ||= [];
    return s.strokesByView[view];
  }

  function saveForView(view) {
    try {
      localStorage.setItem(`ink:${view}`, JSON.stringify(getStrokesForView(view)));
    } catch (e) {
      console.warn("ink save failed", e);
    }
  }

  function loadForView(view) {
    try {
      const raw = localStorage.getItem(`ink:${view}`);
      getState().strokesByView[view] = raw ? JSON.parse(raw) : [];
    } catch (e) {
      getState().strokesByView[view] = [];
    }
    redraw();
  }

 function ensureCanvasSize() {
    const canvas = el.canvas;
    if (!canvas) return;
    const appEl = el.app || document.getElementById("app");
    const worldEl = el.world || document.getElementById("world");
    // Size the canvas to match the app element exactly (so ink overlays the paper)
    const w = Math.max(appEl.offsetWidth || 1200, 1200);
    const h = Math.max(appEl.offsetHeight || 800, 800);
    const dpr = window.devicePixelRatio || 1;

    // Position canvas relative to the world container so it overlays the app
    // appEl.offsetLeft/Top are relative to world content box (no transforms)
    canvas.style.position = "absolute";
    canvas.style.left = `${appEl.offsetLeft}px`;
    canvas.style.top = `${appEl.offsetTop}px`;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    // Set backing store size using devicePixelRatio
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    // Reset transform so drawing uses CSS pixels
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Keep pointer events off by default; app toggles when pen is ON
    canvas.style.pointerEvents = getState().penOn ? "auto" : "none";
    canvas.style.touchAction = "none";
  }

  // Convert client coordinates to coordinates relative to the app (untransformed)
  function screenToWorld(clientX, clientY) {
    // If world has a CSS transform (translate + scale), invert it using DOMMatrix
    const worldEl = el.world || document.getElementById("world");
    const appEl = el.app || document.getElementById("app");
    if (!worldEl || !appEl) return { x: clientX, y: clientY };

    // Get world bounding rect to compute point relative to world origin
    const worldRect = worldEl.getBoundingClientRect();
    const localX = clientX - worldRect.left;
    const localY = clientY - worldRect.top;

    // Get computed transform matrix of the world element
    const style = getComputedStyle(worldEl);
    const transform = style.transform || "none";

    if (transform === "none") {
      // No transform: map directly to world-local coordinates, then to app-local
      const st = getState();
      // world is translated by state.pan and scaled by state.zoom in CSS transform
      // Convert to app-local by reversing translate and scale
      const x = (localX - (st.pan?.x || 0)) / (st.zoom || 1);
      const y = (localY - (st.pan?.y || 0)) / (st.zoom || 1);
      // Now offset by app element position inside world
      const appOffsetX = appEl.offsetLeft || 0;
      const appOffsetY = appEl.offsetTop || 0;
      return { x: x - appOffsetX, y: y - appOffsetY };
    }

    // Use DOMMatrix to invert the transform and map the point back to untransformed coords
    try {
      const matrix = new DOMMatrixReadOnly(transform);
      const inv = matrix.inverse();
      // point relative to world origin
      const pt = new DOMPoint(localX, localY);
      const unmapped = pt.matrixTransform(inv);
      // unmapped is now coordinates in the world element's local coordinate system
      // Convert to coordinates relative to the app element inside world
      const appOffsetX = appEl.offsetLeft || 0;
      const appOffsetY = appEl.offsetTop || 0;
      return { x: unmapped.x - appOffsetX, y: unmapped.y - appOffsetY };
    } catch (err) {
      // Fallback: use state.pan/state.zoom inverse
      const st = getState();
      const x = (localX - (st.pan?.x || 0)) / (st.zoom || 1);
      const y = (localY - (st.pan?.y || 0)) / (st.zoom || 1);
      const appOffsetX = appEl.offsetLeft || 0;
      const appOffsetY = appEl.offsetTop || 0;
      return { x: x - appOffsetX, y: y - appOffsetY };
    }
  }

  function drawStroke(stroke) {
    if (!ctx || !stroke || !stroke.pts || stroke.pts.length < 2) return;
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
    ctx.moveTo(stroke.pts[0].x, stroke.pts[0].y);
    for (let i = 1; i < stroke.pts.length; i++) ctx.lineTo(stroke.pts[i].x, stroke.pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function redraw() {
    const canvas = el.canvas;
    if (!canvas || !ctx) return;
    ensureCanvasSize();
    // clear using device pixels
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = getState();
    const strokes = getStrokesForView(s.view || "General");
    for (const st of strokes) drawStroke(st);
  }

  function clear() {
    const s = getState();
    s.strokesByView[s.view] = [];
    saveForView(s.view);
    redraw();
  }

  function undo() {
    const s = getState();
    const arr = getStrokesForView(s.view);
    arr.pop();
    saveForView(s.view);
    redraw();
  }

  // Pointer drawing state
  let drawing = false;
  let currentStroke = null;
  let activePointerId = null;

  function pointerDown(e) {
    const s = getState();
    if (!s.penOn) return;
    // allow stylus/pointer; ignore touch if you want stylus-only
    // (keep touch support if desired by removing the next line)
    if (e.pointerType === "touch") return;

    // Ensure canvas has correct size/position before starting stroke
    ensureCanvasSize();

    drawing = true;
    activePointerId = e.pointerId;

    // Map the initial point using the robust screenToWorld
    const p = screenToWorld(e.clientX, e.clientY);
    currentStroke = { erase: !!s.erasing, pts: [p] };
    getStrokesForView(s.view).push(currentStroke);

    try { el.canvas.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
    redraw();
  }

  function pointerMove(e) {
    const s = getState();
    if (!s.penOn || !drawing || !currentStroke) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    if (e.pointerType === "touch") return;
    // Map subsequent points the same way
    currentStroke.pts.push(screenToWorld(e.clientX, e.clientY));
    e.preventDefault();
    redraw();
  }

  function endStroke(e) {
    const s = getState();
    if (!s.penOn) return;
    if (e && activePointerId !== null && e.pointerId !== activePointerId) return;
    drawing = false;
    currentStroke = null;
    if (el.canvas && e) {
      try { el.canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    activePointerId = null;
    saveForView(getState().view);
    redraw();
  }

  function attachHandlers() {
    const canvas = el.canvas;
    if (!canvas) return;
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);
    canvas.addEventListener("lostpointercapture", endStroke);
    canvas.addEventListener("pointerleave", endStroke);
    // default off; app toggles when pen is ON
    canvas.style.pointerEvents = "none";
    canvas.style.touchAction = "none";
  }

  const api = {
    redraw,
    ensureCanvasSize,
    loadForView(view) { getState().view = view || getState().view || "General"; loadForView(getState().view); },
    setPenMode(on) {
      const s = getState();
      s.penOn = !!on;
      if (el.canvas) el.canvas.style.pointerEvents = s.penOn ? "auto" : "none";
    },
    setEraser(on) { const s = getState(); s.erasing = !!on; },
    undo,
    clear,
    saveForView,
    _internal: { getState, el }
  };

  attachHandlers();
  window.addEventListener("load", () => { ensureCanvasSize(); redraw(); });
  window.addEventListener("resize", () => { ensureCanvasSize(); redraw(); });

  window.ink = api;
})();
