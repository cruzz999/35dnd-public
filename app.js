/* ======================================================================
   app.js - Drop-in replacement (with robust ensureGs loader)
   - Adds dynamic loader ensureGs() to reliably load gs_ingest.js if missing
   - Replaces loadGs click handler to await ensureGs()
   - Keeps overlay canvas, DPR sizing, pan/zoom mirroring, and pen behavior
   ====================================================================== */

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
  fillGs: $("fillGs")
};

/* ------------------------------ App state ------------------------------ */
const state = {
  loaded: false,
  view: "General",
  pan: { x: 20, y: 20 },
  zoom: 1.0,
  penOn: false,
  erasing: false,
  penWidth: 0.5,
  penGrey: 0,
  strokesByView: {},
  data: { general: null, spells: { sorc: [], wiz: [], meta: null } }
};

/* ---------------------------- Utilities -------------------------------- */
function escapeHtml(s) { return String(s || "").replace(/[&<>\\'"]/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;" }[m])); }
function fmtSign(n){ n = Number(n)||0; return (n>=0?"+":"")+n; }
function abilityMod(score){ return Math.floor((Number(score)-10)/2); }

/* -------------------- Viewport height sync ------------------------------- */
function syncViewportHeight(){
  const topbar = document.querySelector(".topbar");
  const h = topbar ? topbar.getBoundingClientRect().height : 56;
  if (el.viewport) el.viewport.style.height = `calc(100vh - ${h}px)`;
}
window.addEventListener("resize", () => {
  syncViewportHeight();
  applyWorldTransform();
  ensureCanvasSize();
  if (window.ink && typeof window.ink.redraw === "function") window.ink.redraw();
});
syncViewportHeight();

/* -------------------- Paper transform (pan/zoom) ----------------------- */
function applyWorldTransform(){
  if (!el.world) return;
  el.world.style.transformOrigin = "0 0";
  el.world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;

  // Mirror transform to overlay canvas so ink aligns with world
  const canvas = document.getElementById('inkWorld');
  if (canvas) {
    canvas.style.transformOrigin = "0 0";
    canvas.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  }
}
function clampZoom(z){ return Math.max(0.5, Math.min(3.0, z)); }
function setZoom(newZoom, anchorClientX=null, anchorClientY=null){
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
  ensureCanvasSize();
  if (window.ink && typeof window.ink.redraw === "function") window.ink.redraw();
}
function resetView(){ state.zoom = 1.0; state.pan.x = 20; state.pan.y = 20; applyWorldTransform(); ensureCanvasSize(); if (window.ink && typeof window.ink.redraw === "function") window.ink.redraw(); }

/* --------------------------- View routing ------------------------------ */
function setView(viewName){ state.view = viewName; render(); if (window.ink && typeof window.ink.loadForView === "function") window.ink.loadForView(viewName); }
if (el.viewGeneral) el.viewGeneral.onclick = () => setView("General");
if (el.viewSpells) el.viewSpells.onclick = () => setView("Spells");
if (el.viewSlots) el.viewSlots.onclick = () => setView("Slots");
if (el.viewSkills) el.viewSkills.onclick = () => setView("Skills");

/* --------------------------- Zoom controls ----------------------------- */
if (el.zoomOut) el.zoomOut.onclick = () => setZoom(state.zoom / 1.15);
if (el.zoomIn) el.zoomIn.onclick = () => setZoom(state.zoom * 1.15);
if (el.zoomReset) el.zoomReset.onclick = () => resetView();

/* ----------------------------- Pan mode -------------------------------- */
let panDrag = { active:false, startX:0, startY:0, basePanX:0, basePanY:0 };
let panPending = false;
const PAN_THRESHOLD = 6;

/* -------------------- Overlay canvas sizing & placement ------------------ */
function ensureCanvasSize(){
  const canvasEl = el.ink || document.getElementById('inkWorld');
  if (!canvasEl) return;

  // Create overlay container if missing
  let overlay = document.getElementById('inkOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'inkOverlay';
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.right = '0';
    overlay.style.bottom = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '900';
    document.body.appendChild(overlay);
  }

  // Move canvas into overlay if needed
  if (canvasEl.parentElement !== overlay) {
    canvasEl.style.position = 'absolute';
    canvasEl.style.left = '0px';
    canvasEl.style.top = '0px';
    overlay.appendChild(canvasEl);
  }

  // Size canvas to viewport area (so it overlays the visible paper)
  const dpr = window.devicePixelRatio || 1;
  const ref = el.viewport || document.documentElement;
  const w = Math.max(1, Math.floor(ref.clientWidth || window.innerWidth));
  const h = Math.max(1, Math.floor(ref.clientHeight || window.innerHeight));

  canvasEl.style.width = `${w}px`;
  canvasEl.style.height = `${h}px`;
  canvasEl.width = Math.floor(w * dpr);
  canvasEl.height = Math.floor(h * dpr);

  const ctx = canvasEl.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  canvasEl.style.touchAction = 'none';
  canvasEl.style.userSelect = 'none';
  canvasEl.style.pointerEvents = state.penOn ? 'auto' : 'none';
  canvasEl.style.zIndex = state.penOn ? '1000' : '5';
}

/* ------------------------------ Inline Ink ------------------------------ */
const ink = (() => {
  const canvas = el.ink || document.getElementById('inkWorld');
  let ctx = canvas ? canvas.getContext('2d') : null;

  function getStrokesForView(view){ state.strokesByView[view] ||= []; return state.strokesByView[view]; }
  function saveForView(view){ try { localStorage.setItem(`ink:${view}`, JSON.stringify(getStrokesForView(view))); } catch(e){} }
  function loadForView(view){ try { const raw = localStorage.getItem(`ink:${view}`); state.strokesByView[view] = raw ? JSON.parse(raw) : []; } catch(e){ state.strokesByView[view]=[]; } redraw(); }

  function drawStroke(stroke){
    if (!ctx) return;
    const pts = stroke.pts || [];
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (stroke.erase) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = Math.max(8, (stroke.width || 0.5) * 8);
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = stroke.width || 0.5;
      ctx.strokeStyle = stroke.color || "#000";
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function redraw(){
    if (!canvas || !ctx) return;
    ensureCanvasSize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const strokes = getStrokesForView(state.view);
    for (const s of strokes) drawStroke(s);
  }

  function clear(){ state.strokesByView[state.view] = []; redraw(); saveForView(state.view); }
  function undo(){ const s = getStrokesForView(state.view); s.pop(); redraw(); saveForView(state.view); }

  // Pointer state
  let drawing = false;
  let currentStroke = null;
  let activePointerId = null;

  function pointerDown(e){
    const s = state;
    if (!s.penOn || !canvas) return;
    if (e.pointerType === "touch") return;

    try { e.stopPropagation(); e.preventDefault(); } catch (err) {}

    drawing = true;
    activePointerId = e.pointerId;
    const p = screenToWorld(e.clientX, e.clientY);
    const width = Number(s.penWidth) || 0.5;
    const grey = Math.round((Number(s.penGrey) || 0) * 2.55);
    const color = `rgb(${grey},${grey},${grey})`;
    currentStroke = { erase: s.erasing, pts: [p], width, color };
    getStrokesForView(s.view).push(currentStroke);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    redraw();
  }

  function pointerMove(e){
    const s = state;
    if (!s.penOn || !drawing || !currentStroke) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    if (e.pointerType === "touch") return;

    try { e.stopPropagation(); e.preventDefault(); } catch (err) {}
    currentStroke.pts.push(screenToWorld(e.clientX, e.clientY));
    redraw();
  }

  function endStroke(e){
    const s = state;
    if (!s.penOn) return;
    if (e && activePointerId !== null && e.pointerId !== activePointerId) return;
    try { if (e) { e.stopPropagation(); e.preventDefault(); } } catch (err) {}
    drawing = false;
    currentStroke = null;
    if (canvas && e) { try { canvas.releasePointerCapture(e.pointerId); } catch (err) {} }
    activePointerId = null;
    saveForView(state.view);
    redraw();
  }

  // Attach listeners
  if (canvas) {
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);
    canvas.addEventListener("lostpointercapture", endStroke);
    canvas.addEventListener("pointerleave", endStroke);
    canvas.style.pointerEvents = state.penOn ? 'auto' : 'none';
    canvas.style.touchAction = "none";
    canvas.style.userSelect = "none";
  }

  function setPenMode(on){
    state.penOn = !!on;
    if (el.penToggle) el.penToggle.textContent = state.penOn ? "Pen: ON" : "Pen: OFF";
    if (state.penOn) document.body.classList.add('pen-active'); else document.body.classList.remove('pen-active');
    if (canvas) {
      canvas.style.pointerEvents = state.penOn ? 'auto' : 'none';
      canvas.style.zIndex = state.penOn ? '1000' : '5';
    }
    if (!state.penOn) { drawing = false; currentStroke = null; activePointerId = null; }
    ensureCanvasSize();
    requestAnimationFrame(() => {
      if (canvas) {
        canvas.style.pointerEvents = state.penOn ? 'auto' : 'none';
        canvas.style.zIndex = state.penOn ? '1000' : '5';
      }
    });
  }

  function setEraser(on){ state.erasing = !!on; if (el.eraser) el.eraser.textContent = state.erasing ? "Eraser: ON" : "Eraser"; }

  return {
    redraw, loadForView, ensureCanvasSize, setPenMode, setEraser, setPenWidth: (w)=>{ state.penWidth = Number(w); }, setPenGrey: (g)=>{ state.penGrey = Number(g); }, undo, clear, saveForView, _internal:{ screenToWorld }
  };
})();

window.ink = window.ink || ink;

/* -------------------- Coordinate mapping ------------------------------- */
function screenToWorld(clientX, clientY){
  const vr = el.viewport ? el.viewport.getBoundingClientRect() : document.documentElement.getBoundingClientRect();
  const vx = clientX - vr.left;
  const vy = clientY - vr.top;
  return { x: (vx - state.pan.x) / state.zoom, y: (vy - state.pan.y) / state.zoom };
}

/* --------------------------- Rendering -------------------------------- */
function renderGeneral(){
  const g = state.data.general || { abilities:{}, feats:[], languages:[], ac:{}, buffs:{} , classes:{sorc:1,wiz:5,um:0}, saves:{}, attacks:{} };
  el.app.innerHTML = `
    <div class="panel">
      <h2>General</h2>
      <div>Character: ${escapeHtml(g.characterName||"")}</div>
      <div style="margin-top:8px;">
        <label><input id="buff_mage" type="checkbox" ${g.buffs?.mageArmor ? "checked" : ""}> Mage Armor (+4)</label><br>
        <label><input id="buff_shield" type="checkbox" ${g.buffs?.shieldSpell ? "checked" : ""}> Shield (+4)</label>
      </div>
    </div>
  `;
  document.querySelectorAll('#app input').forEach(inp => {
    inp.addEventListener('change', () => {
      requestAnimationFrame(()=>{ renderGeneral(); if (window.ink && typeof window.ink.redraw === 'function') window.ink.redraw(); });
    });
  });
}

function renderSpells(){
  el.app.innerHTML = `<div class="panel"><h2>Spells</h2><div class="hint">Spell lists</div></div>`;
}

function render(){
  if (!state.loaded) {
    el.app.innerHTML = `<div class="panel"><h2>Load</h2><div class="hint">Load data via Google Sheets</div></div>`;
    applyWorldTransform();
    ensureCanvasSize();
    return;
  }
  if (state.view === "General") renderGeneral();
  else if (state.view === "Spells") renderSpells();
  else el.app.innerHTML = `<div class="panel"><h2>${escapeHtml(state.view)}</h2></div>`;
  applyWorldTransform();
  ensureCanvasSize();
}

/* ------------------ ensureGs helper with dynamic loader ------------------ */
/* Usage: const gs = await ensureGs(); // throws on failure */
async function loadScript(src, { timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    // If a script with the same src substring is already present, resolve after a tick
    for (const s of document.scripts) {
      if (s.src && s.src.indexOf(src) !== -1) {
        return requestAnimationFrame(() => resolve(s));
      }
    }
    const scr = document.createElement('script');
    scr.src = src;
    scr.async = true;
    scr.onload = () => resolve(scr);
    scr.onerror = () => reject(new Error(`Failed to load script ${src}`));
    document.head.appendChild(scr);
    if (timeout > 0) {
      setTimeout(() => reject(new Error(`Loading ${src} timed out after ${timeout}ms`)), timeout);
    }
  });
}

async function ensureGs() {
  if (window.gsIngest) return window.gsIngest;
  if (window.gs && typeof window.gs.loadFromGoogleSheets === 'function') return window.gs;

  const candidatePaths = ['gs_ingest.js', './gs_ingest.js', '/gs_ingest.js'];
  let lastErr = null;
  for (const p of candidatePaths) {
    try {
      await loadScript(p, { timeout: 8000 });
      await new Promise((r) => requestAnimationFrame(r));
      if (window.gsIngest) return window.gsIngest;
      if (window.gs && typeof window.gs.loadFromGoogleSheets === 'function') return window.gs;
    } catch (err) {
      lastErr = err;
    }
  }
  const msg = lastErr ? lastErr.message : 'gs_ingest did not expose expected API';
  const e = new Error(`ensureGs failed: ${msg}`);
  e.detail = { candidatePaths };
  throw e;
}

/* ---------------------- Hook Google Sheets button ---------------------- */
window.addEventListener("DOMContentLoaded", () => {
  // Ensure topbar/viewport sizing is correct
  syncViewportHeight();
  ensureCanvasSize();

  // Keep topbar size changes in sync
  (function watchTopbarSize(){
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    try {
      const ro = new ResizeObserver(() => { syncViewportHeight(); applyWorldTransform(); ensureCanvasSize(); if (window.ink && typeof window.ink.redraw === 'function') window.ink.redraw(); });
      ro.observe(topbar);
      window.__topbarResizeObserver = ro;
    } catch (e) {
      let lastH = topbar.getBoundingClientRect().height;
      setInterval(()=>{ const h = topbar.getBoundingClientRect().height; if (h !== lastH){ lastH = h; syncViewportHeight(); applyWorldTransform(); ensureCanvasSize(); if (window.ink && typeof window.ink.redraw === 'function') window.ink.redraw(); } }, 300);
    }
  })();

  // Inject panning styles once
  (function injectPanningStyles(){
    const id = 'app.js:is-panning';
    if (document.head.querySelector(`style[data-generated-by="${id}"]`)) return;
    const css = `
      body.is-panning, body.is-panning * { -webkit-user-select:none!important; user-select:none!important; -webkit-tap-highlight-color:transparent!important; }
      body.is-panning ::selection { background: transparent !important; }
    `;
    const s = document.createElement('style');
    s.setAttribute('data-generated-by', id);
    s.appendChild(document.createTextNode(css));
    document.head.appendChild(s);
  })();

  // Auto-populate GS URL
  const AUTO_SHEET = "https://docs.google.com/spreadsheets/d/1P_Vslp-rxiTcntUZVLR2BjJrdeQqdWfPLeigs2Gnx_U/edit?usp=sharing";
  if (el.gsUrl && !el.gsUrl.value) el.gsUrl.value = AUTO_SHEET;

  // Robust Load button: use ensureGs() to dynamically load gs_ingest if needed
  if (el.loadGs && el.gsUrl) {
    el.loadGs.addEventListener("click", async () => {
      try {
        const url = el.gsUrl.value.trim();
        if (!url) { if (typeof setProgress === 'function') setProgress(0, "Paste a Google Sheets URL first."); return; }

        const gs = await ensureGs();

        if (!gs.__patchedForApp) {
          const orig = gs.loadFromGoogleSheets.bind(gs);
          gs.loadFromGoogleSheets = async function (sheetUrl) {
            await orig(sheetUrl);
            try {
              const general = window.state?.data?.general ?? null;
              const spells = window.state?.data?.spells ?? null;
              if (typeof window.receiveIngestedData === "function") {
                window.receiveIngestedData(general, spells);
              }
            } catch (err) { console.warn("post-ingest merge failed", err); }
          };
          gs.__patchedForApp = true;
        }

        if (typeof setProgress === 'function') setProgress(10, "Loading Google Sheets...");
        await gs.loadFromGoogleSheets(url);
        mergeWindowStateIfPresent();
        render();
        ensureCanvasSize();
        if (window.ink && typeof window.ink.redraw === 'function') window.ink.redraw();
        if (typeof setProgress === 'function') setProgress(100, "Done ✅");
      } catch (e) {
        console.error("Load GS failed", e);
        if (typeof setProgress === 'function') setProgress(0, `Google Sheets load failed: ${e.message || e}`);
        try { alert(`Load failed: ${e.message || e}`); } catch (err) {}
      }
    });
  } else {
    console.warn("Google Sheets UI not present (#gsUrl / #loadGs).");
  }

  if (el.fillGs && el.gsUrl) {
    el.fillGs.addEventListener("click", () => { el.gsUrl.value = AUTO_SHEET; el.gsUrl.focus(); });
    el.gsUrl.addEventListener("keydown", (e) => { if (e.key === "Enter") el.loadGs.click(); });
  }

  /* ------------------ Wire ink controls and pen toggle ------------------ */
  (function wireInkControls(){
    function safeInk(){ if (window.ink) return window.ink; console.warn("ink API not ready"); return null; }
    function updatePenLabel(){ if (!el.penToggle) return; el.penToggle.textContent = `Pen: ${state.penOn ? "ON" : "OFF"}`; }
    function updateEraserLabel(){ if (!el.eraser) return; el.eraser.textContent = state.erasing ? "Eraser: ON" : "Eraser"; }

    if (el.penToggle) el.penToggle.disabled = true;
    if (el.eraser) el.eraser.disabled = true;
    if (el.undo) el.undo.disabled = true;
    if (el.clearInk) el.clearInk.disabled = true;

    const enableControls = () => { if (el.penToggle) el.penToggle.disabled = false; if (el.eraser) el.eraser.disabled = false; if (el.undo) el.undo.disabled = false; if (el.clearInk) el.clearInk.disabled = false; };

    const setCanvasInteraction = (on) => {
      const canvas = document.getElementById('inkWorld');
      if (canvas) {
        canvas.style.pointerEvents = on ? 'auto' : 'none';
        canvas.style.zIndex = on ? '1000' : '5';
      }
    };

    const inkReadyCheck = () => {
      if (window.ink) {
        enableControls();
        try { if (typeof window.ink.setPenMode === 'function') window.ink.setPenMode(!!state.penOn); } catch(e){}
        setCanvasInteraction(!!state.penOn);

        if (el.penToggle) {
          el.penToggle.addEventListener("click", () => {
            state.penOn = !state.penOn;
            const inkApi = safeInk();
            if (inkApi && typeof inkApi.setPenMode === "function") {
              try { inkApi.setPenMode(state.penOn); } catch (e) { console.error("ink.setPenMode error", e); }
            }
            if (state.penOn) document.body.classList.add('pen-active'); else document.body.classList.remove('pen-active');
            setCanvasInteraction(state.penOn);
            ensureCanvasSize();
            requestAnimationFrame(()=> setCanvasInteraction(state.penOn));
            updatePenLabel();
          });
        }

        if (el.eraser) {
          el.eraser.addEventListener("click", () => {
            state.erasing = !state.erasing;
            const inkApi = safeInk();
            if (inkApi && typeof inkApi.setEraser === "function") {
              try { inkApi.setEraser(state.erasing); } catch (e) { console.error("ink.setEraser error", e); }
            }
            updateEraserLabel();
          });
        }

        if (el.undo) {
          el.undo.addEventListener("click", () => { try { window.ink.undo(); } catch(e){ console.warn("undo failed", e); } });
        }
        if (el.clearInk) {
          el.clearInk.addEventListener("click", () => { try { window.ink.clear(); } catch(e){ console.warn("clear failed", e); } });
        }
      } else {
        setTimeout(()=> {
          enableControls();
          if (el.penToggle) {
            el.penToggle.addEventListener("click", () => {
              state.penOn = !state.penOn;
              if (state.penOn) document.body.classList.add('pen-active'); else document.body.classList.remove('pen-active');
              setCanvasInteraction(state.penOn);
              ensureCanvasSize();
              requestAnimationFrame(()=> setCanvasInteraction(state.penOn));
              updatePenLabel();
            });
          }
          if (el.eraser) el.eraser.addEventListener("click", ()=>{ state.erasing = !state.erasing; updateEraserLabel(); });
          if (el.undo) el.undo.addEventListener("click", ()=>{ console.warn("undo not available"); });
          if (el.clearInk) el.clearInk.addEventListener("click", ()=>{ console.warn("clear not available"); });
        }, 300);
      }
    };

    inkReadyCheck();

    // Pen width control
    const penWidthEl = document.getElementById("penWidth");
    const penWidthLabel = document.getElementById("penWidthLabel");
    if (penWidthEl) {
      penWidthEl.value = state.penWidth ?? 0.5;
      penWidthLabel.textContent = (Number(penWidthEl.value) % 1 === 0) ? String(Number(penWidthEl.value)) : Number(penWidthEl.value).toFixed(2);
      penWidthEl.addEventListener("input", () => {
        const v = parseFloat(penWidthEl.value) || 0.25;
        state.penWidth = v;
        penWidthLabel.textContent = (v % 1 === 0) ? String(v) : v.toFixed(2);
        const inkApi = window.ink;
        if (inkApi && typeof inkApi.setPenWidth === "function") inkApi.setPenWidth(v);
      });
    }

    // Greyscale control
    const penGreyEl = document.getElementById("penGrey");
    const penGreyLabel = document.getElementById("penGreyLabel");
    if (penGreyEl) {
      penGreyEl.value = state.penGrey ?? 0;
      const updateGreyLabel = (val) => { const grey = Math.round(val * 2.55); const hex = grey.toString(16).padStart(2,"0"); penGreyLabel.textContent = `#${hex}${hex}${hex}`; };
      updateGreyLabel(penGreyEl.value);
      penGreyEl.addEventListener("input", () => {
        const v = Number(penGreyEl.value) || 0;
        state.penGrey = v;
        updateGreyLabel(v);
        const inkApi = window.ink;
        if (inkApi && typeof inkApi.setPenGrey === "function") inkApi.setPenGrey(v);
      });
    }
  })();

  /* ------------------ Checkbox delegation (safe re-render) ------------------ */
  if (el.app) {
    el.app.addEventListener('change', (ev) => {
      const tgt = ev.target;
      if (!tgt) return;
      if (!state.data || !state.data.general) return;
      const g = state.data.general;
      if (tgt.id === 'buff_mage') {
        g.buffs = g.buffs || {};
        g.buffs.mageArmor = tgt.checked ? 4 : 0;
        requestAnimationFrame(() => { renderGeneral(); if (window.ink && typeof window.ink.redraw === "function") window.ink.redraw(); });
      } else if (tgt.id === 'buff_shield') {
        g.buffs = g.buffs || {};
        g.buffs.shieldSpell = tgt.checked ? 4 : 0;
        requestAnimationFrame(() => { renderGeneral(); if (window.ink && typeof window.ink.redraw === "function") window.ink.redraw(); });
      }
    });
  }

  /* ------------------ Viewport pan guard (prevent stealing clicks) ------------------ */
  (function ensureViewportPanGuard(){
    if (!el.viewport) return;
    const P = { panDrag:{ active:false, startX:0, startY:0, basePanX:0, basePanY:0 }, panPending:false, PAN_THRESHOLD: PAN_THRESHOLD };

    function beginPanInit(e){
      P.panPending = true;
      P.panDrag.startX = e.clientX;
      P.panDrag.startY = e.clientY;
      P.panDrag.basePanX = state.pan.x;
      P.panDrag.basePanY = state.pan.y;
      document.body.classList.add('is-panning');
    }
    function beginPanCommit(){ P.panDrag.active = true; }
    function movePanHandler(e){
      if (!P.panDrag.active) return;
      const dx = e.clientX - P.panDrag.startX;
      const dy = e.clientY - P.panDrag.startY;
      state.pan.x = P.panDrag.basePanX + dx;
      state.pan.y = P.panDrag.basePanY + dy;
      applyWorldTransform();
      ensureCanvasSize();
      if (window.ink && typeof window.ink.redraw === "function") window.ink.redraw();
    }
    function endPanHandler(e){
      P.panPending = false;
      P.panDrag.active = false;
      document.body.classList.remove('is-panning');
      try { el.viewport.releasePointerCapture?.(e?.pointerId); } catch (err) {}
    }

    el.viewport.addEventListener("pointerdown", (e) => {
      if (state.penOn) return;
      const interactive = e.target && e.target.closest && e.target.closest('input, button, label, a, textarea, select, [contenteditable]');
      if (interactive) return;
      if (e.target && e.target.closest && e.target.closest('canvas#inkWorld')) return;
      beginPanInit(e);
      try { el.viewport.setPointerCapture?.(e.pointerId); } catch (err) {}
    });

    el.viewport.addEventListener("pointermove", (e) => {
      if (!P.panPending && !P.panDrag.active) return;
      if (!P.panDrag.active) {
        const dx = Math.abs(e.clientX - P.panDrag.startX);
        const dy = Math.abs(e.clientY - P.panDrag.startY);
        if (dx + dy < P.PAN_THRESHOLD) return;
        beginPanCommit();
      }
      movePanHandler(e);
    });

    el.viewport.addEventListener("pointerup", (e) => {
      if (!P.panDrag.active) {
        P.panPending = false;
        document.body.classList.remove('is-panning');
        try { el.viewport.releasePointerCapture?.(e.pointerId); } catch (err) {}
        return;
      }
      endPanHandler(e);
    });

    el.viewport.addEventListener("pointercancel", (e) => {
      P.panPending = false;
      P.panDrag.active = false;
      document.body.classList.remove('is-panning');
      try { el.viewport.releasePointerCapture?.(e.pointerId); } catch (err) {}
    });
  })();

  /* --------------------------- Initial setup ----------------------------- */
  applyWorldTransform();
  ensureCanvasSize();
  render();

});
