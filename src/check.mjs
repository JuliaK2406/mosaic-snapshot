// Content check: the shape of content/snapshot.yaml and TODO markers.
// Run with npm run check. The build runs it too and stops on any error.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONTENT_FILE = path.join(ROOT, 'content', 'snapshot.yaml');
export const PILLAR_KEYS = ['F', 'P', 'V'];
export const RESULT_KEYS = [...PILLAR_KEYS, 'balanced'];
export const ITEMS_PER_PILLAR = 4;
export const STEPS_PER_RESULT = 3;

export async function loadContent(file = CONTENT_FILE) {
  return load(await readFile(file, 'utf8'));
}

// Required fields. 'string' means a non-empty text, 'url' a full web address.
// Nested objects are checked recursively.
const SHAPE = {
  meta: { published: 'boolean', site_url: 'url', title: 'string', description: 'string' },
  links: { calendly: 'url', main_site: 'url' },
  backend: { endpoint_url: 'url-or-empty' },
  logic: { balanced_gap: 'number', tie_order: 'tie-order' },
  intro: {
    wordmark: 'string',
    headline: 'string',
    subhead: 'string',
    meta_line: 'string',
    start_label: 'string',
    author_line: 'string',
    sample_label: 'string',
  },
  question: { prompt: 'string', back_label: 'string', scale: 'scale' },
  pillars: 'pillars',
  grow_question: { eyebrow: 'string', title: 'string', subtitle: 'string', options: 'options' },
  email_step: {
    eyebrow: 'string',
    title: 'string',
    subtitle: 'string',
    name_label: 'string',
    email_label: 'string',
    consent_label: 'string',
    submit_label: 'string',
    data_note: 'string',
    error_name: 'string',
    error_email: 'string',
  },
  result: {
    eyebrow: 'string',
    greeting_with_name: 'string',
    greeting: 'string',
    focus_label: 'string',
    score_suffix: 'string',
    legend_low: 'string',
    legend_high: 'string',
    grow_match: 'string',
    grow_mismatch: 'string',
    section_labels: { what_it_means: 'string', how_it_affects: 'string', whats_next: 'string', first_steps: 'string' },
    cta_button: 'string',
    cta_note: 'string',
    copy_line: 'string',
    retake_label: 'string',
    signature_name: 'string',
    signature_title: 'string',
    legal_line: 'string',
  },
  results: 'results',
};

// Strings that must keep their placeholders.
const PLACEHOLDERS = [
  ['result.greeting_with_name', ['{name}']],
  ['result.copy_line', ['{email}']],
  ['result.grow_match', ['{grow}']],
  ['result.grow_mismatch', ['{grow}', '{focus}']],
];

// The only value that may be empty: no backend yet means nothing is sent.
const EMPTY_ALLOWED = new Set(['backend.endpoint_url']);

const isString = (value) => typeof value === 'string';
const isFilled = (value) => isString(value) && value.trim() !== '';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function isWebUrl(value, protocols = ['https:', 'http:']) {
  if (!isFilled(value)) return false;
  try {
    const url = new URL(value.trim());
    return protocols.includes(url.protocol) && url.hostname !== '';
  } catch {
    return false;
  }
}

export function checkContent(content) {
  if (!isObject(content)) return { errors: ['content: the file is not a list of fields'], todos: [] };
  const errors = [];
  const fail = (at, message) => errors.push(`${at}: ${message}`);
  checkShape(content, SHAPE, '', fail);
  for (const [at, needed] of PLACEHOLDERS) {
    const value = get(content, at);
    if (!isString(value)) continue;
    for (const tag of needed) if (!value.includes(tag)) fail(at, `must contain ${tag}`);
  }
  checkNoEmptyValues(content, '', fail);
  const todos = [];
  collectTodos(content, '', todos);
  return { errors, todos };
}

function get(object, dotted) {
  return dotted.split('.').reduce((value, key) => (isObject(value) ? value[key] : undefined), object);
}

function join(at, key) {
  return at ? `${at}.${key}` : key;
}

