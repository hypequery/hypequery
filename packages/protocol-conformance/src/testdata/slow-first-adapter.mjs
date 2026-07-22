// Answers every case immediately except id "s1", whose reply it delays well
// past any test timeout. Exercises the runner's recovery from a timed-out case:
// the stale connection (and its pending late reply) must be discarded so the
// following cases are not desynchronized.
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed === '') return;
  const message = JSON.parse(trimmed);
  if (message.type === 'hello') {
    process.stdout.write(`${JSON.stringify({ type: 'hello', protocol: 1, families: ['fam-a', 'fam-b'] })}\n`);
    return;
  }
  if (message.type === 'end') process.exit(0);
  if (message.type === 'case') {
    const result = message.role === 'rejection'
      ? { ok: false, code: message.case.error }
      : { ok: true };
    const line = `${JSON.stringify({ type: 'result', seq: message.seq, ...result })}\n`;
    if (message.id === 's1') {
      setTimeout(() => process.stdout.write(line), 10_000);
    } else {
      process.stdout.write(line);
    }
  }
});
