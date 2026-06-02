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

    // Prefer a real URL if one exists
    if (spell?.url) {
      const href = String(spell.url).replace(/"/g, "&quot;");
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${name}</a>`;
    }

    // Fallback: normal Google search
    const searchUrl = buildSpellSearchUrl(spell?.name || "");
    return `<a href="${searchUrl}" target="_blank" rel="noopener noreferrer">${name}</a>`;
  }

  function computeSpellCL(spell, options = {}) {
    const meta = options.meta || {};
    const progression = options.progression || null;
    const arcaneSpellPower = Number(options.arcaneSpellPower) || 0;

    // Prefer the progression-aware model if actual progression is supplied.
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

    // Fallback to legacy behavior if progression wasn't supplied.
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
            <th>Spell</th><th>SL</th><th>CL</th><th>DC</th>
            ${showPrep ? "<th>Prep</th>" : ""}
            <th>Type</th><th>F</th><th>E</th>
            <th>Range</th><th>Area</th><th>Damage</th><th>Duration</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((s) => {
            const cl = computeSpellCL(s, {
              meta,
              progression,
              arcaneSpellPower
            });

            const dc = computeSpellDC(s.sl, castingMod);

            const scaled = (
              global.SpellScaling &&
              typeof global.SpellScaling.computeDisplayFields === "function"
            )
              ? global.SpellScaling.computeDisplayFields(s, cl, {
                  sourceText: s.sourceText || ""
                })
              : {
                  rangeText: s.range || "",
                  areaText: s.area || "",
                  damageText: s.damage || "",
                  durationText: s.duration || "",
                  targetsText: s.targets || ""
                };

            const spellCell = renderSpellNameCell(s);

            const anchorId = `${s.mode}:${s.name}:prep`
              .toLowerCase()
              .replace(/\s+/g, "_")
              .replace(/[^a-z0-9:_-]/g, "");

            const prepCell = showPrep
              ? `<td><span class="prep-box" data-ink-anchor="${anchorId}"></span></td>`
              : "";

            return `
              <tr>
                <td>${spellCell}</td>
                <td>${Number(s.sl) || 0}</td>
                <td>${cl}</td>
                <td>${dc}</td>
                ${prepCell}
                <td>${escapeHtml(s.type || "")}</td>
                <td>${s.fire ? "✓" : ""}</td>
                <td>${s.evo ? "✓" : ""}</td>
                <td>${escapeHtml(scaled.rangeText || "")}</td>
                <td>${escapeHtml(scaled.areaText || "")}</td>
                <td>${escapeHtml(scaled.damageText || "")}</td>
                <td>${escapeHtml(scaled.durationText || "")}</td>
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
