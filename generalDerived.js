// generalDerived.js
// Pure derived-stat computations for the General / Spells / Slots views.
// Intentionally has NO DOM access, NO app-state mutation, and NO ink logic.

(function (global) {
  const GeneralDerived = {};

  function num(v, fb = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  }

  function abilityMod(score) {
    return Math.floor((num(score) - 10) / 2);
  }

  function babPoor(level) {
    level = num(level);
    return Math.floor(level / 2);
  }

  function saveGood(level) {
    level = num(level);
    return 2 + Math.floor(level / 2);
  }

  function savePoor(level) {
    level = num(level);
    return Math.floor(level / 3);
  }

  function totalLevel(classes) {
    classes = classes || {};
    return num(classes.sorc) + num(classes.wiz) + num(classes.um) +num(classes.inc);
  }

  function hpAverageD4(totalLvl) {
    totalLvl = num(totalLvl);
    if (totalLvl <= 0) return 0;
    return 4 + (totalLvl - 1) * 3;
  }

  function defaultAbilityBreakdown(src) {
    src = src || {};
    return {
      pointBuy: num(src.pointBuy),
      asi: num(src.asi),
      items: num(src.items),
      buffs: num(src.buffs)
    };
  }

  function compute(g) {
    g = g || {};

    const cls = g.classes || {};
    const abilitiesSrc = g.abilities || {};
    const ac = g.ac || {};
    const savesSrc = g.saves || {};
    const attacks = g.attacks || {};
    const buffs = g.buffs || {};

    const abilities = {};
    for (const k of ["str", "dex", "con", "int", "wis", "cha"]) {
      const a = defaultAbilityBreakdown(abilitiesSrc[k]);
      const base = a.pointBuy + a.asi;
      const total = base + a.items + a.buffs;
      abilities[k] = {
        total,
        mod: abilityMod(total)
      };
    }

    const lvl = totalLevel(cls);
    const hpBase = hpAverageD4(lvl);
    const hpMax = hpBase + abilities.con.mod * lvl;

    const armorItem = num(ac.armor);
    const shieldItem = num(ac.shield);
    const mageArmorBonus = num(buffs.mageArmor);
    const shieldSpellBonus = num(buffs.shieldSpell);

    const armorUsed = Math.max(armorItem, mageArmorBonus);
    const shieldUsed = Math.max(shieldItem, shieldSpellBonus);

    const acTotal =
      10 +
      armorUsed +
      shieldUsed +
      abilities.dex.mod +
      num(ac.size) +
      num(ac.natural) +
      num(ac.deflect) +
      num(ac.misc);

    const touch =
      10 +
      abilities.dex.mod +
      num(ac.size) +
      num(ac.deflect) +
      num(ac.miscTouch);

    const flat =
      10 +
      armorUsed +
      shieldUsed +
      num(ac.size) +
      num(ac.natural) +
      num(ac.deflect) +
      num(ac.misc);

    const bab =
      babPoor(cls.sorc) +
      babPoor(cls.wiz) +
      babPoor(cls.um);

    const fortBase =
      savePoor(cls.sorc) +
      savePoor(cls.wiz) +
      savePoor(cls.um);

    const refBase =
      savePoor(cls.sorc) +
      savePoor(cls.wiz) +
      savePoor(cls.um);

    const willBase =
      saveGood(cls.sorc) +
      saveGood(cls.wiz) +
      saveGood(cls.um);

    const saves = {
      fort: fortBase + abilities.con.mod + num(savesSrc.fortMisc),
      ref: refBase + abilities.dex.mod + num(savesSrc.refMisc),
      will: willBase + abilities.wis.mod + num(savesSrc.willMisc)
    };

    const init = abilities.dex.mod + num(g.initMisc);
    const melee = bab + abilities.str.mod + num(attacks.meleeMisc);
    const ranged = bab + abilities.dex.mod + num(attacks.rangedMisc);

    return {
      lvl,
      abilities,
      hpMax,
      acTotal,
      touch,
      flat,
      bab,
      saves,
      init,
      melee,
      ranged
    };
  }

  // Public API
  GeneralDerived.compute = compute;
  GeneralDerived.abilityMod = abilityMod;
  GeneralDerived.babPoor = babPoor;
  GeneralDerived.saveGood = saveGood;
  GeneralDerived.savePoor = savePoor;
  GeneralDerived.totalLevel = totalLevel;
  GeneralDerived.hpAverageD4 = hpAverageD4;

  global.GeneralDerived = GeneralDerived;
})(window);
