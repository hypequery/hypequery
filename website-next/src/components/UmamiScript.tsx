'use client';

import { useSyncExternalStore } from 'react';
import Script from 'next/script';
import { isLocalHostname } from '@/lib/local-host';

// The hostname never changes during a page's lifetime, so there is nothing to subscribe to.
const subscribe = () => () => {};
const isTrackedHost = () => !isLocalHostname(window.location.hostname);
// The server cannot know the visitor's hostname; render nothing until hydration.
const isTrackedHostOnServer = () => false;

/**
 * Loads Umami everywhere except local development. The hostname is only known
 * in the browser, so the check runs client-side rather than making the root
 * layout dynamic.
 */
export default function UmamiScript() {
  const enabled = useSyncExternalStore(subscribe, isTrackedHost, isTrackedHostOnServer);
  if (!enabled) return null;

  return (
    <Script
      defer
      src="https://cloud.umami.is/script.js"
      data-website-id="a1b133a2-bf0a-4260-9c2c-f76a2a20359f"
      strategy="afterInteractive"
    />
  );
}
