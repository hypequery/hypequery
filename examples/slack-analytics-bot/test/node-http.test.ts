/** The HTTP mode adapter: body limits, hung-up clients and handler failures. */
import { once } from 'node:events';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serveFetch } from '../lib/utils/node-http.js';

let server: Server | undefined;

afterEach(async () => {
  server?.close();
  server = undefined;
});

async function start(handler: (request: Request) => Promise<Response>) {
  const spy = vi.fn(handler);
  server = createServer(serveFetch(spy, { path: '/slack/events', origin: 'http://localhost', maxBodyBytes: 16 }));
  server.listen(0);
  await once(server, 'listening');
  return { port: (server.address() as AddressInfo).port, handler: spy };
}

function post(port: number, options: { body?: string; headers?: Record<string, string>; end?: boolean } = {}) {
  const req = request({ port, path: '/slack/events', method: 'POST', headers: options.headers });
  const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
    req.on('response', res => {
      let body = '';
      res.setEncoding('utf8').on('data', chunk => (body += chunk)).on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject);
  });
  if (options.body) req.write(options.body);
  if (options.end !== false) req.end();
  return { req, response };
}

const echo = async (request: Request) => new Response(`got ${await request.text()}`);

describe('serveFetch', () => {
  it('passes a body within the limit to the handler', async () => {
    const { port } = await start(echo);
    expect(await post(port, { body: 'hello' }).response).toEqual({ status: 200, body: 'got hello' });
  });

  it('answers 413 to a declared Content-Length over the limit without reading the body', async () => {
    const { port, handler } = await start(echo);
    const { req, response } = post(port, { headers: { 'content-length': '1000' }, body: 'x', end: false });
    expect((await response).status).toBe(413);
    req.destroy();
    expect(handler).not.toHaveBeenCalled();
  });

  it('answers 413 once a chunked body goes over the limit', async () => {
    const { port, handler } = await start(echo);
    expect((await post(port, { body: 'x'.repeat(64) }).response).status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it('survives a client that hangs up mid-body, and keeps serving', async () => {
    const { port, handler } = await start(echo);
    const { req, response } = post(port, { headers: { 'content-length': '10' }, body: 'abc', end: false });
    response.catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 50));
    req.destroy();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(handler).not.toHaveBeenCalled();
    expect(await post(port, { body: 'again' }).response).toEqual({ status: 200, body: 'got again' });
  });

  it('answers 500 when the handler throws', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { port } = await start(async () => {
      throw new Error('boom');
    });
    expect((await post(port, { body: 'hi' }).response).status).toBe(500);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('answers 404 off the events path', async () => {
    const { port, handler } = await start(echo);
    const res = await new Promise<number>(resolve => request({ port, path: '/other' }, r => resolve(r.statusCode!)).end());
    expect(res).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });
});
