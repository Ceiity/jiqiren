import { hash, verify, Algorithm } from '@node-rs/argon2';

const opts = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, opts);
export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}
// constant-ish timing for unknown users
let dummy: string | undefined;
export async function burnPasswordCheck(password: string) {
  dummy ??= await hashPassword('nailong-dummy-password');
  await verifyPassword(dummy, password);
}
