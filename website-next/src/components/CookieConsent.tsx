'use client';

import { useEffect } from 'react';
import * as CookieConsent from 'vanilla-cookieconsent';
import 'vanilla-cookieconsent/dist/cookieconsent.css';

declare global {
  interface Window {
    reb2b?: unknown;
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
 * Loads reb2b (person-level visitor de-anonymization). Marketing category.
 */
function loadReb2b() {
  if (window.reb2b || document.getElementById('reb2b')) return;

  const s = document.createElement('script');
  s.id = 'reb2b';
  s.textContent = `!function(key){if(window.reb2b)return;window.reb2b={loaded:true};var s=document.createElement("script");s.async=true;s.src="https://ddwl4m2hdecbv.cloudfront.net/b/"+key+"/"+key+".js.gz";document.getElementsByTagName("script")[0].parentNode.insertBefore(s,document.getElementsByTagName("script")[0]);}("QOQRJHK1W462");`;
  document.head.appendChild(s);
}

/**
 * Consent banner (vanilla-cookieconsent). Gates the trackers that set cookies
 * or identify individuals — GA (analytics) and Leadfeeder + reb2b (marketing) —
 * so they only load after the visitor opts in. Umami is cookieless and
 * consent-exempt, so it stays in the root layout and is not managed here.
 */
export default function CookieConsentBanner({
  gaMeasurementId,
}: {
  gaMeasurementId?: string;
}) {
  useEffect(() => {
    void CookieConsent.run({
      guiOptions: {
        consentModal: { layout: 'box wide', position: 'bottom left' },
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
        const removed = changedCategories.some(
          (c) => (c === 'analytics' || c === 'marketing') && !CookieConsent.acceptedCategory(c),
        );
        if (removed) {
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
                'We use cookies and similar tools to understand traffic and improve the site. Analytics and marketing trackers only run with your consent.',
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
                    'Required for the site to function (e.g. remembering your theme). Always on.',
                  linkedCategory: 'necessary',
                },
                {
                  title: 'Analytics',
                  description:
                    'Google Analytics — helps us understand how the site is used. Umami, our cookieless analytics, runs without consent and is not covered here.',
                  linkedCategory: 'analytics',
                },
                {
                  title: 'Marketing',
                  description:
                    'Leadfeeder and reb2b identify visiting organizations and individuals so we can follow up. Loads only with your consent.',
                  linkedCategory: 'marketing',
                },
              ],
            },
          },
        },
      },
    });

    function applyConsent() {
      if (CookieConsent.acceptedCategory('analytics')) {
        loadGoogleAnalytics(gaMeasurementId);
      }
      if (CookieConsent.acceptedCategory('marketing')) {
        loadLeadfeeder();
        loadReb2b();
      }
    }
  }, [gaMeasurementId]);

  return null;
}
