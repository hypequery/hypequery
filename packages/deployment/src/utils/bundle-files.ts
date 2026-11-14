import type {
  ProtocolDeploymentBundleFile,
  ProtocolDeploymentBundleManifest,
} from '@hypequery/protocol';

export type DeploymentBundleFileRole = 'deployment' | 'business-context' | 'source';

export interface DeploymentBundleFileEntry extends ProtocolDeploymentBundleFile {
  readonly role: DeploymentBundleFileRole;
  /** Media type used when the file travels in a multipart submission. */
  readonly contentType: 'application/json' | 'application/octet-stream';
}

/**
 * Every declared file in a bundle (excluding `bundle.json`), with bundle-relative
 * paths, in the fixed order used for upload, intake, storage and verification:
 * deployment contract, business context, then source files.
 */
export function deploymentBundleFiles(
  manifest: ProtocolDeploymentBundleManifest,
): readonly DeploymentBundleFileEntry[] {
  const { deployment, businessContext, source } = manifest;
  return Object.freeze([
    {
      role: 'deployment',
      contentType: 'application/json',
      path: deployment.path,
      sha256: deployment.sha256,
      byteLength: deployment.byteLength,
    },
    ...(businessContext ? [{
      role: 'business-context' as const,
      contentType: 'application/json' as const,
      path: businessContext.path,
      sha256: businessContext.sha256,
      byteLength: businessContext.byteLength,
    }] : []),
    ...(source?.files.map(file => ({
      role: 'source' as const,
      contentType: 'application/octet-stream' as const,
      path: `${source.root}/${file.path}`,
      sha256: file.sha256,
      byteLength: file.byteLength,
    })) ?? []),
  ]);
}
