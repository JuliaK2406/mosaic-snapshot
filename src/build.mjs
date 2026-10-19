// Build: content/snapshot.yaml -> check -> dist/ with index.html (content embedded as JSON),
// privacy/index.html, app.js, styles.css (with the @font-face rules), favicon.svg,
// content.json, CNAME, the fonts, the link card og-image.png and, while unpublished, robots.txt.
// Also joins backend/src into backend/Code.gs for Google Apps Script (npm run backend).

import { readFile, writeFile, mkdir, rm, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { ROOT, loadContent, checkContent, report } from './check.mjs';
import { ICON_ALPHAS } from './app/mosaic.js';

export const DIST = path.join(ROOT, 'dist');
const APP_DIR = path.join(ROOT, 'src', 'app');
const STYLES_DIR = path.join(ROOT, 'src', 'styles');
// Order matters: a module must come after every module it imports.
const MODULES = ['dom.js', 'scoring.js', 'mosaic.js', 'submit.js', 'main.js'];
// The Apps Script file: the page's own scoring and src cleaning, then the backend modules.
export const BACKEND_SOURCES = [
  'src/app/scoring.js',
  'src/app/submit.js',
  'backend/src/validate.js',
  'backend/src/limits.js',
  'backend/src/sheet.js',
  'backend/src/locale.js',
  'backend/src/summary.js',
  'backend/src/email.js',
  'backend/src/brevo.js',
  'backend/src/entry.js',
];
export const CODE_GS = path.join(ROOT, 'backend', 'Code.gs');
export const CODE_GS_HEADER = `// generated from backend/src, do not edit here
// Rebuild with "npm run backend" (also part of "npm run build") and paste the whole file
// into the Apps Script editor, then Deploy > Manage deployments > New version.
// Sources, in order: ${BACKEND_SOURCES.join(', ')}
`;
const STYLES = ['tokens.css', 'app.css'];
// The site's own domain: dist/CNAME keeps GitHub Pages on it after every deploy.
export const CUSTOM_DOMAIN = 'mosaic.juliakrylova.com';
export const ASSETS = path.join(ROOT, 'assets');
// The link card for LinkedIn and the like, made by scripts/og-image.mjs (npm run og).
export const OG_IMAGE_FILE = 'og-image.png';
export const OG_IMAGE = path.join(ASSETS, OG_IMAGE_FILE);
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 627;
// Fonts are served by the site itself, so no request leaves for Google. These are the latin
// woff2 files Google Fonts serves for the same weights (variable weight, one file per family),
// so the rendering is unchanged; the OFL licence files live beside them in assets/fonts.
export const FONTS = [
  { family: 'Inter', file: 'inter-latin.woff2', weights: [400, 500, 600] },
  { family: 'Lora', file: 'lora-latin.woff2', weights: [500, 600] },
];
export const FONT_LICENCES = ['OFL-Inter.txt', 'OFL-Lora.txt'];
const LATIN_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

// One @font-face per weight, as Google Fonts declares them, all pointing at the same file.
// The URLs are relative to styles.css, so the notice page in privacy/ resolves them too.
export function fontFaceCss() {
  const rules = [];
  for (const font of FONTS) {
    for (const weight of font.weights) {
      rules.push(`@font-face {\n  font-family: '${font.family}';\n  font-style: normal;\n  font-weight: ${weight};\n  font-display: swap;\n  src: url(fonts/${font.file}) format('woff2');\n  unicode-range: ${LATIN_RANGE};\n}`);
    }
  }
  return `/* Fonts served by the site itself (assets/fonts, SIL Open Font License) */\n${rules.join('\n')}\n\n`;
}

function siteUrl(content) {
  return content.meta.site_url.replace(/\/$/, '');
}
const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

export function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text).replace(/[&<>"']/g, (char) => map[char]);
}

// JSON inside a <script> block: "<" is escaped so "</script>" in a text can never close it early.
export function embedJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// Reads one colour token (#rrggbb) from tokens.css, so no colour is written twice.
export function readToken(css, name) {
  const match = css.match(new RegExp(name + '\\s*:\\s*(#[0-9A-Fa-f]{6})'));
  if (!match) throw new Error(`tokens.css: ${name} not found`);
  return match[1];
}

// Joins the ES modules into one file in the given order. Supported: named imports from a module
// listed earlier ("import { a } from './x.js';" or a ../ path when sources carry a file path)
// and "export function/const/let/class". Any other import or export, an import of an unlisted
// module, a top-level name declared in two modules, or a syntax error in the result stops the build.
export function bundle(sources) {
  const identity = (source) => (source.path ? path.resolve(source.path) : source.name);
  const ids = sources.map(identity);
  const declared = new Map();
  const parts = [];
  sources.forEach((source, position) => {
    const { name, code } = source;
    const imports = [];
    let stripped = code.replace(/^import\s*\{[^}]*\}\s*from\s*'(\.\.?\/[^']+)';[ \t]*$/gm, (match, target) => {
      imports.push(target);
      return '';
    });
    for (const target of imports) {
      const wanted = source.path ? path.resolve(path.dirname(source.path), target) : target.replace(/^\.\//, '');
      const at = ids.indexOf(wanted);
      if (at < 0) throw new Error(`${name}: imports ${target}, which is not in the module list`);
      if (at >= position) throw new Error(`${name}: imports ${target}, which must come earlier in the module list`);
    }
    stripped = stripped.replace(/^export\s+(?=(?:async\s+)?function\s|const\s|let\s|class\s)/gm, '');
    const leftover = stripped.match(/^\s*(import|export)\b/m);
    if (leftover) throw new Error(`${name}: the bundler cannot handle this ${leftover[1]} statement`);
    for (const match of stripped.matchAll(/^(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      const id = match[1];
      if (declared.has(id)) throw new Error(`${name}: top-level name "${id}" is already declared in ${declared.get(id)}`);
      declared.set(id, name);
    }
    parts.push(`// ---- ${name} ----\n${stripped.trim()}\n`);
  });
  const output = parts.join('\n');
  try {
    new vm.Script(`'use strict';\n${output}`, { filename: 'app.js' });
  } catch (error) {
    throw new Error(`app.js does not parse: ${error.message}`);
  }
  return output;
}

