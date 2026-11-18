import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  applyAnalyticsConsent,
  clearPostHogStorage,
  consentChange,
  hasAnalyticsConsent,
  pageSection,
  NO_CAPTURE_CLASS,
  type ConsentClient,
  type DeviceStorage,
} from './analytics';

const consentCookie = (categories: unknown) =>
  `theme=dark; cc_cookie=${encodeURIComponent(JSON.stringify({ categories, revision: 0 }))}; other=1`;

test('hasAnalyticsConsent is false without a consent cookie', () => {
  assert.equal(hasAnalyticsConsent(''), false);
  assert.equal(hasAnalyticsConsent('theme=dark; other=1'), false);
});

test('hasAnalyticsConsent is false for a malformed consent cookie', () => {
  assert.equal(hasAnalyticsConsent('cc_cookie=%7Bnot-json'), false);
  assert.equal(hasAnalyticsConsent('cc_cookie=%E0%A4%A'), false); // bad URI escape
  assert.equal(hasAnalyticsConsent(`cc_cookie=${encodeURIComponent('null')}`), false);
  assert.equal(hasAnalyticsConsent(consentCookie('analytics')), false); // not an array
});

test('hasAnalyticsConsent reads the accepted categories', () => {
  assert.equal(hasAnalyticsConsent(consentCookie(['necessary'])), false);
  assert.equal(hasAnalyticsConsent(consentCookie(['necessary', 'analytics'])), true);
  // A cookie whose name merely ends in cc_cookie is not the consent cookie.
  assert.equal(hasAnalyticsConsent(`xcc_cookie=${encodeURIComponent(JSON.stringify({ categories: ['analytics'] }))}`), false);
});

test('pageSection groups paths', () => {
  assert.equal(pageSection('/'), 'home');
  assert.equal(pageSection('/docs/quick-start'), 'docs');
  assert.equal(pageSection('/cube-alternative'), 'compare');
  assert.equal(pageSection('/cms/posts'), 'cms');
  assert.equal(pageSection('/embedded-analytics'), 'landing');
});

function fakeClient(loaded = true) {
  const calls: string[] = [];
  const client: ConsentClient = {
    __loaded: loaded,
    set_config: (config) => void calls.push(`set_config:${config.persistence}`),
    startSessionRecording: () => void calls.push('startSessionRecording'),
    stopSessionRecording: () => void calls.push('stopSessionRecording'),
  } as ConsentClient;
  return { client, calls };
}

function fakeStore(keys: string[], available = true) {
  const store = new Set(keys);
  return {
    store,
    open: () => {
      if (!available) throw new Error('SecurityError: storage disabled');
      return { keys: () => [...store], removeItem: (key: string) => void store.delete(key) };
    },
  };
}

function fakeDevice({ localAvailable = true } = {}) {
  const local = fakeStore(['ph_phc_x_posthog', 'theme', 'ph_phc_x_window_id'], localAvailable);
  const session = fakeStore(['ph_phc_x_window_id', 'ph_phc_x_primary_window_exists', 'draft']);
  const written: string[] = [];
  const device: DeviceStorage = {
    hostname: 'www.hypequery.com',
    localStorage: local.open,
    sessionStorage: session.open,
    readCookies: () => 'ph_phc_x_posthog=abc; cc_cookie=1; theme=dark',
    writeCookie: (cookie) => void written.push(cookie),
  };
  return { device, local: local.store, session: session.store, written };
}

test('granting consent persists ids and starts recording', () => {
  const { client, calls } = fakeClient();
  const { device, local, written } = fakeDevice();
  applyAnalyticsConsent(true, client, device);
  assert.deepEqual(calls, ['set_config:localStorage+cookie', 'startSessionRecording']);
  assert.equal(local.size, 3);
  assert.equal(written.length, 0);
});

test('withdrawing consent stops recording before clearing stored ids', () => {
  const { client, calls } = fakeClient();
  const { device, local, session, written } = fakeDevice();
  applyAnalyticsConsent(false, client, device);
  assert.deepEqual(calls, ['stopSessionRecording', 'set_config:memory']);
  assert.deepEqual([...local], ['theme']);
  assert.deepEqual([...session], ['draft']);
  assert.equal(written.length, 3);
  assert.ok(written.every((c) => c.startsWith('ph_phc_x_posthog=;') && c.includes('expires=Thu, 01 Jan 1970')));
  assert.ok(written.some((c) => c.includes('domain=.hypequery.com')));
});

test('withdrawing consent still clears cookies and session storage when local storage is unavailable', () => {
  const { client } = fakeClient();
  const { device, session, written } = fakeDevice({ localAvailable: false });
  assert.doesNotThrow(() => applyAnalyticsConsent(false, client, device));
  assert.deepEqual([...session], ['draft']);
  assert.equal(written.length, 3);
});

test('consent changes are a no-op when PostHog never started', () => {
  const { client, calls } = fakeClient(false);
  const { device, local } = fakeDevice();
  applyAnalyticsConsent(false, client, device);
  applyAnalyticsConsent(true, client, device);
  assert.deepEqual(calls, []);
  assert.equal(local.size, 3);
});

test('clearPostHogStorage leaves non-PostHog cookies alone', () => {
  const { device, written } = fakeDevice();
  clearPostHogStorage(device);
  assert.ok(written.every((c) => c.startsWith('ph_')));
});

test('turning Analytics off in preferences reloads and clears PostHog', () => {
  const accepted = new Set(['necessary', 'marketing']);
  assert.deepEqual(consentChange(['analytics'], (c) => accepted.has(c)), { reload: true, clearPostHog: true, apply: false });
});

test('turning only Marketing off reloads but keeps PostHog ids', () => {
  const accepted = new Set(['necessary', 'analytics']);
  assert.deepEqual(consentChange(['marketing'], (c) => accepted.has(c)), { reload: true, clearPostHog: false, apply: false });
});

test('turning Analytics on is applied without a reload', () => {
  const accepted = new Set(['necessary', 'analytics']);
  assert.deepEqual(consentChange(['analytics'], (c) => accepted.has(c)), { reload: false, clearPostHog: false, apply: true });
});

test('the CMS root is blocked from session replay', () => {
  assert.equal(NO_CAPTURE_CLASS, 'ph-no-capture'); // posthog-js recorder blockClass
  const layout = readFileSync(new URL('../app/cms/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /<div className=\{`\$\{NO_CAPTURE_CLASS\} min-h-screen/);
});
