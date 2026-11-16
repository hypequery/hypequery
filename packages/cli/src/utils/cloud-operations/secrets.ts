/**
 * Which Cloud operations carry a secret, and in which direction. The spec
 * doesn't mark secrets, so they are listed here; the parity test fails when a
 * new operation is off the connector, or has a secret-looking input field,
 * without being classified below.
 */

/** Operations whose output holds a secret Cloud shows only once (a new key's token, a private JWK). */
export const SECRET_OUTPUT_OPERATIONS: ReadonlySet<string> = new Set([
  'apiKeys.create',
  'customerAccess.createKey',
  'deployKeys.create',
  'signingKeys.create',
]);

/**
 * Input fields that hold a secret. The CLI never takes them as a flag value
 * (shell history, `ps`): they come from stdin (`--<field>-stdin`), a hidden
 * prompt at a terminal, or `--input-json`.
 */
export const SECRET_INPUT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'connections.save': ['password'],
  'customerAccess.prove': ['sampleToken'],
  'oidcClient.save': ['clientSecret'],
};

/**
 * Operations Cloud keeps off the connector (`connector: false`) that return no
 * secret, with the reason. Every connector-off operation is either here or in
 * SECRET_OUTPUT_OPERATIONS.
 */
export const CONNECTOR_OFF_WITHOUT_SECRET_OUTPUT: Readonly<Record<string, string>> = {
  'connections.save': 'Takes the ClickHouse password as input; the output is the connection without it.',
  'oidcClient.save': 'Takes the OIDC client secret as input; the output never echoes it.',
  'samplePolicy.set': 'A model never widens what it is shown; the output is the policy, not a secret.',
};

/** Input names that look like secrets; each must be classified in SECRET_INPUT_FIELDS or NOT_SECRET_INPUT_FIELDS. */
export const SECRET_LOOKING_INPUT = /password|secret|token$|privatekey/i;

/** Secret-looking input fields that are not secrets, with the reason. */
export const NOT_SECRET_INPUT_FIELDS: Readonly<Record<string, string>> = {
  'managementTokens.revoke.token': "The management token's id from managementTokens.list, not the token itself.",
};

export function isSecretInput(operation: string, property: string): boolean {
  return SECRET_INPUT_FIELDS[operation]?.includes(property) === true;
}
