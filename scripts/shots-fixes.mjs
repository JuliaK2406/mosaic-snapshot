// Screenshots for the fixes after the test (PROMPT 04): the first screen, a question with Next
// after going back, question 13, the email screen and the result, plus the phone set for the
// pixel comparison. Run after npm run build: npm run shots:fixes
// Output: ../screenshots 04 - правки после теста/ (override with SHOTS_DIR).
// The placeholder texts and the character budget of stage 4 went away together with the
// fields audience and instruction (PROMPT 04в).

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../src/check.mjs';
import { startServer } from './serve.mjs';
import { takeShots, start, answer, grow, back, waitStep, complete, PERSON, RESULT_SETTLE_MS } from './shots.mjs';

const OUT_DIR = process.env.SHOTS_DIR || path.resolve(ROOT, '..', 'screenshots 04 - правки после теста');
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const SMALL_PHONE = { width: 320, height: 568, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAPTOP = { width: 1440, height: 900, deviceScaleFactor: 1 };
const name = (vp) => `${vp.width}x${vp.height}`;

async function context(browser, vp) {
  return browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor || 1, isMobile: Boolean(vp.isMobile), hasTouch: Boolean(vp.hasTouch) });
}

async function shoot(page, file, options = {}) {
  await page.waitForTimeout(options.settle || 400);
  await page.screenshot({ path: file, fullPage: Boolean(options.full) });
  console.log(path.basename(file));
}

export async function takeFixShots(outDir = OUT_DIR) {
  await mkdir(outDir, { recursive: true });
  const { server, url } = await startServer(0);
  const browser = await chromium.launch();
  try {
    // the first screen after the changes
    for (const vp of [PHONE, LAPTOP]) {
      const ctx = await context(browser, vp);
      const page = await ctx.newPage();
      await page.goto(`${url}/`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await shoot(page, path.join(outDir, `${name(vp)}-01-intro-after.png`), { settle: vp.isMobile ? 400 : 2000 });
      await ctx.close();
    }
    // a question with Next after going back two questions
    for (const vp of [PHONE, SMALL_PHONE, LAPTOP]) {
      const ctx = await context(browser, vp);
      const page = await ctx.newPage();
      await page.goto(`${url}/`, { waitUntil: 'networkidle' });
      await start(page);
      await answer(page, [5, 6, 7, 4, 8]);
      await back(page);
      await waitStep(page, 'q', 4);
      await back(page);
      await waitStep(page, 'q', 3);
      await shoot(page, path.join(outDir, `${name(vp)}-02-question-next.png`));
      await ctx.close();
    }
    // question 13, the email screen and the result on the phone; the result on the laptop
    {
      const ctx = await context(browser, PHONE);
      const page = await ctx.newPage();
      await page.goto(`${url}/`, { waitUntil: 'networkidle' });
      await start(page);
      await answer(page, [8, 8, 8, 8, 4, 5, 4, 5, 8, 8, 8, 8]);
      await waitStep(page, 'grow');
      await shoot(page, path.join(outDir, `${name(PHONE)}-03-q13.png`));
      await grow(page, 'P');
      await shoot(page, path.join(outDir, `${name(PHONE)}-04-email.png`));
      await ctx.close();
    }
    for (const vp of [PHONE, LAPTOP]) {
      const ctx = await context(browser, vp);
      const page = await ctx.newPage();
      await page.goto(`${url}/`, { waitUntil: 'networkidle' });
      await complete(page, { answers: [8, 8, 8, 8, 4, 5, 4, 5, 8, 8, 8, 8], grow: 'P', ...PERSON });
      await shoot(page, path.join(outDir, `${name(vp)}-05-result-P.png`), { full: true, settle: RESULT_SETTLE_MS });
      await ctx.close();
    }
    // the phone set, for a pixel comparison with the previous stage
    await takeShots({ outDir: path.join(outDir, '390') });
  } finally {
    await browser.close();
    server.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await takeFixShots();
