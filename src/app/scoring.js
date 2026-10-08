// Result logic as pure functions. No DOM here: the tests import this file directly.

export function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// answers: the 12 scores in question order (four per pillar, pillars in content order).
// Returns { F: [...], P: [...], V: [...] }.
export function groupAnswers(answers, pillars) {
  const grouped = {};
  let index = 0;
  for (const pillar of pillars) {
    grouped[pillar.key] = pillar.items.map(() => answers[index++]);
  }
  return grouped;
}

export function pillarAverages(grouped) {
  const averages = {};
  for (const key of Object.keys(grouped)) averages[key] = average(grouped[key]);
  return averages;
}

// Gap = 10 minus the pillar average. There are no "where I want to be" questions,
// so 10 stands for the desired state.
export function pillarGaps(averages) {
  const gaps = {};
  for (const key of Object.keys(averages)) gaps[key] = 10 - averages[key];
  return gaps;
}

// Balanced when every gap is below logic.balanced_gap. Otherwise the focus is the
// pillar with the largest gap; a tie goes to whichever comes first in logic.tie_order.
export function pickFocus(gaps, logic) {
  const order = logic.tie_order;
  const balanced = order.every((key) => gaps[key] < logic.balanced_gap);
  if (balanced) return { result: 'balanced', focus: null };
  let focus = order[0];
  for (const key of order) {
    if (gaps[key] > gaps[focus]) focus = key;
  }
  return { result: focus, focus };
}

export function evaluate(answers, content) {
  const grouped = groupAnswers(answers, content.pillars);
  const averages = pillarAverages(grouped);
  const gaps = pillarGaps(averages);
  const { result, focus } = pickFocus(gaps, content.logic);
  return { grouped, averages, gaps, result, focus, balanced: result === 'balanced' };
}

// Which line about question 13 to show: null for a balanced mosaic,
// 'match' when the chosen pillar is the focus, otherwise 'mismatch'.
export function growLineKind(result, grow) {
  if (result === 'balanced') return null;
  return grow === result ? 'match' : 'mismatch';
}

export function formatAverage(value) {
  return value.toFixed(1);
}

// Replaces {name}-style placeholders with plain text. The caller puts the result
// into textContent, so nothing here is ever parsed as HTML.
export function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}
