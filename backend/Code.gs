// generated from backend/src, do not edit here
// Rebuild with "npm run backend" (also part of "npm run build") and paste the whole file
// into the Apps Script editor, then Deploy > Manage deployments > New version.
// Sources, in order: src/app/scoring.js, src/app/submit.js, backend/src/validate.js, backend/src/limits.js, backend/src/sheet.js, backend/src/locale.js, backend/src/summary.js, backend/src/email.js, backend/src/brevo.js, backend/src/entry.js
// ---- src/app/scoring.js ----
// Result logic as pure functions. No DOM here: the tests import this file directly.

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// answers: the 12 scores in question order (four per pillar, pillars in content order).
// Returns { F: [...], P: [...], V: [...] }.
function groupAnswers(answers, pillars) {
  const grouped = {};
  let index = 0;
  for (const pillar of pillars) {
    grouped[pillar.key] = pillar.items.map(() => answers[index++]);
  }
  return grouped;
}

function pillarAverages(grouped) {
  const averages = {};
  for (const key of Object.keys(grouped)) averages[key] = average(grouped[key]);
  return averages;
}

// Gap = 10 minus the pillar average. There are no "where I want to be" questions,
// so 10 stands for the desired state.
function pillarGaps(averages) {
  const gaps = {};
  for (const key of Object.keys(averages)) gaps[key] = 10 - averages[key];
  return gaps;
}

// Balanced when every gap is below logic.balanced_gap. Otherwise the focus is the
// pillar with the largest gap; a tie goes to whichever comes first in logic.tie_order.
function pickFocus(gaps, logic) {
  const order = logic.tie_order;
  const balanced = order.every((key) => gaps[key] < logic.balanced_gap);
  if (balanced) return { result: 'balanced', focus: null };
  let focus = order[0];
  for (const key of order) {
    if (gaps[key] > gaps[focus]) focus = key;
  }
  return { result: focus, focus };
}

function evaluate(answers, content) {
  const grouped = groupAnswers(answers, content.pillars);
  const averages = pillarAverages(grouped);
  const gaps = pillarGaps(averages);
  const { result, focus } = pickFocus(gaps, content.logic);
  return { grouped, averages, gaps, result, focus, balanced: result === 'balanced' };
}

// Which line about question 13 to show: null for a balanced mosaic,
// 'match' when the chosen pillar is the focus, otherwise 'mismatch'.
function growLineKind(result, grow) {
  if (result === 'balanced') return null;
  return grow === result ? 'match' : 'mismatch';
}

function formatAverage(value) {
  return value.toFixed(1);
}

// Replaces {name}-style placeholders with plain text. The caller puts the result
// into textContent, so nothing here is ever parsed as HTML.
function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

// ---- src/app/submit.js ----
// Payload for stage 2 (Google Apps Script) and the sending itself.
// While backend.endpoint_url is empty, nothing leaves the browser.

const PAYLOAD_VERSION = 1;
const SRC_MAX_LENGTH = 40;

// Workshop tag from ?src=. Keeps a-z, 0-9, "-" and "_" only, at most 40 characters.
// Letters are lower-cased first, so "Workshop-A" and "workshop-a" count as the same tag.
function sanitizeSrc(raw) {
  if (typeof raw !== 'string') return '';
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, SRC_MAX_LENGTH);
}

function readSrc(search) {
  const params = new URLSearchParams(search || '');
  return sanitizeSrc(params.get('src') || '');
}

// The content check guarantees a full address; if it ever is not one, the link is used as is.
function calendlyUrl(base, { src, result }) {
  try {
    const url = new URL(base);
    url.searchParams.set('utm_source', 'mosaic-snapshot');
    url.searchParams.set('utm_medium', 'result');
    url.searchParams.set('utm_campaign', src || 'direct');
    url.searchParams.set('utm_content', result);
    return url.toString();
  } catch {
    return base;
  }
}

// { F1: 4, F2: 3, ... V4: 6 } in question order.
function answerMap(answers, pillars) {
  const map = {};
  let index = 0;
  for (const pillar of pillars) {
    pillar.items.forEach((item, position) => {
      map[`${pillar.key}${position + 1}`] = answers[index++];
    });
  }
  return map;
}

// Payload sent to the stage 2 endpoint (Google Apps Script), version 1:
// {
//   "version": 1,
//   "submitted_at": "2026-10-08T10:00:00.000Z",
//   "name": "Anna",
//   "email": "anna@example.com",
//   "consent": false,
//   "src": "",
//   "grow": "F|P|V",
//   "result": "F|P|V|balanced",
//   "averages": { "F": 4, "P": 7, "V": 6 },
//   "answers": { "F1": 4, "F2": 3, "F3": 5, "F4": 4, "P1": 7, "P2": 6, "P3": 8, "P4": 7, "V1": 6, "V2": 5, "V3": 7, "V4": 6 }
// }
function buildPayload({ name, email, consent, src, grow, evaluation, answers, pillars, submittedAt }) {
  const averages = {};
  for (const key of Object.keys(evaluation.averages)) {
    averages[key] = Math.round(evaluation.averages[key] * 100) / 100;
  }
  return {
    version: PAYLOAD_VERSION,
    submitted_at: submittedAt || new Date().toISOString(),
    name,
    email,
    consent: Boolean(consent),
    src: src || '',
    grow,
    result: evaluation.result,
    averages,
    answers: answerMap(answers, pillars),
  };
}