function checkShape(value, shape, at, fail) {
  if (typeof shape === 'string') {
    checkKind(value, shape, at, fail);
    return;
  }
  if (!isObject(value)) {
    fail(at || 'content', 'expected a group of fields');
    return;
  }
  for (const [key, sub] of Object.entries(shape)) {
    const childPath = join(at, key);
    if (!(key in value)) {
      fail(childPath, 'missing');
      continue;
    }
    checkShape(value[key], sub, childPath, fail);
  }
}

function checkKind(value, kind, at, fail) {
  switch (kind) {
    case 'string':
      if (!isFilled(value)) fail(at, 'must be a non-empty text');
      break;
    case 'url':
      if (!isWebUrl(value)) fail(at, 'must be a full address starting with https:// or http://');
      break;
    case 'url-or-empty':
      if (!isString(value)) fail(at, 'must be text (empty is allowed)');
      else if (value.trim() !== '' && !isWebUrl(value, ['https:'])) fail(at, 'must be empty or a full https:// address');
      break;
    case 'boolean':
      if (typeof value !== 'boolean') fail(at, 'must be true or false');
      break;
    case 'number':
      if (typeof value !== 'number' || !(value > 0)) fail(at, 'must be a number above 0');
      break;
    case 'tie-order':
      checkTieOrder(value, at, fail);
      break;
    case 'scale':
      checkScale(value, at, fail);
      break;
    case 'pillars':
      checkPillars(value, at, fail);
      break;
    case 'options':
      checkOptions(value, at, fail);
      break;
    case 'results':
      checkResults(value, at, fail);
      break;
    default:
      fail(at, `unknown check "${kind}"`);
  }
}

function checkTieOrder(value, at, fail) {
  if (!Array.isArray(value)) {
    fail(at, 'must be a list');
    return;
  }
  const given = [...value].sort().join(',');
  const wanted = [...PILLAR_KEYS].sort().join(',');
  if (given !== wanted) fail(at, `must list each of ${PILLAR_KEYS.join(', ')} exactly once`);
}

function checkScale(value, at, fail) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(at, 'must be a list of marks');
    return;
  }
  value.forEach((mark, i) => {
    const here = `${at}[${i}]`;
    if (!isObject(mark)) {
      fail(here, 'must have value and label');
      return;
    }
    if (!Number.isInteger(mark.value) || mark.value < 1 || mark.value > 10) fail(`${here}.value`, 'must be a whole number from 1 to 10');
    if (!isFilled(mark.label)) fail(`${here}.label`, 'must be a non-empty text');
  });
}

function checkKeyedList(value, at, fail, { noun, fields }) {
  if (!Array.isArray(value)) {
    fail(at, 'must be a list');
    return false;
  }
  if (value.length !== PILLAR_KEYS.length) fail(at, `must have exactly ${PILLAR_KEYS.length} ${noun}s, found ${value.length}`);
  const keys = value.map((entry) => (isObject(entry) ? entry.key : undefined));
  for (const key of PILLAR_KEYS) if (!keys.includes(key)) fail(at, `${noun} with key ${key} is missing`);
  value.forEach((entry, i) => {
    const here = `${at}[${i}]`;
    if (!isObject(entry)) {
      fail(here, `must have key and ${fields.join(', ')}`);
      return;
    }
    if (!PILLAR_KEYS.includes(entry.key)) fail(`${here}.key`, `must be one of ${PILLAR_KEYS.join(', ')}`);
    for (const field of fields) if (!isFilled(entry[field])) fail(`${here}.${field}`, 'must be a non-empty text');
  });
  return true;
}

function checkPillars(value, at, fail) {
  if (!checkKeyedList(value, at, fail, { noun: 'pillar', fields: ['name', 'short', 'in_text'] })) return;
  value.forEach((pillar, i) => {
    if (!isObject(pillar)) return;
    const here = `${at}[${i}].items`;
    if (!Array.isArray(pillar.items)) {
      fail(here, 'must be a list');
      return;
    }
    if (pillar.items.length !== ITEMS_PER_PILLAR) fail(here, `must have exactly ${ITEMS_PER_PILLAR} items, found ${pillar.items.length}`);
    pillar.items.forEach((item, j) => {
      const itemPath = `${here}[${j}]`;
      if (!isObject(item)) {
        fail(itemPath, 'must have a title');
        return;
      }
      if (!isFilled(item.title)) fail(`${itemPath}.title`, 'must be a non-empty text');
      if ('note' in item && !isFilled(item.note)) fail(`${itemPath}.note`, 'must be a non-empty text or removed');
    });
  });
}

