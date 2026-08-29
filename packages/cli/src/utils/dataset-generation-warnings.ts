import type { DatasetGenerationWarning } from '../generators/dataset-generator.js';
import { logger } from './logger.js';

export function logDatasetGenerationWarnings(
  warnings: readonly DatasetGenerationWarning[] | undefined,
): void {
  if (!warnings?.length) {
    return;
  }

  logger.newline();
  logger.warn('Review generated dataset tenant isolation:');
  for (const warning of warnings) {
    logger.indent(`• ${warning.message}`);
  }
}
