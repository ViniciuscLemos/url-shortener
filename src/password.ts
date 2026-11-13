import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Passwords on links. scrypt is slow on purpose, so a stolen table can't be guessed through
// quickly; the salt makes the same password look different on two links.

export function checkPassword(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'The password is text.' };
  if (value.length < 4) return { ok: false, error: 'A password needs at least 4 characters.' };
  if (value.length > 72) return { ok: false, error: 'A password of up to 72 characters is plenty.' };
  return { ok: true, value };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${scryptSync(password, salt, 32).toString('base64url')}`;
}

export function passwordMatches(given: unknown, stored: string): boolean {
  if (typeof given !== 'string' || !given) return false;
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(given, Buffer.from(salt, 'base64url'), expected.length);
  return timingSafeEqual(actual, expected);
}
