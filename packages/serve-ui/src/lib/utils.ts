import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names with Tailwind CSS.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format duration in milliseconds to human-readable string.
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '-';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

/**
 * Format timestamp to locale string.
 */
export function formatTime(timestamp: number | undefined): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleTimeString();
}

/**
 * Format timestamp to relative time.
 */
export function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return '-';

  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 1000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/**
 * Format number with locale separators.
 */
export function formatNumber(n: number | undefined): string {
  if (n === undefined) return '-';
  return n.toLocaleString();
}

/**
 * Format percentage.
 */
export function formatPercentage(value: number | undefined): string {
  if (value === undefined) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Truncate string with ellipsis.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
