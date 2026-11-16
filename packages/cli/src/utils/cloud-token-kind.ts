/**
 * What a hypequery Cloud bearer token is, by its prefix. `HYPEQUERY_API_TOKEN`
 * may hold a management token (`hqmt_`, from `hypequery login` or Settings ›
 * CLI sign-ins) or a deploy key (`hqdp_`). Cloud owns everything after the
 * prefix, so only the prefix is read here: pinning a version or length would
 * break every published CLI the day Cloud rotates its token format.
 */
export type CloudTokenKind = 'management' | 'deploy-key' | 'unknown';

export const MANAGEMENT_TOKEN_PREFIX = 'hqmt_';
export const DEPLOY_KEY_PREFIX = 'hqdp_';

/** An opaque, header-safe bearer value of a sane length after the prefix. */
const TOKEN_BODY = /^[A-Za-z0-9_-]{16,512}$/;

export function cloudTokenKind(token: string): CloudTokenKind {
  if (token.startsWith(MANAGEMENT_TOKEN_PREFIX)) return 'management';
  if (token.startsWith(DEPLOY_KEY_PREFIX)) return 'deploy-key';
  return 'unknown';
}

/** A management token Cloud returned is well formed enough to store and send. */
export function isManagementTokenValue(value: unknown): value is string {
  return typeof value === 'string'
    && value.startsWith(MANAGEMENT_TOKEN_PREFIX)
    && TOKEN_BODY.test(value.slice(MANAGEMENT_TOKEN_PREFIX.length));
}
