// Screenshots for the launch (PROMPT 05): the data notice on a phone and a laptop, the email
// screen with its link, the result footer with the city, plus a copy of the link card.
// Run after npm run build: npm run shots:launch
// Output: ../screenshots 05 - запуск/ (override with SHOTS_DIR).

import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../src/check.mjs';
import { OG_IMAGE, OG_IMAGE_FILE } from '../src/build.mjs';
import { startServer } from './serve.mjs';
import { start, answer, grow, complete, PERSON, ALL_EIGHT, RESULT_SETTLE_MS } from './shots.mjs';

const OUT_DIR = process.env.SHOTS_DIR || path.resolve(ROOT, '..', 'screenshots 05 - запуск');
const PHONE = { name: '390x844', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAPTOP = { name: '1440x900', viewport: { width: 1440, height: 900 } };

async function shoot(browser, url, size, id, pathname, run, outDir, options = {}) {
  const { name, ...context } = size;
  const ctx = await browser.newContext(context);
  const page = await ctx.newPage();
  await page.goto(`${url}${pathname}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await run(page);
  await page.waitForTimeout(options.settle || 500);
  const file = path.join(outDir, `${name}-${id}.png`);
  await page.screenshot({ path: file, fullPage: Boolean(options.full) });
  console.log(path.basename(file));
  await ctx.close();
}

export async function takeLaunchShots(outDir = OUT_DIR) {
  await mkdir(outDir, { recursive: true });
  const { server, url } = await startServer(0);
  const browser = await chromium.launch();
  try {
    await shoot(browser, url, PHONE, '01-privacy', '/privacy/', async () => {}, outDir, { full: true });
    await shoot(browser, url, LAPTOP, '01-privacy', '/privacy/', async () => {}, outDir, { full: true });
    await shoot(browser, url, PHONE, '02-email-link', '/', async (page) => { await start(page); await answer(page, ALL_EIGHT); await grow(page, 'P'); }, outDir);
    await shoot(browser, url, PHONE, '03-result-footer', '/', async (page) => {
      await complete(page, { answers: [8, 8, 8, 8, 4, 5, 4, 5, 8, 8, 8, 8], grow: 'P', ...PERSON });
      await page.waitForTimeout(RESULT_SETTLE_MS);
      await page.evaluate(() => document.querySelector('.signature').scrollIntoView({ block: 'end' }));
    }, outDir, { settle: 600 });
    await copyFile(OG_IMAGE, path.join(outDir, OG_IMAGE_FILE));
    console.log(OG_IMAGE_FILE);
  } finally {
    await browser.close();
    server.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await takeLaunchShots();
