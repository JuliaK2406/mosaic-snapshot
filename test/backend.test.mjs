import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadContent } from '../src/check.mjs';
import { buildBackendCode, CODE_GS } from '../src/build.mjs';
import { evaluate } from '../src/app/scoring.js';
import { TILE_HEIGHTS, tileAlpha } from '../src/app/mosaic.js';
import { parseSubmission, cleanName, looksLikeSpam, ANSWER_KEYS } from '../backend/src/validate.js';
import { safeCell } from '../backend/src/sheet.js';
import { relayEnabled, describeAccount } from '../backend/src/brevo.js';
import { LIMITS, decideSending, counterKeys, staleCounterKeys, dayKey, hourKey } from '../backend/src/limits.js';
import { HEADERS, buildRecord, rowValues, columnOf, missingHeaders, resultLabel, headerRenames } from '../backend/src/sheet.js';
import { summaryLayout, questionItems, pillarLabels, columnLetter, balanced, ROWS, SUMMARY_SHEET_NAME } from '../backend/src/summary.js';
import { runSetup } from '../backend/src/entry.js';
import { renderEmail, renderNotification, EMAIL_TILE_HEIGHTS, emailTileAlpha, tileHex, NOTE_BACKGROUND, withParams, escapeHtml } from '../backend/src/email.js';
import { emailRequest, contactRequest, notificationRequest, isAttributeError, brevoTags, describeLists, describeAttributes } from '../backend/src/brevo.js';
import { processSubmission, FALLBACK_CONTENT, STATUS, SAMPLE_ANSWERS } from '../backend/src/entry.js';

const content = await loadContent();

const GOOD = {
  version: 1,
  submitted_at: '2026-10-12T10:00:00.000Z',
  name: 'Anna',
  email: 'anna@example.com',
  consent: true,
  src: 'workshop-a',
  grow: 'V',
  result: 'F',
  averages: { F: 4, P: 7, V: 6 },
  answers: { ...SAMPLE_ANSWERS },
};

const good = (patch = {}) => ({ ...GOOD, ...patch });
const errorsOf = (payload) => {
  const parsed = parseSubmission(payload);
  return parsed.ok ? [] : parsed.errors;
};

// ---------- validate ----------

test('a good submission passes with cleaned fields and answers in F1..V4 order', () => {
  const parsed = parseSubmission(JSON.stringify(good({ name: '  Anna \t Maria ', extra: 'dropped' })));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rejected, false);
  assert.equal(parsed.submission.name, 'Anna Maria');
  assert.deepEqual(parsed.submission.answers, [4, 3, 5, 4, 7, 6, 8, 7, 6, 5, 7, 6]);
  assert.equal(parsed.submission.src, 'workshop-a');
  assert.equal(parsed.submission.clientResult, 'F');
  assert.equal('extra' in parsed.submission, false);
});

test('each field fails on its own', () => {
  assert.ok(errorsOf(good({ version: 2 })).some((e) => e.includes('version')));
  assert.ok(errorsOf(good({ name: '' })).some((e) => e.includes('name')));
  assert.ok(errorsOf(good({ name: 'x'.repeat(61) })).some((e) => e.includes('name')));
  assert.ok(errorsOf(good({ email: 'anna.example.com' })).some((e) => e.includes('email')));
  assert.ok(errorsOf(good({ consent: 'yes' })).some((e) => e.includes('consent')));
  assert.ok(errorsOf(good({ grow: 'X' })).some((e) => e.includes('grow')));
  assert.ok(errorsOf(good({ answers: { ...SAMPLE_ANSWERS, F1: 0 } })).some((e) => e.includes('F1')));
  assert.ok(errorsOf(good({ answers: { ...SAMPLE_ANSWERS, V4: 11 } })).some((e) => e.includes('V4')));
  const noV4 = { ...SAMPLE_ANSWERS };
  delete noV4.V4;
  assert.ok(errorsOf(good({ answers: noV4 })).some((e) => e.includes('F1..V4')));
  assert.ok(errorsOf(good({ answers: { ...SAMPLE_ANSWERS, X1: 5 } })).some((e) => e.includes('F1..V4')));
  assert.ok(errorsOf('not json').some((e) => e.includes('JSON')));
  assert.ok(errorsOf('[1,2]').some((e) => e.includes('object')));
});

test('src is cleaned like on the page and control characters leave the name', () => {
  const parsed = parseSubmission(good({ src: 'Work shop-A_1!', name: 'An' + String.fromCharCode(7) + 'na' }));
  assert.equal(parsed.submission.src, 'workshop-a_1');
  assert.equal(parsed.submission.name, 'Anna');
  assert.equal(cleanName(null), '');
});

test('a name with a link or an address is rejected, not invalid', () => {
  for (const name of ['Buy http://x.y', 'www.spam.com', 'see://this', 'me@spam.com']) {
    const parsed = parseSubmission(good({ name }));
    assert.equal(parsed.ok, true, name);
    assert.equal(parsed.rejected, true, name);
    assert.equal(looksLikeSpam(name), true);
  }
  assert.equal(looksLikeSpam('Anna-Maria'), false);
});

// ---------- scoring on the server ----------

test('the server recomputes the result like the page on the PROMPT 01 table', () => {
  const cases = [
    [{ F: 10, P: 10, V: 10 }, 'balanced'],
    [{ F: 8, P: 8, V: 8 }, 'balanced'],
    [{ F: 7, P: 7, V: 7 }, 'F'],
    [{ F: 3, P: 8, V: 8 }, 'F'],
    [{ F: 8, P: [4, 5, 4, 5], V: 8 }, 'P'],
    [{ F: 8, P: 8, V: [2, 3, 2, 3] }, 'V'],
    [{ F: 8, P: 5, V: 5 }, 'P'],
    [{ F: [8, 7, 7, 7], P: [8, 7, 7, 7], V: [7, 7, 7, 7] }, 'V'],
  ];
  const four = (x) => (Array.isArray(x) ? x : [x, x, x, x]);
  for (const [scores, expected] of cases) {
    const answers = [...four(scores.F), ...four(scores.P), ...four(scores.V)];
    assert.equal(evaluate(answers, content).result, expected);
    assert.equal(evaluate(answers, FALLBACK_CONTENT).result, expected);
  }
});

