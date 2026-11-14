import { describe, expect, it, vi } from 'vitest';
import { createHypequeryToolsClient } from './client.js';
import { toolsEndpointUrl } from './endpoint-url.js';

describe('toolsEndpointUrl', () => {
  it.each([
    'https://acme-logistics-1f2e3d.hypequery.app/mcp',
    'http://localhost:8787/mcp',
    'http://gateway.localhost:8787/mcp',
    'http://127.0.0.1:8787/mcp',
    'http://[::1]:8787/mcp',
  ])('accepts %s', input => {
    expect(toolsEndpointUrl(input).href).toBe(new URL(input).href);
    expect(toolsEndpointUrl(new URL(input)).href).toBe(new URL(input).href);
  });

  it.each([
    'http://acme-logistics-1f2e3d.hypequery.app/mcp',
    'http://analytics.internal/mcp',
    'http://10.0.0.5:8787/mcp',
    'http://localhost.example.com/mcp',
    'http://127.0.0.1.example.com/mcp',
    'HTTP://Analytics.Internal/mcp',
    'ws://localhost:8787/mcp',
  ])('refuses %s, where the token would not be sent over https', input => {
    expect(() => toolsEndpointUrl(input)).toThrow(/url must use https/);
    expect(() => toolsEndpointUrl(input)).toThrow(TypeError);
  });

  it('refuses something that is not a URL', () => {
    expect(() => toolsEndpointUrl('acme.hypequery.app/mcp')).toThrow(TypeError);
  });
});

describe('createHypequeryToolsClient', () => {
  it('refuses a plain http endpoint before the token is read or a request is sent', () => {
    const token = vi.fn(() => 'agent-token-0123456789');
    const fetch = vi.fn();
    expect(() => createHypequeryToolsClient({ url: 'http://analytics.internal/mcp', token, fetch }))
      .toThrow(/url must use https/);
    expect(token).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
