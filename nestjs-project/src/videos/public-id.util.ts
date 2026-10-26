import { randomBytes } from 'node:crypto';

// 8 random bytes → 11 base64url characters (~64 bits): short and non-enumerable.
export function generatePublicId(): string {
  return randomBytes(8).toString('base64url');
}
