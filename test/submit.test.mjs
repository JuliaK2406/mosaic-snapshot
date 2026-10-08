import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../src/check.mjs';
import { evaluate } from '../src/app/scoring.js';
import { sanitizeSrc, readSrc, calendlyUrl, buildPayload, sendPayload, answerMap } from '../src/app/submit.js';

const content = await loadContent();

test('src keeps only a-z, 0-9, dash and underscore, at most 40 characters', () => {
  assert.equal(sanitizeSrc('Work shop-A_1!'), 'workshop-a_1');
  assert.equal(sanitizeSrc('x'.repeat(50)), 'x'.repeat(40));
  assert.equal(sanitizeSrc(''), '');
  assert.equal(sanitizeSrc(null), '');
  assert.equal(sanitizeSrc('<script>'), 'script');
});

test('src is read from the query string and is empty without the parameter', () => {
  assert.equal(readSrc('?src=linkedin-oct&utm=1'), 'linkedin-oct');
  assert.equal(readSrc('?utm=1'), '');
  assert.equal(readSrc(''), '');
});

test('Calendly link carries the utm tags, with "direct" when there is no src', () => {
  const base = new URL(content.links.calendly);
  const direct = new URL(calendlyUrl(content.links.calendly, { src: '', result: 'F' }));
  assert.equal(direct.origin + direct.pathname, base.origin + base.pathname);
  assert.equal(direct.searchParams.get('utm_source'), 'mosaic-snapshot');
  assert.equal(direct.searchParams.get('utm_medium'), 'result');
  assert.equal(direct.searchParams.get('utm_campaign'), 'direct');
  assert.equal(direct.searchParams.get('utm_content'), 'F');
  const tagged = new URL(calendlyUrl(content.links.calendly, { src: 'workshop-a', result: 'balanced' }));
  assert.equal(tagged.searchParams.get('utm_campaign'), 'workshop-a');
  assert.equal(tagged.searchParams.get('utm_content'), 'balanced');
});

test('a link that is not a full address is returned unchanged instead of throwing', () => {
  assert.equal(calendlyUrl('calendly.com/x', { src: '', result: 'F' }), 'calendly.com/x');
});

test('answer map uses F1..V4 keys in question order', () => {
  assert.deepEqual(answerMap([4, 3, 5, 4, 7, 6, 8, 7, 6, 5, 7, 6], content.pillars), {
    F1: 4, F2: 3, F3: 5, F4: 4, P1: 7, P2: 6, P3: 8, P4: 7, V1: 6, V2: 5, V3: 7, V4: 6,
  });
});

test('payload matches the agreed shape', () => {
  const answers = [4, 3, 5, 4, 7, 6, 8, 7, 6, 5, 7, 6];
  const payload = buildPayload({
    name: 'Anna',
    email: 'anna@example.com',
    consent: false,
    src: '',
    grow: 'V',
    evaluation: evaluate(answers, content),
    answers,
    pillars: content.pillars,
    submittedAt: '2026-10-08T10:00:00.000Z',
  });
  assert.deepEqual(payload, {
    version: 1,
    submitted_at: '2026-10-08T10:00:00.000Z',
    name: 'Anna',
    email: 'anna@example.com',
    consent: false,
    src: '',
    grow: 'V',
    result: 'F',
    averages: { F: 4, P: 7, V: 6 },
    answers: { F1: 4, F2: 3, F3: 5, F4: 4, P1: 7, P2: 6, P3: 8, P4: 7, V1: 6, V2: 5, V3: 7, V4: 6 },
  });
});

test('payload stamps the current time when none is given', () => {
  const answers = new Array(12).fill(8);
  const payload = buildPayload({ name: 'A', email: 'a@b.co', consent: true, src: 'x', grow: 'F', evaluation: evaluate(answers, content), answers, pillars: content.pillars });
  assert.ok(!Number.isNaN(Date.parse(payload.submitted_at)));
  assert.equal(payload.consent, true);
  assert.equal(payload.result, 'balanced');
});

test('nothing is sent while the endpoint is empty or only whitespace', async () => {
  let calls = 0;
  const spy = () => { calls += 1; return Promise.resolve(); };
  assert.equal(await sendPayload({ version: 1 }, '', spy), false);
  assert.equal(await sendPayload({ version: 1 }, '   ', spy), false);
  assert.equal(await sendPayload({ version: 1 }, undefined, spy), false);
  assert.equal(calls, 0);
});

test('with an endpoint the payload goes as a text/plain POST in no-cors mode', async () => {
  const seen = [];
  const sent = await sendPayload({ version: 1 }, 'https://example.com/exec', (url, options) => {
    seen.push({ url, options });
    return Promise.resolve({ ok: true });
  });
  assert.equal(sent, true);
  assert.equal(seen[0].url, 'https://example.com/exec');
  assert.equal(seen[0].options.method, 'POST');
  assert.equal(seen[0].options.mode, 'no-cors');
  assert.equal(seen[0].options.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.equal(seen[0].options.body, '{"version":1}');
});

test('a failing send resolves to false and never throws', async () => {
  assert.equal(await sendPayload({}, 'https://example.com/exec', () => Promise.reject(new Error('offline'))), false);
  assert.equal(await sendPayload({}, 'https://example.com/exec', () => { throw new Error('boom'); }), false);
});
