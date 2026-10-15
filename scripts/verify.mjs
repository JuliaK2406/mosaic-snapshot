// Browser checks with Playwright against dist/: texts match the yaml word for word,
// no horizontal scroll at 360 and 390, fonts loaded, gold frame on the right column,
// palette, history, validation, privacy, reduced motion, relative paths.
// Run after npm run build: npm run verify

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadContent } from '../src/check.mjs';
import { build } from '../src/build.mjs';
import { startServer, PREVIEW_BASE } from './serve.mjs';
import { placeholder } from './shots-fixes.mjs';
import { start, answer, grow, fillEmail, submit, waitStep, complete, back, labels, PERSON, RESULT_SETTLE_MS } from './shots.mjs';
import { renderEmail } from '../backend/src/email.js';
import { evaluate } from '../src/app/scoring.js';

const content = await loadContent();
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  (${String(detail).slice(0, 300)})` : ''}`);
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const inText = (key) => content.pillars.find((p) => p.key === key).in_text;

const TOKENS = ['#5E1A4D', '#1E2A47', '#FAF8F5', '#B89B5E', '#E4E2DD', '#EFDCAC', '#545B70', '#8C8577', '#F3E9EF', '#FFFFFF'];
const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};
const ALLOWED_RGB = new Set(TOKENS.map(hexToRgb));

const CASES = {
  F: { answers: [4, 3, 5, 4, 7, 6, 8, 7, 6, 5, 7, 6], grow: 'V', kind: 'mismatch' },
  P: { answers: [8, 8, 8, 8, 4, 5, 4, 5, 8, 8, 8, 8], grow: 'P', kind: 'match' },
  V: { answers: [8, 8, 8, 8, 8, 8, 8, 8, 2, 3, 2, 3], grow: 'F', kind: 'mismatch' },
  balanced: { answers: new Array(12).fill(8), grow: 'F', kind: null },
};
const TILE_HEIGHTS = [62, 46, 54, 50, 48, 60, 46, 58, 56, 50, 62, 44];
const TILE_RANKS = [0, 5, 2, 9, 4, 7, 1, 10, 3, 8, 6, 11];
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

// verify runs against its own build in a temporary folder with the endpoint pointed at a
// closed local port, so a real endpoint in the yaml never receives test submissions.
const DEAD_ENDPOINT = 'http://127.0.0.1:9/__endpoint';
const verifyDist = await mkdtemp(path.join(os.tmpdir(), 'mosaic-verify-'));
await build({ distDir: verifyDist, endpointUrl: DEAD_ENDPOINT, backend: false, quiet: true });
const { server, url } = await startServer(0, verifyDist);
const browser = await chromium.launch();
const isOwnRequest = (x) => x.startsWith(url) || x.startsWith(DEAD_ENDPOINT) || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(x);

async function open(options = MOBILE, pathname = '/', before) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  if (before) await before(page);
  await page.goto(`${url}${pathname}`, { waitUntil: 'networkidle' });
  return { page, context, requests };
}

// VERIFY_ONLY=<text> runs only the sections whose name contains the text (for debugging a scenario).
async function section(name, fn) {
  if (process.env.VERIFY_ONLY && !name.includes(process.env.VERIFY_ONLY)) return;
  try {
    await fn();
  } catch (error) {
    check(`${name}: finished without an exception`, false, `${error.message} ${error.stack ? error.stack.split('\n').slice(1, 3).join(' ') : ''}`);
  }
}

