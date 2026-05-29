/**
 * app.js — Restored and consolidated application script
 *
 * - Full single-file replacement intended to be drop-in for your project.
 * - Renders General view (six columns: Ability | Total | Mod | Buffs | ASI | PointBuy).
 * - Total is computed from pointBuy + ASI + items + buffs (read-only).
 * - AC and Saves computed and displayed; Mage Armor and Shield are checkboxes.
 * - Feats and header metadata shown.
 * - Robust Google Sheets ingest (tries proxy, Google export for multiple gids, published CSV).
 * - XLSX upload support (if SheetJS is loaded).
 * - Ink canvas with working pen toggle, eraser, undo, clear.
 * - Prevents text selection while panning.
 *
 * Install: replace your existing app.js with this file. No external edits required
 * except ensuring index.html contains the expected element IDs (app, world, inkWorld, gsUrl, loadGs, file, etc.).
 */

/* =========================
   Safety: guard cssRules access
   ========================= */
(function safeCssRulesWrapper() {
  try {
    const desc = Object.getOwnPropertyDescriptor(CSSStyleSheet.prototype, 'cssRules');
    if (desc && typeof desc.get === 'function') {
      const orig = desc.get;
      Object.defineProperty(CSSStyleSheet.prototype, 'cssRules', {
        get: function () {
          try {
            const r = orig.call(this);
            return r == null ? [] : r;
          } catch (e) {
            return [];
          }
        },
        configurable: true
      });
    }
  } catch (e) {
    console.warn('safeCssRulesWrapper failed (non-fatal):', e && e.message);
  }
})();

/* =========================
   DOM helpers & utilities
   ========================= */
const $ = id => document.getElementById(id);
const escapeHtml = s => String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtSign = n => { n = Number(n)||0; return (n>=0?'+':'')+n; };
const abilityMod = score => Math.floor((Number(score||0)-10)/2);
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const nextFrame = () => new Promise(r => requestAnimationFrame(r));

/* =========================
   Root elements
   ========================= */
const el = {
  file: $('file'),
  gsUrl: $('gsUrl'),
  loadGs: $('loadGs'),
  status: $('status'),
  progressBar: $('progressBar'),
  viewGeneral: $('viewGeneral'),
  viewSpells: $('viewSpells'),
  viewSlots: $('viewSlots'),
  viewSkills: $('viewSkills'),
  zoomOut: $('zoomOut'),
  zoomIn: $('zoomIn'),
  zoomReset: $('zoomReset'),
  penToggle: $('penToggle'),
  eraser: $('eraser'),
  undo: $('undo'),
  clearInk: $('clearInk'),
  viewport: $('viewport'),
  world: $('world'),
  app: $('app'),
  ink: $('inkWorld'),
};

/* =========================
   App state
   ========================= */
window.state = window.state || {
  view: 'General',
  zoom: 1,
  pan: { x: 20, y: 20 },
  penOn: false,
  erasing: false,
  strokesByView: {},
  data: { general: null, spells: { sorc: [], wiz: [], meta: {} }, slots: [] },
  loaded: false,
  canvasOrigin: { x: 2000, y: 2000 }
};

/* =========================
   Progress helper
   ========================= */
function setProgress(pct, text) {
  if (el.progressBar) el.progressBar.style.width = `${pct}%`;
  if (el.status) el.status.textContent = text || '';
}

/* =========================
   Viewport transform (pan/zoom)
   ========================= */
function applyWorldTransform() {
  const world = el.world || document.body;
  if (!world) return;
  world.style.transformOrigin = '0 0';
  world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  if (el.ink) {
    el.ink.style.transformOrigin = '0 0';
    el.ink.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  }
}
function setZoom(z, anchorX=null, anchorY=null) {
  const old = state.zoom;
  z = clamp(z, 0.5, 3);
  if (z === old) return;
  if (anchorX != null && anchorY != null && el.viewport) {
    const vr = el.viewport.getBoundingClientRect();
    const vx = anchorX - vr.left;
    const vy = anchorY - vr.top;
    const wx = (vx - state.pan.x) / old;
    const wy = (vy - state.pan.y) / old;
    state.pan.x = vx - wx * z;
    state.pan.y = vy - wy * z;
  }
  state.zoom = z;
  applyWorldTransform();
  if (ink && ink.redraw) ink.redraw();
}
function resetView() { state.zoom = 1; state.pan = { x:20, y:20 }; applyWorldTransform(); if (ink && ink.redraw) ink.redraw(); }

/* Wheel zoom */
if (el.viewport) {
  el.viewport.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 1/1.08;
    setZoom(state.zoom * factor, e.clientX, e.clientY);
  }, { passive: false });
}

