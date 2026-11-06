'use client';

import { useEffect } from 'react';
import { classifyCopiedCode } from '@/lib/code-copy';
import { trackUmamiEvent } from '@/lib/umami';

// Fumadocs sets data-checked on the copy button once the clipboard write
// succeeds, then clears it about 1.5s later. Stop waiting well after that.
const COPY_CONFIRM_TIMEOUT_MS = 3000;

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

    // Count a button copy only once the button reports success, so a denied or
    // failed clipboard write is not recorded (InstallCommand does the same).
    const trackWhenConfirmed = (button: Element, text: string) => {
      const observer = new MutationObserver(() => {
        if (!button.hasAttribute('data-checked')) return;
        observer.disconnect();
        window.clearTimeout(timeout);
        track(text, 'button');
      });
      const timeout = window.setTimeout(() => observer.disconnect(), COPY_CONFIRM_TIMEOUT_MS);
      observer.observe(button, { attributes: true, attributeFilter: ['data-checked'] });
    };

    const onClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest?.('figure button');
      if (!button || button.getAttribute('role') === 'tab') return;
      const pre = button.closest('figure')?.querySelector('pre');
      if (pre) trackWhenConfirmed(button, pre.textContent ?? '');
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
