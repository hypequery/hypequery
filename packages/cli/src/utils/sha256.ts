import { createHash } from 'node:crypto';

export function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}
