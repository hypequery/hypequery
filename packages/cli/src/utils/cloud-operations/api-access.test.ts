import { describe, expect, it } from 'vitest';
import { CliError } from '../cli-error.js';
import { cloudApiOrigin, resolveCloudApiAccess } from './api-access.js';

const TOKEN = `hqmt_v1_${'a'.repeat(43)}`;

describe('cloudApiOrigin', () => {
  it('returns the origin of an HTTPS endpoint', () => {
    expect(cloudApiOrigin('https://cloud.example.com/v1/deployments/submissions')).toBe('https://cloud.example.com');
  });

  it.each([
    'http://localhost:3000/v1/deployments/submissions',
    'http://127.0.0.1:3000/v1/deployments/submissions',
    'http://[::1]:3000/v1/deployments/submissions',
  ])('allows loopback HTTP for local Cloud development: %s', endpoint => {
    expect(cloudApiOrigin(endpoint)).toBe(new URL(endpoint).origin);
  });

  it.each([
    'http://cloud.example.com/v1/deployments/submissions',
    'http://localhost.example.com/v1/deployments/submissions',
    'http://10.0.0.5:3000/v1/deployments/submissions',
    'ftp://cloud.example.com/v1',
    'https://user:secret@cloud.example.com/v1',
    'not a url',
  ])('refuses an endpoint a credential cannot safely be sent to: %s', endpoint => {
    expect(() => cloudApiOrigin(endpoint)).toThrowError(
      expect.objectContaining({ code: 'CLOUD_ENDPOINT_INSECURE', category: 'correctable_input', exitClass: 'correctable' }),
    );
  });

  it('never repeats credentials embedded in the endpoint', () => {
    try {
      cloudApiOrigin('http://user:secret@cloud.example.com/v1');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect(`${(error as CliError).message} ${(error as CliError).hint}`).not.toContain('secret');
    }
  });
});

describe('resolveCloudApiAccess', () => {
  it('refuses HYPEQUERY_API_TOKEN with a non-local HTTP endpoint before any request', async () => {
    await expect(resolveCloudApiAccess({
      env: { HYPEQUERY_API_TOKEN: TOKEN, HYPEQUERY_DEPLOYMENT_ENDPOINT: 'http://cloud.example.com/v1/deployments/submissions' },
    })).rejects.toMatchObject({ code: 'CLOUD_ENDPOINT_INSECURE' });
  });

  it('uses the origin of an HTTPS endpoint', async () => {
    await expect(resolveCloudApiAccess({
      env: { HYPEQUERY_API_TOKEN: TOKEN, HYPEQUERY_DEPLOYMENT_ENDPOINT: 'https://cloud.example.com/v1/deployments/submissions' },
    })).resolves.toMatchObject({ baseUrl: 'https://cloud.example.com', token: TOKEN, source: 'env' });
  });
});
