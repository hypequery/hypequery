import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import CodeWindow from '@/components/CodeWindow';
import { RichText } from '@/components/RichText';
import { DeployWaitlist } from '@/components/home/DeployWaitlist';
import { OpenSourceBadge } from '@/components/home/OpenSourceBadge';
import { SetupCommand, type Language } from '@/components/home/SetupCommand';
import { marketing } from '@/components/ui/marketing';
import { faqPageSchema, type FaqItem } from '@/lib/faq-schema';

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

/** A numbered, copy-paste quickstart rendered right under the hero. */
type Quickstart = {
  eyebrow: string;
  title: string;
  description: string;
  steps: Array<{ title: string; description: string; code: string; filename: string; language?: string }>;
  footnote?: string;
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
  /** Extra panels stacked under `codePanel` in the same column. */
  codePanels?: CodePanel[];
};

function CodePanelCard({ panel, eyebrow, language }: { panel: CodePanel; eyebrow: string; language: Language }) {
  return (
    <div className={marketing.card}>
      <p className="font-mono text-xs text-text-dim">
        {panel.eyebrow}
      </p>
      <h3 className={`mt-3 ${marketing.cardTitle}`}>
        <RichText text={panel.title} />
      </h3>
      <CodeWindow
        code={panel.code}
        filename={panelFilename(panel, eyebrow, language)}
        language={panel.language ?? language}
        className="mt-4"
      />
      <p className="mt-4 text-sm leading-6 text-text-muted">
        <RichText text={panel.description} />
      </p>
    </div>
  );
}

/** One card for a lone `codePanel` (the original layout); a stacked column when `codePanels` adds more. */
function SectionPanels({ section, language }: { section: Section; language: Language }) {
  const panels = [...(section.codePanel ? [section.codePanel] : []), ...(section.codePanels ?? [])];
  if (panels.length === 0) return null;
  if (!section.codePanels?.length) {
    return <CodePanelCard panel={panels[0]} eyebrow={section.eyebrow} language={language} />;
  }
  return (
    <div className="min-w-0 space-y-6">
      {panels.map((panel) => (
        <CodePanelCard key={panel.title} panel={panel} eyebrow={section.eyebrow} language={language} />
      ))}
    </div>
  );
}

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

/** A table with any number of columns, for comparing several tools at once. */
type ComparisonMatrix = {
  eyebrow: string;
  title: string;
  description: string;
  columns: Array<{ label: string; highlight?: boolean }>;
  rows: Array<{ label: string; cells: string[] }>;
  footnote?: string;
};

type SectionHeading = {
  eyebrow: string;
  title: string;
  description?: string;
};

