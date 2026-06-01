// sheetLoader.js
// Pure-ish Google Sheets / CSV helper utilities.
// Intentionally does NOT mutate app state and does NOT touch the DOM.

(function (global) {
  const SheetLoader = {};

  function extractSpreadsheetId(url) {
    const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : null;
  }

  async function fetchCsvViaProxy(sheetId, gid) {
    const url = `/gs/csv?id=${encodeURIComponent(sheetId)}&gid=${encodeURIComponent(gid)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV proxy failed ${res.status}`);
    return await res.text();
  }

  function csvToGrid(csvText) {
    if (typeof XLSX === "undefined") {
      throw new Error("XLSX is not loaded. Ensure xlsx.full.min.js is included before sheetLoader.js.");
    }

    const wb = XLSX.read(csvText, { type: "string" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  }

  SheetLoader.extractSpreadsheetId = extractSpreadsheetId;
  SheetLoader.fetchCsvViaProxy = fetchCsvViaProxy;
  SheetLoader.csvToGrid = csvToGrid;

  global.SheetLoader = SheetLoader;
})(window);
