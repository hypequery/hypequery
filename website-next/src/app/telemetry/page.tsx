import type { Metadata } from 'next';
import Link from 'next/link';
import Footer from '@/components/Footer';
import Navigation from '@/components/Navigation';
import { absoluteUrl, ogImage } from '@/lib/site';

const description =
  'What the hypequery playground collects, what it never collects, and how to turn it off. Anonymous, opt-out, and off by default until you enable it.';

export const metadata: Metadata = {
  title: 'Telemetry',
  description,
  alternates: {
    canonical: absoluteUrl('/telemetry'),
  },
  openGraph: {
    images: ogImage('hypequery telemetry'),
    type: 'website',
    url: absoluteUrl('/telemetry'),
    title: 'Telemetry | hypequery',
    description,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Telemetry | hypequery',
    description,
  },
};

const collected = [
  'An anonymous, randomly generated machine ID (a UUID stored in ~/.hypequery/telemetry.json). It is not tied to you, your account, or your network.',
  'A one-way hash of your project directory path — enough to count distinct projects, never enough to recover the path.',
  'Anonymous feature events: that the gateway started, that the playground UI was opened, that a query ran, that history was cleared.',
  'Hashed endpoint identifiers and bucketed durations (for example “<250ms” or “<5s”) so we can see rough activity without exact timings.',
  'Coarse environment context: your Node.js major version and operating system platform (for example “darwin”).',
];

const neverCollected = [
  'Your SQL, queries, or query names in readable form.',
  'Query inputs, parameters, or results — no rows, no data, ever.',
  'Hostnames, connection strings, file paths, environment variables, or credentials.',
  'IP-derived identity, account details, or anything that identifies you personally.',
];

const optOuts = [
  {
    label: 'Per run',
    code: 'hypequery dev --no-telemetry',
    copy: 'A one-off flag that hard-disables telemetry for that command, regardless of any other setting.',
  },
  {
    label: 'Persistent',
    code: 'HYPEQUERY_TELEMETRY_DISABLED=1',
    copy: 'Set this environment variable in your shell profile or CI to disable telemetry everywhere.',
  },
  {
    label: 'Universal',
    code: 'DO_NOT_TRACK=1',
    copy: 'We honor the cross-tool Do Not Track convention. If you already set this, telemetry is off.',
  },
];

export default function TelemetryPage() {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-bg pt-28 text-text">
        <section className="mx-auto max-w-4xl px-4 py-20 lg:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">Telemetry</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-text sm:text-5xl">
            Anonymous, opt-out, and off by default
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-text-muted">
            The experimental hypequery playground (<code className="rounded bg-bg-alt px-1.5 py-0.5 text-sm">hypequery
            dev --ui-experimental</code>) can send anonymous usage events so we can tell whether it&apos;s worth
            investing in. It captures no queries, schemas, or data — only which features get used. This page is the
            full, honest account of what that means.
          </p>

          <div className="mt-8 rounded-lg border border-border bg-bg-card p-6 shadow-card">
            <p className="text-sm leading-7 text-text-muted">
              <span className="font-semibold text-text">Experimental UI only.</span> This telemetry belongs to the
              opt-in local playground launched with{' '}
              <code className="rounded bg-bg-alt px-1.5 py-0.5 text-xs">hypequery dev --ui-experimental</code>, and is
              not part of the standard <code className="rounded bg-bg-alt px-1.5 py-0.5 text-xs">hypequery dev</code>{' '}
              experience.
            </p>
            <p className="mt-3 text-sm leading-7 text-text-muted">
              <span className="font-semibold text-text">Currently dormant.</span> No ingest endpoint ships in the
              published packages, so telemetry is a complete no-op today — nothing is sent no matter your settings.
              When an endpoint is configured in a future release, the first run that would send anything prints a
              one-time notice in your terminal first. Telemetry is automatically disabled in CI.
            </p>
          </div>

          <h2 className="mt-16 text-2xl font-semibold text-text">What&apos;s collected</h2>
          <ul className="mt-6 space-y-3">
            {collected.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-7 text-text-muted">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h2 className="mt-16 text-2xl font-semibold text-text">What&apos;s never collected</h2>
          <ul className="mt-6 space-y-3">
            {neverCollected.map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-7 text-text-muted">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-border-strong" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-3xl text-sm leading-7 text-text-muted">
            These rules are enforced in code, not just promised: events are validated against an allowlist, names are
            hashed, and durations are bucketed before anything leaves your machine. The browser UI only ever talks to
            your own local dev server — never a third party. Delivery is fire-and-forget with a short timeout, so it
            can never slow down or break your dev server.
          </p>

          <h2 className="mt-16 text-2xl font-semibold text-text">How to turn it off</h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-text-muted">
            Any one of these disables telemetry. There&apos;s no precedence to remember — the first that applies wins.
          </p>
          <div className="mt-6 space-y-4">
            {optOuts.map((opt) => (
              <div key={opt.code} className="rounded-lg border border-border bg-bg-card p-5 shadow-card">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">{opt.label}</p>
                <pre className="mt-3 overflow-x-auto rounded bg-bg-alt px-4 py-3 text-sm text-text">
                  <code>{opt.code}</code>
                </pre>
                <p className="mt-3 text-sm leading-7 text-text-muted">{opt.copy}</p>
              </div>
            ))}
          </div>

          <div className="mt-16 rounded-lg border border-border bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">Questions?</p>
              <h2 className="mt-3 text-2xl font-semibold text-text">The code is open — read it or ask us</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-text-muted">
                The full implementation lives in the open. If anything here is unclear, open an issue and we&apos;ll
                answer it.
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-3 md:mt-0">
              <a
                href="https://github.com/hypequery/hypequery/issues"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center border border-border-strong px-5 py-3 text-sm font-semibold text-text transition hover:bg-bg-alt"
              >
                Open an issue →
              </a>
              <Link
                href="/contact-us"
                className="inline-flex items-center justify-center bg-text px-5 py-3 text-sm font-semibold text-bg transition hover:opacity-90"
              >
                Contact the team
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
