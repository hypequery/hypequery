export interface DraftDeploymentResult {
  readonly draftId: string;
  readonly name: string;
  readonly stagingUrl: string;
}

export function validateDraftDeploymentOptions(options: {
  draft?: string;
  replaceRestored?: boolean;
}): void {
  if (options.draft === undefined) return;
  if (options.draft.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.draft)) {
    throw new Error('--draft must be a lowercase name with letters, numbers and single hyphens (max 64 characters).');
  }
  if (options.replaceRestored) {
    throw new Error('--draft cannot be combined with --replace-restored; draft uploads do not replace Production.');
  }
}

/** Accept only the requested draft and a staging endpoint on the deployment service. */
export function parseDraftDeploymentResult(
  input: unknown,
  expected: { name: string; endpoint: string; project: string },
): DraftDeploymentResult | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)
    || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'draftId,name,stagingUrl'
    || typeof value.draftId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.draftId)
    || value.name !== expected.name
    || typeof value.stagingUrl !== 'string') return undefined;
  let url: URL;
  try {
    url = new URL(value.stagingUrl, expected.endpoint);
  } catch {
    return undefined;
  }
  if (url.origin !== new URL(expected.endpoint).origin || url.username || url.password
    || url.search || url.hash
    || url.pathname !== `/api/gateway/${encodeURIComponent(expected.project)}/draft/${value.draftId}`) return undefined;
  return Object.freeze({ draftId: value.draftId, name: expected.name, stagingUrl: url.href });
}