// ---------- limits ----------

test('limits: the same email is held for 2 minutes and 3 times a day', () => {
  const now = new Date('2026-10-12T10:00:00Z');
  const base = { now, lastSentAt: null, emailDayCount: 0, hourCount: 0, dayCount: 0, needed: 1, isTestEmail: false };
  assert.equal(decideSending(base).allowed, true);
  assert.equal(decideSending({ ...base, lastSentAt: now.getTime() - 60 * 1000 }).allowed, false);
  assert.equal(decideSending({ ...base, lastSentAt: now.getTime() - 3 * 60 * 1000 }).allowed, true);
  assert.equal(decideSending({ ...base, emailDayCount: 2 }).allowed, true);
  assert.equal(decideSending({ ...base, emailDayCount: 3 }).allowed, false);
});

test('limits: the test address skips the per-email limits but not the shared ones', () => {
  const now = new Date('2026-10-12T10:00:00Z');
  const base = { now, lastSentAt: now.getTime() - 1000, emailDayCount: 9, hourCount: 0, dayCount: 0, needed: 1, isTestEmail: true };
  assert.equal(decideSending(base).allowed, true);
  assert.equal(decideSending({ ...base, hourCount: LIMITS.PER_HOUR }).allowed, false);
});

test('limits: the 151st email in an hour and the 281st in a day are refused, notifications count', () => {
  const now = new Date('2026-10-12T10:00:00Z');
  const base = { now, lastSentAt: null, emailDayCount: 0, hourCount: 0, dayCount: 0, needed: 1, isTestEmail: false };
  assert.equal(decideSending({ ...base, hourCount: 149 }).allowed, true);
  assert.equal(decideSending({ ...base, hourCount: 150 }).allowed, false);
  assert.equal(decideSending({ ...base, dayCount: 279 }).allowed, true);
  assert.equal(decideSending({ ...base, dayCount: 280 }).allowed, false);
  assert.equal(decideSending({ ...base, hourCount: 149, needed: 2 }).allowed, false);
});

test('limits: keys by day and hour, stale keys are found', () => {
  const now = new Date('2026-10-12T10:30:00Z');
  assert.equal(dayKey(now), '2026-10-12');
  assert.equal(hourKey(now), '2026-10-12T10');
  const keys = counterKeys('abc', now);
  assert.deepEqual(keys, { last: 'last:abc', emailDay: 'emailday:2026-10-12:abc', hour: 'hour:2026-10-12T10', day: 'day:2026-10-12' });
  const stale = staleCounterKeys(['day:2026-10-12', 'day:2026-10-11', 'day:2026-10-10', 'hour:2026-10-09T23', 'emailday:2026-10-01:x', 'BREVO_API_KEY', 'last:x'], now);
  assert.deepEqual(stale, ['day:2026-10-10', 'hour:2026-10-09T23', 'emailday:2026-10-01:x']);
});

// ---------- sheet ----------

const submission = parseSubmission(good()).submission;
const evaluation = evaluate(submission.answers, content);

test('sheet: the header and the row are in the agreed order', () => {
  assert.equal(HEADERS.length, 28);
  assert.equal(HEADERS[0], 'Received at');
  assert.deepEqual(HEADERS.slice(10, 22), ANSWER_KEYS);
  const receivedAt = new Date('2026-10-12T10:00:05Z');
  const record = buildRecord({ receivedAt, submission, evaluation, pillars: content.pillars, emailStatus: 'pending', contactStatus: 'pending', note: '', consentLabel: content.email_step.consent_label });
  const values = rowValues(HEADERS, record);
  assert.equal(values[0], receivedAt);
  assert.deepEqual(values.slice(1, 10), ['Anna', 'anna@example.com', 'Yes', 'workshop-a', 'Foundation', 'Visibility', 4, 7, 6]);
  assert.deepEqual(values.slice(10, 22), [4, 3, 5, 4, 7, 6, 8, 7, 6, 5, 7, 6]);
  assert.deepEqual(values.slice(22), ['pending', 'pending', '', '2026-10-12T10:00:00.000Z', content.email_step.consent_label, 1]);
  assert.equal(resultLabel('balanced', content.pillars), 'Balanced');
  assert.equal(resultLabel('P', []), 'P');
});

test('sheet: averages have two decimals, consent text only with consent', () => {
  const quarter = evaluate([8, 7, 7, 7, 8, 7, 7, 7, 7, 7, 7, 7], content);
  const noConsent = { ...submission, consent: false };
  const record = buildRecord({ receivedAt: new Date(), submission: noConsent, evaluation: quarter, pillars: content.pillars, emailStatus: 'skipped', contactStatus: 'skipped', note: '', consentLabel: 'text' });
  assert.equal(record['Foundation avg'], 7.25);
  assert.equal(record['Newsletter consent'], 'No');
  assert.equal(record['Consent text'], '');
  assert.equal(record.Source, 'workshop-a');
});

test('sheet: writing by headers survives reordered columns and a column added by Julia', () => {
  const headerRow = ['Email', 'Contacted', 'First name', 'Received at', 'Result', 'Email status'];
  const record = buildRecord({ receivedAt: 'now', submission, evaluation, pillars: content.pillars, emailStatus: 'sent', contactStatus: 'added', note: '', consentLabel: '' });
  assert.deepEqual(rowValues(headerRow, record), ['anna@example.com', '', 'Anna', 'now', 'Foundation', 'sent']);
  assert.equal(columnOf(headerRow, 'Result'), 5);
  assert.equal(columnOf(headerRow, 'Note'), 0);
  assert.ok(missingHeaders(headerRow).includes('Note'));
  assert.deepEqual(missingHeaders(HEADERS), []);
});

// ---------- email ----------

