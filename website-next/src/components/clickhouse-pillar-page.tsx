import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import CodeWindow from '@/components/CodeWindow';
import { RichText } from '@/components/RichText';
import { DeployWaitlist } from '@/components/home/DeployWaitlist';
import { OpenSourceBadge } from '@/components/home/OpenSourceBadge';
import { SetupCommand, type Language } from '@/components/home/SetupCommand';
import { marketing } from '@/components/ui/marketing';

type LinkItem = {
  href: string;
  label: string;
};

function ctaTarget(href: string) {
  const path = href.replace(/^https?:\/\//, '').replace(/[#?].*$/, '');
  return path.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/_+$/, '') || 'home';
}

type Card = {
  title: string;
  copy: string;
};

type Stat = {
  label: string;
  value: string;
};

type CodePanel = {
  eyebrow: string;
  title: string;
  description: string;
  code: string;
  /** Defaults to a name built from the section eyebrow, with the page language's extension. */
  filename?: string;
  /** Highlighting language. Defaults to the page language; set 'bash' or 'tsx' for other snippets. */
  language?: string;
};

const EXTENSIONS: Record<Language, string> = { typescript: 'ts', python: 'py' };

function panelFilename(panel: CodePanel, eyebrow: string, language: Language) {
  return panel.filename ?? `${eyebrow.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${EXTENSIONS[language]}`;
}

type Section = {
  eyebrow: string;
  title: string;
  description: string;
  paragraphs?: string[];
  bullets?: string[];
  codePanel?: CodePanel;
};

type ReadingLink = {
  href: string;
  title: string;
  description: string;
};

type Cta = {
  href: string;
  label: string;
};

type ComparisonTable = {
  eyebrow: string;
  title: string;
  description: string;
  competitorLabel: string;
  rows: Array<{ label: string; competitor: string; hypequery: string }>;
  footnote?: string;
};

export type ClickhousePillarPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  primaryCta: Cta;
  secondaryCta: Cta;
  /** Which SDK the setup command shows first. Python pages pass 'python'. */
  language?: Language;
  stats?: Stat[];
  problems: Card[];
  solutionSection: Section;
  implementationSection: Section;
  comparisonTable?: ComparisonTable;
  searchIntentCards: Card[];
  readingLinks: ReadingLink[];
  relatedPillars: LinkItem[];
  nextStep: {
    eyebrow: string;
    title: string;
    description: string;
    primaryCta: Cta;
    secondaryCta: Cta;
  };
};

