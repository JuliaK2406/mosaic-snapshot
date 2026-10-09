// Screenshots for the wide (laptop) mode and the tablet and short-phone checks.
// Run after npm run build. Output: ../screenshots 02 - ноутбук/ (override with SHOTS_DIR).
//   after/        the phone set from shots.mjs, taken again for the pixel comparison
//   <width>-*.png the wide, tablet and short-phone sets

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../src/check.mjs';
import { startServer } from './serve.mjs';
import { takeShots, start, answer, grow, complete, waitStep, PERSON, ALL_EIGHT, RESULT_SETTLE_MS } from './shots.mjs';

const OUT_DIR = process.env.SHOTS_DIR || path.resolve(ROOT, '..', 'screenshots 02 - ноутбук');

const CASES = {
  F: { answers: [4, 3, 5, 4, 7, 6, 8, 7, 6, 5, 7, 6], grow: 'V' },
  P: { answers: [8, 8, 8, 8, 4, 5, 4, 5, 8, 8, 8, 8], grow: 'P' },
  V: { answers: [8, 8, 8, 8, 8, 8, 8, 8, 2, 3, 2, 3], grow: 'F' },
  balanced: { answers: ALL_EIGHT, grow: 'F' },
};

const WIDE_VIEWPORTS = [
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1440x900', width: 1440, height: 900 },
];

const WIDE_SCENARIOS = [
  { id: '01-intro', run: (page) => page.waitForTimeout(2000) },
  { id: '02-q01', run: (page) => start(page) },
  { id: '03-q07-live', run: async (page) => { await start(page); await answer(page, [5, 6, 7, 4, 8, 3]); } },
  { id: '04-q13', run: async (page) => { await start(page); await answer(page, ALL_EIGHT); } },
  { id: '05-email', run: async (page) => { await start(page); await answer(page, ALL_EIGHT); await grow(page, 'P'); } },
  { id: '06-result-F', full: true, scrolled: true, run: (page) => complete(page, { ...CASES.F, ...PERSON }) },
  { id: '07-result-P', full: true, scrolled: true, run: (page) => complete(page, { ...CASES.P, ...PERSON }) },
  { id: '08-result-V', full: true, scrolled: true, run: (page) => complete(page, { ...CASES.V, ...PERSON }) },
  { id: '09-result-balanced', full: true, scrolled: true, run: (page) => complete(page, { ...CASES.balanced, ...PERSON }) },
];

const TABLET = { name: '834x1194', width: 834, height: 1194, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const TABLET_SCENARIOS = [
  { id: '01-intro', run: async () => {} },
  { id: '02-q01', run: (page) => start(page) },
  { id: '06-result-F', full: true, run: (page) => complete(page, { ...CASES.F, ...PERSON }) },
];

const SHORT_PHONE = { name: '390x664', width: 390, height: 664, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const SHORT_PHONE_SCENARIOS = [
  { id: '05-email', run: async (page) => { await start(page); await answer(page, ALL_EIGHT); await grow(page, 'P'); } },
];

async function shoot(browser, url, viewport, scenarios, outDir) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor || 1,
    isMobile: Boolean(viewport.isMobile),
    hasTouch: Boolean(viewport.hasTouch),
  });
  const problems = [];
  for (const scenario of scenarios) {
    const page = await context.newPage();
    await page.goto(`${url}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await scenario.run(page);
    await page.waitForTimeout(scenario.full ? RESULT_SETTLE_MS : 400);
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    const file = path.join(outDir, `${viewport.name}-${scenario.id}.png`);
    await page.screenshot({ path: file, fullPage: Boolean(scenario.full) });
    if (scenario.scrolled && viewport.name === '1440x900') {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(outDir, `${viewport.name}-${scenario.id}-scrolled.png`) });
    }
    const flag = sw !== cw ? `PROBLEM: horizontal overflow ${sw} > ${cw}` : 'ok';
    console.log(`${path.basename(file)}  ${flag}`);
    if (sw !== cw) problems.push(`${path.basename(file)}: overflow ${sw} > ${cw}`);
    await page.close();
  }
  await context.close();
  return problems;
}

export async function takeWideShots(outDir = OUT_DIR) {
  await mkdir(outDir, { recursive: true });
  const problems = [];
  problems.push(...await takeShots({ outDir: path.join(outDir, 'after') }));
  const { server, url } = await startServer(0);
  const browser = await chromium.launch();
  try {
    for (const viewport of WIDE_VIEWPORTS) problems.push(...await shoot(browser, url, viewport, WIDE_SCENARIOS, outDir));
    problems.push(...await shoot(browser, url, TABLET, TABLET_SCENARIOS, outDir));
    problems.push(...await shoot(browser, url, SHORT_PHONE, SHORT_PHONE_SCENARIOS, outDir));
  } finally {
    await browser.close();
    server.close();
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const problems = await takeWideShots();
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n${problems.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll screenshots taken, no horizontal overflow.');
  }
}
