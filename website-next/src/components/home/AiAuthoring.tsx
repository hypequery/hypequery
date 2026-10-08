'use client';

import { useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { ArrowUp, Check, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { DeployWaitlist } from './DeployWaitlist';
import { useFollow } from './useFollow';
import { useTimeline } from './useTimeline';

const STEPS = [
  ['Connect ClickHouse', 'Point Cloud at your database with a read-only user.'],
  ['AI learns your business', 'It reads your schema and asks what matters: revenue, customers, tenants.'],
  ['Review and go live', 'Accept the proposed datasets, and they are served as REST and MCP endpoints.'],
] as const;

type Message =
  | { role: 'user'; at: number; text: string; typeFrom?: number }
  | { role: 'assistant'; at: number; text: React.ReactNode; thinkFrom: number }
  | { role: 'status'; at: number; doneAt: number };

// Milliseconds after the section scrolls into view.
const T = {
  draft: 5000,
  refunds: 9400,
  month: 12300,
  live: 14600,
};
const DONE = T.live + 800;
const TYPE_PER_CHAR = 45;
const FLASH_MS = 1400;

const SCRIPT: Message[] = [
  { role: 'user', at: 300, text: 'We sell subscriptions. Revenue is paid orders only, and each customer is a tenant.' },
  { role: 'status', at: 900, doneAt: 2000 },
  { role: 'assistant', thinkFrom: 2100, at: 2700, text: 'Quick check: should revenue be before or after tax?' },
  { role: 'user', typeFrom: 3400, at: 4000, text: 'Before tax.' },
  {
    role: 'assistant',
    thinkFrom: 4300,
    at: T.draft,
    text: (
      <>
        I drafted an <span className="font-mono">orders</span> dataset. Revenue is paid orders before tax, and every query
        is scoped to one customer.
      </>
    ),
  },
  { role: 'user', typeFrom: 7600, at: 8400, text: 'Track refunds too.' },
  { role: 'assistant', thinkFrom: 8700, at: T.refunds, text: <>Added a <span className="font-mono">refunds</span> measure.</> },
  { role: 'user', typeFrom: 10400, at: 11500, text: 'And revenue by month.' },
  { role: 'assistant', thinkFrom: 11700, at: T.month, text: <>Added a <span className="font-mono">month</span> dimension.</> },
  { role: 'user', typeFrom: 13000, at: 14000, text: 'Looks good. Publish it.' },
  {
    role: 'assistant',
    thinkFrom: 14100,
    at: T.live,
    text: (
      <>
        <span className="font-mono">orders</span> is live as REST and MCP endpoints.
      </>
    ),
  },
];

type Row = { at: number; name: string; kind: string; detail: string; note: string };

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: 'Dimensions',
    rows: [
      { at: T.draft + 200, name: 'country', kind: 'String', detail: 'customers.country', note: 'Billing country of the customer' },
      { at: T.draft + 350, name: 'plan', kind: 'String', detail: 'plans.name', note: 'Subscription plan at the time of the order' },
      { at: T.draft + 500, name: 'created_at', kind: 'DateTime', detail: 'orders.created_at', note: 'When the order was placed, in UTC' },
      { at: T.month, name: 'month', kind: 'Date', detail: 'toStartOfMonth(created_at)', note: 'Calendar month of the order' },
    ],
  },
  {
    title: 'Measures',
    rows: [
      { at: T.draft + 700, name: 'revenue', kind: 'sum', detail: "sum(amount_ex_tax) where status = 'paid'", note: 'Paid order value before tax, in USD' },
      { at: T.draft + 850, name: 'order_count', kind: 'count', detail: 'count()', note: 'Orders in any status' },
      { at: T.draft + 1000, name: 'customers', kind: 'uniq', detail: 'uniq(customer_id)', note: 'Distinct paying customers' },
      { at: T.refunds, name: 'refunds', kind: 'count', detail: "countIf(status = 'refunded')", note: 'Orders refunded in full or in part' },
    ],
  },
  {
    title: 'Access',
    rows: [
      { at: T.draft + 1200, name: 'tenant', kind: 'rule', detail: 'customer_id = request.tenant', note: 'Every query is scoped to one customer' },
    ],
  },
];

const reveal = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
};

/** When a message first appears: its typing dots for the assistant, otherwise the message itself. */
function appearsAt(message: Message) {
  return message.role === 'assistant' ? message.thinkFrom : message.at;
}

/** Changes whenever something new appears, so the chat can follow it. */
function stage(elapsed: number) {
  return SCRIPT.reduce((count, message) => count + Number(elapsed >= appearsAt(message)) + Number(elapsed >= message.at), 0);
}

function ChatMessage({ message, elapsed }: { message: Message; elapsed: number }) {
  if (message.role === 'user') {
    return (
      <motion.div {...reveal} className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-bg-alt px-4 py-2.5 text-[13px] leading-5 text-text">{message.text}</div>
      </motion.div>
    );
  }

  if (message.role === 'status') {
    const reading = elapsed < message.doneAt;
    return (
      <motion.div {...reveal} className="flex items-center gap-2 pl-9 font-mono text-[11px] text-text-dim">
        {reading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Check className="h-3 w-3 text-accent" aria-hidden="true" />}
        {reading ? 'Reading schema…' : 'Read 3 tables · orders, customers, plans'}
      </motion.div>
    );
  }

  return (
    <motion.div {...reveal} className="flex items-start gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft">
        <Sparkles className="h-3 w-3 text-accent" aria-hidden="true" />
      </span>
      {elapsed < message.at ? (
        <div className="flex h-6 items-center gap-1">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-dim" style={{ animationDelay: `${dot * 120}ms` }} />
          ))}
        </div>
      ) : (
        <div className="min-w-0 pt-0.5 text-[13px] leading-5 text-text">{message.text}</div>
      )}
    </motion.div>
  );
}

