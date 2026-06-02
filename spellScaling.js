// spellScaling.js
// Safe spell scaling helper.
// Pure logic only: no DOM, no app-state mutation, no network calls.
// Uses current CL + spell row text (and optional extra source text) to compute
// display-ready spell fields such as range, damage, duration, etc.

(function (global) {
  const SpellScaling = {};

  function num(v, fb = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

function computeCastingTimeText(spell, cl, options = {}) {
  const raw = cleanText(spell?.castingTime || "");

  // Default for your current spell list
  if (!raw) {
    return "Standard Action";
  }

  return raw;
}

  function cleanText(s) {
    return String(s || "")
      .replace(/\u2013|\u2014/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function titleCase(s) {
    s = String(s || "");
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function getSourceText(spell, options = {}) {
    const parts = [
      spell?.range,
      spell?.area,
      spell?.damage,
      spell?.duration,
      spell?.notes,
      options.sourceText
    ].filter(Boolean);

    return cleanText(parts.join(" | "));
  }

  /* ----------------------------------------------------------------------
     RANGE
     Supports:
     - Close
     - Medium
     - Long
     - explicit formulas like:
       "400 ft. + 40 ft./level"
       "100 ft. + 10 ft./level"
       "25 ft. + 5 ft./2 levels"
     ---------------------------------------------------------------------- */

  function computeStandardRangeFeet(label, cl) {
    const x = String(label || "").toLowerCase();
    cl = Math.max(0, num(cl, 0));

    if (x === "close") {
      return 25 + 5 * Math.floor(cl / 2);
    }
    if (x === "medium") {
      return 100 + 10 * cl;
    }
    if (x === "long") {
      return 400 + 40 * cl;
    }

    return null;
  }
/* ----------------------------------------------------------------------
   RANGE
   Conservative parsing:
   - prefer the spell row's own range field if it contains a real range rule
   - otherwise extract only the actual "Range:" field from source text
   - do NOT scan the whole spell body for range-like numbers
---------------------------------------------------------------------- */

function computeStandardRangeFeet(label, cl) {
  const x = String(label || "").toLowerCase();
  cl = Math.max(0, num(cl, 0));

  if (x === "close") {
    return 25 + 5 * Math.floor(cl / 2);
  }
  if (x === "medium") {
    return 100 + 10 * cl;
  }
  if (x === "long") {
    return 400 + 40 * cl;
  }

  return null;
}

function extractRangeFieldFromSourceText(sourceText) {
  const text = cleanText(sourceText || "");
  if (!text) return "";

  // Try to isolate the actual Range field from the structured spell text.
  // Stop at the next common field name.
  const m = text.match(
    /Range:\s*(.+?)(?=\s+(?:Area:|Effect:|Target:|Targets:|Duration:|Saving Throw:|Spell Resistance:|Description:|You\b))/i
  );

  return m ? cleanText(m[1]) : "";
}

function parseRangeRuleFromText(text) {
  text = cleanText(text || "");
  if (!text) return null;

  // Standard named ranges
  const stdMatch = text.match(/\b(Close|Medium|Long)\b/i);
  if (stdMatch) {
    return {
      kind: "standardRange",
      label: titleCase(stdMatch[1])
    };
  }

  // Explicit numeric formulas:
  // e.g. 400 ft. + 40 ft./level
  // e.g. 25 ft. + 5 ft./2 levels
  const m = text.match(/(\d+)\s*ft\.?\s*\+\s*(\d+)\s*ft\.?\/\s*(level|caster level|2 levels)/i);
  if (m) {
    return {
      kind: "linearFeet",
      baseFeet: num(m[1]),
      feetPerStep: num(m[2]),
      levelsPerStep: /2 levels/i.test(m[3]) ? 2 : 1
    };
  }

  return null;
}

function parseRangeRule(rangeText, sourceText) {
  const raw = cleanText(rangeText || "");

  // First: trust the spell row's range field if it itself contains a scalable rule.
  let rule = parseRangeRuleFromText(raw);
  if (rule) return rule;

  // Second: if the row field is flattened (e.g. "800 ft"), try the actual Range: field from source text.
  const sourceRange = extractRangeFieldFromSourceText(sourceText);
  rule = parseRangeRuleFromText(sourceRange);
  if (rule) return rule;

  return null;
}

function computeRangeText(spell, cl, options = {}) {
  const raw = cleanText(spell?.range || "");
  const sourceText = getSourceText(spell, options);
  const rule = parseRangeRule(raw, sourceText);

  if (!rule) {
    return raw;
  }

  if (rule.kind === "standardRange") {
    const feet = computeStandardRangeFeet(rule.label, cl);
    if (feet != null) {
      return `${rule.label} (${feet} ft.)`;
    }
  }

  if (rule.kind === "linearFeet") {
    const steps = rule.levelsPerStep === 2 ? Math.floor(cl / 2) : cl;
    const feet = rule.baseFeet + rule.feetPerStep * steps;
    return `${feet} ft.`;
  }

  return raw;
}

  /* ----------------------------------------------------------------------
     DAMAGE
     Supports:
     - XdY per caster level (maximum ZdY)
     - XdY per level (maximum ZdY)
     - multiplier-based projectile counts in damage box:
       - Scorching Ray => 1*4d6 / 2*4d6 / 3*4d6
       - Magic Missile => 1*1d4+1 ... 5*1d4+1
     ---------------------------------------------------------------------- */

  function stripLeadingMultiplier(rawDamage) {
    return cleanText(String(rawDamage || "").replace(/^\s*\d+\s*\*\s*/, ""));
  }

  function parseDamageRule(damageText, sourceText) {
    const text = cleanText(`${damageText || ""} | ${sourceText || ""}`);
    const rawDamage = cleanText(damageText || "");

    // Fireball-style:
    // 1d6 points of fire damage per caster level (maximum 10d6)
    let m = text.match(/(\d+)d(\d+)[^|]*?per\s+(?:caster\s+)?level[^|]*?maximum\s+(\d+)d(\d+)/i);
    if (m) {
      return {
        kind: "dicePerLevel",
        dicePerLevel: num(m[1]),
        dieSize: num(m[2]),
        maxDice: num(m[3]),
        maxDieSize: num(m[4])
      };
    }

    // Looser version:
    // 1d6/level (max 10d6)
    m = text.match(/(\d+)d(\d+)\s*\/\s*level[^|]*?max(?:imum)?\s*\(?\s*(\d+)d(\d+)/i);
    if (m) {
      return {
        kind: "dicePerLevel",
        dicePerLevel: num(m[1]),
        dieSize: num(m[2]),
        maxDice: num(m[3]),
        maxDieSize: num(m[4])
      };
    }

    // Scorching Ray:
    // one ray, plus one additional ray for every four levels beyond 3rd
    // (to a maximum of three rays at 11th level)
    if (/additional ray/i.test(text) && /maximum of three rays at 11th level/i.test(text)) {
      return {
        kind: "multishotDamage",
        shotType: "scorchingRay",
        baseDamage: stripLeadingMultiplier(rawDamage) || "4d6"
      };
    }

    // Magic Missile:
    // additional missile ... maximum of five missiles at 9th level or higher
    if (/additional missile/i.test(text) && /maximum of five missiles at 9th level/i.test(text)) {
      return {
        kind: "multishotDamage",
        shotType: "magicMissile",
        baseDamage: stripLeadingMultiplier(rawDamage) || "1d4+1"
      };
    }

    return null;
  }

  function scorchingRayCount(cl) {
    cl = Math.max(0, num(cl, 0));
    if (cl >= 11) return 3;
    if (cl >= 7) return 2;
    return 1;
  }

  function magicMissileCount(cl) {
    cl = Math.max(0, num(cl, 0));
    if (cl >= 9) return 5;
    if (cl >= 7) return 4;
    if (cl >= 5) return 3;
    if (cl >= 3) return 2;
    return 1;
  }

  function computeDamageText(spell, cl, options = {}) {
    const raw = cleanText(spell?.damage || "");
    const sourceText = getSourceText(spell, options);
    const rule = parseDamageRule(raw, sourceText);

    if (!rule) {
      return raw;
    }

    if (rule.kind === "dicePerLevel") {
      const totalDice = clamp(rule.dicePerLevel * cl, 0, rule.maxDice);
      return `${totalDice}d${rule.dieSize}`;
    }

    if (rule.kind === "multishotDamage") {
      let count = 1;

      if (rule.shotType === "scorchingRay") {
        count = scorchingRayCount(cl);
      } else if (rule.shotType === "magicMissile") {
        count = magicMissileCount(cl);
      }

      return `${count}*${rule.baseDamage}`;
    }

    return raw;
  }

  /* ----------------------------------------------------------------------
     TARGET / COUNT TEXT
     First pass still available, but not required for your current UI.
     ---------------------------------------------------------------------- */

  function parseTargetsRule(targetsText, sourceText) {
    const text = cleanText(`${targetsText || ""} | ${sourceText || ""}`);

    if (/additional missile/i.test(text) && /maximum of five missiles/i.test(text)) {
      return {
        kind: "magicMissileStyle"
      };
    }

    return null;
  }

  function computeTargetsText(spell, cl, options = {}) {
    const raw = cleanText(spell?.targets || "");
    const sourceText = getSourceText(spell, options);
    const rule = parseTargetsRule(raw, sourceText);

    if (!rule) {
      return raw;
    }

    if (rule.kind === "magicMissileStyle") {
      const missiles = magicMissileCount(cl);
      return `${missiles} missile${missiles === 1 ? "" : "s"}`;
    }

    return raw;
  }

  /* ----------------------------------------------------------------------
     DURATION
     Supports:
     - Instantaneous
     - N round/level
     - N rounds/level
     - N min./level
     - N minute/level
     - N hour/level
     ---------------------------------------------------------------------- */

  function parseDurationRule(durationText, sourceText) {
    const text = cleanText(`${durationText || ""} | ${sourceText || ""}`);

    if (/instantaneous/i.test(text)) {
      return { kind: "fixed", value: "Instantaneous" };
    }

    const m = text.match(/(\d+)\s*(round|rounds|min\.?|minute|minutes|hour|hours)\s*\/\s*(?:caster\s+)?level/i);
    if (m) {
      return {
        kind: "durationPerLevel",
        amountPerLevel: num(m[1]),
        unit: m[2].toLowerCase()
      };
    }

    return null;
  }

  function normalizeDurationUnit(unit, total) {
    const u = String(unit || "").toLowerCase();

    if (u === "round" || u === "rounds") {
      return `${total} round${total === 1 ? "" : "s"}`;
    }
    if (u === "min" || u === "min." || u === "minute" || u === "minutes") {
      return `${total} minute${total === 1 ? "" : "s"}`;
    }
    if (u === "hour" || u === "hours") {
      return `${total} hour${total === 1 ? "" : "s"}`;
    }

    return `${total} ${unit}`;
  }

  function computeDurationText(spell, cl, options = {}) {
    const raw = cleanText(spell?.duration || "");
    const sourceText = getSourceText(spell, options);
    const rule = parseDurationRule(raw, sourceText);

    if (!rule) {
      return raw;
    }

    if (rule.kind === "fixed") {
      return rule.value;
    }

    if (rule.kind === "durationPerLevel") {
      const total = rule.amountPerLevel * Math.max(0, num(cl, 0));
      return normalizeDurationUnit(rule.unit, total);
    }

    return raw;
  }

  /* ----------------------------------------------------------------------
     AREA
     First pass: keep original unless a very simple scaling pattern is found.
     ---------------------------------------------------------------------- */

  function parseAreaRule(areaText, sourceText) {
    const text = cleanText(`${areaText || ""} | ${sourceText || ""}`);

    const m = text.match(/(\d+)\s*ft\.?-radius[^|]*?\/\s*(?:caster\s+)?level/i);
    if (m) {
      return {
        kind: "radiusPerLevel",
        feetPerLevel: num(m[1])
      };
    }

    return null;
  }

  function computeAreaText(spell, cl, options = {}) {
    const raw = cleanText(spell?.area || "");
    const sourceText = getSourceText(spell, options);
    const rule = parseAreaRule(raw, sourceText);

    if (!rule) {
      return raw;
    }

    if (rule.kind === "radiusPerLevel") {
      const radius = rule.feetPerLevel * Math.max(0, num(cl, 0));
      return `${radius}-ft.-radius`;
    }

    return raw;
  }

  /* ----------------------------------------------------------------------
     PUBLIC COMPOSER
     ---------------------------------------------------------------------- */


function computeDisplayFields(spell, cl, options = {}) {
  return {
    cl: num(cl, 0),
    castingTimeText: computeCastingTimeText(spell, cl, options),
    rangeText: computeRangeText(spell, cl, options),
    areaText: computeAreaText(spell, cl, options),
    damageText: computeDamageText(spell, cl, options),
    durationText: computeDurationText(spell, cl, options),
    targetsText: computeTargetsText(spell, cl, options)
  };
}


  SpellScaling.computeDisplayFields = computeDisplayFields;

  global.SpellScaling = SpellScaling;
})(window);
