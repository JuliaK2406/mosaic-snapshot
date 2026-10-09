// Screenshots of every screen at 390x844 and 1440x900 through Playwright.
// Run after npm run build. Output folder: ../screenshots 01 - каркас/ (override with SHOTS_DIR).
// The helpers below are shared with verify.mjs.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ROOT, loadContent } from '../src/check.mjs';
import { startServer } from './serve.mjs';

const DEFAULT_OUT_DIR = process.env.SHOTS_DIR || path.resolve(ROOT, '..', 'screenshots 01 - каркас');
export const RESULT_SETTLE_MS = 2500;
export const VIEWPORTS = [
  { name: '390', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: '1440', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];
export const ALL_EIGHT = new Array(12).fill(8);
export const PERSON = { name: 'Anna', email: 'anna@example.com' };

const content = await loadContent();
export const labels = {
  start: content.intro.start_label,
  back: content.question.back_label,
  submit: content.email_step.submit_label,
  sample: content.intro.sample_label,
  name: content.email_step.name_label,
  email: content.email_step.email_label,
};
const growLabel = (key) => content.grow_question.options.find((option) => option.key === key).label;

// ---- navigation helpers ----

export async function waitStep(page, step, qi) {
  const selector = qi === undefined ? `#app[data-step="${step}"]` : `#app[data-step="${step}"][data-qi="${qi}"]`;
  await page.waitForSelector(selector, { state: 'attached', timeout: 5000 });
}

export async function start(page) {
  await page.getByRole('button', { name: labels.start, exact: true }).click();
  await waitStep(page, 'q', 0);
}

export async function rate(page, value) {
  await page.locator('.rate', { hasText: new RegExp(`^${value}$`) }).click();
}

// Answers the questions in order starting at index "from", waiting for each transition to land.
export async function answer(page, values, from = 0) {
  for (let i = 0; i < values.length; i += 1) {
    const qi = from + i;
    await waitStep(page, 'q', qi);
    await rate(page, values[i]);
    if (qi + 1 < 12) await waitStep(page, 'q', qi + 1);
    else await waitStep(page, 'grow');
  }
}

export async function back(page) {
  await page.getByRole('button', { name: labels.back, exact: true }).click();
}

export async function grow(page, key) {
  await waitStep(page, 'grow');
  await page.getByRole('button', { name: growLabel(key) }).click();
  await waitStep(page, 'email');
}

export async function fillEmail(page, { name, email }) {
  await page.getByLabel(labels.name, { exact: true }).fill(name);
  await page.getByLabel(labels.email, { exact: true }).fill(email);
}

export async function submit(page) {
  await page.getByRole('button', { name: labels.submit, exact: true }).click();
}

export async function complete(page, { answers, grow: growKey, name, email }) {
  await start(page);
  await answer(page, answers);
  await grow(page, growKey);
  await fillEmail(page, { name, email });
  await submit(page);
  await waitStep(page, 'result');
}

// ---- scenarios ----

export const SCENARIOS = [
  { id: '01-intro', run: async () => {} },
  { id: '02-q01', run: (page) => start(page) },
  {
    id: '03-q05-selected',
    run: async (page) => {
      await start(page);
      await answer(page, [5, 6, 7, 4]);
      await rate(page, 7);
      await waitStep(page, 'q', 5);
      await back(page);
      await waitStep(page, 'q', 4);
    },
  },
  {
    id: '04-q13',
    run: async (page) => {
      await start(page);
      await answer(page, ALL_EIGHT);
      await waitStep(page, 'grow');
    },
  },
  {
    id: '05-email-errors',
    run: async (page) => {
      await start(page);
      await answer(page, ALL_EIGHT);
      await grow(page, 'P');
      await submit(page);
    },
  },
  { id: '06-result-F', full: true, run: (page) => complete(page, { answers: [4, 3, 5, 4, 7, 6, 8, 7, 6, 5, 7, 6], grow: 'V', ...PERSON }) },
  { id: '07-result-P', full: true, run: (page) => complete(page, { answers: [8, 8, 8, 8, 4, 5, 4, 5, 8, 8, 8, 8], grow: 'P', ...PERSON }) },
  { id: '08-result-V', full: true, run: (page) => complete(page, { answers: [8, 8, 8, 8, 8, 8, 8, 8, 2, 3, 2, 3], grow: 'F', ...PERSON }) },
  { id: '09-result-balanced', full: true, run: (page) => complete(page, { answers: ALL_EIGHT, grow: 'F', ...PERSON }) },
  {
    id: '10-result-sample',
    full: true,
    run: async (page) => {
      await page.getByRole('button', { name: labels.sample, exact: true }).click();
      await waitStep(page, 'result');
    },
  },
];

export async function takeShots({ outDir = DEFAULT_OUT_DIR, viewports = VIEWPORTS, scenarios = SCENARIOS } = {}) {
  await mkdir(outDir, { recursive: true });
  const { server, url } = await startServer(0);
  const browser = await chromium.launch();
  const problems = [];
  try {
    for (const vp of viewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.deviceScaleFactor,
        isMobile: vp.isMobile,
        hasTouch: vp.hasTouch,
      });
      for (const scenario of scenarios) {
        const page = await context.newPage();
        await page.goto(`${url}/`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await scenario.run(page);
        await page.waitForTimeout(scenario.full ? RESULT_SETTLE_MS : 350);
        const facts = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          lora: document.fonts.check('500 16px Lora') && [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Lora' && f.status === 'loaded'),
          inter: document.fonts.check('400 16px Inter') && [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Inter' && f.status === 'loaded'),
        }));
        const file = path.join(outDir, `${vp.name}-${scenario.id}.png`);
        await page.screenshot({ path: file, fullPage: Boolean(scenario.full) });
        const flags = [];
        if (facts.scrollWidth !== facts.clientWidth) flags.push(`horizontal overflow ${facts.scrollWidth} > ${facts.clientWidth}`);
        if (!facts.lora || !facts.inter) flags.push('fonts not loaded');
        console.log(`${path.basename(file)}  ${flags.length ? `PROBLEM: ${flags.join('; ')}` : 'ok'}`);
        if (flags.length) problems.push(`${path.basename(file)}: ${flags.join('; ')}`);
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const problems = await takeShots();
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n${problems.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll screenshots taken: no horizontal overflow, fonts loaded.');
  }
}