type SourceLink = {
  href: string;
  label: string;
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
  quickstart?: Quickstart;
  /** Shown right after the hero, before the problem cards. */
  comparisonMatrix?: ComparisonMatrix;
  /** A heading above the problem cards; without it they render as before. */
  problemsHeading?: SectionHeading;
  problems: Card[];
  solutionSection: Section;
  implementationSection: Section;
  /** Further sections in the implementation layout, after `implementationSection`. */
  additionalSections?: Section[];
  comparisonTable?: ComparisonTable;
  /** Honest list of situations where the other tool is the better choice. */
  chooseAlternative?: {
    title: string;
    bullets: string[];
  };
  /** External references, listed after the question cards. */
  sources?: SourceLink[];
  searchIntentCards: Card[];
  /** Rendered as an FAQ section with matching FAQPage structured data. */
  faq?: FaqItem[];
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
  quickstart,
  comparisonMatrix,
  problemsHeading,
  problems,
  solutionSection,
  implementationSection,
  additionalSections,
  comparisonTable,
  chooseAlternative,
  sources,
  searchIntentCards,
  faq,
  readingLinks,
  relatedPillars,
  nextStep,
}: ClickhousePillarPageProps) {
  return (
    <>
      {faq && faq.length > 0 ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageSchema(faq)) }} />
      ) : null}
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

        {quickstart ? (
          <section id="quickstart" className="border-b border-border">
            <div className={`${marketing.container} py-14 sm:py-20`}>
              <p className={marketing.eyebrow}>{quickstart.eyebrow}</p>
              <h2 className="mt-3 max-w-[820px] text-3xl font-normal tracking-[-0.03em] text-text sm:text-4xl">
                <RichText text={quickstart.title} />
              </h2>
              <p className="mt-4 max-w-[760px] text-sm leading-6 text-text-muted sm:text-base">
                <RichText text={quickstart.description} />
              </p>
              <ol className="mt-10 grid gap-6 lg:grid-cols-2">
                {quickstart.steps.map((step, index) => (
                  <li key={step.title} className={marketing.card}>
                    <p className="font-mono text-xs text-text-dim">Step {index + 1}</p>
                    <h3 className={`mt-3 ${marketing.cardTitle}`}>
                      <RichText text={step.title} />
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-text-muted">
                      <RichText text={step.description} />
                    </p>
                    <CodeWindow
                      code={step.code}
                      filename={step.filename}
                      language={step.language ?? language}
                      className="mt-4"
                    />
                  </li>
                ))}
              </ol>
              {quickstart.footnote ? (
                <p className="mt-6 max-w-[760px] text-sm leading-6 text-text-muted">
                  <RichText text={quickstart.footnote} />
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {comparisonMatrix ? (
          <section className={`${marketing.container} pt-14 sm:pt-20`}>
            <p className={marketing.eyebrow}>{comparisonMatrix.eyebrow}</p>
            <h2 className={`mt-3 ${marketing.sectionTitle}`}>{comparisonMatrix.title}</h2>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-text-muted sm:text-base"><RichText text={comparisonMatrix.description} /></p>
            <div className="mt-8 overflow-x-auto rounded-xl border border-border bg-bg-card shadow-card">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-alt/60">
                    <th className="w-[16%] px-5 py-4" aria-label="Dimension" />
                    {comparisonMatrix.columns.map((column) => (
                      <th
                        key={column.label}
                        scope="col"
                        className={`px-5 py-4 font-mono text-xs font-medium ${column.highlight ? 'bg-accent-soft text-accent' : 'text-text-dim'}`}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparisonMatrix.rows.map((row) => (
                    <tr key={row.label} className="border-b border-border last:border-b-0">
                      <th scope="row" className="px-5 py-4 align-top text-sm font-medium text-text"><RichText text={row.label} /></th>
                      {row.cells.map((cell, index) => (
                        <td
                          key={comparisonMatrix.columns[index]?.label ?? index}
                          className={`px-5 py-4 align-top text-sm leading-6 ${comparisonMatrix.columns[index]?.highlight ? 'bg-accent-soft text-text' : 'text-text-muted'}`}
                        >
                          <RichText text={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {comparisonMatrix.footnote ? (
              <p className="mt-4 text-xs leading-5 text-text-dim"><RichText text={comparisonMatrix.footnote} /></p>
            ) : null}
          </section>
        ) : null}

        <section className={`${marketing.container} py-14 sm:py-20`}>
          {problemsHeading ? (
            <div className="mb-10">
              <p className={marketing.eyebrow}>{problemsHeading.eyebrow}</p>
              <h2 className={`mt-3 ${marketing.sectionTitle}`}>{problemsHeading.title}</h2>
              {problemsHeading.description ? (
                <p className="mt-4 max-w-3xl text-sm leading-6 text-text-muted sm:text-base"><RichText text={problemsHeading.description} /></p>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-6 lg:grid-cols-3">
            {problems.map((problem) => {
              const CardHeading = problemsHeading ? 'h3' : 'h2';
              return (
                <div key={problem.title} className={marketing.card}>
                  <CardHeading className={marketing.cardTitle}><RichText text={problem.title} /></CardHeading>
                  <p className="mt-3 text-sm leading-6 text-text-muted"><RichText text={problem.copy} /></p>
                </div>
              );
            })}
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
              <SectionPanels section={solutionSection} language={language} />
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
            <SectionPanels section={implementationSection} language={language} />
          </div>
        </section>

        {additionalSections?.map((section, index) => (
          <section key={section.title} className={index % 2 === 0 ? marketing.band : undefined}>
            <div className={`${marketing.container} py-14 sm:py-20`}>
              <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr]">
                <div>
                  <p className={marketing.eyebrow}>{section.eyebrow}</p>
                  <h2 className={`mt-3 ${marketing.sectionTitle}`}>{section.title}</h2>
                  <p className="mt-4 text-sm leading-6 text-text-muted sm:text-base"><RichText text={section.description} /></p>
                  {section.paragraphs?.map((paragraph) => (
                    <p key={paragraph} className="mt-4 text-sm leading-6 text-text-muted">
                      <RichText text={paragraph} />
                    </p>
                  ))}
                  {section.bullets ? (
                    <ul className="mt-7 space-y-3 text-sm text-text">
                      {section.bullets.map((bullet) => (
                        <li key={bullet} className="flex gap-3">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                          <span><RichText text={bullet} /></span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <SectionPanels section={section} language={language} />
              </div>
            </div>
          </section>
        ))}

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

        {chooseAlternative ? (
          <section className={`${marketing.container} pb-14 sm:pb-20`}>
            <div className="rounded-xl border border-border-strong bg-bg-card p-6 shadow-card sm:p-8">
              <h2 className={marketing.sectionTitle}>{chooseAlternative.title}</h2>
              <ul className="mt-6 space-y-3">
                {chooseAlternative.bullets.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-6 text-text-muted">
                    <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <span><RichText text={item} /></span>
                  </li>
                ))}
              </ul>
            </div>
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
            {sources && sources.length > 0 ? (
              <div className="mt-10">
                <p className="font-mono text-xs text-text-dim">Sources</p>
                <ul className="mt-3 space-y-2 text-sm text-text-muted">
                  {sources.map((source) => (
                    <li key={source.href}>
                      <a
                        href={source.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent"
                      >
                        {source.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>

        {faq && faq.length > 0 ? (
          <section className={`${marketing.container} pt-14 sm:pt-20`}>
            <p className={marketing.eyebrow}>FAQ</p>
            <h2 className={`mt-3 ${marketing.sectionTitle}`}>Frequently asked questions</h2>
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              {faq.map((item) => (
                <div key={item.question} className={marketing.card}>
                  <h3 className={marketing.cardTitle}>{item.question}</h3>
                  <p className="mt-3 text-sm leading-6 text-text-muted">{item.answer}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

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
