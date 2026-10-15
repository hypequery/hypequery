'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Copy } from 'lucide-react';
import { SiPython, SiTypescript } from 'react-icons/si';
import CodeHighlight from '@/components/CodeHighlight';
import { BACKEND_EXAMPLES, CLOUD_COMMANDS, CLOUD_EXAMPLES, DATASET_EXAMPLES } from './datasetQuickstartExamples';

const CODE_STEPS = [
  { id: 'dataset', title: 'Define & query', copy: 'Define measures and dimensions, then query them.' },
  { id: 'backend', title: 'Run in your backend', copy: 'Call it from your Hono or FastAPI routes, in the same process.' },
  { id: 'cloud', title: 'Publish to cloud', copy: 'Deploy with one command for a hosted REST API and MCP server.' },
] as const;

/** The "In code" tab of the build section: the editable example, running in your backend, then deploying to cloud. */
export function DatasetQuickstartPanel() {
  const [language, setLanguage] = useState<keyof typeof DATASET_EXAMPLES>('typescript');
  const [copyStatus, setCopyStatus] = useState('');
  const [example, setExample] = useState<'dataset' | 'backend' | 'cloud'>('dataset');
  const isBackend = example === 'backend';
  const isCloud = example === 'cloud';
  const code = isCloud ? CLOUD_EXAMPLES[language] : isBackend ? BACKEND_EXAMPLES[language] : DATASET_EXAMPLES[language];

  return (
    <div className="grid items-start gap-10 max-md:grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,400px)_minmax(0,1fr)] md:gap-12 lg:gap-16">
      <div>
        <h3 className="text-2xl font-normal tracking-[-0.03em] text-text">Write your model in code. Ship it in your own backend, or push to our cloud.</h3>
        <p className="mt-3 max-w-[520px] text-sm leading-6 text-text-muted sm:text-base">
          Define datasets in TypeScript or Python, next to your app code, and review them in pull requests.
        </p>
        {/* Vertical steps on the left, like the "With AI" tab, so both tabs share one layout. */}
        <div role="tablist" aria-label="Dataset developer examples" aria-orientation="vertical" className="mt-7 space-y-2">
          {CODE_STEPS.map(({ id, title, copy }, index) => {
            const selected = example === id;
            return (
              <button
                key={id}
                id={`dataset-step-${id}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls="dataset-example-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => { setExample(id); setCopyStatus(''); }}
                onKeyDown={(event) => {
                  const keys: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
                  if (!(event.key in keys) && event.key !== 'Home' && event.key !== 'End') return;
                  event.preventDefault();
                  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? CODE_STEPS.length - 1 : (index + keys[event.key] + CODE_STEPS.length) % CODE_STEPS.length;
                  const next = CODE_STEPS[nextIndex].id;
                  setExample(next);
                  setCopyStatus('');
                  document.getElementById(`dataset-step-${next}`)?.focus();
                }}
                className={`dataset-language flex w-full gap-4 rounded-xl border p-3 text-left transition ${selected ? 'border-border-strong bg-bg-card' : 'border-transparent hover:bg-bg-card/60'}`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${selected ? 'border-accent text-accent' : 'border-border-strong text-text-muted'}`}>{index + 1}</span>
                <span>
                  <span className={`block text-sm font-medium ${selected ? 'text-text' : 'text-text-muted'}`}>{title}</span>
                  <span className="mt-1 block text-sm leading-6 text-text-muted">{copy}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-8">
          <Link href="/docs/quick-start" className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-border-strong bg-bg-card px-5 text-sm font-semibold text-text transition hover:-translate-y-0.5 hover:border-text">Start open source <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </div>
      </div>
      <div id="dataset-example-panel" role="tabpanel" aria-labelledby={`dataset-step-${example}`} className="dataset-quickstart-panel flex h-[592px] flex-col overflow-hidden rounded-xl border border-border bg-bg-card shadow-card md:h-[632px]">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-center gap-1" role="group" aria-label="Example language">
            {(['typescript', 'python'] as const).map((value) => {
              const Icon = value === 'typescript' ? SiTypescript : SiPython;
              return <button key={value} type="button" aria-pressed={language === value} onClick={() => { setLanguage(value); setCopyStatus(''); }} className={`dataset-language flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium ${language === value ? 'bg-accent-soft text-accent' : 'text-text-muted hover:text-text'}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{value === 'typescript' ? 'TypeScript' : 'Python'}</button>;
            })}
          </div>
          <div className="flex items-center gap-1">
          <button type="button" aria-label="Copy dataset example" className="dataset-copy flex items-center gap-2 rounded-md px-2 py-1 text-xs text-text-muted hover:text-text" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopyStatus('Copied'); } catch { setCopyStatus('Select code to copy'); } }}>{copyStatus === 'Copied' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}<span aria-live="polite">{copyStatus || 'Copy'}</span></button>
          </div>
        </div>
        {/* Same height as the AI window; the body scrolls, so switching steps never resizes the panel. */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-bg-alt/50 p-5 sm:p-6">
          <div className="mb-4 font-mono text-[10px] text-text-dim">{isCloud ? 'analytics/cloud' : isBackend ? 'routes/revenue' : 'analytics/orders'}.{language === 'typescript' ? 'ts' : 'py'}</div>
          <CodeHighlight key={`${example}-${language}`} code={code} language={language} className="[&_code]:text-[11px] [&_code]:leading-[1.75] sm:[&_code]:text-xs" />
          {isCloud && <>
            <div className="mb-3 mt-6 border-t border-border pt-4 font-mono text-[10px] text-text-dim">Terminal</div>
            <CodeHighlight key={`cloud-cli-${language}`} code={CLOUD_COMMANDS[language]} language="bash" className="[&_code]:text-[11px] [&_code]:leading-[1.75] sm:[&_code]:text-xs" />
          </>}
        </div>
        <p className="border-t border-border px-5 py-3 text-[11px] leading-5 text-text-muted sm:px-6">{isCloud ? 'Cloud access is required. Login selects your project and environment.' : isBackend ? 'Reuses your connected analytics client and orders dataset.' : 'Uses an existing orders table and a connected analytics client.'}</p>
      </div>
    </div>
  );
}
