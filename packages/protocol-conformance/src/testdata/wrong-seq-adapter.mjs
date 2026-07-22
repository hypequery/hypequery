// Answers with a mismatched seq: exercises the runner's out-of-order handling.
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
    process.stdout.write(`${JSON.stringify({ type: 'result', seq: message.seq + 100, ok: true })}\n`);
  }
});
