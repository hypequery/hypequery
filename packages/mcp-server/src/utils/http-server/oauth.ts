/**
 * OAuth 2.0 resource-server pieces for the HTTP transport: the RFC 9728
 * protected-resource metadata document and RFC 6750 Bearer challenges.
 *
 * The authorization server (client registration, consent, token issuance) is
 * not part of this package; an MCP client discovers it from this metadata.
 */

export interface MCPProtectedResourceOptions {
  /** The canonical URL of this MCP endpoint, which tokens must name as their audience. */
  resource: string;
  /** Issuer URLs of the authorization servers that mint tokens for this resource. */
  authorizationServers: readonly string[];
  /** Scopes advertised to clients. */
  scopesSupported?: readonly string[];
  /** Scopes every principal must hold; a principal without them is refused with 403. */
  requiredScopes?: readonly string[];
  /** Human-readable documentation for this resource. */
  resourceDocumentation?: string;
}

export interface ProtectedResource {
  readonly resource: string;
  readonly metadataPath: string;
  readonly metadataUrl: string;
  readonly requiredScopes: readonly string[];
  readonly document: Readonly<Record<string, unknown>>;
}

const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

function httpsUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute URL.`);
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError(`${label} must use https (http is allowed only for loopback).`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError(`${label} must not contain credentials, a query or a fragment.`);
  }
  return url;
}

function scopes(values: readonly string[] | undefined, label: string): string[] {
  const out: string[] = [];
  for (const scope of values ?? []) {
    if (typeof scope !== 'string' || !SCOPE_TOKEN.test(scope)) {
      throw new TypeError(`${label} entries must be RFC 6749 scope tokens.`);
    }
    if (!out.includes(scope)) out.push(scope);
  }
  return out;
}

/** Validate the options once, at server construction. */
export function protectedResource(options: MCPProtectedResourceOptions): ProtectedResource {
  const resource = httpsUrl(options.resource, 'oauth.resource');
  if (!Array.isArray(options.authorizationServers) || options.authorizationServers.length === 0) {
    throw new TypeError('oauth.authorizationServers must name at least one authorization server.');
  }
  // Issuer identifiers are compared exactly by clients, so they are kept as written.
  const servers = options.authorizationServers.map((server) => {
    httpsUrl(server, 'oauth.authorizationServers');
    return server;
  });
  const supported = scopes(options.scopesSupported, 'oauth.scopesSupported');
  const required = scopes(options.requiredScopes, 'oauth.requiredScopes');
  // RFC 9728 §3.1: the well-known segment goes between the host and the resource path.
  const path = resource.pathname === '/' ? '' : resource.pathname.replace(/\/$/, '');
  const metadataPath = `/.well-known/oauth-protected-resource${path}`;
  // The resource identifier is the token audience, so it too is kept as written.
  const document: Record<string, unknown> = {
    resource: options.resource,
    authorization_servers: servers,
  };
  if (supported.length > 0) document.scopes_supported = supported;
  document.bearer_methods_supported = ['header'];
  if (options.resourceDocumentation !== undefined) {
    document.resource_documentation = httpsUrl(options.resourceDocumentation, 'oauth.resourceDocumentation').href;
  }
  return Object.freeze({
    resource: document.resource as string,
    metadataPath,
    metadataUrl: `${resource.origin}${metadataPath}`,
    requiredScopes: Object.freeze(required),
    document: Object.freeze(document),
  });
}

export type BearerError = 'invalid_token' | 'insufficient_scope';

/** An RFC 6750 `WWW-Authenticate` value. Error descriptions are never included. */
export function bearerChallenge(
  error: BearerError | undefined,
  resource: ProtectedResource | undefined,
  scope?: readonly string[],
): string {
  const params: string[] = [];
  if (error) params.push(`error="${error}"`);
  if (error === 'insufficient_scope' && scope && scope.length > 0) params.push(`scope="${scope.join(' ')}"`);
  if (resource) params.push(`resource_metadata="${resource.metadataUrl}"`);
  return params.length === 0 ? 'Bearer' : `Bearer ${params.join(', ')}`;
}
