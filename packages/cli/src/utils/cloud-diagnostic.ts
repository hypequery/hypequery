import { logger } from './logger.js';

export interface CloudCompatibilityDiagnosticLike {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly subject: string;
  readonly message: string;
  readonly remedy: string;
}

/** Report warnings and explicitly overridden errors before submitting a release. */
export function reportCloudDiagnostic(
  diagnostic: CloudCompatibilityDiagnosticLike,
  allowUnsupportedConfig: boolean,
): void {
  // Blocking errors are reported by the contract builder's exception.
  if (diagnostic.severity === 'error' && !allowUnsupportedConfig) return;
  logger.warn(`${diagnostic.code} (${diagnostic.subject})`);
  logger.indent(diagnostic.message);
  logger.indent(`→ ${diagnostic.remedy}`);
}
