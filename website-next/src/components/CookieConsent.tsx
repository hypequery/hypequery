'use client';

import { useEffect } from 'react';
import * as CookieConsent from 'vanilla-cookieconsent';
import 'vanilla-cookieconsent/dist/cookieconsent.css';
import { applyAnalyticsConsent, consentChange } from '@/lib/analytics';
import { isLocalHostname } from '@/lib/local-host';
import './CookieConsent.css';

declare global {
  interface Window {
    ldfdr?: unknown;
    dataLayer?: unknown[];
  }
}

/**
 * Loads Google Analytics (gtag). Analytics category.
 * Idempotent: no-op if the tag is already on the page.
 */
function loadGoogleAnalytics(measurementId?: string) {
  if (!measurementId || document.getElementById('ga-src')) return;

  const src = document.createElement('script');
  src.id = 'ga-src';
  src.async = true;
  src.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(src);

  const inline = document.createElement('script');
  inline.id = 'ga-inline';
  inline.textContent = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${measurementId}');`;
  document.head.appendChild(inline);
}

/**
 * Loads Leadfeeder (company-level visitor identification). Marketing category.
 */
function loadLeadfeeder() {
  if (document.getElementById('leadfeeder')) return;

  const s = document.createElement('script');
  s.id = 'leadfeeder';
  s.textContent = `(function (ss, ex) {
  window.ldfdr =
    window.ldfdr ||
    function () {
      (ldfdr._q = ldfdr._q || []).push([].slice.call(arguments));
    };
  (function (d, s) {
    fs = d.getElementsByTagName(s)[0];
    function ce(src) {
      var cs = d.createElement(s);
      cs.src = src;
      cs.async = 1;
      fs.parentNode.insertBefore(cs, fs);
    }
    ce(
      "https://sc.lfeeder.com/lftracker_v1_" +
        ss +
        (ex ? "_" + ex : "") +
        ".js"
    );
  })(document, "script");
})("DzLR5a5lx1Z4BoQ2");`;
  document.head.appendChild(s);
}

/**
 * Consent banner (vanilla-cookieconsent). Gates optional analytics and
 * marketing trackers so they load only after the visitor opts in.
 */
export default function CookieConsentBanner({
  gaMeasurementId,
}: {
  gaMeasurementId?: string;
}) {
  useEffect(() => {
    void CookieConsent.run({
      guiOptions: {
        consentModal: { layout: 'box', position: 'bottom right' },
        preferencesModal: { layout: 'box' },
      },
      categories: {
        necessary: { enabled: true, readOnly: true },
        analytics: {},
        marketing: {},
      },
      // Applying withdrawn consent to an already-running script isn't possible
      // in-session, so reload to unload trackers when a category is turned off.
      onChange: ({ changedCategories }) => {
        const change = consentChange(changedCategories, (c) => CookieConsent.acceptedCategory(c));
        // Drop PostHog's stored ids before the reload restarts it cookieless.
        if (change.clearPostHog) applyAnalyticsConsent(false);
        if (change.reload) {
          window.location.reload();
          return;
        }
        applyConsent();
      },
      onConsent: () => applyConsent(),
      language: {
        default: 'en',
        translations: {
          en: {
            consentModal: {
              title: 'We value your privacy',
              description:
                'We measure visits and page usage with anonymous, cookieless analytics (Umami and PostHog). Analytics cookies, session recording and marketing trackers only run with your consent.',
              acceptAllBtn: 'Accept all',
              acceptNecessaryBtn: 'Reject all',
              showPreferencesBtn: 'Manage preferences',
            },
            preferencesModal: {
              title: 'Manage cookie preferences',
              acceptAllBtn: 'Accept all',
              acceptNecessaryBtn: 'Reject all',
              savePreferencesBtn: 'Save preferences',
              closeIconLabel: 'Close',
              sections: [
                {
                  title: 'Strictly necessary',
                  description:
                    'Required for the site to function (e.g. remembering your theme), plus anonymous, cookieless usage analytics (Umami and PostHog) that store nothing on your device. Always on.',
                  linkedCategory: 'necessary',
                },
                {
                  title: 'Analytics',
                  description:
                    'Google Analytics and PostHog, which use cookies to recognise returning visitors and, for PostHog, record sessions, to help us understand how visitors use the site.',
                  linkedCategory: 'analytics',
                },
                {
                  title: 'Marketing',
                  description:
                    'Helps us understand which organizations visit the site and measure interest in our products.',
                  linkedCategory: 'marketing',
                },
              ],
            },
          },
        },
      },
    });

    function applyConsent() {
      // PostHog is already running cookieless; consent lets it persist ids and
      // record sessions. A no-op wherever PostHog did not start.
      if (CookieConsent.acceptedCategory('analytics')) applyAnalyticsConsent(true);
      // Never load trackers during local development, whatever was consented.
      if (isLocalHostname(window.location.hostname)) return;
      if (CookieConsent.acceptedCategory('analytics')) {
        loadGoogleAnalytics(gaMeasurementId);
      }
      if (CookieConsent.acceptedCategory('marketing')) {
        loadLeadfeeder();
      }
    }
  }, [gaMeasurementId]);

  return null;
}
