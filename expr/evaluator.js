// expr/evaluator.js
// Lightweight wrapper for evaluating numeric expressions used in spell fields.
// This avoids using global eval on raw user text. If you prefer a parser dependency
// (expr-eval / jsep) we can swap this for a safer parser-based evaluator.

const MATH_KEYS = Object.getOwnPropertyNames(Math).filter(k => typeof Math[k] === 'function');

export function compileExpression(exprText) {
  const raw = (exprText || '').trim().replace(/^\{/, '').replace(/\}$/, '');
  try {
    // Build a function that only has access to Math functions and the provided scope.
    // The function receives a single `scope` object and evaluates the expression inside a frozen scope.
    // This is intentionally minimal; if you need more features we can replace with a parser.
    const mathBindings = MATH_KEYS.join(', ');
    const fn = new Function('scope', `
      "use strict";
      const { ${mathBindings} } = Math;
      const s = Object.freeze(scope || {});
      // Only identifiers present in scope or Math are usable; other globals are not referenced.
      return (function() { with (s) { return (${raw}); } })();
    `);
    return (scope) => {
      try { return fn(scope); } catch (e) { console.error('Expression eval error', raw, e); return null; }
    };
  } catch (e) {
    console.error('compileExpression error', exprText, e);
    return () => null;
  }
}
