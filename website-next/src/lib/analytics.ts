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

/**
 * Applies a consent decision to a running PostHog. Without consent PostHog
 * keeps its ids in memory only: nothing is stored on the device and no
 * session is recorded. With consent it may persist ids and record sessions.
 */
export function applyAnalyticsConsent(granted: boolean) {
  if (typeof window === 'undefined' || !posthog.__loaded) return;
  if (granted) {
    posthog.set_config({ persistence: 'localStorage+cookie' });
    posthog.startSessionRecording();
    return;
  }
  posthog.stopSessionRecording();
  posthog.set_config({ persistence: 'memory' });
  clearPostHogStorage();
}

/** Removes what PostHog stored while consent was granted. */
function clearPostHogStorage() {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith('ph_')) window.localStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable (private mode, blocked); nothing to clear then.
  }
  const { hostname } = window.location;
  const rootDomain = hostname.split('.').slice(-2).join('.');
  for (const cookie of document.cookie.split(/;\s*/)) {
    const name = cookie.split('=')[0];
    if (!name.startsWith('ph_')) continue;
    for (const domain of ['', `; domain=${hostname}`, `; domain=.${rootDomain}`]) {
      document.cookie = `${name}=; path=/${domain}; expires=Thu, 01 Jan 1970 00:00:01 GMT`;
    }
  }
}
