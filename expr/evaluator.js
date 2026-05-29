// expr/evaluator.js
// Minimal safe expression evaluator wrapper.
// NOTE: This intentionally forbids identifiers except a strict whitelist.
// It only supports numbers, parentheses and + - * / and a small set of variable names.

export function evaluateExpression(expr, vars = {}) {
  // Allowed characters: digits, whitespace, parentheses, arithmetic operators, dot for decimals, comma
  // Allowed variable names: only those present in vars and matching /^[A-Za-z_][A-Za-z0-9_]*$/
  if (typeof expr !== "string") throw new Error("Expression must be a string");

  // Quick reject of obviously dangerous characters
  if (/[;`\\\u0000]/.test(expr)) throw new Error("Disallowed characters in expression");

  // Only allow these characters in the expression
  if (!/^[0-9+\-*/().,\sA-Za-z0-9_]+$/.test(expr)) throw new Error("Invalid characters in expression");

  // Build a whitelist of variable names we will allow
  const allowedVars = Object.keys(vars).filter(n => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
  // Replace variable names in the expression with a safe placeholder access pattern
  // We'll compile a function that accepts only the allowedVars as parameters.
  // But to be extra safe, ensure the expression does not contain the words "constructor" or "prototype" etc.
  if (/\b(constructor|__proto__|prototype|window|document|globalThis|Function|eval)\b/.test(expr)) {
    throw new Error("Disallowed identifier in expression");
  }

  // Final sanity check: only allowed variable names appear as identifiers
  const identifierRegex = /[A-Za-z_][A-Za-z0-9_]*/g;
  let id;
  while ((id = identifierRegex.exec(expr)) !== null) {
    const name = id[0];
    if (!/^[0-9]+$/.test(name) && !allowedVars.includes(name)) {
      // If it's not a number and not in allowedVars, reject
      throw new Error(`Unknown identifier in expression: ${name}`);
    }
  }

  // Safe compile: use Function but only with whitelisted param names and a sanitized expression
  const paramNames = allowedVars;
  const paramList = paramNames.join(",");
  // Wrap expression in parentheses to avoid ASI surprises
  const safeExpr = `return (${expr});`;
  const fn = new Function(...paramNames, safeExpr);
  const args = paramNames.map(n => vars[n]);
  return fn(...args);
}
