// slotCalculator.js
// Drop-in module: compute spell slots from app state without modifying app.js

(function(global){
  const SlotCalculator = {};

  // Canonical SRD min caster level per spell level
  const minCasterLevelForSpellLevel = [0,1,3,5,7,9,11,13,15,17];

  // Canonical base slots (SRD) for Sorcerer and Wizard (levels 1..20)
  // Each array is 10 entries for spell levels 0..9
  const baseSlots = {
    sorcerer: {
      1:  [5,3,0,0,0,0,0,0,0,0],
      2:  [6,4,0,0,0,0,0,0,0,0],
      3:  [6,5,0,0,0,0,0,0,0,0],
      4:  [6,6,3,0,0,0,0,0,0,0],
      5:  [6,6,4,0,0,0,0,0,0,0],
      6:  [6,6,5,3,0,0,0,0,0,0],
      7:  [6,6,6,4,0,0,0,0,0,0],
      8:  [6,6,6,5,3,0,0,0,0,0],
      9:  [6,6,6,6,4,0,0,0,0,0],
      10: [6,6,6,6,5,3,0,0,0,0],
      11: [6,6,6,6,6,4,0,0,0,0],
      12: [6,6,6,6,6,5,3,0,0,0],
      13: [6,6,6,6,6,6,4,0,0,0],
      14: [6,6,6,6,6,6,5,3,0,0],
      15: [6,6,6,6,6,6,6,4,0,0],
      16: [6,6,6,6,6,6,6,5,3,0],
      17: [6,6,6,6,6,6,6,6,4,0],
      18: [6,6,6,6,6,6,6,6,5,3],
      19: [6,6,6,6,6,6,6,6,6,4],
      20: [6,6,6,6,6,6,6,6,6,6]
    },
    wizard: {
      1:  [3,1,0,0,0,0,0,0,0,0],
      2:  [4,2,0,0,0,0,0,0,0,0],
      3:  [4,2,1,0,0,0,0,0,0,0],
      4:  [4,3,2,0,0,0,0,0,0,0],
      5:  [4,3,2,1,0,0,0,0,0,0],
      6:  [4,3,3,2,0,0,0,0,0,0],
      7:  [4,4,3,2,1,0,0,0,0,0],
      8:  [4,4,3,3,2,0,0,0,0,0],
      9:  [4,4,4,3,2,1,0,0,0,0],
      10: [4,4,4,3,3,2,0,0,0,0],
      11: [4,4,4,4,3,2,1,0,0,0],
      12: [4,4,4,4,3,3,2,0,0,0],
      13: [4,4,4,4,4,3,2,1,0,0],
      14: [4,4,4,4,4,3,3,2,0,0],
      15: [4,4,4,4,4,4,3,2,1,0],
      16: [4,4,4,4,4,4,3,3,2,0],
      17: [4,4,4,4,4,4,4,3,2,1],
      18: [4,4,4,4,4,4,4,3,3,2],
      19: [4,4,4,4,4,4,4,4,3,3],
      20: [4,4,4,4,4,4,4,4,4,4]
    }
  };

  // SRD bonus-spell mapping for ability modifiers +1..+9 (index = modifier)
  // Each array is 10 entries for spell levels 0..9
  const bonusMap = {
    1: [0,1,0,0,0,0,0,0,0,0],
    2: [0,1,1,0,0,0,0,0,0,0],
    3: [0,1,1,1,0,0,0,0,0,0],
    4: [0,1,1,1,1,0,0,0,0,0],
    5: [0,2,1,1,1,1,0,0,0,0],
    6: [0,2,2,1,1,1,1,0,0,0],
    7: [0,2,2,2,1,1,1,1,0,0],
    8: [0,2,2,2,2,1,1,1,1,0],
    9: [0,3,2,2,2,2,1,1,1,1]
  };

  // Helper: safe clone array of length 10
  function zeroVec() { return [0,0,0,0,0,0,0,0,0,0]; }
  function cloneVec(v) { return v ? v.slice(0,10) : zeroVec(); }

  // Compute ability modifier
  function abilityMod(score) {
    score = Number(score) || 0;
    return Math.floor((score - 10) / 2);
  }

  // Read effective caster levels and ability scores from state.
  // This function is defensive: it tries common locations and allows overrides.
  function readFromState(state) {
    // Default fallback values
    const out = {
      sorcererLevel: null,
      wizardLevel: null,
      sorCha: null,
      wizInt: null,
      isWizardSpecialist: false,
      specialistSchool: null
    };

    if (!state) return out;

    // 1) If state.data.general exists and matches earlier app structure, use it
    try {
      const g = state.data && state.data.general;
      if (g) {
        // classes may be stored as g.classes.sorc, g.classes.wiz, g.classes.um, g.classes.inc
        const cls = g.classes || {};
        // Some sheets store effective caster levels separately; try those first
        if (g.effective) {
          out.sorcererLevel = Number(g.effective.sorcerer) || out.sorcererLevel;
          out.wizardLevel = Number(g.effective.wizard) || out.wizardLevel;
        }
        // fallback: compute from class levels and UM rules if present
        if (cls.sorc != null) out.sorcererLevel = Number(cls.sorc) || out.sorcererLevel;
        if (cls.wiz != null) out.wizardLevel = Number(cls.wiz) || out.wizardLevel;
        // If Ultimate Magus (um) exists, some builds add to both; user said UM increases effective sorcerer and wizard
        if (cls.um != null) {
          const um = Number(cls.um) || 0;
          // Many UM rules: UM levels add to both caster progressions; user earlier indicated UM 2 -> sorcerer +2 and wizard +1 (depending on build)
          // We will not guess complex rules; if the sheet provided effective levels, prefer those.
          // Keep raw UM value available for caller to adjust if needed.
          out.umLevels = um;
        }
        // Abilities: g.abilities.str/dex/... or g.abilities.cha.total etc.
        if (g.abilities) {
          const a = g.abilities;
          // try common keys
          out.sorCha = Number(a.cha?.total ?? a.cha?.pointBuy ?? a.cha?.base ?? a.cha) || out.sorCha;
          out.wizInt = Number(a.int?.total ?? a.int?.pointBuy ?? a.int?.base ?? a.int) || out.wizInt;
        }
        // Some sheets store ability totals in top-level fields
        if (!out.sorCha && g.cha != null) out.sorCha = Number(g.cha);
        if (!out.wizInt && g.int != null) out.wizInt = Number(g.int);

        // Specialist info: try g.specialist or g.wizardSpecialist
        if (g.specialist) {
          out.isWizardSpecialist = !!g.specialist.enabled;
          out.specialistSchool = g.specialist.school || out.specialistSchool;
        } else if (g.wizardSpecialist) {
          out.isWizardSpecialist = !!g.wizardSpecialist.enabled;
          out.specialistSchool = g.wizardSpecialist.school || out.specialistSchool;
        }
      }
    } catch (e) {
      // ignore and continue to other heuristics
    }

    // 2) Try state.data.spells or state.data.meta if present
    try {
      const s = state.data && state.data.spells && state.data.spells.meta;
      if (s) {
        if (s.effSorc != null) out.sorcererLevel = Number(s.effSorc);
        if (s.effWiz != null) out.wizardLevel = Number(s.effWiz);
      }
    } catch (e) {}

    // 3) Try top-level state fields (some forks may store them there)
    if (state.sorcererLevel != null) out.sorcererLevel = Number(state.sorcererLevel);
    if (state.wizardLevel != null) out.wizardLevel = Number(state.wizardLevel);
    if (state.cha != null) out.sorCha = Number(state.cha);
    if (state.int != null) out.wizInt = Number(state.int);

    // 4) If still missing, leave null so caller can supply overrides
    return out;
  }

  // Compute bonus vector for a given ability score (0..9)
  function bonusVectorForScore(score) {
    const mod = abilityMod(score);
    if (mod <= 0) return zeroVec();
    const key = String(Math.min(9, mod));
    return cloneVec(bonusMap[key] || zeroVec());
  }

  // Compute final slots for a class side
  // classKey: "sorcerer" or "wizard"
  // casterLevel: integer (effective caster level)
  // abilityScore: integer (Cha for sorc, Int for wiz)
  // returns { base:[], bonus:[], final:[] } arrays length 10
  function computeFinalSlotsFor(classKey, casterLevel, abilityScore) {
    const result = { base: zeroVec(), bonus: zeroVec(), final: zeroVec() };
    if (!classKey || !baseSlots[classKey]) return result;
    casterLevel = Number(casterLevel) || 0;
    abilityScore = Number(abilityScore) || 0;

    // base: lookup exact level; if level > 20, clamp to 20; if <1, return zeros
    const lvlKey = String(Math.max(1, Math.min(20, casterLevel)));
    const base = baseSlots[classKey][lvlKey] ? cloneVec(baseSlots[classKey][lvlKey]) : zeroVec();
    result.base = base;

    // bonus vector from ability
    const bonusVec = bonusVectorForScore(abilityScore);
    // apply only where casterLevel >= minCasterLevelForSpellLevel
    const final = base.slice();
    const bonusApplied = zeroVec();
    for (let L = 1; L <= 9; L++) {
      if (casterLevel >= minCasterLevelForSpellLevel[L]) {
        const add = Number(bonusVec[L] || 0);
        bonusApplied[L] = add;
        final[L] = (final[L] || 0) + add;
      }
    }
    result.bonus = bonusApplied;
    result.final = final;
    return result;
  }

  // Public: compute all slots from state
  // options:
  //   overrides: { sorcererLevel, wizardLevel, sorCha, wizInt }
  //   applySpecialistPreparedBonus: boolean (if true, adds +1 prepared per level for wizard specialist)
  //   specialistSchool: string (optional)
  SlotCalculator.computeAllSlots = function(state, options = {}) {
    const read = readFromState(state);
    const overrides = options.overrides || {};

    const sorcererLevel = Number(overrides.sorcererLevel ?? read.sorcererLevel ?? 0);
    const wizardLevel   = Number(overrides.wizardLevel   ?? read.wizardLevel   ?? 0);
    const sorCha        = Number(overrides.sorCha        ?? read.sorCha        ?? 0);
    const wizInt        = Number(overrides.wizInt        ?? read.wizInt        ?? 0);

    const isSpecialist = Boolean(options.applySpecialistPreparedBonus || read.isWizardSpecialist);
    const specialistSchool = options.specialistSchool || read.specialistSchool || null;

    const sor = computeFinalSlotsFor("sorcerer", sorcererLevel, sorCha);
    const wiz = computeFinalSlotsFor("wizard", wizardLevel, wizInt);

    // preparedCounts: for wizard, prepared counts = wiz.final
    // if specialist and applySpecialistPreparedBonus, add +1 per level to prepared counts (per SRD)
    const prepared = cloneVec(wiz.final);
    if (isSpecialist) {
      for (let L = 0; L <= 9; L++) {
        // SRD specialist gives +1 prepared spell of the specialty school per spell level per day.
        // We add +1 to prepared counts for each level where the wizard can prepare that level.
        // For 0-level, many DMs treat specialty as applying to 0-level too; keep it consistent with your table.
        if (wizardLevel >= minCasterLevelForSpellLevel[L]) {
          prepared[L] = (prepared[L] || 0) + 1;
        }
      }
    }

    return {
      meta: {
        sorcererLevel,
        wizardLevel,
        sorCha,
        wizInt,
        isSpecialist,
        specialistSchool
      },
      sorcerer: sor,
      wizard: wiz,
      wizardPrepared: prepared
    };
  };

  // Convenience: compute and return only arrays for UI
  SlotCalculator.computeArrays = function(state, options = {}) {
    const all = SlotCalculator.computeAllSlots(state, options);
    return {
      sorcererBase: all.sorcerer.base,
      sorcererBonus: all.sorcerer.bonus,
      sorcererFinal: all.sorcerer.final,
      wizardBase: all.wizard.base,
      wizardBonus: all.wizard.bonus,
      wizardFinal: all.wizard.final,
      wizardPrepared: all.wizardPrepared
    };
  };

  // Expose to global
  global.SlotCalculator = SlotCalculator;
})(window);
