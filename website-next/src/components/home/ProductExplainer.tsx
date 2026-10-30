'use client';

import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import * as Popover from '@radix-ui/react-popover';
import { ArrowUpRight, Braces, ChevronDown, Cloud, Code2, Database, MessagesSquare } from 'lucide-react';
import { SiClaude, SiClickhouse, SiGooglegemini, SiModelcontextprotocol, SiOpenapiinitiative, SiPython, SiReact, SiTypescript } from 'react-icons/si';
import { RiOpenaiFill } from 'react-icons/ri';
import { AppChat, ClaudeTerminal, useAiAnswers } from './AiAnswers';
import { DeployWaitlist } from './DeployWaitlist';
import { HypequeryMascotIcon } from '../HypequeryMascotIcon';
import { marketing } from '../ui/marketing';
import './ProductExplainer.css';

const CONNECTIONS = [
  'M200 50 C200 110 600 75 600 150',
  'M600 50 V150',
  'M1000 50 C1000 110 600 75 600 150',
  'M600 150 C600 225 200 190 200 290',
  'M600 150 V290',
  'M600 150 C600 225 1000 190 1000 290',
];

// The left and right curves from the model out to the API and agent cards.
const SIDE_OUTPUTS = [3, 5];

const ENTRANCE = {
  hidden: { opacity: 0, y: 10 },
  visible: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

// Every preview shares this height. The chat and terminal render at 80% so a few exchanges still fit.
const PREVIEW_HEIGHT = 'h-[300px]';
const PANEL_SCALE = 0.8;
const PANEL_HEIGHT = `${300 / PANEL_SCALE}px`;

const SOURCE_FIELDS = {
  orders: 'amount · created_at · customer_id',
  customers: 'plan · region · tenant_id',
  events: 'event · timestamp · tenant_id',
};

/** `modelCode` and `dashboardCode` are server-highlighted code samples, passed in from the page. */
export function ProductExplainer({ modelCode, dashboardCode }: { modelCode: ReactNode; dashboardCode: ReactNode }) {
  const reducedMotion = useReducedMotion();
  const [activeConnection, setActiveConnection] = useState<number | null>(null);
  const [dashboardView, setDashboardView] = useState<'preview' | 'code'>('preview');
  // Matches the chat and terminal: September is last month at $128K, August $104K.
  const [period, setPeriod] = useState<'september' | 'august'>('september');
  const latest = period === 'september';
  const revenue = latest ? '128,000' : '104,000';
  const countries = (latest
    ? [['GB', 64000], ['US', 48000], ['DE', 16000]]
    : [['GB', 52000], ['US', 39000], ['DE', 13000]]) as [string, number][];
  const answersRef = useRef<HTMLDivElement>(null);
  const answers = useAiAnswers(answersRef);
  const chartPath = latest
    ? 'M0 70C20 70 25 50 45 55S75 65 95 40S130 50 150 35S175 42 195 22S225 35 250 15S280 20 300 5'
    : 'M0 65C20 60 25 70 45 60S75 35 95 42S130 58 150 42S175 25 195 33S225 18 250 25S280 15 300 18';

  return (
    <section aria-labelledby="product-explainer-title" className="overflow-x-clip mx-auto max-w-[1280px] px-5 pt-14 sm:px-8 sm:pt-20">
      <motion.div variants={ENTRANCE} initial={reducedMotion ? false : "hidden"} whileInView="visible" viewport={{ once: true, amount: 0.2 }} custom={0} className="mx-auto max-w-[660px] text-center">
        <h2 id="product-explainer-title" className="home-section-title text-text">One model behind every answer</h2>
        <p className="mx-auto mt-4 max-w-[570px] text-sm leading-6 text-text-muted sm:text-base">Your dashboards, APIs and agents like Claude all query the same model, with the same tenant rules.</p>
      </motion.div>

      <motion.div variants={ENTRANCE} initial={reducedMotion ? false : "hidden"} whileInView="visible" viewport={{ once: true, amount: 0.2 }} custom={0.06} className="relative mt-9 h-[290px] sm:mt-12" role="figure" aria-label="ClickHouse tables flow into a shared hypequery model, then into dashboards, APIs, and MCP agents">
        <div className="absolute inset-x-0 -top-1 flex items-center justify-center gap-2 text-[11px] text-text-muted">
          <SiClickhouse className="h-3.5 w-3.5 text-[#d6a500]" aria-hidden="true" />
          <span>ClickHouse Cloud, chDB, or self-hosted</span>
        </div>
        <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1200 290" preserveAspectRatio="none" fill="none" aria-hidden="true">
          {CONNECTIONS.map((path, index) => (
            // On small screens the cards stack under the model, so only the centre line continues down to them.
            <g key={path} className={SIDE_OUTPUTS.includes(index) ? 'max-md:hidden' : undefined}>
              <path d={path} className={`explainer-connection ${activeConnection === index ? 'is-active' : ''}`} stroke="var(--border-strong)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
              <circle r="3" fill="var(--accent)" className="explainer-signal">
                <animateMotion path={path} dur="5s" begin={`-${index * 0.65}s`} repeatCount="indefinite" />
              </circle>
            </g>
          ))}
        </svg>
        <div className="absolute inset-x-0 top-[30px] grid grid-cols-3">
          {(['orders', 'customers', 'events'] as const).map((table, index) => (
            <div key={table} className="flex justify-center">
              <button type="button" aria-label={`Inspect ${table} fields`} onMouseEnter={() => setActiveConnection(index)} onMouseLeave={() => setActiveConnection(null)} onFocus={() => setActiveConnection(index)} onBlur={() => setActiveConnection(null)} className="explainer-source relative inline-flex items-center gap-2 rounded-lg border border-border bg-bg-card px-3 py-2 font-mono text-[10px] text-text-muted shadow-card sm:px-5 sm:text-xs"><Database className="h-3.5 w-3.5" aria-hidden="true" />{table}<span data-edge={index} className="explainer-source-detail" aria-hidden="true">{SOURCE_FIELDS[table]}</span></button>
            </div>
          ))}
        </div>
        <div className="explainer-model absolute left-1/2 top-[114px] -translate-x-1/2 rounded-[22px] border border-border/60 bg-bg/80 p-2.5 shadow-[0_0_50px_var(--accent-soft)]">
          <span className="explainer-model-ripple" aria-hidden="true" />
          <span className="explainer-model-ripple" aria-hidden="true" />
          <span className="explainer-model-ripple" aria-hidden="true" />
          <Popover.Root>
          <Popover.Trigger asChild>
          <button type="button" aria-label="View the model's code" className="explainer-model-trigger relative flex min-w-[260px] items-center gap-3 rounded-xl border border-border-strong bg-bg-card px-5 py-4 text-left shadow-card transition hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">
            <HypequeryMascotIcon blink className="h-6 w-6 text-accent" aria-hidden="true" />
            <div><span className="block text-lg font-semibold tracking-tight text-text">hypequery</span><span className="block text-[11px] text-text-muted">Your shared analytics model</span><span className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-medium text-accent"><Code2 className="h-3 w-3" aria-hidden="true" />View the code</span></div>
            <div className="ml-auto flex flex-col gap-1.5" aria-label="Model built in TypeScript, Python, or cloud"><SiTypescript className="h-3.5 w-3.5 text-[#3178c6]" title="TypeScript" /><SiPython className="h-3.5 w-3.5 text-[#3776ab]" title="Python" /><Cloud className="h-3.5 w-3.5 text-accent" strokeWidth={2} aria-label="Cloud" /></div>
          </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="bottom" sideOffset={12} collisionPadding={{ top: 120, right: 16, bottom: 16, left: 16 }} className="z-40 max-h-[var(--radix-popover-content-available-height)] w-[min(460px,calc(100vw-32px))] overflow-auto rounded-xl border border-border-strong bg-bg-card p-4 shadow-xl outline-none">
              <div className="mb-3 flex items-center justify-between font-mono text-[10px] text-text-dim"><span>analytics/orders.ts</span><Link href="/docs/datasets/defining-datasets" className="font-sans text-[11px] font-medium text-accent hover:underline">Defining datasets →</Link></div>
              {modelCode}
            </Popover.Content>
          </Popover.Portal>
          </Popover.Root>
        </div>
        <div className="absolute inset-x-0 bottom-8 text-center text-[10px] text-text-dim">Published v1 · orders, customers, refunds, events</div>
      </motion.div>

      <div ref={answersRef} className="grid border-border md:grid-cols-3 md:divide-x md:divide-border md:border-t">
        <motion.article variants={ENTRANCE} initial={reducedMotion ? false : "hidden"} whileInView="visible" viewport={{ once: true, amount: 0.15 }} custom={0.0} onMouseEnter={() => setActiveConnection(3)} onMouseLeave={() => setActiveConnection(null)} onFocusCapture={() => setActiveConnection(3)} onBlurCapture={() => setActiveConnection(null)} className="explainer-consumer min-w-0 pb-7 md:pr-6 md:pt-7 lg:pr-8">
          <div className="explainer-link md:hidden" aria-hidden="true" />
          <div className="flex items-center gap-2.5"><Braces className="h-5 w-5 text-accent" aria-hidden="true" /><h3 className="text-xl font-medium tracking-tight text-text">APIs</h3><div className="framework-logo-cluster ml-auto flex shrink-0 items-center pl-1" aria-label="Served from TypeScript or Python, with OpenAPI">
            {([
              ['TypeScript', SiTypescript, 'text-[#3178c6]'],
              ['Python', SiPython, 'text-[#3776ab]'],
              ['OpenAPI', SiOpenapiinitiative, 'text-[#6ba539]'],
            ] as const).map(([name, Icon, color]) => <span key={name} title={name} data-tooltip={name} aria-label={name} className={`logo-tooltip framework-logo inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg bg-bg-card shadow-card ${color}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>)}
          </div></div>
          <p className="mt-3 max-w-[350px] text-sm leading-6 text-text-muted">Every dataset is an authenticated endpoint with OpenAPI, for any frontend, mobile app or service.</p>
          <div className={`explainer-preview mt-6 flex flex-col overflow-hidden rounded-xl border border-border bg-bg-card font-mono text-[10.5px] leading-[1.5] shadow-card ${PREVIEW_HEIGHT}`} aria-label={`Illustrative API request and response for ${latest ? 'September' : 'August'} revenue by country`}>
            <div className="border-b border-border px-4 py-2.5">
              <div><span className="font-semibold text-accent">POST</span> <span className="text-text">/api/analytics/datasets/orders/query</span></div>
            </div>
            <pre className="m-0 border-b border-border px-4 py-2.5 text-text-muted">{`{
  "dimensions": ["country"],
  "measures": ["revenue"],
  "filters": [{ "field": "month",
    "operator": "eq", "value": "${latest ? '2026-09' : '2026-08'}" }]
}`}</pre>
            <div className="flex items-center gap-2 px-4 pt-2.5"><span className="rounded bg-[#27c93f]/15 px-1.5 py-px font-semibold text-[#1f9d55] dark:text-[#4ade80]">200 OK</span><span className="text-text-dim">application/json</span></div>
            <pre key={period} className="explainer-result m-0 min-h-0 flex-1 overflow-hidden px-4 pb-2.5 pt-1.5 text-text">{`{ "data": [
${countries.map(([country, value]) => `  { "country": "${country}", "revenue": "${value}.00" }`).join(',\n')}
] }`}</pre>
          </div>
          <Link href="/docs/http-openapi" aria-label="Read more about serving datasets over HTTP" className="explainer-read-more mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-text-muted">Read more <ArrowUpRight className="h-3 w-3" aria-hidden="true" /></Link>
        </motion.article>
        <motion.article variants={ENTRANCE} initial={reducedMotion ? false : "hidden"} whileInView="visible" viewport={{ once: true, amount: 0.15 }} custom={0.06} onMouseEnter={() => setActiveConnection(4)} onMouseLeave={() => setActiveConnection(null)} onFocusCapture={() => setActiveConnection(4)} onBlurCapture={() => setActiveConnection(null)} className="explainer-consumer min-w-0 pb-7 md:px-6 md:pt-7 lg:px-8">
          <div className="explainer-link md:hidden" aria-hidden="true" />
          <div className="flex items-center gap-2.5"><SiReact className="h-5 w-5 text-[#339db6]" aria-hidden="true" /><h3 className="text-xl font-medium tracking-tight text-text">Embedded analytics</h3>
            <div role="group" aria-label="Dashboard example view" className="ml-auto inline-flex rounded-md border border-border p-0.5 text-[10.5px]">
              {(['preview', 'code'] as const).map((view) => (
                <button key={view} type="button" aria-pressed={dashboardView === view} onClick={() => setDashboardView(view)} className={`rounded px-2 py-0.5 font-medium capitalize transition ${dashboardView === view ? 'bg-bg-alt text-text' : 'text-text-muted hover:text-text'}`}>{view}</button>
              ))}
            </div></div>
          <p className="mt-3 max-w-[350px] text-sm leading-6 text-text-muted">Ship embedded analytics with typed React hooks and your own components.</p>
          {dashboardView === 'code' ? (
            <div className={`explainer-preview mt-6 flex flex-col overflow-hidden rounded-xl border border-border bg-bg-card shadow-card ${PREVIEW_HEIGHT}`}>
              <div className="border-b border-border px-4 py-3 font-mono text-[10px] text-text-dim">components/RevenueByCountry.tsx</div>
              <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{dashboardCode}</div>
            </div>
          ) : (
          <div className={`explainer-preview mt-6 flex flex-col overflow-hidden rounded-xl border border-border bg-bg-card shadow-card ${PREVIEW_HEIGHT}`} aria-label={`Illustrative dashboard showing $${revenue} in revenue for ${latest ? 'September' : 'August'}`}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3"><span className="text-[11px] font-medium text-text">Revenue</span><div className="relative"><select aria-label="Example reporting period" value={period} onChange={(event) => setPeriod(event.target.value as 'september' | 'august')} className="explainer-period cursor-pointer appearance-none rounded border border-border bg-bg-card py-1 pl-2 pr-5 text-[9px] text-text-muted"><option value="september">September</option><option value="august">August</option></select><ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-text-muted" aria-hidden="true" /></div></div>
            <div className="px-4 pt-4"><span key={period} className="explainer-result text-2xl font-medium tracking-tight text-text">${revenue}</span><span className="ml-2 text-[10px] text-text-muted">USD</span></div>
            <svg key={period} className="explainer-chart mt-3 h-20 w-full px-4" viewBox="0 0 300 80" fill="none" aria-hidden="true"><path d="M0 15H300M0 40H300M0 65H300" stroke="var(--border)" strokeDasharray="3 5" /><path d={chartPath} stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" /><circle cx="300" cy={latest ? 5 : 18} r="3" fill="var(--accent)" /></svg>
            <div className="flex justify-between px-4 text-[9px] text-text-dim"><span>{latest ? '1 Sep' : '1 Aug'}</span><span>{latest ? '30 Sep' : '31 Aug'}</span></div>
            <div className="mt-auto border-t border-border px-4 pb-4 pt-3">
              <div className="text-[10px] text-text-dim">By country</div>
              <div className="mt-2 space-y-2">
                {countries.map(([country, value]) => (
                  <div key={country} className="flex items-center gap-3 text-[10px]">
                    <span className="w-5 font-mono text-text-muted">{country}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"><div key={period} className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(value / countries[0][1]) * 100}%` }} /></div>
                    <span className="w-12 text-right font-mono text-text">${value.toLocaleString('en-US')}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          )}
          <Link href="/docs/react/getting-started" aria-label="Read more about React dashboards" className="explainer-read-more mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-text-muted">Read more <ArrowUpRight className="h-3 w-3" aria-hidden="true" /></Link>
        </motion.article>
        <motion.article variants={ENTRANCE} initial={reducedMotion ? false : "hidden"} whileInView="visible" viewport={{ once: true, amount: 0.15 }} custom={0.12} onMouseEnter={() => setActiveConnection(5)} onMouseLeave={() => setActiveConnection(null)} onFocusCapture={() => setActiveConnection(5)} onBlurCapture={() => setActiveConnection(null)} className="explainer-consumer min-w-0 pb-7 md:pl-6 md:pt-7 lg:pl-8">
          <div className="explainer-link md:hidden" aria-hidden="true" />
          <div className="flex items-center gap-2.5"><span title="Model Context Protocol (MCP)"><SiModelcontextprotocol className="h-5 w-5 text-text" aria-label="Model Context Protocol" /></span><h3 className="text-xl font-medium tracking-tight text-text">AI agents</h3><div className="framework-logo-cluster ml-auto flex shrink-0 items-center pl-1" aria-label="AI model providers">
            {([
              ['Claude', SiClaude, 'text-[#d97757]'],
              ['OpenAI', RiOpenaiFill, 'text-text'],
              ['Gemini', SiGooglegemini, 'text-[#4285f4]'],
            ] as const).map(([name, Icon, color]) => <span key={name} title={name} data-tooltip={name} aria-label={name} className={`logo-tooltip framework-logo inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg bg-bg-card shadow-card ${color}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>)}
          </div></div>
          <p className="mt-3 max-w-[350px] text-sm leading-6 text-text-muted">Connect Claude, ChatGPT, or your favourite model over MCP. They only see what you publish.</p>
          <div className={`explainer-preview mt-6 ${PREVIEW_HEIGHT}`}>
            <div style={{ zoom: PANEL_SCALE, height: PANEL_HEIGHT }}>
              <ClaudeTerminal elapsed={answers.elapsed} reduced={answers.reduced} className="h-full" />
            </div>
          </div>
          <Link href="/docs/mcp/overview" aria-label="Read more about MCP agents" className="explainer-read-more mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-text-muted">Read more <ArrowUpRight className="h-3 w-3" aria-hidden="true" /></Link>
        </motion.article>
      </div>
      <motion.div variants={ENTRANCE} initial={reducedMotion ? false : "hidden"} whileInView="visible" viewport={{ once: true, amount: 0.2 }} custom={0.08} className="mt-4 grid overflow-hidden rounded-2xl border border-border bg-bg-card/40 md:mt-2 md:grid-cols-[0.9fr_1.1fr]">
        <div className="flex flex-col justify-center p-5 sm:p-6">
          <div className="flex items-center gap-2.5"><MessagesSquare className="h-5 w-5 text-accent" aria-hidden="true" /><h3 className="text-xl font-medium tracking-tight text-text">Embedded chat</h3><span className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">Coming soon</span></div>
          <p className="mt-3 max-w-[440px] text-sm leading-6 text-text-muted">Let your customers ask questions about their own data, inside your app. Chat answers from the same model as your dashboards, APIs and agents: the same question gets the same number everywhere.</p>
          <DeployWaitlist location="home-embedded-chat" className={`${marketing.secondaryButton} mt-5 min-h-10 self-start text-xs`} />
        </div>
        <div className="border-t border-border bg-bg-alt/60 p-4 md:border-l md:border-t-0">
          <div className="h-[240px]">
            <div style={{ zoom: PANEL_SCALE, height: `${240 / PANEL_SCALE}px` }}>
              <AppChat elapsed={answers.elapsed} reduced={answers.reduced} className="h-full" />
            </div>
          </div>
        </div>
      </motion.div>
      <p className="mt-5 text-center text-xs leading-5 text-text-muted">
        Server code uses the same model directly: <a href="#runs-where-title" className="font-medium text-text underline decoration-border underline-offset-2 hover:decoration-accent">jobs, reports and notebooks</a> in TypeScript or Python.
      </p>
    </section>
  );
}
