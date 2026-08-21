import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'hello') {
    process.stdout.write(`${JSON.stringify({
      type: 'hello',
      protocol: 1,
      implementation: 'malformed-suite-adapter',
      families: ['tagged-values-v1'],
      hostileObjectSuite: { count: 1, mechanisms: 'getter' },
    })}\n`);
  } else if (message.type === 'end') {
    process.exit(0);
  }
});