export function pageHtml(content, { themeColor = '#FAF8F5' } = {}) {
  const m = content.meta;
  const robots = m.published ? '' : '  <meta name="robots" content="noindex, nofollow">\n';
  const site = escapeHtml(siteUrl(content));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(m.title)}</title>
  <meta name="description" content="${escapeHtml(m.description)}">
${robots}  <link rel="canonical" href="${site}/">
  <meta property="og:url" content="${site}/">
  <meta property="og:title" content="${escapeHtml(m.title)}">
  <meta property="og:description" content="${escapeHtml(m.description)}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${site}/${OG_IMAGE_FILE}">
  <meta property="og:image:width" content="${OG_WIDTH}">
  <meta property="og:image:height" content="${OG_HEIGHT}">
  <meta property="og:image:alt" content="${escapeHtml(content.intro.headline)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="${themeColor}">
  <link rel="icon" type="image/svg+xml" href="./favicon.svg">
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <main id="app"></main>
  <script id="snapshot-content" type="application/json">${embedJson(content)}</script>
  <script type="module" src="./app.js"></script>
</body>
</html>
`;
}

// The brand sign as plain markup for the notice page (the survey page draws it in app.js).
export function brandIconHtml() {
  return `<span class="brand__icon" aria-hidden="true">${ICON_ALPHAS.map((alpha) => `<span style="background: rgba(var(--aubergine-rgb), ${alpha})"></span>`).join('')}</span>`;
}

// Email addresses in an already escaped text become mailto links; nothing else is markup.
export function linkEmails(escapedText) {
  return escapedText.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (email) => `<a href="mailto:${email}">${email}</a>`);
}

// The data notice at privacy/: its own page from the privacy section of the yaml, the same
// fonts, colours and gutters as the survey, no script. The brand sign leads back to the survey.
export function privacyHtml(content, { themeColor = '#FAF8F5' } = {}) {
  const m = content.meta;
  const p = content.privacy;
  const paragraph = (text) => `      <p>${linkEmails(escapeHtml(text))}</p>`;
  const sections = p.sections.map((section) => {
    const parts = [`      <h2 class="heading-sm">${escapeHtml(section.heading)}</h2>`];
    (section.paragraphs || []).forEach((text) => parts.push(paragraph(text)));
    if (section.items) parts.push(`      <ul class="notice__list">\n${section.items.map((text) => `        <li>${linkEmails(escapeHtml(text))}</li>`).join('\n')}\n      </ul>`);
    return `    <section class="notice__section">\n${parts.join('\n')}\n    </section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(p.title)} | ${escapeHtml(m.title)}</title>
  <meta name="description" content="${escapeHtml(p.intro)}">
  <link rel="canonical" href="${escapeHtml(siteUrl(content))}/privacy/">
  <meta name="theme-color" content="${themeColor}">
  <link rel="icon" type="image/svg+xml" href="../favicon.svg">
  <link rel="stylesheet" href="../styles.css">
</head>
<body>
  <main class="notice">
    <a class="brand notice__brand" href="../">${brandIconHtml()}<span class="brand__wordmark">${escapeHtml(content.intro.wordmark)}</span></a>
    <h1 class="heading notice__title">${escapeHtml(p.title)}</h1>
${paragraph(p.intro)}
${sections}
  </main>
