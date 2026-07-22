// Answers the handshake, then never answers a case: exercises the runner's
// per-case timeout.
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed === '') return;
  const message = JSON.parse(trimmed);
  if (message.type === 'hello') {
    process.stdout.write(`${JSON.stringify({ type: 'hello', protocol: 1, families: ['fam-a', 'fam-b'] })}\n`);
  }
  if (message.type === 'end') process.exit(0);
});