// Fire-and-forget. Never blocks the result and never shows an error to the person.
// A blank or whitespace-only address means: send nothing.
function sendPayload(payload, endpointUrl, fetchImpl = globalThis.fetch) {
  const url = typeof endpointUrl === 'string' ? endpointUrl.trim() : '';
  if (!url || typeof fetchImpl !== 'function') return Promise.resolve(false);
  try {
    return fetchImpl(url, {
      method: 'POST',
      mode: 'no-cors',
      keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    }).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

// ---- backend/src/validate.js ----
// Checks one submission from the page and cleans its fields. Pure functions, no Apps Script
// objects, so the tests import this file directly. Runs inside Google Apps Script (V8) too,
// so no optional chaining, no URL class, nothing from Node or the browser.



const NAME_MAX = 60;
const EMAIL_MAX = 254;
const EMAIL_PATTERN_SERVER = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PILLAR_KEYS_SERVER = ['F', 'P', 'V'];
const ANSWER_KEYS = ['F1', 'F2', 'F3', 'F4', 'P1', 'P2', 'P3', 'P4', 'V1', 'V2', 'V3', 'V4'];
// A link or an address in the name field is not a person: the row is kept, nothing is sent.
const SPAM_PATTERN = /https?:|www\.|:\/\/|@/i;
const SUBMITTED_AT_MAX = 40;

// Control characters (0 to 31 and 127) and invisible ones (zero-width, direction marks,
// byte order mark), built without escape sequences on purpose.
const chr = (code) => String.fromCharCode(code);
const CONTROL_CHARACTERS = new RegExp('[' + chr(0) + '-' + chr(31) + chr(127) + ']', 'g');
const INVISIBLE_CHARACTERS = new RegExp('[' + chr(0x200B) + '-' + chr(0x200F) + chr(0x2028) + '-' + chr(0x202E) + chr(0x2060) + chr(0xFEFF) + ']', 'g');
// Google Sheets reads a cell that starts with one of these as a formula or a number.
const FORMULA_START = /^[=+\-@]+/;
const SUBMITTED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(CONTROL_CHARACTERS, '')
    .replace(INVISIBLE_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(FORMULA_START, '')
    .trim();
}

function looksLikeSpam(name) {
  return SPAM_PATTERN.test(name || '');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// raw: the request body (string) or an already parsed object.
// Returns { ok: false, errors } for an invalid submission, otherwise
// { ok: true, submission, rejected } where rejected marks a spammy name.
// Extra fields are dropped; answers come out as an array of 12 in F1..V4 order.
function parseSubmission(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch (error) {
      return { ok: false, errors: ['body is not JSON'] };
    }
  }
  if (!isPlainObject(data)) return { ok: false, errors: ['body is not an object'] };

  const errors = [];
  if (data.version !== 1) errors.push('version must be 1');

  const name = cleanName(data.name);
  if (name.length < 1 || name.length > NAME_MAX) errors.push(`name must be 1 to ${NAME_MAX} characters`);

  const email = typeof data.email === 'string' ? data.email.trim() : '';
  if (!EMAIL_PATTERN_SERVER.test(email) || email.length > EMAIL_MAX || FORMULA_START.test(email)) errors.push('email is not valid');

  if (typeof data.consent !== 'boolean') errors.push('consent must be true or false');

  const src = sanitizeSrc(typeof data.src === 'string' ? data.src : '');

  if (PILLAR_KEYS_SERVER.indexOf(data.grow) < 0) errors.push('grow must be F, P or V');

  const answers = [];
  if (!isPlainObject(data.answers)) {
    errors.push('answers must be an object with F1..V4');
  } else {
    const keys = Object.keys(data.answers);
    const missing = ANSWER_KEYS.filter((key) => keys.indexOf(key) < 0);
    if (keys.length !== ANSWER_KEYS.length || missing.length) errors.push('answers must have exactly the keys F1..V4');
    ANSWER_KEYS.forEach((key) => {
      const value = data.answers[key];
      if (!Number.isInteger(value) || value < 1 || value > 10) errors.push(`answer ${key} must be a whole number from 1 to 10`);
      answers.push(value);
    });
  }

  if (errors.length) return { ok: false, errors };

  const submittedAt = typeof data.submitted_at === 'string' && data.submitted_at.length <= SUBMITTED_AT_MAX && SUBMITTED_AT_PATTERN.test(data.submitted_at)
    ? data.submitted_at
    : '';
  const submission = {
    version: 1,
    name,
    email,
    consent: data.consent,
    src,
    grow: data.grow,
    answers,
    submittedAt,
    clientResult: typeof data.result === 'string' ? data.result : '',
  };
  return { ok: true, submission, rejected: looksLikeSpam(name) };
}

// ---- backend/src/limits.js ----
// Decisions about duplicates and sending limits. Pure: the counters and the time come in
// as arguments, the storage (CacheService, PropertiesService) lives in entry.js.

const LIMITS = {
  PER_EMAIL_MIN_SECONDS: 120, // the same address not more than once in 2 minutes
  PER_EMAIL_PER_DAY: 3,       // and not more than 3 emails a day
  PER_HOUR: 150,              // everyone together, notifications to Julia included
  PER_DAY: 280,               // free Brevo allows 300 a day, keep a margin
};

// Counters are keyed by UTC day and hour, so they roll over by themselves.
function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function hourKey(date) {
  return date.toISOString().slice(0, 13);
}

// emailKey: a hash of the address, never the address itself.
function counterKeys(emailKey, now) {
  return {
    last: `last:${emailKey}`,
    emailDay: `emailday:${dayKey(now)}:${emailKey}`,
    hour: `hour:${hourKey(now)}`,
    day: `day:${dayKey(now)}`,
  };
}

// lastSentAt: timestamp (ms) of the previous email to this address, or null.
// needed: how many emails this submission will send (1, or 2 with a notification).
// The test address skips the per-address limits, the shared limits still apply.
function decideSending({ now, lastSentAt, emailDayCount, hourCount, dayCount, needed, isTestEmail }) {
  const count = needed || 1;
  if (!isTestEmail) {
    if (lastSentAt && now.getTime() - lastSentAt < LIMITS.PER_EMAIL_MIN_SECONDS * 1000) {
      return { allowed: false, reason: `same email within ${LIMITS.PER_EMAIL_MIN_SECONDS / 60} minutes` };
    }
    if ((emailDayCount || 0) >= LIMITS.PER_EMAIL_PER_DAY) {
      return { allowed: false, reason: `same email ${LIMITS.PER_EMAIL_PER_DAY} times today` };
    }
  }
  if ((hourCount || 0) + count > LIMITS.PER_HOUR) return { allowed: false, reason: `hourly limit of ${LIMITS.PER_HOUR}` };
  if ((dayCount || 0) + count > LIMITS.PER_DAY) return { allowed: false, reason: `daily limit of ${LIMITS.PER_DAY}` };
  return { allowed: true, reason: '' };
}

// Counter keys older than yesterday, to be deleted from the properties.
function staleCounterKeys(keys, now) {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return keys.filter((key) => {
    const match = key.match(/^(?:emailday|day|hour):(\d{4}-\d{2}-\d{2})/);
    return Boolean(match) && match[1] !== today && match[1] !== yesterday;
  });
}

// ---- backend/src/sheet.js ----
// The Responses sheet: its header row and one row per submission. Pure functions; the
// script writes by header text, so columns may be reordered or added on the right.



const SHEET_NAME = 'Responses';

const HEADERS = [
  'Received at',
  'First name',
  'Email',
  'Newsletter consent',
  'Source',
  'Result',
  'Priority',
  'Foundation avg',
  'Professional avg',
  'Visibility avg',
  'F1', 'F2', 'F3', 'F4',
  'P1', 'P2', 'P3', 'P4',
  'V1', 'V2', 'V3', 'V4',
  'Email status',
  'Contact status',
  'Note',
  'Submitted at (browser)',
  'Consent text',
  'Payload version',
];

const AVERAGE_HEADERS = { F: 'Foundation avg', P: 'Professional avg', V: 'Visibility avg' };
const AVERAGE_HEADER_NAMES = Object.keys(AVERAGE_HEADERS).map((key) => AVERAGE_HEADERS[key]);

function round2(value) {
  return Math.round(value * 100) / 100;
}

// 'Foundation', 'Professional', 'Visibility' from the content, 'Balanced' for a balanced mosaic.
function resultLabel(key, pillars) {
  if (key === 'balanced') return 'Balanced';
  const pillar = (pillars || []).filter((candidate) => candidate.key === key)[0];
  return pillar && pillar.short ? pillar.short : key;
}

function buildRecord({ receivedAt, submission, evaluation, pillars, emailStatus, contactStatus, note, consentLabel }) {
  const record = {};
  record['Received at'] = receivedAt;
  record['First name'] = submission.name;
  record['Email'] = submission.email;
  record['Newsletter consent'] = submission.consent ? 'Yes' : 'No';
  record['Source'] = submission.src || 'direct';
  record['Result'] = resultLabel(evaluation.result, pillars);
  record.Priority = resultLabel(submission.grow, pillars);
  Object.keys(AVERAGE_HEADERS).forEach((key) => {
    record[AVERAGE_HEADERS[key]] = round2(evaluation.averages[key]);
  });
  ANSWER_KEYS.forEach((key, index) => {
    record[key] = submission.answers[index];
  });
  record['Email status'] = emailStatus;
  record['Contact status'] = contactStatus;
  record['Note'] = note || '';
  record['Submitted at (browser)'] = submission.submittedAt || '';
  record['Consent text'] = submission.consent ? (consentLabel || '') : '';
  record['Payload version'] = submission.version;
  return record;
}

// Google Sheets reads text that starts with = + - or @ as a formula or a number;
// a leading space keeps it text. Dates and numbers pass through untouched.
function safeCell(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? ` ${value}` : value;
}

// Values for one sheet row, aligned to the header row actually present in the sheet.
function rowValues(headerRow, record) {
  return headerRow.map((header) => (Object.prototype.hasOwnProperty.call(record, header) ? safeCell(record[header]) : ''));
}

// 1-based column number of a header, 0 when the header is missing.
function columnOf(headerRow, header) {
  return headerRow.indexOf(header) + 1;
}

function missingHeaders(headerRow) {
  return HEADERS.filter((header) => headerRow.indexOf(header) < 0);
}

// Headers that changed name since an earlier version of the sheet; the old cell is renamed
// in place, the values below it stay.
const HEADER_RENAMES = { 'Wants to grow': 'Priority' };

// [{ column (1-based), from, to }] for every old header that is present while the new one is not.
function headerRenames(headerRow) {
  return Object.keys(HEADER_RENAMES)
    .filter((from) => headerRow.indexOf(from) >= 0 && headerRow.indexOf(HEADER_RENAMES[from]) < 0)
    .map((from) => ({ column: headerRow.indexOf(from) + 1, from, to: HEADER_RENAMES[from] }));
}

// ---- backend/src/locale.js ----
// Formulas in summary.js are written in the US syntax: a comma between arguments and between
// the columns of an array, a dot in decimals, TRUE and FALSE. Range.setFormula() parses the
// text in the locale of the spreadsheet, so in a sheet with a Russian, Dutch or German locale
// every one of them would be a parse error. setup() probes the separator of the sheet and
// translates each formula with localizeFormula() before writing it.

const SEPARATORS = [',', ';'];

// Pure. For ';': commas between arguments become ';', commas between array columns become '\',
// the dot of a decimal number becomes ','. Text inside double or single quotes never changes
// (the QUERY text keeps its commas). TRUE and FALSE become 1=1 and 1=0 for either separator,
// so nothing in the formula depends on the language of the sheet.
function localizeFormula(formula, separator) {
  if (!SEPARATORS.includes(separator)) throw new Error(`unknown argument separator: ${JSON.stringify(separator)}`);
  const semicolon = separator === ';';
  const brackets = [];
  let out = '';
  let quote = '';
  let token = '';
  const flush = () => {
    if (!token) return;
    if (token === 'TRUE') out += '1=1';
    else if (token === 'FALSE') out += '1=0';
    else if (semicolon && /^[0-9]+\.[0-9]+$/.test(token)) out += token.replace('.', ',');
    else out += token;
    token = '';
  };
  for (const char of formula) {
    if (quote) {
      out += char;
      if (char === quote) quote = '';
      continue;
    }
    if (/[A-Za-z0-9_.]/.test(char)) {
      token += char;
      continue;
    }
    flush();
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      continue;
    }
    if (char === '(' || char === '{') brackets.push(char);
    if (char === ')' || char === '}') brackets.pop();
    if (char === ',' && semicolon) {
      out += brackets[brackets.length - 1] === '{' ? '\\' : ';';
      continue;
    }
    out += char;
  }
  flush();
  if (quote) throw new Error(`unclosed quote in formula: ${formula}`);
  return out;
}

// The probe formulas, one per candidate separator; the one that evaluates to 3 wins.
function probeFormula(separator) {
  return `=SUM(1${separator}2)`;
}

// Runs the probe on a cell: writes each candidate, flushes, reads the value, clears the cell.
// Returns ',' or ';', or null when neither evaluates to 3.
function detectSeparator(cell, flush) {
  let found = null;
  for (const separator of SEPARATORS) {
    if (found) break;
    cell.setFormula(probeFormula(separator));
    flush();
    const value = cell.getValue();
    if (value === 3) found = separator;
  }
  cell.clearContent();
  flush();
  return found;
}

// ---- backend/src/summary.js ----
// The Summary sheet: anonymous statistics on formulas that update themselves. Pure function:
// summaryLayout() returns cells, formulas and formats; setup() in entry.js writes them.
// Every formula finds its Responses column by header text (MATCH on the first row), never
// by letter, and excludes rows whose Source is "test". No names, no emails, no single rows.



const SUMMARY_SHEET_NAME = 'Summary';
const SUMMARY_NOTE = 'Figures update by themselves with every new response. Test rows (Source = test) are not counted. After the questions change, run setup() again to refresh the question names.';
const SUMMARY_COLUMNS = 4;        // visible columns A to D
// Fixed widths in pixels: A holds the labels and the question names, B the dates and counts.
// Auto-resize was tried first and made A as wide as the note in A1, so the note is merged
// across A:D with wrapping instead.
const COLUMN_WIDTHS = [340, 150, 110, 150];
const HELPER_FIRST_COLUMN = 8;    // H to K: the unsorted question table that the sorted one reads
const QUESTION_ROWS = 12;
const SOURCE_ROWS = 30;           // room for 30 distinct sources in the "By source" table
const PERCENT = '0%';
const TWO_DECIMALS = '0.00';
const DATE_TIME = 'yyyy-mm-dd hh:mm';

// A1 column letter for a 1-based column number.
function columnLetter(column) {
  let n = column;
  let letters = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// Checks that stop setup() from writing a formula with a mismatched bracket or quote.
function balanced(formula) {
  let depth = 0;
  let doubleQuotes = 0;
  let singleQuotes = 0;
  for (const char of formula) {
    if (char === '"') doubleQuotes += 1;
    if (char === "'") singleQuotes += 1;
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0 && doubleQuotes % 2 === 0 && singleQuotes % 2 === 0;
}

// lastColumn: the letter of the last column of the Responses grid at setup time, so the
// references never point outside the sheet.
function makeColumnRef(lastColumn) {
  return (header) => `INDEX(Responses!$A$2:$${lastColumn},0,MATCH("${header}",Responses!$1:$1,0))`;
}

// Layout rows (1-based) that other formulas refer to.
const ROWS = {
  note: 1,
  responsesTitle: 3,
  total: 4,
  subscribed: 5,
  notSubscribed: 6,
  first: 7,
  last: 8,
  resultTitle: 10,
  resultFirst: 11,          // 11 to 14: three pillars and Balanced
  priorityTitle: 16,
  priorityFirst: 17,        // 17 to 19: three pillars
  focused: 20,
  differs: 21,
  averageTitle: 23,
  averageFirst: 24,         // 24 to 26
  questionsTitle: 28,
  questionsHeader: 29,
  questionsFirst: 30,       // 30 to 41, the sorted table (and the helper rows in H to K)
  sourceTitle: 43,
  sourceHeader: 44,
  sourceFirst: 45,          // 45 to 74
};

// pillars: [{ key, short }] from the content (or the keys alone), items: [{ pillarShort, title, code }]
// in question order, lastColumn: letter of the last column of Responses. The helper block H:K
// holds question name, pillar, average, share; the visible block sorts it by the average.
function summaryLayout({ pillars, items, lastColumn }) {
  const col = makeColumnRef(lastColumn);
  const notTest = `${col('Source')},"<>test"`;
  const total = `$B$${ROWS.total}`;
  const share = (cell) => `=IF(${total}=0,0,${cell}/${total})`;
  const cells = [];
  const formulas = [];
  const formats = [];
  const bold = [];
  const value = (row, column, text) => cells.push({ row, column, value: text });
  const formula = (row, column, text, format) => {
    if (!balanced(text)) throw new Error(`unbalanced formula at row ${row}, column ${column}: ${text}`);
    formulas.push({ row, column, formula: text });
    if (format) formats.push({ row, column, rows: 1, columns: 1, format });
  };
  const title = (row, text) => {
    value(row, 1, text);
    bold.push({ row, column: 1, rows: 1, columns: SUMMARY_COLUMNS });
  };

  value(ROWS.note, 1, SUMMARY_NOTE);

  // 1. Responses
  title(ROWS.responsesTitle, 'Responses');
  value(ROWS.total, 1, 'Responses (test rows excluded)');
  formula(ROWS.total, 2, `=COUNTIFS(${col('Result')},"<>",${notTest})`);
  value(ROWS.subscribed, 1, 'Subscribed to the newsletter');
  formula(ROWS.subscribed, 2, `=COUNTIFS(${col('Newsletter consent')},"Yes",${notTest})`);
  formula(ROWS.subscribed, 3, share(`B${ROWS.subscribed}`), PERCENT);
  value(ROWS.notSubscribed, 1, 'Not subscribed');
  formula(ROWS.notSubscribed, 2, `=COUNTIFS(${col('Newsletter consent')},"No",${notTest})`);
  formula(ROWS.notSubscribed, 3, share(`B${ROWS.notSubscribed}`), PERCENT);
  value(ROWS.first, 1, 'First response');
  formula(ROWS.first, 2, `=IF(${total}=0,"-",MINIFS(${col('Received at')},${notTest},${col('Result')},"<>"))`, DATE_TIME);
  value(ROWS.last, 1, 'Last response');
  formula(ROWS.last, 2, `=IF(${total}=0,"-",MAXIFS(${col('Received at')},${notTest},${col('Result')},"<>"))`, DATE_TIME);

  // 2. Result
  title(ROWS.resultTitle, 'Result');
  const labels = pillars.map((pillar) => pillar.short || pillar.key);
  [...labels, 'Balanced'].forEach((label, i) => {
    const row = ROWS.resultFirst + i;
    value(row, 1, label);
    formula(row, 2, `=COUNTIFS(${col('Result')},"${label}",${notTest})`);
    formula(row, 3, share(`B${row}`), PERCENT);
  });

  // 3. Priority
  title(ROWS.priorityTitle, 'Priority');
  labels.forEach((label, i) => {
    const row = ROWS.priorityFirst + i;
    value(row, 1, label);
    formula(row, 2, `=COUNTIFS(${col('Priority')},"${label}",${notTest})`);
    formula(row, 3, share(`B${row}`), PERCENT);
  });
  value(ROWS.focused, 1, 'Responses with a focus (not balanced)');
  formula(ROWS.focused, 2, `=COUNTIFS(${col('Result')},"<>",${col('Result')},"<>Balanced",${notTest})`);
  value(ROWS.differs, 1, 'Priority differs from the result');
  formula(ROWS.differs, 2, `=SUMPRODUCT((${col('Source')}<>"test")*(${col('Result')}<>"")*(${col('Result')}<>"Balanced")*(${col('Priority')}<>${col('Result')}))`);
  formula(ROWS.differs, 3, `=IF($B$${ROWS.focused}=0,0,B${ROWS.differs}/$B$${ROWS.focused})`, PERCENT);

  // 4. Average by pillar
  title(ROWS.averageTitle, 'Average by pillar');
  const averageHeaders = ['Foundation avg', 'Professional avg', 'Visibility avg'];
  labels.forEach((label, i) => {
    const row = ROWS.averageFirst + i;
    value(row, 1, label);
    formula(row, 2, `=IFERROR(AVERAGEIFS(${col(averageHeaders[i])},${notTest}),"-")`, TWO_DECIMALS);
  });

  // 5. Average by question, lowest first: the helper block in H to K holds the unsorted
  // rows, the visible block sorts them by the average.
  title(ROWS.questionsTitle, 'Average by question, lowest first');
  ['Question', 'Pillar', 'Average', 'Answers 1 to 4'].forEach((header, i) => value(ROWS.questionsHeader, i + 1, header));
  bold.push({ row: ROWS.questionsHeader, column: 1, rows: 1, columns: SUMMARY_COLUMNS });
  const h = HELPER_FIRST_COLUMN;
  value(ROWS.questionsHeader, h, 'Helper rows for the sorted table on the left (hidden, do not edit)');
  items.forEach((item, i) => {
    const row = ROWS.questionsFirst + i;
    value(row, h, item.title);
    value(row, h + 1, item.pillarShort);
    formula(row, h + 2, `=IFERROR(AVERAGEIFS(${col(item.code)},${notTest}),"-")`, TWO_DECIMALS);
    formula(row, h + 3, `=IF(${total}=0,"-",COUNTIFS(${col(item.code)},"<=4",${notTest})/${total})`, PERCENT);
  });
  const helperRange = `$${columnLetter(h)}$${ROWS.questionsFirst}:$${columnLetter(h + 3)}$${ROWS.questionsFirst + items.length - 1}`;
  formula(ROWS.questionsFirst, 1, `=SORT(${helperRange},3,TRUE)`);
  formats.push({ row: ROWS.questionsFirst, column: 3, rows: items.length, columns: 1, format: TWO_DECIMALS });
  formats.push({ row: ROWS.questionsFirst, column: 4, rows: items.length, columns: 1, format: PERCENT });

  // 6. By source
  title(ROWS.sourceTitle, 'By source');
  ['Source', 'Responses', 'Subscribed', 'Subscribed share'].forEach((header, i) => value(ROWS.sourceHeader, i + 1, header));
  bold.push({ row: ROWS.sourceHeader, column: 1, rows: 1, columns: SUMMARY_COLUMNS });
  formula(ROWS.sourceFirst, 1,
    `=IFERROR(QUERY({${col('Source')},ARRAYFORMULA(IF(${col('Newsletter consent')}="Yes",1,0))},"select Col1, count(Col1), sum(Col2) where Col1 <> 'test' and Col1 <> '' group by Col1 order by count(Col1) desc label count(Col1) '', sum(Col2) ''",0),"-")`);
  for (let i = 0; i < SOURCE_ROWS; i += 1) {
    const row = ROWS.sourceFirst + i;
    formula(row, 4, `=IF(OR(B${row}="",NOT(ISNUMBER(B${row}))),"",IF(B${row}=0,0,C${row}/B${row}))`, PERCENT);
  }

  return {
    cells,
    formulas,
    formats,
    bold,
    hiddenColumns: { start: HELPER_FIRST_COLUMN, count: 4 },
    columnWidths: COLUMN_WIDTHS.map((width, i) => ({ column: i + 1, width })),
    merges: [{ row: ROWS.note, column: 1, rows: 1, columns: SUMMARY_COLUMNS, wrap: true }],
    rows: ROWS.sourceFirst + SOURCE_ROWS - 1,
    columns: HELPER_FIRST_COLUMN + 3,
  };
}

// Question rows from the content (names) or from the answer codes alone.
function questionItems(content) {
  const codes = HEADERS.slice(HEADERS.indexOf('F1'), HEADERS.indexOf('V4') + 1);
  if (!content || !Array.isArray(content.pillars)) {
    return codes.map((code) => ({ pillarShort: code.charAt(0), title: code, code }));
  }
  const items = [];
  content.pillars.forEach((pillar) => {
    (pillar.items || []).forEach((item, i) => {
      const code = `${pillar.key}${i + 1}`;
      items.push({ pillarShort: pillar.short || pillar.key, title: item.title || code, code });
    });
  });
  return items.length === codes.length ? items : codes.map((code) => ({ pillarShort: code.charAt(0), title: code, code }));
}

function pillarLabels(content) {
  if (!content || !Array.isArray(content.pillars) || content.pillars.length !== 3) {
    return [{ key: 'F' }, { key: 'P' }, { key: 'V' }];
  }
  return content.pillars.map((pillar) => ({ key: pillar.key, short: pillar.short }));
}

// ---- backend/src/email.js ----
// The email with the result: subject, plain text and HTML, built only from content.json and
// the checked fields of the submission. Pure functions. Table layout with inline styles so
// it survives Gmail, Apple Mail and Outlook (a conditional 600 px table for Outlook's Word
// engine, which ignores max-width); colours are solid (email clients ignore transparency),
// fonts are Georgia and Arial (web fonts are unreliable in email).



const EMAIL_WIDTH = 600;

const RGB = {
  aubergine: [94, 26, 77],
  porcelain: [250, 248, 245],
  champagne: [239, 220, 172],
};
const EMAIL_COLOURS = {
  aubergine: '#5E1A4D',
  navy: '#1E2A47',
  porcelain: '#FAF8F5',
  gold: '#B89B5E',
  warmGrey: '#E4E2DD',
  muted: '#545B70',
  onAubergine: '#F3E9EF',
  white: '#FFFFFF',
};

// Same numbers as TILE_HEIGHTS in src/app/mosaic.js; a test keeps them equal.
const EMAIL_TILE_HEIGHTS = { F: [62, 46, 54, 50], P: [48, 60, 46, 58], V: [56, 50, 62, 44] };
const TILE_GAP = 6;

const HEADING_FONT = "Georgia, 'Times New Roman', serif";
const TEXT_FONT = 'Arial, Helvetica, sans-serif';

// Same formula as tileAlpha in src/app/mosaic.js; a test keeps them equal.
function emailTileAlpha(score) {
  return 0.12 + (0.88 * (score - 1)) / 9;
}

function toHex(channel) {
  const value = Math.max(0, Math.min(255, Math.round(channel)));
  return (value < 16 ? '0' : '') + value.toString(16).toUpperCase();
}

// The colour of `rgb` drawn with opacity `alpha` over `base`, as a solid hex colour.
function blend(rgb, base, alpha) {
  return '#' + rgb.map((channel, i) => toHex(base[i] + (channel - base[i]) * alpha)).join('');
}

function tileHex(score) {
  return blend(RGB.aubergine, RGB.porcelain, emailTileAlpha(score));
}

const NOTE_BACKGROUND = blend(RGB.champagne, RGB.porcelain, 0.5);

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Adds query parameters to a link without the URL class (not available in Apps Script).
function withParams(base, params) {
  const pairs = Object.keys(params).map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`);
  if (!pairs.length) return base;
  const hashAt = base.indexOf('#');
  const link = hashAt >= 0 ? base.slice(0, hashAt) : base;
  const hash = hashAt >= 0 ? base.slice(hashAt) : '';
  return link + (link.indexOf('?') >= 0 ? '&' : '?') + pairs.join('&') + hash;
}

function emailCalendlyLink(base, src, resultKey) {
  return withParams(base, {
    utm_source: 'mosaic-snapshot',
    utm_medium: 'email',
    utm_campaign: src || 'direct',
    utm_content: resultKey,
  });
}

function pillarInText(content, key) {
  const pillar = content.pillars.filter((candidate) => candidate.key === key)[0];
  return pillar ? pillar.in_text : '';
}

function pillarShort(content, key) {
  if (key === 'balanced') return 'Balanced';
  const pillar = content.pillars.filter((candidate) => candidate.key === key)[0];
  return pillar ? pillar.short : key;
}

// Everything the two renderers share, in the order of the email.
function emailParts(content, submission, evaluation) {
  const e = content.email;
  const r = content.result;
  const key = evaluation.result;
  const texts = content.results[key];
  const kind = growLineKind(key, submission.grow);
  const growLine = kind
    ? fillTemplate(kind === 'match' ? r.grow_match : r.grow_mismatch, {
      grow: pillarInText(content, submission.grow),
      focus: pillarInText(content, key),
    })
    : '';
  const sections = [
    { label: r.section_labels.what_it_means, paragraphs: [texts.what_it_means] },
    key === 'balanced'
      ? { label: r.section_labels.whats_next, paragraphs: texts.whats_next }
      : { label: r.section_labels.how_it_affects, paragraphs: texts.how_it_affects },
  ];
  return {
    key,
    texts,
    subject: fillTemplate(e.subject, { name: submission.name }),
    preheader: e.preheader,
    wordmark: content.intro.wordmark,
    greeting: fillTemplate(e.greeting, { name: submission.name }),
    intro: e.intro,
    scoresTitle: e.scores_title,
    focusLabel: r.focus_label,
    scoreSuffix: r.score_suffix,
    columns: content.pillars.map((pillar) => ({
      key: pillar.key,
      short: pillar.short,
      average: formatAverage(evaluation.averages[pillar.key]),
      scores: evaluation.grouped[pillar.key],
      isFocus: evaluation.focus === pillar.key,
    })),
    headline: texts.headline,
    growLine,
    sections,
    stepsLabel: r.section_labels.first_steps,
    steps: texts.steps,
    ctaQuestion: texts.cta_question,
    ctaButton: r.cta_button,
    ctaNote: r.cta_note,
    link: emailCalendlyLink(content.links.calendly, submission.src, key),
    closing: e.closing,
    signatureName: r.signature_name,
    signatureTitle: r.signature_title,
    mainSite: content.links.main_site,
    legalLine: r.legal_line,
    whyLine: e.why_line,
  };
}

function renderText(content, submission, evaluation) {
  const p = emailParts(content, submission, evaluation);
  const lines = [p.preheader, p.wordmark, '', p.greeting, p.intro, '', p.scoresTitle];
  const focus = p.columns.filter((column) => column.isFocus)[0];
  if (focus) lines.push(`${p.focusLabel}: ${focus.short}`);
  p.columns.forEach((column) => lines.push(`${column.short}: ${column.average} ${p.scoreSuffix}`));
  lines.push('', p.headline);
  if (p.growLine) lines.push(p.growLine);
  p.sections.forEach((section) => {
    lines.push('', section.label);
    section.paragraphs.forEach((paragraph) => lines.push(paragraph));
  });
  lines.push('', p.stepsLabel);
  p.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  lines.push('', p.ctaQuestion, `${p.ctaButton}: ${p.link}`, p.ctaNote);
  lines.push('', p.closing, p.signatureName, p.signatureTitle, p.mainSite);
  lines.push('', p.legalLine, p.whyLine);
  return lines.join('\n');
}

const TEXT_STYLE = `font-family:${TEXT_FONT};font-size:16px;line-height:24px;color:${EMAIL_COLOURS.navy};`;
const SMALL_STYLE = `font-family:${TEXT_FONT};font-size:12px;line-height:18px;color:${EMAIL_COLOURS.muted};`;
const LABEL_STYLE = `font-family:${TEXT_FONT};font-size:12px;line-height:18px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${EMAIL_COLOURS.aubergine};`;

function cell(style, inner, attrs) {
  return `<td${attrs ? ` ${attrs}` : ''} style="${style}">${inner}</td>`;
}

function row(style, inner, attrs) {
  return `<tr>${cell(style, inner, attrs)}</tr>`;
}

function spacer(height) {
  return `<tr><td height="${height}" style="height:${height}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
}

function mosaicColumn(column, parts, showLabels) {
  const rows = [];
  if (showLabels) {
    const label = column.isFocus ? escapeHtml(parts.focusLabel) : '&nbsp;';
    rows.push(`<tr><td height="18" style="height:18px;font-family:${TEXT_FONT};font-size:11px;line-height:18px;font-weight:bold;letter-spacing:1px;color:${EMAIL_COLOURS.gold};">${label}</td></tr>`);
    rows.push(spacer(4));
  }
  column.scores.forEach((score, i) => {
    const height = EMAIL_TILE_HEIGHTS[column.key][i];
    const colour = tileHex(score);
    if (i > 0) rows.push(spacer(TILE_GAP));
    rows.push(`<tr><td height="${height}" bgcolor="${colour}" style="height:${height}px;background-color:${colour};border-radius:6px;font-size:0;line-height:0;">&nbsp;</td></tr>`);
  });
  rows.push(spacer(8));
  rows.push(row(`font-family:${TEXT_FONT};font-size:12px;line-height:18px;font-weight:bold;color:${EMAIL_COLOURS.navy};`, escapeHtml(column.short)));
  rows.push(row(`font-family:${HEADING_FONT};font-size:20px;line-height:26px;color:${EMAIL_COLOURS.aubergine};`,
    `${escapeHtml(column.average)} <span style="font-family:${TEXT_FONT};font-size:12px;color:${EMAIL_COLOURS.muted};">${escapeHtml(parts.scoreSuffix)}</span>`));
  return `<td width="33%" valign="top" style="padding:0 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table></td>`;
}

function sectionHtml(section) {
  const paragraphs = section.paragraphs
    .map((paragraph, i) => row(`${TEXT_STYLE}padding:${i ? 8 : 4}px 0 0;`, escapeHtml(paragraph)))
    .join('');
  return `<tr><td style="padding:20px 0 0;border-top:1px solid ${EMAIL_COLOURS.warmGrey};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${row(LABEL_STYLE, escapeHtml(section.label))}${paragraphs}</table></td></tr>`;
}

function renderHtml(content, submission, evaluation) {
  const p = emailParts(content, submission, evaluation);
  const showLabels = p.columns.some((column) => column.isFocus);
  const body = [];
  body.push(row(`font-family:${HEADING_FONT};font-size:12px;line-height:18px;letter-spacing:2px;color:${EMAIL_COLOURS.aubergine};padding:0 0 24px;`, escapeHtml(p.wordmark)));
  body.push(row(`${TEXT_STYLE}padding:0 0 8px;`, escapeHtml(p.greeting)));
  body.push(row(`${TEXT_STYLE}padding:0 0 24px;`, escapeHtml(p.intro)));
  body.push(row(`font-family:${HEADING_FONT};font-size:20px;line-height:26px;color:${EMAIL_COLOURS.navy};padding:0 0 12px;`, escapeHtml(p.scoresTitle)));
  body.push(`<tr><td style="padding:0 0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${p.columns.map((column) => mosaicColumn(column, p, showLabels)).join('')}</tr></table></td></tr>`);
  body.push(row(`font-family:${HEADING_FONT};font-size:24px;line-height:30px;color:${EMAIL_COLOURS.navy};padding:0 0 16px;`, escapeHtml(p.headline)));
  if (p.growLine) {
    body.push(`<tr><td style="padding:0 0 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${NOTE_BACKGROUND}" style="background-color:${NOTE_BACKGROUND};border-radius:10px;padding:14px 16px;font-family:${TEXT_FONT};font-size:15px;line-height:22px;color:${EMAIL_COLOURS.navy};">${escapeHtml(p.growLine)}</td></tr></table></td></tr>`);
  }
  p.sections.forEach((section) => body.push(sectionHtml(section)));
  const steps = p.steps.map((step) => `<li style="${TEXT_STYLE}padding:0 0 8px 4px;">${escapeHtml(step)}</li>`).join('');
  body.push(`<tr><td style="padding:20px 0 0;border-top:1px solid ${EMAIL_COLOURS.warmGrey};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${row(LABEL_STYLE, escapeHtml(p.stepsLabel))}<tr><td style="padding:4px 0 0;"><ol style="margin:0;padding:0 0 0 22px;">${steps}</ol></td></tr></table></td></tr>`);
  body.push(`<tr><td style="padding:28px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_COLOURS.aubergine}" style="background-color:${EMAIL_COLOURS.aubergine};border-radius:12px;"><tr><td style="padding:24px;">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`
    + row(`font-family:${HEADING_FONT};font-size:20px;line-height:26px;color:${EMAIL_COLOURS.white};padding:0 0 16px;`, escapeHtml(p.ctaQuestion))
    + `<tr><td style="padding:0 0 12px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${EMAIL_COLOURS.gold}" style="background-color:${EMAIL_COLOURS.gold};border-radius:10px;padding:16px 28px;"><a href="${escapeHtml(p.link)}" style="display:inline-block;font-family:${TEXT_FONT};font-size:16px;font-weight:bold;color:${EMAIL_COLOURS.navy};text-decoration:none;">${escapeHtml(p.ctaButton)}</a></td></tr></table></td></tr>`
    + row(`font-family:${TEXT_FONT};font-size:13px;line-height:18px;color:${EMAIL_COLOURS.onAubergine};`, escapeHtml(p.ctaNote))
    + `</table></td></tr></table></td></tr>`);
  body.push(row(`${TEXT_STYLE}padding:28px 0 4px;`, escapeHtml(p.closing)));
  body.push(row(`${TEXT_STYLE}font-weight:bold;`, `<a href="${escapeHtml(p.mainSite)}" style="color:${EMAIL_COLOURS.navy};text-decoration:underline;">${escapeHtml(p.signatureName)}</a>`));
  body.push(row(`font-family:${TEXT_FONT};font-size:13px;line-height:20px;color:${EMAIL_COLOURS.muted};`, escapeHtml(p.signatureTitle)));
  body.push(row(`${SMALL_STYLE}padding:24px 0 0;border-top:1px solid ${EMAIL_COLOURS.warmGrey};`, escapeHtml(p.legalLine)));
  body.push(row(`${SMALL_STYLE}padding:4px 0 0;`, escapeHtml(p.whyLine)));

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(p.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLOURS.porcelain};">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${EMAIL_COLOURS.porcelain};mso-hide:all;">${escapeHtml(p.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_COLOURS.porcelain}" style="background-color:${EMAIL_COLOURS.porcelain};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${EMAIL_WIDTH}px;">
${body.join('\n')}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}

function renderEmail(content, submission, evaluation) {
  const subject = fillTemplate(content.email.subject, { name: submission.name });
  return {
    subject,
    text: renderText(content, submission, evaluation),
    html: renderHtml(content, submission, evaluation),
  };
}

// The plain-text alert to Julia about one new response.
function renderNotification(content, submission, evaluation) {
  const resultName = pillarShort(content, evaluation.result);
  const subject = fillTemplate(content.email.notify_subject, { name: submission.name, result: resultName });
  const lines = [
    `Name: ${submission.name}`,
    `Email: ${submission.email}`,
    `Result: ${resultName}`,
    `Priority: ${pillarShort(content, submission.grow)}`,
  ];
  content.pillars.forEach((pillar) => lines.push(`${pillar.short}: ${formatAverage(evaluation.averages[pillar.key])} ${content.result.score_suffix}`));
  lines.push(`Newsletter consent: ${submission.consent ? 'Yes' : 'No'}`);
  lines.push(`Source: ${submission.src || 'direct'}`);
  return { subject, text: lines.join('\n') };
}

// ---- backend/src/brevo.js ----
// Request bodies for the Brevo API and small helpers to read its answers. Pure functions;
// the HTTP call itself lives in entry.js.

const BREVO_BASE = 'https://api.brevo.com/v3';
const CONTACT_VARIANTS = ['full', 'name-only', 'bare'];

function brevoTags(resultKey, src) {
  return ['mosaic-snapshot', resultKey, src || 'direct'];
}

// POST /v3/smtp/email
function emailRequest({ senderName, senderEmail, replyTo, toEmail, toName, subject, html, text, tags }) {
  const body = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: toEmail, name: toName }],
    subject,
    htmlContent: html,
    textContent: text,
    tags,
  };
  if (replyTo) body.replyTo = { email: replyTo };
  return body;
}

// The plain-text alert to Julia about one new response.
function notificationRequest({ senderName, senderEmail, toEmail, subject, text }) {
  return {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: toEmail }],
    subject,
    textContent: text,
    tags: ['mosaic-snapshot', 'notification'],
  };
}

