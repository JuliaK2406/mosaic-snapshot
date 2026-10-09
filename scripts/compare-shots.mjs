// Pixel comparison of two screenshot folders, file by file, without extra dependencies:
// Chromium decodes the PNGs on a canvas. Usage:
//   node scripts/compare-shots.mjs <dirA> <dirB> [--only=390-] [--allow=05-email-errors,...]
// Exit code 1 when any compared file differs, except files whose name contains an allowed fragment.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const [dirA, dirB] = args.filter((a) => !a.startsWith('--'));
const only = (args.find((a) => a.startsWith('--only=')) || '--only=').slice(7);
const allowed = (args.find((a) => a.startsWith('--allow=')) || '--allow=').slice(8).split(',').filter(Boolean);
const reportFile = (args.find((a) => a.startsWith('--report=')) || '--report=').slice(9);
if (!dirA || !dirB) {
  console.error('usage: node scripts/compare-shots.mjs <dirA> <dirB> [--only=prefix] [--allow=a,b] [--report=file]');
  process.exit(2);
}

const namesA = (await readdir(dirA)).filter((n) => n.endsWith('.png') && n.startsWith(only)).sort();
const namesB = new Set(await readdir(dirB));
const browser = await chromium.launch();
const page = await browser.newPage();
const lines = [];
let failures = 0;
try {
  for (const name of namesA) {
    if (!namesB.has(name)) {
      lines.push(`${name}: missing in ${dirB}`);
      failures += 1;
      continue;
    }
    const a = (await readFile(path.join(dirA, name))).toString('base64');
    const b = (await readFile(path.join(dirB, name))).toString('base64');
    const result = await page.evaluate(async ([srcA, srcB]) => {
      const load = (src) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = `data:image/png;base64,${src}`;
      });
      const [imgA, imgB] = await Promise.all([load(srcA), load(srcB)]);
      if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
        return { sizeA: `${imgA.width}x${imgA.height}`, sizeB: `${imgB.width}x${imgB.height}`, differing: -1 };
      }
      const draw = (img) => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const dataA = draw(imgA);
      const dataB = draw(imgB);
      let differing = 0;
      let minY = Infinity;
      let maxY = -1;
      for (let i = 0; i < dataA.length; i += 4) {
        if (dataA[i] !== dataB[i] || dataA[i + 1] !== dataB[i + 1] || dataA[i + 2] !== dataB[i + 2] || dataA[i + 3] !== dataB[i + 3]) {
          differing += 1;
          const y = Math.floor(i / 4 / imgA.width);
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      return { sizeA: `${imgA.width}x${imgA.height}`, differing, total: imgA.width * imgA.height, minY, maxY };
    }, [a, b]);
    const isAllowed = allowed.some((fragment) => name.includes(fragment));
    let line;
    if (result.differing === -1) line = `${name}: size differs (${result.sizeA} vs ${result.sizeB})`;
    else if (result.differing === 0) line = `${name}: identical (${result.sizeA})`;
    else line = `${name}: ${result.differing} of ${result.total} pixels differ (${((100 * result.differing) / result.total).toFixed(2)}%), rows ${result.minY}-${result.maxY}`;
    if (result.differing !== 0 && !isAllowed) failures += 1;
    if (result.differing !== 0 && isAllowed) line += '  [allowed]';
    lines.push(line);
  }
} finally {
  await browser.close();
}
const text = `${lines.join('\n')}\n\n${failures ? `${failures} unexpected difference(s)` : 'No unexpected differences'}\n`;
console.log(text);
if (reportFile) await writeFile(reportFile, text, 'utf8');
process.exitCode = failures ? 1 : 0;