const CASES = {
  F: { answers: [4, 3, 5, 4, 7, 6, 8, 7, 6, 5, 7, 6], grow: 'V', kind: 'mismatch' },
  P: { answers: [8, 8, 8, 8, 4, 5, 4, 5, 8, 8, 8, 8], grow: 'P', kind: 'match' },
  V: { answers: [8, 8, 8, 8, 8, 8, 8, 8, 2, 3, 2, 3], grow: 'F', kind: 'mismatch' },
  balanced: { answers: new Array(12).fill(8), grow: 'F', kind: null },
};
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const inText = (key) => content.pillars.find((p) => p.key === key).in_text;

test('email: every text of the four results is in the text and the HTML word for word', () => {
  for (const [key, c] of Object.entries(CASES)) {
    const ev = evaluate(c.answers, content);
    assert.equal(ev.result, key);
    const message = renderEmail(content, { name: 'Anna', email: 'anna@example.com', src: '', grow: c.grow }, ev);
    const t = content.results[key];
    const expected = [t.headline, t.what_it_means, ...(key === 'balanced' ? t.whats_next : t.how_it_affects), ...t.steps, t.cta_question,
      content.email.intro, content.email.scores_title, content.email.closing, content.email.why_line, content.result.cta_button, content.result.cta_note,
      content.result.signature_name, content.result.signature_title, content.result.legal_line, content.intro.wordmark, content.email.preheader];
    const html = norm(message.html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
    const text = norm(message.text);
    for (const s of expected) {
      assert.ok(text.includes(norm(s)), `${key} text: ${s.slice(0, 40)}`);
      assert.ok(html.includes(norm(s)), `${key} html: ${s.slice(0, 40)}`);
    }
    const line = c.kind ? (c.kind === 'match' ? content.result.grow_match : content.result.grow_mismatch).replace('{grow}', inText(c.grow)).replace('{focus}', inText(key)) : null;
    if (line) {
      assert.ok(text.includes(norm(line)), `${key}: grow line in text`);
      assert.ok(html.includes(norm(line)), `${key}: grow line in html`);
    } else {
      for (const template of [content.result.grow_match, content.result.grow_mismatch]) {
        const head = norm(template.split('{')[0]);
        if (head) assert.ok(!text.includes(head) && !html.includes(head), 'balanced: no grow line');
      }
      assert.ok(!html.includes(`${escapeHtml(content.result.focus_label)}</td>`), 'balanced: no focus label');
    }
    assert.equal(message.subject, content.email.subject.replace('{name}', 'Anna'));
    assert.ok(message.html.includes(`Hi Anna,`));
    const utm = 'utm_source=mosaic-snapshot&utm_medium=email&utm_campaign=direct&utm_content=' + key;
    assert.ok(message.html.includes(escapeHtml(content.links.calendly + '?' + utm)), `${key}: calendly link in html`);
    assert.ok(message.text.includes(content.links.calendly + '?' + utm), `${key}: calendly link in text`);
    assert.ok(message.html.includes(`href="${content.links.main_site}"`), 'signature links to the site');
  }
});

test('email: the name is escaped, the source goes into utm_campaign, the focus label marks the column', () => {
  const ev = evaluate(CASES.F.answers, content);
  const message = renderEmail(content, { name: 'Anna <b>', email: 'a@b.co', src: 'workshop-a', grow: 'V' }, ev);
  assert.ok(message.html.includes('Hi Anna &lt;b&gt;,'));
  assert.ok(!message.html.includes('<b>,'));
  assert.ok(message.html.includes('utm_campaign=workshop-a'));
  assert.equal(message.html.split(`${escapeHtml(content.result.focus_label)}</td>`).length - 1, 1, 'the focus label marks exactly one column');
  assert.ok(message.text.includes(`${content.result.focus_label}: Foundation`));
  assert.ok(message.text.includes(`Foundation: 4.0 ${content.result.score_suffix}`));
});

test('email: tile colours and sizes follow the page', () => {
  assert.deepEqual(EMAIL_TILE_HEIGHTS, TILE_HEIGHTS);
  for (let score = 1; score <= 10; score += 1) assert.equal(emailTileAlpha(score), tileAlpha(score));
  assert.equal(tileHex(10), '#5E1A4D');
  assert.equal(tileHex(1), '#E7DDE1');
  assert.equal(NOTE_BACKGROUND, '#F5EAD1');
  assert.equal(withParams('https://x.y/z', { a: '1 2' }), 'https://x.y/z?a=1%202');
  assert.equal(withParams('https://x.y/z?k=v#h', { a: '1' }), 'https://x.y/z?k=v&a=1#h');
});

test('email: the notification to Julia has the subject from the yaml and the facts', () => {
  const ev = evaluate(CASES.P.answers, content);
  const alert = renderNotification(content, { name: 'Anna', email: 'anna@example.com', src: '', grow: 'P', consent: true }, ev);
  assert.equal(alert.subject, content.email.notify_subject.replace('{name}', 'Anna').replace('{result}', 'Professional'));
  assert.ok(alert.text.includes('Email: anna@example.com'));
  assert.ok(alert.text.includes('Priority: Professional'));
  assert.ok(!alert.text.includes('Wants to grow'));
  assert.ok(alert.text.includes('Professional: 4.5 / 10'));
  assert.ok(alert.text.includes('Newsletter consent: Yes'));
  assert.ok(alert.text.includes('Source: direct'));
  const balanced = renderNotification(content, { name: 'B', email: 'b@b.co', src: 'x', grow: 'F', consent: false }, evaluate(CASES.balanced.answers, content));
  assert.ok(balanced.subject.includes('Balanced'));
});

// ---------- brevo ----------

test('brevo: the email body carries sender, recipient, tags, and replyTo only when set', () => {
  const base = { senderName: 'Julia Krylova', senderEmail: 'contact@juliakrylova.com', toEmail: 'anna@example.com', toName: 'Anna', subject: 's', html: '<p>h</p>', text: 't', tags: brevoTags('F', '') };
  const without = emailRequest({ ...base, replyTo: '' });
  assert.deepEqual(without.sender, { name: 'Julia Krylova', email: 'contact@juliakrylova.com' });
  assert.deepEqual(without.to, [{ email: 'anna@example.com', name: 'Anna' }]);
  assert.deepEqual(without.tags, ['mosaic-snapshot', 'F', 'direct']);
  assert.equal('replyTo' in without, false);
  const withReply = emailRequest({ ...base, replyTo: 'julia@gmail.com' });
  assert.deepEqual(withReply.replyTo, { email: 'julia@gmail.com' });
  assert.deepEqual(brevoTags('balanced', 'workshop-a'), ['mosaic-snapshot', 'balanced', 'workshop-a']);
});

test('brevo: the contact body has the list and the attributes, with the two fallbacks', () => {
  const base = { email: 'anna@example.com', name: 'Anna', listId: '7', result: 'Foundation', grow: 'Visibility', src: '', date: '2026-10-12' };
  const full = contactRequest({ ...base, variant: 'full' });
  assert.deepEqual(full, { email: 'anna@example.com', updateEnabled: true, listIds: [7], attributes: { FIRSTNAME: 'Anna', SNAPSHOT_RESULT: 'Foundation', SNAPSHOT_GROW: 'Visibility', SNAPSHOT_SRC: 'direct', SNAPSHOT_DATE: '2026-10-12' } });
  assert.deepEqual(contactRequest({ ...base, variant: 'name-only' }).attributes, { FIRSTNAME: 'Anna' });
  assert.equal('attributes' in contactRequest({ ...base, variant: 'bare' }), false);
  assert.equal(isAttributeError(400, '{"code":"invalid_parameter","message":"Attribute SNAPSHOT_DATE does not exist"}'), true);
  assert.equal(isAttributeError(401, 'Key not found'), false);
  assert.equal(notificationRequest({ senderName: 'J', senderEmail: 'j@x.y', toEmail: 'n@x.y', subject: 's', text: 't' }).to[0].email, 'n@x.y');
  assert.equal(describeLists({ lists: [{ id: 7, name: 'Newsletter' }] }, '7').found, true);
  assert.deepEqual(describeAttributes({ attributes: [{ name: 'FIRSTNAME' }] }).missing, ['SNAPSHOT_RESULT', 'SNAPSHOT_GROW', 'SNAPSHOT_SRC', 'SNAPSHOT_DATE']);
});

// ---------- the whole path with fake services ----------

function fakeServices({ config = {}, content: served = content, brevoResponses = [], contentError = '', now = new Date('2026-10-12T10:00:00Z'), state = {} } = {}) {
  const sheet = state.sheet || (state.sheet = { headerRow: HEADERS.slice(), rows: [] });
  const counters = state.counters || (state.counters = {});
  const cache = state.cache || (state.cache = {});
  const calls = [];
  const queue = brevoResponses.slice();
  return {
    calls,
    sheet,
    counters,
    services: {
      config: { BREVO_ENABLED: 'true', BREVO_API_KEY: 'k', SENDER_NAME: 'Julia Krylova', SENDER_EMAIL: 'contact@juliakrylova.com', NEWSLETTER_LIST_ID: '7', CONTENT_URL: 'https://example.com/content.json', ...config },
      now: () => now,
      log: () => {},
      loadContent: () => ({ content: served, error: contentError }),
      withLock: (fn) => fn(),
      hash: (email) => `h(${email})`,
      cache: { get: (key) => (key in cache ? cache[key] : null), put: (key, value) => { cache[key] = value; } },
      counters: { getAll: () => ({ ...counters }), set: (key, value) => { counters[key] = String(value); }, remove: (keys) => keys.forEach((key) => delete counters[key]) },
      sheet: {
        append: (record) => { sheet.rows.push(rowValues(sheet.headerRow, record)); return { rowIndex: sheet.rows.length + 1, headerRow: sheet.headerRow }; },
        update: (rowInfo, fields) => { const row = sheet.rows[rowInfo.rowIndex - 2]; Object.keys(fields).forEach((header) => { row[columnOf(sheet.headerRow, header) - 1] = fields[header]; }); },
      },
      brevo: (method, path, body) => { calls.push({ method, path, body }); return queue.length ? queue.shift() : { code: 201, text: '{"messageId":"x"}', json: { messageId: 'x' } }; },
      dateString: (date) => date.toISOString().slice(0, 10),
    },
  };
}
const cellOf = (fake, rowIndex, header) => fake.sheet.rows[rowIndex - 2][columnOf(fake.sheet.headerRow, header) - 1];

test('path: with Brevo off the row is written with skipped statuses and nothing is called', () => {
  const fake = fakeServices({ config: { BREVO_ENABLED: 'false' } });
  const outcome = processSubmission(submission, false, fake.services);
  assert.equal(outcome.emailStatus, STATUS.SKIPPED);
  assert.equal(outcome.contactStatus, STATUS.SKIPPED);
  assert.equal(fake.calls.length, 0);
  assert.equal(fake.sheet.rows.length, 1);
  assert.equal(cellOf(fake, outcome.rowIndex, 'Result'), 'Foundation');
  assert.equal(cellOf(fake, outcome.rowIndex, 'Email status'), 'skipped');
  assert.equal(Object.keys(fake.counters).length, 0);
});

test('path: email and contact are sent, statuses and counters updated, note stays empty', () => {
  const fake = fakeServices();
  const outcome = processSubmission(submission, false, fake.services);
  assert.equal(outcome.emailStatus, STATUS.SENT);
  assert.equal(outcome.contactStatus, STATUS.ADDED);
  assert.equal(outcome.note, '');
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[0].path, '/smtp/email');
  assert.equal(fake.calls[0].body.to[0].email, 'anna@example.com');
  assert.deepEqual(fake.calls[0].body.tags, ['mosaic-snapshot', 'F', 'workshop-a']);
  assert.equal('replyTo' in fake.calls[0].body, false);
  assert.equal(fake.calls[1].path, '/contacts');
  assert.equal(fake.calls[1].body.attributes.SNAPSHOT_RESULT, 'Foundation');
  assert.equal(fake.calls[1].body.attributes.SNAPSHOT_DATE, '2026-10-12');
  assert.equal(cellOf(fake, outcome.rowIndex, 'Email status'), 'sent');
  assert.equal(cellOf(fake, outcome.rowIndex, 'Contact status'), 'added');
  assert.equal(fake.counters['day:2026-10-12'], '1');
  assert.equal(fake.counters['hour:2026-10-12T10'], '1');
  assert.equal(fake.counters['emailday:2026-10-12:h(anna@example.com)'], '1');
});

