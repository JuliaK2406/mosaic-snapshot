import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, checkContent, report } from '../src/check.mjs';

const content = await loadContent();
const copy = () => structuredClone(content);
const errorsOf = (c) => checkContent(c).errors;
const hasError = (errors, path) => errors.some((e) => e.startsWith(`${path}:`));

// TODO markers are not asserted here on purpose: while published is false a TODO is only
// a reminder, and this test must not block the deploy when Julia leaves one in the yaml.
test('the real content file passes with no errors', () => {
  const { errors, todos } = checkContent(content);
  assert.deepEqual(errors, []);
  assert.equal(report(content, { errors, todos }).ok, true);
});

test('a missing step is reported with the path of the field', () => {
  const c = copy();
  c.results.P.steps.pop();
  const errors = errorsOf(c);
  assert.ok(hasError(errors, 'results.P.steps'), errors.join('\n'));
});

test('an empty text is reported with its path', () => {
  const c = copy();
  c.pillars[2].items[1].title = '   ';
  assert.ok(hasError(errorsOf(c), 'pillars[2].items[1].title'));
  const d = copy();
  d.result.cta_button = '';
  assert.ok(hasError(errorsOf(d), 'result.cta_button'));
});

test('the endpoint may be empty, nothing else may', () => {
  assert.deepEqual(errorsOf(copy()), []);
  const c = copy();
  c.links.calendly = '';
  assert.ok(hasError(errorsOf(c), 'links.calendly'));
});

test('pillars need exactly four items each and keys F, P, V', () => {
  const c = copy();
  c.pillars[0].items.push({ title: 'Extra' });
  assert.ok(hasError(errorsOf(c), 'pillars[0].items'));
  const d = copy();
  d.pillars[1].key = 'X';
  const errors = errorsOf(d);
  assert.ok(hasError(errors, 'pillars[1].key'));
  assert.ok(errors.some((e) => e.includes('key P is missing')));
});

test('question 13 needs the same three keys', () => {
  const c = copy();
  c.grow_question.options.splice(1, 1);
  const errors = errorsOf(c);
  assert.ok(hasError(errors, 'grow_question.options'));
});

test('results need F, P, V and balanced with all fields', () => {
  const c = copy();
  delete c.results.balanced;
  assert.ok(hasError(errorsOf(c), 'results.balanced'));
  const d = copy();
  delete d.results.V.how_it_affects;
  assert.ok(hasError(errorsOf(d), 'results.V.how_it_affects'));
  const e = copy();
  e.results.balanced.whats_next = [];
  assert.ok(hasError(errorsOf(e), 'results.balanced.whats_next'));
});

test('placeholders must stay in the strings that use them', () => {
  const c = copy();
  c.result.greeting_with_name = 'Here is your Mosaic';
  c.result.copy_line = 'A copy is on its way.';
  c.result.grow_mismatch = 'You said {grow}.';
  const errors = errorsOf(c);
  assert.ok(errors.includes('result.greeting_with_name: must contain {name}'));
  assert.ok(errors.includes('result.copy_line: must contain {email}'));
  assert.ok(errors.includes('result.grow_mismatch: must contain {focus}'));
});

test('tie order must list F, P and V once each; the gap must be a number above 0', () => {
  const c = copy();
  c.logic.tie_order = ['F', 'P'];
  assert.ok(hasError(errorsOf(c), 'logic.tie_order'));
  const d = copy();
  d.logic.balanced_gap = 'three';
  assert.ok(hasError(errorsOf(d), 'logic.balanced_gap'));
});

test('a TODO is listed, blocks only when published is true', () => {
  const c = copy();
  c.results.F.headline = 'TODO: new headline';
  const result = checkContent(c);
  assert.deepEqual(result.todos, ['results.F.headline']);
  assert.equal(report(c, result).ok, true);
  c.meta.published = true;
  const published = report(c, checkContent(c));
  assert.equal(published.ok, false);
  assert.ok(published.lines.some((line) => line.includes('TODO markers remain')));
});

test('links must be full web addresses, the endpoint empty or https', () => {
  const c = copy();
  c.links.calendly = 'calendly.com/juliakrylova/30min';
  assert.ok(hasError(errorsOf(c), 'links.calendly'));
  const d = copy();
  d.meta.site_url = 'mosaic.juliakrylova.com';
  assert.ok(hasError(errorsOf(d), 'meta.site_url'));
  const e = copy();
  e.backend.endpoint_url = '   ';
  assert.deepEqual(errorsOf(e), []);
  const f = copy();
  f.backend.endpoint_url = 'http://script.google.com/macros/s/abc/exec';
  assert.ok(hasError(errorsOf(f), 'backend.endpoint_url'));
  const g = copy();
  g.backend.endpoint_url = 'https://script.google.com/macros/s/abc/exec';
  assert.deepEqual(errorsOf(g), []);
});

test('published must be true or false', () => {
  const c = copy();
  c.meta.published = 'yes';
  assert.ok(hasError(errorsOf(c), 'meta.published'));
});
