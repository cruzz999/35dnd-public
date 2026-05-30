// ink.js
// Robust ink layer that compensates for world pan/zoom when mapping pointer coords.
// Drop-in replacement: exposes window.ink API expected by app.js
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
    viewport: document.getElementById("viewport"),
    world: document.getElementById("world")
  };

  // Create canvas if missing
  if (!el.canvas) {
    const c = document.createElement("canvas");
    c.id = "inkWorld";
    c.className = "ink";
    document.body.appendChild(c);
    el.canvas = c;
  }

  let ctx = el.canvas.getContext ? el.canvas.getContext("2d") : null;

  function getStrokesForView(view) {
    const s = getState();
    s.strokesByView[view] ||= [];
    return s.strokesByView[view];
  }

  function saveForView(view) {
    try { localStorage.setItem(`ink:${view}`, JSON.stringify(getStrokesForView(view))); } catch (e) { console.warn("ink save failed", e); }
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

  // Ensure canvas is a child of #app and sized to app's untransformed layout size.
  function ensureCanvasSize() {
    const canvas = el.canvas;
    const appEl = el.app || document.getElementById("app");
    if (!canvas || !appEl) return;

    // Move canvas into app so it visually overlays the paper content
    if (canvas.parentElement !== appEl) {
      canvas.style.position = "absolute";
      canvas.style.left = "0px";
      canvas.style.top = "0px";
      canvas.style.zIndex = 30;
      appEl.appendChild(canvas);
    }

    // Size canvas to app's layout size (CSS pixels before world scale)
    const w = Math.max(appEl.offsetWidth || 1200, 1200);
    const h = Math.max(appEl.offsetHeight || 800, 800);
    const dpr = window.devicePixelRatio || 1;

    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    // Backing store in device pixels
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    // Keep drawing coordinates in CSS pixels by scaling the context by dpr
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Pointer events reflect pen state
    canvas.style.pointerEvents = getState().penOn ? "auto" : "none";
    canvas.style.touchAction = "none";
  }

  // Map client coordinates to canvas-local CSS pixels, compensating for world zoom.
  function screenToWorld(clientX, clientY) {
    const canvas = el.canvas;
    const worldEl = el.world || document.getElementById("world");
    const st = getState();

    if (!canvas) return { x: clientX, y: clientY };

    // canvas.getBoundingClientRect() returns the *visual* rect (already scaled by world zoom)
    const rect = canvas.getBoundingClientRect();
    // raw visual offset inside the scaled canvas
    const visX = clientX - rect.left;
    const visY = clientY - rect.top;

    // If the app uses a world scale (state.zoom), divide out that scale to get unscaled CSS pixels.
    // This corrects the starting point at different zoom levels.
    const zoom = st.zoom || 1;
    const cssX = visX / zoom;
    const cssY = visY / zoom;

    // cssX/cssY are coordinates relative to the canvas's untransformed CSS pixel space.
    return { x: cssX, y: cssY };
  }

  // Draw helpers
  function drawStroke(stroke) {
    if (!ctx || !stroke || !stroke.pts || stroke.pts.length < 2) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
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
    // Clear using device pixels
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

  // Pointer state
  let drawing = false;
  let currentStroke = null;
  let activePointerId = null;

  function pointerDown(e) {
    const s = getState();
    if (!s.penOn) return;
    if (e.pointerType === "touch") return; // keep stylus-only by default

    ensureCanvasSize();

    drawing = true;
    activePointerId = e.pointerId;

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

    // Remove duplicates then attach
    canvas.removeEventListener("pointerdown", pointerDown);
    canvas.removeEventListener("pointermove", pointerMove);
    canvas.removeEventListener("pointerup", endStroke);
    canvas.removeEventListener("pointercancel", endStroke);
    canvas.removeEventListener("lostpointercapture", endStroke);
    canvas.removeEventListener("pointerleave", endStroke);

    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);
    canvas.addEventListener("lostpointercapture", endStroke);
    canvas.addEventListener("pointerleave", endStroke);

    canvas.style.pointerEvents = getState().penOn ? "auto" : "none";
    canvas.style.touchAction = "none";
  }

  const api = {
    redraw,
    ensureCanvasSize,
    loadForView(view) { const s = getState(); s.view = view || s.view || "General"; loadForView(s.view); },
    setPenMode(on) { const s = getState(); s.penOn = !!on; if (el.canvas) el.canvas.style.pointerEvents = s.penOn ? "auto" : "none"; },
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
