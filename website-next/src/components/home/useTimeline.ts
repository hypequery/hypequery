'use client';

import { useEffect, useState } from 'react';

/** Elapsed milliseconds since `active` became true, ticking until `done`. */
export function useTimeline(active: boolean, reduced: boolean, done: number) {
  const [elapsed, setElapsed] = useState(0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!active || reduced) return;
    const start = performance.now();
    const timer = window.setInterval(() => {
      const next = performance.now() - start;
      setElapsed(next);
      if (next >= done) window.clearInterval(timer);
    }, 40);
    return () => window.clearInterval(timer);
  }, [active, reduced, done, run]);

  return {
    // Reduced motion shows the finished state straight away.
    elapsed: reduced ? done : elapsed,
    replay: () => {
      setElapsed(0);
      setRun((value) => value + 1);
    },
  };
}
