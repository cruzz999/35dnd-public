// ink.js
// Robust ink layer: maps client -> world -> app using DOMMatrix inverse.
// Exposes window.ink API expected by app.js
(function () {
  if (window.ink) return;

  // Toggle this to true to print debug info for the next pointerDown event
  const DEBUG_ONCE = false;

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

  // Map client coordinates -> app-local coordinates by inverting the world transform.
  function screenToWorld(clientX, clientY) {
    const canvas = el.canvas;
    const worldEl = el.world || document.getElementById("world");
    const appEl = el.app || document.getElementById("app");
    const st = getState();

    if (!canvas || !worldEl || !appEl) {
      // fallback: simple canvas bounding rect mapping
      const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
      return { x: clientX - (rect.left || 0), y: clientY - (rect.top || 0) };
    }

    // 1) point relative to world element's visual origin
    const worldRect = worldEl.getBoundingClientRect();
    const px = clientX - worldRect.left;
    const py = clientY - worldRect.top;

    // 2) get computed transform of world (should be translate + scale)
    const style = getComputedStyle(worldEl);
    const transform = style.transform || "none";

    // If no transform, fall back to reversing state.pan/state.zoom
    if (transform === "none") {
      const x = (px - (st.pan?.x || 0)) / (st.zoom || 1);
      const y = (py - (st.pan?.y || 0)) / (st.zoom || 1);
      const appOffsetX = appEl.offsetLeft || 0;
      const appOffsetY = appEl.offsetTop || 0;
      return { x: x - appOffsetX, y: y - appOffsetY };
    }

    // 3) invert the transform matrix and map the point back to world-local coords
    try {
      // DOMMatrix expects the transform string like "matrix(a,b,c,d,tx,ty)"
      const m = new DOMMatrixReadOnly(transform);
      const inv = m.inverse();
      const pt = new DOMPoint(px, py);
      const unmapped = pt.matrixTransform(inv); // coordinates in world-local space

      // 4) convert world-local to app-local by subtracting app's offset inside world
      const appOffsetX = appEl.offsetLeft || 0;
      const appOffsetY = appEl.offsetTop || 0;
      const appLocalX = unmapped.x - appOffsetX;
      const appLocalY = unmapped.y - appOffsetY;

      // Debugging hook (prints once if DEBUG_ONCE true)
      if (DEBUG_ONCE) {
        // eslint-disable-next-line no-console
        console.log("ink debug mapping:", {
          clientX, clientY, worldRect, px, py, transform, unmappedX: unmapped.x, unmappedY: unmapped.y,
          appOffsetX, appOffsetY, appLocalX, appLocalY, statePan: st.pan, stateZoom: st.zoom
        });
      }

      return { x: appLocalX, y: appLocalY };
    } catch (err) {
      // fallback to reversing pan/zoom if DOMMatrix fails
      const x = (px - (st.pan?.x || 0)) / (st.zoom || 1);
      const y = (py - (st.pan?.y || 0)) / (st.zoom || 1);
      const appOffsetX = appEl.offsetLeft || 0;
      const appOffsetY = appEl.offsetTop || 0;
      return { x: x - appOffsetX, y: y - appOffsetY };
    }
  }

  // Drawing helpers
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

  // Pointer state
  let drawing = false;
  let currentStroke = null;
  let activePointerId = null;

  function pointerDown(e) {
    const s = getState();
    if (!s.penOn) return;
    if (e.pointerType === "touch") return;

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
    _internal: { getState, el, screenToWorld }
  };

  attachHandlers();
  window.addEventListener("load", () => { ensureCanvasSize(); redraw(); });
  window.addEventListener("resize", () => { ensureCanvasSize(); redraw(); });

  window.ink = api;
})();