/* =========================
   Prevent selection while panning
   ========================= */
(function preventSelectionDuringPan(){
  const body = document.body;
  function addNoSelect(){ body.classList.add('no-select-during-pan'); }
  function removeNoSelect(){ body.classList.remove('no-select-during-pan'); }
  if (!document.getElementById('noSelectDuringPanStyle')) {
    const s = document.createElement('style');
    s.id = 'noSelectDuringPanStyle';
    s.textContent = `.no-select-during-pan, .no-select-during-pan * { user-select: none !important; -webkit-user-select: none !important; }`;
    document.head.appendChild(s);
  }
  // We'll call addNoSelect/removeNoSelect from pan handlers below.
})();

/* =========================
   Ink canvas implementation
   ========================= */
const ink = (function(){
  const canvas = el.ink;
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  let canvasOrigin = state.canvasOrigin || { x:2000, y:2000 };
  state.canvasOrigin = canvasOrigin;

  function ensureSize() {
    const minW = Math.max(el.app?.scrollWidth || 1200, 1200) + canvasOrigin.x*2;
    const minH = Math.max(el.app?.scrollHeight || 800, 800) + canvasOrigin.y*2;
    canvas.style.width = `${minW}px`;
    canvas.style.height = `${minH}px`;
    canvas.width = Math.floor(minW * dpr);
    canvas.height = Math.floor(minH * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  ensureSize();

  function worldToCss(x,y) {
    return { x: x*state.zoom + state.pan.x - canvasOrigin.x, y: y*state.zoom + state.pan.y - canvasOrigin.y };
  }
  function screenToWorld(cx,cy) {
    const vr = el.viewport ? el.viewport.getBoundingClientRect() : { left:0, top:0 };
    const vx = cx - vr.left;
    return { x: (vx - state.pan.x) / state.zoom, y: (cy - vr.top - state.pan.y) / state.zoom };
  }

  function drawStrokePts(pts, erase=false) {
    if (!ctx || pts.length < 2) return;
    ctx.save();
    if (erase) { ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = 18; }
    else { ctx.globalCompositeOperation = 'source-over'; ctx.lineWidth = 2; }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function redraw() {
    ensureSize();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const strokes = state.strokesByView[state.view] || [];
    for (const s of strokes) {
      const cssPts = (s.pts || []).map(p => worldToCss(p.x,p.y));
      drawStrokePts(cssPts, !!s.erase);
    }
  }

  function saveForView(view) {
    try { localStorage.setItem(`ink:${view}`, JSON.stringify(state.strokesByView[view] || [])); } catch {}
  }
  function loadForView(view) {
    try {
      const raw = localStorage.getItem(`ink:${view}`);
      state.strokesByView[view] = raw ? JSON.parse(raw) : [];
    } catch { state.strokesByView[view] = []; }
    redraw();
  }

  // pointer handling
  let drawing = false, current = null, activeId = null;
  function pointerDown(e) {
    if (!state.penOn) return;
    if (e.pointerType === 'touch') return;
    ensureSize();
    drawing = true;
    activeId = e.pointerId;
    const w = screenToWorld(e.clientX, e.clientY);
    current = { erase: !!state.erasing, pts: [w] };
    state.strokesByView[state.view] ||= [];
    state.strokesByView[state.view].push(current);
    redraw();
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  }
  function pointerMove(e) {
    if (!drawing || activeId !== e.pointerId) return;
    const w = screenToWorld(e.clientX, e.clientY);
    const last = current.pts[current.pts.length-1];
    const dx = w.x - last.x, dy = w.y - last.y;
    if (dx*dx + dy*dy < 0.0001) return;
    current.pts.push(w);
    redraw();
    e.preventDefault();
  }
  function pointerUp(e) {
    if (!drawing) return;
    if (activeId !== null && e && e.pointerId !== activeId) return;
    drawing = false; current = null; activeId = null;
    saveForView(state.view);
    try { if (e) canvas.releasePointerCapture(e.pointerId); } catch {}
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('lostpointercapture', pointerUp);
  canvas.addEventListener('pointerleave', pointerUp);

  function clear() { state.strokesByView[state.view] = []; saveForView(state.view); redraw(); }
  function undo() { const s = state.strokesByView[state.view] || []; s.pop(); saveForView(state.view); redraw(); }

  function setPenMode(on) {
    state.penOn = !!on;
    canvas.style.pointerEvents = state.penOn ? 'auto' : 'none';
    if (el.penToggle) el.penToggle.textContent = `Pen: ${state.penOn ? 'ON' : 'OFF'}`;
  }
  function setEraser(on) { state.erasing = !!on; if (el.eraser) el.eraser.textContent = state.erasing ? 'Eraser: ON' : 'Eraser'; }

  return { redraw, loadForView, clear, undo, setPenMode, setEraser, saveForView };
})();

/* Wire pen toggle, eraser, undo, clear */
if (el.penToggle) {
  el.penToggle.addEventListener('click', () => {
    state.penOn = !state.penOn;
    if (ink && typeof ink.setPenMode === 'function') ink.setPenMode(state.penOn);
    else if (el.ink) el.ink.style.pointerEvents = state.penOn ? 'auto' : 'none';
  }, { passive: true });
}
if (el.eraser) el.eraser.addEventListener('click', () => { state.erasing = !state.erasing; if (ink && ink.setEraser) ink.setEraser(state.erasing); }, { passive: true });
if (el.undo) el.undo.addEventListener('click', () => { if (ink && ink.undo) ink.undo(); }, { passive: true });
if (el.clearInk) el.clearInk.addEventListener('click', () => { if (ink && ink.clear) ink.clear(); }, { passive: true });

/* =========================
   Pan handling
   ========================= */
let panDrag = { active:false, sx:0, sy:0, baseX:0, baseY:0 };
function beginPan(e) { panDrag.active = true; panDrag.sx = e.clientX; panDrag.sy = e.clientY; panDrag.baseX = state.pan.x; panDrag.baseY = state.pan.y; document.body.classList.add('no-select-during-pan'); }
function movePan(e) { if (!panDrag.active) return; const dx = e.clientX - panDrag.sx; const dy = e.clientY - panDrag.sy; state.pan.x = panDrag.baseX + dx; state.pan.y = panDrag.baseY + dy; applyWorldTransform(); if (ink && ink.redraw) ink.redraw(); }
function endPan() { panDrag.active = false; document.body.classList.remove('no-select-during-pan'); }
if (el.viewport) {
  el.viewport.addEventListener('pointerdown', e => { if (state.penOn) return; beginPan(e); el.viewport.setPointerCapture?.(e.pointerId); }, { passive: true });
  el.viewport.addEventListener('pointermove', movePan, { passive: true });
  el.viewport.addEventListener('pointerup', endPan, { passive: true });
  el.viewport.addEventListener('pointercancel', endPan, { passive: true });
}

/* =========================
   Derived computations for General
   ========================= */
function computeGeneralDerived(g) {
  const cls = g.classes || { sorc:0, wiz:0, um:0 };
  const abilities = {};
  for (const k of ['str','dex','con','int','wis','cha']) {
    const a = g.abilities[k] || {};
    const pb = Number(a.pointBuy || 0);
    const asi = Number(a.asi || 0);
    const items = Number(a.items || 0);
    const buffs = Number(a.buffs || 0);
    const total = pb + asi + items + buffs;
    abilities[k] = { total, mod: abilityMod(total) };
  }
  const lvl = (Number(cls.sorc)||0) + (Number(cls.wiz)||0) + (Number(cls.um)||0);
  const conMod = abilities.con.mod;
  const hpBase = lvl > 0 ? (4 + (lvl-1)*3) : 0;
  const hpMax = hpBase + conMod * lvl;
  const ac = g.ac || {};
  const armorItem = Number(ac.armor || 0);
  const shieldItem = Number(ac.shield || 0);
  const size = Number(ac.size || 0);
  const natural = Number(ac.natural || 0);
  const deflect = Number(ac.deflect || 0);
  const misc = Number(ac.misc || 0);
  const mageArmor = Number(g.buffs?.mageArmor || 0);
  const shieldSpell = Number(g.buffs?.shieldSpell || 0);
  const armorUsed = Math.max(armorItem, mageArmor);
  const shieldUsed = Math.max(shieldItem, shieldSpell);
  const acTotal = 10 + armorUsed + shieldUsed + abilities.dex.mod + size + natural + deflect + misc;
  const touch = 10 + abilities.dex.mod + size + deflect + (Number(ac.miscTouch||0) || 0);
  const flat = 10 + armorUsed + shieldUsed + size + natural + deflect + misc;
  const bab = Math.floor((Number(cls.sorc)||0)/2) + Math.floor((Number(cls.wiz)||0)/2) + Math.floor((Number(cls.um)||0)/2);
  const fort = Math.floor((Number(cls.sorc)||0)/3) + Math.floor((Number(cls.wiz)||0)/3) + Math.floor((Number(cls.um)||0)/3) + abilities.con.mod + (Number(g.saves?.fortMisc)||0);
  const ref = Math.floor((Number(cls.sorc)||0)/3) + Math.floor((Number(cls.wiz)||0)/3) + Math.floor((Number(cls.um)||0)/3) + abilities.dex.mod + (Number(g.saves?.refMisc)||0);
  const will = 2 + Math.floor((Number(cls.sorc)||0)/2) + Math.floor((Number(cls.wiz)||0)/2) + Math.floor((Number(cls.um)||0)/2) + abilities.wis.mod + (Number(g.saves?.willMisc)||0);
  const saves = { fort, ref, will };
  const init = abilities.dex.mod + (Number(g.initMisc)||0);
  return { lvl, abilities, hpMax, acTotal, touch, flat, bab, saves, init };
}

/* =========================
   CSV parsing helpers
   ========================= */
function parseCsv(text) {
  const rows = [];
  let cur = [];
  let curField = '';
  let inQuotes = false;
  for (let i=0;i<text.length;i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i+1] === '"') { curField += '"'; i++; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i+1] === '\n') { /* skip */ }
      cur.push(curField); curField = ''; rows.push(cur); cur = []; continue;
    }
    if (!inQuotes && ch === ',') { cur.push(curField); curField = ''; continue; }
    curField += ch;
  }
  if (curField !== '' || cur.length) { cur.push(curField); rows.push(cur); }
  return rows;
}
function csvRowsToObjects(rows) {
  if (!rows || rows.length === 0) return [];
  const headers = rows[0].map(h => String(h||'').trim());
  const out = [];
  for (let r=1;r<rows.length;r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const obj = {};
    for (let c=0;c<headers.length;c++) obj[headers[c]] = row[c] !== undefined ? row[c] : '';
    out.push(obj);
  }
  return out;
}