// POST /v3/contacts. variant: 'full' with every attribute, 'name-only' with FIRSTNAME,
// 'bare' without attributes (the fallbacks when Brevo rejects unknown attributes).
function contactRequest({ email, name, listId, result, grow, src, date, variant }) {
  const body = { email, updateEnabled: true, listIds: [Number(listId)] };
  if (variant === 'full') {
    body.attributes = {
      FIRSTNAME: name,
      SNAPSHOT_RESULT: result,
      SNAPSHOT_GROW: grow,
      SNAPSHOT_SRC: src || 'direct',
      SNAPSHOT_DATE: date,
    };
  } else if (variant === 'name-only') {
    body.attributes = { FIRSTNAME: name };
  }
  return body;
}

function isSuccess(code) {
  return code >= 200 && code < 300;
}

// Brevo answers 400 with a message that names the attribute it does not know.
function isAttributeError(code, text) {
  return code === 400 && /attribute/i.test(text || '');
}

// A short, safe excerpt of an error answer for the note column.
function errorNote(code, text) {
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  return `Brevo ${code}: ${body.slice(0, 200)}`;
}

// Brevo reports the state of transactional sending as relay.enabled in GET /v3/account.
// true or false when the field is there, null when it is not.
function relayEnabled(json) {
  if (!json || typeof json !== 'object' || !json.relay || typeof json.relay !== 'object') return null;
  return json.relay.enabled === true;
}

