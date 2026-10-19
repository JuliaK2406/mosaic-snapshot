import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../src/check.mjs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pageHtml, privacyHtml, fontFaceCss, linkEmails, build, embedJson, bundle, faviconSvg, escapeHtml, readToken, OG_IMAGE, FONTS, ASSETS } from '../src/build.mjs';

const content = await loadContent();

test('published head: canonical, og:url and og:image with the site address, the card size and alt, twitter card, fonts from the site', () => {
  const html = pageHtml(content);
  const site = content.meta.site_url;
  assert.ok(html.includes(`<link rel="canonical" href="${site}/">`));
  assert.ok(html.includes(`<meta property="og:url" content="${site}/">`));
  assert.ok(html.includes(`<meta property="og:image" content="${site}/og-image.png">`));
  assert.ok(html.includes('<meta property="og:image:width" content="1200">') && html.includes('<meta property="og:image:height" content="627">'));
  assert.ok(html.includes(`<meta property="og:image:alt" content="${escapeHtml(content.intro.headline)}">`));
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'));
  assert.ok(!/googleapis|gstatic/.test(html), 'no Google fonts');
  assert.ok(!html.includes('rel="preload"'), 'no font preload: each font would be fetched twice');
  assert.ok(!html.includes('name="robots"'), 'published: no noindex');
});

test('fonts: @font-face for Inter 400, 500, 600 and Lora 500, 600 from the site, latin only, files and licences present', async () => {
  const css = fontFaceCss();
  for (const [family, weight] of [['Inter', 400], ['Inter', 500], ['Inter', 600], ['Lora', 500], ['Lora', 600]]) {
    assert.ok(new RegExp(`font-family: '${family}';\\s*font-style: normal;\\s*font-weight: ${weight};`).test(css), `${family} ${weight}`);
  }
  assert.ok(css.includes("url(fonts/inter-latin.woff2) format('woff2')") && css.includes("url(fonts/lora-latin.woff2) format('woff2')"));
  assert.ok(!/https?:/.test(css), 'no remote font');
  assert.equal((css.match(/unicode-range: U\+0000-00FF/g) || []).length, 5);
  for (const font of FONTS) {
    const bytes = await readFile(path.join(ASSETS, 'fonts', font.file));
    assert.equal(bytes.slice(0, 4).toString(), 'wOF2', `${font.file} is woff2`);
  }
  for (const name of ['OFL-Inter.txt', 'OFL-Lora.txt']) {
    assert.ok((await readFile(path.join(ASSETS, 'fonts', name), 'utf8')).includes('SIL Open Font License, Version 1.1'), name);
  }
});

