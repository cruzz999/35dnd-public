// src/render.js
import { escapeHtml, fmtSign, abilityMod } from './utils.js';

export function computeGeneralDerived(g) {
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

export function renderGeneral(state, ink) {
  const g = state.data.general;
  if (!g) {
    const app = document.getElementById('app');
    if (app) app.innerHTML = `<div class="panel"><h2>General</h2><div class="hint">No general data loaded.</div></div>`;
    return;
  }

  // ensure defaults
  g.abilities = g.abilities || {};
  for (const k of ['str','dex','con','int','wis','cha']) g.abilities[k] = g.abilities[k] || { pointBuy:0, asi:0, items:0, buffs:0, total:0 };
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
      <div class="ability-cell total"><input id="${a}_total" type="number" value="${total}" readonly /></div>
      <div class="ability-cell mod"><input id="${a}_mod" type="text" value="${mod>=0? '+'+mod : String(mod)}" readonly /></div>
      <div class="ability-cell buffs"><input id="${a}_buffs" type="number" value="${buffs}" /></div>
      <div class="ability-cell asi"><input id="${a}_asi" type="number" value="${asi}" /></div>
      <div class="ability-cell pointbuy"><input id="${a}_pointbuy" type="number" value="${pb}" readonly /></div>
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
          <div class="general-grid" id="abilitiesGrid" style="grid-template-columns: 1fr 0.9fr 0.8fr 1fr 0.9fr 0.9fr; gap:10px;">
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

  const app = document.getElementById('app');
  if (app) app.innerHTML = html;

  // wire inputs
  abilities.forEach(a => {
    const pbEl = document.getElementById(`${a}_pointbuy`);
    const asiEl = document.getElementById(`${a}_asi`);
    const buffsEl = document.getElementById(`${a}_buffs`);
    const totalEl = document.getElementById(`${a}_total`);
    const modEl = document.getElementById(`${a}_mod`);
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
      if (document.getElementById('ac_total')) document.getElementById('ac_total').value = Number(nd.acTotal || 10);
      if (document.getElementById('ac_touch')) document.getElementById('ac_touch').value = Number(nd.touch || 10);
      if (document.getElementById('ac_flat')) document.getElementById('ac_flat').value = Number(nd.flat || 10);
      if (document.getElementById('save_fort')) document.getElementById('save_fort').value = fmtSign(nd.saves?.fort || 0);
      if (document.getElementById('save_ref')) document.getElementById('save_ref').value = fmtSign(nd.saves?.ref || 0);
      if (document.getElementById('save_will')) document.getElementById('save_will').value = fmtSign(nd.saves?.will || 0);
      if (ink && ink.redraw) ink.redraw();
    }
    [asiEl, buffsEl].forEach(elm => { if (elm) elm.addEventListener('input', recompute, { passive: true }); });
  });

  const chkMage = document.getElementById('chkMageArmor'), chkShield = document.getElementById('chkShieldSpell');
  if (chkMage) chkMage.addEventListener('change', () => { g.buffs.mageArmor = chkMage.checked ? 1 : 0; const nd = computeGeneralDerived(g); if (document.getElementById('ac_total')) document.getElementById('ac_total').value = Number(nd.acTotal||10); if (ink && ink.redraw) ink.redraw(); }, { passive: true });
  if (chkShield) chkShield.addEventListener('change', () => { g.buffs.shieldSpell = chkShield.checked ? 1 : 0; const nd = computeGeneralDerived(g); if (document.getElementById('ac_total')) document.getElementById('ac_total').value = Number(nd.acTotal||10); if (ink && ink.redraw) ink.redraw(); }, { passive: true });

  const hpEl = document.getElementById('hp_current'), hdEl = document.getElementById('hit_dice');
  if (hpEl) hpEl.addEventListener('input', () => { g.hp_current = Number(hpEl.value) || 0; }, { passive: true });
  if (hdEl) hdEl.addEventListener('input', () => { g.hit_dice = hdEl.value || '0d4'; }, { passive: true });

  if (ink && ink.redraw) ink.redraw();
}
