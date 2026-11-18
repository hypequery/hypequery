import posthog from 'posthog-js';
import { ANALYTICS_APP, hasAnalyticsConsent, pageSection } from '@/lib/analytics';
import { isLocalHostname } from '@/lib/local-host';

/**
 * Starts PostHog before the app becomes interactive.
 *
 * Captured automatically: pageviews on every route change, page leaves (time
 * on page and scroll depth), clicks and form submits (autocapture), rage and
 * dead clicks, heatmaps and web vitals.
 *
 * Consent: without the Analytics category PostHog runs cookieless (ids in
 * memory, no session recording), the same footing as Umami. Accepting
 * Analytics lets it persist ids and record sessions; CookieConsentBanner
 * applies changes made after load.
 */
const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
// Local development stays out of production metrics unless this is set.
const captureLocal = process.env.NEXT_PUBLIC_POSTHOG_CAPTURE_LOCAL === 'true';
const environment = process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV;

if (!token) {
  if (process.env.NODE_ENV === 'development') {
    console.warn(
      'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured',
    );
  }
} else if (captureLocal || !isLocalHostname(window.location.hostname)) {
  try {
    const consented = hasAnalyticsConsent();
    posthog.init(token, {
      api_host: host,
      // Links from PostHog (toolbar, heatmaps) still work when `host` is a reverse proxy.
      ui_host: 'https://us.posthog.com',
      defaults: '2026-08-30',
      // Anonymous visitors stay anonymous events; nobody is identified on this site.
      person_profiles: 'identified_only',
      persistence: consented ? 'localStorage+cookie' : 'memory',
      disable_session_recording: !consented,
      capture_dead_clicks: true,
      before_send: (event) => {
        if (!event) return null;
        const { pathname } = window.location;
        const section = pageSection(pathname);
        // The CMS is our own admin tool, not visitor behaviour.
        if (section === 'cms') return null;
        event.properties = {
          ...event.properties,
          app: ANALYTICS_APP,
          environment,
          page_section: section,
        };
        return event;
      },
    });
  } catch (error) {
    console.error('PostHog failed to start', error);
  }
}