try {
  // ---------- each result: texts, mosaic, grow line, link, privacy, back ----------
  for (const [key, c] of Object.entries(CASES)) {
    await section(`result ${key}`, async () => {
      const { page, context, requests } = await open(MOBILE, '/?src=Work%20shop-A_1!');
      await complete(page, { ...c, ...PERSON });
      await page.waitForTimeout(RESULT_SETTLE_MS);
      const text = norm(await page.evaluate(() => document.getElementById('app').textContent));
      const t = content.results[key];
      const r = content.result;
      const expected = [
        t.headline, t.what_it_means, ...(key === 'balanced' ? t.whats_next : t.how_it_affects), ...t.steps, t.cta_question,
        r.eyebrow, r.section_labels.what_it_means,
        key === 'balanced' ? r.section_labels.whats_next : r.section_labels.how_it_affects,
        r.section_labels.first_steps, r.cta_button, r.cta_note, r.retake_label,
        r.signature_name, r.signature_title, r.legal_line, r.legend_low, r.legend_high,
        r.greeting_with_name.replace('{name}', PERSON.name), r.copy_line.replace('{email}', PERSON.email),
        ...content.pillars.map((p) => p.short),
      ];
      if (key !== 'balanced') expected.push(r.focus_label);
      const missing = expected.filter((s) => !text.includes(norm(s)));
      check(`result ${key}: every text from the yaml is on the page word for word`, missing.length === 0, missing.join(' | '));
      const unexpected = key === 'balanced'
        ? [r.section_labels.how_it_affects, r.focus_label]
        : [r.section_labels.whats_next, ...content.results.balanced.steps];
      check(`result ${key}: texts of other results are absent`, unexpected.every((s) => !text.includes(norm(s))));

      const focusIndex = await page.evaluate(() => [...document.querySelectorAll('.mosaic__col')].findIndex((col) => col.classList.contains('is-focus')));
      const expectedIndex = key === 'balanced' ? -1 : content.pillars.findIndex((p) => p.key === key);
      check(`result ${key}: gold frame on the right column`, focusIndex === expectedIndex, `got ${focusIndex}, expected ${expectedIndex}`);
      const frame = await page.evaluate(() => {
        const col = document.querySelector('.mosaic__col.is-focus');
        if (!col) return null;
        const cs = getComputedStyle(col);
        return { border: cs.borderTopColor, width: cs.borderTopWidth, radius: cs.borderTopLeftRadius, dots: document.querySelectorAll('.mosaic__dot').length };
      });
      if (key === 'balanced') check('result balanced: no frame and no focus dot', frame === null && (await page.evaluate(() => document.querySelectorAll('.mosaic__dot').length)) === 0);
      else check(`result ${key}: frame is gold, 2px, radius 12px, one dot`, frame && frame.border === 'rgb(184, 155, 94)' && frame.width === '2px' && frame.radius === '12px' && frame.dots === 1, JSON.stringify(frame));

      const growNote = await page.evaluate(() => (document.querySelector('.grow-note') ? document.querySelector('.grow-note').textContent : null));
      if (c.kind) {
        const template = c.kind === 'match' ? r.grow_match : r.grow_mismatch;
        const expectedLine = template.replace('{grow}', inText(c.grow)).replace('{focus}', inText(key));
        check(`result ${key}: grow line is the ${c.kind} text with pillar names filled in`, growNote === expectedLine, growNote);
        const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.grow-note')).backgroundColor);
        check(`result ${key}: grow line sits on champagne at 50%`, bg === 'rgba(239, 220, 172, 0.5)', bg);
      } else {
        check('result balanced: no grow line', growNote === null);
      }

      const scores = await page.evaluate(() => [...document.querySelectorAll('.mosaic__score')].map((s) => s.firstChild.textContent));
      const expectedScores = content.pillars.map((p, i) => (c.answers.slice(i * 4, i * 4 + 4).reduce((a, b) => a + b, 0) / 4).toFixed(1));
      check(`result ${key}: averages shown as ${expectedScores.join(', ')}`, JSON.stringify(scores) === JSON.stringify(expectedScores), scores.join(', '));

      const tiles = await page.evaluate(() => [...document.querySelectorAll('.mosaic__tile')].map((tile) => ({
        h: tile.style.height,
        title: tile.title,
        label: tile.getAttribute('aria-label'),
        role: tile.getAttribute('role'),
        delay: tile.style.animationDelay,
        opacity: getComputedStyle(tile).opacity,
        bg: getComputedStyle(tile).backgroundColor,
      })));
      check(`result ${key}: 12 tiles, all fully visible after 2.5 s`, tiles.length === 12 && tiles.every((tile) => tile.opacity === '1'));
      check(`result ${key}: tile heights as specified`, JSON.stringify(tiles.map((tile) => tile.h)) === JSON.stringify(TILE_HEIGHTS.map((h) => `${h}px`)));
      check(`result ${key}: tile delays are 150 + rank x 85 ms`, tiles.every((tile, i) => tile.delay === `${150 + TILE_RANKS[i] * 85}ms`));
      const titles = content.pillars.flatMap((p, pi) => p.items.map((item, j) => `${item.title}: ${c.answers[pi * 4 + j]} ${r.score_suffix}`));
      check(`result ${key}: tile titles read "item: score / 10"`, JSON.stringify(tiles.map((tile) => tile.title)) === JSON.stringify(titles));
      check(`result ${key}: tiles are readable by assistive tech (role img with the same label)`, tiles.every((tile) => tile.role === 'img' && tile.label === tile.title));
      const headings = await page.evaluate(() => [...document.querySelectorAll('#app h1, #app h2, #app h3')].map((h) => h.tagName));
      check(`result ${key}: one h1, then h2 and h3 sections`, headings.filter((h) => h === 'H1').length === 1 && headings[0] === 'H1' && headings.includes('H2') && headings.includes('H3'), headings.join(' '));
      const alphaOk = tiles.every((tile, i) => {
        const score = c.answers[i];
        const alpha = 0.12 + (0.88 * (score - 1)) / 9;
        const m = tile.bg.match(/rgba?\(94, 26, 77(?:, ([\d.]+))?\)/);
        if (!m) return false;
        const got = m[1] === undefined ? 1 : Number(m[1]);
        return Math.abs(got - alpha) < 0.01;
      });
      check(`result ${key}: tile opacity follows 0.12 + 0.88 x (score - 1) / 9`, alphaOk, tiles.map((tile) => tile.bg).join(' '));

      const link = await page.evaluate(() => {
        const a = document.querySelector('.cta a');
        return { href: a.href, rel: a.getAttribute('rel'), target: a.target };
      });
      const u = new URL(link.href);
      check(`result ${key}: Calendly link keeps the base and adds utm tags (src cleaned to workshop-a_1)`,
        u.origin + u.pathname === content.links.calendly
          && u.searchParams.get('utm_source') === 'mosaic-snapshot'
          && u.searchParams.get('utm_medium') === 'result'
          && u.searchParams.get('utm_campaign') === 'workshop-a_1'
          && u.searchParams.get('utm_content') === key,
        link.href);
      check(`result ${key}: link opens in a new tab with rel=noopener`, link.rel === 'noopener' && link.target === '_blank');
      check(`result ${key}: page is scrolled to the top`, (await page.evaluate(() => window.scrollY)) === 0);

      const external = requests.filter((x) => !isOwnRequest(x));
      check(`result ${key}: no requests except own files, Google Fonts and the page's own endpoint`, external.length === 0, external.join(', '));
      const storage = await page.evaluate(() => ({ ls: localStorage.length, ss: sessionStorage.length, cookie: document.cookie }));
      check(`result ${key}: no localStorage, sessionStorage or cookies`, storage.ls === 0 && storage.ss === 0 && storage.cookie === '');

      await page.goBack();
      await waitStep(page, 'intro');
      await start(page);
      const selected = await page.evaluate(() => document.querySelectorAll('.rate.is-selected').length);
      const counter = await page.evaluate(() => document.querySelector('.topbar__count').textContent);
      check(`result ${key}: back gesture returns to the first screen and clears the answers`, selected === 0 && counter === '1 / 13');
      await context.close();
    });
  }

  // ---------- sample result: only from ?sample, only while unpublished ----------
  await section('sample', async () => {
    const { page: intro, context: introContext } = await open();
    const links = await intro.evaluate(() => document.querySelectorAll('.screen--intro .link-button, .screen--intro a').length);
    check('first screen has no link to the sample result', links === 0, String(links));
    await introContext.close();
    const { page, context, requests } = await open(MOBILE, '/?sample');
    await waitStep(page, 'result');
    await page.waitForTimeout(RESULT_SETTLE_MS);
    const text = norm(await page.evaluate(() => document.getElementById('app').textContent));
    const expectedLine = content.result.grow_mismatch.replace('{grow}', inText('V')).replace('{focus}', inText('F'));
    check('sample result: focus F, greeting without a name, mismatch line about Visibility and Foundation',
      text.includes(norm(content.results.F.headline)) && text.includes(norm(content.result.greeting)) && text.includes(norm(expectedLine)) && !text.includes(norm(content.result.greeting_with_name.replace('{name}', ''))));
    check('sample result: no copy line without an email', !text.includes('on its way'));
    const external = requests.filter((x) => !x.startsWith(url) && !/^https:\/\/fonts\./.test(x));
    check('sample result: nothing is sent anywhere, not even to the endpoint', external.length === 0, external.join(', '));
    await page.goBack();
    await waitStep(page, 'intro');
    check('sample result: back leads to the first screen', true);
    await context.close();
    const publishedDist = await mkdtemp(path.join(os.tmpdir(), 'mosaic-published-'));
    const published = await startServer(0, publishedDist);
    try {
      await build({ distDir: publishedDist, endpointUrl: DEAD_ENDPOINT, backend: false, quiet: true, patch: (c) => { c.meta.published = true; } });
      const ctx = await browser.newContext(MOBILE);
      const p = await ctx.newPage();
      await p.goto(`${published.url}/?sample`, { waitUntil: 'networkidle' });
      await p.waitForTimeout(600);
      const state = await p.evaluate(() => ({ step: document.getElementById('app').dataset.step, robots: document.querySelector('meta[name="robots"]') !== null }));
      check('published build: ?sample does nothing, the first screen stays', state.step === 'intro' && !state.robots, JSON.stringify(state));
      await ctx.close();
    } finally {
      published.server.close();
      await rm(publishedDist, { recursive: true, force: true });
    }
  });

  // ---------- horizontal overflow and fonts ----------
  for (const width of [360, 390]) {
    await section(`overflow ${width}`, async () => {
      const { page, context } = await open({ viewport: { width, height: 780 }, isMobile: true, hasTouch: true });
      const overflowAt = async (label) => {
        const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        check(`${width}px ${label}: no horizontal scroll`, sw === cw, `${sw} vs ${cw}`);
      };
      await overflowAt('first screen');
      await start(page);
      await overflowAt('question 1');
      await answer(page, [5, 6, 7, 4, 5, 6, 7, 4, 5, 6, 7, 4]);
      await overflowAt('question 13');
      await grow(page, 'V');
      await overflowAt('email');
      await submit(page);
      await overflowAt('email with errors');
      await fillEmail(page, { name: 'Anna', email: 'a-very-long-address.for-testing-wrapping@example-domain-name.com' });
      await submit(page);
      await waitStep(page, 'result');
      await page.waitForTimeout(RESULT_SETTLE_MS);
      await overflowAt('result');
      if (width === 390) {
        const fonts = await page.evaluate(() => {
          const loaded = (family) => [...document.fonts].some((f) => f.family.replace(/"/g, '') === family && f.status === 'loaded');
          return { lora: document.fonts.check('500 16px Lora') && loaded('Lora'), inter: document.fonts.check('400 16px Inter') && loaded('Inter') };
        });
        check('Lora is loaded', fonts.lora);
        check('Inter is loaded', fonts.inter);
        const headingFont = await page.evaluate(() => getComputedStyle(document.querySelector('.heading')).fontFamily);
        check('headings use Lora', /Lora/.test(headingFont), headingFont);
        const colors = await page.evaluate(() => {
          const seen = new Set();
          for (const node of document.querySelectorAll('#app, #app *')) {
            const cs = getComputedStyle(node);
            for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'outlineColor']) seen.add(cs[prop]);
          }
          seen.add(getComputedStyle(document.body).backgroundColor);
          return [...seen];
        });
        const offPalette = colors.filter((value) => {
          const m = value.match(/^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/);
          if (!m) return value !== 'transparent';
          if (m[4] === '0') return false;
          return !ALLOWED_RGB.has(`${m[1]}, ${m[2]}, ${m[3]}`);
        });
        check('result screen uses brand colours only', offPalette.length === 0, offPalette.join(' '));
      }
      await context.close();
    });
  }

  // ---------- email validation and accessibility ----------
  await section('validation', async () => {
    const { page, context } = await open();
    await start(page);
    await answer(page, new Array(12).fill(6));
    await grow(page, 'P');
    const liveRegions = await page.evaluate(() => [...document.querySelectorAll('.field__error')].map((n) => ({ display: getComputedStyle(n).display, height: n.getBoundingClientRect().height, text: n.textContent })));
    check('empty error regions stay in the accessibility tree (not display:none) and take no space', liveRegions.length === 2 && liveRegions.every((r) => r.display !== 'none' && r.height === 0 && r.text === ''), JSON.stringify(liveRegions));
    await submit(page);
    const state = await page.evaluate(() => ({
      nameError: document.getElementById('name-error').textContent,
      emailError: document.getElementById('email-error').textContent,
      nameInvalid: document.getElementById('name').getAttribute('aria-invalid'),
      emailInvalid: document.getElementById('email').getAttribute('aria-invalid'),
      nameDescribed: document.getElementById('name').getAttribute('aria-describedby'),
      emailDescribed: document.getElementById('email').getAttribute('aria-describedby'),
      live: document.getElementById('name-error').getAttribute('aria-live'),
      focused: document.activeElement.id,
      consent: document.getElementById('consent').checked,
      step: document.getElementById('app').dataset.step,
    }));
    check('empty form: both error texts from the yaml are shown', state.nameError === content.email_step.error_name && state.emailError === content.email_step.error_email, JSON.stringify(state));
    check('empty form: fields marked aria-invalid and described by their error', state.nameInvalid === 'true' && state.emailInvalid === 'true' && state.nameDescribed === 'name-error' && state.emailDescribed === 'email-error');
    check('empty form: errors are announced politely and focus goes to the first bad field', state.live === 'polite' && state.focused === 'name');
    check('consent checkbox is unchecked by default', state.consent === false);
    check('empty form: still on the email screen', state.step === 'email');
    await fillEmail(page, { name: 'Anna', email: 'not-an-email' });
    const cleared = await page.evaluate(() => document.getElementById('name-error').textContent);
    check('typing a name clears its error', cleared === '');
    await submit(page);
    const emailOnly = await page.evaluate(() => ({ n: document.getElementById('name-error').textContent, e: document.getElementById('email-error').textContent, f: document.activeElement.id }));
    check('bad email only: only the email error shows and gets focus', emailOnly.n === '' && emailOnly.e === content.email_step.error_email && emailOnly.f === 'email');
    await page.getByLabel(labels.email, { exact: true }).fill('anna@example.com');
    await page.evaluate(() => {
      const form = document.querySelector('form');
      form.requestSubmit();
      form.requestSubmit();
    });
    await waitStep(page, 'result');
    await page.waitForTimeout(900);
    const afterDouble = await page.evaluate(() => ({ step: document.getElementById('app').dataset.step, heads: document.querySelectorAll('.result__head').length, host: location.host }));
    check('a double submit shows one result and stays on the site', afterDouble.step === 'result' && afterDouble.heads === 1 && afterDouble.host === new URL(url).host, JSON.stringify(afterDouble));
    await page.goBack();
    await waitStep(page, 'intro');
    check('after a double submit, one back returns to the first screen', true);
    await context.close();
  });

  // ---------- transitions and history ----------
  await section('history', async () => {
    const { page, context } = await open();
    await page.evaluate(() => {
      const button = document.querySelector('.btn--primary');
      button.click();
      button.click();
    });
    await waitStep(page, 'q', 0);
    await page.goBack();
    await waitStep(page, 'intro');
    check('a double tap on Start adds one history entry, one back returns to the first screen', true);
    await start(page);
    await page.evaluate(() => {
      const rates = document.querySelectorAll('.rate');
      rates[4].click();
      rates[6].click();
    });
    await waitStep(page, 'q', 1);
    await back(page);
    await waitStep(page, 'q', 0);
    const kept = await page.evaluate(() => [...document.querySelectorAll('.rate')].findIndex((b) => b.classList.contains('is-selected')) + 1);
    check('a second tap during the 250 ms transition is ignored, back shows the first answer selected', kept === 5, `selected ${kept}`);
    const counter = await page.evaluate(() => document.querySelector('.topbar__count').textContent);
    const width = await page.evaluate(() => document.querySelector('.progress__fill').style.width);
    check('question 1 shows "1 / 13" and an 8% progress bar', counter === '1 / 13' && width === '8%', `${counter} ${width}`);
    await answer(page, [5, 6, 7]);
    await page.goBack();
    await waitStep(page, 'q', 2);
    const third = await page.evaluate(() => [...document.querySelectorAll('.rate')].findIndex((b) => b.classList.contains('is-selected')) + 1);
    check('browser back from question 4 shows question 3 with 7 selected', third === 7, `selected ${third}`);
    const pillarLine = await page.evaluate(() => ({ text: document.querySelector('.eyebrow--pillar').textContent, transform: getComputedStyle(document.querySelector('.eyebrow--pillar')).textTransform }));
    check('pillar name is the yaml text, shown in capitals by CSS', pillarLine.text === content.pillars[0].name && pillarLine.transform === 'uppercase');
    await page.goBack();
    await page.goBack();
    await page.goBack();
    await waitStep(page, 'intro');
    check('three more backs land on the first screen', true);
    await page.goForward();
    await waitStep(page, 'q', 0);
    const forwardKept = await page.evaluate(() => [...document.querySelectorAll('.rate')].findIndex((b) => b.classList.contains('is-selected')) + 1);
    check('forward from the first screen restores question 1 with its answer', forwardKept === 5, `selected ${forwardKept}`);
    await answer(page, [5, 5, 5], 0);
    await page.reload({ waitUntil: 'networkidle' });
    await waitStep(page, 'intro');
    await page.waitForTimeout(300);
    const afterReload = await page.evaluate(() => ({ step: document.getElementById('app').dataset.step, depth: window.history.state && window.history.state.depth }));
    check('a reload in the middle of the questions shows the first screen with a clean history position', afterReload.step === 'intro' && afterReload.depth === 0, JSON.stringify(afterReload));
    await start(page);
    const freshAfterReload = await page.evaluate(() => document.querySelectorAll('.rate.is-selected').length);
    check('after the reload the answers are gone', freshAfterReload === 0);
    await context.close();
  });

  // ---------- question 13 and note display ----------
  await section('question screens', async () => {
    const { page, context } = await open();
    await start(page);
    const q1 = await page.evaluate(() => ({ note: document.querySelector('.note').hidden, title: document.querySelector('#question-title').textContent }));
    check('question 1 has no note and the right title', q1.note === true && q1.title === content.pillars[0].items[0].title);
    await answer(page, [5, 5, 5]);
    const q4 = await page.evaluate(() => ({ hidden: document.querySelector('.note').hidden, text: document.querySelector('.note').textContent }));
    check('question 4 shows its note', q4.hidden === false && q4.text === content.pillars[0].items[3].note);
    const legend = await page.evaluate(() => [...document.querySelectorAll('.scale dt, .scale dd')].map((n) => n.textContent));
    check('scale legend comes from the yaml', JSON.stringify(legend) === JSON.stringify(content.question.scale.flatMap((m) => [String(m.value), m.label])));
    await answer(page, new Array(9).fill(5), 3);
    await waitStep(page, 'grow');
    const g = await page.evaluate(() => ({
      counter: document.querySelector('.topbar__count').textContent,
      width: document.querySelector('.progress__fill').style.width,
      cards: [...document.querySelectorAll('.card')].map((c) => [c.querySelector('.card__label').textContent, c.querySelector('.card__desc').textContent]),
      pressed: [...document.querySelectorAll('.card')].map((c) => c.getAttribute('aria-pressed')),
    }));
    check('question 13 shows "13 / 13", full progress and the three cards from the yaml',
      g.counter === '13 / 13' && g.width === '100%' && JSON.stringify(g.cards) === JSON.stringify(content.grow_question.options.map((o) => [o.label, o.description])) && g.pressed.every((p) => p === 'false'));
    await grow(page, 'V');
    await back(page);
    await waitStep(page, 'grow');
    const pressed = await page.evaluate(() => [...document.querySelectorAll('.card')].map((c) => c.getAttribute('aria-pressed')));
    check('back from the email screen shows the chosen card selected', JSON.stringify(pressed) === '["false","false","true"]', pressed.join(','));
    await context.close();
  });

  // ---------- reduced motion ----------
  await section('reduced motion', async () => {
    const { page, context } = await open(MOBILE, '/', (p) => p.emulateMedia({ reducedMotion: 'reduce' }));
    await complete(page, { ...CASES.F, ...PERSON });
    const motion = await page.evaluate(() => {
      const tile = document.querySelector('.mosaic__tile');
      const body = document.querySelector('.rise');
      return { tileAnim: getComputedStyle(tile).animationName, tileOpacity: getComputedStyle(tile).opacity, bodyAnim: getComputedStyle(body).animationName, bodyOpacity: getComputedStyle(body).opacity };
    });
    check('reduced motion: tiles and text block appear at once without animation',
      motion.tileAnim === 'none' && motion.tileOpacity === '1' && motion.bodyAnim === 'none' && motion.bodyOpacity === '1', JSON.stringify(motion));
    await context.close();
  });

  // ---------- head, robots, relative paths, favicon ----------
  await section('head and paths', async () => {
    const { page, context } = await open();
    const head = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      title: document.title,
      description: document.querySelector('meta[name="description"]').content,
      robots: document.querySelector('meta[name="robots"]') ? document.querySelector('meta[name="robots"]').content : null,
      ogTitle: document.querySelector('meta[property="og:title"]').content,
      ogDescription: document.querySelector('meta[property="og:description"]').content,
      icon: document.querySelector('link[rel="icon"]').getAttribute('href'),
    }));
    check('head: lang, title, description and og tags from the yaml', head.lang === 'en' && head.title === content.meta.title && head.description === content.meta.description && head.ogTitle === content.meta.title && head.ogDescription === content.meta.description);
    check('head: noindex while unpublished', head.robots === 'noindex, nofollow');
    check('favicon is referenced relatively', head.icon === './favicon.svg');
    const robots = await (await page.request.get(`${url}/robots.txt`)).text();
    check('robots.txt disallows everything while unpublished', robots.includes('Disallow: /'));
    const cname = await page.request.get(`${url}/CNAME`);
    check('no CNAME file', cname.status() === 404);
    await context.close();

    const previewContext = await browser.newContext(MOBILE);
    const preview = await previewContext.newPage();
    const statuses = [];
    preview.on('response', (response) => statuses.push([response.url(), response.status()]));
    await preview.goto(`${url}${PREVIEW_BASE}/`, { waitUntil: 'networkidle' });
    const ok = await preview.evaluate(() => ({
      headline: document.querySelector('h1') ? document.querySelector('h1').textContent : null,
      background: getComputedStyle(document.body).backgroundColor,
    }));
    const assets = statuses.filter(([u]) => u.startsWith(`${url}${PREVIEW_BASE}/`));
    check('site works under the /mosaic-snapshot/ preview path with relative assets', ok.headline === content.intro.headline && ok.background === 'rgb(250, 248, 245)' && assets.length >= 3 && assets.every(([, s]) => s === 200), JSON.stringify(assets));
    await previewContext.close();
  });

  // ---------- touch targets and desktop column ----------
  await section('sizes', async () => {
    const { page, context } = await open();
    const targets = async (label) => {
      const small = await page.evaluate(() => [...document.querySelectorAll('button, a, input:not([type="checkbox"]), label.consent')]
        .filter((n) => n.getClientRects().length > 0)
        .map((n) => [n.className || n.tagName, Math.round(n.getBoundingClientRect().height)])
        .filter(([, h]) => h < 44));
      check(`${label}: every tap target is at least 44 px tall`, small.length === 0, JSON.stringify(small));
    };
    await targets('first screen');
    await page.keyboard.press('Tab');
    const focusRing = await page.evaluate(() => {
      const cs = getComputedStyle(document.activeElement);
      return { element: document.activeElement.className, style: cs.outlineStyle, color: cs.outlineColor, width: cs.outlineWidth, offset: cs.outlineOffset };
    });
    check('keyboard focus ring is a solid navy 2 px outline with a 2 px offset',
      focusRing.element.includes('btn') && focusRing.style === 'solid' && focusRing.color === 'rgb(30, 42, 71)' && focusRing.width === '2px' && focusRing.offset === '2px', JSON.stringify(focusRing));
    await start(page);
    const rateHeight = await page.evaluate(() => Math.round(document.querySelector('.rate').getBoundingClientRect().height));
    check('number buttons are 56 px tall', rateHeight === 56, String(rateHeight));
    await targets('question');
    await answer(page, new Array(12).fill(5));
    await targets('question 13');
    await grow(page, 'F');
    await targets('email');
    const inputHeight = await page.evaluate(() => Math.round(document.getElementById('name').getBoundingClientRect().height));
    const buttonHeight = await page.evaluate(() => Math.round(document.querySelector('.btn--primary').getBoundingClientRect().height));
    check('inputs are 50 px and the main button 54 px tall', inputHeight === 50 && buttonHeight === 54, `${inputHeight} ${buttonHeight}`);
    await fillEmail(page, PERSON);
    await submit(page);
    await waitStep(page, 'result');
    await page.waitForTimeout(RESULT_SETTLE_MS);
    await targets('result');
    await context.close();

    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const dpage = await desktop.newPage();
    await dpage.goto(`${url}/`, { waitUntil: 'networkidle' });
    const box = await dpage.evaluate(() => {
      const r = document.querySelector('.screen').getBoundingClientRect();
      return { width: Math.round(r.width), left: Math.round(r.left), height: Math.round(r.height), inner: window.innerWidth };
    });
    check('desktop: wide layout up to 1216 px, centred and at least the window height', box.width <= 1216 && box.width >= 900 && Math.abs(box.left - (box.inner - box.width) / 2) <= 1 && box.height >= 900, JSON.stringify(box));
    await desktop.close();
  });
  // ---------- wide mode (laptops) ----------
  for (const [width, height] of [[1024, 768], [1280, 720], [1366, 768], [1440, 900]]) {
    await section(`wide ${width}x${height}`, async () => {
      const { page, context } = await open({ viewport: { width, height } });
      const overflowAt = async (label) => {
        const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        check(`${width}x${height} ${label}: no horizontal scroll`, sw === cw, `${sw} vs ${cw}`);
      };
      await page.waitForTimeout(1800);
      const intro = await page.evaluate(() => ({
        aside: getComputedStyle(document.querySelector('.screen__aside')).display,
        big: document.querySelectorAll('.teaser--large .teaser__tile').length,
        bigOpacity: getComputedStyle(document.querySelector('.teaser--large .teaser__tile')).opacity,
        startWidth: Math.round(document.querySelector('.btn--primary').getBoundingClientRect().width),
        cols: getComputedStyle(document.querySelector('.screen--intro')).gridTemplateColumns.split(' ').length,
        headline: Math.round(parseFloat(getComputedStyle(document.querySelector('.display')).fontSize)),
      }));
      check(`${width}: first screen in two columns, large mosaic assembled, Start not full width, headline 40 to 56 px`,
        intro.aside !== 'none' && intro.big === 12 && intro.bigOpacity === '1' && intro.startWidth >= 240 && intro.startWidth < 500 && intro.cols === 2 && intro.headline >= 40 && intro.headline <= 56, JSON.stringify(intro));
      await overflowAt('first screen');
      await start(page);
      const rates = await page.evaluate(() => {
        const r = [...document.querySelectorAll('.rate')].map((b) => b.getBoundingClientRect());
        return { rows: new Set(r.map((b) => Math.round(b.top))).size, minWidth: Math.min(...r.map((b) => b.width)) };
      });
      check(`${width}: digits 1 to 10 in one row, each at least 48 px wide`, rates.rows === 1 && rates.minWidth >= 48, JSON.stringify(rates));
      const legend = await page.evaluate(() => {
        const dds = [...document.querySelectorAll('.scale dd')];
        const rateLeft = (n) => document.querySelectorAll('.rate')[n - 1].getBoundingClientRect();
        const r1 = rateLeft(1); const r5 = rateLeft(5); const r10 = rateLeft(10);
        const b = dds.map((d) => d.getBoundingClientRect());
        return { rows: new Set(b.map((x) => Math.round(x.top))).size, firstUnder1: Math.abs(b[0].left - r1.left) < 2, midUnder5: Math.abs((b[1].left + b[1].right) / 2 - (r5.left + r5.right) / 2) < 30, lastUnder10: Math.abs(b[2].right - r10.right) < 2 };
      });
      check(`${width}: scale labels on one row, under the digits 1, 5 and 10`, legend.rows === 1 && legend.firstUnder1 && legend.midUnder5 && legend.lastUnder10, JSON.stringify(legend));
      await overflowAt('question 1');
      await answer(page, [5, 6, 7, 4, 8, 3]);
      const live = await page.evaluate(() => {
        const grid = document.querySelector('.mosaic--live');
        const tiles = [...grid.querySelectorAll('.mosaic__tile')];
        const filled = tiles.filter((t) => t.classList.contains('is-answered'));
        const empty = tiles.filter((t) => !t.classList.contains('is-answered'));
        const current = tiles.findIndex((t) => t.classList.contains('is-current'));
        const cs = current >= 0 ? getComputedStyle(tiles[current]) : null;
        return {
          total: tiles.length,
          filled: filled.length,
          shades: [...new Set(filled.map((t) => getComputedStyle(t).backgroundColor))],
          emptyAll: empty.every((t) => getComputedStyle(t).backgroundColor === 'rgba(0, 0, 0, 0)'),
          current,
          currentBorder: cs ? `${cs.borderTopColor} ${cs.borderTopWidth}` : null,
          hidden: grid.getAttribute('aria-hidden'),
          visible: getComputedStyle(grid).display !== 'none',
        };
      });
      check(`${width}: live mosaic: 6 filled tiles of one flat shade, the 7th outlined navy, the rest empty, aria-hidden`,
        live.total === 12 && live.filled === 6 && live.shades.length === 1 && live.shades[0] === 'rgba(94, 26, 77, 0.35)' && live.emptyAll && live.current === 6 && live.currentBorder === 'rgb(30, 42, 71) 2px' && live.hidden === 'true' && live.visible, JSON.stringify(live));
      await overflowAt('question 7');
      await page.keyboard.press('ArrowLeft');
      await waitStep(page, 'q', 5);
      const kept = await page.evaluate(() => [...document.querySelectorAll('.rate')].findIndex((b) => b.classList.contains('is-selected')) + 1);
      check(`${width}: Left arrow goes back and the previous answer (3) is selected`, kept === 3, String(kept));
      await page.keyboard.press('9');
      await waitStep(page, 'q', 6);
      await page.keyboard.press('0');
      await waitStep(page, 'q', 7);
      await page.keyboard.press('Backspace');
      await waitStep(page, 'q', 6);
      const ten = await page.evaluate(() => [...document.querySelectorAll('.rate')].findIndex((b) => b.classList.contains('is-selected')) + 1);
      const liveCount = await page.evaluate(() => document.querySelectorAll('.mosaic--live .is-answered').length);
      check(`${width}: keys 9 and 0 set 9 and 10, Backspace goes back, live mosaic counts 7 answers`, ten === 10 && liveCount === 7, `${ten} ${liveCount}`);
      await answer(page, [5, 5, 5, 5, 5, 5], 6);
      await waitStep(page, 'grow');
      const cards = await page.evaluate(() => {
        const r = [...document.querySelectorAll('.card')].map((c) => c.getBoundingClientRect());
        return { rows: new Set(r.map((b) => Math.round(b.top))).size, heights: new Set(r.map((b) => Math.round(b.height))).size, noLive: document.querySelector('.mosaic--live') === null };
      });
      check(`${width}: question 13 shows three cards in one row of equal height and no live mosaic`, cards.rows === 1 && cards.heights === 1 && cards.noLive, JSON.stringify(cards));
      await overflowAt('question 13');
      await page.keyboard.press('2');
      await waitStep(page, 'email');
      check(`${width}: key 2 on question 13 chooses a card and opens the email screen`, true);
      const expectedAnswers = [5, 6, 7, 4, 8, 9, 5, 5, 5, 5, 5, 5];
      const blur = await page.evaluate(() => {
        const big = document.querySelector('.mosaic-blur--large');
        const small = document.querySelector('.mosaic-blur--compact');
        return {
          bigDisplay: getComputedStyle(big).display,
          smallDisplay: getComputedStyle(small).display,
          filter: getComputedStyle(big.querySelector('.mosaic__tiles')).filter,
          hidden: big.getAttribute('aria-hidden'),
          tiles: [...big.querySelectorAll('.mosaic__tile')].map((t) => getComputedStyle(t).backgroundColor),
          scores: document.querySelectorAll('.mosaic-blur .mosaic__score, .mosaic-blur .mosaic__flag').length,
          width: Math.round(big.getBoundingClientRect().width),
        };
      });
      const shadesOk = blur.tiles.length === 12 && blur.tiles.every((bg, i) => {
        const m = bg.match(/rgba?\(94, 26, 77(?:, ([\d.]+))?\)/);
        if (!m) return false;
        const a = m[1] === undefined ? 1 : Number(m[1]);
        return Math.abs(a - (0.12 + (0.88 * (expectedAnswers[i] - 1)) / 9)) < 0.01;
      });
      check(`${width}: email screen shows the large blurred mosaic with the real shades, aria-hidden, no scores or labels`,
        blur.bigDisplay !== 'none' && blur.smallDisplay === 'none' && /blur\(/.test(blur.filter) && blur.hidden === 'true' && shadesOk && blur.scores === 0 && blur.width >= 300, JSON.stringify(blur).slice(0, 300));
      await page.getByLabel(labels.name, { exact: true }).click();
      await page.keyboard.type('123');
      await page.keyboard.press('Backspace');
      const typed = await page.evaluate(() => ({ value: document.getElementById('name').value, step: document.getElementById('app').dataset.step }));
      check(`${width}: digits and Backspace in the name field edit the text, nothing is intercepted`, typed.value === '12' && typed.step === 'email', JSON.stringify(typed));
      await overflowAt('email');
      await fillEmail(page, PERSON);
      await submit(page);
      await waitStep(page, 'result');
      await page.waitForTimeout(RESULT_SETTLE_MS);
      await overflowAt('result');
      const layout = await page.evaluate(() => {
        const left = document.querySelector('.result__left');
        return {
          position: getComputedStyle(left).position,
          card: getComputedStyle(document.querySelector('.cta-card')).display,
          band: getComputedStyle(document.querySelector('.cta')).display,
          cols: getComputedStyle(document.querySelector('.screen--result')).gridTemplateColumns.split(' ').length,
        };
      });
      if (height >= 760) {
        check(`${width}x${height}: result in two columns, left column sticky with the call card, no band at the end`, layout.cols === 2 && layout.position === 'sticky' && layout.card !== 'none' && layout.band === 'none', JSON.stringify(layout));
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(200);
        const stuck = await page.evaluate(() => {
          const r = document.querySelector('.result__left').getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), inner: window.innerHeight, scrolled: window.scrollY > 0 };
        });
        // At the very end of the page the sticky column may be pushed up by the end of its grid row;
        // it must stay fully visible, and on tall windows it stays exactly 32 px from the top.
        const stickyOk = height >= 900 ? stuck.top === 32 : stuck.top >= 0;
        check(`${width}x${height}: after scrolling to the end the left column is still fully visible${height >= 900 ? ' at 32 px from the top' : ''}`, stuck.scrolled && stickyOk && stuck.bottom <= stuck.inner, JSON.stringify(stuck));
      } else {
        check(`${width}x${height}: short window: left column scrolls with the page, call band at the end`, layout.position === 'static' && layout.card === 'none' && layout.band !== 'none', JSON.stringify(layout));
        await page.evaluate(() => document.querySelector('.cta a').scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(200);
        const reach = await page.evaluate(() => {
          const r = document.querySelector('.cta a').getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), inner: window.innerHeight, visible: r.width > 0 && r.height > 0 };
        });
        check(`${width}x${height}: the call button can be scrolled into view`, reach.visible && reach.top >= 0 && reach.bottom <= reach.inner, JSON.stringify(reach));
      }
      await context.close();
    });
  }

  // ---------- review follow-ups: reduced motion on wide screens, key repeat, narrow laptops, blur, line length, tall column ----------
  await section('wide reduced motion', async () => {
    const { page, context } = await open({ viewport: { width: 1440, height: 900 } }, '/', (p) => p.emulateMedia({ reducedMotion: 'reduce' }));
    const teaser = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.teaser--large .teaser__tile')];
      return { names: [...new Set(tiles.map((t) => getComputedStyle(t).animationName))], opacity: [...new Set(tiles.map((t) => getComputedStyle(t).opacity))] };
    });
    check('1440 reduced motion: the large first-screen mosaic shows at once, no animation', teaser.names.join() === 'none' && teaser.opacity.join() === '1', JSON.stringify(teaser));
    await start(page);
    await page.keyboard.press('5');
    const live = await page.evaluate(() => {
      const tile = document.querySelector('.mosaic--live .is-answered');
      return tile ? { name: getComputedStyle(tile).animationName, opacity: getComputedStyle(tile).opacity } : null;
    });
    check('1440 reduced motion: an answered live tile fills without animation', live && live.name === 'none' && live.opacity === '1', JSON.stringify(live));
    await context.close();
  });

  await section('key repeat', async () => {
    const { page, context } = await open({ viewport: { width: 1440, height: 900 } });
    await start(page);
    await page.evaluate(() => {
      for (let i = 0; i < 6; i += 1) window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', repeat: true, bubbles: true }));
    });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ qi: document.getElementById('app').dataset.qi, answered: document.querySelectorAll('.mosaic--live .is-answered').length }));
    check('holding a digit key down (auto-repeat) answers nothing', after.qi === '0' && after.answered === 0, JSON.stringify(after));
    await page.keyboard.press('5');
    await waitStep(page, 'q', 1);
    check('a normal key press still answers', true);
    await context.close();
  });

  for (const width of [900, 960]) {
    await section(`narrow laptop ${width}`, async () => {
      const { page, context } = await open({ viewport: { width, height: 800 } });
      await start(page);
      await answer(page, [5, 6, 7, 4, 8, 3]);
      const m = await page.evaluate(() => {
        const names = [...document.querySelectorAll('.mosaic--live .mosaic__name')];
        const rates = [...document.querySelectorAll('.rate')].map((b) => b.getBoundingClientRect());
        return {
          labels: names.map((n) => ({ text: n.textContent, oneLine: n.getBoundingClientRect().height < 20, fits: n.scrollWidth <= n.clientWidth })),
          rows: new Set(rates.map((r) => Math.round(r.top))).size,
          minWidth: Math.min(...rates.map((r) => r.width)),
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth,
        };
      });
      check(`${width}: live mosaic labels stay on one line and are not cut, digits in one row at 44 px or more, no overflow`,
        m.labels.length === 3 && m.labels.every((l) => l.oneLine && l.fits) && m.rows === 1 && m.minWidth >= 44 && m.sw === m.cw, JSON.stringify(m));
      await context.close();
    });
  }

  await section('blur strength and line length', async () => {
    let { page, context } = await open({ viewport: { width: 1440, height: 900 } });
    await start(page);
    await answer(page, [1, 10, 1, 10, 10, 1, 10, 1, 1, 10, 1, 10]);
    await grow(page, 'F');
    await context.close();
    for (const [w, h] of [[1440, 900], [960, 800]]) {
      for (const [label, answers] of [['uniform', new Array(12).fill(8)], ['contrasting', [1, 10, 1, 10, 10, 1, 10, 1, 1, 10, 1, 10]]]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h } });
        const p = await ctx.newPage();
        await p.goto(`${url}/`, { waitUntil: 'networkidle' });
        await start(p);
        await answer(p, answers);
        await grow(p, 'F');
        await p.waitForTimeout(300);
        const structure = await p.evaluate(() => {
          const big = document.querySelector('.mosaic-blur--large');
          const cols = [...big.querySelectorAll('.mosaic__col')];
          const tiles = [...big.querySelectorAll('.mosaic__tile')];
          const meanTile = tiles.reduce((sum, t) => sum + t.getBoundingClientRect().height, 0) / tiles.length;
          const inner = parseFloat((getComputedStyle(cols[0].querySelector('.mosaic__tiles')).filter.match(/blur\(([\d.]+)px\)/) || [])[1]) || 0;
          const rects = cols.map((c) => { const r = c.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
          const box = big.getBoundingClientRect();
          return { cols: cols.length, clipped: cols.every((c) => getComputedStyle(c).overflow === 'hidden'), inner, meanTile, rects, box: { x: box.left, y: box.top, w: box.width, h: box.height } };
        });
        check(`${w}: blurred mosaic (${label}) is clipped per column with an inner blur of at least 0.4 of a tile height`,
          structure.cols === 3 && structure.clipped && structure.inner >= 0.4 * structure.meanTile, JSON.stringify({ inner: structure.inner, meanTile: Math.round(structure.meanTile), clipped: structure.clipped }));
        const shot = (await p.screenshot({ clip: { x: structure.box.x, y: structure.box.y, width: structure.box.w, height: structure.box.h } })).toString('base64');
        const measured = await p.evaluate(async ([src, rects, box]) => {
          const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = `data:image/png;base64,${src}`; });
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx2 = canvas.getContext('2d');
          ctx2.drawImage(img, 0, 0);
          const data = ctx2.getImageData(0, 0, img.width, img.height).data;
          const scale = img.width / box.w;
          // "purple" = how far a pixel is from porcelain towards aubergine, 0 to 1
          const purple = (x, y) => { const i = (Math.round(y) * img.width + Math.round(x)) * 4; return 1 - (data[i + 1] - 26) / (248 - 26); };
          const yFrom = Math.round(box.h * 0.2 * scale);
          const yTo = Math.round(box.h * 0.8 * scale);
          const columnMean = (x) => { let s = 0; let n = 0; for (let y = yFrom; y < yTo; y += 2) { s += purple(x, y); n += 1; } return s / n; };
          const columnSpread = (x) => { const values = []; for (let y = yFrom; y < yTo; y += 2) values.push(purple(x, y)); return Math.max(...values) - Math.min(...values); };
          const centers = rects.map((r) => ((r.left + r.right) / 2 - box.x) * scale);
          const gaps = [((rects[0].right + rects[1].left) / 2 - box.x) * scale, ((rects[1].right + rects[2].left) / 2 - box.x) * scale];
          return { centers: centers.map(columnMean), gaps: gaps.map(columnMean), spreads: centers.map(columnSpread) };
        }, [shot, structure.rects, structure.box]);
        const minCenter = Math.min(...measured.centers);
        const maxGap = Math.max(...measured.gaps);
        const maxSpread = Math.max(...measured.spreads);
        check(`${w}: blurred mosaic (${label}): three columns read as separate bands, no single tile readable`,
          maxGap < 0.5 * minCenter && maxSpread < 0.6 * minCenter,
          JSON.stringify({ centers: measured.centers.map((v) => v.toFixed(2)), gaps: measured.gaps.map((v) => v.toFixed(2)), spreads: measured.spreads.map((v) => v.toFixed(2)) }));
        await ctx.close();
      }
    }
    const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page2 = await context2.newPage();
    await page2.goto(`${url}/`, { waitUntil: 'networkidle' });
    await start(page2);
    await answer(page2, [1, 10, 1, 10, 10, 1, 10, 1, 1, 10, 1, 10]);
    await grow(page2, 'F');
    page = page2;
    context = context2;
    const lead = await page.evaluate(() => {
      const l = document.querySelector('.lead');
      return l ? { width: l.getBoundingClientRect().width, size: parseFloat(getComputedStyle(l).fontSize) } : null;
    });
    await fillEmail(page, PERSON);
    await submit(page);
    await waitStep(page, 'result');
    await page.waitForTimeout(RESULT_SETTLE_MS);
    const text = await page.evaluate(() => {
      const p = document.querySelector('.section p');
      const right = document.querySelector('.result__right');
      return { pWidth: p.getBoundingClientRect().width, size: parseFloat(getComputedStyle(p).fontSize), rightWidth: right.getBoundingClientRect().width };
    });
    // Inter averages about half an em per character in running English text.
    const charsPerLine = text.pWidth / (text.size * 0.5);
    check('1440: result paragraphs hold about 65 characters per line or fewer', text.rightWidth <= 540 && charsPerLine <= 66, JSON.stringify({ ...text, charsPerLine: Math.round(charsPerLine) }));
    await context.close();
    const intro = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ipage = await intro.newPage();
    await ipage.goto(`${url}/`, { waitUntil: 'networkidle' });
    const leadNow = await ipage.evaluate(() => {
      const l = document.querySelector('.lead');
      return { width: l.getBoundingClientRect().width, size: parseFloat(getComputedStyle(l).fontSize) };
    });
    check('1440: the first-screen lead holds about 65 characters per line or fewer', leadNow.width / (leadNow.size * 0.5) <= 66, JSON.stringify(leadNow));
    await intro.close();
  });

  await section('tall result column', async () => {
    const { page, context } = await open({ viewport: { width: 1366, height: 768 } });
    await complete(page, { answers: [8, 8, 8, 8, 8, 8, 8, 8, 2, 3, 2, 3], grow: 'V', name: 'Anna-Maria Konstantinopolskaya-Longname', email: PERSON.email });
    await page.waitForTimeout(RESULT_SETTLE_MS);
    const tall = await page.evaluate(() => ({
      tallClass: document.querySelector('.screen--result').classList.contains('result--tall'),
      position: getComputedStyle(document.querySelector('.result__left')).position,
      band: getComputedStyle(document.querySelector('.cta')).display,
      card: getComputedStyle(document.querySelector('.cta-card')).display,
    }));
    check('1366x768 with a long name: the left column does not fit, so it scrolls and the call band returns', tall.tallClass && tall.position === 'static' && tall.band !== 'none' && tall.card === 'none', JSON.stringify(tall));
    await page.evaluate(() => document.querySelector('.cta a').scrollIntoView({ block: 'center' }));
    const reach = await page.evaluate(() => {
      const r = document.querySelector('.cta a').getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
    check('1366x768 with a long name: the call button can be scrolled into view', reach);
    await context.close();
    const short = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const spage = await short.newPage();
    await spage.goto(`${url}/`, { waitUntil: 'networkidle' });
    await complete(spage, { answers: [8, 8, 8, 8, 8, 8, 8, 8, 2, 3, 2, 3], grow: 'V', ...PERSON });
    const fits = await spage.evaluate(() => ({ tallClass: document.querySelector('.screen--result').classList.contains('result--tall'), position: getComputedStyle(document.querySelector('.result__left')).position }));
    check('1366x768 with a short name: the left column fits and stays sticky', !fits.tallClass && fits.position === 'sticky', JSON.stringify(fits));
    await short.close();
  });

  // ---------- Next button ----------
  for (const viewport of [{ name: '390', ...MOBILE }, { name: '1440', viewport: { width: 1440, height: 900 } }]) {
    await section(`next ${viewport.name}`, async () => {
      const { page, context } = await open(viewport);
      const nextState = () => page.evaluate(() => {
        const next = document.querySelector('.next');
        return next ? { hidden: next.hidden, visible: next.getClientRects().length > 0, text: next.textContent } : null;
      });
      const selectedRate = () => page.evaluate(() => [...document.querySelectorAll('.rate')].findIndex((b) => b.classList.contains('is-selected')) + 1);
      await start(page);
      const fresh = await nextState();
      check(`${viewport.name}: on a new question Next exists but is hidden`, fresh && fresh.hidden && !fresh.visible && fresh.text === content.question.next_label, JSON.stringify(fresh));
      await answer(page, [5, 6, 7, 4, 8]);
      await back(page);
      await waitStep(page, 'q', 4);
      await back(page);
      await waitStep(page, 'q', 3);
      const shown = await nextState();
      const geometry = await page.evaluate(() => {
        const next = document.querySelector('.next').getBoundingClientRect();
        const backRect = document.querySelector('.back').getBoundingClientRect();
        const count = document.querySelector('.topbar__count').getBoundingClientRect();
        const middle = (r) => r.top + r.height / 2;
        return { nextHeight: Math.round(next.height), nextRight: Math.round(next.right), countCenter: Math.round((count.left + count.right) / 2), backLeft: Math.round(backRect.left), inner: window.innerWidth, sameRow: Math.abs(middle(next) - middle(backRect)) < 2 && Math.abs(middle(count) - middle(backRect)) < 3 };
      });
      check(`${viewport.name}: after two Backs Next is visible on the right, same row, at least 44 px tall`, shown && !shown.hidden && shown.visible && geometry.nextHeight >= 44 && geometry.sameRow && geometry.nextRight > geometry.countCenter, JSON.stringify({ shown, geometry }));
      const countBefore = await page.evaluate(() => document.querySelector('.topbar__count').getBoundingClientRect().left);
      await page.locator('.next').click();
      await waitStep(page, 'q', 4);
      const midway = await page.evaluate(() => ({ counter: document.querySelector('.topbar__count').textContent, countLeft: document.querySelector('.topbar__count').getBoundingClientRect().left }));
      check(`${viewport.name}: Next once shows question 5 with its answer 8`, midway.counter === '5 / 13' && (await selectedRate()) === 8, JSON.stringify(midway));
      await page.locator('.next').click();
      await waitStep(page, 'q', 5);
      const after = await page.evaluate(() => ({ qi: document.getElementById('app').dataset.qi, counter: document.querySelector('.topbar__count').textContent, answered: document.querySelectorAll('.mosaic--live .is-answered').length, countLeft: document.querySelector('.topbar__count').getBoundingClientRect().left }));
      check(`${viewport.name}: Next twice returns to the farthest question (6) with the five answers intact`, after.qi === '5' && after.counter === '6 / 13' && (await selectedRate()) === 0 && after.answered === 5, JSON.stringify(after));
      check(`${viewport.name}: the counter did not move while Next was shown and hidden`, Math.abs(after.countLeft - countBefore) < 1 && Math.abs(midway.countLeft - countBefore) < 1, `${countBefore} vs ${midway.countLeft} vs ${after.countLeft}`);
      const onNew = await nextState();
      check(`${viewport.name}: on the farthest question, which has no answer, Next is hidden`, onNew && onNew.hidden, JSON.stringify(onNew));
      await page.locator('.rate', { hasText: /^6$/ }).click();
      const during = await nextState();
      check(`${viewport.name}: right after a fresh answer Next does not flash during the highlight`, during && during.hidden, JSON.stringify(during));
      await waitStep(page, 'q', 6);
      await page.goBack();
      await waitStep(page, 'q', 5);
      await page.keyboard.press('ArrowRight');
      await waitStep(page, 'q', 6);
      check(`${viewport.name}: the right arrow works like Next when Next is visible`, true);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(350);
      const stays = await page.evaluate(() => document.getElementById('app').dataset.qi);
      check(`${viewport.name}: the right arrow does nothing without an answer`, stays === '6', stays);
      await page.goBack();
      await waitStep(page, 'q', 5);
      await page.evaluate(() => { const next = document.querySelector('.next'); next.click(); next.click(); next.click(); });
      await page.waitForTimeout(400);
      const once = await page.evaluate(() => ({ qi: document.getElementById('app').dataset.qi, depth: window.history.state && window.history.state.depth }));
      check(`${viewport.name}: three quick taps on Next move one question and one history entry`, once.qi === '6' && once.depth === 7, JSON.stringify(once));
      await page.goBack();
      await waitStep(page, 'q', 5);
      check(`${viewport.name}: the browser back after Next returns to the previous question`, true);
      await answer(page, [5, 5, 5, 5, 5, 5, 5], 5);
      await waitStep(page, 'grow');
      const growFresh = await nextState();
      check(`${viewport.name}: on question 13 Next is hidden until a card is chosen`, growFresh && growFresh.hidden, JSON.stringify(growFresh));
      await grow(page, 'P');
      await page.goBack();
      await waitStep(page, 'grow');
      const growShown = await nextState();
      check(`${viewport.name}: back from the email screen shows Next on question 13`, growShown && !growShown.hidden, JSON.stringify(growShown));
      await page.goBack();
      await waitStep(page, 'q', 11);
      await page.locator('.next').click();
      await waitStep(page, 'grow');
      await page.locator('.next').click();
      await waitStep(page, 'email');
      const emailBar = await page.evaluate(() => ({ next: document.querySelector('.next') === null, name: document.getElementById('name') !== null }));
      check(`${viewport.name}: Next from question 12 to 13 and from 13 to the email screen, which has no Next`, emailBar.next && emailBar.name, JSON.stringify(emailBar));
      await context.close();
    });
  }

  await section('next 320', async () => {
    const { page, context } = await open({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
    await start(page);
    await answer(page, [5, 6]);
    await back(page);
    await waitStep(page, 'q', 1);
    const bar = await page.evaluate(() => {
      const items = ['.back', '.topbar__count', '.next'].map((s) => document.querySelector(s).getBoundingClientRect());
      return { centers: items.map((r) => Math.round(r.top + r.height / 2)), heights: items.map((r) => Math.round(r.height)), rights: items.map((r) => Math.round(r.right)), width: document.documentElement.scrollWidth, inner: document.documentElement.clientWidth };
    });
    check('320 px: Back, counter and Next stay on one row, no horizontal scroll, Next at least 44 px', Math.max(...bar.centers) - Math.min(...bar.centers) <= 3 && bar.heights[2] >= 44 && bar.rights[2] <= bar.inner && bar.width === bar.inner, JSON.stringify(bar));
    await context.close();
  });

  // ---------- texts after the test ----------
  await section('texts', async () => {
    const { page, context } = await open();
    await start(page);
    await answer(page, [8, 8, 8, 8, 4, 5, 4, 5, 8, 8, 8, 8]);
    const title = await page.evaluate(() => document.querySelector('h1').textContent);
    check('question 13 title: "Which area has your priority right now?"', title === 'Which area has your priority right now?', title);
    await grow(page, 'P');
    const note = await page.evaluate(() => document.querySelector('.data-note').textContent);
    check('email screen data note: "... to show your result and send you a copy."', note === 'Mastermind Global B.V. uses your name and email to show your result and send you a copy.', note);
    await fillEmail(page, PERSON);
    await submit(page);
    await waitStep(page, 'result');
    await page.waitForTimeout(RESULT_SETTLE_MS);
    const result = await page.evaluate(() => ({ button: document.querySelector('.cta a').textContent, line: document.querySelector('.grow-note').textContent }));
    check('result: "Book an introduction call" and the priority line', result.button === 'Book an introduction call' && result.line === 'Your priority right now is your Professional Fulfilment, and your answers agree. Here is where to start.', JSON.stringify(result));
    await context.close();
    const mismatch = renderEmail(content, { name: 'Anna', email: 'a@b.co', src: '', grow: 'V' }, evaluate([4, 3, 5, 4, 7, 6, 8, 7, 6, 5, 7, 6], content));
    const match = renderEmail(content, { name: 'Anna', email: 'a@b.co', src: '', grow: 'P' }, evaluate([8, 8, 8, 8, 4, 5, 4, 5, 8, 8, 8, 8], content));
    check('emails: the new button text and both priority lines', mismatch.html.includes('Book an introduction call') && mismatch.text.includes('Your priority right now is your Visibility. Your answers suggest starting with your Foundation. Here is why.') && match.text.includes('Your priority right now is your Professional Fulfilment, and your answers agree. Here is where to start.'));
  });

  // ---------- empty first-screen fields ----------
  await section('first screen fields', async () => {
    const { page, context } = await open();
    const intro = await page.evaluate(() => ({
      audience: document.querySelector('.intro__audience') === null,
      instruction: document.querySelector('.intro__instruction') === null,
      headChildren: document.querySelector('.intro__head').children.length,
      actionChildren: document.querySelector('.intro__actions').children.length,
      linkButtons: document.querySelectorAll('.screen--intro .link-button').length,
      startBottom: Math.round(document.querySelector('.btn--primary').getBoundingClientRect().bottom),
    }));
    check('empty audience and instruction render nothing: two head children, two action children, no link', intro.audience && intro.instruction && intro.headChildren === 2 && intro.actionChildren === 2 && intro.linkButtons === 0, JSON.stringify(intro));
    await context.close();
    // Temporary texts of the budget length (see budget.txt of stage 4) at the five sizes
    // from the task; they exist only here and in scripts/shots-fixes.mjs.
    const filledDist = await mkdtemp(path.join(os.tmpdir(), 'mosaic-filled-'));
    const filled = await startServer(0, filledDist);
    try {
      await build({ distDir: filledDist, endpointUrl: DEAD_ENDPOINT, backend: false, quiet: true, patch: (c) => { c.intro.audience = placeholder(90); c.intro.instruction = placeholder(55); } });
      const sizes = [
        { name: '390x664', viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, startVisible: true },
        { name: '390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, startVisible: true },
        { name: '320x568', viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true },
        { name: '834x1194', viewport: { width: 834, height: 1194 }, isMobile: true, hasTouch: true, startVisible: true },
        { name: '1440x900', viewport: { width: 1440, height: 900 }, startVisible: true, wide: true },
      ];
      for (const size of sizes) {
        const { name, startVisible, wide, ...options } = size;
        const ctx = await browser.newContext(options);
        const p = await ctx.newPage();
        await p.goto(`${filled.url}/`, { waitUntil: 'networkidle' });
        await p.evaluate(() => document.fonts.ready);
        const placed = await p.evaluate(() => {
          const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
          const audience = rect('.intro__audience');
          const instruction = rect('.intro__instruction');
          const lead = rect('.lead');
          const teaser = rect('.teaser');
          const start = rect('.btn--primary');
          const meta = rect('.meta-line');
          return {
            audienceBelowLead: audience.top >= lead.bottom && audience.bottom <= meta.top && (window.innerWidth >= 900 || audience.bottom <= teaser.top),
            instructionAboveStart: instruction.bottom <= start.top && instruction.top >= meta.bottom,
            audienceWidth: Math.round(audience.width),
            startBottom: Math.round(start.bottom),
            inner: window.innerHeight,
            noHorizontalScroll: document.documentElement.scrollWidth === document.documentElement.clientWidth,
          };
        });
        const ok = placed.audienceBelowLead && placed.instructionAboveStart && placed.noHorizontalScroll
          && (!startVisible || placed.startBottom <= placed.inner)
          && (!wide || placed.audienceWidth <= 576);
        check(`${name}: filled audience under the subhead, instruction right above Start, no horizontal scroll${startVisible ? ', Start visible' : ''}${wide ? ', texts within the left column' : ''}`, ok, JSON.stringify(placed));
        await ctx.close();
      }
    } finally {
      filled.server.close();
      await rm(filledDist, { recursive: true, force: true });
    }
  });

  // ---------- tablet portrait keeps the phone design ----------
  await section('tablet', async () => {
    const { page, context } = await open({ viewport: { width: 834, height: 1194 }, isMobile: true, hasTouch: true });
    const t = await page.evaluate(() => ({ aside: getComputedStyle(document.querySelector('.screen__aside')).display, display: getComputedStyle(document.querySelector('.screen--intro')).display }));
    check('834 px: phone design, no aside, single column', t.aside === 'none' && t.display === 'flex', JSON.stringify(t));
    const gap = await page.evaluate(() => {
      const meta = document.querySelector('.meta-line').getBoundingClientRect();
      const button = document.querySelector('.btn--primary').getBoundingClientRect();
      return { gap: Math.round(button.top - meta.bottom), buttonBottom: Math.round(button.bottom), inner: window.innerHeight };
    });
    check('834 px: the Start button follows the text instead of sitting at the bottom', gap.gap <= 60 && gap.buttonBottom < gap.inner - 200, JSON.stringify(gap));
    const narrowTablet = await browser.newContext({ viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true });
    const tpage = await narrowTablet.newPage();
    await tpage.goto(`${url}/`, { waitUntil: 'networkidle' });
    const gap2 = await tpage.evaluate(() => Math.round(document.querySelector('.btn--primary').getBoundingClientRect().top - document.querySelector('.meta-line').getBoundingClientRect().bottom));
    check('768 px: the Start button follows the text too', gap2 <= 60, String(gap2));
    await narrowTablet.close();
    await start(page);
    const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.rates')).gridTemplateColumns.split(' ').length);
    check('834 px: digits in the 5 x 2 grid', cols === 5, String(cols));
    await context.close();
  });

  // ---------- short phone: the email screen with the compact blurred mosaic ----------
  await section('short phone', async () => {
    const { page, context } = await open({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });
    await start(page);
    await answer(page, new Array(12).fill(6));
    await grow(page, 'P');
    const m = await page.evaluate(() => {
      const small = document.querySelector('.mosaic-blur--compact');
      const r = small.getBoundingClientRect();
      const button = document.querySelector('.btn--primary').getBoundingClientRect();
      const title = document.querySelector('h1').getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), filter: getComputedStyle(small).filter, hidden: small.getAttribute('aria-hidden'), rightOfTitle: r.left >= title.right, buttonBottom: Math.round(button.bottom), inner: window.innerHeight, scrollY: window.scrollY, scores: small.querySelectorAll('.mosaic__score, .mosaic__flag').length };
    });
    check('390 x 664: compact blurred mosaic about 96 px beside the title, aria-hidden, no scores', m.w >= 90 && m.w <= 102 && m.h >= 90 && m.h <= 104 && /blur\(/.test(m.filter) && m.hidden === 'true' && m.rightOfTitle && m.scores === 0, JSON.stringify(m));
    check('390 x 664: the submit button is visible without scrolling', m.scrollY === 0 && m.buttonBottom <= m.inner, JSON.stringify(m));
    await context.close();
  });
  // ---------- the page really sends the payload ----------
  await section('sending', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'mosaic-send-'));
    const capture = await startServer(0, tmp);
    try {
      await build({ distDir: tmp, endpointUrl: `${capture.url}/__endpoint`, backend: false, quiet: true });
      const posts = async () => (await (await fetch(`${capture.url}/__endpoint`)).json());
      const clear = () => fetch(`${capture.url}/__endpoint?clear=1`);
      const sendContext = await browser.newContext(MOBILE);
      let page = await sendContext.newPage();
      await page.goto(`${capture.url}/?src=Test_QR!`, { waitUntil: 'networkidle' });
      await complete(page, { answers: CASES.P.answers, grow: 'V', ...PERSON, consent: true });
      await page.waitForTimeout(800);
      let seen = await posts();
      check('sending: exactly one POST after the survey', seen.length === 1, `${seen.length} posts`);
      const body = seen.length ? JSON.parse(seen[0].body) : {};
      const onScreen = await page.evaluate(() => document.querySelector('.heading-sm').textContent);
      const keyOnScreen = Object.keys(content.results).find((key) => content.results[key].headline === onScreen);
      check('sending: body is text/plain JSON with version 1, 12 answers, the result on the screen, consent and the cleaned src',
        seen.length === 1 && /text\/plain/.test(seen[0].contentType) && body.version === 1 && Object.keys(body.answers || {}).length === 12
          && body.answers.P2 === 5 && body.result === keyOnScreen && body.consent === true && body.src === 'test_qr' && body.name === PERSON.name && body.email === PERSON.email && typeof body.submitted_at === 'string',
        JSON.stringify(body).slice(0, 300));
      await page.close();
      await clear();
      page = await sendContext.newPage();
      await page.goto(`${capture.url}/?sample`, { waitUntil: 'networkidle' });
      await waitStep(page, 'result');
      await page.waitForTimeout(800);
      seen = await posts();
      check('sending: the sample result sends nothing', seen.length === 0, `${seen.length} posts`);
      await page.close();
      await clear();
      page = await sendContext.newPage();
      await page.goto(`${capture.url}/`, { waitUntil: 'networkidle' });
      await start(page);
      await answer(page, CASES.V.answers);
      await grow(page, 'F');
      await fillEmail(page, PERSON);
      await page.evaluate(() => { const form = document.querySelector('form'); form.requestSubmit(); form.requestSubmit(); });
      await waitStep(page, 'result');
      await page.waitForTimeout(800);
      seen = await posts();
      check('sending: a double submit sends one POST', seen.length === 1, `${seen.length} posts`);
      await sendContext.close();
    } finally {
      capture.server.close();
      await rm(tmp, { recursive: true, force: true });
    }
    const tmp2 = await mkdtemp(path.join(os.tmpdir(), 'mosaic-dead-'));
    const dead = await startServer(0, tmp2);
    try {
      await build({ distDir: tmp2, endpointUrl: 'http://127.0.0.1:9/__endpoint', backend: false, quiet: true });
      const deadContext = await browser.newContext(MOBILE);
      const page = await deadContext.newPage();
      await page.goto(`${dead.url}/`, { waitUntil: 'networkidle' });
      await complete(page, { answers: CASES.F.answers, grow: 'V', ...PERSON });
      await page.waitForTimeout(RESULT_SETTLE_MS);
      const shown = await page.evaluate(() => ({ step: document.getElementById('app').dataset.step, headline: document.querySelector('.heading-sm').textContent }));
      check('sending: with an unreachable endpoint the result still shows', shown.step === 'result' && shown.headline === content.results.F.headline, JSON.stringify(shown));
      await deadContext.close();
    } finally {
      dead.server.close();
      await rm(tmp2, { recursive: true, force: true });
    }
    await build({ quiet: true, backend: false });
  });
} finally {
  await browser.close();
  server.close();
  await rm(verifyDist, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
if (failed.length) {
  console.log(`Failed:\n${failed.map((r) => `  ${r.name}`).join('\n')}`);
  process.exitCode = 1;
}
