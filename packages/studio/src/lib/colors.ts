/**
 * Centralized color scheme for consistent styling across the UI.
 * Uses Tailwind classes with dark mode support.
 */

export const COLORS = {
  success: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-700 dark:text-green-400',
    bgLight: 'bg-green-50 dark:bg-green-900/20',
  },
  warning: {
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    text: 'text-yellow-700 dark:text-yellow-400',
    bgLight: 'bg-yellow-50 dark:bg-yellow-900/20',
  },
  error: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-700 dark:text-red-400',
    bgLight: 'bg-red-50 dark:bg-red-900/20',
  },
  info: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-400',
    bgLight: 'bg-blue-50 dark:bg-blue-900/20',
  },
  purple: {
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    text: 'text-purple-700 dark:text-purple-400',
    bgLight: 'bg-purple-50 dark:bg-purple-900/20',
  },
  neutral: {
    bg: 'bg-gray-100 dark:bg-gray-800/50',
    text: 'text-gray-600 dark:text-gray-400',
    bgLight: 'bg-muted',
  },
} as const;

export type ColorScheme = keyof typeof COLORS;

/**
 * HTTP method color mapping.
 */
export const METHOD_COLORS: Record<string, { bg: string; text: string }> = {
  GET: { bg: COLORS.success.bg, text: COLORS.success.text },
  POST: { bg: COLORS.info.bg, text: COLORS.info.text },
  PUT: { bg: COLORS.warning.bg, text: COLORS.warning.text },
  DELETE: { bg: COLORS.error.bg, text: COLORS.error.text },
  PATCH: { bg: COLORS.purple.bg, text: COLORS.purple.text },
};

/**
 * Icon size constants for consistent sizing.
 */
export const ICON_SIZES = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
} as const;

export type IconSize = keyof typeof ICON_SIZES;
