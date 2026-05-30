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
    // Use app element size so canvas overlays paper exactly
    const w = Math.max(appEl?.offsetWidth || 1200, 1200);
    const h = Math.max(appEl?.offsetHeight || 800, 800);
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
    canvas.style.touchAction = "none";
  }

  function screenToWorld(clientX, clientY) {
    const st = getState();
    const vr = el.viewport?.getBoundingClientRect();
    if (!vr) return { x: clientX, y: clientY };
    const vx = clientX - vr.left;
    const vy = clientY - vr.top;
    return { x: (vx - (st.pan?.x || 0)) / (st.zoom || 1), y: (vy - (st.pan?.y || 0)) / (st.zoom || 1) };
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
    // ignore touch when pen mode is on (stylus only)
    if (e.pointerType === "touch") return;
    drawing = true;
    activePointerId = e.pointerId;
    const p = screenToWorld(e.clientX, e.clientY);
    currentStroke = { erase: !!s.erasing, pts: [p] };
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
