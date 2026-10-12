// Screenshots for stage 2 (data): the tablet first screen after the fix, the blurred mosaic in
// wide mode with uniform and contrasting answers, and the phone set for the pixel comparison
// with screenshots 02 - ноутбук/after. Run after npm run build: npm run shots:data

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../src/check.mjs';
import { startServer } from './serve.mjs';
import { takeShots, start, answer, grow, ALL_EIGHT } from './shots.mjs';

const OUT_DIR = process.env.SHOTS_DIR || path.resolve(ROOT, '..', 'screenshots 03 - данные');
export const CONTRASTING = [1, 10, 1, 10, 10, 1, 10, 1, 1, 10, 1, 10];

const TABLETS = [
  { name: '834x1194', width: 834, height: 1194, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: '768x1024', width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];
const TABLET_SCENARIOS = [
  { id: '01-intro', run: async () => {} },
  { id: '02-q01', run: (page) => start(page) },
  { id: '05-email', run: async (page) => { await start(page); await answer(page, ALL_EIGHT); await grow(page, 'P'); } },
];

const WIDE = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '960x800', width: 960, height: 800 },
];
const WIDE_SCENARIOS = [
  { id: 'email-uniform', run: async (page) => { await start(page); await answer(page, ALL_EIGHT); await grow(page, 'P'); } },
  { id: 'email-contrast', run: async (page) => { await start(page); await answer(page, CONTRASTING); await grow(page, 'P'); } },
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
    await page.waitForTimeout(400);
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    const file = path.join(outDir, `${viewport.name}-${scenario.id}.png`);
    await page.screenshot({ path: file, fullPage: Boolean(scenario.full) });
    console.log(`${path.basename(file)}  ${sw !== cw ? `PROBLEM: horizontal overflow ${sw} > ${cw}` : 'ok'}`);
    if (sw !== cw) problems.push(path.basename(file));
    await page.close();
  }
  await context.close();
  return problems;
}

export async function takeDataShots(outDir = OUT_DIR) {
  await mkdir(outDir, { recursive: true });
  const problems = [];
  problems.push(...await takeShots({ outDir: path.join(outDir, '390') }));
  const { server, url } = await startServer(0);
  const browser = await chromium.launch();
  try {
    for (const viewport of TABLETS) problems.push(...await shoot(browser, url, viewport, TABLET_SCENARIOS, outDir));
    for (const viewport of WIDE) problems.push(...await shoot(browser, url, viewport, WIDE_SCENARIOS, outDir));
  } finally {
    await browser.close();
    server.close();
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const problems = await takeDataShots();
  if (problems.length) {
    console.error(`\n${problems.length} problem(s): ${problems.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll screenshots taken, no horizontal overflow.');
  }
}
