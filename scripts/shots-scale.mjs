// Screenshots for the statements and the agreement scale (PROMPT 04г): questions F2 and V1
// on two phones, F1 on a laptop, the priority screen and the email screen on a phone, the
// first screen on a tall and a short phone.
// Run after npm run build: npm run shots:scale
// Output: ../screenshots 04г - утверждения и шкала/ (override with SHOTS_DIR).

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../src/check.mjs';
import { startServer } from './serve.mjs';
import { start, answer, waitStep, grow } from './shots.mjs';

const OUT_DIR = process.env.SHOTS_DIR || path.resolve(ROOT, '..', 'screenshots 04г - утверждения и шкала');
const phone = (width, height) => ({ name: `${width}x${height}`, viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const SIZES = {
  tall: phone(390, 844),
  short: phone(390, 664),
  small: phone(320, 568),
  laptop: { name: '1440x900', viewport: { width: 1440, height: 900 } },
};
const F1 = 0;
const F2 = 1;
const V1 = 8;

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

async function toEmail(page) {
  await toPriority(page);
  await grow(page, 'P');
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

export async function takeScaleShots(outDir = OUT_DIR) {
  await mkdir(outDir, { recursive: true });
  const { server, url } = await startServer(0);
  const browser = await chromium.launch();
  const problems = [];
  try {
    for (const size of [SIZES.tall, SIZES.short]) {
      problems.push(...await shoot(browser, url, size, '01-intro', async () => {}, outDir));
    }
    for (const size of [SIZES.tall, SIZES.small]) {
      problems.push(...await shoot(browser, url, size, '02-question-F2', (page) => toQuestion(page, F2), outDir));
      problems.push(...await shoot(browser, url, size, '03-question-V1', (page) => toQuestion(page, V1), outDir));
    }
    problems.push(...await shoot(browser, url, SIZES.laptop, '02-question-F1', (page) => toQuestion(page, F1), outDir));
    problems.push(...await shoot(browser, url, SIZES.tall, '04-priority', toPriority, outDir));
    problems.push(...await shoot(browser, url, SIZES.tall, '05-email', toEmail, outDir));
  } finally {
    await browser.close();
    server.close();
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const problems = await takeScaleShots();
  if (problems.length) {
    console.error(`\n${problems.length} problem(s): ${problems.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll screenshots taken, no horizontal overflow.');
  }
}
