// Browser checks with Playwright against dist/: texts match the yaml word for word,
// no horizontal scroll at 360 and 390, fonts loaded, gold frame on the right column,
// palette, history, validation, privacy, reduced motion, relative paths.
// Run after npm run build: npm run verify

import { chromium } from 'playwright';
import { loadContent } from '../src/check.mjs';
import { startServer, PREVIEW_BASE } from './serve.mjs';
import { start, answer, grow, fillEmail, submit, waitStep, complete, back, labels, PERSON, RESULT_SETTLE_MS } from './shots.mjs';

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

const { server, url } = await startServer(0);
const browser = await chromium.launch();

async function open(options = MOBILE, pathname = '/', before) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  if (before) await before(page);
  await page.goto(`${url}${pathname}`, { waitUntil: 'networkidle' });
  return { page, context, requests };
}

async function section(name, fn) {
  try {
    await fn();
  } catch (error) {
    check(`${name}: finished without an exception`, false, error.message);
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

      const external = requests.filter((x) => !x.startsWith(url) && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(x));
      check(`result ${key}: no requests except own files and Google Fonts`, external.length === 0, external.join(', '));
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

  // ---------- sample link ----------
  await section('sample', async () => {
    const { page, context, requests } = await open();
    const visible = await page.getByRole('button', { name: labels.sample, exact: true }).isVisible();
    check('sample link is visible while meta.published is false', visible);
    await page.getByRole('button', { name: labels.sample, exact: true }).click();
    await waitStep(page, 'result');
    await page.waitForTimeout(RESULT_SETTLE_MS);
    const text = norm(await page.evaluate(() => document.getElementById('app').textContent));
    const expectedLine = content.result.grow_mismatch.replace('{grow}', inText('V')).replace('{focus}', inText('F'));
    check('sample result: focus F, greeting without a name, mismatch line about Visibility and Foundation',
      text.includes(norm(content.results.F.headline)) && text.includes(norm(content.result.greeting)) && text.includes(norm(expectedLine)) && !text.includes(norm(content.result.greeting_with_name.replace('{name}', ''))));
    check('sample result: no copy line without an email', !text.includes('on its way'));
    const external = requests.filter((x) => !x.startsWith(url) && !/^https:\/\/fonts\./.test(x));
    check('sample result: nothing is sent anywhere', external.length === 0);
    await page.goBack();
    await waitStep(page, 'intro');
    check('sample result: back leads to the first screen', true);
    await context.close();
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
      return { width: Math.round(r.width), left: Math.round(r.left), height: Math.round(r.height) };
    });
    check('desktop: column is 440 px wide, centred and at least the window height', box.width === 440 && box.left === 500 && box.height >= 900, JSON.stringify(box));
    await desktop.close();
  });
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
if (failed.length) {
  console.log(`Failed:\n${failed.map((r) => `  ${r.name}`).join('\n')}`);
  process.exitCode = 1;
}