// One line about GET /v3/account for checkSetup.
function describeAccount(json) {
  if (!json || typeof json !== 'object') return 'account: no readable answer';
  const plans = Array.isArray(json.plan) ? json.plan : [];
  const planText = plans.length
    ? plans.map((plan) => `${plan.type || '?'}${plan.credits !== undefined ? ` (${plan.credits} ${plan.creditsType || 'credits'})` : ''}`).join(', ')
    : 'unknown';
  const relay = relayEnabled(json);
  const relayText = relay === null
    ? 'transactional sending (relay): not in the answer, the support ticket decides'
    : `transactional sending (relay): ${relay ? 'enabled' : 'NOT enabled'}`;
  return `account: ${json.email || json.companyName || 'ok'}; plan ${planText}; ${relayText}`;
}

function describeSenders(json) {
  const senders = json && Array.isArray(json.senders) ? json.senders : [];
  if (!senders.length) return 'senders: none';
  return `senders: ${senders.map((sender) => `${sender.name || ''} <${sender.email}> ${sender.active ? 'active' : 'not active'}`).join('; ')}`;
}

function describeLists(json, wantedId) {
  const lists = json && Array.isArray(json.lists) ? json.lists : [];
  const found = lists.some((list) => String(list.id) === String(wantedId));
  const names = lists.map((list) => `#${list.id} ${list.name}${list.totalSubscribers !== undefined ? ` (${list.totalSubscribers})` : ''}`).join('; ');
  return { line: `lists: ${names || 'none'}; NEWSLETTER_LIST_ID ${wantedId || 'not set'} ${found ? 'found' : 'NOT found'}`, found };
}