test('path: a second submission from the same address within 2 minutes is rate-limited, the row is still written', () => {
  const state = {};
  const first = fakeServices({ state });
  processSubmission(submission, false, first.services);
  const second = fakeServices({ state, now: new Date('2026-10-12T10:01:00Z') });
  const outcome = processSubmission(submission, false, second.services);
  assert.equal(outcome.emailStatus, STATUS.RATE_LIMITED);
  assert.equal(outcome.contactStatus, STATUS.ADDED, 'the consent still counts');
  assert.ok(outcome.note.includes('limit'));
  assert.equal(second.calls.length, 1);
  assert.equal(second.calls[0].path, '/contacts');
  assert.equal(state.sheet.rows.length, 2);
  const upperCase = fakeServices({ state, now: new Date('2026-10-12T10:01:30Z') });
  assert.equal(processSubmission({ ...submission, email: 'Anna@Example.com' }, false, upperCase.services).emailStatus, STATUS.RATE_LIMITED, 'letter case does not bypass the limit');
  const third = fakeServices({ state, now: new Date('2026-10-12T10:03:00Z') });
  assert.equal(processSubmission(submission, false, third.services).emailStatus, STATUS.SENT);
});

test('path: a spammy name gets the rejected status and no calls', () => {
  const fake = fakeServices();
  const spam = { ...submission, name: 'www.spam.com' };
  const outcome = processSubmission(spam, true, fake.services);
  assert.equal(outcome.emailStatus, STATUS.REJECTED);
  assert.equal(outcome.contactStatus, STATUS.SKIPPED);
  assert.equal(fake.calls.length, 0);
  assert.equal(fake.sheet.rows.length, 1);
  assert.ok(outcome.note.includes('spam'));
});

