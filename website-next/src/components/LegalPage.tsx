import type { ReactNode } from 'react';
import Footer from '@/components/Footer';
import Navigation from '@/components/Navigation';
import { formatLongDate } from '@/lib/format-date';

type LegalPageProps = {
  eyebrow: string;
  title: string;
  /** Last substantive update (YYYY-MM-DD), from src/data/page-dates.ts. */
  updated: string;
  children: ReactNode;
};

/** Shared layout for the privacy policy and terms: one readable column of plain prose. */
export default function LegalPage({ eyebrow, title, updated, children }: LegalPageProps) {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-bg pt-28 text-text">
        <article className="mx-auto max-w-3xl px-4 py-20 lg:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">{eyebrow}</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-text sm:text-5xl">{title}</h1>
          <p className="mt-4 text-sm text-text-dim">
            Last updated: <time dateTime={updated}>{formatLongDate(updated)}</time>
          </p>
          <div
            className={[
              'mt-10 text-base leading-7 text-text-muted',
              '[&_h2]:mt-12 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-text',
              '[&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text',
              '[&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6',
              '[&_strong]:font-semibold [&_strong]:text-text',
              '[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2',
              '[&_table]:mt-4 [&_table]:w-full [&_table]:text-left [&_table]:text-sm',
              '[&_th]:border-b [&_th]:border-border [&_th]:py-2 [&_th]:pr-4 [&_th]:font-semibold [&_th]:text-text',
              '[&_td]:border-b [&_td]:border-border [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top',
            ].join(' ')}
          >
            {children}
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}
