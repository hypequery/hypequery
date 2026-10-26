import { describe, expect, it } from 'vitest';
import { loadServeDev } from './load-serve-dev.js';

const missing = (code: string) => () =>
  Promise.reject(Object.assign(new Error("Cannot find package '@hypequery/serve'"), { code }));

describe('loadServeDev', () => {
  it.each(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'])('names the package to install for %s', async code => {
    await expect(loadServeDev(missing(code))).rejects.toThrow('npm install @hypequery/serve');
  });

  it('passes through a module serve itself cannot find', async () => {
    const nested = Object.assign(new Error("Cannot find package 'zod' imported from /app/node_modules/@hypequery/serve/dist/index.js"), { code: 'ERR_MODULE_NOT_FOUND' });
    await expect(loadServeDev(() => Promise.reject(nested))).rejects.toThrow("Cannot find package 'zod'");
  });

  it('passes other failures through', async () => {
    await expect(loadServeDev(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});