test('path: attribute errors fall back to FIRSTNAME, then to no attributes', () => {
  const attributeError = { code: 400, text: '{"message":"Attribute SNAPSHOT_DATE does not exist"}', json: null };
  const fake = fakeServices({ brevoResponses: [{ code: 201, text: '{}', json: {} }, attributeError, attributeError, { code: 201, text: '{}', json: {} }] });
  const outcome = processSubmission(submission, false, fake.services);
  assert.equal(outcome.contactStatus, STATUS.ADDED_NO_ATTRIBUTES);
  assert.equal(fake.calls.length, 4);
  assert.deepEqual(fake.calls[2].body.attributes, { FIRSTNAME: 'Anna' });
  assert.equal('attributes' in fake.calls[3].body, false);
  assert.ok(outcome.note.includes('without attributes'));
});

test('path: other Brevo errors become failed with the answer in the note', () => {
  const fake = fakeServices({ brevoResponses: [{ code: 401, text: '{"message":"Key not found"}', json: null }, { code: 500, text: 'oops', json: null }] });
  const outcome = processSubmission(submission, false, fake.services);
  assert.equal(outcome.emailStatus, STATUS.FAILED);
  assert.equal(outcome.contactStatus, STATUS.FAILED);
  assert.ok(outcome.note.includes('Brevo 401'));
  assert.ok(outcome.note.includes('Brevo 500'));
});

test('path: without content the result is computed with the built-in logic, the email fails with "no content"', () => {
  const fake = fakeServices({ content: null, contentError: 'content.json answered 404' });
  const outcome = processSubmission(submission, false, fake.services);
  assert.equal(outcome.evaluation.result, 'F');
  assert.equal(outcome.emailStatus, STATUS.FAILED);
  assert.ok(outcome.note.includes('no content'));
  assert.ok(outcome.note.includes('404'));
  assert.equal(outcome.contactStatus, STATUS.ADDED);
  assert.equal(cellOf(fake, outcome.rowIndex, 'Result'), 'F');
  assert.equal(cellOf(fake, outcome.rowIndex, 'Consent text'), '');
});

test('path: a mismatch between the client result and the server goes into the note', () => {
  const fake = fakeServices({ config: { BREVO_ENABLED: 'false' } });
  const outcome = processSubmission({ ...submission, clientResult: 'V' }, false, fake.services);
  assert.ok(outcome.note.includes('client result V, server F'));
});

test('path: the notification to Julia is sent and counted, replyTo and test address are honoured', () => {
  const fake = fakeServices({ config: { NOTIFY_EMAIL: 'julia@example.com', REPLY_TO: 'julia@gmail.com', TEST_EMAIL: 'anna@example.com' } });
  const outcome = processSubmission(submission, false, fake.services);
  assert.equal(outcome.emailStatus, STATUS.SENT);
  assert.equal(fake.calls.length, 3);
  assert.deepEqual(fake.calls[0].body.replyTo, { email: 'julia@gmail.com' });
  assert.equal(fake.calls[2].body.to[0].email, 'julia@example.com');
  assert.ok(fake.calls[2].body.subject.includes('Anna'));
  assert.equal(fake.counters['day:2026-10-12'], '2');
  const again = fakeServices({ config: { TEST_EMAIL: 'anna@example.com' }, state: { sheet: fake.sheet, counters: fake.counters, cache: {} }, now: new Date('2026-10-12T10:00:30Z') });
  assert.equal(processSubmission(submission, false, again.services).emailStatus, STATUS.SENT);
});

test('path: no consent means no contact call', () => {
  const fake = fakeServices();
  const outcome = processSubmission({ ...submission, consent: false }, false, fake.services);
  assert.equal(outcome.contactStatus, STATUS.NO_CONSENT);
  assert.equal(fake.calls.length, 1);
  assert.equal(cellOf(fake, outcome.rowIndex, 'Newsletter consent'), 'No');
});

// ---------- Code.gs ----------

