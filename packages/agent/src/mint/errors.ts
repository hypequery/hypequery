/** The option a refused mint names. */
export type AgentTokenField =
  | 'signingKey'
  | 'project'
  | 'tenant'
  | 'subject'
  | 'permissionSet'
  | 'constraints'
  | 'expiresInSeconds'
  | 'endpoint'
  | 'now';

/**
 * Thrown when `mintAgentToken()` is given an option the tenant endpoint would
 * refuse. Nothing is minted: a token Cloud refuses fails later and less
 * clearly. The message never contains key material.
 */
export class AgentTokenError extends Error {
  readonly field: AgentTokenField;

  constructor(field: AgentTokenField, message: string) {
    super(message);
    this.name = 'AgentTokenError';
    this.field = field;
  }
}