const WANTED_ATTRIBUTES = ['FIRSTNAME', 'SNAPSHOT_RESULT', 'SNAPSHOT_GROW', 'SNAPSHOT_SRC', 'SNAPSHOT_DATE'];

function describeAttributes(json) {
  const names = json && Array.isArray(json.attributes) ? json.attributes.map((attribute) => String(attribute.name).toUpperCase()) : [];
  const missing = WANTED_ATTRIBUTES.filter((name) => names.indexOf(name) < 0);
  return { line: `attributes: ${missing.length ? `missing ${missing.join(', ')}` : 'all present'}`, missing };
}

// ---- backend/src/entry.js ----
// Google Apps Script entry points (doPost, doGet, setup, checkSetup, testSubmission) and the
// plumbing around the pure modules. Everything that touches an Apps Script service lives in
// realServices(); processSubmission() takes any services object, so the tests run it with fakes.
// Runs on the Apps Script V8 runtime: no optional chaining, no URL class, no Node.










const CONTENT_CACHE_SECONDS = 600;
const LOCK_WAIT_MS = 20000;
const CONTENT_CACHE_KEY = 'content.json';

// The same answers as the sample result on the first screen.
const SAMPLE_ANSWERS = { F1: 4, F2: 3, F3: 5, F4: 4, P1: 7, P2: 6, P3: 8, P4: 7, V1: 6, V2: 5, V3: 7, V4: 6 };