/* =========================
   Apply sheet row to general mapping
   ========================= */
function applySheetRowToGeneralDetailed(row) {
  if (!state.data.general) state.data.general = {};
  const g = state.data.general;
  g.characterName = row['Character'] ?? row['Name'] ?? g.characterName ?? '';
  g.playerName = row['Player'] ?? g.playerName ?? '';
  g.xp = row['XP'] ?? g.xp ?? '';
  g.classLine = row['Class'] ?? row['Classes'] ?? g.classLine ?? '';
  g.race = row['Race'] ?? g.race ?? '';

  const map = { STR:'str', DEX:'dex', CON:'con', INT:'int', WIS:'wis', CHA:'cha' };
  Object.keys(map).forEach(h => {
    const a = map[h];
    g.abilities = g.abilities || {};
    g.abilities[a] = g.abilities[a] || {};
    if (row[`${h}`] !== undefined && row[`${h}`] !== '') g.abilities[a].pointBuy = Number(row[`${h}`]) || g.abilities[a].pointBuy || 0;
    if (row[`${h} ASI`] !== undefined && row[`${h} ASI`] !== '') g.abilities[a].asi = Number(row[`${h} ASI`]) || g.abilities[a].asi || 0;
    if (row[`${h} PB`] !== undefined && row[`${h} PB`] !== '') g.abilities[a].pointBuy = Number(row[`${h} PB`]) || g.abilities[a].pointBuy || 0;
    if (row[`${h} ITEMS`] !== undefined && row[`${h} ITEMS`] !== '') g.abilities[a].items = Number(row[`${h} ITEMS`]) || g.abilities[a].items || 0;
    if (row[`${h} BUFFS`] !== undefined && row[`${h} BUFFS`] !== '') g.abilities[a].buffs = Number(row[`${h} BUFFS`]) || g.abilities[a].buffs || 0;
  });

  if (row['Feats']) {
    const list = String(row['Feats']).split(',').map(s => s.trim()).filter(Boolean);
    g.feats = list.map(l => ({ label: l }));
  } else {
    const feats = [];
    Object.keys(row).forEach(k => { if (/feat/i.test(k) && row[k]) feats.push({ label: String(row[k]) }); });
    if (feats.length) g.feats = feats;
  }

  if (row['Armor']) g.ac = g.ac || {}, g.ac.armor = Number(row['Armor']) || g.ac.armor || 0;
  if (row['Shield']) g.ac = g.ac || {}, g.ac.shield = Number(row['Shield']) || g.ac.shield || 0;
  if (row['Mage Armor']) g.buffs = g.buffs || {}, g.buffs.mageArmor = (String(row['Mage Armor']).trim().toLowerCase() === '1' || String(row['Mage Armor']).trim().toLowerCase() === 'yes') ? 1 : 0;
  if (row['Shield Spell']) g.buffs = g.buffs || {}, g.buffs.shieldSpell = (String(row['Shield Spell']).trim().toLowerCase() === '1' || String(row['Shield Spell']).trim().toLowerCase() === 'yes') ? 1 : 0;

  // After mapping, mark loaded and render
  state.loaded = true;
  render();
}

