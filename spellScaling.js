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

  function extractStructuredField(sourceText, labels) {
    const text = cleanText(sourceText || "");
    if (!text) return "";

    const labelPattern = Array.isArray(labels)
      ? labels.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
      : String(labels).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Stop before the next common spell field
    const stopPattern =
      "(?:School:|Level:|Components:|Casting Time:|Range:|Area:|Effect:|Target:|Targets:|Duration:|Saving Throw:|Spell Resistance:|Description:|You\\b|Comments\\b|Complete list\\b)";

    const re = new RegExp(`(?:${labelPattern}):\\s*(.+?)(?=\\s+${stopPattern}|$)`, "i");
    const m = text.match(re);
    return m ? cleanText(m[1]) : "";
  }

  function extractLevelField(sourceText) {
    return extractStructuredField(sourceText, "Level");
  }

  function extractCastingTimeField(sourceText) {
    return extractStructuredField(sourceText, "Casting Time");
  }

  function extractRangeField(sourceText) {
    return extractStructuredField(sourceText, "Range");
  }

  function extractAreaField(sourceText) {
    return extractStructuredField(sourceText, ["Area", "Effect", "Target", "Targets"]);
  }

  function extractDurationField(sourceText) {
    return extractStructuredField(sourceText, "Duration");
  }

  function extractSavingThrowField(sourceText) {
    return extractStructuredField(sourceText, "Saving Throw");
  }

  function extractSchoolAndDescriptor(sourceText) {
    const text = cleanText(sourceText || "");
    if (!text) {
      return { school: "", descriptor: "" };
    }

    const m = text.match(
      /\b(Abjuration|Conjuration|Divination|Enchantment|Evocation|Illusion|Necromancy|Transmutation|Universal)\b(?:\s*\[([^\]]+)\])?\s+Level:/i
    );

    return {
      school: m ? titleCase(m[1]) : "",
      descriptor: m ? cleanText(m[2] || "") : ""
    };
  }

  function inferSpellLevel(spell, options = {}) {
    const explicit = Number(spell?.sl);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;

    const sourceText = getSourceText(spell, options);
    const levelField = extractLevelField(sourceText);
    if (!levelField) return 0;

    const mode = String(spell?.mode || "").toLowerCase();

    const candidates =
      mode === "wiz"
        ? [/wizard\s+(\d+)/i, /sor\/wiz\s+(\d+)/i]
        : [/sorcerer\s+(\d+)/i, /sor\/wiz\s+(\d+)/i];

    for (const re of candidates) {
      const m = levelField.match(re);
      if (m) return num(m[1], 0);
    }

    return 0;
  }

  function inferSpellTags(spell, options = {}) {
    const sourceText = getSourceText(spell, options);
    const sd = extractSchoolAndDescriptor(sourceText);

    const evo = spell?.evo === true || sd.school.toLowerCase() === "evocation";
    const fire =
      spell?.fire === true ||
      /\bfire\b/i.test(sd.descriptor) ||
      /\bfire\b/i.test(sourceText);

    return { evo, fire };
  }

  function inferSpellType(spell, options = {}) {
    const rawType = cleanText(spell?.type || "");
    if (rawType) return rawType;

    const sourceText = getSourceText(spell, options);
    const saveText = extractSavingThrowField(sourceText).toLowerCase();
    const areaText = extractAreaField(sourceText).toLowerCase();

    if (/\bray\b/i.test(sourceText) || /\bray\b/i.test(areaText)) {
      return saveText && !saveText.startsWith("none") ? "RAY SAVE" : "RAY";
    }

    if (areaText) {
      return saveText && !saveText.startsWith("none") ? "AOE SAVE" : "AOE";
    }

    if (/target/i.test(sourceText) || /targets/i.test(sourceText)) {
      return saveText && !saveText.startsWith("none") ? "TARGET SAVE" : "TARGET";
    }

    return "";
  }

  function inferFixedDamageTextFromSource(sourceText) {
    const text = cleanText(sourceText || "");
    if (!text) return "";

    // Fixed damage e.g. "deals 4d6 points of fire damage"
    let m = text.match(/deals\s+(\d+d\d+(?:\+\d+)?)\s+points?/i);
    if (m) return m[1];

    // e.g. "1d6 points of fire damage per caster level (maximum 10d6)"
    m = text.match(/(\d+d\d+)\s+points?[^|]*?per\s+(?:caster\s+)?level[^|]*?maximum\s+(\d+d\d+)/i);
    if (m) {
      return `${m[1]}/level (max ${m[2]})`;
    }

    return "";
  }

  /* ----------------------------------------------------------------------
     CASTING TIME
  ---------------------------------------------------------------------- */

  function computeCastingTimeText(spell, cl, options = {}) {
    const raw = cleanText(spell?.castingTime || "");
    if (raw) return raw;

    const sourceText = getSourceText(spell, options);
    const sourceField = extractCastingTimeField(sourceText);
    if (sourceField) return sourceField;

    return "Standard Action";
  }

  /* ----------------------------------------------------------------------
     RANGE
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

  function parseRangeRuleFromText(text) {
    text = cleanText(text || "");
    if (!text) return null;

    const stdMatch = text.match(/\b(Close|Medium|Long)\b/i);
    if (stdMatch) {
      return {
        kind: "standardRange",
        label: titleCase(stdMatch[1])
      };
    }

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
    let rule = parseRangeRuleFromText(raw);
    if (rule) return rule;

    const sourceRange = extractRangeField(sourceText);
    rule = parseRangeRuleFromText(sourceRange);
    if (rule) return rule;

    return null;
  }

  function computeRangeText(spell, cl, options = {}) {
    const raw = cleanText(spell?.range || "");
    const sourceText = getSourceText(spell, options);
    const sourceRange = extractRangeField(sourceText);
    const rule = parseRangeRule(raw, sourceText);

    if (!rule) {
      return raw || sourceRange;
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

    return raw || sourceRange;
  }

  /* ----------------------------------------------------------------------
     DAMAGE
  ---------------------------------------------------------------------- */

  function stripLeadingMultiplier(rawDamage) {
    return cleanText(String(rawDamage || "").replace(/^\s*\d+\s*\*\s*/, ""));
  }

