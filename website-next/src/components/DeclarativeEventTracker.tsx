'use client';

import { useEffect } from 'react';
import { capturePostHogEvent } from '@/lib/analytics';

const EVENT_ATTRIBUTE = 'data-umami-event';
const PROPERTY_PREFIX = `${EVENT_ATTRIBUTE}-`;

/**
 * Sends the site's declarative click events to PostHog as well. Links and
 * buttons name their event with `data-umami-event` (and its properties with
 * `data-umami-event-*`), which Umami's script reads on its own. Listening at
 * the document mirrors every one of them without touching each element.
 */
export function DeclarativeEventTracker() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const element = (event.target as Element | null)?.closest?.(`[${EVENT_ATTRIBUTE}]`);
      const name = element?.getAttribute(EVENT_ATTRIBUTE);
      if (!element || !name) return;
      const properties: Record<string, string> = { page: window.location.pathname };
      for (const { name: attribute, value } of Array.from(element.attributes)) {
        if (attribute.startsWith(PROPERTY_PREFIX)) {
          properties[attribute.slice(PROPERTY_PREFIX.length).replaceAll('-', '_')] = value;
        }
      }
      capturePostHogEvent(name, properties);
    };

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return null;
}
