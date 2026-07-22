export interface StudioRuntimeConfig {
  /** Base URL containing the gateway contract endpoints. */
  gatewayBaseUrl: string;
}

export interface ResolveStudioRuntimeConfigOptions {
  injected?: Partial<StudioRuntimeConfig>;
  pathname?: string;
}

/** Normalize a gateway base URL without changing its origin or path. */
export function normalizeGatewayBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed === '' || trimmed === '/') return '';
  return trimmed.replace(/\/+$/, '');
}

/**
 * Resolve boot configuration. Hosts should inject `gatewayBaseUrl`; the path
 * fallback lets a same-origin gateway serve Studio at its own API base.
 */
export function resolveStudioRuntimeConfig(
  options: ResolveStudioRuntimeConfigOptions = {}
): StudioRuntimeConfig {
  const injectedBaseUrl = options.injected?.gatewayBaseUrl;
  if (injectedBaseUrl?.trim()) {
    return { gatewayBaseUrl: normalizeGatewayBaseUrl(injectedBaseUrl) };
  }

  const pathname = options.pathname ?? '/';
  return { gatewayBaseUrl: normalizeGatewayBaseUrl(pathname) };
}