function parseDamageRule(damageText, sourceText) {
  const text = cleanText(`${damageText || ""} | ${sourceText || ""}`);
  const rawDamage = cleanText(damageText || "");

  // Fireball-style:
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

  // Scorching Ray
  if (/additional ray/i.test(text) && /maximum of three rays at 11th level/i.test(text)) {
    return {
      kind: "multishotDamage",
      shotType: "scorchingRay",
      baseDamage: stripLeadingMultiplier(rawDamage) || "4d6"
    };
  }

  // Magic Missile
  if (/additional missile/i.test(text) && /maximum of five missiles at 9th level/i.test(text)) {
    return {
      kind: "multishotDamage",
      shotType: "magicMissile",
      baseDamage: stripLeadingMultiplier(rawDamage) || "1d4+1"
    };
  }

  // Melf's Unicorn Arrow
  if (/additional unicorn arrow/i.test(text) && /\b1d8\+8\b/i.test(text)) {
    return {
      kind: "multishotDamage",
      shotType: "unicornArrow",
      baseDamage: stripLeadingMultiplier(rawDamage) || "1d8+8"
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

function unicornArrowCount(cl) {
  cl = Math.max(0, num(cl, 0));
  return clamp(1 + Math.floor(Math.max(0, cl - 5) / 3), 1, 5);
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
    return raw || inferFixedDamageTextFromSource(sourceText);
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
    } else if (rule.shotType === "unicornArrow") {
      count = unicornArrowCount(cl);
    }

    return `${count}*${rule.baseDamage}`;
  }

  return raw || inferFixedDamageTextFromSource(sourceText);
}

  /* ----------------------------------------------------------------------
     TARGET / COUNT TEXT
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
    const sourceField = extractDurationField(sourceText);
    const rule = parseDurationRule(raw, sourceText);

    if (!rule) {
      return raw || sourceField;
    }

    if (rule.kind === "fixed") {
      return rule.value;
    }

    if (rule.kind === "durationPerLevel") {
      const total = rule.amountPerLevel * Math.max(0, num(cl, 0));
      return normalizeDurationUnit(rule.unit, total);
    }

    return raw || sourceField;
  }

  /* ----------------------------------------------------------------------
     AREA
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
function compactTargetLikeText(text, cl) {
  text = cleanText(text || "");
  if (!text) return "";

  // Haste:
  // "One creature/level, no two of which can be more than 30 ft. apart"
  let m = text.match(/One creature\/level,\s*no two of which can be more than (\d+)\s*ft\.?\s*apart/i);
  if (m) {
    const count = Math.max(1, num(cl, 0));
    return `${count} targets, <-> ${m[1]} ft`;
  }

  // Melf's Unicorn Arrow:
  // "One creature or up to five creatures, no two of which are more than 15 ft. apart"
  m = text.match(/One creature or up to five creatures,\s*no two of which are more than (\d+)\s*ft\.?\s*apart/i);
  if (m) {
    const count = unicornArrowCount(cl);
    return `1-${count} targets, <-> ${m[1]} ft`;
  }

  return text;
}

function computeAreaText(spell, cl, options = {}) {
  const raw = cleanText(spell?.area || "");
  const sourceText = getSourceText(spell, options);
  const sourceField = extractAreaField(sourceText);
  const rule = parseAreaRule(raw, sourceText);

  if (!rule) {
    return compactTargetLikeText(raw || sourceField, cl);
  }

  if (rule.kind === "radiusPerLevel") {
    const radius = rule.feetPerLevel * Math.max(0, num(cl, 0));
    return `${radius}-ft.-radius`;
  }

  return compactTargetLikeText(raw || sourceField, cl);
}

  /* ----------------------------------------------------------------------
     PUBLIC API
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
  SpellScaling.inferSpellLevel = inferSpellLevel;
  SpellScaling.inferSpellTags = inferSpellTags;
  SpellScaling.inferSpellType = inferSpellType;
  SpellScaling.extractSavingThrowField = extractSavingThrowField;

  global.SpellScaling = SpellScaling;
})(window);