// Used when content.json cannot be read: the agreed logic and the pillar keys, no texts.
const FALLBACK_CONTENT = {
  logic: { balanced_gap: 3, tie_order: ['F', 'P', 'V'] },
  pillars: [
    { key: 'F', items: [{}, {}, {}, {}] },
    { key: 'P', items: [{}, {}, {}, {}] },
    { key: 'V', items: [{}, {}, {}, {}] },
  ],
};

const STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  SKIPPED: 'skipped',
  FAILED: 'failed',
  RATE_LIMITED: 'rate-limited',
  REJECTED: 'rejected',
  ADDED: 'added',
  ADDED_NO_ATTRIBUTES: 'added-no-attributes',
  NO_CONSENT: 'no-consent',
};

const REQUIRED_PROPERTIES = ['BREVO_API_KEY', 'BREVO_ENABLED', 'SENDER_NAME', 'SENDER_EMAIL', 'NEWSLETTER_LIST_ID', 'CONTENT_URL'];
const OPTIONAL_PROPERTIES = ['REPLY_TO', 'TEST_EMAIL', 'NOTIFY_EMAIL', 'SHEET_ID'];

function brevoEnabled(config) {
  return String(config.BREVO_ENABLED || '').toLowerCase() === 'true';
}

function isTestAddress(config, email) {
  return Boolean(config.TEST_EMAIL) && String(email).toLowerCase() === String(config.TEST_EMAIL).toLowerCase();
}

// One submission from start to end. services: see realServices() below and the fakes in the tests.
// Returns { rowIndex, emailStatus, contactStatus, note, evaluation }.
function processSubmission(submission, rejected, services, options) {
  const config = services.config;
  const now = services.now();
  const loaded = services.loadContent();
  const content = loaded.content;
  const base = content || FALLBACK_CONTENT;
  const pillars = content ? content.pillars : [];
  const evaluation = evaluate(submission.answers, base);
  const notes = [];
  if (options && options.note) notes.push(options.note);
  if (loaded.error) notes.push(`content: ${loaded.error}`);
  if (submission.clientResult && submission.clientResult !== evaluation.result) {
    notes.push(`client result ${submission.clientResult}, server ${evaluation.result}`);
  }

  const enabled = brevoEnabled(config);
  const wantsNotify = Boolean(config.NOTIFY_EMAIL);
  const needed = 1 + (wantsNotify ? 1 : 0);
  let emailStatus;
  let contactStatus;
  if (rejected) {
    emailStatus = STATUS.REJECTED;
    contactStatus = STATUS.SKIPPED;
    notes.push('name looks like spam');
  } else if (!enabled) {
    emailStatus = STATUS.SKIPPED;
    contactStatus = STATUS.SKIPPED;
  } else {
    emailStatus = STATUS.PENDING;
    contactStatus = submission.consent ? STATUS.PENDING : STATUS.NO_CONSENT;
  }

  const recordFor = () => buildRecord({
    receivedAt: now,
    submission,
    evaluation,
    pillars,
    emailStatus,
    contactStatus,
    note: notes.join('; '),
    consentLabel: content && content.email_step ? content.email_step.consent_label : '',
  });

  // Counters and the first write of the row happen under the lock, so two requests
  // at the same moment cannot both pass the limits or mix up row numbers.
  let rowInfo;
  try {
    rowInfo = services.withLock(() => {
      if (emailStatus === STATUS.PENDING) {
        const keys = counterKeys(services.hash(submission.email.toLowerCase()), now);
      const counters = services.counters.getAll();
      const lastSentAt = services.cache.get(keys.last);
      const decision = decideSending({
        now,
        lastSentAt: lastSentAt ? Number(lastSentAt) : null,
        emailDayCount: Number(counters[keys.emailDay] || 0),
        hourCount: Number(counters[keys.hour] || 0),
        dayCount: Number(counters[keys.day] || 0),
        needed,
        isTestEmail: isTestAddress(config, submission.email),
      });
        if (decision.allowed) {
          services.counters.set(keys.emailDay, Number(counters[keys.emailDay] || 0) + 1);
          services.counters.set(keys.hour, Number(counters[keys.hour] || 0) + needed);
          services.counters.set(keys.day, Number(counters[keys.day] || 0) + needed);
          services.cache.put(keys.last, String(now.getTime()), LIMITS.PER_EMAIL_MIN_SECONDS);
          const stale = staleCounterKeys(Object.keys(counters), now);
          if (stale.length) services.counters.remove(stale);
        } else {
          // The email is held back; the consent still counts, the contact is still added.
          emailStatus = STATUS.RATE_LIMITED;
          notes.push(`limit: ${decision.reason}`);
        }
      }
      return services.sheet.append(recordFor());
    });
  } catch (error) {
    // The lock did not come in time (another request held it for too long): keep the
    // response in the sheet, send nothing, say why.
    notes.push(`lock: ${error && error.message ? error.message : error}`);
    if (emailStatus === STATUS.PENDING) emailStatus = STATUS.FAILED;
    if (contactStatus === STATUS.PENDING) contactStatus = STATUS.SKIPPED;
    rowInfo = services.sheet.append(recordFor());
  }

  const allowed = emailStatus === STATUS.PENDING;

  try {
  if (emailStatus === STATUS.PENDING) {
    if (!content) {
      emailStatus = STATUS.FAILED;
      notes.push('no content');
    } else {
      const message = renderEmail(content, submission, evaluation);
      const body = emailRequest({
        senderName: config.SENDER_NAME,
        senderEmail: config.SENDER_EMAIL,
        replyTo: config.REPLY_TO || '',
        toEmail: submission.email,
        toName: submission.name,
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: brevoTags(evaluation.result, submission.src),
      });
      const response = services.brevo('post', '/smtp/email', body);
      if (isSuccess(response.code)) {
        emailStatus = STATUS.SENT;
      } else {
        emailStatus = STATUS.FAILED;
        notes.push(errorNote(response.code, response.text));
      }
    }
  }

  if (contactStatus === STATUS.PENDING) {
    let outcome = STATUS.FAILED;
    for (let i = 0; i < CONTACT_VARIANTS.length; i += 1) {
      const variant = CONTACT_VARIANTS[i];
      const body = contactRequest({
        email: submission.email,
        name: submission.name,
        listId: config.NEWSLETTER_LIST_ID,
        result: resultLabel(evaluation.result, pillars),
        grow: resultLabel(submission.grow, pillars),
        src: submission.src,
        date: services.dateString(now),
        variant,
      });
      const response = services.brevo('post', '/contacts', body);
      if (isSuccess(response.code)) {
        outcome = variant === 'full' ? STATUS.ADDED : STATUS.ADDED_NO_ATTRIBUTES;
        if (variant !== 'full') notes.push(`contact added without ${variant === 'name-only' ? 'the snapshot attributes' : 'attributes'}`);
        break;
      }
      if (!isAttributeError(response.code, response.text)) {
        notes.push(errorNote(response.code, response.text));
        break;
      }
      if (variant === CONTACT_VARIANTS[CONTACT_VARIANTS.length - 1]) notes.push(errorNote(response.code, response.text));
    }
    contactStatus = outcome;
  }

  if (wantsNotify && allowed && content) {
    const alert = renderNotification(content, submission, evaluation);
    const body = notificationRequest({
      senderName: config.SENDER_NAME,
      senderEmail: config.SENDER_EMAIL,
      toEmail: config.NOTIFY_EMAIL,
      subject: alert.subject,
      text: alert.text,
    });
    const response = services.brevo('post', '/smtp/email', body);
    if (!isSuccess(response.code)) notes.push(`notification: ${errorNote(response.code, response.text)}`);
  }
  } catch (error) {
    // Whatever broke after the row was written (a service threw), the row gets final statuses.
    if (emailStatus === STATUS.PENDING) emailStatus = STATUS.FAILED;
    if (contactStatus === STATUS.PENDING) contactStatus = STATUS.FAILED;
    notes.push(`error: ${error && error.message ? error.message : error}`);
  }

  const note = notes.join('; ');
  services.sheet.update(rowInfo, { 'Email status': emailStatus, 'Contact status': contactStatus, Note: note });
  return { rowIndex: rowInfo.rowIndex, emailStatus, contactStatus, note, evaluation };
}

