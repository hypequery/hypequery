/**
 * Operations that are not destructive but change who can reach the
 * organisation or its data, so the CLI asks for the same confirmation as a
 * destructive operation: a prompt at a terminal, and `--yes` when nobody can
 * answer one (`--no-input`, CI, or `--json` without a terminal). Cloud does
 * not require `confirm` for these, so the CLI does not send it.
 *
 * Each entry grants access, creates a credential, or changes how users or
 * customers authenticate or what they may see. The parity test fails when an
 * entry names an operation the spec does not have, or a destructive one
 * (those are confirmed already).
 */
export const SENSITIVE_OPERATIONS: Readonly<Record<string, string>> = {
  'apiKeys.create': 'Creates an API key that can query the project.',
  'deployKeys.create': 'Creates a deploy key that can publish releases.',
  'signingKeys.create': 'Creates a key that signs in-app agent tokens.',
  'customerAccess.createKey': 'Creates a server key that acts for any customer.',
  'customerAccess.setMode': 'Changes how customers\' users are identified.',
  'customerSettings.set': 'Replaces the browser origins allowed to call customer endpoints, and customer registration.',
  'jwtIssuer.save': 'Trusts an identity provider\'s JWTs for customers\' users.',
  'oidcClient.save': 'Changes the identity provider customers\' users sign in to MCP with.',
  'permissionSets.create': 'Grants customers\' users datasets and fields.',
  'permissionSets.update': 'Changes which datasets and fields customers\' users may query.',
  'samplePolicy.set': 'Changes which columns\' sample values the assistant may see.',
  'connections.save': 'Replaces the ClickHouse credentials and databases the project uses.',
  'members.invite': 'Invites someone into the organisation.',
  'org.setAccessPolicy': 'Changes who may be invited into the organisation.',
};

export function isSensitiveOperation(name: string): boolean {
  return Object.hasOwn(SENSITIVE_OPERATIONS, name);
}
