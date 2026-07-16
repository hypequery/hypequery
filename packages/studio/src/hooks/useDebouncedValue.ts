import { useEffect, useState } from 'react';

/**
 * Returns `value` after it has been stable for `delayMs`. Used to keep
 * fast-changing inputs (e.g. search text) from firing an API request on
 * every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
