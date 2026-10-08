// Payload for stage 2 (Google Apps Script) and the sending itself.
// While backend.endpoint_url is empty, nothing leaves the browser.

export const PAYLOAD_VERSION = 1;
const SRC_MAX_LENGTH = 40;

// Workshop tag from ?src=. Keeps a-z, 0-9, "-" and "_" only, at most 40 characters.
// Letters are lower-cased first, so "Workshop-A" and "workshop-a" count as the same tag.
export function sanitizeSrc(raw) {
  if (typeof raw !== 'string') return '';
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, SRC_MAX_LENGTH);
}

export function readSrc(search) {
  const params = new URLSearchParams(search || '');
  return sanitizeSrc(params.get('src') || '');
}

// The content check guarantees a full address; if it ever is not one, the link is used as is.
export function calendlyUrl(base, { src, result }) {
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
export function answerMap(answers, pillars) {
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
export function buildPayload({ name, email, consent, src, grow, evaluation, answers, pillars, submittedAt }) {
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
export function sendPayload(payload, endpointUrl, fetchImpl = globalThis.fetch) {
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
