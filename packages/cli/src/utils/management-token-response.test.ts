import { describe, expect, it } from 'vitest';

import { managementCredentialFromResponse } from './management-token-response.js';

const ORIGIN = 'https://cloud.example.test';
const NOW = Date.parse('2030-01-01T00:00:00.000Z');
const TOKEN = `hqmt_v1_${'m'.repeat(43)}`;
const browser = { origin: ORIGIN, now: NOW, signedInWith: 'browser' as const };
const device = { origin: ORIGIN, now: NOW, signedInWith: 'device' as const };

describe('managementCredentialFromResponse', () => {
  it('is null when browser sign-in returned only the deploy credential', () => {
    expect(managementCredentialFromResponse({ access_token: `hqdp_v1_${'c'.repeat(43)}` }, browser)).toBeNull();
  });

  it('reads device sign-in\'s access_token as the management token', () => {
    expect(managementCredentialFromResponse({
      access_token: TOKEN,
      expires_at: '2030-01-31T00:00:00.000Z',
      project: null,
      project_limited: false,
    }, device)).toEqual({
      cloudUrl: ORIGIN,
      token: TOKEN,
      expiresAt: '2030-01-31T00:00:00.000Z',
      deploymentEndpoint: `${ORIGIN}/v1/deployments/submissions`,
      projectLimited: false,
      signedInWith: 'device',
    });
  });

  it('takes a deployment endpoint and target when Cloud names them', () => {
    expect(managementCredentialFromResponse({
      management_token: TOKEN,
      management_token_expires_at: '2030-01-31T00:00:00.000Z',
      deployment_endpoint: `${ORIGIN}/v2/deployments/submissions`,
      deployment_target: { project: 'acme:shop', environment: 'production' },
    }, device)).toMatchObject({
      deploymentEndpoint: `${ORIGIN}/v2/deployments/submissions`,
      target: { project: 'acme:shop', environment: 'production' },
    });
  });

  it.each([
    ['an expiry in the past', { management_token: TOKEN, management_token_expires_at: '2029-12-31T00:00:00.000Z' }, /expiration/],
    ['an endpoint on another origin', {
      management_token: TOKEN,
      management_token_expires_at: '2030-01-31T00:00:00.000Z',
      deployment_endpoint: 'https://evil.example.test/v1/deployments/submissions',
    }, /deployment endpoint/],
    ['a token that is not a management token', { management_token: `hqdp_v1_${'c'.repeat(43)}`, management_token_expires_at: '2030-01-31T00:00:00.000Z' }, /management token/],
  ])('refuses %s', (_case, body, error) => {
    expect(() => managementCredentialFromResponse(body, browser)).toThrow(error);
  });
});
