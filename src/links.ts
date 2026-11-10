import { randomInt } from 'node:crypto';

// lower case letters and digits, minus the ones that get mixed up when read aloud or by hand
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const CODE_LENGTH = 7;

// paths the app itself uses, so nobody can take them as an alias
const RESERVED = new Set(['api', 'assets', 'stats', 'admin', 'login', 'health', 'index', 'favicon']);

/** 7 random characters from 32: about 34 billion codes, and nothing to learn from them (unlike 1, 2, 3...). */
export function randomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

export function checkAlias(text: string): Check<string> {
  const alias = text.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,31}$/.test(alias)) {
    return { ok: false, error: 'The custom name needs 3 to 32 letters, numbers or dashes, starting with a letter or number.' };
  }
  if (RESERVED.has(alias)) return { ok: false, error: `"${alias}" is used by the site itself, pick another one.` };
  return { ok: true, value: alias };
}

export function checkUrl(text: string, ownHost: string): Check<string> {
  const raw = text.trim();
  if (!raw) return { ok: false, error: 'Paste a link to shorten.' };
  if (raw.length > 2048) return { ok: false, error: 'This link is too long (more than 2048 characters).' };

  // people paste "example.com/page" without the https all the time
  // ("localhost:3000/x" also looks like a scheme, so only "something://" or a known one counts)
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(javascript|data|vbscript|file|blob|mailto):/i.test(raw);
  const withScheme = hasScheme ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: "That doesn't look like a link." };
  }
  // javascript:, data:, file: and friends would turn a short link into a way to attack someone
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https links can be shortened.' };
  }
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
    return { ok: false, error: "That doesn't look like a link." };
  }
  // a short link pointing to another short link of this site can loop forever
  if (url.host === ownHost) return { ok: false, error: "That's already a short link from here." };
  return { ok: true, value: url.href };
}

const MAX_AHEAD = 2 * 365 * 24 * 3600_000;

/** When the link stops working: a future moment up to two years ahead, or null for never. */
export function checkExpiry(value: unknown, now = new Date()): { ok: true; value: Date | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'The end date is a date like 2026-12-01 or an ISO time.' };
  // a plain date means the end of that day in São Paulo, which is how people think about "until the 1st"
  const at = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59-03:00`) : new Date(value);
  if (Number.isNaN(at.getTime())) return { ok: false, error: 'The end date is a date like 2026-12-01 or an ISO time.' };
  if (at.getTime() <= now.getTime()) return { ok: false, error: 'The end date has to be in the future.' };
  if (at.getTime() - now.getTime() > MAX_AHEAD) return { ok: false, error: 'The end date can be at most two years ahead.' };
  return { ok: true, value: at };
}
