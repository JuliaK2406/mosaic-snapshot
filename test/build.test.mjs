import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../src/check.mjs';
import { pageHtml, embedJson, bundle, faviconSvg, escapeHtml } from '../src/build.mjs';

const content = await loadContent();

test('unpublished page carries noindex, published page does not', () => {
  const hidden = pageHtml({ ...content, meta: { ...content.meta, published: false } });
  assert.ok(hidden.includes('<meta name="robots" content="noindex, nofollow">'));
  const open = pageHtml({ ...content, meta: { ...content.meta, published: true } });
  assert.ok(!open.includes('name="robots"'));
});

test('head has lang, title, description and og tags, all paths relative', () => {
  const html = pageHtml(content);
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes(`<title>${content.meta.title}</title>`));
  assert.ok(html.includes(`<meta name="description" content="${content.meta.description}">`));
  assert.ok(html.includes(`<meta property="og:title" content="${content.meta.title}">`));
  assert.ok(html.includes(`<meta property="og:description" content="${content.meta.description}">`));
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

test('favicon is a 3x3 mosaic', () => {
  const svg = faviconSvg();
  assert.equal(svg.split('<rect').length - 1, 9);
  assert.ok(svg.includes('fill="#5E1A4D"'));
});