// ---------- Apps Script plumbing ----------

function scriptProperties() {
  return PropertiesService.getScriptProperties();
}

function readConfig() {
  return scriptProperties().getProperties();
}

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function hexDigest(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map((byte) => ((byte + 256) % 256).toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function openSpreadsheet(config) {
  if (config.SHEET_ID) return SpreadsheetApp.openById(config.SHEET_ID);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('No spreadsheet: run setup() from the Apps Script editor first');
  return active;
}

function getOrCreateSheet(spreadsheet) {
  return spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
}

// The header row as it is in the sheet; written when the first row is empty. An old header
// name (Wants to grow) is renamed in place, once; the values below it stay.
function ensureHeaders(sheet) {
  const lastColumn = sheet.getLastColumn();
  const row = lastColumn ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
  if (row.every((value) => value === '')) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return HEADERS.slice();
  }
  const headerRow = row.map((value) => String(value));
  headerRenames(headerRow).forEach((rename) => {
    sheet.getRange(1, rename.column).setValue(rename.to);
    headerRow[rename.column - 1] = rename.to;
  });
  return headerRow;
}

// Everything setup() does, with the spreadsheet and the properties passed in, so the tests
// run it on a fake. Returns the log lines.
const SETUP_ERROR_PREFIX = 'setup: ERROR';

// flush: SpreadsheetApp.flush in Apps Script, so that the probe formula is evaluated before
// its value is read; the tests pass a no-op.
function runSetup({ spreadsheet, props, loaded, flush = () => {} }) {
  const lines = [];
  props.setProperty('SHEET_ID', spreadsheet.getId());
  const responses = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  const before = responses.getLastColumn() ? responses.getRange(1, 1, 1, responses.getLastColumn()).getValues()[0].map((value) => String(value)) : [];
  const renames = headerRenames(before);
  const headerRow = ensureHeaders(responses);
  responses.setFrozenRows(1);
  AVERAGE_HEADER_NAMES.forEach((header) => {
    const column = columnOf(headerRow, header);
    if (column && responses.getMaxRows() > 1) responses.getRange(2, column, responses.getMaxRows() - 1, 1).setNumberFormat('0.00');
  });
  const missing = missingHeaders(headerRow);
  lines.push(`setup: spreadsheet "${spreadsheet.getName()}", sheet "${SHEET_NAME}", ${headerRow.length} columns${renames.length ? `, renamed ${renames.map((r) => `${r.from} to ${r.to}`).join(', ')}` : ''}${missing.length ? `, missing headers: ${missing.join(', ')}` : ''}, SHEET_ID saved`);

  const content = loaded ? loaded.content : null;
  const layout = summaryLayout({
    pillars: pillarLabels(content),
    items: questionItems(content),
    lastColumn: columnLetter(Math.max(responses.getMaxColumns(), HEADERS.length)),
  });
  let summary = spreadsheet.getSheetByName(SUMMARY_SHEET_NAME);
  if (!summary) summary = spreadsheet.insertSheet(SUMMARY_SHEET_NAME);
  summary.clear();
  // The spreadsheet parses setFormula() in its own locale: a probe on the empty sheet tells
  // whether arguments are separated by "," or ";" before any formula is written.
  const separator = detectSeparator(summary.getRange(1, 1), flush);
  if (!separator) {
    lines.push(`${SETUP_ERROR_PREFIX}: cannot tell the argument separator of this spreadsheet: neither ${probeFormula(',')} nor ${probeFormula(';')} evaluates to 3. The "${SUMMARY_SHEET_NAME}" sheet was not built; check File > Settings > Locale and run setup again.`);
    return lines;
  }
  lines.push(`setup: argument separator "${separator}" (the locale of the spreadsheet)${separator === ';' ? ', formulas translated from the US syntax' : ''}`);
  const grid = [];
  for (let r = 0; r < layout.rows; r += 1) grid.push(new Array(layout.columns).fill(''));
  layout.cells.forEach((cell) => {
    grid[cell.row - 1][cell.column - 1] = cell.value;
  });
  summary.getRange(1, 1, layout.rows, layout.columns).setValues(grid);
  layout.formulas.forEach((cell) => summary.getRange(cell.row, cell.column).setFormula(localizeFormula(cell.formula, separator)));
  layout.formats.forEach((format) => summary.getRange(format.row, format.column, format.rows, format.columns).setNumberFormat(format.format));
  layout.bold.forEach((range) => summary.getRange(range.row, range.column, range.rows, range.columns).setFontWeight('bold'));
  summary.hideColumns(layout.hiddenColumns.start, layout.hiddenColumns.count);
  layout.columnWidths.forEach((item) => summary.setColumnWidth(item.column, item.width));
  layout.merges.forEach((area) => {
    const range = summary.getRange(area.row, area.column, area.rows, area.columns);
    range.breakApart();
    range.merge();
    range.setWrap(Boolean(area.wrap));
    range.setVerticalAlignment('top');
  });
  spreadsheet.setActiveSheet(summary);
  spreadsheet.moveActiveSheet(1);
  const names = content ? 'question names from the content' : `question codes F1 to V4 (content not read${loaded && loaded.error ? `: ${loaded.error}` : ''}); run setup again when CONTENT_URL works`;
  lines.push(`setup: sheet "${SUMMARY_SHEET_NAME}" rebuilt as the first tab with ${layout.formulas.length} formulas, ${names}`);
  return lines;
}

function sheetService(config) {
  let sheet = null;
  let headerRow = null;
  const ensure = () => {
    if (!sheet) {
      sheet = getOrCreateSheet(openSpreadsheet(config));
      headerRow = ensureHeaders(sheet);
    }
  };
  return {
    append(record) {
      ensure();
      sheet.appendRow(rowValues(headerRow, record));
      return { rowIndex: sheet.getLastRow(), headerRow };
    },
    update(rowInfo, fields) {
      ensure();
      Object.keys(fields).forEach((header) => {
        const column = columnOf(rowInfo.headerRow, header);
        if (column) sheet.getRange(rowInfo.rowIndex, column).setValue(safeCell(fields[header]));
      });
    },
  };
}

function loadContentFromUrl(config) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CONTENT_CACHE_KEY);
  if (cached) {
    try {
      return { content: JSON.parse(cached), error: '' };
    } catch (error) {
      cache.remove(CONTENT_CACHE_KEY);
    }
  }
  if (!config.CONTENT_URL) return { content: null, error: 'CONTENT_URL is not set' };
  try {
    const response = UrlFetchApp.fetch(config.CONTENT_URL, { muteHttpExceptions: true });
    const code = response.getResponseCode();
    if (code !== 200) return { content: null, error: `content.json answered ${code}` };
    const text = response.getContentText();
    const content = JSON.parse(text);
    cache.put(CONTENT_CACHE_KEY, text, CONTENT_CACHE_SECONDS);
    return { content, error: '' };
  } catch (error) {
    return { content: null, error: `content.json: ${error.message}` };
  }
}

