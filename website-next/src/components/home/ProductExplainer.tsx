'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, ChevronDown, Database, Layers3, RotateCcw, Send } from 'lucide-react';
import { SiClaude, SiClickhouse, SiGooglegemini, SiModelcontextprotocol, SiPython, SiReact, SiTypescript } from 'react-icons/si';
import { RiOpenaiFill } from 'react-icons/ri';
import { AppChat, ClaudeTerminal, useAiAnswers } from './AiAnswers';
import './ProductExplainer.css';

const CONNECTIONS = [
  'M200 50 C200 110 600 75 600 150',
  'M600 50 V150',
  'M1000 50 C1000 110 600 75 600 150',
  'M600 150 C600 225 200 190 200 290',
  'M600 150 V290',
  'M600 150 C600 225 1000 190 1000 290',
];

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

export function ProductExplainer() {
  const reducedMotion = useReducedMotion();
  const [activeConnection, setActiveConnection] = useState<number | null>(null);
  const [period, setPeriod] = useState('this month');
  const revenue = period === 'this month' ? '128,000' : '104,000';
  const countries = (period === 'this month'
    ? [['GB', 64000], ['US', 48000], ['DE', 16000]]
    : [['GB', 52000], ['US', 39000], ['DE', 13000]]) as [string, number][];
  const answersRef = useRef<HTMLDivElement>(null);
  const answers = useAiAnswers(answersRef);
  const chartPath = period === 'this month'
    ? 'M0 70C20 70 25 50 45 55S75 65 95 40S130 50 150 35S175 42 195 22S225 35 250 15S280 20 300 5'
    : 'M0 65C20 60 25 70 45 60S75 35 95 42S130 58 150 42S175 25 195 33S225 18 250 25S280 15 300 18';

  return (
    <section aria-labelledby="product-explainer-title" className="mx-auto max-w-[1280px] px-5 pb-12 pt-14 sm:px-8 sm:pt-20">
      <motion.div variants={ENTRANCE} initial={reducedMotion ? false : "hidden"} whileInView="visible" viewport={{ once: true, amount: 0.2 }} custom={0} className="mx-auto max-w-[660px] text-center">
        <h2 id="product-explainer-title" className="home-section-title text-text">One model, every interface</h2>
        <p className="mx-auto mt-4 max-w-[570px] text-sm leading-6 text-text-muted sm:text-base">Define your ClickHouse analytics once in code. Dashboards, embedded chat, and AI agents all read from it.</p>
      </motion.div>

      <motion.div variants={ENTRANCE} initial={reducedMotion ? false : "hidden"} whileInView="visible" viewport={{ once: true, amount: 0.2 }} custom={0.06} className="relative mt-9 h-[290px] sm:mt-12" aria-label="ClickHouse tables flow into a shared hypequery model, then into dashboards, chat, and MCP agents">
        <div className="absolute inset-x-0 -top-1 flex items-center justify-center gap-2 text-[11px] text-text-muted">
          <SiClickhouse className="h-3.5 w-3.5 text-[#d6a500]" aria-hidden="true" />
          <span>ClickHouse Cloud, chDB, or self-hosted</span>
        </div>
        <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1200 290" preserveAspectRatio="none" fill="none" aria-hidden="true">
          {CONNECTIONS.map((path, index) => (
            <g key={path}>
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
          <div className="relative flex min-w-[260px] items-center gap-3 rounded-xl border border-border-strong bg-bg-card px-5 py-4 shadow-card">
            <Layers3 className="h-6 w-6 text-accent" aria-hidden="true" />
            <div><span className="block text-lg font-semibold tracking-tight text-text">hypequery</span><span className="block text-[11px] text-text-muted">Your shared analytics model</span></div>
            <div className="ml-auto flex flex-col gap-2" aria-label="Model in TypeScript or Python"><SiTypescript className="h-3.5 w-3.5 text-[#3178c6]" title="TypeScript" /><SiPython className="h-3.5 w-3.5 text-[#3776ab]" title="Python" /></div>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-8 text-center text-[10px] text-text-dim">Shared metrics · dimensions · tenant rules</div>
        <div className="absolute inset-x-0 -bottom-2 grid grid-cols-3 text-center text-[10px] text-text-muted md:hidden">
          {['React', 'Chat', 'MCP'].map((surface) => <div key={surface}><span className="rounded border border-border bg-bg-card px-3 py-1">{surface}</span></div>)}
        </div>
      </motion.div>

      <div ref={answersRef} className="grid border-t border-border md:grid-cols-3 md:divide-x md:divide-border">
        <motion.article variants={ENTRANCE} initial={reducedMotion ? false : "hidden"} whileInView="visible" viewport={{ once: true, amount: 0.15 }} custom={0.0} onMouseEnter={() => setActiveConnection(3)} onMouseLeave={() => setActiveConnection(null)} onFocusCapture={() => setActiveConnection(3)} onBlurCapture={() => setActiveConnection(null)} className="explainer-consumer min-w-0 py-7 md:pr-6 lg:pr-8">
          <div className="flex items-center gap-2.5"><SiReact className="h-5 w-5 text-[#339db6]" aria-hidden="true" /><h3 className="text-xl font-medium tracking-tight text-text">Your dashboards</h3></div>
          <p className="mt-3 max-w-[350px] text-sm leading-6 text-text-muted">Build with typed React hooks and your own components.</p>
          <div className={`explainer-preview mt-6 flex flex-col overflow-hidden rounded-xl border border-border bg-bg-card shadow-card ${PREVIEW_HEIGHT}`} aria-label={`Illustrative dashboard showing $${revenue} in revenue ${period}`}>
            <div className="flex items-center justify-between border-b border-border px-4 py-3"><span className="text-[11px] font-medium text-text">Revenue</span><div className="relative"><select aria-label="Example reporting period" value={period} onChange={(event) => setPeriod(event.target.value)} className="explainer-period cursor-pointer appearance-none rounded border border-border bg-bg-card py-1 pl-2 pr-5 text-[9px] text-text-muted"><option value="this month">This month</option><option value="last month">Last month</option></select><ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-text-muted" aria-hidden="true" /></div></div>
            <div className="px-4 pt-4"><span key={period} className="explainer-result text-2xl font-medium tracking-tight text-text">${revenue}</span><span className="ml-2 text-[10px] text-text-muted">USD</span></div>
            <svg key={period} className="explainer-chart mt-3 h-20 w-full px-4" viewBox="0 0 300 80" fill="none" aria-hidden="true"><path d="M0 15H300M0 40H300M0 65H300" stroke="var(--border)" strokeDasharray="3 5" /><path d={chartPath} stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" /><circle cx="300" cy={period === 'this month' ? 5 : 18} r="3" fill="var(--accent)" /></svg>
            <div className="flex justify-between px-4 text-[9px] text-text-dim"><span>{period === 'this month' ? '1 Oct' : '1 Sep'}</span><span>{period === 'this month' ? '31 Oct' : '30 Sep'}</span></div>
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
          <Link href="/docs/react/getting-started" aria-label="Read more about React dashboards" className="explainer-read-more mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-text-muted">Read more <ArrowUpRight className="h-3 w-3" aria-hidden="true" /></Link>
        </motion.article>
        <motion.article variants={ENTRANCE} initial={reducedMotion ? false : "hidden"} whileInView="visible" viewport={{ once: true, amount: 0.15 }} custom={0.06} onMouseEnter={() => setActiveConnection(4)} onMouseLeave={() => setActiveConnection(null)} onFocusCapture={() => setActiveConnection(4)} onBlurCapture={() => setActiveConnection(null)} className="explainer-consumer min-w-0 py-7 max-md:border-t max-md:border-border md:px-6 lg:px-8">
          <div className="flex items-center gap-2.5"><Send className="h-4.5 w-4.5 text-accent" aria-hidden="true" /><h3 className="text-xl font-medium tracking-tight text-text">Embedded chat</h3><span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[10px] font-normal text-text-muted">Coming soon</span></div>
          <p className="mt-3 max-w-[350px] text-sm leading-6 text-text-muted">Let customers ask questions about their data, inside your app.</p>
          <div className={`explainer-preview mt-6 ${PREVIEW_HEIGHT}`}>
            <div style={{ zoom: PANEL_SCALE, height: PANEL_HEIGHT }}>
              <AppChat elapsed={answers.elapsed} reduced={answers.reduced} className="h-full" />
            </div>
          </div>
        </motion.article>
        <motion.article variants={ENTRANCE} initial={reducedMotion ? false : "hidden"} whileInView="visible" viewport={{ once: true, amount: 0.15 }} custom={0.12} onMouseEnter={() => setActiveConnection(5)} onMouseLeave={() => setActiveConnection(null)} onFocusCapture={() => setActiveConnection(5)} onBlurCapture={() => setActiveConnection(null)} className="explainer-consumer min-w-0 py-7 max-md:border-t max-md:border-border md:pl-6 lg:pl-8">
          <div className="flex items-center gap-2.5"><span title="Model Context Protocol (MCP)"><SiModelcontextprotocol className="h-5 w-5 text-text" aria-label="Model Context Protocol" /></span><h3 className="text-xl font-medium tracking-tight text-text">Connected agents</h3><div className="framework-logo-cluster ml-auto flex shrink-0 items-center pl-1" aria-label="AI model providers">
            {([
              ['Claude', SiClaude, 'text-[#d97757]'],
              ['OpenAI', RiOpenaiFill, 'text-text'],
              ['Gemini', SiGooglegemini, 'text-[#4285f4]'],
            ] as const).map(([name, Icon, color]) => <span key={name} title={name} data-tooltip={name} aria-label={name} className={`logo-tooltip framework-logo inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-bg bg-bg-card shadow-card ${color}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>)}
          </div></div>
          <p className="mt-3 max-w-[350px] text-sm leading-6 text-text-muted">Give MCP agents access to the analytics you choose to publish.</p>
          <div className={`explainer-preview mt-6 ${PREVIEW_HEIGHT}`}>
            <div style={{ zoom: PANEL_SCALE, height: PANEL_HEIGHT }}>
              <ClaudeTerminal elapsed={answers.elapsed} reduced={answers.reduced} className="h-full" />
            </div>
          </div>
          <Link href="/docs/mcp/overview" aria-label="Read more about MCP agents" className="explainer-read-more mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-text-muted">Read more <ArrowUpRight className="h-3 w-3" aria-hidden="true" /></Link>
        </motion.article>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={answers.replay}
          aria-label="Replay the chat and agent examples"
          className={`rounded-md p-1.5 text-text-dim transition hover:text-text ${answers.done ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
