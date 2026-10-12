// Preview of the result emails: the four results rendered by backend/src/email.js into
// dist/emails/<key>.html and .txt, plus full-height screenshots at 600 and 375 px.
// Run after npm run build: npm run emails. Output folder: ../screenshots 03 - данные/ (SHOTS_DIR).

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ROOT, loadContent } from '../src/check.mjs';
import { evaluate } from '../src/app/scoring.js';
import { renderEmail } from '../backend/src/email.js';

const OUT_DIR = process.env.SHOTS_DIR || path.resolve(ROOT, '..', 'screenshots 03 - данные');
const EMAILS_DIR = path.join(ROOT, 'dist', 'emails');
const WIDTHS = [600, 375];

export const EMAIL_CASES = [
  { key: 'F', answers: [4, 3, 5, 4, 7, 6, 8, 7, 6, 5, 7, 6], grow: 'V', src: '' },
  { key: 'P', answers: [8, 8, 8, 8, 4, 5, 4, 5, 8, 8, 8, 8], grow: 'P', src: 'workshop-a' },
  { key: 'V', answers: [8, 8, 8, 8, 8, 8, 8, 8, 2, 3, 2, 3], grow: 'F', src: '' },
  { key: 'balanced', answers: new Array(12).fill(8), grow: 'F', src: '' },
];
const PERSON = { name: 'Anna', email: 'anna@example.com' };

export async function renderPreviews({ outDir = OUT_DIR } = {}) {
  const content = await loadContent();
  await mkdir(EMAILS_DIR, { recursive: true });
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const written = [];
  try {
    for (const c of EMAIL_CASES) {
      const evaluation = evaluate(c.answers, content);
      if (evaluation.result !== c.key) throw new Error(`case ${c.key} evaluates to ${evaluation.result}`);
      const message = renderEmail(content, { ...PERSON, src: c.src, grow: c.grow }, evaluation);
      await writeFile(path.join(EMAILS_DIR, `${c.key}.html`), message.html, 'utf8');
      await writeFile(path.join(EMAILS_DIR, `${c.key}.txt`), `Subject: ${message.subject}\n\n${message.text}\n`, 'utf8');
      for (const width of WIDTHS) {
        const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: width < 600 ? 2 : 1 });
        await page.setContent(message.html, { waitUntil: 'load' });
        const file = path.join(outDir, `email-${c.key}-${width}.png`);
        await page.screenshot({ path: file, fullPage: true });
        written.push(path.basename(file));
        await page.close();
      }
      console.log(`${c.key}: subject "${message.subject}", html ${message.html.length} bytes, text ${message.text.length} bytes`);
    }
  } finally {
    await browser.close();
  }
  return written;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = await renderPreviews();
  console.log(`\n${files.length} screenshots: ${files.join(', ')}`);
}
