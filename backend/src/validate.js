// Checks one submission from the page and cleans its fields. Pure functions, no Apps Script
// objects, so the tests import this file directly. Runs inside Google Apps Script (V8) too,
// so no optional chaining, no URL class, nothing from Node or the browser.

import { sanitizeSrc } from '../../src/app/submit.js';

export const NAME_MAX = 60;
export const EMAIL_MAX = 254;
export const EMAIL_PATTERN_SERVER = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PILLAR_KEYS_SERVER = ['F', 'P', 'V'];
export const ANSWER_KEYS = ['F1', 'F2', 'F3', 'F4', 'P1', 'P2', 'P3', 'P4', 'V1', 'V2', 'V3', 'V4'];
// A link or an address in the name field is not a person: the row is kept, nothing is sent.
export const SPAM_PATTERN = /https?:|www\.|:\/\/|@/i;
export const SUBMITTED_AT_MAX = 40;

// Control characters (0 to 31 and 127), built without escape sequences on purpose.
const CONTROL_CHARACTERS = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']', 'g');

export function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(CONTROL_CHARACTERS, '').replace(/\s+/g, ' ').trim();
}

export function looksLikeSpam(name) {
  return SPAM_PATTERN.test(name || '');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// raw: the request body (string) or an already parsed object.
// Returns { ok: false, errors } for an invalid submission, otherwise
// { ok: true, submission, rejected } where rejected marks a spammy name.
// Extra fields are dropped; answers come out as an array of 12 in F1..V4 order.
export function parseSubmission(raw) {
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
  if (!EMAIL_PATTERN_SERVER.test(email) || email.length > EMAIL_MAX) errors.push('email is not valid');

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

  const submittedAt = typeof data.submitted_at === 'string' && data.submitted_at.length <= SUBMITTED_AT_MAX ? data.submitted_at : '';
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
