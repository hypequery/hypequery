/**
 * Lets a host learn which audiences a JWT strategy accepts without verifying a token.
 *
 * `createJwtStrategy` returns a closure, so its configuration is otherwise invisible.
 * `hypequery mcp --http` needs it to refuse a strategy that would also accept tokens
 * issued for another API. Attached under a registered symbol so a consumer that cannot
 * import serve (it is an optional peer) reads the same key. Keep it in step with
 * `@hypequery/mcp`'s `http-auth.ts`.
 */
const jwtAudienceSymbol = Symbol.for('hypequery.jwt-audience.v1');

export interface JwtStrategyAudience {
  readonly version: 1;
  /** The `aud` values a token may carry one of; empty when the audience is not checked. */
  readonly audiences: readonly string[];
}

export function attachJwtAudience<T extends object>(
  strategy: T,
  audience: string | readonly string[] | undefined,
): T {
  const audiences = audience === undefined ? [] : typeof audience === 'string' ? [audience] : [...audience];
  Object.defineProperty(strategy, jwtAudienceSymbol, {
    value: Object.freeze({ version: 1, audiences: Object.freeze(audiences) } satisfies JwtStrategyAudience),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return strategy;
}

/** The audiences a `createJwtStrategy` strategy accepts, or undefined for any other strategy. */
export function readJwtAudience(strategy: unknown): readonly string[] | undefined {
  if (typeof strategy !== 'function') return undefined;
  const value = (strategy as unknown as Record<symbol, unknown>)[jwtAudienceSymbol] as Partial<JwtStrategyAudience> | undefined;
  return value?.version === 1 && Array.isArray(value.audiences) ? value.audiences : undefined;
}