test('the link card assets/og-image.png exists and is a 1200 x 627 PNG', async () => {
  const png = await readFile(OG_IMAGE);
  assert.equal(png.slice(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 627);
});

test('privacy page: title, every heading, paragraph and point from the yaml, mailto links, no script, relative assets', () => {
  const html = privacyHtml(content);
  assert.ok(html.includes(`<title>${escapeHtml(content.privacy.title)} | ${escapeHtml(content.meta.title)}</title>`));
  assert.ok(html.includes(`<h1 class="heading notice__title">${escapeHtml(content.privacy.title)}</h1>`));
  assert.ok(html.includes(`<p>${linkEmails(escapeHtml(content.privacy.intro))}</p>`));
  for (const section of content.privacy.sections) {
    assert.ok(html.includes(`<h2 class="heading-sm">${escapeHtml(section.heading)}</h2>`), section.heading);
    for (const text of section.paragraphs || []) assert.ok(html.includes(`<p>${linkEmails(escapeHtml(text))}</p>`), text.slice(0, 40));
    for (const text of section.items || []) assert.ok(html.includes(`<li>${linkEmails(escapeHtml(text))}</li>`), text.slice(0, 40));
  }
  assert.equal((html.match(/<li>/g) || []).length, 3);
  assert.ok(html.includes('<a href="mailto:contact@juliakrylova.com">contact@juliakrylova.com</a>'));
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('href="../styles.css"') && html.includes('href="../favicon.svg"') && html.includes('<a class="brand notice__brand" href="../">'));
  assert.ok(html.includes(`<link rel="canonical" href="${content.meta.site_url}/privacy/">`));
  assert.ok(!/(href|src)="\/[^/]/.test(html), 'no root-absolute paths');
  assert.equal(linkEmails('write to a.b+c@x-y.co. Thanks'), 'write to <a href="mailto:a.b+c@x-y.co">a.b+c@x-y.co</a>. Thanks');
});

test('the build writes CNAME with the custom domain, the notice page, the fonts and the card', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mosaic-build-test-'));
  try {
    const files = await build({ distDir: dir, backend: false, quiet: true });
    assert.equal(files.CNAME, 'mosaic.juliakrylova.com\n');
    assert.ok(files['privacy/index.html'].includes(content.privacy.title));
    assert.ok(files['styles.css'].startsWith('/* Fonts served by the site itself'));
    assert.equal(files['robots.txt'], undefined, 'published: no robots.txt');
    for (const name of ['CNAME', 'privacy/index.html', 'fonts/inter-latin.woff2', 'fonts/lora-latin.woff2', 'fonts/OFL-Inter.txt', 'fonts/OFL-Lora.txt', 'og-image.png']) {
      assert.ok((await readFile(path.join(dir, name))).length > 0, name);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unpublished page carries noindex, published page does not', () => {
  const hidden = pageHtml({ ...content, meta: { ...content.meta, published: false } });
  assert.ok(hidden.includes('<meta name="robots" content="noindex, nofollow">'));
  const open = pageHtml({ ...content, meta: { ...content.meta, published: true } });
  assert.ok(!open.includes('name="robots"'));
});

test('head has lang, title, description and og tags, all paths relative', () => {
  const html = pageHtml(content);
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes(`<title>${escapeHtml(content.meta.title)}</title>`));
  assert.ok(html.includes(`<meta name="description" content="${escapeHtml(content.meta.description)}">`));
  assert.ok(html.includes(`<meta property="og:title" content="${escapeHtml(content.meta.title)}">`));
  assert.ok(html.includes(`<meta property="og:description" content="${escapeHtml(content.meta.description)}">`));
  assert.ok(html.includes('href="./styles.css"'));
  assert.ok(html.includes('src="./app.js"'));
  assert.ok(html.includes('href="./favicon.svg"'));
  assert.ok(!/(href|src)="\/[^/]/.test(html), 'no root-absolute paths');
});

test('content is embedded as JSON that cannot close the script block', () => {
  const json = embedJson({ text: '</script><b>' });
  assert.ok(!json.includes('</script>'));
  assert.deepEqual(JSON.parse(json), { text: '</script><b>' });
  const html = pageHtml({ ...content, intro: { ...content.intro, headline: 'x</script>y' } });
  assert.equal(html.split('</script>').length - 1, 2, 'exactly the two real closing tags');
});

test('html attributes are escaped', () => {
  assert.equal(escapeHtml('a<b>&"c\''), 'a&lt;b&gt;&amp;&quot;c&#39;');
});

test('bundle strips relative imports and export keywords, refuses anything else', () => {
  const out = bundle([
    { name: 'a.js', code: "export function a() { return 1; }\nexport const B = 2;\n" },
    { name: 'b.js', code: "import { a, B } from './a.js';\nexport function c() { return a() + B; }\n" },
  ]);
  assert.ok(!out.includes('import '));
  assert.ok(!out.includes('export '));
  assert.ok(out.includes('function a()'));
  assert.ok(out.includes('function c()'));
  assert.throws(() => bundle([{ name: 'x.js', code: 'export { a };\n' }]), /x\.js/);
  assert.throws(() => bundle([{ name: 'y.js', code: "import fs from 'node:fs';\n" }]), /y\.js/);
});

test('bundle refuses an unlisted module, a wrong order, a duplicate name and a syntax error', () => {
  assert.throws(() => bundle([{ name: 'a.js', code: "import { x } from './util.js';\n" }]), /not in the module list/);
  assert.throws(() => bundle([
    { name: 'a.js', code: "import { b } from './b.js';\n" },
    { name: 'b.js', code: 'export const b = 1;\n' },
  ]), /must come earlier/);
  assert.throws(() => bundle([
    { name: 'a.js', code: 'export function same() {}\n' },
    { name: 'b.js', code: 'function same() {}\n' },
  ]), /already declared in a\.js/);
  assert.throws(() => bundle([{ name: 'a.js', code: 'function broken( {\n' }]), /does not parse/);
});

test('colour tokens are read from tokens.css', () => {
  assert.equal(readToken(':root {\n  --aubergine: #5E1A4D;\n}', '--aubergine'), '#5E1A4D');
  assert.throws(() => readToken(':root {}', '--missing'), /not found/);
});

test('favicon is a 3x3 mosaic', () => {
  const svg = faviconSvg('#5E1A4D');
  assert.equal(svg.split('<rect').length - 1, 9);
  assert.ok(svg.includes('fill="#5E1A4D"'));
});
