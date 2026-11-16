/** `cloud` (the default) or `self-hosted`. Explicit, so a missing key never silently switches modes. */
export function agentMode(): 'cloud' | 'self-hosted' {
  const mode = process.env.HYPEQUERY_MODE ?? 'cloud';
  if (mode !== 'cloud' && mode !== 'self-hosted') {
    throw new Error(`HYPEQUERY_MODE must be "cloud" or "self-hosted", not "${mode}".`);
  }
  return mode;
}
