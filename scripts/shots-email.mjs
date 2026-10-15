// Screenshots for the email screen in wide mode (PROMPT 04б): six laptop sizes, uniform and
// contrasting answers, before and after the change, plus question 12 at 1440 x 900 to compare
// the mosaic there with the one on the email screen, and (after) the phone set for the pixel
// comparison with screenshots 04 - правки после теста/390.
// Run after npm run build: npm run shots:email -- before   or   npm run shots:email (after)

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../src/check.mjs';
import { startServer } from './serve.mjs';
import { takeShots, start, answer, grow, back, waitStep, ALL_EIGHT } from './shots.mjs';
import { CONTRASTING } from './shots-data.mjs';

const OUT_DIR = process.env.SHOTS_DIR || path.resolve(ROOT, '..', 'screenshots 04б - мозаика на ноутбуке');
export const LAPTOPS = [[960, 800], [1024, 768], [1280, 720], [1366, 768], [1440, 900], [1920, 1080]]
  .map(([width, height]) => ({ name: `${width}x${height}`, width, height }));

async function toEmail(page, answers) {
  await start(page);
  await answer(page, answers);
  await grow(page, 'P');
}

// Question 12 with all twelve answers in place: answer everything, then Back from question 13.
async function toQuestion12(page, answers) {
  await start(page);
  await answer(page, answers);
  await waitStep(page, 'grow');
  await back(page);
  await waitStep(page, 'q', 11);
}

async function shoot(browser, url, viewport, id, run, dir, problems) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  await page.goto(`${url}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await run(page);
  await page.waitForTimeout(800);
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  const file = path.join(dir, `${viewport.name}-${id}.png`);
  await page.screenshot({ path: file });
  console.log(`${path.basename(file)}  ${sw !== cw ? `PROBLEM: horizontal overflow ${sw} > ${cw}` : 'ok'}`);
  if (sw !== cw) problems.push(path.basename(file));
  await context.close();
}

export async function takeEmailShots(stage = 'after', outDir = OUT_DIR) {
  const dir = path.join(outDir, stage);
  await mkdir(dir, { recursive: true });
  const { server, url } = await startServer(0);
  const browser = await chromium.launch();
  const problems = [];
  try {
    for (const laptop of LAPTOPS) {
      await shoot(browser, url, laptop, 'email-uniform', (page) => toEmail(page, ALL_EIGHT), dir, problems);
      await shoot(browser, url, laptop, 'email-contrast', (page) => toEmail(page, CONTRASTING), dir, problems);
    }
    const laptop = LAPTOPS.find((item) => item.name === '1440x900');
    await shoot(browser, url, laptop, 'q12-uniform', (page) => toQuestion12(page, ALL_EIGHT), dir, problems);
    await shoot(browser, url, laptop, 'q12-contrast', (page) => toQuestion12(page, CONTRASTING), dir, problems);
  } finally {
    await browser.close();
    server.close();
  }
  if (stage === 'after') problems.push(...await takeShots({ outDir: path.join(outDir, '390') }));
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const stage = process.argv[2] === 'before' ? 'before' : 'after';
  const problems = await takeEmailShots(stage);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s): ${problems.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${stage} screenshots taken, no horizontal overflow.`);
  }
}
