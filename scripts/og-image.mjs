// The link card (og:image) for LinkedIn and the like: a 1200 x 627 PNG made only from what the
// site already shows: the brand sign and wordmark, the first-screen headline from the yaml and
// the decorative mosaic in the brand colours. No other text. Writes assets/og-image.png, which
// the build copies into dist/. Fonts and colours come from the repository itself.
// Run: npm run og

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ROOT, loadContent } from '../src/check.mjs';
import { OG_IMAGE, OG_WIDTH, OG_HEIGHT, FONTS, readToken, escapeHtml } from '../src/build.mjs';
import { ICON_ALPHAS, TEASER_SCORES, TEASER_HEIGHTS, tileAlpha } from '../src/app/mosaic.js';
import { startServer } from './serve.mjs';

export function cardHtml(content, tokens, base) {
  const hex = readToken(tokens, '--aubergine');
  const aubergine = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');   // the same colour as --aubergine-rgb
  const navy = readToken(tokens, '--navy');
  const porcelain = readToken(tokens, '--porcelain');
  const faces = FONTS.map((font) => `@font-face { font-family: '${font.family}'; font-style: normal; font-weight: ${font.weights[0]} ${font.weights[font.weights.length - 1]}; src: url(${base}/assets/fonts/${font.file}) format('woff2'); }`).join('\n');
  const icon = ICON_ALPHAS.map((alpha) => `<span style="background: rgba(${aubergine}, ${alpha})"></span>`).join('');
  const columns = TEASER_SCORES.map((scores, column) => `<div class="col">${scores.map((score, row) => `<div class="tile" style="height: ${TEASER_HEIGHTS[column][row] * 3}px; background: rgba(${aubergine}, ${tileAlpha(score).toFixed(3)})"></div>`).join('')}</div>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
${faces}
html, body { margin: 0; background: ${porcelain}; }
.card { box-sizing: border-box; width: ${OG_WIDTH}px; height: ${OG_HEIGHT}px; padding: 72px 80px; display: grid; grid-template-columns: minmax(0, 1fr) 420px; column-gap: 72px; align-items: center; }
.brand { display: flex; align-items: center; gap: 14px; margin-bottom: 40px; }
.icon { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); gap: 3px; width: 32px; height: 32px; }
.icon span { border-radius: 2px; }
.wordmark { font-family: 'Lora', Georgia, serif; font-size: 20px; font-weight: 600; letter-spacing: 0.18em; color: rgb(${aubergine}); }
.headline { margin: 0; font-family: 'Lora', Georgia, serif; font-weight: 500; font-size: 68px; line-height: 1.12; color: ${navy}; max-width: 11ch; }
.mosaic { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.col { display: flex; flex-direction: column; gap: 12px; }
.tile { border-radius: 14px; }
</style></head>
<body><div class="card">
  <div><div class="brand"><span class="icon">${icon}</span><span class="wordmark">${escapeHtml(content.intro.wordmark)}</span></div>
  <h1 class="headline">${escapeHtml(content.intro.headline)}</h1></div>
  <div class="mosaic">${columns}</div>
</div></body></html>
`;
}

export async function makeCard(output = OG_IMAGE) {
  const content = await loadContent();
  const tokens = await readFile(path.join(ROOT, 'src', 'styles', 'tokens.css'), 'utf8');
  const { server, url } = await startServer(0, ROOT);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: OG_WIDTH, height: OG_HEIGHT }, deviceScaleFactor: 1 });
    await page.setContent(cardHtml(content, tokens, url), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
    if (!loaded.includes('Lora')) throw new Error(`Lora did not load for the card (loaded: ${loaded.join(', ') || 'none'})`);
    await page.screenshot({ path: output, type: 'png', clip: { x: 0, y: 0, width: OG_WIDTH, height: OG_HEIGHT } });
    console.log(`${path.relative(ROOT, output)}  ${OG_WIDTH} x ${OG_HEIGHT}`);
  } finally {
    await browser.close();
    server.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await makeCard();
