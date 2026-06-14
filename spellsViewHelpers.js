// spellsViewHelpers.js
// Safe rendering helper extraction for spell tables.
// Intentionally does NOT mutate app state, bind events, or touch DOM directly.
// It only returns HTML strings.

(function (global) {
  const SpellsViewHelpers = {};

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    }[m]));
  }

  function computeSpellDC(spellLevel, castingMod) {
    if (
      global.ArcaneMath &&
      typeof global.ArcaneMath.computeSpellDC === "function"
    ) {
      return global.ArcaneMath.computeSpellDC(spellLevel, castingMod);
    }

    return 10 + (Number(spellLevel) || 0) + (Number(castingMod) || 0);
  }

  function buildSpellSearchUrl(spellName) {
    const query = `site:dnd.arkalseif.info ${String(spellName || "").trim()}`;
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  }

  function renderSpellNameCell(spell) {
    const name = escapeHtml(spell?.name || "");

    if (spell?.url) {
      const href = String(spell.url).replace(/"/g, "&quot;");
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${name}</a>`;
    }

    const searchUrl = buildSpellSearchUrl(spell?.name || "");
    return `<a href="${searchUrl}" target="_blank" rel="noopener noreferrer">${name}</a>`;
  }

  function computeSpellCL(spell, options = {}) {
    const meta = options.meta || {};
    const progression = options.progression || null;
    const arcaneSpellPower = Number(options.arcaneSpellPower) || 0;

    if (
      progression &&
      global.ArcaneMath &&
      typeof global.ArcaneMath.computeSpellCasterLevel === "function"
    ) {
      return global.ArcaneMath.computeSpellCasterLevel(spell, {
        progression,
        arcaneSpellPower,
        bonuses: {
          allArcane: 0,
          fire: 0,
          evocation: 0,
          fireEvocation: (spell.evo && spell.fire) ? 2 : 0
        }
      });
    }

    if (
      global.ArcaneMath &&
      typeof global.ArcaneMath.computeLegacySpellCasterLevel === "function"
    ) {
      return global.ArcaneMath.computeLegacySpellCasterLevel(spell, meta || {});
    }

    const bonusFireEvo = (spell.evo && spell.fire) ? 2 : 0;

    if (spell.mode === "wiz") {
      return (Number(meta?.wizLevels) || 0) + (Number(meta?.umLevels) || 0) + bonusFireEvo;
    }

    return (
      (Number(meta?.sorcLevels) || 0) +
      (Number(meta?.umLevels) || 0) +
      (Number(meta?.arcaneSpellpower) || 0) +
      bonusFireEvo
    );
  }

  function cleanText(s) {
    return String(s || "")
      .replace(/\u2013|\u2014/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractSavingThrowText(spell) {
    if (spell?.savingThrow) {
      return cleanText(spell.savingThrow);
    }

    if (
      global.SpellScaling &&
      typeof global.SpellScaling.extractSavingThrowField === "function"
    ) {
      const derived = global.SpellScaling.extractSavingThrowField(spell?.sourceText || "");
      if (derived) return cleanText(derived);
    }

    const sourceText = cleanText(spell?.sourceText || "");
    if (!sourceText) return "";

    const m = sourceText.match(
      /Saving Throw:\s*(.+?)(?=\s+(?:Spell Resistance:|Description:|You\b|Comments\b|Complete list\b))/i
    );

    return m ? cleanText(m[1]) : "";
  }

  function abbreviateSaveType(saveText) {
    const t = cleanText(saveText).toLowerCase();

    if (!t) return "";
    if (t.startsWith("reflex")) return "Ref";
    if (t.startsWith("will")) return "Will";
    if (t.startsWith("fortitude")) return "Fort";
    if (t.startsWith("none")) return "None";

    return saveText;
  }

  function renderDcCell(spell, dc) {
    const saveText = extractSavingThrowText(spell);
    const saveAbbr = abbreviateSaveType(saveText);

    if (!saveAbbr || saveAbbr === "None") {
      return "—";
    }

    return `${escapeHtml(saveAbbr)} ${dc}`;
  }

  function enrichSpellForRender(spell, options = {}) {
    const sourceText = spell?.sourceText || "";

    let inferredLevel = Number(spell?.sl) || 0;
    let inferredType = cleanText(spell?.type || "");
    let inferredFire = !!spell?.fire;
    let inferredEvo = !!spell?.evo;

    if (global.SpellScaling) {
      if (typeof global.SpellScaling.inferSpellLevel === "function") {
        inferredLevel = global.SpellScaling.inferSpellLevel(spell, { sourceText }) || inferredLevel;
      }

      if (typeof global.SpellScaling.inferSpellTags === "function") {
        const tags = global.SpellScaling.inferSpellTags(spell, { sourceText }) || {};
        inferredFire = !!tags.fire;
        inferredEvo = !!tags.evo;
      }

      if (typeof global.SpellScaling.inferSpellType === "function") {
        inferredType = global.SpellScaling.inferSpellType(spell, { sourceText }) || inferredType;
      }
    }

    return {
      ...spell,
      sl: inferredLevel,
      type: inferredType,
      fire: inferredFire,
      evo: inferredEvo
    };
  }

  function renderSpellTable(options = {}) {
    const rows = options.rows || [];
    const meta = options.meta || {};
    const progression = options.progression || null;
    const arcaneSpellPower = Number(options.arcaneSpellPower) || 0;
    const castingMod = Number(options.castingMod) || 0;
    const showPrep = !!options.showPrep;

    if (!rows.length) {
      return `<div class="hint">No spells loaded.</div>`;
    }

    return `
      <table class="table">
        <thead>
          <tr>
            ${showPrep ? "<th>Prep</th>" : ""}
            <th>Spell</th>
            <th>SL</th>
            <th>CL</th>
            <th>DC</th>
            <th>Type</th>
            <th>F</th>
            <th>E</th>
            <th>Range</th>
            <th>Area</th>
            <th>Damage</th>
            <th>Duration</th>
            <th>Casting Time</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((s) => {
            const enriched = enrichSpellForRender(s, { sourceText: s.sourceText || "" });

            const cl = computeSpellCL(enriched, {
              meta,
              progression,
              arcaneSpellPower
            });

            const dc = computeSpellDC(enriched.sl, castingMod);

            const scaled = (
              global.SpellScaling &&
              typeof global.SpellScaling.computeDisplayFields === "function"
            )
              ? global.SpellScaling.computeDisplayFields(enriched, cl, {
                  sourceText: enriched.sourceText || ""
                })
              : {
                  castingTimeText: enriched.castingTime || "Standard Action",
                  rangeText: enriched.range || "",
                  areaText: enriched.area || "",
                  damageText: enriched.damage || "",
                  durationText: enriched.duration || "",
                  targetsText: enriched.targets || ""
                };

            const spellCell = renderSpellNameCell(enriched);

            const anchorId = `${enriched.mode}:${enriched.name}:prep`
              .toLowerCase()
              .replace(/\s+/g, "_")
              .replace(/[^a-z0-9:_-]/g, "");

            const prepCell = showPrep
              ? `<td><span class="prep-box" data-ink-anchor="${anchorId}"></span></td>`
              : "";

            return `
              <tr>
                ${prepCell}
                <td>${spellCell}</td>
                <td>${Number(enriched.sl) || 0}</td>
                <td>${cl}</td>
                <td>${renderDcCell(enriched, dc)}</td>
                <td>${escapeHtml(enriched.type || "")}</td>
                <td>${enriched.fire ? "✓" : ""}</td>
                <td>${enriched.evo ? "✓" : ""}</td>
                <td>${escapeHtml(scaled.rangeText || "")}</td>
                <td>${escapeHtml(scaled.areaText || "")}</td>
                <td>${escapeHtml(scaled.damageText || "")}</td>
                <td>${escapeHtml(scaled.durationText || "")}</td>
                <td>${escapeHtml(scaled.castingTimeText || "Standard Action")}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  SpellsViewHelpers.renderSpellTable = renderSpellTable;

  global.SpellsViewHelpers = SpellsViewHelpers;
})(window);
