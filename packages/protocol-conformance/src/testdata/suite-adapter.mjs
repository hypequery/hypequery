import { createInterface } from 'node:readline';

const mode = process.argv[2];
const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type !== 'hello') return;
  const hostileObjectSuite = mode === 'malformed'
    ? { count: 1 }
    : undefined;
  process.stdout.write(`${JSON.stringify({
    type: 'hello',
    protocol: 1,
    families: ['host-family'],
    ...(hostileObjectSuite ? { hostileObjectSuite } : {}),
  })}\n`);
});
