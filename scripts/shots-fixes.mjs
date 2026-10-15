// Screenshots for the fixes after the test (PROMPT 04) and the character budget of the two
// optional first-screen texts. Run after npm run build: npm run shots:fixes
// Output: ../screenshots 04 - правки после теста/ (override with SHOTS_DIR).
// The placeholder texts below exist only here, for the pictures and the budget; they never
// go into the content file.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ROOT } from '../src/check.mjs';
import { build } from '../src/build.mjs';
import { startServer } from './serve.mjs';
import { takeShots, start, answer, grow, back, waitStep, complete, PERSON, ALL_EIGHT, RESULT_SETTLE_MS } from './shots.mjs';

const OUT_DIR = process.env.SHOTS_DIR || path.resolve(ROOT, '..', 'screenshots 04 - правки после теста');
const DEAD_ENDPOINT = 'http://127.0.0.1:9/__endpoint';
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const SHORT_PHONE = { width: 390, height: 664, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const SMALL_PHONE = { width: 320, height: 568, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LAPTOP = { width: 1440, height: 900, deviceScaleFactor: 1 };
const name = (vp) => `${vp.width}x${vp.height}`;

// Neutral filler, cut at a word boundary, for the budget measurement and the pictures.
const FILLER = 'Placeholder text for this field, used only to measure how much fits on the first screen before the Start button moves out of view. ';
export function placeholder(length) {
  let text = '';
  while (text.length < length) text += FILLER;
  const cut = text.slice(0, length);
  const space = cut.lastIndexOf(' ');
  return (space > length - 20 ? cut.slice(0, space) : cut).trim();
}

async function context(browser, vp) {
  return browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor || 1, isMobile: Boolean(vp.isMobile), hasTouch: Boolean(vp.hasTouch) });
}

async function shoot(page, file, options = {}) {
  await page.waitForTimeout(options.settle || 400);
  await page.screenshot({ path: file, fullPage: Boolean(options.full) });
  console.log(path.basename(file));
}

async function tempSite(patch) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mosaic-shots-'));
  await build({ distDir: dir, endpointUrl: DEAD_ENDPOINT, backend: false, quiet: true, patch });
  const served = await startServer(0, dir);
  return { ...served, dir, close: async () => { served.server.close(); await rm(dir, { recursive: true, force: true }); } };
}

// The largest text length (in characters) for which the Start button stays within the viewport.
async function budget(browser, vp, makePatch) {
  let low = 0;
  let high = 1200;
  while (high - low > 10) {
    const mid = Math.floor((low + high) / 2);
    const site = await tempSite(makePatch(placeholder(mid)));
    const ctx = await context(browser, vp);
    const page = await ctx.newPage();
    await page.goto(`${site.url}/`, { waitUntil: 'networkidle' });
    const fits = await page.evaluate(() => document.querySelector('.btn--primary').getBoundingClientRect().bottom <= window.innerHeight);
    await ctx.close();
    await site.close();
    if (fits) low = mid;
    else high = mid;
  }
  return low;
}

// Room under the Start button at 390 x 664 with both fields empty, and the height of one
// line of each text.
async function freeSpace(browser, url) {
  const ctx = await context(browser, SHORT_PHONE);
  const page = await ctx.newPage();
  await page.goto(`${url}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const room = await page.evaluate(() => {
    const start = document.querySelector('.btn--primary').getBoundingClientRect();
    const lineOf = (className) => {
      const probe = document.createElement('p');
      probe.className = className;
      probe.textContent = 'x';
      document.querySelector('.intro__head').appendChild(probe);
      const height = probe.getBoundingClientRect().height;
      probe.remove();
      return Math.round(height);
    };
    return { free: Math.round(window.innerHeight - start.bottom), audienceLine: lineOf('intro__audience'), instructionLine: lineOf('intro__instruction') };
  });
  await ctx.close();
  return room;
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
    // the first screen with placeholder texts in the two new places: within the budget (06,
    // Start still visible at 390 x 664) and over it (07, Start drops below the fold)
    const fitting = { audience: placeholder(90), instruction: placeholder(55) };
    const long = { audience: placeholder(180), instruction: placeholder(80) };
    const sets = [['06-intro-placeholders', fitting, [SHORT_PHONE, SMALL_PHONE, LAPTOP]], ['07-intro-placeholders-long', long, [SHORT_PHONE]]];
    for (const [suffix, texts, viewports] of sets) {
      const site = await tempSite((c) => { c.intro.audience = texts.audience; c.intro.instruction = texts.instruction; });
      try {
        for (const vp of viewports) {
          const ctx = await context(browser, vp);
          const page = await ctx.newPage();
          await page.goto(`${site.url}/`, { waitUntil: 'networkidle' });
          await page.evaluate(() => document.fonts.ready);
          await shoot(page, path.join(outDir, `${name(vp)}-${suffix}.png`), { settle: vp.isMobile ? 400 : 2000 });
          await ctx.close();
        }
      } finally {
        await site.close();
      }
    }
    // the budget at 390 x 664: each field alone, and both together with a one-line instruction
    const audienceAlone = await budget(browser, SHORT_PHONE, (text) => (c) => { c.intro.audience = text; });
    const instructionAlone = await budget(browser, SHORT_PHONE, (text) => (c) => { c.intro.instruction = text; });
    const instructionLine = placeholder(55);
    const audienceWithInstruction = await budget(browser, SHORT_PHONE, (text) => (c) => { c.intro.audience = text; c.intro.instruction = instructionLine; });
    const room = await freeSpace(browser, url);
    const lines = [
      `Budget at 390 x 664 (iPhone Safari visible area), Start button fully visible without scrolling, headline and subhead as today:`,
      `free space under Start with both fields empty: ${room.free} px (one audience line ${room.audienceLine} px, one instruction line ${room.instructionLine} px, plus the paragraph gaps)`,
      `audience alone: up to ${audienceAlone} characters`,
      `instruction alone: up to ${instructionAlone} characters`,
      `audience with a one-line instruction (${instructionLine.length} characters): up to ${audienceWithInstruction} characters`,
      `measured with the placeholder filler of this script; real sentences with longer words may differ by a few characters`,
    ];
    await writeFile(path.join(outDir, 'budget.txt'), `${lines.join('\n')}\n`, 'utf8');
    console.log(lines.join('\n'));
    // the phone set, for a pixel comparison with the previous stage
    await takeShots({ outDir: path.join(outDir, '390') });
  } finally {
    await browser.close();
    server.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await takeFixShots();
