import type { Metadata } from 'next';
import Link from 'next/link';
import Footer from '@/components/Footer';
import Navigation from '@/components/Navigation';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Get in touch with the hypequery team — book a call, open a GitHub issue, or reach out on X.',
  alternates: {
    canonical: absoluteUrl('/contact-us'),
  },
  openGraph: {
    images: ogImage('Contact hypequery'),
    type: 'website',
    url: absoluteUrl('/contact-us'),
    title: 'Contact | hypequery',
    description:
      'Get in touch with the hypequery team — book a call, open a GitHub issue, or reach out on X.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Contact | hypequery',
    description:
      'Get in touch with the hypequery team — book a call, open a GitHub issue, or reach out on X.',
  },
};

const channels = [
  {
    title: 'Book a call',
    copy: 'Talk through your architecture, migration questions, or whether hypequery fits your stack. 30 minutes, no pitch.',
    href: 'https://cal.com/luke-reilly-jdi9su/hypequery-chat',
    label: 'Pick a time',
    external: true,
    track: 'book_call',
  },
  {
    title: 'GitHub',
    copy: 'Bug reports, feature requests, and questions about the library live in the open on GitHub.',
    href: 'https://github.com/hypequery/hypequery/issues',
    label: 'Open an issue',
    external: true,
    track: 'github_issues',
  },
  {
    title: 'X / Twitter',
    copy: 'Quick questions and release updates. DMs are open.',
    href: 'https://x.com/hypequery',
    label: 'Message @hypequery',
    external: true,
    track: 'twitter',
  },
];

export default function ContactUsPage() {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-bg pt-28 text-text">
        <section className="mx-auto max-w-7xl px-4 py-20 lg:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">Contact</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-tight text-text sm:text-6xl">
            Talk to the team behind hypequery
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-text-muted">
            Evaluating hypequery for your ClickHouse stack, stuck on an integration, or comparing it
            against Cube, Tinybird, or a hand-rolled layer? Pick whichever channel suits you.
          </p>

          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {channels.map((channel) => (
              <div key={channel.title} className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
                <h2 className="text-xl font-semibold text-text">{channel.title}</h2>
                <p className="mt-3 text-sm leading-7 text-text-muted">{channel.copy}</p>
                <a
                  href={channel.href}
                  target="_blank"
                  rel="noreferrer"
                  data-umami-event="cta_click"
                  data-umami-event-target={channel.track}
                  data-umami-event-location="contact_page"
                  className="mt-6 inline-flex items-center border border-border-strong px-5 py-3 text-sm font-semibold text-text transition hover:bg-bg-alt"
                >
                  {channel.label} →
                </a>
              </div>
            ))}
          </div>

          <div className="mt-12 rounded-lg border border-border bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">
                Just exploring?
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-text">
                The quick start answers most questions
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-text-muted">
                Generate types from your ClickHouse schema and run your first typed query in a few
                minutes — often faster than scheduling a call.
              </p>
            </div>
            <div className="mt-6 md:mt-0">
              <Link
                href="/docs/quick-start"
                data-umami-event="cta_click"
                data-umami-event-target="docs_quick_start"
                data-umami-event-location="contact_page"
                className="inline-flex items-center bg-text px-5 py-3 text-sm font-semibold text-bg transition hover:opacity-90"
              >
                Open quick start
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
