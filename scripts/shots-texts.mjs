// Screenshots for Julia's texts of 16 October (PROMPT 04в): the first screen at five sizes,
// the questions with the longest title (F4) and the longest question line (V1) on two phones,
// one question on a laptop, and the priority screen on a phone.
// Run after npm run build: npm run shots:texts
// Output: ../screenshots 04в - тексты Юлии/ (override with SHOTS_DIR).

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../src/check.mjs';
import { startServer } from './serve.mjs';
import { start, answer, waitStep } from './shots.mjs';

const OUT_DIR = process.env.SHOTS_DIR || path.resolve(ROOT, '..', 'screenshots 04в - тексты Юлии');
const phone = (width, height) => ({ name: `${width}x${height}`, viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const SIZES = {
  tall: phone(390, 844),
  short: phone(390, 664),
  small: phone(320, 568),
  tablet: phone(834, 1194),
  laptop: { name: '1440x900', viewport: { width: 1440, height: 900 } },
};
const F4 = 3;   // the longest title
const V1 = 8;   // the longest question line

async function toQuestion(page, index) {
  await start(page);
  if (index > 0) await answer(page, new Array(index).fill(6));
  await waitStep(page, 'q', index);
}

async function toPriority(page) {
  await start(page);
  await answer(page, new Array(12).fill(6));
  await waitStep(page, 'grow');
}

async function shoot(browser, url, size, id, run, outDir) {
  const { name, ...options } = size;
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto(`${url}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await run(page);
  await page.waitForTimeout(size.viewport.width >= 900 ? 2000 : 500);
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  const file = path.join(outDir, `${name}-${id}.png`);
  await page.screenshot({ path: file });
  console.log(`${path.basename(file)}  ${sw !== cw ? `PROBLEM: horizontal overflow ${sw} > ${cw}` : 'ok'}`);
  await context.close();
  return sw !== cw ? [path.basename(file)] : [];
}

export async function takeTextShots(outDir = OUT_DIR) {
  await mkdir(outDir, { recursive: true });
  const { server, url } = await startServer(0);
  const browser = await chromium.launch();
  const problems = [];
  try {
    for (const size of [SIZES.tall, SIZES.short, SIZES.small, SIZES.tablet, SIZES.laptop]) {
      problems.push(...await shoot(browser, url, size, '01-intro', async () => {}, outDir));
    }
    for (const size of [SIZES.tall, SIZES.small]) {
      problems.push(...await shoot(browser, url, size, '02-question-F4', (page) => toQuestion(page, F4), outDir));
      problems.push(...await shoot(browser, url, size, '03-question-V1', (page) => toQuestion(page, V1), outDir));
    }
    problems.push(...await shoot(browser, url, SIZES.laptop, '02-question-F4', (page) => toQuestion(page, F4), outDir));
    problems.push(...await shoot(browser, url, SIZES.tall, '04-priority', toPriority, outDir));
  } finally {
    await browser.close();
    server.close();
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const problems = await takeTextShots();
  if (problems.length) {
    console.error(`\n${problems.length} problem(s): ${problems.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll screenshots taken, no horizontal overflow.');
  }
}
