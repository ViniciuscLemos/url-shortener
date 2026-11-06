import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// the token that lets whoever made a link change it later (shown once, kept in their browser)
export function newOwnerToken(): { token: string; hash: Buffer } {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: hashOf(token) };
}

export const hashOf = (token: string) => createHash('sha256').update(token).digest();

// compares in constant time, so how long it takes doesn't say how much of the token was right
export function ownerMatches(header: string | undefined, stored: Buffer | null): boolean {
  if (!stored || !header?.startsWith('Bearer ')) return false;
  const given = hashOf(header.slice(7).trim());
  return given.length === stored.length && timingSafeEqual(given, stored);
}
