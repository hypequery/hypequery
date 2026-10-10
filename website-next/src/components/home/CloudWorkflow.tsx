'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { Check } from 'lucide-react';
import { CloudHeader, CloudRail, ConnectButton, Slash, VersionSwitch, type CloudPage } from './CloudAppFrame';

// Screens from the Cloud chat redesign: drafts, review and publish, deployments, and logs.

const AUTO_ADVANCE_MS = 7000;

const reveal = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
};

function Avatar() {
  return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-text text-[11px] font-semibold text-bg">h</span>;
}

function Mark({ kind }: { kind: '+' | '~' | '−' }) {
  const tone = kind === '+' ? 'bg-[#22c55e]/15 text-[#16a34a]' : kind === '~' ? 'bg-[#f59e0b]/15 text-[#d97706]' : 'bg-[#ef4444]/15 text-[#dc2626]';
  return <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[11px] font-semibold ${tone}`}>{kind}</span>;
}

function Table({ head, rows, align }: { head: string[]; rows: React.ReactNode[][]; align?: ('left' | 'right')[] }) {
  return (
    <table className="w-full text-left text-[11.5px]">
      <thead>
        <tr className="border-b border-border text-[10.5px] text-text-dim">
          {head.map((cell, index) => (
            <th key={cell} className={`px-3 py-1.5 font-normal ${align?.[index] === 'right' ? 'text-right' : ''}`}>{cell}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex} className="border-b border-border last:border-b-0">
            {row.map((cell, index) => (
              <td key={index} className={`px-3 py-1.5 font-mono text-text ${align?.[index] === 'right' ? 'text-right' : ''}`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DraftScreen() {
  return (
    <div className="grid h-full max-md:gap-5 max-md:p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-6 md:p-6">
      <div className="space-y-4">
        <div className="ml-auto max-w-[90%] rounded-2xl rounded-br-md bg-bg-alt px-4 py-2.5 text-[12.5px] leading-5 text-text">
          Add a net revenue measure to orders: revenue minus refunds and discounts. I also want to slice it by the
          customer&apos;s acquisition channel.
        </div>
        <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-[11.5px] text-text">
          Published is locked, so this chat started draft <span className="font-mono font-medium">net-revenue</span> and switched you to it.
        </div>
        <div className="flex gap-3">
          <Avatar />
          <div className="min-w-0 space-y-1.5 text-[11.5px]">
            {[
              ['Started draft net-revenue', 'from Published v42'],
              ['Read dataset orders', '9 dims · 5 measures'],
              ['Inspected table analytics.refunds', '1.2M rows'],
              ['Compiled draft & ran test query', '184 ms'],
            ].map(([step, detail]) => (
              <div key={step} className="flex items-center gap-2">
                <Check className="h-3 w-3 text-accent" aria-hidden="true" />
                <span className="text-text">{step}</span>
                <span className="font-mono text-[10.5px] text-text-dim max-md:hidden">{detail}</span>
              </div>
            ))}
            <p className="pt-2 text-[12.5px] leading-5 text-text max-md:hidden">
              I added a <span className="font-mono">refunds</span> measure, a derived <span className="font-mono">net_revenue</span>,
              and a relationship so <span className="font-mono">channel</span> is available on orders. Nothing goes live until
              you publish.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="overflow-hidden rounded-lg border border-border bg-bg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11.5px]">
            <span className="font-medium text-text">Change set · orders</span>
            <span className="inline-flex items-center gap-1 text-[#16a34a]"><Check className="h-3 w-3" aria-hidden="true" />Compiles · 0 errors</span>
          </div>
          {([
            ['+', 'measure', 'refunds', 'sum(refund_amount)'],
            ['+', 'derived', 'net_revenue', 'revenue - refunds - discounts'],
            ['+', 'relationship', 'orders → customers', 'many-to-one on customer_id'],
            ['~', 'dimension', 'channel', 'exposed via customer.channel'],
          ] as const).map(([kind, type, name, detail]) => (
            <div key={name} className="grid items-center gap-2.5 max-md:grid-cols-[16px_minmax(0,1fr)] md:grid-cols-[16px_76px_minmax(0,1fr)] border-b border-border px-3 py-2 text-[11.5px] last:border-b-0">
              <Mark kind={kind} />
              <span className="text-text-dim max-md:hidden">{type}</span>
              <span className="truncate">
                <span className="font-mono font-medium text-text">{name}</span>
                <span className="ml-2 font-mono text-[10.5px] text-text-muted">{detail}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="max-md:hidden">
          <div className="mb-1.5 text-[11px] text-text-dim">Results from draft net-revenue, last 3 months</div>
          <div className="overflow-hidden rounded-lg border border-border bg-bg">
            <Table
              head={['month', 'revenue', 'refunds', 'net_revenue']}
              align={['left', 'right', 'right', 'right']}
              rows={[
                ['2026-07', '$1,284,410', '$41,902', '$1,198,311'],
                ['2026-08', '$1,342,077', '$38,215', '$1,259,640'],
                ['2026-09', '$1,401,930', '$52,668', '$1,301,452'],
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewScreen() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5 text-[11px]">
        <span className="rounded-md bg-[#22c55e]/15 px-2 py-0.5 text-[#16a34a]">+3 added</span>
        <span className="rounded-md bg-[#f59e0b]/15 px-2 py-0.5 text-[#d97706]">~2 modified</span>
        <span className="rounded-md bg-[#ef4444]/15 px-2 py-0.5 text-[#dc2626]">−1 removed</span>
        <span className="rounded-md border border-[#ef4444]/40 px-2 py-0.5 text-[#dc2626]">1 breaking</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[#16a34a] max-md:hidden"><Check className="h-3 w-3" aria-hidden="true" />Compiles · 12 contract tests pass</span>
      </div>
      <div className="grid min-h-0 flex-1 md:grid-cols-[210px_minmax(0,1fr)]">
        <div className="space-y-0.5 border-r border-border p-3 text-[11.5px] max-md:hidden">
          <div className="px-2 pb-1 text-[10.5px] text-text-dim">orders · 5 changes</div>
          {([
            ['~', 'avg_order_value', 'derived measure', true],
            ['+', 'net_revenue', 'derived measure', false],
            ['+', 'refunds', 'measure', false],
            ['+', 'customer', 'relationship', false],
            ['−', 'gross_margin_legacy', 'derived measure', false],
          ] as const).map(([kind, name, type, selected]) => (
            <div key={name} className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${selected ? 'bg-bg-alt' : ''}`}>
              <Mark kind={kind} />
              <span className="min-w-0">
                <span className="block truncate font-mono text-text">{name}</span>
                <span className="block text-[10px] text-text-dim">{type}</span>
              </span>
              {kind === '−' && <span className="ml-auto rounded bg-[#ef4444]/15 px-1 text-[9px] font-medium text-[#dc2626]">BREAKING</span>}
            </div>
          ))}
          <div className="px-2 pb-1 pt-2 text-[10.5px] text-text-dim">refunds · 1 change</div>
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
            <Mark kind="~" />
            <span>
              <span className="block font-mono text-text">tenant</span>
              <span className="block text-[10px] text-text-dim">access rule</span>
            </span>
          </div>
        </div>

        <div className="min-w-0 space-y-3.5 overflow-hidden max-md:p-4 md:p-5">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[13px] font-semibold text-text">orders.avg_order_value</span>
            <span className="text-[11px] text-text-dim">derived measure · modified</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-bg max-md:hidden">
            <Table
              head={['Property', 'Published (v42)', 'Draft net-revenue']}
              rows={[
                ['Expression', <span key="a" className="text-[#dc2626] line-through">revenue / order_count</span>, <span key="b" className="text-[#16a34a]">net_revenue / order_count</span>],
                ['Uses', <span key="a" className="text-[#dc2626] line-through">revenue, order_count</span>, <span key="b" className="text-[#16a34a]">net_revenue, order_count</span>],
                ['Format', 'Currency', 'Currency'],
              ]}
            />
          </div>
          <div>
            <div className="mb-1.5 text-[11px] text-text-dim">Data impact: the same query on Published and on the draft, by month</div>
            <div className="overflow-hidden rounded-lg border border-border bg-bg">
              <Table
                head={['month', 'published', 'draft', 'change']}
                align={['left', 'right', 'right', 'right']}
                rows={[
                  ['2026-07', '$48.12', '$44.91', '−6.7%'],
                  ['2026-08', '$48.66', '$45.67', '−6.1%'],
                  ['2026-09', '$49.30', '$45.76', '−7.2%'],
                ]}
              />
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] text-text-dim">Who&apos;s affected</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ['API keys querying this', '3', 'last 7 days'],
                ['MCP clients', '1', 'Claude, Cursor'],
                ['Requests touching field', '18,204', 'last 7 days'],
              ].map(([label, value, detail]) => (
                <div key={label} className="rounded-lg border border-border bg-bg px-3 py-2">
                  <div className="text-[10.5px] text-text-muted">{label}</div>
                  <div className="mt-0.5 text-lg font-medium tracking-tight text-text">{value}</div>
                  <div className="text-[10px] text-text-dim">{detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeploymentsScreen() {
  const versions = [
    ['v42', 'Rename session dimensions', 'Live', 'Draft session-dims · MK', '3 days ago'],
    ['v41', 'Model subscriptions table', '', 'Draft subscriptions · LR', '9 days ago'],
    ['v40', 'Cohort month on customers', 'Rolled back', 'Draft cohort-month · JS', '12 days ago'],
    ['v39', 'Tenant scoping for refunds', '', 'CI · hq deploy', '2 weeks ago'],
    ['v38', 'Initial model', '', 'Onboarding chat · LR', '3 weeks ago'],
  ] as const;

  return (
    <div className="h-full max-md:p-4 md:p-6">
      <div className="text-[13px] font-medium text-text">Production history</div>
      <div className="mt-1 text-[11.5px] text-text-muted">Every version that has been published. Open one to see its schema, read-only.</div>
      <div className="relative mt-4 overflow-visible rounded-lg border border-border bg-bg">
        {versions.map(([version, change, status, from, when], index) => (
          <div key={version} className="grid items-center gap-3 max-md:grid-cols-[34px_minmax(0,1fr)_auto] md:grid-cols-[48px_minmax(0,1.4fr)_minmax(0,1fr)_90px_auto] border-b border-border px-4 py-2.5 text-[11.5px] last:border-b-0">
            <span className="font-mono font-medium text-text">{version}</span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-text">{change}</span>
              {status && (
                <span className={`rounded-full px-1.5 py-px text-[9.5px] font-medium ${status === 'Live' ? 'bg-[#22c55e]/15 text-[#16a34a]' : 'bg-bg-alt text-text-muted'}`}>{status}</span>
              )}
            </span>
            <span className="truncate text-text-muted max-md:hidden">{from}</span>
            <span className="text-text-dim">{when}</span>
            <span className="flex gap-3 text-[11px] max-md:hidden">
              <span className="text-text-muted">View schema</span>
              {index > 0 && <span className={index === 1 ? 'font-medium text-accent' : 'text-text-muted'}>Roll back to this</span>}
            </span>
          </div>
        ))}
        <motion.div {...reveal} transition={{ ...reveal.transition, delay: 0.6 }} className="absolute top-[86px] z-10 rounded-lg max-md:inset-x-3 md:right-4 md:w-[270px] border border-border-strong bg-bg-card p-3 text-[11.5px] shadow-card">
          <div className="font-medium text-text">Roll back to v41?</div>
          <p className="mt-1 leading-4 text-text-muted">Published goes back to v41 right away. Later versions stay listed here, and open drafts are kept.</p>
          <div className="mt-3 flex justify-end gap-2">
            <span className="rounded-md border border-border px-2 py-1 text-text">Cancel</span>
            <span className="rounded-md bg-accent px-2 py-1 font-medium text-white dark:text-[#0c0e14]">Roll back</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function LogsScreen() {
  const rows = [
    ['12:41:08', 200, 'orders · net_revenue by month', 'Chat · LR', '184 ms', '3'],
    ['12:40:51', 200, 'orders · net_revenue by customer.channel', 'Chat · LR', '242 ms', '4'],
    ['12:38:02', 400, 'orders · gross_margin_legacy by sku', 'API test key · finance-dashboard', '9 ms', '–'],
    ['12:31:44', 200, 'orders · avg_order_value by month', 'Validation', '131 ms', '3'],
    ['12:29:10', 200, 'orders · revenue, refunds by month', 'Chat · LR', '201 ms', '3'],
    ['12:18:37', 200, 'customers · customer_count by channel', 'Chat · LR', '88 ms', '4'],
  ] as const;

  return (
    <div className="grid h-full content-start md:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 max-md:p-4 md:p-5">
        <div className="text-[11px] text-text-dim">Requests against draft net-revenue · last 30 min</div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[['Requests', '41'], ['Errors', '1'], ['p95 latency', '242 ms']].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-bg px-3 py-2">
              <div className="text-[10.5px] text-text-muted">{label}</div>
              <div className="text-base font-medium text-text">{value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-bg">
          {rows.map(([time, status, query, source, duration, count], index) => (
            <div key={time} className={`${index > 3 ? 'max-md:hidden ' : ''}grid items-center gap-2.5 max-md:grid-cols-[52px_32px_minmax(0,1fr)] md:grid-cols-[58px_34px_minmax(0,1fr)_minmax(0,0.8fr)_50px_18px] border-b border-border px-3 py-2 font-mono text-[10.5px] last:border-b-0 ${status === 400 ? 'bg-[#ef4444]/[0.06]' : ''}`}>
              <span className="text-text-dim">{time}</span>
              <span className={`rounded px-1 text-center ${status === 200 ? 'bg-[#22c55e]/15 text-[#16a34a]' : 'bg-[#ef4444]/15 text-[#dc2626]'}`}>{status}</span>
              <span className="truncate text-text">{query}</span>
              <span className="truncate font-sans text-text-muted max-md:hidden">{source}</span>
              <span className="text-right text-text-muted max-md:hidden">{duration}</span>
              <span className="text-right text-text-muted max-md:hidden">{count}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 border-border bg-bg-alt/30 p-4 text-[11.5px] max-md:border-t md:border-l">
        <div className="flex items-center gap-2">
          <span className="rounded bg-[#ef4444]/15 px-1 font-mono text-[10.5px] text-[#dc2626]">400</span>
          <span className="truncate font-mono text-text">gross_margin_legacy by sku</span>
        </div>
        <div className="rounded-lg border border-[#ef4444]/30 bg-[#ef4444]/[0.06] p-3 leading-4">
          <div className="font-medium text-[#dc2626]">Unknown measure gross_margin_legacy</div>
          <p className="mt-1 text-text-muted">
            This draft removes it, and finance-dashboard still asks for it. Once you publish, it will get this error on
            Published too.
          </p>
          <div className="mt-2.5 flex gap-2 text-[11px]">
            <span className="rounded-md border border-border bg-bg-card px-2 py-1 text-text">See it in Review</span>
            <span className="rounded-md border border-border bg-bg-card px-2 py-1 text-text">Ask chat to fix</span>
          </div>
        </div>
        <div className="space-y-1 font-mono text-[10.5px] text-text-muted max-md:hidden">
          <div><span className="text-text-dim">Tenant </span>org_id = acme-eu</div>
          <div><span className="text-text-dim">Trace </span>tr_8f21c2a9</div>
        </div>
      </div>
    </div>
  );
}

function PageTitle({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-nowrap text-[13.5px] font-semibold text-text max-md:hidden">{children}</span>;
}

function Subtitle({ children }: { children: React.ReactNode }) {
  return <span className="truncate text-[12.5px] text-text-muted max-xl:hidden">{children}</span>;
}

function PrimaryButton({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-8 shrink-0 items-center rounded-[7px] bg-accent px-3 text-[13px] font-medium text-white dark:text-[#0c0e14]">{children}</span>;
}

const SCREENS: {
  id: string;
  title: string;
  copy: string;
  page: CloudPage;
  crumbs: React.ReactNode;
  actions: React.ReactNode;
  Screen: () => React.JSX.Element;
}[] = [
  {
    id: 'draft',
    title: 'Every change starts in a draft',
    copy: 'Published is locked. Ask for a change and it lands in a draft that compiles and runs test queries.',
    page: 'chat',
    crumbs: (
      <>
        <VersionSwitch draft name="net-revenue" detail="Draft" />
        <Slash className="max-md:hidden" />
        <PageTitle>Chat</PageTitle>
        <Subtitle>one thread per draft · started 25 min ago</Subtitle>
      </>
    ),
    actions: (
      <>
        <Subtitle>4 unsaved changes</Subtitle>
        <PrimaryButton>Save</PrimaryButton>
      </>
    ),
    Screen: DraftScreen,
  },
  {
    id: 'review',
    title: 'Review the impact before you publish',
    copy: 'See what changed in meaning, how the numbers move, and which API keys and agents are affected.',
    page: 'model',
    crumbs: (
      <>
        <VersionSwitch draft name="net-revenue" detail="Draft" />
        <Slash className="max-md:hidden" />
        <PageTitle>Review &amp; publish</PageTitle>
      </>
    ),
    actions: (
      <>
        <Subtitle>4 unsaved changes</Subtitle>
        <PrimaryButton>Publish as v43</PrimaryButton>
      </>
    ),
    Screen: ReviewScreen,
  },
  {
    id: 'deployments',
    title: 'Roll back in one click',
    copy: 'Every published version is kept, from chat, the editor, or CI. Go back to any of them right away.',
    page: 'settings',
    crumbs: (
      <>
        <VersionSwitch draft={false} name="Published" detail="v42" />
        <Slash className="max-md:hidden" />
        <PageTitle>Settings › Deployments</PageTitle>
      </>
    ),
    actions: null,
    Screen: DeploymentsScreen,
  },
  {
    id: 'logs',
    title: 'Catch breaking requests early',
    copy: 'Every request against a draft is logged, so a dashboard that still needs a removed measure shows up first.',
    page: 'logs',
    crumbs: (
      <>
        <VersionSwitch draft name="net-revenue" detail="Draft" />
        <Slash className="max-md:hidden" />
        <PageTitle>Logs</PageTitle>
      </>
    ),
    actions: null,
    Screen: LogsScreen,
  },
];

export function CloudWorkflow() {
  const ref = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const reduced = useReducedMotion() ?? false;
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState(false);

  // Step through the screens while the section is on screen, until someone picks one.
  useEffect(() => {
    if (!inView || pinned || reduced) return;
    const timer = window.setInterval(() => setActive((index) => (index + 1) % SCREENS.length), AUTO_ADVANCE_MS);
    return () => window.clearInterval(timer);
  }, [inView, pinned, reduced]);

  // On small screens the tabs are a scrolling row; keep the active one in view without moving the page.
  useEffect(() => {
    const row = tabsRef.current;
    const tab = row?.children[active] as HTMLElement | undefined;
    if (!row || !tab || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({ left: tab.offsetLeft - row.offsetLeft - 20, behavior: reduced ? 'auto' : 'smooth' });
  }, [active, reduced]);

  const screen = SCREENS[active];

  return (
    <section aria-labelledby="cloud-workflow-title" className="mx-auto max-w-[1280px] px-5 pb-4 pt-14 sm:px-8 sm:pt-20">
      <h2 id="cloud-workflow-title" className="home-section-title max-w-[720px] text-text">Change it without breaking production</h2>
      <p className="mt-4 max-w-[600px] text-sm leading-6 text-text-muted sm:text-base">
        Your API and agents keep serving the published version while you, the AI, or CI work in drafts.
      </p>

      <div ref={ref} className="grid max-lg:mt-8 max-lg:gap-5 lg:mt-10 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-6">
        <div role="tablist" aria-label="Cloud workflow" ref={tabsRef} className="flex [scrollbar-width:none] max-lg:snap-x max-lg:gap-2 max-lg:overflow-x-auto max-sm:-mx-5 max-sm:scroll-px-5 max-sm:px-5 sm:max-lg:-mx-8 sm:max-lg:scroll-px-8 sm:max-lg:px-8 lg:flex-col lg:gap-1">
          {SCREENS.map(({ id, title, copy }, index) => {
            const selected = index === active;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="cloud-workflow-panel"
                onClick={() => {
                  setActive(index);
                  setPinned(true);
                }}
                className={`relative shrink-0 snap-start overflow-hidden border px-4 text-left transition max-lg:rounded-full max-lg:py-2 lg:rounded-lg lg:py-3 ${selected ? 'border-border-strong bg-bg-card' : 'border-transparent hover:bg-bg-card/60'}`}
              >
                <span className={`block font-medium max-lg:whitespace-nowrap max-lg:text-[13px] lg:text-sm ${selected ? 'text-text' : 'text-text-muted'}`}>{title}</span>
                <span className={`mt-1 block text-[13px] leading-5 max-lg:hidden ${selected ? 'text-text-muted' : 'text-text-dim'}`}>{copy}</span>
                {selected && inView && !pinned && !reduced && (
                  <motion.span
                    key={active}
                    className="absolute bottom-0 left-0 h-0.5 bg-accent"
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: AUTO_ADVANCE_MS / 1000, ease: 'linear' }}
                  />
                )}
              </button>
            );
          })}
        </div>
        <p className="-mt-2 text-sm leading-6 text-text-muted lg:hidden">{screen.copy}</p>

        <div id="cloud-workflow-panel" role="tabpanel" aria-label={screen.title} className="flex overflow-hidden rounded-xl border border-border bg-bg-card shadow-card">
          <CloudRail page={screen.page} className="max-md:hidden" />
          <div className="flex min-w-0 flex-1 flex-col">
            <CloudHeader
              logo="mobile"
              actions={
                <span className="flex items-center gap-2.5 max-md:hidden">
                  {screen.actions}
                  <ConnectButton />
                </span>
              }
            >
              {screen.crumbs}
            </CloudHeader>
            <div className="overflow-hidden max-md:h-[500px] md:h-[540px]">
              <motion.div key={screen.id} {...reveal} className="h-full">
                <screen.Screen />
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
