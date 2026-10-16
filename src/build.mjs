// Build: content/snapshot.yaml -> check -> dist/ with index.html (content embedded as JSON),
// app.js, styles.css, favicon.svg, content.json and, while unpublished, robots.txt.
// Also joins backend/src into backend/Code.gs for Google Apps Script (npm run backend).

import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
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
const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Lora:wght@500;600&display=swap';
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
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(m.title)}</title>
  <meta name="description" content="${escapeHtml(m.description)}">
${robots}  <meta property="og:title" content="${escapeHtml(m.title)}">
  <meta property="og:description" content="${escapeHtml(m.description)}">
  <meta property="og:type" content="website">
  <meta name="theme-color" content="${themeColor}">
  <link rel="icon" type="image/svg+xml" href="./favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${FONTS_URL}">
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
    'app.js': bundle(sources),
    'styles.css': styles.join('\n'),
    'favicon.svg': faviconSvg(readToken(tokens, '--aubergine')),
    'content.json': JSON.stringify(content),
  };
  if (!content.meta.published) files['robots.txt'] = ROBOTS_TXT;

  // Only the build's own files are replaced; dist/emails (the email previews) stays.
  await mkdir(distDir, { recursive: true });
  for (const name of [...Object.keys(files), 'robots.txt']) await rm(path.join(distDir, name), { force: true });
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(distDir, name), body, 'utf8');
  for (const name of Object.keys(files)) {
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