function checkOptions(value, at, fail) {
  checkKeyedList(value, at, fail, { noun: 'option', fields: ['label', 'description'] });
}

function checkResults(value, at, fail) {
  if (!isObject(value)) {
    fail(at, `must contain ${RESULT_KEYS.join(', ')}`);
    return;
  }
  for (const key of RESULT_KEYS) {
    const here = `${at}.${key}`;
    const block = value[key];
    if (!isObject(block)) {
      fail(here, 'missing');
      continue;
    }
    for (const field of ['headline', 'what_it_means', 'cta_question']) {
      if (!isFilled(block[field])) fail(`${here}.${field}`, 'must be a non-empty text');
    }
    const listField = key === 'balanced' ? 'whats_next' : 'how_it_affects';
    checkTextList(block[listField], `${here}.${listField}`, fail);
    if (!Array.isArray(block.steps)) {
      fail(`${here}.steps`, 'must be a list');
    } else {
      if (block.steps.length !== STEPS_PER_RESULT) fail(`${here}.steps`, `must have exactly ${STEPS_PER_RESULT} steps, found ${block.steps.length}`);
      checkTextList(block.steps, `${here}.steps`, fail);
    }
  }
}

function checkTextList(value, at, fail) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(at, 'must be a list with at least one paragraph');
    return;
  }
  value.forEach((text, i) => {
    if (!isFilled(text)) fail(`${at}[${i}]`, 'must be a non-empty text');
  });
}

function checkNoEmptyValues(value, at, fail) {
  if (isString(value)) {
    if (value.trim() === '' && !EMPTY_ALLOWED.has(at)) fail(at, 'is empty');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) fail(at, 'is an empty list');
    value.forEach((entry, i) => checkNoEmptyValues(entry, `${at}[${i}]`, fail));
    return;
  }
  if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) checkNoEmptyValues(entry, join(at, key), fail);
    return;
  }
  if (value === null || value === undefined) fail(at, 'is empty');
}

function collectTodos(value, at, todos) {
  if (isString(value)) {
    if (/\bTODO\b/.test(value)) todos.push(at);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, i) => collectTodos(entry, `${at}[${i}]`, todos));
    return;
  }
  if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) collectTodos(entry, join(at, key), todos);
  }
}

// Human-readable report. A TODO blocks only once meta.published is true.
export function report(content, { errors, todos }) {
  const lines = [];
  const published = Boolean(content && content.meta && content.meta.published === true);
  const pillars = Array.isArray(content?.pillars) ? content.pillars : [];
  const questions = pillars.reduce((n, pillar) => n + (Array.isArray(pillar?.items) ? pillar.items.length : 0), 0);
  lines.push(`Content: ${pillars.length} pillars, ${questions} questions, published: ${published}`);
  if (todos.length) {
    lines.push(`TODO markers (${todos.length}):`);
    for (const at of todos) lines.push(`  ${at}`);
  } else {
    lines.push('TODO markers: none');
  }
  const blocking = [...errors];
  if (published && todos.length) blocking.push('meta.published: is true while TODO markers remain');
  if (blocking.length) {
    lines.push(`Errors (${blocking.length}):`);
    for (const error of blocking) lines.push(`  ${error}`);
  } else {
    lines.push('Errors: none');
  }
  return { ok: blocking.length === 0, lines };
}

export async function runCheck(file = CONTENT_FILE) {
  let content;
  try {
    content = await loadContent(file);
  } catch (error) {
    return { ok: false, lines: [`Cannot read ${path.relative(ROOT, file)}: ${error.message}`] };
  }
  return report(content, checkContent(content));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { ok, lines } = await runCheck();
  console.log(lines.join('\n'));
  process.exitCode = ok ? 0 : 1;
}
