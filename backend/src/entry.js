// Google Apps Script entry points (doPost, doGet, setup, checkSetup, testSubmission) and the
// plumbing around the pure modules. Everything that touches an Apps Script service lives in
// realServices(); processSubmission() takes any services object, so the tests run it with fakes.
// Runs on the Apps Script V8 runtime: no optional chaining, no URL class, no Node.

import { evaluate } from '../../src/app/scoring.js';
import { parseSubmission } from './validate.js';
import { LIMITS, decideSending, counterKeys, staleCounterKeys } from './limits.js';
import { SHEET_NAME, HEADERS, buildRecord, rowValues, columnOf, missingHeaders, resultLabel } from './sheet.js';
import { renderEmail, renderNotification } from './email.js';
import {
  BREVO_BASE, CONTACT_VARIANTS, brevoTags, emailRequest, notificationRequest, contactRequest,
  isSuccess, isAttributeError, errorNote, describeAccount, describeSenders, describeLists, describeAttributes,
} from './brevo.js';

export const CONTENT_CACHE_SECONDS = 600;
export const LOCK_WAIT_MS = 20000;
export const CONTENT_CACHE_KEY = 'content.json';

// The same answers as the sample result on the first screen.
export const SAMPLE_ANSWERS = { F1: 4, F2: 3, F3: 5, F4: 4, P1: 7, P2: 6, P3: 8, P4: 7, V1: 6, V2: 5, V3: 7, V4: 6 };

// Used when content.json cannot be read: the agreed logic and the pillar keys, no texts.
export const FALLBACK_CONTENT = {
  logic: { balanced_gap: 3, tie_order: ['F', 'P', 'V'] },
  pillars: [
    { key: 'F', items: [{}, {}, {}, {}] },
    { key: 'P', items: [{}, {}, {}, {}] },
    { key: 'V', items: [{}, {}, {}, {}] },
  ],
};

export const STATUS = {
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

export const REQUIRED_PROPERTIES = ['BREVO_API_KEY', 'BREVO_ENABLED', 'SENDER_NAME', 'SENDER_EMAIL', 'NEWSLETTER_LIST_ID', 'CONTENT_URL'];
export const OPTIONAL_PROPERTIES = ['REPLY_TO', 'TEST_EMAIL', 'NOTIFY_EMAIL', 'SHEET_ID'];

export function brevoEnabled(config) {
  return String(config.BREVO_ENABLED || '').toLowerCase() === 'true';
}

function isTestAddress(config, email) {
  return Boolean(config.TEST_EMAIL) && String(email).toLowerCase() === String(config.TEST_EMAIL).toLowerCase();
}

// One submission from start to end. services: see realServices() below and the fakes in the tests.
// Returns { rowIndex, emailStatus, contactStatus, note, evaluation }.
export function processSubmission(submission, rejected, services, options) {
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

  // Counters and the first write of the row happen under the lock, so two requests
  // at the same moment cannot both pass the limits or mix up row numbers.
  const rowInfo = services.withLock(() => {
    if (emailStatus === STATUS.PENDING) {
      const keys = counterKeys(services.hash(submission.email), now);
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
        emailStatus = STATUS.RATE_LIMITED;
        contactStatus = submission.consent ? STATUS.SKIPPED : STATUS.NO_CONSENT;
        notes.push(`limit: ${decision.reason}`);
      }
    }
    const record = buildRecord({
      receivedAt: now,
      submission,
      evaluation,
      pillars,
      emailStatus,
      contactStatus,
      note: notes.join('; '),
      consentLabel: content && content.email_step ? content.email_step.consent_label : '',
    });
    return services.sheet.append(record);
  });

  const allowed = emailStatus === STATUS.PENDING;

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

// The header row as it is in the sheet; written when the first row is empty.
function ensureHeaders(sheet) {
  const lastColumn = sheet.getLastColumn();
  const row = lastColumn ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
  if (row.every((value) => value === '')) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return HEADERS.slice();
  }
  return row.map((value) => String(value));
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
        if (column) sheet.getRange(rowInfo.rowIndex, column).setValue(fields[header]);
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
  const response = UrlFetchApp.fetch(BREVO_BASE + path, options);
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

export function doPost(e) {
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

export function doGet() {
  return ContentService.createTextOutput('Mosaic Snapshot endpoint');
}

// Creates the Responses sheet with its headers, freezes the header row and remembers the
// spreadsheet in SHEET_ID. Safe to run again.
export function setup() {
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
  props.setProperty('SHEET_ID', spreadsheet.getId());
  const sheet = getOrCreateSheet(spreadsheet);
  const headerRow = ensureHeaders(sheet);
  sheet.setFrozenRows(1);
  const missing = missingHeaders(headerRow);
  console.log(`setup: spreadsheet "${spreadsheet.getName()}", sheet "${SHEET_NAME}", ${headerRow.length} columns${missing.length ? `, missing headers: ${missing.join(', ')}` : ''}, SHEET_ID saved`);
}

function maskKey(value) {
  const text = String(value || '');
  return text ? `${text.slice(0, 4)}... (${text.length} characters)` : 'missing';
}

// Reads every setting and asks Brevo (read-only) whether the account, sender, list and
// attributes are in place. One line per check, the last line says what is still missing.
export function checkSetup() {
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

  try {
    const sheet = getOrCreateSheet(openSpreadsheet(config));
    const headerRow = ensureHeaders(sheet);
    const absent = missingHeaders(headerRow);
    console.log(`sheet: "${SHEET_NAME}" with ${headerRow.length} columns${absent.length ? `, missing headers: ${absent.join(', ')}` : ', all headers present'}`);
    if (absent.length) missing.push(`sheet headers ${absent.join(', ')}`);
  } catch (error) {
    console.log(`sheet: ${error.message}`);
    missing.push('the Responses sheet (run setup)');
  }

  console.log(missing.length ? `NOT READY: ${missing.join('; ')}` : 'READY: everything is in place');
}

// Runs one test response through the normal path: the sample answers, name Test,
// the TEST_EMAIL address, source "test". Writes the outcome to the log.
export function testSubmission() {
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
