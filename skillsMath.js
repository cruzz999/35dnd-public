// skillsMath.js
// Pure skills computation helpers.
// No DOM, no state mutation, no rendering side effects.

(function (global) {
  const SkillsMath = {};

  const ACP_SKILLS = new Set([
    "Balance",
    "Climb",
    "Escape Artist",
    "Hide",
    "Jump",
    "Move Silently",
    "Sleight of Hand",
    "Tumble"
  ]);

  function num(v, fb = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  }

  function normalizeAbilityCode(code) {
    const x = String(code || "").trim().toLowerCase();
    if (x === "str") return "str";
    if (x === "dex") return "dex";
    if (x === "con") return "con";
    if (x === "int") return "int";
    if (x === "wis") return "wis";
    if (x === "cha") return "cha";
    return null;
  }

  function getAbilityModifier(general, abilityCode) {
    if (!general || !global.GeneralDerived) return 0;
    const derived = global.GeneralDerived.compute(general);
    const key = normalizeAbilityCode(abilityCode);
    if (!key) return 0;
    return num(derived?.abilities?.[key]?.mod, 0);
  }

  function getRaceBonusForSkill(skillName, raceText) {
    const race = String(raceText || "").toLowerCase();

    // Your sheet/current character uses the half-elf package:
    // +2 Diplomacy, +2 Gather Information, +1 Listen/Search/Spot
    if (race.includes("half") && race.includes("elf")) {
      if (skillName === "Diplomacy") return 2;
      if (skillName === "Gather Information") return 2;
      if (skillName === "Listen") return 1;
      if (skillName === "Search") return 1;
      if (skillName === "Spot") return 1;
    }

    return 0;
  }

  function getArmorCheckPenaltyForSkill(skillName, baseAcp = 0) {
    const acp = num(baseAcp, 0);

    if (skillName === "Swim") return acp * 2;
    if (ACP_SKILLS.has(skillName)) return acp;

    return 0;
  }

  function computeSkillRows(parsedRows, general, editsBySkillName = {}, options = {}) {
    const rows = Array.isArray(parsedRows) ? parsedRows : [];
    const raceText = general?.race || "";
    const baseAcp = num(options.baseAcp, 0);

    return rows.map((row) => {
      const edit = editsBySkillName[row.name] || {};

      const rank = edit.rank != null ? num(edit.rank, 0) : num(row.rank, 0);
      const misc = edit.misc != null ? num(edit.misc, 0) : num(row.misc, 0);

      const abilityMod = getAbilityModifier(general, row.ability);
      const acp = getArmorCheckPenaltyForSkill(row.name, baseAcp);
      const raceBonus = getRaceBonusForSkill(row.name, raceText);

      const total = rank + abilityMod + misc + acp + raceBonus;

      return {
        name: row.name,
        ability: row.ability,
        total,
        abilityMod,
        rank,
        misc,
        acp,
        raceBonus,

        // keep originals around for debugging if needed
        sheetTotal: num(row.sheetTotal, 0),
        sheetAbilityMod: num(row.sheetAbilityMod, 0),
        sheetAcp: num(row.sheetAcp, 0),
        sheetRaceBonus: num(row.sheetRaceBonus, 0)
      };
    });
  }

  SkillsMath.computeSkillRows = computeSkillRows;
  SkillsMath.getArmorCheckPenaltyForSkill = getArmorCheckPenaltyForSkill;
  SkillsMath.getRaceBonusForSkill = getRaceBonusForSkill;

  global.SkillsMath = SkillsMath;
})(window);