function Chat({ elapsed, reduced }: { elapsed: number; reduced: boolean }) {
  const ref = useFollow(stage(elapsed), reduced);
  const drafting = SCRIPT.find(
    (message) => message.role === 'user' && message.typeFrom !== undefined && elapsed >= message.typeFrom && elapsed < message.at,
  );
  const draft =
    drafting?.role === 'user' && drafting.typeFrom !== undefined
      ? drafting.text.slice(0, Math.floor((elapsed - drafting.typeFrom) / TYPE_PER_CHAR))
      : '';

  return (
    <div className="flex min-h-0 flex-col border-r border-border">
      <div ref={ref} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 [scrollbar-width:none]">
        {SCRIPT.filter((message) => elapsed >= appearsAt(message)).map((message) => (
          <ChatMessage key={`${message.role}-${message.at}`} message={message} elapsed={elapsed} />
        ))}
      </div>

      <div className="px-3 pb-3 pt-1">
        <div className="flex items-center gap-2 rounded-xl border border-border-strong bg-bg py-2 pl-3.5 pr-2 text-[13px] shadow-card">
          <span className={`min-w-0 flex-1 truncate ${draft ? 'text-text' : 'text-text-dim'}`}>
            {draft || 'Describe your business…'}
            {drafting && <span className="ml-px inline-block h-[1em] w-px translate-y-[2px] animate-pulse bg-text" />}
          </span>
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${draft ? 'bg-accent text-white dark:text-[#0c0e14]' : 'bg-bg-alt text-text-dim'}`}>
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </div>
      </div>
    </div>
  );
}

function DatasetDraft({ elapsed }: { elapsed: number }) {
  const live = elapsed >= T.live;

  return (
    <div className="min-h-0 overflow-hidden bg-bg-alt/30">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <span className="font-mono text-sm font-semibold text-text">orders</span>
        <span className="font-mono text-[11px] text-text-dim">analytics.orders</span>
        {live ? (
          <motion.span {...reveal} className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Live · REST and MCP
          </motion.span>
        ) : (
          <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-text-muted">Draft</span>
        )}
      </div>

      <div className="space-y-5 px-6 py-5">
        {SECTIONS.map(({ title, rows }) => {
          const shown = rows.filter((row) => elapsed >= row.at);
          if (shown.length === 0) return null;
          return (
            <div key={title}>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-text-dim">{title}</div>
              <ul className="divide-y divide-border rounded-lg border border-border bg-bg-card">
                {shown.map((row) => {
                  const fresh = elapsed - row.at < FLASH_MS && elapsed < DONE;
                  return (
                    <motion.li
                      key={row.name}
                      {...reveal}
                      className={`grid grid-cols-[120px_80px_260px_1fr] items-center gap-4 whitespace-nowrap px-4 py-2.5 text-xs transition-colors duration-700 ${fresh ? 'bg-accent-soft' : ''}`}
                    >
                      <span className="font-mono text-text">{row.name}</span>
                      <span className="w-fit rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted">{row.kind}</span>
                      <span className="truncate font-mono text-text-dim">{row.detail}</span>
                      <span className="text-text-muted">{row.note}</span>
                    </motion.li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AuthoringDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const reduced = useReducedMotion() ?? false;
  const { elapsed, replay } = useTimeline(inView, reduced, DONE);
  const done = elapsed >= DONE && !reduced;

  return (
    <div ref={ref} className="w-[900px] lg:w-[1040px]">
      <p className="sr-only">
        A chat in hypequery Cloud: the user describes their business, the AI reads the ClickHouse schema, asks whether
        revenue is before or after tax, and drafts an orders dataset with dimensions, measures, and a tenant rule. The
        user asks for refunds and revenue by month, the AI adds both, and the dataset goes live as REST and MCP
        endpoints.
      </p>
      <div className="overflow-hidden rounded-l-xl border border-r-0 border-border bg-bg-card shadow-card">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-xs font-medium text-text">hypequery Cloud</span>
          <span className="text-xs text-text-dim">/ Acme / New dataset</span>
          <button
            type="button"
            onClick={replay}
            tabIndex={done ? 0 : -1}
            aria-label="Replay the animation"
            className={`ml-3 rounded-md p-1 text-text-dim transition hover:text-text ${done ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div aria-hidden="true" className="grid h-[580px] grid-cols-[320px_1fr]">
          <Chat elapsed={elapsed} reduced={reduced} />
          <DatasetDraft elapsed={elapsed} />
        </div>
      </div>
    </div>
  );
}

export function AiAuthoring() {
  return (
    <section aria-labelledby="ai-authoring-title" className="overflow-x-clip">
      <div className="mx-auto max-w-[1280px] px-5 pb-4 pt-14 sm:px-8 sm:pt-20">
        <div className="grid items-center gap-10 md:grid-cols-[minmax(0,400px)_minmax(0,1fr)] md:gap-12 lg:gap-16">
          <div>
            <h2 id="ai-authoring-title" className="home-section-title text-text">Describe your business. Get a semantic layer.</h2>
            <p className="mt-4 max-w-[520px] text-sm leading-6 text-text-muted sm:text-base">
              Cloud&apos;s AI drafts your datasets for you, so you go from a ClickHouse connection to governed AI answers in
              minutes.
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
