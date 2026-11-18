import posthog from 'posthog-js';
import { trackUmamiEvent } from '@/lib/umami';

/**
 * PostHog product analytics for the marketing site.
 *
 * The website and hypequery Cloud send to the same PostHog project so a
 * visitor can be followed from the site into the product. Every event carries
 * `app`, which is how the two are told apart in insights.
 */
export const ANALYTICS_APP = 'website';

/**
 * PostHog's block class. Session replay renders an element with this class as
 * an empty placeholder and records nothing inside it; autocapture ignores it
 * too. The CMS root carries it so editor screens and unpublished previews
 * never reach a recording, however the editor navigates there.
 */
export const NO_CAPTURE_CLASS = 'ph-no-capture';

/** vanilla-cookieconsent's cookie: URL-encoded JSON with the accepted categories. */
const CONSENT_COOKIE = 'cc_cookie';

type EventPayload = Record<string, string | number | boolean | null | undefined>;

/**
 * Whether the visitor accepted the Analytics category. Read straight from the
 * consent cookie because PostHog starts before the consent banner hydrates.
 */
export function hasAnalyticsConsent(cookies: string = document.cookie): boolean {
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=([^;]+)`));
  if (!match) return false;
  try {
    const consent: unknown = JSON.parse(decodeURIComponent(match[1]));
    const categories = (consent as { categories?: unknown } | null)?.categories;
    return Array.isArray(categories) && categories.includes('analytics');
  } catch {
    return false;
  }
}

/** The part of the site a path belongs to, for breaking down what visitors read. */
export function pageSection(pathname: string): string {
  if (pathname === '/') return 'home';
  const [first] = pathname.split('/').filter(Boolean);
  if (first === 'docs') return 'docs';
  if (first === 'blog') return 'blog';
  if (first === 'compare' || first.endsWith('-alternative')) return 'compare';
  if (first === 'use-cases') return 'use_cases';
  if (first === 'examples') return 'examples';
  if (first === 'contact-us') return 'contact';
  if (first === 'cms') return 'cms';
  return 'landing';
}

/**
 * Sends a custom event to Umami and PostHog. PostHog is skipped until it has
 * started, which it never does on local hosts or without a project token.
 */
export function trackEvent(eventName: string, payload?: EventPayload) {
  trackUmamiEvent(eventName, payload);
  capturePostHogEvent(eventName, payload);
}

/** PostHog only, for events Umami already receives another way. */
export function capturePostHogEvent(eventName: string, payload?: EventPayload) {
  if (typeof window === 'undefined' || !posthog.__loaded) return;
  posthog.capture(eventName, payload);
}

export type ConsentChange = { reload: boolean; clearPostHog: boolean; apply: boolean };

/**
 * What to do when the visitor changes cookie preferences. Turning a tracking
 * category off reloads the page so trackers unload; if Analytics was turned
 * off, PostHog's stored ids are cleared first. Anything else is applied live.
 */
export function consentChange(
  changedCategories: readonly string[],
  isAccepted: (category: string) => boolean,
): ConsentChange {
  const removed = changedCategories.some(
    (c) => (c === 'analytics' || c === 'marketing') && !isAccepted(c),
  );
  if (!removed) return { reload: false, clearPostHog: false, apply: true };
  return { reload: true, clearPostHog: !isAccepted('analytics'), apply: false };
}

/** The parts of PostHog that consent changes touch. */
export type ConsentClient = Pick<
  typeof posthog,
  '__loaded' | 'set_config' | 'startSessionRecording' | 'stopSessionRecording'
>;

/** Where PostHog keeps ids on the device. Injected so tests can use fakes. */
export interface DeviceStorage {
  hostname: string;
  /** Returns the storage, or throws if it is unavailable (private mode, blocked). */
  localStorage: () => Pick<Storage, 'removeItem'> & { keys: () => string[] };
  sessionStorage: () => Pick<Storage, 'removeItem'> & { keys: () => string[] };
  readCookies: () => string;
  writeCookie: (cookie: string) => void;
}

function browserStorage(kind: 'localStorage' | 'sessionStorage') {
  return () => {
    const storage = window[kind];
    return { removeItem: (key: string) => storage.removeItem(key), keys: () => Object.keys(storage) };
  };
}

function browserDevice(): DeviceStorage {
  return {
    hostname: window.location.hostname,
    localStorage: browserStorage('localStorage'),
    sessionStorage: browserStorage('sessionStorage'),
    readCookies: () => document.cookie,
    writeCookie: (cookie) => {
      document.cookie = cookie;
    },
  };
}

/**
 * Applies a consent decision to a running PostHog. Without consent PostHog
 * keeps its ids in memory only: nothing is stored on the device and no
 * session is recorded. With consent it may persist ids and record sessions.
 */
export function applyAnalyticsConsent(
  granted: boolean,
  client: ConsentClient = posthog,
  device?: DeviceStorage,
) {
  if (typeof window === 'undefined' && !device) return;
  if (!client.__loaded) return;
  if (granted) {
    client.set_config({ persistence: 'localStorage+cookie' });
    client.startSessionRecording();
    return;
  }
  // Stop recording and switch to memory first, so nothing is written back
  // after the stored ids are cleared.
  client.stopSessionRecording();
  client.set_config({ persistence: 'memory' });
  clearPostHogStorage(device ?? browserDevice());
}

/** Removes what PostHog stored while consent was granted. */
export function clearPostHogStorage(device: DeviceStorage) {
  for (const open of [device.localStorage, device.sessionStorage]) {
    try {
      const storage = open();
      for (const key of storage.keys()) {
        if (key.startsWith('ph_')) storage.removeItem(key);
      }
    } catch {
      // Storage can be unavailable (private mode, blocked); nothing to clear then.
    }
  }
  const { hostname } = device;
  const rootDomain = hostname.split('.').slice(-2).join('.');
  for (const cookie of device.readCookies().split(/;\s*/)) {
    const name = cookie.split('=')[0];
    if (!name.startsWith('ph_')) continue;
    for (const domain of ['', `; domain=${hostname}`, `; domain=.${rootDomain}`]) {
      device.writeCookie(`${name}=; path=/${domain}; expires=Thu, 01 Jan 1970 00:00:01 GMT`);
    }
  }
}
