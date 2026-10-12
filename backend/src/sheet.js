// The Responses sheet: its header row and one row per submission. Pure functions; the
// script writes by header text, so columns may be reordered or added on the right.

import { ANSWER_KEYS } from './validate.js';

export const SHEET_NAME = 'Responses';

export const HEADERS = [
  'Received at',
  'First name',
  'Email',
  'Newsletter consent',
  'Source',
  'Result',
  'Wants to grow',
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
export const AVERAGE_HEADER_NAMES = Object.keys(AVERAGE_HEADERS).map((key) => AVERAGE_HEADERS[key]);

export function round2(value) {
  return Math.round(value * 100) / 100;
}

// 'Foundation', 'Professional', 'Visibility' from the content, 'Balanced' for a balanced mosaic.
export function resultLabel(key, pillars) {
  if (key === 'balanced') return 'Balanced';
  const pillar = (pillars || []).filter((candidate) => candidate.key === key)[0];
  return pillar && pillar.short ? pillar.short : key;
}

export function buildRecord({ receivedAt, submission, evaluation, pillars, emailStatus, contactStatus, note, consentLabel }) {
  const record = {};
  record['Received at'] = receivedAt;
  record['First name'] = submission.name;
  record['Email'] = submission.email;
  record['Newsletter consent'] = submission.consent ? 'Yes' : 'No';
  record['Source'] = submission.src || 'direct';
  record['Result'] = resultLabel(evaluation.result, pillars);
  record['Wants to grow'] = resultLabel(submission.grow, pillars);
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
export function safeCell(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? ` ${value}` : value;
}

// Values for one sheet row, aligned to the header row actually present in the sheet.
export function rowValues(headerRow, record) {
  return headerRow.map((header) => (Object.prototype.hasOwnProperty.call(record, header) ? safeCell(record[header]) : ''));
}

// 1-based column number of a header, 0 when the header is missing.
export function columnOf(headerRow, header) {
  return headerRow.indexOf(header) + 1;
}

export function missingHeaders(headerRow) {
  return HEADERS.filter((header) => headerRow.indexOf(header) < 0);
}
