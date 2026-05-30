// ink.js
// Self-contained ink layer. Attach API to window.ink.
// Designed to overlay the #app element and map pointer events reliably
// across pan/zoom/transform by using the canvas bounding rect.
(function () {
  if (window.ink) return;

  // Use a shared state object if present; otherwise create a minimal one.
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

  // If the canvas element is missing, create one and insert into DOM
  if (!el.canvas) {
    const c = document.createElement("canvas");
    c.id = "inkWorld";
    c.className = "ink";
    // try to append to body as fallback; app.js will move it into #app on ensureCanvasSize
    document.body.appendChild(c);
    el.canvas = c;
  }

  let ctx = el.canvas.getContext ? el.canvas.getContext("2d") : null;

  // Utility: strokes storage per view
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

  // Ensure the canvas is a child of the app element and sized to it exactly.
  function ensureCanvasSize() {
    const canvas = el.canvas;
    const appEl = el.app || document.getElementById("app");
    if (!canvas || !appEl) return;

    // Move canvas into the app element so it shares the same layout/transform
    if (canvas.parentElement !== appEl) {
      // preserve existing canvas style where possible
      canvas.style.position = "absolute";
      canvas.style.left = "0px";
      canvas.style.top = "0px";
      canvas.style.zIndex = 30;
      appEl.appendChild(canvas);
    }

    // CSS size should match app element's layout size (untransformed CSS pixels)
    const w = Math.max(appEl.offsetWidth || 1200, 1200);
    const h = Math.max(appEl.offsetHeight || 800, 800);
    const dpr = window.devicePixelRatio || 1;

    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    // Backing store size in device pixels
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    // Use a scale so drawing coordinates are in CSS pixels
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Default pointer-events off; app toggles when pen is ON
    canvas.style.pointerEvents = getState().penOn ? "auto" : "none";
    canvas.style.touchAction = "none";
  }

  // Map client coordinates to coordinates relative to the canvas (CSS pixels).
  // Using canvas.getBoundingClientRect() makes this robust across zoom/transform.
  function screenToWorld(clientX, clientY) {
    const canvas = el.canvas;
    if (!canvas) return { x: clientX, y: clientY };

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return { x, y };
  }

  // Basic stroke renderer
  function drawStroke(stroke) {
    if (!ctx || !stroke || !stroke.pts || stroke.pts.length < 2) return;
    ctx.save();
    if (stroke.erase) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = 18;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
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
    // ignore touch if you want stylus-only; remove the next line to allow finger drawing
    if (e.pointerType === "touch") return;

    // Ensure canvas is sized and placed correctly before starting stroke
    ensureCanvasSize();

    drawing = true;
    activePointerId = e.pointerId;

    // Use robust mapping
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
    // Remove existing listeners to avoid duplicates
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

    // default off; app toggles when pen is ON
    canvas.style.pointerEvents = getState().penOn ? "auto" : "none";
    canvas.style.touchAction = "none";
  }

  // Public API
  const api = {
    redraw,
    ensureCanvasSize,
    loadForView(view) {
      const s = getState();
      s.view = view || s.view || "General";
      loadForView(s.view);
    },
    setPenMode(on) {
      const s = getState();
      s.penOn = !!on;
      if (el.canvas) el.canvas.style.pointerEvents = s.penOn ? "auto" : "none";
    },
    setEraser(on) {
      const s = getState();
      s.erasing = !!on;
    },
    undo,
    clear,
    saveForView,
    // expose internals for debugging if needed
    _internal: { getState, el }
  };

  // Initialize
  attachHandlers();
  window.addEventListener("load", () => { ensureCanvasSize(); redraw(); });
  window.addEventListener("resize", () => { ensureCanvasSize(); redraw(); });

  // Expose API
  window.ink = api;
})();