test('backend/Code.gs matches a fresh build, has no imports, no secrets and no yaml texts', async () => {
  const fresh = await buildBackendCode();
  const committed = await readFile(CODE_GS, 'utf8');
  assert.equal(committed, fresh, 'run npm run backend and commit backend/Code.gs');
  assert.ok(fresh.startsWith('// generated from backend/src, do not edit here'));
  assert.ok(!/^\s*(import|export)\b/m.test(fresh));
  assert.ok(!/xkeysib|api-key:\s*['"][A-Za-z0-9]/.test(fresh));
  const leaves = [];
  const walk = (value) => {
    if (typeof value === 'string') leaves.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(content);
  for (const text of leaves.filter((leaf) => leaf.length > 12 && !/^https?:/.test(leaf))) {
    assert.ok(!fresh.includes(text), `Code.gs must not contain "${text}"`);
  }
  assert.ok(fresh.includes('function doPost('));
  assert.ok(fresh.includes('function evaluate('));
});

// ---------- review follow-ups ----------

test('formulas cannot reach the sheet: leading = + - @ leave the name, such emails are invalid, submitted_at must be ISO', () => {
  const name = parseSubmission(good({ name: '=HYPERLINK("//evil.io","Open")' })).submission.name;
  assert.equal(name, 'HYPERLINK("//evil.io","Open")');
  assert.equal(parseSubmission(good({ name: '+-=@Anna' })).submission.name, 'Anna');
  assert.ok(errorsOf(good({ email: '=IMPORTDATA("x")@a.b' })).some((e) => e.includes('email')));
  assert.ok(errorsOf(good({ email: '-anna@example.com' })).some((e) => e.includes('email')));
  assert.equal(parseSubmission(good({ submitted_at: '=HYPERLINK("//e.io")' })).submission.submittedAt, '');
  assert.equal(parseSubmission(good({ submitted_at: '2026-10-12T10:00:00.000Z' })).submission.submittedAt, '2026-10-12T10:00:00.000Z');
  assert.equal(parseSubmission(good({ submitted_at: '2026-10-12T10:00:00Z' })).submission.submittedAt, '2026-10-12T10:00:00Z');
  assert.equal(safeCell('=1+1'), ' =1+1');
  assert.equal(safeCell('+41 79'), ' +41 79');
  assert.equal(safeCell('Anna'), 'Anna');
  assert.equal(safeCell(7.5), 7.5);
  assert.deepEqual(rowValues(['Note', 'F1'], { Note: '@import', F1: 4 }), [' @import', 4]);
});

test('invisible and direction characters leave the name', () => {
  const tricky = 'An' + String.fromCharCode(0x200B) + 'na' + String.fromCharCode(0x202E) + String.fromCharCode(0xFEFF);
  assert.equal(cleanName(tricky), 'Anna');
  assert.equal(cleanName('   '), '');
  assert.ok(errorsOf(good({ name: '=' })).some((e) => e.includes('name')));
});

test('path: a Brevo transport failure (code 0) ends in failed with the reason, never pending', () => {
  const fake = fakeServices({ brevoResponses: [{ code: 0, text: 'request failed: DNS error', json: null }, { code: 0, text: 'request failed: timeout', json: null }] });
  const outcome = processSubmission(submission, false, fake.services);
  assert.equal(outcome.emailStatus, STATUS.FAILED);
  assert.equal(outcome.contactStatus, STATUS.FAILED);
  assert.ok(outcome.note.includes('DNS error'));
  assert.equal(cellOf(fake, outcome.rowIndex, 'Email status'), 'failed');
  assert.equal(cellOf(fake, outcome.rowIndex, 'Contact status'), 'failed');
});

test('path: a service that throws after the row was written still leaves final statuses', () => {
  const fake = fakeServices();
  fake.services.brevo = () => { throw new Error('boom'); };
  const outcome = processSubmission(submission, false, fake.services);
  assert.equal(outcome.emailStatus, STATUS.FAILED);
  assert.equal(outcome.contactStatus, STATUS.FAILED);
  assert.ok(outcome.note.includes('boom'));
  assert.equal(cellOf(fake, outcome.rowIndex, 'Email status'), 'failed');
  assert.notEqual(cellOf(fake, outcome.rowIndex, 'Note'), '');
});

test('path: when the lock does not come, the row is still written without sending', () => {
  const fake = fakeServices();
  fake.services.withLock = () => { throw new Error('Lock timeout: another process was holding the lock'); };
  const outcome = processSubmission(submission, false, fake.services);
  assert.equal(outcome.emailStatus, STATUS.FAILED);
  assert.equal(outcome.contactStatus, STATUS.SKIPPED);
  assert.ok(outcome.note.includes('lock'));
  assert.equal(fake.sheet.rows.length, 1);
  assert.equal(fake.calls.length, 0);
  assert.equal(Object.keys(fake.counters).length, 0);
});

test('brevo: the transactional flag is read from relay.enabled', () => {
  assert.equal(relayEnabled({ relay: { enabled: true } }), true);
  assert.equal(relayEnabled({ relay: { enabled: false } }), false);
  assert.equal(relayEnabled({ plan: [] }), null);
  assert.ok(describeAccount({ email: 'j@x.y', plan: [{ type: 'free', credits: 300, creditsType: 'sendLimit' }], relay: { enabled: false } }).includes('NOT enabled'));
  assert.ok(describeAccount({ plan: [] }).includes('not in the answer'));
});

test('email: Outlook gets a fixed 600 px table, the preheader is hidden there too, the button padding sits on the cell', () => {
  const message = renderEmail(content, { name: 'Anna', email: 'a@b.co', src: '', grow: 'V' }, evaluate(CASES.F.answers, content));
  assert.ok(message.html.includes('<!--[if mso]><table role="presentation" width="600"'));
  assert.ok(message.html.includes('<!--[if mso]></td></tr></table><![endif]-->'));
  assert.ok(message.html.includes('mso-hide:all;'));
  assert.ok(/border-radius:10px;padding:16px 28px;"><a href=/.test(message.html));
});

// ---------- Priority column and the Summary sheet ----------

test('sheet: the column is called Priority, an old Wants to grow header is renamed once', () => {
  assert.equal(HEADERS[6], 'Priority');
  assert.ok(!HEADERS.includes('Wants to grow'));
  const old = HEADERS.map((h) => (h === 'Priority' ? 'Wants to grow' : h));
  assert.deepEqual(headerRenames(old), [{ column: 7, from: 'Wants to grow', to: 'Priority' }]);
  assert.deepEqual(headerRenames(HEADERS), []);
  assert.deepEqual(headerRenames(['Wants to grow', 'Priority']), [], 'nothing to rename when Priority already exists');
  const record = buildRecord({ receivedAt: 'now', submission, evaluation, pillars: content.pillars, emailStatus: 's', contactStatus: 'a', note: '', consentLabel: '' });
  assert.equal(record.Priority, 'Visibility');
});

const layout = summaryLayout({ pillars: pillarLabels(content), items: questionItems(content), lastColumn: 'AB' });
const allFormulas = layout.formulas.map((f) => f.formula);
const COLUMN_REF = /INDEX\(Responses!\$A\$2:\$AB,0,MATCH\("([^"]+)",Responses!\$1:\$1,0\)\)/g;

test('summary: every reference to Responses goes through MATCH on a header text', () => {
  const headersUsed = new Set();
  for (const f of allFormulas) {
    const stripped = f.replace(COLUMN_REF, (m, header) => { headersUsed.add(header); return 'COL'; });
    assert.ok(!stripped.includes('Responses!'), `direct reference in ${f.slice(0, 120)}`);
  }
  for (const header of headersUsed) assert.ok(HEADERS.includes(header), `unknown header ${header}`);
  assert.ok(headersUsed.size >= 8, [...headersUsed].join(', '));
});

test('summary: no formula touches First name or Email, every one over Responses excludes test rows', () => {
  for (const f of allFormulas) {
    assert.ok(!f.includes('"First name"') && !f.includes('"Email"'), f.slice(0, 120));
    if (f.includes('Responses!')) assert.ok(f.includes('"<>test"') || f.includes('<>"test"') || f.includes("<> 'test'"), `no test exclusion in ${f.slice(0, 120)}`);
  }
});

test('summary: brackets and quotes are paired in every formula', () => {
  for (const f of allFormulas) assert.ok(balanced(f), f.slice(0, 120));
  assert.equal(balanced('=IF(A1="x",1,2)'), true);
  assert.equal(balanced('=IF(A1="x",1,2'), false);
  assert.equal(balanced('=IF(A1="x,1,2)'), false);
  assert.equal(columnLetter(1), 'A');
  assert.equal(columnLetter(28), 'AB');
  assert.equal(columnLetter(53), 'BA');
});

test('summary: twelve question rows with names from the content, codes without it', () => {
  const withContent = questionItems(content);
  assert.equal(withContent.length, 12);
  assert.deepEqual(withContent[0], { pillarShort: 'Foundation', title: content.pillars[0].items[0].title, code: 'F1' });
  assert.deepEqual(withContent[11], { pillarShort: 'Visibility', title: content.pillars[2].items[3].title, code: 'V4' });
  const helperTitles = layout.cells.filter((c) => c.column === 9 && c.row >= ROWS.questionsFirst).map((c) => c.value);
  assert.deepEqual(helperTitles, withContent.map((item) => item.title));
  const fallback = questionItems(null);
  assert.equal(fallback.length, 12);
  assert.deepEqual(fallback[4], { pillarShort: 'P', title: 'P1', code: 'P1' });
  assert.deepEqual(pillarLabels(null), [{ key: 'F' }, { key: 'P' }, { key: 'V' }]);
  const bare = summaryLayout({ pillars: pillarLabels(null), items: fallback, lastColumn: 'AB' });
  assert.ok(bare.cells.some((c) => c.row === ROWS.resultFirst && c.value === 'F'));
  assert.ok(bare.formulas.some((f) => f.formula.includes('MATCH("V4"')));
});

test('summary: the sections and the sorted table are where the layout says', () => {
  const at = (row, column) => layout.cells.find((c) => c.row === row && c.column === column);
  assert.equal(at(ROWS.responsesTitle, 1).value, 'Responses');
  assert.equal(at(ROWS.resultTitle, 1).value, 'Result');
  assert.equal(at(ROWS.priorityTitle, 1).value, 'Priority');
  assert.equal(at(ROWS.resultFirst + 3, 1).value, 'Balanced');
  assert.equal(at(ROWS.averageTitle, 1).value, 'Average by pillar');
  const sortFormula = layout.formulas.find((f) => f.row === ROWS.questionsFirst && f.column === 1).formula;
  assert.equal(sortFormula, '=SORT($H$30:$K$41,3,TRUE)');
  const query = layout.formulas.find((f) => f.row === ROWS.sourceFirst && f.column === 1).formula;
  assert.ok(query.startsWith('=IFERROR(QUERY({') && query.includes("where Col1 <> 'test'") && query.includes('order by count(Col1) desc'));
  assert.equal(layout.formulas.filter((f) => f.column === 4 && f.row >= ROWS.sourceFirst).length, 30);
  assert.ok(layout.formats.some((f) => f.format === '0%') && layout.formats.some((f) => f.format === '0.00') && layout.formats.some((f) => f.format === 'yyyy-mm-dd hh:mm'));
  assert.deepEqual(layout.hiddenColumns, { start: 8, count: 4 });
});

function fakeSpreadsheet(initial = {}) {
  const sheets = new Map();
  let order = [];
  const makeSheet = (name, rows = []) => {
    const grid = rows.map((r) => r.slice());
    const formulas = new Map();
    const formats = new Map();
    const weights = new Map();
    const hidden = [];
    const resized = [];
    let frozen = 0;
    const ensure = (r, c) => { while (grid.length < r) grid.push([]); const row = grid[r - 1]; while (row.length < c) row.push(''); };
    const sheet = {
      name, grid, formulas, formats, weights, hidden, resized,
      getName: () => name,
      getLastColumn: () => grid.reduce((m, row) => Math.max(m, row.length), 0),
      getLastRow: () => grid.length,
      getMaxRows: () => Math.max(grid.length, 1000),
      getMaxColumns: () => Math.max(sheet.getLastColumn(), 26),
      setFrozenRows: (n) => { frozen = n; },
      getFrozenRows: () => frozen,
      clear: () => { grid.length = 0; formulas.clear(); formats.clear(); weights.clear(); },
      // hiding or resizing the same columns again changes nothing in a real sheet
      hideColumns: (start, count) => { if (!hidden.some(([s, c]) => s === start && c === count)) hidden.push([start, count]); },
      autoResizeColumns: (start, count) => { if (!resized.some(([s, c]) => s === start && c === count)) resized.push([start, count]); },
      getRange: (r, c, nr = 1, nc = 1) => ({
        getValues: () => { ensure(r + nr - 1, c + nc - 1); return grid.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)); },
        setValues: (values) => values.forEach((row, i) => row.forEach((v, j) => { ensure(r + i, c + j); grid[r + i - 1][c + j - 1] = v; })),
        setValue: (v) => { ensure(r, c); grid[r - 1][c - 1] = v; },
        setFormula: (f) => { ensure(r, c); formulas.set(`${r},${c}`, f); grid[r - 1][c - 1] = f; },
        setNumberFormat: (fmt) => { for (let i = 0; i < nr; i += 1) for (let j = 0; j < nc; j += 1) formats.set(`${r + i},${c + j}`, fmt); },
        setFontWeight: (w) => { for (let i = 0; i < nr; i += 1) for (let j = 0; j < nc; j += 1) weights.set(`${r + i},${c + j}`, w); },
      }),
    };
    return sheet;
  };
  const spreadsheet = {
    active: null,
    getId: () => 'fake-id',
    getName: () => 'Fake',
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => { const s = makeSheet(name); sheets.set(name, s); order.push(name); return s; },
    setActiveSheet: (s) => { spreadsheet.active = s; },
    moveActiveSheet: (position) => { order = order.filter((n) => n !== spreadsheet.active.name); order.splice(position - 1, 0, spreadsheet.active.name); },
    order: () => order,
    sheets,
  };
  Object.entries(initial).forEach(([name, rows]) => { sheets.set(name, makeSheet(name, rows)); order.push(name); });
  return spreadsheet;
}
const snapshot = (sheet) => JSON.stringify({ grid: sheet.grid, formulas: [...sheet.formulas], formats: [...sheet.formats], weights: [...sheet.weights], hidden: sheet.hidden, frozen: sheet.getFrozenRows() });

test('setup on a fake spreadsheet: renames the old header once, keeps the rows, builds Summary first, repeats without changes', () => {
  const oldHeaders = HEADERS.map((h) => (h === 'Priority' ? 'Wants to grow' : h));
  const newRecord = buildRecord({ receivedAt: 'd1', submission, evaluation, pillars: content.pillars, emailStatus: 'sent', contactStatus: 'added', note: '', consentLabel: 'c' });
  const oldRecord = { ...newRecord, 'Wants to grow': newRecord.Priority };
  delete oldRecord.Priority;
  const dataRow = rowValues(oldHeaders, oldRecord);
  const spreadsheet = fakeSpreadsheet({ Responses: [oldHeaders, dataRow] });
  const props = { values: {}, setProperty(key, value) { this.values[key] = value; } };
  const first = runSetup({ spreadsheet, props, loaded: { content, error: '' } });
  const responses = spreadsheet.getSheetByName('Responses');
  assert.equal(responses.grid[0][6], 'Priority');
  assert.equal(responses.grid[1][6], 'Visibility', 'the value below the renamed header stays');
  assert.deepEqual(responses.grid[1], dataRow);
  assert.equal(props.values.SHEET_ID, 'fake-id');
  assert.ok(first[0].includes('renamed Wants to grow to Priority'), first[0]);
  assert.ok(first[1].includes('Summary') && first[1].includes('question names from the content'), first[1]);
  assert.equal(spreadsheet.order()[0], SUMMARY_SHEET_NAME);
  const summary = spreadsheet.getSheetByName(SUMMARY_SHEET_NAME);
  assert.ok(summary.formulas.size > 60);
  assert.equal(summary.grid[0][0].startsWith('Figures update by themselves'), true);
  assert.ok(summary.formulas.get(`${ROWS.total},2`).includes('MATCH("Result"'));
  assert.deepEqual(summary.hidden, [[8, 4]]);
  const responsesAfterFirst = snapshot(responses);
  const summaryAfterFirst = snapshot(summary);
  const second = runSetup({ spreadsheet, props, loaded: { content, error: '' } });
  assert.ok(!second[0].includes('renamed'), 'the rename happens once');
  assert.equal(snapshot(responses), responsesAfterFirst, 'Responses is untouched by a second run');
  assert.equal(snapshot(spreadsheet.getSheetByName(SUMMARY_SHEET_NAME)), summaryAfterFirst, 'the Summary sheet is rebuilt identically');
  assert.equal(spreadsheet.order().filter((n) => n === SUMMARY_SHEET_NAME).length, 1);
});

test('setup on an empty fake spreadsheet writes the new headers and the fallback Summary when content is missing', () => {
  const spreadsheet = fakeSpreadsheet();
  const props = { values: {}, setProperty(key, value) { this.values[key] = value; } };
  const lines = runSetup({ spreadsheet, props, loaded: { content: null, error: 'content.json answered 404' } });
  assert.deepEqual(spreadsheet.getSheetByName('Responses').grid[0], HEADERS);
  assert.equal(spreadsheet.getSheetByName('Responses').getFrozenRows(), 1);
  assert.ok(lines[1].includes('question codes F1 to V4') && lines[1].includes('404'), lines[1]);
  const summary = spreadsheet.getSheetByName(SUMMARY_SHEET_NAME);
  assert.equal(summary.grid[ROWS.questionsFirst - 1][8], 'F1');
  assert.equal(summary.grid[ROWS.resultFirst - 1][0], 'F');
});
