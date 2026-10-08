import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../src/check.mjs';
import { evaluate, growLineKind, formatAverage, fillTemplate, pickFocus, groupAnswers } from '../src/app/scoring.js';

const content = await loadContent();

// Four scores per pillar; a single number means that score four times.
function answers({ F, P, V }) {
  const four = (x) => (Array.isArray(x) ? x : [x, x, x, x]);
  return [...four(F), ...four(P), ...four(V)];
}
const run = (scores) => evaluate(answers(scores), content);

test('all 10: balanced', () => {
  const r = run({ F: 10, P: 10, V: 10 });
  assert.equal(r.result, 'balanced');
  assert.equal(r.focus, null);
  assert.equal(r.balanced, true);
});

test('all 8: balanced', () => {
  assert.equal(run({ F: 8, P: 8, V: 8 }).result, 'balanced');
});

test('all 7: gap exactly 3, not balanced, tie goes to F', () => {
  const r = run({ F: 7, P: 7, V: 7 });
  assert.equal(r.gaps.F, 3);
  assert.equal(r.balanced, false);
  assert.equal(r.result, 'F');
});

test('F 3,3,3,3 with P and V at 8: F', () => {
  assert.equal(run({ F: 3, P: 8, V: 8 }).result, 'F');
});

test('F 8; P 4,5,4,5; V 8: P', () => {
  assert.equal(run({ F: 8, P: [4, 5, 4, 5], V: 8 }).result, 'P');
});

test('F 8; P 8; V 2,3,2,3: V', () => {
  assert.equal(run({ F: 8, P: 8, V: [2, 3, 2, 3] }).result, 'V');
});

test('F 8; P and V at 5: tie between P and V goes to P', () => {
  assert.equal(run({ F: 8, P: 5, V: 5 }).result, 'P');
});

test('F 8,7,7,7; P 8,7,7,7; V 7,7,7,7: V (gap 3 against 2.75)', () => {
  const r = run({ F: [8, 7, 7, 7], P: [8, 7, 7, 7], V: [7, 7, 7, 7] });
  assert.equal(r.gaps.F, 2.75);
  assert.equal(r.gaps.V, 3);
  assert.equal(r.result, 'V');
});

test('sample answers from the first screen: focus F', () => {
  const r = evaluate([4, 3, 5, 4, 7, 6, 8, 7, 6, 5, 7, 6], content);
  assert.equal(r.result, 'F');
  assert.deepEqual(r.averages, { F: 4, P: 7, V: 6 });
  assert.equal(growLineKind(r.result, 'V'), 'mismatch');
});

test('grow line: focus F, chosen F: match', () => {
  assert.equal(growLineKind('F', 'F'), 'match');
});

test('grow line: focus F, chosen V: mismatch', () => {
  assert.equal(growLineKind('F', 'V'), 'mismatch');
});

test('grow line: balanced with any choice: no line', () => {
  for (const grow of ['F', 'P', 'V']) assert.equal(growLineKind('balanced', grow), null);
});

test('tie order comes from the content file', () => {
  const gaps = { F: 3, P: 3, V: 3 };
  assert.equal(pickFocus(gaps, { balanced_gap: 3, tie_order: ['V', 'P', 'F'] }).result, 'V');
  assert.equal(pickFocus(gaps, { balanced_gap: 3, tie_order: ['P', 'F', 'V'] }).result, 'P');
});

test('balanced threshold comes from the content file', () => {
  const gaps = { F: 3, P: 2, V: 1 };
  assert.equal(pickFocus(gaps, { balanced_gap: 3, tie_order: ['F', 'P', 'V'] }).result, 'F');
  assert.equal(pickFocus(gaps, { balanced_gap: 4, tie_order: ['F', 'P', 'V'] }).result, 'balanced');
});

test('answers are grouped by pillar in question order', () => {
  const grouped = groupAnswers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2], content.pillars);
  assert.deepEqual(grouped, { F: [1, 2, 3, 4], P: [5, 6, 7, 8], V: [9, 10, 1, 2] });
});

test('averages are shown with one decimal', () => {
  assert.equal(formatAverage(4), '4.0');
  assert.equal(formatAverage(7.5), '7.5');
  assert.equal(formatAverage(7.25), '7.3');
  assert.equal(formatAverage(10), '10.0');
});

test('placeholders are filled as plain text and unknown ones stay', () => {
  assert.equal(fillTemplate('{name}, hello {x}', { name: 'Anna' }), 'Anna, hello {x}');
  assert.equal(fillTemplate('a {grow} b {focus}', { grow: 'Visibility', focus: 'Foundation' }), 'a Visibility b Foundation');
  assert.equal(fillTemplate('{name}', { name: '<b>' }), '<b>');
});
