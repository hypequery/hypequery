import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DevHandler } from './dev-handler.js';
import { MemoryStore } from './storage/index.js';

class MockRequest extends EventEmitter {
  method = 'GET';
  headers: Record<string, string> = {};

  constructor(public url: string) {
    super();
  }
}

class MockResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: string | Buffer = '';

  writeHead(status: number, headers: Record<string, string> = {}) {
    this.statusCode = status;
    this.headers = { ...this.headers, ...headers };
    return this;
  }

  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  write(data: string | Buffer) {
    this.body = data;
    return true;
  }

  end(data?: string | Buffer) {
    if (data !== undefined) this.body = data;
  }
}

describe('DevHandler', () => {
  let rootDir: string;
  let distDir: string;
  let handler: DevHandler;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'hypequery-gateway-'));
    distDir = path.join(rootDir, 'dist');
    await mkdir(path.join(distDir, 'assets'), { recursive: true });
    await writeFile(path.join(distDir, 'index.html'), '<html>studio shell</html>');

    const store = new MemoryStore(10);
    await store.initialize();
    handler = new DevHandler({ store, capabilities: [] });
    (handler as unknown as { distDir: string }).distDir = distDir;
  });

  afterEach(async () => {
    handler.shutdown();
    await rm(rootDir, { recursive: true, force: true });
  });

  it.each(['/__dev', '/__dev/'])('serves the studio shell at %s', async (url) => {
    const response = new MockResponse();

    const handled = await handler.handleRequest(
      new MockRequest(url) as unknown as IncomingMessage,
      response as unknown as ServerResponse
    );

    expect(handled).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('<html>studio shell</html>');
  });

  it('rejects an asset symlink whose real target escapes the studio dist directory', async () => {
    const secretPath = path.join(rootDir, 'secret.txt');
    await writeFile(secretPath, 'not a studio asset');
    await symlink(secretPath, path.join(distDir, 'assets', 'leak.txt'));
    const response = new MockResponse();

    await handler.handleRequest(
      new MockRequest('/__dev/assets/leak.txt') as unknown as IncomingMessage,
      response as unknown as ServerResponse
    );

    expect(response.statusCode).toBe(403);
    expect(response.body).toBe('Forbidden');
  });
});
