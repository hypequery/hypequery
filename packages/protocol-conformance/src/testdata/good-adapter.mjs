// A well-behaved fake adapter for runner tests. Announced families come from
// argv (default fam-a, fam-b). Rejections echo the case's expected code.
import { createInterface } from 'node:readline';

const families = process.argv.slice(2).length ? process.argv.slice(2) : ['fam-a', 'fam-b'];
const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed === '') return;
  const message = JSON.parse(trimmed);
  if (message.type === 'hello') {
    const hostileObjectSuite = { count: 2, mechanisms: ['getter', 'toJSON'] };
    process.stdout.write(
      `${JSON.stringify({ type: 'hello', protocol: 1, families, hostileObjectSuite })}\n`,
    );
    return;
  }
  if (message.type === 'end') {
    process.exit(0);
  }
  if (message.type === 'case') {
    const result = message.role === 'rejection'
      ? { ok: false, code: message.case.error }
      : { ok: true };
    process.stdout.write(`${JSON.stringify({ type: 'result', seq: message.seq, ...result })}\n`);
  }
});