function brevoCall(config, method, path, body) {
  const options = {
    method,
    muteHttpExceptions: true,
    headers: { 'api-key': config.BREVO_API_KEY || '', accept: 'application/json' },
  };
  if (body) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  // muteHttpExceptions covers HTTP errors; DNS, timeout and SSL failures throw, so they
  // are turned into an answer with code 0 and the error text.
  let response;
  try {
    response = UrlFetchApp.fetch(BREVO_BASE + path, options);
  } catch (error) {
    return { code: 0, text: `request failed: ${error && error.message ? error.message : error}`, json: null };
  }
  const code = response.getResponseCode();
  const text = response.getContentText();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    json = null;
  }
  return { code, text, json };
}

function realServices(config) {
  const props = scriptProperties();
  return {
    config,
    now: () => new Date(),
    log: (message) => console.log(message),
    loadContent: () => loadContentFromUrl(config),
    withLock: (fn) => {
      const lock = LockService.getScriptLock();
      lock.waitLock(LOCK_WAIT_MS);
      try {
        return fn();
      } finally {
        lock.releaseLock();
      }
    },
    hash: hexDigest,
    cache: {
      get: (key) => CacheService.getScriptCache().get(key),
      put: (key, value, seconds) => CacheService.getScriptCache().put(key, value, seconds),
    },
    counters: {
      getAll: () => props.getProperties(),
      set: (key, value) => props.setProperty(key, String(value)),
      remove: (keys) => keys.forEach((key) => props.deleteProperty(key)),
    },
    sheet: sheetService(config),
    brevo: (method, path, body) => brevoCall(config, method, path, body),
    dateString: (date) => Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
  };
}

// ---------- entry points ----------

function doPost(e) {
  const raw = e && e.postData ? e.postData.contents : '';
  const parsed = parseSubmission(raw);
  if (!parsed.ok) {
    console.log(`invalid submission: ${parsed.errors.join('; ')}`);
    return jsonOutput({ ok: false });
  }
  try {
    const outcome = processSubmission(parsed.submission, parsed.rejected, realServices(readConfig()));
    console.log(`row ${outcome.rowIndex}: email ${outcome.emailStatus}, contact ${outcome.contactStatus}${outcome.note ? `, ${outcome.note}` : ''}`);
  } catch (error) {
    console.log(`processing failed: ${error && error.stack ? error.stack : error}`);
  }
  return jsonOutput({ ok: true });
}

function doGet() {
  return ContentService.createTextOutput('Mosaic Snapshot endpoint');
}

// Creates the Responses sheet with its headers (renaming old ones in place), freezes the
// header row, remembers the spreadsheet in SHEET_ID and rebuilds the Summary sheet as the
// first tab. Safe to run again; run it again after the question texts change.
function setup() {
  const props = scriptProperties();
  const config = props.getProperties();
  let spreadsheet = null;
  if (config.SHEET_ID) {
    try {
      spreadsheet = SpreadsheetApp.openById(config.SHEET_ID);
    } catch (error) {
      spreadsheet = null;
    }
  }
  if (!spreadsheet) spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    console.log('setup: no spreadsheet. Open the script from the sheet (Extensions > Apps Script) or set SHEET_ID.');
    return;
  }
  const lines = runSetup({ spreadsheet, props, loaded: loadContentFromUrl(config), flush: () => SpreadsheetApp.flush() });
  lines.forEach((line) => console.log(line));
  const failure = lines.find((line) => line.indexOf(SETUP_ERROR_PREFIX) === 0);
  if (failure) throw new Error(failure);
}

function maskKey(value) {
  const text = String(value || '');
  return text ? `${text.slice(0, 4)}... (${text.length} characters)` : 'missing';
}

// Reads every setting and asks Brevo (read-only) whether the account, sender, list and
// attributes are in place. One line per check, the last line says what is still missing.
function checkSetup() {
  const config = readConfig();
  const missing = [];
  REQUIRED_PROPERTIES.forEach((name) => {
    const value = config[name];
    if (!value) missing.push(`property ${name}`);
    console.log(`property ${name}: ${name === 'BREVO_API_KEY' ? maskKey(value) : (value || 'missing')}`);
  });
  OPTIONAL_PROPERTIES.forEach((name) => {
    console.log(`property ${name} (optional): ${config[name] || 'not set'}`);
  });
  console.log(`sending: ${brevoEnabled(config) ? 'ON (BREVO_ENABLED is true)' : 'OFF (rows only, no emails, no contacts)'}`);

  const loaded = loadContentFromUrl(config);
  if (loaded.content) {
    const hasEmail = Boolean(loaded.content.email && loaded.content.email.subject);
    console.log(`content: ${config.CONTENT_URL} read, email section ${hasEmail ? 'present' : 'MISSING'}`);
    if (!hasEmail) missing.push('email section in content.json');
  } else {
    console.log(`content: cannot read (${loaded.error})`);
    missing.push('content.json');
  }

  if (config.BREVO_API_KEY) {
    const account = brevoCall(config, 'get', '/account');
    if (isSuccess(account.code)) {
      console.log(`brevo ${describeAccount(account.json)}`);
      if (relayEnabled(account.json) === false) missing.push('transactional sending (relay) enabled in Brevo, ask support');
    } else {
      console.log(`brevo account: ${errorNote(account.code, account.text)}`);
      missing.push('a working BREVO_API_KEY');
    }
    const senders = brevoCall(config, 'get', '/senders');
    if (isSuccess(senders.code)) {
      console.log(`brevo ${describeSenders(senders.json)}`);
      const list = senders.json && Array.isArray(senders.json.senders) ? senders.json.senders : [];
      const ours = list.filter((sender) => String(sender.email).toLowerCase() === String(config.SENDER_EMAIL || '').toLowerCase())[0];
      if (!ours) missing.push(`sender ${config.SENDER_EMAIL || '(SENDER_EMAIL)'} in Brevo`);
      else if (!ours.active) missing.push(`sender ${config.SENDER_EMAIL} is not active yet`);
    } else {
      console.log(`brevo senders: ${errorNote(senders.code, senders.text)}`);
    }
    const lists = brevoCall(config, 'get', '/contacts/lists?limit=50');
    if (isSuccess(lists.code)) {
      const described = describeLists(lists.json, config.NEWSLETTER_LIST_ID);
      console.log(`brevo ${described.line}`);
      if (!described.found) missing.push('NEWSLETTER_LIST_ID that matches a list');
    } else {
      console.log(`brevo lists: ${errorNote(lists.code, lists.text)}`);
    }
    const attributes = brevoCall(config, 'get', '/contacts/attributes');
    if (isSuccess(attributes.code)) {
      const described = describeAttributes(attributes.json);
      console.log(`brevo ${described.line}`);
      if (described.missing.length) missing.push(`contact attributes ${described.missing.join(', ')}`);
    } else {
      console.log(`brevo attributes: ${errorNote(attributes.code, attributes.text)}`);
    }
  }

  // Read-only: the sheet and its headers are only reported, never created here.
  try {
    if (!config.SHEET_ID) throw new Error('SHEET_ID is not set, run setup first');
    const sheet = SpreadsheetApp.openById(config.SHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error(`no sheet "${SHEET_NAME}", run setup first`);
    const lastColumn = sheet.getLastColumn();
    const headerRow = lastColumn ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map((value) => String(value)) : [];
    const absent = missingHeaders(headerRow);
    console.log(`sheet: "${SHEET_NAME}" with ${headerRow.length} columns${absent.length ? `, missing headers: ${absent.join(', ')}` : ', all headers present'}`);
    if (absent.length) missing.push(`sheet headers ${absent.join(', ')}`);
  } catch (error) {
    console.log(`sheet: ${error.message}`);
    missing.push('the Responses sheet with its headers (run setup)');
  }

  console.log(missing.length ? `NOT READY: ${missing.join('; ')}` : 'READY: everything is in place');
}

// Runs one test response through the normal path: the sample answers, name Test,
// the TEST_EMAIL address, source "test". Writes the outcome to the log.
function testSubmission() {
  const config = readConfig();
  if (!config.TEST_EMAIL) {
    console.log('testSubmission: set the TEST_EMAIL property first');
    return;
  }
  const payload = {
    version: 1,
    submitted_at: new Date().toISOString(),
    name: 'Test',
    email: config.TEST_EMAIL,
    consent: false,
    src: 'test',
    grow: 'V',
    answers: SAMPLE_ANSWERS,
  };
  const parsed = parseSubmission(payload);
  if (!parsed.ok) {
    console.log(`testSubmission: the test payload is invalid (${parsed.errors.join('; ')})`);
    return;
  }
  const outcome = processSubmission(parsed.submission, parsed.rejected, realServices(config), { note: 'test submission' });
  console.log(`testSubmission: row ${outcome.rowIndex}, result ${outcome.evaluation.result}, email ${outcome.emailStatus}, contact ${outcome.contactStatus}${outcome.note ? `, ${outcome.note}` : ''}`);
  if (!brevoEnabled(config)) console.log('testSubmission: BREVO_ENABLED is not true, so nothing was sent; the row is in the sheet');
}
