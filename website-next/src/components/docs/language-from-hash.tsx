'use client';

import { useLayoutEffect } from 'react';

/**
 * The tab group every quick start shares, with its two values. Fumadocs derives
 * a tab's value from its label, lowercased, and stores that.
 */
export const LANGUAGE_GROUP = 'language';
const PYTHON = 'python';
const TYPESCRIPT = 'typescript';

/**
 * Picks the language tabs from the URL hash, so a link can open a quick start
 * in Python (`/docs/quick-start#python`) or TypeScript (`#typescript`).
 *
 * Fumadocs reads a tab group's choice from sessionStorage when the tabs mount.
 * Layout effects run in tree order, so rendering this before the first
 * `<Tabs groupId="language">` sets the choice before any tab reads it. Anchors
 * that exist only in the Python tabs (`pythonAnchors`) select Python too.
 */
export function LanguageFromHash({ pythonAnchors = [] }: { pythonAnchors?: string[] }) {
  useLayoutEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1)).toLowerCase();
    if (!hash) return;
    if (hash === 'python' || pythonAnchors.includes(hash)) {
      sessionStorage.setItem(LANGUAGE_GROUP, PYTHON);
    } else if (hash === 'typescript') {
      sessionStorage.setItem(LANGUAGE_GROUP, TYPESCRIPT);
    }
  }, [pythonAnchors]);
  return null;
}
