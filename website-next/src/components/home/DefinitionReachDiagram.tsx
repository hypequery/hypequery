import { useState } from 'react';

const codeLines = {
  typescript: [
  <><span className="text-[#c792ea]">export const</span> <span className="text-[#82aaff]">orders</span> <span className="text-text-muted">=</span> <span className="text-[#c792ea]">dataset</span><span className="text-text-muted">({'{'}</span></>,
  <><span className="text-text-muted">  name:</span> <span className="text-[#c3e88d]">&apos;orders&apos;</span><span className="text-text-muted">,</span></>,
  <><span className="text-text-muted">  table:</span> <span className="text-[#c3e88d]">&apos;orders&apos;</span><span className="text-text-muted">,</span></>,
  <><span className="text-text-muted">  dimensions:</span> <span className="text-text-muted">{'{'}</span></>,
  <><span className="text-text-muted">    status:</span> <span className="text-[#82aaff]">string</span><span className="text-text-muted">,</span></>,
  <><span className="text-text-muted">    createdAt:</span> <span className="text-[#82aaff]">date</span><span className="text-text-muted">,</span></>,
  <><span className="text-text-muted">  {'}'},</span></>,
  <><span className="text-text-muted">  measures:</span> <span className="text-text-muted">{'{'}</span></>,
  <><span className="text-text-muted">    revenue:</span> <span className="text-[#c792ea]">sum</span><span className="text-text-muted">(amount),</span></>,
  <><span className="text-text-muted">  {'}'}</span></>,
  <><span className="text-text-muted">{' });'}</span></>,
  ],
  python: [
    <><span className="text-[#c792ea]">orders</span> <span className="text-text-muted">=</span> <span className="text-[#c792ea]">dataset</span><span className="text-text-muted">(</span></>,
    <><span className="text-text-muted">    name=</span><span className="text-[#c3e88d]">&quot;orders&quot;</span><span className="text-text-muted">,</span></>,
    <><span className="text-text-muted">    table=</span><span className="text-[#c3e88d]">&quot;orders&quot;</span><span className="text-text-muted">,</span></>,
    <><span className="text-text-muted">    dimensions={'{'}</span></>,
    <><span className="text-text-muted">        </span><span className="text-[#c3e88d]">&quot;status&quot;</span><span className="text-text-muted">: String,</span></>,
    <><span className="text-text-muted">        </span><span className="text-[#c3e88d]">&quot;created_at&quot;</span><span className="text-text-muted">: Date,</span></>,
    <><span className="text-text-muted">    {'}'},</span></>,
    <><span className="text-text-muted">    measures={'{'}</span></>,
    <><span className="text-text-muted">        revenue: Sum(</span><span className="text-[#c3e88d]">&quot;amount&quot;</span><span className="text-text-muted">),</span></>,
    <><span className="text-text-muted">    {'}'}</span></>,
    <><span className="text-text-muted">)</span></>,
  ],
};

const consumers = [
  ['01', 'API', 'validated endpoints'],
  ['02', 'React', 'hooks and dashboards'],
  ['03', 'MCP', 'governed AI tools'],
];

export function DefinitionReachDiagram() {
  const [language, setLanguage] = useState<'typescript' | 'python'>('typescript');
  const isPython = language === 'python';

  return (
    <div className="relative grid h-full min-h-[220px] grid-cols-[minmax(0,1.12fr)_minmax(180px,.88fr)] gap-4 overflow-hidden rounded-lg border border-border bg-bg-card p-3 sm:gap-6 sm:p-4" aria-label="Orders data model reachable through API, React, and MCP">
      <div className="min-w-0 overflow-hidden rounded-md border border-border bg-bg-alt">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 font-mono text-[10px] text-text-dim">
          <button type="button" onClick={() => setLanguage('typescript')} className={`rounded-sm px-1 py-0.5 text-[9px] font-bold transition-colors ${!isPython ? 'bg-accent-soft text-accent' : 'text-text-dim hover:text-text'}`}>TS</button>
          <button type="button" onClick={() => setLanguage('python')} className={`rounded-sm px-1 py-0.5 text-[9px] font-bold transition-colors ${isPython ? 'bg-accent-soft text-accent' : 'text-text-dim hover:text-text'}`}>PY</button>
          {isPython ? 'datasets/orders.py' : 'datasets/orders.ts'}
          <span className="ml-auto text-text-dim">⧉</span>
        </div>
        <div className="p-3 font-mono text-[10px] leading-[1.85] sm:text-[11px]">
          {codeLines[language].map((line, index) => (
            <div className="flex min-w-max" key={index}>
              <span className="mr-3 inline-block w-4 select-none text-right text-white/25">{index + 1}</span>
              <code>{line}</code>
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute bottom-0 left-0 h-16 w-[54%] bg-gradient-to-t from-bg-card to-transparent" />
      </div>
      <div className="relative flex min-w-0 flex-col justify-center gap-2.5 py-2 sm:gap-3">
        <div className="absolute left-0 top-1/2 hidden h-px w-5 -translate-x-6 bg-accent/50 sm:block" />
        {consumers.map(([number, title, detail]) => (
          <div key={number} className="relative flex min-w-0 items-center gap-2 rounded border border-border bg-bg-alt px-2.5 py-2.5">
            <span className="font-mono text-[9px] text-accent/80">{number}</span>
            <span className="h-5 w-px bg-white/10" />
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-text">{title}</div>
              <div className="truncate text-[10px] text-text-dim">{detail}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-bg-card to-transparent" />
    </div>
  );
}
