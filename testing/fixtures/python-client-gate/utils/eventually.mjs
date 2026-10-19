import { setTimeout } from 'node:timers/promises';

export async function eventually(check, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await setTimeout(25);
  }
  throw new Error(message);
}
