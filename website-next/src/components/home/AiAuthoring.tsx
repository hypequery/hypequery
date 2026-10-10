'use client';

import { useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { ArrowUp, Check, RotateCcw } from 'lucide-react';
import { CloudHeader, CloudRail, ConnectButton, VersionSwitch } from './CloudAppFrame';
import { DeployWaitlist } from './DeployWaitlist';
import { useFollow } from './useFollow';
import { useTimeline } from './useTimeline';

const STEPS = [
  ['Connect ClickHouse', 'Read-only access. Credentials are encrypted and never shown to the assistant.'],
  ['Describe your business', 'Say what you sell, who will query the data, and who should see what.'],
  ['Review and publish', 'It drafts datasets, measures, and tenant rules. Publish, and your API and MCP go live.'],
] as const;

// The onboarding chat from the Cloud design: context first, then a draft model, then v1.
// Milliseconds after the section scrolls into view.
const T = {
  welcome: 300,
  chipDashboards: 1500,
  chipAgents: 1800,
  typeFirst: 2300,
  sendFirst: 4700,
  thinkTables: 5000,
  tables: 5800,
  draftClick: 8300,
  thinkDraft: 8500,
  draft: 9400,
  typeSecond: 10700,
  sendSecond: 12000,
  thinkPublish: 12300,
  publish: 13300,
  next: 14200,
  // Then the user asks the live model a question, as the design's analytical answer.
  askClick: 15300,
  ask: 15600,
  thinkAnswer: 15900,
  answer: 16900,
};
const DONE = T.answer + 1800;

const QUESTION = 'Gross revenue by month this year';

// Jul to Sep match the design's revenue figures; earlier months lead up to them.
const MONTHLY_REVENUE = [
  ['Jan', 1.02],
  ['Feb', 0.98],
  ['Mar', 1.06],
  ['Apr', 1.11],
  ['May', 1.17],
  ['Jun', 1.22],
  ['Jul', 1.28],
  ['Aug', 1.34],
  ['Sep', 1.4],
] as const;

const FIRST_MESSAGE =
  "We're an online store selling outdoor gear in the EU. Our product dashboards and an AI support agent will query it. Each customer account only sees its own data.";
const SECOND_MESSAGE = 'Looks good. Call revenue "gross revenue" and publish it.';

const AUDIENCES = [
  ['Product dashboards', T.chipDashboards],
  ['AI agents', T.chipAgents],
  ['Internal BI', null],
  ['Customer-facing API', null],
] as const;

const TABLES = [
  ['orders', 'one row per order', '18.2M', true],
  ['customers', 'accounts and acquisition', '410K', true],
  ['refunds', 'refund events', '1.2M', true],
  ['events', 'product analytics', '2.1B', true],
  ['subscriptions', 'billing plans', '96K', true],
  ['sessions', 'web sessions', '640M', false],
] as const;

const DATASETS = [
  ['orders', 'gross revenue, order count, AOV, discounts', '5 measures · 9 dims'],
  ['customers', 'customer count, channel, cohort month', '2 measures · 6 dims'],
  ['refunds', 'refund amount and count', '2 measures · 4 dims'],
  ['events', 'event count, unique users', '2 measures · 7 dims'],
] as const;

const DEPLOY_STEPS = [
  ['Connect ClickHouse', 'Read-only · 14 tables', 0],
  ['Describe your data', 'Who queries it, what matters', T.draftClick],
  ['Review the draft model', 'Datasets, measures, dimensions', T.sendSecond],
  ['Publish v1', 'Your API goes live', T.publish],
] as const;

const NEXT_STEPS = [
  ['Connect your app or agent', 'API key, REST snippet, MCP config'],
  ['Review the model', 'Measures and dimensions in a table'],
  ['Ask a question', '"Gross revenue by month this year"'],
] as const;

const reveal = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
};

const MARKS = Object.values(T);

/** Changes whenever something new appears, so the chat can follow it. */
function stage(elapsed: number) {
  return MARKS.filter((mark) => elapsed >= mark).length;
}

function typed(text: string, from: number, until: number, elapsed: number) {
  if (elapsed < from || elapsed >= until) return '';
  const perChar = (until - from - 200) / text.length;
  return text.slice(0, Math.floor((elapsed - from) / perChar));
}

function Avatar() {
  return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-text text-[11px] font-semibold text-bg">h</span>;
}

function Assistant({ children }: { children: React.ReactNode }) {
  return (
    <motion.div {...reveal} className="flex items-start gap-3">
      <Avatar />
      <div className="min-w-0 flex-1 pt-0.5 text-[13px] leading-5 text-text">{children}</div>
    </motion.div>
  );
}

