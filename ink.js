// ink.js
// Standalone ink layer that mirrors the original inline implementation from app.js.
// It relies on a shared window.state object (created if missing) so it integrates
// seamlessly with the rest of the app's state (pan/zoom/penOn/erasing/strokesByView).
(function () {
  if (window.ink) return;

  // Ensure a shared state object exists (app.js uses `state`).
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
    world: document.getElementById("world"),
    penToggle: document.getElementById("penToggle"),
    eraserBtn: document.getElementById("eraser"),
    undoBtn: document.getElementById("undo"),
    clearBtn: document.getElementById("clearInk")
  };

  // Create canvas if missing (fallback)
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
    } catch {
      getState().strokesByView[view] = [];
    }
    redraw();
  }

  // Size canvas to match the app content area (like original inline code)
  function ensureCanvasSize() {
    const canvas = el.canvas;
    if (!canvas || !ctx) return;

    // Use app scrollWidth/scrollHeight so canvas covers the full paper area
    const appEl = el.app || document.getElementById("app");
    const w = Math.max(appEl?.scrollWidth || 0, 1200);
    const h = Math.max(appEl?.scrollHeight || 0, 800);
    const dpr = window.devicePixelRatio || 1;

    canvas.style.position = "absolute";
    canvas.style.left = "0px";
    canvas.style.top = "0px";
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // critical on Android
    canvas.style.touchAction = "none";
  }

  // Map client coordinates to world/app coordinates using viewport rect and state pan/zoom
  function screenToWorld(clientX, clientY) {
    if (!el.viewport) return { x: 0, y: 0 };
    const vr = el.viewport.getBoundingClientRect();
    const vx = clientX - vr.left;
    const vy = clientY - vr.top;
    const st = getState();
    return {
      x: (vx - st.pan.x) / st.zoom,
      y: (vy - st.pan.y) / st.zoom
    };
  }

  function drawStroke(stroke) {
    if (!ctx) return;
    const pts = stroke.pts || [];
    if (pts.length < 2) return;

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
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function redraw() {
    const canvas = el.canvas;
    if (!canvas || !ctx) return;
    ensureCanvasSize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const strokes = getStrokesForView(getState().view);
    for (const stroke of strokes) drawStroke(stroke);
  }

  function clear() {
    const s = getState();
    s.strokesByView[s.view] = [];
    saveForView(s.view);
    redraw();
  }

  function undo() {
    const s = getStrokesForView(getState().view);
    s.pop();
    saveForView(getState().view);
    redraw();
  }

  // Stylus-safe pointer handling (same logic as original inline)
  let drawing = false;
  let currentStroke = null;
  let activePointerId = null;

  function pointerDown(e) {
    const s = getState();
    if (!s.penOn || !el.canvas) return;

    // ignore finger/palm touches in pen mode
    if (e.pointerType === "touch") return;

    drawing = true;
    activePointerId = e.pointerId;

    const p = screenToWorld(e.clientX, e.clientY);
    currentStroke = { erase: s.erasing, pts: [p] };
    getStrokesForView(s.view).push(currentStroke);

    try { el.canvas.setPointerCapture(e.pointerId); } catch {}
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
      try { el.canvas.releasePointerCapture(e.pointerId); } catch {}
    }
    activePointerId = null;

    saveForView(getState().view);
    redraw();
  }

  // Attach listeners (if canvas exists)
  if (el.canvas) {
    el.canvas.addEventListener("pointerdown", pointerDown);
    el.canvas.addEventListener("pointermove", pointerMove);
    el.canvas.addEventListener("pointerup", endStroke);
    el.canvas.addEventListener("pointercancel", endStroke);
    el.canvas.addEventListener("lostpointercapture", endStroke);
    el.canvas.addEventListener("pointerleave", endStroke);
    el.canvas.style.pointerEvents = "none";
    el.canvas.style.touchAction = "none";
  }

  // API functions to mirror original behavior and allow app.js to call them
  function setPenMode(on) {
    const s = getState();
    s.penOn = !!on;
    if (el.penToggle) el.penToggle.textContent = `Pen: ${s.penOn ? "ON" : "OFF"}`;
    if (el.canvas) el.canvas.style.pointerEvents = s.penOn ? "auto" : "none";

    if (!s.penOn) {
      drawing = false;
      currentStroke = null;
      activePointerId = null;
    }
  }

  function setEraser(on) {
    const s = getState();
    s.erasing = !!on;
    if (el.eraserBtn) el.eraserBtn.textContent = s.erasing ? "Eraser: ON" : "Eraser";
  }

  // Wire UI buttons if present (keeps parity with original inline wiring)
  if (el.penToggle) el.penToggle.addEventListener("click", () => setPenMode(!getState().penOn));
  if (el.eraserBtn) el.eraserBtn.addEventListener("click", () => setEraser(!getState().erasing));
  if (el.undoBtn) el.undoBtn.addEventListener("click", () => undo());
  if (el.clearBtn) el.clearBtn.addEventListener("click", () => clear());

  window.addEventListener("resize", () => {
    ensureCanvasSize();
    redraw();
  });

  // Initialize canvas size
  ensureCanvasSize();

  // Expose API
  window.ink = {
    redraw,
    loadForView,
    setPenMode,
    setEraser,
    undo,
    clear,
    saveForView,
    _internal: { getState, el }
  };
})();
