import { describe, expect, it } from 'vitest';

import {
  buildCorsHeaders,
  buildPreflightHeaders,
  handleCorsRequest,
  resolveCorsConfig,
} from './cors.js';
import type { ServeRequest } from './types.js';

const request = (method: ServeRequest['method'], origin?: string): ServeRequest => ({
  method,
  path: '/api/test',
  headers: origin ? { origin } : {},
  query: {},
});

describe('resolveCorsConfig', () => {
  it('resolves false and undefined to null', () => {
    expect(resolveCorsConfig(false)).toBeNull();
    expect(resolveCorsConfig(undefined)).toBeNull();
  });

  it('uses defaults when config is true', () => {
    expect(resolveCorsConfig(true)).toEqual({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      exposedHeaders: [],
      credentials: false,
      maxAge: 86400,
    });
  });

  it('merges object config with defaults', () => {
    expect(resolveCorsConfig({
      origin: 'https://app.example.com',
      credentials: true,
      exposedHeaders: ['x-total-count'],
    })).toEqual({
      origin: 'https://app.example.com',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      exposedHeaders: ['x-total-count'],
      credentials: true,
      maxAge: 86400,
    });
  });
});

describe('buildCorsHeaders', () => {
  it('allows wildcard origins without vary', () => {
    const config = resolveCorsConfig(true)!;

    expect(buildCorsHeaders(config, 'https://app.example.com')).toEqual({
      'access-control-allow-origin': '*',
    });
  });

  it('echoes wildcard request origins when credentials are enabled', () => {
    const config = resolveCorsConfig({ origin: '*', credentials: true })!;

    expect(buildCorsHeaders(config, 'https://app.example.com')).toEqual({
      'access-control-allow-origin': 'https://app.example.com',
      'vary': 'Origin',
      'access-control-allow-credentials': 'true',
    });
  });

  it('matches string, array, and function origins', () => {
    expect(buildCorsHeaders(
      resolveCorsConfig({ origin: 'https://app.example.com' })!,
      'https://app.example.com',
    )).toMatchObject({ 'access-control-allow-origin': 'https://app.example.com', vary: 'Origin' });
    expect(buildCorsHeaders(
      resolveCorsConfig({ origin: ['https://one.example.com', 'https://two.example.com'] })!,
      'https://two.example.com',
    )).toMatchObject({ 'access-control-allow-origin': 'https://two.example.com', vary: 'Origin' });
    expect(buildCorsHeaders(
      resolveCorsConfig({ origin: (origin) => origin.endsWith('.example.com') })!,
      'https://admin.example.com',
    )).toMatchObject({ 'access-control-allow-origin': 'https://admin.example.com', vary: 'Origin' });
  });

  it('omits headers for missing or rejected origins', () => {
    const config = resolveCorsConfig({ origin: 'https://app.example.com' })!;

    expect(buildCorsHeaders(config, undefined)).toEqual({});
    expect(buildCorsHeaders(config, 'https://evil.example.com')).toEqual({});
  });

  it('includes exposed headers', () => {
    const config = resolveCorsConfig({
      origin: 'https://app.example.com',
      exposedHeaders: ['x-total-count', 'x-request-id'],
    })!;

    expect(buildCorsHeaders(config, 'https://app.example.com')).toMatchObject({
      'access-control-expose-headers': 'x-total-count, x-request-id',
    });
  });
});

describe('buildPreflightHeaders', () => {
  it('adds methods, headers, and max-age for matching origins', () => {
    const config = resolveCorsConfig({
      origin: 'https://app.example.com',
      methods: ['GET', 'POST'],
      allowedHeaders: ['authorization'],
      maxAge: 60,
    })!;

    expect(buildPreflightHeaders(config, 'https://app.example.com')).toEqual({
      'access-control-allow-origin': 'https://app.example.com',
      'vary': 'Origin',
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'authorization',
      'access-control-max-age': '60',
    });
  });

  it('does not add preflight headers for rejected origins', () => {
    const config = resolveCorsConfig({ origin: 'https://app.example.com' })!;

    expect(buildPreflightHeaders(config, 'https://evil.example.com')).toEqual({});
  });
});

describe('handleCorsRequest', () => {
  it('returns empty headers when CORS is disabled', () => {
    expect(handleCorsRequest(null, request('GET', 'https://app.example.com'))).toEqual({
      preflightResponse: null,
      corsHeaders: {},
    });
  });

  it('returns a 204 preflight response for OPTIONS requests', () => {
    const config = resolveCorsConfig({ origin: 'https://app.example.com' })!;

    expect(handleCorsRequest(config, request('OPTIONS', 'https://app.example.com'))).toEqual({
      preflightResponse: {
        status: 204,
        headers: expect.objectContaining({
          'access-control-allow-origin': 'https://app.example.com',
          'access-control-allow-methods': expect.any(String),
          'access-control-allow-headers': expect.any(String),
          'access-control-max-age': '86400',
        }),
        body: '',
      },
      corsHeaders: {},
    });
  });

  it('returns normal CORS headers for non-OPTIONS requests', () => {
    const config = resolveCorsConfig({ origin: 'https://app.example.com' })!;

    expect(handleCorsRequest(config, request('GET', 'https://app.example.com'))).toEqual({
      preflightResponse: null,
      corsHeaders: {
        'access-control-allow-origin': 'https://app.example.com',
        vary: 'Origin',
      },
    });
  });
});
