'use client';

import { useEffect, useRef } from 'react';

/** Keeps a scrolling panel pinned to its newest content, like a real chat. Change `key` when content is added. */
export function useFollow(key: number, reduced: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [key, reduced]);
  return ref;
}
