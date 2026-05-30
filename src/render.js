// src/render.js
import { escapeHtml, fmtSign, abilityMod } from './utils.js';

/* Class progression factors (fractional BAB / save helpers).
   Adjust names or factors if you add other classes. */
const CLASS_PROGRESSIONS = {
  // factor: BAB per level (fractional), saveGood: true if class has good Will/Fort/Ref as appropriate
  sorcerer: { bab: 0.5, good: { fort:false, ref:false, will:true } },
  wizard:   { bab: 0.5, good: { fort:false, ref:false, will:true } },
  'ultimate magus': { bab: 0.75, good: { fort:false, ref:false, will:true } },
  // add other classes here as needed
};

function fracBabForClass(level, factor) {
  return (level || 0) * (factor || 0);
}
function goodSaveBase(level) {
  // Good save: +2 at 1st, then +1/2 per level -> 2 + floor(level/2)
  return 2 + Math.floor((level || 0) / 2);
}
function poorSaveBase(level) {
  // Poor save: floor(level/3)
  return Math.floor((level || 0) / 3);
}

export function computeGeneralDerived(g) {
  const cls = g.classes || {};
  // compute fractional BAB sum
  let babFrac = 0;
  for (const [name, lvl] of Object.entries(cls)) {
    const key = String(name).toLowerCase();
    const prog = CLASS_PROGRESSIONS[key] || { bab: 0.5, good: { fort:false, ref:false, will:false } };
    babFrac += fracBabForClass(Number(lvl)||0, prog.bab);
  }
  const bab = Math.floor(babFrac);

  // compute saves by summing each class's contribution
  let fortBase = 0, refBase = 0, willBase = 0;
  for (const [name, lvl] of Object.entries(cls)) {
    const key = String(name).toLowerCase();
    const prog = CLASS_PROGRESSIONS[key] || { bab:0.5, good:{fort:false,ref:false,will:false} };
    const L = Number(lvl)||0;
    if (prog.good.fort) fortBase += goodSaveBase(L); else fortBase += poorSaveBase(L);
    if (prog.good.ref)  refBase  += goodSaveBase(L); else refBase  += poorSaveBase(L);
    if (prog.good.will) willBase += goodSaveBase(L); else willBase += poorSaveBase(L);
  }

  // ability mods: prefer computed totals if present, else compute from pointBuy+asi+items+buffs
  const abilities = {};
  for (const k of ['str','dex','con','int','wis','cha']) {
    const a = g.abilities?.[k] || {};
    const pb = Number(a.pointBuy || 0);
    const asi = Number(a.asi || 0);
    const items = Number(a.items || 0);
    const buffs = Number(a.buffs || 0);
    const total = (a.score !== undefined && a.score !== null) ? Number(a.score) : (pb + asi + items + buffs);
    abilities[k] = { total, mod: abilityMod(total) };
  }

  // add ability mods to saves
  const fort = fortBase + (abilities.con?.mod || 0) + (Number(g.saves?.fortMisc)||0);
  const ref  = refBase  + (abilities.dex?.mod || 0) + (Number(g.saves?.refMisc)||0);
  const will = willBase + (abilities.wis?.mod || 0) + (Number(g.saves?.willMisc)||0);

  // AC components (best-effort)
  const ac = g.ac || {};
  const armorUsed = Math.max(Number(ac.armor||0), Number(g.buffs?.mageArmor||0));
  const shieldUsed = Math.max(Number(ac.shield||0), Number(g.buffs?.shieldSpell||0));
  const sizeMod = Number(ac.size || 0);
  const natural = Number(ac.natural || 0);
  const deflect = Number(ac.deflect || 0);
  const misc = Number(ac.misc || 0);
  const acTotal = 10 + armorUsed + shieldUsed + (abilities.dex?.mod||0) + sizeMod + natural + deflect + misc;

  // Attacks
  const melee = bab + (abilities.str?.mod || 0) + (Number(g.attackMisc)||0);
  const ranged = bab + (abilities.dex?.mod || 0) + (Number(g.attackMisc)||0);
  const grapple = bab + (abilities.str?.mod || 0) + (sizeMod || 0) + (Number(g.attackMisc)||0);

  return {
    bab, abilities, hpMax: 0, // hp handled elsewhere
    acTotal, saves: { fort, ref, will },
    attacks: { melee, ranged, grapple }
  };
}

export function renderGeneral(state, ink) {
  const g = state.data.general;
  if (!g) return;
  g.abilities = g.abilities || {};
  g.feats = Array.isArray(g.feats) ? g.feats : [];

  // dedupe feats by normalized label and skip header-like entries
  const seen = new Set();
  const feats = [];
  for (const f of g.feats) {
    const label = (typeof f === 'string') ? f : (f.label || '');
    if (!label) continue;
    const nk = label.trim().toUpperCase();
    if (nk === 'FEATS' || nk.includes('FEATS & SPECIAL')) continue;
    const key = nk.replace(/\s+/g,' ');
    if (seen.has(key)) continue;
    seen.add(key);
    feats.push(label);
  }

  const derived = computeGeneralDerived(g);
  // build HTML (abilities grid omitted for brevity; keep your existing layout)
  const featsHtml = feats.length ? `<section class="feats-panel"><h3>Feats</h3><ul class="feats-list simple">${feats.map(f=>`<li>${escapeHtml(f)}</li>`).join('')}</ul></section>` : `<div class="hint">No feats listed.</div>`;

  // Insert featsHtml below abilities and show derived attacks/saves
  const app = document.getElementById('app');
  if (!app) return;
  // reuse existing header and abilities rendering (omitted here) — append feats and derived attack/saves
  // For brevity, replace the derived block insertion with:
  app.querySelector('#derivedAttacks')?.remove?.();
  const derivedHtml = `
    <div id="derivedAttacks" class="panel" style="padding:10px;margin-top:8px;">
      <h3>Derived</h3>
      <div class="kv"><div>BAB</div><div>${derived.bab}</div></div>
      <div class="kv"><div>Melee</div><div>${derived.attacks.melee >= 0 ? '+'+derived.attacks.melee : derived.attacks.melee}</div></div>
      <div class="kv"><div>Ranged</div><div>${derived.attacks.ranged >= 0 ? '+'+derived.attacks.ranged : derived.attacks.ranged}</div></div>
      <div class="kv"><div>Grapple</div><div>${derived.attacks.grapple >= 0 ? '+'+derived.attacks.grapple : derived.attacks.grapple}</div></div>
      <div style="margin-top:8px;">
        <div class="kv"><div>Fort</div><div>${fmtSign(derived.saves.fort)}</div></div>
        <div class="kv"><div>Ref</div><div>${fmtSign(derived.saves.ref)}</div></div>
        <div class="kv"><div>Will</div><div>${fmtSign(derived.saves.will)}</div></div>
      </div>
    </div>
  `;
  // append feats and derivedHtml under abilities container if present
  const leftCol = app.querySelector('.left-column') || app;
  // remove old feats panel if present
  leftCol.querySelector('.feats-panel')?.remove();
  leftCol.insertAdjacentHTML('beforeend', featsHtml);
  // remove old derivedAttacks and append new
  const rightCol = app.querySelector('.right-column') || app;
  rightCol.querySelector('#derivedAttacks')?.remove();
  rightCol.insertAdjacentHTML('beforeend', derivedHtml);
}
