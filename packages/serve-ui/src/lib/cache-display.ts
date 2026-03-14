import { CheckCircle, Database, RefreshCw, SkipForward } from 'lucide-react';
import { COLORS } from './colors';
import type { CacheStatus } from './types';

export interface CacheDisplayConfig {
  label: string;
  labelShort: string;
  icon: typeof CheckCircle;
  bgClass: string;
  textClass: string;
  className: string;
}

/**
 * Get unified cache status display configuration.
 * Single source of truth for all cache status displays across the UI.
 */
export function getCacheDisplayConfig(
  status?: CacheStatus,
  cacheHit?: boolean
): CacheDisplayConfig | null {
  if (status === 'hit' || (!status && cacheHit)) {
    return {
      label: 'Cache Hit',
      labelShort: 'HIT',
      icon: CheckCircle,
      bgClass: COLORS.success.bg,
      textClass: COLORS.success.text,
      className: `${COLORS.success.text} ${COLORS.success.bg}`,
    };
  }

  if (status === 'stale') {
    return {
      label: 'Stale (Revalidating)',
      labelShort: 'STALE',
      icon: RefreshCw,
      bgClass: COLORS.warning.bg,
      textClass: COLORS.warning.text,
      className: `${COLORS.warning.text} ${COLORS.warning.bg}`,
    };
  }

  if (status === 'bypass') {
    return {
      label: 'Bypass',
      labelShort: 'BYPASS',
      icon: SkipForward,
      bgClass: COLORS.info.bg,
      textClass: COLORS.info.text,
      className: `${COLORS.info.text} ${COLORS.info.bg}`,
    };
  }

  if (status === 'miss') {
    return {
      label: 'Cache Miss',
      labelShort: 'MISS',
      icon: Database,
      bgClass: COLORS.neutral.bg,
      textClass: COLORS.neutral.text,
      className: `${COLORS.neutral.text} ${COLORS.neutral.bg}`,
    };
  }

  // No cache status - return null to indicate no badge should be shown
  return null;
}
