// arcaneMath.js
// Shared arcane progression and spell CL helpers.
// Intentionally has NO DOM access, NO app-state mutation, and NO ink logic.

(function (global) {
  const ArcaneMath = {};

  function num(v, fb = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  }

  // -----------------------------
  // Progression / advancement
  // -----------------------------
  // Models Ultimate Magus spellcasting advancement:
  // - UM 1,4,7 -> lower caster level class
  // - other UM levels -> both prepared + spontaneous arcane classes
  function computeProgressionLevels(options = {}) {
    let sorc = num(options.sorcBase);
    let wiz = num(options.wizBase);
    const umLevels = num(options.umLevels);
    const tieBreaker = options.tieBreaker === "sorc" ? "sorc" : "wiz";

    const specialLevels = new Set([1, 4, 7]);

    for (let i = 1; i <= umLevels; i++) {
      if (specialLevels.has(i)) {
        if (sorc < wiz) sorc++;
        else if (wiz < sorc) wiz++;
        else {
          if (tieBreaker === "sorc") sorc++;
          else wiz++;
        }
      } else {
        sorc++;
        wiz++;
      }
    }

    return { sorc, wiz };
  }

  // Arcane Spell Power:
  // +1 at UM 1, +2 at UM 4, +3 at UM 7, +4 at UM 10
  function computeArcaneSpellPower(umLevels, explicitValue = null) {
    const explicit = Number(explicitValue);
    if (Number.isFinite(explicit)) return explicit;

    const um = num(umLevels);
    if (um >= 10) return 4;
    if (um >= 7) return 3;
    if (um >= 4) return 2;
    if (um >= 1) return 1;
    return 0;
  }

  // -----------------------------
  // Spell resolution helpers
  // -----------------------------
  // Recommended layered model:
  // - base CL from relevant progression side
  // - arcane-wide CL bonus
  // - optional broad / tag-specific bonuses
  function computeSpellCasterLevel(spell, options = {}) {
    spell = spell || {};
    const progression = options.progression || { sorc: 0, wiz: 0 };
    const mode = spell.mode === "wiz" ? "wiz" : "sorc";

    let cl = mode === "wiz" ? num(progression.wiz) : num(progression.sorc);

    // Broad arcane CL bonuses (e.g. Arcane Spell Power)
    cl += num(options.arcaneSpellPower);

    // Optional additional bonus buckets
    const bonuses = options.bonuses || {};
    cl += num(bonuses.allArcane);

    if (spell.fire) cl += num(bonuses.fire);
    if (spell.evo) cl += num(bonuses.evocation);
    if (spell.fire && spell.evo) cl += num(bonuses.fireEvocation);

    return cl;
  }

  // Compatibility wrapper for your CURRENT display behavior, if desired.
  // Current app.js behavior was:
  // - wiz CL = wizLevels + umLevels + fire/evo bonus
  // - sorc CL = sorcLevels + umLevels + arcaneSpellPower + fire/evo bonus
  function computeLegacySpellCasterLevel(spell, meta = {}) {
    spell = spell || {};
    const bonusFireEvo = (spell.evo && spell.fire) ? 2 : 0;

    if (spell.mode === "wiz") {
      return num(meta.wizLevels) + num(meta.umLevels) + bonusFireEvo;
    }

    return (
      num(meta.sorcLevels) +
      num(meta.umLevels) +
      num(meta.arcaneSpellpower) +
      bonusFireEvo
    );
  }

  function computeSpellDC(spellLevel, castingMod) {
    return 10 + num(spellLevel) + num(castingMod);
  }

  ArcaneMath.computeProgressionLevels = computeProgressionLevels;
  ArcaneMath.computeArcaneSpellPower = computeArcaneSpellPower;
  ArcaneMath.computeSpellCasterLevel = computeSpellCasterLevel;
  ArcaneMath.computeLegacySpellCasterLevel = computeLegacySpellCasterLevel;
  ArcaneMath.computeSpellDC = computeSpellDC;

  global.ArcaneMath = ArcaneMath;
})(window);
