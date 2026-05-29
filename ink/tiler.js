// ink/tiler.js
// Minimal adapter that provides the same API as the inline ink module in app.js.
// If you have a more advanced tiler implementation, replace the internals.

export function initTiler(canvasEl, options = {}) {
  const canvas = canvasEl;
  const ctx = canvas ? canvas.getContext("2d") : null;
  const state = { view: "General", strokesByView: {}, penOn: false, erasing: false };

  function ensureCanvasSize() {
    if (!canvas || !ctx) return;
    const w = Math.max(document.getElementById("app")?.scrollWidth || 1200, 1200);
    const h = Math.max(document.getElementById("app")?.scrollHeight || 800, 800);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function getStrokesForView(view) { state.strokesByView[view] ||= []; return state.strokesByView[view]; }

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
    for (const s of strokes) drawStroke(s);
  }

  function loadForView(view) {
    state.view = view;
    redraw();
  }

  function setPenMode(on) { state.penOn = !!on; if (canvas) canvas.style.pointerEvents = state.penOn ? "auto" : "none"; }
  function setEraser(on) { state.erasing = !!on; }

  // Minimal pointer handling (non-stylus-optimized)
  let drawing = false;
  let currentStroke = null;
  let activePointerId = null;
  function screenToWorld(clientX, clientY) {
    const vr = document.getElementById("viewport")?.getBoundingClientRect();
    const panX = options.pan?.x || 0;
    const panY = options.pan?.y || 0;
    const zoom = options.zoom || 1;
    if (!vr) return { x: clientX, y: clientY };
    const vx = clientX - vr.left;
    const vy = clientY - vr.top;
    return { x: (vx - panX) / zoom, y: (vy - panY) / zoom };
  }
  function pointerDown(e) {
    if (!state.penOn || !canvas) return;
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
    drawing = false;
    currentStroke = null;
    activePointerId = null;
    try { if (e && canvas) canvas.releasePointerCapture(e.pointerId); } catch {}
  }

  if (canvas) {
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);
  }

  return { redraw, loadForView, setPenMode, setEraser, getStrokesForView };
}
