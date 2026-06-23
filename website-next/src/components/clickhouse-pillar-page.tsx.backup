import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import CodeWindow from '@/components/CodeWindow';

type LinkItem = {
  href: string;
  label: string;
};

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
};

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

export type ClickhousePillarPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  primaryCta: Cta;
  secondaryCta: Cta;
  stats: Stat[];
  problems: Card[];
  solutionSection: Section;
  implementationSection: Section;
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
  stats,
  problems,
  solutionSection,
  implementationSection,
  searchIntentCards,
  readingLinks,
  relatedPillars,
  nextStep,
}: ClickhousePillarPageProps) {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-[#020617] pt-28 text-gray-100">
        <section className="relative overflow-hidden border-b border-slate-800/80">
          <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-300">{eyebrow}</p>
            <h1 className="font-display mt-4 max-w-5xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              {title}
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">{description}</p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href={primaryCta.href}
                className="bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                {primaryCta.label}
              </Link>
              <Link
                href={secondaryCta.href}
                className="border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
              >
                {secondaryCta.label}
              </Link>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {stats.map((stat) => (
                <div key={stat.label} className="border border-slate-700/80 bg-slate-950/70 p-5">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{stat.label}</p>
                  <p className="mt-2 text-xl font-semibold text-slate-100">{stat.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {problems.map((problem) => (
              <div key={problem.title} className="border border-slate-700 bg-slate-900/60 p-6">
                <h2 className="font-display text-xl font-semibold text-slate-100">{problem.title}</h2>
                <p className="mt-4 text-sm leading-7 text-slate-300">{problem.copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-slate-800 bg-slate-950/60">
          <div className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
            <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">
                  {solutionSection.eyebrow}
                </p>
                <h2 className="font-display mt-3 text-3xl font-semibold text-white">
                  {solutionSection.title}
                </h2>
                <p className="mt-5 text-base leading-8 text-slate-300">{solutionSection.description}</p>
                {solutionSection.paragraphs?.map((paragraph) => (
                  <p key={paragraph} className="mt-4 text-sm leading-7 text-slate-300">
                    {paragraph}
                  </p>
                ))}
                {solutionSection.bullets ? (
                  <ul className="mt-8 space-y-3 text-sm text-slate-200">
                    {solutionSection.bullets.map((bullet) => (
                      <li key={bullet} className="flex gap-3">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {solutionSection.codePanel ? (
                <div className="border border-slate-700 bg-slate-950/80 p-6">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                    {solutionSection.codePanel.eyebrow}
                  </p>
                  <h3 className="font-display mt-3 text-xl font-semibold text-white">
                    {solutionSection.codePanel.title}
                  </h3>
                  <CodeWindow
                    code={solutionSection.codePanel.code}
                    filename={`${solutionSection.eyebrow.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ts`}
                    className="mt-4"
                  />
                  <p className="mt-4 text-sm leading-7 text-slate-300">
                    {solutionSection.codePanel.description}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">
                {implementationSection.eyebrow}
              </p>
              <h2 className="font-display mt-3 text-3xl font-semibold text-white">
                {implementationSection.title}
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-300">{implementationSection.description}</p>
              {implementationSection.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="mt-4 text-sm leading-7 text-slate-300">
                  {paragraph}
                </p>
              ))}
              {implementationSection.bullets ? (
                <ul className="mt-8 space-y-3 text-sm text-slate-200">
                  {implementationSection.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-300" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {implementationSection.codePanel ? (
              <div className="border border-slate-700 bg-slate-950/80 p-6">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                  {implementationSection.codePanel.eyebrow}
                </p>
                <h3 className="font-display mt-3 text-xl font-semibold text-white">
                  {implementationSection.codePanel.title}
                </h3>
                <CodeWindow
                  code={implementationSection.codePanel.code}
                  filename={`${implementationSection.eyebrow.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ts`}
                  className="mt-4"
                />
                <p className="mt-4 text-sm leading-7 text-slate-300">
                  {implementationSection.codePanel.description}
                </p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="border-y border-slate-800 bg-slate-950/60">
          <div className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
              Where teams usually get stuck
            </p>
            <h2 className="font-display mt-3 text-3xl font-semibold text-white">
              The questions this page should answer
            </h2>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              {searchIntentCards.map((item) => (
                <div key={item.title} className="border border-slate-700 bg-slate-900/70 p-6">
                  <h3 className="font-display text-xl font-semibold text-slate-100">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-300">{item.copy}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <div className="grid gap-10 lg:grid-cols-[0.65fr_0.35fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">Further reading</p>
              <h2 className="font-display mt-3 text-3xl font-semibold text-white">
                Go deeper where it actually helps
              </h2>
              <div className="mt-10 grid gap-6 lg:grid-cols-2">
                {readingLinks.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group border border-slate-700 bg-slate-900/70 p-6 transition hover:-translate-y-1 hover:border-indigo-400 hover:bg-slate-900"
                  >
                    <h3 className="font-display text-xl font-semibold text-slate-100">{item.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-slate-300">{item.description}</p>
                    <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300 group-hover:text-cyan-200">
                      Open guide
                    </p>
                  </Link>
                ))}
              </div>
            </div>
            <div className="border border-slate-700 bg-slate-950/80 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Related pillars</p>
              <div className="mt-5 space-y-3">
                {relatedPillars.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block border border-slate-800 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-cyan-400 hover:bg-slate-900"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-20 lg:px-6">
          <div className="border border-indigo-500/35 bg-slate-950 p-8 md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">
                {nextStep.eyebrow}
              </p>
              <h2 className="font-display mt-3 text-2xl font-semibold text-white">{nextStep.title}</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">{nextStep.description}</p>
            </div>
            <div className="mt-6 flex gap-3 md:mt-0">
              <Link
                href={nextStep.primaryCta.href}
                className="inline-flex items-center bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                {nextStep.primaryCta.label}
              </Link>
              <Link
                href={nextStep.secondaryCta.href}
                className="inline-flex items-center border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
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
