'use client';

import { useEffect } from 'react';
import { classifyCopiedCode } from '@/lib/code-copy';
import { trackUmamiEvent } from '@/lib/umami';

/**
 * Sends a `code_copy` event when someone copies from a code block, either with
 * the Fumadocs copy button (docs) or by selecting text inside a <pre> (docs and
 * blog). Listens at the document so no code block component needs changing.
 */
export function CodeCopyTracker() {
  useEffect(() => {
    const track = (text: string, method: 'button' | 'selection') => {
      if (text.trim() === '') return;
      trackUmamiEvent('code_copy', {
        ...classifyCopiedCode(text),
        method,
        page: window.location.pathname,
      });
    };

    const onClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest?.('figure button');
      if (!button || button.getAttribute('role') === 'tab') return;
      const pre = button.closest('figure')?.querySelector('pre');
      if (pre) track(pre.textContent ?? '', 'button');
    };

    const onCopy = () => {
      const selection = document.getSelection();
      const anchor = selection?.anchorNode;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      if (selection && element?.closest('pre')) track(selection.toString(), 'selection');
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('copy', onCopy);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('copy', onCopy);
    };
  }, []);

  return null;
}