function Thinking() {
  return (
    <motion.div {...reveal} className="flex items-center gap-3">
      <Avatar />
      <div className="flex h-6 items-center gap-1">
        {[0, 1, 2].map((dot) => (
          <span key={dot} className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-dim" style={{ animationDelay: `${dot * 120}ms` }} />
        ))}
      </div>
    </motion.div>
  );
}

function User({ children }: { children: React.ReactNode }) {
  return (
    <motion.div {...reveal} className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-bg-alt px-4 py-2.5 text-[13px] leading-5 text-text">{children}</div>
    </motion.div>
  );
}

/** The design's analytical answer: a headline, a KPI, a chart, and where the numbers came from. */
function RevenueAnswer({ reduced }: { reduced: boolean }) {
  const width = 300;
  const height = 92;
  const values = MONTHLY_REVENUE.map(([, value]) => value);
  const min = 0.9;
  const max = 1.45;
  const points = values.map((value, index) => [
    (index / (values.length - 1)) * width,
    height - ((value - min) / (max - min)) * height,
  ]);
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = points[points.length - 1];

  return (
    <Assistant>
      Gross revenue has grown <strong className="font-semibold">7 months in a row</strong> since the February low, and
      September was the best month this year.
      <div className="mt-3 rounded-lg border border-border bg-bg p-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[10.5px] text-text-dim">Gross revenue · September 2026</span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="text-xl font-semibold tracking-tight text-text">$1.40M</span>
          <span className="text-[11px] text-[#16a34a]">+4.5% vs Aug</span>
        </div>
        <div className="relative mt-2 h-[92px]">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible" preserveAspectRatio="none" aria-hidden="true">
            <motion.path
              d={`${line} L${width} ${height} L0 ${height} Z`}
              fill="var(--accent)"
              fillOpacity={0.12}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.5 }}
            />
            <motion.path
              d={line}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              initial={reduced ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
          </svg>
          <span
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
            style={{ left: `${(lastX / width) * 100}%`, top: `${(lastY / height) * 100}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[9.5px] text-text-dim">
          {MONTHLY_REVENUE.map(([month]) => <span key={month}>{month}</span>)}
        </div>
      </div>
      <ul className="mt-3 space-y-1 text-[12px] text-text-muted">
        <li>· February dipped 4% after the January sales.</li>
        <li>· Every month since has been higher than the last.</li>
      </ul>
      <div className="mt-3 font-mono text-[10px] text-text-dim">From Published v1 · orders.gross_revenue by created_at month · 1 query, 184 ms</div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        {['Show as table', 'Copy as API request', 'Show query'].map((label) => (
          <span key={label} className="rounded-md border border-border px-2 py-1 text-text-muted">{label}</span>
        ))}
      </div>
    </Assistant>
  );
}

function Chat({ elapsed, reduced }: { elapsed: number; reduced: boolean }) {
  const ref = useFollow(stage(elapsed), reduced);
  const draft = typed(FIRST_MESSAGE, T.typeFirst, T.sendFirst, elapsed) || typed(SECOND_MESSAGE, T.typeSecond, T.sendSecond, elapsed);

  return (
    <div className="flex min-h-0 flex-col">
      <div ref={ref} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-2 pt-6 [scrollbar-width:none]">
        {elapsed >= T.welcome && (
          <Assistant>
            Welcome to Analytics. I can see 14 tables in <span className="font-mono">analytics</span>. Before I suggest a
            model, two quick questions so the names and measures make sense to your team.
            <div className="mt-2 font-medium">What does your business do, and who will query this API?</div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {AUDIENCES.map(([label, at]) => {
                const picked = at !== null && elapsed >= at;
                return (
                  <span key={label} className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${picked ? 'border-accent bg-accent-soft text-accent' : 'border-border text-text-muted'}`}>
                    {label}
                  </span>
                );
              })}
            </div>
          </Assistant>
        )}

        {elapsed >= T.sendFirst && <User>{FIRST_MESSAGE}</User>}
        {elapsed >= T.thinkTables && elapsed < T.tables && <Thinking />}

        {elapsed >= T.tables && (
          <Assistant>
            Got it. Since each account only sees its own data, I&apos;ll scope every dataset by{' '}
            <span className="font-mono">org_id</span>. <strong className="font-semibold">Which tables should we start with?</strong>{' '}
            I&apos;ve ticked the ones that look central.
            <div className="mt-3 overflow-hidden rounded-lg border border-border bg-bg">
              {TABLES.map(([name, note, rows, checked], index) => (
                <motion.div
                  key={name}
                  {...reveal}
                  transition={{ ...reveal.transition, delay: reduced ? 0 : 0.08 * index }}
                  className="flex items-center gap-2.5 border-b border-border px-3 py-1.5 text-[12px] last:border-b-0"
                >
                  <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] ${checked ? 'bg-accent text-white dark:text-[#0c0e14]' : 'border border-border-strong'}`}>
                    {checked && <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <span className="font-mono text-text">{name}</span>
                  <span className="text-text-dim">{note}</span>
                  <span className="ml-auto font-mono text-[11px] text-text-muted">{rows}</span>
                </motion.div>
              ))}
              <div className="px-3 py-1.5 text-[11px] text-text-dim">+ 8 more tables</div>
            </div>
            <span className={`mt-3 inline-flex rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition dark:text-[#0c0e14] ${elapsed >= T.draftClick ? 'opacity-60' : 'shadow-[0_0_0_3px_var(--accent-soft)]'}`}>
              Draft a model from 5 tables
            </span>
          </Assistant>
        )}

        {elapsed >= T.thinkDraft && elapsed < T.draft && <Thinking />}

        {elapsed >= T.draft && (
          <Assistant>
            Here&apos;s a first draft: 4 datasets from your 5 tables, each scoped by <span className="font-mono">org_id</span>.
            Revenue, order count, AOV and discounts are on <span className="font-mono">orders</span>. Tell me what to rename
            or change, or publish it.
          </Assistant>
        )}

        {elapsed >= T.sendSecond && <User>{SECOND_MESSAGE}</User>}
        {elapsed >= T.thinkPublish && elapsed < T.publish && <Thinking />}

        {elapsed >= T.publish && (
          <Assistant>
            Renamed it and published. Because nothing was live yet, this went out straight away as v1. From now on
            Published is locked, and changes happen in drafts.
            <div className="mt-3 overflow-hidden rounded-lg border border-border bg-bg">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[12px]">
                <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                <span className="font-medium">Published · v1</span>
                <span className="ml-auto font-mono text-[11px] text-text-muted">acme-analytics.hypequery.app</span>
              </div>
              {DATASETS.map(([name, summary, counts]) => (
                <div key={name} className="grid grid-cols-[84px_1fr_auto] items-center gap-3 border-b border-border px-3 py-1.5 text-[12px] last:border-b-0">
                  <span className="font-mono font-medium text-text">{name}</span>
                  <span className="truncate text-text-muted">{summary}</span>
                  <span className="font-mono text-[10.5px] text-text-dim">{counts}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-text-dim">
              Every dataset is scoped by <span className="font-mono">org_id</span>.
            </div>
          </Assistant>
        )}

        {elapsed >= T.next && (
          <motion.div {...reveal} className="pl-9">
            <div className="text-[12px] font-medium text-text">What next?</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {NEXT_STEPS.map(([title, detail], index) => {
                const pressed = index === 2 && elapsed >= T.askClick;
                return (
                  <div
                    key={title}
                    className={`rounded-lg border px-3 py-2 transition-colors ${
                      index === 0 ? 'border-text bg-text text-bg' : pressed ? 'border-accent bg-accent-soft text-text' : 'border-border bg-bg text-text'
                    } ${index > 0 ? 'max-sm:hidden' : ''}`}
                  >
                    <div className="text-[11.5px] font-medium">{title}</div>
                    <div className={`mt-0.5 text-[10.5px] ${index === 0 ? 'opacity-70' : 'text-text-muted'}`}>{detail}</div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {elapsed >= T.ask && <User>{QUESTION}</User>}
        {elapsed >= T.thinkAnswer && elapsed < T.answer && <Thinking />}
        {elapsed >= T.answer && <RevenueAnswer reduced={reduced} />}
      </div>

      <div className="px-5 pb-4 pt-2">
        <div className="flex items-center gap-2 rounded-xl border border-border-strong bg-bg py-2 pl-3.5 pr-2 text-[13px] shadow-card">
          <span className={`min-w-0 flex-1 truncate ${draft ? 'text-text' : 'text-text-dim'}`}>
            {draft || (elapsed >= T.publish ? 'Ask about your data, or describe a change…' : 'Answer, or add context: naming, what matters to your team…')}
            {draft && <span className="ml-px inline-block h-[1em] w-px translate-y-[2px] animate-pulse bg-text" />}
          </span>
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${draft ? 'bg-accent text-white dark:text-[#0c0e14]' : 'bg-bg-alt text-text-dim'}`}>
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </div>
      </div>
    </div>
  );
}

function DeployChecklist({ elapsed }: { elapsed: number }) {
  const activeIndex = DEPLOY_STEPS.findIndex(([, , doneAt]) => elapsed < doneAt);

  return (
    <div className="border-l border-border bg-bg-alt/30 px-5 py-6 max-md:hidden">
      <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-text-dim">First deployment</div>
      <ol className="mt-4 space-y-4">
        {DEPLOY_STEPS.map(([title, detail, doneAt], index) => {
          const done = elapsed >= doneAt;
          const active = index === activeIndex;
          return (
            <li key={title} className="flex gap-3">
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors ${
                  done ? 'bg-accent text-white dark:text-[#0c0e14]' : active ? 'border border-accent' : 'border border-border-strong'
                }`}
              >
                {done ? <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" /> : active && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
              </span>
              <span>
                <span className={`block text-[12px] font-medium ${done || active ? 'text-text' : 'text-text-muted'}`}>{title}</span>
                <span className="block text-[11px] text-text-dim">{detail}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-6 max-w-[220px] text-[11px] leading-4 text-text-dim">
        {elapsed >= T.publish ? 'API, Data Model and Logs are now in the sidebar.' : 'The rest of the app opens once your first datasets are live.'}
      </p>
    </div>
  );
}

function AuthoringDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const reduced = useReducedMotion() ?? false;
  const { elapsed, replay } = useTimeline(inView, reduced, DONE);
  const done = elapsed >= DONE && !reduced;
  const published = elapsed >= T.publish;

  return (
    <div ref={ref} className="max-md:w-full md:w-[900px] lg:w-[1040px]">
      <p className="sr-only">
        The hypequery Cloud onboarding chat. The assistant sees 14 ClickHouse tables and asks what the business does and
        who will query it. The user describes an EU outdoor gear store whose dashboards and AI support agent query the
        data, with each customer seeing only its own. The assistant scopes every dataset by org_id, suggests five tables,
        drafts four datasets, renames revenue to gross revenue on request, and publishes v1 at
        acme-analytics.hypequery.app.
      </p>
      <div aria-hidden="true" className="flex overflow-hidden border-y border-l border-border bg-bg-card shadow-card max-md:h-[592px] max-md:rounded-xl max-md:border-r md:h-[632px] md:rounded-l-xl">
        {/* As in the design, the app's rail only appears once v1 is live. */}
        <div className={`shrink-0 overflow-hidden transition-[width] duration-500 max-md:hidden ${published ? 'w-[60px]' : 'w-0'}`}>
          <CloudRail page="chat" className="h-full" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <CloudHeader
            logo={published ? 'mobile' : true}
            innerClassName="md:w-[740px]"
            actions={
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={replay}
                  tabIndex={done ? 0 : -1}
                  aria-label="Replay the animation"
                  className={`rounded-md p-1 text-text-dim transition hover:text-text ${done ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                {published ? <ConnectButton /> : <span className="text-[12.5px] text-text-muted">Skip setup</span>}
              </span>
            }
          >
            <VersionSwitch draft={false} live={published} name="Published" detail={published ? 'v1' : 'nothing yet'} />
          </CloudHeader>
          <div className="grid min-h-0 flex-1 max-md:grid-cols-[minmax(0,1fr)] md:grid-cols-[540px_minmax(260px,1fr)]">
            <Chat elapsed={elapsed} reduced={reduced} />
            <DeployChecklist elapsed={elapsed} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AiAuthoring() {
  return (
    <section aria-labelledby="ai-authoring-title" className="overflow-x-clip">
      <div className="mx-auto max-w-[1280px] px-5 pb-4 pt-14 sm:px-8 sm:pt-20">
        <div className="grid items-center gap-10 max-md:grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,400px)_minmax(0,1fr)] md:gap-12 lg:gap-16">
          <div>
            <h2 id="ai-authoring-title" className="home-section-title text-text">Describe your business. Get a semantic layer.</h2>
            <p className="mt-4 max-w-[520px] text-sm leading-6 text-text-muted sm:text-base">
              Connect ClickHouse, answer two questions, and Cloud drafts and publishes your datasets. Ask your first
              question minutes later.
            </p>
            <ol className="mt-8 space-y-5">
              {STEPS.map(([title, copy], index) => (
                <li key={title} className="flex gap-4">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong font-mono text-[11px] text-text-muted">{index + 1}</span>
                  <span>
                    <span className="block text-sm font-medium text-text">{title}</span>
                    <span className="mt-1 block text-sm leading-6 text-text-muted">{copy}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <DeployWaitlist location="ai-authoring" className="inline-flex min-h-11 items-center gap-3 rounded-lg bg-accent px-5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:opacity-90 dark:text-[#0c0e14]" />
            </div>
          </div>

          <AuthoringDemo />
        </div>
      </div>
    </section>
  );
}
