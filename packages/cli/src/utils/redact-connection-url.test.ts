import { describe, expect, it } from 'vitest';
import { redactConnectionUrl } from './redact-connection-url.js';

describe('redactConnectionUrl', () => {
  it('removes embedded credentials, query parameters, and fragments', () => {
    expect(redactConnectionUrl(
      'https://admin:super-secret@clickhouse.example.com:8443/analytics?token=secret#details',
    )).toBe('https://clickhouse.example.com:8443/analytics');
  });

  it('keeps a useful bare host for diagnostics', () => {
    expect(redactConnectionUrl('localhost:8123/analytics')).toBe('localhost:8123/analytics');
  });

  it('does not echo malformed input', () => {
    expect(redactConnectionUrl('https://%')).toBe('[configured connection URL]');
  });

  it('handles missing configuration', () => {
    expect(redactConnectionUrl(undefined)).toBe('not set');
  });
});
