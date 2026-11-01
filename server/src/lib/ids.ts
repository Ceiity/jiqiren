import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Unbiased random string from a CSPRNG via rejection sampling. */
export function randomString(length: number, alphabet = BASE62): string {
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  let out = '';
  while (out.length < length) {
    const bytes = crypto.randomBytes(length * 2);
    for (const b of bytes) {
      if (b < max) out += alphabet[b % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Internal ids for files/folders/uploads — not guessable. */
export const newId = () => randomString(16, ALPHABET);
/** Public share token, ~59 bits of entropy (10 × log2(62)). */
export const newShareToken = () => randomString(10);
export const newSecret = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (input: string) => crypto.createHash('sha256').update(input).digest('hex');
