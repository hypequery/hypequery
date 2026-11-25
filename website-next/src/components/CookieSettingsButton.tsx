'use client';

import * as CookieConsent from 'vanilla-cookieconsent';

/**
 * Reopens the cookie preferences dialog after the banner has been answered, so
 * visitors can change their consent at any time, as the privacy policy says.
 */
export default function CookieSettingsButton() {
  return (
    <button
      type="button"
      onClick={() => CookieConsent.showPreferences()}
      className="text-xs text-text-dim transition hover:text-text"
    >
      Cookie settings
    </button>
  );
}
