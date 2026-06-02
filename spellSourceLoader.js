// spellSourceLoader.js
// Fetches spell page source text (via same-origin proxy), caches it locally,
// and attaches it to spell rows as `sourceText`.
//
// Pure data-loader layer: no DOM mutation, no rendering logic, no ink logic.

(function (global) {
  const SpellSourceLoader = {};

  const CACHE_PREFIX = "spell.source.v1:";
  const DEFAULT_PROXY_BASE = "/spell/source?url=";

  function cleanText(s) {
    return String(s || "")
      .replace(/\u2013|\u2014/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeUrl(url) {
    return String(url || "").trim();
  }

  function cacheKeyForUrl(url) {
    return CACHE_PREFIX + encodeURIComponent(normalizeUrl(url));
  }

  function readCache(url) {
    const key = cacheKeyForUrl(url);

    if (typeof global.AppStorage !== "undefined") {
      const cached = global.AppStorage.readString?.(key, "") || "";
      return cached || "";
    }

    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function writeCache(url, text) {
    const key = cacheKeyForUrl(url);
    const safe = String(text || "");

    if (typeof global.AppStorage !== "undefined") {
      if (typeof global.AppStorage.writeString === "function") {
        global.AppStorage.writeString(key, safe);
        return;
      }
      if (typeof global.AppStorage.writeJson === "function") {
        global.AppStorage.writeJson(key, safe);
        return;
      }
    }

    try {
      localStorage.setItem(key, safe);
    } catch {}
  }

  function extractUsefulTextFromHtml(html) {
    const doc = new DOMParserString(String(html || ""), "text/html");

    doc.querySelectorAll("script, style, noscript").forEach((el) => el.remove());

    const bodyText = doc.body ? doc.body.textContent : html;
    return cleanText(bodyText);
  }

  function normalizeFetchedText(rawText, data = null) {
    // Preferred JSON contract: { text: "..." }
    if (data && typeof data.text === "string") {
      return cleanText(data.text);
    }

    // Alternate JSON contract: { html: "..." }
    if (data && typeof data.html === "string") {
      return extractUsefulTextFromHtml(data.html);
    }

    // Raw HTML response
    if (/<\/?[a-z][\s\S]*>/i.test(String(rawText || ""))) {
      return extractUsefulTextFromHtml(rawText);
    }

    // Plain text response
    return cleanText(rawText);
  }

  async function fetchSourceTextForUrl(url, options = {}) {
    url = normalizeUrl(url);
    if (!url) return "";

    const cached = readCache(url);
    if (cached) return cached;

    const proxyBase = options.proxyBase || DEFAULT_PROXY_BASE;
    const requestUrl = `${proxyBase}${encodeURIComponent(url)}`;

    const res = await fetch(requestUrl, {
      method: "GET",
      credentials: "same-origin"
    });

    if (!res.ok) {
      throw new Error(`Spell source fetch failed (${res.status}) for ${url}`);
    }

    const contentType = String(res.headers.get("content-type") || "").toLowerCase();

    let rawText = "";
    let data = null;

    if (contentType.includes("application/json")) {
      data = await res.json();
    } else {
      rawText = await res.text();
    }

    const normalized = normalizeFetchedText(rawText, data);
    writeCache(url, normalized);
    return normalized;
  }

  async function enrichSpellRows(rows, options = {}) {
    rows = Array.isArray(rows) ? rows : [];

    const uniqueUrls = [];
    const seen = new Set();

    for (const row of rows) {
      const url = normalizeUrl(row?.url);
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      uniqueUrls.push(url);
    }

    const textByUrl = {};
    const total = uniqueUrls.length;
    let done = 0;

    for (const url of uniqueUrls) {
      try {
        textByUrl[url] = await fetchSourceTextForUrl(url, options);
      } catch (e) {
        console.warn("SpellSourceLoader: failed to fetch source text", url, e);
        textByUrl[url] = "";
      }

      done++;
      if (typeof options.onProgress === "function") {
        try {
          options.onProgress(done, total, url);
        } catch {}
      }
    }

    let updatedCount = 0;

    for (const row of rows) {
      const url = normalizeUrl(row?.url);
      if (!url) continue;

      const text = textByUrl[url] || "";
      if (text && row.sourceText !== text) {
        row.sourceText = text;
        updatedCount++;
      } else if (!row.sourceText) {
        row.sourceText = text;
      }
    }

    return {
      totalUrls: total,
      updatedCount
    };
  }

  SpellSourceLoader.fetchSourceTextForUrl = fetchSourceTextForUrl;
  SpellSourceLoader.enrichSpellRows = enrichSpellRows;

  global.SpellSourceLoader = SpellSourceLoader;
})(window);
