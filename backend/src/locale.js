// Formulas in summary.js are written in the US syntax: a comma between arguments and between
// the columns of an array, a dot in decimals, TRUE and FALSE. Range.setFormula() parses the
// text in the locale of the spreadsheet, so in a sheet with a Russian, Dutch or German locale
// every one of them would be a parse error. setup() probes the separator of the sheet and
// translates each formula with localizeFormula() before writing it.

export const SEPARATORS = [',', ';'];

// Pure. For ';': commas between arguments become ';', commas between array columns become '\',
// the dot of a decimal number becomes ','. Text inside double or single quotes never changes
// (the QUERY text keeps its commas). TRUE and FALSE become 1=1 and 1=0 for either separator,
// so nothing in the formula depends on the language of the sheet.
export function localizeFormula(formula, separator) {
  if (!SEPARATORS.includes(separator)) throw new Error(`unknown argument separator: ${JSON.stringify(separator)}`);
  const semicolon = separator === ';';
  const brackets = [];
  let out = '';
  let quote = '';
  let token = '';
  const flush = () => {
    if (!token) return;
    if (token === 'TRUE') out += '1=1';
    else if (token === 'FALSE') out += '1=0';
    else if (semicolon && /^[0-9]+\.[0-9]+$/.test(token)) out += token.replace('.', ',');
    else out += token;
    token = '';
  };
  for (const char of formula) {
    if (quote) {
      out += char;
      if (char === quote) quote = '';
      continue;
    }
    if (/[A-Za-z0-9_.]/.test(char)) {
      token += char;
      continue;
    }
    flush();
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      continue;
    }
    if (char === '(' || char === '{') brackets.push(char);
    if (char === ')' || char === '}') brackets.pop();
    if (char === ',' && semicolon) {
      out += brackets[brackets.length - 1] === '{' ? '\\' : ';';
      continue;
    }
    out += char;
  }
  flush();
  if (quote) throw new Error(`unclosed quote in formula: ${formula}`);
  return out;
}

// The probe formulas, one per candidate separator; the one that evaluates to 3 wins.
export function probeFormula(separator) {
  return `=SUM(1${separator}2)`;
}

// Runs the probe on a cell: writes each candidate, flushes, reads the value, clears the cell.
// Returns ',' or ';', or null when neither evaluates to 3.
export function detectSeparator(cell, flush) {
  let found = null;
  for (const separator of SEPARATORS) {
    if (found) break;
    cell.setFormula(probeFormula(separator));
    flush();
    const value = cell.getValue();
    if (value === 3) found = separator;
  }
  cell.clearContent();
  flush();
  return found;
}
