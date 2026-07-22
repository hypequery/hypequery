// Answers the first case, then exits mid-stream on the next: exercises the
// runner's respawn-once behavior.
import { createInterface } from 'node:readline';

let answered = 0;
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
    if (answered >= 1) process.exit(1);
    answered += 1;
    process.stdout.write(`${JSON.stringify({ type: 'result', seq: message.seq, ok: true })}\n`);
  }
});
