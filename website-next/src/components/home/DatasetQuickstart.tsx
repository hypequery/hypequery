'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowRight, Check, Cloud, Copy, Database, Server } from 'lucide-react';
import { SiFastapi, SiHono, SiPython, SiTypescript } from 'react-icons/si';
import CodeHighlight from '@/components/CodeHighlight';
import { DeployWaitlist } from './DeployWaitlist';
import { BACKEND_EXAMPLES, CLOUD_COMMANDS, CLOUD_EXAMPLES, DATASET_EXAMPLES } from './datasetQuickstartExamples';

export function DatasetQuickstart() {
  const [language, setLanguage] = useState<keyof typeof DATASET_EXAMPLES>('typescript');
  const [copyStatus, setCopyStatus] = useState('');
  const [example, setExample] = useState<'dataset' | 'backend' | 'cloud'>('dataset');
  const isBackend = example === 'backend';
  const isCloud = example === 'cloud';
  const code = (isCloud ? CLOUD_EXAMPLES : isBackend ? BACKEND_EXAMPLES : DATASET_EXAMPLES)[language];

  return (
    <section aria-labelledby="dataset-quickstart-title" className="mx-auto max-w-[1280px] px-5 py-12 sm:px-8 sm:py-16">
      <div className="mb-8 max-w-[620px]">
        <h2 id="dataset-quickstart-title" className="home-section-title text-text">Start with one dataset.</h2>
        <p className="mt-4 text-sm leading-6 text-text-muted sm:text-base">Define once. Run in your backend or publish to Cloud.</p>
      </div>
      <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Dataset developer examples">
        {(['dataset', 'backend', 'cloud'] as const).map((value) => <button key={value} id={`dataset-step-${value}`} role="tab" type="button" aria-selected={example === value} aria-controls="dataset-example-panel" tabIndex={example === value ? 0 : -1} onClick={() => { setExample(value); setCopyStatus(''); }} onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const steps = ['dataset', 'backend', 'cloud'] as const;
            const next = event.key === 'Home' ? 'dataset' : event.key === 'End' ? 'cloud' : steps[(steps.indexOf(value) + (event.key === 'ArrowRight' ? 1 : 2)) % steps.length];
            setExample(next);
            setCopyStatus('');
            document.getElementById(`dataset-step-${next}`)?.focus();
          }
        }} className={`dataset-language rounded-md px-4 py-2.5 text-sm font-medium ${example === value ? 'bg-accent-soft text-accent' : 'text-text-muted hover:text-text'}`}>{value === 'dataset' ? 'Define & query' : value === 'backend' ? 'Run in your backend' : 'Publish to Cloud'}</button>)}
      </div>
      <div id="dataset-example-panel" role="tabpanel" aria-labelledby={`dataset-step-${example}`} className="dataset-quickstart-panel overflow-hidden rounded-xl border border-border bg-bg-card shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-center gap-1" role="group" aria-label="Example language">
            {(['typescript', 'python'] as const).map((value) => {
              const Icon = value === 'typescript' ? SiTypescript : SiPython;
              return <button key={value} type="button" aria-pressed={language === value} onClick={() => { setLanguage(value); setCopyStatus(''); }} className={`dataset-language flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium ${language === value ? 'bg-accent-soft text-accent' : 'text-text-muted hover:text-text'}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{value === 'typescript' ? 'TypeScript' : 'Python'}</button>;
            })}
          </div>
          <button type="button" aria-label="Copy dataset example" className="dataset-copy flex items-center gap-2 rounded-md px-2 py-1 text-xs text-text-muted hover:text-text" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopyStatus('Copied'); } catch { setCopyStatus('Select code to copy'); } }}>{copyStatus === 'Copied' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}<span aria-live="polite">{copyStatus || 'Copy'}</span></button>
        </div>
        <div className="dataset-quickstart-layout">
          <div className="min-w-0 bg-bg-alt/50 p-5 sm:p-6">
            <div className="mb-4 font-mono text-[10px] text-text-dim">{isCloud ? 'analytics/cloud' : isBackend ? 'routes/revenue' : 'analytics/orders'}.{language === 'typescript' ? 'ts' : 'py'}</div>
            <CodeHighlight key={`${example}-${language}`} code={code} language={language} className="min-h-[280px] [&_code]:text-[11px] [&_code]:leading-[1.75] sm:[&_code]:text-xs" />
          </div>
          <div className="dataset-example-result flex min-w-0 flex-col p-5 sm:p-6">
            {isCloud ? <>
              <div className="flex items-center gap-2 text-xs font-medium text-text"><Cloud className="h-4 w-4 text-accent" aria-hidden="true" />hypequery Cloud<span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[10px] font-normal text-text-muted">Early access</span></div>
              <p className="mt-3 text-xs leading-5 text-text-muted">Publish your datasets as hosted REST and MCP endpoints.</p>
              <div className="mt-5 min-w-0 rounded-lg border border-border bg-bg-alt/50 p-4">
                <div className="mb-3 font-mono text-[10px] text-text-dim">CLI</div>
                <CodeHighlight key={`cloud-cli-${language}`} code={CLOUD_COMMANDS[language]} language="bash" className="[&_code]:text-[10px] [&_code]:leading-6" />
              </div>
              <div className="mt-4 flex gap-2 text-[11px] text-text-muted"><span className="rounded border border-border px-2 py-1">REST /execute</span><span className="rounded border border-border px-2 py-1">MCP /mcp</span></div>
              <DeployWaitlist location="developer-cloud" className="feature-detail-link mt-auto! pt-6" />
              <Link href="/docs/reference/api/cli" className="mt-3 text-[11px] text-text-muted hover:text-accent">Cloud CLI reference</Link>
            </> : isBackend ? <>
              <div className="flex items-center gap-2 text-xs font-medium text-text">{language === 'typescript' ? <SiHono className="h-4 w-4 text-[#ff5b3d]" aria-hidden="true" /> : <SiFastapi className="h-4 w-4 text-[#009688]" aria-hidden="true" />}Inside your {language === 'typescript' ? 'Hono' : 'FastAPI'} backend</div>
              <p className="mt-3 text-xs leading-5 text-text-muted">Your routes and middleware. Analytics in the same process.</p>
              <div className="my-4" aria-label="Your existing backend executes hypequery queries directly against ClickHouse">
                <div className="rounded-lg border border-border bg-bg-alt/50 p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-text"><Server className="h-4 w-4 text-accent" aria-hidden="true" />Your existing backend</div>
                  <div className="mt-3 rounded-md border border-accent/20 bg-accent-soft px-3 py-2 font-mono text-[11px] text-accent">analytics.execute(orders, ...)</div>
                </div>
                <div className="flex items-center justify-center gap-2 py-3 text-[10px] text-text-muted"><ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />Direct query</div>
                <div className="flex items-center gap-2 rounded-lg border border-border px-4 py-3 text-xs text-text"><Database className="h-4 w-4 text-accent" aria-hidden="true" />ClickHouse</div>
              </div>
              <Link href="/docs/datasets/execution" className="feature-detail-link mt-auto! pt-6">Run inside your app <ArrowRight aria-hidden="true" /></Link>
            </> : <>
            <div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium text-text">Revenue by country</span><span className="text-[10px] text-text-dim">Example result</span></div>
            <table className="mt-5 w-full text-left text-xs">
              <caption className="sr-only">Illustrative revenue grouped by country</caption>
              <thead><tr className="border-b border-border text-text-muted"><th scope="col" className="pb-3 font-normal">country</th><th scope="col" className="pb-3 text-right font-normal">revenue</th></tr></thead>
              <tbody className="text-text">{[['GB', '$64,000'], ['US', '$48,000'], ['DE', '$16,000']].map(([country, revenue]) => <tr key={country} className="border-b border-border"><td className="py-3 font-mono">{country}</td><td className="py-3 text-right font-mono">{revenue}</td></tr>)}</tbody>
            </table>
            <Link href="/docs/quick-start" className="feature-detail-link mt-auto! pt-6">Build your first query <ArrowRight aria-hidden="true" /></Link>
            </>}
          </div>
        </div>
        <p className="border-t border-border px-5 py-3 text-[11px] leading-5 text-text-muted sm:px-6">{isCloud ? 'Cloud access is required. Login selects your project and environment.' : isBackend ? 'Reuses your connected analytics client and orders dataset.' : 'Uses an existing orders table and a connected analytics client.'}</p>
      </div>
    </section>
  );
}
