// Decisions about duplicates and sending limits. Pure: the counters and the time come in
// as arguments, the storage (CacheService, PropertiesService) lives in entry.js.

export const LIMITS = {
  PER_EMAIL_MIN_SECONDS: 120, // the same address not more than once in 2 minutes
  PER_EMAIL_PER_DAY: 3,       // and not more than 3 emails a day
  PER_HOUR: 150,              // everyone together, notifications to Julia included
  PER_DAY: 280,               // free Brevo allows 300 a day, keep a margin
};

// Counters are keyed by UTC day and hour, so they roll over by themselves.
export function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

export function hourKey(date) {
  return date.toISOString().slice(0, 13);
}

// emailKey: a hash of the address, never the address itself.
export function counterKeys(emailKey, now) {
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
export function decideSending({ now, lastSentAt, emailDayCount, hourCount, dayCount, needed, isTestEmail }) {
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
export function staleCounterKeys(keys, now) {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return keys.filter((key) => {
    const match = key.match(/^(?:emailday|day|hour):(\d{4}-\d{2}-\d{2})/);
    return Boolean(match) && match[1] !== today && match[1] !== yesterday;
  });
}
