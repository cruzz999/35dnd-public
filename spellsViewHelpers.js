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

  function computeSpellCL(spell, meta) {
    if (
      global.ArcaneMath &&
      typeof global.ArcaneMath.computeLegacySpellCasterLevel === "function"
    ) {
      return global.ArcaneMath.computeLegacySpellCasterLevel(spell, meta || {});
    }

    // Safe compatibility fallback if ArcaneMath is not available.
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
            const cl = computeSpellCL(s, meta);
            const dc = computeSpellDC(s.sl, castingMod);

            const spellCell = s.url
              ? `<a href="${String(s.url).replace(/"/g, "&quot;")}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)}</a>`
            : escapeHtml(s.name);


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
                <td>${escapeHtml(s.range || "")}</td>
                <td>${escapeHtml(s.area || "")}</td>
                <td>${escapeHtml(s.damage || "")}</td>
                <td>${escapeHtml(s.duration || "")}</td>
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