export function ClickhousePillarPage({
  eyebrow,
  title,
  description,
  primaryCta,
  secondaryCta,
  language = 'typescript',
  stats,
  problems,
  solutionSection,
  implementationSection,
  comparisonTable,
  searchIntentCards,
  readingLinks,
  relatedPillars,
  nextStep,
}: ClickhousePillarPageProps) {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-bg pt-[62px] text-text">
        <section className="border-b border-border">
          <div className={`${marketing.container} pb-14 pt-12 sm:pb-16 sm:pt-16`}>
            <div className="flex flex-wrap items-center gap-3">
              <OpenSourceBadge />
              <p className={marketing.eyebrow}>{eyebrow}</p>
            </div>
            <h1 className={`mt-5 max-w-[980px] ${marketing.heroTitle}`}>
              {title}
            </h1>
            <p className={`mt-5 max-w-[700px] ${marketing.heroLead}`}><RichText text={description} /></p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href={primaryCta.href}
                data-umami-event="cta_click"
                data-umami-event-target={ctaTarget(primaryCta.href)}
                data-umami-event-location="pillar_hero_primary"
                className={marketing.primaryButton}
              >
                {primaryCta.label} <span aria-hidden="true">→</span>
              </Link>
              <Link
                href={secondaryCta.href}
                data-umami-event="cta_click"
                data-umami-event-target={ctaTarget(secondaryCta.href)}
                data-umami-event-location="pillar_hero_secondary"
                className={marketing.secondaryButton}
              >
                {secondaryCta.label}
              </Link>
            </div>
            <SetupCommand className="mt-4" defaultLanguage={language} />
            {stats && stats.length > 0 && (
              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                {stats.map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
                    <p className="font-mono text-xs text-text-dim">{stat.label}</p>
                    <p className="mt-2 text-lg font-medium tracking-tight text-text">{stat.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={`${marketing.container} py-14 sm:py-20`}>
          <div className="grid gap-6 lg:grid-cols-3">
            {problems.map((problem) => (
              <div key={problem.title} className={marketing.card}>
                <h2 className={marketing.cardTitle}><RichText text={problem.title} /></h2>
                <p className="mt-3 text-sm leading-6 text-text-muted"><RichText text={problem.copy} /></p>
              </div>
            ))}
          </div>
        </section>

        <section className={marketing.band}>
          <div className={`${marketing.container} py-14 sm:py-20`}>
            <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr]">
              <div>
                <p className={marketing.eyebrow}>
                  {solutionSection.eyebrow}
                </p>
                <h2 className={`mt-3 ${marketing.sectionTitle}`}>
                  {solutionSection.title}
                </h2>
                <p className="mt-4 text-sm leading-6 text-text-muted sm:text-base"><RichText text={solutionSection.description} /></p>
                {solutionSection.paragraphs?.map((paragraph) => (
                  <p key={paragraph} className="mt-4 text-sm leading-6 text-text-muted">
                    <RichText text={paragraph} />
                  </p>
                ))}
                {solutionSection.bullets ? (
                  <ul className="mt-7 space-y-3 text-sm text-text">
                    {solutionSection.bullets.map((bullet) => (
                      <li key={bullet} className="flex gap-3">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                        <span><RichText text={bullet} /></span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {solutionSection.codePanel ? (
                <div className={marketing.card}>
                  <p className="font-mono text-xs text-text-dim">
                    {solutionSection.codePanel.eyebrow}
                  </p>
                  <h3 className={`mt-3 ${marketing.cardTitle}`}>
                    <RichText text={solutionSection.codePanel.title} />
                  </h3>
                  <CodeWindow
                    code={solutionSection.codePanel.code}
                    filename={panelFilename(solutionSection.codePanel, solutionSection.eyebrow, language)}
                    language={solutionSection.codePanel.language ?? language}
                    className="mt-4"
                  />
                  <p className="mt-4 text-sm leading-6 text-text-muted">
                    <RichText text={solutionSection.codePanel.description} />
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className={`${marketing.container} py-14 sm:py-20`}>
          <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr]">
            <div>
              <p className={marketing.eyebrow}>
                {implementationSection.eyebrow}
              </p>
              <h2 className={`mt-3 ${marketing.sectionTitle}`}>
                {implementationSection.title}
              </h2>
              <p className="mt-4 text-sm leading-6 text-text-muted sm:text-base"><RichText text={implementationSection.description} /></p>
              {implementationSection.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="mt-4 text-sm leading-6 text-text-muted">
                  <RichText text={paragraph} />
                </p>
              ))}
              {implementationSection.bullets ? (
                <ul className="mt-7 space-y-3 text-sm text-text">
                  {implementationSection.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      <span><RichText text={bullet} /></span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {implementationSection.codePanel ? (
              <div className={marketing.card}>
                <p className="font-mono text-xs text-text-dim">
                  {implementationSection.codePanel.eyebrow}
                </p>
                <h3 className={`mt-3 ${marketing.cardTitle}`}>
                  <RichText text={implementationSection.codePanel.title} />
                </h3>
                <CodeWindow
                  code={implementationSection.codePanel.code}
                  filename={panelFilename(implementationSection.codePanel, implementationSection.eyebrow, language)}
                  language={implementationSection.codePanel.language ?? language}
                  className="mt-4"
                />
                <p className="mt-4 text-sm leading-6 text-text-muted">
                  <RichText text={implementationSection.codePanel.description} />
                </p>
              </div>
            ) : null}
          </div>
        </section>

        {comparisonTable ? (
          <section className={`${marketing.container} pb-14 sm:pb-20`}>
            <p className={marketing.eyebrow}>
              {comparisonTable.eyebrow}
            </p>
            <h2 className={`mt-3 ${marketing.sectionTitle}`}>{comparisonTable.title}</h2>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-text-muted sm:text-base"><RichText text={comparisonTable.description} /></p>
            <div className="mt-8 overflow-x-auto rounded-xl border border-border bg-bg-card shadow-card">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-alt/60">
                    <th className="w-[22%] px-5 py-4" aria-label="Dimension" />
                    <th className="w-[39%] px-5 py-4 font-mono text-xs font-medium text-text-dim">
                      {comparisonTable.competitorLabel}
                    </th>
                    <th className="w-[39%] bg-accent-soft px-5 py-4 font-mono text-xs font-medium text-accent">
                      hypequery
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonTable.rows.map((row) => (
                    <tr key={row.label} className="border-b border-border last:border-b-0">
                      <td className="px-5 py-4 align-top text-sm font-medium text-text"><RichText text={row.label} /></td>
                      <td className="px-5 py-4 align-top text-sm leading-6 text-text-muted"><RichText text={row.competitor} /></td>
                      <td className="bg-accent-soft px-5 py-4 align-top text-sm leading-6 text-text">
                        <RichText text={row.hypequery} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {comparisonTable.footnote ? (
              <p className="mt-4 text-xs leading-5 text-text-dim"><RichText text={comparisonTable.footnote} /></p>
            ) : null}
          </section>
        ) : null}

        <section className={marketing.band}>
          <div className={`${marketing.container} py-14 sm:py-20`}>
            <p className="font-mono text-xs text-text-dim">
              Where teams usually get stuck
            </p>
            <h2 className={`mt-3 ${marketing.sectionTitle}`}>
              Questions teams ask
            </h2>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              {searchIntentCards.map((item) => (
                <div key={item.title} className={marketing.card}>
                  <h3 className={marketing.cardTitle}><RichText text={item.title} /></h3>
                  <p className="mt-3 text-sm leading-6 text-text-muted"><RichText text={item.copy} /></p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={`${marketing.container} py-14 sm:py-20`}>
          <div className="grid gap-10 lg:grid-cols-[0.65fr_0.35fr]">
            <div>
              <p className={marketing.eyebrow}>Further reading</p>
              <h2 className={`mt-3 ${marketing.sectionTitle}`}>
                Go deeper where it actually helps
              </h2>
              <div className="mt-10 grid gap-6 lg:grid-cols-2">
                {readingLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group rounded-xl border border-border bg-bg-card p-6 transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
                  >
                    <h3 className={marketing.cardTitle}><RichText text={item.title} /></h3>
                    <p className="mt-3 text-sm leading-6 text-text-muted"><RichText text={item.description} /></p>
                    <p className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-accent group-hover:opacity-70">
                      Open guide <span aria-hidden="true">→</span>
                    </p>
                  </Link>
                ))}
              </div>
            </div>
            <div className={marketing.card}>
              <p className="font-mono text-xs text-text-dim">Related pillars</p>
              <div className="mt-5 space-y-3">
                {relatedPillars.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block rounded-lg border border-border px-4 py-3 text-sm font-medium text-text transition hover:border-border-strong hover:bg-bg-alt"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className={`${marketing.container} pb-20`}>
          <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className={marketing.eyebrow}>
                {nextStep.eyebrow}
              </p>
              <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">{nextStep.title}</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted"><RichText text={nextStep.description} /></p>
              {/* The same two paths as the homepage: open source today, cloud when you want it hosted. */}
              <p className="mt-4 text-xs leading-5 text-text-dim">
                Open source, and it runs in your own backend. Want it hosted?{' '}
                <DeployWaitlist location="pillar-next-step" className="font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent" />
              </p>
            </div>
            <div className="mt-6 flex shrink-0 flex-wrap gap-3 md:mt-0">
              <Link
                href={nextStep.primaryCta.href}
                data-umami-event="cta_click"
                data-umami-event-target={ctaTarget(nextStep.primaryCta.href)}
                data-umami-event-location="pillar_next_step_primary"
                className={marketing.primaryButton}
              >
                {nextStep.primaryCta.label} <span aria-hidden="true">→</span>
              </Link>
              <Link
                href={nextStep.secondaryCta.href}
                data-umami-event="cta_click"
                data-umami-event-target={ctaTarget(nextStep.secondaryCta.href)}
                data-umami-event-location="pillar_next_step_secondary"
                className={marketing.secondaryButton}
              >
                {nextStep.secondaryCta.label}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