</body>
</html>
`;
}

// The same 3x3 mini mosaic as the brand icon on the first screen.
export function faviconSvg(colour = '#5E1A4D') {
  const cells = ICON_ALPHAS.map((alpha, i) => {
    const x = (i % 3) * 11;
    const y = Math.floor(i / 3) * 11;
    return `<rect x="${x}" y="${y}" width="10" height="10" rx="1.5" fill="${colour}" fill-opacity="${alpha}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${cells}</svg>\n`;
}

// Reads backend/src and the two page modules it needs into one Apps Script file.
export async function buildBackendCode() {
  const sources = [];
  for (const rel of BACKEND_SOURCES) {
    const file = path.join(ROOT, rel);
    sources.push({ name: rel, path: file, code: await readFile(file, 'utf8') });
  }
  return CODE_GS_HEADER + bundle(sources);
}

export async function buildBackend({ quiet = false } = {}) {
  const code = await buildBackendCode();
  await mkdir(path.dirname(CODE_GS), { recursive: true });
  await writeFile(CODE_GS, code, 'utf8');
  if (!quiet) console.log(`  backend/Code.gs  ${Buffer.byteLength(code)} bytes`);
  return code;
}

// options.distDir: where to write (default dist/); options.endpointUrl: replaces backend.endpoint_url
// in this build only (also read from SNAPSHOT_ENDPOINT_URL, for the local sending check, never in CI);
// options.patch: a function that changes the loaded content before the check, for temporary builds
// in verify and screenshots only (published mode, placeholder texts); options.backend: also rebuild
// backend/Code.gs (default true).
export async function build(options = {}) {
  const distDir = options.distDir || DIST;
  const quiet = Boolean(options.quiet);
  const log = quiet ? () => {} : console.log;
  const content = await loadContent();
  if (typeof options.patch === 'function') options.patch(content);
  const result = report(content, checkContent(content));
  log(result.lines.join('\n'));
  if (!result.ok) throw new Error('Content check failed, nothing was built');
  const endpointUrl = options.endpointUrl || process.env.SNAPSHOT_ENDPOINT_URL || '';
  if (endpointUrl) {
    content.backend.endpoint_url = endpointUrl;
    log(`  endpoint override: ${endpointUrl}`);
  }

  const sources = [];
  for (const name of MODULES) sources.push({ name, code: await readFile(path.join(APP_DIR, name), 'utf8') });
  const styles = [];
  for (const name of STYLES) styles.push(`/* ---- ${name} ---- */\n${await readFile(path.join(STYLES_DIR, name), 'utf8')}`);
  const tokens = await readFile(path.join(STYLES_DIR, 'tokens.css'), 'utf8');

  const files = {
    'index.html': pageHtml(content, { themeColor: readToken(tokens, '--porcelain') }),
    'privacy/index.html': privacyHtml(content, { themeColor: readToken(tokens, '--porcelain') }),
    'app.js': bundle(sources),
    'styles.css': fontFaceCss() + styles.join('\n'),
    'favicon.svg': faviconSvg(readToken(tokens, '--aubergine')),
    'content.json': JSON.stringify(content),
    'CNAME': `${CUSTOM_DOMAIN}\n`,
  };
  if (!content.meta.published) files['robots.txt'] = ROBOTS_TXT;

  // Only the build's own files are replaced; dist/emails (the email previews) stays.
  await mkdir(distDir, { recursive: true });
  await mkdir(path.join(distDir, 'privacy'), { recursive: true });
  await mkdir(path.join(distDir, 'fonts'), { recursive: true });
  for (const name of [...Object.keys(files), 'robots.txt']) await rm(path.join(distDir, name), { force: true });
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(distDir, name), body, 'utf8');
  // the fonts with their licence files and the link card are copied as they are
  const copies = [
    ...FONTS.map((font) => [path.join(ASSETS, 'fonts', font.file), path.join('fonts', font.file)]),
    ...FONT_LICENCES.map((name) => [path.join(ASSETS, 'fonts', name), path.join('fonts', name)]),
    [OG_IMAGE, OG_IMAGE_FILE],
  ];
  const written = Object.keys(files);
  for (const [from, to] of copies) {
    if (!(await stat(from).catch(() => null))) {
      if (from === OG_IMAGE) {
        log(`  WARNING: ${path.relative(ROOT, from)} is missing, run npm run og; the page links to it`);
        continue;
      }
      throw new Error(`${path.relative(ROOT, from)} is missing`);
    }
    await copyFile(from, path.join(distDir, to));
    written.push(to);
  }
  for (const name of written) {
    const { size } = await stat(path.join(distDir, name));
    log(`  ${path.relative(ROOT, path.join(distDir, name))}  ${size} bytes`);
  }
  if (options.backend !== false) await buildBackend({ quiet });
  log(content.meta.published
    ? 'Published mode: indexable, no robots.txt, no sample result'
    : 'Unpublished mode: noindex, robots.txt with Disallow, sample result at ?sample');
  return files;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await build();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
