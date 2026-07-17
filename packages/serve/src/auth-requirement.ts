interface EndpointAuthRequirement {
  readonly auth?: unknown | null;
  readonly requiresAuth?: boolean;
  readonly requiredRoles?: readonly string[];
  readonly requiredScopes?: readonly string[];
}

/** Resolve an endpoint's local auth requirement before applying global auth. */
export function resolveLocalAuthRequirement(
  endpoint: EndpointAuthRequirement,
): boolean | undefined {
  if ((endpoint.requiredRoles?.length ?? 0) > 0
    || (endpoint.requiredScopes?.length ?? 0) > 0) {
    return true;
  }
  if (endpoint.requiresAuth !== undefined) return endpoint.requiresAuth;
  if (endpoint.auth != null) return true;
  return undefined;
}
