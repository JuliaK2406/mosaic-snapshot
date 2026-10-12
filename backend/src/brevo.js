// Request bodies for the Brevo API and small helpers to read its answers. Pure functions;
// the HTTP call itself lives in entry.js.

export const BREVO_BASE = 'https://api.brevo.com/v3';
export const CONTACT_VARIANTS = ['full', 'name-only', 'bare'];

export function brevoTags(resultKey, src) {
  return ['mosaic-snapshot', resultKey, src || 'direct'];
}

// POST /v3/smtp/email
export function emailRequest({ senderName, senderEmail, replyTo, toEmail, toName, subject, html, text, tags }) {
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
export function notificationRequest({ senderName, senderEmail, toEmail, subject, text }) {
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
export function contactRequest({ email, name, listId, result, grow, src, date, variant }) {
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

export function isSuccess(code) {
  return code >= 200 && code < 300;
}

// Brevo answers 400 with a message that names the attribute it does not know.
export function isAttributeError(code, text) {
  return code === 400 && /attribute/i.test(text || '');
}

// A short, safe excerpt of an error answer for the note column.
export function errorNote(code, text) {
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  return `Brevo ${code}: ${body.slice(0, 200)}`;
}

// One line about GET /v3/account for checkSetup.
export function describeAccount(json) {
  if (!json || typeof json !== 'object') return 'account: no readable answer';
  const plans = Array.isArray(json.plan) ? json.plan : [];
  const planText = plans.length
    ? plans.map((plan) => `${plan.type || '?'}${plan.credits !== undefined ? ` (${plan.credits} ${plan.creditsType || 'credits'})` : ''}`).join(', ')
    : 'unknown';
  const flagKeys = Object.keys(json).filter((key) => /transactional|smtp/i.test(key));
  const flagText = flagKeys.length
    ? flagKeys.map((key) => `${key}=${JSON.stringify(json[key])}`).join(', ')
    : 'transactional flag not in the answer (the support ticket decides)';
  return `account: ${json.email || json.companyName || 'ok'}; plan ${planText}; ${flagText}`;
}

export function describeSenders(json) {
  const senders = json && Array.isArray(json.senders) ? json.senders : [];
  if (!senders.length) return 'senders: none';
  return `senders: ${senders.map((sender) => `${sender.name || ''} <${sender.email}> ${sender.active ? 'active' : 'not active'}`).join('; ')}`;
}

export function describeLists(json, wantedId) {
  const lists = json && Array.isArray(json.lists) ? json.lists : [];
  const found = lists.some((list) => String(list.id) === String(wantedId));
  const names = lists.map((list) => `#${list.id} ${list.name}${list.totalSubscribers !== undefined ? ` (${list.totalSubscribers})` : ''}`).join('; ');
  return { line: `lists: ${names || 'none'}; NEWSLETTER_LIST_ID ${wantedId || 'not set'} ${found ? 'found' : 'NOT found'}`, found };
}

export const WANTED_ATTRIBUTES = ['FIRSTNAME', 'SNAPSHOT_RESULT', 'SNAPSHOT_GROW', 'SNAPSHOT_SRC', 'SNAPSHOT_DATE'];

export function describeAttributes(json) {
  const names = json && Array.isArray(json.attributes) ? json.attributes.map((attribute) => String(attribute.name).toUpperCase()) : [];
  const missing = WANTED_ATTRIBUTES.filter((name) => names.indexOf(name) < 0);
  return { line: `attributes: ${missing.length ? `missing ${missing.join(', ')}` : 'all present'}`, missing };
}