/* =========================
   Robust Google Sheets loader
   ========================= */
function extractSpreadsheetId(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}
function isCsvUrl(u) { return /\.csv($|\?)/i.test(String(u)); }
async function tryFetchText(u, opts = {}) {
  try {
    const r = await fetch(u, Object.assign({ cache: 'no-store' }, opts));
    const text = await r.text().catch(()=>null);
    return { ok: r.ok, status: r.status, text };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function loadFromGoogleSheets(url) {
  setProgress(2, 'Starting sheet load...');
  console.log('[ingest] loadFromGoogleSheets', url);
  const sheetId = extractSpreadsheetId(url);
  const tried = [];

  // 1) direct CSV URL
  if (isCsvUrl(url)) {
    const r = await tryFetchText(url);
    tried.push({ method: 'direct-csv', url, result: r });
    if (r.ok && r.text) {
      const rows = parseCsv(r.text);
      const objs = csvRowsToObjects(rows);
      if (objs.length) { applySheetRowToGeneralDetailed(objs[0]); setProgress(100, 'Sheet loaded (direct CSV)'); return; }
    }
  }

  // 2) try proxy if available
  if (sheetId) {
    try {
      const proxyUrl = `/gs/csv?id=${encodeURIComponent(sheetId)}&gid=0`;
      const r = await tryFetchText(proxyUrl);
      tried.push({ method: 'proxy', url: proxyUrl, result: r });
      if (r.ok && r.text) {
        const rows = parseCsv(r.text);
        const objs = csvRowsToObjects(rows);
        if (objs.length) { applySheetRowToGeneralDetailed(objs[0]); setProgress(100, 'Sheet loaded (proxy)'); return; }
      }
    } catch (e) { tried.push({ method:'proxy-exception', error: String(e) }); }
  }

  // 3) try Google export for candidate gids
  if (sheetId) {
    const candidateGids = [2004670713, 0, 1231385124, 2140364605];
    for (const gid of candidateGids) {
      try {
        const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
        const r = await tryFetchText(exportUrl);
        tried.push({ method: 'google-export', gid, url: exportUrl, result: r });
        if (r.ok && r.text) {
          const rows = parseCsv(r.text);
          const objs = csvRowsToObjects(rows);
          if (objs.length) { applySheetRowToGeneralDetailed(objs[0]); setProgress(100, `Sheet loaded (gid=${gid})`); return; }
        }
      } catch (e) { tried.push({ method:'google-export-ex', gid, error: String(e) }); }
    }

    // 4) try published CSV pattern
    try {
      const pubUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/pub?output=csv`;
      const r = await tryFetchText(pubUrl);
      tried.push({ method: 'published-csv', url: pubUrl, result: r });
      if (r.ok && r.text) {
        const rows = parseCsv(r.text);
        const objs = csvRowsToObjects(rows);
        if (objs.length) { applySheetRowToGeneralDetailed(objs[0]); setProgress(100, 'Sheet loaded (published CSV)'); return; }
      }
    } catch (e) { tried.push({ method:'published-ex', error: String(e) }); }
  }

  console.error('[ingest] all attempts failed', tried);
  setProgress(0, 'Sheet load failed — see console for details.');
  console.info('If the sheet is private, publish it or use a server-side proxy.');
}

/* Wire loadGs button */
if (el.loadGs && el.gsUrl) {
  el.loadGs.addEventListener('click', async () => {
    const url = el.gsUrl.value && el.gsUrl.value.trim();
    if (!url) { setProgress(0, 'Paste a Google Sheets URL first.'); return; }
    await loadFromGoogleSheets(url);
  }, { passive: true });
}

/* Autofill gsUrl with shared sheet if empty */
window.addEventListener('DOMContentLoaded', () => {
  try {
    const defaultSheet = 'https://docs.google.com/spreadsheets/d/1P_Vslp-rxiTcntUZVLR2BjJrdeQqdWfPLeigs2Gnx_U/edit?usp=sharing';
    if (el.gsUrl && (!el.gsUrl.value || el.gsUrl.value.trim() === '')) el.gsUrl.value = defaultSheet;
  } catch (e) {}
});

/* =========================
   XLSX upload handling (optional)
   ========================= */
if (el.file) {
  el.file.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      setProgress(5, 'Reading file...');
      const buf = await f.arrayBuffer();
      setProgress(20, 'Parsing workbook...');
      if (typeof XLSX === 'undefined') throw new Error('XLSX library not loaded');
      const wb = XLSX.read(buf, { type: 'array' });
      // Try General sheet
      const ws = wb.Sheets['General'] || wb.Sheets['General info'] || wb.Sheets['GeneralInfo'];
      if (ws) {
        const csv = XLSX.utils.sheet_to_csv(ws);
        const rows = parseCsv(csv);
        const objs = csvRowsToObjects(rows);
        if (objs.length) applySheetRowToGeneralDetailed(objs[0]);
      }
      // Spells sheet
      if (wb.Sheets['Spells']) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets['Spells']);
        const rows = parseCsv(csv);
        const objs = csvRowsToObjects(rows);
        state.data.spells.wiz = objs;
      }
      state.loaded = true;
      setProgress(100, 'File loaded');
      render();
    } catch (err) {
      console.error(err);
      setProgress(0, 'XLSX load failed: ' + (err && err.message));
    }
  }, { passive: true });
}

/* =========================
   Render General view (six columns, pointBuy right)
   ========================= */
function renderGeneral() {
  const g = state.data.general;
  if (!g) {
    if (el.app) el.app.innerHTML = `<div class="panel"><h2>General</h2><div class="hint">No general data loaded.</div></div>`;
    return;
  }

  g.abilities = g.abilities || {};
  for (const k of ['str','dex','con','int','wis','cha']) {
    g.abilities[k] = g.abilities[k] || { pointBuy:0, asi:0, items:0, buffs:0, total:0 };
  }
  g.feats = Array.isArray(g.feats) ? g.feats : [];
  g.ac = g.ac || { armor:0, shield:0, size:0, natural:0, deflect:0, misc:0, miscTouch:0 };
  g.buffs = g.buffs || { mageArmor:0, shieldSpell:0 };

  const derived = computeGeneralDerived(g);
  const abilities = ['str','dex','con','int','wis','cha'];

  const headerHtml = `
    <div class="sheet-header" style="display:flex;gap:18px;align-items:flex-end;margin-bottom:10px;">
      <div style="flex:1 1 320px;">
        <div style="font-size:1.1rem;font-weight:700">${escapeHtml(g.characterName || '')}</div>
        <div style="color:var(--muted);font-size:0.9rem">${escapeHtml(g.classLine || '')} • ${escapeHtml(g.race || '')}</div>
      </div>
      <div style="min-width:220px;text-align:right;">
        <div><strong>Player</strong> ${escapeHtml(g.playerName || '')}</div>
        <div><strong>XP</strong> ${escapeHtml(String(g.xp || ''))}</div>
      </div>
    </div>
  `;

  const rowsHtml = abilities.map(a => {
    const ab = g.abilities[a];
    const pb = Number(ab.pointBuy || 0);
    const asi = Number(ab.asi || 0);
    const items = Number(ab.items || 0);
    const buffs = Number(ab.buffs || 0);
    const total = pb + asi + items + buffs;
    ab.total = total;
    const mod = abilityMod(total);
    return `
      <div class="ability-name">${a.toUpperCase()}</div>

      <div class="ability-cell total">
        <input id="${a}_total" type="number" value="${total}" readonly />
      </div>

      <div class="ability-cell mod">
        <input id="${a}_mod" type="text" value="${mod>=0? '+'+mod : String(mod)}" readonly />
      </div>

      <div class="ability-cell buffs">
        <input id="${a}_buffs" type="number" value="${buffs}" />
      </div>

      <div class="ability-cell asi">
        <input id="${a}_asi" type="number" value="${asi}" />
      </div>

      <div class="ability-cell pointbuy">
        <input id="${a}_pointbuy" type="number" value="${pb}" readonly />
      </div>
    `;
  }).join('');

  const featsHtml = g.feats.length ? `<ul class="feats-list">${g.feats.map(f => `<li>${f.url ? `<a href="${escapeHtml(f.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(f.label||f)}</a>` : escapeHtml(f.label||f)}</li>`).join('')}</ul>` : `<div class="hint">No feats listed.</div>`;

  const acTotal = derived.acTotal || 10;
  const touch = derived.touch || 10;
  const flat = derived.flat || 10;
  const saves = derived.saves || { fort:0, ref:0, will:0 };

  const html = `
    <section id="generalView" class="sheet">
      ${headerHtml}
      <div style="display:flex;gap:18px;align-items:flex-start;">
        <div style="flex:1 1 640px;">
          <div class="general-grid" id="abilitiesGrid" style="grid-template-columns: 1.0fr 0.9fr 0.8fr 1.0fr 0.9fr 0.9fr; gap:10px;">
            <div class="header">Ability</div>
            <div class="header">Total</div>
            <div class="header">Mod</div>
            <div class="header">Buffs</div>
            <div class="header">ASI</div>
            <div class="header">PointBuy</div>

            ${rowsHtml}
          </div>
        </div>

        <div style="flex:0 0 320px;">
          <div class="panel" style="padding:10px;">
            <h3 style="margin:0 0 8px 0;">Derived</h3>
            <div class="kv"><div>AC</div><div><input id="ac_total" type="number" value="${Number(acTotal)}" readonly /></div></div>
            <div class="kv"><div>Touch</div><div><input id="ac_touch" type="number" value="${Number(touch)}" readonly /></div></div>
            <div class="kv"><div>Flat</div><div><input id="ac_flat" type="number" value="${Number(flat)}" readonly /></div></div>

            <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
              <label style="display:flex;align-items:center;gap:6px;"><input id="chkMageArmor" type="checkbox" ${g.buffs.mageArmor ? 'checked' : ''}/> Mage Armor</label>
              <label style="display:flex;align-items:center;gap:6px;"><input id="chkShieldSpell" type="checkbox" ${g.buffs.shieldSpell ? 'checked' : ''}/> Shield</label>
            </div>

            <div style="margin-top:12px;">
              <label>Saves</label>
              <div class="kv"><div>Fort</div><div><input id="save_fort" type="text" value="${fmtSign(saves.fort)}" readonly /></div></div>
              <div class="kv"><div>Ref</div><div><input id="save_ref" type="text" value="${fmtSign(saves.ref)}" readonly /></div></div>
              <div class="kv"><div>Will</div><div><input id="save_will" type="text" value="${fmtSign(saves.will)}" readonly /></div></div>
            </div>

            <div style="margin-top:12px;">
              <label>Feats</label>
              ${featsHtml}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;

  if (el.app) el.app.innerHTML = html;

  const grid = $('abilitiesGrid');
  if (grid && !grid.classList.contains('general-grid')) grid.classList.add('general-grid');

  // Wire inputs
  abilities.forEach(a => {
    const pbEl = $(`${a}_pointbuy`);
    const asiEl = $(`${a}_asi`);
    const buffsEl = $(`${a}_buffs`);
    const totalEl = $(`${a}_total`);
    const modEl = $(`${a}_mod`);

    function recompute() {
      const ab = g.abilities[a];
      ab.pointBuy = Number(pbEl?.value || 0);
      ab.asi = Number(asiEl?.value || 0);
      ab.buffs = Number(buffsEl?.value || 0);
      const items = Number(ab.items || 0);
      const total = (ab.pointBuy||0) + (ab.asi||0) + (items||0) + (ab.buffs||0);
      ab.total = total;
      if (totalEl) totalEl.value = total;
      const m = abilityMod(total);
      if (modEl) modEl.value = (m>=0? '+'+m : String(m));
      state.data.general.abilities[a] = ab;
      const nd = computeGeneralDerived(state.data.general);
      if ($('ac_total')) $('ac_total').value = Number(nd.acTotal || 10);
      if ($('ac_touch')) $('ac_touch').value = Number(nd.touch || 10);
      if ($('ac_flat')) $('ac_flat').value = Number(nd.flat || 10);
      if ($('save_fort')) $('save_fort').value = fmtSign(nd.saves?.fort || 0);
      if ($('save_ref')) $('save_ref').value = fmtSign(nd.saves?.ref || 0);
      if ($('save_will')) $('save_will').value = fmtSign(nd.saves?.will || 0);
      if (ink && ink.redraw) ink.redraw();
    }

    [asiEl, buffsEl].forEach(elm => { if (elm) elm.addEventListener('input', recompute, { passive: true }); });
  });

  const chkMage = $('chkMageArmor'), chkShield = $('chkShieldSpell');
  if (chkMage) chkMage.addEventListener('change', () => { g.buffs.mageArmor = chkMage.checked ? 1 : 0; const nd = computeGeneralDerived(g); if ($('ac_total')) $('ac_total').value = Number(nd.acTotal||10); if (ink && ink.redraw) ink.redraw(); }, { passive: true });
  if (chkShield) chkShield.addEventListener('change', () => { g.buffs.shieldSpell = chkShield.checked ? 1 : 0; const nd = computeGeneralDerived(g); if ($('ac_total')) $('ac_total').value = Number(nd.acTotal||10); if (ink && ink.redraw) ink.redraw(); }, { passive: true });

  const hpEl = $('hp_current'), hdEl = $('hit_dice');
  if (hpEl) hpEl.addEventListener('input', () => { g.hp_current = Number(hpEl.value) || 0; }, { passive: true });
  if (hdEl) hdEl.addEventListener('input', () => { g.hit_dice = hdEl.value || '0d4'; }, { passive: true });

  if (ink && ink.redraw) ink.redraw();
}

/* =========================
   Spells/Slots/Skills placeholders
   ========================= */
function renderSpells() {
  const spells = state.data.spells || { sorc:[], wiz:[] };
  if (el.app) el.app.innerHTML = `<div class="panel"><h2>Spells</h2><div class="hint">Spell lists loaded: Sorc ${spells.sorc.length}, Wiz ${spells.wiz.length}</div></div>`;
}
function renderSlots() {
  if (el.app) el.app.innerHTML = `<div class="panel"><h2>Slots</h2><div class="hint">Slots placeholder</div></div>`;
}
function renderSkills() {
  if (el.app) el.app.innerHTML = `<div class="panel"><h2>Skills</h2><div class="hint">Skills placeholder</div></div>`;
}

/* =========================
   Main render router
   ========================= */
function render() {
  if (!el.app) return;
  if (!state.loaded) {
    el.app.innerHTML = `<div class="panel"><h2>Load</h2><div class="hint">Load via Google Sheets or upload XLSX.</div></div>`;
    applyWorldTransform();
    if (ink && ink.loadForView) ink.loadForView(state.view);
    return;
  }
  if (state.view === 'General') renderGeneral();
  else if (state.view === 'Spells') renderSpells();
  else if (state.view === 'Slots') renderSlots();
  else if (state.view === 'Skills') renderSkills();
  applyWorldTransform();
  if (ink && ink.redraw) ink.redraw();
}

/* =========================
   View buttons wiring
   ========================= */
if (el.viewGeneral) el.viewGeneral.addEventListener('click', () => { state.view = 'General'; render(); }, { passive: true });
if (el.viewSpells) el.viewSpells.addEventListener('click', () => { state.view = 'Spells'; render(); }, { passive: true });
if (el.viewSlots) el.viewSlots.addEventListener('click', () => { state.view = 'Slots'; render(); }, { passive: true });
if (el.viewSkills) el.viewSkills.addEventListener('click', () => { state.view = 'Skills'; render(); }, { passive: true });

/* =========================
   Zoom buttons
   ========================= */
if (el.zoomOut) el.zoomOut.addEventListener('click', () => setZoom(state.zoom / 1.15), { passive: true });
if (el.zoomIn) el.zoomIn.addEventListener('click', () => setZoom(state.zoom * 1.15), { passive: true });
if (el.zoomReset) el.zoomReset.addEventListener('click', () => resetView(), { passive: true });

/* =========================
   Autosave and init
   ========================= */
(function init() {
  try {
    const raw = localStorage.getItem('sheet:general');
    if (raw) state.data.general = JSON.parse(raw);
  } catch {}

  if (!state.data.general) {
    state.data.general = {
      characterName: 'Unnamed',
      playerName: '',
      xp: '',
      classLine: '',
      race: '',
      classes: { sorc:1, wiz:5, um:2 },
      abilities: {
        str:{pointBuy:10,asi:0,items:0,buffs:0},
        dex:{pointBuy:10,asi:0,items:0,buffs:0},
        con:{pointBuy:10,asi:0,items:0,buffs:0},
        int:{pointBuy:10,asi:0,items:0,buffs:0},
        wis:{pointBuy:10,asi:0,items:0,buffs:0},
        cha:{pointBuy:10,asi:0,items:0,buffs:0}
      },
      ac: { armor:0, shield:0, size:0, natural:0, deflect:0, misc:0, miscTouch:0 },
      buffs: { mageArmor:0, shieldSpell:0 },
      feats: []
    };
  }

  applyWorldTransform();
  if (ink && ink.loadForView) ink.loadForView(state.view);
  render();

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem('sheet:general', JSON.stringify(state.data.general)); } catch {}
    }, 500);
  }
  document.addEventListener('input', scheduleSave, { passive: true });

  // Autofill gsUrl if empty
  try {
    const defaultSheet = 'https://docs.google.com/spreadsheets/d/1P_Vslp-rxiTcntUZVLR2BjJrdeQqdWfPLeigs2Gnx_U/edit?usp=sharing';
    if (el.gsUrl && (!el.gsUrl.value || el.gsUrl.value.trim() === '')) el.gsUrl.value = defaultSheet;
  } catch (e) {}
})();

/* =========================
   End of file
   ========================= */
