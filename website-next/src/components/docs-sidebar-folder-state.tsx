'use client';

import { useEffect, useRef } from 'react';
import { useFolder } from 'fumadocs-ui/components/sidebar/base';

const STORAGE_PREFIX = 'hq-docs-sidebar:';

function readOpen(id: string): boolean | undefined {
  try {
    const saved = sessionStorage.getItem(STORAGE_PREFIX + id);
    return saved === null ? undefined : saved === '1';
  } catch {
    return undefined;
  }
}

function writeOpen(id: string, open: boolean) {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + id, open ? '1' : '0');
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); the sidebar still works.
  }
}

/**
 * A sidebar folder's label that keeps the folder open or closed for the browser
 * session. Fumadocs holds a folder's open state inside the folder, so this reads
 * and sets it through the folder's context, which the label renders inside.
 * A saved state always wins, even for the folder holding the current page;
 * without one, the folder keeps Fumadocs' default (open when it holds the
 * current page or its meta.json sets defaultOpen). Navigating into a closed
 * folder still opens it, and that is saved like any other change.
 */
export function PersistedFolderLabel({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const folder = useFolder();
  const previous = useRef<boolean | undefined>(undefined);
  const open = folder?.open;
  const setOpen = folder?.setOpen;

  useEffect(() => {
    if (!setOpen) return;
    const saved = readOpen(id);
    if (saved === undefined) return;
    setOpen(saved);
    // Restore once, on mount; later changes come from the user or navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (open === undefined) return;
    // Save only a change: the folder's initial state, seen before the saved state is
    // restored (and again when React re-runs effects in development), must not
    // overwrite what was saved.
    if (previous.current !== undefined && previous.current !== open) writeOpen(id, open);
    previous.current = open;
  }, [id, open]);

  return <>{children}</>;
}
