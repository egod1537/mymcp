import { argon2id, hash, verify } from 'argon2';

const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function isArgon2idHash(value: string | undefined): value is string {
  return value?.startsWith('$argon2id$') ?? false;
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error('Password must be at least 12 characters');
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  if (!isArgon2idHash(encodedHash)) return false;
  try {
    return await verify(encodedHash, password);
  } catch {
    return false;
  }
}
